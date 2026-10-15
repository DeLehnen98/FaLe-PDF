// Tool: simple power of attorney (Vollmacht) for everyday matters – collecting post/parcels, dealing with an
// authority, general bank matters (with an honest note that banks/notaries usually need their own forms),
// registering/deregistering a vehicle, picking up a child from nursery/school, flat handover, or free text.
// Principal and agent, validity (one day / period / until revoked), sub-delegation, ID note, finger signature
// of the principal and specimen signature line for the agent. ID numbers are optional, only printed in the PDF
// and never stored (not part of "remember").
import { el, T, s, form, userError, ensureCss, isoDate, fmtDate, note, remember, signaturePad, pdfPreview, dateLine } from '../lib/tpl-core.js';
import { createWriter, collectText, mm } from '../lib/tpl-pdf.js';
import { missingWarning } from '../lib/unifont.js';
import { briefVorlage } from '../lib/arc2-brief.js';

ensureCss();

const P = {
  post: { label: { de: 'Post und Pakete abholen', en: 'Collect post and parcels' }, title: { de: 'Vollmacht zur Abholung von Post und Paketen', en: 'Authorisation to collect post and parcels' },
    fields: [['where', { de: 'Wo? (optional, z. B. Postfiliale oder Paketshop)', en: 'Where? (optional, e.g. post office)' }]],
    scope: (v, de) => (de ? `für mich bestimmte Briefe, Pakete und sonstige Sendungen – auch Einschreiben und Nachnahmesendungen –${s(v.where) ? ` bei ${s(v.where)}` : ''} abzuholen, in Empfang zu nehmen und den Empfang zu quittieren.`
      : `to collect and accept letters, parcels and other items addressed to me – including registered and cash-on-delivery items –${s(v.where) ? ` at ${s(v.where)}` : ''}, and to sign for them.`) },
  authority: { label: { de: 'Behördengang', en: 'Dealing with an authority' }, title: { de: 'Vollmacht für einen Behördengang', en: 'Authorisation to deal with an authority' },
    fields: [['office', { de: 'Behörde / Amt', en: 'Authority / office' }], ['matter', { de: 'Angelegenheit', en: 'Matter' }, { de: 'z. B. Abholung meines neuen Reisepasses', en: 'e.g. collecting my new passport' }]],
    scope: (v, de) => (de ? `mich gegenüber ${s(v.office) || 'der zuständigen Behörde'}${s(v.matter) ? ` in folgender Angelegenheit zu vertreten: ${s(v.matter)}` : ' zu vertreten'}. Die Vollmacht umfasst das Stellen von Anträgen, die Abgabe und Entgegennahme von Erklärungen und Unterlagen sowie die Abholung von Bescheiden und Dokumenten.`
      : `to represent me before ${s(v.office) || 'the competent authority'}${s(v.matter) ? ` in the following matter: ${s(v.matter)}` : ''}. This includes submitting applications, giving and receiving statements and documents, and collecting decisions and documents.`),
    hint: { de: 'Manche Dinge musst du persönlich erledigen, etwa den Antrag auf einen Personalausweis oder Reisepass (Fingerabdrücke). Die Abholung ist mit Vollmacht oft möglich – frag beim Amt nach.', en: 'Some things must be done in person, e.g. applying for an ID card or passport. Ask the office beforehand.' } },
  bank: { label: { de: 'Bankangelegenheiten (allgemein)', en: 'Bank matters (general)' }, title: { de: 'Vollmacht für Bankangelegenheiten', en: 'Authorisation for bank matters' },
    fields: [['bankName', { de: 'Bank', en: 'Bank' }], ['matter', { de: 'Welche Angelegenheiten?', en: 'Which matters?' }, { de: 'z. B. Abholung von Kontoauszügen', en: 'e.g. collecting bank statements' }]],
    scope: (v, de) => (de ? `mich gegenüber ${s(v.bankName) || 'meiner Bank'} in folgenden Angelegenheiten zu vertreten: ${s(v.matter) || 'Auskünfte einholen und Unterlagen entgegennehmen'}.`
      : `to represent me towards ${s(v.bankName) || 'my bank'} in the following matters: ${s(v.matter) || 'obtaining information and receiving documents'}.`),
    hint: { de: 'Wichtig: Banken erkennen formlose Vollmachten oft nicht an und verlangen ihr eigenes Formular (meist mit Unterschrift in der Filiale) oder eine notarielle Vollmacht. Frag am besten vorher bei deiner Bank nach.', en: 'Important: banks often do not accept informal authorisations and require their own form or a notarised power of attorney. Ask your bank first.' }, warn: true },
  vehicle: { label: { de: 'Fahrzeug an-, ab- oder ummelden', en: 'Register / deregister a vehicle' }, title: { de: 'Vollmacht zur Zulassung eines Fahrzeugs', en: 'Authorisation for vehicle registration' },
    fields: [['action', { de: 'Was soll erledigt werden?', en: 'What should be done?' }, null, [['zul', { de: 'Zulassung (Anmeldung)', en: 'Registration' }], ['abm', { de: 'Außerbetriebsetzung (Abmeldung)', en: 'Deregistration' }], ['umm', { de: 'Umschreibung / Ummeldung', en: 'Change of registration' }]]],
      ['plate', { de: 'Kennzeichen (falls vorhanden)', en: 'Licence plate (if any)' }], ['vin', { de: 'Fahrzeug-Identifizierungsnummer (optional)', en: 'Vehicle identification number (optional)' }], ['office', { de: 'Zulassungsbehörde (optional)', en: 'Registration office (optional)' }]],
    scope: (v, de) => {
      const act = { zul: de ? 'die Zulassung' : 'the registration', abm: de ? 'die Außerbetriebsetzung' : 'the deregistration', umm: de ? 'die Umschreibung' : 'the change of registration' }[v.action || 'zul'];
      const car = [s(v.plate) ? (de ? `mit dem Kennzeichen ${s(v.plate)}` : `with the licence plate ${s(v.plate)}`) : '', s(v.vin) ? (de ? `(FIN ${s(v.vin)})` : `(VIN ${s(v.vin)})`) : ''].filter(Boolean).join(' ');
      return de ? `für mich ${s(v.office) ? `bei ${s(v.office)} ` : 'bei der zuständigen Zulassungsbehörde '}${act} des Fahrzeugs${car ? ' ' + car : ''} zu beantragen, alle dafür nötigen Erklärungen abzugeben und Unterlagen, Kennzeichen und Plaketten entgegenzunehmen.`
        : `to apply on my behalf ${s(v.office) ? `at ${s(v.office)} ` : 'at the registration office '}for ${act} of the vehicle${car ? ' ' + car : ''}, to make all necessary statements and to receive documents, plates and stickers.`;
    },
    hint: { de: 'Für die Zulassung braucht die bevollmächtigte Person meist auch deinen Ausweis (oder eine Kopie), die Zulassungsbescheinigungen, den Versicherungsnachweis (eVB) und ein SEPA-Mandat für die Kfz-Steuer. Viele Zulassungsstellen haben eigene Vollmachtsformulare.', en: 'The registration office may ask for further documents and may have its own form.' } },
  child: { label: { de: 'Kind von Kita / Schule abholen', en: 'Pick up a child' }, title: { de: 'Vollmacht zur Abholung meines Kindes', en: 'Authorisation to pick up my child' },
    fields: [['childName', { de: 'Name des Kindes', en: 'Child’s name' }], ['childBirth', { de: 'Geburtsdatum des Kindes (optional)', en: 'Child’s date of birth (optional)' }, null, null, 'date'], ['institution', { de: 'Kita / Schule / Verein', en: 'Nursery / school / club' }]],
    scope: (v, de) => (de ? `mein Kind ${s(v.childName) || '…'}${v.childBirth ? `, geboren am ${fmtDate(v.childBirth, 'de')},` : ''} ${s(v.institution) ? `aus der Einrichtung ${s(v.institution)} ` : ''}abzuholen.`
      : `to pick up my child ${s(v.childName) || '…'}${v.childBirth ? `, born on ${fmtDate(v.childBirth, 'en')},` : ''} ${s(v.institution) ? `from ${s(v.institution)}` : ''}.`.replace(/\s+\./, '.')),
    hint: { de: 'Viele Kitas und Schulen haben eigene Formulare und wollen die abholende Person vorher kennen. Bei gemeinsamem Sorgerecht unterschreiben am besten beide Eltern.', en: 'Many nurseries and schools have their own forms. If parental responsibility is shared, both parents should sign.' } },
  flat: { label: { de: 'Wohnungsübergabe', en: 'Flat handover' }, title: { de: 'Vollmacht für die Wohnungsübergabe', en: 'Authorisation for a property handover' },
    fields: [['flatAddr', { de: 'Anschrift der Wohnung', en: 'Address of the property' }], ['handover', { de: 'Übergabe am (optional)', en: 'Handover on (optional)' }, null, null, 'date']],
    scope: (v, de) => (de ? `mich bei der Übergabe der Wohnung ${s(v.flatAddr) || '…'}${v.handover ? ` am ${fmtDate(v.handover, 'de')}` : ''} zu vertreten, insbesondere das Übergabeprotokoll zu unterzeichnen, Zählerstände festzuhalten und Schlüssel zu übergeben bzw. entgegenzunehmen.`
      : `to represent me at the handover of the property ${s(v.flatAddr) || '…'}${v.handover ? ` on ${fmtDate(v.handover, 'en')}` : ''}, in particular to sign the handover report, record meter readings and hand over or receive keys.`) },
  general: { label: { de: 'Allgemein / eigener Text', en: 'General / own text' }, title: { de: 'Vollmacht', en: 'Power of attorney' },
    fields: [['matter', { de: 'Wozu bevollmächtigst du?', en: 'What is the authorisation for?' }, { de: 'z. B. mich bei der Eigentümerversammlung am 12.11. zu vertreten und für mich abzustimmen', en: 'e.g. to represent me at the owners’ meeting and vote on my behalf' }, null, 'area']],
    scope: (v, de) => (s(v.matter) ? s(v.matter).replace(/\.?$/, '.') : (de ? 'mich in folgender Angelegenheit zu vertreten: …' : 'to represent me in the following matter: …')) },
};

export function buildDoc(v, lang) {
  const de = lang === 'de';
  const p = P[v.purpose] || P.post;
  const person = (pre) => ({ name: s(v[pre + 'Name']), birth: v[pre + 'Birth'] ? fmtDate(v[pre + 'Birth'], lang) : '', addr: [s(v[pre + 'Street']), s(v[pre + 'City'])].filter(Boolean).join(', '), id: s(v[pre + 'Id']) });
  const valid = v.valid === 'day' ? (de ? `Diese Vollmacht gilt nur am ${fmtDate(v.day, lang) || '…'}.` : `This authorisation is valid on ${fmtDate(v.day, lang) || '…'} only.`)
    : v.valid === 'period' ? (de ? `Diese Vollmacht gilt vom ${fmtDate(v.from, lang) || '…'} bis zum ${fmtDate(v.to, lang) || '…'}.` : `This authorisation is valid from ${fmtDate(v.from, lang) || '…'} to ${fmtDate(v.to, lang) || '…'}.`)
      : (de ? 'Diese Vollmacht gilt bis auf Widerruf.' : 'This authorisation is valid until revoked.');
  const extra = [];
  extra.push(v.sub ? (de ? 'Die bevollmächtigte Person darf Untervollmacht erteilen.' : 'The authorised person may delegate this authority.') : (de ? 'Die bevollmächtigte Person darf keine Untervollmacht erteilen.' : 'The authorised person may not delegate this authority.'));
  if (v.idNote !== false) extra.push(de ? `Die bevollmächtigte Person weist sich mit ihrem eigenen Ausweis aus.${v.idCopy ? ' Eine Kopie meines Ausweises liegt bei.' : ''}` : `The authorised person will show their own ID.${v.idCopy ? ' A copy of my ID is attached.' : ''}`);
  if (s(v.notes)) extra.push(s(v.notes));
  return { title: T(lang, p.title), giver: person('g'), agent: person('a'), intro: de ? 'Hiermit bevollmächtige ich die oben genannte Person,' : 'I hereby authorise the person named above', scope: p.scope(v, de), valid, extra,
    dateLine: dateLine(v.place, v.date || isoDate(), lang), lang };
}

async function makePdf(d, sig, lang) {
  const de = lang === 'de';
  const w = await createWriter({ text: collectText(d).join('\n'), lang, margins: { t: 25, b: 22 } });
  w.newPage();
  w.para(d.title, { font: w.bold, size: 18, after: 16, lead: 1.25 });
  const block = (label, p) => {
    w.para(label, { font: w.bold, size: 10, color: w.GREY, after: 2 });
    w.kv([[de ? 'Name' : 'Name', p.name || ' '], ...(p.birth ? [[de ? 'Geburtsdatum' : 'Date of birth', p.birth]] : []), [de ? 'Anschrift' : 'Address', p.addr || ' '], ...(p.id ? [[de ? 'Ausweisnummer' : 'ID number', p.id]] : [])], { labelWidth: mm(35) });
    w.space(8);
  };
  block(de ? 'Vollmachtgeber/in' : 'Principal (giving authority)', d.giver);
  block(de ? 'Bevollmächtigte Person' : 'Authorised person', d.agent);
  w.hr(); w.space(12);
  w.para(`${d.intro} ${d.scope}`, { size: 11.5, lead: 1.45, after: 10 });
  w.para(d.valid, { after: 6 });
  for (const t of d.extra) w.para(t, { after: 6 });
  w.space(24);
  w.para(d.dateLine, { after: 4 });
  await w.signatures([{ caption: de ? 'Unterschrift Vollmachtgeber/in' : 'Signature of the principal', sig, name: d.giver.name }, { caption: de ? 'Unterschrift der bevollmächtigten Person (Unterschriftsprobe)' : 'Specimen signature of the authorised person', name: d.agent.name }], { height: mm(20) });
  w.numberPages();
  return w.finish({ title: d.title });
}

let api = null;
const REQ = v => [{ ok: !!s(v.gName), de: 'den Namen des Vollmachtgebers', en: 'the principal’s name' }, { ok: !!s(v.aName), de: 'den Namen der bevollmächtigten Person', en: 'the authorised person’s name' }];

export default {
  labels: { back_to_files: { de: 'Zurück zur Vollmacht', en: 'Back to the form' } },
  options: [],
  mountStage(stage, state, ctx) { api = stageFn(stage, state, ctx); briefVorlage('power-of-attorney', 'poa', stage, state, ctx, () => { api = stageFn(stage, state, ctx); }); },
  status(values) {
    const v = values.poa || {};
    const summary = (P[v.purpose] || P.post).title;
    const miss = REQ(v).filter(r => !r.ok);
    return miss.length ? { ok: false, summary, hint: { de: `Noch nötig: ${miss.map(x => x.de).join(', ')}.`, en: `Still needed: ${miss.map(x => x.en).join(', ')}.` } } : { summary };
  },
  async run(inputs, opts, ctx) {
    const v = opts.poa || {};
    if (REQ(v).some(r => !r.ok)) throw userError('Bitte gib die Namen von Vollmachtgeber und bevollmächtigter Person an.', 'Please enter the names of the principal and the authorised person.');
    ctx.progress(0.3, { de: 'PDF wird erstellt …', en: 'Creating PDF …' });
    const d = buildDoc(v, ctx.lang);
    const { bytes, missing, pages } = await makePdf(d, await api?.sig(), ctx.lang);
    const mw = missingWarning(missing);
    if (mw) ctx.note(mw);
    const p = P[v.purpose] || P.post;
    if (p.hint) ctx.note(p.hint);
    ctx.note({ de: 'Druck die Vollmacht aus und unterschreib sie eigenhändig, falls du nicht schon per Finger unterschrieben hast. Für Grundstücksgeschäfte, viele Bankgeschäfte oder als Vorsorgevollmacht reicht so eine einfache Vollmacht nicht.', en: 'Print and sign the authorisation by hand if you haven’t signed with your finger. For property, many banking matters or long-term arrangements a simple authorisation like this is usually not enough.' });
    const name = ctx.safeFileName(`${d.title}${v.aName ? ' – ' + s(v.aName) : ''}.pdf`);
    return { outputs: [{ name, blob: new Blob([bytes], { type: 'application/pdf' }), pages, note: d.title }] };
  },
};

function stageFn(stage, state, ctx) {
  const lang = ctx.lang, de = lang === 'de';
  const v = (state.values.poa ||= { purpose: 'post', valid: 'revoke', sub: false, idNote: true, idCopy: false, date: isoDate(), day: isoDate(), from: isoDate(), to: '', action: 'zul' });
  const rem = remember({ key: 'fale-wt-poa-giver', fields: ['gName', 'gStreet', 'gCity', 'place'], v, lang, label: { de: 'Meine Angaben (Vollmachtgeber) auf diesem Gerät merken', en: 'Remember my details (principal) on this device' } });
  const pv = pdfPreview(lang);
  const pad = signaturePad(lang, () => changed('sig'));
  const purposeBox = el('div', {});
  const validBox = el('div', {});
  const changed = key => {
    if (rem.fields.includes(key)) rem.save();
    if (key === 'purpose') renderPurpose();
    if (key === 'valid') renderValid();
    state.results.clear(); ctx.refresh();
    pv.schedule(async () => (await makePdf(buildDoc(v, lang), await pad.export(), lang)).bytes);
  };
  const f = form(v, lang, changed);
  function renderPurpose() {
    const p = P[v.purpose] || P.post;
    purposeBox.replaceChildren(f.grid(...p.fields.map(([key, label, ph, choices, type]) => (choices ? f.select(key, label, choices.map(([value, l]) => ({ value, label: l })), { id: `tpl-${key}` })
      : type === 'area' ? f.area(key, label, { id: `tpl-${key}`, placeholder: ph || '', rows: 3 }) : f.field(key, label, { id: `tpl-${key}`, type: type || 'text', placeholder: ph || '', wide: true })))),
    p.hint ? note(lang, p.hint, p.warn ? 'tpl-warn' : '') : '');
  }
  function renderValid() {
    validBox.replaceChildren(v.valid === 'day' ? f.field('day', { de: 'Datum', en: 'Date' }, { type: 'date', id: 'tpl-day' })
      : v.valid === 'period' ? f.grid(f.field('from', { de: 'Von', en: 'From' }, { type: 'date', id: 'tpl-from' }), f.field('to', { de: 'Bis', en: 'To' }, { type: 'date', id: 'tpl-to' })) : '');
  }
  const person = (pre, title, id, extra = []) => f.sec(id, title, f.grid(
    f.field(pre + 'Name', { de: 'Vor- und Nachname', en: 'Full name' }, { wide: true, autocomplete: pre === 'g' ? 'name' : 'off' }), f.field(pre + 'Birth', { de: 'Geburtsdatum (optional)', en: 'Date of birth (optional)' }, { type: 'date' }),
    f.field(pre + 'Street', { de: 'Straße und Hausnummer', en: 'Street and number' }, { wide: true }), f.field(pre + 'City', { de: 'PLZ und Ort', en: 'Postcode and town' }),
    f.field(pre + 'Id', { de: 'Ausweisnummer (optional)', en: 'ID number (optional)' }, { hint: { de: 'Steht nur im PDF und wird nirgends gespeichert.', en: 'Only printed in the PDF, never stored.' } })), ...extra);
  stage.append(el('div', { class: 'tpl-split' }, el('div', {},
    f.sec('tpl-h-purpose', { de: 'Wofür ist die Vollmacht?', en: 'What is it for?' }, f.select('purpose', { de: 'Zweck', en: 'Purpose' }, Object.entries(P).map(([k, p]) => ({ value: k, label: p.label })), { wide: true }), purposeBox),
    person('g', { de: 'Vollmachtgeber/in (du)', en: 'Principal (you)' }, 'tpl-h-giver', [f.grid(f.field('place', { de: 'Ort für die Datumszeile', en: 'Place' }), f.field('date', { de: 'Datum', en: 'Date' }, { type: 'date' })), rem.box]),
    person('a', { de: 'Bevollmächtigte Person', en: 'Authorised person' }, 'tpl-h-agent'),
    f.sec('tpl-h-valid', { de: 'Gültigkeit und Zusätze', en: 'Validity and details' },
      f.seg('valid', { de: 'Gültig', en: 'Valid' }, [{ value: 'day', label: { de: 'An einem Tag', en: 'On one day' } }, { value: 'period', label: { de: 'Zeitraum', en: 'Period' } }, { value: 'revoke', label: { de: 'Bis auf Widerruf', en: 'Until revoked' } }]),
      validBox,
      f.check('sub', { de: 'Untervollmacht erlaubt', en: 'Delegation allowed' }),
      f.check('idNote', { de: 'Hinweis: Bevollmächtigte Person weist sich mit eigenem Ausweis aus', en: 'Note: the authorised person shows their own ID' }),
      f.check('idCopy', { de: 'Kopie meines Ausweises liegt bei', en: 'A copy of my ID is attached' }),
      f.area('notes', { de: 'Weitere Hinweise oder Einschränkungen (optional)', en: 'Further notes or limits (optional)' }, { rows: 2 })),
    f.sec('tpl-h-sig', { de: 'Deine Unterschrift (optional)', en: 'Your signature (optional)' }, el('p', { class: 'img-muted' }, T(lang, { de: 'Unterschreib mit dem Finger – oder lass das Feld leer und unterschreib auf dem Ausdruck. Die bevollmächtigte Person unterschreibt auf dem Ausdruck.', en: 'Sign with your finger – or leave it empty and sign the printout. The authorised person signs the printout.' })), pad.root)),
  el('div', { class: 'tpl-side' }, f.sec('tpl-h-pv', { de: 'Vorschau', en: 'Preview' }, pv.root,
    note(lang, { de: 'Eine einfache schriftliche Vollmacht reicht für viele Alltagsdinge. Banken, Notare, Grundbuchämter und manche Behörden verlangen aber eigene Formulare oder eine beglaubigte Vollmacht – frag im Zweifel vorher nach. Keine Rechtsberatung.', en: 'A simple written authorisation is enough for many everyday matters. Banks, notaries and some authorities require their own forms or a certified power of attorney – ask beforehand. Not legal advice.' })))));
  renderPurpose(); renderValid();
  changed('init');
  return { sig: () => pad.export() };
}
