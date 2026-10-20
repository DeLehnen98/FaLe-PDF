-- FaLe PDF: „Brief per Post“ – print-and-mail jobs (api/_lib/postal.js, api/_lib/poststore.js).
--
-- A job holds the letter PDF (base64) only until it was handed to the print service; then pdf is set to null.
-- Unpaid jobs lose their PDF after 24 hours (status 'canceled'); job rows (no content: status, price, page count,
-- options, tracking code) are kept 180 days as proof of dispatch for the sender. The capability for status/cancel is
-- stored as SHA-256 only; owner_hash is the pseudonymous device hash (rate limits).
-- Same access model as the share tables: RLS on, no table privileges, SECURITY DEFINER RPCs gated by FALE_RPC_SECRET,
-- EXECUTE for anon + service_role only.

create table if not exists public.post_jobs (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{16,32}$'),
  owner_hash text not null check (char_length(owner_hash) between 16 and 128),
  cap_hash text not null check (cap_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'paid', 'submitted', 'sent', 'failed', 'refunded', 'canceled')),
  options jsonb not null default '{}'::jsonb,
  price_cents integer not null check (price_cents between 50 and 10000),
  pages integer not null check (pages between 1 and 40),
  pdf text check (pdf is null or char_length(pdf) <= 4600000),
  session_id text check (session_id is null or char_length(session_id) <= 255),
  payment_intent text check (payment_intent is null or char_length(payment_intent) <= 255),
  provider_id text check (provider_id is null or char_length(provider_id) <= 64),
  provider_status text check (provider_status is null or char_length(provider_status) <= 32),
  tracking text check (tracking is null or char_length(tracking) <= 60),
  error text check (error is null or char_length(error) <= 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  sent_at timestamptz
);
create index if not exists post_jobs_created_idx on public.post_jobs (created_at);
alter table public.post_jobs enable row level security;
revoke all on public.post_jobs from public, anon, authenticated;

create or replace function private.fale_post_purge() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a integer; b integer;
begin
  update public.post_jobs set pdf = null, status = 'canceled', updated_at = now()
   where status = 'pending_payment' and created_at < now() - interval '24 hours';
  get diagnostics a = row_count;
  delete from public.post_jobs where created_at < now() - interval '180 days';
  get diagnostics b = row_count;
  return jsonb_build_object('expired', a, 'deleted', b);
end $$;
revoke all on function private.fale_post_purge() from public, anon, authenticated;

create or replace function private.fale_post_json(j public.post_jobs, p_with_pdf boolean) returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('id', j.id, 'owner_hash', j.owner_hash, 'cap_hash', j.cap_hash, 'status', j.status, 'options', j.options,
    'price_cents', j.price_cents, 'pages', j.pages, 'session_id', j.session_id, 'payment_intent', j.payment_intent,
    'provider_id', j.provider_id, 'provider_status', j.provider_status, 'tracking', j.tracking, 'error', j.error,
    'created_at', j.created_at, 'updated_at', j.updated_at, 'paid_at', j.paid_at, 'sent_at', j.sent_at)
    || case when p_with_pdf then jsonb_build_object('pdf', j.pdf) else '{}'::jsonb end
$$;
revoke all on function private.fale_post_json(public.post_jobs, boolean) from public, anon, authenticated;

create or replace function public.fale_post_create(p_secret text, p_id text, p_owner text, p_cap text, p_options jsonb,
  p_price integer, p_pages integer, p_pdf text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.fale_check(p_secret);
  if random() < 0.05 then perform private.fale_post_purge(); end if;
  insert into public.post_jobs (id, owner_hash, cap_hash, options, price_cents, pages, pdf)
  values (p_id, p_owner, p_cap, coalesce(p_options, '{}'::jsonb), p_price, p_pages, p_pdf);
  return jsonb_build_object('ok', true);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'reason', 'exists');
end $$;

create or replace function public.fale_post_get(p_secret text, p_id text, p_with_pdf boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j public.post_jobs;
begin
  perform private.fale_check(p_secret);
  select * into j from public.post_jobs where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if j.status = 'pending_payment' and j.created_at < now() - interval '24 hours' then
    update public.post_jobs set pdf = null, status = 'canceled', updated_at = now() where id = p_id returning * into j;
  end if;
  return jsonb_build_object('ok', true, 'job', private.fale_post_json(j, coalesce(p_with_pdf, false)));
end $$;

-- p_from: only change the job when it is in this status (atomic hand-over: pending_payment → paid exactly once)
create or replace function public.fale_post_patch(p_secret text, p_id text, p_from text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j public.post_jobs; k text;
begin
  perform private.fale_check(p_secret);
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'bad input'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('status', 'session_id', 'payment_intent', 'provider_id', 'provider_status', 'tracking', 'error', 'pdf', 'paid_at', 'sent_at') then
      return jsonb_build_object('ok', false, 'reason', 'bad_field');
    end if;
  end loop;
  select * into j from public.post_jobs where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_from is not null and j.status <> p_from then return jsonb_build_object('ok', false, 'reason', 'status', 'status', j.status); end if;
  update public.post_jobs set
    status          = case when p_patch ? 'status' then p_patch->>'status' else status end,
    session_id      = case when p_patch ? 'session_id' then p_patch->>'session_id' else session_id end,
    payment_intent  = case when p_patch ? 'payment_intent' then p_patch->>'payment_intent' else payment_intent end,
    provider_id     = case when p_patch ? 'provider_id' then p_patch->>'provider_id' else provider_id end,
    provider_status = case when p_patch ? 'provider_status' then p_patch->>'provider_status' else provider_status end,
    tracking        = case when p_patch ? 'tracking' then p_patch->>'tracking' else tracking end,
    error           = case when p_patch ? 'error' then p_patch->>'error' else error end,
    pdf             = case when p_patch ? 'pdf' then p_patch->>'pdf' else pdf end,
    paid_at         = case when p_patch ? 'paid_at' then (p_patch->>'paid_at')::timestamptz else paid_at end,
    sent_at         = case when p_patch ? 'sent_at' then (p_patch->>'sent_at')::timestamptz else sent_at end,
    updated_at      = now()
  where id = p_id returning * into j;
  return jsonb_build_object('ok', true, 'job', private.fale_post_json(j, false));
end $$;

create or replace function public.fale_post_delete(p_secret text, p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform private.fale_check(p_secret);
  delete from public.post_jobs where id = p_id;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'deleted', n > 0);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.fale_post_create(text, text, text, text, jsonb, integer, integer, text)',
    'public.fale_post_get(text, text, boolean)',
    'public.fale_post_patch(text, text, text, jsonb)',
    'public.fale_post_delete(text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to anon, service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
