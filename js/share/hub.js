// Overview "Teilen & Übertragen": entry cards + the links and signature requests created on this device.
import { t } from '../i18n/index.js';
import { h, esc, toast } from '../ui.js';
import { oicon } from '../office/kinds.js';
import { SHARE_FEATURES } from './entry.js';
import { listEntries, removeEntry, patchEntry, isExpired } from './registry.js';
import { shareApi, signApi, online } from './api.js';
import { offlineBanner, e2eNote, expiryLabel, statusPill, copyToClipboard, shareText, sicon, fmtDateTime } from './common.js';
import { revokeShare } from './create.js';

export async function mount(screen) {
  const wrap = h(`<div class="screen-inner sh-hub">
    <div class="sh-hero card">${sicon('shareLock')}<div><strong>Teilen, ohne die Kontrolle abzugeben</strong>
      <p>Links sind Ende-zu-Ende-verschlüsselt und laufen automatisch ab. Unser Server sieht weder Inhalt noch Dateinamen.</p></div></div>
    <div data-off></div>
    <div class="tool-grid sh-grid sh-hub-grid"></div>
    <h2 class="section-title">Meine Links <button class="btn btn-sm btn-ghost" type="button" data-refresh>${oicon('undo')} Aktualisieren</button></h2>
    <div class="sh-list" data-links></div>
    <h2 class="section-title">Unterschriftsanfragen</h2>
    <div class="sh-list" data-reqs></div>
    <div data-note></div>
    <p class="muted small sh-local-note">${oicon('info')}<span>Diese Liste wird nur auf diesem Gerät gespeichert. Die Links enthalten den Schlüssel – gib dieses Gerät nicht unbeaufsichtigt weiter.</span></p>
  </div>`);
  screen.body.appendChild(wrap);
  const off = offlineBanner(on => { wrap.querySelectorAll('[data-net]').forEach(b => { b.disabled = !on; }); });
  wrap.querySelector('[data-off]').appendChild(off.el);
  const grid = wrap.querySelector('.sh-hub-grid');
  SHARE_FEATURES.forEach(f => grid.appendChild(h(`<a class="tool-card" href="${f.href}" data-tool="share-${f.id}"><span class="tile-ic sh-ic">${sicon(f.icon)}</span><span class="tc-text"><h3>${esc(f.title)}</h3><p>${esc(f.desc)}</p></span></a>`)));
  wrap.querySelector('[data-note]').appendChild(e2eNote());
  wrap.querySelector('[data-refresh]').addEventListener('click', () => render(true));

  async function render(fetchStatus = true) {
    renderLinks(fetchStatus);
    renderRequests(fetchStatus);
  }

  function renderLinks(fetchStatus) {
    const box = wrap.querySelector('[data-links]');
    box.innerHTML = '';
    const list = listEntries('file');
    if (!list.length) { box.appendChild(h(`<p class="panel-empty">Noch keine Links. Tippe auf „Sicher teilen“, um eine Datei verschlüsselt zu teilen.</p>`)); return; }
    list.forEach(e => {
      const exp = isExpired(e);
      const row = h(`<article class="card sh-row" data-share-id="${esc(e.id)}">
        <span class="sh-row-ic">${oicon(e.pw ? 'lock' : 'link')}</span>
        <div class="sh-row-main"><strong data-no-i18n>${esc(e.name)}</strong>
          <span class="muted small" data-meta>${exp ? 'Abgelaufen' : esc(linkMeta(e))}</span></div>
        <span data-pill>${statusPill(exp ? 'expired' : e.maxDownloads && e.downloads >= e.maxDownloads ? 'exhausted' : 'active')}</span>
        <div class="sh-row-acts">
          ${exp ? '' : `<button class="icon-btn" type="button" data-copy aria-label="Link kopieren">${oicon('copy')}</button><button class="icon-btn" type="button" data-share aria-label="Link teilen">${oicon('share')}</button>`}
          <button class="icon-btn" type="button" data-del data-net aria-label="${exp ? 'Aus der Liste entfernen' : 'Link löschen'}">${oicon('trash')}</button>
        </div></article>`);
      const cp = row.querySelector('[data-copy]'); if (cp) cp.addEventListener('click', () => copyToClipboard(e.url));
      const sh = row.querySelector('[data-share]'); if (sh) sh.addEventListener('click', () => shareText({ title: e.name, text: t(`Ich habe dir „${e.name}“ sicher geteilt:`), url: e.url }));
      row.querySelector('[data-del]').addEventListener('click', async () => {
        if (exp) { removeEntry(e.id); row.remove(); return; }
        if (await revokeShare(e)) row.remove();
      });
      box.appendChild(row);
      if (!exp && fetchStatus && online()) {
        shareApi.status(e.id, e.auth).then(r => {
          const meta = row.querySelector('[data-meta]'), pill = row.querySelector('[data-pill]');
          if (!r.exists) { pill.innerHTML = statusPill('deleted'); meta.textContent = 'Nicht mehr auf dem Server (abgelaufen oder gelöscht)'; patchEntry(e.id, { expiresAt: new Date().toISOString() }); return; }
          const o = r.object;
          if (o.downloads !== e.downloads) patchEntry(e.id, { downloads: o.downloads, maxDownloads: o.maxDownloads, expiresAt: o.expiresAt }); // re-renders
        }).catch(() => {});
      }
    });
  }

  function renderRequests(fetchStatus) {
    const box = wrap.querySelector('[data-reqs]');
    box.innerHTML = '';
    const list = listEntries('sign');
    if (!list.length) { box.appendChild(h(`<p class="panel-empty">Noch keine Anfragen. Öffne eine PDF und wähle ⋮ → „Unterschrift anfordern“.</p>`)); return; }
    list.forEach(e => {
      const exp = isExpired(e);
      const row = h(`<a class="card sh-row sh-row-link" href="#/teilen/anfrage/${esc(e.id)}" data-req-id="${esc(e.id)}">
        <span class="sh-row-ic">${sicon('signReq')}</span>
        <div class="sh-row-main"><strong data-no-i18n>${esc(e.name)}</strong>
          <span class="muted small">${(e.signers || []).map(s => esc(s.name)).join(', ')} · ${exp ? 'Abgelaufen' : esc(expiryLabel(e.expiresAt))}</span></div>
        <span data-pill>${statusPill(exp ? 'expired' : summary(e.lastStatus))}</span>
        <span class="sh-row-go">${oicon('chevronRight')}</span></a>`);
      box.appendChild(row);
      if (!exp && fetchStatus && online()) {
        signApi.status(e.id, e.auth).then(r => {
          const st = r.exists ? r.signers.map(s => s.status) : ['expired'];
          patchEntry(e.id, { lastStatus: st, lastCheck: Date.now() });
          row.querySelector('[data-pill]').innerHTML = statusPill(r.exists ? summary(st) : 'expired');
        }).catch(() => {});
      }
    });
  }

  const onChange = () => render(false);
  window.addEventListener('fale:shares-changed', onChange);
  render(true);
  return () => { off.destroy(); window.removeEventListener('fale:shares-changed', onChange); };
}

function linkMeta(e) {
  const dl = e.downloads == null ? (e.maxDownloads ? `max. ${e.maxDownloads}× herunterladbar` : 'beliebig oft herunterladbar')
    : e.maxDownloads ? `${e.downloads} von ${e.maxDownloads} Downloads` : `${e.downloads} Download${e.downloads === 1 ? '' : 's'}`;
  return `${expiryLabel(e.expiresAt)} · ${dl}`;
}

/** One status for a whole request: signed when everybody signed, otherwise the "lowest" one. */
export function summary(st) {
  if (!Array.isArray(st) || !st.length) return 'open';
  if (st.includes('expired')) return 'expired';
  if (st.every(s => s === 'signed')) return 'signed';
  if (st.some(s => s === 'viewed' || s === 'signed')) return 'viewed';
  return 'open';
}
void toast; void fmtDateTime;
