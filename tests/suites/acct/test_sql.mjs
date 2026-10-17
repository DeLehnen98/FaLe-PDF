// SQL tests for supabase/migrations/20261014180000_fale_account_sync.sql (+ _cron) on a local PostgreSQL
// with the Supabase stub (auth.uid() from request.jwt.claims, storage.objects with RLS).
//   ./reset_db.sh fale_sqltest && node test_sql.mjs
import { connect, lit } from './pgmini.mjs';
import { execSync } from 'node:child_process';

const DB = process.env.PGDB || 'fale_sqltest';
execSync(`${new URL('./reset_db.sh', import.meta.url).pathname} ${DB}`, { stdio: 'ignore' });
const c = await connect({ path: '/tmp/faleacct/.s.PGSQL.5544', database: DB });
const SECRET = 'test-rpc-secret-0123456789abcdefghijklmnop';
let pass = 0, fail = 0;
function check(name, cond, info = '') { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (info ? '  [' + JSON.stringify(info).slice(0, 400) + ']' : '')); } }

async function q(sql) { try { return await c.query(sql); } catch (e) { try { await c.query('rollback'); } catch {} throw e; } }
async function as(user, sql, { session = null } = {}) {
  const claims = user ? { sub: user, role: 'authenticated', aud: 'authenticated', session_id: session } : { role: 'anon' };
  return q(`begin; set local role ${user ? 'authenticated' : 'anon'}; select set_config('request.jwt.claims', ${lit(JSON.stringify(claims))}, true); ${sql}; commit;`);
}
async function rpc(user, fn, args = '', opts) { const r = await as(user, `select public.${fn}(${args})::text as r`, opts); return JSON.parse(r[0].r); }
async function err(p) { try { await p; return null; } catch (e) { return e; } }
const id22 = s => (s + 'xxxxxxxxxxxxxxxxxxxxxxxx').slice(0, 22);
const KDF = { alg: 'PBKDF2-SHA256', iter: 600000, salt: 'c2FsdHNhbHRzYWx0c2FsdA' };
const W = 'A'.repeat(80);
async function upload(user, name, size) {
  return as(user, `insert into storage.objects (bucket_id, name, owner_id, metadata) values ('sync', ${lit(name)}, ${lit(user)}, jsonb_build_object('size', ${size}, 'mimetype', 'application/octet-stream'))`);
}

const [A, B] = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const SA = 'aaaaaaaa-0000-4000-8000-000000000001';
await q(`insert into auth.users (id, email) values (${lit(A)}, 'a@example.com'), (${lit(B)}, 'b@example.com');
         insert into auth.sessions (id, user_id) values (${lit(SA)}, ${lit(A)})`);

// ------------------------------------------------------------------ basics / auth
let r = await rpc(A, 'sync_status');
check('status: empty account', r.ok && r.key === null && r.quota === 1073741824 && r.usage.total === 0 && r.chunk_bytes === 4194332, r);
let e = await err(rpc(null, 'sync_status'));
check('anon cannot call sync_status', e && /permission denied/.test(e.message), e && e.message);
e = await err(q(`begin; set local role authenticated; select public.sync_status(); commit;`));
check('authenticated without uid → not_authenticated', e && /not_authenticated/.test(e.message), e && e.message);

r = await rpc(A, 'sync_reserve', `${lit(id22('blob1'))}, 10, 1`);
check('reserve without key → no_key', r.ok === false && r.reason === 'no_key', r);

r = await rpc(A, 'sync_keys_put', `'keyA_1234567890ab', ${lit(KDF)}::jsonb, ${lit(W)}, ${lit(W)}, 'create'`);
check('keys: create', r.ok, r);
r = await rpc(A, 'sync_keys_put', `'keyA_OTHER_7890ab', ${lit(KDF)}::jsonb, ${lit(W)}, ${lit(W)}, 'create'`);
check('keys: second create with other key → exists', !r.ok && r.reason === 'exists' && r.key_id === 'keyA_1234567890ab', r);
r = await rpc(A, 'sync_keys_put', `'keyA_1234567890ab', ${lit({ ...KDF, iter: 700000 })}::jsonb, ${lit('B'.repeat(80))}, ${lit(W)}, 'update'`);
check('keys: update (new password) with same key id', r.ok, r);
r = await rpc(A, 'sync_keys_put', `'keyA_1234567890ab', ${lit({ ...KDF, iter: 1000 })}::jsonb, ${lit(W)}, ${lit(W)}, 'update'`);
check('keys: weak KDF rejected', !r.ok && r.reason === 'bad_input', r);
r = await rpc(B, 'sync_keys_put', `'keyB_1234567890ab', ${lit(KDF)}::jsonb, ${lit(W)}, ${lit(W)}, 'update'`);
check('keys: update without key → key_mismatch', !r.ok && r.reason === 'key_mismatch', r);
let rows = await as(B, `select count(*) n from public.sync_keys`);
check('RLS: B cannot see A\'s keys', rows[0].n === '0', rows);
rows = await as(A, `select count(*) n from public.sync_keys`);
check('RLS: A sees own keys', rows[0].n === '1', rows);
e = await err(as(null, `select * from public.sync_keys`));
check('anon has no table access', e && /permission denied/.test(e.message), e && e.message);
e = await err(as(A, `insert into public.sync_items (user_id, item_id, kind, seq, meta) values (${lit(A)}, ${lit(id22('direct'))}, 'file', 1, 'x')`));
check('no direct INSERT into sync_items (writes only via RPC)', e && /permission denied/.test(e.message), e && e.message);
e = await err(as(A, `update public.sync_keys set key_id = 'zzzzzzzzzzzzzzzzzz'`));
check('no direct UPDATE of sync_keys', e && /permission denied/.test(e.message), e && e.message);
await rpc(B, 'sync_keys_put', `'keyB_1234567890ab', ${lit(KDF)}::jsonb, ${lit(W)}, ${lit(W)}, 'create'`);

// ------------------------------------------------------------------ reserve + storage RLS + commit
const b1 = id22('blobone'), b2 = id22('blobtwo'), it1 = id22('itemone');
r = await rpc(A, 'sync_reserve', `${lit(b1)}, 100, 1`);
check('reserve 100 bytes', r.ok && r.chunk_bytes === 4194332, r);
r = await rpc(A, 'sync_reserve', `${lit(b2)}, 100, 2`);
check('reserve with inconsistent chunk count rejected', !r.ok && r.reason === 'bad_input', r);
r = await rpc(A, 'sync_reserve', `${lit(b1)}, 100, 1`);
check('reserve same blob twice rejected', !r.ok && r.reason === 'exists', r);
await upload(A, `${A}/${b1}/0`, 100);
check('upload into reserved slot', true);
e = await err(upload(A, `${A}/${b1}/1`, 10));
check('upload beyond reserved chunk count denied', e && /row-level security/.test(e.message), e && e.message);
e = await err(upload(A, `${A}/${id22('notreserved')}/0`, 10));
check('upload into unreserved blob denied', e && /row-level security/.test(e.message), e && e.message);
e = await err(upload(B, `${A}/${b1}/0x`, 10));
check('B cannot upload into A\'s prefix', e && /row-level security/.test(e.message), e && e.message);
e = await err(upload(B, `${B}/${b1}/0`, 10));
check('B cannot use A\'s reservation under own prefix', e && /row-level security/.test(e.message), e && e.message);
e = await err(upload(A, `${A}/${b1}/0`, 100));
check('chunks are write-once (duplicate rejected)', e && /duplicate key/.test(e.message), e && e.message);
e = await err(as(A, `update storage.objects set metadata = '{"size":1}' where name = ${lit(`${A}/${b1}/0`)}`).then(async () => {
  const x = await q(`select metadata->>'size' s from storage.objects where name = ${lit(`${A}/${b1}/0`)}`); if (x[0].s !== '100') throw new Error('updated'); }));
check('no UPDATE on storage objects', !e, e && e.message);
rows = await as(B, `select count(*) n from storage.objects`);
check('RLS: B cannot list A\'s objects', rows[0].n === '0', rows);
rows = await as(B, `with d as (delete from storage.objects where name like ${lit(A + '/%')} returning 1) select count(*) n from d`);
check('RLS: B cannot delete A\'s objects', rows[0].n === '0', rows);
rows = await as(A, `select count(*) n from storage.objects`);
check('A sees own object', rows[0].n === '1', rows);

const SHA = 'ab'.repeat(32);
r = await rpc(A, 'sync_commit', `${lit(it1)}, 'file', 0, 'bWV0YQ', ${lit(b1)}, ${lit(SHA)}, 'dev_A_0123456789ab'`);
check('commit new item v1', r.ok && r.version === 1, r);
r = await rpc(A, 'sync_commit', `${lit(it1)}, 'file', 0, 'bWV0YQ', ${lit(b1)}, ${lit(SHA)}, null`);
check('commit with stale base → conflict + current item', !r.ok && r.reason === 'conflict' && r.item.version === 1 && r.item.blob_id === b1, r);
r = await rpc(A, 'sync_commit', `${lit(it1)}, 'file', 1, 'bWV0YTI', ${lit(b1)}, ${lit(SHA)}, null`);
check('meta-only update keeps blob, v2', r.ok && r.version === 2 && !r.dead, r);
r = await rpc(A, 'sync_commit', `${lit(it1)}, 'folders', 2, 'bWV0YTI', null, null, null`);
check('kind cannot change', !r.ok && r.reason === 'bad_input', r);
r = await rpc(B, 'sync_commit', `${lit(it1)}, 'file', 2, 'bWV0YTI', ${lit(b1)}, ${lit(SHA)}, null`);
check('B cannot commit with A\'s blob', !r.ok && r.reason === 'no_blob', r);

// incomplete uploads
const b3 = id22('blobthree');
r = await rpc(A, 'sync_reserve', `${lit(b3)}, 4194400, 2`);
check('reserve 2 chunks', r.ok, r);
await upload(A, `${A}/${b3}/0`, 4194332);
r = await rpc(A, 'sync_commit', `${lit(it1)}, 'file', 2, 'bWV0YTM', ${lit(b3)}, ${lit(SHA)}, null`);
check('commit with missing chunk → incomplete', !r.ok && r.reason === 'incomplete' && r.chunks === 1, r);
await upload(A, `${A}/${b3}/1`, 999);
r = await rpc(A, 'sync_commit', `${lit(it1)}, 'file', 2, 'bWV0YTM', ${lit(b3)}, ${lit(SHA)}, null`);
check('commit with wrong byte count (lied about size) → incomplete', !r.ok && r.reason === 'incomplete', r);
await as(A, `delete from storage.objects where name = ${lit(`${A}/${b3}/1`)}`);
await upload(A, `${A}/${b3}/1`, 68);
r = await rpc(A, 'sync_commit', `${lit(it1)}, 'file', 2, 'bWV0YTM', ${lit(b3)}, ${lit(SHA)}, null`);
check('commit new content → v3, old blob dead', r.ok && r.version === 3 && r.dead === b1, r);
r = await rpc(A, 'sync_garbage');
check('garbage lists dead blob', r.blobs.some(x => x.blob_id === b1 && x.status === 'dead'), r);
r = await rpc(A, 'sync_blob_gone', `array[${lit(b1)}]`);
check('blob_gone refuses while objects exist', r.removed === 0 && r.remaining === 1, r);
await as(A, `delete from storage.objects where name like ${lit(`${A}/${b1}/%`)}`);
r = await rpc(A, 'sync_blob_gone', `array[${lit(b1)}, ${lit(b3)}]`);
check('blob_gone removes dead blob row, keeps live blob', r.removed === 1, r);

// pull isolation
r = await rpc(A, 'sync_pull', '0, 100');
check('pull returns own item', r.items.length === 1 && r.items[0].item_id === it1 && r.items[0].version === 3 && r.items[0].meta === 'bWV0YTM', r);
const cursor = r.cursor;
r = await rpc(B, 'sync_pull', '0, 100');
check('pull isolation: B sees nothing of A', r.items.length === 0, r);
rows = await as(B, `select count(*) n from public.sync_items`);
check('RLS: B cannot select A\'s items', rows[0].n === '0', rows);

// delete → tombstone
r = await rpc(A, 'sync_delete', `${lit(it1)}, 2, null`);
check('delete with stale version → conflict', !r.ok && r.reason === 'conflict', r);
r = await rpc(A, 'sync_delete', `${lit(it1)}, 3, null`);
check('delete → tombstone v4 + dead blob', r.ok && r.version === 4 && r.dead === b3, r);
r = await rpc(A, 'sync_pull', `${cursor}, 100`);
check('pull after cursor shows tombstone only', r.items.length === 1 && r.items[0].deleted === true && r.items[0].meta === null, r);
r = await rpc(A, 'sync_commit', `${lit(it1)}, 'file', 4, 'bWV0YTU', null, null, null`);
check('restore (commit on tombstone) → v5', r.ok && r.version === 5, r);

// ------------------------------------------------------------------ quota
await q(`update private.fale_sync_config set value = 1000 where key = 'free_bytes'`);
await as(A, `delete from storage.objects where name like ${lit(`${A}/%`)}`);
await rpc(A, 'sync_blob_gone', `array[${lit(b3)}]`);
r = await rpc(A, 'sync_reserve', `${lit(id22('big'))}, 2000, 1`);
check('quota: reserve over free quota refused', !r.ok && r.reason === 'quota' && r.quota === 1000, r);
r = await rpc(A, 'sync_reserve', `${lit(id22('q1'))}, 500, 1`);
check('quota: reserve 500 of 1000', r.ok, r);
r = await rpc(A, 'sync_reserve', `${lit(id22('q2'))}, 600, 1`);
check('quota: open reservations count (500 + 600 > 1000)', !r.ok && r.reason === 'quota', r);
await upload(A, `${A}/${id22('q1')}/0`, 500);
r = await rpc(A, 'sync_status');
check('usage = stored bytes + meta (no double count of uploaded reservation)', r.usage.stored === 500 && r.usage.open === 0, r.usage);
await q(`insert into public.plus_accounts (user_id, purchase_token_hash, product, expires_at) values (${lit(A)}, ${lit('cd'.repeat(32))}, 'fale_plus_monthly', now() + interval '10 days')`);
r = await rpc(A, 'sync_reserve', `${lit(id22('q2'))}, 600, 1`);
check('quota: Plus account gets plus_bytes', r.ok, r);
r = await rpc(A, 'sync_status');
check('status shows plus + plus quota', r.plus === true && r.quota === 21474836480, r);
await q(`update private.fale_sync_config set value = 2 where key = 'max_pending'`);
r = await rpc(A, 'sync_reserve', `${lit(id22('q3'))}, 10, 1`);
check('too many open reservations refused', !r.ok && r.reason === 'too_many_pending', r);
await q(`update private.fale_sync_config set value = 64 where key = 'max_pending'; update private.fale_sync_config set value = 1073741824 where key = 'free_bytes'`);
// meta quota
await q(`update private.fale_sync_config set value = 10 where key = 'free_bytes'`);
r = await rpc(B, 'sync_commit', `${lit(id22('bmeta'))}, 'profile', 0, ${lit('x'.repeat(50))}, null, null, null`);
check('quota: inline metadata counts too', !r.ok && r.reason === 'quota', r);
await q(`update private.fale_sync_config set value = 1073741824 where key = 'free_bytes'`);
r = await rpc(B, 'sync_commit', `${lit(id22('bmeta'))}, 'profile', 0, ${lit('x'.repeat(98305))}, null, null, null`);
check('metadata size limit', !r.ok && r.reason === 'bad_input', r);

// ------------------------------------------------------------------ devices
r = await rpc(A, 'fale_device_touch', `'devA_0123456789abcd', 'Pixel 9', 'android', '2.4.0'`, { session: SA });
check('device touch', r.ok && r.revoked === false, r);
r = await rpc(A, 'fale_devices');
check('devices list', r.devices.length === 1 && r.devices[0].name === 'Pixel 9' && r.devices[0].platform === 'android', r);
r = await rpc(B, 'fale_device_revoke', `'devA_0123456789abcd'`);
check('B cannot revoke A\'s device', !r.ok && r.reason === 'not_found', r);
r = await rpc(A, 'fale_device_revoke', `'devA_0123456789abcd'`);
rows = await q(`select count(*) n from auth.sessions where id = ${lit(SA)}`);
check('revoke ends the device session', r.ok && r.session_ended === true && rows[0].n === '0', { r, rows });
r = await rpc(A, 'fale_device_touch', `'devA_0123456789abcd', 'Pixel 9', 'android', '2.4.0'`);
check('revoked device learns it is revoked', r.ok && r.revoked === true, r);

// ------------------------------------------------------------------ secret-gated API functions
e = await err(rpc(A, 'fale_account_plus_get', `${lit(SECRET)}, ${lit(A)}`));
check('authenticated cannot call secret-gated functions', e && /permission denied/.test(e.message), e && e.message);
e = await err(rpc(null, 'fale_account_plus_get', `'wrong-secret-0123456789abcdefghijklmnop', ${lit(A)}`));
check('wrong secret → forbidden', e && /forbidden/.test(e.message), e && e.message);
r = await rpc(null, 'fale_account_plus_get', `${lit(SECRET)}, ${lit(A)}`);
check('plus_get with secret', r && r.product === 'fale_plus_monthly', r);
await q(`insert into public.plus_entitlements (device_hash, purchase_token_hash, product, expires_at) values ('devhash_0123456789abcdef', ${lit('ef'.repeat(32))}, 'fale_plus_yearly', now() + interval '300 days')`);
r = await rpc(null, 'fale_account_plus_link', `${lit(SECRET)}, ${lit(B)}, 'devhash_0123456789abcdef'`);
check('link device Plus to account B', r.ok && r.linked && r.product === 'fale_plus_yearly', r);
r = await rpc(null, 'fale_account_plus_upsert', `${lit(SECRET)}, ${lit(A)}, ${lit('ef'.repeat(32))}, 'fale_plus_yearly', now() + interval '300 days'`);
rows = await q(`select user_id from public.plus_accounts where purchase_token_hash = ${lit('ef'.repeat(32))}`);
check('one purchase → one account (moves to A)', r.ok && rows.length === 1 && rows[0].user_id === A, rows);

// ------------------------------------------------------------------ wipe + account deletion
r = await rpc(B, 'sync_wipe');
rows = await as(B, `select (select count(*) from public.sync_keys) k, (select count(*) from public.sync_items) i`);
check('sync_wipe removes items + keys', r.ok && rows[0].k === '0' && rows[0].i === '0', { r, rows });
r = await rpc(null, 'fale_account_delete', `${lit(SECRET)}, ${lit(A)}`);
rows = await q(`select (select count(*) from auth.users where id = ${lit(A)}) u, (select count(*) from public.sync_items where user_id = ${lit(A)}) i,
  (select count(*) from public.devices where user_id = ${lit(A)}) d, (select count(*) from auth.users where id = ${lit(B)}) b,
  (select remaining_objects from private.fale_account_deletions where user_id = ${lit(A)}) ro`);
check('account delete: rows + auth user gone, other user untouched, remaining objects reported', r.ok && r.auth_deleted && rows[0].u === '0' && rows[0].i === '0' && rows[0].d === '0' && rows[0].b === '1' && rows[0].ro === String(r.remaining_objects) && r.remaining_objects === 1, { r, rows });

// ------------------------------------------------------------------ purge
await rpc(B, 'sync_keys_put', `'keyB_2234567890ab', ${lit(KDF)}::jsonb, ${lit(W)}, ${lit(W)}, 'create'`);
const it2 = id22('itemtwo');
await rpc(B, 'sync_commit', `${lit(it2)}, 'reminder', 0, 'eA', null, null, null`);
await rpc(B, 'sync_delete', `${lit(it2)}, 1, null`);
await q(`update public.sync_items set deleted_at = now() - interval '31 days' where item_id = ${lit(it2)}`);
rows = await q(`select private.fale_sync_purge()::text r`);
const pr = JSON.parse(rows[0].r);
rows = await q(`select count(*) n from public.sync_items where item_id = ${lit(it2)}`);
check('purge removes 30-day-old tombstones', pr.tombstones === 1 && rows[0].n === '0', pr);
rows = await q(`select count(*) n from cron.job where jobname = 'fale-sync-purge'`);
check('cron job scheduled', rows[0].n === '1');

// ------------------------------------------------------------------ idempotency
c.close();
let ok = true;
try {
  for (const f of ['20261014180000_fale_account_sync.sql', '20261014180100_fale_account_sync_cron.sql']) {
    execSync(`psql -h /tmp/faleacct -p 5544 -U postgres -d ${DB} -v ON_ERROR_STOP=1 -q --single-transaction -c "set client_min_messages=warning" -f /home/claude/FalePDF/supabase/migrations/${f}`, { stdio: 'pipe' });
  }
} catch (x) { ok = false; console.log(String(x.stderr || x).slice(0, 500)); }
const c2 = await connect({ path: '/tmp/faleacct/.s.PGSQL.5544', database: DB });
rows = await c2.query(`select (select count(*) from public.sync_keys) k, (select count(*) from cron.job where jobname = 'fale-sync-purge') j, (select value from private.fale_sync_config where key='free_bytes') f`);
check('migrations are idempotent (re-run keeps data and config)', ok && rows[0].k === '1' && rows[0].j === '1' && rows[0].f === '1073741824', rows);
// every new public table has RLS enabled
rows = await c2.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
check('RLS enabled on every public table', rows.length === 0, rows);
rows = await c2.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(p.proconfig) x where x like 'search_path=%')`);
check('all SECURITY DEFINER functions pin search_path', rows.length === 0, rows);
rows = await c2.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'sync_%' or p.proname like 'fale_device%' or p.proname = 'fale_devices') and has_function_privilege('anon', p.oid, 'execute')`);
check('anon cannot execute any sync/device RPC', rows.length === 0, rows);
c2.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
