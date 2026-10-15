// Shared UI pieces for "Teilen & Übertragen": stylesheet, icons, offline banner, link box, progress.
import { h, esc, toast } from '../ui.js';
import { oicon } from '../office/kinds.js';
import { online } from './api.js';

let cssDone = false;
export function loadShareCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('../../css/share.css', import.meta.url).href;
  document.head.appendChild(l);
}

// a few extra glyphs (24×24, stroke) – everything else comes from the app's icon sets
const EXTRA = {
  devices: '<rect x="2.5" y="5" width="13" height="10" rx="1.6"/><path d="M1.5 18h15"/><rect x="17.5" y="8" width="5" height="11" rx="1.2"/><path d="M19.4 16.8h1.2"/>',
  send: '<path d="M21 3 10 14"/><path d="m21 3-7 18-4-7-7-4z"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>',
  shareLock: '<rect x="4" y="10.5" width="16" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/><circle cx="12" cy="15.5" r="1.4"/>',
  signReq: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M7.5 17c1.2-1.6 2.2-2.4 3-2.4 1 0 .6 2.2 1.6 2.2.7 0 1.3-.9 2-.9.6 0 .9.6 1.9.6"/>',
};
export function sicon(name, cls = '') {
  if (!EXTRA[name]) return oicon(name, cls);
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${EXTRA[name]}</svg>`;
}

/** Honest one-paragraph explanation of the encryption (reused on several screens). */
export function e2eNote({ compact = false } = {}) {
  return h(`<div class="sh-e2e${compact ? ' compact' : ''}">${sicon('shareLock')}<div>
    <strong>Ende-zu-Ende-verschlüsselt</strong>
    <p>Die Datei wird auf deinem Gerät mit AES-256 verschlüsselt, bevor sie hochgeladen wird. Der Schlüssel steckt nur im Link (hinter dem #) und wird nie an unseren Server gesendet – wir speichern nur verschlüsselte Daten, Größe und Ablaufzeit und löschen alles automatisch. Wichtig: Wer den vollständigen Link hat, kann die Datei öffnen. Teile ihn nur mit den richtigen Personen oder setze zusätzlich ein Passwort.</p>
  </div></div>`);
}

/** Offline banner; calls onChange(isOnline) when the state flips. Returns {el, destroy}. */
export function offlineBanner(onChange) {
  const el = h(`<div class="sh-offline card" role="status" hidden>${oicon('cloud')}<div><strong>Du bist offline</strong>
    <span>Teilen, Unterschriften anfordern und Übertragen brauchen eine Internetverbindung. Alles andere in FaLe PDF funktioniert weiter offline.</span></div></div>`);
  const upd = () => { const on = online(); el.hidden = on; onChange && onChange(on); };
  window.addEventListener('online', upd);
  window.addEventListener('offline', upd);
  upd();
  return { el, destroy: () => { window.removeEventListener('online', upd); window.removeEventListener('offline', upd); } };
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function fmtUtc(iso) {
  if (!iso) return '–';
  return new Date(iso).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}
/** "läuft ab in 3 Std." / "läuft ab in 6 Tagen" / "abgelaufen" */
export function expiryLabel(iso) {
  if (!iso) return '';
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return 'abgelaufen';
  const min = Math.round(ms / 60000);
  if (min < 60) return `läuft ab in ${Math.max(1, min)} Min.`;
  const hr = Math.round(ms / 3600000);
  if (hr < 36) return `läuft ab in ${hr} Std.`;
  const d = Math.round(ms / 86400000);
  return `läuft ab in ${d} Tagen`;
}

export function progressBar(label = '') {
  const el = h(`<div class="sh-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="sh-progress-top"><span data-label>${esc(label)}</span><span data-pct>0 %</span></div><div class="sh-bar"><span></span></div></div>`);
  return {
    el,
    set(frac, text) {
      const p = Math.max(0, Math.min(100, Math.round(frac * 100)));
      el.setAttribute('aria-valuenow', String(p));
      el.querySelector('.sh-bar span').style.width = p + '%';
      el.querySelector('[data-pct]').textContent = `${p} %`;
      if (text != null) el.querySelector('[data-label]').textContent = text;
    },
  };
}

export async function copyToClipboard(text, okMsg = 'Link kopiert.') {
  try { await navigator.clipboard.writeText(text); toast(okMsg, 'success', { timeout: 2200 }); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    toast(ok ? okMsg : 'Kopieren wird hier nicht unterstützt – bitte den Link markieren und kopieren.', ok ? 'success' : 'error');
    return ok;
  }
}

/** Share a link as text (system share sheet, Android app or Web Share API; fallback: copy). */
export async function shareText({ title, text, url }) {
  const full = text ? `${text}\n${url}` : url;
  try {
    const { isNative, shareTextOrLink } = await import('../platform.js');
    const r = await shareTextOrLink(isNative() ? { title, text: full } : { title, text: text || '', url });
    if (r.ok) return true;
    if (r.cancelled) return false;
  } catch { /* fall back to copying */ }
  return copyToClipboard(full, 'Link kopiert – füge ihn in deine Nachricht ein.');
}

/** QR code (SVG) for a URL – uses the app's own encoder. */
export async function qrSvg(text, size = 220) {
  const { encodeQR, qrToSvg } = await import('../tools/qr.js');
  return qrToSvg(encodeQR(text, { ecc: 'M' }), { border: 3, size });
}

/** Link box: read-only field + Kopieren / Teilen / QR. */
export function linkBox(url, { shareTitle = 'Sicherer Link', shareText: text = '', qr = true, label = 'Dein Link' } = {}) {
  const el = h(`<div class="sh-linkbox">
    <label class="field"><span class="field-label">${esc(label)}</span><input class="input sh-link" readonly value="${esc(url)}" data-no-i18n aria-label="${esc(label)}"></label>
    <div class="sh-link-acts">
      <button class="btn btn-primary" type="button" data-copy>${oicon('copy')} Link kopieren</button>
      <button class="btn btn-soft" type="button" data-share>${oicon('share')} Teilen …</button>
      ${qr ? `<button class="btn btn-ghost" type="button" data-qr aria-expanded="false">${oicon('qr')} QR-Code</button>` : ''}
    </div>
    <div class="sh-qr" data-qrbox hidden></div></div>`);
  const input = el.querySelector('input');
  input.addEventListener('focus', () => input.select());
  el.querySelector('[data-copy]').addEventListener('click', () => copyToClipboard(url));
  el.querySelector('[data-share]').addEventListener('click', () => shareText({ title: shareTitle, text, url }));
  const qb = el.querySelector('[data-qr]');
  if (qb) qb.addEventListener('click', async () => {
    const box = el.querySelector('[data-qrbox]');
    if (!box.innerHTML) { try { box.innerHTML = await qrSvg(url); } catch { box.innerHTML = '<p class="muted small">Der Link ist zu lang für einen QR-Code.</p>'; } }
    box.hidden = !box.hidden;
    qb.setAttribute('aria-expanded', String(!box.hidden));
  });
  return el;
}

export function statusPill(status) {
  const map = {
    open: ['Offen', 'open'], viewed: ['Angesehen', 'viewed'], signed: ['Unterschrieben', 'signed'], expired: ['Abgelaufen', 'expired'],
    waiting: ['Wartet', 'open'], active: ['Aktiv', 'signed'], deleted: ['Gelöscht', 'expired'], exhausted: ['Limit erreicht', 'expired'],
  };
  const [label, cls] = map[status] || [status, 'open'];
  return `<span class="sh-pill sh-pill-${cls}">${esc(label)}</span>`;
}

export function shareErrorText(e, fallback) {
  return (e && e.userMessage) || fallback || 'Das hat nicht geklappt. Bitte versuche es erneut.';
}
