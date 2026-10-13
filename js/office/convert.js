// Conversion tools into PDF: Word → PDF, Excel/CSV → PDF, PowerPoint → PDF, Text → PDF.
import * as db from '../db.js';
import { $, h, esc, toast, errorToast, pickFiles, progress } from '../ui.js';
import { importAny, saveResult } from '../library.js';
import { resultCard } from '../components.js';
import { ACCEPT, KINDS, kindOf, kindInfo, stripExt, oicon, kindTile, detectKind } from './kinds.js';
import { fileThumb, fileMeta } from './filerow.js';

const CONF = {
  'word-pdf': { cats: ['doc'], kinds: ['docx', 'txt', 'md'], accept: ACCEPT.doc, what: 'Word-Dokument (.docx), Text oder Markdown', icon: 'kdoc' },
  'text-pdf': { cats: ['doc'], kinds: ['txt', 'md'], accept: ACCEPT.text, what: 'Textdatei (.txt) oder Markdown (.md)', icon: 'kdoc' },
  'excel-pdf': { cats: ['sheet'], kinds: ['xlsx', 'csv'], accept: ACCEPT.sheet, what: 'Excel-Tabelle (.xlsx) oder CSV', icon: 'ksheet' },
  'ppt-pdf': { cats: ['slides'], kinds: ['pptx'], accept: ACCEPT.slides, what: 'PowerPoint-Präsentation (.pptx)', icon: 'kslides' },
};

/** Convert a library entry to PDF bytes. */
export async function convertToPdf(doc, onProgress) {
  const blob = await db.getFile(doc.id);
  if (!blob) throw Object.assign(new Error('missing'), { userMessage: 'Datei nicht gefunden.' });
  const kind = kindOf(doc);
  const title = stripExt(doc.name);
  if (kind === 'docx') {
    const { docxToHtml } = await import('./docx-read.js');
    const { htmlToModel } = await import('./docmodel.js');
    const { modelToPdf } = await import('./docpdf.js');
    const r = await docxToHtml(await blob.arrayBuffer(), doc.name);
    return modelToPdf(htmlToModel(r.html, { baseSize: r.baseSize }), { title, page: r.page, onProgress });
  }
  if (kind === 'txt' || kind === 'md') {
    const { decodeText } = await import('./vendor.js');
    const text = await decodeText(blob);
    const { modelToPdf, textToPdf } = await import('./docpdf.js');
    if (kind === 'txt') return textToPdf(text, { title });
    const { markdownToHtml, htmlToModel } = await import('./docmodel.js');
    return modelToPdf(htmlToModel(markdownToHtml(text)), { title, onProgress });
  }
  if (kind === 'xlsx' || kind === 'csv') {
    const wb = kind === 'csv' ? await (await import('./csv.js')).readCsv(blob, doc.name) : await (await import('./xlsx-read.js')).readXlsx(await blob.arrayBuffer(), doc.name);
    return (await import('./sheetpdf.js')).workbookToPdf(wb, { title, onProgress });
  }
  if (kind === 'pptx') {
    const pres = await (await import('./pptx-read.js')).readPptx(await blob.arrayBuffer(), doc.name);
    return (await import('./slide-render.js')).presToPdf(pres, { title, onProgress });
  }
  throw Object.assign(new Error('kind'), { userMessage: 'Dieser Dateityp kann nicht umgewandelt werden.' });
}

export async function mount(screen, { docId, tool }) {
  const conf = CONF[tool.id];
  const inner = h(`<div class="screen-inner">
    <div class="card intro"><span class="tile-ic">${oicon(conf.icon)}</span><div><strong>${esc(tool.title)}</strong><p>${esc(tool.desc)} Alles passiert auf deinem Gerät.</p></div></div>
    <div class="convert-pick">
      <button class="btn btn-primary" type="button" data-dev>${oicon('upload')} Datei vom Gerät wählen</button>
      <span class="muted small">${esc(conf.what)}</span>
    </div>
    <div data-selected></div>
    <div data-result></div>
    <h2 class="section-title" data-libtitle>Aus deinen Dateien</h2>
    <div class="doc-list chooser" data-lib></div>
  </div>`);
  screen.body.appendChild(inner);
  let current = null;

  const choose = async doc => {
    current = doc;
    $('[data-result]', inner).innerHTML = '';
    $('[data-selected]', inner).innerHTML = '';
    const card = h(`<div class="card convert-card"><div class="doc">${fileThumb(doc)}<span class="doc-info"><span class="doc-name">${esc(doc.name)}</span><span class="doc-meta">${fileMeta(doc)}</span></span></div>
      <button class="btn btn-primary" type="button" data-run>${oicon('kpdf')} In PDF umwandeln</button></div>`);
    $('[data-run]', card).addEventListener('click', run);
    $('[data-selected]', inner).appendChild(card);
    screen.setFoot([]);
  };
  const run = async () => {
    if (!current) return;
    const btn = $('[data-run]', inner);
    btn.disabled = true;
    const prog = progress('Wird umgewandelt …');
    try {
      const bytes = await convertToPdf(current, p => prog.set(`Wird umgewandelt … ${Math.round(p * 100)} %`));
      const pdfDoc = await saveResult(bytes, stripExt(current.name) + '.pdf');
      prog.done();
      $('[data-result]', inner).innerHTML = '';
      $('[data-result]', inner).appendChild(resultCard(pdfDoc, { title: 'PDF erstellt' }));
      toast('PDF erstellt und in „Dateien“ gespeichert', 'success');
    } catch (e) {
      prog.done();
      errorToast(e, 'Die Umwandlung ist fehlgeschlagen.');
    } finally { btn.disabled = false; }
  };

  $('[data-dev]', inner).addEventListener('click', async () => {
    const files = await pickFiles({ accept: conf.accept, multiple: false });
    if (!files.length) return;
    const k = detectKind(files[0]);
    if (!conf.kinds.includes(k)) { toast(`Bitte wähle: ${conf.what}.`, 'error'); return; }
    try {
      const doc = await importAny(files[0], { source: 'Gerät', quiet: true });
      await choose(doc);
      run();
    } catch (e) { errorToast(e, 'Die Datei konnte nicht geöffnet werden.'); }
  });

  const docs = (await db.listFiles()).filter(d => conf.kinds.includes(kindOf(d)));
  const lib = $('[data-lib]', inner);
  if (!docs.length) { lib.appendChild(h('<p class="panel-empty">Noch keine passenden Dateien gespeichert.</p>')); }
  docs.forEach(d => {
    const b = h(`<button class="doc doc-open" type="button" style="padding:10px">${fileThumb(d)}<span class="doc-info"><span class="doc-name">${esc(d.name)}</span><span class="doc-meta">${fileMeta(d)}</span></span></button>`);
    b.addEventListener('click', () => choose(d));
    lib.appendChild(b);
  });
  if (docId) {
    const d = await db.getDoc(docId);
    if (d && conf.kinds.includes(kindOf(d))) await choose(d);
  }
  void kindInfo; void KINDS; void kindTile;
}
