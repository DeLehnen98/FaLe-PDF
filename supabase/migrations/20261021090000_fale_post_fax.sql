-- FaLe PDF: „Per Fax senden“ + scheduled check for „Brief per Post“ (api/_lib/postal.js).
--
-- A fax job keeps its PDF until the fax went through or finally failed (one automatic second try) – so the purge
-- now also removes any PDF older than 24 hours, whatever the status. fale_post_open lists jobs that still need a
-- look (payment not confirmed yet, or handed over but not finished) for the scheduled sweep (no content, no PDF).

create or replace function private.fale_post_purge() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a integer; b integer; c integer;
begin
  update public.post_jobs set pdf = null, status = 'canceled', updated_at = now()
   where status = 'pending_payment' and created_at < now() - interval '24 hours';
  get diagnostics a = row_count;
  update public.post_jobs set pdf = null, updated_at = now()
   where pdf is not null and created_at < now() - interval '24 hours';
  get diagnostics c = row_count;
  delete from public.post_jobs where created_at < now() - interval '180 days';
  get diagnostics b = row_count;
  return jsonb_build_object('expired', a, 'deleted', b, 'pdf_removed', c);
end $$;
revoke all on function private.fale_post_purge() from public, anon, authenticated;

create or replace function public.fale_post_open(p_secret text, p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  perform private.fale_check(p_secret);
  perform private.fale_post_purge();
  select coalesce(jsonb_agg(private.fale_post_json(j, false)), '[]'::jsonb) into r from (
    select * from public.post_jobs
     where (status = 'pending_payment' and session_id is not null and created_at < now() - interval '2 minutes' and created_at > now() - interval '24 hours')
        or (status = 'submitted' and created_at > now() - interval '30 days')
     order by updated_at asc
     limit greatest(1, least(coalesce(p_limit, 40), 100))
  ) j;
  return jsonb_build_object('ok', true, 'jobs', r);
end $$;

revoke all on function public.fale_post_open(text, integer) from public, anon, authenticated;
grant execute on function public.fale_post_open(text, integer) to anon, service_role;

notify pgrst, 'reload schema';
