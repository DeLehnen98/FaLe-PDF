// FaLe One – checks what the (mock) server received from a background backup, with the web worker's own JS code:
// every photo must decrypt to the original bytes, its metadata (name, capture time, GPS, camera data, size) must
// equal what one/js/media.js reads from the same file, the keyed hash must equal JS dedupeHash, thumbnails and
// previews must decrypt to JPEGs of the right size, and the device report must open with the device key.
//   const { problems, info } = await verifyBackup({ mock, mkRaw, userId, deviceId, deviceName, fixtures })
import { createHash } from 'node:crypto';
import * as K from '../../one/js/shared/one/crypto.js';
import { parseExif, exifToMeta } from '../../one/js/media.js';

export const jpegSize = u => { // → {w, h} from the SOF marker
  for (let i = 2; i + 9 < u.length;) {
    if (u[i] !== 0xff) { i++; continue; }
    const m = u[i + 1], len = (u[i + 2] << 8) | u[i + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (u[i + 5] << 8) | u[i + 6], w: (u[i + 7] << 8) | u[i + 8] };
    i += 2 + len;
  }
  return null;
};
const sha = u => createHash('sha256').update(u).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** fixtures: [{ name, bytes: Uint8Array, taken (ms, MediaStore), w, h (oriented pixel size) }] */
export async function verifyBackup({ mock, mkRaw, userId, deviceId, deviceName, fixtures }) {
  const problems = [], info = [];
  const keys = await K.deriveKeys(await K.importMasterRaw(mkRaw), userId);
  const nodes = mock.photoNodes();
  // the photos folder (created by the background run: no folder id was handed over)
  const folders = mock.folders();
  const folderMeta = {};
  for (const f of folders) {
    try { folderMeta[f.id] = await K.openMeta(await K.openNodeKey(keys, f.id, f.key), { userId, kind: 'folder', id: f.id }, f.meta); }
    catch (e) { problems.push(`Ordner ${f.id}: ${e.message}`); }
  }
  for (const fx of fixtures) {
    const hits = [];
    for (const n of nodes) {
      try {
        const nk = await K.openNodeKey(keys, n.id, n.key);
        const meta = await K.openMeta(nk, { userId, kind: 'photo', id: n.id }, n.meta);
        if (meta.name === fx.name) hits.push({ n, nk, meta });
      } catch (e) { problems.push(`Knoten ${n.id} lässt sich nicht öffnen: ${e.message}`); }
    }
    if (hits.length !== 1) { problems.push(`${fx.name}: ${hits.length}× gesichert (erwartet 1)`); continue; }
    const { n, nk, meta } = hits[0];
    const p = m => problems.push(`${fx.name}: ${m}`);
    // node metadata = what the web app would write (media.js on the same bytes; w/h after EXIF orientation)
    const js = exifToMeta(parseExif(fx.bytes));
    if (js.takenAt ? meta.takenAt !== js.takenAt : !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/.test(meta.takenAt || '')) p(`takenAt ${meta.takenAt} ≠ ${js.takenAt}`);
    if (!same(meta.gps, js.gps)) p(`gps ${JSON.stringify(meta.gps)} ≠ ${JSON.stringify(js.gps)}`);
    if (!same(meta.exif, js.exif)) p(`exif ${JSON.stringify(meta.exif)} ≠ ${JSON.stringify(js.exif)}`);
    if ((meta.orientation || null) !== (js.orientation || null)) p(`orientation ${meta.orientation} ≠ ${js.orientation}`);
    if (meta.w !== fx.w || meta.h !== fx.h) p(`Größe ${meta.w}×${meta.h} ≠ ${fx.w}×${fx.h}`);
    if (meta.v !== 1) p('meta.v');
    const folder = folderMeta[n.parent];
    if (!folder || folder.role !== 'photos') p(`liegt nicht im Fotos-Ordner (${n.parent})`);
    // revision: keys, envelope, keyed hash, device
    const h = n.head;
    if (!h) { p('keine Version'); continue; }
    if (h.deviceId !== deviceId) p(`deviceId ${h.deviceId}`);
    let fk, rm;
    try {
      const ctx = { userId, nodeId: n.id, revId: h.id };
      fk = await K.openFileKey(nk, ctx, h.key);
      rm = await K.openRevMeta(fk, ctx, h.meta);
    } catch (e) { p('Version lässt sich nicht öffnen: ' + e.message); continue; }
    const digest = await K.contentDigest(fx.bytes);
    if (rm.size !== fx.bytes.length) p(`rmeta.size ${rm.size}`);
    if (rm.mime !== 'image/jpeg') p(`rmeta.mime ${rm.mime}`);
    if (rm.digest !== K.hex(digest)) p('rmeta.digest weicht ab');
    if (fx.taken && rm.mtime !== fx.taken) p(`rmeta.mtime ${rm.mtime} ≠ ${fx.taken}`);
    if (h.hash !== await K.dedupeHash(keys, digest)) p('Dedupe-Hash weicht vom JS-Wert ab');
    // blobs: content = original bytes; thumb/preview = JPEGs of the documented size
    const opened = {};
    for (const b of h.blobs) {
      try {
        const bk = await K.blobKey(fk, b.id, b.purpose);
        const parts = mock.chunksOf(b.id);
        const plain = [];
        for (let i = 0; i < parts.length; i++) plain.push(await K.openChunk(bk, { userId, nodeId: n.id, revId: h.id, blobId: b.id, purpose: b.purpose }, i, parts.length, parts[i]));
        opened[b.purpose] = { bytes: Buffer.concat(plain.map(x => Buffer.from(x))), chunks: parts.length };
      } catch (e) { p(`${b.purpose} lässt sich nicht entschlüsseln: ${e.message}`); }
    }
    if (!opened.content) { p('kein Inhalt'); continue; }
    if (sha(opened.content.bytes) !== sha(fx.bytes)) p('Inhalt ≠ Original');
    const t = opened.thumb && jpegSize(opened.thumb.bytes);
    if (!t) p('kein Vorschaubild'); else {
      if (Math.max(t.w, t.h) !== Math.min(256, Math.max(fx.w, fx.h)) || !rm.thumb || rm.thumb.w !== t.w || rm.thumb.h !== t.h) p(`Vorschaubild ${t.w}×${t.h}, rmeta ${JSON.stringify(rm.thumb)}`);
      if ((t.w > t.h) !== (fx.w > fx.h)) p('Vorschaubild nicht gedreht (EXIF-Ausrichtung)');
      if (opened.thumb.bytes.length > 120 * 1024) p('Vorschaubild zu groß');
    }
    const wantPreview = Math.max(fx.w, fx.h) > 1600 * 1.15;
    const pv = opened.preview && jpegSize(opened.preview.bytes);
    if (wantPreview && (!pv || Math.max(pv.w, pv.h) !== 1600 || (pv.w > pv.h) !== (fx.w > fx.h))) p(`Vorschau fehlt/falsch: ${JSON.stringify(pv)}`);
    if (!wantPreview && opened.preview) p('unnötige Vorschau');
    info.push(`${fx.name}: ${fx.bytes.length} B in ${opened.content.chunks} Teil(en) identisch, ${meta.takenAt}, GPS ${meta.gps ? meta.gps.lat + '/' + meta.gps.lon : '–'}, Vorschaubild ${t ? t.w + '×' + t.h : '–'}${pv ? ', Vorschau ' + pv.w + '×' + pv.h : ''}`);
  }
  // backup.report: the last one says "idle + success" with the encrypted device record
  const rep = mock.st.reports.filter(r => r.deviceId === deviceId);
  const last = rep[rep.length - 1];
  if (!last || last.status !== 'idle' || last.success !== true) problems.push('letzter Sicherungsbericht nicht "idle/success": ' + JSON.stringify(last && { status: last.status, success: last.success, error: last.error }));
  else {
    try {
      const dm = await K.openDeviceMeta(keys, deviceId, last.meta);
      if (dm.platform !== 'android' || dm.name !== deviceName) problems.push('Gerätedaten ' + JSON.stringify(dm));
    } catch (e) { problems.push('Gerätebericht lässt sich nicht öffnen: ' + e.message); }
  }
  return { problems, info };
}
