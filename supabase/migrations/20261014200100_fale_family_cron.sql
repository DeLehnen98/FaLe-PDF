-- FaLe Familien-Ordner: daily retention job (expired/used invitations, 30-day-old tombstones, empty folders). Safe to re-run.
-- Encrypted files in Storage are never deleted with SQL (that would orphan them) – devices remove their own objects.
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'fale-family-purge';
select cron.schedule('fale-family-purge', '53 3 * * *', 'select private.fam_purge()');
