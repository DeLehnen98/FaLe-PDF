-- FaLe-Konto (optional account for all FaleNetwork apps) + FaLe Sync (end-to-end encrypted, zero-knowledge).
--
-- Auth: Supabase Auth (E-Mail + 6-stelliger Code). The app talks to Supabase directly with the
-- publishable key + the user's access token; everything below is protected by RLS / auth.uid().
--
-- What the server stores for sync: random item ids, a coarse kind ('file', 'folders', …), versions,
-- sizes, SHA-256 of the CIPHERTEXT, timestamps and an encrypted metadata envelope (AES-256-GCM, key
-- derived on the device from the sync master key). File contents live in the private Storage bucket
-- `sync` as encrypted chunks under `<user id>/<random blob id>/<chunk no>`. Never: file names, folder
-- or tag names, plaintext, keys. The master key exists in plaintext only on the user's devices; the
-- server keeps it only wrapped (AES-GCM) by a password-derived key (PBKDF2-SHA256 >= 600k) and by the
-- printable recovery key.
--
-- Access model
--   * every new table: RLS enabled; authenticated users may SELECT their own rows only; there are NO
--     insert/update/delete policies – writes go through the SECURITY DEFINER functions below, which use
--     auth.uid() (never a user id parameter) and serialize per user with an advisory lock.
--   * storage.objects (bucket `sync`): own prefix only; uploads only into a chunk slot that was reserved
--     before (quota check) – see sync_reserve(); no UPDATE policy → objects are immutable.
--   * quota: computed from the real object sizes in storage.objects plus open reservations; a commit
--     verifies that the uploaded chunks match the reservation exactly (count and bytes).
--   * functions for the Vercel API (Plus per account, account deletion) are gated by FALE_RPC_SECRET
--     (private.fale_check from 20261014120000_fale_ai_counters.sql) and executable by anon only.
-- Retention: tombstones 30 days, revoked devices 30 days, stale reservations 7 days
-- (private.fale_sync_purge, scheduled in 20261014180100_fale_account_sync_cron.sql).
-- Idempotent: safe to re-run.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ------------------------------------------------------------------ configuration (owner: edit via SQL)
create table if not exists private.fale_sync_config (
  key text primary key,
  value bigint not null,
  note text
);
alter table private.fale_sync_config enable row level security;
revoke all on private.fale_sync_config from public, anon, authenticated;
insert into private.fale_sync_config (key, value, note) values
  ('free_bytes', 1073741824, 'FaLe Sync: Speicher pro Konto ohne Plus (1 GB)'),
  ('plus_bytes', 21474836480, 'FaLe Sync: Speicher pro Konto mit FaLe Plus (20 GB)'),
  ('chunk_bytes', 4194332, 'Chiffretext pro Teil: 4 MiB Klartext + 12 Byte IV + 16 Byte Tag (= Bucket-Limit)'),
  ('max_pending', 64, 'gleichzeitig reservierte, noch nicht bestätigte Uploads pro Konto'),
  ('max_items', 100000, 'Einträge pro Konto'),
  ('max_meta_bytes', 98304, 'verschlüsselte Metadaten pro Eintrag (Base64-Zeichen)'),
  ('tombstone_days', 30, 'Löschmarker werden so lange aufbewahrt')
on conflict (key) do nothing;

create or replace function private.fale_cfg(p_key text) returns bigint
language sql stable security definer set search_path = '' as $$
  select value from private.fale_sync_config where key = p_key
$$;
revoke all on function private.fale_cfg(text) from public, anon, authenticated;

create sequence if not exists private.fale_sync_seq;
revoke all on sequence private.fale_sync_seq from public, anon, authenticated;

-- deletion requests (kept only until the deletion is complete, max. 30 days)
create table if not exists private.fale_account_deletions (
  user_id uuid primary key,
  requested_at timestamptz not null default now(),
  auth_deleted boolean not null default false,
  remaining_objects integer not null default 0,
  done_at timestamptz
);
alter table private.fale_account_deletions enable row level security;
revoke all on private.fale_account_deletions from public, anon, authenticated;

-- ------------------------------------------------------------------ tables
create table if not exists public.devices (
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id text not null check (device_id ~ '^[A-Za-z0-9_-]{16,64}$'),
  name text not null default '' check (char_length(name) <= 60),
  platform text not null default 'web' check (platform ~ '^[a-z0-9_-]{1,20}$'),
  app_version text check (app_version is null or char_length(app_version) <= 20),
  session_id uuid,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (user_id, device_id)
);

create table if not exists public.plus_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  purchase_token_hash text not null unique check (purchase_token_hash ~ '^[0-9a-f]{64}$'),
  product text not null check (char_length(product) between 1 and 100),
  expires_at timestamptz not null,
  verified_at timestamptz not null default now()
);

create table if not exists public.sync_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  v smallint not null default 1 check (v = 1),
  key_id text not null check (key_id ~ '^[A-Za-z0-9_-]{16,32}$'),
  kdf jsonb not null check (jsonb_typeof(kdf) = 'object' and octet_length(kdf::text) <= 400),
  wrapped_pw text not null check (char_length(wrapped_pw) between 40 and 400 and wrapped_pw ~ '^[A-Za-z0-9_-]+$'),
  wrapped_rk text not null check (char_length(wrapped_rk) between 40 and 400 and wrapped_rk ~ '^[A-Za-z0-9_-]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id text not null check (item_id ~ '^[A-Za-z0-9_-]{22}$'),
  kind text not null check (kind in ('file', 'folders', 'tags', 'sig', 'reminder', 'profile', 'settings', 'vault', 'vaultkey')),
  version bigint not null default 1 check (version >= 1),
  seq bigint not null,
  blob_id text check (blob_id is null or blob_id ~ '^[A-Za-z0-9_-]{22}$'),
  size bigint not null default 0 check (size >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  meta text check (meta is null or meta ~ '^[A-Za-z0-9_-]+$'),
  device_id text check (device_id is null or device_id ~ '^[A-Za-z0-9_-]{16,64}$'),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  deleted_at timestamptz,
  primary key (user_id, item_id),
  check ((deleted and meta is null and blob_id is null) or (not deleted and meta is not null))
);
create index if not exists sync_items_seq_idx on public.sync_items (user_id, seq);
create index if not exists sync_items_tomb_idx on public.sync_items (deleted_at) where deleted;

create table if not exists public.sync_blobs (
  user_id uuid not null references auth.users (id) on delete cascade,
  blob_id text not null check (blob_id ~ '^[A-Za-z0-9_-]{22}$'),
  size bigint not null check (size > 0),
  chunks integer not null check (chunks between 1 and 1000000),
  status text not null default 'pending' check (status in ('pending', 'live', 'dead')),
  item_id text,
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  primary key (user_id, blob_id)
);
create index if not exists sync_blobs_status_idx on public.sync_blobs (user_id, status);

alter table public.devices enable row level security;
alter table public.plus_accounts enable row level security;
alter table public.sync_keys enable row level security;
alter table public.sync_items enable row level security;
alter table public.sync_blobs enable row level security;
revoke all on public.devices, public.plus_accounts, public.sync_keys, public.sync_items, public.sync_blobs from public, anon, authenticated;
grant select on public.devices, public.plus_accounts, public.sync_keys, public.sync_items, public.sync_blobs to authenticated;

do $$
declare t text;
begin
  foreach t in array array['devices', 'plus_accounts', 'sync_keys', 'sync_items', 'sync_blobs'] loop
    execute format('drop policy if exists %I on public.%I', 'fale_own_select', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) is not null and user_id = (select auth.uid()))', 'fale_own_select', t);
  end loop;
end $$;

-- ------------------------------------------------------------------ storage bucket + policies
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sync', 'sync', false, 4194332, array['application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists fale_sync_select on storage.objects;
drop policy if exists fale_sync_insert on storage.objects;
drop policy if exists fale_sync_delete on storage.objects;
create policy fale_sync_select on storage.objects for select to authenticated using (
  bucket_id = 'sync' and (select auth.uid()) is not null and (storage.foldername(name))[1] = (select auth.uid())::text
);
-- Upload only into a reserved, still pending chunk slot <uid>/<blob id>/<n> with n < chunks.
create policy fale_sync_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'sync'
  and (select auth.uid()) is not null
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and array_length(storage.foldername(name), 1) = 2
  and exists (
    select 1 from public.sync_blobs b
    where b.user_id = (select auth.uid())
      and b.blob_id = (storage.foldername(name))[2]
      and b.status = 'pending'
      and b.chunks > (case when storage.filename(name) ~ '^(0|[1-9][0-9]{0,6})$' then storage.filename(name)::integer else 2147483647 end)
  )
);
create policy fale_sync_delete on storage.objects for delete to authenticated using (
  bucket_id = 'sync' and (select auth.uid()) is not null and (storage.foldername(name))[1] = (select auth.uid())::text
);
-- (no UPDATE policy: chunks are write-once; a changed file gets a new blob id)

-- ------------------------------------------------------------------ helpers (private)
create or replace function private.fale_uid() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare u uuid;
begin
  u := auth.uid();
  if u is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  return u;
end $$;

create or replace function private.fale_lock(p_user uuid) returns void
language sql volatile security definer set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('fale-sync:' || p_user::text, 0))
$$;

create or replace function private.fale_plus_active(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.plus_accounts where user_id = p_user and expires_at > now())
$$;

create or replace function private.fale_sync_quota(p_user uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select case when private.fale_plus_active(p_user) then private.fale_cfg('plus_bytes') else private.fale_cfg('free_bytes') end
$$;

/** Bytes per prefix as reported by Storage (real object sizes). */
create or replace function private.fale_obj_bytes(p_prefix text) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(coalesce((o.metadata ->> 'size')::bigint, 0)), 0)::bigint
  from storage.objects o
  where o.bucket_id = 'sync' and starts_with(o.name, p_prefix)
$$;

/** Usage of a user: stored = all objects under <uid>/, open = not yet uploaded part of pending reservations, meta = inline envelopes. */
create or replace function private.fale_sync_usage(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare st bigint; op bigint; me bigint;
begin
  st := private.fale_obj_bytes(p_user::text || '/');
  select coalesce(sum(greatest(b.size - private.fale_obj_bytes(p_user::text || '/' || b.blob_id || '/'), 0)), 0)::bigint into op
    from public.sync_blobs b where b.user_id = p_user and b.status = 'pending';
  select coalesce(sum(octet_length(i.meta)), 0)::bigint into me from public.sync_items i where i.user_id = p_user;
  return jsonb_build_object('stored', st, 'open', op, 'meta', me, 'total', st + op + me);
end $$;

create or replace function private.fale_item_json(i public.sync_items) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('item_id', i.item_id, 'kind', i.kind, 'version', i.version, 'seq', i.seq, 'blob_id', i.blob_id,
    'size', i.size, 'sha256', i.sha256, 'meta', i.meta, 'deleted', i.deleted, 'updated_at', i.updated_at, 'device_id', i.device_id)
$$;

do $$
declare f text;
begin
  foreach f in array array['private.fale_uid()', 'private.fale_lock(uuid)', 'private.fale_plus_active(uuid)', 'private.fale_sync_quota(uuid)',
    'private.fale_obj_bytes(text)', 'private.fale_sync_usage(uuid)', 'private.fale_item_json(public.sync_items)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- ------------------------------------------------------------------ RPCs for signed-in users (auth.uid())
create or replace function public.sync_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := private.fale_uid(); k record; n bigint;
begin
  select key_id, kdf, wrapped_pw, wrapped_rk, created_at, updated_at into k from public.sync_keys where user_id = u;
  select count(*) into n from public.sync_items where user_id = u and not deleted;
  return jsonb_build_object('ok', true,
    'plus', private.fale_plus_active(u),
    'quota', private.fale_sync_quota(u),
    'usage', private.fale_sync_usage(u),
    'items', n,
    'chunk_bytes', private.fale_cfg('chunk_bytes'),
    'max_meta', private.fale_cfg('max_meta_bytes'),
    'cursor', coalesce((select max(seq) from public.sync_items where user_id = u), 0),
    'key', case when k.key_id is null then null else jsonb_build_object('key_id', k.key_id, 'kdf', k.kdf, 'wrapped_pw', k.wrapped_pw,
      'wrapped_rk', k.wrapped_rk, 'created_at', k.created_at, 'updated_at', k.updated_at) end);
end $$;

/** Store the wrapped master key. p_mode 'create' (first device) or 'update' (new password / new recovery key, same key). */
create or replace function public.sync_keys_put(p_key_id text, p_kdf jsonb, p_wrapped_pw text, p_wrapped_rk text, p_mode text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u uuid := private.fale_uid(); cur record; it bigint;
begin
  if p_mode not in ('create', 'update') or p_key_id is null or p_key_id !~ '^[A-Za-z0-9_-]{16,32}$'
     or p_kdf is null or jsonb_typeof(p_kdf) <> 'object' or p_kdf ->> 'alg' <> 'PBKDF2-SHA256'
     or coalesce((p_kdf ->> 'iter')::bigint, 0) < 600000 or (p_kdf ->> 'iter')::bigint > 10000000
     or coalesce(p_kdf ->> 'salt', '') !~ '^[A-Za-z0-9_-]{16,64}$' or octet_length(p_kdf::text) > 400 then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  perform private.fale_lock(u);
  select * into cur from public.sync_keys where user_id = u for update;
  if p_mode = 'create' then
    if found and cur.key_id <> p_key_id then return jsonb_build_object('ok', false, 'reason', 'exists', 'key_id', cur.key_id); end if;
    if not found then
      -- a new key must start from an empty cloud (otherwise old items could not be decrypted)
      select count(*) into it from public.sync_items where user_id = u;
      if it > 0 then return jsonb_build_object('ok', false, 'reason', 'not_empty'); end if;
    end if;
  elsif not found or cur.key_id <> p_key_id then
    return jsonb_build_object('ok', false, 'reason', 'key_mismatch');
  end if;
  insert into public.sync_keys (user_id, key_id, kdf, wrapped_pw, wrapped_rk)
  values (u, p_key_id, p_kdf, p_wrapped_pw, p_wrapped_rk)
  on conflict (user_id) do update set kdf = excluded.kdf, wrapped_pw = excluded.wrapped_pw, wrapped_rk = excluded.wrapped_rk, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

/** Reserve upload slots for one encrypted blob (quota check happens here). */
create or replace function public.sync_reserve(p_blob_id text, p_size bigint, p_chunks integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u uuid := private.fale_uid(); cb bigint := private.fale_cfg('chunk_bytes'); us jsonb; q bigint; np integer;
begin
  if p_blob_id is null or p_blob_id !~ '^[A-Za-z0-9_-]{22}$' or p_size is null or p_size < 1 or p_chunks is null
     or p_chunks <> ((p_size + cb - 1) / cb)::integer then
    return jsonb_build_object('ok', false, 'reason', 'bad_input', 'chunk_bytes', cb);
  end if;
  perform private.fale_lock(u);
  if not exists (select 1 from public.sync_keys where user_id = u) then return jsonb_build_object('ok', false, 'reason', 'no_key'); end if;
  if exists (select 1 from public.sync_blobs where user_id = u and blob_id = p_blob_id) then return jsonb_build_object('ok', false, 'reason', 'exists'); end if;
  select count(*) into np from public.sync_blobs where user_id = u and status = 'pending';
  if np >= private.fale_cfg('max_pending') then return jsonb_build_object('ok', false, 'reason', 'too_many_pending'); end if;
  us := private.fale_sync_usage(u);
  q := private.fale_sync_quota(u);
  if (us ->> 'total')::bigint + p_size > q then
    return jsonb_build_object('ok', false, 'reason', 'quota', 'used', (us ->> 'total')::bigint, 'quota', q);
  end if;
  insert into public.sync_blobs (user_id, blob_id, size, chunks) values (u, p_blob_id, p_size, p_chunks);
  return jsonb_build_object('ok', true, 'chunk_bytes', cb);
end $$;

/**
 * Create or update an item (optimistic concurrency: p_base_version = version the client last saw, 0 = new).
 * With a new p_blob_id the uploaded chunks must match the reservation exactly.
 */
create or replace function public.sync_commit(p_item_id text, p_kind text, p_base_version bigint, p_meta text, p_blob_id text, p_sha256 text, p_device text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u uuid := private.fale_uid(); cur public.sync_items; b record; cnt bigint; tot bigint; mx bigint; bad bigint; cb bigint := private.fale_cfg('chunk_bytes');
  us jsonb; q bigint; dead text := null; v bigint; s bigint; resurrect boolean := false; n bigint; bsize bigint := null;
begin
  if p_item_id is null or p_item_id !~ '^[A-Za-z0-9_-]{22}$'
     or p_kind is null or p_kind not in ('file', 'folders', 'tags', 'sig', 'reminder', 'profile', 'settings', 'vault', 'vaultkey')
     or p_base_version is null or p_base_version < 0
     or p_meta is null or p_meta !~ '^[A-Za-z0-9_-]+$' or char_length(p_meta) > private.fale_cfg('max_meta_bytes')
     or (p_blob_id is not null and p_blob_id !~ '^[A-Za-z0-9_-]{22}$')
     or (p_sha256 is not null and p_sha256 !~ '^[0-9a-f]{64}$')
     or (p_device is not null and p_device !~ '^[A-Za-z0-9_-]{16,64}$') then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  perform private.fale_lock(u);
  if not exists (select 1 from public.sync_keys where user_id = u) then return jsonb_build_object('ok', false, 'reason', 'no_key'); end if;
  select * into cur from public.sync_items where user_id = u and item_id = p_item_id for update;
  if found then
    if cur.version <> p_base_version then
      return jsonb_build_object('ok', false, 'reason', 'conflict', 'item', private.fale_item_json(cur));
    end if;
    if cur.kind <> p_kind then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  else
    -- p_base_version > 0 but the row is gone (tombstone purged after 30 days) → treat as new
    resurrect := p_base_version > 0;
    select count(*) into n from public.sync_items where user_id = u;
    if n >= private.fale_cfg('max_items') then return jsonb_build_object('ok', false, 'reason', 'too_many_items'); end if;
  end if;
  -- quota for the (inline) metadata growth
  if octet_length(p_meta) > coalesce(octet_length(cur.meta), 0) then
    us := private.fale_sync_usage(u); q := private.fale_sync_quota(u);
    if (us ->> 'total')::bigint + octet_length(p_meta) - coalesce(octet_length(cur.meta), 0) > q then
      return jsonb_build_object('ok', false, 'reason', 'quota', 'used', (us ->> 'total')::bigint, 'quota', q);
    end if;
  end if;
  if p_blob_id is not null and p_blob_id is distinct from cur.blob_id then
    select * into b from public.sync_blobs where user_id = u and blob_id = p_blob_id for update;
    if not found or b.status <> 'pending' then return jsonb_build_object('ok', false, 'reason', 'no_blob'); end if;
    select count(*), coalesce(sum(coalesce((o.metadata ->> 'size')::bigint, -1)), 0), coalesce(max(coalesce((o.metadata ->> 'size')::bigint, 0)), 0),
           count(*) filter (where storage.filename(o.name) !~ '^(0|[1-9][0-9]{0,6})$' or storage.filename(o.name)::bigint >= b.chunks)
      into cnt, tot, mx, bad
      from storage.objects o where o.bucket_id = 'sync' and starts_with(o.name, u::text || '/' || p_blob_id || '/');
    if cnt <> b.chunks or tot <> b.size or mx > cb or bad > 0 then
      return jsonb_build_object('ok', false, 'reason', 'incomplete', 'chunks', cnt, 'bytes', tot);
    end if;
    update public.sync_blobs set status = 'live', item_id = p_item_id, committed_at = now() where user_id = u and blob_id = p_blob_id;
    bsize := b.size;
  end if;
  if cur.blob_id is not null and cur.blob_id is distinct from p_blob_id then
    update public.sync_blobs set status = 'dead' where user_id = u and blob_id = cur.blob_id;
    dead := cur.blob_id;
  end if;
  v := coalesce(cur.version, 0) + 1;
  s := nextval('private.fale_sync_seq');
  insert into public.sync_items (user_id, item_id, kind, version, seq, blob_id, size, sha256, meta, device_id, updated_at, deleted, deleted_at)
  values (u, p_item_id, p_kind, v, s, p_blob_id,
          case when p_blob_id is null then 0 else coalesce(bsize, cur.size) end, p_sha256, p_meta, p_device, now(), false, null)
  on conflict (user_id, item_id) do update set version = excluded.version, seq = excluded.seq, blob_id = excluded.blob_id, size = excluded.size,
    sha256 = excluded.sha256, meta = excluded.meta, device_id = excluded.device_id, updated_at = now(), deleted = false, deleted_at = null;
  return jsonb_build_object('ok', true, 'version', v, 'seq', s, 'dead', dead, 'resurrected', resurrect);
end $$;

/** Tombstone an item (kept 30 days so other devices learn about the deletion). */
create or replace function public.sync_delete(p_item_id text, p_base_version bigint, p_device text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u uuid := private.fale_uid(); cur public.sync_items; s bigint; dead text := null;
begin
  if p_item_id is null or p_item_id !~ '^[A-Za-z0-9_-]{22}$' or p_base_version is null
     or (p_device is not null and p_device !~ '^[A-Za-z0-9_-]{16,64}$') then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  perform private.fale_lock(u);
  select * into cur from public.sync_items where user_id = u and item_id = p_item_id for update;
  if not found then return jsonb_build_object('ok', true, 'missing', true); end if;
  if cur.deleted then return jsonb_build_object('ok', true, 'version', cur.version, 'seq', cur.seq); end if;
  if cur.version <> p_base_version then return jsonb_build_object('ok', false, 'reason', 'conflict', 'item', private.fale_item_json(cur)); end if;
  if cur.blob_id is not null then
    update public.sync_blobs set status = 'dead' where user_id = u and blob_id = cur.blob_id;
    dead := cur.blob_id;
  end if;
  s := nextval('private.fale_sync_seq');
  update public.sync_items set deleted = true, deleted_at = now(), meta = null, blob_id = null, size = 0, sha256 = null,
    version = version + 1, seq = s, device_id = p_device, updated_at = now()
  where user_id = u and item_id = p_item_id;
  return jsonb_build_object('ok', true, 'version', cur.version + 1, 'seq', s, 'dead', dead);
end $$;

/** Changes after a cursor (sequence number), oldest first. */
create or replace function public.sync_pull(p_after bigint, p_limit integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := private.fale_uid(); lim integer := least(greatest(coalesce(p_limit, 200), 1), 500); arr jsonb; mx bigint; more boolean;
begin
  select coalesce(jsonb_agg(private.fale_item_json(t.i) order by (t.i).seq), '[]'::jsonb), max((t.i).seq) into arr, mx
  from (select i from public.sync_items i where i.user_id = u and i.seq > coalesce(p_after, 0) order by i.seq limit lim) t;
  more := exists (select 1 from public.sync_items where user_id = u and seq > coalesce(mx, p_after, 0));
  return jsonb_build_object('ok', true, 'items', arr, 'cursor', coalesce(mx, p_after, 0), 'more', more);
end $$;

/** Blobs the device should delete from Storage: replaced/deleted (dead) and abandoned reservations. */
create or replace function public.sync_garbage() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := private.fale_uid(); arr jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('blob_id', blob_id, 'chunks', chunks, 'status', status)), '[]'::jsonb) into arr from (
    select blob_id, chunks, status from public.sync_blobs
    where user_id = u and (status = 'dead' or (status = 'pending' and created_at < now() - interval '6 hours'))
    order by created_at limit 200) t;
  return jsonb_build_object('ok', true, 'blobs', arr);
end $$;

/** Forget blob rows whose objects are gone (dead blobs, or the caller's own aborted reservations). */
create or replace function public.sync_blob_gone(p_blob_ids text[]) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u uuid := private.fale_uid(); x text; n integer := 0; left_ integer := 0;
begin
  if p_blob_ids is null or coalesce(array_length(p_blob_ids, 1), 0) > 500 then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  perform private.fale_lock(u);
  foreach x in array p_blob_ids loop
    continue when x is null or x !~ '^[A-Za-z0-9_-]{22}$';
    if exists (select 1 from storage.objects o where o.bucket_id = 'sync' and starts_with(o.name, u::text || '/' || x || '/')) then
      left_ := left_ + 1; continue;
    end if;
    delete from public.sync_blobs where user_id = u and blob_id = x and status in ('dead', 'pending');
    if found then n := n + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'removed', n, 'remaining', left_);
end $$;

/** "Alle Cloud-Daten löschen": items, reservations and the wrapped keys (objects are deleted by the device first). */
create or replace function public.sync_wipe() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u uuid := private.fale_uid(); left_ bigint;
begin
  perform private.fale_lock(u);
  delete from public.sync_items where user_id = u;
  delete from public.sync_blobs where user_id = u;
  delete from public.sync_keys where user_id = u;
  select count(*) into left_ from storage.objects o where o.bucket_id = 'sync' and starts_with(o.name, u::text || '/');
  return jsonb_build_object('ok', true, 'remaining_objects', left_);
end $$;

-- ------------------------------------------------------------------ devices
create or replace function public.fale_device_touch(p_device text, p_name text, p_platform text, p_version text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u uuid := private.fale_uid(); cur record; sid uuid;
begin
  if p_device is null or p_device !~ '^[A-Za-z0-9_-]{16,64}$' then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  begin sid := nullif(auth.jwt() ->> 'session_id', '')::uuid; exception when others then sid := null; end;
  select * into cur from public.devices where user_id = u and device_id = p_device;
  if found and cur.revoked_at is not null then return jsonb_build_object('ok', true, 'revoked', true); end if;
  insert into public.devices as d (user_id, device_id, name, platform, app_version, session_id, last_seen_at)
  values (u, p_device, left(coalesce(btrim(p_name), ''), 60), coalesce(nullif(lower(regexp_replace(coalesce(p_platform, ''), '[^a-zA-Z0-9_-]', '', 'g')), ''), 'web'),
          left(nullif(p_version, ''), 20), sid, now())
  on conflict (user_id, device_id) do update set
    name = case when excluded.name <> '' then excluded.name else d.name end,
    platform = excluded.platform, app_version = excluded.app_version, session_id = coalesce(excluded.session_id, d.session_id), last_seen_at = now();
  return jsonb_build_object('ok', true, 'revoked', false);
end $$;

create or replace function public.fale_devices() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := private.fale_uid(); arr jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('device_id', device_id, 'name', name, 'platform', platform, 'app_version', app_version,
      'created_at', created_at, 'last_seen_at', last_seen_at) order by last_seen_at desc), '[]'::jsonb) into arr
  from public.devices where user_id = u and revoked_at is null;
  return jsonb_build_object('ok', true, 'devices', arr);
end $$;

/** Sign a device out remotely: it is marked revoked (it wipes its keys on the next contact) and its session is ended. */
create or replace function public.fale_device_revoke(p_device text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u uuid := private.fale_uid(); sid uuid; ended boolean := false;
begin
  if p_device is null or p_device !~ '^[A-Za-z0-9_-]{16,64}$' then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  update public.devices set revoked_at = now() where user_id = u and device_id = p_device and revoked_at is null returning session_id into sid;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if sid is not null then
    begin
      delete from auth.sessions where id = sid and user_id = u;
      ended := found;
    exception when others then ended := false; -- no privilege on auth.sessions: the device still signs itself out on its next contact
    end;
  end if;
  return jsonb_build_object('ok', true, 'session_ended', ended);
end $$;

-- ------------------------------------------------------------------ secret-gated RPCs for the Vercel API
create or replace function public.fale_account_plus_get(p_secret text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  perform private.fale_check(p_secret);
  select product, expires_at into r from public.plus_accounts where user_id = p_user;
  if not found then return null; end if;
  return jsonb_build_object('product', r.product, 'expires_at', r.expires_at);
end $$;

create or replace function public.fale_account_plus_upsert(p_secret text, p_user uuid, p_token_hash text, p_product text, p_expires timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.fale_check(p_secret);
  if not exists (select 1 from auth.users where id = p_user) then return jsonb_build_object('ok', false, 'reason', 'no_user'); end if;
  -- one purchase belongs to one account at a time (the latest one that verified it)
  delete from public.plus_accounts where purchase_token_hash = p_token_hash and user_id <> p_user;
  insert into public.plus_accounts (user_id, purchase_token_hash, product, expires_at, verified_at)
  values (p_user, p_token_hash, p_product, p_expires, now())
  on conflict (user_id) do update set purchase_token_hash = excluded.purchase_token_hash, product = excluded.product,
    expires_at = excluded.expires_at, verified_at = now();
  return jsonb_build_object('ok', true);
end $$;

/** Link the Plus subscription of a device (verified earlier via /api/plus-verify) to the account. */
create or replace function public.fale_account_plus_link(p_secret text, p_user uuid, p_device text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  perform private.fale_check(p_secret);
  select purchase_token_hash, product, expires_at into r from public.plus_entitlements where device_hash = p_device and expires_at > now();
  if not found then return jsonb_build_object('ok', true, 'linked', false); end if;
  if not exists (select 1 from auth.users where id = p_user) then return jsonb_build_object('ok', false, 'reason', 'no_user'); end if;
  delete from public.plus_accounts where purchase_token_hash = r.purchase_token_hash and user_id <> p_user;
  insert into public.plus_accounts (user_id, purchase_token_hash, product, expires_at, verified_at)
  values (p_user, r.purchase_token_hash, r.product, r.expires_at, now())
  on conflict (user_id) do update set purchase_token_hash = excluded.purchase_token_hash, product = excluded.product,
    expires_at = excluded.expires_at, verified_at = now();
  return jsonb_build_object('ok', true, 'linked', true, 'product', r.product, 'expires_at', r.expires_at);
end $$;

/**
 * Delete all app data of an account. Storage objects are removed by the API with the user's own token
 * before this call (SQL cannot delete files in Storage); remaining ones are counted and reported.
 * The auth user is deleted here when the database role may do so – otherwise it stays marked in
 * private.fale_account_deletions and the owner deletes it (dashboard or service-role key, see store/ACCOUNT-SETUP.md).
 */
create or replace function public.fale_account_delete(p_secret text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare left_ integer; gone boolean := false;
begin
  perform private.fale_check(p_secret);
  if p_user is null then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  perform private.fale_lock(p_user);
  delete from public.sync_items where user_id = p_user;
  delete from public.sync_blobs where user_id = p_user;
  delete from public.sync_keys where user_id = p_user;
  delete from public.devices where user_id = p_user;
  delete from public.plus_accounts where user_id = p_user;
  select count(*) into left_ from storage.objects o where o.bucket_id = 'sync' and starts_with(o.name, p_user::text || '/');
  begin
    delete from auth.users where id = p_user;
    gone := found;
  exception when others then gone := false;
  end;
  insert into private.fale_account_deletions (user_id, auth_deleted, remaining_objects, done_at)
  values (p_user, gone, left_, case when gone and left_ = 0 then now() end)
  on conflict (user_id) do update set auth_deleted = excluded.auth_deleted, remaining_objects = excluded.remaining_objects, done_at = excluded.done_at;
  return jsonb_build_object('ok', true, 'auth_deleted', gone, 'remaining_objects', left_);
end $$;

/** Mark the auth user as deleted after the API removed it with the service-role key (optional). */
create or replace function public.fale_account_deleted(p_secret text, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.fale_check(p_secret);
  update private.fale_account_deletions set auth_deleted = true, done_at = case when remaining_objects = 0 then now() else done_at end where user_id = p_user;
end $$;

-- ------------------------------------------------------------------ privileges
do $$
declare f text;
begin
  foreach f in array array[
    'public.sync_status()',
    'public.sync_keys_put(text, jsonb, text, text, text)',
    'public.sync_reserve(text, bigint, integer)',
    'public.sync_commit(text, text, bigint, text, text, text, text)',
    'public.sync_delete(text, bigint, text)',
    'public.sync_pull(bigint, integer)',
    'public.sync_garbage()',
    'public.sync_blob_gone(text[])',
    'public.sync_wipe()',
    'public.fale_device_touch(text, text, text, text)',
    'public.fale_devices()',
    'public.fale_device_revoke(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'public.fale_account_plus_get(text, uuid)',
    'public.fale_account_plus_upsert(text, uuid, text, text, timestamptz)',
    'public.fale_account_plus_link(text, uuid, text)',
    'public.fale_account_delete(text, uuid)',
    'public.fale_account_deleted(text, uuid)'
  ] loop
    execute format('revoke all on function %s from public, authenticated', f);
    execute format('grant execute on function %s to anon, service_role', f);
  end loop;
end $$;
