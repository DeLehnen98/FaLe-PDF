-- FaLe Familien-Ordner: Ende-zu-Ende-verschlüsselter gemeinsamer Ordner für Familien (FaLe-Konto + FaLe Sync).
--
-- Schlüssel (alles auf den Geräten, der Server sieht nie Klartext oder Schlüssel):
--   * jedes Konto hat ein ECDH-P-256-Schlüsselpaar; der öffentliche Schlüssel liegt hier (fam_keys.public_jwk),
--     der private nur verschlüsselt mit einem aus dem Sync-Hauptschlüssel abgeleiteten Schlüssel (wrapped_private)
--   * jeder Familien-Ordner hat einen zufälligen Gruppenschlüssel (256 Bit); für jedes Mitglied wird er mit dessen
--     öffentlichem Schlüssel verpackt (ECIES: ephemeres ECDH + HKDF + AES-GCM) → fam_members.wrapped_key
--   * Einladungen: Link/QR enthält ein zufälliges Geheimnis T (nur im #Fragment, geht nie an den Server).
--     Der Server kennt nur SHA-256(HKDF(T, "auth")); der Gruppenschlüssel liegt mit HKDF(T, "wrap") verpackt bei der
--     Einladung, wird beim Annehmen genau einmal ausgeliefert und danach gelöscht (einmalig, ablaufend)
--   * Dokumente/Fristen/Notizen: Metadaten und Inhalt AES-GCM mit Schlüsseln aus dem Gruppenschlüssel;
--     Dateien liegen im privaten Storage-Bucket `family` unter <gruppe>/<zufällige blob id>
--
-- Notfallzugang (Zustandsautomat hier auf dem Server, Schlüsselfreigabe auf dem Gerät):
--   bereit ──anfragen──▶ angefragt ──(Wartezeit vorbei | Verwalter gibt frei)──▶ abholen ──▶ freigegeben
--                          │
--                          └──Verwalter lehnt ab──▶ abgelehnt ──anfragen──▶ angefragt …
--   Das Gerät eines Verwalters verpackt den Gruppenschlüssel VORAB für den öffentlichen Schlüssel des Notfallkontakts
--   (fam_emergency.escrow_key). Dieser Wert ist für niemanden lesbar (keine Policy, kein Grant) und wird nur über
--   fam_emergency_claim() ausgeliefert – und nur, wenn die Wartezeit abgelaufen ist oder ein Verwalter freigegeben hat.
--
-- Bedrohungsmodell (ehrlich):
--   + Der Server-Betreiber und ein Angreifer mit Datenbankzugriff sehen keine Inhalte, Namen oder Schlüssel – nur
--     zufällige IDs, Größen, Zeitstempel, Rollen und welche Konten in welcher Gruppe sind.
--   − Die Wartezeit des Notfallzugangs wird vom Server durchgesetzt. Ein böswilliger Server-Betreiber (oder wer die
--     Datenbank kontrolliert) könnte den vorab verpackten Schlüssel früher an den Notfallkontakt ausliefern. Lesen
--     kann ihn aber nur der Notfallkontakt mit seinem privaten Schlüssel – der Server selbst nie.
--   − Ein entferntes Mitglied verliert sofort den Server-Zugriff auf die verschlüsselten Dateien (RLS), kennt aber den
--     Gruppenschlüssel weiter: Was es vorher heruntergeladen hat, kann es weiter lesen. Gleiches gilt für einen
--     Notfallkontakt nach der Freigabe.
--   − Wer einen noch gültigen Einladungslink abfängt, kann beitreten – Links nur persönlich/verschlüsselt weitergeben;
--     Verwalter sehen jeden Beitritt und können Mitglieder entfernen. Einladungen laufen ab und gelten einmal.
--   − Öffentliche Schlüssel werden vom Server verteilt; ein manipulierter Server könnte einen falschen Schlüssel
--     unterschieben (kein Fingerprint-Abgleich). Die App zeigt deshalb die Schlüssel-Kennung zum Vergleichen an.
--
-- Zugriff: RLS auf allen Tabellen; Mitglieder dürfen ihre Gruppen, Mitglieder und Einträge lesen (SELECT-Policies).
-- Geschrieben wird nur über die SECURITY-DEFINER-Funktionen unten (auth.uid(), Rollenprüfung, Advisory Lock).
-- Idempotent: kann mehrfach ausgeführt werden.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.fale_family_config (key text primary key, value bigint not null, note text);
alter table private.fale_family_config enable row level security;
revoke all on private.fale_family_config from public, anon, authenticated;
insert into private.fale_family_config (key, value, note) values
  ('max_groups', 5, 'Familien-Ordner, in denen ein Konto Mitglied sein kann'),
  ('max_members', 12, 'Mitglieder pro Familien-Ordner'),
  ('max_items', 5000, 'Einträge pro Familien-Ordner'),
  ('max_meta', 65536, 'verschlüsselte Metadaten pro Eintrag (Zeichen)'),
  ('group_bytes', 2147483648, 'Speicher pro Familien-Ordner (2 GB)'),
  ('max_open_invites', 20, 'offene Einladungen pro Familien-Ordner'),
  ('invite_hours_max', 168, 'Einladungen gelten höchstens so lange (Stunden)')
on conflict (key) do nothing;
create or replace function private.fam_cfg(p_key text) returns bigint
language sql stable security definer set search_path = '' as $$ select value from private.fale_family_config where key = p_key $$;
revoke all on function private.fam_cfg(text) from public, anon, authenticated;

-- ------------------------------------------------------------------ tables
create table if not exists public.fam_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  key_id text not null check (key_id ~ '^[A-Za-z0-9_-]{16,32}$'),
  public_jwk jsonb not null check (jsonb_typeof(public_jwk) = 'object' and octet_length(public_jwk::text) <= 400),
  wrapped_private text not null check (char_length(wrapped_private) between 40 and 2000 and wrapped_private ~ '^[A-Za-z0-9_-]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.fam_groups (
  group_id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users (id) on delete set null,
  sealed_name text not null check (char_length(sealed_name) between 20 and 600 and sealed_name ~ '^[A-Za-z0-9_-]+$'),
  key_version integer not null default 1 check (key_version >= 1),
  seq bigint not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.fam_members (
  group_id uuid not null references public.fam_groups (group_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('verwalter', 'mitglied', 'notfall')),
  wrapped_key text check (wrapped_key is null or (char_length(wrapped_key) between 40 and 600 and wrapped_key ~ '^[A-Za-z0-9_-]+$')),
  key_version integer,
  sealed_label text check (sealed_label is null or (char_length(sealed_label) <= 600 and sealed_label ~ '^[A-Za-z0-9_-]+$')),
  invited_by uuid,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists fam_members_user_idx on public.fam_members (user_id);
create table if not exists public.fam_invites (
  invite_id text primary key check (invite_id ~ '^[A-Za-z0-9_-]{22}$'),
  group_id uuid not null references public.fam_groups (group_id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  role text not null check (role in ('verwalter', 'mitglied', 'notfall')),
  auth_hash text not null check (auth_hash ~ '^[0-9a-f]{64}$'),
  wrapped_key text check (wrapped_key is null or (char_length(wrapped_key) between 40 and 600 and wrapped_key ~ '^[A-Za-z0-9_-]+$')),
  key_version integer,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists fam_invites_group_idx on public.fam_invites (group_id);
create table if not exists public.fam_items (
  group_id uuid not null references public.fam_groups (group_id) on delete cascade,
  item_id text not null check (item_id ~ '^[A-Za-z0-9_-]{22}$'),
  kind text not null check (kind in ('file', 'reminder', 'note')),
  version bigint not null default 1 check (version >= 1),
  seq bigint not null,
  meta text check (meta is null or meta ~ '^[A-Za-z0-9_-]+$'),
  blob_id text check (blob_id is null or blob_id ~ '^[A-Za-z0-9_-]{22}$'),
  size bigint not null default 0 check (size >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  key_version integer not null default 1,
  created_by uuid,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  deleted_at timestamptz,
  primary key (group_id, item_id),
  check ((deleted and meta is null and blob_id is null) or (not deleted and meta is not null))
);
create index if not exists fam_items_seq_idx on public.fam_items (group_id, seq);
create table if not exists public.fam_emergency (
  group_id uuid not null references public.fam_groups (group_id) on delete cascade,
  contact_id uuid not null references auth.users (id) on delete cascade,
  owner_id uuid references auth.users (id) on delete set null,
  wait_days integer not null check (wait_days between 1 and 60),
  escrow_key text not null check (char_length(escrow_key) between 40 and 600 and escrow_key ~ '^[A-Za-z0-9_-]+$'),
  key_version integer not null,
  state text not null default 'bereit' check (state in ('bereit', 'angefragt', 'abgelehnt', 'freigegeben')),
  requested_at timestamptz,
  release_at timestamptz,
  decided_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (group_id, contact_id)
);

alter table public.fam_keys enable row level security;
alter table public.fam_groups enable row level security;
alter table public.fam_members enable row level security;
alter table public.fam_invites enable row level security;
alter table public.fam_items enable row level security;
alter table public.fam_emergency enable row level security;
revoke all on public.fam_keys, public.fam_groups, public.fam_members, public.fam_invites, public.fam_items, public.fam_emergency from public, anon, authenticated;
grant select on public.fam_keys, public.fam_groups, public.fam_members, public.fam_items to authenticated;
-- fam_invites and fam_emergency: no grants at all (escrow keys and invite wraps are only handed out by the RPCs)

-- ------------------------------------------------------------------ helpers (private + fale_rls)
create schema if not exists fale_rls;
revoke all on schema fale_rls from public, anon, authenticated;
create or replace function private.fam_uid() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare u uuid;
begin
  u := auth.uid();
  if u is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  return u;
end $$;
create or replace function private.fam_lock(p_group uuid) returns void
language sql volatile security definer set search_path = '' as $$ select pg_advisory_xact_lock(hashtextextended('fale-fam:' || p_group::text, 0)) $$;
create or replace function private.fam_role(p_group uuid, p_user uuid) returns text
language sql stable security definer set search_path = '' as $$ select role from public.fam_members where group_id = p_group and user_id = p_user $$;
/** text → uuid or null (storage paths are untrusted) */
create or replace function fale_rls.fam_uuid(p text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then p::uuid else null end $$;
/** may read the group's encrypted items: Verwalter/Mitglied, or a Notfallkontakt after the release */
create or replace function fale_rls.fam_can_read(p_group uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.fam_members m where m.group_id = p_group and m.user_id = p_user and (
    m.role in ('verwalter', 'mitglied')
    or (m.role = 'notfall' and exists (select 1 from public.fam_emergency e where e.group_id = p_group and e.contact_id = p_user and e.state = 'freigegeben'))))
$$;
create or replace function fale_rls.fam_can_write(p_group uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.fam_members m where m.group_id = p_group and m.user_id = p_user and m.role in ('verwalter', 'mitglied'))
$$;
create or replace function fale_rls.fam_group_bytes(p_group uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(coalesce((o.metadata ->> 'size')::bigint, 0)), 0)::bigint from storage.objects o
  where o.bucket_id = 'family' and starts_with(o.name, p_group::text || '/')
$$;
create or replace function private.fam_item_json(i public.fam_items) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('item_id', i.item_id, 'kind', i.kind, 'version', i.version, 'seq', i.seq, 'meta', i.meta, 'blob_id', i.blob_id, 'size', i.size,
    'sha256', i.sha256, 'key_version', i.key_version, 'created_by', i.created_by, 'updated_by', i.updated_by, 'updated_at', i.updated_at, 'deleted', i.deleted)
$$;
create or replace function private.fam_b64ok(p text, p_min integer, p_max integer) returns boolean
language sql immutable set search_path = '' as $$ select p is not null and char_length(p) between p_min and p_max and p ~ '^[A-Za-z0-9_-]+$' $$;
do $$
declare f text;
begin
  foreach f in array array['private.fam_uid()', 'private.fam_lock(uuid)', 'private.fam_role(uuid, uuid)', 'fale_rls.fam_uuid(text)', 'fale_rls.fam_can_read(uuid, uuid)',
    'fale_rls.fam_can_write(uuid, uuid)', 'fale_rls.fam_group_bytes(uuid)', 'private.fam_item_json(public.fam_items)', 'private.fam_b64ok(text, integer, integer)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
-- RLS/storage policies run as the user and need these yes/no checks: they live in their own small schema
-- (not exposed through the API, nothing else in it), so `private` stays closed for authenticated users.
grant usage on schema fale_rls to authenticated;
grant execute on function fale_rls.fam_can_read(uuid, uuid), fale_rls.fam_can_write(uuid, uuid), fale_rls.fam_uuid(text), fale_rls.fam_group_bytes(uuid) to authenticated;

-- ------------------------------------------------------------------ RLS (read-only for members)
drop policy if exists fam_keys_own on public.fam_keys;
create policy fam_keys_own on public.fam_keys for select to authenticated using ((select auth.uid()) is not null and user_id = (select auth.uid()));
drop policy if exists fam_groups_member on public.fam_groups;
create policy fam_groups_member on public.fam_groups for select to authenticated using (exists (select 1 from public.fam_members m where m.group_id = fam_groups.group_id and m.user_id = (select auth.uid())));
drop policy if exists fam_members_member on public.fam_members;
create policy fam_members_member on public.fam_members for select to authenticated using (fale_rls.fam_can_read(group_id, (select auth.uid())) or user_id = (select auth.uid()));
drop policy if exists fam_items_reader on public.fam_items;
create policy fam_items_reader on public.fam_items for select to authenticated using (fale_rls.fam_can_read(group_id, (select auth.uid())));

-- ------------------------------------------------------------------ storage bucket `family` (<group id>/<blob id>)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('family', 'family', false, 26214400, array['application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists fale_family_select on storage.objects;
drop policy if exists fale_family_insert on storage.objects;
drop policy if exists fale_family_delete on storage.objects;
create policy fale_family_select on storage.objects for select to authenticated using (
  bucket_id = 'family' and (select auth.uid()) is not null and array_length(storage.foldername(name), 1) = 1
  and fale_rls.fam_can_read(fale_rls.fam_uuid((storage.foldername(name))[1]), (select auth.uid()))
);
create policy fale_family_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'family' and (select auth.uid()) is not null and array_length(storage.foldername(name), 1) = 1
  and storage.filename(name) ~ '^[A-Za-z0-9_-]{22}$'
  and fale_rls.fam_can_write(fale_rls.fam_uuid((storage.foldername(name))[1]), (select auth.uid()))
  and fale_rls.fam_group_bytes(fale_rls.fam_uuid((storage.foldername(name))[1])) < 2147483648
);
create policy fale_family_delete on storage.objects for delete to authenticated using (
  bucket_id = 'family' and (select auth.uid()) is not null
  and fale_rls.fam_can_write(fale_rls.fam_uuid((storage.foldername(name))[1]), (select auth.uid()))
);

-- ------------------------------------------------------------------ RPCs: keys
/** Store the own public key + the private key wrapped by the sync master key. p_mode 'create' | 'rewrap' (same key id). */
create or replace function public.fam_key_put(p_key_id text, p_public jsonb, p_wrapped text, p_mode text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u uuid := private.fam_uid(); cur record;
begin
  if p_mode not in ('create', 'rewrap') or p_key_id is null or p_key_id !~ '^[A-Za-z0-9_-]{16,32}$' or p_public is null or jsonb_typeof(p_public) <> 'object'
     or p_public ->> 'kty' <> 'EC' or p_public ->> 'crv' <> 'P-256' or coalesce(p_public ->> 'x', '') !~ '^[A-Za-z0-9_-]{43}$' or coalesce(p_public ->> 'y', '') !~ '^[A-Za-z0-9_-]{43}$'
     or p_public ? 'd' or octet_length(p_public::text) > 400 or not private.fam_b64ok(p_wrapped, 40, 2000) then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  select * into cur from public.fam_keys where user_id = u for update;
  if found and cur.key_id <> p_key_id then return jsonb_build_object('ok', false, 'reason', 'exists', 'key_id', cur.key_id); end if;
  if not found and p_mode = 'rewrap' then return jsonb_build_object('ok', false, 'reason', 'no_key'); end if;
  insert into public.fam_keys (user_id, key_id, public_jwk, wrapped_private) values (u, p_key_id, jsonb_build_object('kty', 'EC', 'crv', 'P-256', 'x', p_public ->> 'x', 'y', p_public ->> 'y'), p_wrapped)
  on conflict (user_id) do update set wrapped_private = excluded.wrapped_private, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.fam_key_get() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := private.fam_uid(); k record;
begin
  select key_id, public_jwk, wrapped_private into k from public.fam_keys where user_id = u;
  if not found then return jsonb_build_object('ok', true, 'key', null); end if;
  return jsonb_build_object('ok', true, 'key', jsonb_build_object('key_id', k.key_id, 'public_jwk', k.public_jwk, 'wrapped_private', k.wrapped_private));
end $$;

/** Public keys of the group's members (for wrapping the group key). Members only. */
create or replace function public.fam_public_keys(p_group uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := private.fam_uid(); arr jsonb;
begin
  if private.fam_role(p_group, u) is null then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.role, 'key_id', k.key_id, 'public_jwk', k.public_jwk)), '[]'::jsonb) into arr
  from public.fam_members m left join public.fam_keys k on k.user_id = m.user_id where m.group_id = p_group;
  return jsonb_build_object('ok', true, 'keys', arr);
end $$;

-- ------------------------------------------------------------------ RPCs: groups + members
drop function if exists public.fam_group_create(text, text);
/** The device chooses the group id (the encrypted name and the wrapped key are bound to it). */
create or replace function public.fam_group_create(p_group uuid, p_sealed_name text, p_wrapped_key text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u uuid := private.fam_uid(); g uuid; n integer;
begin
  if p_group is null or not private.fam_b64ok(p_sealed_name, 20, 600) or not private.fam_b64ok(p_wrapped_key, 40, 600) then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  if exists (select 1 from public.fam_groups where group_id = p_group) then return jsonb_build_object('ok', false, 'reason', 'exists'); end if;
  if not exists (select 1 from public.fam_keys where user_id = u) then return jsonb_build_object('ok', false, 'reason', 'no_key'); end if;
  perform pg_advisory_xact_lock(hashtextextended('fale-fam-user:' || u::text, 0));
  select count(*) into n from public.fam_members where user_id = u;
  if n >= private.fam_cfg('max_groups') then return jsonb_build_object('ok', false, 'reason', 'too_many_groups'); end if;
  insert into public.fam_groups (group_id, created_by, sealed_name) values (p_group, u, p_sealed_name) returning group_id into g;
  insert into public.fam_members (group_id, user_id, role, wrapped_key, key_version) values (g, u, 'verwalter', p_wrapped_key, 1);
  return jsonb_build_object('ok', true, 'group_id', g);
end $$;

/** Everything the app needs for the overview: own groups (encrypted names), members, invites (Verwalter), emergency state. */
create or replace function public.fam_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := private.fam_uid(); out_ jsonb;
begin
  select coalesce(jsonb_agg(x order by (x ->> 'created_at')), '[]'::jsonb) into out_ from (
    select jsonb_build_object(
      'group_id', g.group_id, 'sealed_name', g.sealed_name, 'key_version', g.key_version, 'created_at', g.created_at,
      'my_role', me.role, 'my_wrapped_key', me.wrapped_key, 'my_key_version', me.key_version,
      'can_read', fale_rls.fam_can_read(g.group_id, u),
      'members', (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', au.email, 'role', m.role, 'has_key', m.wrapped_key is not null,
          'sealed_label', m.sealed_label, 'joined_at', m.joined_at, 'me', m.user_id = u, 'key_id', k.key_id) order by m.joined_at), '[]'::jsonb)
        from public.fam_members m left join auth.users au on au.id = m.user_id left join public.fam_keys k on k.user_id = m.user_id where m.group_id = g.group_id),
      'invites', case when me.role = 'verwalter' then (select coalesce(jsonb_agg(jsonb_build_object('invite_id', i.invite_id, 'role', i.role, 'expires_at', i.expires_at,
          'used_at', i.used_at, 'used_by_email', ub.email) order by i.created_at desc), '[]'::jsonb)
        from public.fam_invites i left join auth.users ub on ub.id = i.used_by where i.group_id = g.group_id and (i.used_at is null and i.expires_at > now() or i.used_at > now() - interval '7 days')) else '[]'::jsonb end,
      'emergency', (select coalesce(jsonb_agg(jsonb_build_object('contact_id', e.contact_id, 'contact_email', ce.email, 'owner_id', e.owner_id, 'owner_email', oe.email,
          'state', e.state, 'wait_days', e.wait_days, 'requested_at', e.requested_at, 'release_at', e.release_at, 'decided_at', e.decided_at, 'released_at', e.released_at,
          'ready', e.state = 'angefragt' and e.release_at <= now(), 'me', e.contact_id = u)), '[]'::jsonb)
        from public.fam_emergency e left join auth.users ce on ce.id = e.contact_id left join auth.users oe on oe.id = e.owner_id
        where e.group_id = g.group_id and (me.role = 'verwalter' or e.contact_id = u)),
      'items', (select count(*) from public.fam_items i where i.group_id = g.group_id and not i.deleted),
      'bytes', fale_rls.fam_group_bytes(g.group_id),
      'seq', g.seq) as x
    from public.fam_groups g join public.fam_members me on me.group_id = g.group_id and me.user_id = u
  ) t;
  return jsonb_build_object('ok', true, 'groups', out_, 'now', now());
end $$;

create or replace function public.fam_member_setkey(p_group uuid, p_wrapped_key text, p_key_version integer, p_sealed_label text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u uuid := private.fam_uid(); r text;
begin
  if not private.fam_b64ok(p_wrapped_key, 40, 600) or (p_sealed_label is not null and not private.fam_b64ok(p_sealed_label, 20, 600)) then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  r := private.fam_role(p_group, u);
  if r is null then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if r = 'notfall' and not fale_rls.fam_can_read(p_group, u) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  update public.fam_members set wrapped_key = p_wrapped_key, key_version = coalesce(p_key_version, 1), sealed_label = coalesce(p_sealed_label, sealed_label)
  where group_id = p_group and user_id = u;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.fam_member_label(p_group uuid, p_sealed_label text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u uuid := private.fam_uid();
begin
  if p_sealed_label is not null and not private.fam_b64ok(p_sealed_label, 20, 600) then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  update public.fam_members set sealed_label = p_sealed_label where group_id = p_group and user_id = u;
  if not found then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  return jsonb_build_object('ok', true);
end $$;

/** Verwalter: change a role (verwalter ↔ mitglied). The last Verwalter cannot be demoted. */
create or replace function public.fam_member_role(p_group uuid, p_user uuid, p_role text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u uuid := private.fam_uid(); cur text; nv integer;
begin
  if p_role not in ('verwalter', 'mitglied') then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  perform private.fam_lock(p_group);
  if private.fam_role(p_group, u) is distinct from 'verwalter' then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  cur := private.fam_role(p_group, p_user);
  if cur is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if cur = 'notfall' then return jsonb_build_object('ok', false, 'reason', 'emergency_contact'); end if;
  if cur = 'verwalter' and p_role = 'mitglied' then
    select count(*) into nv from public.fam_members where group_id = p_group and role = 'verwalter';
    if nv <= 1 then return jsonb_build_object('ok', false, 'reason', 'last_admin'); end if;
  end if;
  update public.fam_members set role = p_role where group_id = p_group and user_id = p_user;
  return jsonb_build_object('ok', true);
end $$;

/** Remove a member (Verwalter) or leave (self). The last Verwalter cannot leave – delete the folder instead. */
create or replace function public.fam_member_remove(p_group uuid, p_user uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u uuid := private.fam_uid(); me text; target text; nv integer;
begin
  perform private.fam_lock(p_group);
  me := private.fam_role(p_group, u);
  target := private.fam_role(p_group, p_user);
  if me is null or target is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_user <> u and me <> 'verwalter' then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if target = 'verwalter' then
    select count(*) into nv from public.fam_members where group_id = p_group and role = 'verwalter';
    if nv <= 1 then return jsonb_build_object('ok', false, 'reason', 'last_admin'); end if;
  end if;
  delete from public.fam_emergency where group_id = p_group and contact_id = p_user;
  delete from public.fam_members where group_id = p_group and user_id = p_user;
  return jsonb_build_object('ok', true);
end $$;

/** Verwalter: delete the folder (encrypted files are removed by the device first; remaining objects are counted). */
create or replace function public.fam_group_delete(p_group uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u uuid := private.fam_uid(); left_ bigint;
begin
  perform private.fam_lock(p_group);
  if private.fam_role(p_group, u) is distinct from 'verwalter' then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select count(*) into left_ from storage.objects o where o.bucket_id = 'family' and starts_with(o.name, p_group::text || '/');
  delete from public.fam_groups where group_id = p_group;
  return jsonb_build_object('ok', true, 'remaining_objects', left_);
end $$;

-- ------------------------------------------------------------------ RPCs: invitations (link / QR, expiring, one-time)
create or replace function public.fam_invite_create(p_group uuid, p_invite_id text, p_auth_hash text, p_wrapped_key text, p_role text, p_hours integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u uuid := private.fam_uid(); n integer; kv integer;
begin
  if p_invite_id is null or p_invite_id !~ '^[A-Za-z0-9_-]{22}$' or p_auth_hash is null or p_auth_hash !~ '^[0-9a-f]{64}$' or p_role not in ('verwalter', 'mitglied', 'notfall')
     or p_hours is null or p_hours < 1 or p_hours > private.fam_cfg('invite_hours_max')
     or (p_role = 'notfall' and p_wrapped_key is not null) or (p_role <> 'notfall' and not private.fam_b64ok(p_wrapped_key, 40, 600)) then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  perform private.fam_lock(p_group);
  if private.fam_role(p_group, u) is distinct from 'verwalter' then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select count(*) into n from public.fam_invites where group_id = p_group and used_at is null and expires_at > now();
  if n >= private.fam_cfg('max_open_invites') then return jsonb_build_object('ok', false, 'reason', 'too_many_invites'); end if;
  select key_version into kv from public.fam_groups where group_id = p_group;
  insert into public.fam_invites (invite_id, group_id, created_by, role, auth_hash, wrapped_key, key_version, expires_at)
  values (p_invite_id, p_group, u, p_role, p_auth_hash, p_wrapped_key, kv, now() + make_interval(hours => p_hours));
  return jsonb_build_object('ok', true, 'expires_at', now() + make_interval(hours => p_hours));
end $$;

/** Accept an invitation: proves knowledge of the link secret (p_auth), joins, gets the invite-wrapped group key ONCE. */
create or replace function public.fam_invite_accept(p_invite_id text, p_auth text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u uuid := private.fam_uid(); i record; n integer; ng integer; w text;
begin
  if p_invite_id is null or p_invite_id !~ '^[A-Za-z0-9_-]{22}$' or p_auth is null or p_auth !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  select * into i from public.fam_invites where invite_id = p_invite_id for update;
  if not found or i.auth_hash <> encode(extensions.digest(p_auth, 'sha256'), 'hex') then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if i.used_at is not null then return jsonb_build_object('ok', false, 'reason', 'used'); end if;
  if i.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if not exists (select 1 from public.fam_keys where user_id = u) then return jsonb_build_object('ok', false, 'reason', 'no_key'); end if;
  perform private.fam_lock(i.group_id);
  if private.fam_role(i.group_id, u) is not null then return jsonb_build_object('ok', false, 'reason', 'already_member', 'group_id', i.group_id); end if;
  select count(*) into n from public.fam_members where group_id = i.group_id;
  if n >= private.fam_cfg('max_members') then return jsonb_build_object('ok', false, 'reason', 'group_full'); end if;
  select count(*) into ng from public.fam_members where user_id = u;
  if ng >= private.fam_cfg('max_groups') then return jsonb_build_object('ok', false, 'reason', 'too_many_groups'); end if;
  insert into public.fam_members (group_id, user_id, role, invited_by) values (i.group_id, u, i.role, i.created_by);
  w := i.wrapped_key;
  update public.fam_invites set used_at = now(), used_by = u, wrapped_key = null where invite_id = p_invite_id;
  return jsonb_build_object('ok', true, 'group_id', i.group_id, 'role', i.role, 'wrapped_key', w, 'key_version', i.key_version);
end $$;

create or replace function public.fam_invite_revoke(p_invite_id text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u uuid := private.fam_uid(); g uuid;
begin
  select group_id into g from public.fam_invites where invite_id = p_invite_id;
  if not found then return jsonb_build_object('ok', true, 'missing', true); end if;
  if private.fam_role(g, u) is distinct from 'verwalter' then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  delete from public.fam_invites where invite_id = p_invite_id;
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------------ RPCs: shared items (documents, reminders, notes)
create or replace function public.fam_item_put(p_group uuid, p_item_id text, p_kind text, p_base_version bigint, p_meta text, p_blob_id text, p_size bigint, p_sha256 text, p_key_version integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u uuid := private.fam_uid(); cur public.fam_items; n bigint; s bigint; v bigint; osize bigint; old_blob text := null;
begin
  if p_item_id is null or p_item_id !~ '^[A-Za-z0-9_-]{22}$' or p_kind not in ('file', 'reminder', 'note') or p_base_version is null or p_base_version < 0
     or not private.fam_b64ok(p_meta, 20, private.fam_cfg('max_meta')::integer) or (p_blob_id is not null and p_blob_id !~ '^[A-Za-z0-9_-]{22}$')
     or (p_sha256 is not null and p_sha256 !~ '^[0-9a-f]{64}$') or (p_kind = 'file' and p_blob_id is null) or (p_kind <> 'file' and p_blob_id is not null) then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  perform private.fam_lock(p_group);
  if not fale_rls.fam_can_write(p_group, u) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into cur from public.fam_items where group_id = p_group and item_id = p_item_id for update;
  if found then
    if cur.version <> p_base_version then return jsonb_build_object('ok', false, 'reason', 'conflict', 'item', private.fam_item_json(cur)); end if;
    if cur.kind <> p_kind then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  else
    select count(*) into n from public.fam_items where group_id = p_group;
    if n >= private.fam_cfg('max_items') then return jsonb_build_object('ok', false, 'reason', 'too_many_items'); end if;
  end if;
  if p_blob_id is not null and p_blob_id is distinct from cur.blob_id then
    select (o.metadata ->> 'size')::bigint into osize from storage.objects o where o.bucket_id = 'family' and o.name = p_group::text || '/' || p_blob_id;
    if osize is null then return jsonb_build_object('ok', false, 'reason', 'no_blob'); end if;
    if p_size is null or osize <> p_size then return jsonb_build_object('ok', false, 'reason', 'size_mismatch', 'size', osize); end if;
  end if;
  if cur.blob_id is not null and cur.blob_id is distinct from p_blob_id then old_blob := cur.blob_id; end if;
  update public.fam_groups set seq = seq + 1 where group_id = p_group returning seq into s;
  v := coalesce(cur.version, 0) + 1;
  insert into public.fam_items (group_id, item_id, kind, version, seq, meta, blob_id, size, sha256, key_version, created_by, updated_by, updated_at, deleted, deleted_at)
  values (p_group, p_item_id, p_kind, v, s, p_meta, p_blob_id, coalesce(case when p_blob_id is null then 0 else p_size end, 0), p_sha256, coalesce(p_key_version, 1), u, u, now(), false, null)
  on conflict (group_id, item_id) do update set version = excluded.version, seq = excluded.seq, meta = excluded.meta, blob_id = excluded.blob_id, size = excluded.size,
    sha256 = excluded.sha256, key_version = excluded.key_version, updated_by = u, updated_at = now(), deleted = false, deleted_at = null;
  return jsonb_build_object('ok', true, 'version', v, 'seq', s, 'old_blob', old_blob);
end $$;

create or replace function public.fam_item_delete(p_group uuid, p_item_id text, p_base_version bigint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u uuid := private.fam_uid(); cur public.fam_items; s bigint;
begin
  perform private.fam_lock(p_group);
  if not fale_rls.fam_can_write(p_group, u) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into cur from public.fam_items where group_id = p_group and item_id = p_item_id for update;
  if not found or cur.deleted then return jsonb_build_object('ok', true, 'missing', true); end if;
  if cur.version <> p_base_version then return jsonb_build_object('ok', false, 'reason', 'conflict', 'item', private.fam_item_json(cur)); end if;
  update public.fam_groups set seq = seq + 1 where group_id = p_group returning seq into s;
  update public.fam_items set deleted = true, deleted_at = now(), meta = null, blob_id = null, size = 0, sha256 = null, version = version + 1, seq = s, updated_by = u, updated_at = now()
  where group_id = p_group and item_id = p_item_id;
  return jsonb_build_object('ok', true, 'old_blob', cur.blob_id, 'seq', s);
end $$;

create or replace function public.fam_items_list(p_group uuid, p_after bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := private.fam_uid(); arr jsonb; mx bigint;
begin
  if not fale_rls.fam_can_read(p_group, u) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select coalesce(jsonb_agg(private.fam_item_json(t.i) order by (t.i).seq), '[]'::jsonb), max((t.i).seq) into arr, mx
  from (select i from public.fam_items i where i.group_id = p_group and i.seq > coalesce(p_after, 0) order by i.seq limit 500) t;
  return jsonb_build_object('ok', true, 'items', arr, 'cursor', coalesce(mx, p_after, 0));
end $$;

-- ------------------------------------------------------------------ RPCs: Notfallzugang
/** Verwalter: set up (or renew) an emergency contact – escrow = group key pre-wrapped for the contact's public key. */
create or replace function public.fam_emergency_setup(p_group uuid, p_contact uuid, p_wait_days integer, p_escrow text, p_key_version integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u uuid := private.fam_uid();
begin
  if p_wait_days is null or p_wait_days < 1 or p_wait_days > 60 or not private.fam_b64ok(p_escrow, 40, 600) then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  perform private.fam_lock(p_group);
  if private.fam_role(p_group, u) is distinct from 'verwalter' then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if private.fam_role(p_group, p_contact) is distinct from 'notfall' then return jsonb_build_object('ok', false, 'reason', 'not_contact'); end if;
  insert into public.fam_emergency (group_id, contact_id, owner_id, wait_days, escrow_key, key_version, state)
  values (p_group, p_contact, u, p_wait_days, p_escrow, coalesce(p_key_version, 1), 'bereit')
  on conflict (group_id, contact_id) do update set owner_id = u, wait_days = excluded.wait_days, escrow_key = excluded.escrow_key, key_version = excluded.key_version,
    state = case when public.fam_emergency.state = 'freigegeben' then 'freigegeben' else 'bereit' end, requested_at = null, release_at = null, decided_at = null;
  return jsonb_build_object('ok', true);
end $$;

/** Notfallkontakt: request access. Released automatically after the waiting period unless a Verwalter declines. */
create or replace function public.fam_emergency_request(p_group uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u uuid := private.fam_uid(); e record;
begin
  perform private.fam_lock(p_group);
  select * into e from public.fam_emergency where group_id = p_group and contact_id = u for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_contact'); end if;
  if e.state = 'freigegeben' then return jsonb_build_object('ok', true, 'state', 'freigegeben'); end if;
  if e.state = 'angefragt' then return jsonb_build_object('ok', true, 'state', 'angefragt', 'release_at', e.release_at); end if;
  if e.state = 'abgelehnt' and e.decided_at > now() - interval '24 hours' then return jsonb_build_object('ok', false, 'reason', 'declined_recently', 'decided_at', e.decided_at); end if;
  update public.fam_emergency set state = 'angefragt', requested_at = now(), release_at = now() + make_interval(days => e.wait_days), decided_at = null
  where group_id = p_group and contact_id = u;
  return jsonb_build_object('ok', true, 'state', 'angefragt', 'release_at', now() + make_interval(days => e.wait_days));
end $$;

/** Verwalter: decline ('ablehnen') or release immediately ('freigeben') a pending request. */
create or replace function public.fam_emergency_decide(p_group uuid, p_contact uuid, p_decision text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u uuid := private.fam_uid(); e record;
begin
  if p_decision not in ('ablehnen', 'freigeben') then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  perform private.fam_lock(p_group);
  if private.fam_role(p_group, u) is distinct from 'verwalter' then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into e from public.fam_emergency where group_id = p_group and contact_id = p_contact for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if e.state <> 'angefragt' then return jsonb_build_object('ok', false, 'reason', 'not_pending', 'state', e.state); end if;
  if p_decision = 'ablehnen' then
    update public.fam_emergency set state = 'abgelehnt', decided_at = now(), release_at = null where group_id = p_group and contact_id = p_contact;
  else
    update public.fam_emergency set release_at = now(), decided_at = now() where group_id = p_group and contact_id = p_contact;
  end if;
  return jsonb_build_object('ok', true);
end $$;

/** Notfallkontakt: pick up the escrowed key once the waiting period is over (or a Verwalter released it). */
create or replace function public.fam_emergency_claim(p_group uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u uuid := private.fam_uid(); e record;
begin
  perform private.fam_lock(p_group);
  select * into e from public.fam_emergency where group_id = p_group and contact_id = u for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_contact'); end if;
  if e.state = 'freigegeben' then return jsonb_build_object('ok', true, 'wrapped_key', e.escrow_key, 'key_version', e.key_version); end if;
  if e.state <> 'angefragt' then return jsonb_build_object('ok', false, 'reason', 'not_requested', 'state', e.state); end if;
  if e.release_at > now() then return jsonb_build_object('ok', false, 'reason', 'waiting', 'release_at', e.release_at); end if;
  update public.fam_emergency set state = 'freigegeben', released_at = now() where group_id = p_group and contact_id = u;
  update public.fam_members set wrapped_key = e.escrow_key, key_version = e.key_version where group_id = p_group and user_id = u;
  return jsonb_build_object('ok', true, 'wrapped_key', e.escrow_key, 'key_version', e.key_version);
end $$;

/** Verwalter: withdraw an emergency access (also after the release: server access ends, the key itself cannot be taken back). */
create or replace function public.fam_emergency_revoke(p_group uuid, p_contact uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u uuid := private.fam_uid();
begin
  perform private.fam_lock(p_group);
  if private.fam_role(p_group, u) is distinct from 'verwalter' then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  delete from public.fam_emergency where group_id = p_group and contact_id = p_contact;
  update public.fam_members set wrapped_key = null, key_version = null where group_id = p_group and user_id = p_contact and role = 'notfall';
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------------ retention (daily, see 20261014200100_fale_family_cron.sql)
create or replace function private.fam_purge() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a integer; b integer; c integer;
begin
  delete from public.fam_invites where (used_at is null and expires_at < now() - interval '1 day') or used_at < now() - interval '30 days';
  get diagnostics a = row_count;
  update public.fam_invites set wrapped_key = null where wrapped_key is not null and expires_at < now();
  delete from public.fam_items where deleted and deleted_at < now() - interval '30 days';
  get diagnostics b = row_count;
  -- folders without members (everybody left / accounts deleted) and without files
  delete from public.fam_groups g where not exists (select 1 from public.fam_members m where m.group_id = g.group_id)
    and not exists (select 1 from storage.objects o where o.bucket_id = 'family' and starts_with(o.name, g.group_id::text || '/'));
  get diagnostics c = row_count;
  return jsonb_build_object('invites', a, 'tombstones', b, 'groups', c);
end $$;
revoke all on function private.fam_purge() from public, anon, authenticated;

-- ------------------------------------------------------------------ privileges
do $$
declare f text;
begin
  foreach f in array array[
    'public.fam_key_put(text, jsonb, text, text)', 'public.fam_key_get()', 'public.fam_public_keys(uuid)',
    'public.fam_group_create(uuid, text, text)', 'public.fam_overview()', 'public.fam_member_setkey(uuid, text, integer, text)', 'public.fam_member_label(uuid, text)',
    'public.fam_member_role(uuid, uuid, text)', 'public.fam_member_remove(uuid, uuid)', 'public.fam_group_delete(uuid)',
    'public.fam_invite_create(uuid, text, text, text, text, integer)', 'public.fam_invite_accept(text, text)', 'public.fam_invite_revoke(text)',
    'public.fam_item_put(uuid, text, text, bigint, text, text, bigint, text, integer)', 'public.fam_item_delete(uuid, text, bigint)', 'public.fam_items_list(uuid, bigint)',
    'public.fam_emergency_setup(uuid, uuid, integer, text, integer)', 'public.fam_emergency_request(uuid)', 'public.fam_emergency_decide(uuid, uuid, text)',
    'public.fam_emergency_claim(uuid)', 'public.fam_emergency_revoke(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
