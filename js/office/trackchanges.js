// Änderungen nachverfolgen: Einfügungen (<ins class="tc">) und Löschungen (<del class="tc">) mit Autor und Zeit,
// einzeln oder alle annehmen/ablehnen. Gelöschter Text bleibt durchgestrichen sichtbar, bis die Änderung angenommen wird.
// Formatänderungen werden nicht nachverfolgt.

const isTc = (el, tag) => el && el.nodeType === 1 && el.tagName === tag && el.classList.contains('tc');
const BLOCK = /^(P|H[1-6]|PRE|LI|DIV|BLOCKQUOTE|TD|TH|UL|OL|TABLE|TR)$/;
const insOf = n => { const el = n && (n.nodeType === 1 ? n : n.parentElement); const x = el && el.closest('ins.tc'); return x; };
const delOf = n => { const el = n && (n.nodeType === 1 ? n : n.parentElement); const x = el && el.closest('del.tc'); return x; };

export function createTracker(ed, { author = () => 'Ich', onChange } = {}) {
  let enabled = false;
  let composing = null;

  const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  function mk(tag) {
    const el = document.createElement(tag);
    el.className = 'tc';
    el.setAttribute('data-author', author());
    el.setAttribute('data-date', now());
    return el;
  }
  const mine = el => el && el.getAttribute('data-author') === author();
  const sel = () => getSelection();
  function place(node, off) { const r = document.createRange(); r.setStart(node, off); r.collapse(true); const s = sel(); s.removeAllRanges(); s.addRange(r); }

  /** Mark the range as deleted: own insertions vanish, other text gets wrapped in <del>. Returns the collapse point. */
  function markDeleted(range, backward = true) {
    const texts = [];
    const root = range.commonAncestorContainer;
    if (root.nodeType === 3) texts.push(root);
    else {
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) {
        if (!range.intersectsNode(n)) continue;
        if (n.nodeType === 3) texts.push(n);
        else if (n.tagName === 'IMG' || (n.tagName === 'SUP' && n.classList.contains('fn')) || (n.tagName === 'SPAN' && n.classList.contains('mf'))) texts.push(n);
      }
    }
    let first = null, last = null;
    const sc = range.startContainer, so = range.startOffset, ec = range.endContainer, eo = range.endOffset;
    for (let n of texts) {
      if (!ed.contains(n)) continue;
      if (n.nodeType === 3) {
        let a = n === sc ? so : 0, b = n === ec ? eo : n.length;
        if (sc.nodeType === 1 && sc.contains(n) && sc !== n && !range.isPointInRange(n, 0)) continue;
        if (a >= b) continue;
        if (delOf(n)) { first = first || n; last = n; continue; }
        if (b < n.length) n.splitText(b);
        if (a > 0) { n = n.splitText(a); }
      }
      const ins = insOf(n);
      if (ins && mine(ins)) {
        const anchor = document.createTextNode('');
        n.replaceWith(anchor);
        if (!ins.textContent && !ins.querySelector('img')) { ins.replaceWith(anchor); }
        first = first || anchor; last = anchor;
        continue;
      }
      // merge with an adjacent own deletion
      const prev = n.previousSibling, next = n.nextSibling;
      if (isTc(prev, 'DEL') && mine(prev)) { prev.appendChild(n); }
      else if (isTc(next, 'DEL') && mine(next)) { next.insertBefore(n, next.firstChild); }
      else { const d = mk('del'); n.replaceWith(d); d.appendChild(n); }
      first = first || n; last = n;
    }
    // collapse point
    const pt = backward ? first : last;
    if (!pt) return null;
    const d = delOf(pt);
    if (d) return backward ? { node: d.parentNode, off: Array.prototype.indexOf.call(d.parentNode.childNodes, d) } : { node: d.parentNode, off: Array.prototype.indexOf.call(d.parentNode.childNodes, d) + 1 };
    if (pt.nodeType === 3) return { node: pt, off: backward ? 0 : pt.length };
    return { node: pt.parentNode, off: Array.prototype.indexOf.call(pt.parentNode.childNodes, pt) + (backward ? 0 : 1) };
  }

  function insertText(text) {
    const s = sel();
    if (!s.rangeCount) return;
    let r = s.getRangeAt(0);
    if (!r.collapsed) { const p = markDeleted(r, false); if (p) place(p.node, p.off); r = s.getRangeAt(0); }
    let node = r.startContainer, off = r.startOffset;
    // never type inside a deletion: move behind it
    const d = delOf(node);
    if (d) { node = d.parentNode; off = Array.prototype.indexOf.call(node.childNodes, d) + 1; }
    const ins = insOf(node);
    if (ins && mine(ins) && node.nodeType === 3) {
      node.insertData(off, text);
      place(node, off + text.length);
      return;
    }
    // directly after/before an own insertion element?
    if (node.nodeType === 3 && off === node.length && isTc(node.nextSibling, 'INS') && mine(node.nextSibling) && false) { /* keep caret semantics simple */ }
    const prevSib = node.nodeType === 3 ? (off === 0 ? node.previousSibling : null) : node.childNodes[off - 1];
    if (isTc(prevSib, 'INS') && mine(prevSib) && prevSib.lastChild && prevSib.lastChild.nodeType === 3) {
      const t = prevSib.lastChild; t.appendData(text); place(t, t.length); return;
    }
    const el = mk('ins');
    const t = document.createTextNode(text);
    el.appendChild(t);
    if (node.nodeType === 3) {
      const after = off < node.length ? node.splitText(off) : null;
      if (after) after.before(el); else node.after(el);
    } else {
      const ref = node.childNodes[off] || null;
      if (ref && ref.nodeName === 'BR' && node.childNodes.length === 1) { node.insertBefore(el, ref); ref.remove(); }
      else node.insertBefore(el, ref);
    }
    place(t, t.length);
  }

  function charRange(backward) {
    const s = sel();
    const r = s.getRangeAt(0).cloneRange();
    try {
      s.modify('extend', backward ? 'backward' : 'forward', 'character');
    } catch { return null; }
    const nr = s.getRangeAt(0).cloneRange();
    s.removeAllRanges(); s.addRange(r);
    if (nr.collapsed) return null;
    // do not cross block boundaries (paragraph marks are not tracked)
    const blk = n => { let x = n.nodeType === 1 ? n : n.parentElement; while (x && x !== ed && !BLOCK.test(x.tagName)) x = x.parentElement; return x; };
    if (blk(nr.startContainer) !== blk(nr.endContainer)) return 'boundary';
    return nr;
  }

  function onBeforeInput(e) {
    if (!enabled) return;
    const t = e.inputType;
    const s = sel();
    if (!s.rangeCount || !ed.contains(s.anchorNode)) return;
    if (t === 'insertCompositionText') return; // handled at compositionend
    if (t === 'insertText' || t === 'insertReplacementText' || (t === 'insertFromPaste' && e.dataTransfer == null && e.data)) {
      const data = e.data != null ? e.data : (e.dataTransfer && e.dataTransfer.getData('text/plain')) || '';
      if (!data) return;
      e.preventDefault();
      insertText(data);
      onChange && onChange();
      return;
    }
    if (/^delete/.test(t)) {
      e.preventDefault();
      const backward = /Backward/.test(t);
      let r = s.getRangeAt(0);
      if (r.collapsed) {
        if (/Word/.test(t)) { try { s.modify('extend', backward ? 'backward' : 'forward', 'word'); } catch {} r = s.getRangeAt(0); if (r.collapsed) return; }
        else if (/Line|SoftLine|HardLine/.test(t)) { try { s.modify('extend', backward ? 'backward' : 'forward', 'lineboundary'); } catch {} r = s.getRangeAt(0); if (r.collapsed) return; }
        else {
          // skip over already deleted characters
          for (let guard = 0; guard < 200; guard++) {
            const cr = charRange(backward);
            if (!cr || cr === 'boundary') return;
            const n = backward ? cr.startContainer : cr.endContainer;
            if (delOf(n) && delOf(backward ? cr.endContainer : cr.startContainer)) {
              const d = delOf(n);
              const p = d.parentNode, i = Array.prototype.indexOf.call(p.childNodes, d);
              place(p, backward ? i : i + 1);
              continue;
            }
            r = cr; break;
          }
        }
      }
      const p = markDeleted(r, backward);
      if (p) place(p.node, p.off);
      onChange && onChange();
      return;
    }
    if (t === 'insertParagraph' || t === 'insertLineBreak') {
      const r = s.getRangeAt(0);
      if (!r.collapsed) { const p = markDeleted(r, false); if (p) place(p.node, p.off); }
      return; // the split itself is not tracked
    }
    if (t === 'deleteByCut' || t === 'deleteByDrag') {
      e.preventDefault();
      const p = markDeleted(s.getRangeAt(0), true);
      if (p) place(p.node, p.off);
      onChange && onChange();
    }
  }
  function onCompStart() {
    if (!enabled) return;
    const s = sel();
    if (!s.rangeCount) return;
    const r = s.getRangeAt(0);
    if (!r.collapsed) { const p = markDeleted(r, false); if (p) place(p.node, p.off); }
    const n = s.anchorNode;
    composing = n && n.nodeType === 3 ? { node: n, before: n.nodeValue, off: s.anchorOffset } : null;
  }
  function onCompEnd() {
    if (!enabled || !composing) { composing = null; return; }
    const c = composing; composing = null;
    const n = c.node;
    if (!n.isConnected || insOf(n)) return;
    const a = c.before, b = n.nodeValue;
    let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
    let j = 0; while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
    const removed = a.slice(i, a.length - j), added = b.slice(i, b.length - j);
    if (!removed && !added) return;
    // rebuild: prefix + <del>removed</del> + <ins>added</ins> + suffix
    n.nodeValue = b.slice(0, i);
    let ref = n;
    if (removed) { const d = mk('del'); d.textContent = removed; ref.after(d); ref = d; }
    let insT = null;
    if (added) { const x = mk('ins'); insT = document.createTextNode(added); x.appendChild(insT); ref.after(x); ref = x; }
    const suffix = b.slice(b.length - j);
    if (suffix) ref.after(document.createTextNode(suffix));
    if (insT) place(insT, insT.length);
    onChange && onChange();
  }
  ed.addEventListener('beforeinput', onBeforeInput);
  ed.addEventListener('compositionstart', onCompStart);
  ed.addEventListener('compositionend', onCompEnd);

  // ---- review ----
  const all = () => Array.from(ed.querySelectorAll('ins.tc, del.tc')).filter(x => !x.parentElement.closest('ins.tc, del.tc'));
  function accept(el) {
    if (el.tagName === 'INS') el.replaceWith(...el.childNodes);
    else el.remove();
  }
  function reject(el) {
    if (el.tagName === 'DEL') el.replaceWith(...el.childNodes);
    else el.remove();
  }
  /** Changes touching the selection (or at the caret). */
  function atSelection() {
    const s = sel();
    if (!s.rangeCount) return [];
    const r = s.getRangeAt(0);
    const list = all().filter(x => r.intersectsNode(x));
    if (list.length) return list;
    const n = insOf(r.startContainer) || delOf(r.startContainer);
    return n ? [n] : [];
  }
  function list() {
    return all().map(el => ({ el, kind: el.tagName === 'INS' ? 'ins' : 'del', author: el.getAttribute('data-author') || '', date: el.getAttribute('data-date') || '', text: el.textContent || (el.querySelector('img') ? '[Bild]' : '') }));
  }

  return {
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; },
    list, all, accept, reject, atSelection,
    acceptAll() { all().forEach(accept); ed.normalize(); },
    rejectAll() { all().forEach(reject); ed.normalize(); },
    insertText, markDeleted,
    destroy() { ed.removeEventListener('beforeinput', onBeforeInput); ed.removeEventListener('compositionstart', onCompStart); ed.removeEventListener('compositionend', onCompEnd); },
  };
}
