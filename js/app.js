// FaLe PDF — app entry: routing, navigation, PWA integration.
import './i18n/index.js'; // first: English UI translation layer (top-level await before the first render)
import { logo } from './icons.js';
import { $, $$, toast, errorToast, initPdfInput, setDefaultPdfHandler, closeMenus, openDialog } from './ui.js';
import * as db from './db.js';
import { importFiles, onLibraryChange } from './library.js';
import { openViewer, closeViewer, setViewerCloseHandler, viewerOpen } from './viewer.js';
import { openScreen, closeScreen, renderChooser, currentScreen } from './screen.js';
import { TOOLS, toolById, handoff, toolText } from './tools/index.js';
import { simpleOn } from './simple.js';
import { renderHome, renderFiles, renderTools, renderSearch, renderSettings, importFromDevice, showNewMenu } from './views.js';
import { syncThemeColor, toggleTheme, effectiveDark } from './theme.js';
import { oicon, detectKind, unsupportedReason, openHash } from './office/kinds.js';
import { EXTRA_ROUTES, openExtraRoute } from './extras/routes.js';
import { isNative, platformName, onIncomingFiles } from './platform.js';

const MAIN_VIEWS = ['start', 'dateien', 'werkzeuge', 'suche', 'einstellungen'];
const OFFICE_ROUTES = ['bearbeiten', 'neu', 'vorlagen'];
const SHARE_ROUTES = ['teilen', 's', 'u', 'r', 'verbinden']; // keep in sync with js/share/routes.js
let currentMain = null;
const navStack = [];

// ---------- static icons ----------
function hydrateIcons(root = document) {
  $$('[data-icon]', root).forEach(el => { if (!el.dataset.filled) { el.innerHTML = oicon(el.dataset.icon); el.dataset.filled = '1'; } });
  $$('[data-logo]', root).forEach(el => { el.innerHTML = logo(32); });
}

function updateThemeButton() {
  $$('[data-action="toggle-theme"]').forEach(b => {
    b.innerHTML = oicon(effectiveDark() ? 'sun' : 'moon');
    b.setAttribute('aria-label', effectiveDark() ? 'Helles Design' : 'Dunkles Design');
  });
}

// ---------- routing ----------
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), params: new URLSearchParams(qs || '') };
}

export function goBack() {
  if (navStack.length > 1) history.back();
  else location.replace('#/start');
}

async function showMain(name, params) {
  if (!MAIN_VIEWS.includes(name)) name = 'start';
  $$('.view').forEach(v => { v.hidden = v.dataset.view !== name; });
  $$('[data-nav]').forEach(a => {
    const on = a.dataset.nav === name;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.body.dataset.view = name;
  const changed = currentMain !== name;
  currentMain = name;
  if (changed) $('#main').scrollTop = 0;
  try {
    if (name === 'start') await renderHome();
    if (name === 'dateien') await renderFiles(params);
    if (name === 'werkzeuge') renderTools(params ? params.get('q') : null);
    if (name === 'suche') renderSearch(params ? params.get('q') : null);
    if (name === 'einstellungen') await renderSettings();
  } catch (e) { errorToast(e, 'Ansicht konnte nicht geladen werden.'); }
}

let guardBusy = false;
let routeGen = 0; // each route() call gets a number; a slower, older call must not open its screen over a newer one
async function route() {
  const gen = ++routeGen;
  const stale = () => gen !== routeGen;
  closeMenus();
  // leaving an office editor with unsaved changes?
  const scr = currentScreen();
  if (scr && scr.isDirty && scr.isDirty() && scr.hashKey && location.hash !== scr.hashKey) {
    if (guardBusy) return;
    guardBusy = true;
    const target = location.hash;
    history.pushState(null, '', scr.hashKey);
    const { confirmLeave } = await import('./office/open.js');
    const ok = await confirmLeave(scr);
    guardBusy = false;
    if (!ok) return;
    scr.isDirty = () => false;
    location.hash = target;
    return;
  }
  const { parts, params } = parseHash();
  const top = parts[0] || 'start';
  const key = location.hash || '#/start';
  if (navStack.length > 1 && navStack[navStack.length - 2] === key) navStack.pop();
  else if (navStack[navStack.length - 1] !== key) navStack.push(key);

  if (top === 'ansicht' && parts[1]) {
    const meta = await db.getDoc(parts[1]).catch(() => null);
    if (meta && meta.kind && meta.kind !== 'pdf') { location.replace(openHash(meta)); return; }
    closeScreen();
    if (!currentMain) showMain('start');
    await openViewer(parts[1], {
      page: parseInt(params.get('seite'), 10) || null,
      query: params.get('q'),
      read: params.get('vorlesen') === '1',
    });
    return;
  }
  if (top === 'werkzeug' && parts[1]) {
    if (viewerOpen()) await closeViewer();
    if (!currentMain) showMain('werkzeuge');
    await openTool(parts[1], params);
    return;
  }
  if (OFFICE_ROUTES.includes(top)) {
    if (viewerOpen() || !$('#viewer').hidden) await closeViewer();
    if (!currentMain) showMain(top === 'vorlagen' ? 'werkzeuge' : 'dateien');
    const cur = currentScreen();
    if (cur && cur.hashKey && cur.hashKey.split('?')[0] === key.split('?')[0] && top === 'bearbeiten') return; // already open
    const { openOfficeRoute } = await import('./office/open.js');
    if (stale()) return; // the address changed while the editor module was loading
    await openOfficeRoute(parts, params, { goBack });
    if (stale()) { route(); return; } // left again while opening: route to where we are now
    const s = currentScreen();
    if (s) s.hashKey = location.hash;
    return;
  }
  if (top === 'ki') { // KI-Assistent (js/ai/routes.js)
    if (viewerOpen() || !$('#viewer').hidden) await closeViewer();
    if (!currentMain) showMain('werkzeuge');
    const ai = await import('./ai/routes.js');
    if (stale()) return;
    await ai.openAiRoute(parts, params, { goBack });
    return;
  }
  if (top === 'web' && parts[1]) { // FaleNetwork web tools in a frame (js/webtools/host.js)
    if (viewerOpen() || !$('#viewer').hidden) await closeViewer();
    if (!currentMain) showMain('werkzeuge');
    const wt = await import('./webtools/host.js');
    if (stale()) return;
    await wt.openWebToolRoute(parts, params, { goBack });
    return;
  }
  if (SHARE_ROUTES.includes(top)) { // Teilen & Übertragen (js/share/routes.js): #/teilen…, #/s/<id>, #/u/<token>, #/r/<token>, #/verbinden
    if (viewerOpen() || !$('#viewer').hidden) await closeViewer();
    if (!currentMain) showMain(top === 's' || top === 'u' || top === 'r' ? 'start' : 'werkzeuge');
    await (await import('./share/routes.js')).openShareRoute(parts, params, { goBack });
    return;
  }
  if (EXTRA_ROUTES.includes(top)) {
    if (viewerOpen() || !$('#viewer').hidden) await closeViewer();
    if (!currentMain) showMain(['profil', 'tresor', 'papierkorb', 'konto'].includes(top) ? 'einstellungen' : top === 'duplikate' ? 'dateien' : top === 'fristen' ? 'start' : 'werkzeuge');
    await openExtraRoute(parts, params, { goBack });
    return;
  }
  if (viewerOpen() || !$('#viewer').hidden) await closeViewer();
  closeScreen();
  await showMain(top, params);
}

async function openTool(id, params) {
  const tool = toolById(id);
  if (!tool) { location.replace('#/werkzeuge'); return; }
  if (tool.soon) {
    toast(`„${tool.title}“ ist bald verfügbar.`, 'info');
    location.replace('#/werkzeuge');
    return;
  }
  const docId = params.get('doc');
  if (tool.viewer && docId) { location.replace(`#/ansicht/${docId}?vorlesen=1`); return; }
  const tx = toolText(tool, simpleOn());
  const screen = openScreen({ title: tx.title, sub: tx.desc, onBack: goBack });
  screen.hashKey = location.hash;
  if ((tool.needsDoc || tool.viewer) && !docId) {
    await renderChooser(screen, {
      onPick: d => location.replace(tool.viewer ? `#/ansicht/${d.id}?vorlesen=1` : `#/werkzeug/${tool.id}?doc=${d.id}`),
    });
    return;
  }
  screen.body.innerHTML = '<div class="v-loading"><div><span class="spinner dark" style="width:30px;height:30px"></span><span>Wird geladen …</span></div></div>';
  try {
    const mod = await tool.load();
    if (screen.signal.aborted) return;
    screen.body.innerHTML = '';
    const cleanup = await mod.mount(screen, { docId, params, tool });
    if (typeof cleanup === 'function') screen.cleanup = cleanup;
  } catch (e) {
    if (screen.signal.aborted) return;
    errorToast(e, 'Das Werkzeug konnte nicht geöffnet werden.');
    screen.body.innerHTML = `<div class="screen-inner"><div class="empty"><div class="empty-art">${oicon('info')}</div><h3>Das hat nicht geklappt</h3><p>${e && e.userMessage ? e.userMessage : 'Bitte versuche es erneut.'}</p></div></div>`;
  }
}

// ---------- importing from outside (drop, file handler, share target) ----------
async function handleIncoming(files, source) {
  const list = Array.from(files || []);
  const imgs = list.filter(f => detectKind(f) === 'image');
  const docsIn = list.filter(f => { const k = detectKind(f); return k && k !== 'image'; });
  const other = list.filter(f => !detectKind(f));
  if (other.length) toast(other.length === 1 ? unsupportedReason(other[0]) : `${other.length} Dateien werden nicht unterstützt.`, 'error', { timeout: 6000 });
  let opened = false;
  if (docsIn.length) {
    const docs = await importFiles(docsIn, { source, any: true });
    if (docs.length === 1 && !imgs.length) { location.hash = openHash(docs[0]); opened = true; }
  }
  if (imgs.length) {
    const r = await openDialog({
      title: imgs.length === 1 ? 'Bild erhalten' : `${imgs.length} Bilder erhalten`,
      body: '<p>Möchtest du daraus eine PDF erstellen oder die Bilder in deinen Dateien speichern?</p>',
      actions: [{ label: 'In Dateien speichern', value: 'save' }, { label: 'PDF erstellen', value: 'pdf', kind: 'btn-primary', default: true }],
    });
    if (r.value === 'pdf') { handoff.images.push(...imgs); location.hash = '#/werkzeug/bilder'; }
    else if (r.value === 'save') { await importFiles(imgs, { source, any: true }); if (!opened) location.hash = '#/dateien?typ=image'; }
  }
}

function setupDragDrop() {
  const overlay = $('#drop-overlay');
  let depth = 0;
  const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; overlay.classList.add('show'); });
  window.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) overlay.classList.remove('show'); });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    overlay.classList.remove('show');
    // an open tool screen can claim dropped files (e.g. merge list, images list)
    const scr = currentScreen();
    if (scr && scr.onDropFiles) { scr.onDropFiles(Array.from(e.dataTransfer.files)); return; }
    handleIncoming(e.dataTransfer.files, 'Gerät');
  });
}

// Files opened with / shared to the app: launchQueue (PWA) or the Android intent bridge (platform.js).
function setupLaunchQueue() {
  onIncomingFiles(async (files, info) => {
    try { await handleIncoming(files, (info && info.source) || 'Geöffnet'); } catch (e) { errorToast(e, 'Die Datei konnte nicht geöffnet werden.'); }
  });
}

async function checkInbox() {
  const items = await db.takeInbox();
  if (!items.length) return;
  const files = items.map(it => (it.file instanceof File ? it.file : new File([it.file], it.name || 'Geteilt.pdf', { type: it.type || it.file.type })));
  await handleIncoming(files, 'Geteilt');
}

// ---------- service worker ----------
function registerSW() {
  if (isNative() || !('serviceWorker' in navigator)) return; // Android app: assets are bundled locally
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  navigator.serviceWorker.register('./sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Eine neue Version ist bereit.', 'info', { timeout: 8000, action: { label: 'Neu laden', onClick: () => location.reload() } });
        } else if (nw.state === 'activated' && !navigator.serviceWorker.controller) {
          toast('FaLe PDF ist jetzt offline verfügbar.', 'success');
        }
      });
    });
  }).catch(err => console.warn('SW-Registrierung fehlgeschlagen', err));
}

// ---------- init ----------
async function init() {
  hydrateIcons();
  syncThemeColor();
  updateThemeButton();
  initPdfInput();
  setDefaultPdfHandler(async files => {
    const docs = await importFiles(files, { source: 'Gerät' });
    if (docs.length === 1) location.hash = `#/ansicht/${docs[0].id}`;
  });
  setViewerCloseHandler(goBack);

  document.addEventListener('click', e => {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    if (a.dataset.action === 'open-file') { e.preventDefault(); importFromDevice(); }
    if (a.dataset.action === 'new-menu') { e.preventDefault(); showNewMenu(a); }
    if (a.dataset.action === 'toggle-theme') { toggleTheme(); updateThemeButton(); if (currentMain === 'einstellungen') renderSettings(); }
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeButton);
  // an editor saved a new file and replaced its #/neu/… hash with #/bearbeiten/<id>
  window.addEventListener('fale:hash-replaced', e => {
    if (navStack.length) navStack[navStack.length - 1] = e.detail;
    const s = currentScreen();
    if (s) s.hashKey = e.detail;
  });

  onLibraryChange(() => {
    if (!$('#tool-screen').hidden) return;
    if (currentMain === 'start') renderHome();
    if (currentMain === 'dateien') renderFiles();
  });

  setupDragDrop();
  setupLaunchQueue();
  window.addEventListener('hashchange', route);
  if (!location.hash) history.replaceState(null, '', '#/start');
  await route();

  const params = new URLSearchParams(location.search);
  if (params.has('shared') || params.has('share-error')) {
    if (params.has('share-error')) toast('Die geteilte Datei konnte nicht übernommen werden.', 'error');
    history.replaceState(null, '', location.pathname + location.hash);
  }
  checkInbox().catch(e => console.warn(e));
  registerSW();
  document.documentElement.classList.add('ready');
  if (isNative()) console.info('FaLe PDF bereit (' + platformName() + ')'); // marker for the emulator/simulator tests
  // housekeeping + first-run intro (all local)
  db.purgeOldTrash(30).catch(() => {});
  import('./office/recovery.js').then(m => m.offerRecovery()).catch(e => console.warn(e)); // editors closed by a crash
  import('./extras/onboarding.js').then(m => m.maybeShowOnboarding()).catch(e => console.warn(e));
  import('./extras/reminders.js').then(m => m.syncNotifications()).catch(e => console.warn(e));
  import('./install.js').then(m => m.initInstall()).catch(e => console.warn(e)); // web only: "install as an app", /app/?install=1
  import('./smart/entry.js').then(m => m.initSmart()).catch(e => console.warn(e)); // Dokumenten-Gedächtnis: local index in idle time
  // optional FaLe-Konto: only does something when signed in (or returning from a Google sign-in)
  let acct = false;
  try { acct = localStorage.getItem('fale-acct') === '1'; } catch {}
  if (acct || /[?&]auth=/.test(location.search)) import('./account/entry.js').then(m => m.initAccount()).catch(e => console.warn(e));
}

window.addEventListener('error', e => { console.error(e.error || e.message); });
window.addEventListener('unhandledrejection', e => {
  const r = e.reason;
  if (r && (r.name === 'AbortError' || r.name === 'RenderingCancelledException')) { e.preventDefault(); return; }
  // pdf.js: a page request that was still in flight when a document was closed (viewer left quickly under load)
  if (r && r instanceof TypeError && /reading 'sendWithPromise'/.test(r.message || '')) { e.preventDefault(); return; }
  if (r && r.userMessage) { e.preventDefault(); toast(r.userMessage, 'error'); }
});

init().catch(e => { console.error(e); toast('FaLe PDF konnte nicht gestartet werden.', 'error'); });
export { TOOLS };
