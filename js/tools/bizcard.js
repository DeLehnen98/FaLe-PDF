// Tool: Visitenkarte scannen — OCR a business card photo, recognise the contact fields
// (German + English), edit them and save/share as vCard (.vcf, version 3.0).
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, pickFiles, downloadBlob } from '../ui.js';
import { ensureCss, proBadge, updateFoot } from './common.js';
import { recognize, isAbort } from '../ocr/engine.js';
import { parseCard, toVCard } from '../ocr/bizcard-parse.js';
import { ensureOcrReady, progressPanel, getLangPref, ocrErrorText } from '../ocr/ui.js';

const FIELDS = [
  ['name', 'Name', 'text', 'name'], ['firma', 'Firma', 'text', 'organization'], ['position', 'Position', 'text', 'organization-title'],
  ['telefon', 'Telefon', 'tel', 'tel'], ['mobil', 'Mobil', 'tel', 'tel'], ['fax', 'Fax', 'tel', 'off'],
  ['email', 'E-Mail', 'email', 'email'], ['web', 'Web', 'url', 'url'],
  ['strasse', 'Straße', 'text', 'street-address'], ['plz', 'PLZ', 'text', 'postal-code'], ['ort', 'Ort', 'text', 'address-level2'], ['land', 'Land', 'text', 'country-name'],
];

export async function mount(screen) {
  await ensureCss();
  screen.setTitle('Visitenkarte scannen', 'Kontakt aus einem Foto übernehmen');
  let alive = true, panel = null, photoUrl = null, raw = '';
  let card = null;

  screen.onDropFiles = files => { const f = Array.from(files || []).find(x => /^image\//.test(x.type)); if (f) run(f); };

  function showStart() {
    screen.body.innerHTML = '';
    const wrap = h(`<div class="screen-inner pt-narrow ocr">
      <div class="card intro"><span class="tile-ic">${icon('contact')}</span><div><strong>Visitenkarte scannen</strong>
        <p>Fotografiere eine Visitenkarte – Name, Firma, Telefon, E-Mail, Web und Adresse werden erkannt. Du kannst alles prüfen und als Kontakt (.vcf) speichern oder teilen. ${proBadge()}</p></div></div>
      <div class="ocr-src">
        <button class="btn btn-primary" type="button" data-cam>${icon('camera')} Visitenkarte fotografieren</button>
        <button class="btn btn-ghost" type="button" data-pick>${icon('gallery')} Foto wählen</button>
      </div>
      <p class="ocr-privacy">${icon('shield')}<span>Die Erkennung läuft komplett auf deinem Gerät – nichts wird hochgeladen.</span></p></div>`);
    screen.body.appendChild(wrap);
    const pick = async capture => { const [f] = await pickFiles({ accept: 'image/*', multiple: false, capture }); if (f) run(f); };
    wrap.querySelector('[data-cam]').addEventListener('click', () => pick('environment'));
    wrap.querySelector('[data-pick]').addEventListener('click', () => pick(null));
    updateFoot(screen, []);
  }

  async function run(file) {
    const lang = getLangPref();
    if (!await ensureOcrReady(lang)) return;
    panel = progressPanel({ title: 'Visitenkarte wird gelesen …' });
    try {
      const r = await recognize(file, { lang, psm: 'auto', signal: panel.signal, onProgress: p => panel.update(p) });
      import('../extras/stats.js').then(m => m.track('ocr_pages', 1)).catch(() => {});
      if (!alive) return;
      raw = r.text;
      card = parseCard(r.lines.map(l => ({ text: l.text, size: l.size })));
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      photoUrl = URL.createObjectURL(file);
      showForm();
      if (!r.words.length) toast('Auf dem Foto wurde kein Text gefunden. Achte auf gutes Licht und eine scharfe Aufnahme.', 'info', { timeout: 5000 });
    } catch (e) {
      if (isAbort(e)) toast('Abgebrochen.', 'info'); else errorToast(e, ocrErrorText(e));
    } finally { if (panel) panel.close(); panel = null; }
  }

  function collect() {
    const c = {};
    FIELDS.forEach(([k]) => { c[k] = (screen.body.querySelector(`[data-f="${k}"]`) || {}).value || ''; c[k] = c[k].trim(); });
    c.notiz = (screen.body.querySelector('[data-f="notiz"]') || {}).value || '';
    return c;
  }
  const fileName = c => `${(c.name || c.firma || 'Kontakt').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Kontakt'}.vcf`;

  function showForm() {
    screen.body.innerHTML = '';
    const wrap = h(`<div class="screen-inner pt-narrow ocr bc">
      <div class="bc-photo"><img src="${photoUrl}" alt="Foto der Visitenkarte"></div>
      <div class="card card-pad bc-form">
        <div class="bc-grid">${FIELDS.map(([k, label, type, ac]) => `<label class="field bc-${k}"><span class="field-label">${esc(label)}</span>
          <input class="input" data-f="${k}" type="${type}" autocomplete="${ac}" value="${esc(card[k] || '')}" ${type === 'tel' ? 'inputmode="tel"' : ''}></label>`).join('')}</div>
        <label class="field" style="margin:0"><span class="field-label">Notiz</span><textarea class="input" data-f="notiz" rows="2">${esc((card.rest || []).join('\n'))}</textarea></label>
      </div>
      <details class="pt-details"><summary>${icon('text')} Erkannter Text</summary><div class="pt-details-body"><pre class="bc-raw">${esc(raw)}</pre></div></details>
    </div>`);
    screen.body.appendChild(wrap);
    const again = h(`<button class="btn btn-ghost" type="button">${icon('camera')} Neu</button>`);
    const share = h(`<button class="btn btn-ghost" type="button" data-share>${icon('share')} Teilen</button>`);
    const save = h(`<button class="btn btn-primary" type="button" data-vcf>${icon('download')} Kontakt speichern (.vcf)</button>`);
    again.addEventListener('click', showStart);
    save.addEventListener('click', () => {
      const c = collect();
      if (!c.name && !c.firma && !c.email && !c.telefon && !c.mobil) { toast('Bitte gib mindestens einen Namen oder eine Telefonnummer ein.', 'error'); return; }
      downloadBlob(new Blob([toVCard(c)], { type: 'text/vcard;charset=utf-8' }), fileName(c), 'text/vcard');
    });
    share.addEventListener('click', async () => {
      const c = collect();
      const { shareFile } = await import('../platform.js');
      try { await shareFile(new Blob([toVCard(c)], { type: 'text/vcard' }), fileName(c), 'text/vcard', { title: c.name || 'Kontakt' }); }
      catch (e) { errorToast(e, 'Teilen nicht möglich.'); }
    });
    updateFoot(screen, [again, share, save]);
  }

  showStart();
  return () => { alive = false; if (panel) panel.close(); if (photoUrl) URL.revokeObjectURL(photoUrl); };
}
