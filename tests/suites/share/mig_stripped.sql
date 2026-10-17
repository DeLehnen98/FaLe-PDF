create extension if not exists pgcrypto with schema extensions;
create table if not exists public.share_objects (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{16,32}$'),
  kind text not null check (kind in ('file', 'relay', 'sign-doc', 'sign-result')),
  owner_hash text not null check (owner_hash ~ '^[0-9a-f]{64}$'),
  parent_id text check (parent_id is null or parent_id ~ '^[A-Za-z0-9_-]{16,32}$'),
  header text not null check (char_length(header) between 2 and 65536),
  size bigint not null check (size > 0 and size <= 1073741824),
  chunk_count integer not null check (chunk_count between 1 and 4096),
  chunk_size integer not null check (chunk_size between 1024 and 4194304),
  complete boolean not null default false,
  max_downloads integer check (max_downloads is null or max_downloads between 1 and 1000),
  downloads integer not null default 0 check (downloads >= 0),
  last_open_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists share_objects_expires_idx on public.share_objects (expires_at);
create index if not exists share_objects_parent_idx on public.share_objects (parent_id);
create table if not exists public.share_chunks (
  object_id text not null references public.share_objects (id) on delete cascade,
  idx integer not null check (idx >= 0),
  data bytea not null,
  primary key (object_id, idx)
);
alter table public.share_chunks alter column data set storage external;
create table if not exists public.sign_requests (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{16,32}$'),
  owner_hash text not null check (owner_hash ~ '^[0-9a-f]{64}$'),
  doc_id text not null references public.share_objects (id) on delete cascade,
  signer_count integer not null check (signer_count between 1 and 10),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sign_requests_expires_idx on public.sign_requests (expires_at);
create table if not exists public.sign_signers (
  request_id text not null references public.sign_requests (id) on delete cascade,
  idx integer not null check (idx between 0 and 9),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'open' check (status in ('open', 'viewed', 'signed')),
  viewed_at timestamptz,
  signed_at timestamptz,
  result_id text references public.share_objects (id) on delete set null,
  primary key (request_id, idx)
);
create table if not exists public.transfer_rooms (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{16,32}$'),
  code text not null unique check (code ~ '^[0-9]{6}$'),
  host_hash text not null check (host_hash ~ '^[0-9a-f]{64}$'),
  guest_hash text check (guest_hash is null or guest_hash ~ '^[0-9a-f]{64}$'),
  via text check (via is null or via in ('qr', 'code')),
  created_at timestamptz not null default now(),
  joined_at timestamptz,
  expires_at timestamptz not null
);
create index if not exists transfer_rooms_expires_idx on public.transfer_rooms (expires_at);
create table if not exists public.transfer_msgs (
  seq bigint generated always as identity primary key,
  room_id text not null references public.transfer_rooms (id) on delete cascade,
  sender smallint not null check (sender in (0, 1)),
  body text not null check (char_length(body) between 1 and 65536),
  created_at timestamptz not null default now()
);
create index if not exists transfer_msgs_room_idx on public.transfer_msgs (room_id, seq);
create table if not exists public.share_usage (
  day date not null,
  key text not null check (char_length(key) between 8 and 80),
  kind text not null check (kind ~ '^[a-z_]{2,16}$'),
  n integer not null default 0 check (n >= 0),
  bytes bigint not null default 0 check (bytes >= 0),
  primary key (day, key, kind)
);
alter table public.share_objects enable row level security;
alter table public.share_chunks enable row level security;
alter table public.sign_requests enable row level security;
alter table public.sign_signers enable row level security;
alter table public.transfer_rooms enable row level security;
alter table public.transfer_msgs enable row level security;
alter table public.share_usage enable row level security;
revoke all on public.share_objects, public.share_chunks, public.sign_requests, public.sign_signers,
  public.transfer_rooms, public.transfer_msgs, public.share_usage from public, anon, authenticated;
create or replace function private.fale_share_purge() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o integer; r integer; t integer;
begin
  delete from public.sign_requests where expires_at <= now();
  delete from public.share_objects
   where expires_at <= now()
      or (not complete and created_at < now() - interval '6 hours')
      or (max_downloads is not null and downloads >= max_downloads
          and last_open_at < now() - interval '2 hours');
  get diagnostics o = row_count;
  delete from public.transfer_rooms where expires_at <= now();
  get diagnostics t = row_count;
  delete from public.share_usage where day < current_date - 30;
  get diagnostics r = row_count;
  return jsonb_build_object('objects', o, 'rooms', t, 'usage', r);
end $$;
revoke all on function private.fale_share_purge() from public, anon, authenticated;
create or replace function private.fale_obj_json(o public.share_objects) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', o.id, 'kind', o.kind, 'header', o.header, 'size', o.size, 'chunks', o.chunk_count,
    'chunk_size', o.chunk_size, 'complete', o.complete, 'expires_at', o.expires_at, 'created_at', o.created_at,
    'max_downloads', o.max_downloads, 'downloads', o.downloads)
$$;
revoke all on function private.fale_obj_json(public.share_objects) from public, anon, authenticated;
create or replace function public.fale_rate(p_secret text, p_day date, p_kind text, p_keys text[], p_n_limits integer[],
  p_bytes bigint, p_b_limits bigint[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i integer; rn integer; rb bigint;
begin
  perform private.fale_check(p_secret);
  if p_keys is null or array_length(p_keys, 1) is null or array_length(p_keys, 1) > 4
     or array_length(p_n_limits, 1) <> array_length(p_keys, 1) or array_length(p_b_limits, 1) <> array_length(p_keys, 1)
     or coalesce(p_bytes, -1) < 0 then
    raise exception 'bad input';
  end if;
  for i in 1 .. array_length(p_keys, 1) loop
    insert into public.share_usage (day, key, kind) values (p_day, p_keys[i], p_kind) on conflict do nothing;
    select n, bytes into rn, rb from public.share_usage where day = p_day and key = p_keys[i] and kind = p_kind for update;
    if rn + 1 > p_n_limits[i] or rb + p_bytes > p_b_limits[i] then
      return jsonb_build_object('ok', false, 'index', i - 1);
    end if;
  end loop;
  update public.share_usage set n = n + 1, bytes = bytes + p_bytes where day = p_day and kind = p_kind and key = any (p_keys);
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.fale_share_create(p_secret text, p_id text, p_kind text, p_owner text, p_parent text,
  p_header text, p_size bigint, p_chunks integer, p_chunk_size integer, p_expires timestamptz, p_max_downloads integer,
  p_cap bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare total bigint;
begin
  perform private.fale_check(p_secret);
  if random() < 0.05 then perform private.fale_share_purge(); end if;
  if p_expires <= now() or p_expires > now() + interval '7 days 5 minutes' then raise exception 'bad expiry'; end if;
  if p_chunks <> greatest(1, ceil(p_size::numeric / p_chunk_size)::integer) then raise exception 'bad chunking'; end if;
  select coalesce(sum(size), 0) into total from public.share_objects where expires_at > now();
  if total + p_size > p_cap then return jsonb_build_object('ok', false, 'reason', 'capacity'); end if;
  insert into public.share_objects (id, kind, owner_hash, parent_id, header, size, chunk_count, chunk_size, expires_at, max_downloads)
  values (p_id, p_kind, p_owner, p_parent, p_header, p_size, p_chunks, p_chunk_size, p_expires, p_max_downloads);
  return jsonb_build_object('ok', true, 'expires_at', p_expires);
end $$;
create or replace function public.fale_share_put(p_secret text, p_id text, p_owner text, p_idx integer, p_data text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.share_objects; d bytea;
begin
  perform private.fale_check(p_secret);
  select * into o from public.share_objects where id = p_id;
  if not found or o.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if o.owner_hash <> p_owner then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if o.complete then return jsonb_build_object('ok', false, 'reason', 'complete'); end if;
  if p_idx < 0 or p_idx >= o.chunk_count then return jsonb_build_object('ok', false, 'reason', 'bad_index'); end if;
  d := decode(p_data, 'base64');
  if octet_length(d) < 1 or octet_length(d) > o.chunk_size
     or (p_idx < o.chunk_count - 1 and octet_length(d) <> o.chunk_size) then
    return jsonb_build_object('ok', false, 'reason', 'bad_size');
  end if;
  insert into public.share_chunks (object_id, idx, data) values (p_id, p_idx, d)
  on conflict (object_id, idx) do update set data = excluded.data;
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.fale_share_finish(p_secret text, p_id text, p_owner text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.share_objects; c integer; s bigint;
begin
  perform private.fale_check(p_secret);
  select * into o from public.share_objects where id = p_id for update;
  if not found or o.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if o.owner_hash <> p_owner then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if o.complete then return jsonb_build_object('ok', true, 'object', private.fale_obj_json(o)); end if;
  select count(*), coalesce(sum(octet_length(data)), 0) into c, s from public.share_chunks where object_id = p_id;
  if c <> o.chunk_count or s <> o.size then return jsonb_build_object('ok', false, 'reason', 'incomplete', 'chunks', c, 'bytes', s); end if;
  update public.share_objects set complete = true where id = p_id returning * into o;
  return jsonb_build_object('ok', true, 'object', private.fale_obj_json(o));
end $$;
create or replace function public.fale_share_info(p_secret text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.share_objects;
begin
  perform private.fale_check(p_secret);
  delete from public.share_objects where id = p_id and expires_at <= now();
  select * into o from public.share_objects where id = p_id;
  if not found or not o.complete then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'object', private.fale_obj_json(o));
end $$;
create or replace function public.fale_share_open(p_secret text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.share_objects;
begin
  perform private.fale_check(p_secret);
  delete from public.share_objects where id = p_id and expires_at <= now();
  select * into o from public.share_objects where id = p_id for update;
  if not found or not o.complete then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if o.kind not in ('file', 'relay') then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if o.max_downloads is not null and o.downloads >= o.max_downloads then return jsonb_build_object('ok', false, 'reason', 'exhausted'); end if;
  update public.share_objects set downloads = downloads + 1, last_open_at = now() where id = p_id returning * into o;
  return jsonb_build_object('ok', true, 'object', private.fale_obj_json(o));
end $$;
create or replace function public.fale_share_get(p_secret text, p_id text, p_idx integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ok boolean; d bytea;
begin
  perform private.fale_check(p_secret);
  select (complete and expires_at > now()) into ok from public.share_objects where id = p_id;
  if not coalesce(ok, false) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select data into d from public.share_chunks where object_id = p_id and idx = p_idx;
  if d is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'data', encode(d, 'base64'));
end $$;
create or replace function public.fale_share_status(p_secret text, p_id text, p_owner text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.share_objects;
begin
  perform private.fale_check(p_secret);
  delete from public.share_objects where id = p_id and expires_at <= now();
  select * into o from public.share_objects where id = p_id;
  if not found then return jsonb_build_object('ok', true, 'exists', false); end if;
  if o.owner_hash <> p_owner then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'exists', true, 'object', private.fale_obj_json(o));
end $$;
create or replace function public.fale_share_delete(p_secret text, p_id text, p_owner text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform private.fale_check(p_secret);
  delete from public.share_objects where id = p_id and owner_hash = p_owner and kind in ('file', 'relay');
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'deleted', n > 0);
end $$;
create or replace function public.fale_sign_create(p_secret text, p_id text, p_owner text, p_doc_id text, p_signers text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.share_objects; i integer;
begin
  perform private.fale_check(p_secret);
  if p_signers is null or array_length(p_signers, 1) is null or array_length(p_signers, 1) > 10 then raise exception 'bad signers'; end if;
  select * into o from public.share_objects where id = p_doc_id for update;
  if not found or o.expires_at <= now() or not o.complete then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if o.owner_hash <> p_owner or o.kind <> 'sign-doc' or o.parent_id is not null then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  insert into public.sign_requests (id, owner_hash, doc_id, signer_count, expires_at)
  values (p_id, p_owner, p_doc_id, array_length(p_signers, 1), o.expires_at);
  update public.share_objects set parent_id = p_id where id = p_doc_id;
  for i in 1 .. array_length(p_signers, 1) loop
    insert into public.sign_signers (request_id, idx, token_hash) values (p_id, i - 1, p_signers[i]);
  end loop;
  return jsonb_build_object('ok', true, 'expires_at', o.expires_at, 'created_at', now());
end $$;
create or replace function public.fale_sign_open(p_secret text, p_signer text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.sign_signers; r public.sign_requests; d public.share_objects; src public.share_objects; prev public.sign_signers; own public.share_objects;
begin
  perform private.fale_check(p_secret);
  select * into s from public.sign_signers where token_hash = p_signer for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into r from public.sign_requests where id = s.request_id;
  if r.expires_at <= now() then
    delete from public.share_objects where parent_id = r.id;
    delete from public.sign_requests where id = r.id;
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select * into d from public.share_objects where id = r.doc_id;
  src := d;
  if s.idx > 0 then
    select * into prev from public.sign_signers where request_id = r.id and idx = s.idx - 1;
    if prev.status <> 'signed' or prev.result_id is null then
      return jsonb_build_object('ok', false, 'reason', 'waiting', 'idx', s.idx, 'count', r.signer_count);
    end if;
    select * into src from public.share_objects where id = prev.result_id;
  end if;
  if s.status = 'open' then
    update public.sign_signers set status = 'viewed', viewed_at = now() where request_id = s.request_id and idx = s.idx returning * into s;
  end if;
  if s.result_id is not null then select * into own from public.share_objects where id = s.result_id and complete; end if;
  return jsonb_build_object('ok', true, 'request', r.id, 'idx', s.idx, 'count', r.signer_count, 'status', s.status,
    'created_at', r.created_at, 'expires_at', r.expires_at, 'viewed_at', s.viewed_at, 'signed_at', s.signed_at, 'now', now(),
    'doc', private.fale_obj_json(d), 'source', private.fale_obj_json(src),
    'result', case when own.id is null then null else private.fale_obj_json(own) end);
end $$;
create or replace function public.fale_sign_result(p_secret text, p_signer text, p_obj_id text, p_header text, p_size bigint,
  p_chunks integer, p_chunk_size integer, p_cap bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.sign_signers; r public.sign_requests; prev public.sign_signers; total bigint;
begin
  perform private.fale_check(p_secret);
  select * into s from public.sign_signers where token_hash = p_signer for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into r from public.sign_requests where id = s.request_id;
  if r.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if s.status = 'signed' then return jsonb_build_object('ok', false, 'reason', 'signed'); end if;
  if s.status <> 'viewed' then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if s.idx > 0 then
    select * into prev from public.sign_signers where request_id = r.id and idx = s.idx - 1;
    if prev.status <> 'signed' then return jsonb_build_object('ok', false, 'reason', 'waiting'); end if;
  end if;
  if p_chunks <> greatest(1, ceil(p_size::numeric / p_chunk_size)::integer) then raise exception 'bad chunking'; end if;
  select coalesce(sum(size), 0) into total from public.share_objects where expires_at > now();
  if total + p_size > p_cap then return jsonb_build_object('ok', false, 'reason', 'capacity'); end if;
  if s.result_id is not null then delete from public.share_objects where id = s.result_id; end if;
  insert into public.share_objects (id, kind, owner_hash, parent_id, header, size, chunk_count, chunk_size, expires_at)
  values (p_obj_id, 'sign-result', p_signer, r.id, p_header, p_size, p_chunks, p_chunk_size, r.expires_at);
  update public.sign_signers set result_id = p_obj_id where request_id = s.request_id and idx = s.idx;
  return jsonb_build_object('ok', true, 'expires_at', r.expires_at);
end $$;
create or replace function public.fale_sign_finish(p_secret text, p_signer text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.sign_signers; o public.share_objects; c integer; b bigint;
begin
  perform private.fale_check(p_secret);
  select * into s from public.sign_signers where token_hash = p_signer for update;
  if not found or s.result_id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if s.status = 'signed' then return jsonb_build_object('ok', true, 'signed_at', s.signed_at); end if;
  select * into o from public.share_objects where id = s.result_id for update;
  if not found or o.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select count(*), coalesce(sum(octet_length(data)), 0) into c, b from public.share_chunks where object_id = o.id;
  if c <> o.chunk_count or b <> o.size then return jsonb_build_object('ok', false, 'reason', 'incomplete'); end if;
  update public.share_objects set complete = true where id = o.id;
  update public.sign_signers set status = 'signed', signed_at = now() where request_id = s.request_id and idx = s.idx returning * into s;
  return jsonb_build_object('ok', true, 'signed_at', s.signed_at);
end $$;
create or replace function public.fale_sign_status(p_secret text, p_id text, p_owner text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.sign_requests; list jsonb;
begin
  perform private.fale_check(p_secret);
  select * into r from public.sign_requests where id = p_id;
  if not found then return jsonb_build_object('ok', true, 'exists', false); end if;
  if r.owner_hash <> p_owner then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if r.expires_at <= now() then
    delete from public.share_objects where parent_id = r.id;
    delete from public.sign_requests where id = r.id;
    return jsonb_build_object('ok', true, 'exists', false, 'expired', true);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('idx', s.idx, 'status', s.status, 'viewed_at', s.viewed_at, 'signed_at', s.signed_at,
           'result', case when o.id is not null and o.complete then private.fale_obj_json(o) else null end) order by s.idx), '[]'::jsonb)
    into list
    from public.sign_signers s left join public.share_objects o on o.id = s.result_id
   where s.request_id = r.id;
  return jsonb_build_object('ok', true, 'exists', true, 'created_at', r.created_at, 'expires_at', r.expires_at, 'signers', list);
end $$;
create or replace function public.fale_sign_delete(p_secret text, p_id text, p_owner text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.sign_requests;
begin
  perform private.fale_check(p_secret);
  select * into r from public.sign_requests where id = p_id;
  if not found then return jsonb_build_object('ok', true, 'deleted', false); end if;
  if r.owner_hash <> p_owner then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  delete from public.share_objects where parent_id = r.id or id = r.doc_id;
  delete from public.sign_requests where id = r.id;
  return jsonb_build_object('ok', true, 'deleted', true);
end $$;
create or replace function public.fale_room_create(p_secret text, p_id text, p_code text, p_host text, p_expires timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.fale_check(p_secret);
  if p_expires <= now() or p_expires > now() + interval '2 hours 5 minutes' then raise exception 'bad expiry'; end if;
  delete from public.transfer_rooms where expires_at <= now();
  if exists (select 1 from public.transfer_rooms where code = p_code) then return jsonb_build_object('ok', false, 'reason', 'code_taken'); end if;
  insert into public.transfer_rooms (id, code, host_hash, expires_at) values (p_id, p_code, p_host, p_expires);
  return jsonb_build_object('ok', true, 'expires_at', p_expires);
end $$;
create or replace function public.fale_room_join(p_secret text, p_id text, p_code text, p_guest text, p_via text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.transfer_rooms;
begin
  perform private.fale_check(p_secret);
  if p_id is not null then select * into t from public.transfer_rooms where id = p_id for update;
  else select * into t from public.transfer_rooms where code = p_code for update; end if;
  if not found or t.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if t.guest_hash is not null then return jsonb_build_object('ok', false, 'reason', 'taken'); end if;
  update public.transfer_rooms set guest_hash = p_guest, via = p_via, joined_at = now() where id = t.id returning * into t;
  return jsonb_build_object('ok', true, 'room', t.id, 'expires_at', t.expires_at);
end $$;
create or replace function public.fale_room_send(p_secret text, p_id text, p_auth text, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.transfer_rooms; role smallint; n integer;
begin
  perform private.fale_check(p_secret);
  select * into t from public.transfer_rooms where id = p_id;
  if not found or t.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  role := case when t.host_hash = p_auth then 0 when t.guest_hash = p_auth then 1 else null end;
  if role is null then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select count(*) into n from public.transfer_msgs where room_id = p_id;
  if n >= 2000 then return jsonb_build_object('ok', false, 'reason', 'full'); end if;
  insert into public.transfer_msgs (room_id, sender, body) values (p_id, role, p_body);
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.fale_room_poll(p_secret text, p_id text, p_auth text, p_after bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.transfer_rooms; role smallint; msgs jsonb;
begin
  perform private.fale_check(p_secret);
  select * into t from public.transfer_rooms where id = p_id;
  if not found or t.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  role := case when t.host_hash = p_auth then 0 when t.guest_hash = p_auth then 1 else null end;
  if role is null then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('seq', m.seq, 'body', m.body) order by m.seq), '[]'::jsonb) into msgs
    from (select seq, body from public.transfer_msgs where room_id = p_id and sender <> role and seq > coalesce(p_after, 0)
           order by seq limit 50) m;
  return jsonb_build_object('ok', true, 'joined', t.guest_hash is not null, 'via', t.via, 'expires_at', t.expires_at, 'msgs', msgs);
end $$;
create or replace function public.fale_room_close(p_secret text, p_id text, p_auth text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform private.fale_check(p_secret);
  delete from public.transfer_rooms where id = p_id and (host_hash = p_auth or guest_hash = p_auth);
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'deleted', n > 0);
end $$;
create or replace function public.fale_share_purge(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.fale_check(p_secret);
  return private.fale_share_purge();
end $$;
do $$
declare f text;
begin
  foreach f in array array[
    'public.fale_rate(text, date, text, text[], integer[], bigint, bigint[])',
    'public.fale_share_create(text, text, text, text, text, text, bigint, integer, integer, timestamptz, integer, bigint)',
    'public.fale_share_put(text, text, text, integer, text)',
    'public.fale_share_finish(text, text, text)',
    'public.fale_share_info(text, text)',
    'public.fale_share_open(text, text)',
    'public.fale_share_get(text, text, integer)',
    'public.fale_share_status(text, text, text)',
    'public.fale_share_delete(text, text, text)',
    'public.fale_sign_create(text, text, text, text, text[])',
    'public.fale_sign_open(text, text)',
    'public.fale_sign_result(text, text, text, text, bigint, integer, integer, bigint)',
    'public.fale_sign_finish(text, text)',
    'public.fale_sign_status(text, text, text)',
    'public.fale_sign_delete(text, text, text)',
    'public.fale_room_create(text, text, text, text, timestamptz)',
    'public.fale_room_join(text, text, text, text, text)',
    'public.fale_room_send(text, text, text, text)',
    'public.fale_room_poll(text, text, text, bigint)',
    'public.fale_room_close(text, text, text)',
    'public.fale_share_purge(text)'
  ] loop
    execute format('revoke all on function %s from public, authenticated', f);
    execute format('grant execute on function %s to anon, service_role', f);
  end loop;
end $$;
