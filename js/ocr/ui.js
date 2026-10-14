// Shared OCR UI: first-use notice, offline explanation, language/mode pickers and a progress
// panel with page x/y, ETA and cancel.
import { icon } from '../icons.js';
import { h, esc, openDialog } from '../ui.js';
import { LANGS, PSMS } from './engine.js';
import { offlineStatus, approxBytes, mbLabel } from './assets.js';

function lsGet(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

export const langsOf = lang => String(lang || 'deu+eng').split('+');
export function getLangPref() { const v = lsGet('fale-ocr-lang', 'deu+eng'); return LANGS.some(l => l.id === v) ? v : 'deu+eng'; }
export function setLangPref(v) { lsSet('fale-ocr-lang', v); }
export function getPsmPref() { const v = lsGet('fale-ocr-psm', 'auto'); return PSMS.some(p => p.id === v) ? v : 'auto'; }
export function setPsmPref(v) { lsSet('fale-ocr-psm', v); }

/** <div> with language segment + layout select, persisted. */
export function optionsBlock({ psm = true } = {}) {
  const el = h(`<div class="ocr-opts">
    <div class="field"><span class="field-label">Sprache des Textes</span>
      <div class="seg" role="group" aria-label="Sprache">${LANGS.map(l => `<button type="button" data-ocrlang="${l.id}">${esc(l.label)}</button>`).join('')}</div></div>
    ${psm ? `<label class="field"><span class="field-label">Textanordnung</span>
      <select class="select" data-ocrpsm>${PSMS.map(p => `<option value="${p.id}">${esc(p.label)}</option>`).join('')}</select></label>` : ''}
  </div>`);
  const sync = () => el.querySelectorAll('[data-ocrlang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ocrlang === getLangPref())));
  el.querySelectorAll('[data-ocrlang]').forEach(b => b.addEventListener('click', () => { setLangPref(b.dataset.ocrlang); sync(); }));
  const sel = el.querySelector('[data-ocrpsm]');
  if (sel) { sel.value = getPsmPref(); sel.addEventListener('change', () => setPsmPref(sel.value)); }
  sync();
  return el;
}

/**
 * Before the first OCR run: explain the one-time download, or why it cannot work offline yet.
 * @returns {Promise<boolean>} true when OCR may start
 */
export async function ensureOcrReady(lang = getLangPref()) {
  const langs = langsOf(lang);
  const st = await offlineStatus(langs);
  if (st.mode === 'bundled' || st.mode === 'cached') return true;
  const size = mbLabel(approxBytes(langs));
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    await openDialog({
      title: 'Texterkennung noch nicht offline verfügbar',
      body: `<div class="ocr-note">${icon('info')}<div><p>Für die Texterkennung lädt FaLe PDF <b>einmalig ca. ${esc(size)} Sprachdaten</b> (Deutsch/Englisch) und speichert sie auf diesem Gerät. Das geht nur mit Internetverbindung.</p>
        <p>Danach funktioniert die Texterkennung auch komplett offline. Deine Dokumente werden dabei nie hochgeladen.</p>
        <p class="muted small">Tipp: Unter <b>Ich › Einstellungen › OCR-Daten für offline laden</b> kannst du die Daten vorab herunterladen.</p></div></div>`,
      actions: [{ label: 'OK', value: 'ok', kind: 'btn-primary', default: true }],
    });
    return false;
  }
  if (lsGet('fale-ocr-consent', '') === '1') return true;
  const r = await openDialog({
    title: 'Texterkennung (OCR) einrichten',
    body: `<div class="ocr-note">${icon('scan')}<div><p>Beim ersten Mal werden <b>einmalig ca. ${esc(size)} Sprachdaten</b> für Deutsch und Englisch geladen und auf deinem Gerät gespeichert.</p>
      <p>Danach erkennt FaLe PDF Text auch <b>ohne Internet</b>. Die Erkennung läuft vollständig auf deinem Gerät – es werden keine Dokumente oder Bilder hochgeladen.</p></div></div>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Laden & starten', value: 'ok', kind: 'btn-primary', default: true }],
  });
  if (r.value !== 'ok') return false;
  lsSet('fale-ocr-consent', '1');
  return true;
}

export function fmtEta(s) {
  if (s == null || !isFinite(s)) return '';
  if (s < 5) return 'gleich fertig';
  if (s < 60) return `noch ca. ${Math.max(5, Math.round(s / 5) * 5)} s`;
  const m = Math.round(s / 60);
  return `noch ca. ${m} min`;
}

/**
 * Floating progress panel (non-modal, the UI stays usable) with cancel.
 * @returns {{update: Function, close: Function, signal: AbortSignal, el: HTMLElement}}
 */
export function progressPanel({ title = 'Text wird erkannt …', total = 1, onCancel = null } = {}) {
  const ac = new AbortController();
  const el = h(`<div class="ocr-panel" role="status" aria-live="polite">
    <div class="ocr-panel-head"><span class="spinner" aria-hidden="true"></span><strong data-t>${esc(title)}</strong>
      <button class="btn btn-ghost btn-sm" type="button" data-cancel>${icon('close')} Abbrechen</button></div>
    <div class="ocr-bar" aria-hidden="true"><span data-bar></span></div>
    <div class="ocr-panel-info"><span data-msg>Wird vorbereitet …</span><span data-eta></span></div></div>`);
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  el.querySelector('[data-cancel]').addEventListener('click', () => {
    if (ac.signal.aborted) return;
    ac.abort();
    el.querySelector('[data-msg]').textContent = 'Wird abgebrochen …';
    if (onCancel) onCancel();
  });
  let closed = false;
  return {
    el,
    signal: ac.signal,
    /** p: {index, total, page, phase, progress, eta, message} */
    update(p = {}) {
      if (closed) return;
      const n = p.total || total;
      const i = p.index || 0;
      const frac = Math.max(0, Math.min(1, (i + (p.phase === 'recognize' ? (p.progress || 0) * 0.9 + 0.1 : p.phase === 'done' ? 1 : 0.05)) / n));
      el.querySelector('[data-bar]').style.width = `${(frac * 100).toFixed(1)}%`;
      const phase = p.phase === 'lang' || p.phase === 'load' ? (p.message || 'Texterkennung wird gestartet …') : 'Text wird erkannt';
      const where = p.page && p.page !== i + 1 ? `Seite ${p.page} (${i + 1} von ${n})` : n > 1 ? `Seite ${i + 1} von ${n}` : '';
      el.querySelector('[data-msg]').textContent = where ? `${where} · ${phase}` : phase;
      el.querySelector('[data-eta]').textContent = fmtEta(p.eta);
    },
    setTitle(t) { el.querySelector('[data-t]').textContent = t; },
    close() { closed = true; el.classList.remove('show'); setTimeout(() => el.remove(), 220); },
  };
}

/** German error text for OCR failures (abort is silent). */
export function ocrErrorText(e) {
  if (!e) return 'Die Texterkennung ist fehlgeschlagen.';
  return e.userMessage || 'Die Texterkennung ist fehlgeschlagen.';
}
