// Google Takeout (Google Fotos) import: finds the photos/videos in one or more Takeout ZIPs, pairs each with
// its JSON sidecar (capture time, GPS, favourite, description) and works out album membership from the
// album folders. The originals are uploaded untouched; the sidecar data goes into the encrypted node meta.
import { listZip, readJson } from './unzip.js';
import { kindOf, mimeOf } from './media.js';

const YEAR_DIR = /^(Photos from|Fotos von|Fotos aus|Foto dal|Photos de)\s+\d{4}$/i;
const SKIP_DIR = /^(Trash|Papierkorb|Bin|Corbeille|Archive|Archiv)$/i;
const SUPP = '.supplemental-metadata';

function sidecarFor(dirJsons, base) {
  // 1) exact "<name>.json" / "<name>.supplemental-metadata.json" (also truncated by Google to ~51 chars)
  const cand = [base + '.json'];
  for (let i = SUPP.length; i >= 1; i--) cand.push(base + SUPP.slice(0, i) + '.json');
  for (const c of cand) if (dirJsons.has(c)) return dirJsons.get(c);
  // 2) "IMG(1).jpg" ↔ "IMG.jpg(1).json"
  const m = /^(.*)\((\d+)\)(\.[^.]+)$/.exec(base);
  if (m) {
    const alt = `${m[1]}${m[3]}(${m[2]}).json`;
    if (dirJsons.has(alt)) return dirJsons.get(alt);
    for (let i = SUPP.length; i >= 1; i--) { const a = `${m[1]}${m[3]}${SUPP.slice(0, i)}(${m[2]}).json`; if (dirJsons.has(a)) return dirJsons.get(a); }
  }
  // 3) edited copies use the original's sidecar
  const ed = /^(.*)-(edited|bearbeitet|modifié|editado|modificato)(\.[^.]+)$/i.exec(base);
  if (ed) return sidecarFor(dirJsons, ed[1] + ed[3]);
  // 4) truncated names: the sidecar stem is a prefix of the media name (Google cuts long names at 46/51 chars)
  let best = null;
  for (const [jn, e] of dirJsons) {
    let stem = jn.replace(/\.json$/i, '').replace(/(\.supplemental-metadata|\.supplemental-metadat|\.supplemental-metad|\.supplemental-me|\.supplemental-m|\.supplemental|\.supplementa|\.supplement|\.suppl|\.supp|\.su|\.s)$/i, '');
    if (stem.length >= 20 && base.startsWith(stem) && (!best || stem.length > best[0])) best = [stem.length, e];
  }
  return best ? best[1] : null;
}

/** Meta fields from a Takeout sidecar JSON. */
export function sidecarMeta(j) {
  if (!j || typeof j !== 'object') return {};
  const out = {};
  const ts = Number(j.photoTakenTime && j.photoTakenTime.timestamp);
  if (ts > 0) out.takenAt = new Date(ts * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const g = (j.geoDataExif && (j.geoDataExif.latitude || j.geoDataExif.longitude)) ? j.geoDataExif : j.geoData;
  if (g && (g.latitude || g.longitude) && Math.abs(g.latitude) <= 90 && Math.abs(g.longitude) <= 180) {
    out.gps = { lat: Math.round(g.latitude * 1e6) / 1e6, lon: Math.round(g.longitude * 1e6) / 1e6 };
    if (typeof g.altitude === 'number' && g.altitude) out.gps.alt = Math.round(g.altitude * 10) / 10;
  }
  if (j.favorited === true) out.favorite = true;
  if (typeof j.description === 'string' && j.description.trim()) out.description = j.description.trim().slice(0, 2000);
  return out;
}

/**
 * Scan Takeout archives. → { items: [{ zip (index), entry, name, mime, kind, sidecar: meta, albums: [name] }], albums: [name], skipped }
 * Duplicates across year folders and album folders are kept – the upload deduplicates them by content hash
 * (the album membership is then attached to the one stored copy).
 */
export async function scanTakeout(zips, onProgress) {
  const items = [];
  const albumTitles = new Set();
  let skipped = 0;
  for (let z = 0; z < zips.length; z++) {
    const entries = await listZip(zips[z]);
    const byDir = new Map();
    for (const e of entries) { if (!byDir.has(e.dir)) byDir.set(e.dir, []); byDir.get(e.dir).push(e); }
    let n = 0;
    for (const [dir, list] of byDir) {
      const leaf = dir.split('/').pop() || '';
      if (SKIP_DIR.test(leaf)) { skipped += list.length; continue; }
      const jsons = new Map(list.filter(e => /\.json$/i.test(e.base)).map(e => [e.base, e]));
      let album = null;
      if (leaf && !YEAR_DIR.test(leaf) && !/^(Google Photos|Google Fotos|Takeout)$/i.test(leaf)) {
        const md = jsons.get('metadata.json') || jsons.get('Metadaten.json');
        const j = md ? await readJson(zips[z], md) : null;
        album = (j && typeof j.title === 'string' && j.title.trim()) ? j.title.trim().slice(0, 120) : leaf;
      }
      for (const e of list) {
        if (/\.json$/i.test(e.base) || /^\./.test(e.base)) continue;
        const mime = mimeOf(e.base, '');
        const kind = kindOf(e.base, mime);
        if (kind !== 'image' && kind !== 'video') { skipped++; continue; }
        const sc = sidecarFor(jsons, e.base);
        const sidecar = sc ? sidecarMeta(await readJson(zips[z], sc)) : {};
        if (album) albumTitles.add(album);
        items.push({ zip: z, entry: e, name: e.base, mime, kind, sidecar, albums: album ? [album] : [] });
        if (onProgress && ++n % 200 === 0) onProgress(items.length);
      }
    }
  }
  return { items, albums: [...albumTitles], skipped };
}
