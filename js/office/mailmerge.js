// Serienbrief: Empfängerliste aus einer CSV-/Excel-Datei (Bibliothek oder Gerät), Seriendruckfelder «Feld»,
// Vorschau einzelner Datensätze und Ausgabe als eine gemeinsame PDF oder als ZIP mit einzelnen Word-Dateien.
import * as db from '../db.js';
import { $, $$, esc, openDialog, pickFiles, downloadBlob, progress, toast, errorToast } from '../ui.js';
import { htmlToModel } from './docmodel.js';
import { cleanEditorHtml } from './pagelayout.js';
import { stripExt } from './kinds.js';

/** Read a CSV/XLSX blob → { fields, records } (first row = field names). */
export async function readRecipients(blob, name) {
  let rows;
  if (/\.csv$/i.test(name) || /csv|text\/plain/.test(blob.type)) {
    const { readCsv } = await import('./csv.js');
    const { sheetToRows } = await import('./workbook.js');
    const wb = await readCsv(blob, name);
    rows = sheetToRows(wb.sheets[0]);
  } else {
    const { readXlsx } = await import('./xlsx-read.js');
    const { sheetToRows, recalc } = await import('./workbook.js');
    const wb = await readXlsx(await blob.arrayBuffer(), name);
    try { recalc(wb); } catch {}
    rows = sheetToRows(wb.sheets[0]);
  }
  rows = rows.filter(r => r.some(v => String(v ?? '').trim()));
  if (rows.length < 2) throw Object.assign(new Error('empty'), { userMessage: 'Die Liste braucht eine Kopfzeile mit Feldnamen und mindestens einen Datensatz.' });
  const used = new Map();
  const fields = rows[0].map((h, i) => {
    let f = String(h ?? '').trim() || `Feld${i + 1}`;
    const n = used.get(f) || 0; used.set(f, n + 1);
    if (n) f = `${f}_${n + 1}`;
    return f;
  });
  const records = rows.slice(1).map(r => Object.fromEntries(fields.map((f, i) => [f, String(r[i] ?? '')])));
  return { name, fields, records };
}

/** Dialog: choose a recipient list from the library or the device. */
export async function chooseRecipients() {
  const files = (await db.listFiles()).filter(d => d.kind === 'csv' || d.kind === 'xlsx').sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0)).slice(0, 30);
  const r = await openDialog({
    title: 'Empfängerliste wählen',
    body: `<p class="hint">Die erste Zeile der Tabelle enthält die Feldnamen (z. B. Anrede, Name, Straße, PLZ, Ort).</p>
      <div class="mm-list">${files.length ? files.map(f => `<button class="mm-file" type="button" data-id="${esc(f.id)}"><strong>${esc(f.name)}</strong><span class="muted small">${f.kind.toUpperCase()}</span></button>`).join('') : '<p class="panel-empty">Keine Tabellen in deinen Dateien.</p>'}</div>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Datei vom Gerät …', value: 'device', kind: 'btn-primary' }],
    onMount: dlg => {
      let picked = null;
      $$('.mm-file', dlg).forEach(b => b.addEventListener('click', () => { picked = b.dataset.id; dlg.close(); }));
      return { collect: () => picked };
    },
  });
  try {
    if (r.data) {
      const meta = files.find(f => f.id === r.data);
      const blob = await db.getFile(r.data);
      return { ...(await readRecipients(blob, meta.name)), docId: meta.id };
    }
    if (r.value === 'device') {
      const list = await pickFiles({ accept: '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', multiple: false });
      if (!list || !list.length) return null;
      return await readRecipients(list[0], list[0].name);
    }
  } catch (e) { errorToast(e, 'Die Empfängerliste konnte nicht gelesen werden.'); }
  return null;
}

export const fieldHtml = name => `<span class="mf" data-field="${esc(name)}" contenteditable="false">«${esc(name)}»</span>`;

/** Show record values (or «Feld» placeholders when rec is null) in the editor. */
export function previewFields(ed, rec) {
  $$('span.mf', ed).forEach(sp => {
    const f = sp.getAttribute('data-field') || '';
    sp.textContent = rec ? (rec[f] ?? '') : `«${f}»`;
    sp.classList.toggle('mf-on', !!rec);
  });
}

/** Editor HTML with fields replaced by the record's values. */
export function mergedHtml(ed, rec) {
  const doc = new DOMParser().parseFromString(`<body>${cleanEditorHtml(ed)}</body>`, 'text/html');
  doc.querySelectorAll('span.mf').forEach(sp => {
    const v = rec[sp.getAttribute('data-field') || ''] ?? '';
    const st = sp.getAttribute('style');
    if (st) { const n = doc.createElement('span'); n.setAttribute('style', st); n.textContent = v; sp.replaceWith(n); }
    else sp.replaceWith(doc.createTextNode(v));
  });
  return doc.body.innerHTML;
}

/** Output dialog + generation. */
export async function finishMerge({ ed, data, title, baseSize, page, hf, styles, author }) {
  const r = await openDialog({
    title: 'Serienbrief fertigstellen',
    body: `<p>${data.records.length} Datensätze aus „${esc(data.name)}“.</p>
      <div class="radio-row"><label class="check"><input type="radio" name="out" value="pdf" checked> Eine PDF mit allen Briefen</label>
      <label class="check"><input type="radio" name="out" value="docx"> Einzelne Word-Dateien (ZIP)</label></div>
      <div class="field-row"><label class="field"><span class="field-label">Von Datensatz</span><input class="input" type="number" name="from" min="1" max="${data.records.length}" value="1"></label>
      <label class="field"><span class="field-label">Bis</span><input class="input" type="number" name="to" min="1" max="${data.records.length}" value="${data.records.length}"></label></div>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Erstellen', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => ({ collect: () => ({ out: $('[name=out]:checked', dlg).value, from: +$('[name=from]', dlg).value, to: +$('[name=to]', dlg).value }) }),
  });
  if (r.value !== 'ok' || !r.data) return null;
  const from = Math.max(1, Math.min(data.records.length, r.data.from || 1)), to = Math.max(from, Math.min(data.records.length, r.data.to || data.records.length));
  const recs = data.records.slice(from - 1, to);
  const base = stripExt(title);
  if (r.data.out === 'pdf') {
    const { exportPdfFlow } = await import('./shell.js');
    const { modelToPdf } = await import('./docpdf.js');
    return exportPdfFlow(`${base} (Serienbrief).pdf`, onP => {
      const blocks = [];
      recs.forEach((rec, i) => {
        const m = htmlToModel(mergedHtml(ed, rec), { baseSize, styles });
        if (i) blocks.push({ type: 'pagebreak' });
        blocks.push(...m.blocks);
      });
      return modelToPdf({ blocks, baseSize, styles }, { title: base, page, hf, onProgress: onP });
    });
  }
  const prog = progress('Word-Dateien werden erstellt …');
  try {
    const { modelToDocx } = await import('./docx-write.js');
    const { loadJSZip } = await import('./vendor.js');
    const JSZip = await loadJSZip();
    const zip = new JSZip();
    const names = new Set();
    for (let i = 0; i < recs.length; i++) {
      prog.set(`Word-Dateien werden erstellt … ${i + 1} von ${recs.length}`);
      const m = htmlToModel(mergedHtml(ed, recs[i]), { baseSize, styles });
      const blob = await modelToDocx(m, { title: base, page, hf, author });
      const first = Object.values(recs[i]).find(v => String(v).trim()) || '';
      let n = `${String(from + i).padStart(3, '0')} ${first}`.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 60);
      while (names.has(n)) n += '_';
      names.add(n);
      zip.file(`${n}.docx`, blob);
    }
    const out = await zip.generateAsync({ type: 'blob' });
    downloadBlob(new Blob([out], { type: 'application/zip' }), `${base} (Serienbrief).zip`);
    toast(`${recs.length} Word-Dateien erstellt`, 'success');
  } catch (e) { errorToast(e, 'Der Serienbrief konnte nicht erstellt werden.'); }
  finally { prog.done(); }
  return null;
}
