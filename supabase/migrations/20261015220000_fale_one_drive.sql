-- FaLe One (FaLe Drive + FaLe Fotos): end-to-end encrypted cloud drive / photo backup for the FaLe-Konto.
-- Contract and crypto: docs/FALE-ONE-API.md. Idempotent – safe to re-run.
--
-- What the server stores: random ids (uuid), a coarse kind (folder | file | photo), parent ids, version and
-- change-feed sequence numbers, ciphertext sizes and chunk layout, timestamps, wrapped keys and encrypted
-- metadata envelopes (opaque base64url), an optional keyed content hash (HMAC with a key only the user's
-- devices know – the server cannot test a guess), album membership (ids only) and backup heartbeats.
-- Never: file/folder/album/device names, MIME types, plaintext sizes, dates of capture, EXIF/GPS, keys, content.
--
-- Access model (same as the share feature / account RPCs for the Vercel API):
--   * every table: RLS enabled, NO policies, no privileges for anon/authenticated → direct table access is denied.
--   * all access goes through SECURITY DEFINER functions gated by FALE_RPC_SECRET (private.fale_check from
--     20261014120000_fale_ai_counters.sql), executable by anon (= the publishable key the API uses) and
--     service_role only. The API verifies the FaLe-Konto access token and passes the user id.
--   * every write serializes per user with an advisory transaction lock; the change-feed sequence number is
--     drawn inside that lock, so feed entries become visible in sequence order (cursor-safe).
-- Blob storage: chunks live in public.one_chunks (bytea, ≤ 4 MiB each, default 1 MiB) for backend 'pg';
-- for backend 's3' (Hetzner Object Storage, later) only the bookkeeping lives here and deleted blobs are queued
-- in private.fale_one_gc for the API to remove from the bucket.
-- Retention / purge: 20261015220100_fale_one_drive_cron.sql.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ------------------------------------------------------------------ configuration (owner: edit via SQL)
create table if not exists private.fale_one_config (
  key text primary key,
  value bigint not null,
  note text
);
alter table private.fale_one_config enable row level security;
revoke all on private.fale_one_config from public, anon, authenticated;
insert into private.fale_one_config (key, value, note) values
  ('free_bytes', 10737418240, 'Speicher pro Konto (kostenlos): 10 GiB'),
  ('plus_bytes', 10737418240, 'Speicher pro Konto mit FaLe Plus (bis es eigene One-Tarife gibt: wie kostenlos)'),
  ('beta_cap_bytes', 2147483648, 'Beta-Obergrenze pro Konto, solange Dateien in Postgres liegen (0 = aus); gilt nicht bei public.one_accounts.quota_bytes'),
  ('pg_total_cap_bytes', 5368709120, 'Alle Konten zusammen im Postgres-Blobspeicher (0 = aus) – schützt die Datenbankgröße'),
  ('max_file_bytes', 10737418240, 'größte Datei (Chiffretext)'),
  ('thumb_max_bytes', 131072, 'Vorschaubild (ein Teil, Chiffretext)'),
  ('preview_max_bytes', 8388608, 'große Vorschau (Chiffretext)'),
  ('max_nodes', 1000000, 'Einträge (Dateien + Ordner + Löschmarker) pro Konto'),
  ('max_pending', 256, 'gleichzeitig offene Upload-Sitzungen pro Konto'),
  ('max_meta_chars', 16384, 'verschlüsselte Metadaten pro Eintrag (Base64url-Zeichen)'),
  ('upload_ttl_hours', 24, 'offene Upload-Sitzungen verfallen danach'),
  ('trash_days', 30, 'Papierkorb: endgültig gelöscht nach'),
  ('version_days', 30, 'alte Versionen: gelöscht nach (Tage seit sie ersetzt wurden)'),
  ('version_keep', 10, 'alte Versionen: höchstens so viele pro Datei'),
  ('tombstone_days', 30, 'Löschmarker für die Änderungsliste'),
  ('backup_warn_days', 3, 'Backup-Warnung nach so vielen Tagen ohne erfolgreiches Backup'),
  ('max_albums', 10000, 'Alben pro Konto'),
  ('max_devices', 50, 'Backup-Geräte pro Konto'),
  ('max_depth', 128, 'maximale Ordnertiefe')
on conflict (key) do nothing;

create or replace function private.fale_one_cfg(p_key text) returns bigint
language sql stable security definer set search_path = '' as $$
  select value from private.fale_one_config where key = p_key
$$;

create sequence if not exists private.fale_one_seq;
revoke all on sequence private.fale_one_seq from public, anon, authenticated;

-- global byte counters per backend (beta capacity protection)
create table if not exists private.fale_one_totals (
  backend text primary key check (backend in ('pg', 's3')),
  bytes bigint not null default 0
);
alter table private.fale_one_totals enable row level security;
revoke all on private.fale_one_totals from public, anon, authenticated;
insert into private.fale_one_totals (backend) values ('pg'), ('s3') on conflict do nothing;

-- objects to delete from the S3 bucket (filled by a trigger whenever an s3 blob row disappears)
create table if not exists private.fale_one_gc (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  blob_id uuid not null,
  chunks integer not null,
  created_at timestamptz not null default now(),
  attempts integer not null default 0
);
alter table private.fale_one_gc enable row level security;
revoke all on private.fale_one_gc from public, anon, authenticated;

-- ------------------------------------------------------------------ tables
create table if not exists public.one_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  quota_bytes bigint check (quota_bytes is null or quota_bytes >= 0),   -- owner override (paid plans later)
  blob_bytes bigint not null default 0,                                 -- all blobs incl. open uploads (trigger)
  meta_bytes bigint not null default 0,                                 -- keys + envelopes (trigger)
  node_count integer not null default 0,                                -- incl. tombstones (trigger)
  min_cursor bigint not null default 0,                                 -- feed cursors below this need a full resync
  created_at timestamptz not null default now()
);

create table if not exists public.one_nodes (
  user_id uuid not null references auth.users (id) on delete cascade,
  node_id uuid not null,
  parent_id uuid,
  kind text not null check (kind in ('folder', 'file', 'photo')),
  version bigint not null default 1 check (version >= 1),
  seq bigint not null,
  key text check (key is null or key ~ '^[A-Za-z0-9_-]{40,200}$'),
  meta text check (meta is null or (char_length(meta) between 24 and 65536 and meta ~ '^[A-Za-z0-9_-]+$')),
  head_rev uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  trashed_at timestamptz,
  trash_root uuid,
  deleted boolean not null default false,
  deleted_at timestamptz,
  primary key (user_id, node_id),
  check (parent_id is null or parent_id <> node_id),
  check ((deleted and key is null and meta is null and head_rev is null and trashed_at is null)
      or (not deleted and key is not null and meta is not null)),
  check (deleted or kind = 'folder' or head_rev is not null),
  check ((trashed_at is null) = (trash_root is null))
);
create index if not exists one_nodes_seq_idx on public.one_nodes (user_id, seq);
create index if not exists one_nodes_parent_idx on public.one_nodes (user_id, parent_id);
create index if not exists one_nodes_trash_idx on public.one_nodes (user_id, trash_root) where trash_root is not null;
create index if not exists one_nodes_trashed_idx on public.one_nodes (trashed_at) where trashed_at is not null;
create index if not exists one_nodes_tomb_idx on public.one_nodes (deleted_at) where deleted;

create table if not exists public.one_revisions (
  user_id uuid not null,
  rev_id uuid not null,
  node_id uuid not null,
  key text not null check (key ~ '^[A-Za-z0-9_-]{40,200}$'),
  meta text not null check (char_length(meta) between 24 and 65536 and meta ~ '^[A-Za-z0-9_-]+$'),
  hash text check (hash is null or hash ~ '^[A-Za-z0-9_-]{43}$'),
  size bigint not null default 0 check (size >= 0),
  device_id text check (device_id is null or device_id ~ '^[A-Za-z0-9_-]{16,64}$'),
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  primary key (user_id, rev_id),
  foreign key (user_id, node_id) references public.one_nodes (user_id, node_id) on delete cascade
);
create index if not exists one_revisions_node_idx on public.one_revisions (user_id, node_id);
create index if not exists one_revisions_hash_idx on public.one_revisions (user_id, hash) where hash is not null;
create index if not exists one_revisions_old_idx on public.one_revisions (superseded_at) where superseded_at is not null;

create table if not exists public.one_blobs (
  user_id uuid not null references auth.users (id) on delete cascade,
  blob_id uuid not null,
  purpose text not null check (purpose in ('content', 'thumb', 'preview')),
  backend text not null check (backend in ('pg', 's3')),
  size bigint not null check (size > 0),
  chunks integer not null check (chunks between 1 and 200000),
  chunk_size integer not null check (chunk_size between 65536 and 4194304),
  status text not null default 'pending' check (status in ('pending', 'live')),
  rev_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  committed_at timestamptz,
  primary key (user_id, blob_id),
  foreign key (user_id, rev_id) references public.one_revisions (user_id, rev_id) on delete cascade,
  check (chunks = ((size + chunk_size - 1) / chunk_size)),
  check ((status = 'pending' and rev_id is null and expires_at is not null) or (status = 'live' and rev_id is not null))
);
create index if not exists one_blobs_rev_idx on public.one_blobs (user_id, rev_id);
create index if not exists one_blobs_pending_idx on public.one_blobs (expires_at) where status = 'pending';
create index if not exists one_blobs_status_idx on public.one_blobs (user_id, status);

create table if not exists public.one_chunks (
  user_id uuid not null,
  blob_id uuid not null,
  idx integer not null check (idx >= 0),
  data bytea not null,
  primary key (user_id, blob_id, idx),
  foreign key (user_id, blob_id) references public.one_blobs (user_id, blob_id) on delete cascade
);
-- ciphertext does not compress: store it out of line without trying
alter table public.one_chunks alter column data set storage external;

create table if not exists public.one_albums (
  user_id uuid not null references auth.users (id) on delete cascade,
  album_id uuid not null,
  version bigint not null default 1 check (version >= 1),
  seq bigint not null,
  key text check (key is null or key ~ '^[A-Za-z0-9_-]{40,200}$'),
  meta text check (meta is null or (char_length(meta) between 24 and 65536 and meta ~ '^[A-Za-z0-9_-]+$')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  deleted_at timestamptz,
  primary key (user_id, album_id),
  check ((deleted and key is null and meta is null) or (not deleted and key is not null and meta is not null))
);
create index if not exists one_albums_seq_idx on public.one_albums (user_id, seq);

create table if not exists public.one_album_items (
  user_id uuid not null,
  album_id uuid not null,
  node_id uuid not null,
  seq bigint not null,
  added_at timestamptz not null default now(),
  removed boolean not null default false,
  removed_at timestamptz,
  primary key (user_id, album_id, node_id),
  foreign key (user_id, album_id) references public.one_albums (user_id, album_id) on delete cascade
);
create index if not exists one_album_items_seq_idx on public.one_album_items (user_id, seq);
create index if not exists one_album_items_node_idx on public.one_album_items (user_id, node_id);

create table if not exists public.one_backup_devices (
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id text not null check (device_id ~ '^[A-Za-z0-9_-]{16,64}$'),
  meta text check (meta is null or (char_length(meta) between 24 and 4096 and meta ~ '^[A-Za-z0-9_-]+$')),
  status text not null default 'idle' check (status in ('idle', 'running', 'paused', 'error')),
  pending integer not null default 0 check (pending >= 0),
  pending_bytes bigint not null default 0 check (pending_bytes >= 0),
  error text check (error is null or error ~ '^[a-z0-9_]{1,40}$'),
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

do $$
declare t text;
begin
  foreach t in array array['one_accounts', 'one_nodes', 'one_revisions', 'one_blobs', 'one_chunks', 'one_albums', 'one_album_items', 'one_backup_devices'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- ------------------------------------------------------------------ counters (triggers)
create or replace function private.fale_one_blob_trg() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.one_accounts set blob_bytes = blob_bytes + new.size where user_id = new.user_id;
    update private.fale_one_totals set bytes = bytes + new.size where backend = new.backend;
    return new;
  end if;
  update public.one_accounts set blob_bytes = greatest(blob_bytes - old.size, 0) where user_id = old.user_id;
  update private.fale_one_totals set bytes = greatest(bytes - old.size, 0) where backend = old.backend;
  if old.backend = 's3' then
    insert into private.fale_one_gc (user_id, blob_id, chunks) values (old.user_id, old.blob_id, old.chunks);
  end if;
  return old;
end $$;
drop trigger if exists one_blobs_count on public.one_blobs;
create trigger one_blobs_count after insert or delete on public.one_blobs for each row execute function private.fale_one_blob_trg();

create or replace function private.fale_one_meta_trg() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d bigint := 0; u uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    d := d - coalesce(char_length(old.key), 0) - coalesce(char_length(old.meta), 0);
    u := old.user_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    d := d + coalesce(char_length(new.key), 0) + coalesce(char_length(new.meta), 0);
    u := new.user_id;
  end if;
  if d <> 0 then
    update public.one_accounts set meta_bytes = greatest(meta_bytes + d, 0) where user_id = u;
  end if;
  if tg_table_name = 'one_nodes' and tg_op <> 'UPDATE' then
    update public.one_accounts set node_count = greatest(node_count + case when tg_op = 'INSERT' then 1 else -1 end, 0) where user_id = u;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists one_nodes_count on public.one_nodes;
create trigger one_nodes_count after insert or delete or update of key, meta on public.one_nodes for each row execute function private.fale_one_meta_trg();
drop trigger if exists one_revisions_count on public.one_revisions;
create trigger one_revisions_count after insert or delete or update of key, meta on public.one_revisions for each row execute function private.fale_one_meta_trg();
drop trigger if exists one_albums_count on public.one_albums;
create trigger one_albums_count after insert or delete or update of key, meta on public.one_albums for each row execute function private.fale_one_meta_trg();

-- ------------------------------------------------------------------ helpers (private)
create or replace function private.fale_one_lock(p_user uuid) returns void
language sql volatile security definer set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('fale-one:' || p_user::text, 0))
$$;

/** Ensure the account row exists. false = no such auth user. */
create or replace function private.fale_one_acct(p_user uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_user is null then return false; end if;
  if exists (select 1 from public.one_accounts where user_id = p_user) then return true; end if;
  if not exists (select 1 from auth.users where id = p_user) then return false; end if;
  insert into public.one_accounts (user_id) values (p_user) on conflict do nothing;
  return true;
end $$;

create or replace function private.fale_one_quota(p_user uuid) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare o bigint; q bigint; cap bigint; plus boolean := false;
begin
  select quota_bytes into o from public.one_accounts where user_id = p_user;
  if o is not null then return o; end if;
  if to_regprocedure('private.fale_plus_active(uuid)') is not null then
    execute 'select private.fale_plus_active($1)' into plus using p_user;
  end if;
  q := case when coalesce(plus, false) then private.fale_one_cfg('plus_bytes') else private.fale_one_cfg('free_bytes') end;
  cap := coalesce(private.fale_one_cfg('beta_cap_bytes'), 0);
  if cap > 0 then q := least(q, cap); end if;
  return q;
end $$;

/** Bytes counted against the quota (fast: maintained by triggers). */
create or replace function private.fale_one_used(p_user uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select blob_bytes + meta_bytes from public.one_accounts where user_id = p_user), 0)
$$;

/** Detailed usage for display (slower: full scan of the user's blobs). */
create or replace function private.fale_one_usage(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with b as (
    select b.size, b.status, (n.head_rev = b.rev_id) as head, (n.trashed_at is not null) as trashed
    from public.one_blobs b
    left join public.one_revisions r on r.user_id = b.user_id and r.rev_id = b.rev_id
    left join public.one_nodes n on n.user_id = r.user_id and n.node_id = r.node_id
    where b.user_id = p_user
  ), a as (select coalesce((select meta_bytes from public.one_accounts where user_id = p_user), 0) as meta)
  select jsonb_build_object(
    'files', coalesce(sum(size) filter (where status = 'live' and head and not trashed), 0),
    'versions', coalesce(sum(size) filter (where status = 'live' and not head and not trashed), 0),
    'trash', coalesce(sum(size) filter (where status = 'live' and trashed), 0),
    'pending', coalesce(sum(size) filter (where status = 'pending'), 0),
    'meta', (select meta from a),
    'total', coalesce(sum(size), 0) + (select meta from a))
  from b
$$;

create or replace function private.fale_one_b64(p text, p_min integer, p_max integer) returns boolean
language sql immutable set search_path = '' as $$
  select p is not null and char_length(p) between p_min and p_max and p ~ '^[A-Za-z0-9_-]+$'
$$;

create or replace function private.fale_one_rev_json(p_user uuid, p_rev uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', r.rev_id, 'key', r.key, 'meta', r.meta, 'hash', r.hash, 'size', r.size,
    'device_id', r.device_id, 'created_at', r.created_at, 'superseded_at', r.superseded_at,
    'blobs', coalesce((select jsonb_agg(jsonb_build_object('id', b.blob_id, 'purpose', b.purpose, 'size', b.size, 'chunks', b.chunks,
        'chunk_size', b.chunk_size, 'backend', b.backend) order by b.purpose) from public.one_blobs b where b.user_id = r.user_id and b.rev_id = r.rev_id), '[]'::jsonb))
  from public.one_revisions r where r.user_id = p_user and r.rev_id = p_rev
$$;

create or replace function private.fale_one_node_json(n public.one_nodes) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('t', 'node', 'id', n.node_id, 'parent', n.parent_id, 'kind', n.kind, 'version', n.version, 'seq', n.seq,
    'key', n.key, 'meta', n.meta, 'created_at', n.created_at, 'updated_at', n.updated_at, 'trashed_at', n.trashed_at,
    'trash_root', n.trash_root, 'deleted', n.deleted,
    'head', case when n.head_rev is null then null else private.fale_one_rev_json(n.user_id, n.head_rev) end)
$$;

create or replace function private.fale_one_album_json(a public.one_albums) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('t', 'album', 'id', a.album_id, 'version', a.version, 'seq', a.seq, 'key', a.key, 'meta', a.meta,
    'created_at', a.created_at, 'updated_at', a.updated_at, 'deleted', a.deleted)
$$;

create or replace function private.fale_one_member_json(i public.one_album_items) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('t', 'member', 'album', i.album_id, 'node', i.node_id, 'seq', i.seq, 'added_at', i.added_at, 'removed', i.removed)
$$;

create or replace function private.fale_one_quota_fail(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', false, 'reason', 'quota', 'used', private.fale_one_used(p_user), 'quota', private.fale_one_quota(p_user))
$$;

/** Is p_parent a usable target folder (null = root)? */
create or replace function private.fale_one_folder_ok(p_user uuid, p_parent uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_parent is null or exists (select 1 from public.one_nodes where user_id = p_user and node_id = p_parent
    and kind = 'folder' and not deleted and trashed_at is null)
$$;

/** Is the pending blob complete? null = yes, otherwise a reason. p_observed: {"<blob id>": [size per chunk index, -1 = missing]} (backend s3). */
create or replace function private.fale_one_blob_ready(p_user uuid, p_blob uuid, p_purpose text, p_observed jsonb) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare b public.one_blobs; cnt bigint; tot bigint; bad bigint; arr jsonb;
begin
  select * into b from public.one_blobs where user_id = p_user and blob_id = p_blob for update;
  if not found or b.status <> 'pending' or b.expires_at <= now() then return 'no_upload'; end if;
  if b.purpose <> p_purpose then return 'bad_input'; end if;
  if b.backend = 'pg' then
    select count(*), coalesce(sum(octet_length(c.data)), 0),
           count(*) filter (where c.idx >= b.chunks or (c.idx < b.chunks - 1 and octet_length(c.data) <> b.chunk_size))
      into cnt, tot, bad from public.one_chunks c where c.user_id = p_user and c.blob_id = p_blob;
  else
    arr := p_observed -> (p_blob::text);
    if arr is null or jsonb_typeof(arr) <> 'array' then return 'incomplete'; end if;
    select count(*) filter (where x.v::bigint >= 0), coalesce(sum(greatest(x.v::bigint, 0)), 0),
           count(*) filter (where x.v::bigint >= 0 and x.o - 1 < b.chunks - 1 and x.v::bigint <> b.chunk_size) + count(*) filter (where x.o > b.chunks)
      into cnt, tot, bad from jsonb_array_elements_text(arr) with ordinality as x(v, o);
  end if;
  if cnt <> b.chunks or tot <> b.size or bad > 0 then return 'incomplete'; end if;
  return null;
end $$;

/** Turn a node and its trashed descendants (same trash root) into tombstones; content is deleted. */
create or replace function private.fale_one_destroy(p_user uuid, p_node uuid) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare root uuid; ids uuid[]; n integer;
begin
  select trash_root into root from public.one_nodes where user_id = p_user and node_id = p_node and not deleted;
  if not found then return 0; end if;
  with recursive sub as (
    select p_node as node_id
    union
    select c.node_id from public.one_nodes c join sub s on c.parent_id = s.node_id
     where c.user_id = p_user and not c.deleted and c.trash_root is not distinct from root
  ) select array_agg(node_id) into ids from sub;
  -- tombstones first (head pointer gone), then the revisions (blobs + chunks cascade, s3 blobs are queued)
  update public.one_nodes n2 set head_rev = null, deleted = true, deleted_at = now(), key = null, meta = null,
         trashed_at = null, trash_root = null, version = n2.version + 1, seq = nextval('private.fale_one_seq'), updated_at = now()
   where n2.user_id = p_user and n2.node_id = any (ids);
  get diagnostics n = row_count;
  delete from public.one_revisions r where r.user_id = p_user and r.node_id = any (ids);
  delete from public.one_album_items i where i.user_id = p_user and i.node_id = any (ids);
  return n;
end $$;

do $$
declare f text;
begin
  foreach f in array array['private.fale_one_cfg(text)', 'private.fale_one_blob_trg()', 'private.fale_one_meta_trg()', 'private.fale_one_lock(uuid)',
    'private.fale_one_acct(uuid)', 'private.fale_one_quota(uuid)', 'private.fale_one_used(uuid)', 'private.fale_one_usage(uuid)',
    'private.fale_one_b64(text, integer, integer)', 'private.fale_one_rev_json(uuid, uuid)', 'private.fale_one_node_json(public.one_nodes)',
    'private.fale_one_album_json(public.one_albums)', 'private.fale_one_member_json(public.one_album_items)', 'private.fale_one_quota_fail(uuid)',
    'private.fale_one_folder_ok(uuid, uuid)', 'private.fale_one_blob_ready(uuid, uuid, text, jsonb)', 'private.fale_one_destroy(uuid, uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- ================================================================== secret-gated RPCs for the Vercel API
-- Every function: perform private.fale_check(p_secret); p_user = the verified FaLe-Konto user id.

create or replace function public.fale_one_status(p_secret text, p_user uuid, p_detail boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.one_accounts; used bigint; q bigint; cur bigint;
begin
  perform private.fale_check(p_secret);
  select * into a from public.one_accounts where user_id = p_user;
  used := private.fale_one_used(p_user);
  q := private.fale_one_quota(p_user);
  select greatest(coalesce((select max(seq) from public.one_nodes where user_id = p_user), 0),
                  coalesce((select max(seq) from public.one_albums where user_id = p_user), 0),
                  coalesce((select max(seq) from public.one_album_items where user_id = p_user), 0)) into cur;
  return jsonb_build_object('ok', true, 'quota', q, 'used', used, 'read_only', used >= q,
    'usage', case when coalesce(p_detail, false) then private.fale_one_usage(p_user) else null end,
    'nodes', coalesce(a.node_count, 0), 'cursor', cur, 'min_cursor', coalesce(a.min_cursor, 0),
    'limits', jsonb_build_object('max_file_bytes', private.fale_one_cfg('max_file_bytes'), 'thumb_max_bytes', private.fale_one_cfg('thumb_max_bytes'),
      'preview_max_bytes', private.fale_one_cfg('preview_max_bytes'), 'max_meta_chars', private.fale_one_cfg('max_meta_chars'),
      'max_pending', private.fale_one_cfg('max_pending'), 'trash_days', private.fale_one_cfg('trash_days'),
      'version_days', private.fale_one_cfg('version_days'), 'version_keep', private.fale_one_cfg('version_keep'),
      'upload_ttl_hours', private.fale_one_cfg('upload_ttl_hours'), 'backup_warn_days', private.fale_one_cfg('backup_warn_days')));
end $$;

/** Change feed: nodes, albums and album memberships with seq > p_after, oldest first. */
create or replace function public.fale_one_changes(p_secret text, p_user uuid, p_after bigint, p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare mc bigint; after_ bigint := greatest(coalesce(p_after, 0), 0); lim integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  arr jsonb; mx bigint; more boolean;
begin
  perform private.fale_check(p_secret);
  select min_cursor into mc from public.one_accounts where user_id = p_user;
  if after_ > 0 and after_ < coalesce(mc, 0) then
    return jsonb_build_object('ok', true, 'reset', true, 'changes', '[]'::jsonb, 'cursor', 0, 'more', true);
  end if;
  with c as (
    (select n.seq, private.fale_one_node_json(n) j from public.one_nodes n where n.user_id = p_user and n.seq > after_ order by n.seq limit lim)
    union all
    (select a.seq, private.fale_one_album_json(a) from public.one_albums a where a.user_id = p_user and a.seq > after_ order by a.seq limit lim)
    union all
    (select i.seq, private.fale_one_member_json(i) from public.one_album_items i where i.user_id = p_user and i.seq > after_ order by i.seq limit lim)
  ), t as (select seq, j from c order by seq limit lim)
  select coalesce(jsonb_agg(j order by seq), '[]'::jsonb), max(seq) into arr, mx from t;
  more := exists (select 1 from public.one_nodes where user_id = p_user and seq > coalesce(mx, after_))
       or exists (select 1 from public.one_albums where user_id = p_user and seq > coalesce(mx, after_))
       or exists (select 1 from public.one_album_items where user_id = p_user and seq > coalesce(mx, after_));
  return jsonb_build_object('ok', true, 'reset', false, 'changes', arr, 'cursor', coalesce(mx, after_), 'more', more);
end $$;

create or replace function public.fale_one_mkdir(p_secret text, p_user uuid, p_node uuid, p_parent uuid, p_key text, p_meta text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cur public.one_nodes; s bigint;
begin
  perform private.fale_check(p_secret);
  if p_node is null or not private.fale_one_b64(p_key, 40, 200) or not private.fale_one_b64(p_meta, 24, private.fale_one_cfg('max_meta_chars')::integer) then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  if not private.fale_one_acct(p_user) then return jsonb_build_object('ok', false, 'reason', 'no_user'); end if;
  perform private.fale_one_lock(p_user);
  select * into cur from public.one_nodes where user_id = p_user and node_id = p_node;
  if found then
    -- idempotent retry of the same request
    if cur.kind = 'folder' and not cur.deleted and cur.key = p_key and cur.meta = p_meta and cur.parent_id is not distinct from p_parent then
      return jsonb_build_object('ok', true, 'node', private.fale_one_node_json(cur));
    end if;
    return jsonb_build_object('ok', false, 'reason', 'exists');
  end if;
  if not private.fale_one_folder_ok(p_user, p_parent) then return jsonb_build_object('ok', false, 'reason', 'bad_parent'); end if;
  if (select node_count from public.one_accounts where user_id = p_user) >= private.fale_one_cfg('max_nodes') then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  if private.fale_one_used(p_user) + char_length(p_key) + char_length(p_meta) > private.fale_one_quota(p_user) then return private.fale_one_quota_fail(p_user); end if;
  s := nextval('private.fale_one_seq');
  insert into public.one_nodes (user_id, node_id, parent_id, kind, seq, key, meta) values (p_user, p_node, p_parent, 'folder', s, p_key, p_meta)
  returning * into cur;
  return jsonb_build_object('ok', true, 'node', private.fale_one_node_json(cur));
end $$;

/** Open an upload session (= one pending blob). Quota and capacity are checked (and reserved) here. */
create or replace function public.fale_one_upload_create(p_secret text, p_user uuid, p_blob uuid, p_purpose text, p_size bigint, p_chunks integer,
  p_chunk_size integer, p_backend text, p_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare mx bigint; np integer; cap bigint; tot bigint; dups jsonb := '[]'::jsonb; exp timestamptz;
begin
  perform private.fale_check(p_secret);
  if p_blob is null or p_purpose is null or p_purpose not in ('content', 'thumb', 'preview') or p_backend is null or p_backend not in ('pg', 's3')
     or p_size is null or p_size < 1 or p_chunk_size is null or p_chunk_size < 65536 or p_chunk_size > 4194304
     or p_chunks is null or p_chunks <> ((p_size + p_chunk_size - 1) / p_chunk_size)::integer
     or (p_hash is not null and p_hash !~ '^[A-Za-z0-9_-]{43}$') then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  mx := case p_purpose when 'content' then private.fale_one_cfg('max_file_bytes') when 'thumb' then private.fale_one_cfg('thumb_max_bytes') else private.fale_one_cfg('preview_max_bytes') end;
  if p_size > mx or (p_purpose = 'thumb' and p_chunks <> 1) then return jsonb_build_object('ok', false, 'reason', 'too_large', 'max', mx); end if;
  if not private.fale_one_acct(p_user) then return jsonb_build_object('ok', false, 'reason', 'no_user'); end if;
  perform private.fale_one_lock(p_user);
  if exists (select 1 from public.one_blobs where user_id = p_user and blob_id = p_blob) then return jsonb_build_object('ok', false, 'reason', 'exists'); end if;
  select count(*) into np from public.one_blobs where user_id = p_user and status = 'pending' and expires_at > now();
  if np >= private.fale_one_cfg('max_pending') then return jsonb_build_object('ok', false, 'reason', 'too_many_pending'); end if;
  if private.fale_one_used(p_user) + p_size > private.fale_one_quota(p_user) then return private.fale_one_quota_fail(p_user); end if;
  if p_backend = 'pg' then
    cap := coalesce(private.fale_one_cfg('pg_total_cap_bytes'), 0);
    if cap > 0 then
      select bytes into tot from private.fale_one_totals where backend = 'pg';
      if coalesce(tot, 0) + p_size > cap then return jsonb_build_object('ok', false, 'reason', 'capacity'); end if;
    end if;
  end if;
  if p_hash is not null then
    select coalesce(jsonb_agg(n.node_id), '[]'::jsonb) into dups from (
      select n.node_id from public.one_revisions r join public.one_nodes n on n.user_id = r.user_id and n.node_id = r.node_id and n.head_rev = r.rev_id
       where r.user_id = p_user and r.hash = p_hash and not n.deleted and n.trashed_at is null limit 20) n;
  end if;
  exp := now() + make_interval(hours => private.fale_one_cfg('upload_ttl_hours')::integer);
  insert into public.one_blobs (user_id, blob_id, purpose, backend, size, chunks, chunk_size, expires_at)
  values (p_user, p_blob, p_purpose, p_backend, p_size, p_chunks, p_chunk_size, exp);
  return jsonb_build_object('ok', true, 'expires_at', exp, 'duplicates', dups);
end $$;

/** Store one ciphertext chunk (backend pg). Idempotent: the same index may be sent again; any order. */
create or replace function public.fale_one_chunk_put(p_secret text, p_user uuid, p_blob uuid, p_idx integer, p_data text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.one_blobs; d bytea; want bigint;
begin
  perform private.fale_check(p_secret);
  if p_blob is null or p_idx is null or p_idx < 0 then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  -- base64 of at most one 4 MiB chunk – refuse anything bigger before decoding it
  if p_data is null or length(p_data) > 5600000 then return jsonb_build_object('ok', false, 'reason', 'bad_size'); end if;
  select * into b from public.one_blobs where user_id = p_user and blob_id = p_blob for share;
  if not found or b.status <> 'pending' or b.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'no_upload'); end if;
  if b.backend <> 'pg' then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  if p_idx >= b.chunks then return jsonb_build_object('ok', false, 'reason', 'bad_index'); end if;
  begin
    d := decode(p_data, 'base64');
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'bad_size');
  end;
  want := case when p_idx < b.chunks - 1 then b.chunk_size else b.size - (b.chunks - 1)::bigint * b.chunk_size end;
  if octet_length(d) <> want then return jsonb_build_object('ok', false, 'reason', 'bad_size', 'want', want); end if;
  insert into public.one_chunks (user_id, blob_id, idx, data) values (p_user, p_blob, p_idx, d)
  on conflict (user_id, blob_id, idx) do update set data = excluded.data;
  return jsonb_build_object('ok', true);
end $$;

/** Resume support: which chunks of an open upload are stored (backend pg). */
create or replace function public.fale_one_upload_status(p_secret text, p_user uuid, p_blob uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.one_blobs; got jsonb;
begin
  perform private.fale_check(p_secret);
  select * into b from public.one_blobs where user_id = p_user and blob_id = p_blob;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_upload'); end if;
  if b.backend = 'pg' then
    select coalesce(jsonb_agg(idx order by idx), '[]'::jsonb) into got from public.one_chunks where user_id = p_user and blob_id = p_blob;
  end if;
  return jsonb_build_object('ok', true, 'status', b.status, 'purpose', b.purpose, 'backend', b.backend, 'size', b.size, 'chunks', b.chunks,
    'chunk_size', b.chunk_size, 'expires_at', b.expires_at, 'expired', b.status = 'pending' and b.expires_at <= now(), 'received', got);
end $$;

create or replace function public.fale_one_upload_abort(p_secret text, p_user uuid, p_blob uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.fale_check(p_secret);
  perform private.fale_one_lock(p_user);
  delete from public.one_blobs where user_id = p_user and blob_id = p_blob and status = 'pending';
  return jsonb_build_object('ok', true, 'deleted', found);
end $$;

/** Blob layout for downloads / presigning (any own blob). */
create or replace function public.fale_one_blob_info(p_secret text, p_user uuid, p_blob uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.one_blobs;
begin
  perform private.fale_check(p_secret);
  select * into b from public.one_blobs where user_id = p_user and blob_id = p_blob;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'blob', jsonb_build_object('id', b.blob_id, 'purpose', b.purpose, 'backend', b.backend, 'size', b.size,
    'chunks', b.chunks, 'chunk_size', b.chunk_size, 'status', b.status, 'expired', b.status = 'pending' and b.expires_at <= now()));
end $$;

/** Read one chunk of a committed blob (backend pg). */
create or replace function public.fale_one_chunk_get(p_secret text, p_user uuid, p_blob uuid, p_idx integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d bytea; st text;
begin
  perform private.fale_check(p_secret);
  select b.status into st from public.one_blobs b where b.user_id = p_user and b.blob_id = p_blob and b.backend = 'pg';
  if not found or st <> 'live' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select c.data into d from public.one_chunks c where c.user_id = p_user and c.blob_id = p_blob and c.idx = p_idx;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'data', translate(encode(d, 'base64'), E'\n', ''));
end $$;

/** Batch of small thumbnails (single-chunk thumb blobs in pg) for the timeline. */
create or replace function public.fale_one_thumbs(p_secret text, p_user uuid, p_blobs uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare arr jsonb;
begin
  perform private.fale_check(p_secret);
  if p_blobs is null or coalesce(array_length(p_blobs, 1), 0) > 100 then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  select coalesce(jsonb_object_agg(b.blob_id::text, translate(encode(c.data, 'base64'), E'\n', '')), '{}'::jsonb) into arr
    from public.one_blobs b join public.one_chunks c on c.user_id = b.user_id and c.blob_id = b.blob_id and c.idx = 0
   where b.user_id = p_user and b.blob_id = any (p_blobs) and b.status = 'live' and b.purpose = 'thumb' and b.backend = 'pg' and b.chunks = 1;
  return jsonb_build_object('ok', true, 'thumbs', arr);
end $$;

/**
 * Create a file/photo node with its first revision (p_base_version = 0) or add a new revision to an existing one
 * (p_base_version = the version the client last saw). The referenced uploads must be complete.
 */
create or replace function public.fale_one_commit(p_secret text, p_user uuid, p_node uuid, p_parent uuid, p_kind text, p_base_version bigint,
  p_key text, p_meta text, p_rev uuid, p_rev_key text, p_rev_meta text, p_hash text, p_content uuid, p_thumb uuid, p_preview uuid,
  p_observed jsonb, p_device text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cur public.one_nodes; nn public.one_nodes; why text; s bigint; tot bigint; growth bigint; mm integer := private.fale_one_cfg('max_meta_chars')::integer;
  keep integer := private.fale_one_cfg('version_keep')::integer;
begin
  perform private.fale_check(p_secret);
  if p_node is null or p_rev is null or p_content is null or p_kind is null or p_kind not in ('file', 'photo')
     or p_base_version is null or p_base_version < 0
     or not private.fale_one_b64(p_rev_key, 40, 200) or not private.fale_one_b64(p_rev_meta, 24, mm)
     or (p_hash is not null and p_hash !~ '^[A-Za-z0-9_-]{43}$')
     or (p_device is not null and p_device !~ '^[A-Za-z0-9_-]{16,64}$')
     or (p_base_version = 0 and (not private.fale_one_b64(p_key, 40, 200) or not private.fale_one_b64(p_meta, 24, mm)))
     or (p_base_version > 0 and p_meta is not null and not private.fale_one_b64(p_meta, 24, mm))
     or p_content = p_thumb or p_content = p_preview or p_thumb = p_preview then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  if not private.fale_one_acct(p_user) then return jsonb_build_object('ok', false, 'reason', 'no_user'); end if;
  perform private.fale_one_lock(p_user);
  select * into cur from public.one_nodes where user_id = p_user and node_id = p_node for update;
  if found and cur.head_rev = p_rev then -- idempotent retry
    return jsonb_build_object('ok', true, 'node', private.fale_one_node_json(cur));
  end if;
  if exists (select 1 from public.one_revisions where user_id = p_user and rev_id = p_rev) then return jsonb_build_object('ok', false, 'reason', 'exists'); end if;
  if p_base_version = 0 then
    if found then return jsonb_build_object('ok', false, 'reason', 'exists', 'node', private.fale_one_node_json(cur)); end if;
    if not private.fale_one_folder_ok(p_user, p_parent) then return jsonb_build_object('ok', false, 'reason', 'bad_parent'); end if;
    if (select node_count from public.one_accounts where user_id = p_user) >= private.fale_one_cfg('max_nodes') then
      return jsonb_build_object('ok', false, 'reason', 'too_many');
    end if;
    growth := char_length(p_key) + char_length(p_meta);
  else
    if not found or cur.deleted then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    if cur.version <> p_base_version then return jsonb_build_object('ok', false, 'reason', 'conflict', 'node', private.fale_one_node_json(cur)); end if;
    if cur.kind <> p_kind or (p_key is not null and p_key <> cur.key) then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
    if cur.trashed_at is not null then return jsonb_build_object('ok', false, 'reason', 'trashed'); end if;
    growth := greatest(coalesce(char_length(p_meta), 0) - char_length(cur.meta), 0);
  end if;
  growth := growth + char_length(p_rev_key) + char_length(p_rev_meta);
  if private.fale_one_used(p_user) + growth > private.fale_one_quota(p_user) then return private.fale_one_quota_fail(p_user); end if;
  why := private.fale_one_blob_ready(p_user, p_content, 'content', p_observed);
  if why is null and p_thumb is not null then why := private.fale_one_blob_ready(p_user, p_thumb, 'thumb', p_observed); end if;
  if why is null and p_preview is not null then why := private.fale_one_blob_ready(p_user, p_preview, 'preview', p_observed); end if;
  if why is not null then return jsonb_build_object('ok', false, 'reason', why); end if;
  s := nextval('private.fale_one_seq');
  if p_base_version = 0 then
    -- head_rev has no foreign key: the node can point at the revision that is inserted right after it
    insert into public.one_nodes (user_id, node_id, parent_id, kind, seq, key, meta, head_rev) values (p_user, p_node, p_parent, p_kind, s, p_key, p_meta, p_rev);
  end if;
  select coalesce(sum(size), 0) into tot from public.one_blobs where user_id = p_user and blob_id in (p_content, p_thumb, p_preview);
  insert into public.one_revisions (user_id, rev_id, node_id, key, meta, hash, size, device_id)
  values (p_user, p_rev, p_node, p_rev_key, p_rev_meta, p_hash, tot, p_device);
  update public.one_blobs set status = 'live', rev_id = p_rev, committed_at = now(), expires_at = null
   where user_id = p_user and blob_id in (p_content, p_thumb, p_preview);
  if p_base_version > 0 then
    update public.one_revisions set superseded_at = now() where user_id = p_user and rev_id = cur.head_rev;
    update public.one_nodes set head_rev = p_rev, meta = coalesce(p_meta, meta), version = version + 1, seq = s, updated_at = now()
     where user_id = p_user and node_id = p_node;
  end if;
  select * into nn from public.one_nodes where user_id = p_user and node_id = p_node;
  -- keep at most version_keep old versions
  delete from public.one_revisions r where r.user_id = p_user and r.node_id = p_node and r.rev_id in (
    select rev_id from public.one_revisions where user_id = p_user and node_id = p_node and superseded_at is not null
     order by superseded_at desc offset greatest(keep, 0));
  return jsonb_build_object('ok', true, 'node', private.fale_one_node_json(nn));
end $$;

/** Move and/or change the encrypted metadata (rename, edit EXIF …) – optimistic concurrency via p_base_version. */
create or replace function public.fale_one_update(p_secret text, p_user uuid, p_node uuid, p_base_version bigint, p_move boolean, p_parent uuid, p_meta text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cur public.one_nodes; nn public.one_nodes; p uuid; depth integer := 0; maxd integer := private.fale_one_cfg('max_depth')::integer;
begin
  perform private.fale_check(p_secret);
  if p_node is null or p_base_version is null or (p_meta is null and not coalesce(p_move, false))
     or (p_meta is not null and not private.fale_one_b64(p_meta, 24, private.fale_one_cfg('max_meta_chars')::integer)) then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  perform private.fale_one_lock(p_user);
  select * into cur from public.one_nodes where user_id = p_user and node_id = p_node for update;
  if not found or cur.deleted then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if cur.version <> p_base_version then return jsonb_build_object('ok', false, 'reason', 'conflict', 'node', private.fale_one_node_json(cur)); end if;
  if cur.trashed_at is not null then return jsonb_build_object('ok', false, 'reason', 'trashed'); end if;
  if coalesce(p_move, false) then
    if not private.fale_one_folder_ok(p_user, p_parent) then return jsonb_build_object('ok', false, 'reason', 'bad_parent'); end if;
    -- no cycles: walk up from the new parent
    p := p_parent;
    while p is not null loop
      if p = p_node then return jsonb_build_object('ok', false, 'reason', 'cycle'); end if;
      depth := depth + 1;
      if depth > maxd then return jsonb_build_object('ok', false, 'reason', 'too_deep'); end if;
      select parent_id into p from public.one_nodes where user_id = p_user and node_id = p;
    end loop;
  end if;
  if p_meta is not null and char_length(p_meta) > char_length(cur.meta)
     and private.fale_one_used(p_user) + char_length(p_meta) - char_length(cur.meta) > private.fale_one_quota(p_user) then
    return private.fale_one_quota_fail(p_user);
  end if;
  update public.one_nodes set parent_id = case when coalesce(p_move, false) then p_parent else parent_id end, meta = coalesce(p_meta, meta),
         version = version + 1, seq = nextval('private.fale_one_seq'), updated_at = now()
   where user_id = p_user and node_id = p_node returning * into nn;
  return jsonb_build_object('ok', true, 'node', private.fale_one_node_json(nn));
end $$;

/** Move a node (and its subtree) to the trash. Nothing is deleted; restore is possible for trash_days. */
create or replace function public.fale_one_trash(p_secret text, p_user uuid, p_node uuid, p_base_version bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cur public.one_nodes; n integer;
begin
  perform private.fale_check(p_secret);
  if p_node is null then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  perform private.fale_one_lock(p_user);
  select * into cur from public.one_nodes where user_id = p_user and node_id = p_node for update;
  if not found or cur.deleted then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if cur.trashed_at is not null then return jsonb_build_object('ok', true, 'count', 0, 'node', private.fale_one_node_json(cur)); end if;
  if p_base_version is not null and cur.version <> p_base_version then
    return jsonb_build_object('ok', false, 'reason', 'conflict', 'node', private.fale_one_node_json(cur));
  end if;
  with recursive sub as (
    select p_node as node_id
    union
    select c.node_id from public.one_nodes c join sub s on c.parent_id = s.node_id where c.user_id = p_user and not c.deleted and c.trashed_at is null
  )
  update public.one_nodes x set trashed_at = now(), trash_root = p_node, version = x.version + 1, seq = nextval('private.fale_one_seq'), updated_at = now()
   where x.user_id = p_user and x.node_id in (select node_id from sub);
  get diagnostics n = row_count;
  select * into cur from public.one_nodes where user_id = p_user and node_id = p_node;
  return jsonb_build_object('ok', true, 'count', n, 'node', private.fale_one_node_json(cur));
end $$;

/** Restore a trashed node with everything that was trashed together with it (below it). Lost parent → root. */
create or replace function public.fale_one_restore(p_secret text, p_user uuid, p_node uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cur public.one_nodes; root uuid; to_root boolean; n integer;
begin
  perform private.fale_check(p_secret);
  if p_node is null then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  perform private.fale_one_lock(p_user);
  select * into cur from public.one_nodes where user_id = p_user and node_id = p_node for update;
  if not found or cur.deleted then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if cur.trashed_at is null then return jsonb_build_object('ok', true, 'count', 0, 'node', private.fale_one_node_json(cur)); end if;
  root := cur.trash_root;
  to_root := not private.fale_one_folder_ok(p_user, cur.parent_id);
  with recursive sub as (
    select p_node as node_id
    union
    select c.node_id from public.one_nodes c join sub s on c.parent_id = s.node_id where c.user_id = p_user and not c.deleted and c.trash_root = root
  )
  update public.one_nodes x set trashed_at = null, trash_root = null,
         parent_id = case when x.node_id = p_node and to_root then null else x.parent_id end,
         version = x.version + 1, seq = nextval('private.fale_one_seq'), updated_at = now()
   where x.user_id = p_user and x.node_id in (select node_id from sub);
  get diagnostics n = row_count;
  select * into cur from public.one_nodes where user_id = p_user and node_id = p_node;
  return jsonb_build_object('ok', true, 'count', n, 'node', private.fale_one_node_json(cur));
end $$;

/** Delete forever – only from the trash (explicit two-step deletion). */
create or replace function public.fale_one_delete(p_secret text, p_user uuid, p_node uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cur public.one_nodes; n integer;
begin
  perform private.fale_check(p_secret);
  if p_node is null then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  perform private.fale_one_lock(p_user);
  select * into cur from public.one_nodes where user_id = p_user and node_id = p_node for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if cur.deleted then return jsonb_build_object('ok', true, 'count', 0); end if;
  if cur.trashed_at is null then return jsonb_build_object('ok', false, 'reason', 'not_trashed'); end if;
  n := private.fale_one_destroy(p_user, p_node);
  return jsonb_build_object('ok', true, 'count', n);
end $$;

create or replace function public.fale_one_trash_empty(p_secret text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  perform private.fale_check(p_secret);
  perform private.fale_one_lock(p_user);
  for r in select node_id from public.one_nodes where user_id = p_user and not deleted and trash_root = node_id loop
    n := n + private.fale_one_destroy(p_user, r.node_id);
  end loop;
  return jsonb_build_object('ok', true, 'count', n);
end $$;

create or replace function public.fale_one_versions(p_secret text, p_user uuid, p_node uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cur public.one_nodes; arr jsonb;
begin
  perform private.fale_check(p_secret);
  select * into cur from public.one_nodes where user_id = p_user and node_id = p_node;
  if not found or cur.deleted then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select coalesce(jsonb_agg(private.fale_one_rev_json(p_user, r.rev_id) || jsonb_build_object('head', r.rev_id = cur.head_rev)
           order by (r.rev_id = cur.head_rev) desc, coalesce(r.superseded_at, r.created_at) desc), '[]'::jsonb) into arr
    from public.one_revisions r where r.user_id = p_user and r.node_id = p_node;
  return jsonb_build_object('ok', true, 'node', private.fale_one_node_json(cur), 'versions', arr);
end $$;

/** Make an older revision the current one again (the current one becomes an old version). */
create or replace function public.fale_one_version_restore(p_secret text, p_user uuid, p_node uuid, p_rev uuid, p_base_version bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cur public.one_nodes; nn public.one_nodes;
begin
  perform private.fale_check(p_secret);
  if p_node is null or p_rev is null or p_base_version is null then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  perform private.fale_one_lock(p_user);
  select * into cur from public.one_nodes where user_id = p_user and node_id = p_node for update;
  if not found or cur.deleted then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if cur.version <> p_base_version then return jsonb_build_object('ok', false, 'reason', 'conflict', 'node', private.fale_one_node_json(cur)); end if;
  if cur.trashed_at is not null then return jsonb_build_object('ok', false, 'reason', 'trashed'); end if;
  if cur.head_rev = p_rev then return jsonb_build_object('ok', true, 'node', private.fale_one_node_json(cur)); end if;
  if not exists (select 1 from public.one_revisions where user_id = p_user and node_id = p_node and rev_id = p_rev) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  update public.one_revisions set superseded_at = now() where user_id = p_user and rev_id = cur.head_rev;
  update public.one_revisions set superseded_at = null where user_id = p_user and rev_id = p_rev;
  update public.one_nodes set head_rev = p_rev, version = version + 1, seq = nextval('private.fale_one_seq'), updated_at = now()
   where user_id = p_user and node_id = p_node returning * into nn;
  return jsonb_build_object('ok', true, 'node', private.fale_one_node_json(nn));
end $$;

create or replace function public.fale_one_version_delete(p_secret text, p_user uuid, p_node uuid, p_rev uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cur public.one_nodes;
begin
  perform private.fale_check(p_secret);
  perform private.fale_one_lock(p_user);
  select * into cur from public.one_nodes where user_id = p_user and node_id = p_node;
  if not found or cur.deleted then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if cur.head_rev = p_rev then return jsonb_build_object('ok', false, 'reason', 'is_head'); end if;
  delete from public.one_revisions where user_id = p_user and node_id = p_node and rev_id = p_rev;
  return jsonb_build_object('ok', true, 'deleted', found);
end $$;

-- ------------------------------------------------------------------ albums
create or replace function public.fale_one_album_put(p_secret text, p_user uuid, p_album uuid, p_base_version bigint, p_key text, p_meta text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cur public.one_albums; nn public.one_albums; mm integer := private.fale_one_cfg('max_meta_chars')::integer;
begin
  perform private.fale_check(p_secret);
  if p_album is null or p_base_version is null or p_base_version < 0 or not private.fale_one_b64(p_meta, 24, mm)
     or (p_base_version = 0 and not private.fale_one_b64(p_key, 40, 200)) then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  if not private.fale_one_acct(p_user) then return jsonb_build_object('ok', false, 'reason', 'no_user'); end if;
  perform private.fale_one_lock(p_user);
  select * into cur from public.one_albums where user_id = p_user and album_id = p_album for update;
  if p_base_version = 0 then
    if found then
      if not cur.deleted and cur.key = p_key and cur.meta = p_meta then return jsonb_build_object('ok', true, 'album', private.fale_one_album_json(cur)); end if;
      return jsonb_build_object('ok', false, 'reason', 'exists');
    end if;
    if (select count(*) from public.one_albums where user_id = p_user and not deleted) >= private.fale_one_cfg('max_albums') then
      return jsonb_build_object('ok', false, 'reason', 'too_many');
    end if;
    if private.fale_one_used(p_user) + char_length(p_key) + char_length(p_meta) > private.fale_one_quota(p_user) then return private.fale_one_quota_fail(p_user); end if;
    insert into public.one_albums (user_id, album_id, seq, key, meta) values (p_user, p_album, nextval('private.fale_one_seq'), p_key, p_meta) returning * into nn;
  else
    if not found or cur.deleted then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    if cur.version <> p_base_version then return jsonb_build_object('ok', false, 'reason', 'conflict', 'album', private.fale_one_album_json(cur)); end if;
    if p_key is not null and p_key <> cur.key then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
    if char_length(p_meta) > char_length(cur.meta) and private.fale_one_used(p_user) + char_length(p_meta) - char_length(cur.meta) > private.fale_one_quota(p_user) then
      return private.fale_one_quota_fail(p_user);
    end if;
    update public.one_albums set meta = p_meta, version = version + 1, seq = nextval('private.fale_one_seq'), updated_at = now()
     where user_id = p_user and album_id = p_album returning * into nn;
  end if;
  return jsonb_build_object('ok', true, 'album', private.fale_one_album_json(nn));
end $$;

/** Delete an album (the photos stay). */
create or replace function public.fale_one_album_delete(p_secret text, p_user uuid, p_album uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cur public.one_albums;
begin
  perform private.fale_check(p_secret);
  perform private.fale_one_lock(p_user);
  select * into cur from public.one_albums where user_id = p_user and album_id = p_album for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if cur.deleted then return jsonb_build_object('ok', true); end if;
  delete from public.one_album_items where user_id = p_user and album_id = p_album;
  update public.one_albums set deleted = true, deleted_at = now(), key = null, meta = null, version = version + 1,
         seq = nextval('private.fale_one_seq'), updated_at = now()
   where user_id = p_user and album_id = p_album;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.fale_one_album_items(p_secret text, p_user uuid, p_album uuid, p_add uuid[], p_remove uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cur public.one_albums; n_added integer := 0; n_removed integer := 0;
begin
  perform private.fale_check(p_secret);
  if p_album is null or coalesce(array_length(p_add, 1), 0) + coalesce(array_length(p_remove, 1), 0) > 500 then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  perform private.fale_one_lock(p_user);
  select * into cur from public.one_albums where user_id = p_user and album_id = p_album;
  if not found or cur.deleted then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_add is not null then
    insert into public.one_album_items as i (user_id, album_id, node_id, seq)
    select p_user, p_album, n.node_id, nextval('private.fale_one_seq')
      from public.one_nodes n where n.user_id = p_user and n.node_id = any (p_add) and not n.deleted and n.kind <> 'folder'
    on conflict (user_id, album_id, node_id) do update set removed = false, removed_at = null, added_at = now(), seq = excluded.seq
      where i.removed;
    get diagnostics n_added = row_count;
  end if;
  if p_remove is not null then
    update public.one_album_items set removed = true, removed_at = now(), seq = nextval('private.fale_one_seq')
     where user_id = p_user and album_id = p_album and node_id = any (p_remove) and not removed;
    get diagnostics n_removed = row_count;
  end if;
  return jsonb_build_object('ok', true, 'added', n_added, 'removed', n_removed);
end $$;

-- ------------------------------------------------------------------ backup status per device
create or replace function public.fale_one_backup_report(p_secret text, p_user uuid, p_device text, p_meta text, p_status text, p_pending integer,
  p_pending_bytes bigint, p_success boolean, p_error text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.one_backup_devices;
begin
  perform private.fale_check(p_secret);
  if p_device is null or p_device !~ '^[A-Za-z0-9_-]{16,64}$' or p_status is null or p_status not in ('idle', 'running', 'paused', 'error')
     or (p_meta is not null and not private.fale_one_b64(p_meta, 24, 4096))
     or coalesce(p_pending, 0) < 0 or coalesce(p_pending, 0) > 100000000 or coalesce(p_pending_bytes, 0) < 0
     or (p_error is not null and p_error !~ '^[a-z0-9_]{1,40}$') then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  if not private.fale_one_acct(p_user) then return jsonb_build_object('ok', false, 'reason', 'no_user'); end if;
  perform private.fale_one_lock(p_user);
  if not exists (select 1 from public.one_backup_devices where user_id = p_user and device_id = p_device)
     and (select count(*) from public.one_backup_devices where user_id = p_user) >= private.fale_one_cfg('max_devices') then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  insert into public.one_backup_devices as d (user_id, device_id, meta, status, pending, pending_bytes, error, last_success_at, last_attempt_at, updated_at)
  values (p_user, p_device, p_meta, p_status, coalesce(p_pending, 0), coalesce(p_pending_bytes, 0), p_error,
          case when coalesce(p_success, false) then now() end, now(), now())
  on conflict (user_id, device_id) do update set meta = coalesce(excluded.meta, d.meta), status = excluded.status, pending = excluded.pending,
    pending_bytes = excluded.pending_bytes, error = excluded.error,
    last_success_at = case when coalesce(p_success, false) then now() else d.last_success_at end, last_attempt_at = now(), updated_at = now()
  returning * into r;
  return jsonb_build_object('ok', true, 'device', jsonb_build_object('device_id', r.device_id, 'status', r.status, 'last_success_at', r.last_success_at));
end $$;

create or replace function public.fale_one_backup_list(p_secret text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare arr jsonb; warn integer := private.fale_one_cfg('backup_warn_days')::integer;
begin
  perform private.fale_check(p_secret);
  select coalesce(jsonb_agg(jsonb_build_object('device_id', d.device_id, 'meta', d.meta, 'status', d.status, 'pending', d.pending,
      'pending_bytes', d.pending_bytes, 'error', d.error, 'last_success_at', d.last_success_at, 'last_attempt_at', d.last_attempt_at,
      'created_at', d.created_at, 'updated_at', d.updated_at,
      'stale', coalesce(d.last_success_at, d.created_at) < now() - make_interval(days => warn))
      order by d.updated_at desc), '[]'::jsonb) into arr
    from public.one_backup_devices d where d.user_id = p_user;
  return jsonb_build_object('ok', true, 'warn_days', warn, 'now', now(), 'devices', arr);
end $$;

create or replace function public.fale_one_backup_forget(p_secret text, p_user uuid, p_device text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.fale_check(p_secret);
  delete from public.one_backup_devices where user_id = p_user and device_id = p_device;
  return jsonb_build_object('ok', true, 'deleted', found);
end $$;

-- ------------------------------------------------------------------ dedupe + export
/** Which of these keyed content hashes already exist (current version of a node not in the trash)? */
create or replace function public.fale_one_dedupe(p_secret text, p_user uuid, p_hashes text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare arr jsonb;
begin
  perform private.fale_check(p_secret);
  if p_hashes is null or coalesce(array_length(p_hashes, 1), 0) > 200 then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  select coalesce(jsonb_object_agg(h, ids), '{}'::jsonb) into arr from (
    select r.hash h, jsonb_agg(n.node_id) ids from public.one_revisions r
      join public.one_nodes n on n.user_id = r.user_id and n.node_id = r.node_id and n.head_rev = r.rev_id
     where r.user_id = p_user and r.hash = any (p_hashes) and not n.deleted and n.trashed_at is null
     group by r.hash) t;
  return jsonb_build_object('ok', true, 'matches', arr);
end $$;

/** Export manifest: every node (incl. trash) with ALL revisions and blob layouts, paged by node id; albums on the first page. */
create or replace function public.fale_one_export(p_secret text, p_user uuid, p_after uuid, p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare lim integer := least(greatest(coalesce(p_limit, 200), 1), 500); arr jsonb; last_ uuid; albums jsonb := null;
begin
  perform private.fale_check(p_secret);
  select coalesce(jsonb_agg(private.fale_one_node_json(n) || jsonb_build_object('revisions',
           coalesce((select jsonb_agg(private.fale_one_rev_json(p_user, r.rev_id) order by r.created_at) from public.one_revisions r where r.user_id = p_user and r.node_id = n.node_id), '[]'::jsonb))
           order by n.node_id), '[]'::jsonb), (array_agg(n.node_id order by n.node_id desc))[1] into arr, last_
    from (select * from public.one_nodes where user_id = p_user and not deleted and (p_after is null or node_id > p_after) order by node_id limit lim) n;
  if p_after is null then
    select coalesce(jsonb_agg(private.fale_one_album_json(a) || jsonb_build_object('items',
             coalesce((select jsonb_agg(i.node_id order by i.added_at) from public.one_album_items i where i.user_id = p_user and i.album_id = a.album_id and not i.removed), '[]'::jsonb))), '[]'::jsonb)
      into albums from public.one_albums a where a.user_id = p_user and not a.deleted;
  end if;
  return jsonb_build_object('ok', true, 'nodes', arr, 'albums', albums,
    'next', case when jsonb_array_length(arr) = lim then last_ else null end);
end $$;

-- ------------------------------------------------------------------ S3 garbage queue (API worker)
create or replace function public.fale_one_gc_take(p_secret text, p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare arr jsonb;
begin
  perform private.fale_check(p_secret);
  with t as (
    select id from private.fale_one_gc where attempts < 20 order by id limit least(greatest(coalesce(p_limit, 50), 1), 200) for update skip locked
  ), u as (
    update private.fale_one_gc g set attempts = g.attempts + 1 from t where g.id = t.id returning g.id, g.user_id, g.blob_id, g.chunks
  ) select coalesce(jsonb_agg(jsonb_build_object('id', id, 'user', user_id, 'blob', blob_id, 'chunks', chunks)), '[]'::jsonb) into arr from u;
  return jsonb_build_object('ok', true, 'items', arr);
end $$;

create or replace function public.fale_one_gc_done(p_secret text, p_ids bigint[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform private.fale_check(p_secret);
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) > 1000 then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  delete from private.fale_one_gc where id = any (p_ids);
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'removed', n);
end $$;

-- ------------------------------------------------------------------ account deletion hook
-- Same function as in 20261014180000_fale_account_sync.sql, plus the FaLe One data (chunks cascade; s3 blobs
-- are queued for removal from the bucket by the blob trigger).
create or replace function public.fale_account_delete(p_secret text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare left_ integer; gone boolean := false;
begin
  perform private.fale_check(p_secret);
  if p_user is null then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  perform private.fale_lock(p_user);
  perform private.fale_one_lock(p_user);
  delete from public.one_album_items where user_id = p_user;
  delete from public.one_albums where user_id = p_user;
  delete from public.one_nodes where user_id = p_user;          -- revisions → blobs → chunks cascade
  delete from public.one_blobs where user_id = p_user;          -- open uploads
  delete from public.one_backup_devices where user_id = p_user;
  delete from public.one_accounts where user_id = p_user;
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

-- ------------------------------------------------------------------ privileges
do $$
declare f text;
begin
  foreach f in array array[
    'public.fale_one_status(text, uuid, boolean)',
    'public.fale_one_changes(text, uuid, bigint, integer)',
    'public.fale_one_mkdir(text, uuid, uuid, uuid, text, text)',
    'public.fale_one_upload_create(text, uuid, uuid, text, bigint, integer, integer, text, text)',
    'public.fale_one_chunk_put(text, uuid, uuid, integer, text)',
    'public.fale_one_upload_status(text, uuid, uuid)',
    'public.fale_one_upload_abort(text, uuid, uuid)',
    'public.fale_one_blob_info(text, uuid, uuid)',
    'public.fale_one_chunk_get(text, uuid, uuid, integer)',
    'public.fale_one_thumbs(text, uuid, uuid[])',
    'public.fale_one_commit(text, uuid, uuid, uuid, text, bigint, text, text, uuid, text, text, text, uuid, uuid, uuid, jsonb, text)',
    'public.fale_one_update(text, uuid, uuid, bigint, boolean, uuid, text)',
    'public.fale_one_trash(text, uuid, uuid, bigint)',
    'public.fale_one_restore(text, uuid, uuid)',
    'public.fale_one_delete(text, uuid, uuid)',
    'public.fale_one_trash_empty(text, uuid)',
    'public.fale_one_versions(text, uuid, uuid)',
    'public.fale_one_version_restore(text, uuid, uuid, uuid, bigint)',
    'public.fale_one_version_delete(text, uuid, uuid, uuid)',
    'public.fale_one_album_put(text, uuid, uuid, bigint, text, text)',
    'public.fale_one_album_delete(text, uuid, uuid)',
    'public.fale_one_album_items(text, uuid, uuid, uuid[], uuid[])',
    'public.fale_one_backup_report(text, uuid, text, text, text, integer, bigint, boolean, text)',
    'public.fale_one_backup_list(text, uuid)',
    'public.fale_one_backup_forget(text, uuid, text)',
    'public.fale_one_dedupe(text, uuid, text[])',
    'public.fale_one_export(text, uuid, uuid, integer)',
    'public.fale_one_gc_take(text, integer)',
    'public.fale_one_gc_done(text, bigint[])',
    'public.fale_account_delete(text, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to anon, service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
