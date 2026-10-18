// Tools: "Text erkennen (OCR)", "Durchsuchbares PDF", "Bild zu Word", "Bild zu Excel".
// Everything runs on the device (tesseract.js in a worker, see js/ocr/engine.js).
import * as db from '../db.js';
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, pickFiles, baseName } from '../ui.js';
import { resultCard } from '../components.js';
import { saveResult, getDocBytes } from '../library.js';
import { loadPdf, pageText } from '../pdfcore.js';
import { ensureCss, fileResultCard, loadDocxLib, parseRange, proBadge, updateFoot } from './common.js';
import { recognize, ocrPdfPages, isAbort } from '../ocr/engine.js';
import { makeSearchable, imagesToSearchablePdf, pagesWithoutText } from '../ocr/searchable.js';
import { optionsBlock, ensureOcrReady, progressPanel, getLangPref, getPsmPref, ocrErrorText } from '../ocr/ui.js';

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const isImage = f => /^image\//.test(f.type || '') || /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(f.name || '');
const stripExt = n => String(n || '').replace(/\.(pdf|jpe?g|png|webp|gif|bmp|heic|heif|avif|tiff?)$/i, '');
const isPdf = f => /pdf$/i.test(f.type || '') || /\.pdf$/i.test(f.name || '');

// ---------------------------------------------------------------- text → docx / xlsx helpers
/**
 * Word document from page texts. Paragraphs are separated by blank lines.
 * layout 'paragraphs': lines of a paragraph are joined (hyphenation removed);
 * layout 'lines': line breaks are kept as in the original.
 */
export async function textsToDocx(pages, { layout = 'paragraphs', title = 'Text' } = {}) {
  const D = await loadDocxLib();
  const children = [];
  pages.forEach((txt, pi) => {
    const paras = String(txt || '').replace(/\r/g, '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    if (!paras.length) paras.push('');
    paras.forEach((p, i) => {
      let runs;
      if (layout === 'lines') {
        const lines = p.split('\n');
        runs = lines.map((l, k) => new D.TextRun({ text: l, break: k ? 1 : undefined }));
      } else {
        const joined = p.split('\n').map(l => l.trim()).reduce((acc, l) => (!acc ? l : /\p{L}-$/u.test(acc) && /^\p{Ll}/u.test(l) ? acc.slice(0, -1) + l : acc + ' ' + l), '');
        runs = [new D.TextRun({ text: joined })];
      }
      children.push(new D.Paragraph({ children: runs, pageBreakBefore: pi > 0 && i === 0, spacing: { after: 160 } }));
    });
  });
  const doc = new D.Document({
    creator: 'FaLe PDF', title,
    styles: { default: { document: { run: { font: 'Arial', size: 22 } } } },
    sections: [{ children }],
  });
  return D.Packer.toBlob(doc);
}

/** OCR words → pdf.js-like text items (y up) so the PDF→Excel table clustering can be reused. */
export function wordsToItems(r) {
  const H = r.height || 1000;
  return (r.words || []).map(w => {
    const hgt = Math.max(4, (w.bbox.y1 - w.bbox.y0) * 0.8);
    return { str: w.text, transform: [hgt, 0, 0, hgt, w.bbox.x0, H - (w.baseline ? w.baseline.y0 : w.bbox.y1)], width: w.bbox.x1 - w.bbox.x0, height: hgt };
  });
}

async function rowsToXlsx(sheets, title) {
  const [{ pageToRows, smartValue }, wbm, { writeXlsx }] = await Promise.all([import('../office/pdf2xlsx.js'), import('../office/workbook.js'), import('../office/xlsx-write.js')]);
  const wb = wbm.newWorkbook();
  wb.sheets = [];
  sheets.forEach((s, i) => {
    const sh = wbm.newSheet(sheets.length > 1 ? `Bild ${i + 1}` : 'Tabelle1');
    const rows = s.rows || pageToRows(s.items);
    rows.forEach((row, r) => row.forEach((cellText, c) => {
      const { v, fmt } = smartValue(cellText);
      if (v === null) return;
      const cell = { v };
      if (fmt) cell.s = { fmt };
      sh.cells.set(wbm.KEY(r, c), cell);
      sh.maxR = Math.max(sh.maxR, r); sh.maxC = Math.max(sh.maxC, c);
    }));
    for (let c = 0; c <= sh.maxC; c++) {
      let w = 6;
      for (let r = 0; r <= Math.min(sh.maxR, 300); r++) { const x = sh.cells.get(wbm.KEY(r, c)); if (x && x.v != null) w = Math.max(w, String(x.v).length); }
      sh.colW[c] = Math.min(380, Math.round(w * 7.2 + 14));
    }
    wb.sheets.push(sh);
  });
  if (!wb.sheets.length) wb.sheets.push(wbm.newSheet('Tabelle1'));
  wbm.recalc(wb);
  return writeXlsx(wb, { title });
}

async function tableRowsOf(r) {
  const { pageToRows } = await import('../office/pdf2xlsx.js');
  return pageToRows(wordsToItems(r));
}

function copyText(text) {
  const done = () => toast('Text kopiert.', 'success', { timeout: 1800 });
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(done, () => fallback());
  return fallback();
  function fallback() {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch { toast('Kopieren nicht möglich.', 'error'); }
    ta.remove();
  }
}

async function shareText(text, title) {
  // Android app: Share plugin (the WebView has no navigator.share); web: Web Share API
  const { shareFile, shareTextOrLink } = await import('../platform.js');
  const r = await shareTextOrLink({ title, text });
  if (r.ok || r.cancelled) return;
  await shareFile(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${title}.txt`, 'text/plain', { title });
}

// ---------------------------------------------------------------- "Text erkennen" / "Bild zu Word" / "Bild zu Excel"
const MODES = {
  text: { title: 'Text erkennen (OCR)', sub: 'Text aus Fotos, Scans und Bild-PDFs', icon: 'text', accept: 'image/*,.pdf,application/pdf',
    intro: 'Erkennt Text in Fotos, Scans und PDF-Seiten ohne Textebene – als bearbeitbarer Text, Word-Datei oder durchsuchbare PDF.' },
  word: { title: 'Bild zu Word', sub: 'Fotos und Scans in bearbeitbare Word-Dateien', icon: 'word', accept: 'image/*',
    intro: 'Wandelt Fotos von Briefen, Seiten und Notizen in ein bearbeitbares Word-Dokument (.docx) um.' },
  excel: { title: 'Bild zu Excel', sub: 'Tabellen aus Fotos und Screenshots', icon: 'grid', accept: 'image/*',
    intro: 'Erkennt Tabellen auf Fotos und Screenshots – Zeilen und Spalten werden aus der Lage der Wörter bestimmt – und speichert sie als Excel-Tabelle (.xlsx).' },
};

export async function mount(screen, { docId = null, mode = 'text' } = {}) {
  await ensureCss();
  const M = MODES[mode] || MODES.text;
  screen.setTitle(M.title, M.sub);
  let alive = true;
  let items = []; // {kind:'image'|'pdf', file, name, url, bytes?, pages?}
  let results = null; // [{name, page?, text, conf, r}]
  let panel = null;

  if (docId) {
    const doc = await db.getDoc(docId);
    if (doc) {
      const blob = await db.getFile(docId);
      if ((doc.kind || 'pdf') === 'pdf') items.push({ kind: 'pdf', name: doc.name, bytes: await getDocBytes(docId), pages: doc.pages, docId });
      else if (doc.kind === 'image' && blob) items.push({ kind: 'image', name: doc.name, file: blob, url: URL.createObjectURL(blob) });
    }
  }

  function addFiles(files) {
    const list = Array.from(files || []);
    let bad = 0;
    for (const f of list) {
      if (isImage(f)) items.push({ kind: 'image', name: f.name || 'Bild', file: f, url: URL.createObjectURL(f) });
      else if (mode === 'text' && isPdf(f)) items.push({ kind: 'pdf', name: f.name, file: f });
      else bad++;
    }
    if (bad) toast(mode === 'text' ? 'Bitte wähle Bilder oder PDF-Dateien aus.' : 'Bitte wähle Bilddateien aus.', 'error');
    showSource();
  }
  screen.onDropFiles = files => { if (!results) addFiles(files); };

  // ---------- source view
  function showSource() {
    results = null;
    screen.body.innerHTML = '';
    const wrap = h(`<div class="screen-inner pt-narrow ocr">
      <div class="card intro"><span class="tile-ic">${icon(M.icon)}</span><div><strong>${esc(M.title)}</strong>
        <p>${esc(M.intro)} ${proBadge()}</p></div></div>
      <div class="ocr-src">
        <button class="btn btn-soft" type="button" data-cam>${icon('camera')} Foto aufnehmen</button>
        <button class="btn btn-ghost" type="button" data-pick>${icon('gallery')} ${mode === 'text' ? 'Bilder oder PDF wählen' : 'Bilder wählen'}</button>
      </div>
      <div class="ocr-items" data-items></div>
      <div class="card card-pad ocr-optcard" data-opts></div>
      <p class="ocr-privacy">${icon('shield')}<span>Die Erkennung läuft komplett auf deinem Gerät – nichts wird hochgeladen.</span></p>
    </div>`);
    screen.body.appendChild(wrap);
    wrap.querySelector('[data-opts]').appendChild(optionsBlock({ psm: mode !== 'excel' }));
    wrap.querySelector('[data-cam]').addEventListener('click', async () => addFiles(await pickFiles({ accept: 'image/*', multiple: false, capture: 'environment' })));
    wrap.querySelector('[data-pick]').addEventListener('click', async () => addFiles(await pickFiles({ accept: M.accept, multiple: true })));
    const box = wrap.querySelector('[data-items]');
    if (!items.length) box.appendChild(h(`<div class="ocr-empty">${icon('image')}<span>Noch nichts ausgewählt. Du kannst Dateien auch hierher ziehen.</span></div>`));
    items.forEach((it, i) => {
      const row = h(`<div class="ocr-item">${it.kind === 'image' ? `<img src="${it.url}" alt="">` : `<span class="ocr-pdf">${icon('file')}</span>`}
        <span class="grow"><span class="doc-name">${esc(it.name)}</span><span class="doc-meta">${it.kind === 'pdf' ? `PDF${it.pages ? ` · ${it.pages} Seiten` : ''}` : 'Bild'}</span>
        ${it.kind === 'pdf' ? '<input class="input input-sm" data-range placeholder="Seiten, z. B. 1-3 (leer = alle)" aria-label="Seiten">' : ''}</span>
        <button class="icon-btn" type="button" data-x aria-label="Entfernen">${icon('trash')}</button></div>`);
      const rng = row.querySelector('[data-range]');
      if (rng) { rng.value = it.range || ''; rng.addEventListener('input', () => { it.range = rng.value; }); }
      row.querySelector('[data-x]').addEventListener('click', () => { if (it.url) URL.revokeObjectURL(it.url); items.splice(i, 1); showSource(); });
      box.appendChild(row);
    });
    const go = h(`<button class="btn btn-primary" type="button" data-go>${icon('scan')} Text erkennen</button>`);
    go.disabled = !items.length;
    go.addEventListener('click', run);
    updateFoot(screen, [go], items.length ? `${items.length} Datei${items.length === 1 ? '' : 'en'}` : '');
  }

  // ---------- run
  async function run() {
    const lang = getLangPref(), psm = mode === 'excel' ? 'auto' : getPsmPref();
    if (!await ensureOcrReady(lang)) return;
    // jobs: one per image / PDF page
    const jobs = [];
    for (const it of items) {
      if (it.kind === 'image') { jobs.push({ it }); continue; }
      if (!it.bytes) it.bytes = new Uint8Array(await it.file.arrayBuffer());
      if (!it.pdf) {
        try { it.pdf = (await loadPdf(it.bytes.slice(), { name: it.name, key: it.docId || null })).pdf; } catch (e) { errorToast(e, `„${it.name}“ konnte nicht geöffnet werden.`); return; }
      }
      const nums = parseRange(it.range || '', it.pdf.numPages);
      if (!nums || !nums.length) { toast('Bitte gib einen gültigen Seitenbereich ein, z. B. 1-3, 5.', 'error'); return; }
      nums.forEach(n => jobs.push({ it, page: n }));
    }
    const goBtn = screen.foot.querySelector('[data-go]');
    if (goBtn) goBtn.disabled = true;
    panel = progressPanel({ title: 'Text wird erkannt …', total: jobs.length });
    const out = [];
    const t0 = Date.now();
    let ocrDone = 0;
    try {
      for (let k = 0; k < jobs.length; k++) {
        const j = jobs[k];
        const eta = () => (ocrDone ? ((Date.now() - t0) / ocrDone) * (jobs.length - k) / 1000 : null);
        const tell = p => panel.update({ ...p, index: k, total: jobs.length, page: k + 1, eta: eta() });
        if (j.it.kind === 'image') {
          const r = await recognize(j.it.file, { lang, psm, signal: panel.signal, onProgress: tell });
          out.push({ name: j.it.name, text: r.text, conf: r.conf, r, src: j.it });
          ocrDone++;
        } else {
          // pages that already have text: take it directly (exact, instant)
          const pg = await j.it.pdf.getPage(j.page);
          const existing = await pageText(pg);
          pg.cleanup();
          if (existing.replace(/\s+/g, '').length >= 20) { out.push({ name: j.it.name, page: j.page, text: existing, conf: 100, r: null, fromText: true, src: j.it }); continue; }
          const [r] = await ocrPdfPages(j.it.pdf, { pages: [j.page], lang, psm, signal: panel.signal, onProgress: p => tell(p) });
          out.push({ name: j.it.name, page: j.page, text: r.text, conf: r.conf, r, src: j.it });
          ocrDone++;
        }
        tell({ phase: 'done' });
      }
      if (ocrDone) import('../extras/stats.js').then(m => m.track('ocr_pages', ocrDone)).catch(() => {});
      if (!alive) return;
      results = out;
      showResults();
    } catch (e) {
      if (isAbort(e)) toast('Texterkennung abgebrochen.', 'info');
      else errorToast(e, ocrErrorText(e));
      if (goBtn) goBtn.disabled = false;
    } finally { panel.close(); panel = null; }
  }

  // ---------- results
  function allTexts() {
    return Array.from(screen.body.querySelectorAll('[data-text]')).map(t => t.value);
  }
  function label(res, i) { return res.page ? `${res.name} · Seite ${res.page}` : (results.length > 1 ? `Bild ${i + 1}: ${res.name}` : res.name); }

  async function showResults() {
    screen.body.innerHTML = '';
    const title = stripExt(results[0] ? results[0].name : 'Text') || 'Text';
    const totalChars = results.reduce((s, r) => s + r.text.replace(/\s+/g, '').length, 0);
    const avg = results.filter(r => r.r).reduce((s, r, _, a) => s + r.conf / a.length, 0);
    const wrap = h(`<div class="screen-inner pt-narrow ocr">
      <div class="ocr-sum">${icon('check')}<div><strong>${totalChars ? `${results.length === 1 ? 'Text erkannt' : `${results.length} Seiten erkannt`}` : 'Kein Text gefunden'}</strong>
        <span class="muted small">${totalChars} Zeichen${avg ? ` · Sicherheit ${Math.round(avg)} %` : ''}${avg && avg < 70 ? ' · Bitte prüfen – das Bild ist schwer lesbar.' : ''}</span></div>
        <button class="btn btn-ghost btn-sm" type="button" data-again>${icon('rotate')} Neu</button></div>
      ${mode === 'excel' ? '<h2 class="section-title">Tabelle</h2><div data-tables></div>' : ''}
      <div data-pages></div>
      <div data-result></div></div>`);
    screen.body.appendChild(wrap);
    wrap.querySelector('[data-again]').addEventListener('click', () => { results = null; showSource(); });
    const pagesBox = wrap.querySelector('[data-pages]');
    results.forEach((res, i) => {
      const card = h(`<div class="card ocr-page"><div class="ocr-page-head"><strong>${esc(label(res, i))}</strong>
        ${res.fromText ? '<span class="pt-hint">Text aus der PDF übernommen</span>' : res.r ? `<span class="ocr-conf ${res.conf < 70 ? 'low' : ''}">${Math.round(res.conf)} %</span>` : ''}</div>
        <textarea class="input ocr-text" data-text rows="${Math.min(18, Math.max(5, res.text.split('\n').length + 1))}" spellcheck="false" aria-label="Erkannter Text – ${esc(label(res, i))}"></textarea></div>`);
      card.querySelector('textarea').value = res.text;
      pagesBox.appendChild(card);
    });
    if (mode === 'excel') await renderTables(wrap.querySelector('[data-tables]'));
    const resultBox = wrap.querySelector('[data-result]');

    const copyB = h(`<button class="btn btn-ghost" type="button" data-copy>${icon('copy')} Kopieren</button>`);
    const shareB = h(`<button class="btn btn-ghost" type="button" data-share>${icon('share')} Teilen</button>`);
    const saveB = h(`<button class="btn btn-primary" type="button" data-save>${icon('download')} Speichern als …</button>`);
    copyB.addEventListener('click', () => copyText(allTexts().join('\n\n')));
    shareB.addEventListener('click', () => shareText(allTexts().join('\n\n'), title));
    saveB.addEventListener('click', async () => {
      const { showMenu } = await import('../ui.js');
      const hasSrc = results.some(r => r.src && (r.src.kind === 'image' || r.src.kind === 'pdf'));
      showMenu(saveB, [
        { label: 'Textdatei (.txt)', icon: 'text', onClick: () => saveTxt(resultBox, title) },
        { label: 'Word – Absätze (.docx)', icon: 'word', onClick: () => saveDocx(resultBox, title, 'paragraphs') },
        { label: 'Word – Zeilen wie im Original (.docx)', icon: 'word', onClick: () => saveDocx(resultBox, title, 'lines') },
        mode === 'excel' ? { label: 'Excel-Tabelle (.xlsx)', icon: 'grid', onClick: () => saveXlsx(resultBox, title) } : null,
        hasSrc ? { label: 'Durchsuchbares PDF', icon: 'file', onClick: () => saveSearchable(resultBox, title) } : null,
      ].filter(Boolean), { label: 'Speichern als' });
    });
    updateFoot(screen, [copyB, shareB, saveB]);
    if (mode === 'word') await saveDocx(resultBox, title, 'paragraphs');
    if (mode === 'excel') await saveXlsx(resultBox, title);
  }

  async function renderTables(box) {
    box.innerHTML = '';
    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      if (!res.r) continue;
      res.rows = await tableRowsOf(res.r);
      const rows = res.rows.slice(0, 40);
      const cols = Math.max(0, ...rows.map(r => r.length));
      box.appendChild(h(`<div class="card ocr-table"><div class="ocr-tscroll"><table class="ocr-tbl"><tbody>${rows.map(r => `<tr>${Array.from({ length: cols }, (_, c) => `<td>${esc(r[c] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <p class="muted small" style="margin:8px 12px">${esc(label(res, i))}: ${res.rows.length} Zeilen × ${cols} Spalten</p></div>`));
    }
  }

  function showFile(box, blob, name, opts) {
    box.innerHTML = '';
    box.appendChild(fileResultCard(blob, name, opts));
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function saveTxt(box, title) {
    const blob = new Blob([allTexts().join('\n\n')], { type: 'text/plain;charset=utf-8' });
    showFile(box, blob, `${title}.txt`, { title: 'Textdatei erstellt', iconName: 'text', type: 'text/plain' });
  }
  async function saveDocx(box, title, layout) {
    try {
      const blob = await textsToDocx(allTexts(), { layout, title });
      showFile(box, blob, `${title}.docx`, { title: 'Word-Dokument erstellt', iconName: 'word', note: layout === 'lines' ? 'Zeilen wie im Original' : 'Absätze', type: MIME_DOCX });
    } catch (e) { errorToast(e, 'Das Word-Dokument konnte nicht erstellt werden.'); }
  }
  async function saveXlsx(box, title) {
    try {
      const sheets = results.filter(r => r.r).map(r => ({ rows: r.rows }));
      const blob = await rowsToXlsx(sheets, title);
      showFile(box, blob, `${title}.xlsx`, { title: 'Excel-Tabelle erstellt', iconName: 'grid', type: MIME_XLSX });
    } catch (e) { errorToast(e, 'Die Tabelle konnte nicht erstellt werden.'); }
  }
  async function saveSearchable(box, title) {
    const p = progressPanel({ title: 'Durchsuchbares PDF wird erstellt …', total: results.length });
    try {
      const pdfItems = [...new Set(results.filter(r => r.src && r.src.kind === 'pdf').map(r => r.src))];
      const imgResults = results.filter(r => r.src && r.src.kind === 'image');
      let saved = null;
      if (imgResults.length) {
        const bytes = await imagesToSearchablePdf(imgResults.map(r => ({ source: r.src.file, result: r.r })), { title, signal: p.signal, onProgress: x => p.update(x) });
        saved = await saveResult(bytes, `${title} (durchsuchbar).pdf`);
      }
      for (const it of pdfItems) {
        const pages = results.filter(r => r.src === it && r.r).map(r => r.page);
        const res = await makeSearchable(it.bytes, { pages, lang: getLangPref(), psm: getPsmPref(), signal: p.signal, onProgress: x => p.update(x), name: it.name, key: it.docId || null });
        saved = await saveResult(res.bytes, `${stripExt(it.name)} (durchsuchbar).pdf`);
      }
      if (saved) {
        box.innerHTML = '';
        box.appendChild(resultCard(saved, { title: 'Durchsuchbares PDF gespeichert', note: 'Text auswählbar und durchsuchbar' }));
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        toast('Durchsuchbares PDF gespeichert.', 'success');
      }
    } catch (e) {
      if (isAbort(e)) toast('Abgebrochen.', 'info'); else errorToast(e, ocrErrorText(e));
    } finally { p.close(); }
  }

  showSource();
  return () => {
    alive = false;
    if (panel) panel.close();
    items.forEach(it => { if (it.url) URL.revokeObjectURL(it.url); if (it.pdf) try { it.pdf.destroy(); } catch {} });
  };
}

export const mountWord = (screen, o = {}) => mount(screen, { ...o, mode: 'word' });
export const mountExcel = (screen, o = {}) => mount(screen, { ...o, mode: 'excel' });

// ---------------------------------------------------------------- "Durchsuchbares PDF"
export async function mountSearchable(screen, { docId, params }) {
  await ensureCss();
  const doc = await db.getDoc(docId);
  if (!doc) { screen.body.innerHTML = '<p class="panel-empty">Dokument nicht gefunden.</p>'; return; }
  screen.setTitle('Durchsuchbares PDF', doc.name);
  const bytes = await getDocBytes(docId);
  let alive = true, panel = null;
  const wrap = h(`<div class="screen-inner pt-narrow ocr">
    <div class="card intro"><span class="tile-ic">${icon('search')}</span><div><strong>${esc(doc.name)}</strong>
      <p>Legt eine unsichtbare Textebene über gescannte Seiten: Text lässt sich danach suchen, markieren und kopieren. Das Aussehen der Seiten bleibt unverändert, Seiten mit Text werden übersprungen. ${proBadge()}</p></div></div>
    <div class="card card-pad" data-status><span class="spinner dark"></span> Seiten werden geprüft …</div>
    <div class="card card-pad ocr-optcard" data-opts></div>
    <div class="card card-pad"><label class="field" style="margin:0"><span class="field-label">Seiten (leer = alle ${doc.pages || ''})</span><input class="input" data-range placeholder="z. B. 1-3, 5"></label></div>
    <p class="ocr-privacy">${icon('shield')}<span>Die Texterkennung läuft komplett auf deinem Gerät – nichts wird hochgeladen.</span></p>
    <div data-result></div></div>`);
  screen.body.appendChild(wrap);
  wrap.querySelector('[data-opts]').appendChild(optionsBlock());
  const btn = h(`<button class="btn btn-primary" type="button" data-go disabled>${icon('scan')} Text erkennen</button>`);
  updateFoot(screen, [btn]);
  let missing = [];
  try {
    const { pdf } = await loadPdf(bytes.slice(), { name: doc.name, key: docId });
    missing = await pagesWithoutText(pdf);
    const n = pdf.numPages;
    pdf.destroy();
    if (!alive) return;
    const st = wrap.querySelector('[data-status]');
    st.innerHTML = missing.length
      ? `<div class="ocr-note">${icon('scan')}<div><strong>${missing.length === n ? `Alle ${n} Seite${n === 1 ? '' : 'n'} ohne Text` : `${missing.length} von ${n} Seiten ohne Text`}</strong><p class="muted small">${missing.length === n ? 'Typisch für Scans und fotografierte Dokumente.' : `Seiten ${esc(compactRange(missing))} werden erkannt, die übrigen enthalten bereits Text.`}</p></div></div>`
      : `<div class="ocr-note">${icon('check')}<div><strong>Dieses Dokument ist bereits durchsuchbar</strong><p class="muted small">Alle Seiten enthalten Text – eine Texterkennung ist nicht nötig.</p></div></div>`;
    btn.disabled = !missing.length;
  } catch (e) { errorToast(e, 'Das Dokument konnte nicht geprüft werden.'); }

  btn.addEventListener('click', start);
  async function start() {
    const lang = getLangPref();
    if (!await ensureOcrReady(lang)) return;
    const nums = parseRange(wrap.querySelector('[data-range]').value, doc.pages || 9999);
    if (!nums || !nums.length) { toast('Bitte gib einen gültigen Seitenbereich ein, z. B. 1-3, 5.', 'error'); return; }
    const todo = nums.filter(n => missing.includes(n));
    if (!todo.length) { toast('Die gewählten Seiten enthalten bereits Text.', 'info'); return; }
    btn.disabled = true;
    panel = progressPanel({ title: 'Durchsuchbares PDF wird erstellt …', total: todo.length });
    try {
      const res = await makeSearchable(bytes, { pages: todo, lang, psm: getPsmPref(), signal: panel.signal, onProgress: p => panel.update(p), name: doc.name, key: docId });
      if (!alive) return;
      const saved = await saveResult(res.bytes, `${baseName(doc.name)} (durchsuchbar).pdf`);
      const box = wrap.querySelector('[data-result]');
      box.innerHTML = '';
      box.appendChild(resultCard(saved, { from: docId, title: 'Durchsuchbares PDF erstellt', note: `${res.ocrPages.length} Seite${res.ocrPages.length === 1 ? '' : 'n'} erkannt · ${res.words} Wörter` }));
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      toast('Durchsuchbares PDF gespeichert.', 'success');
    } catch (e) {
      if (isAbort(e)) toast('Texterkennung abgebrochen.', 'info'); else errorToast(e, ocrErrorText(e));
    } finally { if (panel) panel.close(); panel = null; btn.disabled = !missing.length; }
  }
  if (params && params.get && params.get('start') === '1' && missing.length) setTimeout(() => { if (alive) start(); }, 50);
  return () => { alive = false; if (panel) panel.close(); };
}

function compactRange(nums) {
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(j > i ? `${nums[i]}–${nums[j]}` : String(nums[i]));
    i = j;
  }
  return out.join(', ');
}
