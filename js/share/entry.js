// Small, network-free entry points for "Teilen & Übertragen" (start page, Werkzeuge, menus).
import { h, esc } from '../ui.js';
import { loadShareCss, sicon } from './common.js';

export const SHARE_FEATURES = [
  { id: 'link', title: 'Sicher teilen', desc: 'Ende-zu-Ende-verschlüsselter Link – läuft automatisch ab, auf Wunsch mit Passwort.', icon: 'shareLock', href: '#/teilen/link' },
  { id: 'sign', title: 'Unterschrift anfordern', desc: 'PDF per Link unterschreiben lassen – ohne Konto, mit Protokollseite.', icon: 'signReq', href: '#/teilen/unterschrift' },
  { id: 'request', title: 'Unterlagen anfordern', desc: 'Link senden – andere laden Dateien verschlüsselt bei dir hoch. Ohne Konto.', icon: 'inbox', href: '#/teilen/anfordern' },
  { id: 'connect', title: 'Geräte verbinden', desc: 'Dateien zwischen Handy und PC übertragen – per QR-Code oder Code.', icon: 'devices', href: '#/verbinden' },
];

/** Card on the start page. */
export function renderStartCard(box) {
  if (!box) return;
  loadShareCss();
  box.hidden = false;
  box.innerHTML = '';
  const card = h(`<div class="card sh-start-card">
    <a class="sh-start-main" href="#/teilen"><span class="sh-start-ic">${sicon('shareLock')}</span>
      <span class="sh-start-text"><strong>Teilen &amp; Übertragen</strong><span>Verschlüsselte Links, Unterschriften und Unterlagen anfordern, Handy ↔ PC</span></span></a>
    <div class="sh-start-acts">
      ${SHARE_FEATURES.map(f => `<a class="sh-start-act" href="${f.href}" data-share-entry="${f.id}">${sicon(f.icon)}<span>${esc(f.title)}</span></a>`).join('')}
    </div></div>`);
  box.appendChild(card);
}

/** "Teilen & Unterschreiben" section on the Werkzeuge page. */
export function renderToolSection(sec) {
  if (!sec || sec.dataset.filled) return;
  loadShareCss();
  sec.dataset.filled = '1';
  sec.hidden = false;
  sec.innerHTML = `<h2 class="section-title">Teilen &amp; Unterschreiben <a class="btn btn-sm btn-ghost" href="#/teilen">${sicon('link')} Meine Links</a></h2><div class="tool-grid sh-grid"></div>
    <p class="muted small sh-tools-note">${sicon('shield')}<span>Ende-zu-Ende-verschlüsselt: Der Schlüssel steht nur im Link, unser Server sieht keine Inhalte. Braucht eine Internetverbindung.</span></p>`;
  const grid = sec.querySelector('.sh-grid');
  SHARE_FEATURES.forEach(f => grid.appendChild(h(`<a class="tool-card" href="${f.href}" data-tool="share-${f.id}"><span class="tile-ic sh-ic">${sicon(f.icon)}</span><span class="tc-text"><h3>${esc(f.title)}</h3><p>${esc(f.desc)}</p></span></a>`)));
}

/** Menu items for a library document (Dateien ⋮ / long-press and viewer ⋮). */
export function shareMenuItems(doc, { pdf = true } = {}) {
  const items = [{ label: 'Sicher teilen (Link)', icon: 'link', onClick: () => { location.hash = `#/teilen/link?doc=${encodeURIComponent(doc.id)}`; } }];
  if (pdf) items.push({ label: 'Unterschrift anfordern', icon: 'sign', onClick: () => { location.hash = `#/teilen/unterschrift?doc=${encodeURIComponent(doc.id)}`; } });
  return items;
}
