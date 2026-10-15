// Erweiterungen der Textverarbeitung: Felder (Beschriftungsnummern, Querverweise, Tabellenformeln, nummerierte
// Überschriften), Endnoten, Textmarken, Links auf Stellen im Dokument, Querverweise, Beschriftungen, Tabellen
// sortieren/rechnen/umwandeln, Bild zuschneiden/drehen, Tabstopps, Initiale, Einfügeoptionen,
// schwebende Formatleiste (mit Tastatur-Abstand auf dem Handy), Gliederung verschieben.
import { $, $$, esc, h, toast, openDialog } from '../ui.js';
import { officeMenu, oicon } from './kinds.js';
import { headingNumberer } from './docstyles.js';
import { tableGrid, cellPos } from './writer-table.js';
import { cellNumber, formatResult, evalFormula, canonicalFormula, TF_FORMATS } from './tablecalc.js';
import { parseTabs, formatTabs } from './docmodel.js';
import { pageNumberOf } from './hfnorm.js';

const BLOCK_SEL = 'p,h1,h2,h3,h4,h5,h6,li,pre,td,th,blockquote';
const LABELS = ['Abbildung', 'Tabelle', 'Gleichung'];
const cssEsc = s => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));
/** Bookmark names: letters, digits and underscore (Word rules), max. 40 characters. */
export function cleanBookmarkName(n) {
  let s = String(n || '').trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+/, '');
  if (s && !/^[A-Za-z]/.test(s)) s = 'M' + s;
  return s.slice(0, 40);
}

export function createWriterExtras(x) {
  const { ed, wrap } = x;
  const blockOf = n => { const el = n && (n.nodeType === 1 ? n : n.parentElement); return el ? el.closest(BLOCK_SEL) : null; };

  // ======================================================================= fields
  const bmEl = name => (name ? ed.querySelector(`span.bm[data-bm="${cssEsc(name)}"]`) : null);
  function targetText(bm) {
    const blk = blockOf(bm);
    if (!blk) return '';
    if (blk.classList.contains('caption')) {
      const seq = blk.querySelector('span.seq');
      if (seq) { const r = document.createRange(); r.setStart(blk, 0); r.setEndAfter(seq); return r.toString().replace(/\s+/g, ' ').trim(); }
    }
    let t;
    if (/^H[1-6]$/.test(blk.tagName) || blk.classList.contains('title') || bm.nodeType !== 1 || !bm.classList.contains('bm')) {
      t = blk.textContent.replace(/[\u200b]/g, '').replace(/\s+/g, ' ').trim();
      if (/^H[1-6]$/.test(blk.tagName) && blk.getAttribute('data-hnum')) t = `${blk.getAttribute('data-hnum')} ${t}`;
    } else {
      // like Word: the text from the bookmark to the next bookmark / the end of the paragraph
      const r = document.createRange(); r.setStartAfter(bm); r.setEnd(blk, blk.childNodes.length);
      const next = $$('span.bm', blk).find(x => x !== bm && r.comparePoint(x, 0) === 0);
      if (next) r.setEndBefore(next);
      t = r.toString().replace(/[\u200b]/g, '').replace(/\s+/g, ' ').trim();
    }
    return t;
  }
  function pageLabelOf(el) {
    if (!x.pv.on) return null;
    const hf = x.getHf();
    const i = x.pv.pageOf(el) - 1;
    return hf ? pageNumberOf(hf, i) : String(i + 1);
  }
  /** Recalculate everything that depends on the document: heading numbers, caption numbers, references, formulas. */
  function updateFields() {
    // heading numbers (numbered heading styles)
    const num = headingNumberer(x.getStyles());
    for (const hd of $$('h1,h2,h3,h4,h5,h6', ed)) {
      const n = num.any && !hd.closest('td,th,.textbox,[data-toc]') ? num(hd.tagName.toLowerCase()) : null;
      if (n) { if (hd.getAttribute('data-hnum') !== n) hd.setAttribute('data-hnum', n); } else if (hd.hasAttribute('data-hnum')) hd.removeAttribute('data-hnum');
    }
    // caption numbers per label
    const counters = {};
    for (const sp of $$('span.seq', ed)) {
      if (sp.closest('del.tc')) continue;
      const lab = sp.getAttribute('data-seq') || 'Abbildung';
      counters[lab] = (counters[lab] || 0) + 1;
      const t = String(counters[lab]);
      if (sp.textContent !== t) sp.textContent = t;
    }
    // table formulas (three passes so formulas may use other formula results)
    const spans = $$('span.tf', ed);
    for (let pass = 0; pass < 3 && spans.length; pass++) {
      let dirty = false;
      const grids = new Map();
      for (const sp of spans) {
        const td = sp.closest('td,th');
        let text;
        if (!td) text = '!Fehler';
        else {
          const table = td.closest('table');
          if (!grids.has(table)) grids.set(table, tableGrid(table));
          const grid = grids.get(table);
          const pos = cellPos(grid, td);
          const cols = Math.max(...grid.map(r => r.length));
          try {
            const v = evalFormula(sp.getAttribute('data-f') || '', { r: pos.r, c: pos.c, rows: grid.length, cols, value: (r, c) => { const cell = grid[r] && grid[r][c]; return cell && cell !== td ? cellNumber(cell.textContent) : null; } });
            text = formatResult(v, sp.getAttribute('data-fmt') || '');
          } catch { text = '!Fehler'; }
        }
        if (sp.textContent !== text) { sp.textContent = text; dirty = true; }
      }
      if (!dirty) break;
    }
    // cross references
    for (const xr of $$('span.xref', ed)) {
      const bm = bmEl(xr.getAttribute('data-ref'));
      let t;
      if (!bm) t = 'Fehler! Verweisquelle nicht gefunden.';
      else if (xr.getAttribute('data-xk') === 'page') t = pageLabelOf(bm) || xr.textContent;
      else t = targetText(bm) || '?';
      if (xr.textContent !== t) xr.textContent = t;
    }
  }

  // ======================================================================= endnotes
  async function noteText(title, value = '') {
    const r = await openDialog({
      title, body: `<label class="field"><span class="field-label">Text der Endnote</span><textarea class="input w-cmt-ta" name="t" rows="3" autofocus>${esc(value)}</textarea></label>`,
      actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Übernehmen', value: 'ok', kind: 'btn-primary', default: true }],
      onMount: dlg => ({ collect: () => $('[name=t]', dlg).value.trim() }),
    });
    return r.value === 'ok' && r.data ? r.data : null;
  }
  async function insertEndnote(textArg) {
    if (x.plain) { toast('Endnoten gibt es nur in .docx-Dokumenten.', 'info'); return; }
    const text = textArg != null ? textArg : await noteText('Endnote einfügen');
    if (!text) return;
    x.restoreSel(); x.capture();
    const sel = getSelection();
    if (sel.rangeCount && !sel.isCollapsed) sel.collapseToEnd();
    x.insertInline(`<sup class="en" data-en="${esc(text)}" contenteditable="false"></sup>&#8203;`);
    x.changed(); x.refresh();
  }
  function endnoteMenu(en) {
    officeMenu(en, [
      { label: 'Endnote bearbeiten', icon: 'edit', onClick: async () => { const t = await noteText('Endnote bearbeiten', en.getAttribute('data-en') || ''); if (t != null) { x.capture(); en.setAttribute('data-en', t); x.changed(); x.refresh(); } } },
      { label: 'In Fußnote umwandeln', icon: 'footnote', onClick: () => x.op(() => { const f = document.createElement('sup'); f.className = 'fn'; f.setAttribute('data-fn', en.getAttribute('data-en') || ''); f.setAttribute('contenteditable', 'false'); en.replaceWith(f); }) },
      { label: 'Endnote löschen', icon: 'trash', danger: true, onClick: () => x.op(() => en.remove()) },
    ], { label: 'Endnote' });
  }
  function renderEndnotes(area) {
    const ens = $$('sup.en', ed).filter(e => !e.closest('del.tc'));
    area.hidden = !ens.length;
    area.innerHTML = ens.length ? `<p class="en-title">Endnoten</p><ol type="i">${ens.map(e => `<li>${esc(e.getAttribute('data-en') || '')}</li>`).join('')}</ol>` : '';
  }

  // ======================================================================= bookmarks + targets
  const visibleMarks = () => $$('span.bm', ed).filter(b => !/^_/.test(b.getAttribute('data-bm') || ''));
  /** Ensure an element (heading / caption / paragraph) carries a bookmark; returns its name. */
  function ensureTarget(blk) {
    const have = blk.querySelector('span.bm');
    if (have) return have.getAttribute('data-bm');
    let name;
    do { name = `_Ref${Math.floor(1e8 + Math.random() * 9e8)}`; } while (bmEl(name));
    const sp = document.createElement('span');
    sp.className = 'bm'; sp.setAttribute('data-bm', name); sp.setAttribute('contenteditable', 'false');
    blk.prepend(sp);
    return name;
  }
  function gotoTarget(name) {
    const bm = bmEl(name);
    if (!bm) { toast('Dieses Ziel gibt es im Dokument nicht mehr.', 'info'); return; }
    x.jumpTo(blockOf(bm) || bm);
  }
  async function bookmarkDialog() {
    if (x.plain) { toast('Textmarken gibt es nur in .docx-Dokumenten.', 'info'); return; }
    x.saveSel();
    const sel = x.curRange();
    const suggestion = sel && !sel.collapsed ? cleanBookmarkName(sel.toString().slice(0, 30)) : '';
    const list = () => visibleMarks().map(b => b.getAttribute('data-bm'));
    let todo = null;
    const r = await openDialog({
      title: 'Textmarke', wide: true,
      body: `<div class="bm-dlg"><div class="bm-add"><label class="field"><span class="field-label">Name der Textmarke</span><input class="input" name="name" value="${esc(suggestion)}" placeholder="z. B. Anhang_A" autocomplete="off" autofocus></label></div>
        <p class="hint">Erlaubt sind Buchstaben, Ziffern und „_“. Textmarken sind Ziele für Links und Querverweise.</p>
        <div class="bm-list">${list().length ? list().map(n => `<div class="bm-row"><span>${esc(n)}</span><span><button type="button" class="btn btn-ghost btn-sm" data-go="${esc(n)}">Gehe zu</button><button type="button" class="btn btn-ghost btn-sm" data-del="${esc(n)}">Löschen</button></span></div>`).join('') : '<p class="panel-empty">Noch keine Textmarken.</p>'}</div></div>`,
      actions: [{ label: 'Schließen', value: 'cancel' }, { label: 'Hinzufügen', value: 'ok', kind: 'btn-primary', default: true }],
      onMount: dlg => {
        dlg.addEventListener('click', e => { const b = e.target.closest('[data-go],[data-del]'); if (!b) return; todo = b.dataset.go ? ['go', b.dataset.go] : ['del', b.dataset.del]; dlg.close(); });
        return { collect: () => cleanBookmarkName($('[name=name]', dlg).value) };
      },
      validate: (v, dlg) => { if (v !== 'ok') return true; const n = cleanBookmarkName($('[name=name]', dlg).value); if (!n) { $('[name=name]', dlg).classList.add('bad'); return false; } return true; },
    });
    if (todo) { if (todo[0] === 'go') gotoTarget(todo[1]); else x.op(() => { const b = bmEl(todo[1]); if (b) b.remove(); }); return; }
    if (r.value !== 'ok' || !r.data) return;
    const name = r.data;
    x.restoreSel(); x.capture();
    const old = bmEl(name);
    if (old) old.remove();
    const s = getSelection();
    if (s.rangeCount && !s.isCollapsed) s.collapseToStart();
    x.insertInline(`<span class="bm" data-bm="${esc(name)}" contenteditable="false"></span>`);
    x.changed();
    toast(`Textmarke „${name}“ gesetzt`, 'success');
  }

  /** Targets inside the document: headings, captions (by label) and bookmarks. */
  function targets(kind) {
    if (kind === 'heading') return $$('h1,h2,h3,h4,h5,h6', ed).filter(hd => !hd.closest('[data-toc]') && hd.textContent.trim()).map(hd => ({ el: hd, text: targetText(hd.firstChild ? hd.firstChild : hd) || hd.textContent.trim(), level: +hd.tagName[1] }));
    if (kind === 'bookmark') return visibleMarks().map(b => ({ el: b, name: b.getAttribute('data-bm'), text: b.getAttribute('data-bm') }));
    return $$('p.caption', ed).filter(c => { const s = c.querySelector('span.seq'); return s && (s.getAttribute('data-seq') || 'Abbildung') === kind; }).map(c => ({ el: c, text: c.textContent.replace(/\s+/g, ' ').trim() }));
  }
  const nameOfTarget = t => (t.name ? t.name : ensureTarget(t.el));

  // ======================================================================= links
  async function linkDialog() {
    x.saveSel();
    const sel = x.curRange();
    const selText = sel && !sel.collapsed ? sel.toString() : '';
    const a0 = sel && (sel.startContainer.nodeType === 1 ? sel.startContainer : sel.startContainer.parentElement).closest('a');
    const curHref = a0 && ed.contains(a0) ? a0.getAttribute('href') || '' : '';
    const hs = targets('heading'), bms = targets('bookmark');
    let mode = curHref.startsWith('#') ? 'doc' : 'web';
    const r = await openDialog({
      title: 'Link einfügen', wide: true,
      body: `<div class="lk-dlg"><div class="seg lk-seg" role="tablist"><button type="button" role="tab" data-mode="web" aria-selected="${mode === 'web'}">Webadresse oder E-Mail</button><button type="button" role="tab" data-mode="doc" aria-selected="${mode === 'doc'}">Stelle im Dokument</button></div>
        ${selText ? '' : '<label class="field"><span class="field-label">Angezeigter Text</span><input class="input" name="text" autocomplete="off"></label>'}
        <div data-pane="web" ${mode === 'web' ? '' : 'hidden'}><label class="field"><span class="field-label">Adresse</span><input class="input" name="v" value="${esc(curHref && !curHref.startsWith('#') ? curHref : 'https://')}" inputmode="url" autocomplete="off"></label></div>
        <div data-pane="doc" ${mode === 'doc' ? '' : 'hidden'}><div class="lk-list" role="listbox" aria-label="Ziele">
          ${hs.length ? `<p class="lk-h">Überschriften</p>${hs.map((t, i) => `<label class="lk-opt l${t.level}"><input type="radio" name="tgt" value="h${i}"> ${esc(t.text)}</label>`).join('')}` : ''}
          ${bms.length ? `<p class="lk-h">Textmarken</p>${bms.map((t, i) => `<label class="lk-opt"><input type="radio" name="tgt" value="b${i}" ${curHref === `#${t.name}` ? 'checked' : ''}> ${esc(t.text)}</label>`).join('')}` : ''}
          ${hs.length || bms.length ? '' : '<p class="panel-empty">Keine Überschriften oder Textmarken im Dokument.</p>'}</div></div></div>`,
      actions: [...(a0 ? [{ label: 'Link entfernen', value: 'remove', kind: 'btn-danger-ghost' }] : []), { label: 'Abbrechen', value: 'cancel' }, { label: 'Einfügen', value: 'ok', kind: 'btn-primary', default: true }],
      onMount: dlg => {
        $$('[data-mode]', dlg).forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode; $$('[data-mode]', dlg).forEach(y => y.setAttribute('aria-selected', String(y === b))); $$('[data-pane]', dlg).forEach(p => { p.hidden = p.dataset.pane !== mode; }); }));
        setTimeout(() => { const el = mode === 'web' ? $('[name=v]', dlg) : null; if (el) { el.focus(); el.select(); } }, 40);
        return { collect: () => ({ mode, url: ($('[name=v]', dlg).value || '').trim(), text: $('[name=text]', dlg) ? $('[name=text]', dlg).value.trim() : '', tgt: ($('[name=tgt]:checked', dlg) || {}).value || null }) };
      },
    });
    if (r.value === 'remove' && a0) { x.op(() => a0.replaceWith(...a0.childNodes)); return; }
    if (r.value !== 'ok' || !r.data) return;
    const d = r.data;
    let href, label;
    if (d.mode === 'doc') {
      if (!d.tgt) { toast('Wähle ein Ziel im Dokument.', 'info'); return; }
      x.capture();
      const t = d.tgt[0] === 'h' ? hs[+d.tgt.slice(1)] : bms[+d.tgt.slice(1)];
      href = `#${nameOfTarget(t)}`; label = d.text || t.text;
    } else {
      if (!d.url || d.url === 'https://') return;
      href = /^(https?:|mailto:|tel:)/i.test(d.url) ? d.url : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.url) ? `mailto:${d.url}` : `https://${d.url}`;
      label = d.text || d.url;
      x.capture();
    }
    x.restoreSel();
    if (a0 && ed.contains(a0)) a0.setAttribute('href', href);
    else if (selText) { document.execCommand('createLink', false, href); }
    else x.insertInline(`<a href="${esc(href)}">${esc(label)}</a>&nbsp;`);
    x.changed();
  }

  // ======================================================================= cross references
  async function crossRefDialog() {
    if (x.plain) { toast('Querverweise gibt es nur in .docx-Dokumenten.', 'info'); return; }
    x.saveSel();
    const labels = [...new Set([...LABELS, ...$$('span.seq', ed).map(s => s.getAttribute('data-seq') || 'Abbildung')])];
    const kinds = [['heading', 'Überschrift'], ['bookmark', 'Textmarke'], ...labels.map(l => [l, l])];
    let kind = 'heading';
    const fill = dlg => {
      const list = targets(kind);
      $('.xr-list', dlg).innerHTML = list.length ? list.map((t, i) => `<label class="lk-opt${t.level ? ` l${t.level}` : ''}"><input type="radio" name="tgt" value="${i}" ${i === 0 ? 'checked' : ''}> ${esc(t.text)}</label>`).join('') : `<p class="panel-empty">${kind === 'heading' ? 'Keine Überschriften im Dokument.' : kind === 'bookmark' ? 'Keine Textmarken im Dokument.' : `Keine Beschriftungen „${esc(kind)}“ im Dokument.`}</p>`;
    };
    const r = await openDialog({
      title: 'Querverweis', wide: true,
      body: `<div class="xr-dlg"><div class="field-row"><label class="field"><span class="field-label">Verweistyp</span><select class="select" name="kind">${kinds.map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Verweisen auf</span><select class="select" name="xk"><option value="text">Text (z. B. „Abbildung 2“ oder Überschrift)</option><option value="page">Seitenzahl</option></select></label></div>
        <div class="lk-list xr-list" role="listbox" aria-label="Ziele"></div>
        <p class="hint">Querverweise aktualisieren sich automatisch, wenn sich Nummern oder Seiten ändern.</p></div>`,
      actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Einfügen', value: 'ok', kind: 'btn-primary', default: true }],
      onMount: dlg => {
        fill(dlg);
        $('[name=kind]', dlg).addEventListener('change', e => { kind = e.target.value; fill(dlg); });
        return { collect: () => ({ kind, xk: $('[name=xk]', dlg).value, i: ($('[name=tgt]:checked', dlg) || {}).value }) };
      },
    });
    if (r.value !== 'ok' || !r.data || r.data.i == null) return;
    const t = targets(r.data.kind)[+r.data.i];
    if (!t) return;
    x.capture();
    const name = nameOfTarget(t);
    const bm = bmEl(name);
    const text = r.data.xk === 'page' ? (pageLabelOf(bm) || '1') : targetText(bm);
    x.restoreSel();
    x.insertInline(`<span class="xref" data-ref="${esc(name)}" data-xk="${r.data.xk}" contenteditable="false">${esc(text)}</span>&#8203;`);
    if (r.data.xk === 'page' && !x.pv.on) toast('Seitenzahlen von Querverweisen werden in der Seitenansicht aktualisiert.', 'info');
    x.changed(); x.refresh();
  }

  // ======================================================================= captions
  async function captionDialog() {
    if (x.plain) { toast('Beschriftungen gibt es nur in .docx-Dokumenten.', 'info'); return; }
    x.saveSel();
    const r0 = x.curRange();
    const el0 = r0 && (r0.startContainer.nodeType === 1 ? r0.startContainer : r0.startContainer.parentElement);
    const table = el0 && el0.closest('table');
    const img = table && ed.contains(table) ? null : x.getSelImg();
    const anchor = img ? (blockOf(img) || img) : table && ed.contains(table) ? table : null;
    const defLabel = table ? 'Tabelle' : 'Abbildung';
    const labels = [...new Set([...LABELS, ...$$('span.seq', ed).map(s => s.getAttribute('data-seq') || 'Abbildung')])];
    const r = await openDialog({
      title: 'Beschriftung einfügen',
      body: `<div class="cap-dlg"><div class="field-row"><label class="field"><span class="field-label">Bezeichnung</span><select class="select" name="label">${labels.map(l => `<option value="${esc(l)}" ${l === defLabel ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Position</span><select class="select" name="pos"><option value="below" ${table ? '' : 'selected'}>Unter dem Element</option><option value="above" ${table ? 'selected' : ''}>Über dem Element</option></select></label></div>
        <label class="field"><span class="field-label">Beschriftungstext</span><input class="input" name="text" placeholder="z. B. Umsatz im Jahresvergleich" autocomplete="off" autofocus></label>
        <p class="hint">${anchor ? (table ? 'Die Beschriftung gehört zur Tabelle, in der der Cursor steht.' : 'Die Beschriftung gehört zum ausgewählten Bild.') : 'Die Beschriftung wird als neuer Absatz an der Cursorposition eingefügt.'} Die Nummer zählt automatisch weiter.</p></div>`,
      actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Einfügen', value: 'ok', kind: 'btn-primary', default: true }],
      onMount: dlg => ({ collect: () => ({ label: $('[name=label]', dlg).value, pos: $('[name=pos]', dlg).value, text: $('[name=text]', dlg).value.trim() }) }),
    });
    if (r.value !== 'ok' || !r.data) return;
    const d = r.data;
    const html = `<p class="caption">${esc(d.label)} <span class="seq" data-seq="${esc(d.label)}" contenteditable="false">1</span>${d.text ? `: ${esc(d.text)}` : ''}</p>`;
    x.capture();
    let p;
    if (anchor) {
      const t = document.createElement('template'); t.innerHTML = html; p = t.content.firstChild;
      if (d.pos === 'above') anchor.before(p); else anchor.after(p);
    } else { x.restoreSel(); [p] = x.insertBlock(html); }
    if (p) { const rg = document.createRange(); rg.selectNodeContents(p); rg.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(rg); }
    x.changed(); x.refresh();
  }

  // ======================================================================= tables: sort, formula, convert
  async function sortDialog(td) {
    const table = td && td.closest('table');
    if (!table) return;
    if ($$('td[rowspan],th[rowspan]', table).some(c => +c.rowSpan > 1) || $$('td[colspan],th[colspan]', table).some(c => +c.colSpan > 1)) { toast('Tabellen mit verbundenen Zellen lassen sich nicht sortieren.', 'info'); return; }
    const rows = Array.from(table.rows);
    const hasHdr = rows[0] && (rows[0].hasAttribute('data-hdr') || /ts-(header|striped|minimal)/.test(table.className));
    const head = Array.from(rows[0].cells).map((c, i) => c.textContent.trim() || `Spalte ${i + 1}`);
    const col0 = cellPos(tableGrid(table), td).c;
    const r = await openDialog({
      title: 'Tabelle sortieren',
      body: `<div class="wf-dlg"><div class="field-row"><label class="field"><span class="field-label">Sortieren nach</span><select class="select" name="col">${head.map((t, i) => `<option value="${i}" ${i === col0 ? 'selected' : ''}>${esc(hasHdr ? t : `Spalte ${i + 1}`)}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Typ</span><select class="select" name="type"><option value="auto">Automatisch</option><option value="text">Text</option><option value="number">Zahl</option><option value="date">Datum</option></select></label></div>
        <div class="seg" role="group" aria-label="Reihenfolge"><button type="button" data-ord="asc" aria-pressed="true">Aufsteigend</button><button type="button" data-ord="desc" aria-pressed="false">Absteigend</button></div>
        <label class="check"><input type="checkbox" name="hdr" ${hasHdr ? 'checked' : ''}> Erste Zeile ist Überschrift (nicht sortieren)</label></div>`,
      actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Sortieren', value: 'ok', kind: 'btn-primary', default: true }],
      onMount: dlg => {
        let ord = 'asc';
        $$('[data-ord]', dlg).forEach(b => b.addEventListener('click', () => { ord = b.dataset.ord; $$('[data-ord]', dlg).forEach(y => y.setAttribute('aria-pressed', String(y === b))); }));
        return { collect: () => ({ col: +$('[name=col]', dlg).value, type: $('[name=type]', dlg).value, hdr: $('[name=hdr]', dlg).checked, ord }) };
      },
    });
    if (r.value !== 'ok' || !r.data) return;
    x.op(() => sortTable(table, r.data));
    toast('Tabelle sortiert', 'success');
  }
  function sortTable(table, { col, type = 'auto', hdr = true, ord = 'asc' }) {
    const rows = Array.from(table.rows);
    const body = rows.slice(hdr ? 1 : 0).filter(tr => !tr.hasAttribute('data-hdr') || !hdr);
    const parent = body[0] && body[0].parentElement;
    if (!parent) return;
    const dateKey = t => { const m = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(t); if (!m) return null; const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return y * 10000 + +m[2] * 100 + +m[1]; };
    const keyOf = tr => {
      const t = (tr.cells[col] ? tr.cells[col].textContent : '').replace(/\u200b/g, '').trim();
      if (!t) return { k: null, n: false };
      if (type === 'date' || (type === 'auto' && dateKey(t) != null)) return { k: dateKey(t), n: true };
      const n = cellNumber(t);
      if (type === 'number' || (type === 'auto' && n != null && /^[-+\d\s.,€%]*$/.test(t))) return { k: n, n: n != null };
      return { k: t.toLocaleLowerCase('de'), n: false };
    };
    const keyed = body.map((tr, i) => ({ tr, i, ...keyOf(tr) }));
    const coll = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
    keyed.sort((a, b) => {
      // empty cells always go last, whatever the direction
      if (a.k == null || b.k == null) return (a.k == null) - (b.k == null) || a.i - b.i;
      const c = a.n && b.n ? a.k - b.k : a.n !== b.n ? (a.n ? -1 : 1) : coll.compare(String(a.k), String(b.k));
      return (ord === 'desc' ? -c : c) || a.i - b.i;
    });
    const anchorTr = body[body.length - 1].nextElementSibling;
    keyed.forEach(k => parent.insertBefore(k.tr, anchorTr));
  }
  async function formulaDialog(td, existing = null) {
    const table = td.closest('table');
    const grid = tableGrid(table);
    const pos = cellPos(grid, td);
    const above = pos.r > 0 && grid[pos.r - 1][pos.c] && cellNumber(grid[pos.r - 1][pos.c].textContent) != null;
    const def = existing ? existing.getAttribute('data-f') : above ? '=SUM(ABOVE)' : '=SUM(LEFT)';
    const fmt0 = existing ? existing.getAttribute('data-fmt') || '' : /€/.test(table.textContent) ? '0,00 €' : '';
    const colName = c => String.fromCharCode(65 + c);
    const r = await openDialog({
      title: existing ? 'Formel bearbeiten' : 'Formel einfügen',
      body: `<div class="wf-dlg"><label class="field"><span class="field-label">Formel</span><input class="input mono" name="f" value="${esc(def)}" autocomplete="off" spellcheck="false" autofocus></label>
        <label class="field"><span class="field-label">Zahlenformat</span><select class="select" name="fmt">${TF_FORMATS.map(([k, l]) => `<option value="${esc(k)}" ${k === fmt0 ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <p class="hint" data-prev></p>
        <p class="hint">Diese Zelle ist <strong>${colName(pos.c)}${pos.r + 1}</strong>. Beispiele: =SUM(ABOVE) (Summe darüber), =SUM(LEFT), =AVERAGE(B2:B6), =C2*D2, =E5*19/100. Deutsche Namen wie SUMME(OBEN) gehen auch; Argumente mit „;“ trennen.</p></div>`,
      actions: [...(existing ? [{ label: 'Entfernen', value: 'remove', kind: 'btn-danger-ghost' }] : []), { label: 'Abbrechen', value: 'cancel' }, { label: existing ? 'Übernehmen' : 'Einfügen', value: 'ok', kind: 'btn-primary', default: true }],
      onMount: dlg => {
        const inp = $('[name=f]', dlg), fmt = $('[name=fmt]', dlg), prev = $('[data-prev]', dlg);
        const show = () => { try { const v = evalFormula(inp.value, { r: pos.r, c: pos.c, rows: grid.length, cols: Math.max(...grid.map(z => z.length)), value: (rr, cc) => { const cell = grid[rr] && grid[rr][cc]; return cell && cell !== td ? cellNumber(cell.textContent) : null; } }); prev.textContent = `Ergebnis: ${formatResult(v, fmt.value)}`; inp.classList.remove('bad'); } catch (e) { prev.textContent = e.message || 'Formel ungültig'; inp.classList.add('bad'); } };
        inp.addEventListener('input', show); fmt.addEventListener('change', show); show();
        return { collect: () => ({ f: inp.value, fmt: fmt.value }) };
      },
      validate: (v, dlg) => { if (v !== 'ok') return true; try { canonicalFormula($('[name=f]', dlg).value); return true; } catch { $('[name=f]', dlg).classList.add('bad'); return false; } },
    });
    if (r.value === 'remove' && existing) { x.op(() => existing.remove()); return; }
    if (r.value !== 'ok' || !r.data) return;
    const f = canonicalFormula(r.data.f);
    x.capture();
    if (existing) { existing.setAttribute('data-f', f); existing.setAttribute('data-fmt', r.data.fmt); }
    else {
      const html = `<span class="tf" data-f="${esc(f)}" data-fmt="${esc(r.data.fmt)}" contenteditable="false">0</span>`;
      if (!td.textContent.trim()) { td.innerHTML = `<p style="text-align:right">${html}</p>`; }
      else { x.restoreSel(); x.insertInline(html); }
    }
    x.changed(); x.refresh();
  }
  function textToTable(blocks) {
    const ps = blocks.filter(b => !b.closest('td,th') && b.textContent.trim());
    if (!ps.length) { toast('Markiere die Absätze, die zur Tabelle werden sollen (Spalten mit Tab oder ; trennen).', 'info'); return; }
    const sep = ps.some(p => p.textContent.includes('\t')) ? '\t' : ps.every(p => p.textContent.includes(';')) ? ';' : ps.every(p => p.textContent.includes(',')) ? ',' : '\t';
    const rows = ps.map(p => p.textContent.split(sep).map(t => t.trim()));
    const n = Math.max(...rows.map(r => r.length));
    x.op(() => {
      const t = document.createElement('table');
      t.innerHTML = `<colgroup>${'<col>'.repeat(n).replace(/<col>/g, `<col style="width:${(100 / n).toFixed(2)}%">`)}</colgroup><tbody>${rows.map(r => `<tr>${Array.from({ length: n }, (_, i) => `<td><p>${esc(r[i] || '') || '<br>'}</p></td>`).join('')}</tr>`).join('')}</tbody>`;
      ps[0].before(t);
      ps.forEach(p => p.remove());
    });
    toast(`Tabelle mit ${rows.length} Zeilen und ${n} Spalten erstellt`, 'success');
  }
  function tableToText(table) {
    x.op(() => {
      const frag = document.createDocumentFragment();
      for (const tr of Array.from(table.rows)) { const p = document.createElement('p'); p.textContent = Array.from(tr.cells).map(c => c.textContent.replace(/\s+/g, ' ').trim()).join('\t'); frag.appendChild(p); }
      table.replaceWith(frag);
    });
  }

  // ======================================================================= images: crop + rotate
  const loadImg = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Bild nicht lesbar')); im.src = src; });
  const outType = src => (/^data:image\/(png|svg|gif|webp)/i.test(src) ? 'image/png' : 'image/jpeg');
  async function cropDialog(img) {
    let im;
    try { im = await loadImg(img.src); } catch { toast('Das Bild kann nicht bearbeitet werden.', 'error'); return; }
    const W = im.naturalWidth, H = im.naturalHeight;
    const r = await openDialog({
      title: 'Bild zuschneiden', wide: true,
      body: `<div class="crop-dlg"><div class="crop-stage"><canvas width="10" height="10" aria-label="Vorschau"></canvas></div>
        <div class="crop-grid">${[['l', 'Links'], ['r', 'Rechts'], ['t', 'Oben'], ['b', 'Unten']].map(([k, l]) => `<label class="field"><span class="field-label">${l}: <output data-o="${k}">0</output> %</span><input type="range" min="0" max="45" value="0" name="${k}"></label>`).join('')}</div>
        <div class="hf-fields"><span class="muted small">Seitenverhältnis:</span>${[['', 'Frei'], ['1', '1:1'], ['1.3333', '4:3'], ['1.7778', '16:9'], ['0.75', '3:4']].map(([v, l]) => `<button type="button" class="chip" data-ar="${v}">${l}</button>`).join('')}</div></div>`,
      actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Zuschneiden', value: 'ok', kind: 'btn-primary', default: true }],
      onMount: dlg => {
        const cv = $('canvas', dlg), c2 = cv.getContext('2d');
        const sc = Math.min(1, 520 / W, 300 / H);
        cv.width = Math.round(W * sc); cv.height = Math.round(H * sc);
        const v = k => +$(`[name=${k}]`, dlg).value / 100;
        const paint = () => {
          c2.clearRect(0, 0, cv.width, cv.height);
          c2.drawImage(im, 0, 0, cv.width, cv.height);
          const L = v('l') * cv.width, R = v('r') * cv.width, T = v('t') * cv.height, B = v('b') * cv.height;
          c2.fillStyle = 'rgba(20,20,40,.55)';
          c2.fillRect(0, 0, cv.width, T); c2.fillRect(0, cv.height - B, cv.width, B); c2.fillRect(0, T, L, cv.height - T - B); c2.fillRect(cv.width - R, T, R, cv.height - T - B);
          c2.strokeStyle = '#fff'; c2.lineWidth = 2; c2.strokeRect(L + 1, T + 1, cv.width - L - R - 2, cv.height - T - B - 2);
          ['l', 'r', 't', 'b'].forEach(k => { $(`[data-o="${k}"]`, dlg).textContent = String(Math.round(v(k) * 100)); });
        };
        $$('input[type=range]', dlg).forEach(i => i.addEventListener('input', paint));
        $$('[data-ar]', dlg).forEach(b => b.addEventListener('click', () => {
          const ar = +b.dataset.ar;
          ['l', 'r', 't', 'b'].forEach(k => { $(`[name=${k}]`, dlg).value = 0; });
          if (ar) {
            const cur = W / H;
            if (cur > ar) { const keep = (H * ar) / W; const cut = Math.min(45, Math.round((1 - keep) / 2 * 100)); $('[name=l]', dlg).value = cut; $('[name=r]', dlg).value = cut; }
            else { const keep = (W / ar) / H; const cut = Math.min(45, Math.round((1 - keep) / 2 * 100)); $('[name=t]', dlg).value = cut; $('[name=b]', dlg).value = cut; }
          }
          paint();
        }));
        paint();
        return { collect: () => ({ l: v('l'), r: v('r'), t: v('t'), b: v('b') }) };
      },
    });
    if (r.value !== 'ok' || !r.data) return;
    const d = r.data;
    if (d.l + d.r + d.t + d.b < 0.005) return;
    const sx = Math.round(W * d.l), sy = Math.round(H * d.t), sw = Math.max(1, Math.round(W * (1 - d.l - d.r))), sh = Math.max(1, Math.round(H * (1 - d.t - d.b)));
    const c = document.createElement('canvas'); c.width = sw; c.height = sh;
    const g = c.getContext('2d');
    const type = outType(img.src);
    if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, sw, sh); }
    g.drawImage(im, sx, sy, sw, sh, 0, 0, sw, sh);
    const shownW = img.width || img.getBoundingClientRect().width;
    x.op(() => { img.src = c.toDataURL(type, 0.92); img.width = Math.max(24, Math.round(shownW * (sw / W))); img.removeAttribute('height'); });
    setTimeout(() => x.placeHandles(), 60);
    toast('Bild zugeschnitten', 'success');
  }
  async function rotateImage(img, dir = 1) {
    let im;
    try { im = await loadImg(img.src); } catch { toast('Das Bild kann nicht bearbeitet werden.', 'error'); return; }
    const W = im.naturalWidth, H = im.naturalHeight;
    const c = document.createElement('canvas'); c.width = H; c.height = W;
    const g = c.getContext('2d');
    const type = outType(img.src);
    if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, H, W); }
    g.translate(H / 2, W / 2); g.rotate(dir * Math.PI / 2); g.drawImage(im, -W / 2, -H / 2);
    const shownW = img.width || img.getBoundingClientRect().width;
    const maxW = x.contentWidthPx();
    x.op(() => { img.src = c.toDataURL(type, 0.92); img.width = Math.max(24, Math.min(maxW, Math.round(shownW * (H / W)))); img.removeAttribute('height'); });
    setTimeout(() => x.placeHandles(), 60);
  }

  // ======================================================================= tab stops + drop cap
  async function tabsDialog() {
    const blocks = x.selBlocks();
    if (!blocks.length) { toast('Setze den Cursor in einen Absatz.', 'info'); return; }
    let list = parseTabs(blocks[0].getAttribute('data-tabs'));
    const AL = [['left', 'Links'], ['center', 'Zentriert'], ['right', 'Rechts'], ['decimal', 'Dezimal']];
    const LD = [['none', 'Ohne'], ['dot', 'Punkte ……'], ['dash', 'Striche – – –'], ['line', 'Linie ____']];
    const cm = pt => String(Math.round(pt / 28.35 * 100) / 100).replace('.', ',');
    const render = dlg => { $('.tab-list', dlg).innerHTML = list.length ? list.map((t, i) => `<div class="bm-row"><span>${cm(t.pos)} cm · ${AL.find(a => a[0] === t.align)[1]}${t.leader !== 'none' ? ` · ${LD.find(l => l[0] === t.leader)[1]}` : ''}</span><button type="button" class="btn btn-ghost btn-sm" data-rm="${i}">Entfernen</button></div>`).join('') : '<p class="panel-empty">Keine eigenen Tabstopps – es gelten Standard-Tabstopps alle 1,25 cm.</p>'; };
    const r = await openDialog({
      title: 'Tabstopps', wide: true,
      body: `<div class="wf-dlg"><div class="field-row three"><label class="field"><span class="field-label">Position (cm)</span><input class="input" name="pos" inputmode="decimal" placeholder="z. B. 15,5"></label>
        <label class="field"><span class="field-label">Ausrichtung</span><select class="select" name="al">${AL.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Füllzeichen</span><select class="select" name="ld">${LD.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label></div>
        <button type="button" class="btn btn-ghost btn-sm" data-add>${oicon('tabStops')}<span>Tabstopp hinzufügen</span></button>
        <div class="tab-list"></div>
        <p class="hint">Mit der Tab-Taste springt der Text zum nächsten Tabstopp – z. B. rechtsbündige Preise mit Punkten in Speisekarten. Exakt dargestellt in PDF und .docx-Datei, im Editor angenähert.</p></div>`,
      actions: [{ label: 'Alle löschen', value: 'clear', kind: 'btn-danger-ghost' }, { label: 'Abbrechen', value: 'cancel' }, { label: 'Übernehmen', value: 'ok', kind: 'btn-primary', default: true }],
      onMount: dlg => {
        render(dlg);
        $('[data-add]', dlg).addEventListener('click', () => {
          const v = parseFloat(String($('[name=pos]', dlg).value).replace(',', '.'));
          if (!(v > 0 && v < 60)) { $('[name=pos]', dlg).classList.add('bad'); return; }
          $('[name=pos]', dlg).classList.remove('bad');
          list = list.filter(t => Math.abs(t.pos - v * 28.35) > 1).concat([{ pos: Math.round(v * 28.35 * 10) / 10, align: $('[name=al]', dlg).value, leader: $('[name=ld]', dlg).value }]).sort((a, b) => a.pos - b.pos);
          $('[name=pos]', dlg).value = '';
          render(dlg);
        });
        dlg.addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { list.splice(+b.dataset.rm, 1); render(dlg); } });
        return { collect: () => list };
      },
    });
    if (r.value === 'clear') { x.op(() => x.selBlocks().forEach(b => b.removeAttribute('data-tabs'))); return; }
    if (r.value !== 'ok') return;
    x.op(() => (x.selBlocks().length ? x.selBlocks() : blocks).forEach(b => { if (list.length) b.setAttribute('data-tabs', formatTabs(list)); else b.removeAttribute('data-tabs'); }));
  }
  function toggleDropCap() {
    const blocks = x.selBlocks().filter(b => b.tagName === 'P');
    if (!blocks.length) { toast('Setze den Cursor in einen normalen Absatz.', 'info'); return; }
    const on = !blocks[0].hasAttribute('data-dropcap');
    x.op(() => blocks.slice(0, 1).forEach(b => b.toggleAttribute('data-dropcap', on)));
  }

  // ======================================================================= paste options
  let pasteChip = null, lastPaste = null;
  function offerPasteOptions(data) {
    lastPaste = data;
    if (!pasteChip) {
      pasteChip = h(`<button class="w-pastechip" type="button" aria-label="Einfügeoptionen">${oicon('pasteText')}<span>Einfügeoptionen</span></button>`);
      pasteChip.addEventListener('mousedown', e => e.preventDefault());
      pasteChip.addEventListener('click', () => {
        officeMenu(pasteChip, [
          { label: 'Ursprüngliche Formatierung beibehalten', icon: 'painter', onClick: () => repaste('keep') },
          { label: 'Formatierung zusammenführen', icon: 'clearFormat', onClick: () => repaste('merge') },
          { label: 'Nur den Text übernehmen', icon: 'text', onClick: () => repaste('text') },
        ], { label: 'Einfügeoptionen' });
      });
      wrap.querySelector('.writer-main').appendChild(pasteChip);
    }
    const s = getSelection();
    const rect = s.rangeCount ? s.getRangeAt(0).getBoundingClientRect() : null;
    const main = wrap.querySelector('.writer-main').getBoundingClientRect();
    pasteChip.hidden = false;
    pasteChip.style.left = `${Math.max(8, Math.min(main.width - 190, (rect && rect.width + rect.left ? rect.right : main.left + 40) - main.left + 6))}px`;
    pasteChip.style.top = `${Math.max(8, Math.min(main.height - 48, (rect && rect.bottom ? rect.bottom : main.top + 60) - main.top + 6))}px`;
    clearTimeout(pasteChip._t);
    pasteChip._t = setTimeout(hidePasteChip, 12000);
  }
  function hidePasteChip() { if (pasteChip) pasteChip.hidden = true; }
  function repaste(mode) {
    if (!lastPaste) return;
    hidePasteChip();
    x.undo();
    ed.focus({ preventScroll: true });
    x.capture();
    if (mode === 'text' || !lastPaste.html) document.execCommand('insertText', false, lastPaste.text);
    else document.execCommand('insertHTML', false, mode === 'merge' ? mergeFormatting(lastPaste.html) : lastPaste.html);
    x.changed();
    lastPaste.mode = mode;
  }
  /** "Formatierung zusammenführen": keep structure (paragraphs, lists, tables, bold/italic/links), drop fonts, sizes and colours. */
  function mergeFormatting(html) {
    const t = document.createElement('template');
    t.innerHTML = html;
    t.content.querySelectorAll('[style]').forEach(el => {
      ['font-family', 'font-size', 'color', 'background-color', 'line-height', 'margin', 'margin-top', 'margin-bottom', 'text-indent'].forEach(p => el.style.removeProperty(p));
      if (!el.getAttribute('style')) el.removeAttribute('style');
    });
    t.content.querySelectorAll('span:not([class]):not([style])').forEach(sp => sp.replaceWith(...sp.childNodes));
    t.content.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(hd => { const p = document.createElement('p'); const b = document.createElement('strong'); b.append(...hd.childNodes); p.appendChild(b); hd.replaceWith(p); });
    return t.innerHTML;
  }

  // ======================================================================= floating format bar (+ keyboard-aware on phones)
  const coarse = matchMedia('(pointer: coarse)');
  const fbar = h(`<div class="w-fbar" role="toolbar" aria-label="Schnellformat" hidden>
    <button type="button" data-fb="bold" aria-label="Fett" title="Fett">${oicon('bold')}</button>
    <button type="button" data-fb="italic" aria-label="Kursiv" title="Kursiv">${oicon('italic')}</button>
    <button type="button" data-fb="underline" aria-label="Unterstrichen" title="Unterstrichen">${oicon('underline')}</button>
    <button type="button" data-fb="hilite" aria-label="Gelb hervorheben" title="Gelb hervorheben">${oicon('fill')}</button>
    <button type="button" data-fb="color" aria-label="Textfarbe" title="Textfarbe">${oicon('color')}</button>
    <span class="w-fbar-sep" aria-hidden="true"></span>
    <button type="button" data-fb="style" aria-label="Formatvorlage" title="Formatvorlage">${oicon('heading')}</button>
    <button type="button" data-fb="list" aria-label="Aufzählung" title="Aufzählung">${oicon('listUl')}</button>
    <button type="button" data-fb="link" aria-label="Link" title="Link">${oicon('link')}</button>
    <button type="button" data-fb="comment" aria-label="Kommentar" title="Kommentar">${oicon('comment')}</button>
    <button type="button" data-fb="clear" aria-label="Formatierung löschen" title="Formatierung löschen">${oicon('clearFormat')}</button>
  </div>`);
  wrap.querySelector('.writer-main').appendChild(fbar);
  fbar.addEventListener('mousedown', e => e.preventDefault());
  fbar.addEventListener('pointerdown', e => { x.saveSel(); if (e.pointerType !== 'mouse') e.preventDefault(); });
  fbar.addEventListener('click', e => {
    const b = e.target.closest('[data-fb]');
    if (!b) return;
    x.fbarAction(b.dataset.fb, b);
    setTimeout(placeFbar, 30);
  });
  let fbTimer = 0;
  function placeFbar() {
    const s = getSelection();
    const show = s.rangeCount && !s.isCollapsed && ed.contains(s.anchorNode) && ed.isContentEditable && !document.querySelector('dialog[open]') && !wrap.classList.contains('w-read') && s.toString().trim();
    if (!show) { fbar.hidden = true; return; }
    fbar.hidden = false;
    if (coarse.matches || matchMedia('(max-width: 720px)').matches) { fbar.classList.add('dock'); fbar.style.left = fbar.style.top = ''; return; }
    fbar.classList.remove('dock');
    const rect = s.getRangeAt(0).getBoundingClientRect();
    const main = wrap.querySelector('.writer-main').getBoundingClientRect();
    const bw = fbar.offsetWidth || 380, bh = fbar.offsetHeight || 44;
    let left = rect.left + rect.width / 2 - bw / 2 - main.left;
    let top = rect.top - main.top - bh - 10;
    if (top < 6) top = rect.bottom - main.top + 10;
    left = Math.max(6, Math.min(main.width - bw - 6, left));
    top = Math.max(6, Math.min(main.height - bh - 6, top));
    fbar.style.left = `${left}px`; fbar.style.top = `${top}px`;
  }
  const onSel = () => { clearTimeout(fbTimer); fbTimer = setTimeout(placeFbar, 160); if (pasteChip && !pasteChip.hidden && lastPaste && Date.now() - (lastPaste.at || 0) > 600) { /* keep until timeout */ } };
  document.addEventListener('selectionchange', onSel);
  wrap.querySelector('.writer-scroll').addEventListener('scroll', () => { if (!fbar.hidden && !fbar.classList.contains('dock')) placeFbar(); }, { passive: true });
  // keyboard height (visual viewport) → CSS variable, keep the caret visible above the keyboard
  const vv = window.visualViewport;
  const onVV = () => {
    if (!vv) return;
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    wrap.style.setProperty('--kb', `${kb > 60 ? kb : 0}px`);
    wrap.classList.toggle('kb-open', kb > 60);
    if (kb > 60) {
      const s = getSelection();
      if (s.rangeCount && ed.contains(s.anchorNode)) {
        const r = s.getRangeAt(0).getBoundingClientRect();
        const limit = vv.height + vv.offsetTop - 70;
        const sb = wrap.querySelector('.writer-scroll');
        if (r.bottom > limit && r.bottom) sb.scrollTop += r.bottom - limit + 16;
      }
    }
  };
  if (vv) { vv.addEventListener('resize', onVV); vv.addEventListener('scroll', onVV); }

  // ======================================================================= outline: move / promote sections
  function sectionOf(hd) {
    if (hd.parentElement !== ed) return null;
    const lvl = +hd.tagName[1];
    const els = [hd];
    for (let n = hd.nextElementSibling; n; n = n.nextElementSibling) { if (/^H[1-6]$/.test(n.tagName) && +n.tagName[1] <= lvl) break; els.push(n); }
    return els;
  }
  function moveSection(hd, dir) {
    const sec = sectionOf(hd);
    if (!sec) { toast('Nur Überschriften auf oberster Ebene lassen sich verschieben.', 'info'); return false; }
    const lvl = +hd.tagName[1];
    if (dir < 0) {
      let prev = hd.previousElementSibling;
      while (prev && !(/^H[1-6]$/.test(prev.tagName) && +prev.tagName[1] <= lvl)) prev = prev.previousElementSibling;
      if (!prev || +prev.tagName[1] < lvl) return false;
      x.op(() => { const frag = document.createDocumentFragment(); sec.forEach(e => frag.appendChild(e)); prev.before(frag); });
    } else {
      const last = sec[sec.length - 1];
      const next = last.nextElementSibling;
      if (!next || !/^H[1-6]$/.test(next.tagName) || +next.tagName[1] < lvl) return false;
      const nsec = sectionOf(next);
      x.op(() => { const frag = document.createDocumentFragment(); sec.forEach(e => frag.appendChild(e)); nsec[nsec.length - 1].after(frag); });
    }
    return true;
  }

  function destroy() {
    document.removeEventListener('selectionchange', onSel);
    if (vv) { vv.removeEventListener('resize', onVV); vv.removeEventListener('scroll', onVV); }
    clearTimeout(fbTimer);
  }

  return {
    updateFields, insertEndnote, endnoteMenu, renderEndnotes, bookmarkDialog, gotoTarget, linkDialog, crossRefDialog, captionDialog,
    sortDialog, sortTable, formulaDialog, textToTable, tableToText, cropDialog, rotateImage, tabsDialog, toggleDropCap,
    offerPasteOptions, hidePasteChip, placeFbar, moveSection, destroy, targets, ensureTarget,
  };
}
