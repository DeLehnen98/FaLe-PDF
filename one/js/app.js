// FaLe One – app entry: start-up (account → key → engine), app shell, router, global status.
import { el, clear, icon, logo, toast, errorToast } from './dom.js';
import { initLang, t, tp, fmtSize, ago, fmtNum } from './i18n.js';
import * as A from './auth.js';
import * as Keys from './keys.js';
import * as E from './engine.js';
import { apiBase } from './config.js';
import { takeInbox } from './idb.js';

initLang();
const root = document.getElementById('root');
const views = {
  fotos: () => import('./views/fotos.js'),
  drive: () => import('./views/drive.js'),
  suche: () => import('./views/search.js'),
  einstellungen: () => import('./views/settings.js'),
  notfall: () => import('./views/notfall.js'),
};
let shell = null, current = null, currentKey = '';

// ---------------------------------------------------------------- service worker (app shell offline)
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
}

// ---------------------------------------------------------------- start-up
async function driveConfigured() {
  try {
    const r = await fetch(`${apiBase()}/api/drive?a=config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
    const j = await r.json();
    try { localStorage.setItem('fale-one-cfg', JSON.stringify({ configured: !!j.configured, at: Date.now() })); } catch {}
    return !!(r.ok && j.configured);
  } catch {
    try { const c = JSON.parse(localStorage.getItem('fale-one-cfg') || 'null'); if (c) return c.configured; } catch {}
    return null; // unknown (offline, first start)
  }
}

export async function boot() {
  const signedIn = A.maybeSignedIn() && await A.currentUser();
  if (!signedIn) {
    const configured = await driveConfigured();
    return gate(configured === false ? 'unavailable' : 'welcome');
  }
  const lk = await Keys.localKey();
  if (!lk) return gate('key');
  await startApp(lk);
}

async function gate(step, opts) {
  E.stop();
  shell = null; current = null; currentKey = '';
  clear(root);
  const m = await import('./views/onboarding.js');
  m.mount(root, { step, ...opts, done: async () => { const lk = await Keys.localKey(); if (lk) await startApp(lk); else boot(); } });
}
export { gate };

async function startApp(lk) {
  const s = await A.session();
  try {
    await E.start({ userId: s.user.id, mk: lk.key, deviceId: s.device, deviceName: s.deviceName || A.defaultDeviceName() });
  } catch (e) {
    console.error(e);
    clear(root).appendChild(el('div.fatal', el('p', t('FaLe One konnte nicht starten. Bitte lade die Seite neu.'))));
    return;
  }
  buildShell();
  route();
  const firstSync = async () => {
    await E.syncNow();
    if (E.state.syncError && E.state.syncError.status === 401) { await A.localSignOut('expired'); return gate('welcome'); }
    await Promise.all([E.refreshQuota(), E.refreshBackup(), E.refreshOffline(), E.refreshEm()]);
  };
  firstSync().then(() => checkKeyStillValid()).catch(() => {});
  A.touchDevice().catch(() => {});
  setupTimers();
  handleShared();
}

/** Another device may have reset the account key (new Sync-Passwort after data loss): then ask again. */
async function checkKeyStillValid() {
  if (!navigator.onLine) return;
  try {
    const v = await Keys.verifyLocal();
    if (v === 'changed') { await Keys.forgetLocalKey(); toast(t('Der Schlüssel deines Kontos wurde geändert. Bitte entsperre FaLe One erneut.'), { kind: 'info' }); gate('key'); }
  } catch {}
}

let timersSet = false;
function setupTimers() {
  if (timersSet) return;
  timersSet = true;
  setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine && E.state.started) E.syncNow(); }, 45000);
  setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine && E.state.started) { E.refreshQuota(); E.refreshBackup(); E.refreshEm(); } }, 180000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && navigator.onLine && E.state.started) { E.syncNow(); E.refreshBackup(); E.refreshEm(); } });
  window.addEventListener('online', () => { if (!E.state.started) return; E.call('online').catch(() => {}); E.syncNow().then(() => E.refreshQuota()); renderStatus(); });
  window.addEventListener('offline', () => renderStatus());
  A.onAccountChange(d => { if (!d.signedIn) gate(d.reason === 'deleted' ? 'deleted' : 'welcome'); });
}

async function handleShared() {
  const p = new URLSearchParams(location.search);
  if (!p.has('shared')) return;
  history.replaceState(null, '', location.pathname + location.hash);
  let files = [];
  try { files = await takeInbox(); } catch {}
  if (!files.length) { toast(t('Es kamen keine Dateien an.'), { kind: 'info' }); return; }
  const m = await import('./views/uploads.js');
  m.sharedFilesDialog(files);
}

// ---------------------------------------------------------------- shell
const NAV = [
  { key: 'fotos', href: '#/fotos', icon: 'photos', label: () => t('Fotos') },
  { key: 'drive', href: '#/drive', icon: 'drive', label: () => t('Drive') },
];
function buildShell() {
  clear(root);
  const side = el('aside.side', { aria: { label: t('Hauptnavigation') } },
    el('a.brand', { href: '#/fotos', aria: { label: t('FaLe One – Start') } }, logo(30), el('span.brand-name', 'FaLe ', el('b', 'One'))),
    el('nav.side-nav',
      NAV.map(n => el('a.nav-link', { href: n.href, data: { nav: n.key } }, icon(n.icon), el('span', n.label()))),
      el('div.side-sub', { data: { sub: 'fotos' } },
        el('a.sub-link', { href: '#/fotos/alben', data: { nav: 'fotos/alben' } }, icon('album'), el('span', t('Alben'))),
        el('a.sub-link', { href: '#/fotos/favoriten', data: { nav: 'fotos/favoriten' } }, icon('star'), el('span', t('Favoriten'))),
        el('a.sub-link', { href: '#/fotos/duplikate', data: { nav: 'fotos/duplikate' } }, icon('dup'), el('span', t('Duplikate')))),
      el('div.side-sub', { data: { sub: 'drive' } },
        el('a.sub-link', { href: '#/drive/offline', data: { nav: 'drive/offline' } }, icon('offline'), el('span', t('Offline verfügbar'))),
        el('a.sub-link', { href: '#/drive/papierkorb', data: { nav: 'drive/papierkorb' } }, icon('trash'), el('span', t('Papierkorb')))),
      el('a.nav-link', { href: '#/notfall', data: { nav: 'notfall' } }, icon('shield'), el('span', t('Notfallzugang'))),
      el('a.nav-link', { href: '#/einstellungen', data: { nav: 'einstellungen' } }, icon('settings'), el('span', t('Einstellungen')))),
    el('div.side-quota', { data: { quota: 'side' } }),
    el('p.side-foot', icon('lock'), el('span', t('Ende-zu-Ende-verschlüsselt. Nur deine Geräte können deine Dateien lesen.')))
  );
  const header = el('header.bar',
    el('a.brand.bar-brand', { href: '#/fotos', aria: { label: t('FaLe One – Start') } }, logo(28), el('span.brand-name', 'FaLe ', el('b', 'One'))),
    el('h1.bar-title', { data: { title: '' } }),
    el('div.bar-spacer'),
    el('button.chip.status-chip', { type: 'button', data: { status: '' }, onclick: () => openUploads() }),
    el('a.icon-btn', { href: '#/suche', aria: { label: t('Suchen') }, title: t('Suchen') }, icon('search')),
    el('button.icon-btn.up-btn', { type: 'button', aria: { label: t('Uploads') }, title: t('Uploads'), onclick: () => openUploads() }, icon('cloudUp'), el('span.badge', { hidden: true, data: { badge: '' } })),
    el('a.icon-btn.avatar-btn', { href: '#/einstellungen', aria: { label: t('Einstellungen und Konto') }, title: t('Einstellungen') }, el('span.avatar', { data: { avatar: '' } }))
  );
  const main = el('main#main.main', { tabindex: '-1' });
  const bnav = el('nav.bnav', { aria: { label: t('Navigation') } }, NAV.map(n => el('a.bnav-item', { href: n.href, data: { nav: n.key } }, icon(n.icon), el('span', n.label()))));
  const col = el('div.col', header, el('div.notices', { data: { notices: '' }, role: 'region', aria: { label: t('Hinweise') } }), main, bnav);
  root.appendChild(el('a.skip', { href: '#main' }, t('Zum Inhalt springen')));
  root.appendChild(el('div.app', side, col));
  shell = { side, header, main, bnav };
  A.currentUser().then(u => { const a = root.querySelector('[data-avatar]'); if (a && u) a.textContent = (u.email || '?').slice(0, 1).toUpperCase(); });
  E.subscribe(what => {
    if (what.has('quota') || what.has('backup') || what.has('jobs') || what.has('sync') || what.has('nodes') || what.has('em')) renderStatus();
    if (current && current.update) current.update(what);
  });
  renderStatus();
}

// ---------------------------------------------------------------- status: chip, quota, notices
export function quotaWidget() {
  const q = E.state.quota;
  const box = el('div.quota');
  if (!q) return box;
  const p = q.quota ? Math.min(1, q.used / q.quota) : 0;
  const bar = el('span.qbar' + (p >= 1 ? '.full' : p >= 0.8 ? '.warn' : ''), el('span.qbar-fill'));
  bar.firstChild.style.width = (p * 100).toFixed(1) + '%';
  bar.setAttribute('role', 'meter'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(Math.round(p * 100)));
  bar.setAttribute('aria-label', t('Speicher belegt'));
  box.append(el('span.quota-text', t('{used} von {total}', { used: fmtSize(q.used), total: fmtSize(q.quota) })), bar);
  return box;
}
/** Phone: status chip + quota under the header (desktop shows both in the header / sidebar). */
export function homeStatus() {
  return el('div', el('div.home-status', el('button.chip.status-chip.show', { type: 'button', data: { status: '' }, onclick: () => openUploads() }), el('div', { data: { quota: 'home' } }, quotaWidget())), emHomeCard());
}
function myDevice() { const b = E.state.backup; return b && b.devices ? b.devices.find(d => d.self) : null; }
export function statusText() {
  if (!navigator.onLine) return { text: t('Offline'), icon: 'cloudOff', kind: 'off' };
  const jobs = [...E.state.jobs.values()];
  const active = jobs.filter(j => ['waiting', 'hashing', 'queued', 'uploading', 'committing'].includes(j.state));
  if (active.length) {
    const done = jobs.filter(j => j.batch && (j.state === 'done' || j.state === 'skipped')).length;
    return { text: t('Sichert … {n} offen', { n: fmtNum(active.length) }) + (done ? ' · ' + t('{n} fertig', { n: fmtNum(done) }) : ''), icon: 'cloudUp', kind: 'busy' };
  }
  if (jobs.some(j => j.state === 'error')) return { text: t('Upload unterbrochen'), icon: 'warning', kind: 'warn' };
  const d = myDevice();
  if (d && d.lastSuccessAt) return { text: t('Zuletzt gesichert: {when}', { when: ago(d.lastSuccessAt) }), icon: 'cloudCheck', kind: 'ok' };
  if (E.state.syncing && !E.state.lastSync) return { text: t('Synchronisiert …'), icon: 'refresh', kind: 'busy' };
  if (E.state.lastSync) return { text: t('Synchronisiert {when}', { when: ago(E.state.lastSync) }), icon: 'cloudCheck', kind: 'ok' };
  return { text: t('Noch nicht gesichert'), icon: 'cloudUp', kind: 'idle' };
}
function dismissed(k) { try { return localStorage.getItem('fale-one-dismiss-' + k) === '1'; } catch { return false; } }
function dismiss(k) { try { localStorage.setItem('fale-one-dismiss-' + k, '1'); } catch {} }
function renderStatus() {
  if (!shell) return;
  const st = statusText();
  for (const chip of root.querySelectorAll('[data-status]')) { clear(chip).append(icon(st.icon), el('span', st.text)); chip.dataset.kind = st.kind; chip.setAttribute('aria-label', st.text + ' – ' + t('Uploads anzeigen')); }
  const active = [...E.state.jobs.values()].filter(j => !['done', 'skipped'].includes(j.state)).length;
  const badge = root.querySelector('[data-badge]');
  if (badge) { badge.hidden = !active; badge.textContent = active > 99 ? '99+' : String(active); }
  const app = root.querySelector('.app');
  if (app) { app.dataset.jobs = String(active); app.dataset.synced = String(E.state.lastSync || 0); }
  for (const q of root.querySelectorAll('[data-quota]')) clear(q).append(quotaWidget());
  for (const c of root.querySelectorAll('[data-emcard]')) c.replaceWith(emHomeCard());
  // notices: offline, quota 80 % / 100 % (read-only, never deletes), stale backup devices
  const box = root.querySelector('[data-notices]');
  if (!box) return;
  clear(box);
  const q = E.state.quota;
  if (!navigator.onLine) box.append(notice('cloudOff', t('Du bist offline. Du siehst, was auf diesem Gerät gespeichert ist; Änderungen gehen, sobald du wieder online bist.'), 'off'));
  if (q && q.readOnly) box.append(notice('warning', t('Speicher voll – alles bleibt lesbar. Lösche etwas, leere den Papierkorb oder exportiere deine Daten. Gelöscht wird nichts automatisch.'), 'warn', { label: t('Papierkorb'), href: '#/drive/papierkorb' }));
  else if (q && q.quota && q.used / q.quota >= 0.8 && !dismissed('q80')) box.append(notice('info', t('Dein Speicher ist zu {p} % belegt ({used} von {total}).', { p: Math.floor(q.used / q.quota * 100), used: fmtSize(q.used), total: fmtSize(q.quota) }), 'info', null, 'q80'));
  emNotices(box);
  const b = E.state.backup;
  if (b && b.devices) for (const d of b.devices.filter(x => x.stale)) {
    const name = (d.meta && d.meta.name) || t('Ein Gerät');
    const k = 'stale-' + d.deviceId + '-' + (d.lastSuccessAt || d.createdAt || '').slice(0, 10);
    if (!dismissed(k)) box.append(notice('warning', d.lastSuccessAt ? t('{name}: letzte erfolgreiche Sicherung {when}. Öffne FaLe One dort, damit neue Fotos gesichert werden.', { name, when: ago(d.lastSuccessAt) }) : t('{name}: noch keine erfolgreiche Sicherung.', { name }), 'warn', null, k));
  }
}
// ---------------------------------------------------------------- Notfallzugang: banners + home card
const waitLabel = h => (h === 24 ? t('24 Stunden') : tp(h / 24, '{n} Tag', '{n} Tage'));
export { waitLabel };
/** "noch 6 Tage 23 Std." until an ISO time (server clock offset applied) */
export function countdown(iso, serverNow) {
  const skew = serverNow ? Date.parse(serverNow) - Date.now() : 0;
  const ms = Math.max(0, Date.parse(iso) - (Date.now() + skew));
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.max(1, Math.ceil((ms % 36e5) / 6e4));
  if (d) return t('{d} T {h} Std.', { d, h });
  if (h) return t('{h} Std. {m} Min.', { h, m: Math.floor((ms % 36e5) / 6e4) });
  return t('{m} Min.', { m });
}
function emNotices(box) {
  const st = E.state.em;
  if (!st) return;
  const o = st.own;
  if (o && o.request && o.request.status === 'waiting') {
    const who = o.request.requesters.map(q => (o.contacts.find(c => c.slot === q.slot) || {}).email).filter(Boolean).join(', ');
    const txt = o.request.releaseAt
      ? t('{who} hat Zugang zu deinem Notfallzugang angefragt. Freigabe in {left}, wenn du nicht ablehnst.', { who, left: countdown(o.request.releaseAt, o.request.now) })
      : t('{who} hat Zugang angefragt ({n} von {k} Personen nötig).', { who, n: o.request.requesters.length, k: o.request.threshold });
    const n = el('div.notice.urgent', { role: 'alert', data: { emAlert: 'request' } }, icon('warning'), el('p', txt),
      el('div.notice-acts', el('a.btn.ghost.sm', { href: '#/notfall' }, t('Details')),
        el('button.btn.danger-solid.sm', { type: 'button', onclick: async () => { try { E.setEm(await E.call('emDeny')); toast(t('Anfrage abgelehnt. Es wurde nichts freigegeben.')); } catch (e) { errorToast(e); } } }, t('Ablehnen'))));
    box.append(n);
  } else if (o && o.request && o.request.status === 'released') {
    box.append(el('div.notice.warn', { data: { emAlert: 'released' } }, icon('shield'), el('p', t('Dein Notfallzugang ist freigegeben. Du kannst ihn jederzeit widerrufen.')), el('a.btn.ghost.sm', { href: '#/notfall' }, t('Ansehen'))));
  }
  if (o) for (const c of o.contacts.filter(x => x.status === 'accepted')) {
    const k = 'em-acc-' + c.slot + '-' + (c.acceptedAt || '').slice(0, 16);
    if (!dismissed(k)) box.append(notice('shield', t('{email} hat angenommen. Vergleicht jetzt den Sicherheitscode, damit der Notfallzugang aktiv wird.', { email: c.email }), 'info', { label: t('Code vergleichen'), href: '#/notfall' }, k));
  }
  for (const x of st.others || []) {
    if (x.status === 'invited') {
      const k = 'em-inv-' + x.setupId;
      if (!dismissed(k)) box.append(notice('shield', t('{email} möchte dich als Vertrauensperson für den Notfall.', { email: x.ownerEmail }), 'info', { label: t('Ansehen'), href: '#/notfall/fuer-andere' }, k));
    } else if (x.readable) {
      const k = 'em-rel-' + x.setupId + '-' + ((x.request && x.request.releasedAt) || '').slice(0, 16);
      if (!dismissed(k)) box.append(notice('shield', t('Der Notfallzugang von {email} ist freigegeben.', { email: x.ownerEmail }), 'info', { label: t('Öffnen'), href: '#/notfall/zugang/' + x.setupId }, k));
    }
  }
}
/** Calm one-line card for the start views: only when there is something to show. */
export function emHomeCard() {
  const st = E.state.em;
  const holder = el('div', { data: { emcard: '' }, hidden: true });
  if (!st) return holder;
  const o = st.own;
  const active = o ? o.contacts.filter(c => c.status === 'active').length : 0;
  let text = null, sub = null, href = '#/notfall', kind = 'ok';
  if (o) {
    if (active && active >= o.setup.threshold) {
      text = t('Notfallzugang aktiv');
      sub = [tp(active, '{n} Person', '{n} Personen'), o.setup.threshold > 1 ? t('{k} von {n} nötig', { k: o.setup.threshold, n: active }) : null, t('{w} Wartezeit', { w: waitLabel(o.setup.waitHours) })].filter(Boolean).join(' · ');
    } else { text = t('Notfallzugang fast fertig'); sub = t('Vertrauensperson bestätigen'); kind = 'todo'; }
  } else if ((st.others || []).some(x => x.status !== 'invited')) {
    const n = st.others.filter(x => x.status !== 'invited').length;
    text = t('Für andere da'); sub = tp(n, 'Vertrauensperson für {n} Person', 'Vertrauensperson für {n} Personen'); href = '#/notfall/fuer-andere';
  }
  if (!text) return holder;
  return el('a.em-card' + (kind === 'todo' ? '.todo' : ''), { href, data: { emcard: '' } }, el('span.em-card-ic', icon('shield')), el('span.em-card-text', el('strong', text), el('span', sub)), icon('chevronRight'));
}
function notice(ic, text, kind, link, dismissKey) {
  const n = el('div.notice.' + kind, icon(ic), el('p', text), link ? el('a.btn.ghost.sm', { href: link.href }, link.label) : null);
  if (dismissKey) n.append(el('button.icon-btn.sm', { type: 'button', aria: { label: t('Hinweis ausblenden') }, onclick: () => { dismiss(dismissKey); n.remove(); } }, icon('close')));
  return n;
}
async function openUploads() { (await import('./views/uploads.js')).openSheet(); }

// ---------------------------------------------------------------- router
export function setTitle(s) {
  const h = root.querySelector('[data-title]');
  if (h) h.textContent = s || '';
  document.title = s ? `${s} · FaLe One` : 'FaLe One';
}
async function route() {
  if (!shell) return;
  const hash = location.hash.replace(/^#\/?/, '') || 'fotos';
  const [pathPart, query] = hash.split('?');
  const parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  const key = views[parts[0]] ? parts[0] : 'fotos';
  const params = new URLSearchParams(query || '');
  for (const a of root.querySelectorAll('[data-nav]')) {
    const nav = a.dataset.nav;
    const on = nav.includes('/') ? pathPart.startsWith(nav) : nav === key && !(key === 'fotos' && /^fotos\/(alben|album|favoriten|duplikate)/.test(pathPart)) && !(key === 'drive' && /^drive\/(offline|papierkorb)/.test(pathPart));
    const sectionOn = nav === key;
    a.classList.toggle('on', on);
    if (sectionOn) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  for (const s of root.querySelectorAll('[data-sub]')) s.hidden = s.dataset.sub !== key;
  root.querySelector('.app').dataset.section = key;
  const viewKey = key + ':' + parts.slice(1).join('/') + '?' + (query || '');
  if (viewKey === currentKey) return;
  const mod = await views[key]();
  if (current && current.destroy) current.destroy();
  clear(shell.main);
  currentKey = viewKey;
  current = await mod.mount(shell.main, { parts: parts.slice(1), params, setTitle });
  renderStatus();
  shell.main.scrollTop = 0;
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#v=')) route(); });
export function rerender() { currentKey = ''; route(); }

boot().catch(e => { console.error(e); errorToast(e); });
