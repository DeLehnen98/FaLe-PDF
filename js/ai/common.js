// Building blocks shared by the AI screens: status banner + quota, document picker.
import { $, h, esc } from '../ui.js';
import { oicon, kindOf } from '../office/kinds.js';
import { thumbHtml, docMeta } from '../components.js';
import * as db from '../db.js';
import * as C from './client.js';
import { quotaWidget, consentDialog, loadAiCss } from './ui.js';

export const TEXT_KINDS = ['pdf', 'docx', 'txt', 'md', 'pptx', 'xlsx', 'csv'];

/**
 * Status card for an AI screen: offline / disabled / "KI kommt bald" / consent needed / quota.
 * Calls onReady(status) whenever cloud AI becomes usable. Returns { el, refresh, status() }.
 */
export function statusCard({ onChange } = {}) {
  loadAiCss();
  const el = h('<section class="card ai-status" aria-live="polite"><div class="ai-status-body"><span class="spinner dark" aria-hidden="true"></span><span class="muted small">Verfügbarkeit wird geprüft …</span></div></section>');
  const body = $('.ai-status-body', el);
  const qw = quotaWidget();
  let state = { kind: 'checking', status: null };
  const set = (kind, status = null) => { state = { kind, status }; el.dataset.state = kind; onChange && onChange(state); };
  async function refresh(force = false) {
    if (!C.online()) {
      body.innerHTML = `<div class="ai-banner off">${oicon('wifi')}<div><strong>Du bist offline</strong><span>Cloud-KI braucht eine Internetverbindung. Alle anderen Funktionen von FaLe PDF funktionieren weiter.</span></div></div>`;
      return set('offline');
    }
    if (C.cloudDisabled()) {
      body.innerHTML = `<div class="ai-banner off">${oicon('cloud')}<div><strong>Cloud-KI ist ausgeschaltet</strong><span>Du hast sie in den KI-Einstellungen deaktiviert.</span></div><button class="btn btn-soft btn-sm" type="button" data-enable>Einschalten</button></div>`;
      $('[data-enable]', body).addEventListener('click', () => { C.setCloudDisabled(false); refresh(true); });
      return set('disabled');
    }
    let st;
    try { st = await C.aiStatus({ force }); }
    catch (e) {
      body.innerHTML = `<div class="ai-banner off">${oicon('info')}<div><strong>KI gerade nicht erreichbar</strong><span>${esc(e.userMessage || 'Bitte versuche es später erneut.')}</span></div><button class="btn btn-ghost btn-sm" type="button" data-retry>Erneut prüfen</button></div>`;
      $('[data-retry]', body).addEventListener('click', () => refresh(true));
      return set('error');
    }
    if (!st.configured) {
      body.innerHTML = `<div class="ai-banner soon">${oicon('sparkle')}<div><strong>KI kommt bald</strong><span>Die Cloud-KI ist noch nicht eingerichtet. Schau bald wieder vorbei – alle anderen Funktionen kannst du schon nutzen.</span></div></div>`;
      return set('not_configured', st);
    }
    if (!C.hasConsent()) {
      body.innerHTML = `<div class="ai-banner consent">${oicon('shield')}<div><strong>Cloud-KI einrichten</strong><span>Einmalig zustimmen – danach täglich ${st.limits && st.limits.free ? st.limits.free : 'einige'} Anfragen gratis, ohne Konto. Gesendet wird nur der Text, den du auswählst.</span></div><button class="btn btn-primary btn-sm" type="button" data-consent>Zustimmen …</button></div>`;
      $('[data-consent]', body).addEventListener('click', async () => {
        if (await consentDialog(st.provider)) { try { await C.ensureToken(); } catch {} refresh(true); }
      });
      return set('needs_consent', st);
    }
    body.innerHTML = '';
    body.appendChild(qw);
    qw.setFeatures(st.features);
    if (!st.quota) {
      try { await C.refreshQuota(); } catch (e) { /* shown by widget as loading; next action retries */ }
    }
    if (st.budgetExhausted) body.appendChild(h(`<p class="ai-budget-note">${oicon('info')}<span>KI-Kontingent für diesen Monat aufgebraucht – ab dem 1. geht es weiter.</span></p>`));
    return set('ready', st);
  }
  const onNet = e => (e && e.type === 'online' ? setTimeout(() => refresh(true), 600) : refresh(true)); // network needs a moment after 'online'
  window.addEventListener('online', onNet);
  window.addEventListener('offline', onNet);
  window.addEventListener('fale:ai-state', onNet);
  el._dispose = () => { window.removeEventListener('online', onNet); window.removeEventListener('offline', onNet); window.removeEventListener('fale:ai-state', onNet); qw._dispose && qw._dispose(); };
  refresh();
  return { el, refresh, state: () => state };
}

/** Library picker for documents with text. onPick(doc). */
export async function docPicker({ onPick, kinds = TEXT_KINDS, title = 'Dokument wählen', hint = '' } = {}) {
  const docs = (await db.listFiles()).filter(d => kinds.includes(kindOf(d)));
  const wrap = h(`<section class="ai-picker">${title ? `<h2 class="section-title">${esc(title)}</h2>` : ''}${hint ? `<p class="muted small">${esc(hint)}</p>` : ''}<div class="doc-list ai-doclist"></div>
    <button class="btn btn-ghost" type="button" data-import>${oicon('upload')} Datei vom Gerät öffnen</button></section>`);
  const list = $('.ai-doclist', wrap);
  if (!docs.length) list.appendChild(h('<p class="panel-empty">Noch keine passenden Dateien. Öffne eine PDF, ein Word-Dokument oder eine Präsentation.</p>'));
  docs.slice(0, 60).forEach(d => {
    const b = h(`<button class="doc doc-open" type="button" data-id="${esc(d.id)}">${thumbHtml(d)}<span class="doc-info"><span class="doc-name">${esc(d.name)}</span><span class="doc-meta">${docMeta(d)}</span></span></button>`);
    b.addEventListener('click', () => onPick(d));
    list.appendChild(b);
  });
  $('[data-import]', wrap).addEventListener('click', async () => {
    const { pickFiles } = await import('../ui.js');
    const { importFiles } = await import('../library.js');
    const files = await pickFiles({ accept: '.pdf,.docx,.txt,.md,.pptx,.xlsx,.csv,application/pdf', multiple: false });
    if (!files.length) return;
    const added = await importFiles(files, { source: 'Gerät', any: true });
    if (added[0]) setTimeout(() => onPick(added[0]), 300); // let the text index start
  });
  return wrap;
}

/** Small "selected document" chip with a change button. */
export function docChip(doc, onChange) {
  const el = h(`<div class="ai-docchip">${thumbHtml(doc)}<span class="doc-info"><span class="doc-name">${esc(doc.name)}</span><span class="doc-meta">${docMeta(doc)}</span></span>
    ${onChange ? `<button class="btn btn-ghost btn-sm" type="button">${oicon('edit')} Ändern</button>` : ''}</div>`);
  if (onChange) $('button', el).addEventListener('click', onChange);
  return el;
}

export async function getDoc(id) { return id ? db.getDoc(id).catch(() => null) : null; }

/** Disable/enable the main action buttons of a screen depending on the status card state. */
export function gate(buttons, state) {
  const ready = state.kind === 'ready' || state.kind === 'needs_consent';
  buttons.forEach(b => { if (b) { b.disabled = !ready; b.title = ready ? '' : 'Cloud-KI ist gerade nicht verfügbar'; } });
}
