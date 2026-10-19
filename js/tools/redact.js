// Tool: Schwärzen (secure redaction). Marked areas / text / search hits are burned into a
// high-resolution image of the affected pages; the page's original content (text, images,
// annotations, form values) is removed from the file. Pages without marks stay vector.
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, progress, baseName, openDialog, confirmDialog } from '../ui.js';
import { resultCard } from '../components.js';
import { saveResult } from '../library.js';
import { loadPdf, renderPage, canvasToBlob } from '../pdfcore.js';
import { loadEditable, loadPdfLib, saveDoc } from '../pdflib.js';
import { openToolDoc, PageStage, svgEl, guardLeave, createPan, tick, proBadge, updateFoot } from './common.js';
import { pageChars, nearestChar, boxesFor, findInPage, PRESETS } from './textgeom.js';

const MODES = [
  { id: 'area', label: 'Bereich', icon: 'square', hint: 'Bereich aufziehen, der geschwärzt werden soll.' },
  { id: 'text', label: 'Text', icon: 'highlight', hint: 'Über Text ziehen – oder auf ein Wort tippen.' },
  { id: 'search', label: 'Suchen', icon: 'search' },
  { id: 'select', label: 'Entfernen', icon: 'eraser', hint: 'Tippe auf eine Markierung, um sie zu entfernen.' },
];

export async function mount(screen, { docId }) {
  const ctx = await openToolDoc(screen, docId, 'Schwärzen');
  if (!ctx) return;
  const { doc, bytes } = ctx;
  const { pdf } = await loadPdf(bytes.slice(), { name: doc.name, key: docId });
  let mode = 'area';
  let marks = [];
  const undoStack = [];
  let seq = 0;
  let savedSnapshot = '[]';

  screen.body.style.cssText = 'display:flex;flex-direction:column;overflow:hidden';
  const toolbar = h('<div class="pt-toolbar" role="toolbar" aria-label="Schwärzen"></div>');
  MODES.forEach(m => {
    const b = h(`<button class="pt-tool" type="button" data-tool="${m.id}" aria-pressed="false">${icon(m.icon)}<span>${esc(m.label)}</span></button>`);
    b.addEventListener('click', () => (m.id === 'search' ? searchDialog() : setMode(m.id)));
    toolbar.appendChild(b);
  });
  const info = h(`<div class="pt-redact-info">${icon('shield')}<span>Sicheres Schwärzen: Seiten mit Markierungen werden als Bild neu aufgebaut. Text, Bilder und Kommentare darunter werden <b>dauerhaft entfernt</b> – nicht nur überdeckt. Andere Seiten bleiben unverändert. ${proBadge()}</span></div>`);
  const propsBar = h('<div class="pt-props"></div>');
  const stageEl = h('<div class="pt-stage" tabindex="-1"></div>');
  screen.body.append(toolbar, info, propsBar, stageEl);
  const undoBtn = h(`<button class="icon-btn" type="button" aria-label="Rückgängig" disabled>${icon('undo')}</button>`);
  screen.extra.append(undoBtn);
  undoBtn.addEventListener('click', () => {
    if (!undoStack.length) return;
    const before = new Set(marks.map(m => m.page));
    marks = JSON.parse(undoStack.pop());
    new Set([...before, ...marks.map(m => m.page)]).forEach(drawMarks);
    update();
  });

  const stage = new PageStage(stageEl, pdf, {
    onPageCreated: p => {
      p.svg = svgEl('svg', { viewBox: `0 0 ${p.base.width} ${p.base.height}`, preserveAspectRatio: 'none' });
      p.overlay.append(p.svg);
    },
  });
  await stage.init();
  const charsOf = p => (p.chars || (p.chars = pageChars(p.page, p.base).catch(() => ({ chars: [], text: '', map: [] }))));

  function setMode(m) {
    mode = m;
    toolbar.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === m)));
    stageEl.classList.toggle('drawing', m === 'area' || m === 'text');
    stageEl.dataset.mode = m;
    const def = MODES.find(x => x.id === m);
    propsBar.innerHTML = `<span class="pt-hint">${esc(def.hint || '')}</span>`;
  }

  function commit() { undoStack.push(JSON.stringify(marks)); if (undoStack.length > 100) undoStack.shift(); }
  function addMarks(list) {
    if (!list.length) return;
    commit();
    list.forEach(m => { m.id = `m${++seq}`; marks.push(m); });
    new Set(list.map(m => m.page)).forEach(drawMarks);
    update();
  }
  function update() {
    undoBtn.disabled = !undoStack.length;
    const pages = new Set(marks.map(m => m.page)).size;
    applyBtn.disabled = !marks.length;
    updateFoot(screen, [applyBtn], marks.length ? `${marks.length} Markierung${marks.length === 1 ? '' : 'en'} auf ${pages} Seite${pages === 1 ? '' : 'n'}` : 'Noch nichts markiert');
  }
  function drawMarks(num) {
    const p = stage.pages[num - 1];
    if (!p) return;
    p.svg.textContent = '';
    for (const m of marks) {
      if (m.page !== num) continue;
      p.svg.appendChild(svgEl('rect', { x: m.x0, y: m.y0, width: m.x1 - m.x0, height: m.y1 - m.y0, class: 'pt-redmark', 'data-id': m.id }));
    }
  }

  // ---------- pointer ----------
  const pan = createPan(stageEl);
  let gest = null;
  stage.box.addEventListener('pointerdown', async e => {
    if (e.button > 0) return;
    const p = stage.pageAt(e);
    if (!p) return;
    if (pan.down(e)) { if (gest && gest.preview) gest.preview.remove(); gest = null; return; }
    const { x, y } = stage.pointIn(p, e);
    if (mode === 'select') {
      const hit = [...marks].reverse().find(m => m.page === p.num && x >= m.x0 && x <= m.x1 && y >= m.y0 && y <= m.y1);
      if (hit) { commit(); marks = marks.filter(m => m !== hit); drawMarks(p.num); update(); }
      return;
    }
    e.preventDefault();
    stage.box.setPointerCapture(e.pointerId);
    if (mode === 'area') {
      gest = { kind: 'area', p, sx: x, sy: y, x, y, pid: e.pointerId, preview: svgEl('rect', { class: 'pt-redmark pt-redprev' }) };
      p.svg.appendChild(gest.preview);
    } else if (mode === 'text') {
      const g = { kind: 'pending', p, sx: x, sy: y, x, y, moved: false, pid: e.pointerId };
      gest = g;
      const pt = await charsOf(p);
      if (!pt.chars.length) { if (gest === g) gest = null; toast('Auf dieser Seite gibt es keinen erkennbaren Text – nutze „Bereich“.', 'info'); return; }
      const i = nearestChar(pt.chars, x, y);
      Object.assign(g, { kind: 'text', pt, i, j: g.moved ? nearestChar(pt.chars, g.x, g.y) : i, preview: svgEl('g') });
      if (g.ended) { finishText(g); return; }
      p.svg.appendChild(g.preview);
      preview();
    }
  });
  stage.box.addEventListener('pointermove', e => {
    if (pan.move(e)) return;
    if (!gest || e.pointerId !== gest.pid) return;
    const { x, y } = stage.pointIn(gest.p, e);
    if (gest.kind === 'pending') { gest.x = x; gest.y = y; if (Math.hypot(x - gest.sx, y - gest.sy) > 3) gest.moved = true; return; }
    if (gest.kind === 'area') { gest.x = x; gest.y = y; }
    else { gest.j = nearestChar(gest.pt.chars, x, y); if (Math.hypot(x - gest.sx, y - gest.sy) > 3) gest.moved = true; }
    preview();
  });
  const end = e => {
    pan.up(e);
    if (!gest || e.pointerId !== gest.pid) return;
    const g = gest;
    gest = null;
    if (g.kind === 'pending') { g.ended = true; if (e.type === 'pointercancel') g.kind = 'cancelled'; return; }
    g.preview.remove();
    if (e.type === 'pointercancel') return;
    if (g.kind === 'area') {
      const x0 = Math.min(g.sx, g.x), x1 = Math.max(g.sx, g.x), y0 = Math.min(g.sy, g.y), y1 = Math.max(g.sy, g.y);
      if (x1 - x0 > 2 && y1 - y0 > 2) addMarks([{ page: g.p.num, x0, y0, x1, y1 }]);
      else toast('Zum Markieren einen Bereich aufziehen.', 'info', { timeout: 1800 });
    } else finishText(g);
  };
  function finishText(g) {
    if (g.preview) g.preview.remove();
    const [i, j] = g.moved ? [g.i, g.j] : wordAt(g.pt.chars, g.i);
    addMarks(boxesFor(g.pt.chars, i, j).map(b => pad({ page: g.p.num, ...b })));
  }
  stage.box.addEventListener('pointerup', end);
  stage.box.addEventListener('pointercancel', end);

  function preview() {
    const g = gest;
    if (!g) return;
    if (g.kind === 'area') {
      const a = { x: Math.min(g.sx, g.x), y: Math.min(g.sy, g.y), width: Math.abs(g.x - g.sx), height: Math.abs(g.y - g.sy) };
      Object.entries(a).forEach(([k, v]) => g.preview.setAttribute(k, v));
    } else {
      g.preview.textContent = '';
      const [i, j] = g.moved ? [g.i, g.j] : wordAt(g.pt.chars, g.i);
      boxesFor(g.pt.chars, i, j).forEach(b => { const m = pad(b); g.preview.appendChild(svgEl('rect', { x: m.x0, y: m.y0, width: m.x1 - m.x0, height: m.y1 - m.y0, class: 'pt-redmark pt-redprev' })); });
    }
  }
  function pad(b) { const d = 1; return { ...b, x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d }; }
  function wordAt(chars, i) {
    const isW = c => c && /[\p{L}\p{N}@._+\-]/u.test(c.ch);
    if (!isW(chars[i])) return [i, i];
    let a = i, b = i;
    while (a > 0 && isW(chars[a - 1]) && chars[a - 1].line === chars[i].line) a--;
    while (b < chars.length - 1 && isW(chars[b + 1]) && chars[b + 1].line === chars[i].line) b++;
    return [a, b];
  }

  // ---------- search ----------
  async function searchDialog() {
    const r = await openDialog({
      title: 'Suchen & schwärzen',
      wide: true,
      body: `<label class="field"><span class="field-label">Suchbegriffe (mehrere mit Komma trennen)</span>
          <input class="input" name="q" placeholder="z. B. Max Mustermann, Kundennummer" autofocus autocomplete="off"></label>
        <label class="check"><input type="checkbox" name="cs"><span>Groß-/Kleinschreibung beachten</span></label>
        <label class="check"><input type="checkbox" name="ww"><span>Nur ganze Wörter</span></label>
        <p class="field-label" style="margin:12px 0 6px">Automatisch finden</p>
        <div class="pt-presets">${Object.entries(PRESETS).map(([k, v]) => `<label class="pt-preset"><input type="checkbox" name="p_${k}"><span>${esc(v.label)}</span></label>`).join('')}</div>`,
      actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Treffer markieren', value: 'ok', kind: 'btn-primary', default: true }],
      onMount: dlg => ({
        collect: () => ({
          q: dlg.querySelector('[name=q]').value, cs: dlg.querySelector('[name=cs]').checked, ww: dlg.querySelector('[name=ww]').checked,
          presets: Object.keys(PRESETS).filter(k => dlg.querySelector(`[name=p_${k}]`).checked),
        }),
      }),
    });
    if (r.value !== 'ok' || !r.data) return;
    const { q, cs, ww, presets } = r.data;
    const terms = q.split(',').map(t => t.trim()).filter(Boolean);
    if (!terms.length && !presets.length) { toast('Bitte gib einen Suchbegriff ein oder wähle eine Vorlage.', 'error'); return; }
    if (!ocrAsked) await offerOcr();
    const prog = progress('Suche …');
    try {
      const found = [];
      const existing = new Set(marks.map(m => `${m.page}:${m.x0.toFixed(1)}:${m.y0.toFixed(1)}`));
      for (const p of stage.pages) {
        if (p.num % 5 === 0) { prog.set(`Suche … Seite ${p.num} von ${stage.pages.length}`); await tick(); }
        const pt = await charsOf(p);
        if (!pt.chars.length) continue;
        const hits = [];
        terms.forEach(t => hits.push(...findInPage(pt, t, { caseSensitive: cs, wholeWord: ww })));
        presets.forEach(k => hits.push(...findInPage(pt, PRESETS[k].re)));
        for (const hit of hits) {
          for (const b of boxesFor(pt.chars, hit.i, hit.j)) {
            const m = pad({ page: p.num, ...b });
            const key = `${m.page}:${m.x0.toFixed(1)}:${m.y0.toFixed(1)}`;
            if (existing.has(key)) continue;
            existing.add(key);
            found.push(m);
          }
        }
      }
      if (!found.length) { toast('Keine Treffer gefunden.', 'info'); return; }
      addMarks(found);
      const first = Math.min(...found.map(m => m.page));
      stage.scrollToPage(first);
      toast(`${found.length} Stelle${found.length === 1 ? '' : 'n'} markiert. Prüfe die Markierungen vor dem Anwenden.`, 'success', { timeout: 5000 });
    } catch (e) { errorToast(e, 'Suche fehlgeschlagen.'); }
    finally { prog.done(); }
  }

  // ---------- OCR for scanned pages (search terms on image-only pages) ----------
  let ocrAsked = false;
  async function offerOcr() {
    ocrAsked = true;
    const empty = [];
    for (const p of stage.pages) { const pt = await charsOf(p); if (!pt.chars.length) empty.push(p); }
    if (!empty.length) return;
    const r = await openDialog({
      title: 'Seiten ohne Text',
      body: `<p>${empty.length === stage.pages.length ? 'Dieses Dokument ist ein Scan und enthält' : `${empty.length} Seite${empty.length === 1 ? ' enthält' : 'n enthalten'}`} keinen durchsuchbaren Text. Mit der Texterkennung (OCR) können Suchbegriffe auch dort gefunden und geschwärzt werden – direkt auf deinem Gerät.</p>`,
      actions: [{ label: 'Ohne OCR suchen', value: 'skip' }, { label: 'Text per OCR erkennen', value: 'ocr', kind: 'btn-primary', default: true }],
    });
    if (r.value !== 'ocr') return;
    const ui = await import('../ocr/ui.js');
    if (!await ui.ensureOcrReady(ui.getLangPref())) return;
    const { ocrPageChars } = await import('../ocr/pagechars.js');
    const panel = ui.progressPanel({ title: 'Text wird erkannt …', total: empty.length });
    let n = 0;
    const t0 = Date.now();
    try {
      for (let k = 0; k < empty.length; k++) {
        const p = empty[k];
        const eta = n ? ((Date.now() - t0) / n) * (empty.length - k) / 1000 : null;
        const pt = await ocrPageChars(p.page, p.base, { lang: ui.getLangPref(), psm: ui.getPsmPref(), signal: panel.signal, onProgress: x => panel.update({ ...x, index: k, total: empty.length, page: p.num, eta }) });
        p.chars = Promise.resolve(pt);
        n++;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') toast('Texterkennung abgebrochen.', 'info'); else errorToast(e, (e && e.userMessage) || 'Die Texterkennung ist fehlgeschlagen.');
    } finally {
      panel.close();
      if (n) { import('../extras/stats.js').then(m => m.track('ocr_pages', n)).catch(() => {}); toast(`Text auf ${n} Seite${n === 1 ? '' : 'n'} erkannt.`, 'success', { timeout: 2200 }); }
    }
  }

  // ---------- apply ----------
  const pagesOf = list => new Set(list.map(m => m.page)).size;
  const applyBtn = h(`<button class="btn btn-primary" type="button">${icon('redact')} Schwärzen anwenden</button>`);
  applyBtn.addEventListener('click', async () => {
    const r = await openDialog({
      title: 'Schwärzung anwenden?',
      body: `<p><b>Es wird eine neue Datei erstellt.</b> Auf ${pagesOf(marks)} Seite${pagesOf(marks) === 1 ? '' : 'n'} werden die markierten Stellen schwarz eingebrannt und alle Inhalte dieser Seiten in ein Bild umgewandelt – Text ist dort danach nicht mehr auswählbar oder durchsuchbar.</p>
        <label class="field"><span class="field-label">Qualität der geschwärzten Seiten</span>
          <select class="select" name="dpi"><option value="150">150 dpi – kleinere Datei</option><option value="200" selected>200 dpi – empfohlen</option><option value="300">300 dpi – Druckqualität</option></select></label>
        <label class="check"><input type="checkbox" name="meta" checked><span>Metadaten entfernen (Titel, Autor, Stichwörter …)</span></label>`,
      actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Endgültig schwärzen', value: 'ok', kind: 'btn-danger', default: true }],
      onMount: dlg => ({ collect: () => ({ dpi: +dlg.querySelector('[name=dpi]').value, meta: dlg.querySelector('[name=meta]').checked }) }),
    });
    if (r.value !== 'ok') return;
    applyBtn.disabled = true;
    const prog = progress('Schwärze …');
    try {
      const out = await applyRedactions(r.data, prog);
      const res = await saveResult(out, `${baseName(doc.name)} (geschwärzt).pdf`);
      savedSnapshot = JSON.stringify(marks);
      stageEl.querySelectorAll('.pt-result').forEach(x => x.remove());
      const wrap = h('<div class="pt-result screen-inner"></div>');
      wrap.appendChild(resultCard(res, { from: docId, title: 'Geschwärzt', note: 'Inhalte dauerhaft entfernt' }));
      stageEl.prepend(wrap);
      stageEl.scrollTo({ top: 0, behavior: 'smooth' });
      toast('Geschwärzte Kopie gespeichert.', 'success');
    } catch (e) { errorToast(e, 'Schwärzen fehlgeschlagen.'); }
    finally { prog.done(); update(); }
  });

  async function applyRedactions({ dpi, meta }, prog) {
    const PDFLib = await loadPdfLib();
    const { PDFName, PDFDict, PDFArray, PDFRef } = PDFLib;
    const pdfDoc = await loadEditable(bytes, doc.name, { key: docId });
    const ctx = pdfDoc.context;
    const pages = pdfDoc.getPages();
    const byPage = new Map();
    marks.forEach(m => { if (!byPage.has(m.page)) byPage.set(m.page, []); byPage.get(m.page).push(m); });
    const removedAnnots = new Set();
    let k = 0;
    for (const [num, list] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
      prog.set(`Schwärze Seite ${num} (${++k} von ${byPage.size}) …`);
      const p = stage.pages[num - 1];
      const maxPx = 14e6;
      let sc = dpi / 72;
      if (p.base.width * p.base.height * sc * sc > maxPx) sc = Math.sqrt(maxPx / (p.base.width * p.base.height));
      const canvas = await renderPage(p.page, { scale: sc });
      const g = canvas.getContext('2d');
      g.fillStyle = '#000';
      for (const m of list) {
        const x = Math.floor(m.x0 * sc) - 1, y = Math.floor(m.y0 * sc) - 1;
        g.fillRect(x, y, Math.ceil(m.x1 * sc) - x + 1, Math.ceil(m.y1 * sc) - y + 1);
      }
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
      canvas.width = canvas.height = 0;
      const img = await pdfDoc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const node = pages[num - 1].node;
      const W = p.base.width, H = p.base.height;
      const annots = node.lookup(PDFName.of('Annots'));
      if (annots instanceof PDFArray) for (let i = 0; i < annots.size(); i++) { const a = annots.get(i); if (a instanceof PDFRef) removedAnnots.add(a.tag); }
      for (const key of ['Contents', 'Annots', 'Thumb', 'PieceInfo', 'Metadata', 'StructParents', 'Tabs', 'AA', 'B', 'CropBox', 'BleedBox', 'TrimBox', 'ArtBox', 'Group', 'SeparationInfo', 'VP', 'PresSteps', 'Trans', 'Dur']) node.delete(PDFName.of(key));
      node.set(PDFName.of('MediaBox'), ctx.obj([0, 0, W, H]));
      node.set(PDFName.of('Rotate'), ctx.obj(0));
      node.set(PDFName.of('Resources'), ctx.obj({ XObject: { RedactImg: img.ref } }));
      const content = `q ${+W.toFixed(4)} 0 0 ${+H.toFixed(4)} 0 0 cm /RedactImg Do Q`;
      node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(content)));
      await tick();
    }
    prog.set('Entferne verborgene Inhalte …');
    const catalog = pdfDoc.catalog;
    // form fields whose widgets were on redacted pages (their values may contain the hidden text)
    const acro = catalog.lookup(PDFName.of('AcroForm'));
    if (acro instanceof PDFDict && removedAnnots.size) {
      const prune = arr => {
        if (!(arr instanceof PDFArray)) return;
        for (let i = arr.size() - 1; i >= 0; i--) {
          const ref = arr.get(i);
          const f = arr.lookup(i);
          if (ref instanceof PDFRef && removedAnnots.has(ref.tag)) { arr.remove(i); continue; }
          if (f instanceof PDFDict) {
            const kids = f.lookup(PDFName.of('Kids'));
            if (kids instanceof PDFArray) { prune(kids); if (!kids.size()) arr.remove(i); }
          }
        }
      };
      prune(acro.lookup(PDFName.of('Fields')));
    }
    // tagged-PDF structure can carry alternate text / actual text of the removed content
    catalog.delete(PDFName.of('StructTreeRoot'));
    catalog.delete(PDFName.of('MarkInfo'));
    if (meta) {
      catalog.delete(PDFName.of('Metadata'));
      ['Title', 'Author', 'Subject', 'Keywords', 'Creator'].forEach(k2 => { try { pdfDoc.getInfoDict().delete(PDFName.of(k2)); } catch {} });
    }
    await pdfDoc.flush();
    collectGarbage(PDFLib, ctx);
    return saveDoc(pdfDoc);
  }

  guardLeave(screen, () => marks.length > 0 && JSON.stringify(marks) !== savedSnapshot);
  setMode('area');
  update();
  return () => { stage.destroy(); pdf.destroy(); };
}

/** Delete every object that is not reachable from the trailer (pdf-lib writes all objects). */
export function collectGarbage(PDFLib, ctx) {
  const { PDFRef, PDFDict, PDFArray, PDFStream } = PDFLib;
  const seen = new Set();
  const stack = [ctx.trailerInfo.Root, ctx.trailerInfo.Info].filter(Boolean);
  while (stack.length) {
    const o = stack.pop();
    if (o instanceof PDFRef) {
      if (seen.has(o.tag)) continue;
      seen.add(o.tag);
      const obj = ctx.lookup(o);
      if (obj) stack.push(obj);
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) stack.push(v);
    } else if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) stack.push(o.get(i));
    } else if (o instanceof PDFStream) {
      stack.push(o.dict);
    }
  }
  let removed = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.tag)) { ctx.delete(ref); removed++; }
  return removed;
}
