update private.fale_secrets set secret_sha256 = encode(extensions.digest('test-secret-0123456789abcdefghijklmnop', 'sha256'), 'hex') where name = 'rpc';
do $t$
declare s text := 'test-secret-0123456789abcdefghijklmnop'; out text := ''; r jsonb;
  own text := repeat('a', 64); oth text := repeat('b', 64); sg1 text := repeat('c', 64); sg2 text := repeat('d', 64); host text := repeat('e',64); guest text := repeat('f',64);
  b64 text := encode(convert_to(repeat('x', 1024), 'UTF8'), 'base64');
  last text := encode(convert_to('tail', 'UTF8'), 'base64');
begin
  -- forbidden without secret
  begin perform public.fale_share_info('wrong-secret-0123456789abcdefghijklmn', 'AAAAAAAAAAAAAAAAAAAAAA'); out := out || 'nosecret:NOT_BLOCKED|';
  exception when others then out := out || 'nosecret:blocked|'; end;
  r := public.fale_rate(s, current_date, 'up', array['d:dev1xxxxx','i:ip1xxxxxx'], array[2,5], 1000, array[5000,100000]::bigint[]); out := out || 'rate1:' || r || '|';
  r := public.fale_rate(s, current_date, 'up', array['d:dev1xxxxx','i:ip1xxxxxx'], array[2,5], 1000, array[5000,100000]::bigint[]); out := out || 'rate2:' || r || '|';
  r := public.fale_rate(s, current_date, 'up', array['d:dev1xxxxx','i:ip1xxxxxx'], array[2,5], 1000, array[5000,100000]::bigint[]); out := out || 'rate3:' || r || '|';
  -- file share 2 chunks of 1024 + 4 bytes
  r := public.fale_share_create(s, 'FILE0000000000000000AA', 'file', own, null, '{"v":1}', 1028, 2, 1024, now() + interval '1 hour', 1, 1000000); out := out || 'create:' || (r->>'ok') || '|';
  r := public.fale_share_create(s, 'FILE0000000000000000AB', 'file', own, null, '{"v":1}', 10000000, 9766, 1024, now() + interval '1 hour', 1, 1000000); out := out || 'cap:' || (r->>'reason') || '|';
  r := public.fale_share_info(s, 'FILE0000000000000000AA'); out := out || 'info_incomplete:' || (r->>'reason') || '|';
  r := public.fale_share_put(s, 'FILE0000000000000000AA', oth, 0, b64); out := out || 'put_wrongowner:' || (r->>'reason') || '|';
  r := public.fale_share_put(s, 'FILE0000000000000000AA', own, 0, last); out := out || 'put_badsize:' || (r->>'reason') || '|';
  r := public.fale_share_put(s, 'FILE0000000000000000AA', own, 0, b64); out := out || 'put0:' || (r->>'ok') || '|';
  r := public.fale_share_finish(s, 'FILE0000000000000000AA', own); out := out || 'finish_early:' || (r->>'reason') || '|';
  r := public.fale_share_put(s, 'FILE0000000000000000AA', own, 1, last); out := out || 'put1:' || (r->>'ok') || '|';
  r := public.fale_share_finish(s, 'FILE0000000000000000AA', own); out := out || 'finish:' || (r->>'ok') || '|';
  r := public.fale_share_info(s, 'FILE0000000000000000AA'); out := out || 'info:' || (r->'object'->>'size') || '/' || (r->'object'->>'chunks') || '|';
  r := public.fale_share_open(s, 'FILE0000000000000000AA'); out := out || 'open1:' || (r->>'ok') || ':' || (r->'object'->>'downloads') || '|';
  r := public.fale_share_open(s, 'FILE0000000000000000AA'); out := out || 'open2:' || (r->>'reason') || '|';
  r := public.fale_share_get(s, 'FILE0000000000000000AA', 1); out := out || 'get1:' || convert_from(decode(r->>'data','base64'),'UTF8') || '|';
  r := public.fale_share_status(s, 'FILE0000000000000000AA', own); out := out || 'status:' || (r->'object'->>'downloads') || '|';
  r := public.fale_share_delete(s, 'FILE0000000000000000AA', oth); out := out || 'del_wrong:' || (r->>'deleted') || '|';
  r := public.fale_share_delete(s, 'FILE0000000000000000AA', own); out := out || 'del:' || (r->>'deleted') || '|';
  r := public.fale_share_info(s, 'FILE0000000000000000AA'); out := out || 'info_after_del:' || (r->>'reason') || '|';
  -- expired lazily deleted
  insert into public.share_objects (id, kind, owner_hash, header, size, chunk_count, chunk_size, complete, expires_at, created_at)
  values ('OLD00000000000000000AA', 'file', own, '{}', 10, 1, 1024, true, now() - interval '1 minute', now() - interval '2 hours');
  r := public.fale_share_info(s, 'OLD00000000000000000AA'); out := out || 'expired:' || (r->>'reason') || ':' || (select count(*) from public.share_objects where id = 'OLD00000000000000000AA') || '|';
  -- sign request with 2 signers
  r := public.fale_share_create(s, 'DOC00000000000000000AA', 'sign-doc', own, null, '{"doc":1}', 4, 1, 1024, now() + interval '1 day', null, 1000000);
  r := public.fale_share_put(s, 'DOC00000000000000000AA', own, 0, last);
  r := public.fale_share_finish(s, 'DOC00000000000000000AA', own);
  r := public.fale_share_open(s, 'DOC00000000000000000AA'); out := out || 'open_signdoc:' || (r->>'reason') || '|';
  r := public.fale_sign_create(s, 'REQ00000000000000000AA', oth, 'DOC00000000000000000AA', array[sg1, sg2]); out := out || 'sign_create_wrong:' || (r->>'reason') || '|';
  r := public.fale_sign_create(s, 'REQ00000000000000000AA', own, 'DOC00000000000000000AA', array[sg1, sg2]); out := out || 'sign_create:' || (r->>'ok') || '|';
  r := public.fale_sign_open(s, sg2); out := out || 'open2_wait:' || (r->>'reason') || '|';
  r := public.fale_sign_status(s, 'REQ00000000000000000AA', own); out := out || 'st0:' || (r->'signers'->0->>'status') || ',' || (r->'signers'->1->>'status') || '|';
  r := public.fale_sign_result(s, sg1, 'RES10000000000000000AA', '{"r":1}', 4, 1, 1024, 1000000); out := out || 'result_before_view:' || (r->>'reason') || '|';
  r := public.fale_sign_open(s, sg1); out := out || 'open1:' || (r->>'status') || ':' || (r->'source'->>'id') || '|';
  r := public.fale_sign_result(s, sg1, 'RES10000000000000000AA', '{"r":1}', 4, 1, 1024, 1000000); out := out || 'result1:' || (r->>'ok') || '|';
  r := public.fale_sign_finish(s, sg1); out := out || 'finish_incomplete:' || (r->>'reason') || '|';
  r := public.fale_share_put(s, 'RES10000000000000000AA', sg1, 0, last); out := out || 'put_res:' || (r->>'ok') || '|';
  r := public.fale_sign_finish(s, sg1); out := out || 'finish1:' || (r->>'ok') || '|';
  r := public.fale_sign_open(s, sg2); out := out || 'open2:' || (r->>'status') || ':' || (r->'source'->>'id') || ':' || (r->'doc'->>'id') || '|';
  r := public.fale_sign_status(s, 'REQ00000000000000000AA', own); out := out || 'st1:' || (r->'signers'->0->>'status') || ',' || (r->'signers'->1->>'status') || ',' || coalesce(r->'signers'->0->'result'->>'id','-') || '|';
  r := public.fale_sign_status(s, 'REQ00000000000000000AA', oth); out := out || 'st_wrong:' || (r->>'reason') || '|';
  r := public.fale_sign_delete(s, 'REQ00000000000000000AA', own); out := out || 'sign_del:' || (r->>'deleted') || ':' || (select count(*) from public.share_objects where parent_id = 'REQ00000000000000000AA' or id = 'DOC00000000000000000AA') || ':' || (select count(*) from public.sign_signers) || '|';
  -- rooms
  r := public.fale_room_create(s, 'ROOM0000000000000000AA', '123456', host, now() + interval '1 hour'); out := out || 'room:' || (r->>'ok') || '|';
  r := public.fale_room_create(s, 'ROOM0000000000000000AB', '123456', host, now() + interval '1 hour'); out := out || 'room_dup:' || (r->>'reason') || '|';
  r := public.fale_room_send(s, 'ROOM0000000000000000AA', guest, 'x'); out := out || 'send_nojoin:' || (r->>'reason') || '|';
  r := public.fale_room_join(s, null, '123456', guest, 'code'); out := out || 'join:' || (r->>'room') || '|';
  r := public.fale_room_join(s, null, '123456', oth, 'code'); out := out || 'join2:' || (r->>'reason') || '|';
  r := public.fale_room_send(s, 'ROOM0000000000000000AA', guest, 'hello-host'); 
  r := public.fale_room_send(s, 'ROOM0000000000000000AA', host, 'hello-guest');
  r := public.fale_room_poll(s, 'ROOM0000000000000000AA', host, 0); out := out || 'poll_host:' || (r->>'joined') || ':' || (r->'msgs'->0->>'body') || ':' || jsonb_array_length(r->'msgs') || '|';
  r := public.fale_room_poll(s, 'ROOM0000000000000000AA', guest, 0); out := out || 'poll_guest:' || (r->'msgs'->0->>'body') || '|';
  r := public.fale_room_close(s, 'ROOM0000000000000000AA', guest); out := out || 'close:' || (r->>'deleted') || ':' || (select count(*) from public.transfer_msgs) || '|';
  r := public.fale_share_purge(s); out := out || 'purge:' || r || '|';
  raise exception 'RESULT %', out;
end $t$;
