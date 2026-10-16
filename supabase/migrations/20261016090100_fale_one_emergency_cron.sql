-- FaLe One · Notfallzugang: time-based housekeeping (contains UPDATE/DELETE statements) + pg_cron job. Safe to re-run.
--   * releases requests whose waiting period ran out without a veto (the RPCs also do this lazily on every call,
--     so access never depends on this job – it only makes the "freigegeben" notifications go out on time)
--   * expires requests that never reached the threshold (em_request_days, 30) and marks reminders
--   * removes sent / undeliverable notifications after 14 days and closed requests after a year (the log stays)

create or replace function private.fale_em_tick() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record; rel integer := 0; ex integer := 0; ob integer := 0; old integer := 0;
  req_days integer := coalesce(private.fale_one_cfg('em_request_days'), 30)::integer;
begin
  for r in select setup_id from public.one_em_requests where status = 'waiting' and release_at <= now() loop
    perform private.fale_em_lock(r.setup_id);
    perform private.fale_em_settle(r.setup_id);
    rel := rel + 1;
  end loop;
  for r in select request_id, setup_id from public.one_em_requests where status = 'waiting' and threshold_at is null and started_at < now() - make_interval(days => req_days) loop
    perform private.fale_em_lock(r.setup_id);
    update public.one_em_requests set status = 'expired', closed_at = now() where request_id = r.request_id and status = 'waiting' and threshold_at is null;
    if found then
      perform private.fale_em_log_add(r.setup_id, 'expired', null, null, jsonb_build_object('request', r.request_id));
      ex := ex + 1;
    end if;
  end loop;
  delete from private.fale_em_outbox where created_at < now() - interval '14 days';
  get diagnostics ob = row_count;
  delete from public.one_em_requests where status not in ('waiting', 'released') and closed_at < now() - interval '365 days';
  get diagnostics old = row_count;
  return jsonb_build_object('released', rel, 'expired', ex, 'outbox', ob, 'requests', old);
end $$;
revoke all on function private.fale_em_tick() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'fale-em-tick';
select cron.schedule('fale-em-tick', '*/15 * * * *', 'select private.fale_em_tick()');
