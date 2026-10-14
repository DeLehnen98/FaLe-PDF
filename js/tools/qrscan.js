// QR / barcode scanning helpers for the scanner's "QR-Code" mode: BarcodeDetector wrapper and
// the result sheet with actions (open link with confirmation, copy, Wi-Fi details, save vCard,
// save text as note or PDF).
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, confirmDialog, downloadBlob } from '../ui.js';
import { saveResult } from '../library.js';
import { loadPdfLib, saveDoc } from '../pdflib.js';
import { makeSanitizer } from './common.js';
import { parsePayload } from './qr.js';

const FORMAT_LABEL = { qr_code: 'QR-Code', ean_13: 'EAN-13', ean_8: 'EAN-8', upc_a: 'UPC-A', upc_e: 'UPC-E', code_128: 'Code 128', code_39: 'Code 39', code_93: 'Code 93', itf: 'ITF', data_matrix: 'Data Matrix', aztec: 'Aztec', pdf417: 'PDF417', codabar: 'Codabar' };

let detectorPromise = null;
/** BarcodeDetector instance or null when the browser has none / no QR support. */
export function getDetector() {
  if (detectorPromise) return detectorPromise;
  detectorPromise = (async () => {
    if (typeof window === 'undefined' || typeof window.BarcodeDetector !== 'function') return null;
    try {
      const supported = window.BarcodeDetector.getSupportedFormats ? await window.BarcodeDetector.getSupportedFormats() : ['qr_code'];
      if (!supported || !supported.includes('qr_code')) return null;
      const want = ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'data_matrix', 'aztec', 'pdf417', 'itf'].filter(f => supported.includes(f));
      return new window.BarcodeDetector({ formats: want });
    } catch (e) { console.warn('BarcodeDetector', e); return null; }
  })();
  return detectorPromise;
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('In die Zwischenablage kopiert.', 'success', { timeout: 1800 }); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    toast(ok ? 'In die Zwischenablage kopiert.' : 'Kopieren wird hier nicht unterstützt – bitte Text markieren.', ok ? 'success' : 'error');
    return ok;
  }
}

async function textToPdf(text, title) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const clean = makeSanitizer(font);
  const [W, H] = [595.28, 841.89], M = 56, size = 12;
  let page = doc.addPage([W, H]);
  let y = H - M;
  page.drawText(clean(title), { x: M, y: y - 18, size: 18, font: bold, color: rgb(0.1, 0.11, 0.2) });
  y -= 44;
  page.drawText(clean(`Gescannt am ${new Date().toLocaleString('de-DE')}`), { x: M, y, size: 9, font, color: rgb(0.45, 0.47, 0.58) });
  y -= 26;
  for (const para of clean(text).split('\n')) {
    let line = '';
    const words = para.split(/(\s+)/);
    const flush = () => { if (y < M) { page = doc.addPage([W, H]); y = H - M; } page.drawText(line, { x: M, y, size, font, color: rgb(0.1, 0.11, 0.2) }); y -= size * 1.45; line = ''; };
    for (const w of words) {
      const t = line + w;
      if (font.widthOfTextAtSize(t, size) > W - 2 * M && line.trim()) { flush(); line = w.trimStart(); }
      else line = t;
      // very long tokens (URLs): hard wrap
      while (font.widthOfTextAtSize(line, size) > W - 2 * M) {
        let cut = line.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > W - 2 * M) cut--;
        const rest = line.slice(cut); line = line.slice(0, cut); flush(); line = rest;
      }
    }
    flush();
  }
  doc.setTitle(title);
  return saveDoc(doc);
}

/**
 * Render the result sheet into `host`.
 * @param {{rawValue: string, format?: string}} code
 * @param {{onClose: Function}} opts
 */
export function showResultSheet(host, code, { onClose }) {
  const raw = String(code.rawValue || '');
  const fmt = FORMAT_LABEL[code.format] || code.format || 'Code';
  const p = code.format && code.format !== 'qr_code' && code.format !== 'aztec' && code.format !== 'data_matrix' && code.format !== 'pdf417' ? { type: 'text', text: raw } : parsePayload(raw);
  const typeLabel = { url: 'Link', wifi: 'WLAN', vcard: 'Kontakt', mail: 'E-Mail', tel: 'Telefonnummer', text: 'Text' }[p.type];
  let body = '';
  if (p.type === 'wifi') {
    body = `<dl class="qs-dl"><dt>Netzwerk (SSID)</dt><dd>${esc(p.ssid)}</dd><dt>Passwort</dt><dd><span class="qs-pw" data-pw>${p.password ? '••••••••' : '–'}</span>${p.password ? ` <button type="button" class="btn btn-ghost btn-sm" data-showpw>${icon('eye')} Anzeigen</button>` : ''}</dd>
      <dt>Verschlüsselung</dt><dd>${esc(p.security === 'nopass' ? 'Offen' : p.security)}</dd>${p.hidden ? '<dt>Versteckt</dt><dd>Ja</dd>' : ''}</dl>
      <p class="hint">Browser können sich nicht selbst mit einem WLAN verbinden – kopiere das Passwort und wähle das Netz in den Einstellungen.</p>`;
  } else if (p.type === 'vcard') {
    body = `<dl class="qs-dl">${p.name ? `<dt>Name</dt><dd>${esc(p.name)}</dd>` : ''}${p.org ? `<dt>Firma</dt><dd>${esc(p.org)}</dd>` : ''}${p.tel ? `<dt>Telefon</dt><dd>${esc(p.tel)}</dd>` : ''}${p.email ? `<dt>E-Mail</dt><dd>${esc(p.email)}</dd>` : ''}${p.url ? `<dt>Web</dt><dd>${esc(p.url)}</dd>` : ''}</dl>`;
  } else {
    body = `<div class="qs-text" tabindex="0">${esc(p.type === 'url' ? p.url : raw)}</div>`;
  }
  const actions = [];
  if (p.type === 'url') actions.push(['open', 'link', 'Link öffnen', 'btn-primary']);
  if (p.type === 'mail') actions.push(['mail', 'mail', 'E-Mail schreiben', 'btn-primary']);
  if (p.type === 'tel') actions.push(['tel', 'phone', 'Anrufen', 'btn-primary']);
  if (p.type === 'vcard') actions.push(['vcf', 'contact', 'Kontakt speichern (.vcf)', 'btn-primary']);
  if (p.type === 'wifi' && p.password) actions.push(['copypw', 'copy', 'Passwort kopieren', 'btn-primary']);
  actions.push(['copy', 'copy', p.type === 'wifi' ? 'Alles kopieren' : 'Kopieren', 'btn-soft']);
  if (p.type === 'text' || p.type === 'url') { actions.push(['note', 'note', 'Als Notiz speichern', 'btn-ghost']); actions.push(['pdf', 'file', 'Als PDF speichern', 'btn-ghost']); }
  const sheet = h(`<div class="qs-sheet" role="dialog" aria-label="Erkannter Code">
    <div class="qs-head"><span class="tile-ic">${icon(p.type === 'wifi' ? 'wifi' : p.type === 'vcard' ? 'contact' : p.type === 'url' ? 'link' : p.type === 'mail' ? 'mail' : p.type === 'tel' ? 'phone' : 'qr')}</span>
      <div><strong>${esc(typeLabel)}</strong><span>${esc(fmt)} erkannt</span></div>
      <button class="icon-btn" type="button" data-close aria-label="Schließen">${icon('close')}</button></div>
    <div class="qs-body">${body}</div>
    <div class="qs-actions">${actions.map(([id, ic, label, kind]) => `<button type="button" class="btn ${kind} btn-sm" data-act="${id}">${icon(ic)} ${esc(label)}</button>`).join('')}</div>
    <button class="btn btn-ghost btn-block qs-again" type="button" data-again>${icon('qr')} Weiter scannen</button></div>`);
  host.appendChild(sheet);
  const close = () => { sheet.remove(); onClose && onClose(); };
  sheet.querySelector('[data-close]').addEventListener('click', close);
  sheet.querySelector('[data-again]').addEventListener('click', close);
  const pw = sheet.querySelector('[data-showpw]');
  if (pw) pw.addEventListener('click', () => { sheet.querySelector('[data-pw]').textContent = p.password; pw.remove(); });
  sheet.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', async () => {
    const a = b.dataset.act;
    try {
      if (a === 'open') {
        let u;
        try { u = new URL(p.url); } catch { toast('Das ist kein gültiger Link.', 'error'); return; }
        if (!/^https?:$/.test(u.protocol)) { toast('Aus Sicherheitsgründen werden nur http/https-Links geöffnet.', 'error'); return; }
        const ok = await confirmDialog('Link öffnen?', `Der QR-Code führt zu ${u.href} – öffne nur Links, denen du vertraust.`, { okLabel: 'Öffnen' });
        if (ok) window.open(u.href, '_blank', 'noopener,noreferrer');
      } else if (a === 'mail') {
        if (await confirmDialog('E-Mail schreiben?', `An: ${p.to}`, { okLabel: 'E-Mail-App öffnen' })) location.href = raw;
      } else if (a === 'tel') {
        if (await confirmDialog('Anrufen?', `Nummer: ${p.number}`, { okLabel: 'Anrufen' })) location.href = `tel:${p.number.replace(/[^\d+]/g, '')}`;
      } else if (a === 'vcf') {
        const name = `${(p.name || 'Kontakt').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Kontakt'}.vcf`;
        downloadBlob(new Blob([p.raw.endsWith('\n') ? p.raw : p.raw + '\r\n'], { type: 'text/vcard;charset=utf-8' }), name);
        toast('Kontakt gespeichert – öffne die Datei, um ihn ins Adressbuch zu übernehmen.', 'success', { timeout: 4500 });
      } else if (a === 'copypw') { const { copySecret } = await import('../security.js'); if (await copySecret(p.password)) toast('Passwort kopiert – es wird nach 60 Sekunden aus der Zwischenablage entfernt.', 'success', { timeout: 2600 }); else await copyText(p.password); }
      else if (a === 'copy') await copyText(p.type === 'wifi' ? `WLAN: ${p.ssid}\nPasswort: ${p.password}` : raw);
      else if (a === 'note') {
        const { importAny } = await import('../library.js');
        const stamp = new Date().toLocaleString('de-DE').replace(/[.:]/g, '-').replace(/,\s*/, ' ');
        await importAny(new File([raw + '\n'], `QR-Notiz ${stamp}.txt`, { type: 'text/plain' }), { source: 'Erstellt', silent: true });
        toast('Als Notiz in „Dateien“ gespeichert.', 'success');
      } else if (a === 'pdf') {
        const stamp = new Date().toLocaleDateString('de-DE').replace(/\./g, '-');
        const res = await saveResult(await textToPdf(raw, 'Gescannter QR-Code'), `QR-Code ${stamp}.pdf`);
        toast(`„${res.name}“ gespeichert.`, 'success');
      }
    } catch (e) { errorToast(e, 'Das hat nicht geklappt.'); }
  }));
  if (navigator.vibrate) { try { navigator.vibrate(40); } catch {} }
  return { close };
}
