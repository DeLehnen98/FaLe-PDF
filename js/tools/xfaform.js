// Behörden-Formulare (XFA): forms that many authorities still publish only in the XFA format. Most PDF apps show
// just a "Bitte warten … dieses Formular braucht ein bestimmtes Programm" placeholder page for them.
// pdf.js has an XFA engine (it lays the form out as HTML); it is OFF everywhere else in the app and only used here,
// for documents that are XFA-only. PDF JavaScript stays off (enableScripting false), so form scripts never run.
//
// - fill in: pdf.js keeps the values in its annotation storage
// - save: pdf.saveDocument() writes them into the XFA data → the authority gets its own form back, filled in
// - "Als normale PDF": the laid-out form is redrawn as an ordinary PDF (text stays text) – for printing, sending by
//   e-mail or opening in any other app. Drawn from the HTML layout: backgrounds, borders, texts, field values,
//   check boxes and images.
import * as db from '../db.js';
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, progress, baseName, UserError } from '../ui.js';
import { resultCard } from '../components.js';
import { getDocBytes, saveResult } from '../library.js';
import { loadPdf, pdfjsLib } from '../pdfcore.js';
import { loadPdfLib, saveDoc } from '../pdflib.js';
import { ensureCss, updateFoot } from './common.js';
import { guardLinks } from '../security.js';
import { isNative, printPdf } from '../platform.js';
import { needsUnicode, fontForText, cleanText, drawTextImage } from '../office/unifont.js';

/**
 * What kind of form is this? 'pure' = only XFA (other apps show a placeholder), 'hybrid' = XFA plus normal form
 * fields (the normal fill-in tool works; pdf-lib drops the outdated XFA part when saving), null = no XFA.
 */
export async function xfaKind(pdf) {
  try {
    const { info } = await pdf.getMetadata();
    if (!info || !info.IsXFAPresent) return null;
    // real authority forms often carry a signature field (or an empty container) next to the XFA part – only normal
    // fillable fields (text, check box, choice …) make a "hybrid" form that the normal fill-in tool can handle
    let fields = null;
    try { fields = await pdf.getFieldObjects(); } catch { fields = null; }
    const fillable = Object.values(fields || {}).flat().filter(f => f && f.type && f.type !== 'signature' && f.page >= 0);
    return fillable.length ? 'hybrid' : 'pure';
  } catch { return null; }
}

/** Viewer banner for XFA-only forms (shown instead of guessing at the placeholder page). */
export async function showXfaBanner(host, { docId, pdf, isCurrent = () => true }) {
  if (await xfaKind(pdf) !== 'pure' || !isCurrent()) return null;
  host.querySelectorAll('.ocr-banner').forEach(b => b.remove());
  const el = h(`<div class="ocr-banner xfa-banner" role="region" aria-label="Hinweis Formular">${icon('form')}
    <span>Das ist ein Behörden-Formular. Hier siehst du nur einen Platzhalter – öffne es zum Ausfüllen.</span>
    <span class="ocr-banner-act"><button class="btn btn-primary btn-sm" type="button" data-xfa-go>Formular ausfüllen</button></span></div>`);
  el.querySelector('[data-xfa-go]').addEventListener('click', () => { location.hash = `#/werkzeug/behoerdenformular?doc=${docId}`; });
  host.appendChild(el);
  return el;
}

let viewerMod = null;
const viewerLib = () => (viewerMod ||= import('../../vendor/pdfjs/pdf_viewer.mjs'));

export async function mount(screen, { docId }) {
  const doc = await db.getDoc(docId);
  if (!doc) { screen.body.innerHTML = '<p class="panel-empty">Dokument nicht gefunden.</p>'; return; }
  screen.setTitle('Behörden-Formular ausfüllen', doc.name);
  await ensureCss();
  const bytes = await getDocBytes(docId);
  const { pdf } = await loadPdf(bytes.slice(), { name: doc.name, key: docId, xfa: true });
  let alive = true;

  if (!pdf.isPureXfa) {
    const kind = await xfaKind(pdf);
    pdf.destroy();
    screen.body.innerHTML = `<div class="screen-inner"><div class="card xfa-info">${icon('form')}<div>
      <h2>${kind === 'hybrid' ? 'Dieses Formular kannst du normal ausfüllen' : 'Das ist kein Behörden-Formular im XFA-Format'}</h2>
      <p>Öffne es mit „Ausfüllen &amp; unterschreiben“ – dort kannst du auch unterschreiben.</p>
      <a class="btn btn-primary" href="#/werkzeug/unterschreiben?doc=${esc(docId)}">${icon('sign')} Ausfüllen &amp; unterschreiben</a></div></div></div>`;
    return;
  }

  const { EventBus, PDFLinkService, PDFViewer, GenericL10n, LinkTarget } = await viewerLib();
  screen.body.classList.add('xfa-body');
  screen.body.innerHTML = `<div class="xfa-bar"><p class="xfa-tip">${icon('info')}<span>Tippe in die Felder und fülle sie aus. Mit „Speichern“ bleibt es das Original-Formular – so, wie es die Behörde erwartet.</span></p>
    <div class="xfa-zoom" role="group" aria-label="Größe"><button class="icon-btn" type="button" data-zoom="-1" aria-label="Kleiner">${icon('zoomOut')}</button><button class="icon-btn" type="button" data-zoom="1" aria-label="Größer">${icon('zoomIn')}</button></div></div>
    <div class="xfa-stage"><div class="xfa-scroll" data-xfa-scroll tabindex="0"><div class="pdfViewer" data-xfa-viewer></div></div></div>
    <div data-result></div>`;
  const scroll = screen.body.querySelector('[data-xfa-scroll]');
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK, externalLinkRel: 'noopener noreferrer nofollow' });
  const viewer = new PDFViewer({
    container: scroll, viewer: screen.body.querySelector('[data-xfa-viewer]'), eventBus, linkService, l10n: new GenericL10n(),
    textLayerMode: 0, annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS, annotationEditorMode: pdfjsLib.AnnotationEditorType.DISABLE,
  });
  linkService.setViewer(viewer);
  guardLinks(scroll, { source: 'Das Formular enthält einen Link.' });
  // bigger / smaller (phones show the A4 page at page width – small print for many people)
  screen.body.querySelectorAll('[data-zoom]').forEach(b => b.addEventListener('click', () => {
    const next = Math.min(4, Math.max(0.4, viewer.currentScale * (b.dataset.zoom === '1' ? 1.25 : 0.8)));
    viewer.currentScaleValue = String(next);
  }));
  // Forms made with the usual form designer show a red "JavaScript is disabled / JavaScript ist deaktiviert …" line
  // that their own script would hide on opening. Form scripts never run here (safety), so the line would only confuse.
  const JS_NOTE = /javascript/i, JS_NOTE2 = /(disabled|deaktiviert|désactivé|desactivado|disattivato|enable|aktivieren|activez)/i;
  const hideJsNotes = root => root.querySelectorAll('.xfaLayer .xfaRich, .xfaLayer .xfaTextfield[readonly]').forEach(el => {
    const t = el.textContent || '';
    if (t.length < 400 && JS_NOTE.test(t) && JS_NOTE2.test(t)) { const w = el.closest('.xfaWrapper') || el; w.hidden = true; w.style.display = 'none'; }
  });
  const mo = new MutationObserver(() => hideJsNotes(scroll));
  mo.observe(scroll, { childList: true, subtree: true });
  let dirty = false;
  const onPagesInit = () => { viewer.currentScaleValue = scroll.clientWidth < 700 ? 'page-width' : 'auto'; };
  eventBus.on('pagesinit', onPagesInit);
  viewer.setDocument(pdf);
  linkService.setDocument(pdf, null);
  pdf.annotationStorage.onSetModified = () => { dirty = true; foot(); };
  pdf.annotationStorage.onResetModified = () => { dirty = false; foot(); };

  const saveBtn = h(`<button class="btn btn-primary" type="button">${icon('download')} Speichern</button>`);
  const flatBtn = h(`<button class="btn btn-secondary" type="button">${icon('file')} Als normale PDF</button>`);
  const printBtn = h(`<button class="btn btn-ghost" type="button" aria-label="Drucken">${icon('print')}</button>`);
  const foot = () => { if (alive) updateFoot(screen, [printBtn, flatBtn, saveBtn], dirty ? 'Ungespeicherte Änderungen' : ''); };
  foot();
  const result = screen.body.querySelector('[data-result]');
  const showResult = (rdoc, note) => {
    result.innerHTML = '';
    const wrap = h('<div class="pt-result screen-inner"></div>');
    wrap.appendChild(resultCard(rdoc, { from: docId, title: 'Gespeichert', note }));
    result.appendChild(wrap);
    wrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const busy = on => { saveBtn.disabled = flatBtn.disabled = printBtn.disabled = on; };
  const commitFocus = () => { const a = document.activeElement; if (a && scroll.contains(a) && a.blur) a.blur(); };

  saveBtn.addEventListener('click', async () => {
    commitFocus();
    busy(true);
    const prog = progress('Speichere das Formular …');
    try {
      const out = await pdf.saveDocument();
      const rdoc = await saveResult(out, `${baseName(doc.name)} (ausgefüllt).pdf`);
      pdf.annotationStorage.resetModified();
      dirty = false; foot();
      showResult(rdoc, 'Behörden-Formular');
    } catch (e) { errorToast(e, 'Das Formular konnte nicht gespeichert werden.'); }
    finally { prog.done(); busy(false); }
  });
  flatBtn.addEventListener('click', async () => {
    commitFocus();
    busy(true);
    const prog = progress('Erstelle eine normale PDF …');
    try {
      const out = await flattenXfa(viewer, pdf, p => prog.set(`Erstelle eine normale PDF … ${Math.round(p * 100)} %`));
      const rdoc = await saveResult(out, `${baseName(doc.name)} (ausgefüllt, normale PDF).pdf`);
      showResult(rdoc, 'Zum Drucken und Versenden');
    } catch (e) { errorToast(e, 'Die PDF konnte nicht erstellt werden.'); }
    finally { prog.done(); busy(false); }
  });
  printBtn.addEventListener('click', async () => {
    commitFocus();
    busy(true);
    try {
      const out = await flattenXfa(viewer, pdf);
      if (isNative()) await printPdf(out, `${baseName(doc.name)}.pdf`);
      else await printBytes(out);
    } catch (e) { errorToast(e, 'Drucken ist nicht möglich.'); }
    finally { busy(false); }
  });

  return () => {
    alive = false;
    mo.disconnect();
    eventBus.off('pagesinit', onPagesInit);
    try { viewer.setDocument(null); linkService.setDocument(null); } catch {}
    try { pdf.destroy(); } catch {}
  };
}

/** Web printing: the normal PDF is rendered to page images (same look in every browser). */
async function printBytes(out) {
  const { pdf } = await loadPdf(out.slice(), { name: 'Formular' });
  const area = document.getElementById('print-area');
  if (!area) throw new UserError('Drucken ist hier nicht möglich.');
  const urls = [];
  try {
    area.innerHTML = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 2 });
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp, background: 'white' }).promise;
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const u = URL.createObjectURL(blob); urls.push(u);
      const img = new Image(); img.src = u; img.alt = ''; area.appendChild(img);
      await img.decode().catch(() => {});
    }
  } finally { pdf.destroy(); }
  const cleanup = () => { area.innerHTML = ''; urls.forEach(u => URL.revokeObjectURL(u)); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  window.print();
}

// ---------------------------------------------------------------- XFA layout → ordinary PDF
const px = v => parseFloat(v) || 0;
function rgbOf(css) {
  const m = /rgba?\(([^)]+)\)/.exec(css || '');
  if (!m) return null;
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (p.length >= 4 && p[3] === 0) return null;
  return { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255, a: p.length >= 4 ? p[3] : 1 };
}
const visible = (el, cs) => cs.display !== 'none' && cs.visibility !== 'hidden' && !el.closest('.xfaPrintOnly[hidden]');

/** Lines of a text node as laid out on screen: [{text, rect}] (words grouped by their line box). */
function textLines(node) {
  const out = [];
  const text = node.nodeValue;
  const re = /\S+/g;
  const range = document.createRange();
  let m, line = null;
  while ((m = re.exec(text))) {
    range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
    const r = range.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    if (line && Math.abs(r.top - line.top) < r.height * 0.5) { line.text += ' ' + m[0]; line.right = r.right; line.bottom = Math.max(line.bottom, r.bottom); }
    else { line = { text: m[0], left: r.left, right: r.right, top: r.top, bottom: r.bottom }; out.push(line); }
  }
  range.detach && range.detach();
  return out;
}

/**
 * Draw every XFA page of `viewer` (pdf.js PDFViewer showing an XFA document) into a new ordinary PDF.
 * Pages that are not rendered yet are scrolled into view first.
 */
export async function flattenXfa(viewer, pdf, onProgress = null) {
  const PDFLib = await loadPdfLib();
  const { PDFDocument, rgb, degrees } = PDFLib;
  const out = await PDFDocument.create();
  const fonts = new Map();
  const fontFor = async (text, bold) => {
    const k = (needsUnicode(text) ? 'u' : 's') + (bold ? 'b' : 'r');
    if (!fonts.has(k)) fonts.set(k, await fontForText(out, text, { bold, PDFLib }));
    return fonts.get(k);
  };
  const keepPage = viewer.currentPageNumber;
  for (let n = 1; n <= pdf.numPages; n++) {
    if (onProgress) onProgress(n / pdf.numPages);
    const pv = viewer.getPageView(n - 1);
    if (!pv.xfaLayer || !pv.xfaLayer.div || !pv.xfaLayer.div.isConnected) {
      viewer.currentPageNumber = n;
      for (let i = 0; i < 60 && !(pv.xfaLayer && pv.xfaLayer.div && pv.xfaLayer.div.isConnected); i++) await new Promise(r => setTimeout(r, 50));
    }
    const layer = pv.xfaLayer && pv.xfaLayer.div;
    if (!layer) throw new UserError('Das Formular ist noch nicht geladen – bitte kurz warten und noch einmal versuchen.');
    const page1 = await pdf.getPage(n);
    const vp = page1.getViewport({ scale: 1 });
    const pageEl = layer;
    // the page box itself (the XFA layer's own box can be narrower than the page – content is positioned absolutely)
    const pr = pv.div.getBoundingClientRect();
    const box = { left: pr.left + pv.div.clientLeft, top: pr.top + pv.div.clientTop, width: pv.div.clientWidth || pr.width };
    const k = vp.width / box.width; // CSS px on screen → PDF points
    const page = out.addPage([vp.width, vp.height]);
    const X = x => (x - box.left) * k, Y = y => vp.height - (y - box.top) * k;
    const els = [...pageEl.querySelectorAll('*')];
    // 1) backgrounds and borders
    for (const el of els) {
      const cs = getComputedStyle(el);
      if (!visible(el, cs)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const bg = rgbOf(cs.backgroundColor);
      // form buttons ("Validate", "Clear form" …) only work on screen – they are left out of the printable copy
      if (el.closest('button, .xfaButton')) continue;
      if (bg && !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) page.drawRectangle({ x: X(r.left), y: Y(r.bottom), width: r.width * k, height: r.height * k, color: rgb(bg.r, bg.g, bg.b), opacity: bg.a });
      const side = (w, st, col, x0, y0, x1, y1) => {
        if (px(w) <= 0 || st === 'none' || st === 'hidden') return;
        const c = rgbOf(col) || { r: 0, g: 0, b: 0, a: 1 };
        page.drawLine({ start: { x: X(x0), y: Y(y0) }, end: { x: X(x1), y: Y(y1) }, thickness: Math.max(0.4, px(w) * k), color: rgb(c.r, c.g, c.b), opacity: c.a,
          dashArray: st === 'dashed' ? [3, 2] : st === 'dotted' ? [0.8, 1.6] : undefined });
      };
      side(cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor, r.left, r.top, r.right, r.top);
      side(cs.borderBottomWidth, cs.borderBottomStyle, cs.borderBottomColor, r.left, r.bottom, r.right, r.bottom);
      side(cs.borderLeftWidth, cs.borderLeftStyle, cs.borderLeftColor, r.left, r.top, r.left, r.bottom);
      side(cs.borderRightWidth, cs.borderRightStyle, cs.borderRightColor, r.right, r.top, r.right, r.bottom);
    }
    // maxW: the width the text has on screen (CSS px) – forms use narrow fonts (e.g. Myriad) that the PDF draws in
    // Helvetica/Liberation; a line is set slightly smaller when it would otherwise run into its neighbour
    const drawText = async (text, left, baseline, cs, maxW = 0) => {
      const clean = String(text).replace(/\s+/g, ' ').trim();
      if (!clean) return;
      let size = Math.max(4, px(cs.fontSize) * k);
      const bold = (parseInt(cs.fontWeight, 10) || 400) >= 600;
      const c = rgbOf(cs.color) || { r: 0, g: 0, b: 0, a: 1 };
      const opts = { x: X(left), y: Y(baseline), size, color: rgb(c.r, c.g, c.b), bold };
      if (await drawTextImage(page, out, clean, opts)) return;
      const font = await fontFor(clean, bold);
      const t = cleanText(clean, font).text;
      if (maxW > 0) {
        const w = font.widthOfTextAtSize(t, size), room = maxW * k * 1.02;
        if (w > room) opts.size = size = Math.max(3, size * room / w);
      }
      page.drawText(t, { ...opts, font });
    };
    // 2) static texts (captions, labels, rich text)
    const walker = document.createTreeWalker(pageEl, NodeFilter.SHOW_TEXT);
    let t;
    while ((t = walker.nextNode())) {
      const el = t.parentElement;
      if (!el || el.closest('select, textarea, button')) continue;
      const cs = getComputedStyle(el);
      if (!visible(el, cs) || !t.nodeValue.trim()) continue;
      for (const ln of textLines(t)) await drawText(ln.text, ln.left, ln.bottom - (ln.bottom - ln.top) * 0.22, cs, ln.right - ln.left);
    }
    // 3) field values
    for (const el of pageEl.querySelectorAll('input, textarea, select')) {
      const cs = getComputedStyle(el);
      if (!visible(el, cs)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (el.type === 'checkbox' || el.type === 'radio') {
        const s = Math.min(r.width, r.height) * k, cx = X(r.left + r.width / 2), cy = Y(r.top + r.height / 2);
        if (el.type === 'radio') page.drawCircle({ x: cx, y: cy, size: s / 2, borderWidth: 0.7, borderColor: rgb(0, 0, 0) });
        else page.drawRectangle({ x: cx - s / 2, y: cy - s / 2, width: s, height: s, borderWidth: 0.7, borderColor: rgb(0, 0, 0) });
        if (el.checked) {
          if (el.type === 'radio') page.drawCircle({ x: cx, y: cy, size: s / 4, color: rgb(0, 0, 0) });
          else {
            page.drawLine({ start: { x: cx - s * 0.32, y: cy + s * 0.02 }, end: { x: cx - s * 0.08, y: cy - s * 0.28 }, thickness: s * 0.12, color: rgb(0, 0, 0) });
            page.drawLine({ start: { x: cx - s * 0.08, y: cy - s * 0.28 }, end: { x: cx + s * 0.34, y: cy + s * 0.3 }, thickness: s * 0.12, color: rgb(0, 0, 0) });
          }
        }
        continue;
      }
      const value = el.tagName === 'SELECT' ? (el.selectedIndex >= 0 && el.value !== '' ? el.options[el.selectedIndex].text : '') : el.value;
      if (!value || !String(value).trim()) continue;
      const size = Math.max(4, px(cs.fontSize));
      const padL = px(cs.paddingLeft) + px(cs.borderLeftWidth) + 1;
      const lines = el.tagName === 'TEXTAREA' ? await wrapLines(String(value), (r.width - padL * 2) * k, size * k, fontFor) : [String(value).replace(/\s+/g, ' ')];
      const lh = size * 1.2;
      const top = el.tagName === 'TEXTAREA' ? r.top + px(cs.paddingTop) + px(cs.borderTopWidth) : r.top + (r.height - lh) / 2;
      for (let i = 0; i < lines.length; i++) {
        const base = top + lh * i + size * 0.95;
        if (base > r.bottom + 1) break;
        await drawText(lines[i], r.left + padL, base, cs, r.width - padL * 2);
      }
    }
    // 4) images (logos …) – data: or blob: URLs made by pdf.js; PNG and JPEG by their first bytes
    for (const img of pageEl.querySelectorAll('img')) {
      const r = img.getBoundingClientRect();
      const src = img.getAttribute('src') || '';
      if (!r.width || !r.height || !/^(data:image\/|blob:)/i.test(src)) continue;
      try {
        const bytes = src.startsWith('data:') ? Uint8Array.from(atob(src.split(',')[1]), c => c.charCodeAt(0)) : new Uint8Array(await (await fetch(src)).arrayBuffer());
        const png = bytes[0] === 0x89 && bytes[1] === 0x50, jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
        let emb = png ? await out.embedPng(bytes) : jpg ? await out.embedJpg(bytes) : null;
        if (!emb && img.complete && img.naturalWidth) {
          // other formats (GIF, BMP, TIFF …): let the browser draw it and take a PNG
          const c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          emb = await out.embedPng(new Uint8Array(await (await new Promise(res => c.toBlob(res, 'image/png'))).arrayBuffer()));
        }
        if (emb) page.drawImage(emb, { x: X(r.left), y: Y(r.bottom), width: r.width * k, height: r.height * k, rotate: degrees(0) });
      } catch (e) { console.warn('xfa image', e); }
    }
    await new Promise(r => setTimeout(r, 0)); // keep the UI responsive between pages
  }
  if (viewer.currentPageNumber !== keepPage) viewer.currentPageNumber = keepPage;
  out.setProducer('FaLe PDF');
  return saveDoc(out);
}

async function wrapLines(text, maxW, size, fontFor) {
  const font = await fontFor(text, false);
  const width = s => { try { return font.widthOfTextAtSize(cleanText(s, font).text, size); } catch { return s.length * size * 0.5; } };
  const out = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const w of para.split(/\s+/)) {
      const next = line ? line + ' ' + w : w;
      if (line && width(next) > maxW) { out.push(line); line = w; } else line = next;
    }
    out.push(line);
  }
  return out;
}
