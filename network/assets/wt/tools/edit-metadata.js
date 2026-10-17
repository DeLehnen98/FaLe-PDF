// Tool: view and edit PDF document properties (title, author, subject, keywords, creator, producer,
// dates), see hidden data (XMP, attachments, JavaScript, comment authors, application data) and remove
// all of it with one tap. Saved exactly as entered (no producer stamp).
import { el, clear } from '../lib/dom.js';
import { loadPdfLib } from '../lib/pdf.js';
import { inventory, stripPrivate, INFO_KEYS } from '../lib/sec-strip.js';
import { ensureCss, tr, ic, btn, statusLine, pdfBlob, watchUnlock } from '../lib/sec-ui.js';

const LABELS = {
  Title: ['Titel', 'Title'], Author: ['Autor', 'Author'], Subject: ['Thema', 'Subject'], Keywords: ['Stichwörter', 'Keywords'],
  Creator: ['Erstellt mit (Programm)', 'Created with (application)'], Producer: ['PDF erzeugt von', 'PDF produced by'],
  CreationDate: ['Erstellt am', 'Created on'], ModDate: ['Geändert am', 'Modified on'],
};
// edit state (module scope; tied to the current input)
let S = null;

const pad = n => String(n).padStart(2, '0');
const toLocal = d => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` : '');
const fromLocal = s => { if (!s) return null; const d = new Date(s); return isNaN(d) ? null : d; };

export default {
  options: [],

  mountStage(stage, state, ctx) {
    ensureCss();
    stage.classList.add('sec-stage');
    this._stage = stage; this._state = state; this._lang = ctx.lang;
    this.onInputs(state.inputs.filter(i => !i.error && !i.locked));
    watchUnlock(stage, state, inputs => this.onInputs(inputs));
  },

  async onInputs(inputs) {
    const stage = this._stage;
    if (!stage) return;
    const input = inputs.find(i => !i.locked);
    if (!input) { clear(stage); S = null; return; }
    if ((S && S.inputId === input.id) || this._loading === input.id) return;
    this._loading = input.id;
    const L = this._lang;
    clear(stage).append(el('p', { class: 'sec-status' }, tr(L, 'Eigenschaften werden gelesen …', 'Reading properties …')));
    let inv;
    try {
      const PDFLib = await loadPdfLib();
      inv = inventory(PDFLib, await input.pdfDoc());
    } catch (err) { console.warn(err); clear(stage); this._loading = null; return; }
    this._loading = null;
    const info = {};
    for (const k of INFO_KEYS) info[k] = /Date$/.test(k) ? toLocal(inv.info[k]) : (inv.info[k] || '');
    S = { inputId: input.id, inv, info, orig: { ...info }, strip: { xmp: !!inv.xmp, attachments: false, scripts: false, authors: false, custom: false, pieceInfo: false }, all: false };
    render(stage, this._state, L);
  },

  async run(inputs, opts, ctx) {
    const input = inputs[0];
    const PDFLib = await loadPdfLib();
    if (!S || S.inputId !== input.id) {
      const inv = inventory(PDFLib, await input.pdfDoc());
      S = { inputId: input.id, inv, info: {}, orig: {}, strip: {}, all: false };
      for (const k of INFO_KEYS) S.orig[k] = S.info[k] = /Date$/.test(k) ? toLocal(inv.info[k]) : (inv.info[k] || '');
    }
    ctx.progress(0.1, { de: 'Wird gelesen …', en: 'Reading …' });
    const doc = await input.pdfDoc();
    const { PDFName, PDFDict, PDFHexString } = PDFLib;
    const removed = [];
    if (S.all) {
      const n = await stripPrivate(PDFLib, doc, {});
      if (n.attachments) removed.push(ctx.t({ de: `${n.attachments} Anhang/Anhänge`, en: `${n.attachments} attachment(s)` }));
      if (n.scripts) removed.push(ctx.t({ de: `${n.scripts} Skript(e)/Aktion(en)`, en: `${n.scripts} script(s)/action(s)` }));
      if (n.xmp) removed.push('XMP');
    } else {
      const w = S.strip;
      const any = w.xmp || w.attachments || w.scripts || w.authors || w.pieceInfo;
      if (any) await stripPrivate(PDFLib, doc, { info: false, xmp: !!w.xmp, attachments: !!w.attachments, scripts: !!w.scripts, authors: !!w.authors, pieceInfo: !!w.pieceInfo, thumbs: false });
    }
    await ctx.tick();
    // Info dictionary – exactly what the user entered
    let infoDict = doc.context.lookup(doc.context.trailerInfo.Info);
    if (!(infoDict instanceof PDFDict)) { infoDict = doc.context.obj({}); doc.context.trailerInfo.Info = doc.context.register(infoDict); }
    if (S.all || S.strip.custom) for (const [k] of infoDict.entries()) if (!INFO_KEYS.includes(k.asString().slice(1))) infoDict.delete(k);
    for (const k of INFO_KEYS) {
      const v = S.all ? '' : String(S.info[k] ?? '').trim();
      if (!v) { infoDict.delete(PDFName.of(k)); continue; }
      if (/Date$/.test(k)) { const d = fromLocal(v); if (d) infoDict.set(PDFName.of(k), PDFLib.PDFString.fromDate(d)); }
      else infoDict.set(PDFName.of(k), PDFHexString.fromText(v));
    }
    if (!infoDict.entries().length) { doc.context.trailerInfo.Info = undefined; }
    ctx.progress(0.7, { de: 'Wird gespeichert …', en: 'Saving …' });
    let bytes;
    const pw = doc.wtEncrypted && (doc.wtPassword || input.password);
    if (pw) {
      const { encryptDocument } = await import('../lib/shared/pdfcrypt.js');
      await encryptDocument(PDFLib, doc, { userPassword: pw, objectStreams: true });
      bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
      ctx.note({ de: 'Die Datei ist wieder mit demselben Passwort geschützt.', en: 'The file is protected again with the same password.' });
    } else {
      bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
    }
    if (S.all) ctx.note({ de: 'Alle Dokumenteigenschaften, XMP-Metadaten, Anhänge, Skripte, Programmdaten und Autorennamen in Kommentaren wurden entfernt.', en: 'All document properties, XMP metadata, attachments, scripts, application data and author names in comments were removed.' });
    else if (removed.length) ctx.note(removed.join(', '));
    const suffix = S.all ? (ctx.lang === 'de' ? ' (bereinigt)' : ' (cleaned)') : (ctx.lang === 'de' ? ' (Eigenschaften)' : ' (properties)');
    return { outputs: [{ name: ctx.fileName(input.name, suffix, 'pdf'), blob: pdfBlob(bytes), pages: doc.getPageCount() }] };
  },
};

function render(stage, state, L) {
  const bump = () => { state.values.metaRev = (state.values.metaRev || 0) + 1; };
  const inv = S.inv;
  const status = statusLine();
  const fields = {};
  const fieldNodes = INFO_KEYS.map(k => {
    const id = `sec-meta-${k}`;
    const date = /Date$/.test(k);
    const input = el('input', { id, class: 'wt-input', type: date ? 'datetime-local' : 'text', value: S.info[k], autocomplete: 'off', spellcheck: k === 'Keywords' || k === 'Title' || k === 'Subject' ? 'true' : 'false',
      enterkeyhint: 'next', oninput: () => { S.info[k] = input.value; S.all = false; allBtn.setAttribute('aria-pressed', 'false'); bump(); } });
    fields[k] = input;
    return el('div', { class: 'wt-opt' }, el('label', { for: id }, LABELS[k][L === 'de' ? 0 : 1]), input,
      k === 'Keywords' ? el('p', { class: 'wt-opt-hint' }, tr(L, 'Mehrere Stichwörter mit Komma trennen.', 'Separate several keywords with commas.')) : null);
  });
  const reset = btn('undo', tr(L, 'Ursprüngliche Werte', 'Original values'), () => {
    for (const k of INFO_KEYS) { S.info[k] = S.orig[k]; fields[k].value = S.orig[k]; }
    S.all = false; allBtn.setAttribute('aria-pressed', 'false'); bump();
    status.set(tr(L, 'Ursprüngliche Werte wiederhergestellt.', 'Original values restored.'), 'ok');
  });
  const now = btn('calendar', tr(L, 'Änderungsdatum: jetzt', 'Modified: now'), () => {
    fields.ModDate.value = S.info.ModDate = toLocal(new Date()); bump();
  });

  // hidden data
  const checks = [];
  const check = (key, label, count, hint) => {
    if (!count) return null;
    const id = `sec-strip-${key}`;
    const box = el('input', { type: 'checkbox', id, checked: !!S.strip[key], onchange: () => { S.strip[key] = box.checked; S.all = false; allBtn.setAttribute('aria-pressed', 'false'); bump(); } });
    checks.push([key, box]);
    return el('div', {}, el('label', { class: 'sec-check', for: id }, box, el('span', {}, label)), hint ? el('p', { class: 'sec-small' }, hint) : null);
  };
  const customKeys = Object.keys(inv.info.custom || {});
  const items = [
    check('xmp', tr(L, 'XMP-Metadaten entfernen', 'Remove XMP metadata'), inv.xmp != null || inv.xmpStreams,
      tr(L, 'Eine zweite Kopie der Angaben (oft mit Autor und Programmverlauf). Bleibt sie drin, zeigen manche Programme die alten Werte.', 'A second copy of the properties (often with author and editing history). If kept, some programs show the old values.')),
    check('custom', tr(L, `Eigene Felder entfernen (${customKeys.join(', ')})`, `Remove custom fields (${customKeys.join(', ')})`), customKeys.length),
    check('attachments', tr(L, `Anhänge entfernen (${inv.attachments.length})`, `Remove attachments (${inv.attachments.length})`), inv.attachments.length),
    check('scripts', tr(L, `JavaScript und Aktionen entfernen (${inv.scripts.length})`, `Remove JavaScript and actions (${inv.scripts.length})`), inv.scripts.length),
    check('authors', tr(L, `Autorennamen in Kommentaren entfernen (${inv.authors.length})`, `Remove author names in comments (${inv.authors.length})`), inv.authors.length),
    check('pieceInfo', tr(L, 'Programm-interne Daten entfernen', 'Remove application private data'), inv.pieceInfo),
  ].filter(Boolean);

  const allBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet sec-big-btn', aria: { pressed: S.all ? 'true' : 'false' } }, ic('shield'), tr(L, 'Alles Private entfernen', 'Remove everything private'));
  allBtn.addEventListener('click', () => {
    S.all = true;
    for (const k of INFO_KEYS) { S.info[k] = ''; fields[k].value = ''; }
    for (const [k, box] of checks) { S.strip[k] = true; box.checked = true; }
    allBtn.setAttribute('aria-pressed', 'true');
    bump();
    status.set(tr(L, 'Alles markiert: Eigenschaften, XMP, Anhänge, Skripte, Programmdaten und Autorennamen werden beim Speichern entfernt. Tippe unten auf „Speichern“.',
      'Everything selected: properties, XMP, attachments, scripts, application data and author names are removed when saving. Tap “Save” below.'), 'ok');
  });

  const hidden = [];
  if (inv.attachments.length) hidden.push(el('div', {}, el('p', { class: 'sec-h' }, ic('file'), tr(L, 'Anhänge', 'Attachments')),
    el('ul', { class: 'sec-list' }, inv.attachments.map(a => el('li', {}, el('span', { class: 'sec-li-name' }, a.name),
      el('span', { class: 'sec-li-meta' }, [a.desc, a.size != null ? `${a.size} B` : null, a.where === 'doc' ? null : a.where].filter(Boolean).join(' · ') || ' '))))));
  if (inv.scripts.length) hidden.push(el('div', {}, el('p', { class: 'sec-h' }, ic('alert'), tr(L, 'JavaScript und Aktionen', 'JavaScript and actions')),
    el('ul', { class: 'sec-list' }, inv.scripts.map(s => el('li', {}, el('span', { class: 'sec-li-name' }, s.kind + (s.name ? ` „${s.name}“` : '')),
      el('span', { class: 'sec-li-meta' }, s.where === 'doc' ? tr(L, 'Dokument', 'Document') : s.where === 'open' ? tr(L, 'Beim Öffnen', 'On open') : s.where))))));
  if (inv.authors.length) hidden.push(el('dl', { class: 'sec-kv' }, el('dt', {}, tr(L, 'Autoren in Kommentaren', 'Authors in comments')), el('dd', {}, inv.authors.join(', '))));
  if (customKeys.length) hidden.push(el('dl', { class: 'sec-kv' }, customKeys.flatMap(k => [el('dt', {}, k), el('dd', {}, inv.info.custom[k])])));
  if (inv.xmp) hidden.push(el('details', { class: 'sec-details' }, el('summary', {}, tr(L, 'XMP-Metadaten anzeigen', 'Show XMP metadata')), el('pre', { class: 'sec-xmp' }, inv.xmp.slice(0, 20000))));
  const facts = el('div', { class: 'sec-tags' },
    el('span', { class: 'sec-tag' }, tr(L, `${inv.pages} Seiten`, `${inv.pages} pages`)),
    inv.fields ? el('span', { class: 'sec-tag' }, tr(L, `${inv.fields} Formularfelder`, `${inv.fields} form fields`)) : null,
    inv.links ? el('span', { class: 'sec-tag' }, tr(L, `${inv.links} Links`, `${inv.links} links`)) : null,
    el('span', { class: 'sec-tag' + (inv.xmp ? ' is-on' : '') }, inv.xmp ? 'XMP' : tr(L, 'kein XMP', 'no XMP')),
    el('span', { class: 'sec-tag' + (inv.attachments.length ? ' is-on' : '') }, tr(L, `${inv.attachments.length} ${inv.attachments.length === 1 ? 'Anhang' : 'Anhänge'}`, `${inv.attachments.length} attachment${inv.attachments.length === 1 ? '' : 's'}`)),
    el('span', { class: 'sec-tag' + (inv.scripts.length ? ' is-on' : '') }, tr(L, `${inv.scripts.length} ${inv.scripts.length === 1 ? 'Skript/Aktion' : 'Skripte/Aktionen'}`, `${inv.scripts.length} script${inv.scripts.length === 1 ? '' : 's'}/action${inv.scripts.length === 1 ? '' : 's'}`)));

  clear(stage).append(
    el('div', { class: 'sec-card' }, el('h3', { class: 'sec-h' }, ic('shield'), tr(L, 'Private Daten', 'Private data')),
      el('p', { class: 'sec-sub' }, tr(L, 'Entfernt mit einem Tipp alle Eigenschaften und versteckten Daten – praktisch, bevor du eine PDF weitergibst.', 'Removes all properties and hidden data with one tap – handy before you pass a PDF on.')),
      allBtn, facts),
    el('div', { class: 'sec-card' }, el('h3', { class: 'sec-h' }, ic('pen'), tr(L, 'Dokumenteigenschaften', 'Document properties')),
      el('div', { class: 'sec-meta-grid' }, fieldNodes), el('div', { class: 'sec-row' }, reset, now)),
    items.length || hidden.length ? el('div', { class: 'sec-card' }, el('h3', { class: 'sec-h' }, ic('layers'), tr(L, 'Versteckte Daten', 'Hidden data')), ...items, ...hidden)
      : el('p', { class: 'sec-info' }, ic('check'), tr(L, 'Keine Anhänge, Skripte oder XMP-Metadaten gefunden.', 'No attachments, scripts or XMP metadata found.')),
    status.node);
}
