// Tool: comment and mark up PDFs – highlight, underline and strike through text (snaps to the real text), sticky
// notes, text boxes, freehand drawing (pen, finger), rectangles and arrows. Saved as real PDF annotations with
// appearance streams (lib/shared/annotpdf.js, shared with the app), so every PDF reader shows them and they can
// still be edited or deleted there. Undo/redo, a list of all comments, and a summary of all highlights and notes
// as a text file (handy for studying). Scans without text: drawing tools work, text marking needs text recognition
// first (link). "Ansehen" mode lets the page scroll normally on touch screens.
import { el, clear } from '../lib/dom.js';
import { ensureCss, tr, ic, btn, statusLine, previewPage, wipeCanvas, pageNav, stageWidth, saveLikeSource, pdfBlob, loadPdfLib } from '../lib/sec-ui.js';
import { pageChars, nearestChar, quadsFor, boxesFor, textOf } from '../lib/sec-textgeom.js';

const COLORS = { highlight: ['#FFE066', '#8CE99A', '#74C0FC', '#F783AC'], other: ['#E03131', '#1C64F2', '#2B8A3E', '#1F2340'] };
const COLOR_NAMES = { '#FFE066': ['Gelb', 'Yellow'], '#8CE99A': ['Grün', 'Green'], '#74C0FC': ['Blau', 'Blue'], '#F783AC': ['Pink', 'Pink'],
  '#E03131': ['Rot', 'Red'], '#1C64F2': ['Blau', 'Blue'], '#2B8A3E': ['Grün', 'Green'], '#1F2340': ['Schwarz', 'Black'] };
const TOOLS = [
  { id: 'view', icon: 'expand', de: 'Ansehen', en: 'View' },
  { id: 'highlight', icon: 'pen', de: 'Markieren', en: 'Highlight', text: true },
  { id: 'underline', icon: 'type', de: 'Unterstreichen', en: 'Underline', text: true },
  { id: 'strike', icon: 'cross', de: 'Durchstreichen', en: 'Strike out', text: true },
  { id: 'note', icon: 'textarea', de: 'Notiz', en: 'Note' },
  { id: 'text', icon: 'textbox', de: 'Text', en: 'Text' },
  { id: 'ink', icon: 'pen', de: 'Zeichnen', en: 'Draw' },
  { id: 'rect', icon: 'box', de: 'Rechteck', en: 'Rectangle' },
  { id: 'arrow', icon: 'next', de: 'Pfeil', en: 'Arrow' },
];
const S = { inputId: null, pdf: null, pages: [], items: [], undone: [], tool: null, color: { highlight: COLORS.highlight[0], other: COLORS.other[0] }, ui: null, seq: 0 };

const label = (t, lang) => tr(lang, t.de, t.en);
const isText = id => ['highlight', 'underline', 'strike'].includes(id);

export default {
  options: [],
  mountStage(stage, state, ctx) { ensureCss(); S.ui = buildStage(stage, state, ctx); S.ui.load(); },
  onInputs() { S.ui?.load(); },
  status(values, inputs) {
    const n = S.items.length;
    return { summary: n ? { de: `${n} ${n === 1 ? 'Kommentar' : 'Kommentare'}`, en: `${n} ${n === 1 ? 'comment' : 'comments'}` } : null,
      hint: n ? null : { de: 'Wähle oben ein Werkzeug und markiere auf der Seite.', en: 'Choose a tool above and mark up the page.' }, ok: n > 0 };
  },

  async run(inputs, opts, ctx) {
    const input = inputs[0];
    const PDFLib = await loadPdfLib();
    const doc = await input.pdfDoc();
    const pdf = await input.pdfjs();
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      if (!S.items.some(a => a.page === i)) { pages.push(null); continue; }
      const p = await pdf.getPage(i);
      pages.push({ base: p.getViewport({ scale: 1 }) });
    }
    ctx.progress(0.5, { de: 'Kommentare werden gespeichert …', en: 'Saving comments …' });
    const { writeAnnotations } = await import('../lib/shared/annotpdf.js');
    // text markup: the PDF comment is the user's comment (the marked text itself is in the page already)
    await writeAnnotations(PDFLib, doc, S.items.map(a => (isText(a.type) ? { ...a, text: a.comment || '' } : { ...a })), pages);
    const { bytes, protectedAgain } = await saveLikeSource(doc, input);
    if (protectedAgain) ctx.note({ de: 'Die PDF ist wieder mit ihrem Passwort geschützt.', en: 'The PDF is protected with its password again.' });
    const outputs = [{ name: ctx.fileName(input.name, ctx.lang === 'en' ? ' (comments)' : ' (kommentiert)', 'pdf'), blob: pdfBlob(bytes), pages: pdf.numPages }];
    const summary = summaryText(ctx.lang, input.name);
    if (summary) outputs.push({ name: ctx.fileName(input.name, ctx.lang === 'en' ? ' – highlights' : ' – Markierungen', 'md'), blob: new Blob([summary], { type: 'text/markdown;charset=utf-8' }), note: ctx.t({ de: 'Alle Markierungen und Notizen als Text', en: 'All highlights and notes as text' }) });
    ctx.note({ de: 'Die Kommentare sind echte PDF-Anmerkungen – andere PDF-Programme zeigen sie an und können sie bearbeiten oder löschen.', en: 'The comments are real PDF annotations – other PDF programs show them and can edit or delete them.' });
    return { outputs };
  },
};

/** Markdown summary of highlights, notes and text boxes in page order. */
export function summaryText(lang, name) {
  const list = S.items.filter(a => (isText(a.type) && a.text) || ((a.type === 'note' || a.type === 'text') && a.text)).slice().sort((a, b) => a.page - b.page || (a.order || 0) - (b.order || 0));
  if (!list.length) return '';
  const L = { highlight: tr(lang, 'Markiert', 'Highlighted'), underline: tr(lang, 'Unterstrichen', 'Underlined'), strike: tr(lang, 'Durchgestrichen', 'Struck out'), note: tr(lang, 'Notiz', 'Note'), text: tr(lang, 'Text', 'Text') };
  let out = `# ${tr(lang, 'Markierungen und Notizen', 'Highlights and notes')}: ${name}\n`;
  let page = 0;
  for (const a of list) {
    if (a.page !== page) { page = a.page; out += `\n## ${tr(lang, 'Seite', 'Page')} ${page}\n\n`; }
    const t = String(a.text).replace(/\s+/g, ' ').trim();
    out += isText(a.type) ? `- **${L[a.type]}:** „${t}“${a.comment ? ` – ${a.comment}` : ''}\n` : `- **${L[a.type]}:** ${t}\n`;
  }
  return out;
}

function buildStage(stage, state, ctx) {
  const lang = ctx.lang;
  const coarse = matchMedia('(pointer: coarse)').matches;
  S.tool = coarse ? 'view' : 'highlight';
  const status = statusLine();
  const toolBtns = TOOLS.map(t => {
    const b = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm an-tool', aria: { pressed: 'false' }, onclick: () => setTool(t.id) }, ic(t.icon), el('span', {}, label(t, lang)));
    b.dataset.tool = t.id;
    return b;
  });
  const swatchRow = el('div', { class: 'an-swatches', role: 'radiogroup', aria: { label: tr(lang, 'Farbe', 'Colour') } });
  const undoB = btn('undo', tr(lang, 'Rückgängig', 'Undo'), () => undo());
  const redoB = btn('undo', tr(lang, 'Wiederholen', 'Redo'), () => redo());
  redoB.querySelector('svg').style.transform = 'scaleX(-1)';
  const nav = pageNav(lang, n => showPage(n));
  const pageBox = el('div', { class: 'sec-page an-page' });
  const listBox = el('div', { class: 'an-list' });
  const box = el('section', { class: 'sec-card an', aria: { label: tr(lang, 'Kommentieren', 'Comment') } },
    el('div', { class: 'an-tools', role: 'toolbar', aria: { label: tr(lang, 'Werkzeuge', 'Tools') } }, ...toolBtns),
    el('div', { class: 'sec-row an-row' }, swatchRow, el('span', { class: 'an-grow' }), undoB, redoB),
    nav.node, el('div', { class: 'sec-page-wrap' }, pageBox), status.node,
    el('h3', { class: 'sec-h' }, ic('list'), tr(lang, 'Kommentare', 'Comments')), listBox);
  stage.classList.add('sec-stage');
  stage.append(box);
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || state.phase !== 'files' || /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  });

  let cur = null;   // { n, canvas, vp, scale, overlay, chars }
  function changed() { state.results.clear(); ctx.refresh(); renderList(); drawOverlay(); undoB.disabled = !S.items.length; redoB.disabled = !S.undone.length; }
  function add(a) { a.id = ++S.seq; a.order = S.seq; S.items.push(a); S.undone = []; changed(); return a; }
  function undo() { const a = S.items.pop(); if (a) { S.undone.push(a); changed(); } }
  function redo() { const a = S.undone.pop(); if (a) { S.items.push(a); changed(); } }

  function setTool(id) {
    S.tool = id;
    toolBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === id)));
    pageBox.classList.toggle('is-drawing', id !== 'view');
    renderSwatches();
    hint();
  }
  function renderSwatches() {
    const kind = S.tool === 'highlight' ? 'highlight' : 'other';
    clear(swatchRow);
    swatchRow.hidden = S.tool === 'view';
    for (const c of COLORS[kind]) {
      const b = el('button', { type: 'button', class: 'an-swatch', role: 'radio', aria: { checked: String(S.color[kind] === c), label: tr(lang, ...(COLOR_NAMES[c] || [c, c])) }, onclick: () => { S.color[kind] = c; renderSwatches(); } });
      b.style.background = c;
      swatchRow.append(b);
    }
  }
  function hint() {
    const t = TOOLS.find(x => x.id === S.tool);
    if (isText(S.tool) && cur && !cur.chars.chars.length) {
      status.set(tr(lang, 'Diese Seite hat keinen Text (Scan). Zum Markieren mach die PDF zuerst mit „PDF Texterkennung“ durchsuchbar – Zeichnen, Notiz und Rechteck gehen sofort.', 'This page has no text (scan). To highlight, make the PDF searchable with “OCR PDF” first – drawing, notes and rectangles work right away.'), 'error');
      return;
    }
    const H = {
      view: tr(lang, 'Ansehen: Die Seite lässt sich normal scrollen. Wähle ein Werkzeug, um zu kommentieren.', 'View: the page scrolls normally. Choose a tool to comment.'),
      highlight: tr(lang, 'Zieh über den Text, den du markieren willst.', 'Drag across the text you want to highlight.'),
      underline: tr(lang, 'Zieh über den Text, den du unterstreichen willst.', 'Drag across the text you want to underline.'),
      strike: tr(lang, 'Zieh über den Text, den du durchstreichen willst.', 'Drag across the text you want to strike out.'),
      note: tr(lang, 'Tippe auf die Stelle für die Notiz – den Text schreibst du unten in der Liste.', 'Tap where the note should go – write its text in the list below.'),
      text: tr(lang, 'Tippe auf die Stelle für den Text – schreib ihn unten in der Liste.', 'Tap where the text should go – type it in the list below.'),
      ink: tr(lang, 'Zeichne mit Finger, Stift oder Maus.', 'Draw with finger, pen or mouse.'),
      rect: tr(lang, 'Zieh ein Rechteck auf.', 'Drag to draw a rectangle.'),
      arrow: tr(lang, 'Zieh vom Anfang zur Spitze des Pfeils.', 'Drag from the start to the tip of the arrow.'),
    };
    status.set(H[t.id] || '');
  }

  async function load() {
    const input = state.inputs.find(i => !i.error && !i.locked);
    if (!input) { clear(pageBox); status.set(tr(lang, 'Gib zuerst das Passwort der PDF ein.', 'Enter the PDF’s password first.')); return; }
    if (S.inputId === input.id) return;
    S.inputId = input.id; S.items = []; S.undone = []; S.pages = [];
    S.pdf = await input.pdfjs();
    nav.set(1, S.pdf.numPages);
    setTool(S.tool);
    await showPage(1);
    changed();
  }

  async function showPage(n) {
    const width = stageWidth(box, 820) - 4;
    const { canvas, vp, scale, page } = await previewPage(S.pdf, n, width);
    if (!S.pages[n - 1]) S.pages[n - 1] = { chars: await pageChars(await S.pdf.getPage(n), vp) };
    if (cur) wipeCanvas(cur.canvas);
    const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlay.setAttribute('class', 'sec-overlay an-overlay');
    overlay.setAttribute('viewBox', `0 0 ${vp.width} ${vp.height}`);
    clear(pageBox).append(canvas, overlay);
    pageBox.style.width = canvas.style.width;
    cur = { n, canvas, vp, scale, overlay, chars: S.pages[n - 1].chars, page };
    attach(overlay);
    drawOverlay();
    hint();
  }

  // ---------- drawing the comments of the current page (viewport scale-1 coordinates)
  const NS = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  function drawOverlay(live = null) {
    if (!cur) return;
    clear(cur.overlay);
    for (const a of [...S.items.filter(x => x.page === cur.n), ...(live ? [live] : [])]) {
      if (isText(a.type)) {
        for (const b of a.boxes) {
          if (a.type === 'highlight') cur.overlay.append(sv('rect', { x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0, fill: a.color, 'fill-opacity': '0.45', class: 'an-hl' }));
          else { const y = a.type === 'underline' ? b.y1 - (b.y1 - b.y0) * 0.1 : (b.y0 + b.y1) / 2; cur.overlay.append(sv('line', { x1: b.x0, x2: b.x1, y1: y, y2: y, stroke: a.color, 'stroke-width': Math.max(0.8, (b.y1 - b.y0) * 0.07) })); }
        }
      } else if (a.type === 'ink') {
        for (const p of a.paths) cur.overlay.append(sv('polyline', { points: p.map(q => q.join(',')).join(' '), fill: 'none', stroke: a.color, 'stroke-width': a.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      } else if (a.type === 'rect') {
        cur.overlay.append(sv('rect', { x: Math.min(a.x0, a.x1), y: Math.min(a.y0, a.y1), width: Math.abs(a.x1 - a.x0), height: Math.abs(a.y1 - a.y0), fill: 'none', stroke: a.color, 'stroke-width': a.width }));
      } else if (a.type === 'arrow') {
        cur.overlay.append(sv('line', { x1: a.x0, y1: a.y0, x2: a.x1, y2: a.y1, stroke: a.color, 'stroke-width': a.width, 'stroke-linecap': 'round' }));
        const len = Math.hypot(a.x1 - a.x0, a.y1 - a.y0) || 1, d = [(a.x1 - a.x0) / len, (a.y1 - a.y0) / len], s = Math.max(7, a.width * 3.5);
        const l = [a.x1 - d[0] * s - d[1] * s * 0.55, a.y1 - d[1] * s + d[0] * s * 0.55], r = [a.x1 - d[0] * s + d[1] * s * 0.55, a.y1 - d[1] * s - d[0] * s * 0.55];
        cur.overlay.append(sv('polyline', { points: `${l.join(',')} ${a.x1},${a.y1} ${r.join(',')}`, fill: 'none', stroke: a.color, 'stroke-width': a.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      } else if (a.type === 'note') {
        const g = sv('g', { class: 'an-note' });
        g.append(sv('rect', { x: a.x, y: a.y, width: 20, height: 20, rx: 3, fill: a.color, stroke: '#383A52', 'stroke-width': 0.8 }));
        g.append(sv('path', { d: `M${a.x + 5} ${a.y + 6}h10M${a.x + 5} ${a.y + 10}h10M${a.x + 5} ${a.y + 14}h7`, stroke: '#383A52', 'stroke-width': 1.2 }));
        cur.overlay.append(g);
      } else if (a.type === 'text') {
        const t = sv('text', { x: a.x + 2, y: a.y + a.size * 0.95 + 2, fill: a.color, 'font-size': a.size, 'font-family': 'Helvetica, Arial, sans-serif' });
        (a.text || '…').split('\n').forEach((line, i) => { const ts = sv('tspan', { x: a.x + 2, dy: i ? a.size * 1.2 : 0 }); ts.textContent = line || ' '; t.append(ts); });
        cur.overlay.append(t);
      }
    }
  }

  // ---------- input
  function attach(overlay) {
    const pt = e => { const r = overlay.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * cur.vp.width, (e.clientY - r.top) / r.height * cur.vp.height]; };
    overlay.addEventListener('pointerdown', e => {
      const tool = S.tool;
      if (tool === 'view' || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      try { overlay.setPointerCapture(e.pointerId); } catch { /* optional */ }
      const p0 = pt(e);
      const color = tool === 'highlight' ? S.color.highlight : (tool === 'note' ? '#FFD43B' : S.color.other);
      const chars = cur.chars.chars;
      let live = null;
      if (isText(tool)) {
        const i = nearestChar(chars, ...p0);
        if (i < 0) { hint(); return; }
        live = { type: tool, page: cur.n, color, i, j: i, boxes: boxesFor(chars, i, i) };
      } else if (tool === 'ink') live = { type: 'ink', page: cur.n, color, width: 2, paths: [[p0]] };
      else if (tool === 'rect' || tool === 'arrow') live = { type: tool, page: cur.n, color, width: 2, x0: p0[0], y0: p0[1], x1: p0[0], y1: p0[1] };
      const move = ev => {
        if (!live) return;
        const p = pt(ev);
        if (isText(tool)) { live.j = nearestChar(chars, ...p); live.boxes = boxesFor(chars, live.i, live.j); }
        else if (tool === 'ink') live.paths[0].push(p);
        else { live.x1 = p[0]; live.y1 = p[1]; }
        drawOverlay(live);
      };
      const up = ev => {
        overlay.removeEventListener('pointermove', move);
        overlay.removeEventListener('pointerup', up);
        overlay.removeEventListener('pointercancel', up);
        const p = pt(ev);
        if (tool === 'note') { const a = add({ type: 'note', page: cur.n, color, x: p[0] - 10, y: p[1] - 10, text: '' }); focusItem(a); return; }
        if (tool === 'text') { const a = add({ type: 'text', page: cur.n, color, x: p[0], y: p[1] - 8, size: 12, text: '' }); focusItem(a); return; }
        if (!live) return;
        if (isText(tool)) {
          const quads = quadsFor(chars, live.i, live.j);
          if (!quads.length) { drawOverlay(); return; }
          add({ type: tool, page: cur.n, color, quads, boxes: boxesFor(chars, live.i, live.j), text: textOf(chars, live.i, live.j).replace(/\s+/g, ' ').trim(), comment: '' });
        } else if (tool === 'ink') {
          if (live.paths[0].length > 1) add(live); else drawOverlay();
        } else if (Math.hypot(live.x1 - live.x0, live.y1 - live.y0) > 4) add(live);
        else drawOverlay();
      };
      overlay.addEventListener('pointermove', move);
      overlay.addEventListener('pointerup', up);
      overlay.addEventListener('pointercancel', up);
    });
  }

  // ---------- list of comments
  const NAMES = { highlight: ['Markierung', 'Highlight'], underline: ['Unterstrichen', 'Underline'], strike: ['Durchgestrichen', 'Strike-out'], note: ['Notiz', 'Note'], text: ['Text', 'Text'], ink: ['Zeichnung', 'Drawing'], rect: ['Rechteck', 'Rectangle'], arrow: ['Pfeil', 'Arrow'] };
  function renderList() {
    clear(listBox);
    if (!S.items.length) { listBox.append(el('p', { class: 'sec-small' }, tr(lang, 'Noch keine Kommentare.', 'No comments yet.'))); return; }
    for (const a of S.items.slice().sort((x, y) => x.page - y.page || x.order - y.order)) {
      const head = el('div', { class: 'an-item-head' },
        el('span', { class: 'an-dot' }), el('strong', {}, tr(lang, ...NAMES[a.type])), el('span', { class: 'sec-small' }, ` · ${tr(lang, 'Seite', 'Page')} ${a.page}`),
        el('span', { class: 'an-grow' }),
        btn('trash', '', () => { S.items = S.items.filter(x => x !== a); S.undone.push(a); changed(); }, { cls: 'wt-icon-btn', label: tr(lang, 'Löschen', 'Delete') }));
      head.querySelector('.an-dot').style.background = a.color;
      const item = el('div', { class: 'an-item' }, head);
      item.dataset.id = a.id;
      if (isText(a.type) && a.text) item.append(el('blockquote', { class: 'an-quote' }, a.text));
      if (a.type === 'note' || a.type === 'text' || isText(a.type)) {
        const key = isText(a.type) ? 'comment' : 'text';
        const ta = el('textarea', { class: 'wt-input an-input', rows: a.type === 'text' ? '2' : '2', placeholder: isText(a.type) ? tr(lang, 'Kommentar (optional)', 'Comment (optional)') : tr(lang, 'Text eingeben …', 'Type text …'),
          aria: { label: tr(lang, ...NAMES[a.type]) }, oninput: () => { a[key] = ta.value; state.results.clear(); if (a.type === 'text') drawOverlay(); } });
        ta.value = a[key] || '';
        item.append(ta);
      }
      item.addEventListener('click', e => { if (e.target.closest('button,textarea')) return; if (cur?.n !== a.page) { nav.set(a.page); showPage(a.page); } });
      listBox.append(item);
    }
  }
  function focusItem(a) {
    renderList();
    const ta = listBox.querySelector(`.an-item[data-id="${a.id}"] textarea`);
    if (ta) { ta.scrollIntoView({ block: 'center' }); ta.focus({ preventScroll: true }); }
  }

  return { load };
}
