// Tool: Notfallordner (emergency binder) – everything relatives need if something happens: emergency contacts,
// health information, doctors, insurances, bank accounts, contracts, where important documents are kept, online
// accounts (no passwords – only where they are kept), pets, keys and wishes. Output: a printable PDF with a cover,
// table of contents and a wallet card to cut out; optionally a JSON file to continue editing later. Nothing is
// stored automatically (health data!) – the data stays in this tab until the user saves the file.
import { el, T, s, form, userError, ensureCss, isoDate, fmtDate, note, entryList, pdfPreview, clear } from '../lib/tpl-core.js';
import { createWriter, collectText, mm } from '../lib/tpl-pdf.js';
import { missingWarning } from '../lib/unifont.js';

ensureCss();

const DOCS = [
  ['testament', { de: 'Testament / Erbvertrag', en: 'Will' }],
  ['vorsorge', { de: 'Vorsorgevollmacht', en: 'Lasting power of attorney' }],
  ['patient', { de: 'Patientenverfügung', en: 'Advance healthcare directive' }],
  ['betreuung', { de: 'Betreuungsverfügung', en: 'Guardianship directive' }],
  ['ausweis', { de: 'Personalausweis / Reisepass', en: 'ID card / passport' }],
  ['urkunden', { de: 'Geburts- und Heiratsurkunde', en: 'Birth and marriage certificates' }],
  ['rente', { de: 'Renten- und Versicherungsunterlagen', en: 'Pension and insurance papers' }],
  ['wohnen', { de: 'Mietvertrag / Grundbuchauszug', en: 'Tenancy agreement / land register' }],
  ['steuer', { de: 'Steuerunterlagen', en: 'Tax documents' }],
  ['fahrzeug', { de: 'Fahrzeugpapiere', en: 'Vehicle documents' }],
  ['organ', { de: 'Organspendeausweis', en: 'Organ donor card' }],
];

const LISTS = {
  contacts: { title: { de: 'Notfallkontakte', en: 'Emergency contacts' }, item: { de: 'Kontakt', en: 'Contact' },
    cols: [['name', { de: 'Name', en: 'Name' }, 3], ['rel', { de: 'Beziehung', en: 'Relation' }, 2], ['phone', { de: 'Telefon', en: 'Phone' }, 2], ['mail', { de: 'E-Mail', en: 'E-mail' }, 3]] },
  doctors: { title: { de: 'Ärztinnen und Ärzte', en: 'Doctors' }, item: { de: 'Praxis', en: 'Practice' },
    cols: [['name', { de: 'Name / Praxis', en: 'Name / practice' }, 3], ['field', { de: 'Fachrichtung', en: 'Speciality' }, 2], ['phone', { de: 'Telefon', en: 'Phone' }, 2]] },
  insur: { title: { de: 'Versicherungen', en: 'Insurances' }, item: { de: 'Versicherung', en: 'Insurance' },
    cols: [['kind', { de: 'Art', en: 'Type' }, 2], ['company', { de: 'Gesellschaft', en: 'Company' }, 2], ['number', { de: 'Vertrags-/Versichertennr.', en: 'Policy number' }, 2], ['phone', { de: 'Telefon', en: 'Phone' }, 2]] },
  banks: { title: { de: 'Banken und Konten', en: 'Banks and accounts' }, item: { de: 'Konto', en: 'Account' },
    cols: [['bank', { de: 'Bank', en: 'Bank' }, 2], ['kind', { de: 'Art (Giro, Depot …)', en: 'Type (current, savings …)' }, 2], ['iban', { de: 'IBAN (optional)', en: 'IBAN (optional)' }, 3], ['note', { de: 'Hinweis (z. B. Vollmacht für …)', en: 'Note' }, 3]] },
  contracts: { title: { de: 'Verträge und Abos', en: 'Contracts and subscriptions' }, item: { de: 'Vertrag', en: 'Contract' },
    cols: [['what', { de: 'Was (Strom, Handy …)', en: 'What (power, phone …)' }, 2], ['provider', { de: 'Anbieter', en: 'Provider' }, 2], ['number', { de: 'Kunden-/Vertragsnr.', en: 'Customer number' }, 2], ['note', { de: 'Hinweis', en: 'Note' }, 3]] },
  online: { title: { de: 'Online-Konten', en: 'Online accounts' }, item: { de: 'Konto', en: 'Account' },
    cols: [['service', { de: 'Dienst (E-Mail, Social Media …)', en: 'Service' }, 3], ['user', { de: 'Benutzername / E-Mail', en: 'Username / e-mail' }, 3], ['wish', { de: 'Wunsch (löschen, Gedenkzustand …)', en: 'Wish (delete, memorialise …)' }, 3]] },
};

const empty = () => ({
  p: { name: '', birth: '', street: '', city: '', phone: '', blood: '', allergies: '', conditions: '', meds: '', binderWhere: '' },
  contacts: [{}], doctors: [{}], insur: [{}], banks: [{}], contracts: [{}], online: [{}],
  docs: Object.fromEntries(DOCS.map(([k]) => [k, { has: false, where: '' }])),
  pwHint: '', pets: '', keys: '', wishes: '', date: isoDate(),
});
const filled = row => Object.values(row || {}).some(x => s(x));

// ---------------------------------------------------------------- PDF
export async function makePdf(v, lang) {
  const de = lang === 'de';
  const t = x => T(lang, x);
  const p = v.p || {};
  const w = await createWriter({ text: collectText(v).join('\n'), lang, margins: { t: 20, b: 20 } });
  const head = text => { w.ensure(60); w.space(10); w.para(text, { font: w.bold, size: 14, after: 6 }); };
  const sections = [];

  // ---- cover
  w.newPage();
  w.para(de ? 'Notfallordner' : 'Emergency binder', { font: w.bold, size: 26, after: 4 });
  w.para(s(p.name) || (de ? '(Name)' : '(name)'), { size: 15, after: 2 });
  w.para(`${de ? 'Stand' : 'As of'}: ${fmtDate(v.date || isoDate(), lang)}`, { size: 10, color: w.GREY, after: 14 });
  w.para(de ? 'Dieser Ordner hilft Angehörigen, im Notfall schnell das Wichtigste zu finden: wen sie anrufen sollen, was Ärzte wissen müssen und wo Unterlagen liegen. Bitte regelmäßig aktualisieren und an einem Ort aufbewahren, den Vertraute kennen.'
    : 'This binder helps your family find the most important things quickly in an emergency: whom to call, what doctors need to know and where documents are kept. Please update it regularly and keep it where trusted people can find it.', { size: 10.5, lead: 1.45, after: 14 });

  const plan = [];
  const kvP = [[de ? 'Name' : 'Name', p.name], [de ? 'Geburtsdatum' : 'Date of birth', p.birth ? fmtDate(p.birth, lang) : ''], [de ? 'Anschrift' : 'Address', [s(p.street), s(p.city)].filter(Boolean).join(', ')], [de ? 'Telefon' : 'Phone', p.phone]].filter(r => s(r[1]));
  if (kvP.length) plan.push(['person', de ? 'Persönliche Angaben' : 'Personal details']);
  const health = [[de ? 'Blutgruppe' : 'Blood group', p.blood], [de ? 'Allergien' : 'Allergies', p.allergies], [de ? 'Erkrankungen' : 'Conditions', p.conditions], [de ? 'Medikamente' : 'Medication', p.meds]].filter(r => s(r[1]));
  if (health.length) plan.push(['health', de ? 'Gesundheit' : 'Health']);
  for (const [k, L] of Object.entries(LISTS)) if ((v[k] || []).some(filled)) plan.push([k, t(L.title)]);
  const docs = DOCS.filter(([k]) => v.docs?.[k]?.has || s(v.docs?.[k]?.where));
  if (docs.length) plan.push(['docs', de ? 'Wo liegt was?' : 'Where is what?']);
  if (s(v.pwHint)) plan.push(['pw', de ? 'Passwörter' : 'Passwords']);
  const misc = [[de ? 'Haustiere' : 'Pets', v.pets], [de ? 'Schlüssel' : 'Keys', v.keys], [de ? 'Wünsche' : 'Wishes', v.wishes]].filter(r => s(r[1]));
  if (misc.length) plan.push(['misc', de ? 'Sonstiges und Wünsche' : 'Other and wishes']);
  if (plan.length) {
    w.para(de ? 'Inhalt' : 'Contents', { font: w.bold, size: 12, after: 4 });
    plan.forEach(([, label], i) => w.para(`${i + 1}. ${label}`, { size: 10.5, after: 1 }));
    w.space(10);
  }

  // ---- wallet card (85.6 × 54 mm) to cut out
  const cw = mm(85.6), ch = mm(54);
  if (w.y < mm(26) + ch + mm(14)) w.newPage();
  const cx = w.L, cy = mm(26);
  w.page.drawRectangle({ x: cx, y: cy, width: cw, height: ch, borderColor: w.GREY, borderWidth: 0.6, borderDashArray: [3, 3] });
  w.line(de ? 'Notfallkarte – an der gestrichelten Linie ausschneiden und ins Portemonnaie stecken' : 'Emergency card – cut along the dashed line and keep it in your wallet', cx, cy + ch + 5, { size: 7.5, color: w.GREY });
  const lines = [];
  lines.push([de ? 'NOTFALLKARTE' : 'EMERGENCY CARD', w.bold, 9]);
  lines.push([`${s(p.name)}${p.birth ? ` · ${fmtDate(p.birth, lang)}` : ''}`, w.bold, 8.5]);
  const ice = (v.contacts || []).filter(filled).slice(0, 2);
  for (const c of ice) lines.push([`${de ? 'Notfall' : 'ICE'}: ${s(c.name)}${s(c.rel) ? ` (${s(c.rel)})` : ''} ${s(c.phone)}`, w.font, 7.5]);
  if (s(p.blood)) lines.push([`${de ? 'Blutgruppe' : 'Blood group'}: ${s(p.blood)}`, w.font, 7.5]);
  if (s(p.allergies)) lines.push([`${de ? 'Allergien' : 'Allergies'}: ${s(p.allergies)}`, w.font, 7.5]);
  if (s(p.meds)) lines.push([`${de ? 'Medikamente' : 'Medication'}: ${s(p.meds)}`, w.font, 7.5]);
  if (s(p.binderWhere)) lines.push([`${de ? 'Notfallordner' : 'Binder'}: ${s(p.binderWhere)}`, w.font, 7.5]);
  let ly = cy + ch - mm(6);
  for (const [txt, f, size] of lines) {
    for (const ln of w.wrap(txt, f, size, cw - mm(8)).slice(0, 2)) {
      if (ly < cy + mm(3)) break;
      w.line(ln, cx + mm(4), ly, { size, font: f });
      ly -= size * 1.3;
    }
  }

  // ---- sections
  const start = (key, label) => { sections.push(key); if (sections.length === 1) w.newPage(); head(`${sections.length}. ${label}`); };
  for (const [key, label] of plan) {
    start(key, label);
    if (key === 'person') w.kv(kvP, { labelWidth: mm(38) });
    else if (key === 'health') w.kv(health, { labelWidth: mm(38) });
    else if (LISTS[key]) {
      const L = LISTS[key];
      w.table(L.cols.map(([, lab, wgt]) => ({ label: t(lab), w: wgt })), (v[key] || []).filter(filled).map(r => L.cols.map(([k]) => s(r[k]))), { size: 9.5 });
    } else if (key === 'docs') {
      w.table([{ label: de ? 'Dokument' : 'Document', w: 3 }, { label: de ? 'Vorhanden' : 'Exists', w: 1 }, { label: de ? 'Wo liegt es?' : 'Where is it?', w: 4 }],
        docs.map(([k, lab]) => [t(lab), v.docs[k].has ? (de ? 'ja' : 'yes') : '', s(v.docs[k].where)]), { size: 9.5 });
    } else if (key === 'pw') {
      w.para(s(v.pwHint), { size: 10.5, lead: 1.4, after: 4 });
      w.para(de ? 'Hier stehen bewusst keine Passwörter – nur, wo sie zu finden sind.' : 'Deliberately no passwords here – only where to find them.', { size: 9, color: w.GREY });
    } else if (key === 'misc') {
      for (const [k, val] of misc) { w.para(k, { font: w.bold, size: 10.5, after: 2 }); w.para(s(val), { size: 10.5, lead: 1.4, after: 8 }); }
    }
  }
  if (!plan.length) { w.newPage(); w.para(de ? 'Noch keine Angaben.' : 'No details yet.', { color: w.GREY }); }
  w.numberPages();
  return w.finish({ title: `${de ? 'Notfallordner' : 'Emergency binder'}${s(p.name) ? ' – ' + s(p.name) : ''}` });
}

// ---------------------------------------------------------------- draft file (JSON) – only on request
const DRAFT_KIND = 'fale-notfallordner';
export function draftJson(v) { return JSON.stringify({ kind: DRAFT_KIND, version: 1, saved: new Date().toISOString(), data: v }, null, 1); }
export function readDraft(text) {
  let o;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || o.kind !== DRAFT_KIND || typeof o.data !== 'object') return null;
  const d = o.data, base = empty();
  const str = x => (typeof x === 'string' ? x.slice(0, 4000) : '');
  const out = { ...base, date: str(d.date) || base.date, pwHint: str(d.pwHint), pets: str(d.pets), keys: str(d.keys), wishes: str(d.wishes) };
  for (const k of Object.keys(base.p)) out.p[k] = str(d.p?.[k]);
  for (const [k, L] of Object.entries(LISTS)) {
    const rows = Array.isArray(d[k]) ? d[k].slice(0, 50) : [];
    out[k] = rows.map(r => Object.fromEntries(L.cols.map(([c]) => [c, str(r?.[c])])));
    if (!out[k].length) out[k] = [{}];
  }
  for (const [k] of DOCS) out.docs[k] = { has: !!d.docs?.[k]?.has, where: str(d.docs?.[k]?.where) };
  return out;
}

// ---------------------------------------------------------------- tool
let api = null;
export default {
  labels: { back_to_files: { de: 'Zurück zum Notfallordner', en: 'Back to the binder' } },
  options: [
    {
      id: 'draft', type: 'toggle', default: true,
      label: { de: 'Auch eine Datei zum Weiterbearbeiten speichern', en: 'Also save a file to continue editing' },
      hint: { de: 'Damit kannst du den Ordner später wieder öffnen und ändern. Die Datei enthält alle Angaben – bewahr sie sicher auf.', en: 'Lets you open and change the binder later. The file contains all details – keep it safe.' },
    },
  ],
  mountStage(stage, state, ctx) { api = stageFn(stage, state, ctx); },
  status(values, inputs, lang) {
    const v = values.nf || {};
    return s(v.p?.name) ? { summary: { de: 'Notfallordner', en: 'Emergency binder' } } : { ok: false, summary: { de: 'Notfallordner', en: 'Emergency binder' }, hint: { de: 'Noch nötig: dein Name.', en: 'Still needed: your name.' } };
  },
  async run(inputs, opts, ctx) {
    const v = opts.nf || {};
    if (!s(v.p?.name)) throw userError('Bitte gib zuerst deinen Namen ein.', 'Please enter your name first.');
    ctx.progress(0.3, { de: 'PDF wird erstellt …', en: 'Creating PDF …' });
    const { bytes, missing, pages } = await makePdf(v, ctx.lang);
    const mw = missingWarning(missing);
    if (mw) ctx.note(mw);
    ctx.note({ de: 'Ausdrucken, die Notfallkarte ausschneiden und den Ordner an einem Ort aufbewahren, den Vertraute kennen. Der Notfallordner ersetzt kein Testament und keine Vorsorgevollmacht – dafür gelten eigene Formvorschriften.', en: 'Print it, cut out the emergency card and keep the binder where trusted people can find it. It does not replace a will or a power of attorney – those have their own formal requirements.' });
    const base = `${ctx.t({ de: 'Notfallordner', en: 'Emergency binder' })} – ${s(v.p.name)}`;
    const outputs = [{ name: ctx.safeFileName(base + '.pdf'), blob: new Blob([bytes], { type: 'application/pdf' }), pages }];
    if (opts.draft) outputs.push({ name: ctx.safeFileName(base + ' (zum Weiterbearbeiten).json'), blob: new Blob([draftJson(v)], { type: 'application/json' }), note: ctx.t({ de: 'Später hier wieder öffnen', en: 'Open here again later' }) });
    api?.done();
    return { outputs };
  },
};

function stageFn(stage, state, ctx) {
  const lang = ctx.lang, de = lang === 'de';
  const v = (state.values.nf ||= empty());
  clear(stage);
  const pv = pdfPreview(lang, { maxPages: 3 });
  const changed = () => { state.results.clear(); ctx.refresh(); pv.schedule(async () => (await makePdf(v, lang)).bytes, 700); };
  const f = form(v, lang, changed, 'nf');
  const fp = form(v.p, lang, changed, 'nf-p');

  // load a saved draft
  const loadInput = el('input', { type: 'file', accept: '.json,application/json', class: 'wt-picker', tabindex: '-1' });
  const loadMsg = el('p', { class: 'tpl-err', role: 'status', hidden: true });
  loadInput.addEventListener('change', async () => {
    const file = loadInput.files[0];
    loadInput.value = '';
    if (!file) return;
    const d = file.size < 2e6 ? readDraft(await file.text()) : null;
    if (!d) { loadMsg.textContent = T(lang, { de: 'Diese Datei ist kein gespeicherter Notfallordner.', en: 'This file is not a saved emergency binder.' }); loadMsg.hidden = false; return; }
    state.values.nf = d;
    api = stageFn(stage, state, ctx);
    ctx.refresh();
  });

  const list = (key) => {
    const L = LISTS[key];
    const items = v[key];
    const box = entryList({ items, lang, onChange: changed, make: () => ({}), min: 1, max: 30,
      labels: { add: { de: `+ ${L.item.de} hinzufügen`, en: `+ Add ${L.item.en.toLowerCase()}` }, item: i => ({ de: `${L.item.de} ${i + 1}`, en: `${L.item.en} ${i + 1}` }) },
      render: (it) => f.grid(...L.cols.map(([k, lab]) => f.field(k, lab, { obj: it, maxLength: 120, type: k === 'mail' ? 'email' : k === 'phone' ? 'tel' : 'text' }))) });
    return f.sec(`nf-h-${key}`, L.title, box.root);
  };
  const docRows = DOCS.map(([k, lab]) => {
    const o = v.docs[k];
    return f.grid(f.check('has', lab, { obj: o, id: `nf-doc-${k}` }), f.field('where', { de: 'Wo liegt es?', en: 'Where is it?' }, { obj: o, id: `nf-where-${k}`, maxLength: 160 }));
  });

  stage.append(el('div', { class: 'tpl-split' }, el('div', {},
    f.sec('nf-h-load', { de: 'Neu oder weiterbearbeiten', en: 'New or continue' },
      el('p', { class: 'img-muted' }, T(lang, { de: 'Deine Angaben werden nirgends gespeichert, solange du nicht selbst die Datei zum Weiterbearbeiten sicherst. Schon einen Notfallordner angelegt? Lade die Datei hier.', en: 'Your details are not stored anywhere unless you save the file to continue editing. Already made a binder? Load the file here.' })),
      el('div', { class: 'tpl-row' }, el('label', { class: 'wt-btn wt-btn-quiet wt-btn-sm' }, T(lang, { de: 'Gespeicherte Datei laden', en: 'Load saved file' }), loadInput)), loadMsg),
    f.sec('nf-h-person', { de: 'Über dich', en: 'About you' }, fp.grid(
      fp.field('name', { de: 'Vor- und Nachname', en: 'Full name' }, { wide: true, autocomplete: 'name' }), fp.field('birth', { de: 'Geburtsdatum', en: 'Date of birth' }, { type: 'date' }),
      fp.field('phone', { de: 'Telefon', en: 'Phone' }, { type: 'tel' }), fp.field('street', { de: 'Straße und Hausnummer', en: 'Street' }, { wide: true }),
      fp.field('city', { de: 'PLZ und Ort', en: 'Postcode and town' }), fp.field('binderWhere', { de: 'Wo liegt dieser Ordner?', en: 'Where is this binder kept?' }, { placeholder: { de: 'z. B. Wohnzimmerschrank, oberstes Fach', en: 'e.g. living room cupboard, top shelf' } }))),
    f.sec('nf-h-health', { de: 'Gesundheit (für Rettungsdienst und Ärzte)', en: 'Health (for paramedics and doctors)' }, fp.grid(
      fp.field('blood', { de: 'Blutgruppe (optional)', en: 'Blood group (optional)' }, { maxLength: 10 }),
      fp.field('allergies', { de: 'Allergien / Unverträglichkeiten', en: 'Allergies / intolerances' }, { wide: true }),
      fp.field('conditions', { de: 'Wichtige Erkrankungen', en: 'Important conditions' }, { wide: true }),
      fp.field('meds', { de: 'Medikamente (mit Dosis)', en: 'Medication (with dose)' }, { wide: true, maxLength: 400 }))),
    list('contacts'), list('doctors'), list('insur'), list('banks'), list('contracts'),
    f.sec('nf-h-docs', { de: 'Wo liegt was?', en: 'Where is what?' }, el('p', { class: 'img-muted' }, T(lang, { de: 'Hak an, was es gibt, und schreib dazu, wo es liegt.', en: 'Tick what exists and note where it is.' })), ...docRows),
    list('online'),
    f.sec('nf-h-pw', { de: 'Passwörter', en: 'Passwords' }, f.area('pwHint', { de: 'Wo findet man deine Passwörter?', en: 'Where can your passwords be found?' }, { rows: 2, placeholder: { de: 'z. B. Passwort-Manager – Hauptpasswort im versiegelten Umschlag beim Testament', en: 'e.g. password manager – master password in a sealed envelope with the will' } }),
      note(lang, { de: 'Schreib hier keine Passwörter hinein – nur, wo sie zu finden sind.', en: 'Do not write passwords here – only where to find them.' })),
    f.sec('nf-h-misc', { de: 'Sonstiges und Wünsche', en: 'Other and wishes' },
      f.area('pets', { de: 'Haustiere (Name, Futter, Tierarzt)', en: 'Pets (name, food, vet)' }, { rows: 2 }),
      f.area('keys', { de: 'Schlüssel (wer hat Ersatzschlüssel?)', en: 'Keys (who has spare keys?)' }, { rows: 2 }),
      f.area('wishes', { de: 'Wünsche (z. B. Bestattung, wer informiert werden soll)', en: 'Wishes (e.g. funeral, who should be told)' }, { rows: 3 }),
      f.grid(f.field('date', { de: 'Stand vom', en: 'As of' }, { type: 'date' })))),
  el('div', { class: 'tpl-side' }, f.sec('nf-h-pv', { de: 'Vorschau', en: 'Preview' }, pv.root,
    note(lang, { de: 'Keine Rechtsberatung. Testament, Vorsorgevollmacht und Patientenverfügung haben eigene Formvorschriften – hier wird nur festgehalten, wo sie liegen.', en: 'Not legal advice. Wills, powers of attorney and healthcare directives have their own formal requirements – this binder only records where they are kept.' })))));
  changed();
  return { done() {} };
}
