-- FaLe PDF: security hardening (audit 2026-10, see docs/SECURITY-AUDIT-2026-10.md). Idempotent – safe to re-run.
--
--   1. Supabase "anonymous sign-ins" produce JWTs with role = authenticated and is_anonymous = true.
--      They must never reach FaLe Sync (free storage for throw-away identities) or read account rows:
--      private.fale_uid() and every RLS policy below reject them (defense in depth – the API already does).
--   2. Least privilege: no table / sequence / function in the private schema, no identity sequence of
--      the share tables is usable by anon/authenticated; EXECUTE on secret-gated RPCs only for anon
--      (the publishable key used by the Vercel API) and service_role – re-asserted here in one place.
--   3. Input validation inside RPCs: fale_share_put refuses oversized base64 before decoding it;
--      fale_rate validates its key/kind format.
-- Nothing here changes data.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ------------------------------------------------------------------ 1. anonymous identities
create or replace function private.fale_uid() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare u uuid;
begin
  u := auth.uid();
  if u is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  return u;
end $$;
revoke all on function private.fale_uid() from public, anon, authenticated;
-- the family folder (20261014200000_fale_family.sql) has its own uid helper – same rule
do $$
begin
  if to_regprocedure('private.fam_uid()') is null then return; end if;
  execute $f$
    create or replace function private.fam_uid() returns uuid
    language plpgsql stable security definer set search_path = '' as $b$
    declare u uuid;
    begin
      u := auth.uid();
      if u is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
        raise exception 'not_authenticated' using errcode = '28000';
      end if;
      return u;
    end $b$ $f$;
  revoke all on function private.fam_uid() from public, anon, authenticated;
end $$;

do $$
declare t text;
begin
  foreach t in array array['devices', 'plus_accounts', 'sync_keys', 'sync_items', 'sync_blobs'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', 'fale_own_select', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) is not null and user_id = (select auth.uid()) and not coalesce(((select auth.jwt()) ->> %L)::boolean, false))', 'fale_own_select', t, 'is_anonymous');
  end loop;
end $$;

do $$
begin
  if to_regclass('storage.objects') is null then return; end if;
  drop policy if exists fale_sync_select on storage.objects;
  drop policy if exists fale_sync_insert on storage.objects;
  drop policy if exists fale_sync_delete on storage.objects;
  create policy fale_sync_select on storage.objects for select to authenticated using (
    bucket_id = 'sync' and (select auth.uid()) is not null
    and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false)
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
  -- Upload only into a reserved, still pending chunk slot <uid>/<blob id>/<n> with n < chunks.
  create policy fale_sync_insert on storage.objects for insert to authenticated with check (
    bucket_id = 'sync'
    and (select auth.uid()) is not null
    and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false)
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and array_length(storage.foldername(name), 1) = 2
    and storage.filename(name) ~ '^(0|[1-9][0-9]{0,6})$'
    and exists (
      select 1 from public.sync_blobs b
      where b.user_id = (select auth.uid())
        and b.blob_id = (storage.foldername(name))[2]
        and b.status = 'pending'
        and b.chunks > (case when storage.filename(name) ~ '^(0|[1-9][0-9]{0,6})$' then storage.filename(name)::integer else 2147483647 end)
    )
  );
  create policy fale_sync_delete on storage.objects for delete to authenticated using (
    bucket_id = 'sync' and (select auth.uid()) is not null
    and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false)
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
  -- (still no UPDATE policy: chunks are write-once)
end $$;

-- ------------------------------------------------------------------ 2. least privilege
-- every function in the private schema: owner only
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
alter default privileges in schema private revoke execute on functions from public;
do $$
declare t record;
begin
  for t in select c.oid::regclass as rel, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'private' and c.relkind in ('r', 'S', 'v', 'm') loop
    execute format('revoke all on %s from public, anon, authenticated', t.rel);
  end loop;
end $$;

-- identity sequence of transfer_msgs (Supabase default privileges grant sequences to anon/authenticated)
do $$
declare s text;
begin
  if to_regclass('public.transfer_msgs') is not null then
    s := pg_get_serial_sequence('public.transfer_msgs', 'seq');
    if s is not null then execute format('revoke all on sequence %s from public, anon, authenticated', s); end if;
  end if;
end $$;

-- server-side tables: RLS on, no table privileges for API roles (re-asserted)
do $$
declare t text;
begin
  foreach t in array array['ai_usage', 'ai_ip', 'ai_budget', 'ai_rewards', 'plus_entitlements', 'share_objects', 'share_chunks',
                            'sign_requests', 'sign_signers', 'transfer_rooms', 'transfer_msgs', 'share_usage'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
  -- account tables: the owner may only SELECT (own rows via RLS); writes go through SECURITY DEFINER RPCs
  foreach t in array array['devices', 'plus_accounts', 'sync_keys', 'sync_items', 'sync_blobs'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ------------------------------------------------------------------ 3. input validation inside RPCs
create or replace function public.fale_share_put(p_secret text, p_id text, p_owner text, p_idx integer, p_data text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.share_objects; d bytea;
begin
  perform private.fale_check(p_secret);
  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{16,32}$' or p_owner is null or p_owner !~ '^[0-9a-f]{64}$' or p_idx is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  -- base64 of at most one chunk (≤ 4 MiB ciphertext) – refuse anything bigger before decoding it
  if p_data is null or length(p_data) > 5600000 then return jsonb_build_object('ok', false, 'reason', 'bad_size'); end if;
  select * into o from public.share_objects where id = p_id;
  if not found or o.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if o.owner_hash <> p_owner then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if o.complete then return jsonb_build_object('ok', false, 'reason', 'complete'); end if;
  if p_idx < 0 or p_idx >= o.chunk_count then return jsonb_build_object('ok', false, 'reason', 'bad_index'); end if;
  begin
    d := decode(p_data, 'base64');
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'bad_size');
  end;
  if octet_length(d) < 1 or octet_length(d) > o.chunk_size
     or (p_idx < o.chunk_count - 1 and octet_length(d) <> o.chunk_size) then
    return jsonb_build_object('ok', false, 'reason', 'bad_size');
  end if;
  insert into public.share_chunks (object_id, idx, data) values (p_id, p_idx, d)
  on conflict (object_id, idx) do update set data = excluded.data;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.fale_rate(p_secret text, p_day date, p_kind text, p_keys text[], p_n_limits integer[],
  p_bytes bigint, p_b_limits bigint[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i integer; rn integer; rb bigint;
begin
  perform private.fale_check(p_secret);
  if p_day is null or p_kind is null or p_kind !~ '^[a-z_]{2,16}$'
     or p_keys is null or array_length(p_keys, 1) is null or array_length(p_keys, 1) > 4
     or array_length(p_n_limits, 1) <> array_length(p_keys, 1) or array_length(p_b_limits, 1) <> array_length(p_keys, 1)
     or coalesce(p_bytes, -1) < 0 then
    raise exception 'bad input';
  end if;
  for i in 1 .. array_length(p_keys, 1) loop
    if p_keys[i] is null or char_length(p_keys[i]) not between 8 and 80 or p_n_limits[i] is null or p_b_limits[i] is null then
      raise exception 'bad input';
    end if;
  end loop;
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

-- EXECUTE grants: secret-gated RPCs → anon (publishable key of the API) + service_role only;
-- signed-in RPCs → authenticated only. Never PUBLIC.
do $$
declare f text;
begin
  foreach f in array array[
    'public.fale_register_ip(text, text, date, integer)',
    'public.fale_quota_consume(text, text, text, date, integer, integer, boolean, integer, integer)',
    'public.fale_quota_refund(text, text, text, date, boolean)',
    'public.fale_quota_status(text, text, date)',
    'public.fale_budget_reserve(text, text, numeric, numeric)',
    'public.fale_budget_settle(text, text, numeric, numeric)',
    'public.fale_budget_status(text, text)',
    'public.fale_reward_record(text, text, text, date, integer)',
    'public.fale_plus_get(text, text)',
    'public.fale_plus_upsert(text, text, text, text, timestamptz)',
    'public.fale_purge(text)',
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
    'public.fale_share_purge(text)',
    'public.fale_account_plus_get(text, uuid)',
    'public.fale_account_plus_upsert(text, uuid, text, text, timestamptz)',
    'public.fale_account_plus_link(text, uuid, text)',
    'public.fale_account_delete(text, uuid)',
    'public.fale_account_deleted(text, uuid)'
  ] loop
    if to_regprocedure(f) is null then continue; end if;
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to anon, service_role', f);
  end loop;
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
    if to_regprocedure(f) is null then continue; end if;
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
