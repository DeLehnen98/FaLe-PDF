// „Per Post senden“: address + way of sending + price → mail-ready PDF → Stripe Checkout → status screen (#/post/<id>).
import { h, esc, toast, errorToast, openDialog, progress } from '../ui.js';
import { oicon } from '../office/kinds.js';
import { t } from '../i18n/index.js';
import { postConfig, createJob, rememberJob, localPrice, euro, PostError } from './api.js';
import { buildMailPdf, addressLines, isAbroad, checkAddress } from './pdf.js';

const WAYS = [
  { id: '', title: 'Brief', desc: 'Normale Post, kommt in 1–2 Werktagen an' },
  { id: 'r1', title: 'Einschreiben Einwurf', desc: 'Mit Nachweis, dass er im Briefkasten ankam – gut für Kündigungen' },
  { id: 'r2', title: 'Einschreiben', desc: 'Wird nur gegen Unterschrift übergeben' },
];

const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };

/** Letters that need a pen signature (Schriftform) cannot be mailed by a print service. */
export async function needsOwnSignature() {
  await openDialog({
    title: 'Diesen Brief bitte selbst verschicken',
    body: `<div class="pt-info-box">${oicon('pen')}<p>Dieser Brief braucht deine Unterschrift mit Stift – zum Beispiel bei der Kündigung einer Wohnung oder eines Arbeitsvertrags. Ein gedruckter Brief reicht dafür nicht. Drucke ihn aus, unterschreibe ihn und schick ihn selbst, am besten als Einschreiben.</p></div>`,
    actions: [{ label: 'Verstanden', value: 'ok', kind: 'btn-primary', default: true }],
  });
}

/**
 * Open the „Per Post senden“ dialog for a PDF from the library.
 * @param {{docId: string, name: string, bytes: Uint8Array, to?: object, from?: object, strict?: boolean}} o
 */
export async function sendByPost({ docId, name, bytes, to = {}, from = null, strict = false }) {
  if (strict) return needsOwnSignature();
  let cfg;
  try { cfg = await postConfig(); } catch (e) { errorToast(e, 'Der Briefversand ist gerade nicht erreichbar.'); return null; }
  if (!cfg.enabled) { toast('Der Briefversand ist noch nicht eingerichtet – bitte versuche es später.', 'info'); return null; }
  let srcPages = 1;
  try { const { loadEditable } = await import('../pdflib.js'); srcPages = (await loadEditable(bytes, name, { key: docId })).getPageCount(); } catch (e) { errorToast(e, 'Die PDF konnte nicht gelesen werden.'); return null; }
  const pages = srcPages + 1; // + address sheet
  if (pages > cfg.maxPages) { toast(`Per Post gehen bis zu ${cfg.maxPages - 1} Seiten – diese PDF hat ${srcPages}.`, 'error', { timeout: 6000 }); return null; }
  if (!from) {
    try {
      const p = await (await import('../extras/profile.js')).getProfile();
      if (p) from = { name: [p.vorname, p.nachname].filter(Boolean).join(' ') || p.firma || '', strasse: [p.strasse, p.hausnummer].filter(Boolean).join(' '), plz: p.plz || '', ort: p.ort || '' };
    } catch { from = null; }
  }
  const a = { name: '', zusatz: '', strasse: '', plz: '', ort: '', country: 'Deutschland', ...to };
  const state = { registered: 'registered' in to ? to.registered : 'r1', color: false };

  const body = h(`<div class="post-dlg">
    ${cfg.test ? `<div class="post-test" role="note">${oicon('info')}<span>Testmodus: Es wird nichts gedruckt, verschickt oder abgebucht.</span></div>` : ''}
    <div class="post-grid">
      <section class="post-sec"><h3>An wen?</h3>
        <label class="field"><span class="field-label">Name oder Firma</span><input class="input" name="name" autocomplete="off" maxlength="60"></label>
        <label class="field"><span class="field-label">Zusatz <span class="muted">(freiwillig, z. B. Abteilung)</span></span><input class="input" name="zusatz" maxlength="60"></label>
        <label class="field"><span class="field-label">Straße und Hausnummer <span class="muted">(oder Postfach)</span></span><input class="input" name="strasse" maxlength="60"></label>
        <div class="post-row"><label class="field post-plz"><span class="field-label">PLZ</span><input class="input" name="plz" maxlength="10" inputmode="numeric"></label>
          <label class="field"><span class="field-label">Ort</span><input class="input" name="ort" maxlength="50"></label></div>
        <label class="field"><span class="field-label">Land</span><input class="input" name="country" maxlength="40"></label>
        <p class="field-error" data-err hidden></p>
      </section>
      <section class="post-sec"><h3>So steht es im Fenster</h3>
        <div class="post-env" aria-hidden="true"><div class="post-win"><small data-ret></small><div data-lines></div></div><span class="post-stamp">${oicon('mail')}</span></div>
        <h3 class="post-h-way">Wie verschicken?</h3>
        <div class="post-ways" role="radiogroup" aria-label="Versandart">${WAYS.map(w => `<button type="button" class="post-way" role="radio" data-way="${w.id}"><span class="post-way-t"><b>${esc(w.title)}</b><span>${esc(w.desc)}</span></span><span class="post-way-p" data-price="${w.id}"></span></button>`).join('')}</div>
        <label class="check"><input type="checkbox" name="color"><span>Farbig drucken</span></label>
      </section>
    </div>
    <p class="post-sum" data-sum aria-live="polite"></p>
    <p class="hint post-hint">${oicon('pen')} <span>Braucht der Brief deine Unterschrift mit Stift (z. B. Kündigung der Wohnung oder des Jobs)? Dann musst du ihn selbst unterschreiben und verschicken.</span></p>
    <p class="hint post-hint">${oicon('shield')} <span>Zum Drucken geht der Brief an unseren Versandpartner. Bei uns wird er gelöscht, sobald er übergeben ist. Bezahlt wird sicher über Stripe (Karte, PayPal, Google Pay, Apple Pay).</span></p>
  </div>`);
  const $ = s => body.querySelector(s);
  ['name', 'zusatz', 'strasse', 'plz', 'ort', 'country'].forEach(k => { $(`[name=${k}]`).value = a[k] || ''; });
  const read = () => { ['name', 'zusatz', 'strasse', 'plz', 'ort', 'country'].forEach(k => { a[k] = $(`[name=${k}]`).value.trim(); }); state.color = $('[name=color]').checked; };
  const price = () => localPrice(cfg.prices, { pages, color: state.color, registered: isAbroad(a.country) ? '' : state.registered, intl: isAbroad(a.country) });
  let okBtn = null;
  function paint() {
    read();
    const intl = isAbroad(a.country);
    if (intl && state.registered) state.registered = '';
    body.querySelectorAll('[data-way]').forEach(b => {
      const id = b.dataset.way;
      const off = intl && id !== '';
      b.disabled = off;
      b.setAttribute('aria-checked', String(state.registered === id));
      b.tabIndex = state.registered === id ? 0 : -1;
      b.querySelector('.post-way-p').textContent = off ? 'nur Inland' : euro(localPrice(cfg.prices, { pages, color: state.color, registered: id, intl }));
    });
    $('[data-ret]').textContent = from && from.name ? [from.name, from.strasse, [from.plz, from.ort].filter(Boolean).join(' ')].filter(Boolean).join(' · ') : '';
    const ls = addressLines(a);
    $('[data-lines]').innerHTML = ls.length ? ls.map(l => `<span>${esc(l)}</span>`).join('') : '<span class="muted">Adresse eintragen</span>';
    $('[data-sum]').innerHTML = `<b>${esc(euro(price()))}</b> <span data-no-i18n>${esc(t('inkl. MwSt. · {n} Seiten (mit Adressblatt)', { n: pages }) + (intl ? ' · ' + t('ins Ausland') : ''))}</span>`;
    if (okBtn) okBtn.textContent = `Weiter zur Bezahlung (${euro(price())})`;
  }
  body.addEventListener('input', paint);
  body.addEventListener('change', paint);
  body.querySelectorAll('[data-way]').forEach(b => b.addEventListener('click', () => { state.registered = b.dataset.way; paint(); }));

  const r = await openDialog({
    title: 'Per Post senden', wide: true, body,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Weiter zur Bezahlung', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => { okBtn = dlg.querySelector('.dlg-actions .btn-primary'); paint(); setTimeout(() => { const f = body.querySelector('[name=name]'); if (f && !f.value) f.focus(); }, 60); },
    validate: (v) => {
      if (v !== 'ok') return true;
      read();
      const miss = checkAddress(a);
      const err = $('[data-err]');
      if (miss.length) {
        const only = miss.length === 1 ? miss[0] : '';
        err.textContent = only === 'plz' ? 'Die Postleitzahl hat in Deutschland 5 Ziffern.' : only === 'script' ? 'Bitte die Adresse in lateinischen Buchstaben schreiben – so kann die Post sie lesen.' : 'Bitte Name, Straße, PLZ und Ort eintragen.';
        err.hidden = false;
        const f = body.querySelector(`[name=${miss[0] === 'ort' ? (a.plz ? 'ort' : 'plz') : miss[0] === 'script' ? 'name' : miss[0]}]`);
        if (f) f.focus();
        return false;
      }
      err.hidden = true;
      return true;
    },
  });
  if (r.value !== 'ok') return null;
  return submit({ docId, name, bytes, a, from, state, cfg, pages });
}

async function submit({ docId, name, bytes, a, from, state, cfg, pages }) {
  const intl = isAbroad(a.country);
  const registered = intl ? '' : state.registered;
  const prog = progress('Brief wird vorbereitet …');
  let job;
  try {
    const mail = await buildMailPdf(bytes, name, { to: a, from, key: docId });
    if (mail.bytes.length > cfg.maxBytes) throw new PostError('too_large', `Die PDF ist zu groß für den Versand (max. ${Math.round(cfg.maxBytes / 104857.6) / 10} MB). Verkleinere sie zuerst mit „PDF verkleinern“.`);
    const payload = { pdf: b64(mail.bytes), pages: mail.pages, color: state.color, registered, intl, country: a.country, expectCents: localPrice(cfg.prices, { pages: mail.pages, color: state.color, registered, intl }) };
    prog.set('Bezahlung wird vorbereitet …');
    try { job = await createJob(payload); }
    catch (e) {
      if (e && e.code === 'price_changed' && e.data && e.data.priceCents) {
        prog.done();
        const ok = await openDialog({ title: 'Neuer Preis', body: `<p data-no-i18n>${esc(t('Der Versand kostet gerade {price}. Möchtest du so verschicken?', { price: euro(e.data.priceCents) }))}</p>`, actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: `Für ${euro(e.data.priceCents)} verschicken`, value: 'ok', kind: 'btn-primary', default: true }] });
        if (ok.value !== 'ok') return null;
        job = await createJob({ ...payload, expectCents: e.data.priceCents });
      } else throw e;
    }
  } catch (e) { prog.done(); errorToast(e, 'Der Brief konnte nicht vorbereitet werden.'); return null; }
  prog.done();
  rememberJob({ id: job.id, cap: job.cap, docId, docName: name, to: addressLines(a), options: { registered, color: state.color, intl, pages }, priceCents: job.priceCents, createdAt: Date.now(), status: 'pending_payment', checkoutUrl: job.checkoutUrl, test: !!job.test });
  await openCheckout(job.checkoutUrl);
  location.hash = `#/post/${job.id}`;
  return job;
}

/** Stripe Checkout in the browser (the app opens the system browser); test payments stay in the app. */
export async function openCheckout(url) {
  if (!url || /^mock:/.test(url)) return false;
  try {
    const { isNative } = await import('../platform.js');
    if (isNative()) { const { openExternal } = await import('../security.js'); return openExternal(url, { confirm: false }); }
  } catch { /* web */ }
  const w = window.open(url, '_blank'); // (with 'noopener' window.open always returns null – cut the link below instead)
  if (w) { try { w.opener = null; } catch { /* cross-origin */ } }
  else location.href = url; // popup blocked: go there in this tab (Stripe returns to #/post/<id>)
  return true;
}
