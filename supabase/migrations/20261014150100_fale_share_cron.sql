-- FaLe PDF sharing: scheduled expiry cleanup (every 15 minutes) with pg_cron.
-- The API also deletes expired objects lazily on access and purges opportunistically, so the
-- feature works without this job – it only guarantees that ciphertext is gone soon after expiry
-- even when nobody touches the link again. Requires the pg_cron extension (Supabase: Database →
-- Extensions → pg_cron). Safe to re-run.
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'fale-share-purge';
select cron.schedule('fale-share-purge', '*/15 * * * *', 'select private.fale_share_purge()');
