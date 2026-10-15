// Slide rendering: DOM (editor, slideshow, thumbnails) and canvas (PDF export, library thumbnails).
import { esc } from '../ui.js';
import { loadImage } from './vendor.js';

export const PPI = 96; // design pixels per inch for DOM slides

export function fontStack(name) {
  const n = String(name || 'Arial');
  if (/times|georgia|garamond|cambria|serif|palatino|book/i.test(n) && !/sans/i.test(n)) return `"${n}", Georgia, "Times New Roman", serif`;
  if (/mono|courier|consolas/i.test(n)) return `"${n}", "Courier New", monospace`;
  return `"${n}", Arial, "Helvetica Neue", Helvetica, "Liberation Sans", sans-serif`;
}

const CLIP = {
  triangle: 'polygon(50% 0,100% 100%,0 100%)', rtTriangle: 'polygon(0 0,100% 100%,0 100%)', diamond: 'polygon(50% 0,100% 50%,50% 100%,0 50%)',
  parallelogram: 'polygon(25% 0,100% 0,75% 100%,0 100%)', trapezoid: 'polygon(25% 0,75% 0,100% 100%,0 100%)',
  pentagon: 'polygon(50% 0,100% 38%,82% 100%,18% 100%,0 38%)', hexagon: 'polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)',
  octagon: 'polygon(30% 0,70% 0,100% 30%,100% 70%,70% 100%,30% 100%,0 70%,0 30%)', chevron: 'polygon(0 0,75% 0,100% 50%,75% 100%,0 100%,25% 50%)',
  homePlate: 'polygon(0 0,80% 0,100% 50%,80% 100%,0 100%)', rightArrow: 'polygon(0 25%,65% 25%,65% 0,100% 50%,65% 100%,65% 75%,0 75%)',
  leftArrow: 'polygon(100% 25%,35% 25%,35% 0,0 50%,35% 100%,35% 75%,100% 75%)', upArrow: 'polygon(25% 100%,25% 35%,0 35%,50% 0,100% 35%,75% 35%,75% 100%)',
  downArrow: 'polygon(25% 0,75% 0,75% 65%,100% 65%,50% 100%,0 65%,25% 65%)', star5: 'polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)',
};

function bulletText(p) {
  if (!p.bullet) return '';
  if (p.bullet.num) {
    const n = p.bullet.n || 1;
    const f = p.bullet.fmt || 'arabicPeriod';
    if (/alphaLc/.test(f)) return String.fromCharCode(96 + ((n - 1) % 26) + 1) + (/Paren/.test(f) ? ')' : '.');
    if (/alphaUc/.test(f)) return String.fromCharCode(64 + ((n - 1) % 26) + 1) + (/Paren/.test(f) ? ')' : '.');
    if (/romanLc|romanUc/.test(f)) { const R = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x']; const r = R[n] || String(n); return (/Uc/.test(f) ? r.toUpperCase() : r) + '.'; }
    return n + (/Paren/.test(f) ? ')' : '.');
  }
  const ch = p.bullet.char || '•';
  // symbol-font bullets (Wingdings) map to a plain bullet
  return /[-]/.test(ch) || ch.length !== 1 || /[§Ø§ü]/.test(ch) ? '•' : ch;
}

function paraIndent(p) { return p.marL != null ? p.marL : (p.bullet ? 0.3 : 0) + (p.level || 0) * 0.45; }

// ---------------- DOM ----------------
export function textHtml(text, { scale = 1 } = {}) {
  const ptPx = PPI / 72 * scale;
  return text.paras.map(p => {
    const runs = p.runs.length ? p.runs.map(r => {
      const st = `font-size:${(r.size || 18) * ptPx}px;color:${r.color || '#000'};font-family:${esc(fontStack(r.font))};${r.b ? 'font-weight:700;' : ''}${r.i ? 'font-style:italic;' : ''}${r.u ? 'text-decoration:underline;' : ''}`;
      return `<span style="${st}">${esc(r.text).replace(/\n/g, '<br>')}</span>`;
    }).join('') : `<span style="font-size:${(p.endSize || 18) * ptPx}px"><br></span>`;
    const ind = paraIndent(p);
    const b = bulletText(p);
    const fs = (p.runs[0] ? p.runs[0].size : p.endSize || 18) * ptPx;
    const align = { ctr: 'center', r: 'right', just: 'justify' }[p.align] || 'left';
    const lh = p.lnSpc ? 1.18 * p.lnSpc : 1.18;
    return `<div class="sp" style="text-align:${align};padding-left:${ind * PPI}px;line-height:${lh};${p.spcBef ? `margin-top:${p.spcBef * ptPx}px;` : ''}"${b ? ` data-b="${esc(b)}"` : ''} data-level="${p.level || 0}"${p.bullet ? ` data-bullet="${p.bullet.num ? 'num' : 'dot'}"` : ''}>${b ? `<span class="bu" aria-hidden="true" style="font-size:${fs}px;color:${(p.runs[0] && p.runs[0].color) || '#000'};left:${Math.max(0, ind - 0.3) * PPI}px">${esc(b)}</span>` : ''}${runs}</div>`;
  }).join('');
}

export function elementDom(e, i) {
  const st = [`left:${e.x * PPI}px`, `top:${e.y * PPI}px`, `width:${Math.max(1, e.w * PPI)}px`, `height:${Math.max(1, e.h * PPI)}px`];
  if (e.rot) st.push(`transform:rotate(${e.rot}deg)${e.flipH ? ' scaleX(-1)' : ''}`);
  else if (e.flipH || e.flipV) st.push(`transform:${e.flipH ? 'scaleX(-1)' : ''}${e.flipV ? ' scaleY(-1)' : ''}`);
  let inner = '';
  let cls = `el el-${e.type}`;
  if (e.type === 'image') {
    if (!e.src) { cls += ' el-imgph'; inner = '<span class="imgph">Bild einfügen</span>'; }
    else if (e.crop) {
      const [l, t, r, b] = e.crop;
      inner = `<img alt="" src="${e.src}" style="position:absolute;left:${-l / (1 - l - r) * 100}%;top:${-t / (1 - t - b) * 100}%;width:${100 / (1 - l - r)}%;height:${100 / (1 - t - b)}%">`;
      st.push('overflow:hidden');
    } else inner = `<img alt="" src="${e.src}">`;
  } else if (e.type === 'table') {
    const total = e.cols.reduce((a, b) => a + b, 0) || 1;
    inner = '<table><colgroup>' + e.cols.map(c => `<col style="width:${c / total * 100}%">`).join('') + '</colgroup>' + e.rows.map((row, ri) => '<tr' + (e.rowH && e.rowH[ri] ? ` style="height:${e.rowH[ri] * PPI}px"` : '') + '>' + row.map(c => (c ? `<td${c.span > 1 ? ` colspan="${c.span}"` : ''}${c.rowSpan > 1 ? ` rowspan="${c.rowSpan}"` : ''} style="${c.fill ? `background:${c.fill}` : ''}">${textHtml(c.text)}</td>` : '')).join('') + '</tr>').join('') + '</table>';
  } else {
    if (e.geom === 'line') {
      const c = (e.line && e.line.color) || '#000';
      const w = Math.max(1, ((e.line && e.line.w) || 1) * PPI / 72);
      inner = `<svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100" style="overflow:visible"><line x1="0" y1="0" x2="100" y2="100" stroke="${c}" stroke-width="${w}" vector-effect="non-scaling-stroke"/></svg>`;
    } else {
      const shapeSt = [];
      if (e.fillImage) shapeSt.push(`background:url("${e.fillImage}") center/cover`);
      else if (e.fill) shapeSt.push(`background:${e.fill2 ? `linear-gradient(180deg, ${e.fill}, ${e.fill2})` : e.fill}`);
      if (e.fillAlpha != null) shapeSt.push(`opacity:${e.fillAlpha}`);
      if (e.line && e.line.color) shapeSt.push(`border:${Math.max(1, e.line.w * PPI / 72)}px solid ${e.line.color}`);
      if (e.geom === 'ellipse') shapeSt.push('border-radius:50%');
      else if (e.geom === 'roundRect' || e.geom === 'flowChartAlternateProcess' || e.geom === 'round2SameRect') shapeSt.push(`border-radius:${Math.min(e.w, e.h) * PPI * 0.16}px`);
      else if (CLIP[e.geom]) shapeSt.push(`clip-path:${CLIP[e.geom]}`);
      if (shapeSt.length) inner += `<div class="shape" style="${shapeSt.join(';')}"></div>`;
    }
    if (e.text) {
      const [l, t, r, b] = e.text.ins || [0.1, 0.05, 0.1, 0.05];
      const jc = { ctr: 'center', b: 'flex-end' }[e.text.anchor] || 'flex-start';
      inner += `<div class="tx" style="padding:${t * PPI}px ${r * PPI}px ${b * PPI}px ${l * PPI}px;justify-content:${jc};${e.text.wrap === false ? 'white-space:nowrap;' : ''}"${e.ph ? ` data-ph="${esc(e.ph)}"` : ''}>${textHtml(e.text)}</div>`;
    }
  }
  return `<div class="${cls}${e.locked ? ' locked' : ''}" data-i="${i}" style="${st.join(';')}">${inner}</div>`;
}

export function slideHtml(pres, slide) {
  const bg = slide.bg || { color: '#FFFFFF' };
  let bgCss = `background:${bg.color || '#FFFFFF'}`;
  if (bg.image) bgCss = `background:${bg.color || '#fff'} url("${bg.image}") center/cover no-repeat`;
  else if (bg.color2) bgCss = `background:linear-gradient(180deg, ${bg.color}, ${bg.color2})`;
  return `<div class="slide" style="width:${pres.w * PPI}px;height:${pres.h * PPI}px;${bgCss}">${slide.els.map((e, i) => elementDom(e, i)).join('')}</div>`;
}

/** Scaled, non-interactive slide preview element. */
export function slidePreview(pres, slide, widthPx) {
  const wrap = document.createElement('div');
  wrap.className = 'slide-prev';
  const s = widthPx / (pres.w * PPI);
  wrap.style.width = `${widthPx}px`;
  wrap.style.height = `${pres.h * PPI * s}px`;
  wrap.innerHTML = slideHtml(pres, slide);
  wrap.firstElementChild.style.transform = `scale(${s})`;
  return wrap;
}

// ---------------- canvas ----------------
const imgCache = new Map();
async function img(src) {
  if (!imgCache.has(src)) imgCache.set(src, loadImage(src).catch(() => null));
  if (imgCache.size > 200) { const k = imgCache.keys().next().value; imgCache.delete(k); }
  return imgCache.get(src);
}

function shapePath(ctx, geom, x, y, w, h) {
  ctx.beginPath();
  if (geom === 'ellipse') { ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2); return; }
  if (geom === 'roundRect' || geom === 'flowChartAlternateProcess' || geom === 'round2SameRect') {
    const r = Math.min(w, h) * 0.16;
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); return;
  }
  const poly = CLIP[geom];
  if (poly) {
    const pts = poly.slice(8, -1).split(',').map(p => p.trim().split(/\s+/).map(v => parseFloat(v) / 100));
    pts.forEach(([px, py], k) => (k ? ctx.lineTo(x + px * w, y + py * h) : ctx.moveTo(x + px * w, y + py * h)));
    ctx.closePath(); return;
  }
  ctx.rect(x, y, w, h);
}

function canvasFont(r, px) {
  return `${r.i ? 'italic ' : ''}${r.b ? 'bold ' : ''}${px}px ${fontStack(r.font)}`;
}

/** Lay out text paragraphs inside a box. Returns lines [{x, y(baseline), items:[{text, font, color, x, w, u}], size}] in px. */
function layoutText(ctx, text, x0, y0, w0, h0, s) {
  const [l, t, r, b] = (text.ins || [0.1, 0.05, 0.1, 0.05]).map(v => v * s);
  const maxW = Math.max(4, w0 - l - r);
  const ptPx = s / 72;
  const lines = [];
  let y = 0;
  for (const p of text.paras) {
    const ind = paraIndent(p) * s;
    const bul = bulletText(p);
    const firstSize = (p.runs[0] ? p.runs[0].size : p.endSize || 18) * ptPx;
    if (p.spcBef && lines.length) y += p.spcBef * ptPx;
    const lh = (p.lnSpc || 1) * 1.18;
    // tokens
    const toks = [];
    for (const run of p.runs) {
      const px = (run.size || 18) * ptPx;
      const font = canvasFont(run, px);
      for (const part of String(run.text).split(/(\n|\s+)/)) {
        if (!part) continue;
        if (part === '\n') { toks.push({ br: true }); continue; }
        ctx.font = font;
        toks.push({ text: part, font, px, color: run.color || '#000', u: run.u, w: ctx.measureText(part).width, space: /^\s+$/.test(part) });
      }
    }
    let line = { items: [], w: 0, size: firstSize };
    const avail = Math.max(4, maxW - ind);
    const push = () => {
      while (line.items.length && line.items[line.items.length - 1].space) line.w -= line.items.pop().w;
      lines.push({ ...line, ind, para: p, bul: lines.length && lines[lines.length - 1].para === p ? '' : bul, lh });
      line = { items: [], w: 0, size: firstSize };
    };
    for (const tk of toks) {
      if (tk.br) { push(); continue; }
      if (tk.space && !line.items.length) continue;
      if (text.wrap !== false && line.w + tk.w > avail && line.items.length && !tk.space) push();
      line.items.push(tk); line.w += tk.w; line.size = Math.max(line.size, tk.px);
    }
    push();
  }
  // vertical positions
  let total = 0;
  lines.forEach(ln => { ln.h = ln.size * ln.lh; total += ln.h; });
  let cy = y0 + t;
  const innerH = h0 - t - b;
  if (text.anchor === 'ctr') cy += (innerH - total) / 2;
  else if (text.anchor === 'b') cy += innerH - total;
  for (const ln of lines) {
    const align = ln.para.align;
    let lx = x0 + l + ln.ind;
    const free = maxW - ln.ind - ln.w;
    if (align === 'ctr') lx += free / 2;
    else if (align === 'r') lx += free;
    ln.x = lx;
    ln.y = cy + ln.size * 0.92 + (ln.h - ln.size * 1.18) / 2;
    ln.bx = x0 + l + Math.max(0, ln.ind - 0.3 * s);
    cy += ln.h;
  }
  return lines;
}

function drawLines(ctx, lines, out) {
  for (const ln of lines) {
    if (ln.bul && ln.items.length) {
      const first = ln.items[0];
      ctx.font = first.font; ctx.fillStyle = first.color;
      ctx.fillText(ln.bul, ln.bx, ln.y);
    }
    let x = ln.x;
    let text = '';
    for (const it of ln.items) {
      ctx.font = it.font; ctx.fillStyle = it.color;
      if (!it.space) ctx.fillText(it.text, x, ln.y);
      if (it.u) ctx.fillRect(x, ln.y + it.px * 0.12, it.w, Math.max(1, it.px / 16));
      x += it.w;
      text += it.text;
    }
    if (out && text.trim()) out.push({ x: ln.x, y: ln.y, size: ln.size, text: text.trim(), w: ln.w });
  }
}

/**
 * Render a slide to a canvas of the given width. Returns { canvas, texts } (texts in canvas px for PDF text layers).
 */
export async function slideCanvas(pres, slide, widthPx) {
  const s = widthPx / pres.w;
  const c = document.createElement('canvas');
  c.width = Math.round(widthPx);
  c.height = Math.round(pres.h * s);
  const ctx = c.getContext('2d');
  const texts = [];
  const bg = slide.bg || {};
  ctx.fillStyle = bg.color || '#FFFFFF';
  ctx.fillRect(0, 0, c.width, c.height);
  if (bg.color2) { const g = ctx.createLinearGradient(0, 0, 0, c.height); g.addColorStop(0, bg.color); g.addColorStop(1, bg.color2); ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height); }
  if (bg.image) {
    const im = await img(bg.image);
    if (im) { const r = Math.max(c.width / im.naturalWidth, c.height / im.naturalHeight); const w = im.naturalWidth * r, h = im.naturalHeight * r; ctx.drawImage(im, (c.width - w) / 2, (c.height - h) / 2, w, h); }
  }
  for (const e of slide.els) {
    const x = e.x * s, y = e.y * s, w = e.w * s, h = e.h * s;
    ctx.save();
    if (e.rot || e.flipH || e.flipV) {
      ctx.translate(x + w / 2, y + h / 2);
      if (e.rot) ctx.rotate(e.rot * Math.PI / 180);
      ctx.scale(e.flipH ? -1 : 1, e.flipV ? -1 : 1);
      ctx.translate(-(x + w / 2), -(y + h / 2));
    }
    if (e.type === 'image') {
      if (e.src) {
        const im = await img(e.src);
        if (im) {
          if (e.crop) {
            const [l, t, r, b] = e.crop;
            const iw = im.naturalWidth, ih = im.naturalHeight;
            ctx.drawImage(im, l * iw, t * ih, Math.max(1, iw * (1 - l - r)), Math.max(1, ih * (1 - t - b)), x, y, w, h);
          } else ctx.drawImage(im, x, y, w, h);
        }
      }
    } else if (e.type === 'table') {
      const total = e.cols.reduce((a, b) => a + b, 0) || 1;
      const rowsN = e.rows.length || 1;
      let cy = y;
      e.rows.forEach((row, ri) => {
        const rh = (e.rowH && e.rowH[ri] ? e.rowH[ri] * s : h / rowsN);
        let cx = x, ci = 0;
        for (const cell of row) {
          const span = cell ? cell.span || 1 : 1;
          const cw = e.cols.slice(ci, ci + span).reduce((a, b) => a + b, 0) / total * w;
          if (cell) {
            if (cell.fill) { ctx.fillStyle = cell.fill; ctx.fillRect(cx, cy, cw, rh); }
            ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = Math.max(1, s / 96); ctx.strokeRect(cx, cy, cw, rh);
            drawLines(ctx, layoutText(ctx, { ...cell.text, anchor: 't', ins: [0.08, 0.04, 0.08, 0.04] }, cx, cy, cw, rh, s), texts);
          }
          cx += cw; ci += span;
        }
        cy += rh;
      });
    } else {
      if (e.geom === 'line') {
        if (e.line && e.line.color) { ctx.strokeStyle = e.line.color; ctx.lineWidth = Math.max(1, e.line.w * s / 72); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); ctx.stroke(); }
      } else {
        if (e.fillAlpha != null) ctx.globalAlpha = e.fillAlpha;
        if (e.fillImage) {
          const im = await img(e.fillImage);
          if (im) { ctx.save(); shapePath(ctx, e.geom, x, y, w, h); ctx.clip(); const r = Math.max(w / im.naturalWidth, h / im.naturalHeight); ctx.drawImage(im, x + (w - im.naturalWidth * r) / 2, y + (h - im.naturalHeight * r) / 2, im.naturalWidth * r, im.naturalHeight * r); ctx.restore(); }
        } else if (e.fill) {
          shapePath(ctx, e.geom, x, y, w, h);
          if (e.fill2) { const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, e.fill); g.addColorStop(1, e.fill2); ctx.fillStyle = g; } else ctx.fillStyle = e.fill;
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        if (e.line && e.line.color) { shapePath(ctx, e.geom, x, y, w, h); ctx.strokeStyle = e.line.color; ctx.lineWidth = Math.max(1, e.line.w * s / 72); ctx.stroke(); }
      }
      if (e.text) drawLines(ctx, layoutText(ctx, e.text, x, y, w, h, s), texts);
    }
    ctx.restore();
  }
  return { canvas: c, texts, scale: s };
}

/** Presentation → PDF (one page per slide, image + invisible text layer for search/copy). */
export async function presToPdf(pres, { title = 'Präsentation', onProgress } = {}) {
  const { loadPdfLib } = await import('../pdflib.js');
  const { fontKit, safeText, needsUnicode } = await import('./pdftext.js');
  const PDFLib = await loadPdfLib();
  const pdf = await PDFLib.PDFDocument.create();
  pdf.setTitle(title); pdf.setProducer('FaLe PDF'); pdf.setCreator('FaLe PDF');
  const fk = await fontKit(pdf);
  let uniReady = false;
  const PW = pres.w * 72, PH = pres.h * 72;
  for (let i = 0; i < pres.slides.length; i++) {
    const { canvas, texts, scale } = await slideCanvas(pres, pres.slides[i], 1600);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
    const jpg = await pdf.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const page = pdf.addPage([PW, PH]);
    page.drawImage(jpg, { x: 0, y: 0, width: PW, height: PH });
    const k = 72 / scale;
    for (const t of texts) {
      // standard font, or the embedded Unicode subset for Polish, Greek, Cyrillic … text (./unifont.js)
      if (!uniReady && needsUnicode(t.text)) uniReady = await fk.ensureUnicode() || 'failed';
      const font = fk.pick(t.text);
      const str = safeText(t.text, font);
      if (!str.trim()) continue;
      const size = Math.max(2, t.size * k);
      const natural = font.widthOfTextAtSize(str, size);
      const fit = natural > 0 ? Math.min(1.6, (t.w * k) / natural) : 1;
      try { page.drawText(str, { x: t.x * k, y: PH - t.y * k, size: size * fit, font, opacity: 0 }); } catch {}
    }
    onProgress && onProgress((i + 1) / pres.slides.length);
    canvas.width = canvas.height = 0;
  }
  return pdf.save({ useObjectStreams: true });
}
