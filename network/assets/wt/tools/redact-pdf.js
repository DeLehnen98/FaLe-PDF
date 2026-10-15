// Tool: redact PDFs for real. Search terms, presets (e-mail, phone, IBAN, dates), regular expressions,
// form-field values / comments and boxes drawn on the page preview are collected in a review list.
// Applying: every page with a redaction is rendered to an image with black boxes burned in and its
// original content (text, images, fields, comments) is removed from the file; pages without marks
// stay unchanged. Optionally also removes metadata, XMP, attachments and JavaScript.
import { el, clear } from '../lib/dom.js';
import { loadPdfLib, canvasToBlob } from '../lib/pdf.js';
import { ensureCss, tr, ic, btn, userError, guardPrimary, statusLine, pageNav, previewPage, wipeCanvas, stageWidth, renderPage, saveLikeSource, pdfBlob, watchUnlock } from '../lib/sec-ui.js';
import { pageChars, findInPage, boxesFor } from '../lib/sec-textgeom.js';
import { stripPrivate } from '../lib/sec-strip.js';
import { removeUnreachable } from '../lib/pdfopt.js';

const PRESETS = [
  { id: 'email', de: 'E-Mail-Adressen', en: 'E-mail addresses', re: /[\p{L}0-9._%+-]+@[\p{L}0-9.-]+\.[\p{L}]{2,}/gu },
  { id: 'phone', de: 'Telefonnummern', en: 'Phone numbers', re: /(?:\+|00)?\d[\d ()/-]{6,}\d/g },
  { id: 'iban', de: 'IBAN', en: 'IBAN', re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g },
  { id: 'date', de: 'Datumsangaben', en: 'Dates', re: /\b(?:\d{1,2}\.\s?\d{1,2}\.\s?(?:\d{4}|\d{2})|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/g },
];

// state for the current file (module scope, never logged)
const R = { inputId: null, pdf: null, pages: [], terms: [], presets: new Set(), regex: '', whole: false, marks: [], manual: [], seq: 0, ui: null };

const pageText = async n => {
  const p = R.pages[n - 1] || (R.pages[n - 1] = {});
  if (!p.text) {
    p.text = (async () => {
      const page = await R.pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const pt = await pageChars(page, base);
      let annots = [];
      try { annots = await page.getAnnotations({ intent: 'display' }); } catch { /* ignore */ }
      // also link targets (mailto:/web addresses behind "click here"), comment authors, field tooltips and
      // dropdown entries: they are not drawn on the page but stay in the file
      p.annots = annots.map(a => ({ rect: vpRect(base, a.rect), text: [a.fieldValue, a.contentsObj?.str, a.textContent?.join?.(' '), a.url || a.unsafeUrl,
        a.titleObj?.str, a.alternativeText, (a.options || []).map(o => [o?.displayValue, o?.exportValue])].flat(2).filter(v => typeof v === 'string' && v)
        .map(t => t.replace(/^mailto:/i, '')).join(' ') }))
        .filter(a => a.text);
      p.base = base;
      return pt;
    })();
  }
  return p.text;
};

export default {
  options: [
    {
      id: 'dpi', type: 'select', default: 200,
      label: { de: 'Qualität geschwärzter Seiten', en: 'Quality of redacted pages' },
      hint: { de: 'Seiten mit Schwärzungen werden zu Bildern. Höher = schärfer, aber größere Datei.', en: 'Pages with redactions become images. Higher = sharper but larger file.' },
      choices: [
        { value: 150, label: { de: '150 dpi – kleinere Datei', en: '150 dpi – smaller file' } },
        { value: 200, label: { de: '200 dpi – empfohlen', en: '200 dpi – recommended' } },
        { value: 300, label: { de: '300 dpi – Druckqualität', en: '300 dpi – print quality' } },
      ],
    },
    {
      id: 'clean', type: 'toggle', default: true,
      label: { de: 'Versteckte Daten entfernen', en: 'Remove hidden data' },
      hint: { de: 'Eigenschaften, XMP-Metadaten, Anhänge und JavaScript – dort stehen oft Namen.', en: 'Properties, XMP metadata, attachments and JavaScript – they often contain names.' },
    },
  ],

  mountStage(stage, state, ctx) {
    ensureCss();
    stage.classList.add('sec-stage');
    this._stage = stage; this._state = state; this._lang = ctx.lang;
    guardPrimary(stage, state, () => (activeMarks().length ? '' : tr(ctx.lang, 'Markiere zuerst, was geschwärzt werden soll: Suchbegriff, Vorlage oder Bereich auf der Seite.', 'First mark what to redact: a search term, a preset or an area on the page.')),
      msg => { R.ui?.status.set(msg, 'error'); R.ui?.status.node.scrollIntoView({ block: 'center' }); });
    watchUnlock(stage, state, inputs => this.onInputs(inputs));
    this.onInputs(state.inputs.filter(i => !i.error && !i.locked));
  },

  async onInputs(inputs) {
    const stage = this._stage;
    if (!stage) return;
    const input = inputs.find(i => !i.locked);
    if (!input) { clear(stage); R.inputId = null; return; }
    if (R.inputId === input.id || this._loading === input.id) return;
    this._loading = input.id;
    let pdf;
    try { pdf = await input.pdfjs(); } catch { this._loading = null; return; } // locked: the card asks for the password, watchUnlock calls again
    this._loading = null;
    Object.assign(R, { inputId: input.id, pages: [], marks: [], manual: [], terms: [], presets: new Set(), regex: '', pdf });
    build(stage, this._state, this._lang);
  },

  async run(inputs, opts, ctx) {
    const input = inputs[0];
    const marks = activeMarks();
    if (!marks.length) throw userError('Es ist noch nichts zum Schwärzen markiert.', 'Nothing is marked for redaction yet.');
    const PDFLib = await loadPdfLib();
    const { PDFName, PDFDict, PDFArray, PDFRef, PDFString, PDFHexString } = PDFLib;
    const pdf = await input.pdfjs();
    const doc = await input.pdfDoc();
    const ctxp = doc.context;
    const pages = doc.getPages();
    const byPage = new Map();
    for (const m of marks) { if (!byPage.has(m.page)) byPage.set(m.page, []); byPage.get(m.page).push(m); }
    const dpi = +opts.dpi || 200;
    const removedAnnots = new Set();
    let k = 0;
    for (const [num, list] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
      ctx.progress(k / (byPage.size + 1), { de: `Seite ${num} wird geschwärzt (${k + 1} von ${byPage.size})`, en: `Redacting page ${num} (${k + 1} of ${byPage.size})` });
      k++;
      const page = await pdf.getPage(num);
      const base = page.getViewport({ scale: 1 });
      const canvas = await renderPage(page, { scale: dpi / 72, signal: ctx.signal });
      const sx = canvas.width / base.width, sy = canvas.height / base.height;
      const g = canvas.getContext('2d');
      g.fillStyle = '#000';
      for (const m of list) {
        const x = Math.floor(m.x0 * sx) - 2, y = Math.floor(m.y0 * sy) - 2;
        g.fillRect(x, y, Math.ceil(m.x1 * sx) - x + 2, Math.ceil(m.y1 * sy) - y + 2);
      }
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
      wipeCanvas(canvas);
      page.cleanup();
      const img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const node = pages[num - 1].node;
      const W = base.width, H = base.height;
      const annots = node.lookup(PDFName.of('Annots'));
      if (annots instanceof PDFArray) for (let i = 0; i < annots.size(); i++) { const a = annots.get(i); if (a instanceof PDFRef) removedAnnots.add(a.tag); }
      for (const key of ['Contents', 'Annots', 'Thumb', 'PieceInfo', 'Metadata', 'StructParents', 'Tabs', 'AA', 'B', 'CropBox', 'BleedBox', 'TrimBox', 'ArtBox', 'Group', 'SeparationInfo', 'VP', 'PresSteps', 'Trans', 'Dur', 'UserUnit']) node.delete(PDFName.of(key));
      node.set(PDFName.of('MediaBox'), ctxp.obj([0, 0, W, H]));
      node.set(PDFName.of('Rotate'), ctxp.obj(0));
      node.set(PDFName.of('Resources'), ctxp.obj({ XObject: { FaLeRedacted: img.ref } }));
      node.set(PDFName.of('Contents'), ctxp.register(ctxp.flateStream(`q ${+W.toFixed(4)} 0 0 ${+H.toFixed(4)} 0 0 cm /FaLeRedacted Do Q`)));
      await ctx.tick();
    }
    ctx.progress(byPage.size / (byPage.size + 1), { de: 'Versteckte Reste werden entfernt …', en: 'Removing hidden leftovers …' });
    const catalog = doc.catalog;
    // form fields whose widgets sat on redacted pages (their values may contain the text)
    const acro = catalog.lookup(PDFName.of('AcroForm'));
    if (acro instanceof PDFDict && removedAnnots.size) {
      const prune = arr => {
        if (!(arr instanceof PDFArray)) return;
        for (let i = arr.size() - 1; i >= 0; i--) {
          const ref = arr.get(i), f = arr.lookup(i);
          if (ref instanceof PDFRef && removedAnnots.has(ref.tag)) { arr.remove(i); continue; }
          if (f instanceof PDFDict) { const kids = f.lookup(PDFName.of('Kids')); if (kids instanceof PDFArray) { prune(kids); if (!kids.size()) arr.remove(i); } }
        }
      };
      prune(acro.lookup(PDFName.of('Fields')));
    }
    // tagged-PDF structure can carry alternate / actual text of removed content
    catalog.delete(PDFName.of('StructTreeRoot'));
    catalog.delete(PDFName.of('MarkInfo'));
    // bookmarks whose titles contain a redacted text
    const secrets = [...new Set(marks.map(m => m.text).filter(t => t && t.length > 2))];
    let outlinesDropped = false;
    if (secrets.length && outlineMatches(PDFLib, doc, secrets)) { catalog.delete(PDFName.of('Outlines')); outlinesDropped = true; }
    if (opts.clean) await stripPrivate(PDFLib, doc, { thumbs: true });
    await doc.flush();
    removeUnreachable(doc, PDFLib);
    await ctx.tick();
    ctx.progress(0.98, { de: 'Wird gespeichert …', en: 'Saving …' });
    const { bytes, protectedAgain } = await saveLikeSource(doc, input);
    const n = byPage.size;
    ctx.note({ de: `${marks.length} Stelle(n) auf ${n} Seite(n) dauerhaft entfernt. Diese Seiten sind jetzt Bilder: Text dort ist nicht mehr markier- oder durchsuchbar, Links und Formularfelder sind entfernt. Alle anderen Seiten sind unverändert.`,
      en: `${marks.length} item(s) on ${n} page(s) removed for good. Those pages are now images: text there can no longer be selected or searched, links and form fields are gone. All other pages are unchanged.` });
    if (outlinesDropped) ctx.note({ de: 'Lesezeichen wurden entfernt, weil ihre Titel geschwärzten Text enthielten.', en: 'Bookmarks were removed because their titles contained redacted text.' });
    if (!opts.clean && secrets.length) ctx.note({ de: 'Versteckte Daten (Eigenschaften, Anhänge) wurden nicht entfernt – sie können geschwärzten Text noch enthalten.', en: 'Hidden data (properties, attachments) was not removed – it may still contain redacted text.' });
    if (protectedAgain) ctx.note({ de: 'Die Datei ist wieder mit demselben Passwort geschützt.', en: 'The file is protected again with the same password.' });
    const suffix = ctx.lang === 'de' ? ' (geschwärzt)' : ' (redacted)';
    return { outputs: [{ name: ctx.fileName(input.name, suffix, 'pdf'), blob: pdfBlob(bytes), pages: doc.getPageCount() }] };
  },
};

function vpRect(vp, r) {
  const [x0, y0] = vp.convertToViewportPoint(r[0], r[1]), [x1, y1] = vp.convertToViewportPoint(r[2], r[3]);
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

function activeMarks() { return R.marks.filter(m => m.on).concat(R.manual); }

function outlineMatches(PDFLib, doc, secrets) {
  const { PDFName, PDFDict, PDFString, PDFHexString } = PDFLib;
  const root = doc.catalog.lookup(PDFName.of('Outlines'));
  if (!(root instanceof PDFDict)) return false;
  const low = secrets.map(s => s.toLowerCase());
  const seen = new Set();
  const visit = (node, depth) => {
    for (let item = node.lookup(PDFName.of('First')), guard = 0; item instanceof PDFDict && guard < 10000; item = item.lookup(PDFName.of('Next')), guard++) {
      if (seen.has(item) || depth > 64) return false;
      seen.add(item);
      const t = item.lookup(PDFName.of('Title'));
      const title = (t instanceof PDFString || t instanceof PDFHexString) ? t.decodeText().toLowerCase() : '';
      if (low.some(s => title.includes(s))) return true;
      if (visit(item, depth + 1)) return true;
    }
    return false;
  };
  return visit(root, 0);
}

// ---------------------------------------------------------------- UI
function build(stage, state, L) {
  const bump = () => { state.values.redactRev = (state.values.redactRev || 0) + 1; };
  const status = statusLine();
  const termInput = el('input', { id: 'sec-red-term', class: 'wt-input', type: 'search', enterkeyhint: 'search', autocomplete: 'off', spellcheck: 'false', placeholder: tr(L, 'z. B. Name, Kundennummer', 'e.g. name, customer number') });
  const addTerm = () => {
    const parts = termInput.value.split(/[\n;]+/).map(s => s.trim()).filter(Boolean);
    for (const p of parts) if (!R.terms.includes(p)) R.terms.push(p);
    termInput.value = '';
    renderTerms();
    rescan();
  };
  termInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTerm(); } });
  const termList = el('div', { class: 'sec-chips', aria: { label: tr(L, 'Suchbegriffe', 'Search terms') } });
  const renderTerms = () => {
    clear(termList).append(R.terms.map(t => el('button', { type: 'button', class: 'sec-chip', aria: { label: tr(L, `Suchbegriff „${t}“ entfernen`, `Remove search term “${t}”`) },
      onclick: () => { R.terms = R.terms.filter(x => x !== t); renderTerms(); rescan(); } }, el('span', {}, t), ic('close'))));
  };
  const presetChips = PRESETS.map(p => {
    const b = el('button', { type: 'button', class: 'sec-chip', aria: { pressed: 'false' } }, ic('search'), tr(L, p.de, p.en));
    b.addEventListener('click', () => {
      if (R.presets.has(p.id)) R.presets.delete(p.id); else R.presets.add(p.id);
      b.setAttribute('aria-pressed', String(R.presets.has(p.id)));
      rescan();
    });
    return b;
  });
  const whole = el('input', { type: 'checkbox', id: 'sec-red-whole', onchange: () => { R.whole = whole.checked; rescan(); } });
  const regexInput = el('input', { id: 'sec-red-regex', class: 'wt-input', type: 'text', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', placeholder: 'z. B. K-\\d{6}' });
  const regexErr = el('p', { class: 'wt-opt-err', id: 'sec-red-regex-err', hidden: true, role: 'alert' });
  regexInput.setAttribute('aria-describedby', 'sec-red-regex-err');
  let regexTimer = 0;
  regexInput.addEventListener('input', () => { clearTimeout(regexTimer); regexTimer = setTimeout(() => { R.regex = regexInput.value; rescan(); }, 350); });

  const searchCard = el('div', { class: 'sec-card' },
    el('h3', { class: 'sec-h' }, ic('search'), tr(L, 'Was soll weg?', 'What should go?')),
    el('div', { class: 'wt-opt' }, el('label', { for: 'sec-red-term' }, tr(L, 'Suchbegriff', 'Search term')),
      el('div', { class: 'sec-inrow' }, termInput, btn('plus', tr(L, 'Hinzufügen', 'Add'), addTerm, { cls: 'wt-btn wt-btn-quiet' }))),
    termList,
    el('p', { class: 'sec-small' }, tr(L, 'Vorlagen – finden typische persönliche Daten:', 'Presets – find typical personal data:')),
    el('div', { class: 'sec-chips' }, presetChips),
    el('details', { class: 'sec-details' }, el('summary', {}, ic('settings'), tr(L, 'Mehr Suchoptionen', 'More search options')),
      el('div', { class: 'sec-body' },
        el('label', { class: 'sec-check', for: 'sec-red-whole' }, whole, el('span', {}, tr(L, 'Nur ganze Wörter', 'Whole words only'))),
        el('div', { class: 'wt-opt' }, el('label', { for: 'sec-red-regex' }, tr(L, 'Regulärer Ausdruck', 'Regular expression')), regexInput, regexErr,
          el('p', { class: 'wt-opt-hint' }, tr(L, 'Für Fortgeschrittene, z. B. „K-\\d{6}“ für Kundennummern.', 'For advanced users, e.g. “K-\\d{6}” for customer numbers.')))))
  );

  // preview
  const nav = pageNav(L, n => showPage(n));
  const pageBox = el('div', { class: 'sec-page' });
  const overlay = el('div', { class: 'sec-overlay' });
  const drawBtn = el('button', { type: 'button', class: 'sec-chip', aria: { pressed: 'false' } }, ic('box'), tr(L, 'Bereich ziehen', 'Draw area'));
  let drawing = false;
  drawBtn.addEventListener('click', () => { drawing = !drawing; drawBtn.setAttribute('aria-pressed', String(drawing)); pageBox.classList.toggle('is-drawing', drawing);
    drawHint.hidden = !drawing; });
  const drawHint = el('p', { class: 'sec-status', dataset: { kind: 'ok' }, hidden: true }, tr(L, 'Ziehe mit dem Finger einen Rahmen über die Stelle, die geschwärzt werden soll. Zum Blättern und Scrollen „Bereich ziehen“ wieder ausschalten.', 'Drag a box with your finger over the area to redact. Turn “Draw area” off again to scroll and turn pages.'));
  const wholePage = btn('pages', tr(L, 'Ganze Seite', 'Whole page'), () => {
    const p = R.pages[nav.page - 1];
    if (!p?.base) return;
    R.manual.push({ id: ++R.seq, page: nav.page, x0: 0, y0: 0, x1: p.base.width, y1: p.base.height, on: true, src: 'manual', label: tr(L, 'Ganze Seite', 'Whole page') });
    bump(); drawMarks(); renderList();
  }, { cls: 'sec-chip' });
  const previewCard = el('div', { class: 'sec-card sec-sticky' },
    el('h3', { class: 'sec-h' }, ic('file'), tr(L, 'Vorschau', 'Preview')),
    el('div', { class: 'sec-row' }, drawBtn, wholePage), drawHint,
    nav.node, el('div', { class: 'sec-page-wrap' }, pageBox),
    el('p', { class: 'sec-hint-row' }, tr(L, 'Schwarz = wird geschwärzt · gestrichelt = ausgenommen', 'Black = will be redacted · dashed = excluded')));

  // review list
  const count = el('p', { class: 'sec-sub', aria: { live: 'polite' } });
  const list = el('ul', { class: 'sec-hits' });
  const allOn = btn('check', tr(L, 'Alle', 'All'), () => { R.marks.forEach(m => { m.on = true; }); bump(); drawMarks(); renderList(); });
  const allOff = btn('close', tr(L, 'Keine', 'None'), () => { R.marks.forEach(m => { m.on = false; }); bump(); drawMarks(); renderList(); });
  const reviewCard = el('div', { class: 'sec-card' }, el('h3', { class: 'sec-h' }, ic('list'), tr(L, 'Prüfen', 'Review')), count,
    el('div', { class: 'sec-row' }, allOn, allOff), list);

  const info = el('p', { class: 'sec-info' }, ic('shield'), tr(L,
    'Echtes Schwärzen: Seiten mit Markierungen werden als Bild neu aufgebaut, der Text darunter wird aus der Datei entfernt – er lässt sich nicht kopieren oder wiederherstellen. Diese Seiten sind danach nicht mehr durchsuchbar.',
    'Real redaction: pages with marks are rebuilt as images and the text underneath is removed from the file – it cannot be copied or recovered. Those pages are no longer searchable afterwards.'));
  clear(stage).append(info, el('div', { class: 'sec-split' }, el('div', { class: 'sec-stage' }, searchCard, reviewCard), previewCard), status.node);
  R.ui = { status };

  let cur = null, renderSeq = 0;
  async function showPage(n) {
    const my = ++renderSeq;
    await pageText(n); // also gives the base viewport
    const w = stageWidth(previewCard, 640) - 30;
    const r = await previewPage(R.pdf, n, Math.max(200, w));
    if (my !== renderSeq) { wipeCanvas(r.canvas); return; }
    if (cur) wipeCanvas(cur.canvas);
    cur = r;
    pageBox.style.width = r.canvas.style.width;
    clear(pageBox).append(r.canvas, overlay);
    drawMarks();
  }
  function drawMarks(focusId = null) {
    if (!cur) return;
    clear(overlay);
    const s = cur.scale;
    for (const m of [...R.marks, ...R.manual].filter(m => m.page === nav.page)) {
      const d = el('div', { class: 'sec-mark' + (m.on ? '' : ' is-off') + (m.id === focusId ? ' is-focus' : '') });
      Object.assign(d.style, { left: `${m.x0 * s - 1}px`, top: `${m.y0 * s - 1}px`, width: `${(m.x1 - m.x0) * s + 2}px`, height: `${(m.y1 - m.y0) * s + 2}px` });
      overlay.append(d);
    }
  }
  // draw boxes
  let start = null, ghost = null;
  pageBox.addEventListener('pointerdown', e => {
    if (!drawing || !cur) return;
    e.preventDefault();
    pageBox.setPointerCapture(e.pointerId);
    const r = pageBox.getBoundingClientRect();
    start = [e.clientX - r.left, e.clientY - r.top];
    ghost = el('div', { class: 'sec-drawing' });
    overlay.append(ghost);
  });
  pageBox.addEventListener('pointermove', e => {
    if (!start) return;
    const r = pageBox.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, e.clientX - r.left)), y = Math.max(0, Math.min(r.height, e.clientY - r.top));
    Object.assign(ghost.style, { left: `${Math.min(x, start[0])}px`, top: `${Math.min(y, start[1])}px`, width: `${Math.abs(x - start[0])}px`, height: `${Math.abs(y - start[1])}px` });
    ghost._end = [x, y];
  });
  const endDraw = () => {
    if (!start) return;
    const end = ghost?._end;
    ghost?.remove();
    if (end && Math.abs(end[0] - start[0]) > 4 && Math.abs(end[1] - start[1]) > 4) {
      const s = cur.scale;
      R.manual.push({ id: ++R.seq, page: nav.page, x0: Math.min(start[0], end[0]) / s, y0: Math.min(start[1], end[1]) / s, x1: Math.max(start[0], end[0]) / s, y1: Math.max(start[1], end[1]) / s, on: true, src: 'manual', label: tr(L, 'Bereich', 'Area') });
      bump(); drawMarks(); renderList();
    }
    start = null; ghost = null;
  };
  pageBox.addEventListener('pointerup', endDraw);
  pageBox.addEventListener('pointercancel', () => { ghost?.remove(); start = null; ghost = null; });

  function renderList() {
    const all = [...R.marks, ...R.manual].sort((a, b) => a.page - b.page || a.y0 - b.y0);
    const on = all.filter(m => m.on);
    const pagesOn = new Set(on.map(m => m.page)).size;
    count.textContent = all.length ? tr(L, `${on.length} von ${all.length} Stellen werden geschwärzt (${pagesOn} ${pagesOn === 1 ? 'Seite' : 'Seiten'}).`, `${on.length} of ${all.length} items will be redacted (${pagesOn} page${pagesOn === 1 ? '' : 's'}).`)
      : tr(L, 'Noch nichts markiert. Gib einen Suchbegriff ein, wähle eine Vorlage oder ziehe einen Bereich auf der Vorschau.', 'Nothing marked yet. Enter a search term, pick a preset or draw an area on the preview.');
    allOn.hidden = allOff.hidden = !R.marks.length;
    clear(list);
    for (const m of all.slice(0, 500)) {
      const id = `sec-hit-${m.id}`;
      const box = el('input', { type: 'checkbox', id, checked: m.on, onchange: () => { m.on = box.checked; bump(); drawMarks(); renderList(); } });
      const label = el('label', { for: id }, el('span', { class: 'sec-hit-text' }, m.text || m.label), el('span', { class: 'sec-hit-meta' }, `${tr(L, 'Seite', 'Page')} ${m.page} · ${m.label}`));
      const show = btn('arrow', '', async () => { if (nav.page !== m.page) { nav.set(m.page); await showPage(m.page); } drawMarks(m.id); pageBox.scrollIntoView({ block: 'nearest' }); },
        { cls: 'wt-icon-btn', label: tr(L, `Auf Seite ${m.page} zeigen`, `Show on page ${m.page}`) });
      const rm = m.src === 'manual' ? btn('trash', '', () => { R.manual = R.manual.filter(x => x !== m); bump(); drawMarks(); renderList(); }, { cls: 'wt-icon-btn', label: tr(L, 'Bereich löschen', 'Delete area') }) : null;
      list.append(el('li', { class: 'sec-hit' }, m.src === 'manual' ? null : box, label, show, rm));
    }
  }

  let scanSeq = 0;
  async function rescan() {
    const my = ++scanSeq;
    let re = null;
    regexErr.hidden = true; regexInput.removeAttribute('aria-invalid');
    if (R.regex.trim()) {
      try { re = new RegExp(R.regex, 'gu'); if (re.test('')) throw new Error('empty match'); re.lastIndex = 0; }
      catch { re = null; regexErr.textContent = tr(L, 'Dieser Ausdruck ist ungültig.', 'This expression is not valid.'); regexErr.hidden = false; regexInput.setAttribute('aria-invalid', 'true'); }
    }
    const queries = [
      ...R.terms.map(t => ({ q: t, label: tr(L, 'Suchbegriff', 'Search term') })),
      ...PRESETS.filter(p => R.presets.has(p.id)).map(p => ({ q: p.re, label: tr(L, p.de, p.en) })),
      ...(re ? [{ q: re, label: tr(L, 'Ausdruck', 'Expression') }] : []),
    ];
    const prevOff = new Set(R.marks.filter(m => !m.on).map(m => `${m.page}|${m.text}|${Math.round(m.x0)}|${Math.round(m.y0)}`));
    const found = [];
    const n = R.pdf.numPages;
    if (queries.length) status.set(tr(L, 'Suche …', 'Searching …'));
    for (let p = 1; p <= n && queries.length; p++) {
      const pt = await pageText(p);
      if (my !== scanSeq) return;
      for (const { q, label } of queries) {
        for (const hit of findInPage(pt, q, { wholeWord: R.whole && typeof q === 'string' })) {
          for (const b of boxesFor(pt.chars, hit.i, hit.j)) found.push({ page: p, ...b, text: hit.text.replace(/\n/g, ' '), label });
        }
        // values of form fields and comments (not part of the page text)
        for (const a of R.pages[p - 1].annots || []) {
          const t = a.text;
          const hit = typeof q === 'string' ? (R.whole ? new RegExp(`(^|[^\\p{L}\\p{N}_])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}_])`, 'iu').test(t) : t.toLowerCase().includes(q.toLowerCase()))
            : new RegExp(q.source, q.flags.replace('g', '')).test(t);
          if (hit) found.push({ page: p, x0: a.rect[0], y0: a.rect[1], x1: a.rect[2], y1: a.rect[3], text: typeof q === 'string' ? q : t.slice(0, 60), label: tr(L, 'Link, Kommentar oder Formularfeld', 'Link, comment or form field') });
        }
      }
      if (p % 10 === 0) { status.set(tr(L, `Suche … Seite ${p} von ${n}`, `Searching … page ${p} of ${n}`)); await new Promise(r => setTimeout(r, 0)); }
    }
    if (my !== scanSeq) return;
    // de-duplicate overlapping boxes from several queries
    const seen = new Set();
    R.marks = [];
    for (const f of found) {
      const key = `${f.page}|${Math.round(f.x0)}|${Math.round(f.y0)}|${Math.round(f.x1)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      R.marks.push({ id: ++R.seq, ...f, on: !prevOff.has(`${f.page}|${f.text}|${Math.round(f.x0)}|${Math.round(f.y0)}`), src: 'search' });
    }
    status.set(queries.length && !R.marks.length ? tr(L, 'Nichts gefunden. Gescannte Seiten ohne Text lassen sich nur per „Bereich ziehen“ schwärzen.', 'Nothing found. Scanned pages without text can only be redacted with “Draw area”.') : '');
    bump();
    drawMarks();
    renderList();
  }

  nav.set(1, R.pdf.numPages);
  renderList();
  requestAnimationFrame(() => showPage(1));
}
