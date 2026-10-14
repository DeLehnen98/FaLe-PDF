// „Briefkasten-Assistent“: Brief fotografieren oder importieren → Texterkennung auf dem Gerät → Brief verstehen
// (js/smart/extract.js) → Ergebniskarte mit bearbeitbaren Feldern und Ein-Tipp-Aktionen:
// Frist eintragen · Überweisung vorbereiten (GiroCode) · Antwort schreiben · Ablegen (durchsuchbar) · optional „Mit KI verbessern“.
// Routes: #/briefkasten · #/briefkasten/neu?doc=<id> · #/briefkasten/<letterId>
import * as db from '../db.js';
import { $, $$, toast, errorToast, openDialog, confirmDialog, pickFiles, debounce } from '../ui.js';
import { h, esc, oicon, ensureSmartCss, sdb, emitSmart, onSmartChange, money, parseMoney, deDate, daysUntil, relDays, fieldRow, copyText, ensureFolderPath, ensureTags, todayIso } from './common.js';
import { analyze, DOC_TYPES, typeInfo, SUBTYPE_LABELS, validIban, formatIban, cleanIban, REF_NAMES, factsOf, TAX_CATEGORIES } from './extract.js';

export const DISCLAIMER = 'Automatisch erkannt – bitte prüfen. Berechnete Fristen sind Hinweise ohne Gewähr und keine Rechtsberatung; maßgeblich ist das Schreiben selbst.';
const ocrCache = new Map(); // docId → OCR results of this session (for "Ablegen" without a second OCR run)

// ------------------------------------------------------------------ data
export async function listLetters() {
  const all = await sdb.all('letters');
  return all.sort((a, b) => (a.status === b.status ? 0 : a.status === 'offen' ? -1 : 1) || (dueOf(a) || '9999').localeCompare(dueOf(b) || '9999') || b.createdAt - a.createdAt);
}
export const dueOf = l => (l && l.f && l.f.due) || null;
/** Open letters with a deadline within `days` (or overdue). */
export async function dueLetters(days = 14) {
  return (await listLetters()).filter(l => l.status === 'offen' && dueOf(l) && daysUntil(dueOf(l)) <= days);
}
export async function letterForDoc(docId) { const r = await sdb.byIndex('letters', 'docId', docId); return r[0] || null; }

function recordFrom(r, { docId, docName, text, ocr, source }) {
  const s = r.sender || {};
  const f = {
    sender: s.name || '', senderAddress: s.address || '', recipient: (r.recipient && r.recipient.name) || '', date: r.date || '', subject: r.subject || '',
    amount: r.amounts.main, amountLabel: r.amounts.mainLabel || '', iban: r.bank.iban ? formatIban(r.bank.iban) : '', bic: r.bank.bic || '', bank: r.bank.bank || '',
    purpose: r.purpose ? r.purpose.text : '', phone: r.contact.phone || '', email: r.contact.email || '',
    due: r.due ? r.due.date : '', dueKind: r.due ? r.due.kind : '', dueLabel: r.due ? r.due.label : '',
  };
  for (const k of Object.keys(REF_NAMES)) f[k] = r.refs[k] || '';
  return {
    id: db.uid(), docId, docName, createdAt: Date.now(), updatedAt: Date.now(), status: 'offen', source: source || 'import', ocr: !!ocr,
    type: r.type, subtype: r.subtype || null, confidence: r.confidence, ranked: r.ranked.slice(0, 3),
    f, deadlines: r.deadlines, contract: r.contract || null, cancel: r.cancel || null, directDebit: !!r.bank.directDebit,
    receipt: r.receipt || null, tax: r.tax || null, filing: r.filing, text: String(text || '').slice(0, 60000), reminders: [], filed: false,
  };
}

/** Analyse a library entry and store the letter. → letter record */
export async function processDoc(docId, { onProgress, signal, source } = {}) {
  const meta = await db.getDoc(docId);
  if (!meta) throw Object.assign(new Error('missing'), { userMessage: 'Dokument nicht gefunden.' });
  const { textOfDoc } = await import('./textsrc.js');
  const res = await textOfDoc(docId, { onProgress, signal });
  if (res.ocrPages) ocrCache.set(docId, { pages: res.ocrPages });
  if (res.ocrImage) ocrCache.set(docId, { image: res.ocrImage });
  const r = analyze(res.text, { today: todayIso() });
  const rec = recordFrom(r, { docId, docName: meta.name, text: res.text, ocr: res.ocr, source });
  const old = await letterForDoc(docId);
  if (old) { rec.id = old.id; rec.createdAt = old.createdAt; rec.reminders = old.reminders || []; rec.status = old.status; }
  await sdb.put('letters', rec);
  await saveFacts(rec);
  // feed the Dokumenten-Gedächtnis with the recognised text (OCR text of scans is otherwise not searchable yet)
  try { (await import('./memory.js')).indexExtraText(docId, res.pages, { ocr: res.ocr }); } catch (e) { console.warn(e); }
  emitSmart('letters');
  return rec;
}

/** Facts for the Dokumenten-Gedächtnis (replaces earlier facts of this document). */
export async function saveFacts(rec) {
  const old = await sdb.byIndex('facts', 'docId', rec.docId);
  for (const o of old) if (o.source === 'briefkasten') await sdb.del('facts', o.id);
  const pseudo = {
    type: rec.type, subtype: rec.subtype, date: rec.f.date || null, sender: rec.f.sender ? { name: rec.f.sender } : null,
    amounts: { main: rec.f.amount, mainLabel: rec.f.amountLabel, art: null }, deadlines: rec.deadlines, contract: rec.contract, cancel: rec.cancel,
    bank: { iban: rec.f.iban ? cleanIban(rec.f.iban) : null, bic: rec.f.bic || null, bank: rec.f.bank || null }, contact: { phone: rec.f.phone, email: rec.f.email },
    refs: Object.fromEntries(Object.keys(REF_NAMES).filter(k => rec.f[k]).map(k => [k, rec.f[k]])),
  };
  if (rec.f.due && !rec.deadlines.some(d => d.date === rec.f.due)) pseudo.deadlines = [...rec.deadlines, { date: rec.f.due, kind: rec.f.dueKind || 'frist', label: rec.f.dueLabel || 'Frist' }];
  for (const fct of factsOf(pseudo)) await sdb.put('facts', { ...fct, id: db.uid(), docId: rec.docId, letterId: rec.id, source: 'briefkasten', updatedAt: Date.now() });
}

async function saveLetter(rec) {
  rec.updatedAt = Date.now();
  await sdb.put('letters', rec);
  await saveFacts(rec);
  emitSmart('letters');
}

// ------------------------------------------------------------------ screens
export async function mount(screen, { parts, params }) {
  ensureSmartCss();
  screen.root.classList.add('sm-screen');
  const sub = parts[1];
  if (!sub) return mountList(screen);
  if (sub === 'neu') return mountNew(screen, params);
  return mountLetter(screen, sub);
}

function typeIcon(type) { return oicon(typeInfo(type).icon); }

async function startImport() {
  const files = await pickFiles({ accept: '.pdf,application/pdf,image/*', multiple: false });
  if (!files.length) return;
  const { importFiles } = await import('../library.js');
  const docs = await importFiles(files, { source: 'Briefkasten', any: true, quiet: true });
  if (docs[0]) location.hash = `#/briefkasten/neu?doc=${encodeURIComponent(docs[0].id)}`;
}
async function pickFromLibrary() {
  const files = (await db.listFiles()).filter(d => !d.kind || d.kind === 'pdf' || d.kind === 'image');
  const r = await openDialog({
    title: 'Brief aus deinen Dateien', wide: true,
    body: '<div class="sm-pick" role="radiogroup" aria-label="Dateien"></div>',
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Auswerten', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => {
      const box = $('.sm-pick', dlg);
      if (!files.length) box.appendChild(h('<p class="muted">Noch keine PDFs oder Bilder vorhanden.</p>'));
      files.slice(0, 200).forEach((d, i) => {
        const l = h(`<label class="sm-pick-item"><input type="radio" name="doc" ${i === 0 ? 'checked' : ''}><span data-no-i18n></span></label>`);
        l.querySelector('input').value = d.id;
        l.querySelector('span').textContent = d.name;
        box.appendChild(l);
      });
      return { collect: () => { const c = $('input:checked', dlg); return c ? c.value : null; } };
    },
  });
  if (r.value === 'ok' && r.data) location.hash = `#/briefkasten/neu?doc=${encodeURIComponent(r.data)}`;
}

async function mountList(screen) {
  const wrap = h(`<div class="screen-inner sm-inbox">
    <div class="card sm-hero"><span class="sm-hero-ic">${oicon('inbox')}</span><div>
      <strong>Post verstehen in Sekunden</strong>
      <p>Fotografiere einen Brief oder wähle eine PDF: FaLe erkennt Art, Absender, Beträge, IBAN und Fristen – direkt auf deinem Gerät. Nichts wird hochgeladen.</p>
      <div class="sm-hero-actions">
        <a class="btn btn-primary" href="#/werkzeug/scannen?ziel=briefkasten" data-sm-scan>${oicon('camera')}<span>Brief scannen</span></a>
        <button class="btn btn-ghost" type="button" data-sm-import>${oicon('upload')}<span>PDF oder Foto wählen</span></button>
        <button class="btn btn-ghost" type="button" data-sm-lib>${oicon('folder')}<span>Aus meinen Dateien</span></button>
      </div></div></div>
    <div class="tabs sm-tabs" role="tablist" aria-label="Status">
      <button class="tab" role="tab" type="button" data-st="offen">Offen</button>
      <button class="tab" role="tab" type="button" data-st="erledigt">Erledigt</button>
    </div>
    <div class="sm-list" data-list></div>
    <p class="sm-disclaimer">${oicon('info')}<span>${esc(DISCLAIMER)}</span></p>
  </div>`);
  screen.body.appendChild(wrap);
  screen.setFoot([]);
  $('[data-sm-import]', wrap).addEventListener('click', () => startImport().catch(e => errorToast(e)));
  $('[data-sm-lib]', wrap).addEventListener('click', () => pickFromLibrary().catch(e => errorToast(e)));
  let st = 'offen';
  $$('[data-st]', wrap).forEach(b => b.addEventListener('click', () => { st = b.dataset.st; render(); }));
  async function render() {
    const all = await listLetters();
    const docs = new Map((await db.listFiles()).map(d => [d.id, d]));
    $$('[data-st]', wrap).forEach(b => {
      b.setAttribute('aria-selected', String(b.dataset.st === st));
      const n = all.filter(l => l.status === b.dataset.st).length;
      b.innerHTML = `${b.dataset.st === 'offen' ? 'Offen' : 'Erledigt'}<span class="count">${n || ''}</span>`;
    });
    const list = $('[data-list]', wrap);
    list.innerHTML = '';
    const items = all.filter(l => l.status === st);
    if (!items.length) {
      list.appendChild(h(`<div class="empty"><div class="empty-art">${oicon('inbox')}</div><h3>${st === 'offen' ? 'Keine offene Post' : 'Noch nichts erledigt'}</h3><p>${st === 'offen' ? 'Scanne deinen nächsten Brief – FaLe sagt dir, was zu tun ist.' : 'Erledigte Briefe erscheinen hier.'}</p></div>`));
      return;
    }
    items.forEach(l => list.appendChild(letterRow(l, docs.get(l.docId), render)));
  }
  await render();
  const off = onSmartChange(() => render());
  return () => off();
}

export function letterRow(l, doc, onChange) {
  const due = dueOf(l);
  const n = daysUntil(due);
  const cls = due && l.status === 'offen' ? (n < 0 ? 'over' : n <= 7 ? 'soon' : 'later') : '';
  const row = h(`<article class="sm-row" data-letter="${esc(l.id)}">
    <a class="sm-row-main" href="#/briefkasten/${encodeURIComponent(l.id)}">
      <span class="sm-type-ic t-${esc(l.type)}">${typeIcon(l.type)}</span>
      <span class="sm-row-txt"><strong data-no-i18n></strong><span class="sm-row-meta"><span class="sm-badge"></span><span data-no-i18n class="sm-row-amt"></span></span></span>
      ${due ? `<span class="sm-due ${cls}"><b>${esc(l.status === 'offen' ? relDays(n) : '')}</b><span>${esc(deDate(due))}</span></span>` : ''}
    </a>
    <button class="icon-btn" type="button" data-done aria-label="${l.status === 'offen' ? 'Als erledigt markieren' : 'Wieder öffnen'}">${oicon(l.status === 'offen' ? 'check' : 'restore')}</button>
  </article>`);
  $('strong', row).textContent = l.f.sender || (doc ? doc.name : l.docName) || 'Unbekannter Absender';
  $('.sm-badge', row).textContent = l.subtype && SUBTYPE_LABELS[l.subtype] ? SUBTYPE_LABELS[l.subtype] : typeInfo(l.type).label;
  $('.sm-row-amt', row).textContent = l.f.amount != null && l.f.amount !== '' ? money(l.f.amount) : (l.f.subject || '');
  $('[data-done]', row).addEventListener('click', async () => {
    l.status = l.status === 'offen' ? 'erledigt' : 'offen';
    await saveLetter(l);
    toast(l.status === 'erledigt' ? 'Erledigt ✓' : 'Wieder offen', 'success');
    onChange && onChange();
  });
  return row;
}

async function mountNew(screen, params) {
  const docId = params.get('doc');
  const wrap = h(`<div class="screen-inner sm-progress-wrap"><div class="card sm-progress" role="status" aria-live="polite">
    <span class="spinner dark" aria-hidden="true"></span><div><strong data-msg>Brief wird gelesen …</strong><span class="muted small" data-sub>Alles passiert auf deinem Gerät.</span>
    <div class="meter sm-meter" hidden><span style="width:0%"></span></div></div>
    <button class="btn btn-ghost btn-sm" type="button" data-cancel>Abbrechen</button></div></div>`);
  screen.body.appendChild(wrap);
  screen.setFoot([]);
  const ac = new AbortController();
  screen.signal.addEventListener('abort', () => ac.abort());
  $('[data-cancel]', wrap).addEventListener('click', () => { ac.abort(); location.replace('#/briefkasten'); });
  const meter = $('.sm-meter', wrap);
  try {
    const meta = docId && await db.getDoc(docId);
    if (!meta) throw Object.assign(new Error('missing'), { userMessage: 'Das Dokument wurde nicht gefunden.' });
    // OCR may need its one-time language data: ask first (offline-capable afterwards)
    const { textOfDoc } = await import('./textsrc.js');
    const probe = await textOfDoc(docId, { ocr: 'never' });
    if (probe.needsOcr) {
      const { ensureOcrReady } = await import('../ocr/ui.js');
      if (!(await ensureOcrReady('deu+eng'))) {
        wrap.innerHTML = '';
        wrap.appendChild(h(`<div class="empty"><div class="empty-art">${oicon('scan')}</div><h3>Texterkennung nicht verfügbar</h3><p>Ohne Texterkennung kann FaLe den Brief nicht lesen. Du kannst die Angaben auch selbst eintragen.</p>
          <div class="sm-hero-actions"><button class="btn btn-primary" type="button" data-manual>Selbst eintragen</button><a class="btn btn-ghost" href="#/briefkasten">Zurück</a></div></div>`));
        $('[data-manual]', wrap).addEventListener('click', async () => {
          const rec = recordFrom(analyze(''), { docId, docName: meta.name, text: '', ocr: false, source: params.get('quelle') || 'import' });
          rec.type = 'sonstiges';
          await saveLetter(rec);
          location.replace(`#/briefkasten/${rec.id}`);
        });
        return;
      }
      $('[data-msg]', wrap).textContent = 'Text wird erkannt …';
    }
    const rec = await processDoc(docId, {
      signal: ac.signal, source: params.get('quelle') || 'import',
      onProgress: p => {
        meter.hidden = false;
        const total = p.total || 1, idx = p.index || 0;
        const pct = Math.round(((idx + (p.progress || 0)) / total) * 100);
        $('span', meter).style.width = `${pct}%`;
        $('[data-sub]', wrap).textContent = total > 1 ? `Seite ${idx + 1} von ${total}` : (p.message || '');
      },
    });
    try { (await import('../extras/stats.js')).track('ocr_pages', 0); } catch {}
    if (!screen.signal.aborted) location.replace(`#/briefkasten/${rec.id}`);
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    errorToast(e, 'Der Brief konnte nicht ausgewertet werden.');
    wrap.innerHTML = '';
    wrap.appendChild(h(`<div class="empty"><div class="empty-art">${oicon('info')}</div><h3>Das hat nicht geklappt</h3><p></p><a class="btn btn-ghost" href="#/briefkasten">Zum Briefkasten</a></div>`));
    $('p', wrap).textContent = (e && e.userMessage) || 'Bitte versuche es erneut.';
  }
}

// ------------------------------------------------------------------ result card
const FIELD_DEFS = [
  ['sender', 'Absender'], ['recipient', 'Empfänger'], ['date', 'Datum des Schreibens', 'date'], ['subject', 'Betreff', 'text', true],
  ['amount', 'Betrag (€)', 'money'], ['due', 'Fällig / Frist bis', 'date'], ['iban', 'IBAN', 'iban'], ['bic', 'BIC'], ['purpose', 'Verwendungszweck', 'text', true],
  ['kundennummer', 'Kundennummer'], ['rechnungsnummer', 'Rechnungsnummer'], ['vertragsnummer', 'Vertragsnummer'], ['aktenzeichen', 'Aktenzeichen'], ['steuernummer', 'Steuernummer'],
  ['phone', 'Telefon'], ['email', 'E-Mail'], ['senderAddress', 'Anschrift des Absenders', 'text', true],
];

async function mountLetter(screen, id) {
  const rec = await sdb.get('letters', id);
  if (!rec) { screen.body.appendChild(h(`<div class="screen-inner"><div class="empty"><div class="empty-art">${oicon('inbox')}</div><h3>Brief nicht gefunden</h3><a class="btn btn-ghost" href="#/briefkasten">Zum Briefkasten</a></div></div>`)); return; }
  const doc = await db.getDoc(rec.docId);
  screen.setTitle(rec.f.sender || 'Brief', typeInfo(rec.type).label);
  const wrap = h(`<div class="screen-inner sm-letter">
    <section class="card sm-head">
      <div class="sm-head-top">
        <span class="sm-type-ic big t-${esc(rec.type)}">${typeIcon(rec.type)}</span>
        <div class="sm-head-txt">
          <label class="sm-type-pick"><span class="sr-only">Dokumentart</span><select class="select" data-type>${DOC_TYPES.map(t => `<option value="${t.id}">${esc(t.label)}</option>`).join('')}</select></label>
          <strong class="sm-sender" data-no-i18n></strong>
          <span class="sm-sub muted small"></span>
        </div>
        <div class="sm-conf" title="Wie sicher die Erkennung der Dokumentart ist"><span class="sm-conf-bar"><span></span></span><span class="small muted" data-conf></span></div>
      </div>
      <div class="sm-due-box" data-duebox hidden></div>
      <div class="sm-actions" role="group" aria-label="Aktionen">
        <button class="btn btn-primary" type="button" data-act="frist">${oicon('bell')}<span>Frist eintragen</span></button>
        <button class="btn btn-soft" type="button" data-act="zahlen">${oicon('euro')}<span>Überweisung vorbereiten</span></button>
        <button class="btn btn-soft" type="button" data-act="antwort">${oicon('letter')}<span>Antwort schreiben</span></button>
        <button class="btn btn-soft" type="button" data-act="ablegen">${oicon('folder')}<span>Ablegen</span></button>
        <button class="btn btn-ghost" type="button" data-act="ki">${oicon('sparkle')}<span>Mit KI verbessern</span></button>
      </div>
    </section>
    <section class="card sm-fields-card"><h2 class="section-title">Erkannte Angaben <span class="muted small">Tippe zum Korrigieren – wird automatisch gespeichert.</span></h2>
      <div class="sm-fields" data-fields></div></section>
    <section class="card sm-deadlines" data-deadlines hidden><h2 class="section-title">${oicon('calendar')} Fristen &amp; Termine</h2><div data-dl></div></section>
    <section class="card sm-contract" data-contract hidden><h2 class="section-title">${oicon('letter')} Vertrag</h2><p data-no-i18n data-ctext></p></section>
    <section class="card sm-more">
      <div class="sm-more-row">
        <a class="btn btn-ghost btn-sm" data-open>${oicon('file')}<span>Dokument öffnen</span></a>
        <button class="btn btn-ghost btn-sm" type="button" data-act="steuer">${oicon('euro')}<span>Zu Steuer-Belegen</span></button>
        <button class="btn btn-ghost btn-sm" type="button" data-act="status"></button>
        <button class="btn btn-ghost btn-sm" type="button" data-act="neu">${oicon('rotate')}<span>Neu auswerten</span></button>
        <button class="btn btn-danger-ghost btn-sm" type="button" data-act="loeschen">${oicon('trash')}<span>Aus Briefkasten entfernen</span></button>
      </div>
      <details class="sm-text"><summary>Erkannter Text</summary><pre data-no-i18n></pre></details>
    </section>
    <p class="sm-disclaimer">${oicon('info')}<span>${esc(DISCLAIMER)}</span></p>
  </div>`);
  screen.body.appendChild(wrap);
  screen.setFoot([]);
  const typeSel = $('[data-type]', wrap);
  typeSel.value = rec.type;
  const open = $('[data-open]', wrap);
  if (doc) open.href = doc.kind && doc.kind !== 'pdf' && doc.kind !== 'image' ? `#/bearbeiten/${doc.id}` : doc.kind === 'image' ? `#/dateien` : `#/ansicht/${doc.id}`;
  else open.hidden = true;
  $('pre', wrap).textContent = rec.text || '(kein Text erkannt)';

  const paintHead = () => {
    $('.sm-sender', wrap).textContent = rec.f.sender || 'Absender unbekannt';
    const bits = [rec.subtype && SUBTYPE_LABELS[rec.subtype] ? SUBTYPE_LABELS[rec.subtype] : null, rec.f.date ? `vom ${deDate(rec.f.date)}` : null, rec.f.amount != null && rec.f.amount !== '' ? money(rec.f.amount) : null].filter(Boolean);
    $('.sm-sub', wrap).textContent = bits.join(' · ');
    const c = Math.round((rec.confidence || 0) * 100);
    $('.sm-conf-bar > span', wrap).style.width = `${c}%`;
    $('[data-conf]', wrap).textContent = `${c} % sicher`;
    $('.sm-conf', wrap).classList.toggle('low', c < 50);
    const due = rec.f.due;
    const box = $('[data-duebox]', wrap);
    box.hidden = !due;
    if (due) {
      const n = daysUntil(due);
      box.className = `sm-due-box ${n < 0 ? 'over' : n <= 7 ? 'soon' : ''}`;
      box.innerHTML = `${oicon('bell')}<div><strong></strong><span class="small"></span></div>`;
      // separate text nodes so each part is translated on its own (label, date, relative time)
      const st = $('strong', box), sp = t => { const e = document.createElement('span'); e.textContent = t; return e; };
      st.append(sp(rec.f.dueLabel || 'Frist'), ': ', sp(deDate(due)), ' (', sp(relDays(n)), ')');
      const dl = rec.deadlines.find(d => d.date === due);
      $('span.small', box).textContent = dl && dl.hint ? dl.hint : rec.directDebit && rec.type !== 'bescheid' ? 'Laut Schreiben per Lastschrift – du musst nichts überweisen.' : '';
    }
    $('[data-act="status"]', wrap).innerHTML = `${oicon(rec.status === 'offen' ? 'check' : 'restore')}<span>${rec.status === 'offen' ? 'Als erledigt markieren' : 'Wieder öffnen'}</span>`;
    $('[data-act="zahlen"]', wrap).hidden = !(rec.f.iban || ['rechnung', 'mahnung', 'bescheid', 'versicherung'].includes(rec.type));
  };
  // fields
  const fields = $('[data-fields]', wrap);
  const save = debounce(async () => { await saveLetter(rec); paintHead(); }, 400);
  for (const [key, label, kind, wide] of FIELD_DEFS) {
    const val = key === 'amount' ? (rec.f.amount != null && rec.f.amount !== '' ? money(rec.f.amount).replace(/\s€$/, '') : '') : rec.f[key] || '';
    const row = fieldRow({ id: key, label, value: val, type: kind === 'date' ? 'date' : 'text', wide: !!wide, mono: kind === 'iban' });
    const input = $('input', row);
    if (kind === 'money') input.inputMode = 'decimal';
    if (kind === 'iban') {
      const st = h('<span class="sm-iban-state" aria-live="polite"></span>');
      row.appendChild(st);
      const check = () => { const v = input.value.trim(); st.textContent = !v ? '' : validIban(v) ? '✓ Prüfsumme korrekt' : '⚠ Prüfsumme falsch – bitte prüfen'; st.className = `sm-iban-state ${v && !validIban(v) ? 'bad' : 'ok'}`; };
      check();
      input.addEventListener('input', check);
    }
    input.addEventListener('input', () => {
      if (key === 'amount') rec.f.amount = parseMoney(input.value);
      else rec.f[key] = input.value.trim();
      save();
    });
    fields.appendChild(row);
  }
  typeSel.addEventListener('change', async () => {
    rec.type = typeSel.value; rec.subtype = null; rec.confidence = 1;
    $('.sm-type-ic.big', wrap).innerHTML = typeIcon(rec.type);
    $('.sm-type-ic.big', wrap).className = `sm-type-ic big t-${rec.type}`;
    await saveLetter(rec); paintHead();
  });
  // deadlines
  if (rec.deadlines && rec.deadlines.length) {
    const box = $('[data-deadlines]', wrap);
    box.hidden = false;
    const dl = $('[data-dl]', box);
    rec.deadlines.forEach(d => {
      const n = daysUntil(d.date);
      const it = h(`<div class="sm-dl-item ${n < 0 ? 'past' : ''}"><span class="sm-dl-date"></span><div><strong></strong><span class="small muted sm-dl-hint" data-no-i18n></span></div>
        <button class="btn btn-ghost btn-sm" type="button">${oicon('bell')}<span>Eintragen</span></button></div>`);
      $('.sm-dl-date', it).textContent = deDate(d.date);
      const st = $('strong', it), sp = t => { const e = document.createElement('span'); e.textContent = t; return e; };
      st.append(sp(d.label));
      if (d.computed) st.append(' ', sp('(berechnet)'));
      st.append(' · ', sp(relDays(n)));
      $('.sm-dl-hint', it).textContent = d.hint || d.source || '';
      if (d.hint) delete $('.sm-dl-hint', it).dataset.noI18n; // generated explanation → translatable; a quote from the letter is not
      $('button', it).addEventListener('click', () => addDeadline(rec, d));
      dl.appendChild(it);
    });
  }
  if (rec.cancel && rec.cancel.text) { const c = $('[data-contract]', wrap); c.hidden = false; $('[data-ctext]', c).textContent = rec.cancel.text; }
  paintHead();

  wrap.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    try {
      if (act === 'frist') await addDeadline(rec, rec.f.due ? { date: rec.f.due, kind: rec.f.dueKind, label: rec.f.dueLabel } : null);
      if (act === 'zahlen') await transferDialog(rec);
      if (act === 'antwort') await answerMenu(b, rec);
      if (act === 'ablegen') { if (await fileDialog(rec)) paintHead(); }
      if (act === 'ki') { if (await improveWithAi(rec)) { location.reload(); } }
      if (act === 'steuer') { const { addReceiptFromLetter } = await import('./tax.js'); const r = await addReceiptFromLetter(rec); if (r) location.hash = `#/steuer/${r.year}?beleg=${r.id}`; }
      if (act === 'status') { rec.status = rec.status === 'offen' ? 'erledigt' : 'offen'; await saveLetter(rec); paintHead(); toast(rec.status === 'erledigt' ? 'Erledigt ✓' : 'Wieder offen', 'success'); }
      if (act === 'neu') { location.hash = `#/briefkasten/neu?doc=${encodeURIComponent(rec.docId)}`; }
      if (act === 'loeschen') {
        if (!await confirmDialog('Aus dem Briefkasten entfernen?', 'Die erkannten Angaben werden gelöscht. Das Dokument selbst bleibt in deinen Dateien.', { okLabel: 'Entfernen', danger: true })) return;
        await sdb.del('letters', rec.id);
        for (const o of await sdb.byIndex('facts', 'docId', rec.docId)) if (o.letterId === rec.id) await sdb.del('facts', o.id);
        emitSmart('letters');
        location.replace('#/briefkasten');
      }
    } catch (e) { errorToast(e, 'Das hat nicht geklappt.'); }
  });
  const off = onSmartChange(w => { if (w === 'letter-reload') location.reload(); });
  return () => off();
}

// ------------------------------------------------------------------ actions
const REM_TYPE = { zahlung: 'zahlung', kuendigung: 'kuendigung', vertragsende: 'ablauf', widerspruch: 'termin', frist: 'termin', abbuchung: 'zahlung' };
async function addDeadline(rec, d) {
  const R = await import('../extras/reminders.js');
  const who = rec.f.sender || typeInfo(rec.type).label;
  const titles = { zahlung: `${who} bezahlen`, widerspruch: `Widerspruchsfrist ${who}`, kuendigung: `${who} kündigen`, vertragsende: `Vertrag ${who} endet`, frist: `Frist: ${who}`, abbuchung: `Abbuchung ${who} prüfen` };
  const kind = d && d.kind ? d.kind : 'frist';
  let title = titles[kind] || `Frist: ${who}`;
  if (kind === 'widerspruch' && /einspruch/i.test(d.label || '')) title = `Einspruchsfrist ${who}`;
  const n = d && d.date ? daysUntil(d.date) : null;
  const note = [rec.f.amount != null && rec.f.amount !== '' ? money(rec.f.amount) : '', rec.f.rechnungsnummer ? `Rechnung ${rec.f.rechnungsnummer}` : '', rec.f.aktenzeichen ? `Az. ${rec.f.aktenzeichen}` : '', rec.f.kundennummer ? `Kd.-Nr. ${rec.f.kundennummer}` : '', d && d.computed ? 'Frist berechnet – bitte prüfen' : ''].filter(Boolean).join(' · ');
  const out = await R.reminderDialog({ title: title.slice(0, 200), type: REM_TYPE[kind] || 'termin', due: d && d.date ? d.date : '', leads: n != null && n > 10 ? [7, 1] : [1], docId: rec.docId, note });
  if (out) { rec.reminders = [...(rec.reminders || []), out.id]; await saveLetter(rec); }
  return out;
}

async function transferDialog(rec) {
  const { epcPayload, epcSvg, epcPng } = await import('./epc.js');
  const v = { name: rec.f.sender || '', iban: rec.f.iban || '', bic: rec.f.bic || '', amount: rec.f.amount != null && rec.f.amount !== '' ? rec.f.amount : null, purpose: rec.f.purpose || '' };
  if (rec.directDebit && rec.type !== 'mahnung') {
    const go = await openDialog({ title: 'Lastschrift erkannt', body: '<p>Laut Schreiben wird der Betrag per Lastschrift von deinem Konto abgebucht – du musst normalerweise nichts überweisen.</p>', actions: [{ label: 'Schließen', value: 'cancel' }, { label: 'Trotzdem vorbereiten', value: 'ok', kind: 'btn-primary' }] });
    if (go.value !== 'ok') return;
  }
  let payload = null;
  await openDialog({
    title: 'Überweisung vorbereiten', wide: true,
    body: `<div class="sm-transfer">
      <div class="sm-qr" data-qr aria-label="GiroCode"></div>
      <div class="sm-transfer-fields"></div>
      <p class="small muted">Scanne den GiroCode mit deiner Banking-App (Funktion „Foto-Überweisung“ / „GiroCode“) oder kopiere die Angaben. <strong>FaLe löst keine Zahlung aus</strong> – du prüfst und bestätigst alles in deiner Bank.</p>
      <p class="small sm-err" data-err hidden></p></div>`,
    actions: [{ label: 'Schließen', value: 'close' }, { label: 'GiroCode teilen', value: 'share', kind: 'btn-ghost' }],
    validate: (val) => {
      if (val === 'share' && payload) { epcPng(payload).then(b => import('../ui.js').then(u => u.shareBlob(b, 'GiroCode.png', 'image/png'))); return false; }
      return true;
    },
    onMount: dlg => {
      const box = $('.sm-transfer-fields', dlg);
      const defs = [['name', 'Empfänger'], ['iban', 'IBAN'], ['bic', 'BIC (optional)'], ['amount', 'Betrag (€)'], ['purpose', 'Verwendungszweck']];
      const redraw = async () => {
        const err = $('[data-err]', dlg);
        try {
          payload = epcPayload({ ...v, amount: v.amount });
          $('[data-qr]', dlg).innerHTML = await epcSvg(payload, { size: 220 });
          $('[data-qr]', dlg).dataset.payload = payload;
          err.hidden = true;
        } catch (e) { payload = null; $('[data-qr]', dlg).innerHTML = `<div class="sm-qr-empty">${oicon('qr')}</div>`; err.textContent = e.userMessage || 'Bitte Angaben prüfen.'; err.hidden = false; }
      };
      for (const [k, label] of defs) {
        const row = fieldRow({ id: `t_${k}`, label, value: k === 'amount' ? (v.amount != null ? money(v.amount).replace(/\s€$/, '') : '') : v[k], mono: k === 'iban' });
        const inp = $('input', row);
        const cp = h(`<button class="icon-btn sm-copy" type="button" aria-label="${esc(label)} kopieren">${oicon('copy')}</button>`);
        cp.addEventListener('click', async () => { if (await copyText(inp.value)) toast(`${label} kopiert`, 'success'); });
        row.appendChild(cp);
        inp.addEventListener('input', debounce(() => { v[k] = k === 'amount' ? parseMoney(inp.value) : inp.value; redraw(); }, 250));
        box.appendChild(row);
      }
      redraw();
      return null;
    },
  });
}

function guessArt(rec) {
  const t = `${rec.f.sender} ${rec.f.subject} ${rec.text || ''}`.toLowerCase();
  if (/mobilfunk|handy|rufnummer|allnet|sim-karte|\d+\s?gb\b/.test(t)) return 'handy';
  if (/fitness|studio|mitgliedschaft|sport/.test(t)) return 'fitness';
  if (/strom|gas\b|gasliefer|energie|stadtwerke|kwh/.test(t)) return 'strom';
  if (/versicherung|police|versicherungsschein/.test(t)) return 'versicherung';
  if (/stream|serien|filme|musik/.test(t)) return 'streaming';
  if (/abo\b|abonnement|zeitschrift|zeitung/.test(t)) return 'abo';
  if (/miete|mietvertrag|vermieter/.test(t)) return 'miete';
  return 'handy';
}
function splitAddress(a) {
  const s = String(a || '');
  const m = /^(.*?),?\s*((?:D-)?\d{5}\s+.+)$/.exec(s);
  return m ? { street: m[1].replace(/,\s*$/, '').trim(), city: m[2].trim() } : { street: s, city: '' };
}

async function answerMenu(anchor, rec) {
  const { officeMenu } = await import('../office/kinds.js');
  const L = await import('../extras/letters.js');
  const addr = splitAddress(rec.f.senderAddress);
  const base = { r_name: rec.f.sender || '', r_strasse: addr.street || '', r_ort: addr.city || '' };
  const go = (id, values, art) => { L.setLetterPrefill(id, { ...base, ...values }); location.hash = `#/schreiben/${id}${art ? `?art=${art}` : ''}`; };
  const items = [];
  if (rec.type === 'bescheid') {
    const steuer = rec.subtype === 'steuer' || /finanzamt/i.test(rec.f.sender);
    items.push({ label: steuer ? 'Einspruch einlegen' : 'Widerspruch einlegen', icon: 'scale', onClick: () => go('widerspruch', { typ: steuer ? 'einspruch' : 'widerspruch', bescheidart: (rec.f.subject || 'Bescheid').replace(/^betreff:?\s*/i, '').slice(0, 120), datum_bescheid: rec.f.date || '', az: rec.f.aktenzeichen || rec.f.steuernummer || '' }) });
  }
  if (['mahnung', 'rechnung', 'bescheid'].includes(rec.type)) {
    items.push({ label: 'Auf Zahlungsaufforderung antworten', icon: 'euro', onClick: () => go('mahnung-antwort', { zeichen: rec.f.rechnungsnummer || rec.f.aktenzeichen || rec.f.kundennummer || '', datum_schreiben: rec.f.date || '', betrag: rec.f.amount != null && rec.f.amount !== '' ? money(rec.f.amount).replace(/\s€$/, '') : '' }) });
  }
  if (['vertrag', 'versicherung', 'rechnung', 'arzt'].includes(rec.type) && rec.subtype !== 'kuendigungsbestaetigung') {
    const art = guessArt(rec);
    const extra = { kundennr: rec.f.kundennummer || '', vertragsnr: rec.f.vertragsnummer || '', mitgliedsnr: rec.f.kundennummer || rec.f.vertragsnummer || '', police: rec.f.vertragsnummer || '', abonr: rec.f.vertragsnummer || rec.f.kundennummer || '', dienst: rec.f.sender || '' };
    if (rec.cancel && rec.cancel.end) { extra.termin = 'datum'; extra.termin_datum = rec.cancel.end; }
    items.push({ label: 'Kündigung schreiben', icon: 'letter', onClick: () => go('kuendigung', extra, art) });
  }
  items.push({ label: 'Widerruf (Kauf/Vertrag)', icon: 'restore', onClick: () => go('widerruf', { bestellnr: rec.f.rechnungsnummer || rec.f.vertragsnummer || '' }) });
  officeMenu(anchor, items, { label: 'Antwort schreiben' });
}

async function fileDialog(rec) {
  const doc = await db.getDoc(rec.docId);
  if (!doc) { toast('Das Dokument gibt es nicht mehr.', 'error'); return false; }
  const fl = rec.filing || { parent: 'Post', folder: typeInfo(rec.type).plural, tags: [typeInfo(rec.type).label] };
  const ext = (doc.name.match(/\.[a-z0-9]{2,5}$/i) || [''])[0];
  const isImage = doc.kind === 'image';
  const suggestedName = `${rec.f.date || todayIso()} ${typeInfo(rec.type).label} ${rec.f.sender || ''}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
  const r = await openDialog({
    title: 'Ablegen', wide: true,
    body: `<div class="sm-file-form"></div>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Ablegen', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => {
      const box = $('.sm-file-form', dlg);
      box.appendChild(fieldRow({ id: 'f_parent', label: 'Ordner', value: fl.parent }));
      box.appendChild(fieldRow({ id: 'f_folder', label: 'Unterordner', value: fl.folder }));
      box.appendChild(fieldRow({ id: 'f_tags', label: 'Tags (mit Komma getrennt)', value: fl.tags.join(', '), wide: true }));
      box.appendChild(fieldRow({ id: 'f_name', label: 'Dateiname', value: suggestedName, wide: true }));
      const chk = h(`<label class="check sm-check"><input type="checkbox" name="f_search" checked><span>${isImage ? 'Als durchsuchbare PDF speichern (Foto + erkannter Text)' : 'Durchsuchbar machen (unsichtbare Textebene, falls der Scan noch keine hat)'}</span></label>`);
      if (!isImage && !rec.ocr) chk.hidden = true;
      box.appendChild(chk);
      return { collect: () => ({ parent: $('[name=f_parent]', dlg).value, folder: $('[name=f_folder]', dlg).value, tags: $('[name=f_tags]', dlg).value.split(',').map(s => s.trim()).filter(Boolean), name: $('[name=f_name]', dlg).value.trim(), searchable: !chk.hidden && $('[name=f_search]', dlg).checked }) };
    },
  });
  if (r.value !== 'ok' || !r.data) return false;
  const { progress } = await import('../ui.js');
  const prog = progress('Wird abgelegt …');
  try {
    const lib = await import('../library.js');
    let docId = rec.docId;
    if (r.data.searchable) {
      const cached = ocrCache.get(docId);
      if (isImage) {
        prog.set('Durchsuchbare PDF wird erstellt …');
        const { imagesToSearchablePdf } = await import('../ocr/searchable.js');
        const blob = await db.getFile(docId);
        const out = await imagesToSearchablePdf([{ source: blob, result: cached && cached.image ? cached.image : null }], { title: r.data.name || 'Brief' });
        const bytes = out.bytes || out;
        const meta = await lib.importPdf(bytes, { name: `${r.data.name || 'Brief'}.pdf`, source: 'Erstellt', silent: true });
        await db.deleteDoc(docId); // the photo goes to the Papierkorb (30 days)
        docId = meta.id;
        rec.docId = docId;
      } else if (rec.ocr) {
        prog.set('Textebene wird hinzugefügt …');
        const blob = await db.getFile(docId);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let out;
        if (cached && cached.pages) out = await (await import('./textsrc.js')).searchablePdf(bytes, cached.pages, doc.name);
        else out = (await (await import('../ocr/searchable.js')).makeSearchable(bytes, { name: doc.name, key: docId })).bytes;
        await db.replaceFile(docId, new Blob([out], { type: 'application/pdf' }), { textReady: false, modifiedAt: Date.now() });
        lib.reindexDoc(docId).catch(() => {});
      }
    }
    const folder = await ensureFolderPath([r.data.parent || 'Post', r.data.folder].filter(Boolean));
    const tags = await ensureTags(r.data.tags);
    const cur = await db.getDoc(docId);
    const patch = { folder, tags: [...new Set([...(cur.tags || []), ...tags])] };
    if (r.data.name) patch.name = r.data.name + (/\.pdf$/i.test(cur.name) ? '.pdf' : isImage ? '.pdf' : ext);
    await db.updateDoc(docId, patch);
    lib.emitChange();
    rec.filed = true;
    rec.docName = patch.name || cur.name;
    await saveLetter(rec);
    toast('Abgelegt ✓', 'success');
    return true;
  } finally { prog.done(); }
}

/** Optional cloud AI: only on explicit tap, shows what is sent, needs consent (js/ai/ui.js ensureCloud). */
async function improveWithAi(rec) {
  const text = String(rec.text || '').slice(0, 12000);
  if (text.trim().length < 40) { toast('Es gibt zu wenig erkannten Text für die KI.', 'info'); return false; }
  const r = await openDialog({
    title: 'Mit KI verbessern?', wide: true,
    body: `<p>Der erkannte Text dieses Briefs (ca. ${Math.round(text.length / 100) / 10} Tausend Zeichen) wird an die Cloud-KI gesendet, um die Angaben zu prüfen und zu ergänzen. Das Dokument selbst wird nicht hochgeladen.</p>
      <p class="muted small">Tipp: Briefe mit Gesundheits- oder Kontodaten musst du nicht senden – die Erkennung auf dem Gerät funktioniert auch ohne KI.</p>
      <details class="sm-text"><summary>Diesen Text senden</summary><pre data-no-i18n></pre></details>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Senden & verbessern', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => { $('pre', dlg).textContent = text; return null; },
  });
  if (r.value !== 'ok') return false;
  const ui = await import('../ai/ui.js');
  if (!(await ui.ensureCloud())) return false;
  const { progress } = await import('../ui.js');
  const prog = progress('Die KI liest den Brief …');
  try {
    const C = await import('../ai/client.js');
    const res = await C.runTask('letter_extract', { text }, { lang: 'de' });
    const o = res.output || {};
    const changes = [];
    const setIf = (k, v) => { if (v == null || v === '') return; const cur = rec.f[k]; if (cur === '' || cur == null) { rec.f[k] = v; changes.push(k); } };
    if (o.type && DOC_TYPES.some(t => t.id === o.type) && (rec.confidence || 0) < 0.6) { rec.type = o.type; changes.push('type'); }
    setIf('sender', o.sender); setIf('recipient', o.recipient); setIf('date', o.date); setIf('subject', o.subject);
    if (o.amount != null && (rec.f.amount == null || rec.f.amount === '')) { rec.f.amount = o.amount; changes.push('amount'); }
    if (o.iban && validIban(o.iban)) setIf('iban', formatIban(o.iban));
    setIf('bic', o.bic); setIf('purpose', o.purpose); setIf('kundennummer', o.customer_number); setIf('rechnungsnummer', o.invoice_number);
    setIf('vertragsnummer', o.contract_number); setIf('aktenzeichen', o.reference); setIf('phone', o.phone); setIf('email', o.email);
    if (o.due_date && !rec.f.due) { rec.f.due = o.due_date; rec.f.dueLabel = o.due_label || 'Frist (KI)'; rec.f.dueKind = 'frist'; changes.push('due'); }
    rec.ai = { at: Date.now(), summary: o.summary || '', changes };
    await saveLetter(rec);
    toast(changes.length ? `KI hat ${changes.length} Angabe${changes.length === 1 ? '' : 'n'} ergänzt.` : 'Die KI hat nichts Neues gefunden.', 'success', { timeout: 5000 });
    return changes.length > 0;
  } catch (e) { (await import('../ai/ui.js')).showAiError(e); return false; }
  finally { prog.done(); }
}

export { TAX_CATEGORIES };
