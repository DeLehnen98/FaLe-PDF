// GENERATED – synced copy of js/tools/formfields.js by scripts/sync-webtools-vendor.mjs.
// Do not edit here: change the source in the app and run `node scripts/sync-webtools-vendor.mjs`.
// Fillable PDF form fields: automatic field detection on a page and writing AcroForm fields with pdf-lib.
// Import-free on purpose – used by the app tool "Formular erstellen" (js/tools/formcreate.js) and synced into the
// FaLe Werkzeuge (network/assets/wt/lib/shared/formfields.js) by scripts/sync-webtools-vendor.mjs.

export const DEFAULT_NAMES = { text: 'Textfeld', multiline: 'Textbereich', check: 'Kontrollkästchen', sign: 'Unterschrift' };

/** Replace characters a pdf-lib font cannot encode (typographic quotes → ASCII, others → "?"). */
export function makeSanitizer(font) {
  const ok = new Map();
  return text => {
    let out = '';
    for (const ch of String(text).normalize('NFC')) {
      if (ch === '\n') { out += ch; continue; }
      if (!ok.has(ch)) {
        try { font.encodeText(ch); font.widthOfTextAtSize(ch, 10); ok.set(ch, true); } catch { ok.set(ch, false); }
      }
      out += ok.get(ch) ? ch : (/[‘’]/.test(ch) ? "'" : /[“”„]/.test(ch) ? '"' : '?');
    }
    return out;
  };
}

export function overlap(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / Math.max(1, Math.min(a.w * a.h, b.w * b.h));
}

export const cleanLabel = s => String(s || '').replace(/[_.…:]+$/g, '').replace(/^[\s_]+|[\s_:]+$/g, '').trim();
export function typeFromLabel(label, fallback = 'text') {
  if (/unterschrift|signatur|signature|unterzeichn/i.test(label)) return 'sign';
  if (/datum|geburtstag|date\b|geb\.?\s*am/i.test(label)) return 'date';
  return fallback;
}

/**
 * Detect candidate form fields on a page (viewport@1 coordinates).
 *   shapes(page, base) → {rects, lines} (js/tools/pagegeom.js pageShapes) – optional; names: default field names.
 * @returns {Promise<Array<{type, x, y, w, h, name, auto: true}>>}
 */
export async function detectFields(page, base, { shapes: shapesFn = null, names = {} } = {}) {
  const N = { ...DEFAULT_NAMES, ...names };
  const out = [];
  const W = base.width, H = base.height;
  const tc = await page.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (typeof it.str !== 'string' || !it.str.trim()) continue;
    const [a, b, c, d, e, f] = it.transform;
    if (Math.abs(b) > Math.abs(a) * 0.2) continue;
    const size = Math.hypot(c, d) || it.height || 10;
    const [x, y] = base.convertToViewportPoint(e, f);
    const [x2] = base.convertToViewportPoint(e + (it.width || 0) * (a / (Math.hypot(a, b) || 1)), f);
    items.push({ str: it.str, x: Math.min(x, x2), x1: Math.max(x, x2), y, size, w: Math.abs(x2 - x) });
  }
  const textBoxes = items.map(i => ({ x: i.x, y: i.y - i.size * 0.8, w: i.x1 - i.x, h: i.size, str: i.str }));
  const sameLine = (i, j) => Math.abs(i.y - j.y) < Math.max(i.size, j.size) * 0.5;
  const labelLeftOf = (x, y, hgt) => {
    let best = null;
    for (const it of items) {
      if (Math.abs(it.y - (y + hgt * 0.75)) > Math.max(it.size, hgt) * 0.8 && Math.abs(it.y - y - hgt) > it.size * 0.6) continue;
      if (it.x1 > x + 2 || x - it.x1 > 160) continue;
      if (!best || it.x1 > best.x1) best = it;
    }
    return best ? cleanLabel(best.str.replace(/_{3,}.*/, '')) : '';
  };
  const add = f => {
    f.w = Math.max(10, Math.min(W - f.x - 2, f.w));
    if (f.w < 10 || f.h < 6) return;
    if (out.some(o => overlap(o, f) > 0.3)) return;
    out.push({ ...f, auto: true, required: false, def: f.type === 'check' ? false : '' });
  };

  // 1) underscore runs: "Name: ________"
  for (const it of items) {
    const re = /_{4,}/g;
    let m;
    while ((m = re.exec(it.str))) {
      const n = it.str.length || 1;
      const x0 = it.x + (m.index / n) * (it.x1 - it.x), x1 = it.x + ((m.index + m[0].length) / n) * (it.x1 - it.x);
      let label = cleanLabel(it.str.slice(0, m.index));
      if (!label) {
        const left = items.filter(o => o !== it && sameLine(o, it) && o.x1 <= x0 + 2).sort((p, q) => q.x1 - p.x1)[0];
        if (left) label = cleanLabel(left.str);
      }
      const hgt = Math.max(14, it.size * 1.5);
      const type = typeFromLabel(label);
      add({ type, x: x0, y: it.y - hgt + it.size * 0.25, w: x1 - x0, h: type === 'sign' ? Math.max(hgt, 34) : hgt, name: label || (type === 'sign' ? N.sign : N.text) });
    }
  }
  // 2) checkbox glyphs
  for (const it of items) {
    const idx = it.str.search(/[☐□❏▢◻]/);
    if (idx < 0) continue;
    const n = it.str.length || 1;
    const x0 = it.x + (idx / n) * (it.x1 - it.x);
    const s = it.size * 0.9;
    const rest = cleanLabel(it.str.slice(idx + 1)) || (items.find(o => o !== it && sameLine(o, it) && o.x >= x0) || {}).str || '';
    add({ type: 'check', x: x0, y: it.y - s * 0.95, w: s, h: s, name: cleanLabel(rest) || N.check });
  }
  // 3) shapes: small squares → checkbox, boxes → text, lines → field above
  let shapes = { rects: [], lines: [] };
  if (shapesFn) { try { shapes = await shapesFn(page, base); } catch {} }
  const coversText = r => textBoxes.some(t => overlap(t, r) > 0.5 && !/^_+$/.test(t.str.trim()));
  for (const r of shapes.rects) {
    const w = r.x1 - r.x0, hh = r.y1 - r.y0;
    if (w > W * 0.9 && hh > H * 0.5) continue; // page frames
    const rect = { x: r.x0, y: r.y0, w, h: hh };
    if (coversText(rect)) continue;
    if (w >= 6 && w <= 24 && Math.abs(w - hh) < 3) {
      const right = items.filter(o => Math.abs(o.y - (r.y1 - hh * 0.1)) < Math.max(o.size, hh) && o.x >= r.x1 - 1 && o.x - r.x1 < 40).sort((p, q) => p.x - q.x)[0];
      add({ type: 'check', x: r.x0 + 1, y: r.y0 + 1, w: w - 2, h: hh - 2, name: right ? cleanLabel(right.str) : N.check });
    } else if (w >= 40 && hh >= 10 && hh <= 200 && r.stroke) {
      const label = labelLeftOf(r.x0, r.y0, Math.min(hh, 20)) || (items.filter(o => o.y <= r.y0 + 2 && r.y0 - o.y < 20 && o.x >= r.x0 - 4 && o.x < r.x1).sort((p, q) => q.y - p.y)[0] || {}).str || '';
      const type = hh > 40 ? (typeFromLabel(label, 'multiline')) : typeFromLabel(label);
      add({ type, x: r.x0 + 1.5, y: r.y0 + 1.5, w: w - 3, h: hh - 3, name: cleanLabel(label) || (type === 'multiline' ? N.multiline : N.text) });
    }
  }
  for (const l of shapes.lines) {
    const w = l.x1 - l.x0;
    if (w < 50 || w > W * 0.92) continue;
    const label = labelLeftOf(l.x0, l.y0 - 16, 16);
    const type = typeFromLabel(label);
    const hgt = type === 'sign' ? 36 : 18;
    const rect = { x: l.x0, y: l.y0 - hgt, w, h: hgt };
    if (textBoxes.some(t => overlap(t, rect) > 0.35)) continue;
    add({ type, ...rect, name: label || (type === 'sign' ? N.sign : N.text) });
  }
  // 4) "Label:" followed by empty space on the same line
  for (const it of items) {
    const s = it.str.trim();
    if (!/[:]$/.test(s) || s.length > 40 || /_{3,}/.test(s)) continue;
    const label = cleanLabel(s);
    if (!label || /^\d/.test(label)) continue;
    const right = items.filter(o => o !== it && sameLine(o, it) && o.x > it.x1 - 1).sort((p, q) => p.x - q.x)[0];
    const x0 = it.x1 + 6;
    const x1 = right ? right.x - 8 : Math.min(W - 40, x0 + 260);
    if (x1 - x0 < 60) continue;
    const hgt = Math.max(14, it.size * 1.5);
    const type = typeFromLabel(label);
    const rect = { x: x0, y: it.y - hgt + it.size * 0.3, w: x1 - x0, h: type === 'sign' ? Math.max(hgt, 32) : hgt };
    if (type === 'sign') rect.y = it.y - rect.h + it.size * 0.3;
    if (out.some(o => overlap(o, rect) > 0.1)) continue;
    add({ type, ...rect, name: label });
  }
  return out;
}

/**
 * Write the fields as AcroForm fields with pdf-lib.
 *   fields: [{type, page (1-based), x, y, w, h (viewport@1 of that page), name, required, def, options, editable, maxLen, fontSize, tip}]
 *   pageInfos[i]: {page: pdf.js page (rotate), base: viewport at scale 1}
 *   opts.dateTip: tooltip of date fields; opts.dateFormat: AFDate format
 */
export async function writeFields(PDFLib, pdfDoc, fields, pageInfos, { dateTip = 'Datum (TT.MM.JJJJ)', dateFormat = 'dd.mm.yyyy' } = {}) {
  const { rgb, degrees, StandardFonts, PDFName, PDFHexString, PDFString, PDFNumber } = PDFLib;
  const form = pdfDoc.getForm();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const clean = makeSanitizer(font);
  const pages = pdfDoc.getPages();
  const ctx = pdfDoc.context;
  const border = rgb(0.45, 0.47, 0.62), bg = rgb(0.93, 0.95, 1);
  for (const f of fields) {
    const info = pageInfos[f.page - 1];
    const page = pages[f.page - 1];
    const rot = ((info.page.rotate || 0) % 360 + 360) % 360;
    const [ax, ay] = info.base.convertToPdfPoint(f.x, f.y);
    const [bx, by] = info.base.convertToPdfPoint(f.x + f.w, f.y + f.h);
    const rect = { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
    const name = clean(f.name).replace(/\./g, '_') || 'Feld';
    const common = { ...rect, borderColor: border, borderWidth: 0.8, backgroundColor: bg, rotate: degrees(rot), font };
    let field = null;
    if (f.type === 'text' || f.type === 'multiline' || f.type === 'date') {
      field = form.createTextField(name);
      if (f.type === 'multiline') field.enableMultiline();
      if (f.maxLen) field.setMaxLength(f.maxLen);
      if (f.type === 'date') field.setMaxLength(10);
      if (f.def) field.setText(clean(f.def));
      field.addToPage(page, common);
      if (f.fontSize) field.setFontSize(f.fontSize); else if (f.type !== 'multiline') field.setFontSize(Math.max(6, Math.min(12, rect.height * (rot % 180 ? rect.width / rect.height : 1) * 0.55)));
      if (f.type === 'date') {
        // date format/keystroke actions (Acrobat JavaScript), tooltip
        const fmt = dateFormat;
        const js = s => ctx.obj({ S: 'JavaScript', JS: PDFString.of(s) });
        field.acroField.dict.set(PDFName.of('AA'), ctx.obj({ K: js(`AFDate_KeystrokeEx("${fmt}");`), F: js(`AFDate_FormatEx("${fmt}");`) }));
      }
    } else if (f.type === 'check') {
      field = form.createCheckBox(name);
      field.addToPage(page, { ...common, backgroundColor: rgb(1, 1, 1) });
      if (f.def) field.check();
    } else if (f.type === 'radio') {
      field = form.createRadioGroup(name);
      const opts = (f.options || []).map(o => clean(o));
      const row = f.h / Math.max(1, opts.length);
      const s = Math.min(12, row * 0.72);
      opts.forEach((o, i) => {
        const top = f.y + row * i + (row - s) / 2;
        const [p1x, p1y] = info.base.convertToPdfPoint(f.x + 1, top), [p2x, p2y] = info.base.convertToPdfPoint(f.x + 1 + s, top + s);
        field.addOptionToPage(o, page, { x: Math.min(p1x, p2x), y: Math.min(p1y, p2y), width: s, height: s, borderColor: border, borderWidth: 0.8, backgroundColor: rgb(1, 1, 1), rotate: degrees(rot) });
        // option label as page text
        const [tx, ty] = info.base.convertToPdfPoint(f.x + s + 5, f.y + row * i + (row - s) / 2 + s * 0.85);
        page.drawText(o, { x: tx, y: ty, size: Math.min(10, s * 0.95), font, color: rgb(0.12, 0.13, 0.2), rotate: degrees(rot) });
      });
      if (f.def && opts.includes(clean(f.def))) field.select(clean(f.def));
    } else if (f.type === 'dropdown') {
      field = form.createDropdown(name);
      field.addOptions((f.options || []).map(o => clean(o)));
      if (f.editable) field.enableEditing();
      if (f.def) { try { field.select(clean(f.def), !!f.editable); } catch {} }
      field.addToPage(page, common);
      if (f.fontSize) field.setFontSize(f.fontSize);
    } else if (f.type === 'sign') {
      // pdf-lib cannot create signature fields: build the field/widget dictionary directly
      const x0 = rect.x, y0 = rect.y, x1 = rect.x + rect.width, y1 = rect.y + rect.height;
      const ap = ctx.register(ctx.flateStream(
        `0.97 0.97 1 rg 0 0 ${rect.width.toFixed(2)} ${rect.height.toFixed(2)} re f 0.45 0.47 0.62 RG 0.8 w [3 2] 0 d 0.4 0.4 ${(rect.width - 0.8).toFixed(2)} ${(rect.height - 0.8).toFixed(2)} re S`,
        { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, +rect.width.toFixed(2), +rect.height.toFixed(2)] },
      ));
      const dict = ctx.obj({
        Type: 'Annot', Subtype: 'Widget', FT: 'Sig', Rect: [x0, y0, x1, y1].map(v => +v.toFixed(2)), F: 4, P: page.ref,
        MK: { BC: [0.45, 0.47, 0.62], BG: [0.97, 0.97, 1], R: rot }, AP: { N: ap },
      });
      dict.set(PDFName.of('T'), PDFHexString.fromText(name));
      if (f.required) dict.set(PDFName.of('Ff'), PDFNumber.of(2));
      if (f.tip) dict.set(PDFName.of('TU'), PDFHexString.fromText(clean(f.tip)));
      const ref = ctx.register(dict);
      page.node.addAnnot(ref);
      form.acroForm.addField(ref);
      continue;
    }
    if (!field) continue;
    if (f.required) field.enableRequired();
    if (f.tip || f.type === 'date') field.acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(clean(f.tip || dateTip)));
  }
  try { form.updateFieldAppearances(font); } catch (e) { console.warn('appearances', e); }
}
