// „Zuletzt benutzt“ on the Werkzeuge page: the last tools opened on this device (only ids, only on this device).
const KEY = 'fale-tools-recent';
const MAX = 8;

export function recentTools() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter(x => typeof x === 'string' && /^[\w-]{1,40}$/.test(x)).slice(0, MAX) : [];
  } catch { return []; }
}

export function noteTool(id) {
  if (!id || !/^[\w-]{1,40}$/.test(id)) return;
  const list = [id, ...recentTools().filter(x => x !== id)].slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}

export function clearRecentTools() { try { localStorage.removeItem(KEY); } catch {} }
