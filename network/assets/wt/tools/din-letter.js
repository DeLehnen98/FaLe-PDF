// Tool: free letter in DIN 5008 layout (form B or A) – window address field with return line and notices
// ("Einschreiben"), information block or reference line (Bezugszeichen), subject, body, signature by finger,
// enclosures, copy distribution, fold/punch marks, page numbers on longer letters. Live PDF preview + plain
// text. Data stays in the browser; "remember sender" is opt-in and shared with the other letter tools.
import { el, T, s, form, userError, ensureCss, isoDate } from '../lib/tpl-core.js';
import { letterPdf } from '../lib/tpl-pdf.js';
import { missingWarning } from '../lib/unifont.js';
import { baseModel, senderSection, recipientSection, signatureSection, previewSection, SENDER_FIELDS } from '../lib/tpl-letterui.js';

ensureCss();

const paras = t => String(t || '').replace(/\r/g, '').split(/\n\s*\n/).map(p => p.replace(/\s+$/g, '')).filter(p => p.trim());
const lines = t => String(t || '').split('\n').map(x => x.trim()).filter(Boolean);

export function buildModel(v, lang) {
  const de = lang === 'de';
  const m = baseModel(v, lang);
  const refs = [
    [de ? 'Ihr Zeichen' : 'Your ref.', s(v.yourRef)], [de ? 'Ihre Nachricht vom' : 'Your message of', s(v.yourDate)],
    [de ? 'Unser Zeichen' : 'Our ref.', s(v.ourRef)], [de ? 'Unsere Nachricht vom' : 'Our message of', s(v.ourDate)],
  ];
  const contact = [[de ? 'Name' : 'Name', s(v.contactName)], [de ? 'Telefon' : 'Phone', s(v.contactPhone)], [de ? 'E-Mail' : 'E-mail', s(v.contactMail)]];
  const style = v.refStyle === 'line' ? 'line' : 'info';
  const filled = refs.filter(r => r[1]);
  return {
    ...m, form: v.form === 'A' ? 'A' : 'B',
    notices: [v.notice === 'custom' ? s(v.noticeText) : v.notice && v.notice !== 'none' ? NOTICES[v.notice][lang] : ''].filter(Boolean),
    info: style === 'info' ? [...refs, ...contact] : [],
    refLine: style === 'line' ? [...filled.slice(0, 3), [de ? 'Datum' : 'Date', m.dateLine.replace(/^.*?, /, '')]] : null,
    dateLine: style === 'line' ? '' : m.dateLine,
    subject: s(v.subject), salutation: s(v.salutation), blocks: paras(v.body), closing: s(v.closing),
    name: s(v.signName) || m.name, signerExtra: lines(v.signerExtra), enclosures: lines(v.enclosures), cc: lines(v.cc),
    marks: { folds: v.folds !== false, punch: v.punch !== false },
  };
}

const NOTICES = {
  einschreiben: { de: 'Einschreiben', en: 'Registered mail' }, rueckschein: { de: 'Einschreiben Rückschein', en: 'Registered mail – return receipt' },
  persoenlich: { de: 'Persönlich/Vertraulich', en: 'Private and confidential' }, eilt: { de: 'Eilt', en: 'Urgent' },
};

let api = null;
const REQ = v => [{ ok: !!s(v.sName), de: 'deinen Namen', en: 'your name' }, { ok: !!s(v.rName), de: 'den Empfänger', en: 'the recipient' }, { ok: !!s(v.body), de: 'den Brieftext', en: 'the letter text' }];

export default {
  labels: { back_to_files: { de: 'Zurück zum Brief', en: 'Back to the letter' } },
  options: [],
  mountStage(stage, state, ctx) { api = letterStage(stage, state, ctx); },
  status(values) {
    const v = values.letter || {};
    const miss = REQ(v).filter(r => !r.ok);
    const summary = { de: `Brief nach DIN 5008 · Form ${v.form === 'A' ? 'A' : 'B'}`, en: `DIN 5008 letter · form ${v.form === 'A' ? 'A' : 'B'}` };
    return miss.length ? { ok: false, summary, hint: { de: `Noch nötig: ${miss.map(x => x.de).join(', ')}.`, en: `Still needed: ${miss.map(x => x.en).join(', ')}.` } } : { summary };
  },
  async run(inputs, opts, ctx) {
    const v = opts.letter || {};
    if (REQ(v).some(r => !r.ok)) throw userError('Bitte fülle Absender, Empfänger und den Brieftext aus.', 'Please fill in sender, recipient and the letter text.');
    ctx.progress(0.3, { de: 'PDF wird erstellt …', en: 'Creating PDF …' });
    const m = buildModel(v, ctx.lang);
    const { bytes, missing, pages } = await letterPdf({ ...m, sig: await api?.sig() }, { lang: ctx.lang });
    const mw = missingWarning(missing);
    if (mw) ctx.note(mw);
    const name = ctx.safeFileName(`${s(v.subject) || ctx.t({ de: 'Brief', en: 'Letter' })}${v.rName ? ' – ' + s(v.rName) : ''}.pdf`);
    return { outputs: [{ name, blob: new Blob([bytes], { type: 'application/pdf' }), pages, note: m.subject || null }] };
  },
};

function letterStage(stage, state, ctx) {
  const lang = ctx.lang, de = lang === 'de';
  const v = (state.values.letter ||= {
    form: 'B', refStyle: 'info', notice: 'none', letterDate: isoDate(), folds: true, punch: true,
    salutation: de ? 'Sehr geehrte Damen und Herren,' : 'Dear Sir or Madam,', closing: de ? 'Mit freundlichen Grüßen' : 'Yours faithfully,',
    subject: '', body: '',
  });
  let rem = null, pvs = null;
  const changed = key => { if (rem && SENDER_FIELDS.includes(key)) rem.save(); state.results.clear(); ctx.refresh(); pvs?.refresh(); if (key === 'refStyle') renderRefs(); if (key === 'notice') renderNotice(); };
  const f = form(v, lang, changed);
  const sender = senderSection(f, v, lang); rem = sender.rem;
  const sig = signatureSection(f, lang, () => changed('sig'));
  const refsBox = el('div', {});
  function renderRefs() {
    refsBox.replaceChildren(f.grid(
      f.field('yourRef', { de: 'Ihr Zeichen', en: 'Your reference' }, { id: 'tpl-yourRef' }), f.field('yourDate', { de: 'Ihre Nachricht vom', en: 'Your message of' }, { id: 'tpl-yourDate' }),
      f.field('ourRef', { de: 'Unser Zeichen', en: 'Our reference' }, { id: 'tpl-ourRef' }), f.field('ourDate', { de: 'Unsere Nachricht vom', en: 'Our message of' }, { id: 'tpl-ourDate' }),
      ...(v.refStyle === 'line' ? [] : [f.field('contactName', { de: 'Ansprechpartner (optional)', en: 'Contact name (optional)' }, { id: 'tpl-contactName' }),
        f.field('contactPhone', { de: 'Telefon im Infoblock (optional)', en: 'Phone in the info block (optional)' }, { id: 'tpl-contactPhone', type: 'tel' }),
        f.field('contactMail', { de: 'E-Mail im Infoblock (optional)', en: 'E-mail in the info block (optional)' }, { id: 'tpl-contactMail', type: 'email' })])));
  }
  const noticeBox = el('div', {});
  function renderNotice() { noticeBox.replaceChildren(v.notice === 'custom' ? f.field('noticeText', { de: 'Eigener Vermerk', en: 'Own notice' }, { id: 'tpl-noticeText', wide: true }) : ''); }
  renderRefs(); renderNotice();
  pvs = previewSection(f, lang, () => buildModel(v, lang), () => sig.pad.export());

  stage.append(el('div', { class: 'tpl-split' }, el('div', {},
    f.sec('tpl-h-form', { de: 'Briefform', en: 'Layout' },
      f.seg('form', { de: 'Form', en: 'Form' }, [{ value: 'B', label: { de: 'Form B (Standard)', en: 'Form B (standard)' } }, { value: 'A', label: { de: 'Form A (kleiner Briefkopf)', en: 'Form A (short letterhead)' } }]),
      f.seg('refStyle', { de: 'Bezugszeichen', en: 'References' }, [{ value: 'info', label: { de: 'Informationsblock', en: 'Information block' } }, { value: 'line', label: { de: 'Bezugszeichenzeile', en: 'Reference line' } }]),
      refsBox,
      f.grid(f.select('notice', { de: 'Vermerk über der Anschrift', en: 'Notice above the address' }, [{ value: 'none', label: { de: 'Kein Vermerk', en: 'None' } },
        ...Object.entries(NOTICES).map(([k, n]) => ({ value: k, label: n })), { value: 'custom', label: { de: 'Eigener Vermerk …', en: 'Own notice …' } }]), noticeBox),
      f.check('folds', { de: 'Falzmarken drucken', en: 'Print fold marks' }), f.check('punch', { de: 'Lochmarke drucken', en: 'Print punch mark' })),
    recipientSection(f, lang),
    f.sec('tpl-h-text', { de: 'Brieftext', en: 'Letter text' },
      f.field('subject', { de: 'Betreff', en: 'Subject' }, { wide: true, hint: { de: 'Ohne das Wort „Betreff“ – es wird fett gedruckt.', en: 'Without the word “Subject” – it is printed in bold.' } }),
      f.field('salutation', { de: 'Anrede', en: 'Salutation' }, { wide: true }),
      f.area('body', { de: 'Text', en: 'Text' }, { rows: 9, maxLength: 20000, hint: { de: 'Absätze mit einer Leerzeile trennen. Längere Briefe gehen automatisch auf Seite 2 weiter.', en: 'Separate paragraphs with an empty line. Longer letters continue on page 2 automatically.' } }),
      f.field('closing', { de: 'Grußformel', en: 'Closing' }, { wide: true }),
      f.grid(f.field('signName', { de: 'Name unter der Unterschrift (falls anders)', en: 'Name below the signature (if different)' }),
        f.area('signerExtra', { de: 'Zusatz unter dem Namen (optional)', en: 'Line below the name (optional)' }, { rows: 2, placeholder: { de: 'z. B. Geschäftsführerin', en: 'e.g. Managing Director' } })),
      f.area('enclosures', { de: 'Anlagen (eine pro Zeile, optional)', en: 'Enclosures (one per line, optional)' }, { rows: 2 }),
      f.area('cc', { de: 'Verteiler (eine pro Zeile, optional)', en: 'Copies to (one per line, optional)' }, { rows: 2 })),
    sender.sec, sig.sec), el('div', { class: 'tpl-side' }, pvs.sec)));
  pvs.refresh();
  ctx.refresh();
  return { sig: () => sig.pad.export() };
}
