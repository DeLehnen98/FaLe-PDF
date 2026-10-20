// Tool „Formulardaten sammeln“: the entries of many filled-in PDF forms in one Excel table – one row per file, one
// column per field (Vereine, Vermieter, Lehrkräfte, kleine Firmen, die viele Formulare zurückbekommen).
// Reads the form fields of each PDF; for PDFs filled in FaLe and saved „Später in FaLe änderbar“ also the fixed ones
// (from the form memory, js/tools/formmemory.js). Everything stays on the device.
import * as db from '../db.js';
import { icon } from '../icons.js';
import { $, h, esc, toast, errorToast, progress } from '../ui.js';
import { thumbHtml, pickDocsDialog } from '../components.js';
import { getDocBytes, saveFile, importFiles } from '../library.js';
import { loadEditable, loadPdfLib } from '../pdflib.js';
import { oicon } from '../office/kinds.js';
import { resultDialog } from '../office/shell.js';
import { ensureCss } from './common.js';
import { t as tr } from '../i18n/index.js';

/** Field values of one PDF → { fields: [{key, label, value}], source: 'form'|'memory'|'none' }. */
export async function readFormData(bytes, name, key) {
  const PDFLib = await loadPdfLib();
  const doc = await loadEditable(bytes, name, { key });
  let source = 'form';
  const fm = await import('./formmemory.js');
  let list = doc.getForm().getFields();
  if (!list.length && fm.hasMemory(PDFLib, doc)) {
    const m = await fm.readMemory(PDFLib, doc);
    if (m && m.ok) { fm.restore(PDFLib, doc); list = doc.getForm().getFields(); source = 'memory'; }
  }
  const out = [];
  for (const f of list) {
    let value = null;
    try {
      if (f instanceof PDFLib.PDFTextField) value = f.getText() || '';
      else if (f instanceof PDFLib.PDFCheckBox) value = f.isChecked() ? 'Ja' : '';
      else if (f instanceof PDFLib.PDFRadioGroup) value = f.getSelected() || '';
      else if (f instanceof PDFLib.PDFDropdown || f instanceof PDFLib.PDFOptionList) value = (f.getSelected() || []).join(', ');
      else continue; // buttons, signatures
    } catch { continue; }
    let label = '';
    try { const tu = f.acroField.dict.lookup(PDFLib.PDFName.of('TU')); if (tu && tu.decodeText) label = tu.decodeText(); } catch {}
    out.push({ key: f.getName(), label: label || f.getName(), value });
  }
  return { fields: out, source: out.length ? source : 'none' };
}

/** „12,50“ / „1.234,5“ / „42“ → number (for sums in the table); leading zeros (PLZ, Kundennummer) stay text. */
export function asNumber(v) {
  const s = String(v).trim();
  if (!/^-?(?:0|[1-9]\d{0,2}(?:\.\d{3})+|[1-9]\d*)(?:,\d+)?$/.test(s) && !/^-?(?:0|[1-9]\d*)\.\d+$/.test(s)) return null;
  const n = Number(/,/.test(s) || /\.\d{3}(?:\.|$)/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : null;
}

/** Rows → columns: union of field names in order of first appearance. */
export function tableOf(rows) {
  const cols = [], seen = new Map();
  for (const r of rows) for (const f of r.fields) if (!seen.has(f.key)) { seen.set(f.key, cols.length); cols.push({ key: f.key, label: f.label }); }
  return { cols, rows: rows.map(r => ({ name: r.name, source: r.source, values: cols.map(c => { const f = r.fields.find(x => x.key === c.key); return f ? f.value : ''; }) })) };
}

export async function mount(screen, { docId }) {
  await ensureCss();
  const items = []; // {doc, data}
  const wrap = h(`<div class="screen-inner">
    <div class="card intro"><span class="tile-ic">${oicon('table')}</span><div><strong>Formulardaten sammeln</strong>
      <p>Wähle ausgefüllte PDF-Formulare – FaLe macht daraus eine Tabelle: eine Zeile pro Formular, eine Spalte pro Feld. Alles bleibt auf deinem Gerät.</p></div></div>
    <div class="toolbar"><button class="btn btn-soft" type="button" data-add>${icon('plus')} Formulare hinzufügen</button><span class="grow"></span><span class="muted small" data-sum></span></div>
    <div class="order-list fd-files" data-list></div>
    <div class="fd-preview" data-preview></div></div>`);
  screen.body.appendChild(wrap);
  const list = $('[data-list]', wrap), preview = $('[data-preview]', wrap);
  const saveBtn = h(`<button class="btn btn-primary" type="button" data-save>${oicon('ksheet')} Als Excel-Tabelle speichern</button>`);

  async function add(docs) {
    const prog = docs.length > 1 ? progress('Lese Formulare …') : null;
    try {
      for (let i = 0; i < docs.length; i++) {
        const d = docs[i];
        if (items.some(x => x.doc.id === d.id)) continue;
        if (prog) prog.set(`Lese Formulare … ${i + 1}/${docs.length}`);
        let data;
        try { data = await readFormData(await getDocBytes(d.id), d.name, d.id); } catch (e) { console.warn('Formulardaten', d.name, e); data = { fields: [], source: 'error' }; }
        items.push({ doc: d, data });
      }
    } finally { if (prog) prog.done(); }
    render();
  }

  function render() {
    list.innerHTML = '';
    if (!items.length) list.appendChild(h(`<div class="empty"><div class="empty-art">${oicon('table')}</div><h3>Noch keine Formulare gewählt</h3><p>Füge ein oder mehrere ausgefüllte PDF-Formulare hinzu.</p></div>`));
    items.forEach((it, i) => {
      const n = it.data.fields.filter(f => String(f.value).trim()).length;
      const note = it.data.source === 'error' ? 'Konnte nicht gelesen werden'
        : it.data.source === 'none' ? 'Keine Formularfelder – vermutlich fixiert oder gescannt'
          : `${n} von ${it.data.fields.length} Feldern ausgefüllt`;
      const row = h(`<div class="order-item fd-item ${it.data.fields.length ? '' : 'fd-empty'}">${thumbHtml(it.doc)}
        <span class="doc-info"><span class="doc-name">${esc(it.doc.name)}</span><span class="doc-meta">${esc(note)}</span></span>
        <button class="icon-btn" type="button" data-remove aria-label="Entfernen">${icon('close')}</button></div>`);
      $('[data-remove]', row).addEventListener('click', () => { items.splice(i, 1); render(); });
      list.appendChild(row);
    });
    const usable = items.filter(it => it.data.fields.length);
    const t = tableOf(usable.map(it => ({ name: it.doc.name, source: it.data.source, fields: it.data.fields })));
    $('[data-sum]', wrap).textContent = items.length ? `${usable.length} Formular${usable.length === 1 ? '' : 'e'} · ${t.cols.length} Spalten` : '';
    preview.innerHTML = '';
    if (usable.length) {
      const cols = t.cols.slice(0, 6);
      preview.appendChild(h(`<div class="card fd-table-card"><div class="fd-head"><strong>Vorschau</strong>${t.cols.length > cols.length ? `<span class="muted small">+ ${t.cols.length - cols.length} weitere Spalten in der Tabelle</span>` : ''}</div>
        <div class="fd-scroll"><table class="fd-table"><thead><tr><th>Datei</th>${cols.map(c => `<th data-no-i18n>${esc(c.label)}</th>`).join('')}</tr></thead>
        <tbody data-no-i18n>${t.rows.slice(0, 8).map(r => `<tr><td>${esc(r.name)}</td>${r.values.slice(0, 6).map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`));
    }
    saveBtn.disabled = !usable.length;
    screen.setFoot([saveBtn], usable.length ? `${usable.length} Zeile${usable.length === 1 ? '' : 'n'}` : 'Mindestens 1 ausgefülltes Formular wählen');
  }

  $('[data-add]', wrap).addEventListener('click', async () => {
    const ids = await pickDocsDialog({ multi: true, title: 'Formulare hinzufügen', exclude: items.map(x => x.doc.id) });
    if (!ids) return;
    const docs = [];
    for (const id of ids) { const d = await db.getDoc(id); if (d && (d.kind || 'pdf') === 'pdf') docs.push(d); }
    await add(docs);
  });
  screen.onDropFiles = async files => {
    const docs = await importFiles(files.filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf'));
    await add(docs);
  };

  saveBtn.addEventListener('click', async () => {
    const usable = items.filter(it => it.data.fields.length);
    if (!usable.length) return;
    saveBtn.disabled = true;
    const prog = progress('Tabelle wird erstellt …');
    try {
      const t = tableOf(usable.map(it => ({ name: it.doc.name, source: it.data.source, fields: it.data.fields })));
      const { newWorkbook, newSheet, setCell, recalc } = await import('../office/workbook.js');
      const wb = newWorkbook();
      wb.sheets = [];
      const sh = newSheet(tr('Formulardaten'));
      const head = [tr('Datei'), ...t.cols.map(c => c.label)];
      head.forEach((v, c) => setCell(sh, 0, c, { v, s: { b: true } }));
      t.rows.forEach((r, i) => {
        setCell(sh, i + 1, 0, { v: r.name });
        r.values.forEach((v, c) => { if (v === '' || v == null) return; const n = asNumber(v); setCell(sh, i + 1, c + 1, { v: n == null ? String(v) : n }); });
      });
      sh.freeze = 1;
      sh.colW = head.map((v, c) => Math.min(380, Math.round(7.2 * Math.max(8, ...[v, ...t.rows.map(r => c ? r.values[c - 1] : r.name)].map(x => String(x ?? '').length)) + 14)));
      wb.sheets.push(sh);
      recalc(wb);
      const blob = await (await import('../office/xlsx-write.js')).writeXlsx(wb, { title: tr('Formulardaten') });
      const day = new Date().toISOString().slice(0, 10);
      const doc = await saveFile({ blob, name: `${tr('Formulardaten')} ${day}.xlsx`, kind: 'xlsx' });
      prog.done();
      toast('Tabelle erstellt', 'success');
      await resultDialog(doc, 'Tabelle erstellt', `${t.rows.length} Formulare, ${t.cols.length} Felder – gespeichert in deinen Dateien.`);
    } catch (e) {
      prog.done();
      errorToast(e, 'Die Tabelle konnte nicht erstellt werden.');
    } finally { saveBtn.disabled = false; }
  });

  if (docId) { const d = await db.getDoc(docId); if (d) await add([d]); else render(); } else render();
}
