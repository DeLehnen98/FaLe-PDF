// API tests for the Notfallzugang (/api/drive?a=em.*) against the REAL SQL migrations in the local PostgreSQL,
// with the reference client js/one/api.js + crypto.js. Clock: release_at / closed_at are shifted in the DB
// ("fast-forward"), so the boundary (one minute before / after) is tested exactly.
//   node test_nf_api.mjs        (harness on 8930/8931, database fale_nf_api)
process.env.PGDB = process.env.PGDB || 'fale_nf_api';
import crypto from 'node:crypto';
const { startHarness } = await import('../acct/account_harness.mjs');
const K = await import('/home/claude/FalePDF/js/one/crypto.js');
const { createClient } = await import('/home/claude/FalePDF/js/one/api.js');

const PORT = 8930;
const { SB } = await startHarness(PORT);
const APP = `http://127.0.0.1:${PORT}`;
const PKEY = 'sb_publishable_test_key_0123456789';
let pass = 0, fail = 0;
function check(name, cond, info = '') { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (info !== '' ? '  [' + JSON.stringify(info).slice(0, 700) + ']' : '')); } }
const T = (p, o) => fetch(APP + p, o).then(r => r.json());
const sql = async (q) => { const r = await T('/__test/sql', { method: 'POST', body: q }); if (r.error) throw new Error(r.error + ' :: ' + q.slice(0, 300)); return r.rows; };
const bytes = n => new Uint8Array(crypto.randomBytes(n));
const eq = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const err = async p => { try { await p; return null; } catch (e) { return e; } };
const te = new TextEncoder();

async function sbPost(path, body, token) {
  const h = { apikey: PKEY, 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  const r = await fetch(SB + path, { method: 'POST', headers: h, body: JSON.stringify(body) });
  return r.json().catch(() => null);
}
async function signIn(email) {
  await sbPost('/auth/v1/otp', { email, create_user: true });
  const { code } = await T(`/__test/otp?email=${encodeURIComponent(email)}`);
  const s = await sbPost('/auth/v1/verify', { type: 'email', email, token: code });
  const mk = await K.importMasterRaw(new Uint8Array(crypto.randomBytes(32)));
  const keys = await K.deriveKeys(mk, s.user.id);
  const one = createClient({ baseUrl: APP, getToken: async () => s.access_token, retries: 1, retryDelayMs: 10 });
  return { token: s.access_token, id: s.user.id, email, mk, keys, one };
}
async function api(a, body, { token, query = '' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${APP}/api/drive?a=${a}${query}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
  const buf = Buffer.from(await r.arrayBuffer());
  let j = null; try { j = JSON.parse(buf.toString('utf8')); } catch {}
  return { status: r.status, ...(j || {}), _buf: buf };
}
async function folder(U, name, parentId = null) {
  const nodeId = K.uuid();
  const nk = await K.createNodeKey(U.keys, nodeId);
  const meta = await K.sealMeta(nk.key, { userId: U.id, kind: 'folder', id: nodeId }, { v: 1, name });
  return (await U.one.mkdir({ nodeId, parentId, key: nk.wrapped, meta })).node;
}
const upload = async (U, name, data, parentId, extra = {}) => (await U.one.uploadFile({ keys: U.keys, file: data, name, parentId, ...extra })).node;
/** Wanted set: subtree of the roots + albums (+ members) from the owner's live tree */
async function wanted(U, roots, albumIds = []) {
  const all = [];
  for (let after = null; ;) { const r = await U.one.exportPage(after, 500); all.push(...r.nodes); if (!r.next) { var albs = r.albums || albs; break; } after = r.next; if (!albs) albs = r.albums; }
  const byParent = new Map();
  for (const n of all) { if (!byParent.has(n.parent)) byParent.set(n.parent, []); byParent.get(n.parent).push(n); }
  const out = new Map();
  const walk = n => { if (n.trashedAt) return; out.set(n.id, n); for (const c of byParent.get(n.id) || []) walk(c); };
  for (const r of roots) { const n = all.find(x => x.id === r); if (n) walk(n); }
  const albums = (albs || []).filter(a => albumIds.includes(a.id));
  for (const a of albums) for (const id of a.items || []) { const n = all.find(x => x.id === id); if (n && !n.trashedAt) out.set(n.id, n); }
  return { nodes: [...out.values()].map(n => ({ id: n.id, key: n.key })), albums: albums.map(a => ({ id: a.id, key: a.key })) };
}
const shiftRelease = (setupId, interval) => sql(`update public.one_em_requests set release_at = release_at - interval '${interval}', threshold_at = threshold_at - interval '${interval}', started_at = started_at - interval '${interval}' where setup_id = '${setupId}' and status = 'waiting'`);
const names = l => l.nodes.filter(n => n.meta).map(n => n.meta.name).sort();

// ================================================================== setup
await T('/__test/reset?ONE_CHUNK_KB=64');
let r = await api('config');
check('config: emergency available, notify off by default (honest UI)', r.configured === true && r.emergency === true && r.notify === false, r);

const O = await signIn('anna@example.com');      // owner
const B = await signIn('ben@example.com');       // contact 1
const C = await signIn('clara@example.com');     // contact 2
const D = await signIn('dora@example.com');      // stranger
const E = await signIn('emil@example.com');      // contact 3 (removed later)

const nf = await folder(O, 'Notfallordner');
const sub = await folder(O, 'Vollmachten & Verfügungen', nf.id);
const doc1 = bytes(150000);
const f1 = await upload(O, 'Testament-GEHEIM.pdf', doc1, sub.id, { thumb: bytes(900) });
const f2 = await upload(O, 'Versicherungen.txt', te.encode('Police 4711 GEHEIM-NOTFALL'), nf.id);
const priv = await folder(O, 'Privat');
const fp = await upload(O, 'Tagebuch-PRIVAT.txt', te.encode('privat'), priv.id);
const photo = await upload(O, 'Familie.jpg', bytes(5000), priv.id, { kind: 'photo', thumb: bytes(700) });
const albumId = K.uuid(), ak = await K.createAlbumKey(O.keys, albumId);
await O.one.albumPut({ albumId, baseVersion: 0, key: ak.wrapped, meta: await K.sealMeta(ak.key, { userId: O.id, kind: 'album', id: albumId }, { v: 1, name: 'Familienfotos' }) });
await O.one.albumItems(albumId, [photo.id]);

// identity + setup
const oid = await O.one.emIdentityEnsure({ mk: O.mk, userId: O.id });
check('identity: created on first use (fam_keys) and re-opened afterwards', oid.created === true && (await O.one.emIdentityEnsure({ mk: O.mk, userId: O.id })).kid === oid.kid);
const [fk] = await sql(`select key_id from public.fam_keys where user_id = '${O.id}'`);
check('identity: stored in the family-folder key table (one key per account)', fk && fk.key_id === oid.kid, fk);
r = await api('em.setup', { setupId: K.uuid(), baseVersion: 0, waitHours: 100, ownerKey: 'x'.repeat(82), ownerKid: oid.kid, scope: 'x'.repeat(40) }, { token: O.token });
check('setup: waiting period must be one of 24 h / 3 / 7 / 14 / 30 days', r.status === 400, r);
const scope = { v: 1, mode: 'items', roots: [nf.id], albums: [albumId], checklist: true };
const cr = await O.one.emCreate({ keys: O.keys, ownerKid: oid.kid, waitHours: 168, scope });
let own = cr.own;
const SID = cr.setupId;
check('setup: created (7 days, threshold 1, no contacts yet)', own.setup.id === SID && own.setup.waitHours === 168 && own.setup.threshold === 1 && own.contacts.length === 0, own);
r = await api('em.setup', { setupId: K.uuid(), baseVersion: 0, waitHours: 24, ownerKey: own.setup.ownerKey, ownerKid: oid.kid, scope: own.setup.scope }, { token: O.token });
check('setup: one Notfallzugang per account (second → 409 exists)', r.status === 409 && r.error === 'exists', r);
check('setup: scope envelope opens for the owner only with EK', (await O.one.emScope(O.keys, own)).roots[0] === nf.id);

// covered keys
const w1 = await wanted(O, [nf.id], [albumId]);
let sk = await O.one.emSyncKeys({ keys: O.keys, own, nodes: w1.nodes, albums: w1.albums });
check('keys: covered subtree (4) + album + album member wrapped by EK (6 items)', sk.added === 6 && sk.removed === 0, sk);
sk = await O.one.emSyncKeys({ keys: O.keys, own, nodes: w1.nodes, albums: w1.albums });
check('keys: unchanged set → digest says nothing to do', sk.added === 0 && sk.removed === 0, sk);
r = await api('em.keys.put', { setupId: SID, items: [{ kind: 'node', id: (await folder(D, 'Fremd')).id, key: 'A'.repeat(82) }] }, { token: O.token });
check('keys: a foreign node id is skipped (FK on the owner\'s own nodes)', r.ok && r.added === 0 && r.skipped === 1, r);
r = await api('em.keys.put', { setupId: SID, items: [{ kind: 'node', id: nf.id, key: 'A'.repeat(82) }] }, { token: D.token });
check('keys: another account cannot write into the setup', r.status === 404, r);

// ================================================================== invitations
r = await api('em.invite', { setupId: SID, email: 'anna@example.com' }, { token: O.token });
check('invite: not yourself', r.status === 400 && r.error === 'self', r);
r = await api('em.invite', { setupId: SID, email: 'kein-at' }, { token: O.token });
check('invite: invalid address → 400', r.status === 400, r);
r = await O.one.emInvite(SID, 'Ben@Example.com');
check('invite: stored lower-case, slot 1, mailed=false without a notifier', r.slot === 1 && r.mailed === false && r.own.contacts[0].email === 'ben@example.com' && r.own.contacts[0].status === 'invited', r);
await O.one.emInvite(SID, 'clara@example.com');
await O.one.emInvite(SID, 'emil@example.com');
r = await api('em.invite', { setupId: SID, email: 'dora@example.com' }, { token: O.token });
check('invite: at most 3 trusted contacts', r.status === 409 && r.error === 'too_many', r);
let [ob] = await sql(`select count(*) n from private.fale_em_outbox where kind = 'invite' and to_email = 'ben@example.com'`);
check('invite: notification queued in the outbox (pluggable notifier)', +ob.n === 1, ob);

let sb = await B.one.emStatus();
check('contact: sees the invitation addressed to their e-mail (owner e-mail, wait, slot)', sb.others.length === 1 && sb.others[0].status === 'invited' && sb.others[0].ownerEmail === 'anna@example.com' && sb.others[0].waitHours === 168, sb);
check('contact: no own setup', sb.own === null);
const sd = await D.one.emStatus();
check('stranger: sees nothing', sd.others.length === 0 && sd.own === null, sd);
r = await api('em.accept', { setupId: SID }, { token: D.token });
check('accept: only the invited address can accept (bound to the e-mail)', r.status === 404, r);
r = await api('em.accept', { setupId: SID }, { token: B.token });
check('accept: needs the identity key first', r.status === 409 && r.error === 'no_key', r);
const bid = await B.one.emIdentityEnsure({ mk: B.mk, userId: B.id });
r = await B.one.emAccept(SID);
check('accept: → accepted with the contact key id', r.status === 'accepted' && r.kid === bid.kid, r);
check('accept: idempotent', (await B.one.emAccept(SID)).status === 'accepted');

// safety code: both sides compute the same code; a substituted key changes it and sealing fails
own = (await O.one.emStatus()).own;
const cB = own.contacts.find(c => c.slot === 1);
const sasOwner = await K.safetyCode({ setupId: SID, ownerId: O.id, ownerKid: oid.kid, contactId: cB.contactId, contactKid: cB.kid });
sb = await B.one.emStatus();
const sasContact = await K.safetyCode({ setupId: SID, ownerId: sb.others[0].ownerId, ownerKid: sb.others[0].ownerKid, contactId: B.id, contactKid: bid.kid });
check('safety code: owner and contact see the same emoji + digits', sasOwner.digits === sasContact.digits && sasOwner.hex === sasContact.hex, [sasOwner.digits, sasContact.digits]);
// MITM: the server swaps B's key for an attacker key
const evil = await K.identityCreate(D.mk, D.id);
await sql(`update public.one_em_contacts set contact_kid = '${evil.kid}', contact_pub = '${JSON.stringify(evil.publicJwk)}'::jsonb where setup_id = '${SID}' and slot = 1`);
const ownEvil = (await O.one.emStatus()).own;
const ce = ownEvil.contacts.find(c => c.slot === 1);
const sasEvil = await K.safetyCode({ setupId: SID, ownerId: O.id, ownerKid: oid.kid, contactId: ce.contactId, contactKid: ce.kid });
check('MITM: a substituted contact key gives a different safety code (owner would not confirm)', sasEvil.digits !== sasContact.digits);
await sql(`update public.one_em_contacts set contact_kid = '${bid.kid}', contact_pub = '${JSON.stringify(bid.publicJwk)}'::jsonb where setup_id = '${SID}' and slot = 1`);
const pkgWrongKid = await K.emSeal(bid.publicJwk, { purpose: 'share', ownerId: O.id, setupId: SID, from: O.id, to: B.id }, { x: 1 });
r = await api('em.seal', { setupId: SID, baseVersion: own.setup.version, threshold: 1, packages: [{ slot: 1, kid: evil.kid, package: pkgWrongKid }] }, { token: O.token });
check('seal: the key id must be the one the contact accepted with', r.status === 409 && r.error === 'key_changed', r);
r = await api('em.seal', { setupId: SID, baseVersion: own.setup.version, threshold: 1, packages: [{ slot: 2, kid: bid.kid, package: pkgWrongKid }] }, { token: O.token });
check('seal: an invited (not yet accepted) contact cannot be sealed', r.status === 409, r);
own = (await O.one.emStatus()).own;
own = await O.one.emReseal({ keys: O.keys, own, threshold: 1, confirm: [1] });
check('seal: owner confirms after comparing → contact active, threshold 1', own.contacts.find(c => c.slot === 1).status === 'active' && own.setup.threshold === 1, own.contacts);
const [pk] = await sql(`select package from public.one_em_contacts where setup_id = '${SID}' and slot = 1`);
check('seal: package is ciphertext for B only (≈ 0x01 ‖ eph ‖ iv ‖ ct)', K.unb64u(pk.package)[0] === 1 && !(await err(K.emOpen(bid.privateKey, { purpose: 'share', ownerId: O.id, setupId: SID, from: O.id, to: B.id }, pk.package)))
  && !!(await err(K.emOpen(evil.privateKey, { purpose: 'share', ownerId: O.id, setupId: SID, from: O.id, to: B.id }, pk.package))));

// ================================================================== time lock
sb = await B.one.emStatus();
check('contact: active, not readable, no request yet', sb.others[0].status === 'active' && !sb.others[0].readable && !sb.others[0].request, sb.others[0]);
r = await api('em.package', { setupId: SID }, { token: B.token });
check('before any request: package locked (403)', r.status === 403 && r.error === 'locked', r);
r = await B.one.emRequest(SID);
const rel0 = Date.parse(r.request.releaseAt), st0 = Date.parse(r.request.thresholdAt);
check('request: waiting, release exactly 7 days after the request', r.request.status === 'waiting' && Math.abs(rel0 - st0 - 168 * 3600e3) < 1000 && r.joined, r.request);
check('request: owner notified (outbox) and logged', +(await sql(`select count(*) n from private.fale_em_outbox where kind = 'request'`))[0].n === 1 && (await O.one.emStatus()).own.log.some(l => l.event === 'request' && l.slot === 1));
check('request: owner sees the open request with release time', (await O.one.emStatus()).own.request.status === 'waiting');
for (const a of ['em.package', 'em.items']) { r = await api(a, { setupId: SID }, { token: B.token }); check(`waiting: ${a} locked`, r.status === 403 && r.error === 'locked', r); }
r = await fetch(`${APP}/api/drive?a=em.get&s=${SID}&b=${f1.head.blobs.find(b => b.purpose === 'content').id}&i=0`, { method: 'POST', headers: { Authorization: `Bearer ${B.token}` } });
check('waiting: chunks not served', r.status === 404);
await shiftRelease(SID, '167 hours 59 minutes');
sb = await B.one.emStatus();
check('clock: one minute before the end → still locked', !sb.others[0].readable && sb.others[0].request.status === 'waiting', sb.others[0].request);
// deny with one tap
r = await O.one.emDeny(SID);
check('deny: one tap during the waiting period', r.own.request === null && r.own.lastClosed.status === 'denied', r.own.lastClosed);
await shiftRelease(SID, '10 minutes');
sb = await B.one.emStatus();
check('deny: nothing is released afterwards', !sb.others[0].readable && sb.others[0].lastClosed.status === 'denied', sb.others[0]);
r = await api('em.request', { setupId: SID }, { token: B.token });
check('deny: new request only after the cooldown (24 h)', r.status === 429 && r.error === 'cooldown' && r.retryAt, r);
await sql(`update public.one_em_requests set closed_at = closed_at - interval '25 hours' where setup_id = '${SID}'`);
r = await B.one.emRequest(SID);
check('after the cooldown: new request', r.request.status === 'waiting', r);
await shiftRelease(SID, '168 hours 1 minute');
sb = await B.one.emStatus();
check('clock: waiting period over without veto → released, readable', sb.others[0].readable && sb.others[0].request.status === 'released', sb.others[0].request);
r = await O.one.emStatus();
check('owner: release logged + notification queued', r.own.log.some(l => l.event === 'released') && +(await sql(`select count(*) n from private.fale_em_outbox where kind in ('released_owner','released_contact')`))[0].n === 2);
r = await api('em.deny', { setupId: SID }, { token: O.token });
check('deny after release → 409 released (use revoke)', r.status === 409 && r.error === 'released', r);

// ================================================================== contact reads exactly the covered items
const ub = await B.one.emUnlock({ setupId: SID, userId: B.id, privateKey: bid.privateKey });
check('unlock: EK recovered and verified (k = 1)', ub.ek && ub.ownerId === O.id && eq(ub.ek, await O.one.emOwnerKey(O.keys, own)));
let L = await B.one.emLoad({ setupId: SID, ek: ub.ek });
check('load: exactly the covered items (Notfallordner subtree + album + its photo), nothing from "Privat"',
  JSON.stringify(names(L)) === JSON.stringify(['Familie.jpg', 'Notfallordner', 'Testament-GEHEIM.pdf', 'Versicherungen.txt', 'Vollmachten & Verfügungen']) && L.albums[0].meta.name === 'Familienfotos' && L.albums[0].items[0] === photo.id, names(L));
check('load: scope readable for the contact', L.scope && L.scope.mode === 'items' && L.scope.roots[0] === nf.id, L.scope);
const nT = L.nodes.find(n => n.meta && n.meta.name === 'Testament-GEHEIM.pdf');
const got = await B.one.emDownload({ setupId: SID, ownerId: O.id, node: nT.raw, nodeKey: nT.nodeKey });
check('download: decrypted and verified (size + digest), equals the original', eq(got, doc1));
r = await B.one.emThumbs(SID, [f1.head.blobs.find(b => b.purpose === 'thumb').id, photo.head.blobs.find(b => b.purpose === 'thumb').id, fp.head.blobs.find(b => b.purpose === 'content').id]);
check('thumbs: covered thumbnails only', Object.keys(r.thumbs).length === 2, Object.keys(r.thumbs));
r = await fetch(`${APP}/api/drive?a=em.get&s=${SID}&b=${fp.head.blobs.find(b => b.purpose === 'content').id}&i=0`, { method: 'POST', headers: { Authorization: `Bearer ${B.token}` } });
check('get: a blob of an uncovered file → 404', r.status === 404);
r = await api('get', {}, { token: B.token, query: `&b=${f1.head.blobs[0].id}&i=0` });
check('get: the normal drive API never serves the owner\'s blobs to the contact', r.status === 404, r.status);
for (const U of [D, C]) { r = await api('em.items', { setupId: SID }, { token: U.token }); check(`released: ${U === D ? 'stranger' : 'non-requesting / not yet confirmed contact'} still locked`, r.status === 403, r); }
// read-only: the contact has no write path into the owner's drive
r = await api('update', { nodeId: nT.raw.id, baseVersion: nT.raw.version, meta: nT.raw.meta }, { token: B.token });
check('read-only: contact cannot modify the owner\'s items', r.status === 404, r);
// new file in a covered folder after the release → added on the owner's next sync, visible to the contact
const f3 = await upload(O, 'Patientenverfügung-NEU.pdf', bytes(3000), sub.id);
await O.one.emSyncKeys({ keys: O.keys, own, ...(await wanted(O, [nf.id], [albumId])) });
L = await B.one.emLoad({ setupId: SID, ek: ub.ek });
check('new file in a covered folder becomes accessible (owner device re-wraps on sync)', names(L).includes('Patientenverfügung-NEU.pdf'));
// trashed item disappears for the contact at once (server filter), even before the owner's devices re-sync
await O.one.trash(f2.id);
L = await B.one.emLoad({ setupId: SID, ek: ub.ek });
check('trashed item hidden from the contact immediately', !names(L).includes('Versicherungen.txt'));
await O.one.restore(f2.id);
// moved out of the covered folder → the owner's sync removes the wrap
await O.one.update({ nodeId: f3.id, baseVersion: 1, parentId: priv.id });
sk = await O.one.emSyncKeys({ keys: O.keys, own, ...(await wanted(O, [nf.id], [albumId])) });
L = await B.one.emLoad({ setupId: SID, ek: ub.ek });
check('moved out of the covered folder → no longer accessible after the owner\'s sync', sk.removed === 1 && !names(L).includes('Patientenverfügung-NEU.pdf'), sk);
// log: request / deny / release / views / downloads visible to the owner
const log = (await O.one.emLog()).log;
const ev = new Set(log.map(l => l.event));
check('log: every request, veto, release, key pick-up, view and download is visible to the owner',
  ['setup_created', 'contact_invited', 'contact_accepted', 'contact_confirmed', 'request', 'denied', 'released', 'key_fetched', 'viewed', 'download'].every(e => ev.has(e)), [...ev]);
check('log: download entry names the node id (owner maps it to the name locally)', log.some(l => l.event === 'download' && l.detail && l.detail.node === f1.id));

// revoke at any time
own = (await O.one.emRevoke(SID)).own;
check('revoke: request closed', own.request === null && own.lastClosed.status === 'revoked');
r = await api('em.items', { setupId: SID }, { token: B.token });
const r2 = await fetch(`${APP}/api/drive?a=em.get&s=${SID}&b=${f1.head.blobs.find(b => b.purpose === 'content').id}&i=0`, { method: 'POST', headers: { Authorization: `Bearer ${B.token}` } });
check('revoke: items + chunks no longer served', r.status === 403 && r2.status === 404);

// ================================================================== k of n (2 of 3)
await sql(`update public.one_em_requests set closed_at = closed_at - interval '25 hours' where setup_id = '${SID}'`);
const cid = await C.one.emIdentityEnsure({ mk: C.mk, userId: C.id });
const eid = await E.one.emIdentityEnsure({ mk: E.mk, userId: E.id });
await C.one.emAccept(SID); await E.one.emAccept(SID);
own = (await O.one.emStatus()).own;
own = await O.one.emReseal({ keys: O.keys, own, threshold: 2, confirm: [2, 3] });
check('2 of 3: three active contacts, threshold 2', own.setup.threshold === 2 && own.contacts.every(c => c.status === 'active'), own.contacts.map(c => c.status));
const [pk2] = await sql(`select package from public.one_em_contacts where setup_id = '${SID}' and slot = 1`);
check('2 of 3: re-seal replaced B\'s package (fresh split)', pk2.package !== pk.package);
r = await B.one.emRequest(SID);
check('2 of 3: one request alone does not start the waiting period', r.request.status === 'waiting' && r.request.releaseAt === null && r.request.requesters.length === 1, r.request);
await sql(`update public.one_em_requests set started_at = started_at - interval '20 days' where setup_id = '${SID}' and status = 'waiting'`);
sb = await B.one.emStatus();
check('2 of 3: still locked after 20 days with one requester', !sb.others.find(x => x.setupId === SID).readable);
// a malicious server releases early with ONE contact: that contact still cannot decrypt anything
await sql(`update public.one_em_requests set status = 'released', released_at = now(), threshold_at = now(), release_at = now() where setup_id = '${SID}' and status = 'waiting'`);
let u1 = await B.one.emUnlock({ setupId: SID, userId: B.id, privateKey: bid.privateKey });
check('early release by the server + one contact → only one share, no key', u1.waiting && u1.waiting.have === 1 && u1.waiting.need === 2 && !u1.ek, u1);
await sql(`update public.one_em_requests set status = 'waiting', released_at = null, threshold_at = null, release_at = null where setup_id = '${SID}' and status = 'released'`);
r = await C.one.emRequest(SID);
check('2 of 3: second request → waiting period starts now (7 days)', r.request.releaseAt && Math.abs(Date.parse(r.request.releaseAt) - Date.parse(r.request.thresholdAt) - 168 * 3600e3) < 1000 && r.request.requesters.length === 2, r.request);
r = await api('em.package', { setupId: SID }, { token: C.token });
check('2 of 3: still locked during the waiting period', r.status === 403);
await shiftRelease(SID, '169 hours');
u1 = await B.one.emUnlock({ setupId: SID, userId: B.id, privateKey: bid.privateKey });
check('2 of 3: first contact pools its share, waits for the other', u1.waiting && u1.waiting.have === 1, u1);
const [pl] = await sql(`select count(*) n from public.one_em_pool`);
check('pool: B\'s share re-sealed for C only (E did not ask)', +pl.n === 1, pl);
const u2 = await C.one.emUnlock({ setupId: SID, userId: C.id, privateKey: cid.privateKey });
check('2 of 3: second contact combines B\'s pooled share with its own → verified EK', u2.ek && eq(u2.ek, ub.ek));
u1 = await B.one.emUnlock({ setupId: SID, userId: B.id, privateKey: bid.privateKey });
check('2 of 3: first contact now also has the key', u1.ek && eq(u1.ek, ub.ek));
r = await api('em.items', { setupId: SID }, { token: E.token });
check('2 of 3: the contact who did not ask has no access', r.status === 403);
// tamper: the server swaps C's pooled share for a well-formed fake → detected, never a wrong key
const fakeY = K.b64u(bytes(32));
const fake = await K.emSeal(bid.publicJwk, { purpose: 'pool', ownerId: O.id, setupId: SID, from: C.id, to: B.id }, { v: 1, t: 'pool', setupId: SID, from: 2, x: 2, y: fakeY });
await sql(`update public.one_em_pool set sealed = '${fake}' where to_slot = 1`);
const tam = await err(B.one.emUnlock({ setupId: SID, userId: B.id, privateKey: bid.privateKey }));
check('tamper: forged pooled share → "tampered" (check value), no wrong key', tam && tam.code === 'tampered', tam && tam.code);
await sql(`update public.one_em_pool set sealed = 'AAAA' || substr(sealed, 5) where to_slot = 1`);
u1 = await B.one.emUnlock({ setupId: SID, userId: B.id, privateKey: bid.privateKey });
check('tamper: corrupted pooled share is ignored (AES-GCM) → waiting, not a wrong key', u1.waiting && !u1.ek, u1);
// pool only with keys the owner verified: a requester whose key the server swapped is skipped
await sql(`delete from public.one_em_pool`);
await sql(`update public.one_em_contacts set contact_pub = '${JSON.stringify(evil.publicJwk)}'::jsonb where setup_id = '${SID}' and slot = 2`);
await B.one.emUnlock({ setupId: SID, userId: B.id, privateKey: bid.privateKey });
const [pl2] = await sql(`select count(*) n from public.one_em_pool`);
check('pool: never seals a share to a key that is not in the owner\'s verified roster', +pl2.n === 0, pl2);
await sql(`update public.one_em_contacts set contact_pub = '${JSON.stringify(cid.publicJwk)}'::jsonb where setup_id = '${SID}' and slot = 2`);
r = await api('em.seal', { setupId: SID, baseVersion: own.setup.version, threshold: 1, packages: [{ slot: 1, kid: bid.kid, package: pk.package }] }, { token: O.token });
check('seal while released → 409 busy (revoke first)', r.status === 409 && r.error === 'busy', r);
// remove a contact: access ends at once
own = (await O.one.emRemove(SID, 2)).own;
r = await api('em.items', { setupId: SID }, { token: C.token });
check('remove contact: their access ends at once, slot freed', r.status === 403 && own.contacts.length === 2 && !own.contacts.some(c => c.slot === 2), r.status);
sb = await C.one.emStatus();
check('removed contact sees nothing any more', sb.others.length === 0, sb.others);
await O.one.emRevoke(SID);

// ================================================================== threshold before enough contacts are confirmed
{
  const P = await signIn('paula@example.com'), Q = await signIn('quentin@example.com'), R = await signIn('rosa@example.com');
  const pid = await P.one.emIdentityEnsure({ mk: P.mk, userId: P.id });
  const pf = await folder(P, 'Notfall');
  const c2 = await P.one.emCreate({ keys: P.keys, ownerKid: pid.kid, waitHours: 24, scope: { v: 1, mode: 'items', roots: [pf.id] }, threshold: 2 });
  check('setup: k of n chosen at creation (2)', c2.own.setup.threshold === 2, c2.own.setup);
  await P.one.emInvite(c2.setupId, 'quentin@example.com'); await P.one.emInvite(c2.setupId, 'rosa@example.com');
  const qid = await Q.one.emIdentityEnsure({ mk: Q.mk, userId: Q.id }); await Q.one.emAccept(c2.setupId);
  let po = (await P.one.emStatus()).own;
  po = await P.one.emReseal({ keys: P.keys, own: po, confirm: [1] });
  check('2 of 3 with one confirmed: sealed with k = 2 (not silently 1 of 1)', po.setup.threshold === 2 && po.contacts.find(c => c.slot === 1).status === 'active', po.setup);
  r = await api('em.request', { setupId: c2.setupId }, { token: Q.token });
  check('…and requests are refused until enough contacts are active', r.status === 409 && r.error === 'not_ready', r);
  r = await api('em.setup', { setupId: c2.setupId, baseVersion: po.setup.version, waitHours: 24, scope: c2.own.setup.scope, threshold: 1 }, { token: P.token });
  check('threshold change after activation must go through re-sealing', r.status === 409 && r.error === 'reseal', r);
  await R.one.emIdentityEnsure({ mk: R.mk, userId: R.id }); await R.one.emAccept(c2.setupId);
  po = await P.one.emReseal({ keys: P.keys, own: (await P.one.emStatus()).own, confirm: [2] });
  await Q.one.emRequest(c2.setupId); r = await R.one.emRequest(c2.setupId);
  await shiftRelease(c2.setupId, '25 hours');
  await Q.one.emUnlock({ setupId: c2.setupId, userId: Q.id, privateKey: qid.privateKey });
  const rid = await R.one.emIdentityEnsure({ mk: R.mk, userId: R.id });
  const ur = await R.one.emUnlock({ setupId: c2.setupId, userId: R.id, privateKey: rid.privateKey });
  check('…after the second confirmation 2 of 2 unlock works (fresh split replaced the early one)', ur.ek && eq(ur.ek, await P.one.emOwnerKey(P.keys, po)));
  await P.one.emDelete();
}

// ================================================================== RLS, grants, plaintext, export
let denied = 0;
for (const t of ['one_em_setups', 'one_em_contacts', 'one_em_requests', 'one_em_requesters', 'one_em_pool', 'one_em_node_keys', 'one_em_album_keys', 'one_em_log']) {
  for (const role of ['anon', 'authenticated']) {
    const x = await T('/__test/sql', { method: 'POST', body: `begin; set local role ${role}; select count(*) from public.${t}; commit;` });
    if (x.error && /permission denied/.test(x.error)) denied++;
  }
}
check('RLS/grants: anon + authenticated cannot read any emergency table (16/16 denied)', denied === 16, denied);
let x = await T('/__test/sql', { method: 'POST', body: `begin; set local role anon; select public.fale_em_status('wrong-secret-wrong-secret-wrong-secret-xx', '${O.id}'); commit;` });
check('RPC: wrong secret → forbidden', x.error && /forbidden/.test(x.error), x);
x = await T('/__test/sql', { method: 'POST', body: `begin; set local role authenticated; select public.fale_em_status('test-rpc-secret-0123456789abcdefghijklmnop', '${O.id}'); commit;` });
check('RPC: not executable by authenticated (only the API)', x.error && /permission denied/.test(x.error), x);
x = await T('/__test/sql', { method: 'POST', body: `select count(*) n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'fale_em_%' and not (p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=""%')` });
check('RPC: every fale_em_* is SECURITY DEFINER with an empty search_path', x.rows && x.rows[0].n === '0', x);
const dump = (await sql(`select string_agg(t, ' ') d from (
  select row_to_json(s)::text t from public.one_em_setups s union all select row_to_json(c)::text from public.one_em_contacts c
  union all select row_to_json(k)::text from public.one_em_node_keys k union all select row_to_json(k)::text from public.one_em_album_keys k
  union all select row_to_json(l)::text from public.one_em_log l union all select row_to_json(o)::text from private.fale_em_outbox o
  union all select row_to_json(p)::text from public.one_em_pool p union all select row_to_json(n)::text from public.one_nodes n) z`))[0].d;
const ekHex = Buffer.from(ub.ek).toString('hex'), ekB64 = K.b64u(ub.ek);
check('no plaintext in the DB: no names, no content markers, no EK (hex/base64)', !/GEHEIM|Testament|Versicherungen|Notfallordner|Familienfotos|Vollmachten/.test(dump) && !dump.includes(ekHex) && !dump.includes(ekB64), dump.length);
r = await O.one.exportPage();
check('export: first page includes the Notfallzugang (contacts, wait, covered ids, full log)', r.emergency && r.emergency.setup.id === SID && r.emergency.contacts.length === 2 && r.emergency.covered.nodes.includes(f1.id) && r.emergency.log.length > 10, r.emergency && Object.keys(r.emergency));
check('export: none for an account without setup', (await D.one.exportPage()).emergency === null);

// ================================================================== cron: release + expiry
await sql(`update public.one_em_requests set closed_at = closed_at - interval '25 hours' where setup_id = '${SID}'`);
await own; own = (await O.one.emStatus()).own;
own = await O.one.emReseal({ keys: O.keys, own, threshold: 1 });
await B.one.emRequest(SID);
await shiftRelease(SID, '169 hours');
const tick = { t: JSON.parse((await sql(`select private.fale_em_tick() t`))[0].t) };
check('cron: releases due requests (notifications go out on time)', tick.t.released === 1, tick);
await O.one.emRevoke(SID);
await sql(`update public.one_em_requests set closed_at = closed_at - interval '25 hours' where setup_id = '${SID}'`);
own = await O.one.emReseal({ keys: (O.keys), own: (await O.one.emStatus()).own, threshold: 2 });
await B.one.emRequest(SID);
await sql(`update public.one_em_requests set started_at = started_at - interval '31 days' where status = 'waiting'`);
const tick2 = { t: JSON.parse((await sql(`select private.fale_em_tick() t`))[0].t) };
check('cron: requests that never reached the threshold expire after 30 days', tick2.t.expired === 1 && (await O.one.emStatus()).own.lastClosed.status === 'expired', tick2);

// ================================================================== rate limits
await T('/__test/env?ONE_EM_REQUEST_DAILY=1');
r = await api('em.request', { setupId: SID }, { token: B.token });
const r3 = await api('em.request', { setupId: SID }, { token: B.token });
check('rate limit: requests per day (ONE_EM_REQUEST_DAILY)', r3.status === 429 && r3.error === 'drive_limit', [r.status, r3.status]);
await T('/__test/env?ONE_EM_REQUEST_DAILY=&ONE_EM_INVITE_DAILY=1');
const own2 = (await O.one.emStatus()).own;
await O.one.emRemove(SID, 3);
r = await api('em.invite', { setupId: SID, email: 'x1@example.com' }, { token: O.token });
check('rate limit: invitations per day (ONE_EM_INVITE_DAILY)', r.status === 429 && r.error === 'drive_limit', r);
await T('/__test/env?ONE_EM_INVITE_DAILY=&ONE_EM_DAILY=3');
const G = await signIn('gerd@example.com');
let lim = 0;
for (let i = 0; i < 6; i++) if ((await api('em.status', {}, { token: G.token })).status === 429) lim++;
check('rate limit: emergency actions per day (ONE_EM_DAILY)', lim === 3, lim);
await T('/__test/env?ONE_EM_DAILY=');

// ================================================================== notifier (pluggable) – unit level with a fake transport
{
  const { makeNotifier, flushOutbox, render } = await import('/home/claude/FalePDF/api/_lib/notify.js').then(m => m.default || m);
  const sent = [];
  process.env.NOTIFY_PROVIDER = 'webhook'; process.env.NOTIFY_WEBHOOK_URL = 'https://hooks.example.org/fale'; process.env.NOTIFY_WEBHOOK_SECRET = 's3cret';
  const n = makeNotifier({ fetchImpl: async (url, o) => { sent.push({ url, o }); return { ok: true, status: 200 }; } });
  const store = { emOutboxTake: async () => ({ ok: true, items: [{ id: 1, kind: 'request', to: 'anna@example.com', data: { contact_email: 'ben@example.com', release_at: new Date().toISOString() } }, { id: 2, kind: 'bogus', to: 'x@y.z' }] }), emOutboxDone: async ({ ids }) => { store.done = ids; return { ok: true }; } };
  const f = await flushOutbox(store, n);
  const body = sent[0] && JSON.parse(sent[0].o.body);
  check('notifier: webhook gets subject/text (DE+EN), HMAC signature, outbox marked done', f.sent === 1 && sent.length === 1 && /Notfallzugang angefragt/.test(body.subject) && /Emergency access requested/.test(body.subject) && /requested access to your emergency folder/.test(body.text)
    && sent[0].o.headers['X-Fale-Signature'] === crypto.createHmac('sha256', 's3cret').update(sent[0].o.body).digest('hex') && store.done.join() === '1,2', [f, store.done]);
  check('notifier: mails never contain file names or secrets', !/GEHEIM|Testament/.test(JSON.stringify(Object.keys(render('released_contact', { owner_email: 'a@b.c' })))));
  for (const k of ['NOTIFY_PROVIDER', 'NOTIFY_WEBHOOK_URL', 'NOTIFY_WEBHOOK_SECRET']) delete process.env[k];
  check('notifier: none by default (nothing sent)', makeNotifier().kind === 'none');
}

// ================================================================== account deletion cascade
{
  // contact E deletes the account → contact row gone, owner's log says so
  r = await fetch(`${APP}/api/account?a=delete`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${E.token}` }, body: JSON.stringify({ confirm: 'LÖSCHEN' }) }).then(x => x.json());
  const own3 = (await O.one.emStatus()).own;
  check('cascade: a deleted contact disappears from the setup (logged for the owner)', r.ok && own3.contacts.every(c => c.email !== 'emil@example.com'), own3.contacts.map(c => c.email));
  // owner deletes the account → every emergency row of the setup is gone
  const cnt = async () => (await sql(`select (select count(*) from public.one_em_setups) + (select count(*) from public.one_em_contacts) + (select count(*) from public.one_em_requests)
    + (select count(*) from public.one_em_node_keys) + (select count(*) from public.one_em_album_keys) + (select count(*) from public.one_em_log) + (select count(*) from public.one_em_pool) n`))[0].n;
  const n0 = await cnt();
  r = await fetch(`${APP}/api/account?a=delete`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${O.token}` }, body: JSON.stringify({ confirm: 'LÖSCHEN' }) }).then(x => x.json());
  const n1 = await cnt();
  check('cascade: owner account deletion removes the setup, contacts, requests, keys, log and pool', r.ok && +n0 > 10 && n1 === '0', [n0, n1]);
  sb = await B.one.emStatus();
  check('cascade: the contact no longer sees the setup', sb.others.length === 0);
}
// migration idempotency (both files, twice)
{
  const { execFileSync } = await import('node:child_process');
  let okRe = true;
  for (let i = 0; i < 2; i++) for (const f of ['20261016090000_fale_one_emergency.sql', '20261016090100_fale_one_emergency_cron.sql']) {
    try { execFileSync('psql', ['-h', '/tmp/faleacct', '-p', '5544', '-U', 'postgres', '-d', process.env.PGDB, '-v', 'ON_ERROR_STOP=1', '-q', '--single-transaction', '-f', '/home/claude/FalePDF/supabase/migrations/' + f], { stdio: 'ignore' }); }
    catch { okRe = false; }
  }
  check('migrations: re-running both is safe', okRe);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
