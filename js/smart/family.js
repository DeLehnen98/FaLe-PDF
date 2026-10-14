// „Familien-Ordner“: Ende-zu-Ende-verschlüsselter gemeinsamer Ordner für die Familie – Dokumente, Fristen und
// Notizen teilen, Einladung per Link/QR (einmalig, ablaufend), Rollen (Verwalter/Mitglied) und „Notfallzugang“
// (Zugang nach Wartezeit, außer ein Verwalter lehnt ab). Braucht das optionale FaLe-Konto mit FaLe Sync
// (der private Familien-Schlüssel wird mit dem Sync-Hauptschlüssel geschützt). Serverseite:
// supabase/migrations/20261014200000_fale_family.sql (dort auch das Bedrohungsmodell).
// Routes: #/familie · #/familie/<gruppe>[?tab=…] · #/familie/beitreten?i=<einladung>&t=<geheimnis>
import * as db from '../db.js';
import { $, $$, toast, errorToast, openDialog, confirmDialog, progress, debounce } from '../ui.js';
import { h, esc, oicon, ensureSmartCss, fieldRow, copyText, deDate, daysUntil, relDays, lsSet, todayIso } from './common.js';
import * as K from './famcrypto.js';

const MAX_FILE = 20 * 1024 * 1024;
const ROLE_LABEL = { verwalter: 'Verwalter', mitglied: 'Mitglied', notfall: 'Notfallkontakt' };
const STATE_LABEL = { bereit: 'Eingerichtet', angefragt: 'Angefragt', abgelehnt: 'Abgelehnt', freigegeben: 'Freigegeben' };
const err = (msg, code) => Object.assign(new Error(msg), { userMessage: msg, code });

// ------------------------------------------------------------------ account / keys
let ident = null; // { userId, email, priv, keyId, publicJwk }
const gkCache = new Map(); // groupId → raw group key (memory only)
const A = () => import('../account/auth.js');
const KV = () => import('../account/kv.js');

async function rpc(fn, args = {}) {
  const r = await (await A()).rpc(fn, args);
  if (r && r.ok === false) {
    const msgs = {
      forbidden: 'Dafür fehlen dir die Rechte in diesem Familien-Ordner.', no_key: 'Dein Familien-Schlüssel fehlt noch.', invalid: 'Diese Einladung ist ungültig.',
      used: 'Diese Einladung wurde schon verwendet.', expired: 'Diese Einladung ist abgelaufen.', already_member: 'Du bist schon Mitglied dieses Familien-Ordners.',
      group_full: 'Dieser Familien-Ordner ist voll.', too_many_groups: 'Du bist schon in der maximalen Zahl von Familien-Ordnern.', last_admin: 'Mindestens ein Verwalter muss bleiben.',
      waiting: 'Die Wartezeit läuft noch.', declined_recently: 'Die Anfrage wurde gerade abgelehnt – du kannst sie frühestens in 24 Stunden erneut stellen.',
      not_contact: 'Du bist für diesen Ordner kein Notfallkontakt.', conflict: 'Jemand anderes hat das gerade geändert – bitte neu laden.', too_many_invites: 'Es gibt zu viele offene Einladungen.',
      not_requested: 'Es liegt keine Anfrage vor.', emergency_contact: 'Notfallkontakte können keine andere Rolle bekommen.', size_mismatch: 'Die Datei wurde nicht vollständig hochgeladen.',
    };
    throw Object.assign(new Error(r.reason), { code: r.reason, info: r, userMessage: msgs[r.reason] || 'Das hat nicht geklappt. Bitte versuche es erneut.' });
  }
  return r;
}

/** Status for the screen: 'off' (accounts not enabled) | 'offline' | 'signed-out' | 'no-sync' | 'ready' */
export async function availability() {
  const Au = await A();
  const cfg = await Au.accountConfig({ passive: true });
  if (cfg.configured === false && !cfg.offline) return { state: 'off' };
  if (!Au.maybeSignedIn()) {
    if (cfg.unknown || cfg.configured == null) {
      const c2 = await Au.accountConfig();
      if (c2.configured === false) return { state: c2.offline ? 'offline' : 'off' };
    }
    return { state: 'signed-out' };
  }
  const user = await Au.currentUser();
  if (!user) return { state: 'signed-out' };
  const { kv } = await KV();
  const mk = await kv.get('sync.mk', null);
  if (!mk) return { state: 'no-sync', user };
  return { state: 'ready', user, mk };
}

/** Load or create the account's family key pair. */
export async function ensureIdentity() {
  const av = await availability();
  if (av.state !== 'ready') throw err('Für den Familien-Ordner brauchst du das FaLe-Konto mit eingerichtetem FaLe Sync.', av.state);
  if (ident && ident.userId === av.user.id) return ident;
  const { kv } = await KV();
  const cached = await kv.get('fam.priv', null);
  if (cached && (await kv.get('fam.user', null)) === av.user.id) {
    ident = { userId: av.user.id, email: av.user.email, priv: cached, keyId: await kv.get('fam.keyId', ''), publicJwk: await kv.get('fam.pub', null) };
    return ident;
  }
  const r = await rpc('fam_key_get');
  let priv, keyId, publicJwk;
  if (r.key) {
    priv = await K.unwrapPrivate(av.mk, av.user.id, r.key.wrapped_private);
    keyId = r.key.key_id; publicJwk = r.key.public_jwk;
  } else {
    const kp = await K.newKeyPair();
    try {
      keyId = await K.keyIdOf(kp.publicJwk);
      publicJwk = kp.publicJwk;
      const wrapped = await K.wrapPrivate(av.mk, av.user.id, kp.pkcs8);
      await rpc('fam_key_put', { p_key_id: keyId, p_public: publicJwk, p_wrapped: wrapped, p_mode: 'create' });
      priv = await K.importPrivate(kp.pkcs8);
    } finally { kp.pkcs8.fill(0); }
  }
  await kv.set('fam.priv', priv); await kv.set('fam.keyId', keyId); await kv.set('fam.pub', publicJwk); await kv.set('fam.user', av.user.id);
  lsSet('fale-fam-used', '1');
  ident = { userId: av.user.id, email: av.user.email, priv, keyId, publicJwk };
  return ident;
}

async function groupKey(g) {
  if (gkCache.has(g.group_id)) return gkCache.get(g.group_id);
  if (!g.my_wrapped_key) throw err('Für diesen Familien-Ordner hast du (noch) keinen Schlüssel.', 'no_group_key');
  const me = await ensureIdentity();
  const gk = await K.unwrapWith(me.priv, g.my_wrapped_key, g.group_id, me.userId);
  gkCache.set(g.group_id, gk);
  return gk;
}

export async function overview() {
  const r = await rpc('fam_overview');
  const groups = [];
  for (const g of r.groups) {
    let name = null;
    if (g.my_wrapped_key) { try { name = (await K.openJson(g.group_id, await groupKey(g), 'name', g.sealed_name)).name; } catch {} }
    groups.push({ ...g, name });
  }
  return { groups, now: r.now };
}

// ------------------------------------------------------------------ storage (bucket "family")
const objPath = (g, blob) => `${g}/${blob}`;
async function putObject(name, bytes) {
  const Au = await A();
  const r = await Au.sbFetch(`/storage/v1/object/family/${name.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', raw: bytes, contentType: 'application/octet-stream', headers: { 'x-upsert': 'false', 'cache-control': 'no-store' } });
  if (!r.ok) throw err('Die Datei konnte nicht hochgeladen werden.', 'upload');
}
async function getObject(name) {
  const Au = await A();
  const r = await Au.sbFetch(`/storage/v1/object/authenticated/family/${name.split('/').map(encodeURIComponent).join('/')}`, { method: 'GET' });
  if (!r.ok) throw err('Die Datei konnte nicht geladen werden.', 'download');
  return new Uint8Array(await r.arrayBuffer());
}
async function deleteObjects(names) {
  if (!names.length) return;
  const Au = await A();
  await Au.sbFetch('/storage/v1/object/family', { method: 'DELETE', json: { prefixes: names } }).catch(() => null);
}

// ------------------------------------------------------------------ groups, invitations, items
export async function createGroup(name) {
  const me = await ensureIdentity();
  const gk = K.rnd(32);
  const g = crypto.randomUUID();
  const sealedName = await K.sealJson(g, gk, 'name', { name: String(name).slice(0, 80) });
  const wrapped = await K.wrapFor(me.publicJwk, gk, g, me.userId);
  await rpc('fam_group_create', { p_group: g, p_sealed_name: sealedName, p_wrapped_key: wrapped });
  gkCache.set(g, gk);
  return g;
}

/** Create an invitation → { link, code, expiresAt } */
export async function createInvite(g, role = 'mitglied', hours = 72) {
  const gk = role === 'notfall' ? null : await groupKey(g);
  const secret = K.newInviteSecret();
  const inviteId = K.b64u(K.rnd(16));
  const wrapped = gk ? await K.wrapForInvite(secret, inviteId, g.group_id, gk) : null;
  const r = await rpc('fam_invite_create', { p_group: g.group_id, p_invite_id: inviteId, p_auth_hash: await K.inviteAuthHash(secret), p_wrapped_key: wrapped, p_role: role, p_hours: hours });
  const t = K.b64u(secret);
  const base = location.origin && /^https?:/.test(location.origin) ? `${location.origin}${location.pathname}` : 'https://fale-pdf.vercel.app/';
  return { link: `${base}#/familie/beitreten?i=${inviteId}&t=${t}`, code: `${inviteId}.${t}`, expiresAt: r.expires_at, role };
}

export async function acceptInvite(inviteId, t) {
  const me = await ensureIdentity();
  const secret = K.unb64u(t);
  if (secret.length !== 32 || !/^[A-Za-z0-9_-]{22}$/.test(inviteId)) throw err('Dieser Einladungscode ist ungültig.', 'invalid');
  const r = await rpc('fam_invite_accept', { p_invite_id: inviteId, p_auth: await K.inviteAuth(secret) });
  if (r.wrapped_key) {
    const gk = await K.unwrapInvite(secret, inviteId, r.group_id, r.wrapped_key);
    const mine = await K.wrapFor(me.publicJwk, gk, r.group_id, me.userId);
    await rpc('fam_member_setkey', { p_group: r.group_id, p_wrapped_key: mine, p_key_version: r.key_version || 1, p_sealed_label: null });
    gkCache.set(r.group_id, gk);
  }
  return r;
}

export async function listItems(g) {
  const gk = await groupKey(g);
  const out = [];
  let after = 0;
  for (let i = 0; i < 20; i++) {
    const r = await rpc('fam_items_list', { p_group: g.group_id, p_after: after });
    for (const it of r.items) {
      if (it.deleted) continue;
      try { out.push({ ...it, m: await K.openJson(g.group_id, gk, it.item_id, it.meta) }); } catch { out.push({ ...it, m: { name: '(nicht lesbar)', title: '(nicht lesbar)' }, broken: true }); }
    }
    if (r.items.length < 500) break;
    after = r.cursor;
  }
  return out;
}

export async function shareDoc(g, doc) {
  const gk = await groupKey(g);
  const blob = await db.getFile(doc.id);
  if (!blob) throw err('Die Datei fehlt.', 'missing');
  if (blob.size > MAX_FILE) throw err('Dateien bis 20 MB können geteilt werden.', 'too_big');
  const itemId = K.b64u(K.rnd(16)), blobId = K.b64u(K.rnd(16));
  const sealed = await K.sealBlob(g.group_id, gk, itemId, blobId, new Uint8Array(await blob.arrayBuffer()));
  await putObject(objPath(g.group_id, blobId), sealed);
  const meta = await K.sealJson(g.group_id, gk, itemId, { name: doc.name, kind: doc.kind || 'pdf', type: blob.type || '', size: blob.size, by: ident.email, at: Date.now() });
  try {
    await rpc('fam_item_put', { p_group: g.group_id, p_item_id: itemId, p_kind: 'file', p_base_version: 0, p_meta: meta, p_blob_id: blobId, p_size: sealed.length, p_sha256: K.hex(await K.sha256(sealed)), p_key_version: 1 });
  } catch (e) { await deleteObjects([objPath(g.group_id, blobId)]); throw e; }
}

export async function saveItem(g, kind, data, base = null) {
  const gk = await groupKey(g);
  const itemId = base ? base.item_id : K.b64u(K.rnd(16));
  const meta = await K.sealJson(g.group_id, gk, itemId, { ...data, by: ident.email, at: Date.now() });
  return rpc('fam_item_put', { p_group: g.group_id, p_item_id: itemId, p_kind: kind, p_base_version: base ? base.version : 0, p_meta: meta, p_blob_id: null, p_size: null, p_sha256: null, p_key_version: 1 });
}

export async function deleteItem(g, it) {
  const r = await rpc('fam_item_delete', { p_group: g.group_id, p_item_id: it.item_id, p_base_version: it.version });
  if (r.old_blob) await deleteObjects([objPath(g.group_id, r.old_blob)]);
}

export async function downloadItem(g, it) {
  const gk = await groupKey(g);
  const sealed = await getObject(objPath(g.group_id, it.blob_id));
  if (it.sha256 && K.hex(await K.sha256(sealed)) !== it.sha256) throw err('Die Datei wurde unterwegs verändert.', 'hash');
  const bytes = await K.openBlob(g.group_id, gk, it.item_id, it.blob_id, sealed);
  const { importAny, emitChange } = await import('../library.js');
  const file = new File([bytes], it.m.name || 'Dokument', { type: it.m.type || 'application/octet-stream' });
  const meta = await importAny(file, { source: 'Familien-Ordner', silent: true });
  emitChange();
  return meta;
}

export async function setupEmergency(g, contactId, days) {
  const gk = await groupKey(g);
  const keys = (await rpc('fam_public_keys', { p_group: g.group_id })).keys;
  const c = keys.find(k => k.user_id === contactId);
  if (!c || !c.public_jwk) throw err('Der Notfallkontakt hat noch keinen Schlüssel.', 'no_key');
  const escrow = await K.wrapFor(c.public_jwk, gk, g.group_id, contactId);
  return rpc('fam_emergency_setup', { p_group: g.group_id, p_contact: contactId, p_wait_days: days, p_escrow: escrow, p_key_version: g.key_version || 1 });
}

export async function claimEmergency(g) {
  const me = await ensureIdentity();
  const r = await rpc('fam_emergency_claim', { p_group: g.group_id });
  const gk = await K.unwrapWith(me.priv, r.wrapped_key, g.group_id, me.userId);
  gkCache.set(g.group_id, gk);
  return true;
}

export async function deleteGroup(g) {
  try {
    const items = await rpc('fam_items_list', { p_group: g.group_id, p_after: 0 });
    await deleteObjects(items.items.filter(i => i.blob_id).map(i => objPath(g.group_id, i.blob_id)));
  } catch {}
  return rpc('fam_group_delete', { p_group: g.group_id });
}

// ------------------------------------------------------------------ UI
export async function mount(screen, { parts, params }) {
  ensureSmartCss();
  screen.root.classList.add('sm-screen');
  const body = h('<div class="screen-inner sm-family"></div>');
  screen.body.appendChild(body);
  screen.setFoot([]);
  body.appendChild(h('<div class="v-loading"><div><span class="spinner dark" style="width:28px;height:28px"></span><span>Wird geladen …</span></div></div>'));
  let av;
  try { av = await availability(); } catch (e) { av = { state: 'offline' }; }
  body.innerHTML = '';
  if (av.state !== 'ready') return renderGate(body, av.state, parts, params);
  try { await ensureIdentity(); } catch (e) { errorToast(e, 'Dein Familien-Schlüssel konnte nicht geladen werden.'); body.appendChild(h(`<div class="empty"><div class="empty-art">${oicon('key')}</div><h3>Schlüssel nicht verfügbar</h3><p></p></div>`)); $('p', body).textContent = e.userMessage || ''; return; }
  if (parts[1] === 'beitreten') return renderJoin(body, params);
  if (parts[1]) return renderGroup(screen, body, parts[1], params);
  return renderOverview(body);
}

function renderGate(body, state, parts, params) {
  const pending = parts[1] === 'beitreten' ? `#/familie/beitreten?${params.toString()}` : null;
  if (pending) { try { sessionStorage.setItem('fale-fam-pending', pending); } catch {} }
  const card = h(`<div class="card sm-hero sm-gate"><span class="sm-hero-ic">${oicon('vault')}</span><div><strong></strong><p></p><div class="sm-hero-actions"></div>
    <ul class="sm-feat"><li>${oicon('lock')}<span>Ende-zu-Ende-verschlüsselt: Der Server sieht keine Inhalte, Namen oder Schlüssel.</span></li>
    <li>${oicon('person')}<span>Einladen per Link oder QR-Code – Rollen Verwalter und Mitglied.</span></li>
    <li>${oicon('bell')}<span>Gemeinsame Dokumente, Fristen und Notizen.</span></li>
    <li>${oicon('shield')}<span>Notfallzugang: Eine Vertrauensperson bekommt nach einer Wartezeit Zugriff – außer du lehnst ab.</span></li></ul></div></div>`);
  const t = $('strong', card), p = $('p', card), act = $('.sm-hero-actions', card);
  if (state === 'off') { t.textContent = 'Familien-Ordner – kommt mit dem FaLe-Konto'; p.textContent = 'Teile wichtige Unterlagen sicher mit deiner Familie. Diese Funktion braucht das optionale FaLe-Konto, das bald verfügbar ist. Alles andere funktioniert wie gewohnt ohne Konto.'; card.classList.add('sm-soon'); }
  else if (state === 'offline') { t.textContent = 'Familien-Ordner braucht eine Internetverbindung'; p.textContent = 'Zum Teilen mit deiner Familie muss FaLe die verschlüsselten Daten über dein FaLe-Konto austauschen. Bitte versuche es mit Internetverbindung erneut.'; }
  else if (state === 'signed-out') { t.textContent = 'Familien-Ordner'; p.textContent = 'Melde dich mit deinem FaLe-Konto an und richte FaLe Sync ein – dein Familien-Schlüssel wird damit geschützt.'; act.appendChild(h(`<a class="btn btn-primary" href="#/konto">${oicon('user')}<span>Zum FaLe-Konto</span></a>`)); }
  else { t.textContent = 'Erst FaLe Sync einrichten'; p.textContent = 'Dein privater Familien-Schlüssel wird mit deinem Sync-Schlüssel geschützt, damit du ihn auf allen Geräten hast. Richte FaLe Sync ein oder entsperre es auf diesem Gerät.'; act.appendChild(h(`<a class="btn btn-primary" href="#/konto">${oicon('key')}<span>FaLe Sync einrichten</span></a>`)); }
  body.appendChild(card);
}

async function renderOverview(body) {
  const head = h(`<div class="sm-fam-head"><button class="btn btn-primary" type="button" data-new>${oicon('folderPlus')}<span>Familien-Ordner anlegen</span></button>
    <button class="btn btn-ghost" type="button" data-code>${oicon('key')}<span>Einladungscode eingeben</span></button>
    <button class="btn btn-ghost btn-sm" type="button" data-sec>${oicon('shield')}<span>Wie sicher ist das?</span></button></div>`);
  body.appendChild(head);
  const list = h('<div class="sm-fam-list" data-list></div>');
  body.appendChild(list);
  const { groups } = await overview();
  const me = await ensureIdentity();
  if (!groups.length) list.appendChild(h(`<div class="empty"><div class="empty-art">${oicon('vault')}</div><h3>Noch kein Familien-Ordner</h3><p>Lege einen Ordner an und lade deine Familie per Link oder QR-Code ein. Alles wird auf euren Geräten verschlüsselt.</p></div>`));
  for (const g of groups) {
    const emerg = (g.emergency || []);
    const pend = emerg.filter(e => e.state === 'angefragt' && !e.me);
    const mine = emerg.find(e => e.me);
    const card = h(`<a class="card sm-fam-card"><span class="sm-type-ic">${oicon('vault')}</span><span class="sm-row-txt"><strong data-no-i18n></strong><span class="small muted"></span></span></a>`);
    $('strong', card).textContent = g.name || (g.my_role === 'notfall' ? `Familien-Ordner von ${(g.members.find(m => m.role === 'verwalter') || {}).email || '…'}` : 'Familien-Ordner');
    $('.small', card).textContent = `${ROLE_LABEL[g.my_role]} · ${g.members.length} Mitglied${g.members.length === 1 ? '' : 'er'}${g.can_read ? ` · ${g.items} Einträge` : ''}`;
    card.href = `#/familie/${g.group_id}`;
    list.appendChild(card);
    for (const e of pend) {
      const n = daysUntil(String(e.release_at).slice(0, 10));
      const b = h(`<div class="card sm-alert"><span>${oicon('bell')}</span><div><strong></strong><span class="small"></span></div><a class="btn btn-soft btn-sm">Prüfen</a></div>`);
      $('strong', b).textContent = `${e.contact_email} hat Notfallzugang angefragt`;
      $('.small', b).textContent = `Wird ${n <= 0 ? 'jetzt' : `am ${deDate(String(e.release_at).slice(0, 10))} (${relDays(n)})`} freigegeben, wenn du nicht ablehnst.`;
      $('a', b).href = `#/familie/${g.group_id}?tab=notfall`;
      list.appendChild(b);
    }
    if (mine && g.my_role === 'notfall') {
      const b = h(`<div class="card sm-alert info"><span>${oicon('shield')}</span><div><strong></strong><span class="small"></span></div><a class="btn btn-soft btn-sm">Öffnen</a></div>`);
      $('strong', b).textContent = `Du bist Notfallkontakt (${STATE_LABEL[mine.state]})`;
      $('.small', b).textContent = mine.state === 'angefragt' ? (mine.ready ? 'Die Wartezeit ist vorbei – du kannst den Zugang jetzt öffnen.' : `Freigabe am ${deDate(String(mine.release_at).slice(0, 10))}, wenn niemand ablehnt.`) : `Wartezeit bei einer Anfrage: ${mine.wait_days} Tage.`;
      $('a', b).href = `#/familie/${g.group_id}?tab=notfall`;
      list.appendChild(b);
    }
  }
  const keyInfo = h('<p class="small muted sm-fp"></p>');
  keyInfo.textContent = `Deine Schlüssel-Kennung: ${await K.fingerprint(me.publicJwk)} – vergleiche sie bei Zweifeln mit deiner Familie.`;
  body.appendChild(keyInfo);
  $('[data-new]', head).addEventListener('click', async () => {
    const { promptDialog } = await import('../ui.js');
    const name = await promptDialog('Familien-Ordner anlegen', 'Name (nur für euch sichtbar, verschlüsselt)', 'Familie', { okLabel: 'Anlegen' });
    if (!name || !name.trim()) return;
    try { const g = await createGroup(name.trim()); toast('Familien-Ordner angelegt', 'success'); location.hash = `#/familie/${g}?tab=mitglieder`; } catch (e) { errorToast(e, 'Der Ordner konnte nicht angelegt werden.'); }
  });
  $('[data-code]', head).addEventListener('click', async () => {
    const { promptDialog } = await import('../ui.js');
    const code = await promptDialog('Einladungscode', 'Code oder Link', '', { okLabel: 'Weiter' });
    if (!code) return;
    const m = /i=([A-Za-z0-9_-]{22})&t=([A-Za-z0-9_-]+)/.exec(code) || /^\s*([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{40,})\s*$/.exec(code);
    if (!m) { toast('Das ist kein gültiger Einladungscode.', 'error'); return; }
    location.hash = `#/familie/beitreten?i=${m[1]}&t=${m[2]}`;
  });
  $('[data-sec]', head).addEventListener('click', securityInfo);
}

export function securityInfo() {
  return openDialog({
    title: 'Wie sicher ist der Familien-Ordner?', wide: true,
    body: `<div class="sm-sec">
      <p><strong>Ende-zu-Ende-verschlüsselt.</strong> Dokumente, Namen, Fristen und Notizen werden auf euren Geräten verschlüsselt (AES-256). Jeder Ordner hat einen eigenen Schlüssel, den jedes Mitglied mit seinem persönlichen Schlüssel (ECDH P-256) erhält. Der Server speichert nur verschlüsselte Daten, Größen, Zeitstempel und wer Mitglied ist.</p>
      <p><strong>Einladungen</strong> enthalten ein Geheimnis, das nur im Link steht und nie an den Server geht. Sie gelten einmal und laufen ab. Wer einen gültigen Link abfängt, kann beitreten – teile ihn nur persönlich oder verschlüsselt; Verwalter sehen jeden Beitritt und können Mitglieder entfernen.</p>
      <p><strong>Notfallzugang:</strong> Dein Gerät verschlüsselt den Ordner-Schlüssel vorab für deinen Notfallkontakt. Der Server gibt ihn erst nach der Wartezeit heraus – außer du lehnst ab. Ehrlicher Hinweis: Die Wartezeit setzt der Server durch. Wer den Server kontrolliert, könnte sie verkürzen, die Inhalte aber trotzdem nicht selbst lesen – das kann nur dein Notfallkontakt.</p>
      <p><strong>Entfernen:</strong> Ein entferntes Mitglied verliert sofort den Zugriff auf die verschlüsselten Dateien. Was es vorher geöffnet oder gespeichert hat, behält es.</p>
      <p><strong>Schlüssel-Kennung:</strong> Bei Zweifeln vergleicht ihr die angezeigten Kennungen – so merkt ihr, falls jemand einen falschen Schlüssel unterschiebt.</p></div>`,
    actions: [{ label: 'Verstanden', value: 'ok', kind: 'btn-primary', default: true }],
  });
}

async function renderJoin(body, params) {
  const i = params.get('i'), t = params.get('t');
  const card = h(`<div class="card sm-hero"><span class="sm-hero-ic">${oicon('person')}</span><div><strong>Einladung in einen Familien-Ordner</strong>
    <p>Du wurdest eingeladen. Nach dem Beitritt teilt ihr Dokumente, Fristen und Notizen Ende-zu-Ende-verschlüsselt.</p>
    <div class="sm-hero-actions"><button class="btn btn-primary" type="button" data-join>${oicon('check')}<span>Einladung annehmen</span></button><a class="btn btn-ghost" href="#/familie">Abbrechen</a></div></div></div>`);
  body.appendChild(card);
  $('[data-join]', card).addEventListener('click', async ev => {
    const btn = ev.currentTarget; // currentTarget is null after the first await
    btn.disabled = true;
    try {
      const r = await acceptInvite(i, t);
      toast(r.role === 'notfall' ? 'Du bist jetzt Notfallkontakt.' : 'Willkommen im Familien-Ordner!', 'success');
      location.replace(`#/familie/${r.group_id}${r.role === 'notfall' ? '?tab=notfall' : ''}`);
    } catch (e) {
      btn.disabled = false;
      if (e.code === 'already_member' && e.info && e.info.group_id) { location.replace(`#/familie/${e.info.group_id}`); return; }
      errorToast(e, 'Die Einladung konnte nicht angenommen werden.');
    }
  });
}

const TABS = [['dokumente', 'Dokumente', 'file'], ['fristen', 'Fristen', 'bell'], ['notizen', 'Notizen', 'notes'], ['mitglieder', 'Mitglieder', 'person'], ['notfall', 'Notfallzugang', 'shield']];

async function renderGroup(screen, body, groupId, params) {
  let tab = params.get('tab') || 'dokumente';
  let state = await overview();
  let g = state.groups.find(x => x.group_id === groupId);
  if (!g) { body.appendChild(h(`<div class="empty"><div class="empty-art">${oicon('vault')}</div><h3>Ordner nicht gefunden</h3><p>Vielleicht wurdest du entfernt oder der Ordner wurde gelöscht.</p><a class="btn btn-ghost" href="#/familie">Zur Übersicht</a></div>`)); return; }
  if (g.my_role === 'notfall' && !g.can_read) tab = 'notfall';
  screen.setTitle(g.name || 'Familien-Ordner', `${ROLE_LABEL[g.my_role]} · Ende-zu-Ende-verschlüsselt`);
  const tabs = h(`<div class="tabs sm-tabs" role="tablist" aria-label="Bereiche">${TABS.map(([id, label, ic]) => `<button class="tab" role="tab" type="button" data-tab="${id}">${oicon(ic)}<span>${esc(label)}</span></button>`).join('')}</div>`);
  const panel = h('<div class="sm-fam-panel"></div>');
  body.append(tabs, panel);
  const reload = async () => { state = await overview(); g = state.groups.find(x => x.group_id === groupId); if (!g) { location.replace('#/familie'); return; } await paint(); };
  async function paint() {
    $$('[data-tab]', tabs).forEach(b => { b.setAttribute('aria-selected', String(b.dataset.tab === tab)); b.hidden = g.my_role === 'notfall' && !g.can_read && b.dataset.tab !== 'notfall'; });
    panel.innerHTML = '';
    try {
      if (tab === 'mitglieder') await paintMembers(panel, g, reload);
      else if (tab === 'notfall') await paintEmergency(panel, g, reload);
      else await paintItems(panel, g, tab, reload);
    } catch (e) { errorToast(e, 'Das konnte nicht geladen werden.'); }
  }
  $$('[data-tab]', tabs).forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; history.replaceState(null, '', `#/familie/${groupId}?tab=${tab}`); paint(); }));
  await paint();
}

async function paintItems(panel, g, tab, reload) {
  const kind = tab === 'dokumente' ? 'file' : tab === 'fristen' ? 'reminder' : 'note';
  const canWrite = g.my_role === 'verwalter' || g.my_role === 'mitglied';
  const items = (await listItems(g)).filter(i => i.kind === kind);
  const bar = h('<div class="sm-fam-bar"></div>');
  if (canWrite) {
    const add = h(`<button class="btn btn-primary" type="button">${oicon('plus')}<span>${kind === 'file' ? 'Dokument teilen' : kind === 'reminder' ? 'Frist teilen' : 'Notiz hinzufügen'}</span></button>`);
    add.addEventListener('click', async () => {
      try {
        if (kind === 'file') { if (await pickAndShare(g)) reload(); }
        else if (await editItemDialog(g, kind)) reload();
      } catch (e) { errorToast(e, 'Das hat nicht geklappt.'); }
    });
    bar.appendChild(add);
  }
  panel.appendChild(bar);
  if (!items.length) { panel.appendChild(h(`<p class="muted sm-empty-small">${kind === 'file' ? 'Noch keine geteilten Dokumente.' : kind === 'reminder' ? 'Noch keine gemeinsamen Fristen.' : 'Noch keine Notizen.'}</p>`)); return; }
  items.sort((a, b) => (kind === 'reminder' ? String(a.m.due || '').localeCompare(String(b.m.due || '')) : new Date(b.updated_at) - new Date(a.updated_at)));
  for (const it of items) {
    const row = h(`<article class="card sm-fam-item"><span class="sm-type-ic">${oicon(kind === 'file' ? 'file' : kind === 'reminder' ? 'bell' : 'notes')}</span>
      <div class="sm-row-txt"><strong data-no-i18n></strong><span class="small muted" data-no-i18n></span><p class="sm-note-text" data-no-i18n hidden></p></div><div class="sm-fam-acts"></div></article>`);
    const m = it.m;
    $('strong', row).textContent = kind === 'file' ? m.name : m.title || 'Ohne Titel';
    $('.small', row).textContent = [kind === 'reminder' && m.due ? `${deDate(m.due)} (${relDays(daysUntil(m.due))})` : '', kind === 'file' && m.size ? `${Math.max(1, Math.round(m.size / 1024))} KB` : '', m.by ? `von ${m.by}` : ''].filter(Boolean).join(' · ');
    if (kind === 'note' && m.text) { const p = $('.sm-note-text', row); p.hidden = false; p.textContent = m.text; }
    const acts = $('.sm-fam-acts', row);
    if (kind === 'file') {
      const dl = h(`<button class="btn btn-soft btn-sm" type="button">${oicon('download')}<span>In meine Dateien</span></button>`);
      dl.addEventListener('click', async () => { dl.disabled = true; try { const d = await downloadItem(g, it); toast(`„${d.name}“ gespeichert`, 'success', { action: { label: 'Öffnen', onClick: async () => { const { openHash } = await import('../office/kinds.js'); location.hash = !d.kind || d.kind === 'pdf' ? `#/ansicht/${d.id}` : openHash(d); } } }); } catch (e) { errorToast(e, 'Die Datei konnte nicht geladen werden.'); } finally { dl.disabled = false; } });
      acts.appendChild(dl);
    }
    if (kind === 'reminder' && m.due) {
      const rb = h(`<button class="btn btn-soft btn-sm" type="button">${oicon('bell')}<span>Bei mir eintragen</span></button>`);
      rb.addEventListener('click', async () => { try { const R = await import('../extras/reminders.js'); await R.addReminder({ title: m.title, type: m.type || 'termin', due: m.due, leads: [7, 1], note: m.note || '' }); toast('In deine Fristen eingetragen', 'success'); } catch (e) { errorToast(e); } });
      acts.appendChild(rb);
    }
    if (canWrite) {
      if (kind !== 'file') { const ed = h(`<button class="icon-btn" type="button" aria-label="Bearbeiten">${oicon('edit')}</button>`); ed.addEventListener('click', async () => { try { if (await editItemDialog(g, kind, it)) reload(); } catch (e) { errorToast(e); } }); acts.appendChild(ed); }
      const del = h(`<button class="icon-btn" type="button" aria-label="Entfernen">${oicon('trash')}</button>`);
      del.addEventListener('click', async () => { if (!await confirmDialog('Aus dem Familien-Ordner entfernen?', 'Der Eintrag wird für alle Mitglieder entfernt. Lokale Kopien bleiben erhalten.', { okLabel: 'Entfernen', danger: true })) return; try { await deleteItem(g, it); reload(); } catch (e) { errorToast(e); } });
      acts.appendChild(del);
    }
    panel.appendChild(row);
  }
}

async function pickAndShare(g) {
  const files = (await db.listFiles()).filter(d => d.size <= MAX_FILE);
  const r = await openDialog({
    title: 'Dokumente teilen', wide: true,
    body: '<p class="small muted">Die Dateien werden auf deinem Gerät verschlüsselt und nur für die Mitglieder dieses Ordners lesbar hochgeladen (bis 20 MB je Datei).</p><div class="sm-pick" role="group" aria-label="Dateien"></div>',
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Teilen', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => {
      const box = $('.sm-pick', dlg);
      if (!files.length) box.appendChild(h('<p class="muted">Keine Dateien vorhanden.</p>'));
      files.slice(0, 300).forEach(d => {
        const l = h('<label class="sm-pick-item"><input type="checkbox" name="doc"><span data-no-i18n></span></label>');
        l.querySelector('input').value = d.id;
        l.querySelector('span').textContent = d.name;
        box.appendChild(l);
      });
      return { collect: () => $$('input:checked', dlg).map(x => x.value) };
    },
  });
  if (r.value !== 'ok' || !r.data || !r.data.length) return false;
  const p = progress('Wird verschlüsselt und geteilt …');
  try {
    for (const id of r.data) { const d = files.find(x => x.id === id); p.set(`„${d.name}“ wird geteilt …`); await shareDoc(g, d); }
    toast(r.data.length === 1 ? 'Dokument geteilt' : `${r.data.length} Dokumente geteilt`, 'success');
    return true;
  } finally { p.done(); }
}

async function editItemDialog(g, kind, it = null) {
  const m = it ? it.m : {};
  const r = await openDialog({
    title: kind === 'reminder' ? (it ? 'Frist bearbeiten' : 'Frist teilen') : (it ? 'Notiz bearbeiten' : 'Notiz hinzufügen'), wide: true,
    body: '<div class="sm-rc-form"></div>',
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Speichern', value: 'ok', kind: 'btn-primary', default: true }],
    validate: (v, dlg) => { if (v !== 'ok') return true; if (!$('[name=title]', dlg).value.trim()) { toast('Bitte gib einen Titel an.', 'error'); return false; } if (kind === 'reminder' && !/^\d{4}-\d{2}-\d{2}$/.test($('[name=due]', dlg).value)) { toast('Bitte wähle ein Datum.', 'error'); return false; } return true; },
    onMount: dlg => {
      const box = $('.sm-rc-form', dlg);
      box.appendChild(fieldRow({ id: 'title', label: kind === 'reminder' ? 'Worum geht es?' : 'Titel', value: m.title || '', wide: true }));
      if (kind === 'reminder') { box.appendChild(fieldRow({ id: 'due', label: 'Datum', type: 'date', value: m.due || '' })); box.appendChild(fieldRow({ id: 'note', label: 'Notiz (optional)', value: m.note || '' })); }
      else box.appendChild(fieldRow({ id: 'text', label: 'Text', type: 'textarea', value: m.text || '', wide: true }));
      return { collect: () => Object.fromEntries($$('[name]', box).map(x => [x.name, x.value.trim()])) };
    },
  });
  if (r.value !== 'ok' || !r.data) return false;
  await saveItem(g, kind, r.data, it);
  return true;
}

async function paintMembers(panel, g, reload) {
  const admin = g.my_role === 'verwalter';
  if (admin) {
    const inv = h(`<div class="card sm-invite"><div><strong>Familie einladen</strong><span class="small muted">Einladungen gelten einmal und laufen ab. Teile den Link nur persönlich (z. B. als QR-Code auf deinem Handy).</span></div>
      <div class="sm-invite-row"><label class="sm-field"><span class="sm-field-label">Rolle</span><select class="select" name="role"><option value="mitglied">Mitglied</option><option value="verwalter">Verwalter</option><option value="notfall">Notfallkontakt</option></select></label>
      <label class="sm-field"><span class="sm-field-label">Gültig</span><select class="select" name="hours"><option value="24">24 Stunden</option><option value="72" selected>3 Tage</option><option value="168">7 Tage</option></select></label>
      <button class="btn btn-primary" type="button" data-invite>${oicon('qr')}<span>Einladung erstellen</span></button></div></div>`);
    $('[data-invite]', inv).addEventListener('click', async () => {
      try {
        const res = await createInvite(g, $('[name=role]', inv).value, +$('[name=hours]', inv).value);
        await inviteDialog(res);
        reload();
      } catch (e) { errorToast(e, 'Die Einladung konnte nicht erstellt werden.'); }
    });
    panel.appendChild(inv);
  }
  const list = h('<div class="sm-members"></div>');
  for (const m of g.members) {
    const row = h(`<div class="card sm-member"><span class="me-avatar" aria-hidden="true"></span><div class="sm-row-txt"><strong data-no-i18n></strong><span class="small muted"></span></div><div class="sm-fam-acts"></div></div>`);
    $('.me-avatar', row).textContent = (m.email || '?').slice(0, 1).toUpperCase();
    $('strong', row).textContent = `${m.email || 'Unbekannt'}${m.me ? ' (du)' : ''}`;
    $('.small', row).textContent = [ROLE_LABEL[m.role], !m.has_key && m.role !== 'notfall' ? 'wartet auf Schlüssel' : '', m.key_id ? `Schlüssel ${m.key_id.slice(0, 8)}` : ''].filter(Boolean).join(' · ');
    const acts = $('.sm-fam-acts', row);
    if (admin && !m.me && m.role !== 'notfall') {
      const rb = h(`<button class="btn btn-ghost btn-sm" type="button">${m.role === 'verwalter' ? 'Zu Mitglied machen' : 'Zu Verwalter machen'}</button>`);
      rb.addEventListener('click', async () => { try { await rpc('fam_member_role', { p_group: g.group_id, p_user: m.user_id, p_role: m.role === 'verwalter' ? 'mitglied' : 'verwalter' }); reload(); } catch (e) { errorToast(e); } });
      acts.appendChild(rb);
    }
    if ((admin && !m.me) || m.me) {
      const del = h(`<button class="btn btn-danger-ghost btn-sm" type="button">${m.me ? 'Ordner verlassen' : 'Entfernen'}</button>`);
      del.addEventListener('click', async () => {
        if (!await confirmDialog(m.me ? 'Familien-Ordner verlassen?' : 'Mitglied entfernen?', m.me ? 'Du verlierst den Zugriff auf die geteilten Dokumente.' : 'Die Person verliert sofort den Zugriff auf die verschlüsselten Dateien. Was sie bereits gespeichert hat, behält sie.', { okLabel: m.me ? 'Verlassen' : 'Entfernen', danger: true })) return;
        try { await rpc('fam_member_remove', { p_group: g.group_id, p_user: m.user_id }); if (m.me) location.replace('#/familie'); else reload(); } catch (e) { errorToast(e); }
      });
      acts.appendChild(del);
    }
    list.appendChild(row);
  }
  panel.appendChild(list);
  if (admin && g.invites && g.invites.length) {
    const box = h('<div class="sm-invites"><h3 class="sm-pass-title">Einladungen</h3></div>');
    for (const i of g.invites) {
      const row = h('<div class="sm-inv-row"><span class="small" data-no-i18n></span><button class="btn btn-ghost btn-sm" type="button" hidden>Zurückziehen</button></div>');
      $('span', row).textContent = i.used_at ? `${ROLE_LABEL[i.role]} – angenommen von ${i.used_by_email || '…'}` : `${ROLE_LABEL[i.role]} – offen bis ${new Date(i.expires_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`;
      const b = $('button', row);
      if (!i.used_at) { b.hidden = false; b.addEventListener('click', async () => { try { await rpc('fam_invite_revoke', { p_invite_id: i.invite_id }); reload(); } catch (e) { errorToast(e); } }); }
      box.appendChild(row);
    }
    panel.appendChild(box);
  }
  if (admin) {
    const del = h(`<button class="btn btn-danger-ghost btn-sm sm-del-group" type="button">${oicon('trash')}<span>Familien-Ordner löschen</span></button>`);
    del.addEventListener('click', async () => {
      if (!await confirmDialog('Familien-Ordner löschen?', 'Alle geteilten Dokumente, Fristen und Notizen werden für alle Mitglieder gelöscht. Lokale Kopien bleiben erhalten.', { okLabel: 'Löschen', danger: true })) return;
      try { await deleteGroup(g); toast('Familien-Ordner gelöscht', 'success'); location.replace('#/familie'); } catch (e) { errorToast(e); }
    });
    panel.appendChild(del);
  }
}

async function inviteDialog(res) {
  const { encodeQR, qrToSvg } = await import('../tools/qr.js');
  const svg = qrToSvg(encodeQR(res.link, { ecc: 'M' }), { border: 4, size: 220 });
  await openDialog({
    title: res.role === 'notfall' ? 'Einladung als Notfallkontakt' : 'Einladung erstellt', wide: true,
    body: `<div class="sm-invite-dlg"><div class="sm-qr" data-qr>${svg}</div><div>
      <p>Lass die Person diesen QR-Code scannen oder schicke ihr den Link (am besten persönlich). Gültig bis <strong data-no-i18n></strong>, nur einmal verwendbar.</p>
      <label class="sm-field wide"><span class="sm-field-label">Link</span><input class="input sm-mono" readonly data-link data-no-i18n></label>
      <label class="sm-field wide"><span class="sm-field-label">Oder Einladungscode</span><input class="input sm-mono" readonly data-codev data-no-i18n></label>
      <div class="sm-hero-actions"><button class="btn btn-soft btn-sm" type="button" data-copy>${oicon('copy')}<span>Link kopieren</span></button><button class="btn btn-ghost btn-sm" type="button" data-share>${oicon('share')}<span>Teilen</span></button></div></div></div>`,
    actions: [{ label: 'Fertig', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => {
      $('strong', dlg).textContent = new Date(res.expiresAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
      $('[data-link]', dlg).value = res.link;
      $('[data-codev]', dlg).value = res.code;
      $('[data-qr]', dlg).dataset.link = res.link;
      $('[data-copy]', dlg).addEventListener('click', async () => { if (await copyText(res.link)) toast('Link kopiert', 'success'); });
      $('[data-share]', dlg).addEventListener('click', async () => { try { if (navigator.share) await navigator.share({ title: 'Einladung in den FaLe Familien-Ordner', url: res.link }); else if (await copyText(res.link)) toast('Link kopiert', 'success'); } catch {} });
      return null;
    },
  });
}

async function paintEmergency(panel, g, reload) {
  const admin = g.my_role === 'verwalter';
  const info = h(`<div class="card sm-em-info"><span>${oicon('shield')}</span><div><strong>So funktioniert der Notfallzugang</strong>
    <p class="small">Lade eine Vertrauensperson als <b>Notfallkontakt</b> ein und richte hier eine Wartezeit ein. Fragt sie Zugang an, wird er nach Ablauf der Wartezeit automatisch freigegeben – außer ein Verwalter lehnt vorher ab. Bis dahin sieht sie nichts.</p>
    <button class="btn btn-ghost btn-sm" type="button" data-sec>${oicon('info')}<span>Wie sicher ist das?</span></button></div></div>`);
  $('[data-sec]', info).addEventListener('click', securityInfo);
  panel.appendChild(info);
  if (g.my_role === 'notfall') {
    const e = (g.emergency || []).find(x => x.me);
    const card = h('<div class="card sm-em-card"><strong></strong><p class="small"></p><div class="sm-hero-actions"></div></div>');
    const act = $('.sm-hero-actions', card);
    if (!e) { $('strong', card).textContent = 'Noch nicht eingerichtet'; $('p', card).textContent = 'Ein Verwalter muss den Notfallzugang für dich noch einrichten.'; }
    else if (e.state === 'freigegeben' || g.can_read) {
      $('strong', card).textContent = 'Zugang freigegeben';
      $('p', card).textContent = 'Du kannst die Dokumente dieses Familien-Ordners jetzt lesen.';
      if (!g.my_wrapped_key) { const b = h(`<button class="btn btn-primary" type="button">${oicon('key')}<span>Zugang öffnen</span></button>`); b.addEventListener('click', async () => { try { await claimEmergency(g); reload(); } catch (x) { errorToast(x); } }); act.appendChild(b); }
      else { const b = h(`<a class="btn btn-primary">${oicon('file')}<span>Dokumente ansehen</span></a>`); b.href = `#/familie/${g.group_id}?tab=dokumente`; act.appendChild(b); }
    } else if (e.state === 'angefragt') {
      $('strong', card).textContent = e.ready ? 'Die Wartezeit ist vorbei' : 'Anfrage läuft';
      $('p', card).textContent = e.ready ? 'Du kannst den Zugang jetzt öffnen.' : `Freigabe am ${new Date(e.release_at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })} – wenn kein Verwalter ablehnt.`;
      if (e.ready) { const b = h(`<button class="btn btn-primary" type="button">${oicon('key')}<span>Zugang öffnen</span></button>`); b.addEventListener('click', async () => { try { await claimEmergency(g); toast('Zugang geöffnet', 'success'); reload(); } catch (x) { errorToast(x); } }); act.appendChild(b); }
    } else {
      $('strong', card).textContent = e.state === 'abgelehnt' ? 'Anfrage abgelehnt' : 'Bereit';
      $('p', card).textContent = `Im Notfall kannst du Zugang anfragen. Er wird nach ${e.wait_days} Tagen freigegeben, wenn niemand ablehnt.`;
      const b = h(`<button class="btn btn-primary" type="button">${oicon('bell')}<span>Notfallzugang anfragen</span></button>`);
      b.addEventListener('click', async () => {
        if (!await confirmDialog('Notfallzugang anfragen?', `Die Verwalter werden informiert, sobald sie FaLe öffnen. Ohne Ablehnung bekommst du nach ${e.wait_days} Tagen Zugriff.`, { okLabel: 'Anfragen' })) return;
        try { await rpc('fam_emergency_request', { p_group: g.group_id }); toast('Anfrage gestellt', 'success'); reload(); } catch (x) { errorToast(x); }
      });
      act.appendChild(b);
    }
    panel.appendChild(card);
    return;
  }
  const contacts = g.members.filter(m => m.role === 'notfall');
  if (!contacts.length) panel.appendChild(h('<p class="muted small">Noch kein Notfallkontakt. Lade eine Vertrauensperson unter „Mitglieder“ mit der Rolle „Notfallkontakt“ ein.</p>'));
  for (const c of contacts) {
    const e = (g.emergency || []).find(x => x.contact_id === c.user_id);
    const card = h('<div class="card sm-em-card"><strong data-no-i18n></strong><p class="small"></p><div class="sm-hero-actions"></div></div>');
    $('strong', card).textContent = c.email;
    const act = $('.sm-hero-actions', card);
    const p = $('p', card);
    if (!e) p.textContent = 'Noch nicht eingerichtet.';
    else if (e.state === 'angefragt') p.textContent = `Hat Zugang angefragt – automatische Freigabe am ${new Date(e.release_at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}.`;
    else p.textContent = `${STATE_LABEL[e.state]} · Wartezeit ${e.wait_days} Tage${e.released_at ? ` · freigegeben am ${new Date(e.released_at).toLocaleDateString('de-DE')}` : ''}`;
    if (admin) {
      if (!e || e.state !== 'angefragt') {
        const sel = h('<label class="sm-field"><span class="sm-field-label">Wartezeit</span><select class="select"><option value="3">3 Tage</option><option value="7" selected>7 Tage</option><option value="14">14 Tage</option><option value="30">30 Tage</option></select></label>');
        if (e) $('select', sel).value = String(e.wait_days);
        const b = h(`<button class="btn btn-primary btn-sm" type="button">${oicon('shield')}<span>${e ? 'Aktualisieren' : 'Notfallzugang einrichten'}</span></button>`);
        b.addEventListener('click', async () => { try { await setupEmergency(g, c.user_id, +$('select', sel).value); toast('Notfallzugang eingerichtet', 'success'); reload(); } catch (x) { errorToast(x); } });
        act.append(sel, b);
      }
      if (e && e.state === 'angefragt') {
        const no = h(`<button class="btn btn-danger btn-sm" type="button">${oicon('close')}<span>Ablehnen</span></button>`);
        no.addEventListener('click', async () => { try { await rpc('fam_emergency_decide', { p_group: g.group_id, p_contact: c.user_id, p_decision: 'ablehnen' }); toast('Abgelehnt', 'success'); reload(); } catch (x) { errorToast(x); } });
        const yes = h(`<button class="btn btn-soft btn-sm" type="button">${oicon('check')}<span>Sofort freigeben</span></button>`);
        yes.addEventListener('click', async () => { if (!await confirmDialog('Sofort freigeben?', 'Die Person kann den Familien-Ordner dann sofort lesen.', { okLabel: 'Freigeben' })) return; try { await rpc('fam_emergency_decide', { p_group: g.group_id, p_contact: c.user_id, p_decision: 'freigeben' }); reload(); } catch (x) { errorToast(x); } });
        act.append(no, yes);
      }
      if (e) {
        const rv = h(`<button class="btn btn-ghost btn-sm" type="button">${oicon('trash')}<span>Widerrufen</span></button>`);
        rv.addEventListener('click', async () => { if (!await confirmDialog('Notfallzugang widerrufen?', e.state === 'freigegeben' ? 'Der Server-Zugriff endet sofort. Was bereits geöffnet wurde, kann die Person behalten.' : 'Der vorbereitete Schlüssel wird gelöscht.', { okLabel: 'Widerrufen', danger: true })) return; try { await rpc('fam_emergency_revoke', { p_group: g.group_id, p_contact: c.user_id }); reload(); } catch (x) { errorToast(x); } });
        act.appendChild(rv);
      }
    }
    panel.appendChild(card);
  }
}

/** Start page: pending emergency requests (only when the family feature is used on this device). */
export async function pendingAlerts() {
  try {
    if (localStorage.getItem('fale-fam-used') !== '1') return [];
    const Au = await A();
    if (!Au.maybeSignedIn() || !Au.online()) return [];
    const r = await rpc('fam_overview');
    const out = [];
    for (const g of r.groups) for (const e of g.emergency || []) {
      if (e.state === 'angefragt' && !e.me && g.my_role === 'verwalter') out.push({ group: g.group_id, text: `${e.contact_email} hat Notfallzugang angefragt`, release: e.release_at });
      if (e.me && e.ready && e.state === 'angefragt') out.push({ group: g.group_id, text: 'Dein Notfallzugang kann jetzt geöffnet werden', release: e.release_at });
    }
    return out;
  } catch { return []; }
}
void todayIso; void debounce;
