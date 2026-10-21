// „Per Fax senden“: fax number (any format of the person's country, or +…) → price → fax-ready PDF → Stripe
// Checkout → status screen (#/post/<id>) with a Sendebericht (proof of transmission) at the end.
import { h, esc, toast, errorToast, openDialog, progress, debounce } from '../ui.js';
import { oicon } from '../office/kinds.js';
import { t } from '../i18n/index.js';
import { postConfig, createJob, rememberJob, localPrice, euro, quoteFax, deviceRegion, PostError } from './api.js';
import { buildFaxPdf } from './pdf.js';
import { needsOwnSignature, openCheckout } from './send.js';

const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
/** +4968112345 + cc '49' → „+49 68112345“ (country code apart; the rest as the server wrote it). */
export const prettyFax = (n, cc = '') => { const s = String(n || ''); return cc && s.startsWith('+' + cc) ? `+${cc} ${s.slice(cc.length + 1)}` : s; };

/**
 * Open the „Per Fax senden“ dialog for a PDF from the library.
 * @param {{docId: string, name: string, bytes: Uint8Array, to?: string, strict?: boolean}} o
 */
export async function sendByFax({ docId, name, bytes, to = '', strict = false }) {
  if (strict) return needsOwnSignature();
  let cfg;
  try { cfg = await postConfig(); } catch (e) { errorToast(e, 'Der Faxversand ist gerade nicht erreichbar.'); return null; }
  if (!cfg.fax) { toast('Der Faxversand ist noch nicht eingerichtet – bitte versuche es später.', 'info'); return null; }
  let pages = 1;
  try { const { loadEditable } = await import('../pdflib.js'); pages = (await loadEditable(bytes, name, { key: docId })).getPageCount(); } catch (e) { errorToast(e, 'Die PDF konnte nicht gelesen werden.'); return null; }
  if (pages > cfg.maxPages) { toast(t('Per Fax gehen bis zu {max} Seiten – diese PDF hat {n}.', { max: cfg.maxPages, n: pages }), 'error', { timeout: 6000 }); return null; }

  const state = { number: null, cc: '', intl: false, price: localPrice(cfg.prices, { channel: 'fax', pages, intl: false }), seq: 0, error: '' };
  const body = h(`<div class="post-dlg fax-dlg">
    ${cfg.faxTest ? `<div class="post-test" role="note">${oicon('info')}<span>Testmodus: Es wird nichts gefaxt oder abgebucht.</span></div>` : ''}
    <label class="field"><span class="field-label">Faxnummer</span>
      <input class="input fax-num" name="fax" type="tel" inputmode="tel" autocomplete="off" maxlength="40" placeholder="${esc(t('z. B. {ex}', { ex: deviceRegion() === 'DE' ? '0681 123456' : '+33 1 23 45 67 89' }))}"></label>
    <p class="muted small fax-where">Die Faxnummer steht meist im Briefkopf, in der Fußzeile oder im Impressum – oft mit „Fax“ davor.</p>
    <p class="fax-check" data-check aria-live="polite"></p>
    <p class="post-sum" data-sum aria-live="polite"></p>
    <p class="hint post-hint">${oicon('check')} <span>Du bekommst einen Sendebericht mit Datum, Uhrzeit und der ersten Seite – als Nachweis, dass das Fax übertragen wurde.</span></p>
    <p class="hint post-hint">${oicon('pen')} <span>Braucht der Brief deine Unterschrift mit Stift (z. B. Kündigung der Wohnung oder des Jobs)? Dann reicht ein Fax nicht – schick ihn selbst per Post.</span></p>
    <p class="hint post-hint">${oicon('shield')} <span>Zum Faxen geht die PDF an unseren Faxdienst. Bei uns wird sie gelöscht, sobald das Fax durch ist. Bezahlt wird sicher über Stripe (Karte, PayPal, Google Pay, Apple Pay).</span></p>
  </div>`);
  const $ = s => body.querySelector(s);
  const input = $('[name=fax]');
  input.value = to || '';
  let okBtn = null;
  function paint() {
    const c = $('[data-check]');
    if (state.error) { c.className = 'fax-check bad'; c.innerHTML = `${oicon('info')} <span>${esc(state.error)}</span>`; }
    else if (state.number) { c.className = 'fax-check ok'; c.innerHTML = `${oicon('check')} <span data-no-i18n>${esc(t('Wird gefaxt an {n}', { n: prettyFax(state.number, state.cc) }) + (state.intl ? ' · ' + t('ins Ausland') : ''))}</span>`; }
    else { c.className = 'fax-check'; c.textContent = ''; }
    $('[data-sum]').innerHTML = `<b>${esc(euro(state.price))}</b> <span data-no-i18n>${esc(pages === 1 ? t('inkl. MwSt. · 1 Seite') : t('inkl. MwSt. · {n} Seiten', { n: pages }))}</span>`;
    if (okBtn) { okBtn.textContent = `Weiter zur Bezahlung (${euro(state.price)})`; okBtn.disabled = !state.number; }
  }
  async function check() {
    const v = input.value.trim();
    const seq = ++state.seq;
    if (v.replace(/\D/g, '').length < 6) { state.number = null; state.error = ''; paint(); return; }
    try {
      const r = await quoteFax(v, pages);
      if (seq !== state.seq) return;
      state.number = r.to; state.cc = r.cc || ''; state.intl = !!r.intl; state.price = r.priceCents; state.error = '';
    } catch (e) {
      if (seq !== state.seq) return;
      state.number = null;
      state.error = e && e.code === 'bad_fax_number' ? 'Diese Faxnummer geht nicht. Bitte eine Festnetz-Faxnummer mit Vorwahl eintragen (aus dem Ausland mit +Ländervorwahl).' : (e && e.userMessage) || 'Die Nummer konnte nicht geprüft werden.';
    }
    paint();
  }
  const later = debounce(check, 450);
  input.addEventListener('input', () => { state.number = null; paint(); later(); });
  input.addEventListener('blur', check);

  const r = await openDialog({
    title: 'Per Fax senden', body,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Weiter zur Bezahlung', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => { okBtn = dlg.querySelector('.dlg-actions .btn-primary'); paint(); if (input.value) check(); setTimeout(() => { if (!input.value) input.focus(); }, 60); },
    validate: v => {
      if (v !== 'ok' || state.number) return true;
      if (!state.error) { state.error = 'Bitte die Faxnummer eintragen.'; paint(); }
      check(); input.focus();
      return false;
    },
  });
  if (r.value !== 'ok') return null;
  return submit({ docId, name, bytes, cfg, number: state.number, cc: state.cc, intl: state.intl, raw: input.value.trim() });
}

async function submit({ docId, name, bytes, cfg, number, cc, intl, raw }) {
  const prog = progress('Fax wird vorbereitet …');
  let job, fax;
  try {
    fax = await buildFaxPdf(bytes, name, { key: docId });
    if (fax.bytes.length > cfg.maxBytes) throw new PostError('too_large', `Die PDF ist zu groß für den Versand (max. ${Math.round(cfg.maxBytes / 104857.6) / 10} MB). Verkleinere sie zuerst mit „PDF verkleinern“.`);
    const payload = { channel: 'fax', to: number, region: 'DE', pdf: b64(fax.bytes), pages: fax.pages, expectCents: localPrice(cfg.prices, { channel: 'fax', pages: fax.pages, intl }) };
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
  } catch (e) { prog.done(); errorToast(e, 'Das Fax konnte nicht vorbereitet werden.'); return null; }
  prog.done();
  rememberJob({ id: job.id, cap: job.cap, docId, docName: name, to: [prettyFax(number, cc)], options: { channel: 'fax', to: number, intl, pages: fax.pages, typed: raw }, priceCents: job.priceCents, createdAt: Date.now(), status: 'pending_payment', checkoutUrl: job.checkoutUrl, test: !!job.test });
  await openCheckout(job.checkoutUrl);
  location.hash = `#/post/${job.id}`;
  return job;
}
