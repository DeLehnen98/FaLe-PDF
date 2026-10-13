// Presentation model → .pptx via PptxGenJS (loaded lazily).
import { loadPptxGen, loadJSZip } from './vendor.js';

const hex = c => (c ? String(c).replace('#', '').toUpperCase().slice(0, 6) : undefined);
const SHAPES = { rect: 'rect', roundRect: 'roundRect', ellipse: 'ellipse', triangle: 'triangle', rtTriangle: 'rtTriangle', diamond: 'diamond', parallelogram: 'parallelogram', trapezoid: 'trapezoid', pentagon: 'pentagon', hexagon: 'hexagon', octagon: 'octagon', chevron: 'chevron', homePlate: 'homePlate', rightArrow: 'rightArrow', leftArrow: 'leftArrow', upArrow: 'upArrow', downArrow: 'downArrow', star5: 'star5', line: 'line' };

function runsFor(text, base = {}) {
  const out = [];
  const paras = text.paras;
  paras.forEach((p, pi) => {
    const popts = {
      align: { ctr: 'center', r: 'right', just: 'justify' }[p.align] || 'left',
      indentLevel: p.level || 0,
      bullet: p.bullet ? (p.bullet.num ? { type: 'number' } : (p.bullet.char && p.bullet.char !== '•' ? { characterCode: p.bullet.char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0') } : true)) : false,
    };
    if (p.spcBef) popts.paraSpaceBefore = p.spcBef;
    const runs = p.runs.length ? p.runs : [{ text: '', size: p.endSize || 18 }];
    runs.forEach((r, ri) => {
      const parts = String(r.text).split('\n');
      parts.forEach((t, k) => {
        const o = { ...base, ...popts, fontSize: Math.max(1, Math.round((r.size || 18) * 2) / 2) };
        if (r.b) o.bold = true;
        if (r.i) o.italic = true;
        if (r.u) o.underline = { style: 'sng' };
        if (r.color) o.color = hex(r.color);
        if (r.font) o.fontFace = r.font;
        if (k > 0) o.softBreakBefore = true;
        if (ri === runs.length - 1 && k === parts.length - 1 && pi < paras.length - 1) o.breakLine = true;
        out.push({ text: t, options: o });
      });
    });
  });
  return out;
}

export async function presToPptx(pres, { title = 'Präsentation' } = {}) {
  const PptxGenJS = await loadPptxGen();
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'FALE', width: +pres.w.toFixed(3), height: +pres.h.toFixed(3) });
  pptx.layout = 'FALE';
  pptx.author = 'FaLe PDF';
  pptx.company = 'FaLe PDF';
  pptx.title = title;
  for (const sl of pres.slides) {
    const s = pptx.addSlide();
    const bg = sl.bg || {};
    if (bg.image) s.background = { data: bg.image.replace(/^data:/, '') };
    else s.background = { color: hex(bg.color) || 'FFFFFF' };
    for (const e of sl.els) {
      const pos = { x: +e.x.toFixed(3), y: +e.y.toFixed(3), w: +Math.max(0.01, e.w).toFixed(3), h: +Math.max(0.01, e.h).toFixed(3) };
      if (e.rot) pos.rotate = Math.round(e.rot);
      if (e.flipH) pos.flipH = true;
      if (e.flipV) pos.flipV = true;
      if (e.type === 'image') {
        if (!e.src) continue;
        const o = { ...pos, data: e.src.replace(/^data:/, '') };
        if (e.crop) {
          // PptxGenJS crops via sizing: approximate by keeping the visible box (the image is stored uncropped)
          o.sizing = { type: 'crop', w: pos.w, h: pos.h };
        }
        try { s.addImage(o); } catch (err) { console.warn('Bild übersprungen', err); }
        continue;
      }
      if (e.type === 'table') {
        const rows = e.rows.map(row => row.filter(Boolean).map(c => {
          const txt = c.text.paras.map(p => p.runs.map(r => r.text).join('')).join('\n');
          const r0 = (c.text.paras[0] && c.text.paras[0].runs[0]) || {};
          const o = { fontSize: r0.size || 12, color: hex(r0.color) || '000000', bold: !!r0.b };
          if (c.fill) o.fill = { color: hex(c.fill) };
          if (c.span > 1) o.colspan = c.span;
          if (c.rowSpan > 1) o.rowspan = c.rowSpan;
          return { text: txt, options: o };
        }));
        if (rows.length) s.addTable(rows, { x: pos.x, y: pos.y, w: pos.w, colW: e.cols.map(v => +v.toFixed(3)), border: { type: 'solid', pt: 1, color: 'FFFFFF' }, fontFace: 'Arial', margin: 0.05 });
        continue;
      }
      const shapeName = SHAPES[e.geom] || 'rect';
      const sh = {};
      if (e.fill) sh.fill = { color: hex(e.fill), ...(e.fillAlpha != null ? { transparency: Math.round((1 - e.fillAlpha) * 100) } : {}) };
      if (e.line && e.line.color) sh.line = { color: hex(e.line.color), width: e.line.w || 1 };
      if (e.geom === 'roundRect') sh.rectRadius = Math.min(e.w, e.h) * 0.16;
      if (e.text && e.text.paras.some(p => p.runs.some(r => r.text))) {
        const [l, t, r, b] = e.text.ins || [0.1, 0.05, 0.1, 0.05];
        s.addText(runsFor(e.text), {
          ...pos, ...sh, shape: pptx.ShapeType[shapeName] || pptx.ShapeType.rect,
          valign: { ctr: 'middle', b: 'bottom' }[e.text.anchor] || 'top',
          margin: [l * 72, r * 72, b * 72, t * 72].map(v => +v.toFixed(1)),
          wrap: e.text.wrap !== false,
          fit: 'none',
        });
      } else if (e.fill || e.line || e.fillImage) {
        if (e.fillImage) { try { s.addImage({ ...pos, data: e.fillImage.replace(/^data:/, ''), sizing: { type: 'cover', w: pos.w, h: pos.h } }); } catch {} continue; }
        if (shapeName === 'line') s.addShape(pptx.ShapeType.line, { ...pos, line: sh.line || { color: '000000', width: 1 } });
        else s.addShape(pptx.ShapeType[shapeName] || pptx.ShapeType.rect, { ...pos, ...sh });
      }
    }
    if (sl.notes) s.addNotes(sl.notes);
  }
  let out = await pptx.write({ outputType: 'blob', compression: true });
  // slide transitions (PptxGenJS has no API for them): add <p:transition> to the slide parts
  if (pres.slides.some(sl => sl.transition && sl.transition !== 'none')) {
    const JSZip = await loadJSZip();
    const zip = await JSZip.loadAsync(out);
    for (let i = 0; i < pres.slides.length; i++) {
      const t = pres.slides[i].transition;
      if (!t || t === 'none') continue;
      const f = zip.file(`ppt/slides/slide${i + 1}.xml`);
      if (!f) continue;
      let xml = await f.async('string');
      if (/<p:transition\b/.test(xml)) continue;
      const tag = `<p:transition spd="med">${t === 'push' ? '<p:push dir="l"/>' : '<p:fade/>'}</p:transition>`;
      xml = /<p:timing\b/.test(xml) ? xml.replace(/<p:timing\b/, tag + '<p:timing') : xml.replace(/<\/p:sld>\s*$/, tag + '</p:sld>');
      zip.file(`ppt/slides/slide${i + 1}.xml`, xml);
    }
    out = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  }
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}
