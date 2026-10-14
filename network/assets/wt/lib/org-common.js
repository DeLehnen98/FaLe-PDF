// Shared helpers of the page tools (split, delete, extract, organize, rotate, blank pages, mix, halves):
// rearranging pages inside a pdf-lib document while keeping document-level parts (bookmarks, forms,
// links, metadata) and really removing deleted pages, copying pages into new documents, saving with
// the original password, syncing grid state with the shell's option controls, and a page stage
// (toolbar + PageGrid) for one PDF.
import { el } from './dom.js';
import { saveDoc, saveEncrypted } from './pdf.js';
import { removeUnreachable } from './pdfopt.js';
import { PageGrid, ThumbSource, loadGridCss, toolbar } from './pagegrid.js';

export const userError = (de, en) => Object.assign(new Error(en), { userMessage: { de, en } });
export const norm = deg => ((Math.round(deg / 90) * 90) % 360 + 360) % 360;

// ---------------------------------------------------------------- shell option sync
/** Write a text option of the shell (input #wt-opt-<id>) as if the user typed it. */
export function shellText(id, text) {
  const input = document.getElementById(`wt-opt-${id}`);
  if (!input || input.value === text) return;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  if (input.getAttribute('aria-invalid') === 'true') input.dispatchEvent(new Event('change', { bubbles: true }));
}
/** Select a radio option of the shell. */
export function shellRadio(id, value) {
  const r = [...document.querySelectorAll(`input[name="wt-opt-${id}"]`)].find(x => x.value === String(value));
  if (r && !r.checked) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
}

// ---------------------------------------------------------------- saving
/** Save; a source that was opened with a password is protected again with it. Returns bytes. */
export async function saveLike(doc, input, ctx, { title = null } = {}) {
  const pw = input?.password || doc.wtPassword || null;
  if (pw) {
    ctx.note({ de: 'Die Datei ist wieder mit demselben Passwort geschützt.', en: 'The file is protected again with the same password.' });
    return saveEncrypted(doc, pw, { title });
  }
  return saveDoc(doc, { title });
}
export const pdfBlob = bytes => new Blob([bytes], { type: 'application/pdf' });

// ---------------------------------------------------------------- page tree surgery
const INHERITABLE = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];

/** Copy inherited page attributes onto the leaf, so it can live under any parent. */
export function materialize(page, PDFLib) {
  const { PDFName } = PDFLib;
  for (const k of INHERITABLE) {
    const name = PDFName.of(k);
    if (page.node.has(name)) continue;
    const v = page.node.getInheritableAttribute(name);
    if (v) page.node.set(name, v);
  }
}

/** A second page object showing the same content (contents/resources shared, no form widgets). */
export function clonePage(doc, PDFLib, page) {
  const { PDFName, PDFArray, PDFDict, PDFRef, PDFPage } = PDFLib;
  const ctx = doc.context;
  materialize(page, PDFLib);
  const leaf = page.node.clone(ctx);
  const ref = ctx.register(leaf);
  const annots = page.node.lookup(PDFName.of('Annots'));
  leaf.delete(PDFName.of('Annots'));
  leaf.delete(PDFName.of('StructParents'));
  if (annots instanceof PDFArray) {
    const list = [];
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookup(i);
      if (!(a instanceof PDFDict)) continue;
      const sub = a.get(PDFName.of('Subtype'))?.toString();
      if (sub === '/Widget' || sub === '/Popup') continue;
      const c = a.clone(ctx);
      c.delete(PDFName.of('Popup'));
      c.delete(PDFName.of('StructParent'));
      c.set(PDFName.of('P'), ref);
      list.push(ctx.register(c));
    }
    if (list.length) leaf.set(PDFName.of('Annots'), ctx.obj(list));
  }
  const p = PDFPage.of(leaf, ref, doc);
  return p;
}

/**
 * Rebuild the page list of `doc` in place.
 * spec: [{ page: PDFPage of doc, rot?: degrees added }, { blank: [w, h], rot? }, …] – a page may appear
 * several times (copies share content). Pages that are not in spec are removed for real (also from
 * bookmarks, named destinations, forms and the structure tree, then garbage-collected), so their content
 * is not left hidden in the file.
 */
export function rearrange(doc, PDFLib, spec) {
  const { PDFName, PDFNumber, PDFPage, degrees } = PDFLib;
  const ctx = doc.context;
  const old = doc.getPages();
  for (const p of old) materialize(p, PDFLib);
  const used = new Set();
  const out = [];
  for (const s of spec) {
    let page;
    if (s.blank) {
      page = PDFPage.create(doc);
      page.setSize(s.blank[0], s.blank[1]);
    } else if (!used.has(s.page)) { page = s.page; used.add(page); } else page = clonePage(doc, PDFLib, s.page);
    out.push([page, s.rot || 0]);
  }
  for (const [page, rot] of out) if (rot) page.setRotation(degrees(norm(page.getRotation().angle + rot)));

  // flat page tree: root /Pages → all leaves
  const rootRef = doc.catalog.get(PDFName.of('Pages'));
  const root = doc.catalog.Pages();
  const kids = ctx.obj(out.map(([p]) => p.ref));
  root.set(PDFName.of('Kids'), kids);
  root.set(PDFName.of('Count'), PDFNumber.of(out.length));
  for (const k of INHERITABLE) root.delete(PDFName.of(k));
  for (const [p] of out) { p.node.set(PDFName.of('Parent'), rootRef); doc.pageMap.set(p.node, p); }
  doc.pageCount = undefined;
  doc.pageCache.invalidate();

  const removed = old.filter(p => !used.has(p));
  if (removed.length) prune(doc, PDFLib, removed.map(p => p.ref), new Set(out.map(([p]) => p.ref)));
  else removeUnreachable(doc, PDFLib);
  if (removed.length || out.length !== old.length || out.some(([p], i) => p !== old[i])) doc.catalog.delete(PDFName.of('PageLabels'));
  return doc;
}

/** Remove every trace of the given page refs (and their annotations), then drop unreachable objects. */
function prune(doc, PDFLib, removedRefs, keptRefs) {
  const { PDFName, PDFArray, PDFDict, PDFRef, PDFStream } = PDFLib;
  const ctx = doc.context;
  const dead = new Set(removedRefs);
  // annotations that only lived on removed pages
  const keptAnnots = new Set();
  for (const ref of keptRefs) {
    const a = ctx.lookup(ref)?.get(PDFName.of('Annots'));
    const arr = a instanceof PDFRef ? ctx.lookup(a) : a;
    if (arr instanceof PDFArray) for (let i = 0; i < arr.size(); i++) { const x = arr.get(i); if (x instanceof PDFRef) keptAnnots.add(x); }
  }
  for (const ref of removedRefs) {
    const a = ctx.lookup(ref)?.get(PDFName.of('Annots'));
    const arr = a instanceof PDFRef ? ctx.lookup(a) : a;
    if (arr instanceof PDFArray) for (let i = 0; i < arr.size(); i++) { const x = arr.get(i); if (x instanceof PDFRef && !keptAnnots.has(x)) dead.add(x); }
  }
  const pointsToDead = dest => {
    let d = dest instanceof PDFRef ? ctx.lookup(dest) : dest;
    if (d instanceof PDFDict) { // action or {D: …}
      const inner = d.get(PDFName.of('D'));
      d = inner instanceof PDFRef ? ctx.lookup(inner) : inner;
    }
    return d instanceof PDFArray && d.size() > 0 && dead.has(d.get(0));
  };

  // bookmarks: drop entries that point to removed pages (their children move up)
  const outlines = doc.catalog.lookup(PDFName.of('Outlines'));
  if (outlines instanceof PDFDict) pruneOutline(outlines, doc.catalog.get(PDFName.of('Outlines')));
  function pruneOutline(parent, parentRef) {
    const items = [];
    for (let r = parent.get(PDFName.of('First')), g = 0; r instanceof PDFRef && g < 100000; g++) {
      const it = ctx.lookup(r);
      if (!(it instanceof PDFDict)) break;
      items.push([r, it]);
      r = it.get(PDFName.of('Next'));
    }
    const keep = [];
    for (const [r, it] of items) {
      pruneOutline(it, r);
      const dest = it.get(PDFName.of('Dest')) ?? it.lookup(PDFName.of('A'));
      const bad = dest && pointsToDead(dest);
      if (!bad) { keep.push([r, it]); continue; }
      // promote children of a removed entry
      const kids = [];
      for (let c = it.get(PDFName.of('First')), g = 0; c instanceof PDFRef && g < 100000; g++) { const ci = ctx.lookup(c); if (!(ci instanceof PDFDict)) break; kids.push([c, ci]); c = ci.get(PDFName.of('Next')); }
      keep.push(...kids);
    }
    keep.forEach(([r, it], i) => {
      it.set(PDFName.of('Parent'), parentRef);
      if (i > 0) it.set(PDFName.of('Prev'), keep[i - 1][0]); else it.delete(PDFName.of('Prev'));
      if (i < keep.length - 1) it.set(PDFName.of('Next'), keep[i + 1][0]); else it.delete(PDFName.of('Next'));
    });
    if (keep.length) { parent.set(PDFName.of('First'), keep[0][0]); parent.set(PDFName.of('Last'), keep[keep.length - 1][0]); }
    else { parent.delete(PDFName.of('First')); parent.delete(PDFName.of('Last')); }
    if (items.length !== keep.length) {
      const c = parent.get(PDFName.of('Count'));
      if (c) parent.set(PDFName.of('Count'), PDFLib.PDFNumber.of(c.asNumber() < 0 ? -keep.length : keep.length));
    }
  }
  if (outlines instanceof PDFDict && !outlines.get(PDFName.of('First'))) doc.catalog.delete(PDFName.of('Outlines'));

  // named destinations (catalog /Dests and the /Names /Dests tree)
  const dests = doc.catalog.lookup(PDFName.of('Dests'));
  if (dests instanceof PDFDict) for (const [k, v] of dests.entries()) if (pointsToDead(v)) dests.delete(k);
  const names = doc.catalog.lookup(PDFName.of('Names'));
  const tree = names instanceof PDFDict ? names.lookup(PDFName.of('Dests')) : null;
  if (tree instanceof PDFDict) pruneNameTree(tree, 0);
  function pruneNameTree(node, depth) {
    if (depth > 32) return;
    const arr = node.lookup(PDFName.of('Names'));
    if (arr instanceof PDFArray) {
      const keep = [];
      for (let i = 0; i + 1 < arr.size(); i += 2) if (!pointsToDead(arr.get(i + 1))) keep.push(arr.get(i), arr.get(i + 1));
      node.set(PDFName.of('Names'), ctx.obj(keep));
    }
    const kids = node.lookup(PDFName.of('Kids'));
    if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i++) { const k = kids.lookup(i); if (k instanceof PDFDict) pruneNameTree(k, depth + 1); }
  }
  const open = doc.catalog.get(PDFName.of('OpenAction'));
  if (open && pointsToDead(open)) doc.catalog.delete(PDFName.of('OpenAction'));

  // links on kept pages that jump to a removed page lose their target (the link area stays inert)
  for (const ref of keptRefs) {
    const annots = ctx.lookup(ref)?.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookup(i);
      if (!(a instanceof PDFDict) || a.get(PDFName.of('Subtype'))?.toString() !== '/Link') continue;
      for (const k of ['Dest', 'A']) { const v = a.get(PDFName.of(k)); if (v && pointsToDead(v)) a.delete(PDFName.of(k)); }
    }
  }
  // everything else (form fields, structure tree …): remove references
  const scrub = (obj, depth = 0) => {
    if (depth > 200) return;
    if (obj instanceof PDFStream) obj = obj.dict;
    if (obj instanceof PDFDict) {
      for (const [k, v] of obj.entries()) {
        if (v instanceof PDFRef) { if (dead.has(v)) obj.delete(k); }
        else if (v instanceof PDFDict || v instanceof PDFArray) scrub(v, depth + 1);
      }
    } else if (obj instanceof PDFArray) {
      for (let i = obj.size() - 1; i >= 0; i--) {
        const v = obj.get(i);
        if (v instanceof PDFRef) { if (dead.has(v)) obj.remove(i); }
        else if (v instanceof PDFDict || v instanceof PDFArray) scrub(v, depth + 1);
      }
    }
  };
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) if (!dead.has(ref)) scrub(obj);
  // a link annotation whose destination page is gone stays as a dead link: remove its action
  removeUnreachable(doc, PDFLib);
}

/**
 * New document with copies of `indices` of `src` (repeats allowed). Form fields of the copied pages keep
 * working (registered in the new AcroForm). Returns the new pdf-lib document.
 */
export async function copyToNew(PDFLib, src, indices, { rot = null } = {}) {
  const { PDFName, PDFDict, PDFArray, PDFRef, degrees } = PDFLib;
  const out = await PDFLib.PDFDocument.create();
  const fields = [];
  const seen = new Set();
  let chunk = [];
  const flush = async () => {
    if (!chunk.length) return;
    const copied = await out.copyPages(src, chunk);
    copied.forEach((p, k) => {
      const r = rot ? rot[out.getPageCount()] : 0;
      out.addPage(p);
      if (r) p.setRotation(degrees(norm(p.getRotation().angle + r)));
      const annots = p.node.lookup(PDFName.of('Annots'));
      if (!(annots instanceof PDFArray)) return;
      for (let i = 0; i < annots.size(); i++) {
        let ref = annots.get(i);
        let d = ref instanceof PDFRef ? out.context.lookup(ref) : ref;
        if (!(d instanceof PDFDict) || d.get(PDFName.of('Subtype'))?.toString() !== '/Widget') continue;
        for (let g = 0; g < 32; g++) { const par = d.get(PDFName.of('Parent')); if (!(par instanceof PDFRef)) break; ref = par; d = out.context.lookup(par); }
        if (ref instanceof PDFRef && !seen.has(ref)) { seen.add(ref); fields.push(ref); }
      }
    });
    chunk = [];
  };
  for (const i of indices) { if (chunk.includes(i)) await flush(); chunk.push(i); }
  await flush();
  if (fields.length) {
    const form = out.context.obj({});
    form.set(PDFName.of('Fields'), out.context.obj(fields));
    const sf = src.catalog.lookup(PDFName.of('AcroForm'));
    if (sf instanceof PDFDict) {
      const copier = PDFLib.PDFObjectCopier.for(src.context, out.context);
      for (const k of ['DR', 'DA', 'Q', 'NeedAppearances']) { const v = sf.get(PDFName.of(k)); if (v) form.set(PDFName.of(k), copier.copy(v)); }
    }
    out.catalog.set(PDFName.of('AcroForm'), out.context.register(form));
  }
  const title = src.getTitle?.();
  if (title) out.setTitle(title);
  return out;
}

// ---------------------------------------------------------------- ranges ↔ cuts
/** Groups (arrays of 0-based pages) → text "1-3, 4-8". */
export function groupsToText(groups) {
  return groups.map(g => (g.length > 1 && g[g.length - 1] - g[0] === g.length - 1 ? `${g[0] + 1}-${g[g.length - 1] + 1}` : g.map(p => p + 1).join(' '))).join(', ');
}
/** Contiguous groups from cut positions (cut after page index). */
export function groupsFromCuts(cuts, count) {
  const sorted = [...cuts].filter(c => c >= 0 && c < count - 1).sort((a, b) => a - b);
  const groups = [];
  let start = 0;
  for (const c of [...sorted, count - 1]) { groups.push(range(start, c)); start = c + 1; }
  return groups.filter(g => g.length);
}
export const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

/**
 * Parse split ranges: "1-3, 4-8" → [[0,1,2],[3..7]]; a part may list several pages with spaces or "+"
 * ("1 3 5" or "1+3+5"); "8-" means to the end. Throws {kind, detail} on errors.
 */
export function parseGroups(text, count) {
  const src = String(text || '').trim().toLowerCase();
  if (!src) return [];
  const groups = [];
  for (const raw of src.split(/[,;\n]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const pages = [];
    for (const tok of part.replace(/[–—]/g, '-').replace(/\s*-\s*/g, '-').split(/[\s+]+/)) {
      if (!tok) continue;
      let m;
      if ((m = /^(\d+)$/.exec(tok))) pages.push(check(+m[1]) - 1);
      else if ((m = /^(\d*)-(\d*)$/.exec(tok)) && (m[1] || m[2])) {
        const a = m[1] ? check(+m[1]) : 1, b = m[2] ? check(+m[2]) : count;
        if (a <= b) for (let i = a; i <= b; i++) pages.push(i - 1); else for (let i = a; i >= b; i--) pages.push(i - 1);
      } else if (['letzte', 'last', 'ende', 'end'].includes(tok)) pages.push(count - 1);
      else throw Object.assign(new Error('syntax'), { kind: 'syntax', detail: tok });
    }
    if (pages.length) groups.push(pages);
  }
  return groups;
  function check(p) { if (p < 1 || p > count) throw Object.assign(new Error('range'), { kind: 'range', detail: p }); return p; }
}

// ---------------------------------------------------------------- page stage for one PDF
/**
 * Toolbar + PageGrid for the first usable PDF of the inputs.
 * o: { mode, mark, buttons, hint, grid: {extra PageGrid options}, onLoad(items, input) }
 */
export class PageStage {
  constructor(host, ctx, o = {}) {
    this.ctx = ctx;
    this.lang = ctx.lang;
    this.o = o;
    this.thumbs = new ThumbSource();
    this.input = null;
    this.items = [];
    this.wrap = el('div', { class: 'pg-stage', hidden: true });
    host.append(this.wrap);
    if (o.buttons) { this.tb = toolbar(o.buttons); this.wrap.append(this.tb.bar); }
    this.ready = loadGridCss();
    this.grid = new PageGrid(this.wrap, { lang: this.lang, mode: o.mode || 'select', mark: o.mark, thumbs: this.thumbs, ...(o.grid || {}) });
    if (o.hint) this.wrap.append(el('p', { class: 'pg-hint' }, ctx.t(o.hint)));
    this.token = 0;
  }

  /** Load the first usable PDF. Resolves true when a new document was loaded. */
  async setInputs(inputs) {
    const input = inputs.find(i => i.kind === 'pdf' && !i.locked && !i.error) || null;
    if (input === this.input) return false;
    const token = ++this.token;
    if (this.input) this.thumbs.dropInput(this.input.id);
    this.input = input;
    if (!input) { this.items = []; this.grid.setItems([]); this.wrap.hidden = true; return true; }
    this.thumbs.addInput(input);
    const n = await input.pageCount();
    await this.ready;
    if (token !== this.token) return false;
    this.items = Array.from({ length: n }, (_, p) => ({ id: `${input.id}:${p}`, src: { f: input.id, p }, rot: 0 }));
    this.grid.setItems(this.items);
    this.wrap.hidden = false;
    this.o.onLoad?.(this.items, input);
    this.loadSizes(token);
    return true;
  }

  /** Page sizes in the background (orientation filters, placeholder aspect). */
  async loadSizes(token) {
    const items = this.items;
    if (items.length > 3000) return;
    for (let i = 0; i < items.length; i++) {
      if (token !== this.token) return;
      try { await this.thumbs.pageSize(items[i].src); } catch { return; }
      if (i % 25 === 24) { this.grid.refresh(); await new Promise(r => setTimeout(r, 0)); }
    }
    if (token !== this.token) return;
    this.sizesLoaded = true;
    this.grid.refresh();
    this.o.onSizes?.();
  }

  size(item) { return item.src ? this.thumbs.size(item.src) : null; }
  info(node) { if (this.tb) { this.tb.info.replaceChildren(...[].concat(node)); } }
}

/** Selected 0-based page indices (document order) of a stage. */
export const selectedPages = stage => stage.items.filter(it => stage.grid.selected.has(it.id)).map(it => it.src.p);
