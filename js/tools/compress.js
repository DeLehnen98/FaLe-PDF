// Tool: compress — lossless re-save (object streams) or strong (re-render pages as JPEG).
import * as db from '../db.js';
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, progress, formatSize, baseName } from '../ui.js';
import { resultCard } from '../components.js';
import { getDocBytes, saveResult } from '../library.js';
import { loadPdf, renderPage, canvasToBlob } from '../pdfcore.js';

const trackStat = (e, n = 1) => { import('../extras/stats.js').then(m => m.track(e, n)).catch(() => {}); };
import { loadEditable, loadPdfLib, saveDoc } from '../pdflib.js';

/**
 * Compress a PDF (pure, reusable by the batch tool).
 * @param {Uint8Array} bytes
 * @param {{mode?: 'lossless'|'strong', quality?: number, dpi?: number, name?: string, key?: string, onProgress?: (text:string) => void}} [opts]
 * @returns {Promise<Uint8Array>}
 */
export async function compressPdf(bytes, { mode = 'lossless', quality = 0.6, dpi = 130, name = 'Dokument', key = null, onProgress = null } = {}) {
  if (mode === 'lossless' || mode === 'images') {
    const pdfDoc = await loadEditable(bytes, name, { key });
    const PDFLib = await loadPdfLib();
    if (mode === 'images') await shrinkImages(pdfDoc, PDFLib, { onProgress });
    recompressStreams(pdfDoc, PDFLib);
    return saveDoc(pdfDoc);
  }
  const { pdf } = await loadPdf(bytes.slice(), { name, key });
  try {
    const { PDFDocument } = await loadPdfLib();
    const outDoc = await PDFDocument.create();
    for (let i = 1; i <= pdf.numPages; i++) {
      if (onProgress) onProgress(`Komprimiere Seite ${i}/${pdf.numPages} …`);
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1, rotation: page.rotate });
      const canvas = await renderPage(page, { scale: dpi / 72 });
      const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
      canvas.width = canvas.height = 0;
      const img = await outDoc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const p = outDoc.addPage([vp.width, vp.height]);
      p.drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
      page.cleanup();
    }
    outDoc.setTitle(baseName(name));
    return await saveDoc(outDoc);
  } finally { pdf.destroy(); }
}

export async function mount(screen, { docId }) {
  const doc = await db.getDoc(docId);
  if (!doc) { screen.body.innerHTML = '<p class="panel-empty">Dokument nicht gefunden.</p>'; return; }
  screen.setTitle('Komprimieren', doc.name);

  const wrap = h(`<div class="screen-inner">
    <div class="card intro"><span class="tile-ic">${icon('compress')}</span><div><strong>${esc(doc.name)}</strong>
      <p>Aktuelle Größe: <b>${formatSize(doc.size)}</b> · ${doc.pages} Seite${doc.pages === 1 ? '' : 'n'}</p></div></div>
    <div class="option-grid" role="radiogroup" aria-label="Komprimierungsart">
      <label class="radio-card"><input type="radio" name="mode" value="images"><span><strong>Bilder verkleinern</strong>
        <span>Fotos und Scans werden kleiner gerechnet – gut lesbar wie vorher. Text, Links und Formulare bleiben unverändert.</span></span></label>
      <label class="radio-card"><input type="radio" name="mode" value="lossless"><span><strong>Verlustfrei</strong>
        <span>Optimiert die Dateistruktur und packt unkomprimierte Daten. Text, Links und Formulare bleiben unverändert.</span></span></label>
      <label class="radio-card"><input type="radio" name="mode" value="strong"><span><strong>Stark</strong>
        <span>Wandelt jede Seite in ein JPEG-Bild um. Ideal für Scans und Fotos – deutlich kleinere Dateien.</span></span></label>
    </div>
    <div class="card card-pad" data-strong hidden style="margin-top:16px">
      <div class="notice" style="margin-top:0">${icon('info')}<span>Achtung: Bei „Stark“ wird Text zu Bild – er ist danach nicht mehr markierbar oder durchsuchbar. Links und Formularfelder gehen verloren.</span></div>
      <label class="field"><span class="field-label">Bildqualität: <b data-qv>60</b> %</span><input type="range" min="25" max="90" step="5" value="60" data-q aria-label="Bildqualität"></label>
      <label class="field"><span class="field-label">Auflösung</span>
        <select class="select" data-dpi aria-label="Auflösung">
          <option value="72">72 dpi – sehr klein</option><option value="100">100 dpi – Bildschirm</option>
          <option value="130" selected>130 dpi – ausgewogen</option><option value="150">150 dpi – Druck (einfach)</option><option value="200">200 dpi – Druck (gut)</option>
        </select></label>
    </div>
    <div data-out></div></div>`);
  screen.body.appendChild(wrap);
  const strongBox = wrap.querySelector('[data-strong]');
  // default: files with big photos/scans → "Bilder verkleinern" (that is where the size is), otherwise lossless
  const bytes0 = await getDocBytes(docId);
  // (cheap estimate – no parsing: more than ~250 KB per page means photos or scans)
  const hasPhotos = (doc.size || bytes0.byteLength) / Math.max(1, doc.pages || 1) > 250e3;
  wrap.querySelector(`input[name="mode"][value="${hasPhotos ? 'images' : 'lossless'}"]`).checked = true;
  const out = wrap.querySelector('[data-out]');
  const q = wrap.querySelector('[data-q]');
  q.addEventListener('input', () => { wrap.querySelector('[data-qv]').textContent = q.value; });
  wrap.querySelectorAll('input[name="mode"]').forEach(r => r.addEventListener('change', () => {
    strongBox.hidden = wrap.querySelector('input[name="mode"]:checked').value !== 'strong';
  }));
  if (doc.encrypted) {
    wrap.querySelector('.option-grid').insertAdjacentHTML('afterend', `<div class="notice">${icon('lock')}<span>Passwortgeschützt: Das Ergebnis wird ohne Passwort gespeichert. Mit „Passwort festlegen“ kannst du es wieder schützen.</span></div>`);
  }

  const btn = h(`<button class="btn btn-primary" type="button" data-run>${icon('compress')} Komprimieren</button>`);
  screen.setFoot([btn]);

  btn.addEventListener('click', async () => {
    const mode = wrap.querySelector('input[name="mode"]:checked').value;
    btn.disabled = true;
    const prog = progress('Komprimiere …');
    try {
      const bytes = bytes0;
      const result = await compressPdf(bytes, { mode, quality: +q.value / 100, dpi: +wrap.querySelector('[data-dpi]').value, name: doc.name, key: docId, onProgress: t => prog.set(t) });
      const before = doc.size, after = result.byteLength;
      const saving = Math.round((1 - after / before) * 100);
      out.innerHTML = '';
      const cmp = h(`<div class="card card-pad" style="margin-top:18px">
        <div class="compare"><div><div class="num">${formatSize(before)}</div><div class="lbl">Vorher</div></div>
        <div class="arrow">${icon('arrowRight')}</div><div><div class="num">${formatSize(after)}</div><div class="lbl">Nachher</div></div></div>
        <div style="text-align:center">${saving > 0 ? `<span class="saving-pill">${saving} % kleiner</span>` : '<span class="muted">Keine Verkleinerung möglich – die Datei ist bereits gut optimiert.</span>'}</div></div>`);
      out.appendChild(cmp);
      if (mode === 'lossless' && saving < 10 && hasPhotos) {
        const tip = h(`<div class="notice">${icon('info')}<span>Die Datei besteht vor allem aus Fotos oder Scans. Mit „Bilder verkleinern“ wird sie deutlich kleiner – der Text bleibt Text.</span>
          <button class="btn btn-soft btn-sm" type="button">Bilder verkleinern</button></div>`);
        tip.querySelector('button').addEventListener('click', () => { wrap.querySelector('input[name="mode"][value="images"]').checked = true; strongBox.hidden = true; btn.click(); });
        out.appendChild(tip);
      }
      if (after < before) {
        const res = await saveResult(result, `${baseName(doc.name)} (komprimiert).pdf`);
        trackStat('bytes_saved', before - after);
        out.appendChild(resultCard(res, { from: docId, title: 'Komprimiert' }));
        toast(`Datei um ${saving} % verkleinert.`, 'success');
      } else {
        toast('Die Datei konnte nicht weiter verkleinert werden.', 'info');
      }
      out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) { errorToast(e, 'Komprimieren fehlgeschlagen.'); }
    finally { prog.done(); btn.disabled = false; }
  });

}

/** Lossless: Flate-compress streams that are stored without any filter. */
function recompressStreams(pdfDoc, PDFLib) {
  const { PDFRawStream, PDFName } = PDFLib;
  const ctx = pdfDoc.context;
  const F = PDFName.of('Filter'), L = PDFName.of('Length'), T = PDFName.of('Type'), DP = PDFName.of('DecodeParms');
  let n = 0;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.get(F)) continue;
    const type = obj.dict.get(T);
    const t = type ? type.toString() : '';
    if (t === '/XRef' || t === '/ObjStm' || t === '/Metadata') continue;
    const raw = obj.getContents();
    if (raw.length < 128) continue;
    const ns = ctx.flateStream(raw);
    if (ns.getContentsSize() >= raw.length) continue;
    for (const [k, v] of obj.dict.entries()) if (k !== L && k !== F && k !== DP) ns.dict.set(k, v);
    ctx.assign(ref, ns);
    n++;
  }
  return n;
}

const MAX_PX = 2000;   // long side of a re-encoded photo: ≈ 170 dpi on A4 – scans stay easy to read and print
const HEAVY_BPP = 0.18; // bytes per pixel above which a JPEG is saved needlessly fine (typical: 0.05–0.12)
const JPEG_Q = 0.72;
const imageStreams = (pdfDoc, PDFLib) => {
  const { PDFRawStream, PDFName } = PDFLib;
  const out = [];
  for (const [ref, obj] of pdfDoc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const st = obj.dict.get(PDFName.of('Subtype'));
    if (st && st.toString() === '/Image') out.push([ref, obj]);
  }
  return out;
};

/**
 * "Bilder verkleinern": JPEG photos/scans (DCTDecode, RGB or gray) larger than MAX_PX are decoded by the browser,
 * scaled down and saved again as JPEG; an image is only replaced when it really gets smaller. Everything else
 * (text, vector graphics, links, forms, other image types) stays untouched. One image at a time, with a pause in
 * between, so the app stays responsive even with a 100 MB scan.
 */
export async function shrinkImages(pdfDoc, PDFLib, { onProgress = null, maxPx = MAX_PX, quality = JPEG_Q } = {}) {
  const { PDFName, PDFNumber, PDFRawStream } = PDFLib;
  const N = k => PDFName.of(k);
  // JPEG images, also wrapped in a text encoding ([/ASCII85Decode /DCTDecode], made by some scanner software)
  const filters = o => { const f = o.dict.get(N('Filter')); return f ? (f.asArray ? f.asArray() : [f]).map(x => x.toString()) : []; };
  const list = imageStreams(pdfDoc, PDFLib).filter(([, o]) => {
    const fs = filters(o);
    if (fs[fs.length - 1] !== '/DCTDecode' || fs.slice(0, -1).some(x => x !== '/ASCII85Decode' && x !== '/ASCIIHexDecode')) return false;
    if (o.dict.get(N('Decode')) || o.dict.get(N('ImageMask')) || o.dict.get(N('DecodeParms'))) return false;
    const cs = o.dict.get(N('ColorSpace'));
    const c = cs ? cs.toString() : '';
    if (!/^\/Device(RGB|Gray)$/.test(c)) return false;
    const w = o.dict.get(N('Width')), h = o.dict.get(N('Height'));
    if (!w || !h) return false;
    const px = w.asNumber() * h.asNumber();
    return Math.max(w.asNumber(), h.asNumber()) > maxPx || o.getContentsSize() / Math.max(1, px) > HEAVY_BPP;
  });
  let done = 0, saved = 0;
  for (const [ref, obj] of list) {
    done++;
    if (onProgress) onProgress(`Verkleinere Bild ${done}/${list.length} …`);
    try {
      let raw = obj.getContents();
      for (const f of filters(obj).slice(0, -1)) raw = f === '/ASCII85Decode' ? ascii85(raw) : asciiHex(raw);
      const bmp = await createImageBitmap(new Blob([raw], { type: 'image/jpeg' }));
      const k = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * k)), hgt = Math.max(1, Math.round(bmp.height * k));
      const c = document.createElement('canvas');
      c.width = w; c.height = hgt;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(bmp, 0, 0, w, hgt);
      bmp.close && bmp.close();
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', quality));
      c.width = c.height = 0;
      if (!blob) continue;
      const jpg = new Uint8Array(await blob.arrayBuffer());
      if (jpg.length >= obj.getContentsSize() * 0.85) continue;
      const dict = obj.dict.clone(pdfDoc.context);
      dict.set(N('Width'), PDFNumber.of(w));
      dict.set(N('Height'), PDFNumber.of(hgt));
      dict.set(N('ColorSpace'), N('DeviceRGB'));
      dict.set(N('BitsPerComponent'), PDFNumber.of(8));
      dict.set(N('Filter'), N('DCTDecode'));
      dict.delete(N('DecodeParms'));
      dict.set(N('Length'), PDFNumber.of(jpg.length));
      pdfDoc.context.assign(ref, PDFRawStream.of(dict, jpg));
      saved += obj.getContentsSize() - jpg.length;
    } catch (e) { console.warn('shrink image', e); }
    await new Promise(r => setTimeout(r, 0));
  }
  return { images: list.length, saved };
}

/** ASCII85 (PDF /ASCII85Decode) → bytes. */
export function ascii85(bytes) {
  const out = [];
  let tuple = 0, n = 0;
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 0x7e) break; // ~>
    if (c <= 0x20) continue;
    if (c === 0x7a && n === 0) { out.push(0, 0, 0, 0); continue; } // z
    if (c < 0x21 || c > 0x75) continue;
    tuple = tuple * 85 + (c - 0x21);
    if (++n === 5) { out.push((tuple >>> 24) & 255, (tuple >>> 16) & 255, (tuple >>> 8) & 255, tuple & 255); tuple = 0; n = 0; }
  }
  if (n > 1) {
    for (let k = n; k < 5; k++) tuple = tuple * 85 + 84;
    const b = [(tuple >>> 24) & 255, (tuple >>> 16) & 255, (tuple >>> 8) & 255, tuple & 255];
    out.push(...b.slice(0, n - 1));
  }
  return Uint8Array.from(out);
}
/** ASCIIHex (PDF /ASCIIHexDecode) → bytes. */
export function asciiHex(bytes) {
  const s = new TextDecoder('latin1').decode(bytes).replace(/>.*$/s, '').replace(/[^0-9a-fA-F]/g, '');
  const t = s.length % 2 ? s + '0' : s;
  const out = new Uint8Array(t.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(t.substr(i * 2, 2), 16);
  return out;
}
