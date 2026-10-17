// Tool: compare two texts (Text vergleichen). Word, character or line level; ignore upper/lower case and
// spacing on request; differences marked inline (deleted struck through, added underlined) or side by side,
// with counts. Uses the diff from compare-pdf (lib/sec-diff.js). Nothing leaves the page (noBar).
import { el, clear } from '../lib/dom.js';
import { T, calcCss, fmt, segmented, liveRegion } from '../lib/calc-core.js';
import { diffTokens } from '../lib/sec-diff.js';

calcCss();

/** Tokens that keep the original text when joined (separators are tokens too). */
export function tokens(text, mode) {
  if (mode === 'chars') return Array.from(text);
  if (mode === 'lines') return text.split(/(?<=\n)/);
  return text.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*|\s+|[^\p{L}\p{N}\s]/gu) || [];
}

/** Diff two texts → { ops: [{ type, text }], del, ins, same } (counts in tokens without whitespace). */
export function compare(a, b, { mode = 'words', ignoreCase = false, ignoreSpace = false } = {}) {
  const ta = tokens(a, mode), tb = tokens(b, mode);
  const norm = t => { let x = ignoreCase ? t.toLocaleLowerCase() : t; if (ignoreSpace) x = /^\s+$/.test(x) ? ' ' : x.replace(/\s+/g, ' ').trim(); return x; };
  const na = ta.map(norm), nb = tb.map(norm);
  const ops = [];
  let del = 0, ins = 0, same = 0;
  const count = arr => arr.filter(t => !/^\s+$/.test(t)).length;
  for (const o of diffTokens(na, nb)) {
    if (o.type === 'eq') { const t = tb.slice(o.b0, o.b1); same += count(t); ops.push({ type: 'eq', text: t.join('') }); }
    else if (o.type === 'del') { const t = ta.slice(o.a0, o.a1); del += count(t); ops.push({ type: 'del', text: t.join('') }); }
    else { const t = tb.slice(o.b0, o.b1); ins += count(t); ops.push({ type: 'ins', text: t.join('') }); }
  }
  // whitespace-only changes are not worth marking when spacing is ignored
  return { ops: ignoreSpace ? ops.map(o => (o.type !== 'eq' && !o.text.trim() ? { type: o.type === 'del' ? 'skip' : 'eq', text: o.text } : o)) : ops, del, ins, same };
}

export default {
  noBar: true,
  mountStage(stage, state, ctx) { stage.append(build(ctx.lang)); },
  status() { return { ok: false }; },
  async run() { throw Object.assign(new Error('nothing'), { userMessage: { de: 'Hier gibt es nichts zu speichern.', en: 'Nothing to save here.' } }); },
};

function build(lang) {
  const w = (de, en) => T({ de, en }, lang);
  const live = liveRegion();
  const ta = el('textarea', { class: 'calc-textarea', id: 'ct-a', placeholder: w('Ursprünglicher Text …', 'Original text …') });
  const tb = el('textarea', { class: 'calc-textarea', id: 'ct-b', placeholder: w('Geänderter Text …', 'Changed text …') });
  let mode = 'words', view = 'inline';
  const ic = el('input', { type: 'checkbox', id: 'ct-case' }), is = el('input', { type: 'checkbox', id: 'ct-space' });
  const summary = el('p', { class: 'calc-summary', role: 'status', aria: { live: 'polite' } });
  const out = el('div');
  const modeSeg = segmented({ name: 'ct-mode', label: w('Vergleichen nach', 'Compare by'), value: mode, onChange: m => { mode = m; run(); },
    choices: [{ value: 'words', label: w('Wörter', 'Words') }, { value: 'chars', label: w('Zeichen', 'Characters') }, { value: 'lines', label: w('Zeilen', 'Lines') }] });
  const viewSeg = segmented({ name: 'ct-view', label: w('Ansicht', 'View'), value: view, onChange: x => { view = x; run(); },
    choices: [{ value: 'inline', label: w('In einem Text', 'Inline') }, { value: 'side', label: w('Nebeneinander', 'Side by side') }] });
  const swap = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', onclick: () => { [ta.value, tb.value] = [tb.value, ta.value]; run(); } }, w('Tauschen', 'Swap'));
  let timer = 0;
  const later = () => { clearTimeout(timer); timer = setTimeout(run, (ta.value.length + tb.value.length) > 40000 ? 300 : 80); };
  [ta, tb].forEach(t => t.addEventListener('input', later));
  [ic, is].forEach(c => c.addEventListener('change', run));
  function frag(ops, keep) {
    const box = el('div', { class: 'calc-diff' });
    for (const o of ops) {
      if (o.type === 'eq') box.append(o.text);
      else if (o.type === 'del' && keep.includes('del')) box.append(el('del', {}, o.text));
      else if (o.type === 'ins' && keep.includes('ins')) box.append(el('ins', {}, o.text));
    }
    return box;
  }
  function run() {
    clear(out);
    if (!ta.value && !tb.value) { summary.textContent = w('Füge zwei Texte ein, um sie zu vergleichen.', 'Paste two texts to compare them.'); return; }
    const r = compare(ta.value, tb.value, { mode, ignoreCase: ic.checked, ignoreSpace: is.checked });
    const unit = mode === 'chars' ? w('Zeichen', 'characters') : mode === 'lines' ? w('Zeilen', 'lines') : w('Wörter', 'words');
    clear(summary);
    if (!r.del && !r.ins) summary.append(el('span', {}, w('Die Texte sind gleich.', 'The texts are identical.')));
    else {
      const total = r.same + Math.max(r.del, r.ins);
      summary.append(el('span', { class: 'is-del' }, `− ${fmt(r.del, { max: 0 })} ${unit}`), el('span', { class: 'is-ins' }, `+ ${fmt(r.ins, { max: 0 })} ${unit}`),
        el('span', {}, w(`${fmt(total ? (r.same / total) * 100 : 100, { max: 0 })} % unverändert`, `${fmt(total ? (r.same / total) * 100 : 100, { max: 0 })} % unchanged`)));
    }
    if (view === 'inline') out.append(frag(r.ops, ['del', 'ins']));
    else out.append(el('div', { class: 'calc-diff-2' }, el('div', {}, el('p', { class: 'calc-label' }, w('Vorher', 'Before')), frag(r.ops.map(o => (o.type === 'ins' ? { type: 'x' } : o)), ['del'])),
      el('div', {}, el('p', { class: 'calc-label' }, w('Nachher', 'After')), frag(r.ops.map(o => (o.type === 'del' ? { type: 'x' } : o)), ['ins']))));
  }
  run();
  return el('section', { class: 'img-box calc', aria: { labelledby: 'ct-h' } },
    el('h2', { class: 'img-h', id: 'ct-h' }, w('Zwei Texte vergleichen', 'Compare two texts')),
    el('div', { class: 'calc-grid calc-grid-2' },
      el('div', { class: 'calc-field' }, el('label', { class: 'calc-label', for: 'ct-a' }, w('Text 1 (vorher)', 'Text 1 (before)')), ta),
      el('div', { class: 'calc-field' }, el('label', { class: 'calc-label', for: 'ct-b' }, w('Text 2 (nachher)', 'Text 2 (after)')), tb)),
    el('div', { class: 'calc-actions' }, swap),
    modeSeg,
    el('label', { class: 'calc-check', for: 'ct-case' }, ic, el('span', {}, w('Groß- und Kleinschreibung ignorieren', 'Ignore upper and lower case'))),
    el('label', { class: 'calc-check', for: 'ct-space' }, is, el('span', {}, w('Leerzeichen und Zeilenumbrüche ignorieren', 'Ignore spaces and line breaks'))),
    viewSeg, summary, out,
    el('p', { class: 'calc-hint' }, w('Beide Texte bleiben auf dieser Seite und werden nicht gespeichert. Für PDFs gibt es „PDF vergleichen“.', 'Both texts stay on this page and are not stored. For PDFs there is “Compare PDF”.')), live);
}
