// Tool: remove blank pages – every page is rendered small and its ink coverage measured (page edges and
// isolated specks from scanners are ignored). Pages below the threshold are marked in the grid; the user
// checks/changes the marks before anything is removed.
import { loadPdfLib, renderPage } from '../lib/pdf.js';
import { el } from '../lib/dom.js';
import { formatPages } from '../lib/ranges.js';
import { PageStage, rearrange, saveLike, pdfBlob, userError } from '../lib/org-common.js';

const W = 200; // analysis width in px
let stage = null;
let values = null;
let scan = null; // { input, gray: [{w, h, data}], cover: number[], done, promise, overrides: Map }

/** Share of "ink" pixels inside the page minus `edge` % on every side, isolated specks ignored. */
export function coverage(g, edge) {
  const { w, h, data } = g;
  const mx = Math.floor(w * edge / 100), my = Math.floor(h * edge / 100);
  const x0 = mx, x1 = w - mx, y0 = my, y1 = h - my;
  if (x1 - x0 < 4 || y1 - y0 < 4) return 0;
  // paper level: 90th percentile of the inner area (works for white paper and greyish scans)
  const hist = new Uint32Array(256);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hist[data[y * w + x]]++;
  const total = (x1 - x0) * (y1 - y0);
  let acc = 0, paper = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.9) { paper = v; break; } }
  const limit = Math.max(40, paper - 70);
  const ink = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (data[y * w + x] < limit) ink[y * w + x] = 1;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      if (!ink[i]) continue;
      // keep a pixel only when a neighbour is ink as well (single specks = scanner noise)
      let nb = 0;
      for (let dy = -1; dy <= 1 && !nb; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx >= x0 && xx < x1 && yy >= y0 && yy < y1 && ink[yy * w + xx]) { nb = 1; break; }
      }
      count += nb;
    }
  }
  return count / total * 100;
}

function grayOf(canvas) {
  const c = canvas.getContext('2d', { willReadFrequently: true });
  const { data } = c.getImageData(0, 0, canvas.width, canvas.height);
  const out = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) out[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  return { w: canvas.width, h: canvas.height, data: out };
}

function analyse(input) {
  const s = { input, gray: [], cover: [], done: 0, overrides: new Map(), n: 0 };
  s.promise = (async () => {
    const pdf = await input.pdfjs();
    s.n = pdf.numPages;
    for (let p = 0; p < s.n; p++) {
      if (scan !== s) return;
      const page = await pdf.getPage(p + 1);
      const vp = page.getViewport({ scale: 1 });
      const canvas = await renderPage(page, { width: vp.width > vp.height ? W * 1.3 : W });
      page.cleanup?.();
      s.gray[p] = grayOf(canvas);
      s.cover[p] = coverage(s.gray[p], values.edge);
      if (stage?.input === input) stage.thumbs.put({ f: input.id, p }, canvas, [vp.width, vp.height]).then(() => canvas.width = canvas.height = 0).catch(() => {});
      s.done = p + 1;
      if (p % 4 === 3 || p === s.n - 1) apply();
      await new Promise(r => setTimeout(r, 0));
    }
  })();
  return s;
}

const fmt = (v, lang) => `${(Math.round(v * 100) / 100).toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB', { maximumFractionDigits: 2 })} %`;

/** Recompute the marks (threshold + manual changes) and the info line. */
function apply() {
  if (!stage?.input || !scan) return;
  const de = stage.lang === 'de';
  const marked = [];
  const ids = [];
  stage.items.forEach((it, p) => {
    const c = scan.cover[p];
    if (c == null) return;
    const auto = c <= values.threshold;
    const on = scan.overrides.has(it.id) ? scan.overrides.get(it.id) : auto;
    if (on) { marked.push(p); ids.push(it.id); }
  });
  stage.grid.setSelected(ids);
  values.remove = formatPages(marked);
  const n = stage.items.length;
  const busy = scan.done < n;
  stage.meter.style.width = `${Math.round(scan.done / Math.max(1, n) * 100)}%`;
  stage.meterBox.hidden = !busy;
  stage.tb.bar.classList.toggle('is-active', marked.length > 0);
  stage.info([
    busy ? (de ? `Seiten werden geprüft … ${scan.done} von ${n}` : `Checking pages … ${scan.done} of ${n}`)
      : marked.length ? (de ? `${marked.length} leere ${marked.length === 1 ? 'Seite' : 'Seiten'} gefunden` : `${marked.length} blank ${marked.length === 1 ? 'page' : 'pages'} found`)
        : (de ? 'Keine leeren Seiten gefunden' : 'No blank pages found'),
    el('small', {}, busy ? (de ? 'Markierte Seiten werden entfernt – du kannst jede antippen.' : 'Marked pages will be removed – you can tap any page.')
      : marked.length ? (de ? `${n - marked.length} von ${n} Seiten bleiben. Antippen ändert die Auswahl.` : `${n - marked.length} of ${n} pages stay. Tap to change.`)
        : (de ? 'Erhöhe die Schwelle, wenn fast leere Seiten mit weg sollen.' : 'Raise the threshold to include almost blank pages.')),
  ]);
}

export default {
  options: [
    {
      id: 'threshold', type: 'range', min: 0, max: 1, step: 0.01, default: 0.03,
      label: { de: 'Als leer gilt eine Seite bis', en: 'A page counts as blank up to' },
      format: (v, lang) => `${fmt(v, lang)} ${lang === 'de' ? 'Tinte' : 'ink'}`,
      hint: { de: 'Höher = auch Seiten mit Seitenzahl oder kurzer Notiz gelten als leer. Die Prozentzahl steht unter jeder Seite.', en: 'Higher = pages with just a page number or a short note count as blank, too. The percentage is shown under every page.' },
    },
    {
      id: 'edge', type: 'range', min: 0, max: 15, step: 1, default: 5, unit: '%',
      label: { de: 'Rand ignorieren', en: 'Ignore the edges' },
      hint: { de: 'Schatten und dunkle Kanten von Scannern am Rand zählen nicht.', en: 'Shadows and dark scanner edges near the border don’t count.' },
    },
  ],

  mountStage(host, state, ctx) {
    values = state.values;
    values.remove = '';
    stage = new PageStage(host, ctx, {
      mode: 'select', mark: 'delete',
      buttons: [
        { id: 'auto', icon: 'wand', label: ctx.t({ de: 'Eigene Änderungen verwerfen, nur automatisch erkannte markieren', en: 'Discard your changes, mark only detected pages' }), short: ctx.t({ de: 'Automatisch', en: 'Auto' }), compact: true, onClick: () => { scan?.overrides.clear(); apply(); } },
        { id: 'none', icon: 'none', label: ctx.t({ de: 'Keine Seite entfernen', en: 'Remove no page' }), onClick: () => { stage.items.forEach(it => scan?.overrides.set(it.id, false)); apply(); } },
      ],
      hint: { de: 'Unter jeder Seite steht, wie viel von ihr bedruckt ist.', en: 'Under every page you see how much of it is printed.' },
      grid: {
        ariaLabel: ctx.t({ de: 'Seiten – rot markierte werden entfernt', en: 'Pages – pages marked red will be removed' }),
        sub: (item, i) => (scan && scan.cover[i] != null ? fmt(scan.cover[i], ctx.lang) : '…'),
        onSelect: sel => { stage.items.forEach(it => { const c = scan?.cover[stage.items.indexOf(it)]; if (c == null) return; const auto = c <= values.threshold; const on = sel.has(it.id); if (on !== auto) scan.overrides.set(it.id, on); else scan.overrides.delete(it.id); }); apply(); },
      },
      onLoad: (items, input) => { scan = analyse(input); apply(); },
    });
    stage.meter = el('span');
    stage.meterBox = el('div', { class: 'pg-meter', 'aria-hidden': 'true' }, stage.meter);
    stage.tb.bar.append(stage.meterBox);
    stage.meterBox.style.flexBasis = '100%';
  },

  async onInputs(inputs) { if (stage) await stage.setInputs(inputs); },

  onOptionsChange(v, inputs, ctx) {
    if (!scan) return;
    if (scan._edge !== v.edge) {
      scan._edge = v.edge;
      scan.gray.forEach((g, p) => { if (g) scan.cover[p] = coverage(g, v.edge); });
    }
    apply();
    stage.grid.refresh();
  },

  async run(inputs, opts, ctx) {
    const input = inputs[0];
    if (scan && scan.input === input && scan.done < scan.n) {
      ctx.progress(null, { de: 'Seiten werden noch geprüft …', en: 'Still checking pages …' });
      while (scan.done < scan.n) { await new Promise(r => setTimeout(r, 150)); ctx.throwIfAborted(); ctx.progress(scan.done / scan.n, { de: `Seite ${scan.done} von ${scan.n} geprüft …`, en: `Checked ${scan.done} of ${scan.n} pages …` }); }
      apply();
      opts.remove = values.remove;
    }
    if (!String(opts.remove || '').trim()) throw userError('Es ist keine Seite zum Entfernen markiert. Erhöhe die Schwelle oder tippe Seiten an.', 'No page is marked for removal. Raise the threshold or tap pages.');
    const doc = await input.pdfDoc();
    const n = doc.getPageCount();
    const del = new Set(ctx.parsePages(opts.remove, n));
    if (del.size >= n) throw userError('Alle Seiten wären leer – mindestens eine Seite muss bleiben.', 'All pages would be removed – at least one page has to stay.');
    const PDFLib = await loadPdfLib();
    rearrange(doc, PDFLib, doc.getPages().filter((p, i) => !del.has(i)).map(page => ({ page })));
    ctx.progress(0.7, { de: 'Wird gespeichert …', en: 'Saving …' });
    await ctx.tick();
    const bytes = await saveLike(doc, input, ctx);
    const de = ctx.lang === 'de';
    return { outputs: [{
      name: ctx.fileName(input.name, de ? ' (ohne leere Seiten)' : ' (no blank pages)', 'pdf'), blob: pdfBlob(bytes), pages: n - del.size,
      note: de ? `${del.size} ${del.size === 1 ? 'Seite' : 'Seiten'} entfernt: ${formatPages([...del].sort((a, b) => a - b))}` : `${del.size} ${del.size === 1 ? 'page' : 'pages'} removed: ${formatPages([...del].sort((a, b) => a - b))}`,
    }] };
  },
};
