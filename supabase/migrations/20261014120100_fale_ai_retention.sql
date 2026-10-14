-- FaLe PDF cloud AI: retention (30 days) + Plus entitlement upsert.
-- Contains DELETE statements → apply with explicit approval (Supabase SQL editor or `supabase db push`).
-- Safe to re-run.

create or replace function private.fale_purge() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.ai_usage where day < current_date - 30;
  delete from public.ai_ip where day < current_date - 30;
  delete from public.ai_rewards where created_at < now() - interval '30 days';
  delete from public.plus_entitlements where expires_at < now() - interval '30 days';
  delete from public.ai_budget where month < to_char(now() - interval '13 months', 'YYYY-MM');
end $$;
revoke all on function private.fale_purge() from public, anon, authenticated;

-- quota RPC again, now with the opportunistic purge hook
create or replace function public.fale_quota_consume(p_secret text, p_device text, p_ip text, p_day date, p_free integer, p_bonus integer,
  p_plus boolean, p_plus_limit integer, p_ip_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u_used integer; u_rew integer; lim integer; ip_used integer;
begin
  perform private.fale_check(p_secret);
  if random() < 0.02 then perform private.fale_purge(); end if; -- opportunistic retention
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

create or replace function public.fale_plus_upsert(p_secret text, p_device text, p_token_hash text, p_product text, p_expires timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.fale_check(p_secret);
  -- one purchase belongs to one device at a time (restore moves it to the new device)
  delete from public.plus_entitlements where purchase_token_hash = p_token_hash and device_hash <> p_device;
  insert into public.plus_entitlements (device_hash, purchase_token_hash, product, expires_at, verified_at)
  values (p_device, p_token_hash, p_product, p_expires, now())
  on conflict (device_hash) do update set purchase_token_hash = excluded.purchase_token_hash, product = excluded.product,
    expires_at = excluded.expires_at, verified_at = now();
end $$;

create or replace function public.fale_purge(p_secret text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.fale_check(p_secret);
  perform private.fale_purge();
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.fale_quota_consume(text, text, text, date, integer, integer, boolean, integer, integer)',
    'public.fale_plus_upsert(text, text, text, text, timestamptz)',
    'public.fale_purge(text)'
  ] loop
    execute format('revoke all on function %s from public, authenticated', f);
    execute format('grant execute on function %s to anon, service_role', f);
  end loop;
end $$;

-- Daily purge with pg_cron (available on Supabase; enable under Database → Extensions if this fails).
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'fale-ai-purge';
select cron.schedule('fale-ai-purge', '17 3 * * *', 'select private.fale_purge()');
