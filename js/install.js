// FaLe PDF – "install as an app" for the web build (Windows, Mac, phones).
// Never active in the native Capacitor apps and never when the app already runs as an installed app.
//
//   initInstall()          app start: picks up the browser's install event, ?install=1, the one-time desktop hint
//   installState()         → { native, standalone, installed, canPrompt, os, browser, offer }
//   promptInstall()        → 'accepted' | 'dismissed' | 'unavailable'  (must run inside a click)
//   showInstallDialog()    the install dialog: the browser's own install prompt, or plain step-by-step instructions
//   renderMeCard(box)      entry on the "Ich" screen
//
// The browser fires `beforeinstallprompt` (Chrome, Edge, Opera, Samsung Internet) once the app is installable;
// js/boot.js keeps an early event in window.__faleInstallEvt so none is lost before this module loads.
// Safari (Mac: Ablage › Zum Dock hinzufügen, iPhone: Teilen › Zum Home-Bildschirm) and Firefox have no such
// event – there the dialog shows the steps in the browser's own words.
import { h, esc, toast, openDialog } from './ui.js';
import { isNative, isDesktopApp } from './platform.js';

/** „FaLe PDF für Windows“ (windows/): the Setup.exe on the windows-latest pre-release. */
export const WINDOWS_SETUP_URL = 'https://github.com/DeLehnen98/FaLe-PDF/releases/download/windows-latest/FaLe-PDF-Setup.exe';

const HINT_KEY = 'fale-install-hint';      // '1' = the desktop hint was shown and closed (never again)
const STARTS_KEY = 'fale-install-starts';  // app starts in the browser (the hint waits for the second one)
const INSTALLED_KEY = 'fale-installed';    // '1' = installed from this browser (appinstalled / opened as app)
const EVT = 'fale:install-change';

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} },
};

let deferred = null;
let started = false;
let cssDone = false;

// ---------------------------------------------------------------- detection
const ua = () => (typeof navigator !== 'undefined' && navigator.userAgent) || '';

export function osName() {
  const u = ua();
  if (/iPhone|iPad|iPod/.test(u) || (/Macintosh/.test(u) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(u)) return 'android';
  if (/Windows/.test(u)) return 'windows';
  if (/Macintosh|Mac OS X/.test(u)) return 'mac';
  if (/CrOS/.test(u)) return 'chromeos';
  if (/Linux/.test(u)) return 'linux';
  return 'other';
}

export function browserName() {
  const u = ua();
  if (/Edg(A|iOS)?\//.test(u)) return 'edge';
  if (/OPR\/|Opera/.test(u)) return 'opera';
  if (/SamsungBrowser/.test(u)) return 'samsung';
  if (/Firefox\/|FxiOS/.test(u)) return 'firefox';
  if (/Chrome\/|CriOS|Chromium/.test(u)) return 'chrome';
  if (/Safari\//.test(u)) return 'safari';
  return 'other';
}

function safariVersion() { const m = /Version\/(\d+)/.exec(ua()); return m ? +m[1] : 0; }
function firefoxVersion() { const m = /Firefox\/(\d+)/.exec(ua()); return m ? +m[1] : 0; }

function mq(q) { try { return matchMedia(q).matches; } catch { return false; } }

/** Running as an installed app (own window / home screen), not in a browser tab. */
export function isStandalone() {
  if (typeof window === 'undefined') return false;
  if (navigator.standalone === true) return true; // iPhone/iPad home screen
  return ['standalone', 'window-controls-overlay', 'minimal-ui'].some(m => mq(`(display-mode: ${m})`));
}

const isDesktop = () => ['windows', 'mac', 'linux', 'chromeos'].includes(osName());

export function installState() {
  const native = isNative();
  const standalone = !native && isStandalone();
  return {
    native, standalone,
    installed: standalone || ls.get(INSTALLED_KEY) === '1',
    canPrompt: !!deferred,
    os: osName(), browser: browserName(),
    offer: !native && !standalone, // show install entries at all
  };
}

function emit() { try { window.dispatchEvent(new CustomEvent(EVT)); } catch {} }
export function onInstallChange(cb) { window.addEventListener(EVT, cb); return () => window.removeEventListener(EVT, cb); }

function take(e) {
  if (!e || isNative()) return;
  try { e.preventDefault(); } catch {} // no mini-infobar; we offer the install where it fits
  deferred = e;
  if (ls.get(INSTALLED_KEY) === '1') ls.set(INSTALLED_KEY, null); // installable again → it was uninstalled
  emit();
}

/** Shows the browser's own install prompt. Call it directly from a click handler. */
export async function promptInstall() {
  const e = deferred;
  if (!e) return 'unavailable';
  deferred = null; // an event can prompt only once
  try { window.__faleInstallEvt = null; } catch {}
  try {
    await e.prompt();
    const choice = await e.userChoice;
    const outcome = choice && choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
    if (outcome === 'accepted') markInstalled();
    emit();
    return outcome;
  } catch (err) {
    console.warn('Installation:', err);
    emit();
    return 'unavailable';
  }
}

function markInstalled() {
  ls.set(INSTALLED_KEY, '1');
  ls.set(HINT_KEY, '1');
  removeHint();
}

// ---------------------------------------------------------------- texts
const PLACE = {
  windows: 'Du findest FaLe PDF danach im Startmenü und kannst es an die Taskleiste anheften.',
  mac: 'Du findest FaLe PDF danach im Programme-Ordner und im Dock.',
  ios: 'FaLe PDF liegt danach auf deinem Home-Bildschirm.',
  android: 'FaLe PDF liegt danach auf deinem Startbildschirm.',
};

export function installTitle(os = osName()) {
  if (os === 'windows' || os === 'linux' || os === 'chromeos') return 'Auf diesem PC installieren';
  if (os === 'mac') return 'Auf diesem Mac installieren';
  return 'Als App installieren';
}

/** Steps for browsers without an install prompt (or when the prompt is not available right now). */
export function manualSteps(os = osName(), browser = browserName()) {
  if (os === 'ios') {
    return { steps: [
      'Tippe auf das Teilen-Symbol (Quadrat mit Pfeil nach oben). Siehst du es nicht, tippe zuerst auf „…“.',
      'Wähle „Zum Home-Bildschirm“ – eventuell musst du dafür etwas nach unten wischen.',
      'Tippe oben rechts auf „Hinzufügen“.',
    ] };
  }
  if (os === 'android') {
    if (browser === 'firefox') return { steps: ['Tippe auf das Menü ⋮.', 'Wähle „Zum Startbildschirm hinzufügen“.', 'Bestätige mit „Hinzufügen“.'] };
    if (browser === 'samsung') return { steps: ['Tippe unten auf das Menü ☰.', 'Wähle „Seite hinzufügen zu“ und dann „Startbildschirm“.', 'Bestätige mit „Hinzufügen“.'] };
    return { steps: ['Tippe oben rechts auf das Menü ⋮.', 'Wähle „App installieren“ oder „Zum Startbildschirm hinzufügen“.', 'Bestätige mit „Installieren“.'] };
  }
  if (browser === 'edge') {
    return { steps: [
      'Klicke oben rechts auf die drei Punkte „…“.',
      'Wähle „Apps“ und dann „Diese Website als App installieren“.',
      'Bestätige mit „Installieren“.',
    ] };
  }
  if (browser === 'chrome' || browser === 'opera') {
    return { steps: [
      'Klicke rechts in der Adressleiste auf das Symbol „Installieren“ (ein kleiner Bildschirm mit Pfeil).',
      'Siehst du es nicht: Klicke oben rechts auf die drei Punkte ⋮ und wähle „Speichern und teilen“ › „FaLe PDF installieren …“.',
      'Bestätige mit „Installieren“.',
    ] };
  }
  if (os === 'mac' && browser === 'safari') {
    if (safariVersion() && safariVersion() < 17) {
      return { steps: [], note: 'Dafür brauchst du macOS 14 (Sonoma) oder neuer. Alternativ geht es in Chrome oder Edge: Öffne pdf.fale.network/app/ dort und klicke auf „Installieren“.' };
    }
    return { steps: [
      'Klicke oben in der Menüleiste auf „Ablage“.',
      'Wähle „Zum Dock hinzufügen …“.',
      'Klicke auf „Hinzufügen“.',
    ] };
  }
  if (browser === 'firefox') {
    if (os === 'windows' && (!firefoxVersion() || firefoxVersion() >= 143)) {
      return { steps: [
        'Klicke rechts in der Adressleiste auf das Symbol „Zur Taskleiste hinzufügen“.',
        'FaLe PDF erscheint danach in der Taskleiste und im Startmenü.',
      ], note: 'PDFs per Doppelklick öffnen klappt nur, wenn du FaLe PDF über Edge oder Chrome installierst.' };
    }
    return { steps: [], note: 'Firefox kann FaLe PDF auf diesem Computer nicht als App installieren. Öffne pdf.fale.network/app/ in Chrome oder Edge (auf dem Mac auch in Safari) und klicke dort auf „Installieren“.' };
  }
  return { steps: [], note: 'Dein Browser kann FaLe PDF vermutlich nicht als App installieren. Öffne pdf.fale.network/app/ in Chrome oder Edge (auf dem Mac auch in Safari) und klicke dort auf „Installieren“.' };
}

// ---------------------------------------------------------------- css + icon
function loadCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('../css/install.css', import.meta.url).href;
  document.head.appendChild(l);
}

const ICON = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M8 20.5h8"/><path d="M12 16.5v4"/><path d="M12 6.5v6"/><path d="m9.2 10 2.8 2.8 2.8-2.8"/></svg>';
const CHECK = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

// ---------------------------------------------------------------- dialog
function benefitsHtml(st) {
  const items = [
    st.os === 'ios' || st.os === 'android' ? 'Eigenes Symbol auf dem Startbildschirm' : 'Eigenes Symbol und eigenes Fenster – wie ein normales Programm',
    'Funktioniert auch ohne Internet',
    'Ohne Konto, nichts wird hochgeladen',
  ];
  if (isDesktop() && st.canPrompt) items.splice(1, 0, 'PDFs direkt per Doppelklick öffnen');
  return `<ul class="inst-benefits">${items.map(t => `<li>${CHECK}<span>${esc(t)}</span></li>`).join('')}</ul>`;
}

function stepsHtml(st) {
  const m = manualSteps(st.os, st.browser);
  return `${m.steps.length ? `<ol class="inst-steps">${m.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}${m.note ? `<p class="inst-note">${esc(m.note)}</p>` : ''}`;
}

function dialogBody(st, waiting) {
  if (st.standalone) return '<p>FaLe PDF läuft hier schon als installierte App.</p>';
  if (st.installed && !st.canPrompt) {
    return `<p class="inst-lead">FaLe PDF ist auf diesem Gerät schon installiert.</p><p>${esc(PLACE[st.os] || '')}</p>`
      + (isDesktop() && st.os !== 'mac' ? '<p class="inst-note">In Chrome und Edge kannst du die App auch über das Symbol „In App öffnen“ rechts in der Adressleiste starten.</p>' : '');
  }
  let main;
  if (st.canPrompt) {
    main = `<button class="btn btn-primary inst-go" type="button" data-inst-go autofocus>${ICON}<span>Jetzt installieren</span></button>
      <p class="inst-note">Dein Browser fragt gleich noch einmal nach – klicke dort auf „Installieren“.</p>`;
  } else if (waiting) {
    main = '<p class="inst-wait" role="status">Einen Moment …</p>';
  } else {
    main = `<p class="inst-how">So geht’s:</p>${stepsHtml(st)}`;
  }
  return `<p class="inst-lead">Dann hast du FaLe PDF wie ein normales Programm auf deinem Gerät. Eine Download-Datei brauchst du dafür nicht.</p>
    ${benefitsHtml(st)}<div class="inst-main">${main}</div>
    ${PLACE[st.os] && (st.canPrompt || !waiting) ? `<p class="inst-note">${esc(PLACE[st.os])}</p>` : ''}`;
}

let dialogOpen = false;
/** The install dialog. `wait`: ms to wait for the browser's install event before showing the manual steps. */
export async function showInstallDialog({ wait = 0 } = {}) {
  if (isNative() || dialogOpen) return null;
  loadCss();
  dialogOpen = true;
  removeHint();
  let waiting = wait > 0 && !deferred && !installState().installed && !!(window.BeforeInstallPromptEvent || /Chrome\//.test(ua()));
  let off = () => {};
  let timer = 0;
  try {
    const res = await openDialog({
      title: installTitle(),
      body: '<div class="inst" data-inst></div>',
      actions: [{ label: 'Schließen', value: 'cancel' }],
      onMount(dlg) {
        const box = dlg.querySelector('[data-inst]');
        const paint = () => {
          box.innerHTML = dialogBody(installState(), waiting);
          const go = box.querySelector('[data-inst-go]');
          if (go) {
            go.addEventListener('click', async () => {
              const r = await promptInstall();
              if (r === 'accepted') {
                dlg.close();
                toast('FaLe PDF wird installiert und öffnet sich gleich in einem eigenen Fenster.', 'success', { timeout: 7000 });
              } else paint();
            });
            setTimeout(() => { try { go.focus(); } catch {} }, 40);
          }
        };
        paint();
        off = onInstallChange(() => { waiting = false; paint(); });
        if (waiting) timer = setTimeout(() => { waiting = false; paint(); }, wait);
        return null;
      },
    });
    return res;
  } finally {
    off();
    clearTimeout(timer);
    dialogOpen = false;
  }
}

/** Windows: make FaLe PDF the app for PDFs (after installing via Edge/Chrome). */
export function showDefaultAppDialog() {
  loadCss();
  return openDialog({
    title: 'PDFs immer mit FaLe PDF öffnen',
    body: `<div class="inst"><p class="inst-lead">So öffnen sich PDFs per Doppelklick in FaLe PDF:</p><ol class="inst-steps">
      <li>Klicke im Explorer mit der rechten Maustaste auf eine PDF-Datei.</li>
      <li>Wähle „Öffnen mit“ und dann „Andere App auswählen“.</li>
      <li>Klicke auf „FaLe PDF“ und dann auf „Immer“.</li></ol>
      <p class="inst-note">Ändern kannst du das jederzeit unter Einstellungen › Apps › Standard-Apps.</p></div>`,
    actions: [{ label: 'Verstanden', value: 'ok', kind: 'btn-primary' }],
  });
}

// ---------------------------------------------------------------- Ich screen
export function renderMeCard(box) {
  if (!box) return;
  const paint = () => {
    if (!box.isConnected && box.dataset.instPainted) return;
    box.dataset.instPainted = '1';
    const st = installState();
    box.innerHTML = '';
    if (st.native || isDesktopApp()) return; // the Windows program is installed already
    loadCss();
    if (st.standalone) {
      if (st.os !== 'windows') return;
      box.appendChild(h(`<button type="button" class="card inst-me" data-inst-default><span class="inst-me-ic">${ICON}</span><span class="inst-me-text"><strong>PDFs per Doppelklick öffnen</strong><span>FaLe PDF als Standard-App für PDFs festlegen</span></span><span class="btn btn-soft btn-sm inst-me-btn">Anleitung</span></button>`));
      box.querySelector('[data-inst-default]').addEventListener('click', () => showDefaultAppDialog());
      return;
    }
    const sub = st.installed && !st.canPrompt ? 'Ist schon installiert – so findest du es'
      : st.os === 'ios' || st.os === 'android' ? 'Mit eigenem Symbol auf dem Startbildschirm'
        : 'Eigenes Symbol und Fenster, auch offline';
    box.appendChild(h(`<button type="button" class="card inst-me" data-inst-open><span class="inst-me-ic">${ICON}</span><span class="inst-me-text"><strong>${esc(installTitle(st.os))}</strong><span>${esc(sub)}</span></span><span class="btn btn-soft btn-sm inst-me-btn">${st.installed && !st.canPrompt ? 'Anzeigen' : 'Installieren'}</span></button>`));
    box.querySelector('[data-inst-open]').addEventListener('click', () => showInstallDialog());
    if (st.os === 'windows') {
      // the classic way: a Setup.exe (windows/, built by .github/workflows/windows.yml)
      box.appendChild(h(`<a class="card inst-me inst-exe" href="${WINDOWS_SETUP_URL}" rel="noopener" data-inst-exe><span class="inst-me-ic">${ICON}</span><span class="inst-me-text"><strong>Als Windows-Programm herunterladen</strong><span>FaLe-PDF-Setup.exe – für Windows 10 und 11, ohne Administratorrechte</span></span><span class="btn btn-soft btn-sm inst-me-btn">Setup.exe</span></a>`));
    }
  };
  paint();
  const off = onInstallChange(() => { if (!box.isConnected) { off(); return; } paint(); });
}

// ---------------------------------------------------------------- one-time desktop hint
function removeHint() { const el = document.querySelector('.inst-hint'); if (el) el.remove(); }

function hintAllowed() {
  const st = installState();
  if (!st.offer || st.installed || ls.get(HINT_KEY) === '1') return false;
  // automated test browsers never get the hint unless a test asks for it (it would cover buttons)
  if (navigator.webdriver && ls.get('fale-install-hint-force') !== '1') return false;
  if (!isDesktop() || !mq('(min-width: 900px)') || !mq('(pointer: fine)')) return false;
  if (+(ls.get(STARTS_KEY) || 0) < 2) return false; // not on the very first visit
  return st.canPrompt || (st.os === 'mac' && st.browser === 'safari' && safariVersion() >= 17);
}

function busy() {
  return !!document.querySelector('dialog[open], .onboard, .inst-hint') || !/^#\/(start)?$/.test(location.hash || '#/start')
    || !document.getElementById('tool-screen')?.hidden;
}

function showHint() {
  if (!hintAllowed() || busy()) return false;
  loadCss();
  const st = installState();
  const el = h(`<aside class="inst-hint" role="complementary" aria-label="FaLe PDF installieren">
    <span class="inst-hint-ic">${ICON}</span>
    <div class="inst-hint-text"><strong>${esc(installTitle(st.os))}</strong><span>Mit eigenem Symbol und Fenster – PDFs öffnest du dann direkt per Doppelklick.</span></div>
    <div class="inst-hint-actions"><button type="button" class="btn btn-primary btn-sm" data-hint-go>Installieren</button><button type="button" class="btn btn-ghost btn-sm" data-hint-no>Nicht jetzt</button></div>
  </aside>`);
  if (st.os === 'mac' && !st.canPrompt) el.querySelector('.inst-hint-text span').textContent = 'Mit eigenem Symbol im Dock und eigenem Fenster.';
  const done = () => { ls.set(HINT_KEY, '1'); el.remove(); };
  el.querySelector('[data-hint-no]').addEventListener('click', done);
  el.querySelector('[data-hint-go]').addEventListener('click', async () => {
    done();
    if (deferred) {
      const r = await promptInstall();
      if (r === 'accepted') toast('FaLe PDF wird installiert und öffnet sich gleich in einem eigenen Fenster.', 'success', { timeout: 7000 });
    } else showInstallDialog();
  });
  document.body.appendChild(el);
  return true;
}

let hintTimer = 0;
function scheduleHint(ms = 6000) {
  clearTimeout(hintTimer);
  if (!hintAllowed()) return;
  hintTimer = setTimeout(() => { if (!showHint() && hintAllowed()) scheduleHint(15000); }, ms);
}

// ---------------------------------------------------------------- start
export function initInstall() {
  if (started || typeof window === 'undefined') return;
  started = true;
  if (isNative()) return;
  const params = new URLSearchParams(location.search);
  const fromLink = params.has('install');
  if (fromLink) { // /app/?install=1 – from the start page's download button
    params.delete('install');
    const qs = params.toString();
    try { history.replaceState(history.state, '', location.pathname + (qs ? '?' + qs : '') + location.hash); } catch {}
  }
  if (isStandalone()) {
    ls.set(INSTALLED_KEY, '1');
    if (fromLink) toast('FaLe PDF ist hier schon als App geöffnet.', 'info');
    return;
  }
  take(window.__faleInstallEvt);
  window.addEventListener('beforeinstallprompt', take);
  window.addEventListener('appinstalled', () => {
    deferred = null;
    markInstalled();
    emit();
  });
  ls.set(STARTS_KEY, String(Math.min(99, +(ls.get(STARTS_KEY) || 0) + 1)));
  if (fromLink) showInstallDialog({ wait: 2500 });
  else {
    scheduleHint();
    onInstallChange(() => { if (!document.querySelector('.inst-hint')) scheduleHint(4000); });
  }
}
