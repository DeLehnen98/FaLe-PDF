// Formatierung in der Textverarbeitung: Formatvorlagen anwenden/ändern, Absatz- und Zeichenformat,
// Groß-/Kleinschreibung, Formatierung löschen, Format übertragen, Listen (mehrstufig, Aufzählungszeichen).
import { $, $$, esc, openDialog } from '../ui.js';
import { FONTS, fontCss, fontNameOf } from './fonts.js';
import { STYLE_ORDER, STYLE_BLOCK, STYLE_CLASSES, styleOfBlock, normalizeStyles, DEFAULT_STYLES } from './docstyles.js';
import { BULLETS } from './docmodel.js';

export const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];
const LEAF = /^(P|H[1-6]|PRE|LI|DIV|BLOCKQUOTE)$/;
const BLOCKISH = /^(P|H[1-6]|PRE|UL|OL|LI|TABLE|DIV|BLOCKQUOTE|HR)$/;
const pt = px => Math.round(parseFloat(px || 0) * 0.75 * 10) / 10;
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const de = n => String(Math.round(n * 100) / 100).replace('.', ',');

function hasBlockChild(el) { for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (BLOCKISH.test(c.tagName)) return true; return false; }
function hasOwnInline(el) {
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3 && c.nodeValue.trim()) return true;
    if (c.nodeType === 1 && !BLOCKISH.test(c.tagName)) return true;
  }
  return false;
}
export function isLeafBlock(el) {
  if (!el || el.nodeType !== 1 || !LEAF.test(el.tagName)) return false;
  if (el.closest('[contenteditable="false"]')) return false;
  if (el.tagName === 'LI') return !el.querySelector(':scope > p, :scope > h1, :scope > h2, :scope > h3, :scope > div') && (hasOwnInline(el) || !el.children.length || !hasBlockChild(el));
  if (el.tagName === 'DIV' || el.tagName === 'BLOCKQUOTE') return !hasBlockChild(el);
  return true;
}
export function blockOf(ed, node) {
  let n = node && (node.nodeType === 1 ? node : node.parentElement);
  while (n && n !== ed) { if (isLeafBlock(n)) return n; n = n.parentElement; }
  return null;
}
/** Leaf blocks touched by the range (or the caret's block). */
export function blocksIn(ed, range) {
  if (!range) return [];
  if (range.collapsed) { const b = blockOf(ed, range.startContainer); return b ? [b] : []; }
  const out = [];
  const a = blockOf(ed, range.startContainer);
  for (const el of ed.querySelectorAll('p,h1,h2,h3,h4,h5,h6,pre,li,div,blockquote')) {
    if (!isLeafBlock(el)) continue;
    if (el === a || range.intersectsNode(el)) {
      // a range ending at offset 0 of a block does not include that block
      if (range.endContainer === el && range.endOffset === 0 && el !== a) continue;
      out.push(el);
    }
  }
  return out;
}

// ---------------- Formatvorlagen ----------------
function retag(el, tag) {
  if (el.tagName.toLowerCase() === tag) return el;
  const n = document.createElement(tag);
  for (const a of Array.from(el.attributes)) n.setAttribute(a.name, a.value);
  while (el.firstChild) n.appendChild(el.firstChild);
  el.replaceWith(n);
  return n;
}
/** Turn a <blockquote> into p.quote paragraphs so single paragraphs can get other styles. */
function flattenQuote(bq) {
  const kids = Array.from(bq.childNodes);
  const out = [];
  let inline = null;
  for (const k of kids) {
    if (k.nodeType === 1 && BLOCKISH.test(k.tagName)) {
      inline = null;
      if (k.tagName === 'P') k.classList.add('quote');
      out.push(k);
    } else {
      if (k.nodeType === 3 && !k.nodeValue.trim() && !inline) continue;
      if (!inline) { inline = document.createElement('p'); inline.className = 'quote'; out.push(inline); }
      inline.appendChild(k);
    }
  }
  bq.replaceWith(...out);
  return out;
}
export function applyStyle(ed, blocks, id) {
  const [tag, cls] = STYLE_BLOCK[id] || STYLE_BLOCK.normal;
  const res = [];
  for (let b of blocks) {
    if (!b.isConnected) continue;
    const bq = b.tagName === 'BLOCKQUOTE' ? b : b.closest('blockquote');
    if (bq && ed.contains(bq)) {
      const parts = flattenQuote(bq);
      if (b === bq) { parts.forEach(p => res.push(...applyStyle(ed, [p], id))); continue; }
    }
    if (b.tagName === 'LI') {
      STYLE_CLASSES.forEach(c => b.classList.remove(c));
      if (cls && id !== 'title') b.classList.add(cls);
      res.push(b);
      continue;
    }
    if (b.tagName === 'DIV' && b.parentElement !== ed && b.closest('td,th,.textbox,.sect') == null && tag === 'p' && !cls) { res.push(b); continue; }
    if (b.tagName === 'PRE' && tag !== 'pre') { b.innerHTML = esc(b.textContent).replace(/\n/g, '<br>') || '<br>'; }
    b = retag(b, tag);
    STYLE_CLASSES.forEach(c => b.classList.remove(c));
    if (cls) b.classList.add(cls);
    if (!b.getAttribute('class')) b.removeAttribute('class');
    if (!b.firstChild) b.appendChild(document.createElement('br'));
    res.push(b);
  }
  return res;
}
export function styleIdOf(block) { return block ? styleOfBlock(block) : 'normal'; }

export function styleModifyDialog(styles, id) {
  const S = normalizeStyles(styles);
  const s = S[id];
  const fontOpts = `<option value="">(wie Standard)</option>` + FONTS.map(f => `<option value="${esc(f.name)}" ${s.font === f.name ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
  return openDialog({
    title: `Formatvorlage ändern: ${s.name}`, wide: true,
    body: `<div class="wf-dlg">
      <div class="field-row"><label class="field"><span class="field-label">Schriftart</span><select class="select" name="font">${fontOpts}</select></label>
        <label class="field"><span class="field-label">Größe (pt)</span><input class="input" name="size" inputmode="decimal" value="${s.size ? de(s.size) : ''}" placeholder="wie Standard"></label></div>
      <div class="field-row"><label class="field"><span class="field-label">Farbe</span><input class="input" type="color" name="color" value="${s.color || '#1A1A1A'}"></label>
        <label class="field"><span class="field-label">Ausrichtung</span><select class="select" name="align">${[['', 'Links (Standard)'], ['center', 'Zentriert'], ['right', 'Rechts'], ['justify', 'Blocksatz']].map(([k, l]) => `<option value="${k}" ${(s.align || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <div class="check-row"><label class="check"><input type="checkbox" name="b" ${s.b ? 'checked' : ''}> Fett</label><label class="check"><input type="checkbox" name="i" ${s.i ? 'checked' : ''}> Kursiv</label><label class="check"><input type="checkbox" name="u" ${s.u ? 'checked' : ''}> Unterstrichen</label><label class="check"><input type="checkbox" name="keepNext" ${s.keepNext ? 'checked' : ''}> Nicht vom nächsten Absatz trennen</label></div>
      <div class="field-row three"><label class="field"><span class="field-label">Abstand vor (pt)</span><input class="input" name="before" inputmode="decimal" value="${de(s.before || 0)}"></label>
        <label class="field"><span class="field-label">Abstand nach (pt)</span><input class="input" name="after" inputmode="decimal" value="${de(s.after || 0)}"></label>
        <label class="field"><span class="field-label">Zeilenabstand</span><input class="input" name="line" inputmode="decimal" value="${de(s.line || 1.15)}"></label></div>
      <p class="hint">Die Änderung gilt für alle Absätze mit der Formatvorlage „${esc(s.name)}“ und wird in der Word-Datei gespeichert.</p></div>`,
    actions: [{ label: 'Zurücksetzen', value: 'reset' }, { label: 'Abbrechen', value: 'cancel' }, { label: 'Übernehmen', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => ({
      collect: () => {
        const v = n => $(`[name=${n}]`, dlg);
        return {
          font: v('font').value || null, size: num(v('size').value), color: v('color').value.toUpperCase(), align: v('align').value || null,
          b: v('b').checked, i: v('i').checked, u: v('u').checked, keepNext: v('keepNext').checked,
          before: num(v('before').value) ?? 0, after: num(v('after').value) ?? 0, line: Math.max(0.5, Math.min(5, num(v('line').value) || 1.15)),
        };
      },
    }),
  }).then(r => {
    if (r.value === 'reset') return { ...DEFAULT_STYLES[id] };
    if (r.value !== 'ok' || !r.data) return null;
    const d = r.data;
    if (id === 'normal' && !d.font) d.font = 'Arial';
    if (id === 'normal' && !d.size) d.size = 11;
    if (d.color === '#1A1A1A' && !s.color) d.color = null;
    return { ...s, ...d };
  });
}

/** Style of a block as it currently looks (for "Formatvorlage an Markierung anpassen"). */
export function styleFromBlock(block, base) {
  const cs = getComputedStyle(block);
  const first = block.querySelector('span,b,strong,i,em,font') || block;
  const fcs = getComputedStyle(first);
  return {
    ...base,
    font: fontNameOf(fcs.fontFamily) || base.font, size: pt(fcs.fontSize), color: rgbHex(fcs.color),
    b: +fcs.fontWeight >= 600, i: fcs.fontStyle === 'italic', before: pt(cs.marginTop), after: pt(cs.marginBottom),
    align: ['center', 'right', 'justify'].includes(cs.textAlign) ? cs.textAlign : null,
    line: Math.round((parseFloat(cs.lineHeight) / parseFloat(cs.fontSize) / 1.13 || base.line || 1.15) * 100) / 100,
  };
}
export function rgbHex(c) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(c || '');
  if (!m) return /^#/.test(c || '') ? c.toUpperCase() : null;
  if (m[4] !== undefined && +m[4] === 0) return null;
  return '#' + [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Remove direct paragraph formatting so blocks follow their style again. */
export function resetDirectFormatting(blocks) {
  for (const b of blocks) {
    ['text-align', 'margin-left', 'margin-right', 'margin-top', 'margin-bottom', 'text-indent', 'line-height'].forEach(p => b.style.removeProperty(p));
    if (!b.getAttribute('style')) b.removeAttribute('style');
  }
}

// ---------------- Absatzformat ----------------
export function paraProps(block) {
  if (!block) return {};
  const cs = getComputedStyle(block);
  const fs = parseFloat(cs.fontSize) || 14.67;
  const lh = parseFloat(cs.lineHeight);
  return {
    align: ['center', 'right', 'justify'].includes(cs.textAlign) ? cs.textAlign : 'left',
    indent: block.style.marginLeft ? pt(cs.marginLeft) : 0,
    indentR: block.style.marginRight ? pt(cs.marginRight) : 0,
    firstLine: pt(cs.textIndent),
    before: pt(cs.marginTop), after: pt(cs.marginBottom),
    line: Number.isFinite(lh) ? Math.round(lh / fs / 1.13 * 100) / 100 : 1.15,
    keepNext: block.hasAttribute('data-keep-next'), pbb: block.hasAttribute('data-pbb'),
  };
}
export function applyPara(blocks, p) {
  for (const b of blocks) {
    const st = b.style;
    if (p.align !== undefined) { if (!p.align || p.align === 'left') st.removeProperty('text-align'); else st.textAlign = p.align; }
    if (p.indent !== undefined) { if (p.indent && b.tagName !== 'LI') st.marginLeft = `${p.indent}pt`; else st.removeProperty('margin-left'); }
    if (p.indentR !== undefined) { if (p.indentR) st.marginRight = `${p.indentR}pt`; else st.removeProperty('margin-right'); }
    if (p.firstLine !== undefined) { if (p.firstLine) st.textIndent = `${p.firstLine}pt`; else st.removeProperty('text-indent'); }
    if (p.before !== undefined) { if (p.before != null) st.marginTop = `${p.before}pt`; else st.removeProperty('margin-top'); }
    if (p.after !== undefined) { if (p.after != null) st.marginBottom = `${p.after}pt`; else st.removeProperty('margin-bottom'); }
    if (p.line !== undefined) { if (p.line) st.lineHeight = String(Math.round(p.line * 1.13 * 1000) / 1000); else st.removeProperty('line-height'); }
    if (p.keepNext !== undefined) b.toggleAttribute('data-keep-next', !!p.keepNext);
    if (p.pbb !== undefined) b.toggleAttribute('data-pbb', !!p.pbb);
    if (!b.getAttribute('style')) b.removeAttribute('style');
  }
}
export const LINE_PRESETS = [[1, '1,0'], [1.15, '1,15'], [1.5, '1,5'], [2, '2,0'], [2.5, '2,5'], [3, '3,0']];

export function paragraphDialog(cur) {
  const hanging = cur.firstLine < 0;
  return openDialog({
    title: 'Absatz', wide: true,
    body: `<div class="wf-dlg">
      <div class="field-row"><label class="field"><span class="field-label">Ausrichtung</span><select class="select" name="align">${[['left', 'Links'], ['center', 'Zentriert'], ['right', 'Rechts'], ['justify', 'Blocksatz']].map(([k, l]) => `<option value="${k}" ${cur.align === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Zeilenabstand (Vielfaches)</span><input class="input" name="line" inputmode="decimal" value="${de(cur.line || 1.15)}" list="wf-lines"><datalist id="wf-lines">${LINE_PRESETS.map(([v]) => `<option value="${de(v)}">`).join('')}</datalist></label></div>
      <h3 class="ps-h">Einzug (cm)</h3>
      <div class="field-row three"><label class="field"><span class="field-label">Links</span><input class="input" name="indent" inputmode="decimal" value="${de(cur.indent / 28.35)}"></label>
        <label class="field"><span class="field-label">Rechts</span><input class="input" name="indentR" inputmode="decimal" value="${de(cur.indentR / 28.35)}"></label>
        <label class="field"><span class="field-label">Sondereinzug</span><select class="select" name="special"><option value="none">Ohne</option><option value="first" ${cur.firstLine > 0 ? 'selected' : ''}>Erste Zeile</option><option value="hanging" ${hanging ? 'selected' : ''}>Hängend</option></select></label></div>
      <label class="field"><span class="field-label">Sondereinzug um (cm)</span><input class="input" name="by" inputmode="decimal" value="${de(Math.abs(cur.firstLine || 0) / 28.35 || 1.25)}"></label>
      <h3 class="ps-h">Abstand (pt)</h3>
      <div class="field-row"><label class="field"><span class="field-label">Vor</span><input class="input" name="before" inputmode="decimal" value="${de(cur.before || 0)}"></label>
        <label class="field"><span class="field-label">Nach</span><input class="input" name="after" inputmode="decimal" value="${de(cur.after || 0)}"></label></div>
      <h3 class="ps-h">Zeilen- und Seitenumbruch</h3>
      <label class="check"><input type="checkbox" name="keepNext" ${cur.keepNext ? 'checked' : ''}> Nicht vom nächsten Absatz trennen</label>
      <label class="check"><input type="checkbox" name="pbb" ${cur.pbb ? 'checked' : ''}> Seitenumbruch oberhalb</label></div>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Übernehmen', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => ({
      collect: () => {
        const v = n => $(`[name=${n}]`, dlg);
        const cm = n => Math.max(-20, Math.min(30, num(v(n).value) || 0)) * 28.35;
        const special = v('special').value, by = Math.max(0, num(v('by').value) || 0) * 28.35;
        let indent = cm('indent');
        let firstLine = special === 'first' ? by : special === 'hanging' ? -by : 0;
        if (firstLine < 0 && indent < -firstLine) indent = -firstLine;
        return {
          align: v('align').value, line: Math.max(0.5, Math.min(5, num(v('line').value) || 1.15)),
          indent: Math.round(indent * 10) / 10, indentR: Math.round(cm('indentR') * 10) / 10, firstLine: Math.round(firstLine * 10) / 10,
          before: Math.max(0, num(v('before').value) || 0), after: Math.max(0, num(v('after').value) || 0),
          keepNext: v('keepNext').checked, pbb: v('pbb').checked,
        };
      },
    }),
  }).then(r => (r.value === 'ok' ? r.data : null));
}

// ---------------- Zeichenformat ----------------
let sentinelN = 0;
/** Wrap the current selection in spans with the given CSS. Collapsed selection: a styled span for the next typed text. */
export function applyInline(ed, css) {
  const s = getSelection();
  if (!s.rangeCount || !ed.contains(s.anchorNode)) return [];
  const r = s.getRangeAt(0);
  const mkSpan = () => { const sp = document.createElement('span'); for (const [k, v] of Object.entries(css)) sp.style.setProperty(k, v); return sp; };
  if (r.collapsed) {
    const sp = mkSpan();
    sp.setAttribute('data-zw', '');
    sp.textContent = '\u200b';
    r.insertNode(sp);
    const nr = document.createRange(); nr.setStart(sp.firstChild, 1); nr.collapse(true);
    s.removeAllRanges(); s.addRange(nr);
    return [sp];
  }
  const sc = r.startContainer, so = r.startOffset, ec = r.endContainer, eo = r.endOffset;
  const root = r.commonAncestorContainer.nodeType === 3 ? r.commonAncestorContainer.parentNode : r.commonAncestorContainer;
  const texts = [];
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (!r.intersectsNode(n) || !n.nodeValue.length) continue;
    if (n.parentElement.closest('[contenteditable="false"]')) continue;
    texts.push(n);
  }
  const out = [];
  let first = null, last = null;
  for (let n of texts) {
    let a = n === sc ? so : 0, b = n === ec ? eo : n.length;
    if (a >= b) continue;
    if (b < n.length) n.splitText(b);
    if (a > 0) n = n.splitText(a);
    const par = n.parentElement;
    // the text node is the whole content of a plain styled span → just set the properties there
    if (par && par.tagName === 'SPAN' && par.childNodes.length === 1 && !par.classList.length) {
      for (const [k, v] of Object.entries(css)) par.style.setProperty(k, v);
      out.push(par);
    } else {
      const sp = mkSpan();
      n.replaceWith(sp); sp.appendChild(n);
      out.push(sp);
    }
    first = first || n; last = n;
  }
  // nested elements inside the touched spans must not override the new values
  if (first) { const nr = document.createRange(); nr.setStart(first, 0); nr.setEnd(last, last.length); s.removeAllRanges(); s.addRange(nr); }
  return out;
}
/** Remove zero-width helpers from styled spans once real text was typed into them. */
export function convertSentinels(ed) {
  const s = getSelection();
  for (const sp of $$('span[data-zw]', ed)) {
    const t = sp.textContent;
    if (t.length > 1 || (t && t !== '\u200b')) {
      const tw = document.createTreeWalker(sp, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) {
        const i = n.nodeValue.indexOf('\u200b');
        if (i < 0) continue;
        const caret = s.rangeCount && s.anchorNode === n ? s.anchorOffset : -1;
        n.deleteData(i, 1);
        if (caret > i) { try { const r = document.createRange(); r.setStart(n, caret - 1); r.collapse(true); s.removeAllRanges(); s.addRange(r); } catch {} }
      }
      sp.removeAttribute('data-zw');
    } else if (!(s.rangeCount && sp.contains(s.anchorNode))) sp.remove();
  }
  return [];
}

export function currentFmt(ed, node) {
  const el = node ? (node.nodeType === 1 ? node : node.parentElement) : null;
  if (!el || !ed.contains(el)) return null;
  const cs = getComputedStyle(el);
  return { font: fontNameOf(cs.fontFamily), size: Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2, color: rgbHex(cs.color), b: +cs.fontWeight >= 600, i: cs.fontStyle === 'italic' };
}
export function growFont(cur, dir) {
  const s = cur || 11;
  if (dir > 0) return SIZES.find(x => x > s + 0.01) || Math.min(400, s + 10);
  const smaller = SIZES.filter(x => x < s - 0.01);
  return smaller.length ? smaller[smaller.length - 1] : Math.max(1, s - 1);
}

const INLINE_FMT = /^(B|STRONG|I|EM|U|S|STRIKE|FONT|SUP|SUB|SMALL|BIG|MARK|TT|CODE)$/;
const SEMANTIC = el => el.tagName === 'A' || (el.classList && (el.classList.contains('cmt') || el.classList.contains('mf') || el.classList.contains('tc')));
const isInline = el => el && el.nodeType === 1 && !BLOCKISH.test(el.tagName) && !/^(TD|TH|TR|TBODY|THEAD|TABLE)$/.test(el.tagName);
/** Move f up to the block level, splitting inline ancestors; semantic ancestors (links, comments, changes) are re-applied inside. */
export function isolate(f, block) {
  while (f.parentElement && f.parentElement !== block && isInline(f.parentElement) && f.parentElement !== block) {
    const p = f.parentElement;
    const after = p.cloneNode(false);
    while (f.nextSibling) after.appendChild(f.nextSibling);
    p.after(f);
    if (after.firstChild) f.after(after);
    if (!p.firstChild || (p.childNodes.length === 1 && p.firstChild.nodeType === 3 && !p.firstChild.nodeValue)) p.remove();
    if (SEMANTIC(p)) { const w = p.cloneNode(false); w.removeAttribute('id'); while (f.firstChild) w.appendChild(f.firstChild); f.appendChild(w); }
  }
}
function stripFormatting(root) {
  for (const el of Array.from(root.querySelectorAll('*')).reverse()) {
    if (el.tagName === 'SUP' && el.classList.contains('fn')) continue;
    if (el.tagName === 'SPAN' && (el.classList.contains('cmt') || el.classList.contains('mf'))) { el.removeAttribute('style'); continue; }
    if (el.tagName === 'SPAN' || INLINE_FMT.test(el.tagName)) { el.replaceWith(...el.childNodes); continue; }
    if (el.tagName === 'A' || el.tagName === 'INS' || el.tagName === 'DEL') el.removeAttribute('style');
  }
}
/** Clear character formatting of the selection (keeps links, comments, fields, tracked changes). */
export function clearCharFormat(ed) {
  const s = getSelection();
  if (!s.rangeCount || s.isCollapsed) return [];
  const key = `fale-clear${++sentinelN}`;
  document.execCommand('styleWithCSS', false, false);
  document.execCommand('fontName', false, key);
  const fs = $$(`font[face="${key}"]`, ed);
  const nodes = [];
  for (const f of fs) {
    const blk = blockOf(ed, f) || f.parentElement;
    isolate(f, blk);
    stripFormatting(f);
    nodes.push(...f.childNodes);
    f.replaceWith(...f.childNodes);
  }
  if (nodes.length) { const r = document.createRange(); r.setStartBefore(nodes[0]); r.setEndAfter(nodes[nodes.length - 1]); s.removeAllRanges(); s.addRange(r); }
  return nodes;
}

/** Change case of the selected text. mode: upper | lower | title | sentence | toggle */
export function changeCase(ed, mode) {
  const s = getSelection();
  if (!s.rangeCount || s.isCollapsed) return false;
  const r = s.getRangeAt(0);
  const texts = [];
  const tw = document.createTreeWalker(r.commonAncestorContainer.nodeType === 3 ? r.commonAncestorContainer.parentNode : r.commonAncestorContainer, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) if (r.intersectsNode(n)) texts.push(n);
  let sentenceStart = true, wordStart = true;
  const startNode = r.startContainer, startOff = r.startOffset, endNode = r.endContainer, endOff = r.endOffset;
  for (const n of texts) {
    const a = n === startNode ? startOff : 0, b = n === endNode ? endOff : n.length;
    const v = n.nodeValue;
    let seg = v.slice(a, b);
    let out = '';
    for (const ch of seg) {
      const isL = /\p{L}/u.test(ch);
      let c = ch;
      if (mode === 'upper') c = ch.toLocaleUpperCase('de');
      else if (mode === 'lower') c = ch.toLocaleLowerCase('de');
      else if (mode === 'toggle') c = ch === ch.toLocaleUpperCase('de') ? ch.toLocaleLowerCase('de') : ch.toLocaleUpperCase('de');
      else if (mode === 'title') c = isL ? (wordStart ? ch.toLocaleUpperCase('de') : ch.toLocaleLowerCase('de')) : ch;
      else if (mode === 'sentence') c = isL ? (sentenceStart ? ch.toLocaleUpperCase('de') : ch.toLocaleLowerCase('de')) : ch;
      if (c === 'SS' && ch === 'ß') c = 'ß';
      out += c;
      if (isL) { wordStart = false; sentenceStart = false; } else { if (/[\s\-–/]/.test(ch)) wordStart = true; if (/[.!?]/.test(ch)) sentenceStart = true; }
    }
    seg = out;
    n.nodeValue = v.slice(0, a) + seg + v.slice(b);
  }
  try { const nr = document.createRange(); nr.setStart(startNode, startOff); nr.setEnd(endNode, Math.min(endOff, endNode.length ?? endOff)); s.removeAllRanges(); s.addRange(nr); } catch {}
  return true;
}

// ---------------- Format übertragen ----------------
export function copyFormat(ed) {
  const s = getSelection();
  if (!s.rangeCount) return null;
  const node = s.getRangeAt(0).startContainer;
  const el = node.nodeType === 1 ? node : node.parentElement;
  if (!el || !ed.contains(el)) return null;
  const cs = getComputedStyle(el);
  const block = blockOf(ed, el);
  const deco = [];
  if (el.closest('u')) deco.push('underline');
  if (el.closest('s,strike')) deco.push('line-through');
  const bgEl = el.closest('[style*="background"]');
  return {
    css: {
      'font-family': cs.fontFamily, 'font-size': `${Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2}pt`, color: cs.color,
      'font-weight': +cs.fontWeight >= 600 ? '700' : '400', 'font-style': cs.fontStyle,
      'text-decoration': deco.join(' ') || 'none',
      ...(bgEl && ed.contains(bgEl) && rgbHex(getComputedStyle(bgEl).backgroundColor) ? { 'background-color': getComputedStyle(bgEl).backgroundColor } : {}),
    },
    style: block ? styleOfBlock(block) : 'normal',
    para: block ? { align: block.style.textAlign || undefined, indent: block.style.marginLeft ? pt(getComputedStyle(block).marginLeft) : undefined, line: block.style.lineHeight ? parseFloat(block.style.lineHeight) / 1.13 : undefined } : null,
  };
}
export function pasteFormat(ed, fmt) {
  const s = getSelection();
  if (!s.rangeCount || !fmt) return;
  const r = s.getRangeAt(0);
  if (r.collapsed) {
    // whole word under the caret
    try { s.modify('move', 'backward', 'word'); s.modify('extend', 'forward', 'word'); } catch {}
  }
  const blocks = blocksIn(ed, s.getRangeAt(0));
  const fullBlocks = blocks.length > 1 || (blocks[0] && s.toString().trim() === blocks[0].textContent.trim());
  clearCharFormat(ed);
  const spans = applyInline(ed, fmt.css);
  spans.forEach(sp => { if (sp.style.textDecoration === 'none') sp.style.removeProperty('text-decoration'); if (sp.style.fontWeight === '400') sp.style.removeProperty('font-weight'); if (sp.style.fontStyle === 'normal') sp.style.removeProperty('font-style'); });
  if (fullBlocks && fmt.style) {
    const nb = applyStyle(ed, blocksIn(ed, getSelection().getRangeAt(0)), fmt.style);
    if (fmt.para) applyPara(nb, Object.fromEntries(Object.entries(fmt.para).filter(([, v]) => v !== undefined)));
  }
}

// ---------------- Listen ----------------
export const LIST_TYPES = [['1', '1. 2. 3.'], ['a', 'a. b. c.'], ['A', 'A. B. C.'], ['i', 'i. ii. iii.'], ['I', 'I. II. III.']];
export const ML_TYPES = [['legal', '1. / 1.1. / 1.1.1.'], ['outline', '1. / a) / i.']];
export const BULLET_TYPES = [['disc', '• Punkt'], ['circle', '◦ Kreis'], ['square', '▪ Quadrat'], ['dash', '– Strich'], ['arrow', '➢ Pfeil'], ['check', '✓ Häkchen']];
void BULLETS;

export function listOf(ed, node) {
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  const li = el && el.closest('li');
  return li && ed.contains(li) ? li.parentElement : null;
}
export function topList(ed, list) {
  let t = list;
  while (t && t.parentElement && t.parentElement.closest('ul,ol') && ed.contains(t.parentElement.closest('ul,ol'))) t = t.parentElement.closest('ul,ol');
  return t;
}
/** Make the selection a list of the given kind (ordered/unordered) and set its numbering/bullet style. */
export function setListStyle(ed, { ordered, type = null, bullet = null, ml = null }) {
  const s = getSelection();
  let list = s.rangeCount ? listOf(ed, s.anchorNode) : null;
  const want = ordered ? 'OL' : 'UL';
  if (!list || list.tagName !== want) {
    document.execCommand(ordered ? 'insertOrderedList' : 'insertUnorderedList');
    list = s.rangeCount ? listOf(ed, s.anchorNode) : null;
  }
  if (!list) return null;
  if (ml) {
    const top = topList(ed, list);
    top.setAttribute('data-ml', ml);
    $$('ol', top).forEach(x => x.removeAttribute('type'));
    top.removeAttribute('type');
    return top;
  }
  if (ordered) {
    const top = topList(ed, list);
    if (top && top.tagName === 'OL' && top.hasAttribute('data-ml')) top.removeAttribute('data-ml');
    if (type && type !== '1') list.setAttribute('type', type); else list.removeAttribute('type');
  } else {
    if (bullet && bullet !== 'disc') list.setAttribute('data-bullet', bullet); else list.removeAttribute('data-bullet');
  }
  return list;
}
export function restartNumbering(ed, node, start = 1) {
  const list = listOf(ed, node);
  if (!list || list.tagName !== 'OL') return false;
  const li = node.nodeType === 1 ? node.closest('li') : node.parentElement.closest('li');
  // split the list at the current item so numbering restarts here
  if (li && li !== list.firstElementChild) {
    const nl = list.cloneNode(false);
    let x = li;
    while (x) { const nx = x.nextElementSibling; nl.appendChild(x); x = nx; }
    list.after(nl);
    nl.setAttribute('start', String(start));
    nl.setAttribute('data-restart', '');
    return nl;
  }
  if (start !== 1) list.setAttribute('start', String(start)); else list.removeAttribute('start');
  list.setAttribute('data-restart', '');
  return list;
}
export function continueNumbering(ed, node) {
  const list = listOf(ed, node);
  if (!list || list.tagName !== 'OL') return false;
  let prev = list.previousElementSibling;
  while (prev && prev.tagName !== 'OL') { if (/^(TABLE|H[1-6])$/.test(prev.tagName)) break; prev = prev.previousElementSibling; }
  if (prev && prev.tagName === 'OL') {
    const startPrev = parseInt(prev.getAttribute('start'), 10) || 1;
    list.setAttribute('start', String(startPrev + prev.children.length));
  } else list.removeAttribute('start');
  list.removeAttribute('data-restart');
  return true;
}
