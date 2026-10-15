// Tool: cover letter (Bewerbungsanschreiben) in DIN 5008 layout with the letterhead of the CV designs
// (classic / modern / compact + accent colour). Structure hints per paragraph (written by you, no AI), salutation
// helper, start date and salary sentences, enclosures. Can take over name, address and design from the opt-in
// CV draft (IndexedDB, tools/cv-builder.js) and create the CV as a second PDF – then "Weiter mit" merge-pdf
// (add certificates) → compress-pdf gives the complete application file ("Bewerbungsmappe").
import { el, icon, T, s, form, userError, ensureCss, isoDate, note, drafts, local } from '../lib/tpl-core.js';
import { letterPdf } from '../lib/tpl-pdf.js';
import { cvHead, cvPdf, ACCENTS, loadPhotoSource, cropPhoto } from '../lib/tpl-cv.js';
import { missingWarning } from '../lib/unifont.js';
import { baseModel, senderSection, recipientSection, signatureSection, previewSection, SENDER_FIELDS, SENDER_KEY } from '../lib/tpl-letterui.js';
import { vorlageParam, loadVorlage, vorlageNotice, vorlageMissing } from '../lib/arc-vorlage.js';

ensureCss();
const CV_KEY = 'cv', CV_FLAG = 'fale-wt-cv-draft';

const PARAS = [
  { key: 'p1', label: { de: '1. Einstieg', en: '1. Opening' }, hint: { de: 'Warum schreibst du? Nenn die Stelle und wo du sie gefunden hast – und steig mit einem konkreten Satz ein statt mit „hiermit bewerbe ich mich“.', en: 'Why are you writing? Name the position and where you found it, and open with something specific about you.' },
    ph: { de: 'z. B. In Ihrer Anzeige suchen Sie jemanden, der … – genau das mache ich seit vier Jahren bei …', en: 'e.g. Your advert asks for someone who … – that is exactly what I have been doing for four years at …' } },
  { key: 'p2', label: { de: '2. Was du mitbringst', en: '2. What you offer' }, hint: { de: 'Zwei bis drei Erfahrungen oder Erfolge, die zu den Anforderungen der Anzeige passen – mit Beispielen und Zahlen, wo möglich.', en: 'Two or three experiences or results that match the requirements – with examples and numbers where possible.' },
    ph: { de: 'z. B. Als … habe ich … eingeführt und dadurch …', en: 'e.g. As … I introduced … which led to …' } },
  { key: 'p3', label: { de: '3. Warum dieses Unternehmen', en: '3. Why this company' }, hint: { de: 'Was reizt dich an genau dieser Firma und Aufgabe? Zeig, dass du dich informiert hast.', en: 'What attracts you to this company and role? Show that you have done your research.' },
    ph: { de: 'z. B. Mich überzeugt an Ihrem Unternehmen besonders …', en: 'e.g. What I particularly like about your company is …' } },
  { key: 'p4', label: { de: '4. Schluss', en: '4. Closing' }, hint: { de: 'Bitte um ein persönliches Gespräch – selbstbewusst, ohne Konjunktiv. Eintrittstermin und Gehaltsvorstellung kannst du unten ergänzen.', en: 'Ask for an interview – confidently. You can add the start date and salary expectation below.' },
    ph: { de: 'z. B. Ich freue mich darauf, Sie in einem persönlichen Gespräch von mir zu überzeugen.', en: 'e.g. I look forward to discussing in an interview how I can contribute.' } },
];

export function buildModel(v, lang) {
  const de = lang === 'de';
  const m = baseModel(v, lang);
  const who = s(v.contact);
  const sal = { f: de ? `Sehr geehrte Frau ${who},` : `Dear Ms ${who},`, m: de ? `Sehr geehrter Herr ${who},` : `Dear Mr ${who},`, n: de ? `Guten Tag ${who},` : `Dear ${who},` }[v.salMode];
  const salutation = who && sal ? sal : de ? 'Sehr geehrte Damen und Herren,' : 'Dear Sir or Madam,';
  const extra = [s(v.start) ? (de ? `Die Stelle kann ich ab ${s(v.start)} antreten.` : `I am available from ${s(v.start)}.`) : '', s(v.salary) ? (de ? `Meine Gehaltsvorstellung liegt bei ${s(v.salary)}.` : `My salary expectation is ${s(v.salary)}.`) : ''].filter(Boolean).join(' ');
  const blocks = [s(v.p1), s(v.p2), s(v.p3), [extra, s(v.p4)].filter(Boolean).join(' ')].filter(Boolean);
  const recipient = [s(v.rName), who ? (de ? `${{ f: 'Frau ', m: 'Herrn ' }[v.salMode] || ''}${who}` : who) : s(v.rAttn), s(v.rStreet), s(v.rCity), s(v.rCountry)].filter(Boolean);
  return {
    ...m, recipient, form: 'B', notices: [], info: [[de ? 'Kennziffer' : 'Reference', s(v.refNo)]],
    subject: `${de ? 'Bewerbung als' : 'Application for the position of'} ${s(v.position) || '…'}${s(v.refNo) ? (de ? ` – Kennziffer ${s(v.refNo)}` : ` – reference ${s(v.refNo)}`) : ''}`,
    salutation, blocks, closing: de ? 'Mit freundlichen Grüßen' : who ? 'Yours sincerely,' : 'Yours faithfully,',
    enclosures: String(v.enclosures || '').split('\n').map(x => x.trim()).filter(Boolean),
    head: cvHead(v),
  };
}

let api = null;
const REQ = v => [{ ok: !!s(v.sName), de: 'deinen Namen', en: 'your name' }, { ok: !!s(v.rName), de: 'das Unternehmen', en: 'the company' }, { ok: !!s(v.position), de: 'die Stelle', en: 'the position' }];

export default {
  labels: { back_to_files: { de: 'Zurück zum Anschreiben', en: 'Back to the cover letter' } },
  options: [],
  mountStage(stage, state, ctx) { api = stageFn(stage, state, ctx); },
  status(values) {
    const v = values.cl || {};
    const summary = { de: `Anschreiben${s(v.position) ? ' · ' + s(v.position) : ''}${v.withCv ? ' + Lebenslauf' : ''}`, en: `Cover letter${s(v.position) ? ' · ' + s(v.position) : ''}${v.withCv ? ' + CV' : ''}` };
    const miss = REQ(v).filter(r => !r.ok);
    return miss.length ? { ok: false, summary, hint: { de: `Noch nötig: ${miss.map(x => x.de).join(', ')}.`, en: `Still needed: ${miss.map(x => x.en).join(', ')}.` } } : { summary };
  },
  async run(inputs, opts, ctx) {
    const v = opts.cl || {};
    if (REQ(v).some(r => !r.ok)) throw userError('Bitte gib deinen Namen, das Unternehmen und die Stelle an.', 'Please enter your name, the company and the position.');
    ctx.progress(0.2, { de: 'Anschreiben wird erstellt …', en: 'Creating the cover letter …' });
    const m = buildModel(v, ctx.lang);
    const de = ctx.lang === 'de';
    const { bytes, missing, pages } = await letterPdf({ ...m, sig: await api?.sig() }, { lang: ctx.lang, family: v.design === 'classic' ? 'serif' : 'sans' });
    const outputs = [{ name: ctx.safeFileName(`${de ? 'Anschreiben' : 'Cover letter'} ${s(v.sName)} – ${s(v.rName)}.pdf`), blob: new Blob([bytes], { type: 'application/pdf' }), pages, note: m.subject }];
    const allMissing = [...missing];
    if (pages > 1) ctx.note({ de: 'Dein Anschreiben ist länger als eine Seite. Üblich ist eine Seite – kürz am besten etwas.', en: 'Your cover letter is longer than one page. One page is usual – consider shortening it.' });
    if (v.withCv) {
      const d = api ? await api.cvDraft() : null;
      if (d) {
        ctx.progress(0.6, { de: 'Lebenslauf wird erstellt …', en: 'Creating the CV …' });
        let photo = null;
        if (d.photo?.blob) { try { photo = await cropPhoto(await loadPhotoSource(d.photo.blob), d.photo.crop, d.v.photoShape || 'circle'); } catch (err) { console.warn('photo', err); } }
        const cv = await cvPdf({ ...d.v, design: v.design, accent: v.accent }, ctx.lang, photo);
        allMissing.push(...cv.missing);
        outputs.push({ name: ctx.safeFileName(`${de ? 'Lebenslauf' : 'CV'} ${s(d.v.name)}.pdf`), blob: new Blob([cv.bytes], { type: 'application/pdf' }), pages: cv.pages });
      } else ctx.note({ de: 'Es ist kein gespeicherter Lebenslauf-Entwurf vorhanden – erstellt wurde nur das Anschreiben.', en: 'No saved CV draft found – only the cover letter was created.' });
    }
    const mw = missingWarning(allMissing);
    if (mw) ctx.note(mw);
    ctx.note({ de: 'Bewerbungsmappe: Tippe auf „PDF zusammenfügen“, füg dort deine Zeugnisse hinzu, und verkleinere die fertige Datei danach mit „PDF komprimieren“ – viele Bewerbungsportale erlauben nur wenige MB.', en: 'Application pack: tap “Merge PDF”, add your certificates there, then shrink the result with “Compress PDF” – many portals only accept a few MB.' });
    return { outputs };
  },
};

function stageFn(stage, state, ctx) {
  const lang = ctx.lang, de = lang === 'de';
  const v = (state.values.cl ||= { design: 'modern', accent: ACCENTS[0], salMode: 'f', letterDate: isoDate(), enclosures: de ? 'Lebenslauf\nZeugnisse' : 'CV\nCertificates', withCv: false });
  let rem = null, pvs = null;
  const hasCvFlag = local.get(CV_FLAG) === 1;
  let cvDraft = null;
  const changed = key => { if (rem && SENDER_FIELDS.includes(key)) rem.save(); state.results.clear(); ctx.refresh(); pvs?.refresh(); };
  const f = form(v, lang, changed);
  const sender = senderSection(f, v, lang, { title: { de: 'Deine Angaben', en: 'Your details' } }); rem = sender.rem;
  const sig = signatureSection(f, lang, () => changed('sig'));
  pvs = previewSection(f, lang, () => buildModel(v, lang), () => sig.pad.export(), { family: () => (v.design === 'classic' ? 'serif' : 'sans'),
    foot: el('p', { class: 'img-muted' }, T(lang, { de: 'DIN 5008, passend fürs Fensterkuvert – und im selben Design wie dein Lebenslauf.', en: 'DIN 5008 layout for window envelopes – in the same design as your CV.' })) });
  const cvBox = el('div', {});
  const swatches = () => el('div', { class: 'tpl-colors', role: 'radiogroup', aria: { label: T(lang, { de: 'Akzentfarbe', en: 'Accent colour' }) } }, ACCENTS.map((c, i) => {
    const inp = el('input', { type: 'radio', name: 'tpl-accent', value: c, checked: v.accent === c, aria: { label: T(lang, { de: `Farbe ${i + 1}`, en: `Colour ${i + 1}` }) }, onchange: () => { v.accent = c; changed('accent'); } });
    const sw = el('span', {}); sw.style.background = c;
    return el('label', { class: 'tpl-swatch' }, inp, sw);
  }));
  const designSec = el('div', {});
  const renderDesign = () => designSec.replaceChildren(
    f.seg('design', { de: 'Design (wie beim Lebenslauf)', en: 'Design (as in the CV)' }, [{ value: 'classic', label: { de: 'Klassisch', en: 'Classic' } }, { value: 'modern', label: { de: 'Modern', en: 'Modern' } }, { value: 'compact', label: { de: 'Kompakt', en: 'Compact' } }]),
    el('p', { class: 'img-seg-legend' }, T(lang, { de: 'Akzentfarbe', en: 'Accent colour' })), swatches());
  function renderCv() {
    if (!cvDraft) {
      cvBox.replaceChildren(note(lang, { de: 'Tipp: Erstell zuerst deinen Lebenslauf mit „Lebenslauf erstellen“ und schalte dort „Entwurf speichern“ ein. Dann kannst du hier Name, Anschrift und Design übernehmen und den Lebenslauf gleich mit erstellen.', en: 'Tip: create your CV with the CV builder first and switch on “Save the draft”. Then you can take over your details and design here and create the CV in one go.' }));
      return;
    }
    const take = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet', id: 'tpl-take-cv', onclick: () => {
      const c = cvDraft.v;
      Object.assign(v, { sName: c.name || v.sName, sStreet: c.street || v.sStreet, sCity: c.city || v.sCity, sPhone: c.phone || v.sPhone, sMail: c.email || v.sMail, design: c.design || v.design, accent: c.accent || v.accent, place: v.place || c.place || '' });
      for (const k of ['sName', 'sStreet', 'sCity', 'sPhone', 'sMail', 'place']) { const i = stage.querySelector(`#tpl-${k}`); if (i) i.value = v[k] || ''; }
      renderDesign(); changed('cv');
    } }, icon('file'), T(lang, { de: `Angaben aus dem Lebenslauf von ${s(cvDraft.v.name) || '…'} übernehmen`, en: `Use details from the CV of ${s(cvDraft.v.name) || '…'}` }));
    cvBox.replaceChildren(el('div', { class: 'img-btn-row' }, take), f.check('withCv', { de: 'Lebenslauf aus dem gespeicherten Entwurf mit erstellen (2 PDFs)', en: 'Also create the CV from the saved draft (2 PDFs)' }, { id: 'tpl-withCv' }));
  }
  renderDesign(); renderCv();
  if (hasCvFlag) drafts.get(CV_KEY).then(d => { if (d && d.v) { cvDraft = d; renderCv(); } });
  stage.append(el('div', { class: 'tpl-split' }, el('div', {},
    f.sec('tpl-h-job', { de: 'Stelle und Design', en: 'Position and design' },
      f.grid(f.field('position', { de: 'Stelle / Position', en: 'Position' }, { wide: true, placeholder: { de: 'z. B. Kauffrau für Büromanagement', en: 'e.g. Office manager' } }), f.field('refNo', { de: 'Kennziffer (optional)', en: 'Reference (optional)' })),
      designSec, cvBox),
    f.sec('tpl-h-rec', { de: 'Unternehmen', en: 'Company' }, f.grid(
      f.field('rName', { de: 'Unternehmen', en: 'Company' }, { wide: true, autocomplete: 'organization' }),
      f.select('salMode', { de: 'Ansprechperson', en: 'Contact person' }, [{ value: 'f', label: { de: 'Frau', en: 'Ms' } }, { value: 'm', label: { de: 'Herr', en: 'Mr' } }, { value: 'n', label: { de: 'Neutral („Guten Tag …“)', en: 'Neutral (“Dear …”)' } }, { value: 'none', label: { de: 'Unbekannt', en: 'Unknown' } }]),
      f.field('contact', { de: 'Name der Ansprechperson (optional)', en: 'Contact name (optional)' }, { placeholder: { de: 'z. B. Dr. Lena Schmidt', en: 'e.g. Lena Smith' } }),
      f.field('rStreet', { de: 'Straße und Hausnummer', en: 'Street' }, { wide: true }), f.field('rCity', { de: 'PLZ und Ort', en: 'Postcode and town' }), f.field('rCountry', { de: 'Land (optional)', en: 'Country (optional)' }))),
    f.sec('tpl-h-text', { de: 'Dein Text', en: 'Your text' },
      el('p', { class: 'img-muted' }, T(lang, { de: 'Die Hinweise helfen beim Aufbau – den Text schreibst du selbst. So klingt er nach dir und nicht nach Vorlage.', en: 'The hints help with the structure – you write the text yourself, so it sounds like you.' })),
      ...PARAS.map(p => f.area(p.key, p.label, { rows: 4, hint: p.hint, placeholder: p.ph, maxLength: 3000 })),
      f.grid(f.field('start', { de: 'Eintrittstermin (optional)', en: 'Available from (optional)' }, { placeholder: { de: 'z. B. 1. März 2027', en: 'e.g. 1 March 2027' } }), f.field('salary', { de: 'Gehaltsvorstellung (optional)', en: 'Salary expectation (optional)' }, { placeholder: { de: 'z. B. 48.000 € brutto im Jahr', en: 'e.g. 48,000 per year' } })),
      f.area('enclosures', { de: 'Anlagen (eine pro Zeile)', en: 'Enclosures (one per line)' }, { rows: 3 })),
    sender.sec, sig.sec), el('div', { class: 'tpl-side' }, pvs.sec)));
  pvs.refresh();
  ctx.refresh();
  // example letter from the Vorlagen-Archiv (?vorlage=<id>&brief=<n>) – a remembered sender is kept, never overwritten
  if (vorlageParam()) loadVorlage().then(t => {
    const L = t?.data?.letters?.[t.letter], cl = L?.cl;
    if (!cl) { stage.prepend(vorlageMissing(lang)); return; }
    const saved = local.get(SENDER_KEY);
    const keep = saved && typeof saved === 'object' ? SENDER_FIELDS.filter(k => s(v[k])) : [];
    for (const [k, val] of Object.entries(cl)) if (!keep.includes(k)) v[k] = val;
    v.letterDate = isoDate();
    for (const k of Object.keys(cl)) {
      const n = stage.querySelector(`#tpl-${k}`);
      if (n && !keep.includes(k) && 'value' in n) n.value = v[k] ?? '';
    }
    renderDesign();
    stage.prepend(vorlageNotice(lang, {
      title: T(lang, { de: `Beispiel geladen: ${t.data.name} – ${L.label}`, en: `Example loaded: ${t.data.name} – ${L.label}` }),
      body: T(lang, { de: `Ersetze Firma, Ansprechperson und vor allem den Text durch deine eigenen Erfahrungen – das Beispiel zeigt nur den Aufbau.${keep.length ? ' Deine gemerkten Absenderangaben bleiben erhalten.' : ''}`, en: `Replace the company, the contact and above all the text with your own experience – the example only shows the structure.${keep.length ? ' Your remembered sender details were kept.' : ''}` }),
    }));
    changed('vorlage');
  });
  return { sig: () => sig.pad.export(), cvDraft: async () => cvDraft || (hasCvFlag ? await drafts.get(CV_KEY) : null) };
}
