// Tool: PDF vergleichen — word-level text comparison of two PDF versions (Myers diff with
// patience anchors for large documents), side-by-side / overlay / text views with additions in
// green and deletions in red, a per-page summary and an exportable comparison report (PDF).
import * as db from '../db.js';
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, progress, baseName } from '../ui.js';
import { pickDocsDialog, resultCard, thumbHtml, docMeta } from '../components.js';
import { getDocBytes, saveResult } from '../library.js';
import { loadPdf, renderPage, canvasToBlob } from '../pdfcore.js';
import { loadPdfLib, saveDoc } from '../pdflib.js';
import { ensureCss, tick, proBadge, updateFoot, makeSanitizer } from './common.js';
import { pageChars, boxesFor } from './textgeom.js';

const GREEN = '#2F9E44', RED = '#E03131';

// ------------------------------------------------------------------------------- diff
/**
 * Myers O(ND) diff on token arrays (strings). Returns null when the edit distance exceeds maxD.
 * @returns {Array<{type:'eq'|'del'|'ins', a0, a1, b0, b1}>|null}
 */
function myers(a, b, maxD = 1500) {
  const n = a.length, m = b.length, max = n + m;
  const off = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace = [];
  let found = -1;
  for (let d = 0; d <= Math.min(max, maxD); d++) {
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
    if (found >= 0) break;
  }
  if (found < 0) return null;
  // backtrack
  const edits = [];
  let x = n, y = m;
  for (let d = found; d > 0; d--) {
    const vv = trace[d];
    const get = k => vv[k + d + 1];
    const k = x - y;
    const prevK = (k === -d || (k !== d && get(k - 1) < get(k + 1))) ? k + 1 : k - 1;
    const prevX = get(prevK), prevY = prevX - prevK;
    while (x > prevX && y > prevY) { edits.push(['eq', x - 1, y - 1]); x--; y--; }
    if (x === prevX) edits.push(['ins', x, y - 1]); else edits.push(['del', x - 1, y]);
    x = prevX; y = prevY;
  }
  while (x > 0 && y > 0) { edits.push(['eq', x - 1, y - 1]); x--; y--; }
  edits.reverse();
  // compress into runs
  const ops = [];
  for (const [t, i, j] of edits) {
    const last = ops[ops.length - 1];
    if (last && last.type === t) {
      if (t === 'eq') { last.a1 = i + 1; last.b1 = j + 1; } else if (t === 'del') last.a1 = i + 1; else last.b1 = j + 1;
    } else {
      ops.push(t === 'eq' ? { type: t, a0: i, a1: i + 1, b0: j, b1: j + 1 } : t === 'del' ? { type: t, a0: i, a1: i + 1, b0: j, b1: j } : { type: t, a0: i, a1: i, b0: j, b1: j + 1 });
    }
  }
  return ops;
}

/** Unique common tokens in increasing order on both sides (patience anchors). */
function anchors(a, b) {
  const ca = new Map(), cb = new Map();
  a.forEach((t, i) => { const e = ca.get(t); ca.set(t, e ? { n: e.n + 1, i } : { n: 1, i }); });
  b.forEach((t, i) => { const e = cb.get(t); cb.set(t, e ? { n: e.n + 1, i } : { n: 1, i }); });
  const pairs = [];
  ca.forEach((ea, t) => { const eb = cb.get(t); if (ea.n === 1 && eb && eb.n === 1) pairs.push([ea.i, eb.i]); });
  pairs.sort((p, q) => p[0] - q[0]);
  // longest increasing subsequence on b-index
  const tails = [], prev = new Int32Array(pairs.length).fill(-1), idx = [];
  pairs.forEach((p, i) => {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pairs[tails[mid]][1] < p[1]) lo = mid + 1; else hi = mid; }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
    idx[lo] = i;
  });
  const out = [];
  let k = tails.length ? tails[tails.length - 1] : -1;
  while (k >= 0) { out.push(pairs[k]); k = prev[k]; }
  return out.reverse();
}

export function diffTokens(a, b) {
  const ops = [];
  const push = (type, a0, a1, b0, b1) => {
    if (a1 - a0 <= 0 && b1 - b0 <= 0) return;
    const last = ops[ops.length - 1];
    if (last && last.type === type && last.a1 === a0 && last.b1 === b0) { last.a1 = a1; last.b1 = b1; return; }
    ops.push({ type, a0, a1, b0, b1 });
  };
  const rec = (a0, a1, b0, b1, depth) => {
    // common prefix / suffix
    let p = 0;
    while (a0 + p < a1 && b0 + p < b1 && a[a0 + p] === b[b0 + p]) p++;
    if (p) push('eq', a0, a0 + p, b0, b0 + p);
    a0 += p; b0 += p;
    let s = 0;
    while (a1 - s > a0 && b1 - s > b0 && a[a1 - 1 - s] === b[b1 - 1 - s]) s++;
    const tail = s ? [a1 - s, a1, b1 - s, b1] : null;
    a1 -= s; b1 -= s;
    if (a0 === a1 || b0 === b1) {
      push('del', a0, a1, b0, b0);
      push('ins', a1, a1, b0, b1);
    } else {
      const r = (a1 - a0) + (b1 - b0) < 60000 ? myers(a.slice(a0, a1), b.slice(b0, b1), 900) : null;
      if (r) r.forEach(o => push(o.type, o.a0 + a0, o.a1 + a0, o.b0 + b0, o.b1 + b0));
      else {
        const an = depth < 12 ? anchors(a.slice(a0, a1), b.slice(b0, b1)) : [];
        if (!an.length) { push('del', a0, a1, b0, b0); push('ins', a1, a1, b0, b1); }
        else {
          let pa = a0, pb = b0;
          for (const [ia, ib] of an) {
            rec(pa, a0 + ia, pb, b0 + ib, depth + 1);
            push('eq', a0 + ia, a0 + ia + 1, b0 + ib, b0 + ib + 1);
            pa = a0 + ia + 1; pb = b0 + ib + 1;
          }
          rec(pa, a1, pb, b1, depth + 1);
        }
      }
    }
    if (tail) push('eq', ...tail);
  };
  rec(0, a.length, 0, b.length, 0);
  return ops;
}

// ------------------------------------------------------------------------------- words
async function extractWords(pdf, onProgress) {
  const pages = [];
  const words = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1, rotation: page.rotate });
    let pt = { chars: [], text: '', map: [] };
    try { pt = await pageChars(page, base); } catch (e) { console.warn(e); }
    const start = words.length;
    const re = /\S+/g;
    let m;
    while ((m = re.exec(pt.text))) {
      let s = m.index, e = s + m[0].length;
      let i = -1, j = -1;
      for (let k = s; k < e; k++) if (pt.map[k] >= 0) { i = pt.map[k]; break; }
      for (let k = e - 1; k >= s; k--) if (pt.map[k] >= 0) { j = pt.map[k]; break; }
      if (i < 0) continue;
      const w = { t: m[0].normalize('NFC'), page: n, boxes: boxesFor(pt.chars, i, j), eol: pt.text[e] === '\n' || e >= pt.text.length };
      const prev = words.length > start ? words[words.length - 1] : null;
      // join words hyphenated at the line end ("Silben-" + "trennung")
      if (prev && prev.eol && /\p{L}-$/u.test(prev.t) && /^\p{Ll}/u.test(w.t)) {
        prev.t = prev.t.slice(0, -1) + w.t; prev.boxes = prev.boxes.concat(w.boxes); prev.eol = w.eol;
        continue;
      }
      words.push(w);
    }
    pages.push({ num: n, width: base.width, height: base.height, start, end: words.length });
    page.cleanup();
    if (onProgress && (n % 3 === 0 || n === pdf.numPages)) { onProgress(n, pdf.numPages); await tick(); }
  }
  return { pages, words };
}

/** Group diff ops into changes with page attribution. */
function buildChanges(ops, A, B) {
  const changes = [];
  const pageOf = (list, i, fallbackPages) => (list[i] ? list[i].page : list[i - 1] ? list[i - 1].page : list.length ? list[list.length - 1].page : 1) || fallbackPages;
  for (let k = 0; k < ops.length; k++) {
    const o = ops[k];
    if (o.type === 'eq') continue;
    // merge del followed by ins into a replacement
    let del = null, ins = null;
    if (o.type === 'del') { del = o; if (ops[k + 1] && ops[k + 1].type === 'ins') { ins = ops[k + 1]; k++; } }
    else { ins = o; if (ops[k + 1] && ops[k + 1].type === 'del') { del = ops[k + 1]; k++; } }
    const a0 = del ? del.a0 : ins.a0, a1 = del ? del.a1 : ins.a0;
    const b0 = ins ? ins.b0 : del.b0, b1 = ins ? ins.b1 : del.b0;
    const type = del && ins ? 'replace' : del ? 'delete' : 'insert';
    changes.push({
      type, a0, a1, b0, b1,
      aPage: pageOf(A.words, a0, 1), bPage: pageOf(B.words, b0, 1),
      oldText: A.words.slice(a0, a1).map(w => w.t).join(' '),
      newText: B.words.slice(b0, b1).map(w => w.t).join(' '),
      before: A.words.slice(Math.max(0, a0 - 5), a0).map(w => w.t).join(' '),
      after: A.words.slice(a1, a1 + 5).map(w => w.t).join(' '),
    });
  }
  return changes;
}

const TYPE_LABEL = { replace: 'Geändert', insert: 'Eingefügt', delete: 'Gelöscht' };

// ------------------------------------------------------------------------------- UI
export async function mount(screen, { docId }) {
  await ensureCss();
  screen.setTitle('PDF vergleichen', 'Zwei Versionen gegenüberstellen');
  let A = docId ? await db.getDoc(docId) : null;
  let B = null;
  let session = null; // {pdfA, pdfB, dataA, dataB, changes}
  let alive = true;

  const wrap = h(`<div class="screen-inner cmp">
    <div class="card intro"><span class="tile-ic">${icon('compare')}</span><div><strong>Zwei PDF-Versionen vergleichen</strong>
      <p>Findet eingefügte, gelöschte und geänderte Wörter – auch wenn sich der Text auf andere Seiten verschoben hat. ${proBadge()}</p></div></div>
    <div class="cmp-pick">
      <div class="card cmp-slot" data-slot="a"></div>
      <button class="icon-btn cmp-swap" type="button" data-swap aria-label="Dokumente tauschen" title="Tauschen">${icon('rotate')}</button>
      <div class="card cmp-slot" data-slot="b"></div>
    </div>
    <div data-out></div></div>`);
  screen.body.appendChild(wrap);
  const out = wrap.querySelector('[data-out]');
  const runBtn = h(`<button class="btn btn-primary" type="button">${icon('compare')} Vergleichen</button>`);
  runBtn.addEventListener('click', run);

  function slot(which) {
    const el = wrap.querySelector(`[data-slot="${which}"]`);
    const d = which === 'a' ? A : B;
    const label = which === 'a' ? 'Alte Version' : 'Neue Version';
    el.innerHTML = `<div class="cmp-slot-head"><span class="cmp-badge cmp-badge-${which}">${which.toUpperCase()}</span><strong>${label}</strong></div>
      ${d ? `<div class="cmp-doc">${thumbHtml(d)}<span class="doc-info"><span class="doc-name">${esc(d.name)}</span><span class="doc-meta">${docMeta(d)}</span></span></div>` : '<p class="muted small" style="margin:6px 0 10px">Noch kein Dokument gewählt.</p>'}
      <button class="btn btn-soft btn-sm" type="button">${icon(d ? 'rotate' : 'plus')} ${d ? 'Anderes Dokument' : 'Dokument wählen'}</button>`;
    el.querySelector('button').addEventListener('click', async () => {
      const ids = await pickDocsDialog({ title: `${label} wählen`, exclude: [(which === 'a' ? B : A)?.id].filter(Boolean) });
      if (!ids || !ids[0]) return;
      const doc = await db.getDoc(ids[0]);
      if (which === 'a') A = doc; else B = doc;
      reset();
    });
  }
  function reset() {
    slot('a'); slot('b');
    closeSession();
    out.innerHTML = '';
    runBtn.disabled = !(A && B);
    updateFoot(screen, [runBtn], A && B ? '' : 'Wähle zwei Dokumente');
  }
  wrap.querySelector('[data-swap]').addEventListener('click', () => { [A, B] = [B, A]; reset(); });
  function closeSession() {
    if (!session) return;
    try { session.pdfA.destroy(); session.pdfB.destroy(); } catch {}
    session = null;
  }

  async function run() {
    if (!A || !B) return;
    runBtn.disabled = true;
    const prog = progress('Lese Dokumente …');
    closeSession();
    out.innerHTML = '';
    try {
      const { pdf: pdfA } = await loadPdf(await getDocBytes(A.id), { name: A.name, key: A.id });
      const { pdf: pdfB } = await loadPdf(await getDocBytes(B.id), { name: B.name, key: B.id });
      session = { pdfA, pdfB };
      const dataA = await extractWords(pdfA, (i, n) => prog.set(`Lese alte Version … ${i}/${n}`));
      const dataB = await extractWords(pdfB, (i, n) => prog.set(`Lese neue Version … ${i}/${n}`));
      if (!alive) return;
      prog.set('Vergleiche …');
      await tick();
      const ops = diffTokens(dataA.words.map(w => w.t), dataB.words.map(w => w.t));
      const changes = buildChanges(ops, dataA, dataB);
      Object.assign(session, { dataA, dataB, changes, ops });
      showResults();
      toast(changes.length ? `${changes.length} Änderung${changes.length === 1 ? '' : 'en'} gefunden.` : 'Keine Textunterschiede gefunden.', changes.length ? 'success' : 'info');
    } catch (e) { errorToast(e, 'Vergleich fehlgeschlagen.'); }
    finally { prog.done(); runBtn.disabled = !(A && B); }
  }

  // ---------- results ----------
  let view = window.matchMedia('(max-width: 720px)').matches ? 'text' : 'side';
  let curIdx = 0;
  function showResults() {
    const { changes, dataA, dataB } = session;
    const noText = !dataA.words.length || !dataB.words.length;
    const cnt = t => changes.filter(c => c.type === t).length;
    const insW = changes.reduce((s, c) => s + (c.b1 - c.b0), 0), delW = changes.reduce((s, c) => s + (c.a1 - c.a0), 0);
    // per page (new version), deletions attributed to the position in the new version
    const perPage = new Map();
    changes.forEach(c => { const e = perPage.get(c.bPage) || { replace: 0, insert: 0, delete: 0, aPages: new Set() }; e[c.type]++; e.aPages.add(c.aPage); perPage.set(c.bPage, e); });
    out.innerHTML = '';
    const sum = h(`<div class="card card-pad cmp-summary">
      <div class="cmp-stats">
        <div><b>${changes.length}</b><span>Änderungen</span></div>
        <div class="ins"><b>${cnt('insert')}</b><span>eingefügt</span></div>
        <div class="del"><b>${cnt('delete')}</b><span>gelöscht</span></div>
        <div class="rep"><b>${cnt('replace')}</b><span>geändert</span></div>
      </div>
      <p class="muted small" style="margin:10px 0 0">${dataA.pages.length} → ${dataB.pages.length} Seiten · ${insW} Wörter hinzu, ${delW} Wörter entfernt${noText ? ' · <b>Mindestens ein Dokument hat keine Textebene (Scan) – nutze die Ansicht „Überlagert“.</b>' : ''}</p>
      ${perPage.size ? `<div class="cmp-pages" role="list">${[...perPage.entries()].sort((p, q) => p[0] - q[0]).map(([p, e]) => `<button type="button" class="cmp-pagechip" role="listitem" data-bpage="${p}"><b>Seite ${p}</b> ${[e.insert ? `<span class="ins">+${e.insert}</span>` : '', e.delete ? `<span class="del">−${e.delete}</span>` : '', e.replace ? `<span class="rep">~${e.replace}</span>` : ''].join(' ')}</button>`).join('')}</div>` : ''}
    </div>`);
    out.appendChild(sum);
    const bar = h(`<div class="cmp-bar">
      <div class="seg" role="group" aria-label="Ansicht">
        <button type="button" data-view="side">Nebeneinander</button><button type="button" data-view="overlay">Überlagert</button><button type="button" data-view="text">Text</button></div>
      <span class="grow"></span>
      <div class="cmp-nav"><button class="icon-btn" type="button" data-nav="-1" aria-label="Vorherige Änderung">${icon('chevronUp')}</button>
        <span data-navinfo></span>
        <button class="icon-btn" type="button" data-nav="1" aria-label="Nächste Änderung">${icon('chevronDown')}</button></div></div>`);
    out.appendChild(bar);
    const pane = h('<div class="cmp-pane" data-pane></div>');
    out.appendChild(pane);
    bar.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { view = b.dataset.view; renderView(); }));
    bar.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => {
      if (!changes.length) return;
      curIdx = (curIdx + +b.dataset.nav + changes.length) % changes.length;
      renderView(true);
    }));
    sum.querySelectorAll('[data-bpage]').forEach(b => b.addEventListener('click', () => {
      const i = changes.findIndex(c => c.bPage === +b.dataset.bpage);
      if (i >= 0) { curIdx = i; renderView(true); pane.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    }));
    curIdx = 0;
    renderView();
    const exp = h(`<button class="btn btn-primary" type="button">${icon('file')} Bericht als PDF</button>`);
    exp.addEventListener('click', () => exportReport(exp));
    updateFoot(screen, [exp], `${changes.length} Änderung${changes.length === 1 ? '' : 'en'}`);
    requestAnimationFrame(() => sum.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  let renderSeq = 0;
  async function renderView(focus = false) {
    const pane = out.querySelector('[data-pane]');
    if (!pane || !session) return;
    const { changes } = session;
    out.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    out.querySelector('[data-navinfo]').textContent = changes.length ? `${curIdx + 1} / ${changes.length}` : '–';
    const seq = ++renderSeq;
    if (view === 'text') { renderText(pane, focus); return; }
    const c = changes[curIdx];
    const aPage = c ? c.aPage : 1, bPage = c ? c.bPage : 1;
    pane.innerHTML = '<div class="cmp-loading"><span class="spinner dark"></span></div>';
    try {
      if (view === 'side') await renderSide(pane, aPage, bPage, seq);
      else await renderOverlay(pane, aPage, bPage, seq);
    } catch (e) { if (alive) errorToast(e, 'Seite konnte nicht angezeigt werden.'); }
  }

  function pageNav(pane, aPage, bPage) {
    const { pdfA, pdfB } = session;
    const nav = h(`<div class="cmp-pagenav"><label>A: Seite <select class="select pt-mini" data-ap>${Array.from({ length: pdfA.numPages }, (_, i) => `<option ${i + 1 === aPage ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
      <label>B: Seite <select class="select pt-mini" data-bp>${Array.from({ length: pdfB.numPages }, (_, i) => `<option ${i + 1 === bPage ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label></div>`);
    const go = () => {
      const ap = +nav.querySelector('[data-ap]').value, bp = +nav.querySelector('[data-bp]').value;
      const seq = ++renderSeq;
      pane.innerHTML = '<div class="cmp-loading"><span class="spinner dark"></span></div>';
      (view === 'side' ? renderSide(pane, ap, bp, seq) : renderOverlay(pane, ap, bp, seq)).catch(e => errorToast(e));
    };
    nav.querySelectorAll('select').forEach(s => s.addEventListener('change', go));
    return nav;
  }

  async function pageCanvas(pdf, n, width) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1, rotation: page.rotate });
    const scale = width / base.width;
    const canvas = await renderPage(page, { scale, dpr: Math.min(2, window.devicePixelRatio || 1) });
    canvas.style.width = `${Math.round(base.width * scale)}px`;
    canvas.style.height = `${Math.round(base.height * scale)}px`;
    return { canvas, scale, base };
  }

  async function renderSide(pane, aPage, bPage, seq) {
    const { pdfA, pdfB, dataA, dataB, changes } = session;
    const phone = window.matchMedia('(max-width: 720px)').matches;
    const colW = Math.max(150, Math.min(560, phone ? pane.clientWidth - 8 : (pane.clientWidth - 24) / 2));
    const [ra, rb] = await Promise.all([pageCanvas(pdfA, aPage, colW), pageCanvas(pdfB, bPage, colW)]);
    if (seq !== renderSeq || !alive) return;
    pane.innerHTML = '';
    pane.appendChild(pageNav(pane, aPage, bPage));
    const grid = h(`<div class="cmp-side ${phone ? 'stack' : ''}"></div>`);
    const mk = (r, label, which) => {
      const col = h(`<div class="cmp-col"><div class="cmp-col-head"><span class="cmp-badge cmp-badge-${which}">${which.toUpperCase()}</span>${esc(label)}</div><div class="cmp-page"></div></div>`);
      const pg = col.querySelector('.cmp-page');
      pg.style.width = r.canvas.style.width; pg.style.height = r.canvas.style.height;
      pg.appendChild(r.canvas);
      return { col, pg };
    };
    const ca = mk(ra, `${A.name} · Seite ${aPage}`, 'a'), cb = mk(rb, `${B.name} · Seite ${bPage}`, 'b');
    grid.append(ca.col, cb.col);
    pane.appendChild(grid);
    const cur = changes[curIdx];
    const mark = (pg, words, i0, i1, page, scale, cls, focus) => {
      const boxes = [];
      for (let i = i0; i < i1; i++) {
        const w = words[i];
        if (!w || w.page !== page) continue;
        for (const bx of w.boxes) {
          // merge with the previous box when on the same line and close by
          const l = boxes[boxes.length - 1];
          const hgt = bx.y1 - bx.y0;
          if (l && Math.abs(l.y0 - bx.y0) < hgt * 0.4 && Math.abs(l.y1 - bx.y1) < hgt * 0.4 && bx.x0 - l.x1 < hgt * 1.2 && bx.x0 >= l.x0) {
            l.x1 = Math.max(l.x1, bx.x1); l.y0 = Math.min(l.y0, bx.y0); l.y1 = Math.max(l.y1, bx.y1);
          } else boxes.push({ ...bx });
        }
      }
      {
        for (const b of boxes) {
          const d = document.createElement('div');
          d.className = `cmp-hl ${cls}${focus ? ' focus' : ''}`;
          Object.assign(d.style, { left: `${b.x0 * scale - 1}px`, top: `${b.y0 * scale - 1}px`, width: `${(b.x1 - b.x0) * scale + 2}px`, height: `${(b.y1 - b.y0) * scale + 2}px` });
          pg.appendChild(d);
        }
      }
    };
    changes.forEach(c => {
      const f = c === cur;
      if (c.aPage === aPage || dataA.words.slice(c.a0, c.a1).some(w => w.page === aPage)) mark(ca.pg, dataA.words, c.a0, c.a1, aPage, ra.scale, c.type === 'replace' ? 'rep-old' : 'del', f);
      if (c.bPage === bPage || dataB.words.slice(c.b0, c.b1).some(w => w.page === bPage)) mark(cb.pg, dataB.words, c.b0, c.b1, bPage, rb.scale, c.type === 'replace' ? 'rep-new' : 'ins', f);
      // pure deletions: marker in B where the text was removed / insertions: marker in A
      if (c.type === 'delete' && c.bPage === bPage) caret(cb.pg, dataB.words, c.b0, bPage, rb.scale, 'del', f);
      if (c.type === 'insert' && c.aPage === aPage) caret(ca.pg, dataA.words, c.a0, aPage, ra.scale, 'ins', f);
    });
    const focusEl = grid.querySelector('.cmp-hl.focus');
    if (focusEl) focusEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (cur) pane.appendChild(changeCard(cur));
  }
  function caret(pg, words, i, page, scale, cls, focus) {
    const w = words[i] && words[i].page === page ? words[i] : words[i - 1] && words[i - 1].page === page ? words[i - 1] : null;
    if (!w || !w.boxes[0]) return;
    const b = w.boxes[0];
    const atEnd = words[i] !== w;
    const d = document.createElement('div');
    d.className = `cmp-caret ${cls}${focus ? ' focus' : ''}`;
    Object.assign(d.style, { left: `${(atEnd ? b.x1 : b.x0) * scale - 1}px`, top: `${b.y0 * scale - 2}px`, height: `${(b.y1 - b.y0) * scale + 4}px` });
    pg.appendChild(d);
  }
  function changeCard(c) {
    return h(`<div class="card cmp-change"><span class="cmp-type ${c.type}">${TYPE_LABEL[c.type]}</span>
      <span class="muted small">Seite ${c.aPage} (A) → Seite ${c.bPage} (B)</span>
      <p>${c.before ? `<span class="muted">… ${esc(c.before)} </span>` : ''}${c.oldText ? `<del>${esc(c.oldText)}</del> ` : ''}${c.newText ? `<ins>${esc(c.newText)}</ins>` : ''}${c.after ? `<span class="muted"> ${esc(c.after)} …</span>` : ''}</p></div>`);
  }

  async function renderOverlay(pane, aPage, bPage, seq) {
    const { pdfA, pdfB } = session;
    const w = Math.max(200, Math.min(820, pane.clientWidth - 8));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const [pa, pb] = await Promise.all([pdfA.getPage(aPage), pdfB.getPage(bPage)]);
    const ba = pa.getViewport({ scale: 1, rotation: pa.rotate }), bb = pb.getViewport({ scale: 1, rotation: pb.rotate });
    const scale = w / Math.max(ba.width, bb.width);
    const ca = await renderPage(pa, { scale, dpr }), cb = await renderPage(pb, { scale, dpr });
    if (seq !== renderSeq || !alive) return;
    const W = Math.max(ca.width, cb.width), H = Math.max(ca.height, cb.height);
    const g = c => { const t = document.createElement('canvas'); t.width = W; t.height = H; const x = t.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(c, 0, 0); return x.getImageData(0, 0, W, H).data; };
    const da = g(ca), dbb = g(cb);
    const outC = document.createElement('canvas');
    outC.width = W; outC.height = H;
    const ctx = outC.getContext('2d');
    const img = ctx.createImageData(W, H);
    const o = img.data;
    let diffPx = 0;
    for (let i = 0; i < o.length; i += 4) {
      const la = (da[i] * 0.299 + da[i + 1] * 0.587 + da[i + 2] * 0.114);
      const lb = (dbb[i] * 0.299 + dbb[i + 1] * 0.587 + dbb[i + 2] * 0.114);
      const ka = 1 - la / 255, kb = 1 - lb / 255; // ink amount
      if (Math.abs(ka - kb) < 0.18) { const v = 255 - Math.max(ka, kb) * 200; o[i] = o[i + 1] = o[i + 2] = v; }
      else if (ka > kb) { o[i] = 224; o[i + 1] = 49 + (1 - ka) * 180; o[i + 2] = 49 + (1 - ka) * 180; diffPx++; }
      else { o[i] = 47 + (1 - kb) * 190; o[i + 1] = 158 + (1 - kb) * 90; o[i + 2] = 68 + (1 - kb) * 170; diffPx++; }
      o[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    ca.width = cb.width = 0;
    outC.style.width = `${Math.round(W / dpr)}px`;
    outC.style.height = `${Math.round(H / dpr)}px`;
    outC.className = 'cmp-overlay-canvas';
    pane.innerHTML = '';
    pane.appendChild(pageNav(pane, aPage, bPage));
    pane.appendChild(h(`<p class="cmp-legend"><span class="sw same"></span>gleich <span class="sw del"></span>nur in A (alt) <span class="sw ins"></span>nur in B (neu) · ${diffPx ? `${(diffPx / (W * H) * 100).toFixed(2).replace('.', ',')} % der Fläche unterschiedlich` : 'keine sichtbaren Unterschiede'}</p>`));
    const box = h('<div class="cmp-overlay"></div>');
    box.appendChild(outC);
    pane.appendChild(box);
  }

  function renderText(pane, focus) {
    const { ops, dataA, dataB, changes } = session;
    pane.innerHTML = '';
    if (!changes.length) { pane.appendChild(h('<p class="panel-empty">Der Text beider Versionen ist identisch.</p>')); return; }
    // show each change with a few words of context, grouped by page (new version)
    const box = h('<div class="cmp-text"></div>');
    let lastPage = 0;
    changes.forEach((c, i) => {
      if (c.bPage !== lastPage) { box.appendChild(h(`<h3 class="cmp-text-page">Seite ${c.bPage}</h3>`)); lastPage = c.bPage; }
      const el = changeCard(c);
      el.dataset.ci = i;
      if (i === curIdx) el.classList.add('focus');
      el.addEventListener('click', () => { curIdx = i; view = 'side'; renderView(true); });
      el.tabIndex = 0;
      box.appendChild(el);
    });
    pane.appendChild(box);
    if (focus) { const f = box.querySelector('.cmp-change.focus'); if (f) f.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    void ops; void dataA; void dataB;
  }

  // ---------- report ----------
  async function exportReport(btn) {
    if (!session) return;
    btn.disabled = true;
    const prog = progress('Erstelle Bericht …');
    try {
      const PDFLib = await loadPdfLib();
      const { PDFDocument, StandardFonts, rgb } = PDFLib;
      const { changes, dataA, dataB, pdfA, pdfB } = session;
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
      const clean = makeSanitizer(font);
      const [PW, PH] = [595.28, 841.89];
      const M = 50;
      let page = doc.addPage([PW, PH]);
      let y = PH - M;
      const col = { ins: rgb(0.18, 0.62, 0.27), del: rgb(0.88, 0.19, 0.19), text: rgb(0.1, 0.11, 0.2), muted: rgb(0.42, 0.44, 0.55) };
      const newPage = () => { page = doc.addPage([PW, PH]); y = PH - M; };
      const line = (txt, { size = 10.5, f = font, color = col.text, gap = 4 } = {}) => {
        const words = clean(txt).split(/\s+/);
        let cur = '';
        const flush = () => { if (y < M + size) newPage(); page.drawText(cur, { x: M, y: y - size, size, font: f, color }); y -= size * 1.3; cur = ''; };
        for (const w of words) {
          const t = cur ? cur + ' ' + w : w;
          if (f.widthOfTextAtSize(t, size) > PW - 2 * M && cur) { flush(); cur = w; } else cur = t;
        }
        if (cur) flush();
        y -= gap;
      };
      line('Vergleichsbericht', { size: 22, f: bold, gap: 10 });
      line(`Alte Version (A): ${A.name} – ${dataA.pages.length} Seiten`, { size: 11 });
      line(`Neue Version (B): ${B.name} – ${dataB.pages.length} Seiten`, { size: 11 });
      line(`Erstellt am ${new Date().toLocaleString('de-DE')} mit FaLe PDF`, { size: 9, color: col.muted, gap: 14 });
      const cnt = t => changes.filter(c => c.type === t).length;
      line(`${changes.length} Änderungen: ${cnt('insert')} eingefügt, ${cnt('delete')} gelöscht, ${cnt('replace')} geändert`, { size: 13, f: bold, gap: 10 });
      // per page table
      const perPage = new Map();
      changes.forEach(c => { const e = perPage.get(c.bPage) || { insert: 0, delete: 0, replace: 0 }; e[c.type]++; perPage.set(c.bPage, e); });
      if (perPage.size) {
        line('Änderungen pro Seite (neue Version)', { size: 12, f: bold, gap: 6 });
        const xs = [M, M + 120, M + 230, M + 340];
        const row = (cells, f2 = font) => { if (y < M + 14) newPage(); cells.forEach((t, i) => page.drawText(clean(String(t)), { x: xs[i], y: y - 10, size: 10, font: f2, color: col.text })); y -= 16; };
        row(['Seite', 'Eingefügt', 'Gelöscht', 'Geändert'], bold);
        [...perPage.entries()].sort((p, q) => p[0] - q[0]).forEach(([p, e]) => row([p, e.insert, e.delete, e.replace]));
        y -= 10;
      }
      line('Alle Änderungen', { size: 12, f: bold, gap: 6 });
      for (let i = 0; i < changes.length; i++) {
        const c = changes[i];
        if (i % 40 === 0) { prog.set(`Bericht: Änderung ${i + 1} von ${changes.length} …`); await tick(); }
        line(`${i + 1}. ${TYPE_LABEL[c.type]} – Seite ${c.aPage} (A) / Seite ${c.bPage} (B)`, { size: 10, f: bold, gap: 1 });
        if (c.oldText) line(`Alt: ${c.oldText.length > 600 ? c.oldText.slice(0, 600) + ' …' : c.oldText}`, { size: 10, color: col.del, gap: 1 });
        if (c.newText) line(`Neu: ${c.newText.length > 600 ? c.newText.slice(0, 600) + ' …' : c.newText}`, { size: 10, color: col.ins, gap: 1 });
        y -= 6;
      }
      // visual pages with highlights (first 30 page pairs with changes)
      const pairs = [];
      changes.forEach(c => { if (!pairs.some(p => p[0] === c.aPage && p[1] === c.bPage)) pairs.push([c.aPage, c.bPage]); });
      const LW = 841.89, LH = 595.28;
      for (let k = 0; k < Math.min(30, pairs.length); k++) {
        const [ap, bp] = pairs[k];
        prog.set(`Bericht: Seitenansicht ${k + 1} von ${Math.min(30, pairs.length)} …`);
        const pg = doc.addPage([LW, LH]);
        pg.drawText(clean(`Seite ${ap} (A, alt)`), { x: 30, y: LH - 30, size: 11, font: bold, color: col.del });
        pg.drawText(clean(`Seite ${bp} (B, neu)`), { x: LW / 2 + 10, y: LH - 30, size: 11, font: bold, color: col.ins });
        const slotW = LW / 2 - 40, slotH = LH - 70;
        for (const [which, pdf, n, data, x0] of [['a', pdfA, ap, dataA, 30], ['b', pdfB, bp, dataB, LW / 2 + 10]]) {
          const p = await pdf.getPage(n);
          const base = p.getViewport({ scale: 1, rotation: p.rotate });
          const s = Math.min(slotW / base.width, slotH / base.height);
          const cv = await renderPage(p, { scale: s * 1.6 });
          const blob = await canvasToBlob(cv, 'image/jpeg', 0.8);
          cv.width = cv.height = 0;
          const img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
          const iw = base.width * s, ih = base.height * s, iy = LH - 45 - ih;
          pg.drawImage(img, { x: x0, y: iy, width: iw, height: ih });
          pg.drawRectangle({ x: x0, y: iy, width: iw, height: ih, borderColor: rgb(0.8, 0.82, 0.88), borderWidth: 0.6 });
          for (const c of changes) {
            const [i0, i1] = which === 'a' ? [c.a0, c.a1] : [c.b0, c.b1];
            for (let i = i0; i < i1; i++) {
              const w = data.words[i];
              if (!w || w.page !== n) continue;
              for (const b of w.boxes) pg.drawRectangle({ x: x0 + b.x0 * s - 0.5, y: iy + ih - b.y1 * s - 0.5, width: (b.x1 - b.x0) * s + 1, height: (b.y1 - b.y0) * s + 1, color: which === 'a' ? col.del : col.ins, opacity: 0.3, borderColor: which === 'a' ? col.del : col.ins, borderWidth: 0.4 });
            }
          }
        }
        await tick();
      }
      doc.setTitle(`Vergleich ${baseName(A.name)} – ${baseName(B.name)}`);
      const bytes = await saveDoc(doc);
      const res = await saveResult(bytes, `Vergleich ${baseName(A.name)} – ${baseName(B.name)}.pdf`);
      out.querySelectorAll('.cmp-report').forEach(x => x.remove());
      const box = h('<div class="cmp-report"></div>');
      box.appendChild(resultCard(res, { title: 'Vergleichsbericht erstellt', note: `${changes.length} Änderungen` }));
      out.insertBefore(box, out.firstChild.nextSibling);
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      toast('Bericht gespeichert.', 'success');
    } catch (e) { errorToast(e, 'Der Bericht konnte nicht erstellt werden.'); }
    finally { prog.done(); btn.disabled = false; }
  }

  reset();
  return () => { alive = false; closeSession(); };
}
