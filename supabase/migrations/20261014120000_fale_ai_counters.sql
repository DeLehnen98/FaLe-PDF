-- FaLe PDF cloud AI: counters only (no document content, no raw IPs, no device ids).
-- Tables have RLS enabled and NO policies; anon/authenticated have no table privileges.
-- The Vercel functions call the SECURITY DEFINER RPCs below with the publishable key AND a
-- server secret (FALE_RPC_SECRET) whose SHA-256 is stored in private.fale_secrets – so the
-- publishable key alone cannot use them.
-- Retention (30 days) and the Plus upsert live in 20261014120100_fale_ai_retention.sql (they contain DELETE
-- statements and therefore need an explicit approval when applied).

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.fale_secrets (
  name text primary key,
  secret_sha256 text not null check (secret_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
alter table private.fale_secrets enable row level security;
revoke all on private.fale_secrets from public, anon, authenticated;

create table if not exists public.ai_usage (
  day date not null,
  device_hash text not null check (char_length(device_hash) between 16 and 64),
  used integer not null default 0 check (used >= 0),
  rewarded integer not null default 0 check (rewarded >= 0),
  primary key (day, device_hash)
);
create table if not exists public.ai_ip (
  day date not null,
  ip_hash text not null check (char_length(ip_hash) between 16 and 64),
  used integer not null default 0 check (used >= 0),
  registered integer not null default 0 check (registered >= 0),
  primary key (day, ip_hash)
);
create table if not exists public.ai_budget (
  month text primary key check (month ~ '^\d{4}-\d{2}$'),
  reserved_usd numeric(14,6) not null default 0 check (reserved_usd >= 0),
  spent_usd numeric(14,6) not null default 0 check (spent_usd >= 0),
  updated_at timestamptz not null default now()
);
create table if not exists public.ai_rewards (
  transaction_id text primary key,
  device_hash text not null,
  day date not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_rewards_created_at_idx on public.ai_rewards (created_at);
create table if not exists public.plus_entitlements (
  device_hash text primary key,
  purchase_token_hash text not null unique,
  product text not null,
  expires_at timestamptz not null,
  verified_at timestamptz not null default now()
);

alter table public.ai_usage enable row level security;
alter table public.ai_ip enable row level security;
alter table public.ai_budget enable row level security;
alter table public.ai_rewards enable row level security;
alter table public.plus_entitlements enable row level security;
revoke all on public.ai_usage, public.ai_ip, public.ai_budget, public.ai_rewards, public.plus_entitlements from public, anon, authenticated;

-- ------------------------------------------------------------------ helpers (private)
create or replace function private.fale_check(p_secret text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is null or length(p_secret) < 32 or not exists (
    select 1 from private.fale_secrets
    where name = 'rpc' and secret_sha256 = encode(extensions.digest(p_secret, 'sha256'), 'hex')
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

revoke all on function private.fale_check(text) from public, anon, authenticated;

-- ------------------------------------------------------------------ RPCs (public, secret-gated)
create or replace function public.fale_register_ip(p_secret text, p_ip text, p_day date, p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform private.fale_check(p_secret);
  insert into public.ai_ip (day, ip_hash) values (p_day, p_ip) on conflict do nothing;
  select registered into n from public.ai_ip where day = p_day and ip_hash = p_ip for update;
  if n >= p_limit then return jsonb_build_object('ok', false, 'registered', n); end if;
  update public.ai_ip set registered = registered + 1 where day = p_day and ip_hash = p_ip returning registered into n;
  return jsonb_build_object('ok', true, 'registered', n);
end $$;

create or replace function public.fale_quota_consume(p_secret text, p_device text, p_ip text, p_day date, p_free integer, p_bonus integer,
  p_plus boolean, p_plus_limit integer, p_ip_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u_used integer; u_rew integer; lim integer; ip_used integer;
begin
  perform private.fale_check(p_secret);
  insert into public.ai_usage (day, device_hash) values (p_day, p_device) on conflict do nothing;
  select used, rewarded into u_used, u_rew from public.ai_usage where day = p_day and device_hash = p_device for update;
  lim := case when p_plus then p_plus_limit else p_free + u_rew * p_bonus end;
  if u_used >= lim then
    return jsonb_build_object('ok', false, 'reason', 'quota', 'used', u_used, 'limit', lim, 'rewarded', u_rew);
  end if;
  if not p_plus then
    insert into public.ai_ip (day, ip_hash) values (p_day, p_ip) on conflict do nothing;
    select used into ip_used from public.ai_ip where day = p_day and ip_hash = p_ip for update;
    if ip_used >= p_ip_limit then
      return jsonb_build_object('ok', false, 'reason', 'ip', 'used', u_used, 'limit', lim, 'rewarded', u_rew);
    end if;
    update public.ai_ip set used = used + 1 where day = p_day and ip_hash = p_ip;
  end if;
  update public.ai_usage set used = used + 1 where day = p_day and device_hash = p_device returning used into u_used;
  return jsonb_build_object('ok', true, 'used', u_used, 'limit', lim, 'rewarded', u_rew);
end $$;

create or replace function public.fale_quota_refund(p_secret text, p_device text, p_ip text, p_day date, p_plus boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.fale_check(p_secret);
  update public.ai_usage set used = greatest(used - 1, 0) where day = p_day and device_hash = p_device;
  if not p_plus then update public.ai_ip set used = greatest(used - 1, 0) where day = p_day and ip_hash = p_ip; end if;
end $$;

create or replace function public.fale_quota_status(p_secret text, p_device text, p_day date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  perform private.fale_check(p_secret);
  select used, rewarded into r from public.ai_usage where day = p_day and device_hash = p_device;
  return jsonb_build_object('used', coalesce(r.used, 0), 'rewarded', coalesce(r.rewarded, 0));
end $$;

create or replace function public.fale_budget_reserve(p_secret text, p_month text, p_est numeric, p_cap numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  perform private.fale_check(p_secret);
  if p_est < 0 then raise exception 'bad estimate'; end if;
  insert into public.ai_budget (month) values (p_month) on conflict do nothing;
  select reserved_usd, spent_usd into r from public.ai_budget where month = p_month for update;
  if r.spent_usd + r.reserved_usd + p_est > p_cap then
    return jsonb_build_object('ok', false, 'reserved', r.reserved_usd, 'spent', r.spent_usd);
  end if;
  update public.ai_budget set reserved_usd = reserved_usd + p_est, updated_at = now() where month = p_month;
  return jsonb_build_object('ok', true, 'reserved', r.reserved_usd + p_est, 'spent', r.spent_usd);
end $$;

create or replace function public.fale_budget_settle(p_secret text, p_month text, p_est numeric, p_actual numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.fale_check(p_secret);
  update public.ai_budget
     set reserved_usd = greatest(reserved_usd - greatest(p_est, 0), 0),
         spent_usd = spent_usd + greatest(p_actual, 0),
         updated_at = now()
   where month = p_month;
end $$;

create or replace function public.fale_budget_status(p_secret text, p_month text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  perform private.fale_check(p_secret);
  select reserved_usd, spent_usd into r from public.ai_budget where month = p_month;
  return jsonb_build_object('reserved', coalesce(r.reserved_usd, 0), 'spent', coalesce(r.spent_usd, 0));
end $$;

create or replace function public.fale_reward_record(p_secret text, p_txid text, p_device text, p_day date, p_max integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare inserted integer; n integer;
begin
  perform private.fale_check(p_secret);
  insert into public.ai_rewards (transaction_id, device_hash, day) values (p_txid, p_device, p_day) on conflict do nothing;
  get diagnostics inserted = row_count;
  insert into public.ai_usage (day, device_hash) values (p_day, p_device) on conflict do nothing;
  select rewarded into n from public.ai_usage where day = p_day and device_hash = p_device for update;
  if inserted = 0 then return jsonb_build_object('ok', true, 'duplicate', true, 'capped', false, 'rewarded', n); end if;
  if n >= p_max then return jsonb_build_object('ok', true, 'duplicate', false, 'capped', true, 'rewarded', n); end if;
  update public.ai_usage set rewarded = rewarded + 1 where day = p_day and device_hash = p_device returning rewarded into n;
  return jsonb_build_object('ok', true, 'duplicate', false, 'capped', false, 'rewarded', n);
end $$;

create or replace function public.fale_plus_get(p_secret text, p_device text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  perform private.fale_check(p_secret);
  select product, expires_at into r from public.plus_entitlements where device_hash = p_device;
  if not found then return null; end if;
  return jsonb_build_object('product', r.product, 'expires_at', r.expires_at);
end $$;

-- Only the anon role (publishable key) may call the RPCs; they are useless without the secret.
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
    'public.fale_plus_get(text, text)'
  ] loop
    execute format('revoke all on function %s from public, authenticated', f);
    execute format('grant execute on function %s to anon, service_role', f);
  end loop;
end $$;
