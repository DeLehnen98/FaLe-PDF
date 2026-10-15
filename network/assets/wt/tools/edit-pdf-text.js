// Tool: "PDF bearbeiten" – place text, change existing text (cover + retype), highlights (snapping to the
// text under your finger), check and cross marks, date, rectangles, circles, arrows, lines, a pen, white-out
// and images directly on the page preview: tap to add, drag to move, handles to resize, undo/redo, several
// pages. Everything is burnt into the PDF as vector content (text stays selectable text: standard fonts, or an
// embedded Unicode subset for Polish, Turkish, Greek, Cyrillic … – lib/unifont.js).
// Ideas from the app's js/tools/annotate.js, annotpdf.js, stamp.js and edit.js; geometry in the visual
// frame of each page (/Rotate, CropBox offsets).
import { loadPdfLib } from '../lib/pdf.js';
import { frame, drawVisual, fontCache, fitText, lostOf, preloadUniFont, hexColor, lostWarning, FONT_CSS, saveResult, drawCentered, userError, pageLang } from '../lib/edit-draw.js';
import { needsUnicode } from '../lib/unifont.js';
import { createPreview } from '../lib/edit-preview.js';
import { pageChars, nearestChar, boxesFor } from '../lib/edit-textgeom.js';
import { embedImage } from '../lib/imgembed.js';
import { InputFile } from '../lib/files.js';
import { el, clear } from '../lib/dom.js';

const LANG = pageLang();
const SVGNS = 'http://www.w3.org/2000/svg';
const BASELINE = { sans: 0.945, serif: 0.937, mono: 0.866 }; // first baseline below the top of a 1.2 line box (× size)
const COLORS = ['#000000', '#1f4fd6', '#d0312d', '#138a36', '#7a3fd0', '#f08c00', '#ffe14d', '#ffffff'];
const COLOR_NAMES = {
  de: { '#000000': 'Schwarz', '#1f4fd6': 'Blau', '#d0312d': 'Rot', '#138a36': 'Grün', '#7a3fd0': 'Lila', '#f08c00': 'Orange', '#ffe14d': 'Gelb', '#ffffff': 'Weiß' },
  en: { '#000000': 'Black', '#1f4fd6': 'Blue', '#d0312d': 'Red', '#138a36': 'Green', '#7a3fd0': 'Purple', '#f08c00': 'Orange', '#ffe14d': 'Yellow', '#ffffff': 'White' },
};

// tool icons: stroke paths in a 24 × 24 box
const ICONS = {
  select: ['M5 3l14 8-6 1.5L10 19z'],
  text: ['M5 6V4h14v2', 'M12 4v16', 'M9 20h6'],
  replace: ['M4 7h10', 'M4 12h6', 'M4 17h8', 'M15 13l5-5 2 2-5 5h-2z'],
  hl: ['M4 20h8', 'M14 4l6 6-8 8H8v-4z'],
  check: ['M4 12.5l5 5L20 6'],
  cross: ['M6 6l12 12', 'M18 6L6 18'],
  date: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v5', 'M16 3v5', 'M8 14h3'],
  rect: ['M4 6h16v12H4z'],
  ellipse: ['M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z'],
  arrow: ['M5 19L19 5', 'M10 5h9v9'],
  line: ['M5 19L19 5'],
  pen: ['M4 20c3-1 4-5 7-6s4 2 6 1 2-4 3-5', 'M15 4l5 5'],
  cover: ['M4 6h16v12H4z', 'M7 10h10', 'M7 14h6'],
  image: ['M4 5h16v14H4z', 'M4 16l5-5 4 4 2-2 5 5', 'M15.5 9.5h.01'],
  undo: ['M9 7L4 12l5 5', 'M4 12h11a5 5 0 0 1 0 10h-2'],
  redo: ['M15 7l5 5-5 5', 'M20 12H9a5 5 0 0 0 0 10h2'],
  trash: ['M5 7h14', 'M10 4h4', 'M7 7l1 13h8l1-13'],
  zoom: ['M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z', 'M15.5 15.5L20 20', 'M10.5 8v5', 'M8 10.5h5'],
  copy: ['M8 8h11v12H8z', 'M5 16V4h11'],
  bold: ['M7 4h6a4 4 0 0 1 0 8H7z', 'M7 12h7a4 4 0 0 1 0 8H7z'],
};
function svgIcon(name) {
  const s = document.createElementNS(SVGNS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) s.setAttribute(k, v);
  for (const d of ICONS[name] || []) { const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}

const T = {
  de: {
    tools: { select: 'Auswählen', text: 'Text', replace: 'Text ändern', hl: 'Markieren', check: 'Haken', cross: 'Kreuz', date: 'Datum', rect: 'Rechteck', ellipse: 'Kreis', arrow: 'Pfeil', line: 'Linie', pen: 'Stift', cover: 'Abdecken', image: 'Bild' },
    hints: {
      select: 'Tippe ein Element an, um es zu verschieben, zu ändern oder zu löschen. Wische auf freier Fläche, um die Seite zu wechseln.',
      text: 'Tippe auf die Stelle, an der der Text stehen soll.',
      replace: 'Tippe auf eine Textzeile: Sie wird weiß abgedeckt und du schreibst den neuen Text darüber.',
      hl: 'Ziehe über Text, um ihn zu markieren – oder ziehe einen Bereich auf.',
      check: 'Tippe auf Kästchen, um Haken zu setzen.', cross: 'Tippe auf Kästchen, um Kreuze zu setzen.',
      date: 'Tippe auf die Stelle, an der das heutige Datum stehen soll.',
      rect: 'Ziehe ein Rechteck auf.', ellipse: 'Ziehe einen Kreis oder eine Ellipse auf.', arrow: 'Ziehe einen Pfeil – die Spitze ist am Ende.', line: 'Ziehe eine Linie.',
      pen: 'Zeichne mit dem Finger. Zum Blättern wechsle zu „Auswählen“.',
      cover: 'Ziehe einen weißen Kasten über Inhalte, die nicht zu sehen sein sollen.',
      image: 'Wähle ein Bild (z. B. Logo oder Unterschrift) – es wird auf der Seite eingefügt.',
    },
    undo: 'Rückgängig', redo: 'Wiederholen', del: 'Löschen', dup: 'Duplizieren', zoom: 'Vergrößern', unzoom: 'Verkleinern',
    content: 'Text', font: 'Schrift', size: 'Größe', width: 'Strichstärke', color: 'Farbe', fill: 'Füllung', bold: 'Fett',
    fonts: { sans: 'Serifenlos', serif: 'Mit Serifen', mono: 'Schreibmaschine' },
    placeholder: 'Dein Text', count: n => (n === 1 ? '1 Änderung' : `${n} Änderungen`), none: 'Noch keine Änderungen',
    obj: { text: 'Text', hl: 'Markierung', check: 'Haken', cross: 'Kreuz', rect: 'Rechteck', ellipse: 'Kreis', arrow: 'Pfeil', line: 'Linie', pen: 'Zeichnung', cover: 'Abdeckung', image: 'Bild' },
    handle: 'Größe ändern', end1: 'Anfang', end2: 'Ende', noText: 'Auf dieser Seite wurde kein Text gefunden (z. B. bei Scans). Nutze „Abdecken“ und „Text“.',
    cover_note: 'Abdecken verdeckt Inhalte nur – darunter bleiben sie in der Datei erhalten. Für vertrauliche Daten nutze ein Schwärzen-Werkzeug.',
    sel: 'Ausgewählt',
  },
  en: {
    tools: { select: 'Select', text: 'Text', replace: 'Change text', hl: 'Highlight', check: 'Tick', cross: 'Cross', date: 'Date', rect: 'Rectangle', ellipse: 'Circle', arrow: 'Arrow', line: 'Line', pen: 'Pen', cover: 'White-out', image: 'Image' },
    hints: {
      select: 'Tap an item to move, change or delete it. Swipe on an empty area to change the page.',
      text: 'Tap where the text should go.',
      replace: 'Tap a line of text: it is covered in white and you type the new text on top.',
      hl: 'Drag across text to highlight it – or drag out an area.',
      check: 'Tap boxes to tick them.', cross: 'Tap boxes to cross them.',
      date: 'Tap where today’s date should go.',
      rect: 'Drag out a rectangle.', ellipse: 'Drag out a circle or ellipse.', arrow: 'Drag an arrow – the tip is at the end.', line: 'Drag a line.',
      pen: 'Draw with your finger. To change pages, switch to “Select”.',
      cover: 'Drag a white box over content that should not be visible.',
      image: 'Choose an image (e.g. a logo or signature) – it is placed on the page.',
    },
    undo: 'Undo', redo: 'Redo', del: 'Delete', dup: 'Duplicate', zoom: 'Zoom in', unzoom: 'Zoom out',
    content: 'Text', font: 'Font', size: 'Size', width: 'Line width', color: 'Colour', fill: 'Fill', bold: 'Bold',
    fonts: { sans: 'Sans serif', serif: 'Serif', mono: 'Typewriter' },
    placeholder: 'Your text', count: n => (n === 1 ? '1 change' : `${n} changes`), none: 'No changes yet',
    obj: { text: 'Text', hl: 'Highlight', check: 'Tick', cross: 'Cross', rect: 'Rectangle', ellipse: 'Circle', arrow: 'Arrow', line: 'Line', pen: 'Drawing', cover: 'White-out', image: 'Image' },
    handle: 'Resize', end1: 'Start', end2: 'End', noText: 'No text was found on this page (e.g. a scan). Use “White-out” and “Text”.',
    cover_note: 'White-out only covers content – it stays in the file underneath. For confidential data use a redaction tool.',
    sel: 'Selected',
  },
};

const DRAG_TOOLS = new Set(['rect', 'ellipse', 'arrow', 'line', 'pen', 'hl', 'cover']);
const STICKY_TOOLS = new Set(['check', 'cross', 'pen', 'hl']); // stay active after use
const BOX_TYPES = new Set(['rect', 'ellipse', 'cover', 'check', 'cross', 'image']);

let seq = 0;
const newId = () => `o${Date.now().toString(36)}${(seq++).toString(36)}`;
const images = new Map(); // id → {input, url, w, h}

// ---------------------------------------------------------------- geometry helpers
const fmtDate = lang => new Date().toLocaleDateString(lang === 'en' ? 'en-GB' : 'de-DE');
const n2 = v => Math.round(v * 100) / 100;

/** SVG path data (visual top-left coordinates) for marks and arrows. */
export function markPath(o) {
  const { x, y, w, h } = o;
  const P = (u, v) => `${n2(x + u * w)} ${n2(y + v * h)}`;
  if (o.type === 'check') return `M${P(0.1, 0.55)} L${P(0.4, 0.85)} L${P(0.92, 0.15)}`;
  return `M${P(0.15, 0.15)} L${P(0.85, 0.85)} M${P(0.85, 0.15)} L${P(0.15, 0.85)}`;
}
export function arrowHead(o) {
  const ang = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
  const len = Math.max(8, o.width * 4.5), spread = 0.45;
  const a = [o.x2 - len * Math.cos(ang - spread), o.y2 - len * Math.sin(ang - spread)];
  const b = [o.x2 - len * Math.cos(ang + spread), o.y2 - len * Math.sin(ang + spread)];
  return `M${n2(o.x2)} ${n2(o.y2)} L${n2(a[0])} ${n2(a[1])} L${n2(b[0])} ${n2(b[1])} Z`;
}
function arrowShaftEnd(o) {
  const ang = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
  const back = Math.max(8, o.width * 4.5) * 0.8;
  return [o.x2 - back * Math.cos(ang), o.y2 - back * Math.sin(ang)];
}
const penPath = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${n2(p[0])} ${n2(p[1])}`).join(' ') + (pts.length === 1 ? ` L${n2(pts[0][0] + 0.1)} ${n2(pts[0][1] + 0.1)}` : '');

function textLines(o) { return String(o.text || '').split('\n'); }
function fontKey(o) { return (o.font || 'sans') + (o.bold ? '-bold' : ''); }

// ---------------------------------------------------------------- burn into the PDF
export async function burn(doc, PDFLib, objs, { tick = null } = {}) {
  const fonts = fontCache(doc, PDFLib);
  const imgCache = new Map();
  const pages = doc.getPages();
  const lost = new Map();
  const { LineCapStyle, BlendMode } = PDFLib;
  const byPage = new Map();
  for (const o of objs) { if (o.page < pages.length) { if (!byPage.has(o.page)) byPage.set(o.page, []); byPage.get(o.page).push(o); } }
  let k = 0;
  for (const [pi, list] of byPage) {
    const page = pages[pi];
    const f = frame(page);
    const H = f.H;
    // fonts and images first (async), then draw synchronously in the visual frame
    const prepared = [];
    for (const o of list) {
      if (o.type === 'text') {
        const r = await fitText(fonts, fontKey(o), o.text);
        for (const [a, b] of r.lost) lost.set(a, b);
        if (!r.text.trim()) continue;
        prepared.push({ o, font: r.font, lines: r.text.split('\n') });
      } else if (o.type === 'image') {
        const im = images.get(o.img);
        if (!im) continue;
        if (!imgCache.has(o.img)) imgCache.set(o.img, await embedImage(doc, im.input));
        prepared.push({ o, img: imgCache.get(o.img) });
      } else prepared.push({ o });
    }
    drawVisual(page, PDFLib, f, () => {
      for (const p of prepared) {
        const o = p.o;
        const color = hexColor(PDFLib, o.color);
        switch (o.type) {
          case 'text': {
            const base = BASELINE[o.font] || BASELINE.sans;
            p.lines.forEach((line, i) => {
              if (!line) return;
              page.drawText(line, { x: o.x, y: H - (o.y + o.size * base + i * o.size * 1.2), size: o.size, font: p.font, color });
            });
            break;
          }
          case 'rect': case 'cover': {
            const fill = o.type === 'cover' ? hexColor(PDFLib, o.color || '#ffffff') : (o.fill ? color : undefined);
            page.drawRectangle({ x: o.x, y: H - o.y - o.h, width: o.w, height: o.h, color: fill, borderColor: o.type === 'cover' ? undefined : color, borderWidth: o.type === 'cover' ? 0 : o.width, opacity: o.type === 'rect' && o.fill ? 0.35 : undefined });
            break;
          }
          case 'ellipse':
            page.drawEllipse({ x: o.x + o.w / 2, y: H - o.y - o.h / 2, xScale: o.w / 2, yScale: o.h / 2, borderColor: color, borderWidth: o.width, color: o.fill ? color : undefined, opacity: o.fill ? 0.35 : undefined });
            break;
          case 'hl':
            for (const r of o.rects) page.drawRectangle({ x: r.x, y: H - r.y - r.h, width: r.w, height: r.h, color, opacity: 0.4, blendMode: BlendMode.Multiply });
            break;
          case 'line': case 'arrow': {
            const end = o.type === 'arrow' ? arrowShaftEnd(o) : [o.x2, o.y2];
            page.drawSvgPath(`M${n2(o.x1)} ${n2(o.y1)} L${n2(end[0])} ${n2(end[1])}`, { x: 0, y: H, borderColor: color, borderWidth: o.width, borderLineCap: LineCapStyle.Round });
            if (o.type === 'arrow') page.drawSvgPath(arrowHead(o), { x: 0, y: H, color, borderColor: color, borderWidth: 0.5 });
            break;
          }
          case 'pen':
            page.drawSvgPath(penPath(o.points), { x: 0, y: H, borderColor: color, borderWidth: o.width, borderLineCap: LineCapStyle.Round });
            break;
          case 'check': case 'cross':
            page.drawSvgPath(markPath(o), { x: 0, y: H, borderColor: color, borderWidth: Math.max(1, Math.min(o.w, o.h) * 0.12), borderLineCap: LineCapStyle.Round });
            break;
          case 'image':
            drawCentered(page, PDFLib, { img: p.img, w: o.w, h: o.h }, o.x + o.w / 2, H - o.y - o.h / 2, 0, 1);
            break;
          default:
        }
      }
    });
    if (tick && ++k % 5 === 0) await tick(k, byPage.size);
  }
  return { lost, pages: byPage.size };
}

// ---------------------------------------------------------------- the editor
let ed = null;

function mountEditor(stage, state, ctx) {
  const lang = ctx.lang === 'en' ? 'en' : 'de';
  const L = T[lang];
  stage.classList.add('ed-edit');
  if (!Array.isArray(state.values.objs)) state.values.objs = [];
  let objs = state.values.objs;
  let tool = 'select';
  let selId = null;
  let geo = null; // {W, H, scale, index}
  let history = [JSON.stringify(objs)], hpos = 0;
  const measured = new Map();
  const style = { text: { color: '#000000', size: 12, font: 'sans', bold: false }, shape: { color: '#d0312d', width: 2 }, mark: { color: '#1f4fd6' }, hl: { color: '#ffe14d' }, pen: { color: '#1f4fd6', width: 2 } };
  const charsCache = new Map();
  const input = () => state.inputs.find(i => !i.error && !i.locked);

  // ---- toolbar
  const toolBtns = new Map();
  const toolbar = el('div', { class: 'ed-tools', role: 'toolbar', aria: { label: lang === 'en' ? 'Tools' : 'Werkzeuge' } });
  for (const id of ['select', 'text', 'replace', 'hl', 'check', 'cross', 'date', 'pen', 'rect', 'ellipse', 'arrow', 'line', 'cover', 'image']) {
    const b = el('button', { type: 'button', class: 'ed-tool', aria: { pressed: String(id === tool) }, dataset: { tool: id }, onclick: () => setTool(id) }, svgIcon(id), el('span', {}, L.tools[id]));
    toolBtns.set(id, b);
    toolbar.append(b);
  }
  const undoBtn = el('button', { type: 'button', class: 'ed-chip', onclick: () => undo() }, svgIcon('undo'), L.undo);
  const redoBtn = el('button', { type: 'button', class: 'ed-chip', aria: { label: L.redo }, onclick: () => redo() }, svgIcon('redo'));
  const zoomBtn = el('button', { type: 'button', class: 'ed-chip', aria: { label: L.zoom, pressed: 'false' }, onclick: () => { const z = pv.zoom > 1 ? 1 : 2; pv.setZoom(z); zoomBtn.setAttribute('aria-pressed', String(z > 1)); zoomBtn.setAttribute('aria-label', z > 1 ? L.unzoom : L.zoom); } }, svgIcon('zoom'));
  const countTag = el('span', { class: 'ed-note', aria: { live: 'polite' } });
  const undoRow = el('div', { class: 'ed-undo-row' }, el('div', { class: 'ed-row' }, undoBtn, redoBtn, zoomBtn), countTag);
  const hint = el('p', { class: 'ed-hint' });
  const fileIn = el('input', { type: 'file', class: 'ed-sr', accept: 'image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif', tabindex: '-1', aria: { hidden: 'true', label: L.tools.image } });
  stage.append(toolbar, undoRow);

  const pv = createPreview(stage, {
    lang, state, interactive: true, heightPhone: 0.72, heightDesktop: 0.78,
    swipeOk: ev => tool === 'select' && pv.zoom === 1 && !ev.target.closest('[data-id], .ed-hdl'),
    onPage: () => { select(null); },
    onRender(i) { geo = { W: i.W, H: i.H, scale: i.scale, index: i.index }; renderAll(); },
  });
  // toolbar above the page, hint + properties below
  stage.insertBefore(toolbar, pv.root);
  stage.insertBefore(undoRow, pv.root);
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'ed-shapes');
  svg.setAttribute('preserveAspectRatio', 'none');
  const htmlLayer = el('div', { class: 'ed-html' });
  const selBox = el('div', { class: 'ed-selbox', hidden: true });
  pv.layer.append(svg, htmlLayer, selBox);
  const props = el('div', { class: 'ed-props', hidden: true });
  pv.extra.append(hint, props, fileIn);

  // ---- state helpers
  const pageObjs = () => objs.filter(o => o.page === geo?.index);
  const byId = id => objs.find(o => o.id === id);
  function commit() {
    state.values.objs = objs;
    state.results?.clear?.();
    history = history.slice(0, hpos + 1);
    const snap = JSON.stringify(objs);
    if (snap !== history[hpos]) { history.push(snap); hpos++; }
    updateUndo();
  }
  function restore(snap) {
    objs = JSON.parse(snap);
    state.values.objs = objs;
    state.results?.clear?.();
    if (selId && !byId(selId)) selId = null;
    renderAll(); buildProps(); updateUndo();
  }
  function undo() { if (hpos > 0) { hpos--; restore(history[hpos]); ctx.announce?.(L.undo); } }
  function redo() { if (hpos < history.length - 1) { hpos++; restore(history[hpos]); ctx.announce?.(L.redo); } }
  function updateUndo() {
    undoBtn.disabled = hpos <= 0;
    redoBtn.disabled = hpos >= history.length - 1;
    countTag.textContent = objs.length ? L.count(objs.length) : L.none;
  }

  function setTool(id) {
    tool = id;
    for (const [k, b] of toolBtns) b.setAttribute('aria-pressed', String(k === id));
    stage.classList.toggle('is-drawing', DRAG_TOOLS.has(id));
    stage.classList.toggle('is-placing', !DRAG_TOOLS.has(id) && id !== 'select');
    hint.textContent = L.hints[id];
    if (id !== 'select') select(null);
    if (id === 'image') fileIn.click();
    if (id === 'replace') loadChars(geo?.index ?? 0);
  }

  async function loadChars(index) {
    if (charsCache.has(index)) return charsCache.get(index);
    const inp = input();
    if (!inp) return null;
    const p = (async () => {
      const doc = await inp.pdfjs();
      const page = await doc.getPage(index + 1);
      try { return (await pageChars(page, page.getViewport({ scale: 1 }))).chars; } finally { page.cleanup(); }
    })().catch(() => []);
    charsCache.set(index, p);
    return p;
  }

  // ---- rendering
  const S = v => v * geo.scale;
  function svgEl(tag, attrs) {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, String(v));
    return e;
  }
  function renderAll() {
    if (!geo) return;
    svg.setAttribute('viewBox', `0 0 ${geo.W} ${geo.H}`);
    while (svg.firstChild) svg.firstChild.remove();
    clear(htmlLayer);
    for (const o of pageObjs()) renderObj(o);
    placeSel();
  }
  function label(o) { return `${L.obj[o.type] || o.type}${o.type === 'text' && o.text ? ': ' + o.text.slice(0, 40) : ''}`; }
  function renderObj(o) {
    const sel = o.id === selId;
    const common = { 'data-id': o.id, class: 'ed-svgobj' + (sel ? ' is-sel' : '') };
    switch (o.type) {
      case 'text': {
        const d = el('div', { class: 'ed-obj ed-obj-text' + (sel ? ' is-sel' : '') + (o.text ? '' : ' is-empty'), dataset: { id: o.id }, role: 'button', tabindex: '0', aria: { label: label(o) } }, o.text || L.placeholder);
        d.style.left = S(o.x) + 'px';
        d.style.top = S(o.y) + 'px';
        d.style.fontSize = S(o.size) + 'px';
        // serif/typewriter text with characters beyond Western European ones is set in the sans face (lib/unifont.js)
        d.style.fontFamily = (needsUnicode(o.text) ? null : FONT_CSS[o.font]) || FONT_CSS.sans;
        d.style.fontWeight = o.bold ? '700' : '400';
        d.style.color = o.color;
        htmlLayer.append(d);
        measured.set(o.id, { w: d.offsetWidth / geo.scale, h: d.offsetHeight / geo.scale });
        break;
      }
      case 'image': {
        const im = images.get(o.img);
        const d = el('div', { class: 'ed-obj ed-obj-img' + (sel ? ' is-sel' : ''), dataset: { id: o.id }, role: 'button', tabindex: '0', aria: { label: label(o) } }, im ? el('img', { src: im.url, alt: '' }) : null);
        Object.assign(d.style, { left: S(o.x) + 'px', top: S(o.y) + 'px', width: S(o.w) + 'px', height: S(o.h) + 'px' });
        htmlLayer.append(d);
        break;
      }
      case 'rect': case 'cover':
        svg.append(svgEl('rect', { ...common, x: o.x, y: o.y, width: o.w, height: o.h, fill: o.type === 'cover' ? (o.color || '#ffffff') : (o.fill ? o.color : 'transparent'), 'fill-opacity': o.type === 'rect' && o.fill ? 0.35 : 1, stroke: o.type === 'cover' ? (sel ? '#4b3fd6' : '#c9c9d6') : o.color, 'stroke-width': o.type === 'cover' ? 0.8 : o.width, 'stroke-dasharray': o.type === 'cover' ? '3 2' : null, 'pointer-events': 'all' }));
        break;
      case 'ellipse':
        svg.append(svgEl('ellipse', { ...common, cx: o.x + o.w / 2, cy: o.y + o.h / 2, rx: o.w / 2, ry: o.h / 2, fill: o.fill ? o.color : 'transparent', 'fill-opacity': o.fill ? 0.35 : 1, stroke: o.color, 'stroke-width': o.width, 'pointer-events': 'all' }));
        break;
      case 'hl': {
        const g = svgEl('g', common);
        for (const r of o.rects) g.append(svgEl('rect', { x: r.x, y: r.y, width: r.w, height: r.h, fill: o.color, 'fill-opacity': 0.4, style: null, 'pointer-events': 'all' }));
        g.style.mixBlendMode = 'multiply';
        svg.append(g);
        break;
      }
      case 'line': case 'arrow': case 'pen': {
        const g = svgEl('g', common);
        let d;
        if (o.type === 'pen') d = penPath(o.points);
        else { const e = o.type === 'arrow' ? arrowShaftEnd(o) : [o.x2, o.y2]; d = `M${o.x1} ${o.y1} L${e[0]} ${e[1]}`; }
        g.append(svgEl('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(o.width, 22 / geo.scale), 'stroke-linecap': 'round', 'pointer-events': 'stroke' }));
        g.append(svgEl('path', { d, fill: 'none', stroke: o.color, 'stroke-width': o.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'pointer-events': 'none' }));
        if (o.type === 'arrow') g.append(svgEl('path', { d: arrowHead(o), fill: o.color, stroke: o.color, 'stroke-width': 0.5, 'pointer-events': 'all' }));
        svg.append(g);
        break;
      }
      case 'check': case 'cross': {
        const g = svgEl('g', common);
        g.append(svgEl('rect', { x: o.x, y: o.y, width: o.w, height: o.h, fill: 'transparent', 'pointer-events': 'all' }));
        g.append(svgEl('path', { d: markPath(o), fill: 'none', stroke: o.color, 'stroke-width': Math.max(1, Math.min(o.w, o.h) * 0.12), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'pointer-events': 'none' }));
        svg.append(g);
        break;
      }
      default:
    }
  }

  function bboxOf(o) {
    switch (o.type) {
      case 'text': { const m = measured.get(o.id) || { w: o.size * 3, h: o.size * 1.2 }; return { x: o.x, y: o.y, w: m.w, h: m.h }; }
      case 'line': case 'arrow': return { x: Math.min(o.x1, o.x2), y: Math.min(o.y1, o.y2), w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) };
      case 'pen': { const xs = o.points.map(p => p[0]), ys = o.points.map(p => p[1]); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
      case 'hl': { const xs = o.rects.flatMap(r => [r.x, r.x + r.w]), ys = o.rects.flatMap(r => [r.y, r.y + r.h]); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
      default: return { x: o.x, y: o.y, w: o.w, h: o.h };
    }
  }

  function handlesFor(o) {
    if (o.type === 'line' || o.type === 'arrow') return [['p1', o.x1, o.y1, L.end1], ['p2', o.x2, o.y2, L.end2]];
    if (o.type === 'pen' || (o.type === 'hl' && o.rects.length > 1)) return [];
    const b = bboxOf(o);
    if (o.type === 'text') return [['se', b.x + b.w, b.y + b.h, L.handle]];
    return [['nw', b.x, b.y], ['ne', b.x + b.w, b.y], ['sw', b.x, b.y + b.h], ['se', b.x + b.w, b.y + b.h]].map(h => [...h, L.handle]);
  }

  function placeSel() {
    clear(selBox);
    const o = selId && byId(selId);
    if (!o || !geo || o.page !== geo.index) { selBox.hidden = true; return; }
    selBox.hidden = false;
    const b = bboxOf(o);
    const pad = 4;
    Object.assign(selBox.style, { left: S(b.x) - pad + 'px', top: S(b.y) - pad + 'px', width: S(b.w) + 2 * pad + 'px', height: S(b.h) + 2 * pad + 'px' });
    for (const [h, x, y, name] of handlesFor(o)) {
      const btn = el('button', { type: 'button', class: 'ed-hdl', dataset: { h }, aria: { label: `${name} (${label(o)})` } });
      btn.style.left = S(x) - S(b.x) + pad + 'px';
      btn.style.top = S(y) - S(b.y) + pad + 'px';
      selBox.append(btn);
    }
  }

  function select(id) {
    selId = id;
    if (geo) renderAll();
    buildProps();
  }

  // ---- properties panel
  function swatches(cur, onPick, list = COLORS) {
    const row = el('div', { class: 'ed-swatches', role: 'group', aria: { label: L.color } });
    for (const c of list) {
      const b = el('button', { type: 'button', class: `ed-swatch c-${c.slice(1)}`, aria: { label: COLOR_NAMES[lang][c], pressed: String(c === cur) }, onclick: () => { onPick(c); for (const x of row.children) x.setAttribute('aria-pressed', String(x === b)); } });
      row.append(b);
    }
    return row;
  }
  function buildProps() {
    clear(props);
    const o = selId && byId(selId);
    if (!o) { props.hidden = true; return; }
    props.hidden = false;
    const upd = (fn, { push = true } = {}) => { fn(o); renderAll(); if (push) commit(); };
    props.append(el('p', { class: 'ed-label' }, `${L.sel}: ${L.obj[o.type]}`));
    if (o.type === 'text') {
      const warn = el('p', { class: 'ed-pv-warn', hidden: true, role: 'status' });
      const showWarn = () => { const w = lostWarning(lostOf(o.text)); warn.textContent = w ? w[lang] : ''; warn.hidden = !w; };
      const ta = el('textarea', { class: 'ed-ta', rows: '3', placeholder: L.placeholder, aria: { label: L.content },
        oninput: e => { o.text = e.target.value; renderAll(); showWarn(); }, onchange: () => commit() }, o.text);
      ta.value = o.text;
      const fontSel = el('select', { class: 'wt-input', aria: { label: L.font }, onchange: e => { style.text.font = e.target.value; upd(x => { x.font = e.target.value; }); } },
        ['sans', 'serif', 'mono'].map(f => el('option', { value: f, selected: o.font === f }, L.fonts[f])));
      const boldBtn = el('button', { type: 'button', class: 'ed-chip', aria: { pressed: String(!!o.bold), label: L.bold }, onclick: () => { style.text.bold = !o.bold; upd(x => { x.bold = !x.bold; }); boldBtn.setAttribute('aria-pressed', String(!!o.bold)); } }, svgIcon('bold'));
      const sizeOut = el('output', { class: 'ed-note' }, `${Math.round(o.size)} pt`);
      const size = el('input', { type: 'range', min: '6', max: '72', step: '1', value: String(Math.round(o.size)), aria: { label: L.size },
        oninput: e => { o.size = +e.target.value; style.text.size = o.size; sizeOut.textContent = `${o.size} pt`; renderAll(); }, onchange: () => commit() });
      props.append(ta, warn, el('div', { class: 'ed-props-row' }, fontSel, boldBtn, el('label', { class: 'ed-size' }, L.size, size, sizeOut)),
        swatches(o.color, c => { style.text.color = c; upd(x => { x.color = c; }); }, COLORS.filter(c => c !== '#ffe14d')));
      showWarn();
      if (!o.text) setTimeout(() => { ta.focus({ preventScroll: true }); ta.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 30);
    } else if (o.type === 'hl') {
      props.append(swatches(o.color, c => { style.hl.color = c; upd(x => { x.color = c; }); }, ['#ffe14d', '#138a36', '#1f4fd6', '#d0312d', '#f08c00']));
    } else if (o.type === 'cover') {
      props.append(swatches(o.color || '#ffffff', c => upd(x => { x.color = c; }), ['#ffffff', '#000000']), el('p', { class: 'ed-note' }, L.cover_note));
    } else if (o.type !== 'image') {
      const kind = o.type === 'pen' ? 'pen' : (o.type === 'check' || o.type === 'cross') ? 'mark' : 'shape';
      props.append(swatches(o.color, c => { style[kind].color = c; upd(x => { x.color = c; }); }, COLORS.filter(c => c !== '#ffffff')));
      if (o.width != null) {
        const out = el('output', { class: 'ed-note' }, `${o.width} pt`);
        const w = el('input', { type: 'range', min: '0.5', max: '12', step: '0.5', value: String(o.width), aria: { label: L.width },
          oninput: e => { o.width = +e.target.value; (style[kind] || {}).width = o.width; out.textContent = `${o.width} pt`; renderAll(); }, onchange: () => commit() });
        props.append(el('label', { class: 'ed-size' }, L.width, w, out));
      }
      if (o.type === 'rect' || o.type === 'ellipse') {
        const fb = el('button', { type: 'button', class: 'ed-chip', aria: { pressed: String(!!o.fill) }, onclick: () => { upd(x => { x.fill = !x.fill; }); fb.setAttribute('aria-pressed', String(!!o.fill)); } }, L.fill);
        props.append(fb);
      }
    }
    props.append(el('div', { class: 'ed-row' },
      el('button', { type: 'button', class: 'ed-chip', onclick: () => duplicate(o) }, svgIcon('copy'), L.dup),
      el('button', { type: 'button', class: 'ed-chip', onclick: () => remove(o) }, svgIcon('trash'), L.del)));
  }

  function remove(o) { objs = objs.filter(x => x !== o); state.values.objs = objs; selId = null; renderAll(); buildProps(); commit(); }
  function duplicate(o) {
    const c = JSON.parse(JSON.stringify(o));
    c.id = newId();
    move(c, 12, 12);
    objs.push(c); commit(); select(c.id);
  }
  function move(o, dx, dy) {
    if ('x' in o) { o.x += dx; o.y += dy; }
    if ('x1' in o) { o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy; }
    if (o.points) o.points = o.points.map(p => [p[0] + dx, p[1] + dy]);
    if (o.rects) o.rects = o.rects.map(r => ({ ...r, x: r.x + dx, y: r.y + dy }));
  }

  // ---- creating
  function add(o) {
    o.id = newId();
    o.page = geo.index;
    objs.push(o);
    commit();
    return o;
  }
  function addAt(t, x, y) {
    const s = style;
    if (t === 'text' || t === 'date') {
      const o = add({ type: 'text', x, y: y - s.text.size * 0.6, size: s.text.size, font: s.text.font, bold: s.text.bold, color: s.text.color, text: t === 'date' ? fmtDate(lang) : '' });
      setTool('select'); select(o.id);
    } else if (t === 'check' || t === 'cross') {
      const z = 18;
      const o = add({ type: t, x: x - z / 2, y: y - z / 2, w: z, h: z, color: s.mark.color });
      select(null); renderAll();
      ctx.announce?.(L.obj[t]);
      return o;
    } else if (t === 'replace') {
      replaceAt(x, y);
    }
    return null;
  }
  async function replaceAt(x, y) {
    const chars = await loadChars(geo.index);
    if (!chars || !chars.length) { hint.textContent = L.noText; return; }
    const i = nearestChar(chars, x, y);
    const c = chars[i];
    if (!c || x < c.x0 - 30 || x > c.x1 + 30 || y < c.y0 - 12 || y > c.y1 + 12) { hint.textContent = L.hints.replace; return; }
    // the run of characters on this line around the tapped one (stop at big gaps = columns)
    let a = i, b = i;
    while (a > 0 && chars[a - 1].line === c.line && chars[a].x0 - chars[a - 1].x1 < c.fh * 1.2) a--;
    while (b < chars.length - 1 && chars[b + 1].line === c.line && chars[b + 1].x0 - chars[b].x1 < c.fh * 1.2) b++;
    const boxes = boxesFor(chars, a, b);
    if (!boxes.length) return;
    const bx = { x0: Math.min(...boxes.map(r => r.x0)), y0: Math.min(...boxes.map(r => r.y0)), x1: Math.max(...boxes.map(r => r.x1)), y1: Math.max(...boxes.map(r => r.y1)) };
    const text = chars.slice(a, b + 1).map(ch => ch.ch).join('').replace(/\s+$/, '');
    const size = Math.max(5, Math.min(72, Math.round(c.fh * 10) / 10));
    const fam = /serif/i.test(c.family) && !/sans/i.test(c.family) ? 'serif' : /mono/i.test(c.family) ? 'mono' : 'sans';
    // baseline of the original text in the visual frame
    const baseY = c.y0 + (c.y1 - c.y0) * 0.8;
    const pad = 1.5;
    add({ type: 'cover', x: bx.x0 - pad, y: bx.y0 - pad, w: bx.x1 - bx.x0 + 2 * pad, h: bx.y1 - bx.y0 + 2 * pad, color: '#ffffff' });
    const o = add({ type: 'text', x: bx.x0, y: baseY - size * (BASELINE[fam] || BASELINE.sans), size, font: fam, bold: false, color: '#000000', text });
    setTool('select');
    select(o.id);
  }

  fileIn.addEventListener('change', async () => {
    const f = fileIn.files && fileIn.files[0];
    fileIn.value = '';
    if (!f || !geo) { setTool('select'); return; }
    const inp = await InputFile.from(f);
    try {
      const info = await inp.imageInfo();
      const swap = [5, 6, 7, 8].includes(info.orientation);
      const iw = swap ? info.height : info.width, ih = swap ? info.width : info.height;
      const id = newId();
      const bmpUrl = URL.createObjectURL(f);
      images.set(id, { input: inp, url: bmpUrl });
      const w = Math.min(geo.W * 0.4, iw * 0.75), h = w * ih / iw;
      const o = add({ type: 'image', img: id, x: (geo.W - w) / 2, y: (geo.H - h) / 2, w, h });
      state.values.imgs = [...images.keys()].join(',');
      setTool('select'); select(o.id);
    } catch {
      hint.textContent = lang === 'en' ? 'This image cannot be opened.' : 'Dieses Bild lässt sich nicht öffnen.';
      setTool('select');
    }
  });

  // ---- pointer handling
  const pagePt = ev => {
    const r = pv.page.getBoundingClientRect();
    return [(ev.clientX - r.left) / geo.scale, (ev.clientY - r.top) / geo.scale];
  };
  let act = null;
  pv.layer.addEventListener('pointerdown', async ev => {
    if (!geo || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    const [x, y] = pagePt(ev);
    const hdl = ev.target.closest('.ed-hdl');
    const hit = ev.target.closest('[data-id]');
    if (hdl && selId) {
      ev.preventDefault();
      act = { kind: 'resize', h: hdl.dataset.h, id: ev.pointerId, x, y, snap: JSON.stringify(byId(selId)), m: measured.get(selId) };
      pv.layer.setPointerCapture(ev.pointerId);
      return;
    }
    if (hit && (tool === 'check' || tool === 'cross') && byId(hit.dataset.id)?.type === tool) {
      // tapping a tick again removes it (handy when filling in forms)
      ev.preventDefault();
      act = null;
      remove(byId(hit.dataset.id));
      return;
    }
    if (hit && (tool === 'select' || !DRAG_TOOLS.has(tool) && tool !== 'check' && tool !== 'cross')) {
      ev.preventDefault();
      if (tool !== 'select') setTool('select');
      if (selId !== hit.dataset.id) select(hit.dataset.id);
      act = { kind: 'move', id: ev.pointerId, x, y, sx: ev.clientX, sy: ev.clientY, snap: JSON.stringify(byId(selId)), moved: false };
      pv.layer.setPointerCapture(ev.pointerId);
      return;
    }
    if (tool === 'select') { if (selId) select(null); return; }
    if (DRAG_TOOLS.has(tool)) {
      ev.preventDefault();
      pv.layer.setPointerCapture(ev.pointerId);
      act = { kind: 'draw', id: ev.pointerId, x, y, sx: ev.clientX, sy: ev.clientY, obj: null, chars: null, ci: -1 };
      if (tool === 'hl') {
        const chars = await loadChars(geo.index);
        const i = chars && chars.length ? nearestChar(chars, x, y) : -1;
        const c = i >= 0 ? chars[i] : null;
        if (c && x >= c.x0 - 4 && x <= c.x1 + 4 && y >= c.y0 - 4 && y <= c.y1 + 4 && act) { act.chars = chars; act.ci = i; }
      }
      return;
    }
    // tap tools: place on pointerup without movement
    act = { kind: 'tap', id: ev.pointerId, x, y, sx: ev.clientX, sy: ev.clientY };
  });
  pv.layer.addEventListener('pointermove', ev => {
    if (!act || ev.pointerId !== act.id || !geo) return;
    const [x, y] = pagePt(ev);
    const cx = Math.max(0, Math.min(geo.W, x)), cy = Math.max(0, Math.min(geo.H, y));
    if (act.kind === 'move') {
      if (!act.moved && Math.hypot(ev.clientX - act.sx, ev.clientY - act.sy) < 4) return;
      act.moved = true;
      const o = byId(selId);
      const base = JSON.parse(act.snap);
      Object.assign(o, base);
      move(o, x - act.x, y - act.y);
      renderAll();
    } else if (act.kind === 'resize') {
      resize(byId(selId), JSON.parse(act.snap), act.h, cx, cy, act.m);
      renderAll();
    } else if (act.kind === 'draw') {
      drawStep(act, cx, cy);
    }
  });
  const finish = ev => {
    if (!act || ev.pointerId !== act.id) return;
    const a = act;
    act = null;
    if (ev.type === 'pointercancel') { if (a.kind === 'draw' && a.obj) { objs = objs.filter(o => o !== a.obj); state.values.objs = objs; renderAll(); } return; }
    if (a.kind === 'move' || a.kind === 'resize') { if (a.kind === 'resize' || a.moved) commit(); buildProps(); return; }
    if (a.kind === 'tap') {
      if (Math.hypot(ev.clientX - a.sx, ev.clientY - a.sy) < 10) addAt(tool, a.x, a.y);
      return;
    }
    if (a.kind === 'draw') {
      const tiny = Math.hypot(ev.clientX - a.sx, ev.clientY - a.sy) < 8;
      if (!a.obj || tiny) {
        if (a.obj) objs = objs.filter(o => o !== a.obj);
        if (tool === 'pen') { if (!a.obj) { /* dot */ objs.push({ id: newId(), page: geo.index, type: 'pen', points: [[a.x, a.y]], color: style.pen.color, width: style.pen.width }); } else objs.push(a.obj); }
        else if (tool !== 'hl' || a.ci >= 0) {
          const o = defaultShape(tool, a.x, a.y, a.ci >= 0 ? a.chars : null, a.ci);
          if (o) objs.push(o);
        }
      }
      state.values.objs = objs;
      commit();
      renderAll();
      const last = objs[objs.length - 1];
      if (!STICKY_TOOLS.has(tool) && last) { setTool('select'); select(last.id); }
    }
  };
  // touch: dragging an item must not scroll the page (pointer events alone cannot stop scrolling)
  pv.layer.addEventListener('touchstart', ev => { if (ev.target.closest?.('[data-id], .ed-hdl')) ev.preventDefault(); }, { passive: false });
  pv.layer.addEventListener('pointerup', finish);
  pv.layer.addEventListener('pointercancel', finish);

  function defaultShape(t, x, y, chars, ci) {
    const id = newId(), page = geo.index;
    const sh = style.shape;
    switch (t) {
      case 'rect': return { id, page, type: 'rect', x: x - 40, y: y - 25, w: 80, h: 50, color: sh.color, width: sh.width, fill: false };
      case 'cover': return { id, page, type: 'cover', x: x - 50, y: y - 10, w: 100, h: 20, color: '#ffffff' };
      case 'ellipse': return { id, page, type: 'ellipse', x: x - 35, y: y - 35, w: 70, h: 70, color: sh.color, width: sh.width, fill: false };
      case 'line': return { id, page, type: 'line', x1: x - 40, y1: y, x2: x + 40, y2: y, color: sh.color, width: sh.width };
      case 'arrow': return { id, page, type: 'arrow', x1: x - 50, y1: y + 30, x2: x, y2: y, color: sh.color, width: sh.width };
      case 'hl': {
        if (!chars) return null;
        // a tap highlights the word under the finger
        let a = ci, b = ci;
        while (a > 0 && chars[a - 1].line === chars[ci].line && chars[a - 1].ch.trim()) a--;
        while (b < chars.length - 1 && chars[b + 1].line === chars[ci].line && chars[b + 1].ch.trim()) b++;
        const rects = boxesFor(chars, a, b).map(r => ({ x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 }));
        return rects.length ? { id, page, type: 'hl', rects, color: style.hl.color } : null;
      }
      default: return null;
    }
  }

  function drawStep(a, x, y) {
    const page = geo.index, sh = style.shape;
    if (!a.obj) {
      const base = { id: newId(), page };
      if (tool === 'pen') a.obj = { ...base, type: 'pen', points: [[a.x, a.y]], color: style.pen.color, width: style.pen.width };
      else if (tool === 'line' || tool === 'arrow') a.obj = { ...base, type: tool, x1: a.x, y1: a.y, x2: x, y2: y, color: sh.color, width: sh.width };
      else if (tool === 'hl') a.obj = { ...base, type: 'hl', rects: [], color: style.hl.color };
      else a.obj = { ...base, type: tool, x: a.x, y: a.y, w: 0, h: 0, color: tool === 'cover' ? '#ffffff' : sh.color, width: sh.width, fill: false };
      objs.push(a.obj);
    }
    const o = a.obj;
    if (o.type === 'pen') { const l = o.points[o.points.length - 1]; if (Math.hypot(x - l[0], y - l[1]) > 0.8) o.points.push([n2(x), n2(y)]); }
    else if (o.type === 'line' || o.type === 'arrow') { o.x2 = x; o.y2 = y; }
    else if (o.type === 'hl') {
      if (a.chars) {
        const j = nearestChar(a.chars, x, y);
        o.rects = boxesFor(a.chars, a.ci, j).map(r => ({ x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 }));
      } else o.rects = [{ x: Math.min(a.x, x), y: Math.min(a.y, y), w: Math.abs(x - a.x), h: Math.abs(y - a.y) }];
    } else { o.x = Math.min(a.x, x); o.y = Math.min(a.y, y); o.w = Math.abs(x - a.x); o.h = Math.abs(y - a.y); }
    renderAll();
  }

  function resize(o, base, h, x, y, m) {
    Object.assign(o, base);
    if (h === 'p1') { o.x1 = x; o.y1 = y; return; }
    if (h === 'p2') { o.x2 = x; o.y2 = y; return; }
    if (o.type === 'text') {
      const w0 = (m && m.w) || base.size * 3;
      const k = Math.max(0.2, (x - base.x) / w0);
      o.size = Math.max(5, Math.min(144, Math.round(base.size * k * 2) / 2));
      return;
    }
    const b = bboxOf(base);
    let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
    if (h.includes('w')) x0 = Math.min(x, x1 - 4); else x1 = Math.max(x, x0 + 4);
    if (h.includes('n')) y0 = Math.min(y, y1 - 4); else y1 = Math.max(y, y0 + 4);
    if (o.type === 'image') { // keep the aspect ratio
      const ar = b.h / b.w;
      const w = x1 - x0;
      if (h.includes('n')) y0 = y1 - w * ar; else y1 = y0 + w * ar;
    }
    if (o.type === 'hl') { o.rects = [{ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }]; return; }
    o.x = x0; o.y = y0; o.w = x1 - x0; o.h = y1 - y0;
  }

  // keyboard: move/delete the selected item
  pv.layer.addEventListener('keydown', ev => {
    const o = selId && byId(selId);
    if (!o) return;
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
    if (d) { ev.preventDefault(); ev.stopPropagation(); const k = ev.shiftKey ? 10 : 1; move(o, d[0] * k, d[1] * k); renderAll(); commit(); pv.layer.querySelector(`[data-id="${o.id}"]`)?.focus?.(); }
    else if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); remove(o); }
    else if (ev.key === 'Escape') select(null);
  });
  pv.layer.addEventListener('focusin', ev => { const id = ev.target.closest?.('[data-id]')?.dataset.id; if (id && id !== selId) { selId = id; placeSel(); buildProps(); } });
  document.addEventListener('keydown', ev => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.key.toLowerCase() !== 'z' || /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target?.tagName || '') || stage.hidden) return;
    ev.preventDefault();
    if (ev.shiftKey) redo(); else undo();
  });

  setTool('select');
  updateUndo();
  return {
    pv,
    reset() { objs = []; state.values.objs = objs; history = ['[]']; hpos = 0; selId = null; charsCache.clear(); pv.reset(); updateUndo(); buildProps(); },
  };
}

export default {
  options: [
    { id: 'objs', type: 'text', default: '', when: () => false, label: 'objects' },
    { id: 'imgs', type: 'text', default: '', when: () => false, label: 'images' },
  ],

  mountStage(stage, state, ctx) { preloadUniFont(); ed = mountEditor(stage, state, ctx); },

  onInputs() { ed?.reset(); },

  async run(inputs, opts, ctx) {
    const objs = Array.isArray(opts.objs) ? opts.objs.filter(o => !(o.type === 'text' && !String(o.text || '').trim())) : [];
    if (!objs.length) throw userError('Du hast noch nichts eingefügt. Wähle oben ein Werkzeug, z. B. „Text“, und tippe auf die Seite.', 'You haven’t added anything yet. Pick a tool above, e.g. “Text”, and tap the page.');
    const PDFLib = await loadPdfLib();
    const outputs = [];
    for (const input of inputs) {
      ctx.progress(0, { de: 'PDF wird geöffnet …', en: 'Opening PDF …' });
      const doc = await input.pdfDoc();
      const r = await burn(doc, PDFLib, objs, { tick: async (i, n) => { ctx.progress(i / n * 0.9, { de: `Seite ${i} von ${n}`, en: `Page ${i} of ${n}` }); await ctx.tick(); } });
      const w = lostWarning(r.lost);
      if (w) ctx.note(w);
      if (objs.some(o => o.type === 'cover')) ctx.note(T[ctx.lang === 'en' ? 'en' : 'de'].cover_note);
      ctx.progress(0.95, { de: 'Wird gespeichert …', en: 'Saving …' });
      await ctx.tick();
      const bytes = await saveResult(doc, ctx);
      outputs.push({ name: ctx.fileName(input.name, ctx.lang === 'en' ? ' (edited)' : ' (bearbeitet)', 'pdf'), blob: new Blob([bytes], { type: 'application/pdf' }), pages: doc.getPageCount(),
        note: { de: `${objs.length} Änderung(en) auf ${r.pages} Seite(n)`, en: `${objs.length} change(s) on ${r.pages} page(s)` } });
    }
    return { outputs };
  },
};
void LANG;
