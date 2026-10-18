// Tool: mail merge (Serienbrief) from an Excel or CSV list – one DIN 5008 letter per row as a single PDF for
// printing (blank backs for duplex on request) or one PDF per recipient in a ZIP. Placeholders {Column} in
// address, subject and text; {Briefanrede} builds "Sehr geehrte Frau Dr. …" from the gender/title/name
// columns; empty fields leave no gaps; dates, amounts and postcodes appear as in the spreadsheet (formatted
// cells, leading zeros restored). Live preview per recipient, warnings for unknown placeholders and rows
// without a complete address. Nothing leaves the browser.
import { el, s, form, userError, ensureCss, isoDate, fmtDate, clear, checkRow } from '../lib/tpl-core.js';
import { letterPdf } from '../lib/tpl-pdf.js';
import { senderSection, signatureSection, previewSection } from '../lib/tpl-letterui.js';
import { tableOf, fixPostcodes, detectColumns, recordOf, fill, defaultAddress, unknownPlaceholders, incompleteRows, fileNameOf } from '../lib/merge.js';
import { loadPdfLib, saveDoc } from '../lib/pdf.js';

ensureCss();

/** Raw rows (arrays of display strings) per sheet from an .xlsx or .csv/.txt file. */
async function readTable(input) {
  const name = input.name || '';
  if (/\.(csv|txt|tsv)$/i.test(name) || /text\//.test(input.file?.type || '')) {
    const { decodeText } = await import('../lib/shared/office/vendor.js');
    const { detectDelimiter, parseCsvText } = await import('../lib/shared/office/csv.js');
    const text = (await decodeText(input.file)).replace(/^﻿/, '');
    return [{ name: name.replace(/\.\w+$/, ''), rows: parseCsvText(text, detectDelimiter(text)) }];
  }
  const { readXlsx } = await import('../lib/shared/office/xlsx-read.js');
  const { displayOf, KEY } = await import('../lib/shared/office/workbook.js');
  const wb = await readXlsx(await input.bytes(), name);
  return wb.sheets.filter(sh => !sh.hidden).map(sh => {
    const rows = [];
    for (let r = 0; r <= sh.maxR; r++) {
      const row = [];
      for (let c = 0; c <= sh.maxC; c++) row.push(displayOf(sh.cells.get(KEY(r, c))));
      rows.push(row);
    }
    return { name: sh.name, rows };
  });
}

const DEF = lang => (lang === 'de'
  ? { subject: '', salutation: '{Briefanrede}', body: '', closing: 'Mit freundlichen Grüßen' }
  : { subject: '', salutation: '{Salutation}', body: '', closing: 'Kind regards' });

function modelFor(v, m, i, lang) {
  const rec = recordOf(m.table, m.table.rows[i] || m.table.cols.map(() => ''));
  const date = fmtDate(v.letterDate || isoDate(), lang);
  const F = t => fill(t, rec, m.roles, { lang, date });
  const lines = t => String(t || '').split('\n').map(x => x.trim()).filter(Boolean);
  const paras = t => String(t || '').replace(/\r/g, '').split(/\n\s*\n/).map(p => p.replace(/\s+$/g, '')).filter(p => p.trim());
  return {
    sender: lines([s(v.sName), s(v.sStreet), s(v.sCity)].join('\n')), contact: [s(v.sPhone), s(v.sMail)].filter(Boolean),
    recipient: lines(F(v.address)), dateLine: `${s(v.place) ? s(v.place) + ', ' : ''}${date}`, name: s(v.sName), lang,
    form: 'B', notices: [], info: [], refLine: null,
    subject: s(F(v.subject)), salutation: s(F(v.salutation)), blocks: paras(F(v.body)), closing: s(v.closing),
    signerExtra: lines(v.signerExtra), enclosures: lines(v.enclosures), cc: [], marks: { folds: true, punch: true },
  };
}

let api = null;

export default {
  labels: { back_to_files: { de: 'Zurück zum Serienbrief', en: 'Back to the mail merge' } },
  options: [
    { id: 'out', type: 'radio', default: 'one', label: { de: 'Ausgabe', en: 'Output' },
      choices: [
        { value: 'one', label: { de: 'Eine PDF mit allen Briefen', en: 'One PDF with all letters' }, hint: { de: 'Zum Drucken', en: 'For printing' } },
        { value: 'zip', label: { de: 'Eine PDF pro Empfänger (ZIP)', en: 'One PDF per recipient (ZIP)' }, hint: { de: 'Zum Verschicken per E-Mail', en: 'For sending by e-mail' } },
      ] },
    { id: 'duplex', type: 'toggle', default: false, when: v => v.out === 'one', label: { de: 'Für beidseitigen Druck', en: 'For double-sided printing' },
      hint: { de: 'Fügt nach Briefen mit ungerader Seitenzahl eine leere Seite ein, damit jeder Brief vorn beginnt.', en: 'Adds a blank page after letters with an odd page count, so every letter starts on a front side.' } },
    { id: 'fileName', type: 'text', default: '', when: v => v.out === 'zip', maxLength: 120, label: { de: 'Dateiname je Brief', en: 'File name per letter' },
      placeholder: { de: 'z. B. {Nachname} {Vorname}', en: 'e.g. {Last name} {First name}' }, hint: { de: 'Mit Platzhaltern aus deiner Liste. Leer = „Brief 1“, „Brief 2“ …', en: 'With placeholders from your list. Empty = “Letter 1”, “Letter 2” …' } },
  ],
  mountStage(stage, state, ctx) { api = mergeStage(stage, state, ctx); },
  onInputs() { api?.load(); },
  status(v) {
    const m = v.mm;
    if (!m?.table) return { ok: false, hint: { de: 'Lies eine Excel- oder CSV-Liste ein.', en: 'Load an Excel or CSV list.' } };
    if (!m.table.rows.length) return { ok: false, hint: { de: 'Die Liste enthält keine Zeilen.', en: 'The list has no rows.' } };
    const L = v.mmL || {};
    if (!s(L.sName) || !s(L.body)) return { ok: false, summary: { de: `${m.table.rows.length} Empfänger`, en: `${m.table.rows.length} recipients` }, hint: { de: 'Noch nötig: Absender und Brieftext.', en: 'Still needed: sender and letter text.' } };
    return { summary: { de: `${m.table.rows.length} Briefe`, en: `${m.table.rows.length} letters` } };
  },
  async run(inputs, opts, ctx) {
    const m = opts.mm, v = opts.mmL, lang = ctx.lang;
    if (!m?.table?.rows.length) throw userError('Keine Empfänger in der Liste.', 'No recipients in the list.');
    const sig = await api?.sig();
    const n = m.table.rows.length;
    const pdfs = [];
    for (let i = 0; i < n; i++) {
      if (i % 5 === 0) { ctx.progress(i / n, { de: `Brief ${i + 1} von ${n}`, en: `Letter ${i + 1} of ${n}` }); await ctx.tick(); }
      const { bytes, pages } = await letterPdf({ ...modelFor(v, m, i, lang), sig }, { lang });
      pdfs.push({ bytes, pages, name: fileNameOf(opts.fileName || '', recordOf(m.table, m.table.rows[i]), m.roles, i) });
    }
    const title = ctx.t({ de: 'Serienbrief', en: 'Mail merge' });
    const base = ctx.safeFileName(`${title}${s(v.subject) && !/\{/.test(v.subject) ? ' ' + s(v.subject) : ''}`);
    if (opts.out === 'zip') {
      const { createZip } = await import('../lib/shared/zip.js');
      const used = new Map();
      const files = pdfs.map(p => {
        let nm = ctx.safeFileName(p.name), k = used.get(nm.toLowerCase()) || 0;
        used.set(nm.toLowerCase(), k + 1);
        if (k) nm = `${nm} (${k + 1})`;
        return { name: `${nm}.pdf`, data: p.bytes };
      });
      ctx.progress(0.95, { de: 'ZIP wird gepackt …', en: 'Packing ZIP …' });
      const zip = await createZip(files);
      return { outputs: [{ name: `${base}.zip`, blob: new Blob([zip], { type: 'application/zip' }), note: ctx.t({ de: `${n} PDF-Dateien`, en: `${n} PDF files` }) }] };
    }
    const PDFLib = await loadPdfLib();
    const out = await PDFLib.PDFDocument.create();
    let blanks = 0;
    for (const [i, p] of pdfs.entries()) {
      if (i % 10 === 0) { ctx.progress(0.8 + 0.15 * (i / n), { de: 'Briefe werden zusammengeführt …', en: 'Combining letters …' }); await ctx.tick(); }
      const src = await PDFLib.PDFDocument.load(p.bytes);
      for (const pg of await out.copyPages(src, src.getPageIndices())) out.addPage(pg);
      if (opts.duplex && src.getPageCount() % 2 === 1 && i < pdfs.length - 1) { out.addPage([595.28, 841.89]); blanks++; }
    }
    const bytes = await saveDoc(out, { title });
    return { outputs: [{ name: `${base}.pdf`, blob: new Blob([bytes], { type: 'application/pdf' }), pages: out.getPageCount(),
      note: ctx.t({ de: `${n} Briefe${blanks ? ` · ${blanks} leere Rückseiten` : ''}`, en: `${n} letters${blanks ? ` · ${blanks} blank backs` : ''}` }) }] };
  },
};

function mergeStage(stage, state, ctx) {
  const lang = ctx.lang, de = lang === 'de';
  const w = (a, b) => (de ? a : b);
  const vals = state.values;
  const v = (vals.mmL ||= { letterDate: isoDate(), address: '', ...DEF(lang) });
  let pvs = null, current = 0, lastField = null, sheets = [], loading = null;
  const changed = () => { state.results.clear(); ctx.refresh(); pvs?.refresh(); checks(); };
  const f = form(v, lang, () => changed(), 'mm');

  // ---------------------------------------------------------------- the list
  const listInfo = el('p', { class: 'img-muted', id: 'mm-info' });
  const sheetSel = el('select', { id: 'mm-sheet', class: 'wt-input', hidden: true, aria: { label: w('Tabellenblatt', 'Sheet') } });
  const headerRow = checkRow({ id: 'mm-header', label: { de: 'Erste Zeile enthält die Spaltennamen', en: 'First row holds the column names' }, checked: true, lang, onChange: () => apply() });
  const headerChk = headerRow.querySelector('input');
  const zipNote = el('p', { class: 'img-muted', id: 'mm-zipnote', hidden: true });
  const tableWrap = el('div', { class: 'mm-table-wrap' });
  const chips = el('div', { class: 'mm-chips', id: 'mm-chips' });
  sheetSel.addEventListener('change', () => apply());

  async function load() {
    const input = state.inputs.find(i => !i.error);
    if (!input) return;
    if (loading?.input === input) return loading.p;
    const p = (async () => {
      listInfo.textContent = w('Liste wird gelesen …', 'Reading the list …');
      try { sheets = await readTable(input); } catch (err) {
        sheets = [];
        listInfo.textContent = err?.userMessage?.[lang] || w('Die Datei ließ sich nicht als Tabelle lesen. Speichere sie als .xlsx oder .csv.', 'The file could not be read as a table. Save it as .xlsx or .csv.');
        vals.mm = null; ctx.refresh(); return;
      }
      clear(sheetSel);
      sheets.forEach((sh, i) => sheetSel.append(el('option', { value: String(i) }, sh.name)));
      // pick the first sheet that has data
      sheetSel.value = String(Math.max(0, sheets.findIndex(sh => sh.rows.some(r => r.some(x => String(x).trim())))));
      sheetSel.hidden = sheets.length < 2;
      apply(true);
    })();
    loading = { input, p };
    return p;
  }
  function apply(first = false) {
    const sh = sheets[+sheetSel.value || 0];
    if (!sh) return;
    const table = tableOf(sh.rows, { header: headerChk.checked });
    const fixedZip = fixPostcodes(table);
    const roles = detectColumns(table.cols);
    vals.mm = { table, roles };
    if (first || !v.address) { v.address = defaultAddress(roles, lang); addrArea.querySelector('textarea').value = v.address; }
    current = 0;
    listInfo.textContent = w(`${table.rows.length} Empfänger · ${table.cols.length} Spalten`, `${table.rows.length} recipients · ${table.cols.length} columns`);
    zipNote.hidden = !fixedZip;
    zipNote.textContent = fixedZip === 1
      ? w('1 Postleitzahl hatte ihre führende Null verloren (z. B. 1067 statt 01067) – ergänzt.', '1 postcode had lost its leading zero (e.g. 1067 instead of 01067) – restored.')
      : w(`${fixedZip} Postleitzahlen hatten ihre führende Null verloren (z. B. 1067 statt 01067) – ergänzt.`, `${fixedZip} postcodes had lost their leading zero (e.g. 1067 instead of 01067) – restored.`);
    renderTable(); renderChips(); changed();
  }
  function renderTable() {
    const { table } = vals.mm;
    const t = el('table', { class: 'mm-table' }, el('thead', {}, el('tr', {}, el('th', {}, '#'), table.cols.map(c => el('th', {}, c)))),
      el('tbody', {}, table.rows.slice(0, 5).map((r, i) => el('tr', {}, el('td', {}, String(i + 1)), r.map(x => el('td', {}, x))))));
    clear(tableWrap).append(t);
    if (table.rows.length > 5) tableWrap.append(el('p', { class: 'img-muted' }, w(`… und ${table.rows.length - 5} weitere`, `… and ${table.rows.length - 5} more`)));
  }
  function renderChips() {
    clear(chips);
    const names = [...vals.mm.table.cols, de ? 'Briefanrede' : 'Salutation', de ? 'Anrede Anschrift' : 'Address title', de ? 'Datum' : 'Date'];
    for (const n of names) chips.append(el('button', { type: 'button', class: 'mm-chip', onclick: () => insert(`{${n}}`) }, `{${n}}`));
  }
  function insert(token) {
    const t = lastField && document.contains(lastField) ? lastField : document.getElementById('mm-body');
    if (!t) return;
    const a = t.selectionStart ?? t.value.length, b = t.selectionEnd ?? t.value.length;
    t.value = t.value.slice(0, a) + token + t.value.slice(b);
    t.focus(); t.setSelectionRange(a + token.length, a + token.length);
    t.dispatchEvent(new Event('input', { bubbles: true }));
  }
  stage.addEventListener('focusin', e => { if (e.target.matches?.('#mm-address, #mm-subject, #mm-salutation, #mm-body')) lastField = e.target; });

  // ---------------------------------------------------------------- letter
  const sender = senderSection(f, v, lang);
  const sig = signatureSection(f, lang, () => changed());
  const addrArea = f.area('address', { de: 'Anschrift (Platzhalter aus deiner Liste)', en: 'Address (placeholders from your list)' }, { rows: 5, hint: { de: 'Zeilen, deren Felder leer sind, fallen weg.', en: 'Lines whose fields are empty are left out.' } });
  const problems = el('div', { class: 'mm-problems', id: 'mm-problems', aria: { live: 'polite' } });

  // recipient stepper for the preview
  const pos = el('span', { class: 'mm-pos', id: 'mm-pos' });
  const go = d => { const n = vals.mm?.table.rows.length || 0; if (!n) return; current = (current + d + n) % n; pvs?.refresh(); pos.textContent = `${current + 1} / ${n}`; };
  const stepper = el('div', { class: 'mm-step' },
    el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', id: 'mm-prev', aria: { label: w('Vorheriger Empfänger', 'Previous recipient') }, onclick: () => go(-1) }, '‹'), pos,
    el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', id: 'mm-next', aria: { label: w('Nächster Empfänger', 'Next recipient') }, onclick: () => go(1) }, '›'));

  function checks() {
    const m = vals.mm;
    clear(problems);
    if (!m) return;
    pos.textContent = m.table.rows.length ? `${current + 1} / ${m.table.rows.length}` : '–';
    const unknown = unknownPlaceholders([v.address, v.subject, v.salutation, v.body], m.table.cols);
    const bad = incompleteRows(m.table, v.address, m.roles);
    const add = text => problems.append(el('p', { class: 'img-note' }, text));
    if (unknown.length) add(w(`Diese Platzhalter passen zu keiner Spalte und bleiben leer: ${unknown.map(x => `{${x}}`).join(', ')}.`, `These placeholders match no column and stay empty: ${unknown.map(x => `{${x}}`).join(', ')}.`));
    if (bad.length) add(w(`Unvollständige Anschrift in Zeile ${bad.slice(0, 8).join(', ')}${bad.length > 8 ? ` und ${bad.length - 8} weiteren` : ''}.`, `Incomplete address in row ${bad.slice(0, 8).join(', ')}${bad.length > 8 ? ` and ${bad.length - 8} more` : ''}.`));
  }

  pvs = previewSection(f, lang, () => (vals.mm ? modelFor(v, vals.mm, current, lang) : modelFor(v, { table: { cols: [], rows: [] }, roles: {} }, 0, lang)), () => sig.pad.export());

  stage.append(el('div', { class: 'tpl-split' }, el('div', {},
    f.sec('mm-h-list', { de: 'Deine Liste', en: 'Your list' }, listInfo, sheetSel,
      headerRow,
      zipNote, tableWrap),
    f.sec('mm-h-fields', { de: 'Platzhalter', en: 'Placeholders' },
      el('p', { class: 'img-muted' }, w('Tippe auf ein Feld, um es an der Cursorposition einzufügen. {Briefanrede} wird je nach Anrede zu „Sehr geehrte Frau …“, „Sehr geehrter Herr …“ oder „Sehr geehrte Damen und Herren“.',
        'Tap a field to insert it at the cursor. {Salutation} becomes “Dear Ms …”, “Dear Mr …” or “Dear Sir or Madam”.')), chips),
    f.sec('mm-h-letter', { de: 'Brief', en: 'Letter' },
      addrArea,
      f.field('subject', { de: 'Betreff', en: 'Subject' }, { wide: true, maxLength: 300 }),
      f.field('salutation', { de: 'Anrede', en: 'Salutation' }, { wide: true, maxLength: 300 }),
      f.area('body', { de: 'Text', en: 'Text' }, { rows: 9, maxLength: 20000, hint: { de: 'Absätze mit einer Leerzeile trennen. Platzhalter gehen überall.', en: 'Separate paragraphs with an empty line. Placeholders work everywhere.' } }),
      f.field('closing', { de: 'Grußformel', en: 'Closing' }, { wide: true }),
      f.area('signerExtra', { de: 'Zusatz unter dem Namen (optional)', en: 'Line below the name (optional)' }, { rows: 2 }),
      f.area('enclosures', { de: 'Anlagen (eine pro Zeile, optional)', en: 'Enclosures (one per line, optional)' }, { rows: 2 }),
      problems),
    sender.sec, sig.sec), el('div', { class: 'tpl-side' }, el('div', { class: 'mm-pvhead' }, el('span', { class: 'img-muted' }, w('Vorschau für Empfänger', 'Preview for recipient')), stepper), pvs.sec)));
  load();
  return { load, sig: () => sig.pad.export() };
}
