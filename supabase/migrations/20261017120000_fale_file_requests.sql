-- FaLe PDF: "Unterlagen anfordern" (file requests) – someone gets a link and uploads documents to the requester.
--
-- Zero-knowledge like the rest of "Teilen" (20261014150000_fale_share.sql):
--   - the request header (title, message, list of wanted documents, the requester's PUBLIC key) is encrypted with
--     the link key from the URL fragment – the server only stores ciphertext;
--   - every uploaded file is encrypted on the uploader's device with a key derived via ECDH from the requester's
--     public key (P-256) → only the requester's device can decrypt; whoever holds the link can upload, not download;
--   - capabilities: owner token (status, download tickets, delete) and upload token (open, upload) – stored as
--     SHA-256 only. Uploaded files are share_objects of kind 'req-file' (parent_id = request id) and use the existing
--     chunk RPCs (fale_share_put / fale_share_finish with the per-file token, fale_share_get with an API ticket).
-- Limits per request: max_files files, max_bytes bytes (counted over existing objects incl. uploads in progress).
-- Expiry: up to 30 days; uploaded files expire with the request. Same access model: RLS on, no table privileges,
-- SECURITY DEFINER RPCs gated by FALE_RPC_SECRET, EXECUTE for anon + service_role only.

alter table public.share_objects drop constraint if exists share_objects_kind_check;
alter table public.share_objects add constraint share_objects_kind_check
  check (kind in ('file', 'relay', 'sign-doc', 'sign-result', 'req-file'));

create table if not exists public.file_requests (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{16,32}$'),
  owner_hash text not null check (owner_hash ~ '^[0-9a-f]{64}$'),
  upload_hash text not null unique check (upload_hash ~ '^[0-9a-f]{64}$'),
  header text not null check (char_length(header) between 2 and 65536),
  max_files integer not null check (max_files between 1 and 200),
  max_bytes bigint not null check (max_bytes between 1048576 and 10737418240),
  closed boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists file_requests_expires_idx on public.file_requests (expires_at);
alter table public.file_requests enable row level security;
revoke all on public.file_requests from public, anon, authenticated;

-- retention: expired requests go too (their files have the same expiry and are removed with the objects)
create or replace function private.fale_share_purge() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o integer; r integer; t integer; q integer;
begin
  delete from public.sign_requests where expires_at <= now();
  delete from public.file_requests where expires_at <= now();
  get diagnostics q = row_count;
  delete from public.share_objects
   where expires_at <= now()
      or (not complete and created_at < now() - interval '6 hours')            -- abandoned uploads
      or (max_downloads is not null and downloads >= max_downloads
          and last_open_at < now() - interval '2 hours');                     -- limit reached (tickets live 2 h)
  get diagnostics o = row_count;
  delete from public.transfer_rooms where expires_at <= now();
  get diagnostics t = row_count;
  delete from public.share_usage where day < current_date - 30;
  get diagnostics r = row_count;
  return jsonb_build_object('objects', o, 'rooms', t, 'usage', r, 'requests', q);
end $$;
revoke all on function private.fale_share_purge() from public, anon, authenticated;

create or replace function private.fale_req_drop(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.share_objects where parent_id = p_id and kind = 'req-file';
  delete from public.file_requests where id = p_id;
end $$;
revoke all on function private.fale_req_drop(text) from public, anon, authenticated;

create or replace function public.fale_req_create(p_secret text, p_id text, p_owner text, p_upload text, p_header text,
  p_max_files integer, p_max_bytes bigint, p_expires timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.fale_check(p_secret);
  if random() < 0.05 then perform private.fale_share_purge(); end if;
  if p_expires <= now() or p_expires > now() + interval '30 days 5 minutes' then raise exception 'bad expiry'; end if;
  insert into public.file_requests (id, owner_hash, upload_hash, header, max_files, max_bytes, expires_at)
  values (p_id, p_owner, p_upload, p_header, p_max_files, p_max_bytes, p_expires);
  return jsonb_build_object('ok', true, 'created_at', now(), 'expires_at', p_expires);
end $$;

-- uploader view: the encrypted header + counters (never the files or their headers)
create or replace function public.fale_req_open(p_secret text, p_upload text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.file_requests; n integer; b bigint;
begin
  perform private.fale_check(p_secret);
  select * into q from public.file_requests where upload_hash = p_upload;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if q.expires_at <= now() then perform private.fale_req_drop(q.id); return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select count(*), coalesce(sum(size), 0) into n, b from public.share_objects where parent_id = q.id and kind = 'req-file';
  return jsonb_build_object('ok', true, 'header', q.header, 'closed', q.closed, 'files', n, 'bytes', b,
    'max_files', q.max_files, 'max_bytes', q.max_bytes, 'created_at', q.created_at, 'expires_at', q.expires_at);
end $$;

-- uploader announces one encrypted file; chunks follow via fale_share_put (owner = the per-file token hash)
create or replace function public.fale_req_upload(p_secret text, p_upload text, p_obj_id text, p_obj_owner text, p_header text,
  p_size bigint, p_chunks integer, p_chunk_size integer, p_cap bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.file_requests; n integer; b bigint; total bigint;
begin
  perform private.fale_check(p_secret);
  select * into q from public.file_requests where upload_hash = p_upload for update;
  if not found or q.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if q.closed then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  if p_chunks <> greatest(1, ceil(p_size::numeric / p_chunk_size)::integer) then raise exception 'bad chunking'; end if;
  select count(*), coalesce(sum(size), 0) into n, b from public.share_objects where parent_id = q.id and kind = 'req-file';
  if n + 1 > q.max_files then return jsonb_build_object('ok', false, 'reason', 'req_files'); end if;
  if b + p_size > q.max_bytes then return jsonb_build_object('ok', false, 'reason', 'req_bytes'); end if;
  select coalesce(sum(size), 0) into total from public.share_objects where expires_at > now();
  if total + p_size > p_cap then return jsonb_build_object('ok', false, 'reason', 'capacity'); end if;
  insert into public.share_objects (id, kind, owner_hash, parent_id, header, size, chunk_count, chunk_size, expires_at, max_downloads)
  values (p_obj_id, 'req-file', p_obj_owner, q.id, p_header, p_size, p_chunks, p_chunk_size, q.expires_at, null);
  return jsonb_build_object('ok', true, 'expires_at', q.expires_at);
end $$;

-- the uploader takes back one of their own uploads (per-file token)
create or replace function public.fale_req_retract(p_secret text, p_obj_id text, p_obj_owner text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform private.fale_check(p_secret);
  delete from public.share_objects where id = p_obj_id and owner_hash = p_obj_owner and kind = 'req-file';
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'deleted', n > 0);
end $$;

-- requester: request state + all completed files
create or replace function public.fale_req_status(p_secret text, p_id text, p_owner text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.file_requests; files jsonb; b bigint; n integer;
begin
  perform private.fale_check(p_secret);
  select * into q from public.file_requests where id = p_id;
  if not found then return jsonb_build_object('ok', true, 'exists', false); end if;
  if q.owner_hash <> p_owner then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if q.expires_at <= now() then perform private.fale_req_drop(q.id); return jsonb_build_object('ok', true, 'exists', false, 'expired', true); end if;
  select coalesce(jsonb_agg(private.fale_obj_json(o) order by o.created_at), '[]'::jsonb) into files
    from public.share_objects o where o.parent_id = q.id and o.kind = 'req-file' and o.complete;
  select count(*), coalesce(sum(size), 0) into n, b from public.share_objects where parent_id = q.id and kind = 'req-file';
  return jsonb_build_object('ok', true, 'exists', true, 'closed', q.closed, 'created_at', q.created_at, 'expires_at', q.expires_at,
    'max_files', q.max_files, 'max_bytes', q.max_bytes, 'used_files', n, 'used_bytes', b, 'files', files);
end $$;

create or replace function public.fale_req_set(p_secret text, p_id text, p_owner text, p_closed boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform private.fale_check(p_secret);
  update public.file_requests set closed = p_closed where id = p_id and owner_hash = p_owner and expires_at > now();
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'closed', p_closed);
end $$;

create or replace function public.fale_req_remove(p_secret text, p_id text, p_owner text, p_obj_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform private.fale_check(p_secret);
  if not exists (select 1 from public.file_requests where id = p_id and owner_hash = p_owner) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  delete from public.share_objects where id = p_obj_id and parent_id = p_id and kind = 'req-file';
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'deleted', n > 0);
end $$;

create or replace function public.fale_req_delete(p_secret text, p_id text, p_owner text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.fale_check(p_secret);
  if not exists (select 1 from public.file_requests where id = p_id) then return jsonb_build_object('ok', true, 'deleted', false); end if;
  if not exists (select 1 from public.file_requests where id = p_id and owner_hash = p_owner) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  perform private.fale_req_drop(p_id);
  return jsonb_build_object('ok', true, 'deleted', true);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.fale_req_create(text, text, text, text, text, integer, bigint, timestamptz)',
    'public.fale_req_open(text, text)',
    'public.fale_req_upload(text, text, text, text, text, bigint, integer, integer, bigint)',
    'public.fale_req_retract(text, text, text)',
    'public.fale_req_status(text, text, text)',
    'public.fale_req_set(text, text, text, boolean)',
    'public.fale_req_remove(text, text, text, text)',
    'public.fale_req_delete(text, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to anon, service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
