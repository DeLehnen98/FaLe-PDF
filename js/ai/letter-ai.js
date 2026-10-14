// „Brief per KI“: describe your request in your own words → the AI drafts subject + text →
// editable DIN-5008 letter with your sender data from the local profile (never sent to the AI).
import { $, $$, h, esc, toast, errorToast, debounce, openDialog } from '../ui.js';
import { oicon, KINDS } from '../office/kinds.js';
import * as C from './client.js';
import { statusCard, gate } from './common.js';
import { ensureCloud, showAiError, progressNote } from './ui.js';

const FIELDS = [
  { id: 'r_name', label: 'Empfänger', ph: 'z. B. Muster Telekom GmbH' },
  { id: 'r_zusatz', label: 'Abteilung / z. Hd. (optional)', ph: 'z. B. Kundenservice' },
  { id: 'r_strasse', label: 'Straße und Hausnummer / Postfach' },
  { id: 'r_ort', label: 'PLZ und Ort' },
];
const SENDER = [
  { id: 's_name', label: 'Dein Name' }, { id: 's_strasse', label: 'Straße und Hausnummer' }, { id: 's_ort', label: 'PLZ und Ort' },
  { id: 's_tel', label: 'Telefon (optional)' }, { id: 's_mail', label: 'E-Mail (optional)' },
];

export async function mount(screen) {
  const [L, { getProfile }] = await Promise.all([import('../extras/letters.js'), import('../extras/profile.js')]);
  const p = await getProfile().catch(() => null);
  const v = {
    s_name: p ? [p.vorname, p.nachname].filter(Boolean).join(' ') : '', s_strasse: p ? [p.strasse, p.hausnummer].filter(Boolean).join(' ') : '',
    s_ort: p ? [p.plz, p.ort].filter(Boolean).join(' ') : '', s_tel: (p && p.telefon) || '', s_mail: (p && p.email) || '', s_firma: (p && p.firma) || '',
    r_name: '', r_zusatz: '', r_strasse: '', r_ort: '', datum: L.isoToday(), ort_brief: (p && p.ort) || '',
    subject: '', salutation: 'Sehr geehrte Damen und Herren,', body: '',
  };
  let gen = null; // assigned below (status callbacks may fire earlier)
  const st = statusCard({ onChange: s => gate([gen], s) });
  const root = h(`<div class="lt-gen ai-letter">
    <form class="lt-form" novalidate autocomplete="on">
      <div data-status></div>
      <div class="card lt-sec ai-sec"><div class="lt-grid">
        <label class="field full"><span class="field-label">Worum geht es? <span class="req" aria-hidden="true">*</span></span>
          <textarea class="input" name="request" rows="4" maxlength="2500" placeholder="z. B. Ich möchte meinen Fitnessstudio-Vertrag zum nächstmöglichen Termin kündigen. Mitgliedsnummer weiß ich gerade nicht." data-no-i18n></textarea>
          <span class="hint">Deine Absenderdaten werden nicht an die KI gesendet – sie kommen lokal aus deinem Profil.</span></label>
        <div class="field full"><span class="field-label">Ton</span><div class="seg" role="group" aria-label="Ton"><button type="button" data-tone="neutral" aria-pressed="true">Sachlich</button><button type="button" data-tone="freundlich" aria-pressed="false">Freundlich</button><button type="button" data-tone="bestimmt" aria-pressed="false">Bestimmt</button></div></div>
      </div></div>
      <details class="card lt-sec" open><summary><span>Empfänger</span>${oicon('chevronDown')}</summary><div class="lt-grid">${FIELDS.map(f => `<label class="field"><span class="field-label">${esc(f.label)}</span><input class="input" name="${f.id}" placeholder="${esc(f.ph || '')}" data-no-i18n></label>`).join('')}</div></details>
      <details class="card lt-sec" ${p ? '' : 'open'}><summary><span>Absender</span><span class="lt-sum muted small" data-sendersum></span>${oicon('chevronDown')}</summary><div class="lt-grid">${SENDER.map(f => `<label class="field"><span class="field-label">${esc(f.label)}</span><input class="input" name="${f.id}" value="${esc(v[f.id])}" data-no-i18n></label>`).join('')}
        <label class="field"><span class="field-label">Ort im Datum</span><input class="input" name="ort_brief" value="${esc(v.ort_brief)}" data-no-i18n></label><label class="field"><span class="field-label">Datum</span><input class="input" type="date" name="datum" value="${esc(v.datum)}"></label></div></details>
      <div class="card lt-sec ai-sec" data-draft hidden><div class="lt-grid">
        <label class="field full"><span class="field-label">Betreff</span><input class="input" name="subject" data-no-i18n></label>
        <label class="field full"><span class="field-label">Anrede</span><input class="input" name="salutation" data-no-i18n></label>
        <label class="field full"><span class="field-label">Brieftext</span><textarea class="input" name="body" rows="10" data-no-i18n></textarea>
          <span class="hint">Ersetze Platzhalter in [eckigen Klammern] durch deine Angaben.</span></label>
      </div></div>
      <p class="ai-prep muted small" data-prep hidden></p>
      <p class="lt-disclaimer">${oicon('info')}<span>${esc(L.DISCLAIMER)} KI kann Fehler machen.</span></p>
    </form>
    <aside class="lt-side" aria-label="Vorschau"><div class="lt-side-head"><strong>Vorschau</strong><span class="muted small">So sieht dein Brief aus</span></div>
      <div class="lt-preview"><div class="lt-paper doc-page" aria-live="off"></div></div></aside>
  </div>`);
  $('[data-status]', root).appendChild(st.el);
  screen.body.classList.add('lt-body');
  screen.body.appendChild(root);
  const form = $('.lt-form', root), paper = $('.lt-paper', root), previewBox = $('.lt-preview', root), draft = $('[data-draft]', root), prep = $('[data-prep]', root);
  let tone = 'neutral';
  $$('[data-tone]', root).forEach(b => b.addEventListener('click', () => { tone = b.dataset.tone; $$('[data-tone]', root).forEach(x => x.setAttribute('aria-pressed', String(x === b))); }));

  const def = {
    fileTitle: 'Brief',
    build: x => ({
      subject: esc(x.subject || 'Betreff'),
      salutation: esc(x.salutation || 'Sehr geehrte Damen und Herren,'),
      body: String(x.body || '').split(/\n{2,}/).map(t => t.trim()).filter(Boolean).map(t => esc(t).replace(/\n/g, '<br>').replace(/\[([^\]]{1,60})\]/g, '<mark>[$1]</mark>')),
    }),
  };
  const update = () => {
    $('[data-sendersum]', root).textContent = [v.s_name, v.s_ort].filter(Boolean).join(', ');
    try { paper.innerHTML = draft.hidden ? '<p class="muted" style="padding:40px;text-align:center">Beschreibe oben dein Anliegen und tippe auf „Brief entwerfen“.</p>' : L.letterHtml(def, v); } catch (e) { console.warn(e); }
    const w = previewBox.clientWidth; if (w) paper.style.zoom = String(Math.min(1, (w - 2) / 794));
  };
  const ro = new ResizeObserver(update);
  ro.observe(previewBox);
  const later = debounce(update, 120);
  form.addEventListener('input', e => { if (e.target.name && e.target.name in v) v[e.target.name] = e.target.value; later(); });
  form.addEventListener('submit', e => e.preventDefault());
  update();

  gen = h(`<button class="btn btn-primary" type="button" data-go>${oicon('sparkle')} Brief entwerfen</button>`);
  const btnPrev = h(`<button class="btn btn-soft only-mobile" type="button" data-prev>${oicon('eye')}<span>Vorschau</span></button>`);
  const btnDoc = h(`<button class="btn btn-ghost" type="button" data-out="doc" hidden>${oicon('kdoc')}<span>Als Dokument</span></button>`);
  const btnPdf = h(`<button class="btn btn-primary" type="button" data-out="pdf" hidden>${oicon('kpdf')}<span>PDF erstellen</span></button>`);
  screen.setFoot([btnPrev, gen, btnDoc, btnPdf]);
  gate([gen], st.state());
  btnPrev.addEventListener('click', () => { root.classList.toggle('show-preview'); btnPrev.querySelector('span').textContent = root.classList.contains('show-preview') ? 'Formular' : 'Vorschau'; update(); });

  gen.addEventListener('click', async () => {
    const req = $('[name=request]', form).value.trim();
    if (req.length < 10) { toast('Beschreibe dein Anliegen in ein, zwei Sätzen.', 'error'); $('[name=request]', form).focus(); return; }
    if (!await ensureCloud()) return;
    gen.disabled = true;
    progressNote(prep, 'Die KI schreibt deinen Brief …');
    try {
      const r = await C.runTask('letter', { request: req, recipient: v.r_name }, { tone });
      const o = r.output;
      v.subject = o.subject; v.salutation = o.salutation; v.body = o.paragraphs.join('\n\n');
      $('[name=subject]', form).value = v.subject; $('[name=salutation]', form).value = v.salutation; $('[name=body]', form).value = v.body;
      draft.hidden = false; btnDoc.hidden = false; btnPdf.hidden = false;
      gen.innerHTML = `${oicon('restore')} Neu entwerfen`;
      gen.classList.replace('btn-primary', 'btn-ghost');
      update();
      draft.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } catch (e) { showAiError(e); }
    finally { gen.disabled = false; progressNote(prep, ''); }
  });

  async function produce(kind) {
    if (!v.s_name.trim()) { toast('Bitte gib deinen Namen als Absender ein.', 'error'); form.querySelectorAll('details')[1].open = true; $('[name=s_name]', form).focus(); return; }
    const btn = kind === 'doc' ? btnDoc : btnPdf;
    btn.disabled = true;
    try {
      const { htmlToModel } = await import('../office/docmodel.js');
      const model = htmlToModel(L.letterHtml(def, v).replace(/<\/?mark>/g, ''), { baseSize: 11 });
      const name = `${(v.subject || 'Brief').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60)} ${L.isoToday()}`;
      let meta;
      if (kind === 'doc') {
        const { modelToDocx } = await import('../office/docx-write.js');
        const { saveFile } = await import('../library.js');
        meta = await saveFile({ blob: new Blob([await modelToDocx(model, { title: 'Brief', page: L.DIN_PAGE })], { type: KINDS.docx.mime }), name, kind: 'docx', source: 'Erstellt' });
      } else {
        const { modelToPdf } = await import('../office/docpdf.js');
        const { saveResult } = await import('../library.js');
        meta = await saveResult(await modelToPdf(model, { title: 'Brief', page: L.DIN_PAGE }), name + '.pdf');
      }
      import('../extras/stats.js').then(m => m.track('letters_created')).catch(() => {});
      const r = await openDialog({
        title: kind === 'doc' ? 'Dokument erstellt' : 'PDF erstellt',
        body: `<div class="result-mini">${oicon('check')}<div><strong>${esc(meta.name)}</strong><p class="muted small">Gespeichert in deinen Dateien.</p></div></div>`,
        actions: [{ label: 'Schließen', value: 'close' }, { label: 'Öffnen', value: 'open', kind: 'btn-primary', default: true }],
      });
      if (r.value === 'open') location.hash = kind === 'doc' ? `#/bearbeiten/${meta.id}` : `#/ansicht/${meta.id}`;
    } catch (e) { errorToast(e, 'Der Brief konnte nicht erstellt werden.'); }
    finally { btn.disabled = false; }
  }
  btnDoc.addEventListener('click', () => produce('doc'));
  btnPdf.addEventListener('click', () => produce('pdf'));
  return () => { ro.disconnect(); st.el._dispose && st.el._dispose(); };
}
