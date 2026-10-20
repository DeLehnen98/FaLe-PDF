// SQL tests for supabase/migrations/20261020200000_fale_post.sql on the local PostgreSQL with the Supabase stub
// (all migrations applied like in CI). RPCs are called as „anon“ with the server secret – exactly like PostgREST.
//   node test_post_sql.mjs   (resets the database fale_post_sql)
import { connect, lit } from './acct/pgmini.mjs';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

const DB = process.env.PGDB || 'fale_post_sql';
execSync(`${new URL('./acct/reset_db.sh', import.meta.url).pathname} ${DB}`, { stdio: 'ignore' });
const c = await connect({ path: '/tmp/faleacct/.s.PGSQL.5544', database: DB });
const SECRET = 'test-rpc-secret-0123456789abcdefghijklmnop';
let pass = 0, fail = 0;
function check(name, cond, info = '') { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (info ? '  [' + JSON.stringify(info).slice(0, 400) + ']' : '')); } }
async function q(sql) { try { return await c.query(sql); } catch (e) { try { await c.query('rollback'); } catch {} throw e; } }
async function as(role, sql) { return q(`begin; set local role ${role}; ${sql}; commit;`); }
async function rpc(fn, args, role = 'anon') { const r = await as(role, `select public.${fn}(${args})::text as r`); return JSON.parse(r[0].r); }
async function err(p) { try { await p; return null; } catch (e) { return e; } }
const id22 = () => crypto.randomBytes(16).toString('base64url');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

const J = id22();
const create = (id, pdf = 'JVBERi0xLjc=') => rpc('fale_post_create', `${lit(SECRET)}, ${lit(id)}, ${lit('d'.repeat(64))}, ${lit(sha('cap'))}, ${lit(JSON.stringify({ pages: 1, registered: 'r1', intl: false }))}::jsonb, 499, 1, ${lit(pdf)}`);

let r = await create(J);
check('create', r.ok, r);
r = await create(J);
check('create twice → exists', !r.ok && r.reason === 'exists', r);
r = await rpc('fale_post_get', `${lit(SECRET)}, ${lit(J)}, false`);
check('get without PDF: no pdf field, options kept', r.ok && !('pdf' in r.job) && r.job.status === 'pending_payment' && r.job.options.registered === 'r1' && r.job.price_cents === 499, r);
r = await rpc('fale_post_get', `${lit(SECRET)}, ${lit(J)}, true`);
check('get with PDF (only for the hand-over)', r.ok && r.job.pdf === 'JVBERi0xLjc=', r);
r = await rpc('fale_post_patch', `${lit(SECRET)}, ${lit(J)}, 'pending_payment', ${lit(JSON.stringify({ status: 'paid', payment_intent: 'pi_1', paid_at: new Date().toISOString() }))}::jsonb`);
check('patch pending → paid', r.ok && r.job.status === 'paid' && r.job.payment_intent === 'pi_1' && r.job.paid_at, r);
r = await rpc('fale_post_patch', `${lit(SECRET)}, ${lit(J)}, 'pending_payment', ${lit(JSON.stringify({ status: 'paid' }))}::jsonb`);
check('second pending → paid refused (exactly one hand-over)', !r.ok && r.reason === 'status' && r.status === 'paid', r);
r = await rpc('fale_post_patch', `${lit(SECRET)}, ${lit(J)}, 'paid', ${lit(JSON.stringify({ status: 'submitted', provider_id: '6035143', pdf: null }))}::jsonb`);
const g = await rpc('fale_post_get', `${lit(SECRET)}, ${lit(J)}, true`);
check('patch paid → submitted, PDF removed', r.ok && g.job.status === 'submitted' && g.job.pdf === null && g.job.provider_id === '6035143', g);
r = await rpc('fale_post_patch', `${lit(SECRET)}, ${lit(J)}, null, ${lit(JSON.stringify({ owner_hash: 'x' }))}::jsonb`);
check('patch: other fields refused', !r.ok && r.reason === 'bad_field', r);
let e = await err(rpc('fale_post_patch', `${lit(SECRET)}, ${lit(J)}, null, ${lit(JSON.stringify({ status: 'lost' }))}::jsonb`));
check('patch: unknown status refused by the table', e && /check constraint/.test(e.message), e && e.message);
e = await err(rpc('fale_post_get', `${lit('wrong-secret-0123456789abcdefghijklmnop')}, ${lit(J)}, true`));
check('wrong server secret → forbidden', e && /forbidden/.test(e.message), e && e.message);
e = await err(as('anon', 'select * from public.post_jobs'));
check('table not readable directly (anon)', e && /permission denied/.test(e.message), e && e.message);
e = await err(as('authenticated', `select public.fale_post_get(${lit(SECRET)}, ${lit(J)}, true)`));
check('RPCs not callable as a signed-in user', e && /permission denied/.test(e.message), e && e.message);
e = await err(rpc('fale_post_create', `${lit(SECRET)}, 'bad id!', ${lit('d'.repeat(64))}, ${lit(sha('x'))}, '{}'::jsonb, 499, 1, null`));
check('bad id rejected', e && /check constraint/.test(e.message), e && e.message);
e = await err(rpc('fale_post_create', `${lit(SECRET)}, ${lit(id22())}, ${lit('d'.repeat(64))}, ${lit(sha('x'))}, '{}'::jsonb, 20000, 1, null`));
check('absurd price rejected', e && /check constraint/.test(e.message), e && e.message);

// unpaid: PDF dropped after 24 h; rows deleted after 180 days
const U = id22();
await create(U);
await q(`update public.post_jobs set created_at = now() - interval '25 hours' where id = ${lit(U)}`);
r = await rpc('fale_post_get', `${lit(SECRET)}, ${lit(U)}, true`);
check('unpaid after 24 h: PDF gone, canceled', r.ok && r.job.pdf === null && r.job.status === 'canceled', r);
await q(`update public.post_jobs set created_at = now() - interval '181 days' where id = ${lit(J)}`);
const p = await q(`select private.fale_post_purge()::text as r`);
r = await rpc('fale_post_get', `${lit(SECRET)}, ${lit(J)}, false`);
check('purge: rows older than 180 days deleted', JSON.parse(p[0].r).deleted >= 1 && !r.ok && r.reason === 'not_found', p);
r = await rpc('fale_post_delete', `${lit(SECRET)}, ${lit(U)}`);
check('delete', r.ok && r.deleted, r);

console.log(`\n${pass}/${pass + fail} passed`);
await c.end?.();
process.exit(fail ? 1 : 0);
