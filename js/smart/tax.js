// „Steuer-Belege“: Kassenbons und Rechnungen fürs Steuerjahr sammeln – Datum, Brutto/Netto/MwSt,
// Händler und Zahlungsart werden auf dem Gerät erkannt, die Kategorie (Anlage N, Sonderausgaben,
// außergewöhnliche Belastungen, § 35a …) vorgeschlagen. Übersicht pro Jahr, Export als XLSX (mit Summen),
// CSV und PDF-Mappe (Deckblatt + Inhaltsverzeichnis + alle Belege). Keine Steuerberatung.
// Routes: #/steuer · #/steuer/<jahr>[?beleg=<id>] · #/steuer/neu?doc=<id>
import * as db from '../db.js';
import { $, $$, toast, errorToast, openDialog, confirmDialog, pickFiles, progress, downloadBlob, shareBlob } from '../ui.js';
import { h, esc, oicon, ensureSmartCss, sdb, emitSmart, onSmartChange, money, parseMoney, deDate, fieldRow, todayIso, lsGet, lsSet } from './common.js';
import { analyze, TAX_CATEGORIES, taxCategory, PAYMENT_LABELS } from './extract.js';

export const TAX_DISCLAIMER = 'Keine Steuerberatung: Die Kategorien sind Vorschläge. Ob und in welcher Höhe etwas absetzbar ist, hängt von deinem Einzelfall ab – im Zweifel helfen Lohnsteuerhilfeverein oder Steuerberatung.';
const round2 = v => Math.round((+v || 0) * 100) / 100;
const vatOf = (r, rate) => { const g = (r.vat || []).find(v => v.rate === rate); return g && g.tax != null ? g.tax : null; };

export async function listReceipts(year) {
  const all = year ? await sdb.byIndex('receipts', 'year', +year) : await sdb.all('receipts');
  return all.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || a.createdAt - b.createdAt);
}
export async function years() {
  const all = await sdb.all('receipts');
  const ys = [...new Set(all.map(r => r.year))].filter(Boolean).sort((a, b) => b - a);
  return ys;
}

function fromAnalysis(r, { docId, docName, source }) {
  const rc = r.receipt || {};
  const date = rc.date || r.date || todayIso();
  return {
    id: db.uid(), docId, docName, source: source || 'import', createdAt: Date.now(), updatedAt: Date.now(),
    date, year: +date.slice(0, 4), merchant: rc.merchant || (r.sender && r.sender.name) || '', total: rc.total ?? r.amounts.main ?? null,
    net: rc.net ?? null, vat: rc.vat || [], payment: rc.payment || null, labor: rc.labor ?? null, laborNet: !!rc.laborNet,
    category: (r.tax && r.tax.id) || 'privat', categoryConfidence: (r.tax && r.tax.confidence) || 0, invoiceNo: rc.invoiceNo || null, note: '',
    docType: r.type, subtype: r.subtype || null,
  };
}

/** Recognise a library entry as a receipt. → receipt record (saved) */
export async function processReceiptDoc(docId, { source, onProgress, signal } = {}) {
  const meta = await db.getDoc(docId);
  if (!meta) throw Object.assign(new Error('missing'), { userMessage: 'Dokument nicht gefunden.' });
  const { textOfDoc } = await import('./textsrc.js');
  const res = await textOfDoc(docId, { onProgress, signal, maxPages: 3 });
  const r = analyze(res.text, { today: todayIso() });
  const rec = fromAnalysis(r, { docId, docName: meta.name, source });
  const old = (await sdb.byIndex('receipts', 'docId', docId))[0];
  if (old) { rec.id = old.id; rec.createdAt = old.createdAt; rec.note = old.note; }
  await sdb.put('receipts', rec);
  try { (await import('./memory.js')).indexExtraText(docId, res.pages, { ocr: res.ocr }); } catch {}
  emitSmart('receipts');
  return rec;
}
/** Briefkasten → Steuer-Belege (no second OCR: uses the letter's analysis). */
export async function addReceiptFromLetter(l) {
  const r = { receipt: l.receipt || {}, tax: l.tax, type: l.type, subtype: l.subtype, date: l.f.date, sender: { name: l.f.sender }, amounts: { main: l.f.amount } };
  const rec = fromAnalysis(r, { docId: l.docId, docName: l.docName, source: 'briefkasten' });
  if (l.f.date && !(l.receipt && l.receipt.date)) { rec.date = l.f.date; rec.year = +l.f.date.slice(0, 4); }
  const old = (await sdb.byIndex('receipts', 'docId', l.docId))[0];
  if (old) { rec.id = old.id; rec.createdAt = old.createdAt; rec.note = old.note; }
  await sdb.put('receipts', rec);
  emitSmart('receipts');
  toast('Zu den Steuer-Belegen hinzugefügt', 'success');
  return rec;
}

// ------------------------------------------------------------------ totals
export function totals(list) {
  const by = new Map();
  for (const c of TAX_CATEGORIES) by.set(c.id, { cat: c, n: 0, total: 0, labor: 0 });
  for (const r of list) {
    const t = by.get(r.category) || by.get('privat');
    t.n++; t.total = round2(t.total + (+r.total || 0)); t.labor = round2(t.labor + (+r.labor || 0));
  }
  const relevant = list.filter(r => r.category !== 'privat');
  return { by, sum: round2(relevant.reduce((s, r) => s + (+r.total || 0), 0)), labor: round2(relevant.reduce((s, r) => s + (+r.labor || 0), 0)), count: list.length };
}

// ------------------------------------------------------------------ screens
export async function mount(screen, { parts, params }) {
  ensureSmartCss();
  screen.root.classList.add('sm-screen');
  if (parts[1] === 'neu') return mountNew(screen, params);
  let year = parseInt(parts[1], 10);
  if (!year) {
    const ys = await years();
    year = ys[0] || new Date().getFullYear() - (new Date().getMonth() < 6 ? 1 : 0);
    location.replace(`#/steuer/${year}`);
    return;
  }
  return mountYear(screen, year, params);
}

async function mountNew(screen, params) {
  const docId = params.get('doc');
  const wrap = h(`<div class="screen-inner"><div class="card sm-progress" role="status" aria-live="polite"><span class="spinner dark" aria-hidden="true"></span><div><strong>Beleg wird gelesen …</strong><span class="muted small" data-sub>Alles passiert auf deinem Gerät.</span></div></div></div>`);
  screen.body.appendChild(wrap);
  screen.setFoot([]);
  try {
    const { textOfDoc } = await import('./textsrc.js');
    const probe = await textOfDoc(docId, { ocr: 'never', maxPages: 3 });
    if (probe.needsOcr) {
      const { ensureOcrReady } = await import('../ocr/ui.js');
      if (!(await ensureOcrReady('deu+eng'))) { location.replace('#/steuer'); return; }
    }
    const rec = await processReceiptDoc(docId, { source: params.get('quelle') || 'import', signal: screen.signal, onProgress: p => { const s = $('[data-sub]', wrap); if (s) s.textContent = p.message || 'Text wird erkannt …'; } });
    if (!screen.signal.aborted) location.replace(`#/steuer/${rec.year}?beleg=${rec.id}`);
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    errorToast(e, 'Der Beleg konnte nicht gelesen werden.');
    location.replace('#/steuer');
  }
}

async function importReceipt() {
  const files = await pickFiles({ accept: '.pdf,application/pdf,image/*', multiple: true });
  if (!files.length) return;
  const { importFiles } = await import('../library.js');
  const docs = await importFiles(files, { source: 'Steuer-Belege', any: true, quiet: true });
  if (docs.length === 1) { location.hash = `#/steuer/neu?doc=${encodeURIComponent(docs[0].id)}`; return; }
  const p = progress(`Belege werden gelesen (0 von ${docs.length}) …`);
  let last = null;
  try {
    for (let i = 0; i < docs.length; i++) { p.set(`Belege werden gelesen (${i + 1} von ${docs.length}) …`); last = await processReceiptDoc(docs[i].id); }
  } catch (e) { errorToast(e, 'Ein Beleg konnte nicht gelesen werden.'); } finally { p.done(); }
  if (last) location.hash = `#/steuer/${last.year}`;
}

async function mountYear(screen, year, params) {
  screen.setTitle(`Steuer-Belege ${year}`, 'Für die Steuererklärung sammeln – auf deinem Gerät');
  const wrap = h(`<div class="screen-inner sm-tax">
    <div class="sm-tax-top">
      <div class="sm-year" role="group" aria-label="Steuerjahr">
        <button class="icon-btn" type="button" data-y="-1" aria-label="Vorjahr">${oicon('chevronLeft')}</button>
        <strong data-no-i18n>${year}</strong>
        <button class="icon-btn" type="button" data-y="1" aria-label="Folgejahr">${oicon('chevronRight')}</button>
      </div>
      <div class="sm-tax-add">
        <a class="btn btn-primary" href="#/werkzeug/scannen?ziel=steuer">${oicon('camera')}<span>Beleg scannen</span></a>
        <button class="btn btn-ghost" type="button" data-import>${oicon('upload')}<span>Dateien wählen</span></button>
        <button class="btn btn-ghost" type="button" data-lib>${oicon('folder')}<span>Aus meinen Dateien</span></button>
      </div>
    </div>
    <div class="sm-sum-cards" data-sums></div>
    <div class="card sm-home"><div><strong>Homeoffice-Pauschale</strong><span class="small muted">6 € pro Tag, höchstens 1.260 € im Jahr – dafür brauchst du keine Belege.</span></div>
      <label class="sm-field sm-home-days"><span class="sm-field-label">Tage im Homeoffice</span><input class="input" type="number" min="0" max="366" inputmode="numeric" data-home></label><strong class="sm-home-sum" data-homesum></strong></div>
    <h2 class="section-title">Belege <span class="count-pill" data-count></span>
      <span class="sm-exports"><button class="btn btn-ghost btn-sm" type="button" data-exp="xlsx">${oicon('ksheet')}<span>Excel</span></button><button class="btn btn-ghost btn-sm" type="button" data-exp="csv">${oicon('grid')}<span>CSV</span></button><button class="btn btn-soft btn-sm" type="button" data-exp="pdf">${oicon('kpdf')}<span>PDF-Mappe</span></button></span></h2>
    <div class="sm-receipts" data-list></div>
    <p class="sm-disclaimer">${oicon('info')}<span>${esc(TAX_DISCLAIMER)}</span></p>
  </div>`);
  screen.body.appendChild(wrap);
  screen.setFoot([]);
  $$('[data-y]', wrap).forEach(b => b.addEventListener('click', () => { location.hash = `#/steuer/${year + +b.dataset.y}`; }));
  $('[data-import]', wrap).addEventListener('click', () => importReceipt().catch(e => errorToast(e)));
  $('[data-lib]', wrap).addEventListener('click', async () => {
    const { pickDocsDialog } = await import('../components.js');
    const ids = await pickDocsDialog({ multi: true, title: 'Belege aus deinen Dateien' });
    if (!ids || !ids.length) return;
    const p = progress('Belege werden gelesen …');
    try { for (const id of ids) await processReceiptDoc(id); } catch (e) { errorToast(e); } finally { p.done(); }
    render();
  });
  const home = $('[data-home]', wrap);
  const homeKey = `fale-smart-home-${year}`;
  home.value = lsGet(homeKey, '') || '';
  const homeSum = () => { const d = Math.max(0, Math.min(366, parseInt(home.value, 10) || 0)); $('[data-homesum]', wrap).textContent = d ? money(Math.min(1260, d * 6)) : ''; };
  home.addEventListener('input', () => { lsSet(homeKey, home.value || null); homeSum(); });
  homeSum();
  wrap.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-exp]');
    if (!b) return;
    b.disabled = true;
    try { await exportYear(year, b.dataset.exp); } catch (e) { errorToast(e, 'Der Export hat nicht geklappt.'); } finally { b.disabled = false; }
  });
  async function render() {
    const list = await listReceipts(year);
    const t = totals(list);
    $('[data-count]', wrap).textContent = String(list.length);
    const sums = $('[data-sums]', wrap);
    sums.innerHTML = '';
    const head = h(`<div class="card sm-sum-total"><span class="small muted">Steuerlich relevante Belege ${year}</span><strong data-no-i18n></strong><span class="small muted" data-no-i18n></span></div>`);
    $('strong', head).textContent = money(t.sum);
    $('span.small:last-child', head).textContent = t.labor ? `davon Arbeitskosten (§ 35a): ${money(t.labor)}` : `${t.count} Beleg${t.count === 1 ? '' : 'e'}`;
    sums.appendChild(head);
    for (const { cat, n, total, labor } of t.by.values()) {
      if (!n || cat.id === 'privat') continue;
      const c = h(`<button class="card sm-sum" type="button"><span class="small muted"></span><strong data-no-i18n></strong><span class="small"></span></button>`);
      $('span.small.muted', c).textContent = cat.group;
      $('strong', c).textContent = money(total);
      $('span.small:last-child', c).textContent = `${cat.label} · ${n} Beleg${n === 1 ? '' : 'e'}${labor ? ` · Arbeitskosten ${money(labor)}` : ''}`;
      c.title = cat.note;
      c.addEventListener('click', () => openDialog({ title: cat.label, body: `<p>${esc(cat.note)}</p><p class="muted small">${esc(TAX_DISCLAIMER)}</p>`, actions: [{ label: 'OK', value: 'ok', kind: 'btn-primary', default: true }] }));
      sums.appendChild(c);
    }
    const box = $('[data-list]', wrap);
    box.innerHTML = '';
    if (!list.length) {
      box.appendChild(h(`<div class="empty"><div class="empty-art">${oicon('euro')}</div><h3>Noch keine Belege für ${year}</h3><p>Scanne Kassenbons und Rechnungen – FaLe liest Datum, Betrag und Mehrwertsteuer und schlägt eine Kategorie vor.</p></div>`));
      return;
    }
    const docs = new Map((await db.listFiles()).map(d => [d.id, d]));
    for (const r of list) box.appendChild(receiptRow(r, docs.get(r.docId), render));
  }
  await render();
  const want = params && params.get('beleg');
  if (want) { const r = await sdb.get('receipts', want); if (r) setTimeout(() => editReceipt(r).then(ok => ok && render()), 60); }
  const off = onSmartChange(w => { if (w === 'receipts') render(); });
  return () => off();
}

function receiptRow(r, doc, onChange) {
  const cat = taxCategory(r.category);
  const row = h(`<article class="sm-rc" data-receipt="${esc(r.id)}">
    <button class="sm-rc-main" type="button"><span class="sm-rc-date"></span><span class="sm-row-txt"><strong data-no-i18n></strong><span class="small muted"></span></span><span class="sm-rc-amt" data-no-i18n></span></button>
    <button class="icon-btn" type="button" data-more aria-label="Weitere Aktionen">${oicon('more')}</button></article>`);
  $('.sm-rc-date', row).textContent = r.date ? deDate(r.date).slice(0, 6) : '–';
  $('strong', row).textContent = r.merchant || (doc ? doc.name : r.docName) || 'Beleg';
  $('.small.muted', row).textContent = [cat.label, r.labor ? `Arbeitskosten ${money(r.labor)}` : '', r.payment ? PAYMENT_LABELS[r.payment] || '' : '', !doc ? 'Datei fehlt' : ''].filter(Boolean).join(' · ');
  $('.sm-rc-amt', row).textContent = money(r.total);
  $('.sm-rc-main', row).addEventListener('click', async () => { if (await editReceipt(r)) onChange(); });
  $('[data-more]', row).addEventListener('click', async e => {
    const { officeMenu } = await import('../office/kinds.js');
    officeMenu(e.currentTarget, [
      { label: 'Bearbeiten', icon: 'edit', onClick: async () => { if (await editReceipt(r)) onChange(); } },
      doc ? { label: 'Beleg öffnen', icon: 'file', onClick: async () => { const { openHash } = await import('../office/kinds.js'); location.hash = !doc.kind || doc.kind === 'pdf' ? `#/ansicht/${doc.id}` : openHash(doc); } } : null,
      '-',
      { label: 'Entfernen', icon: 'trash', danger: true, onClick: async () => { if (await confirmDialog('Beleg entfernen?', 'Der Eintrag wird aus der Übersicht entfernt. Die Datei bleibt erhalten.', { okLabel: 'Entfernen', danger: true })) { await sdb.del('receipts', r.id); emitSmart('receipts'); onChange(); } } },
    ].filter(Boolean), { label: 'Beleg' });
  });
  return row;
}

export async function editReceipt(r) {
  const res = await openDialog({
    title: 'Beleg prüfen', wide: true,
    body: '<div class="sm-rc-form"></div>',
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Speichern', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => {
      const box = $('.sm-rc-form', dlg);
      const m = v => (v == null || v === '' ? '' : money(v).replace(/\s€$/, ''));
      box.appendChild(fieldRow({ id: 'merchant', label: 'Händler / Aussteller', value: r.merchant, wide: true }));
      box.appendChild(fieldRow({ id: 'date', label: 'Datum (Zahlung)', type: 'date', value: r.date }));
      box.appendChild(fieldRow({ id: 'total', label: 'Brutto (€)', value: m(r.total) }));
      box.appendChild(fieldRow({ id: 'net', label: 'Netto (€)', value: m(r.net) }));
      box.appendChild(fieldRow({ id: 'vat19', label: 'MwSt. 19 % (€)', value: m(vatOf(r, 19)) }));
      box.appendChild(fieldRow({ id: 'vat7', label: 'MwSt. 7 % (€)', value: m(vatOf(r, 7)) }));
      box.appendChild(fieldRow({ id: 'category', label: 'Kategorie (Vorschlag)', options: TAX_CATEGORIES.map(c => [c.id, `${c.label} – ${c.group}`]), value: r.category, wide: true }));
      box.appendChild(fieldRow({ id: 'payment', label: 'Zahlungsart', options: [['', 'Unbekannt'], ...Object.entries(PAYMENT_LABELS)], value: r.payment || '' }));
      box.appendChild(fieldRow({ id: 'labor', label: 'Arbeitskosten inkl. MwSt. (§ 35a, €)', value: m(r.labor), hint: r.laborNet ? 'Erkannt ohne Angabe „brutto“ – bitte prüfen.' : '' }));
      box.appendChild(fieldRow({ id: 'note', label: 'Notiz', value: r.note || '', wide: true }));
      const note = h('<p class="sm-cat-note small muted" aria-live="polite"></p>');
      box.appendChild(note);
      const sel = $('[name=category]', box), pay = $('[name=payment]', box);
      const upd = () => {
        const c = taxCategory(sel.value);
        let t = c.note;
        if ((sel.value === 'handwerker' || sel.value === 'haushaltsnah' || sel.value === 'kinderbetreuung') && pay.value === 'bar') t += ' ⚠ Barzahlung wird hier vom Finanzamt nicht anerkannt.';
        note.textContent = t;
        $('[name=labor]', box).closest('.sm-field').hidden = !['handwerker', 'haushaltsnah'].includes(sel.value);
      };
      sel.addEventListener('change', upd); pay.addEventListener('change', upd);
      upd();
      return { collect: () => Object.fromEntries($$('[name]', box).map(i => [i.name, i.value])) };
    },
  });
  if (res.value !== 'ok' || !res.data) return false;
  const d = res.data;
  r.merchant = d.merchant.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(d.date)) { r.date = d.date; r.year = +d.date.slice(0, 4); }
  r.total = parseMoney(d.total); r.net = parseMoney(d.net);
  const v19 = parseMoney(d.vat19), v7 = parseMoney(d.vat7);
  r.vat = [v19 != null ? { rate: 19, tax: v19, net: null, gross: null } : null, v7 != null ? { rate: 7, tax: v7, net: null, gross: null } : null].filter(Boolean);
  r.category = d.category; r.payment = d.payment || null; r.labor = parseMoney(d.labor); r.laborNet = false; r.note = d.note.trim();
  r.updatedAt = Date.now();
  await sdb.put('receipts', r);
  emitSmart('receipts');
  toast('Beleg gespeichert', 'success');
  return true;
}

// ------------------------------------------------------------------ exports
const HEAD = ['Nr.', 'Datum', 'Händler / Aussteller', 'Kategorie', 'Bereich', 'Brutto', 'Netto', 'MwSt. 19 %', 'MwSt. 7 %', 'Arbeitskosten § 35a', 'Zahlungsart', 'Notiz', 'Datei'];
function rowsFor(list, docs) {
  return list.map((r, i) => {
    const c = taxCategory(r.category);
    const d = docs.get(r.docId);
    return [i + 1, r.date || '', r.merchant || '', c.label, c.group, r.total ?? null, r.net ?? null, vatOf(r, 19), vatOf(r, 7), r.labor ?? null, r.payment ? PAYMENT_LABELS[r.payment] : '', r.note || '', d ? d.name : (r.docName || '')];
  });
}

export async function buildXlsxFor(year) {
  const list = await listReceipts(year);
  const docs = new Map((await db.listFiles()).map(d => [d.id, d]));
  const data = rowsFor(list, docs);
  const n = data.length;
  const { buildXlsx, colName } = await import('./xlsx.js');
  const rows = [HEAD.map(t => ({ v: t, s: 'head' }))];
  data.forEach(r => rows.push(r.map((v, ci) => (ci === 1 && v ? { v, s: 'date' } : ci >= 5 && ci <= 9 ? (v == null ? null : { v, s: 'money' }) : v))));
  const last = n + 1;
  const sumRow = ['', '', 'Summe', '', ''];
  for (let ci = 5; ci <= 9; ci++) {
    const col = colName(ci);
    const val = round2(data.reduce((s, r) => s + (+r[ci] || 0), 0));
    sumRow.push({ f: n ? `SUM(${col}2:${col}${last})` : '0', v: val, s: 'moneyBold' });
  }
  rows.push([], sumRow.map(c => (typeof c === 'string' && c ? { v: c, s: 'bold' } : c)));
  // overview with SUMIF per category
  const ov = [[{ v: 'Bereich', s: 'head' }, { v: 'Kategorie', s: 'head' }, { v: 'Anzahl', s: 'head' }, { v: 'Summe brutto', s: 'head' }, { v: 'Arbeitskosten § 35a', s: 'head' }, { v: 'Hinweis', s: 'head' }]];
  const sheet1 = `'Belege ${year}'`;
  for (const c of TAX_CATEGORIES) {
    const items = data.filter(r => r[3] === c.label);
    if (!items.length) continue;
    ov.push([c.group, c.label,
      { f: `COUNTIF(${sheet1}!D2:D${last},"${c.label}")`, v: items.length },
      { f: `SUMIF(${sheet1}!D2:D${last},"${c.label}",${sheet1}!F2:F${last})`, v: round2(items.reduce((s, r) => s + (+r[5] || 0), 0)), s: 'money' },
      { f: `SUMIF(${sheet1}!D2:D${last},"${c.label}",${sheet1}!J2:J${last})`, v: round2(items.reduce((s, r) => s + (+r[9] || 0), 0)), s: 'money' },
      { v: c.note, s: 'wrap' }]);
  }
  const relevant = data.filter(r => r[3] !== taxCategory('privat').label);
  ov.push([], [{ v: 'Steuerlich relevant gesamt', s: 'bold' }, '', relevant.length, { v: round2(relevant.reduce((s, r) => s + (+r[5] || 0), 0)), s: 'moneyBold' }, { v: round2(relevant.reduce((s, r) => s + (+r[9] || 0), 0)), s: 'moneyBold' }]);
  const days = parseInt(lsGet(`fale-smart-home-${year}`, '0'), 10) || 0;
  if (days) ov.push([{ v: 'Homeoffice-Pauschale', s: 'bold' }, `${days} Tage × 6 €`, '', { v: Math.min(1260, days * 6), s: 'money' }]);
  ov.push([], [TAX_DISCLAIMER]);
  return buildXlsx([
    { name: `Belege ${year}`, rows, widths: [5, 11, 32, 26, 30, 12, 12, 12, 11, 16, 18, 24, 30] },
    { name: 'Übersicht', rows: ov, widths: [30, 30, 9, 15, 18, 70] },
  ], { title: `Steuer-Belege ${year}` });
}

export async function buildCsvFor(year) {
  const list = await listReceipts(year);
  const docs = new Map((await db.listFiles()).map(d => [d.id, d]));
  const num = v => (v == null || v === '' ? '' : (+v).toFixed(2).replace('.', ','));
  // texts come from scanned letters/receipts (untrusted): a leading = + - @ would run as a formula in Excel
  // (CSV injection, e.g. =HYPERLINK(…)) → prefixed with ' (security audit 2026-10)
  const cell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [HEAD.map(cell).join(';')];
  for (const r of rowsFor(list, docs)) lines.push(r.map((v, i) => (i === 1 ? deDate(v) : i >= 5 && i <= 9 ? num(v) : cell(v))).join(';'));
  return new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
}

export async function buildPdfBundle(year, { onProgress } = {}) {
  const list = await listReceipts(year);
  if (!list.length) throw Object.assign(new Error('empty'), { userMessage: 'Für dieses Jahr gibt es noch keine Belege.' });
  const { loadPdfLib, saveDoc } = await import('../pdflib.js');
  const { makeSanitizer } = await import('../tools/common.js');
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica), bold = await out.embedFont(StandardFonts.HelveticaBold);
  const san = makeSanitizer(font);
  const A4 = [595.28, 841.89];
  const ink = rgb(0.08, 0.09, 0.18), grey = rgb(0.35, 0.37, 0.5), accent = rgb(0.23, 0.22, 0.63);
  let profile = null;
  try { profile = await (await import('../extras/profile.js')).getProfile(); } catch {}
  const who = profile ? [profile.vorname, profile.nachname].filter(Boolean).join(' ') : '';
  const t = totals(list);
  const text = (pg, s, x, y, { size = 10, f = font, color = ink } = {}) => pg.drawText(san(s), { x, y, size, font: f, color });
  const right = (pg, s, xr, y, { size = 10, f = font, color = ink } = {}) => { const w = f.widthOfTextAtSize(san(s), size); pg.drawText(san(s), { x: xr - w, y, size, font: f, color }); };
  // cover
  const cover = out.addPage(A4);
  text(cover, 'Belege zur Steuererklärung', 56, 760, { size: 24, f: bold, color: accent });
  text(cover, `Steuerjahr ${year}`, 56, 728, { size: 16, f: bold });
  if (who) text(cover, who, 56, 704, { size: 12 });
  text(cover, `Erstellt am ${deDate(todayIso())} mit FaLe PDF · ${list.length} Beleg${list.length === 1 ? '' : 'e'}`, 56, 684, { size: 10, color: grey });
  let y = 640;
  text(cover, 'Übersicht nach Kategorien', 56, y, { size: 13, f: bold }); y -= 22;
  for (const { cat, n, total, labor } of t.by.values()) {
    if (!n) continue;
    text(cover, `${cat.label}`, 56, y, { size: 10.5, f: bold });
    text(cover, `${cat.group} · ${n} Beleg${n === 1 ? '' : 'e'}${labor ? ` · Arbeitskosten ${money(labor)}` : ''}`, 56, y - 13, { size: 9, color: grey });
    right(cover, money(total), 539, y, { size: 10.5, f: bold });
    y -= 34;
    if (y < 140) break;
  }
  cover.drawLine({ start: { x: 56, y: y + 10 }, end: { x: 539, y: y + 10 }, thickness: 0.6, color: grey });
  text(cover, 'Steuerlich relevant gesamt', 56, y - 8, { size: 11, f: bold });
  right(cover, money(t.sum), 539, y - 8, { size: 11, f: bold });
  const days = parseInt(lsGet(`fale-smart-home-${year}`, '0'), 10) || 0;
  if (days) { text(cover, `Homeoffice-Pauschale: ${days} Tage × 6 € = ${money(Math.min(1260, days * 6))}`, 56, y - 30, { size: 10 }); }
  const disc = 'Hinweis: ' + TAX_DISCLAIMER;
  const wrapLines = (s, maxW, size) => { const words = san(s).split(' '); const ls = []; let cur = ''; for (const w of words) { const tt = (cur + ' ' + w).trim(); if (font.widthOfTextAtSize(tt, size) > maxW) { ls.push(cur); cur = w; } else cur = tt; } if (cur) ls.push(cur); return ls; };
  wrapLines(disc, 483, 8.5).forEach((l, i) => text(cover, l, 56, 80 - i * 11, { size: 8.5, color: grey }));
  // table of contents (pages filled after appending)
  const tocPages = [];
  const perToc = 34;
  for (let i = 0; i < Math.ceil(list.length / perToc); i++) tocPages.push(out.addPage(A4));
  const startPage = [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    onProgress && onProgress(i + 1, list.length);
    startPage.push(out.getPageCount() + 1);
    const label = `Beleg ${i + 1} · ${deDate(r.date)} · ${r.merchant || ''} · ${money(r.total)}`;
    const stamp = pg => { const { width, height } = pg.getSize(); pg.drawRectangle({ x: 0, y: height - 18, width, height: 18, color: rgb(0.93, 0.93, 0.98), opacity: 0.92 }); text(pg, label.slice(0, 110), 10, height - 13, { size: 8.5, f: bold, color: accent }); };
    const d = await db.getDoc(r.docId);
    const blob = d && await db.getFile(r.docId);
    try {
      if (d && blob && (!d.kind || d.kind === 'pdf')) {
        const { loadEditable } = await import('../pdflib.js');
        const src = await loadEditable(new Uint8Array(await blob.arrayBuffer()), d.name, { key: d.id });
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach(p => { out.addPage(p); stamp(p); });
        continue;
      }
      if (d && blob && d.kind === 'image') {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const img = /png/i.test(blob.type) ? await out.embedPng(bytes) : await out.embedJpg(bytes).catch(async () => out.embedPng(bytes));
        const pg = out.addPage(A4);
        const f = Math.min((A4[0] - 60) / img.width, (A4[1] - 80) / img.height);
        pg.drawImage(img, { x: (A4[0] - img.width * f) / 2, y: (A4[1] - 30 - img.height * f) / 2, width: img.width * f, height: img.height * f });
        stamp(pg);
        continue;
      }
    } catch (e) { console.warn('bundle', e); }
    const pg = out.addPage(A4);
    stamp(pg);
    text(pg, d ? `Die Datei „${d.name}“ kann nicht eingebettet werden – sie liegt in FaLe PDF.` : 'Die Datei zu diesem Beleg wurde gelöscht.', 56, 760, { size: 11 });
  }
  tocPages.forEach((pg, ti) => {
    text(pg, ti === 0 ? 'Inhaltsverzeichnis' : 'Inhaltsverzeichnis (Fortsetzung)', 56, 780, { size: 16, f: bold, color: accent });
    let yy = 748;
    text(pg, 'Nr.', 56, yy, { size: 9, f: bold }); text(pg, 'Datum', 84, yy, { size: 9, f: bold }); text(pg, 'Händler / Aussteller', 140, yy, { size: 9, f: bold }); text(pg, 'Kategorie', 330, yy, { size: 9, f: bold });
    right(pg, 'Betrag', 500, yy, { size: 9, f: bold }); right(pg, 'Seite', 539, yy, { size: 9, f: bold });
    yy -= 18;
    list.slice(ti * perToc, (ti + 1) * perToc).forEach((r, k) => {
      const i = ti * perToc + k;
      text(pg, String(i + 1), 56, yy, { size: 9 }); text(pg, deDate(r.date), 84, yy, { size: 9 });
      text(pg, (r.merchant || '').slice(0, 34), 140, yy, { size: 9 }); text(pg, taxCategory(r.category).label.slice(0, 30), 330, yy, { size: 9, color: grey });
      right(pg, money(r.total), 500, yy, { size: 9 }); right(pg, String(startPage[i]), 539, yy, { size: 9 });
      yy -= 19;
    });
  });
  out.setTitle(`Belege zur Steuererklärung ${year}`);
  out.setCreator('FaLe PDF');
  return saveDoc(out);
}

async function exportYear(year, kind) {
  const base = `Steuer-Belege ${year}`;
  if (kind === 'xlsx') {
    const blob = await buildXlsxFor(year);
    const r = await exportTarget(base + '.xlsx');
    if (r === 'lib') { const { saveFile } = await import('../library.js'); const m = await saveFile({ blob, name: base, kind: 'xlsx', source: 'Erstellt' }); toast(`„${m.name}“ in deinen Dateien gespeichert`, 'success'); }
    else if (r === 'dl') downloadBlob(blob, base + '.xlsx');
    else if (r === 'share') shareBlob(blob, base + '.xlsx', blob.type);
  } else if (kind === 'csv') {
    const blob = await buildCsvFor(year);
    const r = await exportTarget(base + '.csv');
    if (r === 'dl' || r === 'lib') downloadBlob(blob, base + '.csv');
    else if (r === 'share') shareBlob(blob, base + '.csv', 'text/csv');
  } else {
    const p = progress('PDF-Mappe wird erstellt …');
    try {
      const bytes = await buildPdfBundle(year, { onProgress: (i, n) => p.set(`Beleg ${i} von ${n} …`) });
      const { saveResult } = await import('../library.js');
      const meta = await saveResult(bytes, `${base} – Mappe.pdf`);
      toast('PDF-Mappe gespeichert', 'success', { action: { label: 'Öffnen', onClick: () => { location.hash = `#/ansicht/${meta.id}`; } } });
    } finally { p.done(); }
  }
}
async function exportTarget(name) {
  const r = await openDialog({
    title: 'Exportieren', body: `<p data-no-i18n>${esc(name)}</p>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, ...(/\.xlsx$/.test(name) ? [{ label: 'In Dateien speichern', value: 'lib' }] : []), { label: 'Teilen', value: 'share' }, { label: 'Herunterladen', value: 'dl', kind: 'btn-primary', default: true }],
  });
  return r.value;
}
