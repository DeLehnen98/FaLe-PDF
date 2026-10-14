// Shared UI for the AI features: stylesheet, consent dialog, quota widget, errors, rich text with
// page citations, saving results. All visible strings are plain German (js/i18n translates them).
import { $, h, esc, toast, errorToast, openDialog } from '../ui.js';
import { oicon } from '../office/kinds.js';
import { isNative } from '../platform.js';
import * as C from './client.js';
import { CITE_RE } from './retrieval.js';

let cssDone = false;
export function loadAiCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('../../css/ai.css', import.meta.url).href;
  document.head.appendChild(l);
}

export const AI_ICON = 'sparkle';

// ---------------------------------------------------------------- consent
/** First-use consent. Resolves true when the user agreed. */
export async function consentDialog(provider) {
  const p = provider || {};
  const name = p.label ? `${p.label}${p.company ? ` (${p.company})` : ''}` : 'unseren KI-Anbieter';
  const r = await openDialog({
    title: 'Cloud-KI verwenden?',
    wide: true,
    body: `<div class="ai-consent">
      <p>Für Cloud-KI-Funktionen sendet FaLe PDF <strong>nur den Text, den du für die jeweilige Aufgabe auswählst</strong> (z. B. deine Frage und passende Ausschnitte aus dem Dokument), verschlüsselt über unseren Server an <strong data-no-i18n>${esc(name)}</strong>. Deine Dateien selbst werden nicht hochgeladen.</p>
      <ul class="ai-consent-list">
        <li>${oicon('shield')}<span><strong>Wir speichern keine Inhalte.</strong> Unser Server zählt nur Anfragen: mit einer zufälligen, pseudonymen Gerätekennung und einer gekürzten, verschlüsselten (gehashten) IP-Adresse zum Schutz vor Missbrauch. Diese Zähler werden nach 30 Tagen gelöscht.</span></li>
        <li>${oicon('info')}<span data-no-i18n-note>${esc(p.privacy || 'Die Verarbeitung beim KI-Anbieter richtet sich nach dessen Bedingungen (siehe Datenschutzerklärung).')}</span></li>
        <li>${oicon('lock')}<span>Bitte sende keine besonders sensiblen Daten (z. B. Gesundheits-, Ausweis- oder Kontodaten), wenn du das nicht möchtest. Für private Texte gibt es – wo verfügbar – die KI „Auf dem Gerät“.</span></li>
        <li>${oicon('close')}<span>Freiwillig und jederzeit widerrufbar: In den KI-Einstellungen kannst du die Cloud-KI ausschalten. Alle anderen Funktionen von FaLe PDF bleiben ohne KI nutzbar.</span></li>
      </ul>
      <p class="muted small">Rechtsgrundlage ist deine Einwilligung (Art. 6 Abs. 1 lit. a DSGVO). Details in der <a href="datenschutz.html" target="_blank" rel="noopener" data-ai-privacy>Datenschutzerklärung</a>. KI kann Fehler machen – prüfe wichtige Ergebnisse.</p>
    </div>`,
    actions: [{ label: 'Nicht jetzt', value: 'cancel' }, { label: 'Zustimmen und fortfahren', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => {
      const a = $('[data-ai-privacy]', dlg);
      if (a) a.addEventListener('click', e => { e.preventDefault(); import('../platform.js').then(m => m.openLegalPage('datenschutz.html')); });
      return null;
    },
  });
  if (r.value === 'ok') { C.giveConsent(p.id || ''); return true; }
  return false;
}

/**
 * Make sure cloud AI may be used right now (online, enabled, configured, consent).
 * Returns the status object or null (the user was told why).
 */
export async function ensureCloud() {
  if (!C.online()) { toast('Du bist offline. Cloud-KI braucht eine Internetverbindung.', 'error'); return null; }
  if (C.cloudDisabled()) {
    const r = await openDialog({
      title: 'Cloud-KI ist ausgeschaltet',
      body: '<p>Du hast die Cloud-KI in den KI-Einstellungen ausgeschaltet. Möchtest du sie wieder einschalten?</p>',
      actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Einschalten', value: 'ok', kind: 'btn-primary', default: true }],
    });
    if (r.value !== 'ok') return null;
    C.setCloudDisabled(false);
  }
  let st;
  try { st = await C.aiStatus(); } catch (e) { errorToast(e, 'Der KI-Dienst ist gerade nicht erreichbar.'); return null; }
  if (!st.configured) { toast('KI kommt bald – die Cloud-KI ist noch nicht eingerichtet.', 'info', { timeout: 5000 }); return null; }
  if (!C.hasConsent()) {
    const ok = await consentDialog(st.provider);
    if (!ok) return null;
    try { await C.ensureToken(); C.refreshQuota().catch(() => {}); } catch (e) { errorToast(e, 'Die Verbindung zur KI konnte nicht hergestellt werden.'); return null; }
  }
  return st;
}

// ---------------------------------------------------------------- quota widget
/** "Heute noch X von Y gratis" + optional ad button (Android) + Plus link. Updates itself. */
export function quotaWidget({ compact = false } = {}) {
  const el = h(`<div class="ai-quota${compact ? ' compact' : ''}" aria-live="polite"></div>`);
  let features = {};
  const paint = q => {
    if (!q) {
      el.innerHTML = C.hasConsent() ? '<span class="muted small">Kontingent wird geladen …</span>' : `<span class="muted small">Täglich einige Anfragen gratis – ohne Konto.</span>`;
      return;
    }
    const pct = q.limit ? Math.min(100, (q.used / q.limit) * 100) : 100;
    const left = q.remaining;
    const label = q.plus ? `FaLe Plus aktiv · heute noch ${left} von ${q.limit}` : left > 0 ? `Heute noch ${left} von ${q.limit} gratis` : 'Kontingent für heute aufgebraucht';
    const canAd = !q.plus && isNative() && features.ads !== false && q.rewardsLeft > 0;
    el.innerHTML = `<div class="aq-row"><span class="aq-label"><strong data-aq-left>${esc(label)}</strong>${!q.plus && left <= 0 ? '<span class="muted small">Morgen gibt es wieder neue Anfragen.</span>' : ''}</span>
      <div class="aq-meter" role="progressbar" aria-label="Verbrauchte KI-Anfragen" aria-valuemin="0" aria-valuemax="${q.limit}" aria-valuenow="${q.used}"><span style="width:${pct}%"></span></div></div>
      ${(canAd || !q.plus) && !compact ? `<div class="aq-acts">
        ${canAd ? `<button class="btn btn-soft btn-sm" type="button" data-ai-ad>${oicon('play')} Werbevideo ansehen (+${q.bonus || 3})</button>` : ''}
        ${!q.plus ? `<a class="btn btn-ghost btn-sm" href="#/ki/plus" data-ai-plus>${oicon('star')} FaLe Plus</a>` : ''}</div>` : ''}`;
    const ad = $('[data-ai-ad]', el);
    if (ad) ad.addEventListener('click', () => watchAdFlow(ad));
  };
  const onQ = e => paint(e.detail);
  window.addEventListener('fale:ai-quota', onQ);
  el._dispose = () => window.removeEventListener('fale:ai-quota', onQ);
  el.setFeatures = f => { features = f || {}; paint(C.cachedQuota()); };
  paint(C.cachedQuota());
  return el;
}

/** Rewarded video → server-verified reward → refreshed quota. */
export async function watchAdFlow(btn) {
  if (btn) btn.disabled = true;
  try {
    const { showRewardedAd } = await import('./ads.js');
    const res = await showRewardedAd();
    if (res && res.rewarded) toast(`Danke! ${res.credited ? `+${res.bonus || 3} KI-Anfragen für heute.` : 'Die Gutschrift kann ein paar Sekunden dauern.'}`, 'success', { timeout: 5000 });
  } catch (e) {
    errorToast(e, 'Das Werbevideo konnte gerade nicht geladen werden. Bitte versuche es später.');
  } finally { if (btn) btn.disabled = false; }
}

// ---------------------------------------------------------------- errors
/** Show an AI error. Quota/budget problems get a friendly dialog with the options. */
export async function showAiError(err) {
  if (!err || err.name === 'AbortError') return;
  if (err.code === 'quota_exhausted') {
    const q = err.quota || C.cachedQuota() || {};
    const canAd = isNative() && q.rewardsLeft > 0;
    const r = await openDialog({
      title: 'Heutiges KI-Kontingent aufgebraucht',
      body: `<div class="ai-limit"><p>Du hast heute alle ${q.limit || ''} kostenlosen KI-Anfragen genutzt. Morgen gibt es wieder neue – alle anderen Funktionen von FaLe PDF kannst du ganz normal weiter nutzen.</p>
        ${canAd ? `<p>Freiwillig: Ein kurzes Werbevideo schaltet <strong>${q.bonus || 3} weitere Anfragen</strong> frei (noch ${q.rewardsLeft}× heute).</p>` : ''}
        <p class="muted small">Mit <strong>FaLe Plus</strong> bekommst du deutlich mehr KI-Anfragen pro Tag und unterstützt die Entwicklung.</p></div>`,
      actions: [{ label: 'Schließen', value: 'cancel' }, { label: 'FaLe Plus ansehen', value: 'plus' }, ...(canAd ? [{ label: `Werbevideo ansehen (+${q.bonus || 3})`, value: 'ad', kind: 'btn-primary', default: true }] : [])],
    });
    if (r.value === 'ad') await watchAdFlow();
    if (r.value === 'plus') location.hash = '#/ki/plus';
    return;
  }
  if (err.code === 'budget_exhausted') {
    await openDialog({ title: 'KI-Kontingent für diesen Monat aufgebraucht', body: `<p>${esc(err.userMessage)}</p><p class="muted small">Alle anderen Funktionen bleiben nutzbar. Zusammenfassen und Übersetzen funktionieren – wo verfügbar – auch „Auf dem Gerät“.</p>`, actions: [{ label: 'OK', value: 'ok', kind: 'btn-primary', default: true }] });
    return;
  }
  toast(err.userMessage || 'Die KI ist gerade nicht erreichbar. Bitte versuche es später erneut.', err.code === 'ai_not_configured' ? 'info' : 'error', { timeout: 6000 });
}

// ---------------------------------------------------------------- rich text + citations
function inline(s) {
  return esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
/**
 * Minimal markdown (## headings, - bullets, **bold**, paragraphs) with clickable citations.
 * Citations become <button class="ai-cite" data-page="n">.
 */
export function richText(text, { cite = true } = {}) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  let html = '', list = false, para = [];
  const flushP = () => { if (para.length) { html += `<p>${para.map(inline).join('<br>')}</p>`; para = []; } };
  const closeL = () => { if (list) { html += '</ul>'; list = false; } };
  for (const raw of lines) {
    const l = raw.trimEnd();
    let m;
    if (!l.trim()) { flushP(); closeL(); continue; }
    if ((m = /^#{1,4}\s+(.*)$/.exec(l.trim()))) { flushP(); closeL(); html += `<h4>${inline(m[1])}</h4>`; continue; }
    if ((m = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(l))) { flushP(); if (!list) { html += '<ul>'; list = true; } html += `<li>${inline(m[1])}</li>`; continue; }
    closeL();
    para.push(l);
  }
  flushP(); closeL();
  if (!cite) return html;
  return html.replace(CITE_RE, (all, unit, nums) => {
    const pages = nums.split(/\s*(?:,|und|–|-)\s*/).map(n => parseInt(n, 10)).filter(Boolean);
    const u = unit === 'Seite' ? 'S.' : unit;
    return pages.map(p => `<button type="button" class="ai-cite" data-page="${p}" aria-label="${u === 'S.' ? 'Seite' : u} ${p} öffnen">${esc(u)} ${p}</button>`).join(' ');
  });
}

// ---------------------------------------------------------------- results
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Kopiert', 'success'); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Kopiert', 'success'); } catch { toast('Kopieren nicht möglich', 'error'); }
    ta.remove();
  }
}

/** Save AI text as a library file. fmt: 'docx' | 'txt' | 'pdf'. Returns the new meta. */
export async function saveText(text, { title = 'KI-Ergebnis', fmt = 'docx', heading = '' } = {}) {
  const base = String(title).replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 90) || 'KI-Ergebnis';
  const lib = await import('../library.js');
  let meta;
  if (fmt === 'txt') {
    meta = await lib.saveFile({ blob: new Blob([(heading ? heading + '\n\n' : '') + text.replace(/\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' }), name: base, kind: 'txt' });
  } else {
    const dm = await import('../office/docmodel.js');
    const html = `${heading ? `<h1>${esc(heading)}</h1>` : ''}${dm.markdownToHtml(text)}`;
    const model = dm.htmlToModel(html, { baseSize: 11 });
    if (fmt === 'pdf') {
      const { modelToPdf } = await import('../office/docpdf.js');
      const bytes = await modelToPdf(model, { title: base });
      meta = await lib.saveResult(bytes, base + '.pdf');
    } else {
      const { modelToDocx } = await import('../office/docx-write.js');
      const blob = await modelToDocx(model, { title: base });
      meta = await lib.saveFile({ blob: new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), name: base, kind: 'docx' });
    }
  }
  const { openHash } = await import('../office/kinds.js');
  toast(`„${meta.name}“ gespeichert`, 'success', { action: { label: 'Öffnen', onClick: () => { location.hash = openHash(meta); } } });
  return meta;
}

/** Row of result actions: copy + save as .docx / .txt / PDF. */
export function resultActions(getText, { title, heading } = {}) {
  const row = h(`<div class="ai-res-acts">
    <button class="btn btn-ghost btn-sm" type="button" data-act="copy">${oicon('copy')} Kopieren</button>
    <button class="btn btn-soft btn-sm" type="button" data-act="docx">${oicon('kdoc')} Als Dokument (.docx)</button>
    <button class="btn btn-ghost btn-sm" type="button" data-act="pdf">${oicon('kpdf')} Als PDF</button>
    <button class="btn btn-ghost btn-sm" type="button" data-act="txt">${oicon('file')} Als Text (.txt)</button></div>`);
  row.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const text = getText();
    if (!text) return;
    if (b.dataset.act === 'copy') return copyText(text);
    b.disabled = true;
    try { await saveText(text, { title: typeof title === 'function' ? title() : title, heading: typeof heading === 'function' ? heading() : heading, fmt: b.dataset.act }); }
    catch (err) { errorToast(err, 'Speichern fehlgeschlagen.'); }
    finally { b.disabled = false; }
  });
  return row;
}

/** On-device (Chrome built-in AI) vs. cloud selector for summarize/translate. */
export async function engineSwitch(op) {
  let local = false;
  try {
    // some browsers expose the on-device APIs but never answer availability() → give up after 1.5 s
    const caps = await Promise.race([(await import('../extras/ai.js')).aiCapabilities(), new Promise(r => setTimeout(() => r({}), 1500))]);
    local = !!(caps && caps[op]);
  } catch {}
  const el = h(`<div class="ai-engine" role="radiogroup" aria-label="Wo soll die KI rechnen?">
    ${local ? `<button type="button" role="radio" aria-checked="true" data-engine="device">${oicon('shield')}<span><strong>Auf dem Gerät</strong><small>gratis, privat</small></span></button>` : ''}
    <button type="button" role="radio" aria-checked="${local ? 'false' : 'true'}" data-engine="cloud">${oicon('cloud')}<span><strong>Cloud-KI</strong><small>beste Qualität</small></span></button></div>`);
  let value = local ? 'device' : 'cloud';
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-engine]');
    if (!b) return;
    value = b.dataset.engine;
    el.querySelectorAll('[data-engine]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
  });
  el.value = () => value;
  el.hasLocal = local;
  if (!local) el.hidden = true; // only one option → no need to show a switch
  return el;
}

export function progressNote(el, text) {
  el.hidden = !text;
  el.innerHTML = text ? `<span class="spinner dark" aria-hidden="true"></span><span>${esc(text)}</span>` : '';
}
