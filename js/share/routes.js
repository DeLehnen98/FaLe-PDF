// Routing for "Teilen & Übertragen":
//   #/teilen                       overview (my links + signature requests)
//   #/teilen/link[?doc=<id>]       create an encrypted share link
//   #/teilen/unterschrift[?doc=]   request a signature (place fields, create links)
//   #/teilen/anfrage/<id>          status of one signature request
//   #/teilen/mitnehmen#d=<data>    take a signature request over to another device (asks first)
//   #/s/<id>#k=<key>               recipient view (any browser, no install)
//   #/u/<token>#k=<key>            signer view (any browser, no install, no account)
//   #/verbinden[?r=<room>&s=<secret>]  connect devices / transfer files
import { openScreen } from '../screen.js';
import { errorToast, esc } from '../ui.js';
import { oicon } from '../office/kinds.js';
import { loadShareCss } from './common.js';

export const SHARE_ROUTES = ['teilen', 's', 'u', 'verbinden'];

const SCREENS = {
  hub: { title: 'Teilen & Übertragen', sub: 'Ende-zu-Ende-verschlüsselt – ohne Konto', load: () => import('./hub.js') },
  link: { title: 'Sicher teilen', sub: 'Verschlüsselter Link mit Ablaufdatum', load: () => import('./create.js') },
  unterschrift: { title: 'Unterschrift anfordern', sub: 'Felder setzen, Link senden, unterschriebenes PDF zurückbekommen', load: () => import('./signreq.js') },
  anfrage: { title: 'Unterschriftsanfrage', sub: 'Status und unterschriebenes Dokument', load: () => import('./signreq.js').then(m => ({ mount: m.mountStatus })) },
  mitnehmen: { title: 'Anfrage übernehmen', sub: 'Unterschriftsanfrage auf diesem Gerät ansehen', load: () => import('./signreq.js').then(m => ({ mount: m.mountImport })) },
  s: { title: 'Geteilte Datei', sub: 'Ende-zu-Ende-verschlüsselt mit FaLe PDF', load: () => import('./receive.js') },
  u: { title: 'Unterschreiben', sub: 'Dokument ansehen und elektronisch unterschreiben', load: () => import('./signer.js') },
  verbinden: { title: 'Geräte verbinden', sub: 'Dateien zwischen Handy und PC übertragen', load: () => import('./transfer.js') },
};

function keyOf(parts) {
  if (parts[0] === 'teilen') { const sub = String(parts[1] || '').split('#')[0]; return sub && SCREENS[sub] ? sub : 'hub'; }
  return parts[0];
}

export async function openShareRoute(parts, params, { goBack }) {
  loadShareCss();
  const key = keyOf(parts);
  const conf = SCREENS[key];
  if (!conf) { location.replace('#/teilen'); return; }
  const screen = openScreen({ title: conf.title, sub: conf.sub, onBack: () => (screen.onBackRequest ? screen.onBackRequest(goBack) : goBack()) });
  const cls = ['share-screen', `share-route-${key}`];
  screen.root.classList.add(...cls);
  screen.hashKey = location.hash;
  screen.body.innerHTML = '<div class="v-loading"><div><span class="spinner dark" style="width:30px;height:30px"></span><span>Wird geladen …</span></div></div>';
  try {
    const mod = await conf.load();
    if (screen.signal.aborted) return;
    screen.body.innerHTML = '';
    // id/token without a trailing "#k=…" fragment
    const arg = (key === 's' || key === 'u') ? String(parts[1] || '').split('#')[0] : key === 'anfrage' ? parts[2] : null;
    const cleanup = await mod.mount(screen, { parts, params, goBack, arg, hash: location.hash });
    screen.cleanup = () => { try { if (typeof cleanup === 'function') cleanup(); } finally { screen.root.classList.remove(...cls); } };
  } catch (e) {
    screen.root.classList.remove(...cls);
    if (screen.signal.aborted) return;
    errorToast(e, 'Diese Ansicht konnte nicht geöffnet werden.');
    screen.body.innerHTML = `<div class="screen-inner"><div class="empty"><div class="empty-art">${oicon('info')}</div><h3>Das hat nicht geklappt</h3><p>${esc(e && e.userMessage ? e.userMessage : 'Bitte versuche es erneut.')}</p></div></div>`;
  }
}
