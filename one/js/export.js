// "Alles exportieren" (contract §7.8, product principle "leave anytime"): every file decrypted on this device,
// written as plain folders + files with their dates, photo metadata as JSON sidecars, albums and a
// manifest.json. Into a folder you choose (File System Access API, resumable: existing files are skipped) or
// as ZIP parts (≤ 250 MB each, so phones do not run out of memory). No FaLe tool is needed to read it.
import { el, toast, errorToast, openDialog, progressBar, saveBlob } from './dom.js';
import { t, tp, fmtSize, fmtNum } from './i18n.js';
import * as E from './engine.js';
import { kv } from './idb.js';
import { currentUser } from './auth.js';

const PART_MAX = 250 * 1024 * 1024;
const safe = s => String(s || '').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_').replace(/^\.+$/, '_').replace(/[. ]+$/, '').slice(0, 180) || '_';

// ---------------------------------------------------------------- ZIP (STORE) from Blobs without copying them
function dos(ms) {
  const d = new Date(ms || Date.now());
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2), date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
async function blobCrc(blob) {
  // CRC-32 over 8 MiB slices, so a large (disk-backed) Blob is never read into memory at once
  let crc = 0xffffffff;
  for (let o = 0; o < blob.size; o += 8 * 1024 * 1024) {
    const b = new Uint8Array(await blob.slice(o, o + 8 * 1024 * 1024).arrayBuffer());
    crc = crcUpdate(crc, b);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const TABLE = (() => { const tb = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tb[n] = c >>> 0; } return tb; })();
function crcUpdate(crc, b) { for (let i = 0; i < b.length; i++) crc = TABLE[(crc ^ b[i]) & 0xff] ^ (crc >>> 8); return crc; }

class ZipPart {
  constructor() { this.parts = []; this.central = []; this.offset = 0; this.count = 0; this.names = new Set(); }
  async add(name, blob, mtime) {
    let n = name;
    for (let i = 2; this.names.has(n); i++) n = name.replace(/(\.[^./]*)?$/, m => ` (${i})${m}`);
    this.names.add(n);
    const enc = new TextEncoder().encode(n);
    const crc = await blobCrc(blob);
    const { time, date } = dos(mtime);
    if (blob.size >= 0xffffffff || this.offset >= 0xffffffff) throw Object.assign(new Error('zip too large'), { code: 'too_large' });
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true); lh.setUint32(18, blob.size, true); lh.setUint32(22, blob.size, true);
    lh.setUint16(26, enc.length, true); lh.setUint16(28, 0, true);
    this.parts.push(lh.buffer, enc, blob);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true); ch.setUint32(20, blob.size, true); ch.setUint32(24, blob.size, true);
    ch.setUint16(28, enc.length, true); ch.setUint32(42, this.offset, true);
    this.central.push(ch.buffer, enc);
    this.offset += 30 + enc.length + blob.size;
    this.count++;
  }
  get size() { return this.offset; }
  finish() {
    const cdSize = this.central.reduce((s, p) => s + (p.byteLength ?? p.length), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, this.count, true); end.setUint16(10, this.count, true); end.setUint32(12, cdSize, true); end.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...this.central, end.buffer], { type: 'application/zip' });
  }
}

// ---------------------------------------------------------------- plan
function plan(list, { versions, trash, rootId = null }) {
  const byId = new Map(list.nodes.map(n => [n.id, n]));
  const pathCache = new Map();
  const used = new Set();
  const pathOf = n => {
    if (pathCache.has(n.id)) return pathCache.get(n.id);
    const parent = n.parent && n.id !== rootId ? byId.get(n.parent) : null;
    const base = parent ? pathOf(parent) + '/' : (n.trashed && !rootId ? t('Papierkorb') + '/' : '');
    let p = base + safe(n.name || t('Ohne Namen'));
    if (n.kind !== 'folder') {
      let q = p;
      for (let i = 2; used.has(q.toLowerCase()); i++) q = p.replace(/(\.[^./]*)?$/, m => ` (${i})${m}`);
      p = q;
    }
    used.add(p.toLowerCase());
    pathCache.set(n.id, p);
    return p;
  };
  const inRoot = n => { if (!rootId) return true; for (let c = n, g = 0; c && g < 200; g++) { if (c.id === rootId) return true; c = c.parent ? byId.get(c.parent) : null; } return false; };
  const files = [];
  for (const n of list.nodes) {
    if (n.kind === 'folder' || (!trash && n.trashed) || !inRoot(n) || n.err) continue;
    const path = pathOf(n);
    const vs = (n.versions || []).filter(v => !v.err).sort((a, b) => (b.head - a.head) || (Date.parse(b.createdAt) - Date.parse(a.createdAt)));
    for (const v of versions ? vs : vs.filter(x => x.head)) {
      const vpath = v.head ? path : `${t('Ältere Versionen')}/${path.replace(/(\.[^./]*)?$/, m => ` (${String(v.createdAt || '').slice(0, 19).replace(/[T:]/g, '-')})${m}`)}`;
      files.push({ id: n.id, revId: v.id, path: vpath, size: v.size || 0, mtime: v.mtime, node: n });
    }
  }
  return { files, pathOf, byId };
}
function sidecar(n) {
  const m = n.meta || {};
  const o = { name: n.name, takenAt: m.takenAt, tz: m.tz, gps: m.gps, exif: m.exif, width: m.w, height: m.h, durationMs: m.durationMs, favorite: m.favorite || undefined, description: m.description };
  return Object.values(o).some(v => v !== undefined) ? new Blob([JSON.stringify(o, null, 2)], { type: 'application/json' }) : null;
}

// ---------------------------------------------------------------- run
async function writeTo(target, entries, onFile, onPart) {
  // target: { dir: FileSystemDirectoryHandle } or { zip: true, prefix, startPart }
  const getDir = async (root, parts) => { let d = root; for (const p of parts) d = await d.getDirectoryHandle(p, { create: true }); return d; };
  let part = target.zip ? new ZipPart() : null, partNo = target.startPart || 1, partKeys = [];
  const flush = async () => {
    if (!part || !part.count) return;
    saveBlob(part.finish(), `${target.prefix}-${t('Teil')}-${partNo}.zip`);
    if (onPart) await onPart(partNo, partKeys); // only now are these files really on the device (resume point)
    partNo++; part = new ZipPart(); partKeys = [];
  };
  for (const e of entries) {
    if (target.dir) {
      const parts = e.path.split('/'); const name = parts.pop();
      const d = await getDir(target.dir, parts);
      try { const fh = await d.getFileHandle(name); const f = await fh.getFile(); if (e.size && f.size === e.size) { onFile(e, true); continue; } } catch {}
      const blob = await e.get();
      const w = await (await d.getFileHandle(name, { create: true })).createWritable();
      await w.write(blob); await w.close();
    } else {
      const blob = await e.get();
      if (part.size + blob.size > PART_MAX && part.count) await flush();
      await part.add(e.path, blob, e.mtime);
      partKeys.push(e.key);
    }
    onFile(e, false);
  }
  await flush();
}

export async function exportAll({ rootNode = null } = {}) {
  const fsa = typeof window.showDirectoryPicker === 'function';
  const opts = { versions: false, trash: false };
  const prev = !rootNode ? await kv.get('exportProgress', null).catch(() => null) : null;
  const r = await openDialog({
    title: rootNode ? t('„{name}“ herunterladen', { name: rootNode.name }) : t('Alles exportieren'),
    body: [
      el('p.dlg-text', rootNode ? t('Der Ordner wird auf diesem Gerät entschlüsselt und als ZIP gespeichert – mit Unterordnern und Dateidaten.') : t('Alle Dateien und Fotos werden auf diesem Gerät entschlüsselt und als normale Ordner und Dateien gespeichert – mit Datum, Foto-Metadaten (JSON), Alben und einer Übersicht (manifest.json). Du brauchst dafür kein FaLe-Werkzeug.')),
      rootNode ? null : el('label.check', el('input', { type: 'checkbox', onchange: e => { opts.versions = e.target.checked; } }), el('span', t('Auch ältere Versionen exportieren'))),
      rootNode ? null : el('label.check', el('input', { type: 'checkbox', onchange: e => { opts.trash = e.target.checked; } }), el('span', t('Papierkorb einschließen'))),
      el('p.hint', fsa ? t('Du wählst gleich einen Ordner. Wird der Export unterbrochen, starte ihn einfach neu: Fertige Dateien werden übersprungen.') : t('Der Export kommt in ZIP-Teilen zu je höchstens 250 MB. Wird er unterbrochen, kannst du ihn fortsetzen.')),
      prev && prev.done && prev.done.length && !fsa ? el('p.hint', t('Ein früherer Export wurde unterbrochen ({n} Dateien fertig). Er wird fortgesetzt.', { n: fmtNum(prev.done.length) })) : null,
    ],
    actions: [{ label: t('Abbrechen'), value: 'cancel' }, { label: fsa && !rootNode ? t('Ordner wählen …') : t('Export starten'), value: 'ok', default: true }],
  });
  if (r.value !== 'ok') return;
  let dir = null;
  if (fsa && !rootNode) { try { dir = await window.showDirectoryPicker({ id: 'fale-one-export', mode: 'readwrite' }); } catch { return; } }
  const status = el('span', t('Lese die Liste …'));
  const bar = progressBar(0, t('Export-Fortschritt'));
  const close = toast(el('span.toast-prog', status, bar), { timeout: 24 * 3600e3 });
  try {
    const list = await E.call('exportList');
    const { files, pathOf, byId } = plan(list, { ...opts, rootId: rootNode ? rootNode.id : null });
    const prefix = rootNode ? safe(rootNode.name) : 'FaLe-One-Export-' + new Date().toISOString().slice(0, 10);
    const progress = !rootNode && !dir ? (prev || { done: [] }) : { done: [] };
    const doneSet = new Set(progress.done || []);
    const total = files.reduce((s, f) => s + f.size, 0);
    let bytes = 0, count = 0;
    const entries = [];
    for (const f of files) {
      const key = f.id + ':' + f.revId;
      if (doneSet.has(key)) { bytes += f.size; continue; }
      entries.push({ path: f.path, size: f.size, mtime: f.mtime, key, get: () => E.call('exportFile', { id: f.id, revId: f.revId }) });
      if (f.node.kind === 'photo' && f.revId === (f.node.versions.find(v => v.head) || {}).id) {
        const sc = sidecar(f.node);
        if (sc) entries.push({ path: f.path + '.json', size: sc.size, mtime: f.mtime, key: key + ':json', get: async () => sc });
      }
    }
    if (!rootNode) {
      const albums = list.albums.map(a => ({ name: a.name, items: a.items.map(id => byId.get(id)).filter(n => n && (opts.trash || !n.trashed)).map(n => pathOf(n)) }));
      const user = await currentUser();
      const manifest = {
        exportedAt: new Date().toISOString(), app: 'FaLe One', format: 'fale-one-export-v1', account: user ? user.email : null,
        nodes: list.nodes.filter(n => !n.err && (opts.trash || !n.trashed)).map(n => ({ id: n.id, path: pathOf(n), kind: n.kind, trashed: n.trashed || undefined, versions: n.kind === 'folder' ? undefined : (n.versions || []).filter(v => !v.err && (opts.versions || v.head)).map(v => ({ id: v.id, current: v.head, size: v.size, mime: v.mime, mtime: v.mtime, digest: v.digest })) })),
        albums,
        emergency: list.emergency || undefined, // Notfallzugang: contacts, waiting period, covered items, full log
      };
      if (list.emergency) entries.push({ path: t('Notfallzugang') + '.json', size: 0, key: 'emergency', get: async () => new Blob([JSON.stringify(list.emergency, null, 2)], { type: 'application/json' }) });
      entries.push({ path: 'manifest.json', size: 0, key: 'manifest', get: async () => new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }) });
      for (const a of albums) entries.push({ path: `${t('Alben')}/${safe(a.name)}.txt`, size: 0, key: 'album:' + a.name, get: async () => new Blob([a.items.join('\r\n') + '\r\n'], { type: 'text/plain' }) });
    }
    status.textContent = tp(files.length, '{n} Datei · ', '{n} Dateien · ') + fmtSize(total);
    await writeTo(dir ? { dir } : { zip: true, prefix, startPart: (progress.part || 0) + 1 }, entries, (e) => {
      count++; bytes += e.size;
      bar.set(total ? Math.min(1, bytes / total) : count / entries.length);
      status.textContent = t('Exportiere … {done} von {total}', { done: fmtSize(bytes), total: fmtSize(total) });
    }, async (partNo, keys) => {
      if (rootNode) return;
      keys.forEach(k => doneSet.add(k));
      await kv.set('exportProgress', { part: partNo, done: [...doneSet] }).catch(() => {});
    });
    if (!rootNode) await kv.del('exportProgress').catch(() => {});
    close();
    toast(rootNode ? t('Download fertig.') : t('Export fertig: {n} Dateien, {size}.', { n: fmtNum(files.length), size: fmtSize(total) }), { timeout: 8000 });
  } catch (e) {
    close();
    errorToast(e, t('Der Export wurde unterbrochen. Starte ihn erneut, um fortzusetzen.'));
  }
}
export function exportFolder(node) { return exportAll({ rootNode: node }); }
export { writeTo };
