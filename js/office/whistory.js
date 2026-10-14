// Eigener Rückgängig-/Wiederholen-Verlauf für den Dokumenteditor: Momentaufnahmen des Editor-HTML
// (ohne Seitenumbruch-Markierungen, große Bilder nur einmal im Speicher) samt Cursorposition.
// So lassen sich auch Änderungen rückgängig machen, die nicht über execCommand laufen
// (Tabellen, Formatvorlagen, Nachverfolgung, Abschnitte …).
import { cleanEditorHtml } from './pagelayout.js';

const MAX = 100;

function nodePath(root, node) {
  const path = [];
  while (node && node !== root) {
    const p = node.parentNode;
    if (!p) return null;
    path.unshift(Array.prototype.indexOf.call(p.childNodes, node));
    node = p;
  }
  return node === root ? path : null;
}
function nodeAt(root, path) {
  let n = root;
  for (const i of path || []) { if (!n.childNodes[i]) return null; n = n.childNodes[i]; }
  return n;
}

export function createHistory(ed, { onRestore } = {}) {
  const undo = [], redo = [];
  const images = new Map(); // data URL → token
  const byToken = new Map();
  let lastAt = 0, lastKind = '', lastHtml = null;

  const pack = html => html.replace(/src="(data:[^"]{400,})"/g, (m, u) => {
    let t = images.get(u);
    if (!t) { t = `fale-img:${images.size + 1}`; images.set(u, t); byToken.set(t, u); }
    return `src="${t}"`;
  });
  const unpack = html => html.replace(/src="(fale-img:\d+)"/g, (m, t) => `src="${byToken.get(t) || ''}"`);

  function selState() {
    const s = getSelection();
    if (!s.rangeCount || !ed.contains(s.anchorNode)) return null;
    const r = s.getRangeAt(0);
    return { sc: nodePath(ed, r.startContainer), so: r.startOffset, ec: nodePath(ed, r.endContainer), eo: r.endOffset };
  }
  function state() { return { html: pack(cleanEditorHtml(ed)), sel: selState() }; }
  function apply(st) {
    ed.innerHTML = unpack(st.html);
    if (st.sel) {
      try {
        const a = nodeAt(ed, st.sel.sc), b = nodeAt(ed, st.sel.ec);
        if (a && b) {
          const r = document.createRange();
          r.setStart(a, Math.min(st.sel.so, a.nodeType === 3 ? a.length : a.childNodes.length));
          r.setEnd(b, Math.min(st.sel.eo, b.nodeType === 3 ? b.length : b.childNodes.length));
          const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        }
      } catch {}
    }
    lastHtml = st.html;
    onRestore && onRestore();
  }

  return {
    /** Record the state before a change. kind groups typing bursts ("type"/"del") – other kinds always record. */
    capture(kind = 'op') {
      const now = Date.now();
      if ((kind === 'type' || kind === 'del') && kind === lastKind && now - lastAt < 1200) { lastAt = now; return; }
      lastAt = now; lastKind = kind;
      const st = state();
      if (undo.length && undo[undo.length - 1].html === st.html) return;
      undo.push(st);
      if (undo.length > MAX) undo.shift();
      redo.length = 0;
    },
    /** Break the typing group (e.g. after the caret moved). */
    cut() { lastKind = ''; },
    undo() {
      if (!undo.length) return false;
      const cur = state();
      let prev = undo.pop();
      while (prev && prev.html === cur.html && undo.length) prev = undo.pop();
      if (!prev || prev.html === cur.html) return false;
      redo.push(cur);
      lastKind = '';
      apply(prev);
      return true;
    },
    redo() {
      if (!redo.length) return false;
      const cur = state();
      undo.push(cur);
      lastKind = '';
      apply(redo.pop());
      return true;
    },
    get canUndo() { return undo.length > 0; },
    get canRedo() { return redo.length > 0; },
    clear() { undo.length = 0; redo.length = 0; lastKind = ''; void lastHtml; },
  };
}
