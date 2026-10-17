// Tool: edit PDF bookmarks (the outline / table of contents in the side bar of PDF readers). Shows the existing
// bookmarks, lets you add, rename, re-target, reorder, nest and delete them, generates them from the headings
// (layout analysis) or one per page, and writes a new /Outlines. The outline code is the app's own
// (js/tools/outlinecore.js → lib/shared/outlinecore.js). Everything runs in the browser; nothing is uploaded.
import { el, clear } from '../lib/dom.js';
import { loadPdfLib } from '../lib/pdf.js';
import { ensureCss, tr, ic, btn, userError, statusLine, saveLikeSource, pdfBlob, watchUnlock, pageNav, previewPage, wipeCanvas, stageWidth } from '../lib/sec-ui.js';

const MAX = 2000;
const S = { inputId: null, pdf: null, list: [], orig: 0, undo: null, rev: 0 };
const core = () => import('../lib/shared/outlinecore.js');

/** Keep levels valid: the first entry on level 0, never more than one level deeper than the one before. */
export function normalise(list) {
  list.forEach((it, i) => { it.level = Math.max(0, Math.min(it.level | 0, i ? list[i - 1].level + 1 : 0, 8)); });
  return list;
}

export default {
  options: [
    {
      id: 'show', type: 'toggle', default: true,
      label: { de: 'Lesezeichen beim Öffnen anzeigen', en: 'Show bookmarks when the file is opened' },
      hint: { de: 'Die Seitenleiste mit den Lesezeichen ist dann gleich offen.', en: 'The side bar with the bookmarks opens right away.' },
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
    const input = inputs.find(i => !i.locked);
    if (!input) { clear(stage); S.inputId = null; S.list = []; return; }
    if (S.inputId === input.id || this._loading === input.id) return;
    this._loading = input.id;
    let pdf, list = [];
    try {
      pdf = await input.pdfjs();
      const { readOutline } = await core();
      list = await readOutline(pdf, { untitled: tr(this._lang, 'Ohne Titel', 'Untitled') });
    } catch { if (!pdf) { this._loading = null; return; } }
    this._loading = null;
    S.inputId = input.id; S.pdf = pdf; S.orig = list.length; S.undo = null;
    S.list = normalise(list.slice(0, MAX).map(it => ({ title: it.title, page: Math.max(1, Math.min(pdf.numPages, it.page || 1)), top: it.top, level: it.level })));
    this._status = build(stage, this._state, this._lang);
  },

  async run(inputs, opts, ctx) {
    const input = inputs[0];
    if (S.inputId !== input.id) throw userError('Die Datei wird noch geladen.', 'The file is still loading.');
    const PDFLib = await loadPdfLib();
    const { writeOutline } = await core();
    const doc = await input.pdfDoc();
    const n = doc.getPageCount();
    const list = normalise(S.list.map(it => ({ ...it, title: String(it.title || '').trim() || tr(ctx.lang, `Seite ${it.page}`, `Page ${it.page}`), page: Math.max(1, Math.min(n, it.page | 0 || 1)) })));
    ctx.progress(0.4, { de: 'Lesezeichen werden geschrieben …', en: 'Writing bookmarks …' });
    writeOutline(PDFLib, doc, list);
    if (!opts.show || !list.length) {
      const pm = doc.catalog.get(PDFLib.PDFName.of('PageMode'));
      if (pm && pm.toString() === '/UseOutlines') doc.catalog.delete(PDFLib.PDFName.of('PageMode'));
    }
    const { bytes, protectedAgain } = await saveLikeSource(doc, input);
    if (protectedAgain) ctx.note({ de: 'Die Datei ist wieder mit demselben Passwort geschützt.', en: 'The file is protected again with the same password.' });
    if (!list.length) ctx.note({ de: 'Alle Lesezeichen wurden entfernt.', en: 'All bookmarks were removed.' });
    const suffix = ctx.lang === 'de' ? ' (Lesezeichen)' : ' (bookmarks)';
    return { outputs: [{ name: ctx.fileName(input.name, suffix, 'pdf'), blob: pdfBlob(bytes), pages: n,
      note: ctx.t({ de: `${list.length} ${list.length === 1 ? 'Lesezeichen' : 'Lesezeichen'}`, en: `${list.length} bookmark${list.length === 1 ? '' : 's'}` }) }] };
  },
};

function build(stage, state, L) {
  const status = statusLine();
  const bump = () => { state.values.bmRev = ++S.rev; state.results?.clear?.(); };
  const pages = S.pdf.numPages;

  // ------------------------------------------------ page preview (pick the target page)
  const nav = pageNav(L, n => show(n));
  const pageBox = el('div', { class: 'sec-page bm-page' });
  let cur = null, seq = 0;
  async function show(n) {
    const my = ++seq;
    const r = await previewPage(S.pdf, n, Math.max(160, Math.min(320, stageWidth(stage, 720) - 40)));
    if (my !== seq) { wipeCanvas(r.canvas); return; }
    if (cur) wipeCanvas(cur.canvas);
    cur = r;
    clear(pageBox).append(r.canvas);
  }
  nav.set(1, pages);
  requestAnimationFrame(() => show(1));
  const newTitle = el('input', { class: 'wt-input', id: 'bm-new-title', type: 'text', maxlength: '200', autocomplete: 'off', placeholder: tr(L, 'z. B. Kapitel 1 – Einleitung', 'e.g. Chapter 1 – Introduction') });
  const addHere = () => {
    const title = newTitle.value.trim() || tr(L, `Seite ${nav.page}`, `Page ${nav.page}`);
    if (S.list.length >= MAX) return;
    // insert in page order, on the level of the entry before it
    let i = S.list.findIndex(it => it.page > nav.page);
    if (i < 0) i = S.list.length;
    const level = i ? S.list[i - 1].level : 0;
    S.list.splice(i, 0, { title, page: nav.page, top: null, level });
    newTitle.value = '';
    normalise(S.list); draw(i); bump();
    status.set(tr(L, `Lesezeichen „${title}“ auf Seite ${nav.page} eingefügt.`, `Bookmark “${title}” added on page ${nav.page}.`), 'ok');
  };
  newTitle.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addHere(); } });
  const addBtn = btn('plus', tr(L, 'Für diese Seite hinzufügen', 'Add for this page'), addHere, { cls: 'wt-btn wt-btn-primary wt-btn-sm' });
  addBtn.dataset.add = '';

  // ------------------------------------------------ generators
  function replaceWith(list, msg) {
    S.undo = S.list.map(x => ({ ...x }));
    S.list = normalise(list.slice(0, MAX));
    draw(); bump();
    status.set(msg, 'ok');
    undoBtn.hidden = false;
  }
  const fromHeadings = btn('wand', tr(L, 'Aus Überschriften erzeugen', 'Create from headings'), async () => {
    fromHeadings.disabled = true;
    status.set(tr(L, 'Suche Überschriften …', 'Looking for headings …'));
    try {
      const { outlineFromHeadings } = await core();
      const gen = await outlineFromHeadings(S.pdf, async (n, total) => { status.set(tr(L, `Suche Überschriften … Seite ${n} von ${total}`, `Looking for headings … page ${n} of ${total}`)); await new Promise(r => setTimeout(r, 0)); });
      if (!gen.length) { status.set(tr(L, 'Keine Überschriften erkannt – zum Beispiel, weil alles gleich groß gesetzt ist. Füg die Lesezeichen selbst hinzu.', 'No headings found – for example because everything has the same size. Add the bookmarks yourself.'), 'error'); return; }
      replaceWith(gen, tr(L, `${gen.length} Überschriften erkannt. Prüf die Liste – Titel lassen sich direkt ändern.`, `${gen.length} headings found. Check the list – titles can be edited directly.`));
    } catch (e) {
      console.warn('headings', e);
      status.set(tr(L, 'Überschriften konnten nicht erkannt werden.', 'Headings could not be detected.'), 'error');
    } finally { fromHeadings.disabled = false; }
  });
  fromHeadings.dataset.headings = '';
  const perPage = btn('pages', tr(L, 'Eins pro Seite', 'One per page'), () => {
    replaceWith(Array.from({ length: Math.min(pages, MAX) }, (_, i) => ({ title: tr(L, `Seite ${i + 1}`, `Page ${i + 1}`), page: i + 1, top: null, level: 0 })),
      tr(L, `${Math.min(pages, MAX)} Lesezeichen angelegt – benenne sie jetzt um.`, `${Math.min(pages, MAX)} bookmarks created – rename them now.`));
  });
  perPage.dataset.perpage = '';
  const clearAll = btn('trash', tr(L, 'Alle entfernen', 'Remove all'), () => replaceWith([], tr(L, 'Alle Lesezeichen entfernt.', 'All bookmarks removed.')));
  clearAll.dataset.clear = '';
  const undoBtn = btn('undo', tr(L, 'Rückgängig', 'Undo'), () => {
    if (!S.undo) return;
    S.list = S.undo; S.undo = null; undoBtn.hidden = true;
    draw(); bump();
    status.set(tr(L, 'Vorherige Liste wiederhergestellt.', 'Previous list restored.'), 'ok');
  });
  undoBtn.hidden = true;
  undoBtn.dataset.undo = '';

  // ------------------------------------------------ the list
  const ul = el('ol', { class: 'bm-list', aria: { label: tr(L, 'Lesezeichen', 'Bookmarks') } });
  const count = el('p', { class: 'sec-sub', aria: { live: 'polite' } });
  function move(i, d) {
    // move the entry together with its children
    const end = blockEnd(i);
    const block = S.list.slice(i, end);
    if (d < 0) {
      if (i === 0) return;
      let j = i - 1;
      while (j > 0 && S.list[j].level > block[0].level) j--;
      S.list.splice(i, block.length);
      S.list.splice(j, 0, ...block);
      normalise(S.list); draw(j, 'up'); bump();
    } else {
      if (end >= S.list.length) return;
      const nextEnd = blockEnd(end);
      const next = S.list.slice(end, nextEnd);
      S.list.splice(i, block.length + next.length, ...next, ...block);
      normalise(S.list); draw(i + next.length, 'down'); bump();
    }
  }
  function blockEnd(i) { let j = i + 1; while (j < S.list.length && S.list[j].level > S.list[i].level) j++; return j; }
  function shift(i, d) {
    const end = blockEnd(i);
    const maxLevel = i ? S.list[i - 1].level + 1 : 0;
    const nl = Math.max(0, Math.min(maxLevel, S.list[i].level + d));
    const delta = nl - S.list[i].level;
    if (!delta) return;
    for (let k = i; k < end; k++) S.list[k].level += delta;
    normalise(S.list); draw(i, d > 0 ? 'in' : 'out'); bump();
  }
  function draw(focus = null, what = 'title') {
    clear(ul);
    count.textContent = S.list.length ? tr(L, `${S.list.length} Lesezeichen${S.orig ? ` (vorher ${S.orig})` : ''}.`, `${S.list.length} bookmark${S.list.length === 1 ? '' : 's'}${S.orig ? ` (before: ${S.orig})` : ''}.`)
      : tr(L, 'Noch keine Lesezeichen. Füg welche hinzu oder lass sie aus den Überschriften erzeugen.', 'No bookmarks yet. Add some or create them from the headings.');
    S.list.forEach((it, i) => {
      const n = i + 1;
      const title = el('input', { class: 'wt-input bm-title', type: 'text', maxlength: '200', value: it.title, autocomplete: 'off', aria: { label: tr(L, `Titel von Lesezeichen ${n}`, `Title of bookmark ${n}`) } });
      title.addEventListener('input', () => { it.title = title.value; bump(); });
      const page = el('input', { class: 'wt-input bm-pageno', type: 'number', min: '1', max: String(pages), inputmode: 'numeric', value: String(it.page), aria: { label: tr(L, `Seite von Lesezeichen ${n}`, `Page of bookmark ${n}`) } });
      page.addEventListener('change', () => { const v = Math.max(1, Math.min(pages, parseInt(page.value, 10) || 1)); page.value = String(v); if (v !== it.page) { it.page = v; it.top = null; bump(); } });
      const b = (icon, label, fn, dis, cls) => { const x = btn(icon, '', fn, { cls: 'wt-icon-btn bm-act ' + cls, label }); x.disabled = !!dis; return x; };
      const row = el('li', { class: 'bm-row', dataset: { level: String(it.level) } },
        el('div', { class: 'bm-main' }, title, el('label', { class: 'bm-pagelab' }, tr(L, 'S.', 'p.'), page)),
        el('div', { class: 'bm-acts' },
          b('outdent', tr(L, `Lesezeichen ${n} eine Ebene höher`, `Bookmark ${n} one level up`), () => shift(i, -1), it.level === 0, 'bm-out'),
          b('indent', tr(L, `Lesezeichen ${n} einrücken`, `Indent bookmark ${n}`), () => shift(i, 1), !i || it.level > S.list[i - 1].level, 'bm-in'),
          b('up', tr(L, `Lesezeichen ${n} nach oben`, `Move bookmark ${n} up`), () => move(i, -1), i === 0, 'bm-up'),
          b('down', tr(L, `Lesezeichen ${n} nach unten`, `Move bookmark ${n} down`), () => move(i, 1), blockEnd(i) >= S.list.length, 'bm-down'),
          b('eye', tr(L, `Seite von Lesezeichen ${n} ansehen`, `View the page of bookmark ${n}`), () => { nav.go(it.page); show(it.page); pageBox.scrollIntoView({ block: 'nearest' }); }, false, 'bm-view'),
          b('trash', tr(L, `Lesezeichen ${n} löschen`, `Delete bookmark ${n}`), () => {
            const end = blockEnd(i);
            // children move up one level instead of disappearing
            for (let k = i + 1; k < end; k++) S.list[k].level -= 1;
            S.list.splice(i, 1); normalise(S.list); draw(Math.min(i, S.list.length - 1), 'title'); bump();
          }, false, 'bm-del')));
      row.style.setProperty('--lvl', String(it.level));
      ul.append(row);
    });
    if (focus != null && ul.children[focus]) {
      const sel = { title: '.bm-title', up: '.bm-up', down: '.bm-down', in: '.bm-in', out: '.bm-out' }[what] || '.bm-title';
      const t = ul.children[focus].querySelector(sel);
      (t && !t.disabled ? t : ul.children[focus].querySelector('.bm-title'))?.focus();
    }
  }
  draw();

  clear(stage).append(
    el('div', { class: 'sec-card' }, el('h3', { class: 'sec-h' }, ic('list'), tr(L, 'Lesezeichen', 'Bookmarks')), count,
      el('div', { class: 'sec-toolbar sec-toolbar-start' }, fromHeadings, perPage, clearAll, undoBtn), ul),
    el('div', { class: 'sec-card bm-add' }, el('h3', { class: 'sec-h' }, ic('plus'), tr(L, 'Lesezeichen hinzufügen', 'Add a bookmark')),
      el('p', { class: 'sec-small' }, tr(L, 'Blättere zur Seite, auf die das Lesezeichen springen soll, und gib einen Titel ein.', 'Go to the page the bookmark should jump to and enter a title.')),
      nav.node, el('div', { class: 'sec-page-wrap' }, pageBox),
      el('div', { class: 'wt-opt' }, el('label', { for: 'bm-new-title' }, tr(L, 'Titel', 'Title')), newTitle), addBtn),
    status.node,
    el('p', { class: 'sec-info' }, ic('shield'), tr(L,
      'Lesezeichen erscheinen in jedem PDF-Programm in der Seitenleiste und springen per Klick zur Seite. Deine PDF wird nicht hochgeladen.',
      'Bookmarks show up in the side bar of every PDF reader and jump to the page with one click. Your PDF is not uploaded.')));
  return status;
}
