-- FaLe One: retention (contains DELETE statements) + pg_cron job. Safe to re-run.
--   * trash: items trashed longer than trash_days (30) are deleted for good (they become tombstones)
--   * versions: old versions superseded longer than version_days (30) ago are deleted
--   * open upload sessions past their expiry (upload_ttl_hours, 24 h) are deleted with their chunks
--   * tombstones (deleted nodes/albums, removed album memberships) after tombstone_days (30); the account's
--     min_cursor moves past them, so a device with an older cursor is told to resync from scratch
--   * backup records of devices that were silent for a year; S3 garbage queue entries that failed 20 times
-- Each user is processed under the per-user lock (sequence numbers stay cursor-safe).
-- Over-quota accounts are NEVER touched: nothing here depends on quota.

create or replace function private.fale_one_purge() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record; q record; t integer := 0; x integer; v integer := 0; p integer := 0; tb integer := 0; dv integer := 0; g integer := 0;
  trash_days integer := coalesce(private.fale_one_cfg('trash_days'), 30)::integer;
  version_days integer := coalesce(private.fale_one_cfg('version_days'), 30)::integer;
  tomb_days integer := coalesce(private.fale_one_cfg('tombstone_days'), 30)::integer;
begin
  -- 1. trash older than trash_days → delete forever (per user, under the user's lock)
  for r in select distinct user_id from public.one_nodes where trashed_at < now() - make_interval(days => trash_days) and trash_root = node_id loop
    perform private.fale_one_lock(r.user_id);
    for q in select node_id from public.one_nodes where user_id = r.user_id and trash_root = node_id and not deleted
               and trashed_at < now() - make_interval(days => trash_days) loop
      t := t + private.fale_one_destroy(r.user_id, q.node_id);
    end loop;
  end loop;
  -- 2. old versions (no feed entry needed: only the current version is part of the feed)
  delete from public.one_revisions rv using public.one_nodes nd
   where nd.user_id = rv.user_id and nd.node_id = rv.node_id and nd.head_rev is distinct from rv.rev_id
     and rv.superseded_at < now() - make_interval(days => version_days);
  get diagnostics v = row_count;
  -- 3. abandoned uploads
  delete from public.one_blobs where status = 'pending' and expires_at < now();
  get diagnostics p = row_count;
  -- 4. tombstones → bump min_cursor first, then delete
  for r in
    select user_id, max(seq) as s from (
      select user_id, seq from public.one_nodes where deleted and deleted_at < now() - make_interval(days => tomb_days)
      union all select user_id, seq from public.one_albums where deleted and deleted_at < now() - make_interval(days => tomb_days)
      union all select user_id, seq from public.one_album_items where removed and removed_at < now() - make_interval(days => tomb_days)
    ) z group by user_id
  loop
    perform private.fale_one_lock(r.user_id);
    update public.one_accounts set min_cursor = greatest(min_cursor, r.s) where user_id = r.user_id;
    delete from public.one_album_items where user_id = r.user_id and removed and removed_at < now() - make_interval(days => tomb_days) and seq <= r.s;
    get diagnostics x = row_count; tb := tb + x;
    delete from public.one_albums where user_id = r.user_id and deleted and deleted_at < now() - make_interval(days => tomb_days) and seq <= r.s;
    get diagnostics x = row_count; tb := tb + x;
    delete from public.one_nodes where user_id = r.user_id and deleted and deleted_at < now() - make_interval(days => tomb_days) and seq <= r.s;
    get diagnostics x = row_count; tb := tb + x;
  end loop;
  -- 5. housekeeping
  delete from public.one_backup_devices where updated_at < now() - interval '365 days';
  get diagnostics dv = row_count;
  delete from private.fale_one_gc where attempts >= 20 and created_at < now() - interval '30 days';
  get diagnostics g = row_count;
  return jsonb_build_object('trash', t, 'versions', v, 'uploads', p, 'tombstones', tb, 'devices', dv, 'gc_dropped', g);
end $$;
revoke all on function private.fale_one_purge() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'fale-one-purge';
select cron.schedule('fale-one-purge', '17 4 * * *', 'select private.fale_one_purge()');
