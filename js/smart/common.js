// Shared helpers for the assistants (Briefkasten, Dokumenten-Gedächtnis, Steuer-Belege, Familien-Ordner):
// a separate IndexedDB database "falepdf-smart" (so the document database never needs a version bump),
// lazy CSS, small formatting helpers. Everything stays on this device.
import { h, esc } from '../ui.js';
import { oicon } from '../office/kinds.js';

export { h, esc, oicon };

let cssDone = false;
export function ensureSmartCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('../../css/smart.css', import.meta.url).href;
  document.head.appendChild(l);
}

// ------------------------------------------------------------------ IndexedDB "falepdf-smart"
const NAME = 'falepdf-smart';
const VERSION = 1;
let dbp = null;
export const STORES = ['letters', 'receipts', 'idxdocs', 'terms', 'facts', 'meta'];
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('letters')) d.createObjectStore('letters', { keyPath: 'id' }).createIndex('docId', 'docId');
      if (!d.objectStoreNames.contains('receipts')) { const s = d.createObjectStore('receipts', { keyPath: 'id' }); s.createIndex('year', 'year'); s.createIndex('docId', 'docId'); }
      if (!d.objectStoreNames.contains('idxdocs')) d.createObjectStore('idxdocs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('terms')) d.createObjectStore('terms', { keyPath: 't' });
      if (!d.objectStoreNames.contains('facts')) d.createObjectStore('facts', { keyPath: 'id' }).createIndex('docId', 'docId');
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => { const d = req.result; d.onversionchange = () => { d.close(); dbp = null; }; resolve(d); };
    req.onerror = () => { dbp = null; reject(req.error); };
    req.onblocked = () => { dbp = null; reject(new Error('blocked')); };
  });
  return dbp;
}
export const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
export async function stx(stores, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(stores, mode);
    let out;
    Promise.resolve(fn(t)).then(r => { out = r; }, e => { try { t.abort(); } catch {} reject(e); });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('abort'));
  });
}
export const sdb = {
  get: (store, key) => stx(store, 'readonly', t => reqP(t.objectStore(store).get(key))),
  all: store => stx(store, 'readonly', t => reqP(t.objectStore(store).getAll())),
  byIndex: (store, index, key) => stx(store, 'readonly', t => reqP(t.objectStore(store).index(index).getAll(key))),
  put: (store, rec) => stx(store, 'readwrite', t => { t.objectStore(store).put(rec); }).then(() => rec),
  del: (store, key) => stx(store, 'readwrite', t => { t.objectStore(store).delete(key); }),
  clear: store => stx(store, 'readwrite', t => { t.objectStore(store).clear(); }),
  meta: async (key, def = null) => { const r = await stx('meta', 'readonly', t => reqP(t.objectStore('meta').get(key))).catch(() => null); return r ? r.value : def; },
  setMeta: (key, value) => stx('meta', 'readwrite', t => { t.objectStore('meta').put({ key, value }); }),
};
/** Wipe all assistant data (used by "Daten löschen"). */
export async function wipeSmart() { for (const s of STORES) await sdb.clear(s).catch(() => {}); }

// ------------------------------------------------------------------ change events between the assistant screens
const listeners = new Set();
export function onSmartChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emitSmart(what = '*') { listeners.forEach(fn => { try { fn(what); } catch {} }); try { window.dispatchEvent(new CustomEvent('fale:smart', { detail: what })); } catch {} }

// ------------------------------------------------------------------ formatting
export const pad = n => String(n).padStart(2, '0');
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export function money(v) { return v == null || !Number.isFinite(+v) ? '–' : (+v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '\u00a0€'; } // no line break before €
export function parseMoney(s) {
  const t = String(s ?? '').replace(/[€\s]|eur/gi, '');
  if (!t) return null;
  const n = /,\d{1,2}$/.test(t) ? parseFloat(t.replace(/\./g, '').replace(',', '.')) : parseFloat(t.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
export function deDate(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; }
export function daysUntil(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(); const a = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.round((new Date(y, m - 1, d) - a) / 86400000);
}
export function relDays(n) {
  if (n == null) return '';
  if (n === 0) return 'heute';
  if (n === 1) return 'morgen';
  if (n === -1) return 'seit gestern';
  if (n < 0) return `seit ${-n} Tagen`;
  if (n < 14) return `in ${n} Tagen`;
  if (n < 60) return `in ${Math.round(n / 7)} Wochen`;
  return `in ${Math.round(n / 30)} Monaten`;
}
export const lsGet = (k, d = null) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
export const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} };

/** Find or create a folder by path ["Post", "Rechnungen"] (organize.js supports one sub level). */
export async function ensureFolderPath(names) {
  const org = await import('../extras/organize.js');
  let parent = null;
  let folders = await org.listFolders();
  for (const raw of names.slice(0, 2)) {
    const name = String(raw || '').trim().slice(0, 60);
    if (!name) continue;
    let f = folders.find(x => (x.parent || null) === parent && x.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'));
    if (!f) { f = await org.createFolder(name, parent); folders = await org.listFolders(); }
    parent = f.id;
  }
  return parent;
}
/** Find or create tags by name → ids. */
export async function ensureTags(names) {
  const org = await import('../extras/organize.js');
  const ids = [];
  for (const raw of names) {
    const name = String(raw || '').trim().slice(0, 30);
    if (!name) continue;
    const tags = await org.listTags();
    let t = tags.find(x => x.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'));
    if (!t) t = await org.createTag(name);
    if (t && !ids.includes(t.id)) ids.push(t.id);
  }
  return ids;
}

/** A labelled, editable field row (all values via value/textContent – never HTML). */
export function fieldRow({ id, label, value = '', type = 'text', placeholder = '', hint = '', options = null, wide = false, mono = false }) {
  const el = h(`<label class="sm-field${wide ? ' wide' : ''}"><span class="sm-field-label"></span></label>`);
  el.querySelector('.sm-field-label').textContent = label;
  let input;
  if (options) {
    input = document.createElement('select');
    input.className = 'select';
    for (const [v, l] of options) { const o = document.createElement('option'); o.value = v; o.textContent = l; input.appendChild(o); }
  } else if (type === 'textarea') {
    input = document.createElement('textarea');
    input.className = 'input';
    input.rows = 3;
  } else {
    input = document.createElement('input');
    input.className = 'input';
    input.type = type;
  }
  input.name = id;
  input.dataset.field = id;
  if (placeholder) input.placeholder = placeholder;
  if (mono) input.classList.add('sm-mono');
  input.value = value == null ? '' : String(value);
  input.setAttribute('data-no-i18n', '');
  el.appendChild(input);
  if (hint) { const p = document.createElement('span'); p.className = 'sm-hint'; p.textContent = hint; el.appendChild(p); }
  return el;
}

/** Copy text to the clipboard (with a fallback for older WebViews). */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}
