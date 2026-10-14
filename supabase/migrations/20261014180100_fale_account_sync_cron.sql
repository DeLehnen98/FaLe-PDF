-- FaLe-Konto / FaLe Sync: retention (contains DELETE statements) + daily pg_cron job. Safe to re-run.
--   * tombstones (deleted sync items) after 30 days, once their blob is gone
--   * reservations that were never committed after 7 days, when no object is left
--   * revoked devices after 30 days
--   * finished account-deletion records after 30 days
-- Storage objects are never deleted with SQL (that would orphan the files) – devices delete their own
-- objects through the Storage API; private.fale_account_deletions lists what may still need the owner.

create or replace function private.fale_sync_purge() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t integer; b integer; d integer; a integer; days integer := coalesce(private.fale_cfg('tombstone_days'), 30)::integer;
begin
  delete from public.sync_items i
   where i.deleted and i.deleted_at < now() - make_interval(days => days);
  get diagnostics t = row_count;
  delete from public.sync_blobs sb
   where sb.status in ('pending', 'dead') and sb.created_at < now() - interval '7 days'
     and not exists (select 1 from storage.objects o where o.bucket_id = 'sync' and starts_with(o.name, sb.user_id::text || '/' || sb.blob_id || '/'));
  get diagnostics b = row_count;
  delete from public.devices where revoked_at < now() - interval '30 days';
  get diagnostics d = row_count;
  delete from private.fale_account_deletions where done_at < now() - interval '30 days';
  get diagnostics a = row_count;
  return jsonb_build_object('tombstones', t, 'blobs', b, 'devices', d, 'deletions', a);
end $$;
revoke all on function private.fale_sync_purge() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'fale-sync-purge';
select cron.schedule('fale-sync-purge', '41 3 * * *', 'select private.fale_sync_purge()');
