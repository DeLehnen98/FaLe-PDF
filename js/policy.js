// Firmen-Einstellungen: the IT of a company can switch off everything that goes over the internet, for all PCs at
// once, with the browser's own enterprise policies – no installer and no server of ours involved:
//   1. Edge/Chrome policy WebAppInstallForceList   → installs FaLe PDF on every PC (GPO, Intune, …)
//   2. Edge/Chrome policy ManagedConfigurationPerOrigin → a small JSON file on the company's own server, e.g.
//        { "cloudAi": false, "post": false, "cloudShare": false }
//      which the app reads here with the Managed Configuration API (only for force-installed web apps).
// Keys (all optional; only `false` switches something off – anything else leaves it as it is):
//   cloudAi     Cloud-KI (explanations, translations, assistant) – the AI stays hidden and cannot be switched on
//   post        Brief per Post and Fax (sends the PDF to the print/fax service)
//   cloudShare  Sicher teilen, Dateien anfordern, Unterschrift anfordern, Übertragen (encrypted uploads)
// The last answer is kept on the device (works offline, readable synchronously); it is cleared as soon as the
// browser reports no policy any more. Dependency-free so that every module can ask `blocked('post')` cheaply.
const KEY = 'fale-policy';
export const POLICY_KEYS = ['cloudAi', 'post', 'cloudShare'];

function read() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; }
}

/** The active company settings ({cloudAi:false, …}) or null when the PC is not managed. */
export function policy() { return read(); }

/** Is this feature switched off by the company? */
export function blocked(name) { const p = read(); return !!p && p[name] === false; }

function apiOf() {
  try {
    const n = typeof navigator !== 'undefined' ? navigator : null;
    if (n && n.managed && typeof n.managed.getManagedConfiguration === 'function') return n.managed;
    if (n && n.device && typeof n.device.getManagedConfiguration === 'function') return n.device; // older name
  } catch { /* no navigator */ }
  return null;
}

function store(cfg) {
  const clean = {};
  for (const k of POLICY_KEYS) if (cfg && cfg[k] === false) clean[k] = false;
  const before = JSON.stringify(read());
  try {
    if (Object.keys(clean).length) localStorage.setItem(KEY, JSON.stringify(clean));
    else localStorage.removeItem(KEY);
  } catch { /* storage blocked */ }
  if (JSON.stringify(read()) !== before) { try { window.dispatchEvent(new CustomEvent('fale:policy')); } catch { /* tests */ } }
  return read();
}

let watching = false;
/** Ask the browser for the company settings (at start; again when the IT changes them). Never throws, never waits long. */
export async function loadPolicy(ms = 1500) {
  const api = apiOf();
  if (!api) return store(null);
  try {
    const cfg = await Promise.race([api.getManagedConfiguration(POLICY_KEYS), new Promise(r => setTimeout(() => r(undefined), ms))]);
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
  const names = { cloudAi: 'Cloud-KI', post: 'Brief per Post und Fax', cloudShare: 'Teilen und Übertragen über das Internet' };
  return POLICY_KEYS.filter(k => p[k] === false).map(k => names[k]);
}
