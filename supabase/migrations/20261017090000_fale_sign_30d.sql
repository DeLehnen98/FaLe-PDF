-- Unterschriftsanfragen: Laufzeit bis 30 Tage (Verträge gehen oft durch mehrere Hände; 7 Tage waren zu kurz).
-- Nur für kind = 'sign-doc'. Geteilte Dateien ('file', 'relay') bleiben bei höchstens 7 Tagen.
-- Die Anfrage und die unterschriebenen Versionen übernehmen den Ablauf des Dokuments (fale_sign_create /
-- fale_sign_result), daher genügt diese eine Prüfung. Gleiche Signatur → Rechte aus den früheren Migrationen bleiben.
create or replace function public.fale_share_create(p_secret text, p_id text, p_kind text, p_owner text, p_parent text,
  p_header text, p_size bigint, p_chunks integer, p_chunk_size integer, p_expires timestamptz, p_max_downloads integer,
  p_cap bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare total bigint; max_life interval;
begin
  perform private.fale_check(p_secret);
  if random() < 0.05 then perform private.fale_share_purge(); end if;
  max_life := interval '7 days 5 minutes';
  if p_kind = 'sign-doc' then max_life := interval '30 days 5 minutes'; end if;
  if p_expires <= now() or p_expires > now() + max_life then raise exception 'bad expiry'; end if;
  if p_chunks <> greatest(1, ceil(p_size::numeric / p_chunk_size)::integer) then raise exception 'bad chunking'; end if;
  select coalesce(sum(size), 0) into total from public.share_objects where expires_at > now();
  if total + p_size > p_cap then return jsonb_build_object('ok', false, 'reason', 'capacity'); end if;
  insert into public.share_objects (id, kind, owner_hash, parent_id, header, size, chunk_count, chunk_size, expires_at, max_downloads)
  values (p_id, p_kind, p_owner, p_parent, p_header, p_size, p_chunks, p_chunk_size, p_expires, p_max_downloads);
  return jsonb_build_object('ok', true, 'expires_at', p_expires);
end $$;
