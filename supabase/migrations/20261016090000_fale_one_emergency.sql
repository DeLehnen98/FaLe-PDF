-- FaLe One · Notfallzugang (trusted-contact emergency access), end-to-end encrypted. Idempotent – safe to re-run.
-- Contract, crypto and threat model: docs/FALE-ONE-API.md §12.
--
-- What it does: an account owner names 1–3 trusted contacts (other FaLe-Konto users) and a waiting period
-- (24 h – 30 days). A contact can ask for access at any time; the owner is told and can deny with one tap. If the
-- waiting period passes without a veto, the contact gets READ-ONLY access to exactly the covered items.
-- Optional "k of n": at least k contacts must ask together (Shamir secret sharing, done on the devices).
--
-- Keys (all on the devices – the server only stores ciphertext and enforces the time lock):
--   EK   emergency key, 32 random bytes per setup. The owner keeps it as wrap(KEK, EK) (owner_key).
--        Every covered node key NK / album key AK is ALSO stored wrapped by EK (one_em_node_keys / …_album_keys);
--        the owner's devices keep that set in sync with the chosen folders (new files are added on the next sync).
--   EK (k = 1) or a Shamir share of it (k > 1) is sealed for each contact's ECDH P-256 identity key
--        (public.fam_keys, the same key as the family folders) into a "package" (one_em_contacts.package).
--   The package is handed to a contact ONLY by fale_em_package(), and only after the waiting period passed
--        without a veto (request released). For k > 1 the released contacts re-seal their share for each other
--        (one_em_pool) and combine on their devices. The server never holds EK, a share or a node key in clear.
--
-- Honest threat model (details in the contract):
--   + A server / DB operator or a breach sees ids, e-mail addresses of invited contacts, timestamps, WHICH node ids
--     are covered, and the request/veto log – never names, content or keys.
--   − The waiting period is enforced by this server. A malicious operator could hand a package out early – but only
--     to the contact it is sealed for; the server itself still cannot read anything. With k > 1 an early release
--     still needs k contacts to collude.
--   − The contacts must be trusted: after a release they hold the key and can keep what they downloaded.
--   − Public keys come from the server. Owner and contact compare a short safety code (emoji / digits) over both
--     key ids in person or by phone, which detects a substituted key (MITM). The owner seals only after that.
--
-- Access model: like every FaLe One table – RLS on, no policies, no privileges for anon/authenticated; all access
-- through SECURITY DEFINER functions gated by FALE_RPC_SECRET (private.fale_check), executable by anon (= the API's
-- publishable key) and service_role only. Per-setup writes serialize with an advisory lock.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

insert into private.fale_one_config (key, value, note) values
  ('em_max_contacts', 3, 'Notfallzugang: Vertrauenspersonen je Konto'),
  ('em_max_keys', 200000, 'Notfallzugang: abgedeckte Elemente (Ordner, Dateien, Fotos, Alben) je Einrichtung'),
  ('em_invite_days', 14, 'Notfallzugang: Einladungen gelten so viele Tage'),
  ('em_request_days', 30, 'Notfallzugang: Anfragen ohne genügend Personen verfallen nach so vielen Tagen'),
  ('em_cooldown_hours', 24, 'Notfallzugang: neue Anfrage frühestens so viele Stunden nach Ablehnung/Widerruf')
on conflict (key) do nothing;

-- ------------------------------------------------------------------ tables
create table if not exists public.one_em_setups (
  setup_id uuid primary key,
  owner_id uuid not null unique references auth.users (id) on delete cascade,  -- one Notfallzugang per account
  version bigint not null default 1 check (version >= 1),
  wait_hours integer not null check (wait_hours in (24, 72, 168, 336, 720)),
  threshold smallint not null default 1 check (threshold between 1 and 3),
  owner_key text not null check (owner_key ~ '^[A-Za-z0-9_-]{40,200}$'),             -- wrap(KEK, EK)
  owner_kid text not null check (owner_kid ~ '^[A-Za-z0-9_-]{16,32}$'),             -- owner's identity key id
  scope text not null check (char_length(scope) between 24 and 16384 and scope ~ '^[A-Za-z0-9_-]+$'), -- envelope under EK
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.one_em_contacts (
  setup_id uuid not null references public.one_em_setups (setup_id) on delete cascade,
  slot smallint not null check (slot between 1 and 3),                                  -- also the Shamir x
  email text not null check (char_length(email) between 3 and 254 and email = lower(email)),
  contact_id uuid references auth.users (id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'accepted', 'active')),
  contact_kid text check (contact_kid is null or contact_kid ~ '^[A-Za-z0-9_-]{16,32}$'),
  contact_pub jsonb check (contact_pub is null or (jsonb_typeof(contact_pub) = 'object' and octet_length(contact_pub::text) <= 400)),
  package text check (package is null or (char_length(package) between 40 and 4000 and package ~ '^[A-Za-z0-9_-]+$')),
  invited_at timestamptz not null default now(),
  invite_expires_at timestamptz not null,
  accepted_at timestamptz,
  confirmed_at timestamptz,
  primary key (setup_id, slot),
  unique (setup_id, email),
  check ((status = 'invited' and contact_id is null and package is null)
      or (status = 'accepted' and contact_id is not null and contact_kid is not null and package is null)
      or (status = 'active' and contact_id is not null and contact_kid is not null and package is not null))
);
create unique index if not exists one_em_contacts_contact_idx on public.one_em_contacts (setup_id, contact_id) where contact_id is not null;
create index if not exists one_em_contacts_user_idx on public.one_em_contacts (contact_id) where contact_id is not null;
create index if not exists one_em_contacts_email_idx on public.one_em_contacts (email) where status = 'invited';

create table if not exists public.one_em_requests (
  request_id uuid primary key default gen_random_uuid(),
  setup_id uuid not null references public.one_em_setups (setup_id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting', 'released', 'denied', 'expired', 'revoked', 'canceled')),
  wait_hours integer not null,
  threshold smallint not null,
  started_at timestamptz not null default now(),
  threshold_at timestamptz,         -- enough contacts asked: the waiting period starts here
  release_at timestamptz,           -- threshold_at + wait (null while below the threshold)
  released_at timestamptz,
  closed_at timestamptz,
  check ((threshold_at is null) = (release_at is null))
);
create unique index if not exists one_em_requests_open_idx on public.one_em_requests (setup_id) where status in ('waiting', 'released');
create index if not exists one_em_requests_due_idx on public.one_em_requests (release_at) where status = 'waiting';

create table if not exists public.one_em_requesters (
  request_id uuid not null references public.one_em_requests (request_id) on delete cascade,
  contact_id uuid not null references auth.users (id) on delete cascade,
  slot smallint not null,
  requested_at timestamptz not null default now(),
  primary key (request_id, contact_id)
);
-- k of n: shares re-sealed between released contacts (from_slot → to_slot)
create table if not exists public.one_em_pool (
  request_id uuid not null references public.one_em_requests (request_id) on delete cascade,
  from_slot smallint not null,
  to_slot smallint not null,
  sealed text not null check (char_length(sealed) between 40 and 4000 and sealed ~ '^[A-Za-z0-9_-]+$'),
  created_at timestamptz not null default now(),
  primary key (request_id, from_slot, to_slot),
  check (from_slot <> to_slot)
);
-- covered node / album keys, wrapped by EK. FKs: deleting a node/album row (tombstone purge, account deletion) drops it.
create table if not exists public.one_em_node_keys (
  setup_id uuid not null references public.one_em_setups (setup_id) on delete cascade,
  owner_id uuid not null,
  node_id uuid not null,
  key text not null check (key ~ '^[A-Za-z0-9_-]{40,200}$'),
  created_at timestamptz not null default now(),
  primary key (setup_id, node_id),
  foreign key (owner_id, node_id) references public.one_nodes (user_id, node_id) on delete cascade
);
create index if not exists one_em_node_keys_node_idx on public.one_em_node_keys (owner_id, node_id);
create table if not exists public.one_em_album_keys (
  setup_id uuid not null references public.one_em_setups (setup_id) on delete cascade,
  owner_id uuid not null,
  album_id uuid not null,
  key text not null check (key ~ '^[A-Za-z0-9_-]{40,200}$'),
  created_at timestamptz not null default now(),
  primary key (setup_id, album_id),
  foreign key (owner_id, album_id) references public.one_albums (user_id, album_id) on delete cascade
);
-- visible log for the owner (requests, vetoes, releases, views, downloads, changes)
create table if not exists public.one_em_log (
  id bigserial primary key,
  setup_id uuid not null references public.one_em_setups (setup_id) on delete cascade,
  at timestamptz not null default now(),
  event text not null check (event ~ '^[a-z_]{2,32}$'),
  actor uuid,
  slot smallint,
  detail jsonb check (detail is null or octet_length(detail::text) <= 1000)
);
create index if not exists one_em_log_setup_idx on public.one_em_log (setup_id, id desc);
-- notification outbox (sent by the API's pluggable notifier; e-mail addresses are resolved when sending)
create table if not exists private.fale_em_outbox (
  id bigserial primary key,
  kind text not null,
  to_user uuid,
  to_email text,
  setup_id uuid,
  data jsonb,
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  sent_at timestamptz
);
alter table private.fale_em_outbox enable row level security;
revoke all on private.fale_em_outbox from public, anon, authenticated;
revoke all on sequence private.fale_em_outbox_id_seq from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['one_em_setups', 'one_em_contacts', 'one_em_requests', 'one_em_requesters', 'one_em_pool', 'one_em_node_keys', 'one_em_album_keys', 'one_em_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
  revoke all on sequence public.one_em_log_id_seq from public, anon, authenticated;
end $$;

-- ------------------------------------------------------------------ helpers (private)
create or replace function private.fale_em_lock(p_setup uuid) returns void
language sql volatile security definer set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('fale-em:' || p_setup::text, 0))
$$;
create or replace function private.fale_em_email(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$ select lower(email) from auth.users where id = p_user $$;
create or replace function private.fale_em_log_add(p_setup uuid, p_event text, p_actor uuid, p_slot smallint, p_detail jsonb) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.one_em_log (setup_id, event, actor, slot, detail) values (p_setup, p_event, p_actor, p_slot, p_detail)
$$;
create or replace function private.fale_em_notify(p_kind text, p_user uuid, p_email text, p_setup uuid, p_data jsonb) returns void
language sql volatile security definer set search_path = '' as $$
  insert into private.fale_em_outbox (kind, to_user, to_email, setup_id, data) values (p_kind, p_user, p_email, p_setup, p_data)
$$;
/** Contact slot of a user in a setup (any status) or null. */
create or replace function private.fale_em_slot(p_setup uuid, p_user uuid) returns smallint
language sql stable security definer set search_path = '' as $$
  select slot from public.one_em_contacts where setup_id = p_setup and contact_id = p_user
$$;

/** Release a due request (waiting period over, no veto). Caller holds the setup lock. */
create or replace function private.fale_em_settle(p_setup uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare r public.one_em_requests; s public.one_em_setups; q record;
begin
  select * into r from public.one_em_requests where setup_id = p_setup and status = 'waiting' and release_at <= now() for update;
  if not found then return; end if;
  select * into s from public.one_em_setups where setup_id = p_setup;
  update public.one_em_requests set status = 'released', released_at = r.release_at where request_id = r.request_id;
  perform private.fale_em_log_add(p_setup, 'released', null, null, jsonb_build_object('request', r.request_id));
  perform private.fale_em_notify('released_owner', s.owner_id, null, p_setup, null);
  for q in select contact_id from public.one_em_requesters where request_id = r.request_id loop
    perform private.fale_em_notify('released_contact', q.contact_id, null, p_setup, jsonb_build_object('owner_email', private.fale_em_email(s.owner_id)));
  end loop;
end $$;

/** Owner id when p_user may read the covered items of p_setup right now (released request, requester, active contact). */
create or replace function private.fale_em_reader(p_setup uuid, p_user uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select s.owner_id from public.one_em_setups s
    join public.one_em_requests r on r.setup_id = s.setup_id and r.status = 'released'
    join public.one_em_requesters q on q.request_id = r.request_id and q.contact_id = p_user
    join public.one_em_contacts c on c.setup_id = s.setup_id and c.contact_id = p_user and c.status = 'active'
   where s.setup_id = p_setup
$$;

create or replace function private.fale_em_request_json(p_setup uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', r.request_id, 'status', r.status, 'threshold', r.threshold, 'wait_hours', r.wait_hours,
    'started_at', r.started_at, 'threshold_at', r.threshold_at, 'release_at', r.release_at, 'released_at', r.released_at, 'now', now(),
    'requesters', coalesce((select jsonb_agg(jsonb_build_object('slot', q.slot, 'at', q.requested_at) order by q.requested_at) from public.one_em_requesters q where q.request_id = r.request_id), '[]'::jsonb))
  from public.one_em_requests r where r.setup_id = p_setup and r.status in ('waiting', 'released')
$$;

/** Last closed request (for "abgelehnt am …" and the cooldown). */
create or replace function private.fale_em_last_closed(p_setup uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('status', r.status, 'closed_at', r.closed_at,
    'retry_at', case when r.status in ('denied', 'revoked') then r.closed_at + make_interval(hours => coalesce(private.fale_one_cfg('em_cooldown_hours'), 24)::integer) end)
  from public.one_em_requests r where r.setup_id = p_setup and r.status not in ('waiting', 'released') order by r.closed_at desc nulls last limit 1
$$;

create or replace function private.fale_em_owner_json(s public.one_em_setups) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'setup', jsonb_build_object('id', s.setup_id, 'version', s.version, 'wait_hours', s.wait_hours, 'threshold', s.threshold, 'owner_key', s.owner_key,
      'owner_kid', s.owner_kid, 'scope', s.scope, 'created_at', s.created_at, 'updated_at', s.updated_at,
      'node_keys', (select count(*) from public.one_em_node_keys k where k.setup_id = s.setup_id),
      'album_keys', (select count(*) from public.one_em_album_keys k where k.setup_id = s.setup_id)),
    'contacts', coalesce((select jsonb_agg(jsonb_build_object('slot', c.slot, 'email', c.email, 'status', c.status, 'contact_id', c.contact_id,
        'kid', c.contact_kid, 'pub', c.contact_pub, 'invited_at', c.invited_at, 'invite_expires_at', c.invite_expires_at,
        'expired', c.status = 'invited' and c.invite_expires_at < now(), 'accepted_at', c.accepted_at, 'confirmed_at', c.confirmed_at) order by c.slot)
      from public.one_em_contacts c where c.setup_id = s.setup_id), '[]'::jsonb),
    'request', private.fale_em_request_json(s.setup_id),
    'last_closed', private.fale_em_last_closed(s.setup_id),
    'log', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'at', l.at, 'event', l.event, 'slot', l.slot, 'detail', l.detail) order by l.id desc)
      from (select * from public.one_em_log where setup_id = s.setup_id order by id desc limit 50) l), '[]'::jsonb))
$$;

do $$
declare f text;
begin
  foreach f in array array['private.fale_em_lock(uuid)', 'private.fale_em_email(uuid)', 'private.fale_em_log_add(uuid, text, uuid, smallint, jsonb)',
    'private.fale_em_notify(text, uuid, text, uuid, jsonb)', 'private.fale_em_slot(uuid, uuid)', 'private.fale_em_settle(uuid)',
    'private.fale_em_reader(uuid, uuid)', 'private.fale_em_request_json(uuid)', 'private.fale_em_last_closed(uuid)',
    'private.fale_em_owner_json(public.one_em_setups)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- ================================================================== secret-gated RPCs for the Vercel API
-- ------------------------------------------------------------------ identity key (shared with the family folders)
create or replace function public.fale_em_identity_get(p_secret text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare k record;
begin
  perform private.fale_check(p_secret);
  select key_id, public_jwk, wrapped_private into k from public.fam_keys where user_id = p_user;
  if not found then return jsonb_build_object('ok', true, 'key', null); end if;
  return jsonb_build_object('ok', true, 'key', jsonb_build_object('key_id', k.key_id, 'public_jwk', k.public_jwk, 'wrapped_private', k.wrapped_private));
end $$;

/** Same rules as fam_key_put (20261014200000_fale_family.sql): 'create' a new key, or 'rewrap' the same key id. */
create or replace function public.fale_em_identity_put(p_secret text, p_user uuid, p_key_id text, p_public jsonb, p_wrapped text, p_mode text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cur record;
begin
  perform private.fale_check(p_secret);
  if p_mode not in ('create', 'rewrap') or p_key_id is null or p_key_id !~ '^[A-Za-z0-9_-]{16,32}$' or p_public is null or jsonb_typeof(p_public) <> 'object'
     or p_public ->> 'kty' <> 'EC' or p_public ->> 'crv' <> 'P-256' or coalesce(p_public ->> 'x', '') !~ '^[A-Za-z0-9_-]{43}$' or coalesce(p_public ->> 'y', '') !~ '^[A-Za-z0-9_-]{43}$'
     or p_public ? 'd' or octet_length(p_public::text) > 400 or not private.fale_one_b64(p_wrapped, 40, 2000) then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  if not exists (select 1 from auth.users where id = p_user) then return jsonb_build_object('ok', false, 'reason', 'no_user'); end if;
  select * into cur from public.fam_keys where user_id = p_user for update;
  if found and cur.key_id <> p_key_id then return jsonb_build_object('ok', false, 'reason', 'exists', 'key_id', cur.key_id); end if;
  if not found and p_mode = 'rewrap' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  insert into public.fam_keys (user_id, key_id, public_jwk, wrapped_private) values (p_user, p_key_id, jsonb_build_object('kty', 'EC', 'crv', 'P-256', 'x', p_public ->> 'x', 'y', p_public ->> 'y'), p_wrapped)
  on conflict (user_id) do update set wrapped_private = excluded.wrapped_private, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------------ status (owner + contact views)
create or replace function public.fale_em_status(p_secret text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.one_em_setups; own jsonb := null; others jsonb; mail text; x record;
begin
  perform private.fale_check(p_secret);
  mail := private.fale_em_email(p_user);
  -- settle everything this user is part of (lazy release; the cron does the same every 15 minutes)
  for x in select setup_id from public.one_em_setups where owner_id = p_user
           union select setup_id from public.one_em_contacts where contact_id = p_user order by 1 loop
    perform private.fale_em_lock(x.setup_id);
    perform private.fale_em_settle(x.setup_id);
  end loop;
  select * into s from public.one_em_setups where owner_id = p_user;
  if found then own := private.fale_em_owner_json(s); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'setup_id', st.setup_id, 'owner_id', st.owner_id, 'owner_email', private.fale_em_email(st.owner_id), 'owner_kid', st.owner_kid,
      'wait_hours', st.wait_hours, 'threshold', st.threshold, 'slot', c.slot, 'status', c.status, 'kid', c.contact_kid,
      'contacts', (select count(*) from public.one_em_contacts c2 where c2.setup_id = st.setup_id and c2.status = 'active'),
      'invite_expires_at', c.invite_expires_at, 'accepted_at', c.accepted_at, 'confirmed_at', c.confirmed_at,
      'request', private.fale_em_request_json(st.setup_id),
      'requested', exists (select 1 from public.one_em_requests r join public.one_em_requesters q on q.request_id = r.request_id
                           where r.setup_id = st.setup_id and r.status in ('waiting', 'released') and q.contact_id = p_user),
      'readable', private.fale_em_reader(st.setup_id, p_user) is not null,
      'last_closed', private.fale_em_last_closed(st.setup_id)) order by c.invited_at), '[]'::jsonb) into others
    from public.one_em_contacts c join public.one_em_setups st on st.setup_id = c.setup_id
   where st.owner_id <> p_user and (c.contact_id = p_user or (c.status = 'invited' and mail is not null and c.email = mail and c.invite_expires_at > now()));
  return jsonb_build_object('ok', true, 'own', own, 'others', others, 'now', now());
end $$;

-- ------------------------------------------------------------------ owner: set up / change / end
drop function if exists public.fale_em_setup_put(text, uuid, uuid, bigint, integer, text, text, text);
/**
 * Create (p_base_version = 0) or change wait / scope / threshold (p_base_version = current version).
 * The threshold (k of n) can only change here while no contact is active yet – afterwards fale_em_seal re-splits.
 */
create or replace function public.fale_em_setup_put(p_secret text, p_user uuid, p_setup uuid, p_base_version bigint, p_wait_hours integer,
  p_owner_key text, p_owner_kid text, p_scope text, p_threshold integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.one_em_setups;
begin
  perform private.fale_check(p_secret);
  if p_setup is null or p_base_version is null or p_wait_hours is null or p_wait_hours not in (24, 72, 168, 336, 720)
     or not private.fale_one_b64(p_scope, 24, 16384) or (p_threshold is not null and p_threshold not between 1 and 3) then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  if not exists (select 1 from auth.users where id = p_user) then return jsonb_build_object('ok', false, 'reason', 'no_user'); end if;
  perform private.fale_em_lock(p_setup);
  select * into s from public.one_em_setups where owner_id = p_user for update;
  if p_base_version = 0 then
    if found then
      if s.setup_id = p_setup and s.owner_key = p_owner_key and s.scope = p_scope and s.wait_hours = p_wait_hours then
        return jsonb_build_object('ok', true) || private.fale_em_owner_json(s); -- identical retry
      end if;
      return jsonb_build_object('ok', false, 'reason', 'exists');
    end if;
    if p_owner_key is null or p_owner_key !~ '^[A-Za-z0-9_-]{40,200}$' or p_owner_kid is null or p_owner_kid !~ '^[A-Za-z0-9_-]{16,32}$' then
      return jsonb_build_object('ok', false, 'reason', 'bad_input');
    end if;
    if not exists (select 1 from public.fam_keys where user_id = p_user and key_id = p_owner_kid) then return jsonb_build_object('ok', false, 'reason', 'no_key'); end if;
    if exists (select 1 from public.one_em_setups where setup_id = p_setup) then return jsonb_build_object('ok', false, 'reason', 'exists'); end if;
    insert into public.one_em_setups (setup_id, owner_id, wait_hours, threshold, owner_key, owner_kid, scope)
    values (p_setup, p_user, p_wait_hours, coalesce(p_threshold, 1), p_owner_key, p_owner_kid, p_scope)
    returning * into s;
    perform private.fale_em_log_add(p_setup, 'setup_created', p_user, null, jsonb_build_object('wait_hours', p_wait_hours));
    return jsonb_build_object('ok', true) || private.fale_em_owner_json(s);
  end if;
  if not found or s.setup_id <> p_setup then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if s.version <> p_base_version then return jsonb_build_object('ok', false, 'reason', 'conflict', 'version', s.version); end if;
  if p_owner_key is not null and p_owner_key <> s.owner_key then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  if p_threshold is not null and p_threshold <> s.threshold and exists (select 1 from public.one_em_contacts where setup_id = p_setup and status = 'active') then
    return jsonb_build_object('ok', false, 'reason', 'reseal');
  end if;
  update public.one_em_setups set wait_hours = p_wait_hours, scope = p_scope, threshold = coalesce(p_threshold, threshold), version = version + 1, updated_at = now()
   where setup_id = p_setup returning * into s;
  perform private.fale_em_log_add(p_setup, 'setup_changed', p_user, null, jsonb_build_object('wait_hours', p_wait_hours));
  return jsonb_build_object('ok', true) || private.fale_em_owner_json(s);
end $$;

/** End the Notfallzugang completely (all contacts, packages, wrapped keys, requests and the log). */
create or replace function public.fale_em_setup_delete(p_secret text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.one_em_setups; q record;
begin
  perform private.fale_check(p_secret);
  select * into s from public.one_em_setups where owner_id = p_user;
  if not found then return jsonb_build_object('ok', true, 'deleted', false); end if;
  perform private.fale_em_lock(s.setup_id);
  for q in select contact_id from public.one_em_contacts where setup_id = s.setup_id and contact_id is not null loop
    perform private.fale_em_notify('ended', q.contact_id, null, null, jsonb_build_object('owner_email', private.fale_em_email(p_user)));
  end loop;
  delete from public.one_em_setups where setup_id = s.setup_id;
  return jsonb_build_object('ok', true, 'deleted', true);
end $$;

/** Invite a trusted contact by e-mail (bound to that address: only the account with it can accept). */
create or replace function public.fale_em_invite(p_secret text, p_user uuid, p_setup uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.one_em_setups; e text := lower(trim(coalesce(p_email, ''))); sl smallint; c public.one_em_contacts; days integer;
begin
  perform private.fale_check(p_secret);
  if char_length(e) < 3 or char_length(e) > 254 or e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  perform private.fale_em_lock(p_setup);
  select * into s from public.one_em_setups where setup_id = p_setup and owner_id = p_user;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if e = private.fale_em_email(p_user) then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  days := coalesce(private.fale_one_cfg('em_invite_days'), 14)::integer;
  select * into c from public.one_em_contacts where setup_id = p_setup and email = e;
  if found then
    if c.status <> 'invited' then return jsonb_build_object('ok', false, 'reason', 'exists'); end if;
    update public.one_em_contacts set invite_expires_at = now() + make_interval(days => days), invited_at = now() where setup_id = p_setup and slot = c.slot;
    sl := c.slot;
  else
    if (select count(*) from public.one_em_contacts where setup_id = p_setup) >= coalesce(private.fale_one_cfg('em_max_contacts'), 3) then
      return jsonb_build_object('ok', false, 'reason', 'too_many');
    end if;
    select min(g)::smallint into sl from generate_series(1, 3) g where not exists (select 1 from public.one_em_contacts where setup_id = p_setup and slot = g);
    insert into public.one_em_contacts (setup_id, slot, email, invite_expires_at) values (p_setup, sl, e, now() + make_interval(days => days));
  end if;
  perform private.fale_em_log_add(p_setup, 'contact_invited', p_user, sl, null);
  perform private.fale_em_notify('invite', null, e, p_setup, jsonb_build_object('owner_email', private.fale_em_email(p_user)));
  return jsonb_build_object('ok', true, 'slot', sl) || private.fale_em_owner_json(s);
end $$;

/** Remove a contact (also after a release: the server access ends at once). */
create or replace function public.fale_em_contact_remove(p_secret text, p_user uuid, p_setup uuid, p_slot integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.one_em_setups; c public.one_em_contacts; r public.one_em_requests;
begin
  perform private.fale_check(p_secret);
  perform private.fale_em_lock(p_setup);
  select * into s from public.one_em_setups where setup_id = p_setup and owner_id = p_user;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into c from public.one_em_contacts where setup_id = p_setup and slot = p_slot;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into r from public.one_em_requests where setup_id = p_setup and status in ('waiting', 'released');
  if found and c.contact_id is not null then
    delete from public.one_em_requesters where request_id = r.request_id and contact_id = c.contact_id;
    delete from public.one_em_pool where request_id = r.request_id and (from_slot = c.slot or to_slot = c.slot);
    if not exists (select 1 from public.one_em_requesters where request_id = r.request_id) then
      update public.one_em_requests set status = 'canceled', closed_at = now() where request_id = r.request_id;
    end if;
  end if;
  delete from public.one_em_contacts where setup_id = p_setup and slot = p_slot;
  perform private.fale_em_log_add(p_setup, 'contact_removed', p_user, c.slot, null);
  if c.contact_id is not null then perform private.fale_em_notify('removed', c.contact_id, null, null, jsonb_build_object('owner_email', private.fale_em_email(p_user))); end if;
  return jsonb_build_object('ok', true) || private.fale_em_owner_json(s);
end $$;

/**
 * Owner: (re)seal the packages of the active contacts after comparing the safety code.
 * p_packages: [{slot, kid, package}] – must list EVERY contact that is or becomes active (a new Shamir split
 * replaces all shares at once); each kid must equal the key id the contact accepted with.
 */
create or replace function public.fale_em_seal(p_secret text, p_user uuid, p_setup uuid, p_base_version bigint, p_threshold integer, p_packages jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.one_em_setups; p jsonb; c public.one_em_contacts; n integer; r public.one_em_requests; has_r boolean; slots smallint[] := '{}';
begin
  perform private.fale_check(p_secret);
  if p_packages is null or jsonb_typeof(p_packages) <> 'array' or jsonb_array_length(p_packages) not between 1 and 3 or p_threshold is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  perform private.fale_em_lock(p_setup);
  perform private.fale_em_settle(p_setup);
  select * into s from public.one_em_setups where setup_id = p_setup and owner_id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if s.version <> p_base_version then return jsonb_build_object('ok', false, 'reason', 'conflict', 'version', s.version); end if;
  n := jsonb_array_length(p_packages);
  -- k may exceed the number of sealed contacts (2 of 3 with only one confirmed so far): requests stay impossible
  -- until enough contacts are active (fale_em_request → not_ready)
  if p_threshold < 1 or p_threshold > 3 then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  select * into r from public.one_em_requests where setup_id = p_setup and status in ('waiting', 'released');
  has_r := found;
  if has_r and r.status = 'released' then return jsonb_build_object('ok', false, 'reason', 'busy'); end if;
  for p in select * from jsonb_array_elements(p_packages) loop
    if jsonb_typeof(p) <> 'object' or coalesce(jsonb_typeof(p -> 'slot'), '') <> 'number' or not private.fale_one_b64(p ->> 'package', 40, 4000) then
      return jsonb_build_object('ok', false, 'reason', 'bad_input');
    end if;
    select * into c from public.one_em_contacts where setup_id = p_setup and slot = (p ->> 'slot')::smallint;
    if not found or c.status = 'invited' or c.contact_kid is distinct from (p ->> 'kid') then return jsonb_build_object('ok', false, 'reason', 'key_changed', 'slot', (p ->> 'slot')::integer); end if;
    if c.slot = any (slots) then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
    slots := slots || c.slot;
  end loop;
  if exists (select 1 from public.one_em_contacts where setup_id = p_setup and status = 'active' and not (slot = any (slots))) then
    return jsonb_build_object('ok', false, 'reason', 'incomplete');
  end if;
  if has_r and r.status = 'waiting' then -- a new key split invalidates a pending request
    update public.one_em_requests set status = 'canceled', closed_at = now() where request_id = r.request_id;
    perform private.fale_em_log_add(p_setup, 'request_canceled', p_user, null, null);
  end if;
  for p in select * from jsonb_array_elements(p_packages) loop
    select * into c from public.one_em_contacts where setup_id = p_setup and slot = (p ->> 'slot')::smallint;
    update public.one_em_contacts set package = p ->> 'package', status = 'active', confirmed_at = coalesce(confirmed_at, now())
     where setup_id = p_setup and slot = c.slot;
    if c.status = 'accepted' then
      perform private.fale_em_log_add(p_setup, 'contact_confirmed', p_user, c.slot, null);
      perform private.fale_em_notify('confirmed', c.contact_id, null, p_setup, jsonb_build_object('owner_email', private.fale_em_email(p_user)));
    end if;
  end loop;
  if p_threshold <> s.threshold then perform private.fale_em_log_add(p_setup, 'threshold_changed', p_user, null, jsonb_build_object('threshold', p_threshold)); end if;
  update public.one_em_setups set threshold = p_threshold, version = version + 1, updated_at = now() where setup_id = p_setup returning * into s;
  return jsonb_build_object('ok', true) || private.fale_em_owner_json(s);
end $$;

/** Owner: deny a waiting request (one tap). */
create or replace function public.fale_em_deny(p_secret text, p_user uuid, p_setup uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.one_em_setups; r public.one_em_requests; q record;
begin
  perform private.fale_check(p_secret);
  perform private.fale_em_lock(p_setup);
  perform private.fale_em_settle(p_setup);
  select * into s from public.one_em_setups where setup_id = p_setup and owner_id = p_user;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into r from public.one_em_requests where setup_id = p_setup and status in ('waiting', 'released');
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_request'); end if;
  if r.status = 'released' then return jsonb_build_object('ok', false, 'reason', 'released'); end if;
  update public.one_em_requests set status = 'denied', closed_at = now() where request_id = r.request_id;
  perform private.fale_em_log_add(p_setup, 'denied', p_user, null, jsonb_build_object('request', r.request_id));
  for q in select contact_id from public.one_em_requesters where request_id = r.request_id loop
    perform private.fale_em_notify('denied', q.contact_id, null, p_setup, jsonb_build_object('owner_email', private.fale_em_email(p_user)));
  end loop;
  return jsonb_build_object('ok', true) || private.fale_em_owner_json(s);
end $$;

/** Owner: withdraw a waiting or released access at any time (the server stops serving it at once). */
create or replace function public.fale_em_revoke(p_secret text, p_user uuid, p_setup uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.one_em_setups; r public.one_em_requests; q record;
begin
  perform private.fale_check(p_secret);
  perform private.fale_em_lock(p_setup);
  perform private.fale_em_settle(p_setup);
  select * into s from public.one_em_setups where setup_id = p_setup and owner_id = p_user;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into r from public.one_em_requests where setup_id = p_setup and status in ('waiting', 'released');
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_request'); end if;
  update public.one_em_requests set status = 'revoked', closed_at = now() where request_id = r.request_id;
  delete from public.one_em_pool where request_id = r.request_id;
  perform private.fale_em_log_add(p_setup, 'revoked', p_user, null, jsonb_build_object('request', r.request_id, 'was', r.status));
  for q in select contact_id from public.one_em_requesters where request_id = r.request_id loop
    perform private.fale_em_notify('revoked', q.contact_id, null, p_setup, jsonb_build_object('owner_email', private.fale_em_email(p_user)));
  end loop;
  return jsonb_build_object('ok', true) || private.fale_em_owner_json(s);
end $$;

create or replace function public.fale_em_log(p_secret text, p_user uuid, p_before bigint, p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.one_em_setups; arr jsonb;
begin
  perform private.fale_check(p_secret);
  select * into s from public.one_em_setups where owner_id = p_user;
  if not found then return jsonb_build_object('ok', true, 'log', '[]'::jsonb); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'at', l.at, 'event', l.event, 'slot', l.slot, 'detail', l.detail) order by l.id desc), '[]'::jsonb) into arr
    from (select * from public.one_em_log where setup_id = s.setup_id and (p_before is null or id < p_before) order by id desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) l;
  return jsonb_build_object('ok', true, 'log', arr);
end $$;

-- ------------------------------------------------------------------ owner: covered keys (kept in sync by the owner's devices)
/** Count + SHA-256 over the sorted "kind:id" lines – a cheap "nothing to do" check for the devices. */
create or replace function public.fale_em_keys_digest(p_secret text, p_user uuid, p_setup uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n bigint; d text;
begin
  perform private.fale_check(p_secret);
  if not exists (select 1 from public.one_em_setups where setup_id = p_setup and owner_id = p_user) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select count(*), encode(extensions.digest(coalesce(string_agg(l || E'\n', '' order by l collate "C"), ''), 'sha256'), 'hex') into n, d
    from (select 'album:' || album_id::text l from public.one_em_album_keys where setup_id = p_setup
          union all select 'node:' || node_id::text from public.one_em_node_keys where setup_id = p_setup) z;
  return jsonb_build_object('ok', true, 'count', n, 'digest', d);
end $$;

create or replace function public.fale_em_keys_list(p_secret text, p_user uuid, p_setup uuid, p_after text, p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare arr jsonb; lim integer := least(greatest(coalesce(p_limit, 5000), 1), 10000); mx text;
begin
  perform private.fale_check(p_secret);
  if not exists (select 1 from public.one_em_setups where setup_id = p_setup and owner_id = p_user) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select coalesce(jsonb_agg(l order by l collate "C"), '[]'::jsonb), max(l collate "C") into arr, mx from (
    select l from (select 'album:' || album_id::text l from public.one_em_album_keys where setup_id = p_setup
                   union all select 'node:' || node_id::text from public.one_em_node_keys where setup_id = p_setup) z
     where p_after is null or l collate "C" > p_after collate "C" order by l collate "C" limit lim) t;
  return jsonb_build_object('ok', true, 'items', arr, 'next', case when jsonb_array_length(arr) = lim then mx end);
end $$;

/** Add / replace wrapped keys (≤ 500). Only the owner's live nodes / albums; others are skipped (count in 'skipped'). */
create or replace function public.fale_em_keys_put(p_secret text, p_user uuid, p_setup uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare it jsonb; k text; id uuid; added integer := 0; skipped integer := 0; maxk bigint;
begin
  perform private.fale_check(p_secret);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 500 then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  perform private.fale_em_lock(p_setup);
  if not exists (select 1 from public.one_em_setups where setup_id = p_setup and owner_id = p_user) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  maxk := coalesce(private.fale_one_cfg('em_max_keys'), 200000);
  if (select count(*) from public.one_em_node_keys where setup_id = p_setup) + (select count(*) from public.one_em_album_keys where setup_id = p_setup)
     + jsonb_array_length(p_items) > maxk then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    k := it ->> 'key';
    if jsonb_typeof(it) <> 'object' or coalesce(it ->> 'kind', '') not in ('node', 'album') or coalesce(it ->> 'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or k is null or k !~ '^[A-Za-z0-9_-]{40,200}$' then
      return jsonb_build_object('ok', false, 'reason', 'bad_input');
    end if;
    id := (it ->> 'id')::uuid;
    if it ->> 'kind' = 'node' then
      if not exists (select 1 from public.one_nodes where user_id = p_user and node_id = id and not deleted) then skipped := skipped + 1; continue; end if;
      insert into public.one_em_node_keys (setup_id, owner_id, node_id, key) values (p_setup, p_user, id, k)
      on conflict (setup_id, node_id) do update set key = excluded.key;
    else
      if not exists (select 1 from public.one_albums where user_id = p_user and album_id = id and not deleted) then skipped := skipped + 1; continue; end if;
      insert into public.one_em_album_keys (setup_id, owner_id, album_id, key) values (p_setup, p_user, id, k)
      on conflict (setup_id, album_id) do update set key = excluded.key;
    end if;
    added := added + 1;
  end loop;
  return jsonb_build_object('ok', true, 'added', added, 'skipped', skipped);
end $$;

create or replace function public.fale_em_keys_del(p_secret text, p_user uuid, p_setup uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare it jsonb; n integer := 0; x integer;
begin
  perform private.fale_check(p_secret);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 2000 then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  perform private.fale_em_lock(p_setup);
  if not exists (select 1 from public.one_em_setups where setup_id = p_setup and owner_id = p_user) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(it) <> 'object' or coalesce(it ->> 'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
    if it ->> 'kind' = 'album' then delete from public.one_em_album_keys where setup_id = p_setup and album_id = (it ->> 'id')::uuid;
    else delete from public.one_em_node_keys where setup_id = p_setup and node_id = (it ->> 'id')::uuid; end if;
    get diagnostics x = row_count; n := n + x;
  end loop;
  return jsonb_build_object('ok', true, 'removed', n);
end $$;

-- ------------------------------------------------------------------ contact side
/** Accept an invitation addressed to the e-mail address of this account. Needs the identity key (fam_keys). */
create or replace function public.fale_em_accept(p_secret text, p_user uuid, p_setup uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare mail text := private.fale_em_email(p_user); c public.one_em_contacts; k record; s public.one_em_setups;
begin
  perform private.fale_check(p_secret);
  if mail is null then return jsonb_build_object('ok', false, 'reason', 'no_user'); end if;
  perform private.fale_em_lock(p_setup);
  select * into s from public.one_em_setups where setup_id = p_setup;
  if not found or s.owner_id = p_user then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into c from public.one_em_contacts where setup_id = p_setup and (contact_id = p_user or (email = mail and status = 'invited'));
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if c.status <> 'invited' then return jsonb_build_object('ok', true, 'slot', c.slot, 'status', c.status, 'kid', c.contact_kid); end if; -- idempotent
  if c.invite_expires_at < now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  select key_id, public_jwk into k from public.fam_keys where user_id = p_user;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_key'); end if;
  update public.one_em_contacts set contact_id = p_user, status = 'accepted', contact_kid = k.key_id, contact_pub = k.public_jwk, accepted_at = now()
   where setup_id = p_setup and slot = c.slot;
  perform private.fale_em_log_add(p_setup, 'contact_accepted', p_user, c.slot, null);
  perform private.fale_em_notify('accepted', s.owner_id, null, p_setup, jsonb_build_object('contact_email', mail));
  return jsonb_build_object('ok', true, 'slot', c.slot, 'status', 'accepted', 'kid', k.key_id);
end $$;

/** Decline an invitation or step down as a contact. */
create or replace function public.fale_em_leave(p_secret text, p_user uuid, p_setup uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare mail text := private.fale_em_email(p_user); c public.one_em_contacts; s public.one_em_setups; r public.one_em_requests;
begin
  perform private.fale_check(p_secret);
  perform private.fale_em_lock(p_setup);
  select * into s from public.one_em_setups where setup_id = p_setup;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into c from public.one_em_contacts where setup_id = p_setup and (contact_id = p_user or (mail is not null and email = mail and status = 'invited'));
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into r from public.one_em_requests where setup_id = p_setup and status in ('waiting', 'released');
  if found then
    delete from public.one_em_requesters where request_id = r.request_id and contact_id = p_user;
    delete from public.one_em_pool where request_id = r.request_id and (from_slot = c.slot or to_slot = c.slot);
    if not exists (select 1 from public.one_em_requesters where request_id = r.request_id) then
      update public.one_em_requests set status = 'canceled', closed_at = now() where request_id = r.request_id;
    end if;
  end if;
  delete from public.one_em_contacts where setup_id = p_setup and slot = c.slot;
  perform private.fale_em_log_add(p_setup, case when c.status = 'invited' then 'contact_declined' else 'contact_left' end, p_user, c.slot, null);
  perform private.fale_em_notify('left', s.owner_id, null, p_setup, jsonb_build_object('contact_email', c.email));
  return jsonb_build_object('ok', true);
end $$;

/** Contact: ask for access (or join an open request). The waiting period starts when enough contacts asked. */
create or replace function public.fale_em_request(p_secret text, p_user uuid, p_setup uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.one_em_setups; c public.one_em_contacts; r public.one_em_requests; lc jsonb; n integer; joined boolean := false;
begin
  perform private.fale_check(p_secret);
  perform private.fale_em_lock(p_setup);
  perform private.fale_em_settle(p_setup);
  select * into s from public.one_em_setups where setup_id = p_setup;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into c from public.one_em_contacts where setup_id = p_setup and contact_id = p_user and status = 'active';
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if (select count(*) from public.one_em_contacts where setup_id = p_setup and status = 'active') < s.threshold then
    return jsonb_build_object('ok', false, 'reason', 'not_ready');
  end if;
  select * into r from public.one_em_requests where setup_id = p_setup and status in ('waiting', 'released') for update;
  if not found then
    lc := private.fale_em_last_closed(p_setup);
    if lc ->> 'retry_at' is not null and (lc ->> 'retry_at')::timestamptz > now() then
      return jsonb_build_object('ok', false, 'reason', 'cooldown', 'retry_at', lc ->> 'retry_at');
    end if;
    insert into public.one_em_requests (setup_id, wait_hours, threshold) values (p_setup, s.wait_hours, s.threshold) returning * into r;
  end if;
  if not exists (select 1 from public.one_em_requesters where request_id = r.request_id and contact_id = p_user) then
    insert into public.one_em_requesters (request_id, contact_id, slot) values (r.request_id, p_user, c.slot);
    joined := true;
    select count(*) into n from public.one_em_requesters where request_id = r.request_id;
    if r.status = 'waiting' and r.threshold_at is null and n >= r.threshold then
      update public.one_em_requests set threshold_at = now(), release_at = now() + make_interval(hours => r.wait_hours) where request_id = r.request_id returning * into r;
    end if;
    perform private.fale_em_log_add(p_setup, case when r.status = 'released' then 'joined_released' when n = 1 then 'request' else 'request_joined' end, p_user, c.slot,
      jsonb_build_object('request', r.request_id, 'release_at', r.release_at, 'count', n));
    perform private.fale_em_notify('request', s.owner_id, null, p_setup, jsonb_build_object('contact_email', c.email, 'release_at', r.release_at, 'count', n, 'threshold', r.threshold));
  end if;
  return jsonb_build_object('ok', true, 'joined', joined, 'request', private.fale_em_request_json(p_setup));
end $$;

/** Contact (released requester): own sealed package, the other requesters' keys and the shares pooled for me. */
create or replace function public.fale_em_package(p_secret text, p_user uuid, p_setup uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare owner_ uuid; c public.one_em_contacts; r public.one_em_requests;
begin
  perform private.fale_check(p_secret);
  perform private.fale_em_lock(p_setup);
  perform private.fale_em_settle(p_setup);
  owner_ := private.fale_em_reader(p_setup, p_user);
  if owner_ is null then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;
  select * into c from public.one_em_contacts where setup_id = p_setup and contact_id = p_user;
  select * into r from public.one_em_requests where setup_id = p_setup and status = 'released';
  perform private.fale_em_log_add(p_setup, 'key_fetched', p_user, c.slot, null);
  return jsonb_build_object('ok', true, 'owner_id', owner_, 'slot', c.slot, 'package', c.package,
    'requesters', coalesce((select jsonb_agg(jsonb_build_object('slot', q.slot, 'contact_id', q.contact_id, 'kid', cc.contact_kid, 'pub', cc.contact_pub) order by q.slot)
      from public.one_em_requesters q join public.one_em_contacts cc on cc.setup_id = p_setup and cc.contact_id = q.contact_id and cc.status = 'active'
      where q.request_id = r.request_id), '[]'::jsonb),
    'pool', coalesce((select jsonb_agg(jsonb_build_object('from', p.from_slot, 'sealed', p.sealed) order by p.from_slot) from public.one_em_pool p
      where p.request_id = r.request_id and p.to_slot = c.slot), '[]'::jsonb));
end $$;

/** Contact (released requester): re-seal my share for the other requesters (k of n). p_items: [{to, sealed}] */
create or replace function public.fale_em_pool_put(p_secret text, p_user uuid, p_setup uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.one_em_requests; me smallint; it jsonb; n integer := 0;
begin
  perform private.fale_check(p_secret);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 3 then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  perform private.fale_em_lock(p_setup);
  perform private.fale_em_settle(p_setup);
  if private.fale_em_reader(p_setup, p_user) is null then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;
  me := private.fale_em_slot(p_setup, p_user);
  select * into r from public.one_em_requests where setup_id = p_setup and status = 'released';
  for it in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(it) <> 'object' or coalesce(jsonb_typeof(it -> 'to'), '') <> 'number' or not private.fale_one_b64(it ->> 'sealed', 40, 4000) then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
    if (it ->> 'to')::smallint = me or not exists (select 1 from public.one_em_requesters where request_id = r.request_id and slot = (it ->> 'to')::smallint) then continue; end if;
    insert into public.one_em_pool (request_id, from_slot, to_slot, sealed) values (r.request_id, me, (it ->> 'to')::smallint, it ->> 'sealed')
    on conflict (request_id, from_slot, to_slot) do update set sealed = excluded.sealed, created_at = now();
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'stored', n);
end $$;

/** Contact (released requester): the covered items – owner's node records (without the KEK-wrapped key) + key wrapped by EK. */
create or replace function public.fale_em_items(p_secret text, p_user uuid, p_setup uuid, p_after uuid, p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare owner_ uuid; lim integer := least(greatest(coalesce(p_limit, 500), 1), 1000); arr jsonb; last_ uuid; cnt integer; albums jsonb := null; s public.one_em_setups;
begin
  perform private.fale_check(p_secret);
  perform private.fale_em_lock(p_setup);
  perform private.fale_em_settle(p_setup);
  owner_ := private.fale_em_reader(p_setup, p_user);
  if owner_ is null then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;
  select * into s from public.one_em_setups where setup_id = p_setup;
  -- page over the KEY rows (so trashed items on a page boundary never stop the paging early)
  select count(*), max(node_id::text)::uuid into cnt, last_
    from (select node_id from public.one_em_node_keys where setup_id = p_setup and (p_after is null or node_id > p_after) order by node_id limit lim) k0;
  select coalesce(jsonb_agg((private.fale_one_node_json(n) - 'key') || jsonb_build_object('em_key', k.key) order by n.node_id), '[]'::jsonb) into arr
    from (select * from public.one_em_node_keys where setup_id = p_setup and (p_after is null or node_id > p_after) order by node_id limit lim) k
    join public.one_nodes n on n.user_id = owner_ and n.node_id = k.node_id and not n.deleted and n.trashed_at is null;
  if p_after is null then
    select coalesce(jsonb_agg((private.fale_one_album_json(a) - 'key') || jsonb_build_object('em_key', k.key, 'items',
             coalesce((select jsonb_agg(i.node_id order by i.added_at) from public.one_album_items i
                        join public.one_em_node_keys nk on nk.setup_id = p_setup and nk.node_id = i.node_id
                       where i.user_id = owner_ and i.album_id = a.album_id and not i.removed), '[]'::jsonb))), '[]'::jsonb) into albums
      from public.one_em_album_keys k join public.one_albums a on a.user_id = owner_ and a.album_id = k.album_id and not a.deleted
     where k.setup_id = p_setup;
    if not exists (select 1 from public.one_em_log where setup_id = p_setup and event = 'viewed' and actor = p_user and at > now() - interval '1 hour') then
      perform private.fale_em_log_add(p_setup, 'viewed', p_user, private.fale_em_slot(p_setup, p_user), null);
    end if;
  end if;
  return jsonb_build_object('ok', true, 'owner_id', owner_, 'scope', s.scope, 'nodes', arr, 'albums', albums,
    'next', case when cnt = lim then last_ end);
end $$;

/** Is p_blob a blob of the CURRENT version of a covered, live node? → owner id + blob, else null. */
create or replace function private.fale_em_blob(p_setup uuid, p_user uuid, p_blob uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare owner_ uuid; b record;
begin
  owner_ := private.fale_em_reader(p_setup, p_user);
  if owner_ is null then return null; end if;
  select bl.blob_id, bl.purpose, bl.backend, bl.size, bl.chunks, bl.chunk_size, n.node_id into b
    from public.one_blobs bl
    join public.one_nodes n on n.user_id = bl.user_id and n.head_rev = bl.rev_id and not n.deleted and n.trashed_at is null
    join public.one_em_node_keys k on k.setup_id = p_setup and k.node_id = n.node_id
   where bl.user_id = owner_ and bl.blob_id = p_blob and bl.status = 'live';
  if not found then return null; end if;
  return jsonb_build_object('owner', owner_, 'id', b.blob_id, 'purpose', b.purpose, 'backend', b.backend, 'size', b.size, 'chunks', b.chunks, 'chunk_size', b.chunk_size, 'node', b.node_id);
end $$;
revoke all on function private.fale_em_blob(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function private.fale_em_log_download(p_setup uuid, p_user uuid, p_node uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.one_em_log where setup_id = p_setup and event = 'download' and actor = p_user and detail ->> 'node' = p_node::text and at > now() - interval '1 hour') then
    perform private.fale_em_log_add(p_setup, 'download', p_user, private.fale_em_slot(p_setup, p_user), jsonb_build_object('node', p_node));
  end if;
end $$;
revoke all on function private.fale_em_log_download(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.fale_em_blob_info(p_secret text, p_user uuid, p_setup uuid, p_blob uuid, p_log boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b jsonb;
begin
  perform private.fale_check(p_secret);
  perform private.fale_em_lock(p_setup);
  perform private.fale_em_settle(p_setup);
  b := private.fale_em_blob(p_setup, p_user, p_blob);
  if b is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if coalesce(p_log, false) and b ->> 'purpose' = 'content' then perform private.fale_em_log_download(p_setup, p_user, (b ->> 'node')::uuid); end if;
  return jsonb_build_object('ok', true, 'blob', b);
end $$;

create or replace function public.fale_em_chunk_get(p_secret text, p_user uuid, p_setup uuid, p_blob uuid, p_idx integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b jsonb; d bytea;
begin
  perform private.fale_check(p_secret);
  perform private.fale_em_settle(p_setup);
  b := private.fale_em_blob(p_setup, p_user, p_blob);
  if b is null or b ->> 'backend' <> 'pg' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select c.data into d from public.one_chunks c where c.user_id = (b ->> 'owner')::uuid and c.blob_id = p_blob and c.idx = p_idx;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_idx = 0 and b ->> 'purpose' = 'content' then perform private.fale_em_log_download(p_setup, p_user, (b ->> 'node')::uuid); end if;
  return jsonb_build_object('ok', true, 'data', translate(encode(d, 'base64'), E'\n', ''));
end $$;

create or replace function public.fale_em_thumbs(p_secret text, p_user uuid, p_setup uuid, p_blobs uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare owner_ uuid; arr jsonb;
begin
  perform private.fale_check(p_secret);
  if p_blobs is null or coalesce(array_length(p_blobs, 1), 0) > 100 then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  perform private.fale_em_settle(p_setup);
  owner_ := private.fale_em_reader(p_setup, p_user);
  if owner_ is null then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;
  select coalesce(jsonb_object_agg(b.blob_id::text, translate(encode(c.data, 'base64'), E'\n', '')), '{}'::jsonb) into arr
    from public.one_blobs b
    join public.one_chunks c on c.user_id = b.user_id and c.blob_id = b.blob_id and c.idx = 0
    join public.one_nodes n on n.user_id = b.user_id and n.head_rev = b.rev_id and not n.deleted and n.trashed_at is null
    join public.one_em_node_keys k on k.setup_id = p_setup and k.node_id = n.node_id
   where b.user_id = owner_ and b.blob_id = any (p_blobs) and b.status = 'live' and b.purpose = 'thumb' and b.backend = 'pg' and b.chunks = 1;
  return jsonb_build_object('ok', true, 'thumbs', arr);
end $$;

-- ------------------------------------------------------------------ export, notifications
/** Everything about the owner's Notfallzugang for "export everything" (no packages: they are useless to the owner). */
create or replace function public.fale_em_export(p_secret text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.one_em_setups; j jsonb;
begin
  perform private.fale_check(p_secret);
  select * into s from public.one_em_setups where owner_id = p_user;
  if not found then return jsonb_build_object('ok', true, 'emergency', null); end if;
  j := private.fale_em_owner_json(s);
  j := jsonb_set(j, '{log}', coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'event', l.event, 'slot', l.slot, 'detail', l.detail) order by l.id)
    from public.one_em_log l where l.setup_id = s.setup_id), '[]'::jsonb));
  j := jsonb_set(j, '{contacts}', coalesce((select jsonb_agg(x - 'pub') from jsonb_array_elements(j -> 'contacts') x), '[]'::jsonb));
  return jsonb_build_object('ok', true, 'emergency', j || jsonb_build_object('covered', jsonb_build_object(
    'nodes', (select coalesce(jsonb_agg(node_id order by node_id), '[]'::jsonb) from public.one_em_node_keys where setup_id = s.setup_id),
    'albums', (select coalesce(jsonb_agg(album_id order by album_id), '[]'::jsonb) from public.one_em_album_keys where setup_id = s.setup_id))));
end $$;

create or replace function public.fale_em_outbox_take(p_secret text, p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare arr jsonb;
begin
  perform private.fale_check(p_secret);
  with t as (
    select id from private.fale_em_outbox where sent_at is null and attempts < 5 order by id limit least(greatest(coalesce(p_limit, 20), 1), 100) for update skip locked
  ), u as (
    update private.fale_em_outbox o set attempts = o.attempts + 1 from t where o.id = t.id returning o.id, o.kind, o.to_user, o.to_email, o.data
  ) select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'kind', u.kind, 'to', coalesce(u.to_email, private.fale_em_email(u.to_user)), 'data', u.data) order by u.id), '[]'::jsonb) into arr from u;
  return jsonb_build_object('ok', true, 'items', arr);
end $$;

create or replace function public.fale_em_outbox_done(p_secret text, p_ids bigint[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform private.fale_check(p_secret);
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) > 100 then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  update private.fale_em_outbox set sent_at = now() where id = any (p_ids);
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'done', n);
end $$;

-- ------------------------------------------------------------------ account deletion hook (+ Notfallzugang)
-- Same as 20261015220000_fale_one_drive.sql plus the emergency rows where the account is owner or contact.
create or replace function public.fale_account_delete(p_secret text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare left_ integer; gone boolean := false; q record;
begin
  perform private.fale_check(p_secret);
  if p_user is null then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  perform private.fale_lock(p_user);
  perform private.fale_one_lock(p_user);
  -- Notfallzugang: as owner (everything) and as contact (own contact rows, requests, pooled shares)
  delete from public.one_em_setups where owner_id = p_user;
  for q in select c.setup_id, c.slot from public.one_em_contacts c where c.contact_id = p_user loop
    perform private.fale_em_lock(q.setup_id);
    delete from public.one_em_pool p using public.one_em_requests r where r.request_id = p.request_id and r.setup_id = q.setup_id and (p.from_slot = q.slot or p.to_slot = q.slot);
    perform private.fale_em_log_add(q.setup_id, 'contact_deleted', null, q.slot, null);
  end loop;
  delete from public.one_em_requesters where contact_id = p_user;
  delete from public.one_em_contacts where contact_id = p_user;
  delete from private.fale_em_outbox where to_user = p_user;
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
    'public.fale_em_identity_get(text, uuid)',
    'public.fale_em_identity_put(text, uuid, text, jsonb, text, text)',
    'public.fale_em_status(text, uuid)',
    'public.fale_em_setup_put(text, uuid, uuid, bigint, integer, text, text, text, integer)',
    'public.fale_em_setup_delete(text, uuid)',
    'public.fale_em_invite(text, uuid, uuid, text)',
    'public.fale_em_contact_remove(text, uuid, uuid, integer)',
    'public.fale_em_seal(text, uuid, uuid, bigint, integer, jsonb)',
    'public.fale_em_deny(text, uuid, uuid)',
    'public.fale_em_revoke(text, uuid, uuid)',
    'public.fale_em_log(text, uuid, bigint, integer)',
    'public.fale_em_keys_digest(text, uuid, uuid)',
    'public.fale_em_keys_list(text, uuid, uuid, text, integer)',
    'public.fale_em_keys_put(text, uuid, uuid, jsonb)',
    'public.fale_em_keys_del(text, uuid, uuid, jsonb)',
    'public.fale_em_accept(text, uuid, uuid)',
    'public.fale_em_leave(text, uuid, uuid)',
    'public.fale_em_request(text, uuid, uuid)',
    'public.fale_em_package(text, uuid, uuid)',
    'public.fale_em_pool_put(text, uuid, uuid, jsonb)',
    'public.fale_em_items(text, uuid, uuid, uuid, integer)',
    'public.fale_em_blob_info(text, uuid, uuid, uuid, boolean)',
    'public.fale_em_chunk_get(text, uuid, uuid, uuid, integer)',
    'public.fale_em_thumbs(text, uuid, uuid, uuid[])',
    'public.fale_em_export(text, uuid)',
    'public.fale_em_outbox_take(text, integer)',
    'public.fale_em_outbox_done(text, bigint[])',
    'public.fale_account_delete(text, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to anon, service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
