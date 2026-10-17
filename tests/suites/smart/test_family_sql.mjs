// SQL tests for supabase/migrations/20261014200000_fale_family.sql (+ _cron) on the local PostgreSQL with the Supabase stub.
//   node test_family_sql.mjs   (resets the database fale_smart_sql)
import { connect, lit } from '../acct/pgmini.mjs';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

const DB = process.env.PGDB || 'fale_smart_sql';
execSync(`${new URL('../acct/reset_db.sh', import.meta.url).pathname} ${DB}`, { stdio: 'ignore' });
const c = await connect({ path: '/tmp/faleacct/.s.PGSQL.5544', database: DB });
let pass = 0, fail = 0;
function check(name, cond, info = '') { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (info ? '  [' + JSON.stringify(info).slice(0, 400) + ']' : '')); } }
async function q(sql) { try { return await c.query(sql); } catch (e) { try { await c.query('rollback'); } catch {} throw e; } }
async function as(user, sql) {
  const claims = user ? { sub: user, role: 'authenticated', aud: 'authenticated' } : { role: 'anon' };
  return q(`begin; set local role ${user ? 'authenticated' : 'anon'}; select set_config('request.jwt.claims', ${lit(JSON.stringify(claims))}, true); ${sql}; commit;`);
}
async function rpc(user, fn, args = '') { const r = await as(user, `select public.${fn}(${args})::text as r`); return JSON.parse(r[0].r); }
async function err(p) { try { await p; return null; } catch (e) { return e; } }
const b64u = b => Buffer.from(b).toString('base64url');
const id22 = () => b64u(crypto.randomBytes(16));
const W = 'A'.repeat(120);
const jwk = () => { const k = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' }); return { kty: 'EC', crv: 'P-256', x: k.x, y: k.y }; };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
async function upload(user, name, size) {
  return as(user, `insert into storage.objects (bucket_id, name, owner_id, metadata) values ('family', ${lit(name)}, ${lit(user)}, jsonb_build_object('size', ${size}, 'mimetype', 'application/octet-stream'))`);
}

const [A, B, C, D] = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
await q(`insert into auth.users (id, email) values (${lit(A)}, 'anna@example.com'), (${lit(B)}, 'ben@example.com'), (${lit(C)}, 'carla@example.com'), (${lit(D)}, 'dieter@example.com')`);

// ------------------------------------------------------------------ keys
let r = await rpc(A, 'fam_group_create', `${lit(crypto.randomUUID())}, ${lit(W)}, ${lit(W)}`);
check('group without own key → no_key', !r.ok && r.reason === 'no_key', r);
r = await rpc(A, 'fam_key_put', `'keyA_1234567890ab', ${lit({ kty: 'EC', crv: 'P-256', x: 'x', y: 'y' })}::jsonb, ${lit(W)}, 'create'`);
check('key: malformed JWK rejected', !r.ok && r.reason === 'bad_input', r);
const ja = jwk();
r = await rpc(A, 'fam_key_put', `'keyA_1234567890ab', ${lit({ ...ja, d: 'secret' })}::jsonb, ${lit(W)}, 'create'`);
check('key: JWK with private part rejected', !r.ok && r.reason === 'bad_input', r);
r = await rpc(A, 'fam_key_put', `'keyA_1234567890ab', ${lit(ja)}::jsonb, ${lit(W)}, 'create'`);
check('key: create', r.ok, r);
r = await rpc(A, 'fam_key_put', `'keyA_OTHER_890ab', ${lit(jwk())}::jsonb, ${lit(W)}, 'create'`);
check('key: other key id → exists', !r.ok && r.reason === 'exists', r);
r = await rpc(A, 'fam_key_put', `'keyA_1234567890ab', ${lit(ja)}::jsonb, ${lit('B'.repeat(120))}, 'rewrap'`);
check('key: rewrap (new sync key) keeps key id', r.ok, r);
r = await rpc(A, 'fam_key_get');
check('key: get own', r.ok && r.key.key_id === 'keyA_1234567890ab' && r.key.wrapped_private === 'B'.repeat(120), r);
for (const u of [B, C, D]) await rpc(u, 'fam_key_put', `${lit(`key${u.slice(0, 1)}_1234567890abcd`)}, ${lit(jwk())}::jsonb, ${lit(W)}, 'create'`);
let rows = await as(B, `select count(*) n from public.fam_keys`);
check('RLS: fam_keys own row only', rows[0].n === '1', rows);
let e = await err(as(null, `select public.fam_overview()`));
check('anon cannot call RPCs', e && /permission denied/.test(e.message), e && e.message);
e = await err(as(A, `select * from public.fam_emergency`));
check('fam_emergency not readable by anyone', e && /permission denied/.test(e.message), e && e.message);
e = await err(as(A, `select * from public.fam_invites`));
check('fam_invites not readable', e && /permission denied/.test(e.message), e && e.message);
e = await err(as(A, `select private.fam_role('${A}', '${A}')`));
check('schema private stays closed', e && /permission denied/.test(e.message), e && e.message);

// ------------------------------------------------------------------ group + invitations
const G = crypto.randomUUID();
r = await rpc(A, 'fam_group_create', `${lit(G)}, ${lit('N'.repeat(60))}, ${lit('K'.repeat(120))}`);
check('group create (id chosen by the device)', r.ok && r.group_id === G, r);
r = await rpc(B, 'fam_group_create', `${lit(G)}, ${lit('N'.repeat(60))}, ${lit('K'.repeat(120))}`);
check('group create: existing id refused', !r.ok && r.reason === 'exists', r);
r = await rpc(A, 'fam_overview');
check('overview: Anna is Verwalter with key', r.ok && r.groups.length === 1 && r.groups[0].my_role === 'verwalter' && r.groups[0].my_wrapped_key === 'K'.repeat(120) && r.groups[0].members[0].email === 'anna@example.com', r);
r = await rpc(B, 'fam_overview');
check('overview: Ben sees nothing yet', r.ok && r.groups.length === 0, r);
rows = await as(B, `select count(*) n from public.fam_groups`);
check('RLS: non-member cannot select group', rows[0].n === '0', rows);
const T1 = crypto.randomBytes(32).toString('hex'); const inv1 = id22();
r = await rpc(B, 'fam_invite_create', `${lit(G)}, ${lit(inv1)}, ${lit(sha(T1))}, ${lit(W)}, 'mitglied', 24`);
check('invite: only Verwalter', !r.ok && r.reason === 'forbidden', r);
r = await rpc(A, 'fam_invite_create', `${lit(G)}, ${lit(inv1)}, ${lit(sha(T1))}, ${lit(W)}, 'mitglied', 500`);
check('invite: max. 168 hours', !r.ok && r.reason === 'bad_input', r);
r = await rpc(A, 'fam_invite_create', `${lit(G)}, ${lit(id22())}, ${lit(sha(T1))}, ${lit(W)}, 'notfall', 24`);
check('invite: Notfall invite must not carry the group key', !r.ok && r.reason === 'bad_input', r);
r = await rpc(A, 'fam_invite_create', `${lit(G)}, ${lit(inv1)}, ${lit(sha(T1))}, ${lit('W'.repeat(100))}, 'mitglied', 24`);
check('invite: create (Mitglied)', r.ok, r);
r = await rpc(B, 'fam_invite_accept', `${lit(inv1)}, ${lit('0'.repeat(64))}`);
check('accept: wrong secret → invalid', !r.ok && r.reason === 'invalid', r);
r = await rpc(B, 'fam_invite_accept', `${lit(inv1)}, ${lit(T1)}`);
check('accept: Ben joins, gets invite-wrapped key once', r.ok && r.group_id === G && r.role === 'mitglied' && r.wrapped_key === 'W'.repeat(100), r);
r = await rpc(C, 'fam_invite_accept', `${lit(inv1)}, ${lit(T1)}`);
check('accept: one-time (second use refused)', !r.ok && r.reason === 'used', r);
rows = await q(`select wrapped_key from public.fam_invites where invite_id = ${lit(inv1)}`);
check('accept: invite wrap deleted after use', rows[0].wrapped_key === null, rows);
r = await rpc(B, 'fam_overview');
check('Ben: member without key yet', r.groups.length === 1 && r.groups[0].my_role === 'mitglied' && r.groups[0].my_wrapped_key === null, r);
r = await rpc(B, 'fam_member_setkey', `${lit(G)}, ${lit('M'.repeat(120))}, 1, ${lit('L'.repeat(40))}`);
check('Ben stores own wrapped key', r.ok, r);
const T2 = crypto.randomBytes(32).toString('hex'); const inv2 = id22();
await rpc(A, 'fam_invite_create', `${lit(G)}, ${lit(inv2)}, ${lit(sha(T2))}, ${lit(W)}, 'mitglied', 1`);
await q(`update public.fam_invites set expires_at = now() - interval '1 minute' where invite_id = ${lit(inv2)}`);
r = await rpc(C, 'fam_invite_accept', `${lit(inv2)}, ${lit(T2)}`);
check('accept: expired invite refused', !r.ok && r.reason === 'expired', r);
// Notfallkontakt Carla
const T3 = crypto.randomBytes(32).toString('hex'); const inv3 = id22();
r = await rpc(A, 'fam_invite_create', `${lit(G)}, ${lit(inv3)}, ${lit(sha(T3))}, NULL, 'notfall', 72`);
check('invite: Notfallkontakt invite', r.ok, r);
r = await rpc(C, 'fam_invite_accept', `${lit(inv3)}, ${lit(T3)}`);
check('Carla joins as Notfallkontakt without key', r.ok && r.role === 'notfall' && r.wrapped_key === null, r);
r = await rpc(C, 'fam_member_setkey', `${lit(G)}, ${lit('X'.repeat(120))}, 1, NULL`);
check('Notfallkontakt cannot set a key before release', !r.ok && r.reason === 'forbidden', r);

// ------------------------------------------------------------------ items + storage RLS
const blob1 = id22();
e = await err(upload(D, `${G}/${blob1}`, 1000));
check('storage: outsider cannot upload', e && /row-level security/.test(e.message), e && e.message);
e = await err(upload(C, `${G}/${blob1}`, 1000));
check('storage: Notfallkontakt cannot upload', e && /row-level security/.test(e.message), e && e.message);
e = await err(upload(B, `${G}/sub/${blob1}`, 1000));
check('storage: only <group>/<blob> paths', e && /row-level security/.test(e.message), e && e.message);
await upload(B, `${G}/${blob1}`, 1000);
check('storage: member uploads', true);
const it1 = id22();
r = await rpc(B, 'fam_item_put', `${lit(G)}, ${lit(it1)}, 'file', 0, ${lit('E'.repeat(80))}, ${lit(blob1)}, 999, NULL, 1`);
check('item: size must match the object', !r.ok && r.reason === 'size_mismatch', r);
r = await rpc(B, 'fam_item_put', `${lit(G)}, ${lit(it1)}, 'file', 0, ${lit('E'.repeat(80))}, ${lit(id22())}, 1000, NULL, 1`);
check('item: blob must exist', !r.ok && r.reason === 'no_blob', r);
r = await rpc(B, 'fam_item_put', `${lit(G)}, ${lit(it1)}, 'file', 0, ${lit('E'.repeat(80))}, ${lit(blob1)}, 1000, NULL, 1`);
check('item: put file', r.ok && r.version === 1, r);
r = await rpc(A, 'fam_item_put', `${lit(G)}, ${lit(it1)}, 'file', 0, ${lit('F'.repeat(80))}, ${lit(blob1)}, 1000, NULL, 1`);
check('item: stale base version → conflict', !r.ok && r.reason === 'conflict' && r.item.version === 1, r);
const it2 = id22();
r = await rpc(A, 'fam_item_put', `${lit(G)}, ${lit(it2)}, 'reminder', 0, ${lit('R'.repeat(60))}, NULL, NULL, NULL, 1`);
check('item: put reminder', r.ok, r);
r = await rpc(C, 'fam_item_put', `${lit(G)}, ${lit(id22())}, 'note', 0, ${lit('R'.repeat(60))}, NULL, NULL, NULL, 1`);
check('item: Notfallkontakt cannot write', !r.ok && r.reason === 'forbidden', r);
r = await rpc(A, 'fam_items_list', `${lit(G)}, 0`);
check('items: Verwalter lists 2', r.ok && r.items.length === 2, r);
r = await rpc(C, 'fam_items_list', `${lit(G)}, 0`);
check('items: Notfallkontakt cannot list before release', !r.ok && r.reason === 'forbidden', r);
rows = await as(C, `select count(*) n from public.fam_items`);
check('RLS: Notfallkontakt cannot select items', rows[0].n === '0', rows);
rows = await as(C, `select count(*) n from storage.objects where bucket_id = 'family'`);
check('storage RLS: Notfallkontakt cannot read objects', rows[0].n === '0', rows);
rows = await as(D, `select count(*) n from storage.objects where bucket_id = 'family'`);
check('storage RLS: outsider cannot read objects', rows[0].n === '0', rows);
rows = await as(A, `select count(*) n from storage.objects where bucket_id = 'family'`);
check('storage RLS: Verwalter reads objects', rows[0].n === '1', rows);
r = await rpc(B, 'fam_item_delete', `${lit(G)}, ${lit(it1)}, 1`);
check('item: delete → tombstone + old blob', r.ok && r.old_blob === blob1, r);
r = await rpc(A, 'fam_items_list', `${lit(G)}, 2`);
check('items: cursor delivers the tombstone', r.ok && r.items.length === 1 && r.items[0].deleted === true, r);

// ------------------------------------------------------------------ roles
r = await rpc(A, 'fam_member_role', `${lit(G)}, ${lit(A)}, 'mitglied'`);
check('roles: last Verwalter cannot be demoted', !r.ok && r.reason === 'last_admin', r);
r = await rpc(B, 'fam_member_role', `${lit(G)}, ${lit(B)}, 'verwalter'`);
check('roles: Mitglied cannot promote itself', !r.ok && r.reason === 'forbidden', r);
r = await rpc(A, 'fam_member_remove', `${lit(G)}, ${lit(A)}`);
check('roles: last Verwalter cannot leave', !r.ok && r.reason === 'last_admin', r);
r = await rpc(A, 'fam_member_role', `${lit(G)}, ${lit(C)}, 'mitglied'`);
check('roles: Notfallkontakt cannot be promoted directly', !r.ok && r.reason === 'emergency_contact', r);

// ------------------------------------------------------------------ Notfallzugang
r = await rpc(A, 'fam_emergency_setup', `${lit(G)}, ${lit(B)}, 7, ${lit('S'.repeat(120))}, 1`);
check('emergency: contact must have role notfall', !r.ok && r.reason === 'not_contact', r);
r = await rpc(B, 'fam_emergency_setup', `${lit(G)}, ${lit(C)}, 7, ${lit('S'.repeat(120))}, 1`);
check('emergency: only Verwalter sets up', !r.ok && r.reason === 'forbidden', r);
r = await rpc(A, 'fam_emergency_setup', `${lit(G)}, ${lit(C)}, 7, ${lit('S'.repeat(120))}, 1`);
check('emergency: setup with escrow', r.ok, r);
r = await rpc(C, 'fam_emergency_claim', lit(G));
check('emergency: claim before request → not_requested', !r.ok && r.reason === 'not_requested', r);
r = await rpc(C, 'fam_emergency_request', lit(G));
check('emergency: request → angefragt, release in 7 days', r.ok && r.state === 'angefragt' && new Date(r.release_at) - Date.now() > 6.9 * 864e5, r);
r = await rpc(C, 'fam_emergency_claim', lit(G));
check('emergency: claim during waiting period → waiting, no key', !r.ok && r.reason === 'waiting' && !r.wrapped_key, r);
r = await rpc(A, 'fam_overview');
check('emergency: Verwalter sees the pending request', r.groups[0].emergency.length === 1 && r.groups[0].emergency[0].state === 'angefragt' && r.groups[0].emergency[0].contact_email === 'carla@example.com', r.groups[0].emergency);
r = await rpc(A, 'fam_emergency_decide', `${lit(G)}, ${lit(C)}, 'ablehnen'`);
check('emergency: Verwalter declines', r.ok, r);
r = await rpc(C, 'fam_emergency_claim', lit(G));
check('emergency: declined → no key', !r.ok && r.reason === 'not_requested' && r.state === 'abgelehnt', r);
r = await rpc(C, 'fam_emergency_request', lit(G));
check('emergency: new request blocked for 24 h after a decline', !r.ok && r.reason === 'declined_recently', r);
await q(`update public.fam_emergency set decided_at = now() - interval '2 days' where group_id = ${lit(G)}`);
r = await rpc(C, 'fam_emergency_request', lit(G));
check('emergency: request again later', r.ok && r.state === 'angefragt', r);
await q(`update public.fam_emergency set release_at = now() - interval '1 minute' where group_id = ${lit(G)}`);
r = await rpc(C, 'fam_overview');
check('emergency: contact sees "ready"', r.groups[0].emergency.length === 1 && r.groups[0].emergency[0].ready === true && r.groups[0].emergency[0].me === true, r.groups[0].emergency);
r = await rpc(C, 'fam_emergency_claim', lit(G));
check('emergency: claim after the waiting period returns the escrow', r.ok && r.wrapped_key === 'S'.repeat(120), r);
r = await rpc(C, 'fam_items_list', `${lit(G)}, 0`);
check('emergency: released contact can read items', r.ok && r.items.length === 2, r);
r = await rpc(C, 'fam_item_put', `${lit(G)}, ${lit(id22())}, 'note', 0, ${lit('R'.repeat(60))}, NULL, NULL, NULL, 1`);
check('emergency: released contact still cannot write', !r.ok && r.reason === 'forbidden', r);
r = await rpc(A, 'fam_emergency_revoke', `${lit(G)}, ${lit(C)}`);
check('emergency: revoke', r.ok, r);
r = await rpc(C, 'fam_items_list', `${lit(G)}, 0`);
check('emergency: after revoke no server access', !r.ok && r.reason === 'forbidden', r);
// immediate release by the Verwalter
r = await rpc(A, 'fam_emergency_setup', `${lit(G)}, ${lit(C)}, 30, ${lit('S'.repeat(120))}, 1`);
await rpc(C, 'fam_emergency_request', lit(G));
r = await rpc(A, 'fam_emergency_decide', `${lit(G)}, ${lit(C)}, 'freigeben'`);
check('emergency: Verwalter can release immediately', r.ok, r);
r = await rpc(C, 'fam_emergency_claim', lit(G));
check('emergency: claim after immediate release', r.ok && r.wrapped_key, r);

// ------------------------------------------------------------------ leave / remove / delete / purge
r = await rpc(B, 'fam_member_remove', `${lit(G)}, ${lit(A)}`);
check('remove: Mitglied cannot remove others', !r.ok && r.reason === 'forbidden', r);
r = await rpc(B, 'fam_member_remove', `${lit(G)}, ${lit(B)}`);
check('leave: Ben leaves', r.ok, r);
rows = await as(B, `select count(*) n from storage.objects where bucket_id = 'family'`);
check('leave: no more access to the files', rows[0].n === '0', rows);
r = await rpc(D, 'fam_group_delete', lit(G));
check('delete: outsider cannot delete', !r.ok && r.reason === 'forbidden', r);
await q(`update public.fam_items set deleted_at = now() - interval '40 days' where deleted`);
r = JSON.parse((await q(`select private.fam_purge()::text r`))[0].r);
check('purge: old tombstones + used/expired invites', r.tombstones === 1 && r.invites >= 0, r);
r = await rpc(A, 'fam_group_delete', lit(G));
check('delete: Verwalter deletes the folder (1 object left for the device to remove)', r.ok && r.remaining_objects === 1, r);
rows = await q(`select (select count(*) from public.fam_members) m, (select count(*) from public.fam_items) i, (select count(*) from public.fam_emergency) e`);
check('delete: cascade removes members, items, emergency rows', rows[0].m === '0' && rows[0].i === '0' && rows[0].e === '0', rows);
await q(`delete from auth.users where id = ${lit(D)}`);
rows = await q(`select count(*) n from public.fam_keys where user_id = ${lit(D)}`);
check('account deletion removes the family key', rows[0].n === '0', rows);

console.log(`\n${pass} passed, ${fail} failed`);
c.close && c.close();
process.exit(fail ? 1 : 0);
