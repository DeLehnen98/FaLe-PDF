// FaLe Sync – adapters between the local stores (IndexedDB / localStorage) and sync items.
// Each adapter:
//   kind, group (settings toggle), store (db.js hook store name), singleton?
//   list()                    → [{ id, fp, rec }]      fp = fingerprint of everything that syncs
//   build(rec)                → { env, content|null }  env = plaintext metadata (encrypted by the engine)
//   apply(localId|null, env, content|null, ctx) → localId      (write a remote version locally)
//   remove(localId)           (remote deletion → local: files go to the Papierkorb)
// Device-specific data never syncs: thumbnails, search index, "zuletzt geöffnet", notification ids,
// biometric unlock, PDF passwords.
import * as db from '../db.js';
import { b64u, unb64u } from './crypto.js';
import { t } from '../i18n/index.js';

const J = x => JSON.stringify(x);
const emitLib = async () => { try { (await import('../library.js')).emitChange(); } catch {} };
const blobToB64 = async blob => b64u(new Uint8Array(await blob.arrayBuffer()));
const b64ToBlob = (s, type) => new Blob([unb64u(s)], { type: type || 'application/octet-stream' });
export const INLINE_MAX = 40 * 1024;

// ------------------------------------------------------------------ files (library)
const fpDoc = d => J([d.name, d.kind || 'pdf', d.folder || null, (d.tags || []).slice().sort(), !!d.starred, d.size, d.modifiedAt || 0, !!d.encrypted]);
const files = {
  kind: 'file', group: 'files', store: 'docs',
  async list() { return (await db.listFiles()).map(d => ({ id: d.id, fp: fpDoc(d), rec: d })); },
  async build(d) {
    const blob = await db.getFile(d.id);
    if (!blob) return null;
    return {
      env: { name: d.name, kind: d.kind || 'pdf', type: blob.type || '', size: blob.size, pages: d.pages ?? null, createdAt: d.createdAt || Date.now(), modifiedAt: d.modifiedAt || 0,
        starred: !!d.starred, folder: d.folder || null, tags: d.tags || [], source: d.source || 'Gerät', encrypted: !!d.encrypted, lastPage: d.lastPage || 1 },
      content: blob,
    };
  },
  async apply(localId, env, content) {
    const patch = { name: env.name, starred: !!env.starred, folder: env.folder || null, tags: env.tags || [], modifiedAt: env.modifiedAt || 0, encrypted: !!env.encrypted };
    const cur = localId ? await db.getDoc(localId) : null;
    if (cur) {
      if (content) {
        await db.replaceFile(localId, content, { ...patch, textReady: false, thumb: null });
        reindexLater(localId);
      } else await db.updateDoc(localId, patch);
      return localId;
    }
    const id = localId;
    const meta = { id, ...(env.kind && env.kind !== 'pdf' ? { kind: env.kind } : {}), ...patch, size: content.size, pages: env.pages ?? null,
      createdAt: env.createdAt || Date.now(), openedAt: env.modifiedAt || env.createdAt || Date.now(), lastPage: env.lastPage || 1, thumb: null, source: env.source || 'Gerät', textReady: false };
    await db.addDoc(meta, content);
    reindexLater(id);
    return id;
  },
  async remove(localId) {
    await db.deleteDoc(localId);
    try { (await import('../library.js')).dropThumb(localId); } catch {}
  },
  /** keep the local version as a separate file "<name> (Konflikt von <device>)" */
  async conflictCopy(localId, deviceName) {
    const d = await db.getDoc(localId), blob = await db.getFile(localId);
    if (!d || !blob) return null;
    const m = /^(.*?)(\.[A-Za-z0-9]{1,5})?$/.exec(d.name);
    const name = `${m[1]} ${t('(Konflikt von {device})', { device: deviceName })}${m[2] || ''}`;
    const copy = { ...d, id: db.uid(), name, thumb: null, textReady: false, openedAt: Date.now() };
    await db.addDoc(copy, blob); // not muted → syncs as a new file
    reindexLater(copy.id);
    return copy;
  },
  after: emitLib,
};
const pending = new Set();
function reindexLater(id) {
  pending.add(id);
  setTimeout(async () => {
    if (!pending.delete(id)) return;
    try { await (await import('../library.js')).reindexDoc(id); } catch (e) { console.warn('reindex', e); }
  }, 300);
}

// ------------------------------------------------------------------ lists with a 3-way merge (folders, tags)
function listAdapter(kind, key) {
  return {
    kind, group: 'organize', store: 'settings', singleton: kind, hookKey: key,
    async list() {
      const l = (await db.getSetting(key, [])) || [];
      return [{ id: kind, fp: J(l.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))), rec: l, empty: !l.length }];
    },
    async build(l) { return { env: { list: l }, content: null }; },
    async apply(_id, env) { await db.setSetting(key, Array.isArray(env.list) ? env.list : []); return kind; },
    async remove() {},
    /** base = last synced list; local + remote changed since → merged list */
    merge(base, local, remote) {
      const by = l => new Map((l || []).map(x => [x.id, x]));
      const B = by(base), L = by(local), out = by(remote);
      for (const [id, x] of L) if (!B.has(id) || J(B.get(id)) !== J(x)) out.set(id, x);   // added / changed here
      for (const id of B.keys()) if (!L.has(id)) out.delete(id);                           // deleted here
      return [...out.values()];
    },
    after: emitLib,
  };
}

// ------------------------------------------------------------------ profile, settings
const profile = {
  kind: 'profile', group: 'profile', store: 'settings', singleton: 'profile', hookKey: 'profile',
  async list() { const p = await db.getSetting('profile', null); return [{ id: 'profile', fp: J(p), rec: p, empty: !p }]; },
  async build(p) { return { env: { data: p }, content: null }; },
  async apply(_id, env) {
    await db.setSetting('profile', env.data || null);
    try { (await import('../extras/profile.js')).resetProfileCache(); } catch {}
    return 'profile';
  },
  async remove() {},
};
// Only settings that belong to the person, not to the device (design and language stay per device).
const settings = {
  kind: 'settings', group: 'settings', store: 'settings', singleton: 'settings', hookKey: 'defaultZoom',
  async list() {
    const s = { defaultZoom: await db.getSetting('defaultZoom', null) };
    return [{ id: 'settings', fp: J(s), rec: s, empty: !s.defaultZoom }];
  },
  async build(s) { return { env: { data: s }, content: null }; },
  async apply(_id, env) {
    const s = env.data || {};
    if (s.defaultZoom) await db.setSetting('defaultZoom', s.defaultZoom);
    return 'settings';
  },
  async remove() {},
};

// ------------------------------------------------------------------ reminders
const remClean = r => { const { notifIds, notified, ...rest } = r; void notifIds; void notified; return rest; };
const reminders = {
  kind: 'reminder', group: 'reminders', store: 'reminders',
  async list() { return (await db.listReminders()).map(r => ({ id: r.id, fp: J(remClean(r)), rec: r })); },
  async build(r) { return { env: { rec: remClean(r) }, content: null }; },
  async apply(localId, env) {
    const all = await db.listReminders();
    const cur = all.find(r => r.id === localId);
    const rec = { ...env.rec, id: localId, notifIds: cur ? cur.notifIds || [] : [], notified: false };
    const R = await import('../extras/reminders.js');
    if (cur) await R.updateReminder(rec); // cancels old notifications, schedules new ones
    else await db.putReminder(rec);       // new: scheduled by syncNotifications() after the batch
    return localId;
  },
  async remove(localId) {
    const cur = (await db.listReminders()).find(r => r.id === localId);
    if (cur) await (await import('../extras/reminders.js')).removeReminder(cur);
  },
  async after() { try { await (await import('../extras/reminders.js')).syncNotifications(); } catch {} },
};

// ------------------------------------------------------------------ signatures & stamps
const sigFp = s => J([s.kind || 'signature', s.name || '', s.w || 0, s.h || 0, s.createdAt || 0, s.blob ? s.blob.size : 0, J(s.spec || null)]);
const signatures = {
  kind: 'sig', group: 'sig', store: 'signatures',
  async list() { return (await db.listSignatures()).filter(s => s.blob).map(s => ({ id: s.id, fp: sigFp(s), rec: s })); },
  async build(s) { return { env: { kind: s.kind || 'signature', name: s.name || '', spec: s.spec || null, w: s.w || 0, h: s.h || 0, createdAt: s.createdAt || Date.now(), type: s.blob.type || 'image/png' }, content: s.blob }; },
  async apply(localId, env, content) {
    const cur = localId != null ? await db.getSignature(localId) : null;
    const rec = { ...(cur || {}), kind: env.kind, name: env.name, spec: env.spec, w: env.w, h: env.h, createdAt: env.createdAt, blob: content || (cur && cur.blob) };
    if (cur) rec.id = cur.id; else delete rec.id;
    return db.putSignature(rec);
  },
  async remove(localId) { await db.deleteSignature(localId); },
};

// ------------------------------------------------------------------ Tresor (already encrypted with the PIN – synced as is)
const vaultHeader = async () => { const h = await db.getSetting('vault', null); if (!h) return null; const { bio, ...rest } = h; void bio; return rest; };
const vaultKey = {
  kind: 'vaultkey', group: 'vault', store: 'settings', singleton: 'vaultkey', hookKey: 'vault',
  async list() { const h = await vaultHeader(); return [{ id: 'vaultkey', fp: J(h), rec: h, empty: !h }]; },
  async build(h) { return { env: { header: h }, content: null }; },
  /** Returns null (= not applied) when this device has a DIFFERENT vault with files in it. */
  async apply(_id, env, _c, ctx) {
    const remote = env.header;
    const local = await db.getSetting('vault', null);
    const items = (await db.listVault()).length;
    if (local && items && remote && local.createdAt !== remote.createdAt) { ctx.vaultConflict = true; return null; }
    await db.setSetting('vault', remote ? { ...remote, bio: local && local.createdAt === remote.createdAt ? local.bio || null : null } : null);
    return 'vaultkey';
  },
  async remove() {},
};
const vaultItems = {
  kind: 'vault', group: 'vault', store: 'vault', needsVault: true,
  async list() { return (await db.listVault()).map(r => ({ id: r.id, fp: 'v1', rec: r })); },
  async build(r) {
    const u8 = x => new Uint8Array(x instanceof ArrayBuffer ? x : x.buffer ? x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength) : x);
    return { env: { vid: r.id, v: r.v || 1, metaIv: b64u(u8(r.metaIv)), meta: b64u(u8(r.meta)), dataIv: b64u(u8(r.dataIv)) }, content: new Blob([u8(r.data)]) };
  },
  async apply(localId, env, content) {
    const id = env.vid || localId;
    const toBuf = u => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
    await db.putVaultItem({ id, v: env.v || 1, metaIv: unb64u(env.metaIv), meta: toBuf(unb64u(env.meta)), dataIv: unb64u(env.dataIv), data: await content.arrayBuffer() });
    return id;
  },
  async remove(localId) { await db.deleteVaultItem(localId); },
};

/** Order matters: lists and keys before the entries that reference them. */
export const ADAPTERS = [listAdapter('folders', 'folders'), listAdapter('tags', 'tags'), profile, settings, vaultKey, files, signatures, reminders, vaultItems];
export const byKind = Object.fromEntries(ADAPTERS.map(a => [a.kind, a]));
export const GROUPS = [
  { id: 'files', label: 'Dateien', desc: 'Alle Dateien mit Name, Ordner, Tags und Stern' },
  { id: 'organize', label: 'Ordner & Tags', desc: 'Deine Ordnerstruktur und farbigen Tags' },
  { id: 'sig', label: 'Unterschriften & Stempel', desc: 'Gespeicherte Unterschriften, Initialen und Stempel' },
  { id: 'reminders', label: 'Fristen & Erinnerungen', desc: 'Termine und Kündigungsfristen' },
  { id: 'profile', label: 'Meine Daten', desc: 'Name und Adresse für Briefe und Formulare' },
  { id: 'settings', label: 'Einstellungen', desc: 'Standard-Zoom beim Öffnen von PDFs (Design und Sprache bleiben pro Gerät)' },
  { id: 'vault', label: 'Privater Tresor', desc: 'Nur die bereits mit deiner PIN verschlüsselten Daten' },
];
export { blobToB64, b64ToBlob };
