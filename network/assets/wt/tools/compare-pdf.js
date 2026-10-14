// Tool: compare two PDFs. Word-level text diff (side by side on wide screens, merged with change
// navigation on phones), a visual pixel overlay per page (red = only in the first file, green = only in
// the second) and summary counts – all shown live in the stage. The main button saves a comparison
// report as PDF (summary, list of changes, visual difference pages).
import { el, clear } from '../lib/dom.js';
import { loadPdfLib, saveDoc, canvasToBlob } from '../lib/pdf.js';
import { ensureCss, tr, ic, btn, userError, statusLine, pageNav, wipeCanvas, stageWidth, renderPage, pdfBlob, watchUnlock, winAnsiSafe } from '../lib/sec-ui.js';
import { diffTokens } from '../lib/sec-diff.js';
import { wrapText } from '../lib/sec-draw.js';

const RED = [224, 49, 49], GREEN = [47, 158, 68], AMBER = [240, 140, 0];
let D = null; // {key, A, B, ops, changes, stats}

async function words(pdf, onPage) {
  const toks = [], pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    let text = '';
    for (const it of tc.items) { if (typeof it.str === 'string') text += it.str + (it.hasEOL ? '\n' : ' '); }
    for (const w of text.split(/\s+/)) if (w) { toks.push(w); pages.push(p); }
    page.cleanup();
    onPage?.(p, pdf.numPages);
    if (p % 5 === 0) await new Promise(r => setTimeout(r, 0));
  }
  return { toks, pages, numPages: pdf.numPages };
}

function buildChanges(ops, A, B) {
  const changes = [];
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    if (o.type === 'eq') continue;
    const prev = changes[changes.length - 1];
    if (prev && prev.end === i - 1) { // del followed by ins → replace
      prev.ops.push(i); prev.end = i;
      if (o.type === 'ins') { prev.b = B.toks.slice(o.b0, o.b1).join(' '); prev.pageB = B.pages[o.b0]; }
      else { prev.a = A.toks.slice(o.a0, o.a1).join(' '); prev.pageA = A.pages[o.a0]; }
      prev.type = 'replace';
      continue;
    }
    changes.push({ type: o.type, ops: [i], end: i,
      a: o.type === 'del' ? A.toks.slice(o.a0, o.a1).join(' ') : '', b: o.type === 'ins' ? B.toks.slice(o.b0, o.b1).join(' ') : '',
      pageA: A.pages[Math.min(o.a0, A.pages.length - 1)] || A.numPages, pageB: B.pages[Math.min(o.b0, B.pages.length - 1)] || B.numPages });
  }
  return changes;
}

async function compute(inputs, onProgress) {
  const [ia, ib] = inputs;
  const key = `${ia.id}|${ib.id}`;
  if (D && D.key === key) return D;
  const [pa, pb] = [await ia.pdfjs(), await ib.pdfjs()];
  const A = await words(pa, (p, n) => onProgress?.(0.45 * p / n));
  const B = await words(pb, (p, n) => onProgress?.(0.45 + 0.45 * p / n));
  const ops = diffTokens(A.toks, B.toks);
  const changes = buildChanges(ops, A, B);
  let ins = 0, del = 0;
  for (const o of ops) { if (o.type === 'ins') ins += o.b1 - o.b0; else if (o.type === 'del') del += o.a1 - o.a0; }
  D = { key, A, B, pa, pb, ops, changes, stats: { ins, del, changes: changes.length }, visual: new Map() };
  onProgress?.(1);
  return D;
}

/** Pixel overlay of page n of both files at width w (CSS px × dpr). Returns {canvas, diff (0..1)}. */
async function visualDiff(n, width) {
  const get = async (pdf, k) => (k <= pdf.numPages ? renderPage(await pdf.getPage(k), { width, forms: true }) : null);
  const ca = await get(D.pa, n), cb = await get(D.pb, n);
  const W = Math.max(ca?.width || 0, cb?.width || 0), H = Math.max(ca?.height || 0, cb?.height || 0);
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const g = out.getContext('2d');
  const read = c => { if (!c) return null; const x = document.createElement('canvas'); x.width = W; x.height = H; const xg = x.getContext('2d'); xg.fillStyle = '#fff'; xg.fillRect(0, 0, W, H); xg.drawImage(c, 0, 0); const d = xg.getImageData(0, 0, W, H).data; wipeCanvas(x); return d; };
  const da = read(ca), db = read(cb);
  wipeCanvas(ca); wipeCanvas(cb);
  const img = g.createImageData(W, H);
  const o = img.data;
  let changed = 0;
  for (let i = 0; i < o.length; i += 4) {
    const la = da ? da[i] * 0.299 + da[i + 1] * 0.587 + da[i + 2] * 0.114 : 255;
    const lb = db ? db[i] * 0.299 + db[i + 1] * 0.587 + db[i + 2] * 0.114 : 255;
    const dc = da && db ? Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2])) : Math.abs(la - lb);
    if (dc > 48) {
      const c = Math.abs(la - lb) < 24 ? AMBER : la < lb ? RED : GREEN;
      o[i] = c[0]; o[i + 1] = c[1]; o[i + 2] = c[2]; o[i + 3] = 255;
      changed++;
    } else {
      const v = 255 - (255 - Math.min(la, lb)) * 0.28; // faded common content
      o[i] = o[i + 1] = o[i + 2] = v; o[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return { canvas: out, diff: changed / (W * H || 1), onlyA: !cb, onlyB: !ca };
}

export default {
  options: [
    {
      id: 'visual', type: 'toggle', default: true,
      label: { de: 'Bildvergleich in den Bericht aufnehmen', en: 'Include the visual comparison in the report' },
      hint: { de: 'Für jede Seite mit Unterschieden eine Seite mit roten und grünen Markierungen.', en: 'For every page with differences, a page with red and green marks.' },
    },
  ],

  mountStage(stage, state, ctx) {
    ensureCss();
    stage.classList.add('sec-stage');
    this._stage = stage; this._state = state; this._lang = ctx.lang;
    watchUnlock(stage, state, inputs => this.onInputs(inputs));
    this.onInputs(state.inputs.filter(i => !i.error && !i.locked));
  },

  async onInputs(inputs) {
    const stage = this._stage;
    if (!stage) return;
    const L = this._lang;
    const ready = inputs.filter(i => !i.locked && i.kind === 'pdf');
    if (ready.length < 2) {
      clear(stage).append(el('p', { class: 'sec-info' }, ic('columns'), ready.length ? tr(L, 'Wähle noch eine zweite PDF, um sie mit der ersten zu vergleichen.', 'Choose a second PDF to compare with the first.')
        : tr(L, 'Wähle zwei PDFs aus – zum Beispiel die alte und die neue Fassung eines Vertrags.', 'Choose two PDFs – for example the old and the new version of a contract.')));
      return;
    }
    const pair = ready.slice(0, 2);
    const key = `${pair[0].id}|${pair[1].id}`;
    if (this._key === key) return;
    this._key = key;
    const status = el('p', { class: 'sec-status', role: 'status' }, tr(L, 'Texte werden verglichen …', 'Comparing the texts …'));
    clear(stage).append(status);
    try {
      await new Promise(r => setTimeout(r, 0));
      await compute(pair, f => { status.textContent = tr(L, `Texte werden verglichen … ${Math.round(f * 100)} %`, `Comparing the texts … ${Math.round(f * 100)} %`); });
    } catch (err) { console.warn(err); this._key = null; clear(stage); return; }
    if (this._key !== key) return;
    render(stage, L, pair);
  },

  async run(inputs, opts, ctx) {
    if (inputs.length < 2) throw userError('Wähle zwei PDFs zum Vergleichen aus.', 'Choose two PDFs to compare.');
    const pair = inputs.slice(0, 2);
    ctx.progress(0.02, { de: 'Texte werden verglichen …', en: 'Comparing the texts …' });
    await compute(pair, f => ctx.progress(0.3 * f, { de: 'Texte werden verglichen …', en: 'Comparing the texts …' }));
    const PDFLib = await loadPdfLib();
    const { rgb, StandardFonts } = PDFLib;
    const doc = await PDFLib.PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const A4 = [595.28, 841.89], M = 48;
    let page = doc.addPage(A4), y = A4[1] - M;
    const L = ctx.lang;
    const T = (de, en) => (L === 'de' ? de : en);
    const line = (text, { f = font, size = 10.5, color = rgb(0.1, 0.1, 0.18), indent = 0, gap = 1.35 } = {}) => {
      for (const ln of wrapText(f, winAnsiSafe(f, text).text, size, A4[0] - 2 * M - indent)) {
        if (y < M + size) { page = doc.addPage(A4); y = A4[1] - M; }
        page.drawText(ln, { x: M + indent, y: y - size, size, font: f, color });
        y -= size * gap;
      }
    };
    const s = D.stats;
    line(T('Vergleichsbericht', 'Comparison report'), { f: bold, size: 20 });
    y -= 6;
    line(`${T('Erste Datei (alt)', 'First file (old)')}: ${pair[0].name} · ${D.A.numPages} ${T('Seiten', 'pages')}`);
    line(`${T('Zweite Datei (neu)', 'Second file (new)')}: ${pair[1].name} · ${D.B.numPages} ${T('Seiten', 'pages')}`);
    line(`${T('Erstellt', 'Created')}: ${new Date().toLocaleString(L === 'de' ? 'de-DE' : 'en-GB')} · FaLe Werkzeuge`, { color: rgb(0.4, 0.4, 0.5), size: 9 });
    y -= 8;
    line(T(`${s.changes} Änderungen · ${s.ins} Wörter eingefügt · ${s.del} Wörter gelöscht`, `${s.changes} changes · ${s.ins} words inserted · ${s.del} words deleted`), { f: bold, size: 12 });
    y -= 10;
    if (!s.changes) line(T('Der Text beider Dateien ist identisch.', 'The text of both files is identical.'));
    D.changes.forEach((c, i) => {
      if (y < M + 60) { page = doc.addPage(A4); y = A4[1] - M; }
      const where = c.type === 'ins' ? `${T('Seite', 'Page')} ${c.pageB} (${T('neu', 'new')})` : c.type === 'del' ? `${T('Seite', 'Page')} ${c.pageA} (${T('alt', 'old')})` : `${T('Seite', 'Page')} ${c.pageA} → ${c.pageB}`;
      const kind = { ins: T('Eingefügt', 'Inserted'), del: T('Gelöscht', 'Deleted'), replace: T('Geändert', 'Changed') }[c.type];
      line(`${i + 1}. ${kind} · ${where}`, { f: bold, size: 10.5 });
      if (c.a) line(`– ${c.a.slice(0, 1500)}`, { color: rgb(0.75, 0.12, 0.12), indent: 12 });
      if (c.b) line(`+ ${c.b.slice(0, 1500)}`, { color: rgb(0.1, 0.5, 0.2), indent: 12 });
      y -= 6;
    });
    if (opts.visual) {
      const n = Math.max(D.A.numPages, D.B.numPages);
      for (let p = 1; p <= n; p++) {
        ctx.progress(0.35 + 0.6 * (p / n), { de: `Bildvergleich Seite ${p} von ${n}`, en: `Visual comparison page ${p} of ${n}` });
        const r = await visualDiff(p, 900);
        if (r.diff < 0.00002) { wipeCanvas(r.canvas); await ctx.tick(); continue; }
        const blob = await canvasToBlob(r.canvas, 'image/jpeg', 0.85);
        const ratio = r.canvas.height / r.canvas.width;
        wipeCanvas(r.canvas);
        const img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
        const pg = doc.addPage(A4);
        pg.drawText(winAnsiSafe(bold, T(`Seite ${p}: rot = nur in der ersten Datei, grün = nur in der zweiten, orange = Farbe geändert`, `Page ${p}: red = only in the first file, green = only in the second, orange = colour changed`)).text, { x: M, y: A4[1] - M + 10, size: 11, font: bold });
        const maxW = A4[0] - 2 * M, maxH = A4[1] - 2 * M - 20;
        const w = Math.min(maxW, maxH / ratio), h = w * ratio;
        pg.drawImage(img, { x: (A4[0] - w) / 2, y: A4[1] - M - 14 - h, width: w, height: h });
        await ctx.tick();
      }
    }
    const bytes = await saveDoc(doc, { title: T('Vergleichsbericht', 'Comparison report') });
    const base = pair[0].name.replace(/\.pdf$/i, '');
    return { outputs: [{ name: ctx.safeFileName(`${base} – ${T('Vergleich', 'comparison')}.pdf`), blob: pdfBlob(bytes), pages: doc.getPageCount(),
      note: ctx.t({ de: `${s.changes} Änderungen`, en: `${s.changes} changes` }) }] };
  },
};

// ---------------------------------------------------------------- UI
function render(stage, L, pair) {
  const s = D.stats;
  const sum = el('div', { class: 'sec-sum' },
    el('div', {}, el('strong', {}, String(s.changes)), el('span', {}, tr(L, 'Änderungen', 'Changes'))),
    el('div', { class: 'is-ins' }, el('strong', {}, String(s.ins)), el('span', {}, tr(L, 'Wörter eingefügt', 'Words inserted'))),
    el('div', { class: 'is-del' }, el('strong', {}, String(s.del)), el('span', {}, tr(L, 'Wörter gelöscht', 'Words deleted'))));
  const names = el('p', { class: 'sec-small' }, tr(L, `Alt: ${pair[0].name} · Neu: ${pair[1].name} (Reihenfolge oben mit den Pfeilen tauschen)`, `Old: ${pair[0].name} · New: ${pair[1].name} (swap the order above with the arrows)`));
  const wide = window.matchMedia?.('(min-width: 900px)').matches;
  let view = wide ? 'side' : 'inline';
  const seg = el('div', { class: 'sec-seg', role: 'group', aria: { label: tr(L, 'Ansicht', 'View') } });
  const views = [['inline', 'list', tr(L, 'Zusammen', 'Merged')], ['side', 'columns', tr(L, 'Spalten', 'Columns')], ['visual', 'layers', tr(L, 'Bild', 'Visual')]];
  const segBtns = views.map(([id, icn, label]) => {
    const b = el('button', { type: 'button', aria: { pressed: String(id === view) } }, ic(icn), label);
    b.addEventListener('click', () => { view = id; segBtns.forEach((x, k) => x.setAttribute('aria-pressed', String(views[k][0] === id))); show(); });
    return b;
  });
  seg.append(...segBtns);
  const body = el('div', { class: 'sec-diff' });
  // change navigation
  let cur = -1;
  const counter = el('span', { aria: { live: 'polite' } });
  const prev = btn('prev', '', () => go(cur - 1), { cls: 'wt-icon-btn', label: tr(L, 'Vorherige Änderung', 'Previous change') });
  const next = btn('next', '', () => go(cur + 1), { cls: 'wt-icon-btn', label: tr(L, 'Nächste Änderung', 'Next change') });
  const navBar = el('div', { class: 'sec-changenav' }, prev, counter, next);
  let targets = [];
  function go(k) {
    if (!targets.length) return;
    cur = Math.max(0, Math.min(targets.length - 1, k));
    body.querySelectorAll('.is-cur').forEach(x => x.classList.remove('is-cur'));
    for (const t of targets[cur]) t.classList.add('is-cur');
    targets[cur][0].scrollIntoView({ block: 'center', behavior: 'smooth' });
    updateCounter();
  }
  function updateCounter() {
    counter.textContent = targets.length ? tr(L, `Änderung ${Math.max(cur, 0) + 1} von ${targets.length}`, `Change ${Math.max(cur, 0) + 1} of ${targets.length}`) : tr(L, 'Keine Änderungen', 'No changes');
    prev.disabled = cur <= 0; next.disabled = cur >= targets.length - 1;
  }

  const KEEP = 14; // words shown around changes in long unchanged runs
  function textView(side) {
    const cols = side ? [el('div', { class: 'sec-diff-col' }, el('h4', {}, tr(L, 'Alt', 'Old') + ' · ' + pair[0].name)), el('div', { class: 'sec-diff-col' }, el('h4', {}, tr(L, 'Neu', 'New') + ' · ' + pair[1].name))]
      : [el('div', { class: 'sec-diff-col' })];
    const paras = cols.map(c => { const p = el('p', { class: 'sec-diff-text' }); c.append(p); return p; });
    const lastPage = [0, 0];
    const changeOf = new Map();
    D.changes.forEach((c, k) => c.ops.forEach(i => changeOf.set(i, k)));
    targets = D.changes.map(() => []);
    const pageMark = (col, p) => { if (lastPage[col] !== p) { lastPage[col] = p; paras[col].append(el('span', { class: 'sec-pageh' }, tr(L, `Seite ${p}`, `Page ${p}`))); } };
    D.ops.forEach((o, i) => {
      if (o.type === 'eq') {
        const n = o.a1 - o.a0;
        const write = (col, from, to, pages, toks) => {
          if (to - from > KEEP * 2 + 6 && D.ops.length > 1) {
            const head = i > 0 ? KEEP : 0, tail = i < D.ops.length - 1 ? KEEP : 0;
            for (let t = from; t < from + head; t++) { pageMark(col, pages[t]); paras[col].append(toks[t] + ' '); }
            paras[col].append(el('span', { class: 'sec-ro' }, tr(L, ` … ${to - from - head - tail} Wörter unverändert … `, ` … ${to - from - head - tail} words unchanged … `)));
            for (let t = to - tail; t < to; t++) { pageMark(col, pages[t]); paras[col].append(toks[t] + ' '); }
          } else for (let t = from; t < to; t++) { pageMark(col, pages[t]); paras[col].append(toks[t] + ' '); }
        };
        if (side) { write(0, o.a0, o.a1, D.A.pages, D.A.toks); write(1, o.b0, o.b1, D.B.pages, D.B.toks); }
        else write(0, o.b0, o.b1, D.B.pages, D.B.toks);
        void n;
        return;
      }
      const k = changeOf.get(i);
      if (o.type === 'del') {
        const col = 0;
        pageMark(col, D.A.pages[o.a0]);
        const d = el('del', {}, D.A.toks.slice(o.a0, o.a1).join(' '));
        paras[col].append(d, ' ');
        targets[k].push(d);
      } else {
        const col = side ? 1 : 0;
        pageMark(col, D.B.pages[o.b0]);
        const d = el('ins', {}, D.B.toks.slice(o.b0, o.b1).join(' '));
        paras[col].append(d, ' ');
        targets[k].push(d);
      }
    });
    targets = targets.filter(t => t.length);
    return el('div', { class: 'sec-diff-cols' + (side ? ' is-side' : '') }, cols);
  }

  // visual view
  const vnav = pageNav(L, p => drawVisual(p));
  const vbox = el('div', { class: 'sec-visual' });
  const vinfo = el('p', { class: 'sec-small', aria: { live: 'polite' } });
  let vcanvas = null, vseq = 0;
  async function drawVisual(p) {
    const my = ++vseq;
    vinfo.textContent = tr(L, 'Wird berechnet …', 'Calculating …');
    const r = await visualDiff(p, Math.min(1400, stageWidth(stage, 900) * Math.min(2, window.devicePixelRatio || 1)));
    if (my !== vseq) { wipeCanvas(r.canvas); return; }
    if (vcanvas) wipeCanvas(vcanvas);
    vcanvas = r.canvas;
    r.canvas.setAttribute('role', 'img');
    r.canvas.setAttribute('aria-label', tr(L, `Bildvergleich Seite ${p}`, `Visual comparison page ${p}`));
    clear(vbox).append(r.canvas);
    const pct = r.diff * 100;
    vinfo.textContent = r.onlyA ? tr(L, 'Diese Seite gibt es nur in der ersten Datei.', 'This page exists only in the first file.')
      : r.onlyB ? tr(L, 'Diese Seite gibt es nur in der zweiten Datei.', 'This page exists only in the second file.')
        : pct < 0.002 ? tr(L, 'Keine sichtbaren Unterschiede auf dieser Seite.', 'No visible differences on this page.')
          : tr(L, `${pct < 0.1 ? '< 0,1' : pct.toFixed(1).replace('.', L === 'de' ? ',' : '.')} % der Fläche unterscheiden sich.`, `${pct < 0.1 ? '< 0.1' : pct.toFixed(1)} % of the area differs.`);
  }
  const legend = el('p', { class: 'sec-legend' }, el('span', {}, el('i', { class: 'l-a' }), tr(L, 'nur in der ersten Datei', 'only in the first file')),
    el('span', {}, el('i', { class: 'l-b' }), tr(L, 'nur in der zweiten Datei', 'only in the second file')), el('span', {}, el('i', { class: 'l-chg' }), tr(L, 'Farbe geändert', 'colour changed')), el('span', {}, el('i', { class: 'l-same' }), tr(L, 'gleich', 'same')));

  function show() {
    if (vcanvas) { wipeCanvas(vcanvas); vcanvas = null; }
    cur = -1;
    if (view === 'visual') {
      vnav.set(1, Math.max(D.A.numPages, D.B.numPages));
      clear(body).append(legend, vnav.node, vinfo, vbox);
      navBar.hidden = true;
      drawVisual(1);
    } else {
      clear(body).append(textView(view === 'side'));
      navBar.hidden = !targets.length;
      updateCounter();
    }
  }
  const pageInfo = D.A.numPages !== D.B.numPages ? el('p', { class: 'sec-info is-warn' }, ic('alert'), tr(L, `Die Dateien haben unterschiedlich viele Seiten (${D.A.numPages} und ${D.B.numPages}).`, `The files have a different number of pages (${D.A.numPages} and ${D.B.numPages}).`)) : null;
  const noText = !D.A.toks.length || !D.B.toks.length ? el('p', { class: 'sec-info is-warn' }, ic('alert'), tr(L, 'Mindestens eine Datei enthält keinen Text (z. B. ein Scan). Nutze den Bildvergleich.', 'At least one file has no text (a scan, for example). Use the visual comparison.')) : null;
  clear(stage).append(el('div', { class: 'sec-card' }, el('h3', { class: 'sec-h' }, ic('columns'), tr(L, 'Ergebnis des Vergleichs', 'Comparison result')), sum, names, pageInfo, noText, seg, body, navBar));
  if (noText) { view = 'visual'; segBtns.forEach((x, k) => x.setAttribute('aria-pressed', String(views[k][0] === 'visual'))); }
  show();
}
