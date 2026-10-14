// Local list of the links and signature requests created on THIS device (localStorage).
// It holds what is needed to show status, copy the link again or revoke it: object id, owner
// capability, link key, expiry. Nothing of this is synced anywhere.
const KEY = 'fale-shares-v1';
const MAX = 200;

function read() {
  try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a.filter(x => x && x.id && x.kind) : []; } catch { return []; }
}
function write(list) {
  const keep = Date.now() - 14 * 864e5; // forget entries two weeks after they expired
  try { localStorage.setItem(KEY, JSON.stringify(list.filter(x => !x.expiresAt || Date.parse(x.expiresAt) > keep).slice(0, MAX))); } catch { /* storage full / blocked */ }
  try { window.dispatchEvent(new CustomEvent('fale:shares-changed')); } catch {}
}

export function listEntries(kind = null) {
  return read().filter(x => !kind || x.kind === kind).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
export function getEntry(id) { return read().find(x => x.id === id) || null; }
export function putEntry(entry) { write([entry, ...read().filter(x => x.id !== entry.id)]); return entry; }
export function patchEntry(id, patch) {
  const list = read();
  const e = list.find(x => x.id === id);
  if (!e) return null;
  Object.assign(e, patch);
  write(list);
  return e;
}
export function removeEntry(id) { write(read().filter(x => x.id !== id)); }
export const isExpired = e => !!(e && e.expiresAt && Date.parse(e.expiresAt) <= Date.now());
