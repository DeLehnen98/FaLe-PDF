// .pptx reader (own parser on top of JSZip): slides → simple presentation model (inches, pt).
// Handles text boxes/placeholders (incl. inheritance from layout + master), runs, bullets, pictures,
// solid/gradient fills, lines, groups, tables, backgrounds (colour/image), slide size.
import { openZip, zipXml, kids, kid, attr, rid, readRels, desc, zipImageDataUrl, path as xpath, tick } from './vendor.js';
import { UserError } from '../ui.js';

const EMU = 914400;
const emu = v => (v == null ? 0 : +v / EMU);

export async function readPptx(data, name = 'Präsentation', { onProgress, maxSlides = Infinity } = {}) {
  const zip = await openZip(data, name);
  const pkg = await readRels(zip, '');
  let presPath = 'ppt/presentation.xml';
  for (const r of pkg.values()) if (r.type === 'officeDocument') presPath = r.target;
  const pres = await zipXml(zip, presPath);
  if (!pres) throw new UserError(`„${name}“ enthält keine Präsentation.`);
  const presRels = await readRels(zip, presPath);
  const sz = desc(pres, 'sldSz')[0];
  const model = { w: sz ? emu(attr(sz, 'cx')) : 10, h: sz ? emu(attr(sz, 'cy')) : 7.5, slides: [], theme: null };
  const defaultTextStyle = desc(pres, 'defaultTextStyle')[0] || null;
  const ids = desc(kid(pres.documentElement, 'sldIdLst'), 'sldId');
  const cache = new Map();
  const images = new Map();
  const part = async p => {
    if (!cache.has(p)) cache.set(p, (async () => ({ doc: await zipXml(zip, p), rels: await readRels(zip, p), path: p }))());
    return cache.get(p);
  };
  let n = 0;
  for (const sid of ids) {
    if (n >= maxSlides) break;
    const rel = presRels.get(rid(sid));
    if (!rel) continue;
    const slide = await part(rel.target);
    if (!slide.doc) continue;
    if (attr(slide.doc.documentElement, 'show') === '0') { n++; continue; } // hidden slide
    let layout = null, master = null, theme = null;
    for (const r of slide.rels.values()) if (r.type === 'slideLayout') layout = await part(r.target);
    if (layout) for (const r of layout.rels.values()) if (r.type === 'slideMaster') master = await part(r.target);
    if (master) for (const r of master.rels.values()) if (r.type === 'theme') theme = await part(r.target);
    const ctx = { zip, images, slide, layout, master, colors: themeColors(theme, master), defaultTextStyle, fonts: themeFonts(theme) };
    model.slides.push(await readSlide(ctx));
    n++;
    onProgress && onProgress(n / ids.length);
    if (n % 5 === 0) await tick();
  }
  if (!model.slides.length) model.slides.push({ bg: { color: '#FFFFFF' }, els: [] });
  return model;
}

// ---------------- colours ----------------
function themeColors(theme, master) {
  const c = { dk1: '000000', lt1: 'FFFFFF', dk2: '44546A', lt2: 'E7E6E6', accent1: '4472C4', accent2: 'ED7D31', accent3: 'A5A5A5', accent4: 'FFC000', accent5: '5B9BD5', accent6: '70AD47', hlink: '0563C1', folHlink: '954F72' };
  const scheme = theme && theme.doc && desc(theme.doc, 'clrScheme')[0];
  if (scheme) for (const e of kids(scheme)) {
    const s = kid(e, 'srgbClr'), y = kid(e, 'sysClr');
    if (s) c[e.localName] = attr(s, 'val'); else if (y) c[e.localName] = attr(y, 'lastClr') || (attr(y, 'val') === 'window' ? 'FFFFFF' : '000000');
  }
  const map = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
  const cm = master && master.doc && desc(master.doc, 'clrMap')[0];
  if (cm) for (const k of Object.keys(map)) if (attr(cm, k)) map[k] = attr(cm, k);
  return { scheme: c, map };
}
function themeFonts(theme) {
  const f = { major: 'Arial', minor: 'Arial' };
  const fs = theme && theme.doc && desc(theme.doc, 'fontScheme')[0];
  if (fs) {
    const mj = xpath(fs, 'majorFont', 'latin'), mn = xpath(fs, 'minorFont', 'latin');
    if (mj && attr(mj, 'typeface')) f.major = attr(mj, 'typeface');
    if (mn && attr(mn, 'typeface')) f.minor = attr(mn, 'typeface');
  }
  return f;
}
const PRST = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080', orange: 'FFA500', darkBlue: '00008B', darkGray: 'A9A9A9', lightGray: 'D3D3D3' };

function hexToRgb(h) { return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); }
function rgbToHex(r, g, b) { return [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase(); }
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** Resolve a colour element container (solidFill, fontRef …) to '#RRGGBB' (null = none). */
function colorIn(parent, ctx, phClr = null) {
  if (!parent) return null;
  const el = kid(parent, 'srgbClr') || kid(parent, 'schemeClr') || kid(parent, 'prstClr') || kid(parent, 'sysClr') || kid(parent, 'scrgbClr') || kid(parent, 'hslClr');
  if (!el) return null;
  let hex = null;
  switch (el.localName) {
    case 'srgbClr': hex = attr(el, 'val'); break;
    case 'sysClr': hex = attr(el, 'lastClr') || (attr(el, 'val') === 'window' ? 'FFFFFF' : '000000'); break;
    case 'prstClr': hex = PRST[attr(el, 'val')] || '000000'; break;
    case 'scrgbClr': hex = rgbToHex(+attr(el, 'r') / 100000 * 255, +attr(el, 'g') / 100000 * 255, +attr(el, 'b') / 100000 * 255); break;
    case 'schemeClr': {
      let v = attr(el, 'val');
      if (v === 'phClr') { hex = phClr ? phClr.replace('#', '') : '000000'; break; }
      v = ctx.colors.map[v] || v;
      hex = ctx.colors.scheme[v] || '000000';
      break;
    }
    default: hex = '000000';
  }
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return null;
  let [r, g, b] = hexToRgb(hex);
  for (const m of kids(el)) {
    const val = +attr(m, 'val') / 100000;
    if (m.localName === 'lumMod' || m.localName === 'lumOff') {
      const [hh, ss, ll] = rgbToHsl(r, g, b);
      const nl = m.localName === 'lumMod' ? ll * val : ll + val;
      [r, g, b] = hslToRgb(hh, ss, Math.max(0, Math.min(1, nl)));
    } else if (m.localName === 'tint') { r = r + (255 - r) * (1 - val); g = g + (255 - g) * (1 - val); b = b + (255 - b) * (1 - val); }
    else if (m.localName === 'shade') { r *= val; g *= val; b *= val; }
  }
  return '#' + rgbToHex(r, g, b);
}
function alphaIn(parent) {
  const el = parent && (kid(parent, 'srgbClr') || kid(parent, 'schemeClr') || kid(parent, 'prstClr') || kid(parent, 'sysClr'));
  const a = el && kid(el, 'alpha');
  return a ? +attr(a, 'val') / 100000 : 1;
}

function fillOf(spPr, ctx, styleEl) {
  if (spPr) {
    if (kid(spPr, 'noFill')) return { none: true };
    const sf = kid(spPr, 'solidFill');
    if (sf) return { color: colorIn(sf, ctx), alpha: alphaIn(sf) };
    const gf = kid(spPr, 'gradFill');
    if (gf) { const gs = desc(gf, 'gs'); if (gs.length) return { color: colorIn(gs[0], ctx), color2: colorIn(gs[gs.length - 1], ctx), alpha: alphaIn(gs[0]) }; }
    const bf = kid(spPr, 'blipFill');
    if (bf) return { blip: bf };
    if (kid(spPr, 'grpFill')) return { group: true };
  }
  if (styleEl) {
    const fr = kid(styleEl, 'fillRef');
    if (fr && +attr(fr, 'idx') > 0) return { color: colorIn(fr, ctx) };
  }
  return null;
}
function lineOf(spPr, ctx, styleEl) {
  const ln = spPr && kid(spPr, 'ln');
  if (ln) {
    if (kid(ln, 'noFill')) return null;
    const sf = kid(ln, 'solidFill');
    const w = attr(ln, 'w') ? +attr(ln, 'w') / 12700 : 0.75;
    if (sf) return { color: colorIn(sf, ctx), w };
  }
  if (styleEl) {
    const lr = kid(styleEl, 'lnRef');
    if (lr && +attr(lr, 'idx') > 0 && !(ln && kid(ln, 'noFill'))) return { color: colorIn(lr, ctx), w: ln && attr(ln, 'w') ? +attr(ln, 'w') / 12700 : 0.75 };
  }
  return null;
}

// ---------------- placeholders ----------------
function phOf(sp) {
  const nv = kid(sp, 'nvSpPr') || kid(sp, 'nvPicPr') || kid(sp, 'nvGraphicFramePr');
  const ph = nv && desc(nv, 'ph')[0];
  if (!ph) return null;
  return { type: attr(ph, 'type') || 'obj', idx: attr(ph, 'idx') };
}
function findPh(partDoc, ph) {
  if (!partDoc || !ph) return null;
  const sps = desc(partDoc, 'sp');
  const norm = t => (t === 'ctrTitle' ? 'title' : t === 'subTitle' ? 'body' : t === 'obj' ? 'body' : t);
  if (ph.idx != null) { const m = sps.find(s => { const p = phOf(s); return p && p.idx === ph.idx; }); if (m) return m; }
  let m = sps.find(s => { const p = phOf(s); return p && p.type === ph.type; });
  if (!m) m = sps.find(s => { const p = phOf(s); return p && norm(p.type) === norm(ph.type); });
  return m || null;
}
function xfrmOf(el) {
  const sp = kid(el, 'spPr') || kid(el, 'grpSpPr');
  const x = (sp && kid(sp, 'xfrm')) || kid(el, 'xfrm');
  if (!x) return null;
  const off = kid(x, 'off'), ext = kid(x, 'ext');
  if (!off || !ext) return null;
  return {
    x: emu(attr(off, 'x')), y: emu(attr(off, 'y')), w: emu(attr(ext, 'cx')), h: emu(attr(ext, 'cy')),
    rot: attr(x, 'rot') ? +attr(x, 'rot') / 60000 : 0, flipH: attr(x, 'flipH') === '1', flipV: attr(x, 'flipV') === '1',
    chOff: kid(x, 'chOff'), chExt: kid(x, 'chExt'),
  };
}

// ---------------- slide ----------------
async function readSlide(ctx) {
  const sdoc = ctx.slide.doc;
  const out = { bg: await background(ctx), els: [] };
  const showMaster = el => el && attr(el.documentElement, 'showMasterSp') !== '0';
  // decorative shapes of master + layout (non-placeholders)
  if (ctx.master && showMaster(ctx.slide.doc) && (!ctx.layout || showMaster(ctx.layout.doc))) {
    await walkTree(spTree(ctx.master.doc), ctx, ctx.master, out.els, null, true);
  }
  if (ctx.layout && showMaster(ctx.slide.doc)) await walkTree(spTree(ctx.layout.doc), ctx, ctx.layout, out.els, null, true);
  out.els.forEach(e => { e.locked = true; });
  await walkTree(spTree(sdoc), ctx, ctx.slide, out.els, null, false);
  // slide transition (also inside mc:AlternateContent)
  const tr = desc(sdoc, 'transition')[0];
  if (tr) { const k = kids(tr)[0]; const n = k ? k.localName : 'fade'; out.transition = n === 'push' || n === 'cover' || n === 'pull' || n === 'wipe' || n === 'split' ? 'push' : 'fade'; }
  // speaker notes
  for (const r of ctx.slide.rels.values()) {
    if (r.type !== 'notesSlide') continue;
    const nd = await zipXml(ctx.zip, r.target);
    if (!nd) break;
    for (const sp of desc(nd, 'sp')) {
      const ph = desc(sp, 'ph')[0];
      if (!ph || attr(ph, 'type') !== 'body') continue;
      const text = desc(sp, 'p').map(pp => desc(pp, 't').map(t => t.textContent).join('')).join('\n').trim();
      if (text) out.notes = text;
    }
    break;
  }
  return out;
}
function spTree(doc) { return doc ? desc(doc, 'spTree')[0] : null; }

async function background(ctx) {
  for (const p of [ctx.slide, ctx.layout, ctx.master]) {
    if (!p || !p.doc) continue;
    const bg = desc(p.doc, 'bg')[0];
    if (!bg) continue;
    const pr = kid(bg, 'bgPr');
    if (pr) {
      const sf = kid(pr, 'solidFill');
      if (sf) return { color: colorIn(sf, ctx) || '#FFFFFF' };
      const gf = kid(pr, 'gradFill');
      if (gf) { const gs = desc(gf, 'gs'); return { color: colorIn(gs[0], ctx) || '#FFFFFF', color2: gs.length > 1 ? colorIn(gs[gs.length - 1], ctx) : null }; }
      const bf = kid(pr, 'blipFill');
      if (bf) { const img = await blipUrl(bf, ctx, p); return { color: '#FFFFFF', image: img }; }
    }
    const ref = kid(bg, 'bgRef');
    if (ref) return { color: colorIn(ref, ctx) || '#FFFFFF' };
  }
  return { color: '#FFFFFF' };
}

async function blipUrl(blipFill, ctx, part) {
  const blip = kid(blipFill, 'blip');
  const rid = blip && (attr(blip, 'embed') || attr(blip, 'link'));
  const rel = rid && part.rels.get(rid);
  if (!rel || rel.external) return null;
  if (!ctx.images.has(rel.target)) ctx.images.set(rel.target, await zipImageDataUrl(ctx.zip, rel.target));
  return ctx.images.get(rel.target);
}

async function walkTree(tree, ctx, part, out, tf, decorOnly) {
  if (!tree) return;
  for (const el of kids(tree)) {
    const ln = el.localName;
    if (ln === 'sp' || ln === 'cxnSp') {
      const ph = phOf(el);
      if (decorOnly && ph) continue;
      const e = await readShape(el, ctx, part, ph, decorOnly);
      if (e) out.push(transform(e, tf));
    } else if (ln === 'pic') {
      if (decorOnly && phOf(el)) continue;
      const x = xfrmOf(el) || inheritedXfrm(phOf(el), ctx, part);
      const bf = kid(el, 'blipFill');
      const src = bf ? await blipUrl(bf, ctx, part) : null;
      if (x && src) {
        const sr = bf && kid(bf, 'srcRect');
        const crop = sr ? ['l', 't', 'r', 'b'].map(k => (attr(sr, k) ? +attr(sr, k) / 100000 : 0)) : null;
        out.push(transform({ type: 'image', x: x.x, y: x.y, w: x.w, h: x.h, rot: x.rot, src, crop: crop && crop.some(Boolean) ? crop : null }, tf));
      } else if (x && !src) out.push(transform({ type: 'shape', geom: 'rect', x: x.x, y: x.y, w: x.w, h: x.h, fill: '#EEF0F8', line: { color: '#C9CCDA', w: 0.75 }, text: { paras: [{ align: 'ctr', level: 0, runs: [{ text: 'Grafik (nicht unterstützt)', size: 12, color: '#6B7194' }] }], anchor: 'ctr', ins: [0.1, 0.05, 0.1, 0.05] } }, tf));
    } else if (ln === 'grpSp') {
      const x = xfrmOf(el);
      let child = tf;
      if (x && x.chOff && x.chExt) {
        const cx = emu(attr(x.chOff, 'x')), cy = emu(attr(x.chOff, 'y')), cw = emu(attr(x.chExt, 'cx')) || 1, ch = emu(attr(x.chExt, 'cy')) || 1;
        const local = { sx: x.w / cw, sy: x.h / ch, ox: x.x - cx * (x.w / cw), oy: x.y - cy * (x.h / ch) };
        child = tf ? { sx: tf.sx * local.sx, sy: tf.sy * local.sy, ox: tf.ox + tf.sx * local.ox, oy: tf.oy + tf.sy * local.oy } : local;
      }
      await walkTree(el, ctx, part, out, child, decorOnly);
    } else if (ln === 'graphicFrame') {
      if (decorOnly) continue;
      const x = xfrmOf(el);
      if (!x) continue;
      const tbl = desc(el, 'tbl')[0];
      if (tbl) out.push(transform(readTable(tbl, x, ctx), tf));
      else out.push(transform({ type: 'shape', geom: 'rect', x: x.x, y: x.y, w: x.w, h: x.h, fill: '#F5F6FB', line: { color: '#C9CCDA', w: 0.75 }, text: { paras: [{ align: 'ctr', level: 0, runs: [{ text: 'Diagramm / Objekt', size: 14, color: '#6B7194' }] }], anchor: 'ctr', ins: [0.1, 0.05, 0.1, 0.05] } }, tf));
    } else if (ln === 'AlternateContent') {
      const ch = kid(el, 'Choice') || kid(el, 'Fallback');
      if (ch) await walkTree(ch, ctx, part, out, tf, decorOnly);
    }
  }
}

function transform(e, tf) {
  if (!tf) return e;
  return { ...e, x: tf.ox + e.x * tf.sx, y: tf.oy + e.y * tf.sy, w: e.w * tf.sx, h: e.h * tf.sy };
}

function inheritedXfrm(ph, ctx, part) {
  if (!ph) return null;
  if (part === ctx.slide) {
    const l = ctx.layout && findPh(ctx.layout.doc, ph);
    const lx = l && xfrmOf(l);
    if (lx) return lx;
    const m = ctx.master && findPh(ctx.master.doc, { type: (l && phOf(l) && phOf(l).type) || ph.type });
    return m ? xfrmOf(m) : null;
  }
  if (part === ctx.layout) { const m = ctx.master && findPh(ctx.master.doc, ph); return m ? xfrmOf(m) : null; }
  return null;
}

const GEOMS = new Set(['rect', 'roundRect', 'ellipse', 'triangle', 'rtTriangle', 'diamond', 'parallelogram', 'trapezoid', 'pentagon', 'hexagon', 'octagon', 'chevron', 'homePlate', 'rightArrow', 'leftArrow', 'upArrow', 'downArrow', 'line', 'straightConnector1', 'snip1Rect', 'round1Rect', 'round2SameRect', 'flowChartProcess', 'flowChartAlternateProcess', 'plaque', 'can', 'star5', 'heart', 'cloud', 'donut', 'wedgeRectCallout', 'wedgeRoundRectCallout']);

async function readShape(sp, ctx, part, ph, decorOnly) {
  const spPr = kid(sp, 'spPr');
  let x = xfrmOf(sp);
  let layoutPh = null, masterPh = null;
  if (ph && part === ctx.slide) {
    layoutPh = ctx.layout && findPh(ctx.layout.doc, ph);
    const t = layoutPh ? phOf(layoutPh) : ph;
    masterPh = ctx.master && findPh(ctx.master.doc, { type: t.type, idx: null });
  } else if (ph && part === ctx.layout) masterPh = ctx.master && findPh(ctx.master.doc, ph);
  if (!x) x = (layoutPh && xfrmOf(layoutPh)) || (masterPh && xfrmOf(masterPh));
  if (!x) return null;
  const styleEl = kid(sp, 'style');
  const prstEl = spPr && kid(spPr, 'prstGeom');
  let geom = prstEl ? attr(prstEl, 'prst') : (sp.localName === 'cxnSp' ? 'line' : 'rect');
  if (geom === 'straightConnector1' || geom === 'bentConnector3' || geom === 'curvedConnector3') geom = 'line';
  if (!GEOMS.has(geom) && !kid(spPr, 'custGeom')) geom = 'rect';
  if (spPr && kid(spPr, 'custGeom')) geom = 'rect';
  const isTxBox = desc(kid(sp, 'nvSpPr'), 'cNvSpPr').some(c => attr(c, 'txBox') === '1');
  let fill = fillOf(spPr, ctx, ph || isTxBox ? null : styleEl);
  if (!fill && layoutPh) fill = fillOf(kid(layoutPh, 'spPr'), ctx, null);
  let fillImage = null;
  if (fill && fill.blip) { fillImage = await blipUrl(fill.blip, ctx, part); fill = null; }
  const line = lineOf(spPr, ctx, ph || isTxBox ? null : styleEl);
  const e = {
    type: 'shape', geom, x: x.x, y: x.y, w: x.w, h: x.h, rot: x.rot || 0, flipH: x.flipH, flipV: x.flipV,
    fill: fill && !fill.none && fill.color ? fill.color : null, fillAlpha: fill && fill.alpha != null && fill.alpha < 1 ? fill.alpha : undefined,
    fill2: fill && fill.color2 && fill.color2 !== fill.color ? fill.color2 : undefined, fillImage, line,
  };
  if (ph) e.ph = ph.type === 'ctrTitle' ? 'title' : ph.type;
  const txBody = kid(sp, 'txBody');
  if (txBody) {
    const text = readText(txBody, ctx, { ph, layoutPh, masterPh, styleEl, part });
    if (text.paras.some(p => p.runs.some(r => r.text && r.text.trim()))) e.text = text;
  }
  if (decorOnly && ph) return null;
  if (!e.text && !e.fill && !e.line && !e.fillImage) return null;
  return e;
}

// ---------------- text ----------------
function lvlPPr(lst, level) { return lst ? kid(lst, `lvl${level + 1}pPr`) : null; }
function readText(txBody, ctx, { ph, layoutPh, masterPh, styleEl }) {
  const bodyPr = kid(txBody, 'bodyPr');
  const lBody = layoutPh && desc(layoutPh, 'bodyPr')[0], mBody = masterPh && desc(masterPh, 'bodyPr')[0];
  const pick = (name, def) => { for (const b of [bodyPr, lBody, mBody]) if (b && attr(b, name) != null) return attr(b, name); return def; };
  const anchor = pick('anchor', ph && /title/i.test(ph.type) && ph.type !== 'ctrTitle' ? 'ctr' : ph && ph.type === 'ctrTitle' ? 'b' : 't');
  const ins = [+pick('lIns', 91440) / EMU, +pick('tIns', 45720) / EMU, +pick('rIns', 91440) / EMU, +pick('bIns', 45720) / EMU];
  const wrap = pick('wrap', 'square') !== 'none';
  const vert = pick('vert', 'horz');
  const af = bodyPr && kid(bodyPr, 'normAutofit');
  const scale = af && attr(af, 'fontScale') ? +attr(af, 'fontScale') / 100000 : 1;
  const master = ctx.master && ctx.master.doc;
  const tx = master && desc(master, 'txStyles')[0];
  const isTitle = ph && /title/i.test(ph.type);
  const isBody = ph && !isTitle && !['dt', 'ftr', 'sldNum', 'hdr'].includes(ph.type);
  const mStyle = tx ? kid(tx, isTitle ? 'titleStyle' : isBody ? 'bodyStyle' : 'otherStyle') : null;
  const lists = [kid(txBody, 'lstStyle'), layoutPh && desc(layoutPh, 'lstStyle')[0], masterPh && desc(masterPh, 'lstStyle')[0], ph ? mStyle : null, ctx.defaultTextStyle];
  const fontRefColor = styleEl && kid(styleEl, 'fontRef') ? colorIn(kid(styleEl, 'fontRef'), ctx) : null;
  const paras = [];
  const numCounters = [];
  for (const p of kids(txBody, 'p')) {
    const pPr = kid(p, 'pPr');
    const level = pPr && attr(pPr, 'lvl') ? +attr(pPr, 'lvl') : 0;
    const chain = [pPr, ...lists.map(l => lvlPPr(l, level))].filter(Boolean);
    const pget = name => { for (const c of chain) { const v = attr(c, name); if (v != null) return v; } return null; };
    const pchild = name => { for (const c of chain) { const v = kid(c, name); if (v) return v; } return null; };
    // bullet
    let bullet = null;
    for (const c of chain) {
      if (kid(c, 'buNone')) { bullet = null; break; }
      if (kid(c, 'buChar')) { bullet = { char: attr(kid(c, 'buChar'), 'char') || '•' }; break; }
      if (kid(c, 'buAutoNum')) { bullet = { num: true, fmt: attr(kid(c, 'buAutoNum'), 'type') || 'arabicPeriod' }; break; }
      if (kid(c, 'buBlip')) { bullet = { char: '•' }; break; }
    }
    if (bullet && bullet.num) { numCounters.length = level + 1; numCounters[level] = (numCounters[level] || 0) + 1; bullet.n = numCounters[level]; } else numCounters.length = level;
    const defs = chain.map(c => kid(c, 'defRPr')).filter(Boolean);
    const rget = (rPr, name) => { if (rPr && attr(rPr, name) != null) return attr(rPr, name); for (const d of defs) if (attr(d, name) != null) return attr(d, name); return null; };
    const rcolor = rPr => {
      const own = rPr && kid(rPr, 'solidFill');
      if (own) return colorIn(own, ctx);
      // own lstStyle first, then the shape's font colour, then inherited styles
      const ownDefs = [pPr, lvlPPr(lists[0], level)].filter(Boolean).map(c => kid(c, 'defRPr')).filter(Boolean);
      const ownList = ownDefs.find(d => kid(d, 'solidFill'));
      if (ownList) return colorIn(kid(ownList, 'solidFill'), ctx);
      if (fontRefColor) return fontRefColor;
      for (const d of defs) { const f = kid(d, 'solidFill'); if (f) return colorIn(f, ctx); }
      return '#' + (ctx.colors.scheme[ctx.colors.map.tx1] || '000000');
    };
    const rfont = rPr => {
      let f = rPr && kid(rPr, 'latin') ? attr(kid(rPr, 'latin'), 'typeface') : null;
      if (!f) for (const d of defs) { const l = kid(d, 'latin'); if (l) { f = attr(l, 'typeface'); break; } }
      if (!f || f === '+mn-lt') f = ctx.fonts.minor;
      if (f === '+mj-lt') f = ctx.fonts.major;
      return f;
    };
    const runs = [];
    for (const r of kids(p)) {
      if (r.localName === 'r' || r.localName === 'fld') {
        const rPr = kid(r, 'rPr');
        const t = kid(r, 't');
        const text = t ? t.textContent : '';
        const sz = rget(rPr, 'sz');
        const u = rget(rPr, 'u');
        const cap = rget(rPr, 'cap');
        runs.push({
          text: cap === 'all' ? text.toUpperCase() : text,
          size: (sz ? +sz / 100 : 18) * scale,
          b: rget(rPr, 'b') === '1' || rget(rPr, 'b') === 'true',
          i: rget(rPr, 'i') === '1' || rget(rPr, 'i') === 'true',
          u: !!u && u !== 'none',
          color: rcolor(rPr),
          font: rfont(rPr),
        });
      } else if (r.localName === 'br') {
        const last = runs[runs.length - 1];
        runs.push({ ...(last || { size: 18 * scale, color: '#000000' }), text: '\n' });
      }
    }
    const end = kid(p, 'endParaRPr');
    const endSz = end && attr(end, 'sz') ? +attr(end, 'sz') / 100 * scale : (runs[0] ? runs[0].size : (rget(null, 'sz') ? +rget(null, 'sz') / 100 * scale : 18 * scale));
    const algn = pget('algn') || 'l';
    const spcB = pchild('spcBef');
    const lnSpc = pchild('lnSpc');
    const spcPts = spcB && kid(spcB, 'spcPts') ? +attr(kid(spcB, 'spcPts'), 'val') / 100 : null;
    const lnPct = lnSpc && kid(lnSpc, 'spcPct') ? +attr(kid(lnSpc, 'spcPct'), 'val') / 100000 : null;
    const marL = pget('marL');
    const indent = pget('indent');
    paras.push({
      align: algn, level, bullet: runs.length && runs.some(r => r.text.trim()) ? bullet : null, runs, endSize: endSz,
      spcBef: spcPts, lnSpc: lnPct, marL: marL != null ? emu(marL) : null, indent: indent != null ? emu(indent) : null,
    });
  }
  return { paras, anchor, ins, wrap, vert: vert !== 'horz' ? vert : undefined };
}

function readTable(tbl, x, ctx) {
  const grid = desc(kid(tbl, 'tblGrid'), 'gridCol').map(g => emu(attr(g, 'w')));
  const rows = [];
  const rowH = [];
  for (const tr of kids(tbl, 'tr')) {
    rowH.push(emu(attr(tr, 'h')));
    const row = [];
    for (const tc of kids(tr, 'tc')) {
      if (attr(tc, 'hMerge') === '1' || attr(tc, 'vMerge') === '1') { row.push(null); continue; }
      const tcPr = kid(tc, 'tcPr');
      const sf = tcPr && kid(tcPr, 'solidFill');
      const txBody = kid(tc, 'txBody');
      const text = txBody ? readText(txBody, ctx, {}) : { paras: [] };
      row.push({ text, fill: sf ? colorIn(sf, ctx) : null, span: +(attr(tc, 'gridSpan') || 1), rowSpan: +(attr(tc, 'rowSpan') || 1) });
    }
    rows.push(row);
  }
  // first row / banding colours when the table uses a style without explicit fills
  const tblPr = kid(tbl, 'tblPr');
  const firstRow = tblPr && attr(tblPr, 'firstRow') === '1';
  rows.forEach((row, ri) => row.forEach(c => { if (c && !c.fill) c.fill = firstRow && ri === 0 ? '#' + ctx.colors.scheme.accent1 : (ri % 2 ? '#E9EBF5' : '#CFD5EA'); if (c && firstRow && ri === 0) c.text.paras.forEach(p => p.runs.forEach(r => { r.color = '#FFFFFF'; r.b = true; })); }));
  return { type: 'table', x: x.x, y: x.y, w: grid.reduce((a, b) => a + b, 0) || x.w, h: rowH.reduce((a, b) => a + b, 0) || x.h, cols: grid, rowH, rows };
}

/** Text of each slide (search index). */
export function presText(model) {
  return model.slides.map(s => s.els.filter(e => !e.locked).map(e => {
    if (e.text) return e.text.paras.map(p => p.runs.map(r => r.text).join('')).join('\n');
    if (e.type === 'table') return e.rows.map(r => r.filter(Boolean).map(c => c.text.paras.map(p => p.runs.map(x => x.text).join('')).join(' ')).join('\t')).join('\n');
    return '';
  }).filter(Boolean).join('\n'));
}
