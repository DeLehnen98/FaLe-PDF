// GENERATED – synced copy of js/tools/pdfstruct.js by scripts/sync-webtools-vendor.mjs.
// Do not edit here: change the source in the app and run `node scripts/sync-webtools-vendor.mjs`.
// Layout analysis on pdf.js text content: items → lines → paragraphs with font size,
// bold/italic, alignment and heading levels. Used by "PDF zu Word" (and "PDF bearbeiten").

const isBoldName = n => /bold|black|heavy|semibold|demi|[-,]bd\b/i.test(n || '');
const isItalicName = n => /italic|oblique|[-,]it\b/i.test(n || '');

export function fontFamilyOf(name, fallbackFamily) {
  const n = String(name || '').replace(/^[A-Z]{6}\+/, '');
  if (/courier|mono|consol|menlo/i.test(n) || fallbackFamily === 'monospace') return 'Courier New';
  if (/times|serif|georgia|garamond|cambria|book|roman|minion|palatino/i.test(n) && !/sans/i.test(n)) return 'Times New Roman';
  if (fallbackFamily === 'serif' && !/sans|arial|helvet/i.test(n)) return 'Times New Roman';
  if (/calibri/i.test(n)) return 'Calibri';
  if (/verdana/i.test(n)) return 'Verdana';
  return 'Arial';
}

/**
 * Analyse one page.
 * @returns {Promise<{width:number, height:number, lines:Array, paragraphs:Array, chars:number}>}
 */
export async function analysePage(page) {
  const vp = page.getViewport({ scale: 1 });
  try { await page.getOperatorList(); } catch {}
  const tc = await page.getTextContent();
  const fontCache = new Map();
  const fontInfo = id => {
    if (fontCache.has(id)) return fontCache.get(id);
    let f = null;
    try { if (page.commonObjs.has(id)) f = page.commonObjs.get(id); } catch {}
    const st = (tc.styles || {})[id] || {};
    const name = f && f.name ? String(f.name) : '';
    const info = {
      name,
      bold: !!(f && (f.bold || f.black)) || isBoldName(name),
      italic: !!(f && f.italic) || isItalicName(name),
      family: fontFamilyOf(name, st.fontFamily),
    };
    fontCache.set(id, info);
    return info;
  };

  // 1) items in viewport coordinates (top-left origin, unrotated page)
  const items = [];
  for (const it of tc.items) {
    if (typeof it.str !== 'string' || !it.str.length) continue;
    const [a, b, c, d, e, f] = it.transform;
    if (Math.abs(b) > Math.abs(a) * 0.2) continue; // rotated/vertical text is skipped
    const size = Math.hypot(c, d) || it.height || 10;
    const [x, y] = vp.convertToViewportPoint(e, f); // baseline-left
    const fi = fontInfo(it.fontName);
    items.push({ str: it.str, x, y, w: it.width || size * it.str.length * 0.5, size, ...fi, eol: !!it.hasEOL });
  }
  // 2) lines: group by baseline
  items.sort((p, q) => (Math.abs(p.y - q.y) < Math.min(p.size, q.size) * 0.35 ? p.x - q.x : p.y - q.y));
  const lines = [];
  for (const it of items) {
    let line = lines.length ? lines[lines.length - 1] : null;
    if (!line || Math.abs(line.y - it.y) > Math.min(line.size, it.size) * 0.35) {
      line = { y: it.y, size: it.size, items: [], x0: it.x, x1: it.x + it.w };
      lines.push(line);
    }
    line.items.push(it);
    line.x0 = Math.min(line.x0, it.x);
    line.x1 = Math.max(line.x1, it.x + it.w);
    line.size = Math.max(line.size, it.size);
  }
  // runs per line (merged by style), with spaces for gaps
  let chars = 0;
  for (const line of lines) {
    line.items.sort((p, q) => p.x - q.x);
    const runs = [];
    let prev = null;
    for (const it of line.items) {
      let text = it.str;
      if (prev) {
        const gap = it.x - (prev.x + prev.w);
        const spaced = /\s$/.test(prev.str) || /^\s/.test(text);
        if (!spaced && gap > it.size * 0.15) text = (gap > it.size * 3 ? '    ' : ' ') + text;
      }
      const r = runs[runs.length - 1];
      if (r && r.bold === it.bold && r.italic === it.italic && Math.abs(r.size - it.size) < 0.6 && r.family === it.family) r.text += text;
      else runs.push({ text, bold: it.bold, italic: it.italic, size: it.size, family: it.family });
      prev = it;
    }
    runs.forEach(r => { r.text = r.text.replace(/\s+/g, m => (m.length >= 4 ? '\t' : ' ')); });
    if (runs.length) runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, '');
    if (runs.length) runs[0].text = runs[0].text.replace(/^\s+/, '');
    line.runs = runs.filter(r => r.text);
    line.text = line.runs.map(r => r.text).join('');
    line.bold = line.runs.length > 0 && line.runs.every(r => r.bold || !r.text.trim());
    chars += line.text.replace(/\s/g, '').length;
  }
  const textLines = lines.filter(l => l.text.trim());
  return { width: vp.width, height: vp.height, lines: textLines, chars };
}

/** Body font size = most common size weighted by characters. */
export function bodySize(pages) {
  const hist = new Map();
  for (const p of pages) for (const l of p.lines) for (const r of l.runs) {
    const k = Math.round(r.size * 2) / 2;
    hist.set(k, (hist.get(k) || 0) + r.text.length);
  }
  let best = 11, bc = -1;
  hist.forEach((c, k) => { if (c > bc) { bc = c; best = k; } });
  return best;
}

/** Lines → paragraphs with heading level and alignment. */
export function paragraphs(page, body) {
  const out = [];
  const L = page.lines;
  if (!L.length) return out;
  const left = Math.min(...L.map(l => l.x0));
  const right = Math.max(...L.map(l => l.x1));
  const textW = Math.max(1, right - left);
  let cur = null;
  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    const prev = L[i - 1];
    let brk = !cur;
    if (cur && prev) {
      const gap = l.y - prev.y;
      const lead = cur.lead || gap;
      const sizeChange = Math.abs(l.size - prev.size) > Math.max(prev.size, l.size) * 0.12;
      const boldChange = l.bold !== cur.bold;
      const bigGap = gap > Math.max(prev.size, l.size) * 1.75 || (cur.lines.length > 1 && gap > lead * 1.35);
      const prevShort = prev.x1 < left + textW * 0.72 && /[.!?:]["“”»)]?$/.test(prev.text);
      const indent = l.x0 > prev.x0 + l.size * 1.2 && cur.lines.length >= 1 && prevShort;
      const bullet = /^([•\-–▪◦*]|\d{1,3}[.)]|[a-z][.)])\s/.test(l.text);
      // large text (titles): new paragraph unless lines are set tightly
      const bigText = Math.max(l.size, prev.size) >= body * 1.2 && gap > Math.max(l.size, prev.size) * 1.35;
      // short lines that start at clearly different positions (e.g. centered title → left heading)
      const shift = Math.abs(l.x0 - prev.x0) > l.size * 2 && prev.x1 < left + textW * 0.8 && !/-$/.test(prev.text);
      brk = sizeChange || boldChange || bigGap || prevShort || indent || bullet || bigText || shift || gap < 0;
      if (!brk && cur.lines.length === 1) cur.lead = gap;
    }
    if (brk) {
      cur = { lines: [], size: l.size, bold: l.bold, lead: 0 };
      out.push(cur);
    }
    cur.lines.push(l);
  }
  for (const p of out) {
    const first = p.lines[0];
    const pl = Math.min(...p.lines.map(l => l.x0)), pr = Math.max(...p.lines.map(l => l.x1));
    const centered = Math.abs((pl + pr) / 2 - (left + right) / 2) < textW * 0.06 && pl > left + textW * 0.1 && p.lines.length <= 3;
    const rightAl = pr > right - textW * 0.03 && pl > left + textW * 0.45 && p.lines.length <= 2;
    p.align = centered ? 'center' : rightAl ? 'right' : 'left';
    const textLen = p.lines.reduce((s, l) => s + l.text.length, 0);
    const ratio = p.size / body;
    p.heading = 0;
    if (textLen < 160 && p.lines.length <= 3) {
      if (ratio >= 1.55) p.heading = 1;
      else if (ratio >= 1.25) p.heading = 2;
      else if (ratio >= 1.08 && p.bold) p.heading = 3;
    }
    // merge runs over lines (de-hyphenate)
    const runs = [];
    p.lines.forEach((l, k) => {
      l.runs.forEach((r, j) => {
        let text = r.text;
        if (k > 0 && j === 0) {
          const last = runs[runs.length - 1];
          if (last && /[a-zäöüß]-$/.test(last.text) && /^[a-zäöüß]/.test(text)) last.text = last.text.slice(0, -1);
          else if (last && !/\s$/.test(last.text)) text = ' ' + text;
        }
        const lr = runs[runs.length - 1];
        if (lr && lr.bold === r.bold && lr.italic === r.italic && Math.abs(lr.size - r.size) < 0.6 && lr.family === r.family) lr.text += text;
        else runs.push({ ...r, text });
      });
    });
    p.runs = runs;
    p.text = runs.map(r => r.text).join('');
    p.top = first.y - first.size;
    p.indent = Math.max(0, pl - left);
  }
  return out;
}
