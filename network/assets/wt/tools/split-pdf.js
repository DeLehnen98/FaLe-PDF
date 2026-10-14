// Tool: split a PDF – by ranges ("1-3, 4-8"), every N pages, single pages, maximum file size, top-level
// bookmarks (titles become file names) or odd/even pages. The page grid shows the parts; tapping between
// two pages sets or removes a cut and writes the ranges for you.
import { loadPdfLib } from '../lib/pdf.js';
import { el } from '../lib/dom.js';
import { baseName, formatSize } from '../lib/format.js';
import { formatPages } from '../lib/ranges.js';
import { PageStage, copyToNew, saveLike, pdfBlob, shellText, shellRadio, userError, parseGroups, groupsFromCuts, groupsToText, range } from '../lib/org-common.js';

let stage = null;
let values = null;
let outline = null;     // [{title, page}] top-level bookmarks of the loaded file (null = not read yet)
let lastText = '';

const T = {
  de: { part: 'Teil', page: 'Seite', pages: 'Seiten', odd: 'ungerade Seiten', even: 'gerade Seiten', start: 'Anfang' },
  en: { part: 'part', page: 'page', pages: 'pages', odd: 'odd pages', even: 'even pages', start: 'Start' },
};

/** Top-level bookmarks → [{title, page}] sorted by page, via pdf.js. */
async function readOutline(input) {
  const pdf = await input.pdfjs();
  const items = (await pdf.getOutline()) || [];
  const out = [];
  for (const it of items) {
    try {
      let dest = it.dest;
      if (typeof dest === 'string') dest = await pdf.getDestination(dest);
      if (!Array.isArray(dest) || !dest[0]) continue;
      const page = typeof dest[0] === 'object' ? await pdf.getPageIndex(dest[0]) : (Number.isInteger(dest[0]) ? dest[0] : null);
      if (page == null) continue;
      out.push({ title: String(it.title || '').trim() || `#${out.length + 1}`, page });
    } catch { /* broken destination */ }
  }
  out.sort((a, b) => a.page - b.page);
  return out.filter((o, i) => i === 0 || o.page !== out[i - 1].page);
}

/** Parts for the current settings: [{pages: [...], title?}] or null when only known after running (size). */
function plan(v, n, marks) {
  switch (v.mode) {
    case 'every': {
      const k = Math.max(1, Math.floor(+v.every || 1));
      const parts = [];
      for (let s = 0; s < n; s += k) parts.push({ pages: range(s, Math.min(n, s + k) - 1) });
      return parts;
    }
    case 'single': return range(0, n - 1).map(p => ({ pages: [p] }));
    case 'oddeven': return [{ pages: range(0, n - 1).filter(p => p % 2 === 0), tag: 'odd' }, { pages: range(0, n - 1).filter(p => p % 2 === 1), tag: 'even' }].filter(p => p.pages.length);
    case 'bookmarks': {
      if (!marks || !marks.length) return [];
      const parts = [];
      if (marks[0].page > 0) parts.push({ pages: range(0, marks[0].page - 1), tag: 'start' });
      marks.forEach((m, i) => parts.push({ pages: range(m.page, (i + 1 < marks.length ? marks[i + 1].page : n) - 1), title: m.title }));
      return parts;
    }
    case 'size': return null;
    default: return parseGroups(v.ranges, n).map(pages => ({ pages }));
  }
}

function contiguous(parts) {
  return parts.every(p => p.pages.every((x, i) => i === 0 || x === p.pages[i - 1] + 1));
}

function refreshGrid() {
  if (!stage?.input) return;
  const n = stage.items.length;
  const de = stage.lang === 'de';
  let parts = null, err = false;
  try { parts = plan(values, n, outline); } catch { err = true; }
  const cuts = new Set();
  let groups = null;
  stage.grid.setBadges(null);
  if (parts && values.mode !== 'oddeven') {
    groups = new Array(n).fill(null);
    parts.forEach((p, gi) => p.pages.forEach(pg => { if (groups[pg] == null) groups[pg] = gi; }));
    if (contiguous(parts)) for (const p of parts) { const last = p.pages[p.pages.length - 1]; if (last < n - 1 && p.pages[0] <= last) cuts.add(stage.items[last].id); }
  } else if (values.mode === 'oddeven') {
    stage.grid.setBadges(new Map(stage.items.map((it, i) => [it.id, i % 2 ? (de ? 'gerade' : 'even') : (de ? 'ungerade' : 'odd')])));
  }
  stage.grid.setCuts(cuts, groups);
  // info line
  let main, sub = '';
  if (err) { main = de ? 'Bereiche prüfen' : 'Check the ranges'; sub = de ? 'Beispiel: 1-3, 4-8' : 'Example: 1-3, 4-8'; }
  else if (!parts) { main = de ? 'Teile nach Dateigröße' : 'Parts by file size'; sub = de ? 'Wie viele Teile es werden, steht nach dem Teilen fest.' : 'The number of parts is known after splitting.'; }
  else if (values.mode === 'bookmarks' && !parts.length) { main = de ? 'Keine Lesezeichen gefunden' : 'No bookmarks found'; sub = de ? 'Wähle eine andere Art oder setze Schnitte.' : 'Pick another way or set cuts.'; }
  else if (!parts.length) { main = de ? 'Tippe zwischen zwei Seiten, um zu schneiden' : 'Tap between two pages to cut'; sub = de ? 'oder gib Bereiche ein, z. B. 1-3, 4-8' : 'or type ranges, e.g. 1-3, 4-8'; }
  else {
    main = de ? `${parts.length} ${parts.length === 1 ? 'Datei' : 'Dateien'}` : `${parts.length} ${parts.length === 1 ? 'file' : 'files'}`;
    sub = parts.length <= 8 ? parts.map(p => formatPages(p.pages)).join(' · ') : (de ? 'Tippe zwischen Seiten, um Schnitte zu ändern' : 'Tap between pages to change cuts');
  }
  stage.info([main, el('small', {}, sub)]);
  stage.tb.bar.classList.toggle('is-active', !!(parts && parts.length > 1));
  stage.tb.btn('clear').disabled = !(values.mode === 'ranges' && String(values.ranges || '').trim());
}

/** Toggle a cut after the page with item id (switches to ranges mode, keeps what is shown). */
function toggleCut(id) {
  const n = stage.items.length;
  const p = stage.items.findIndex(it => it.id === id);
  let parts = null;
  try { parts = plan(values, n, outline); } catch { parts = null; }
  let groups;
  if (parts && parts.length && values.mode !== 'oddeven' && contiguous(parts)) {
    groups = parts.map(x => x.pages.slice());
    const gi = groups.findIndex(g => g.includes(p));
    if (gi < 0) groups = [groupsFromCuts([...groups.map(g => g[g.length - 1]), p], n)];
    else if (groups[gi][groups[gi].length - 1] === p) {
      const next = groups[gi + 1];
      if (next && next[0] === p + 1) groups.splice(gi, 2, groups[gi].concat(next));
      else groups.splice(gi + 1, 0, [p + 1]);
    } else {
      const g = groups[gi];
      const at = g.indexOf(p) + 1;
      groups.splice(gi, 1, g.slice(0, at), g.slice(at));
    }
    groups = (gi < 0 ? groups[0] : groups).filter(g => g.length);
  } else groups = groupsFromCuts([p], n);
  lastText = groupsToText(groups.length === 1 && groups[0].length === n ? [] : groups);
  values.ranges = lastText;
  shellRadio('mode', 'ranges');
  shellText('ranges', lastText);
  values.mode = 'ranges';
  refreshGrid();
}

export default {
  options: [
    {
      id: 'mode', type: 'radio', default: 'ranges',
      label: { de: 'Wie soll geteilt werden?', en: 'How do you want to split?' },
      choices: [
        { value: 'ranges', label: { de: 'Eigene Bereiche', en: 'Custom ranges' }, hint: { de: 'Schnitte antippen oder z. B. „1-3, 4-8“', en: 'Tap cuts or type e.g. “1-3, 4-8”' } },
        { value: 'every', label: { de: 'Alle N Seiten', en: 'Every N pages' }, hint: { de: 'Gleich große Teile', en: 'Equal parts' } },
        { value: 'single', label: { de: 'Jede Seite einzeln', en: 'Every page' }, hint: { de: 'Eine Datei pro Seite', en: 'One file per page' } },
        { value: 'size', label: { de: 'Nach Dateigröße', en: 'By file size' }, hint: { de: 'z. B. höchstens 5 MB für E-Mails', en: 'e.g. at most 5 MB for e-mail' } },
        { value: 'bookmarks', label: { de: 'Nach Lesezeichen', en: 'By bookmarks' }, hint: { de: 'Kapitel werden zu Dateien', en: 'Chapters become files' } },
        { value: 'oddeven', label: { de: 'Gerade / ungerade', en: 'Odd / even' }, hint: { de: 'Zwei Dateien', en: 'Two files' } },
      ],
    },
    {
      id: 'ranges', type: 'text', default: '',
      label: { de: 'Teile', en: 'Parts' },
      placeholder: { de: 'z. B. 1-3, 4-8, 9-', en: 'e.g. 1-3, 4-8, 9-' },
      hint: { de: 'Jeder Bereich wird eine Datei. Mehrere Seiten in einem Teil: „1 3 5“.', en: 'Each range becomes a file. Several pages in one part: “1 3 5”.' },
      when: v => v.mode === 'ranges',
      validate: (v, lang) => {
        if (!String(v || '').trim()) return '';
        try { parseGroups(v, 1e6); return ''; } catch { return lang === 'de' ? 'Bitte so eingeben: 1-3, 4-8' : 'Please type it like this: 1-3, 4-8'; }
      },
    },
    {
      id: 'every', type: 'number', default: 2, min: 1, step: 1,
      label: { de: 'Seiten pro Datei', en: 'Pages per file' },
      when: v => v.mode === 'every',
      validate: (v, lang) => (Number.isInteger(+v) && +v >= 1 ? '' : (lang === 'de' ? 'Ganze Zahl ab 1' : 'A whole number from 1')),
    },
    {
      id: 'maxMb', type: 'number', default: 5, min: 0.1, step: 0.1, unit: 'MB',
      label: { de: 'Höchstens pro Datei', en: 'At most per file' },
      when: v => v.mode === 'size',
      validate: (v, lang) => (+v >= 0.05 ? '' : (lang === 'de' ? 'Bitte eine Größe ab 0,05 MB' : 'Please enter at least 0.05 MB')),
    },
  ],

  mountStage(host, state, ctx) {
    values = state.values;
    stage = new PageStage(host, ctx, {
      mode: 'cuts',
      buttons: [
        { id: 'clear', icon: 'none', label: ctx.t({ de: 'Alle Schnitte entfernen', en: 'Remove all cuts' }), short: ctx.t({ de: 'Alle Schnitte entfernen', en: 'Remove all cuts' }), onClick: () => { lastText = ''; values.ranges = ''; shellText('ranges', ''); refreshGrid(); } },
      ],
      hint: { de: 'Tippe auf eine Seite oder die Schere dahinter, um nach dieser Seite zu schneiden. Nochmal tippen hebt den Schnitt auf.', en: 'Tap a page or the scissors after it to cut there. Tap again to remove the cut.' },
      grid: { ariaLabel: ctx.t({ de: 'Seiten mit Schnitten', en: 'Pages with cuts' }), onCut: toggleCut },
      onLoad: async (items, input) => {
        outline = null;
        refreshGrid();
        try { outline = await readOutline(input); } catch (err) { console.warn(err); outline = []; }
        if (stage.input === input) refreshGrid();
      },
    });
  },

  async onInputs(inputs) { if (stage) await stage.setInputs(inputs); },

  onOptionsChange(v) {
    if (v.ranges !== lastText) lastText = v.ranges;
    refreshGrid();
  },

  async run(inputs, opts, ctx) {
    const input = inputs[0];
    const PDFLib = await loadPdfLib();
    const src = await input.pdfDoc();
    const n = src.getPageCount();
    const de = ctx.lang === 'de';
    const L = T[ctx.lang] || T.de;
    const base = baseName(input.name);
    const width = String(n).length;
    const pad = p => String(p + 1).padStart(width, '0');

    if (opts.mode === 'size') return splitBySize(PDFLib, src, input, opts, ctx, base);

    let parts;
    if (opts.mode === 'bookmarks') {
      const marks = await readOutline(input);
      if (!marks.length) throw userError('Diese PDF hat keine Lesezeichen. Wähle eine andere Art zu teilen.', 'This PDF has no bookmarks. Please pick another way to split.');
      parts = plan(opts, n, marks);
    } else {
      try { parts = plan(opts, n, null); } catch (e) {
        throw e.kind === 'range'
          ? userError(`Die PDF hat nur ${n} Seiten – Seite ${e.detail} gibt es nicht.`, `The PDF only has ${n} pages – there is no page ${e.detail}.`)
          : userError('Die Bereiche verstehe ich nicht. Beispiel: 1-3, 4-8', 'I can’t read the ranges. Example: 1-3, 4-8');
      }
    }
    if (!parts.length) throw userError('Setze zuerst mindestens einen Schnitt: Tippe zwischen zwei Seiten oder gib Bereiche ein.', 'Set at least one cut first: tap between two pages or type ranges.');
    if (parts.length === 1 && parts[0].pages.length === n && opts.mode !== 'oddeven') throw userError('Damit entsteht nur eine Datei mit allen Seiten. Setze mindestens einen Schnitt.', 'That would give one file with all pages. Set at least one cut.');

    const outputs = [];
    const used = new Map();
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      ctx.progress(i / parts.length, { de: `Datei ${i + 1} von ${parts.length}`, en: `File ${i + 1} of ${parts.length}` });
      const doc = await copyToNew(PDFLib, src, part.pages);
      const bytes = await saveLike(doc, input, ctx, { title: part.title || null });
      let name;
      if (part.title) name = `${String(i + 1).padStart(String(parts.length).length, '0')} ${part.title}`;
      else if (part.tag === 'odd' || part.tag === 'even') name = `${base} – ${L[part.tag]}`;
      else if (part.tag === 'start') name = `${String(i + 1).padStart(String(parts.length).length, '0')} ${L.start}`;
      else if (part.pages.length === 1) name = `${base} – ${L.page} ${pad(part.pages[0])}`;
      else name = `${base} – ${L.part} ${i + 1} (${de ? 'S.' : 'p.'} ${formatPages(part.pages)})`;
      name = ctx.safeFileName(name.slice(0, 120));
      const k = used.get(name) || 0;
      used.set(name, k + 1);
      if (k) name += ` (${k + 1})`;
      outputs.push({ name: name + '.pdf', blob: pdfBlob(bytes), pages: part.pages.length });
      await ctx.tick();
    }
    ctx.notes.splice(0, ctx.notes.length, ...new Set(ctx.notes));
    return { outputs };
  },
};

async function splitBySize(PDFLib, src, input, opts, ctx, base) {
  const limit = Math.max(0.05, +opts.maxMb || 5) * 1024 * 1024;
  const n = src.getPageCount();
  const de = ctx.lang === 'de';
  const build = async pages => saveLike(await copyToNew(PDFLib, src, pages), input, ctx);
  const parts = [];
  let cur = [], curBytes = null, measuredLen = 0;
  for (let p = 0; p < n; p++) {
    ctx.progress(p / n, { de: `Seite ${p + 1} von ${n} wird eingeteilt …`, en: `Sorting page ${p + 1} of ${n} …` });
    if (!cur.length) { cur = [p]; curBytes = await build(cur); measuredLen = 1; await ctx.tick(); continue; }
    const est = curBytes.length / measuredLen * (cur.length + 1);
    if (est < limit * 0.7) { cur.push(p); continue; }
    const next = cur.concat(p);
    const bytes = await build(next);
    if (bytes.length <= limit) { cur = next; curBytes = bytes; measuredLen = next.length; }
    else {
      if (measuredLen !== cur.length) curBytes = await build(cur);
      parts.push({ pages: cur, bytes: curBytes });
      cur = [p]; curBytes = await build(cur); measuredLen = 1;
    }
    await ctx.tick();
  }
  if (cur.length) { if (measuredLen !== cur.length) curBytes = await build(cur); parts.push({ pages: cur, bytes: curBytes }); }
  const over = parts.filter(p => p.bytes.length > limit);
  if (over.length) ctx.note({
    de: `${over.length === 1 ? 'Eine Seite ist' : `${over.length} Seiten sind`} allein schon größer als ${formatSize(limit, 'de')} und ${over.length === 1 ? 'steht' : 'stehen'} deshalb in einer eigenen, größeren Datei. Tipp: vorher „PDF komprimieren“ nutzen.`,
    en: `${over.length === 1 ? 'One page is' : `${over.length} pages are`} larger than ${formatSize(limit, 'en')} on ${over.length === 1 ? 'its' : 'their'} own and ${over.length === 1 ? 'gets' : 'get'} a separate, larger file. Tip: use “Compress PDF” first.`,
  });
  ctx.notes.splice(0, ctx.notes.length, ...new Set(ctx.notes));
  return {
    outputs: parts.map((part, i) => ({
      name: ctx.safeFileName(`${base} – ${de ? 'Teil' : 'part'} ${i + 1} (${de ? 'S.' : 'p.'} ${formatPages(part.pages)})`) + '.pdf',
      blob: pdfBlob(part.bytes), pages: part.pages.length,
    })),
  };
}
