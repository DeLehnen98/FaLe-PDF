// Background description of library files: search text, thumbnail, page/sheet/slide count.
import { decodeText } from './vendor.js';

async function imageThumb(blob, width = 220) {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, width / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * s));
  c.height = Math.max(1, Math.round(bmp.height * s));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close && bmp.close();
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
}

function canvasBlob(c) { return new Promise(r => c.toBlob(r, 'image/jpeg', 0.82)); }

/** Mini page preview: first lines of text (headings bold). */
function textThumb(blocks) {
  const W = 220, H = 300, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  let y = 26;
  const x = 20, maxW = W - 40;
  for (const b of blocks) {
    if (y > H - 14) break;
    const size = b.h === 1 ? 15 : b.h === 2 ? 12 : b.h ? 10.5 : 8;
    ctx.font = `${b.h ? '700 ' : ''}${size}px Arial, sans-serif`;
    ctx.fillStyle = b.h ? '#1B1E33' : '#4B5068';
    const words = b.text.split(/\s+/);
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, x, y); y += size * 1.35; line = w; if (y > H - 14) break; }
      else line = t;
    }
    if (line && y <= H - 14) { ctx.fillText(line, x, y); y += size * 1.35; }
    y += b.h ? 4 : 3;
  }
  return canvasBlob(c);
}

/** Mini spreadsheet preview. */
function gridThumb(rows) {
  const W = 220, H = 300, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  const cw = 54, rh = 15;
  ctx.font = '8px Arial, sans-serif';
  for (let r = 0; r < 20 && r < rows.length + 3; r++) {
    for (let k = 0; k < 4; k++) {
      ctx.strokeStyle = '#DADDEA'; ctx.lineWidth = 1;
      ctx.strokeRect(2 + k * cw + 0.5, 2 + r * rh + 0.5, cw, rh);
      const v = rows[r] && rows[r][k] != null ? String(rows[r][k]) : '';
      if (!v) continue;
      ctx.fillStyle = r === 0 ? '#15895A' : '#3A3F58';
      ctx.font = `${r === 0 ? '700 ' : ''}8px Arial, sans-serif`;
      let t = v; while (t.length > 1 && ctx.measureText(t).width > cw - 5) t = t.slice(0, -1);
      ctx.fillText(t, 2 + k * cw + 3, 2 + r * rh + 10.5);
    }
  }
  return canvasBlob(c);
}

/** @returns {Promise<{pages: string[], thumb?: Blob, count?: number}|null>} */
export async function describeFile(kind, blob) {
  try {
    if (kind === 'image') return { pages: [], thumb: await imageThumb(blob) };
    if (kind === 'txt' || kind === 'md') {
      const text = (await decodeText(blob)).slice(0, 2_000_000);
      const blocks = text.split(/\n/).slice(0, 40).map(l => { const m = kind === 'md' && /^(#{1,3})\s+(.*)$/.exec(l); return m ? { h: m[1].length, text: m[2] } : { text: l || ' ' }; });
      return { pages: [text], thumb: await textThumb(blocks) };
    }
    if (kind === 'docx') {
      const { docxToHtml, htmlToText } = await import('./docx-read.js');
      const { html } = await docxToHtml(await blob.arrayBuffer());
      const d = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
      const blocks = Array.from(d.body.querySelectorAll('h1,h2,h3,p,li')).slice(0, 40).map(e => ({ h: /^H\d$/.test(e.tagName) ? +e.tagName[1] : 0, text: (e.tagName === 'LI' ? '• ' : '') + (e.textContent || ' ') }));
      return { pages: [htmlToText(html)], thumb: await textThumb(blocks) };
    }
    if (kind === 'xlsx' || kind === 'csv') {
      const { sheetToRows } = await import('./workbook.js');
      const wb = kind === 'csv' ? await (await import('./csv.js')).readCsv(blob) : await (await import('./xlsx-read.js')).readXlsx(await blob.arrayBuffer());
      const pages = wb.sheets.map(sh => sheetToRows(sh).slice(0, 20000).map(r => r.join('\t').replace(/\t+$/, '')).join('\n'));
      const first = wb.sheets[0];
      const rows = sheetToRows({ ...first, maxR: Math.min(first.maxR, 20), maxC: Math.min(first.maxC, 3) });
      return { pages, count: wb.sheets.length, thumb: await gridThumb(rows) };
    }
    if (kind === 'pptx') {
      const { readPptx, presText } = await import('./pptx-read.js');
      const pres = await readPptx(await blob.arrayBuffer());
      let thumb = null;
      try {
        const { slideCanvas } = await import('./slide-render.js');
        const { canvas } = await slideCanvas(pres, pres.slides[0], 260);
        thumb = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.82));
      } catch (e) { console.warn('thumb', e); }
      return { pages: presText(pres), thumb, count: pres.slides.length };
    }
  } catch (e) {
    console.warn('Index fehlgeschlagen', e);
    return { pages: [] };
  }
  return null;
}
