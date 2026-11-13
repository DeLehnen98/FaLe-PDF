// Firmen-Einstellungen: the IT of a company can switch off everything that goes over the internet, for all PCs at
// once, with the browser's own enterprise policies – no installer and no server of ours involved:
//   1. Edge/Chrome policy WebAppInstallForceList   → installs FaLe PDF on every PC (GPO, Intune, …)
//   2. Edge/Chrome policy ManagedConfigurationPerOrigin → a small JSON file on the company's own server, e.g.
//        { "cloudAi": false, "post": false, "cloudShare": false }
//      which the app reads here with the Managed Configuration API (only for force-installed web apps).
//   3. Windows program (windows/, Tauri): a file on the PC, %ProgramData%\FaLe PDF\policy.json. The program reads
//      it at every start and hands the known keys over as window.__FALE_DESKTOP__.policy (windows/src-tauri/src/
//      policy.rs). There the file is the only source – nothing stored in the app can lift it.
// Keys (all optional; only `false` switches something off – anything else leaves it as it is):
//   cloudAi     Cloud-KI (explanations, translations, assistant) – the AI stays hidden and cannot be switched on
//   post        Brief per Post and Fax (sends the PDF to the print/fax service)
//   cloudShare  Sicher teilen, Dateien anfordern, Unterschrift anfordern, Übertragen (encrypted uploads)
//   account     FaLe-Konto (sign-in and the end-to-end encrypted sync between devices)
//   internet    all four at once
// The last answer is kept on the device (works offline, readable synchronously); it is cleared as soon as the
// browser reports no policy any more. Dependency-free so that every module can ask `blocked('post')` cheaply.
const KEY = 'fale-policy';
export const POLICY_KEYS = ['cloudAi', 'post', 'cloudShare', 'account'];

/** Only what the app understands: known keys that are `false` (`internet: false` = all of them). */
function clean(cfg) {
  const out = {};
  if (cfg && typeof cfg === 'object') {
    const all = cfg.internet === false;
    for (const k of POLICY_KEYS) if (all || cfg[k] === false) out[k] = false;
    if (cfg.invalid === true && Object.keys(out).length) out.invalid = true; // the file could not be read → everything off
  }
  return Object.keys(out).length ? out : null;
}

/** Windows program: the settings from the file on the PC. `undefined` = this is not the Windows program. */
function fromShell() {
  try {
    const d = typeof window !== 'undefined' ? window.__FALE_DESKTOP__ : null;
    return d ? clean(d.policy) : undefined;
  } catch { return undefined; }
}

function read() {
  const shell = fromShell();
  if (shell !== undefined) return shell;
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; }
}

/** Where the settings come from: 'file' (Windows program), 'browser' (Edge/Chrome policy) or null (not managed). */
export function policySource() { return fromShell() !== undefined ? (read() ? 'file' : null) : (read() ? 'browser' : null); }
/** The file with the company settings exists but could not be understood – everything is off to be safe. */
export function policyInvalid() { const p = read(); return !!(p && p.invalid); }

/** The active company settings ({cloudAi:false, …}) or null when the PC is not managed. */
export function policy() { return read(); }

/** Is this feature switched off by the company? */
export function blocked(name) { const p = read(); return !!p && p[name] === false; }

function apiOf() {
  try {
    // only desktop browsers: the policies exist for Windows/macOS only – and the Android app (WebView 113 on
    // Android 14) stopped starting once the app asked for it, so phones never ask
    if (typeof window !== 'undefined' && window.Capacitor) return null;
    if (typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')) return null;
    const n = typeof navigator !== 'undefined' ? navigator : null;
    if (n && n.managed && typeof n.managed.getManagedConfiguration === 'function') return n.managed;
    if (n && n.device && typeof n.device.getManagedConfiguration === 'function') return n.device; // older name
  } catch { /* no navigator */ }
  return null;
}

function store(cfg) {
  const c = clean(cfg);
  const before = JSON.stringify(read());
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch { /* storage blocked */ }
  if (JSON.stringify(read()) !== before) { try { window.dispatchEvent(new CustomEvent('fale:policy')); } catch { /* tests */ } }
  return read();
}

let watching = false;
/** Ask the browser for the company settings (at start; again when the IT changes them). Never throws, never waits long. */
export async function loadPolicy(ms = 1500) {
  if (fromShell() !== undefined) return read(); // Windows program: the file on the PC decides, read at program start
  const api = apiOf();
  if (!api) return store(null);
  try {
    const cfg = await Promise.race([api.getManagedConfiguration([...POLICY_KEYS, 'internet']), new Promise(r => setTimeout(() => r(undefined), ms))]);
    if (cfg === undefined) return read(); // no answer in time: keep the last one
    if (!watching && typeof api.addEventListener === 'function') {
      watching = true;
      api.addEventListener('managedconfigurationchange', () => { loadPolicy(ms).catch(() => {}); });
    }
    return store(cfg);
  } catch {
    return read();
  }
}

/** Short German labels of what the company switched off (for the „Ich“ screen). */
export function blockedLabels() {
  const p = read() || {};
  const names = { cloudAi: 'Cloud-KI', post: 'Brief per Post und Fax', cloudShare: 'Teilen und Übertragen über das Internet', account: 'FaLe-Konto' };
  return POLICY_KEYS.filter(k => p[k] === false).map(k => names[k]);
}
