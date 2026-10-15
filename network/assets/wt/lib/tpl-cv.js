// CV (tabellarischer Lebenslauf) model and PDF renderer with three designs – classic (serif, one column),
// modern (accent sidebar with photo, skills as bars), compact (dense, headings in a left column) – plus the
// matching letterhead for the cover letter. Content flows over as many pages as needed (usually 1–2).
// Used by tools/cv-builder.js and tools/cover-letter.js.
import { createWriter, collectText, mm, hexColor, tint } from './tpl-pdf.js';

export const ACCENTS = ['#2b59c3', '#0f766e', '#7c3aed', '#b91c1c', '#c2410c', '#334155'];
export const SECTION_IDS = ['exp', 'edu', 'courses', 'skills', 'langs', 'hobbies'];
export const SECTION_TITLES = {
  exp: { de: 'Berufserfahrung', en: 'Work experience' }, edu: { de: 'Ausbildung', en: 'Education' }, courses: { de: 'Weiterbildung', en: 'Training & certificates' },
  skills: { de: 'Kenntnisse', en: 'Skills' }, langs: { de: 'Sprachen', en: 'Languages' }, hobbies: { de: 'Interessen', en: 'Interests' },
};
export const SKILL_LEVELS = {
  de: ['', 'Grundkenntnisse', 'Erweiterte Kenntnisse', 'Gute Kenntnisse', 'Sehr gute Kenntnisse', 'Expertenwissen'],
  en: ['', 'Basic', 'Intermediate', 'Good', 'Very good', 'Expert'],
};
export const LANG_LEVELS = {
  de: { native: 'Muttersprache', C2: 'C2 – nahezu muttersprachlich', C1: 'C1 – fließend', B2: 'B2 – sehr gut', B1: 'B1 – gut', A2: 'A2 – Grundkenntnisse', A1: 'A1 – Anfänger' },
  en: { native: 'Native', C2: 'C2 – proficient', C1: 'C1 – advanced', B2: 'B2 – upper intermediate', B1: 'B1 – intermediate', A2: 'A2 – elementary', A1: 'A1 – beginner' },
};
const LANG_SCORE = { native: 5, C2: 5, C1: 4, B2: 3.5, B1: 3, A2: 2, A1: 1 };

export function newCv(lang) {
  return {
    design: 'modern', accent: ACCENTS[0], photoShape: 'circle',
    name: '', title: '', street: '', city: '', phone: '', email: '', web: '', birth: '', nationality: '',
    exp: [{ from: '', to: '', role: '', org: '', place: '', desc: '' }], edu: [{ from: '', to: '', role: '', org: '', place: '', desc: '' }], courses: [],
    skills: [{ name: '', level: '3' }], langs: [{ name: lang === 'de' ? 'Deutsch' : 'English', level: 'native' }], hobbies: '',
    order: [...SECTION_IDS], hide: {}, signLine: lang === 'de', place: '', date: '',
  };
}

const t = v => String(v ?? '').trim();
const span = (e, lang) => {
  const a = t(e.from), b = t(e.to);
  if (!a && !b) return '';
  return a && b ? `${a} – ${b}` : a ? `${lang === 'de' ? 'seit' : 'since'} ${a}` : b;
};
const filled = e => t(e.role) || t(e.org) || t(e.desc);
export const visibleSections = (v) => (v.order || SECTION_IDS).filter(id => SECTION_IDS.includes(id) && !v.hide?.[id] && hasContent(v, id));
function hasContent(v, id) {
  if (id === 'hobbies') return !!t(v.hobbies);
  return (v[id] || []).some(e => (id === 'skills' || id === 'langs' ? t(e.name) : filled(e)));
}
export const contactLines = v => [t(v.street) && t(v.city) ? `${t(v.street)}, ${t(v.city)}` : t(v.street) || t(v.city), t(v.phone), t(v.email), t(v.web)].filter(Boolean);

/** CV → PDF. photo: {bytes, type: 'png'|'jpg', width, height} or null. → {bytes, missing, pages} */
export async function cvPdf(v, lang, photo = null) {
  const de = lang === 'de';
  const design = ['classic', 'modern', 'compact'].includes(v.design) ? v.design : 'modern';
  const text = collectText({ ...v, hide: null }).join('\n') + Object.values(SECTION_TITLES).map(x => x[lang]).join(' ');
  const sidebarW = mm(66);
  const w = await createWriter({ text, lang, family: design === 'classic' ? 'serif' : 'sans',
    margins: design === 'modern' ? { l: 66 + 10, r: 15, t: 18, b: 18 } : design === 'compact' ? { l: 16, r: 16, t: 14, b: 16 } : { l: 22, r: 20, t: 20, b: 20 } });
  const accent = hexColor(w.PDFLib, v.accent);
  const soft = tint(w.PDFLib, accent, 0.9);
  const img = photo ? await (photo.type === 'png' ? w.doc.embedPng(photo.bytes) : w.doc.embedJpg(photo.bytes)) : null;
  if (design === 'modern') w.onPage = ww => { ww.page.drawRectangle({ x: 0, y: 0, width: sidebarW, height: ww.H, color: soft }); };
  w.newPage();
  const L = w.L, R = w.R;
  const sizes = design === 'compact' ? { body: 9.2, small: 8.2, head: 10.5, name: 19 } : { body: 10, small: 8.8, head: 11.5, name: design === 'modern' ? 24 : 22 };
  const head = (title, x = L, width = R - L) => {
    w.ensure(sizes.head * 4);
    w.space(design === 'compact' ? 6 : 10);
    w.para(design === 'classic' ? title.toUpperCase() : title, { font: w.bold, size: sizes.head, color: design === 'classic' ? w.INK : accent, x, width, lead: 1.2, after: 2 });
    w.hr({ x1: x, x2: x + width, color: design === 'classic' ? w.INK : accent, thickness: design === 'classic' ? 0.7 : 1 });
    w.space(7);
  };
  // ------------------------------------------------ header
  const contact = contactLines(v);
  const personal = [t(v.birth) ? `${de ? 'Geboren' : 'Born'}: ${t(v.birth)}` : '', t(v.nationality) ? `${de ? 'Staatsangehörigkeit' : 'Nationality'}: ${t(v.nationality)}` : ''].filter(Boolean);
  const drawPhoto = (x, yTop, wd, ht) => { if (img) w.page.drawImage(img, { x, y: yTop - ht, width: wd, height: ht }); };
  if (design === 'classic') {
    const pw = mm(32), ph = img ? (v.photoShape === 'circle' ? pw : mm(42)) : 0;
    const textW = img ? R - L - pw - mm(6) : R - L;
    const top = w.y;
    w.para(t(v.name) || (de ? 'Dein Name' : 'Your name'), { font: w.bold, size: sizes.name, width: textW, lead: 1.15, after: 2, align: img ? 'left' : 'center' });
    if (t(v.title)) w.para(t(v.title), { size: 12, color: w.GREY, width: textW, after: 4, align: img ? 'left' : 'center' });
    w.para([...contact, ...personal].join('  ·  '), { size: sizes.small, color: w.GREY, width: textW, align: img ? 'left' : 'center', after: 2, lead: 1.5 });
    if (img) { drawPhoto(R - pw, top, pw, ph); w.y = Math.min(w.y, top - ph - 4); }
  } else if (design === 'compact') {
    const pw = img ? mm(24) : 0, ph = img ? (v.photoShape === 'circle' ? pw : mm(31)) : 0;
    const top = w.y;
    const cw = R - L - (img ? pw + mm(5) : 0);
    w.para(t(v.name) || (de ? 'Dein Name' : 'Your name'), { font: w.bold, size: sizes.name, width: cw * 0.55, lead: 1.1, after: 1 });
    if (t(v.title)) w.para(t(v.title), { size: 10.5, color: accent, width: cw * 0.55, after: 0 });
    const leftEnd = w.y;
    let cy = top - 2;
    for (const c of [...contact, ...personal]) { w.line(c, L + cw, cy - sizes.small, { size: sizes.small, color: w.GREY, align: 'right', maxWidth: cw * 0.44 }); cy -= sizes.small * 1.4; }
    if (img) drawPhoto(R - pw, top, pw, ph);
    w.y = Math.min(leftEnd, cy, img ? top - ph : Infinity) - 4;
    w.hr({ color: accent, thickness: 1.4 });
    w.space(4);
  } else {
    w.para(t(v.name) || (de ? 'Dein Name' : 'Your name'), { font: w.bold, size: sizes.name, color: accent, lead: 1.1, after: 2 });
    if (t(v.title)) w.para(t(v.title), { size: 13, color: w.GREY, after: 6 });
  }
  // ------------------------------------------------ section bodies
  const dateW = design === 'compact' ? mm(30) : mm(36);
  const entries = (list, x = L, width = R - L) => {
    for (const e of list.filter(filled)) {
      const d = span(e, lang);
      const cw = width - dateW;
      const lines = w.wrap(t(e.desc), w.font, sizes.small + 0.4, cw).length + 2;
      w.ensure(Math.min(lines, 8) * sizes.body * 1.35);
      const y0 = w.y;
      if (d) w.line(d, x, y0 - sizes.body, { size: sizes.small + 0.4, color: w.GREY, maxWidth: dateW - 6 });
      w.para(t(e.role) || t(e.org), { font: w.bold, size: sizes.body, x: x + dateW, width: cw, lead: 1.3 });
      const sub = [t(e.role) ? t(e.org) : '', t(e.place)].filter(Boolean).join(', ');
      if (sub) w.para(sub, { size: sizes.body - 0.5, x: x + dateW, width: cw, lead: 1.3, color: design === 'modern' ? accent : w.INK });
      if (t(e.desc)) w.para(t(e.desc).split('\n').map(l => l.replace(/^\s*[-•*]\s*/, '• ')).join('\n'), { size: sizes.small + 0.4, x: x + dateW, width: cw, lead: 1.35, color: w.rgb(0.25, 0.26, 0.3) });
      w.space(design === 'compact' ? 4 : 7);
    }
  };
  const dots = (x, y, score, max = 5, r = 2.2) => { for (let i = 0; i < max; i++) w.page.drawCircle({ x: x + i * (r * 2 + 2.2), y: y + r, size: r, color: i < score ? accent : tint(w.PDFLib, accent, 0.75) }); };
  const bar = (x, y, width, score) => { w.page.drawRectangle({ x, y, width, height: 3.2, color: tint(w.PDFLib, accent, 0.7) }); w.page.drawRectangle({ x, y, width: width * score / 5, height: 3.2, color: accent }); };
  const skillList = (x, width, style) => {
    const L5 = SKILL_LEVELS[lang];
    for (const sk of v.skills.filter(e => t(e.name))) {
      const lvl = Math.max(0, Math.min(5, +sk.level || 0));
      w.ensure(sizes.body * 2.6);
      if (style === 'bar') {
        w.para(t(sk.name), { size: sizes.body - 0.5, x, width, lead: 1.25 });
        if (lvl) { bar(x, w.y - 4.5, width, lvl); w.space(11); } // below the descenders of the name
      } else {
        const nameW = width - (lvl ? mm(52) : 0);
        const y0 = w.y;
        w.para(t(sk.name), { size: sizes.body, x, width: nameW, lead: 1.3 });
        if (lvl) { dots(x + nameW + 4, y0 - sizes.body, lvl); w.line(L5[lvl], x + nameW + 4 + 36, y0 - sizes.body, { size: sizes.small - 0.4, color: w.GREY, maxWidth: mm(52) - 42 }); }
        w.space(2);
      }
    }
  };
  const langList = (x, width, style) => {
    const LV = LANG_LEVELS[lang];
    for (const l of v.langs.filter(e => t(e.name))) {
      w.ensure(sizes.body * 2.6);
      if (style === 'bar') {
        w.para(t(l.name), { size: sizes.body - 0.5, x, width, lead: 1.25 });
        w.para(LV[l.level] || '', { size: sizes.small - 0.4, x, width, color: w.GREY, lead: 1.25 });
        bar(x, w.y - 4.5, width, LANG_SCORE[l.level] || 0); w.space(11);
      } else w.kv([[t(l.name), LV[l.level] || '']], { size: sizes.body, labelWidth: Math.min(mm(40), width * 0.4), x, width, after: 1 });
    }
  };
  const inline = (items) => items.join('  ·  ');
  const section = (id, x = L, width = R - L, style = 'dots') => {
    if (design === 'compact') {
      // heading in the left column, content to the right
      w.ensure(sizes.body * 4);
      w.space(5);
      const y0 = w.y;
      w.line(SECTION_TITLES[id][lang], x, y0 - sizes.head, { size: sizes.head - 1, font: w.bold, color: accent, maxWidth: mm(30) });
      const cx = x + mm(32), cwid = width - mm(32);
      if (id === 'exp' || id === 'edu' || id === 'courses') entries(v[id], cx, cwid);
      else if (id === 'skills') w.para(inline(v.skills.filter(e => t(e.name)).map(e => (+e.level ? `${t(e.name)} (${SKILL_LEVELS[lang][+e.level]})` : t(e.name)))), { size: sizes.body, x: cx, width: cwid, lead: 1.4, after: 3 });
      else if (id === 'langs') w.para(inline(v.langs.filter(e => t(e.name)).map(e => `${t(e.name)} (${LANG_LEVELS[lang][e.level] || ''})`)), { size: sizes.body, x: cx, width: cwid, lead: 1.4, after: 3 });
      else if (id === 'hobbies') w.para(t(v.hobbies), { size: sizes.body, x: cx, width: cwid, lead: 1.4, after: 3 });
      w.hr({ x1: x, x2: x + width, color: w.LINE, thickness: 0.4 });
      return;
    }
    head(SECTION_TITLES[id][lang], x, width);
    if (id === 'exp' || id === 'edu' || id === 'courses') entries(v[id], x, width);
    else if (id === 'skills') skillList(x, width, style);
    else if (id === 'langs') langList(x, width, style);
    else if (id === 'hobbies') w.para(t(v.hobbies), { size: sizes.body, x, width, lead: 1.4, after: 2 });
  };
  const secs = visibleSections(v);
  const side = design === 'modern' ? secs.filter(id => id === 'skills' || id === 'langs' || id === 'hobbies') : [];
  for (const id of secs.filter(id => !side.includes(id))) section(id);
  // closing line: place, date, signature line (common in German CVs)
  if (v.signLine && (t(v.place) || v.date)) {
    w.space(22); w.ensure(50);
    const dl = `${t(v.place)}${t(v.place) && v.date ? ', ' : ''}${v.date ? fmtD(v.date, lang) : ''}`;
    w.para(dl, { size: sizes.body, after: 22 });
    w.page.drawLine({ start: { x: L, y: w.y }, end: { x: L + mm(60), y: w.y }, thickness: 0.6, color: w.INK });
    w.space(4);
    w.para(t(v.name), { size: sizes.small, color: w.GREY });
  }
  // ------------------------------------------------ modern sidebar (page 1, continues on page 2 if needed)
  if (design === 'modern') {
    const sx = mm(9), swd = sidebarW - mm(18);
    const main = { page: w.page, y: w.y, L: w.L, R: w.R };
    let pi = 0;
    w.page = w.pages[0]; w.y = w.H - mm(16);
    w.L = sx; w.R = sx + swd;
    const sideOnPage = w.onPage;
    w.onPage = ww => { sideOnPage(ww); };
    const origNew = w.newPage.bind(w);
    w.newPage = function () { pi++; if (this.pages[pi]) { this.page = this.pages[pi]; this.y = this.top; return this.page; } return origNew(); };
    if (img) {
      const pw = swd, ph = v.photoShape === 'circle' ? pw : pw * 4 / 3;
      drawPhoto(sx, w.y, pw, ph); w.y -= ph + 10;
    }
    const sideHead = title => { w.ensure(30); w.space(8); w.para(title, { font: w.bold, size: 10.5, color: accent, after: 2 }); w.hr({ color: accent, thickness: 0.8 }); w.space(6); };
    sideHead(de ? 'Kontakt' : 'Contact');
    for (const c of [...contact, ...personal]) w.para(c, { size: sizes.small, lead: 1.35, after: 2 });
    for (const id of side) {
      sideHead(SECTION_TITLES[id][lang]);
      if (id === 'skills') skillList(sx, swd, 'bar');
      else if (id === 'langs') langList(sx, swd, 'bar');
      else w.para(t(v.hobbies), { size: sizes.small + 0.4, lead: 1.4 });
    }
    w.newPage = origNew; w.L = main.L; w.R = main.R; w.page = main.page; w.y = main.y;
  }
  w.numberPages({ y: mm(8) });
  return w.finish({ title: `${de ? 'Lebenslauf' : 'CV'} ${t(v.name)}`.trim() });
}
const fmtD = (iso, lang) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return !m ? iso : lang === 'de' ? `${m[3]}.${m[2]}.${m[1]}` : new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); };

/** Letterhead in the CV design for the cover letter (drawLetter head hook). */
export function cvHead(v) {
  return (w, m) => {
    const design = v.design || 'modern';
    const accent = hexColor(w.PDFLib, v.accent);
    const name = m.sender[0] || '';
    const rest = [...m.sender.slice(1), ...m.contact];
    if (design === 'classic') {
      w.line(name, w.W / 2, w.H - mm(20), { size: 18, font: w.bold, align: 'center', maxWidth: w.TW });
      w.line(rest.join('  ·  '), w.W / 2, w.H - mm(27), { size: 8.5, color: w.GREY, align: 'center', maxWidth: w.TW });
      w.page.drawLine({ start: { x: w.L, y: w.H - mm(31) }, end: { x: w.R, y: w.H - mm(31) }, thickness: 0.7, color: w.INK });
    } else if (design === 'compact') {
      w.line(name, w.L, w.H - mm(20), { size: 16, font: w.bold, maxWidth: w.TW * 0.5 });
      let y = w.H - mm(14);
      for (const r of rest) { w.line(r, w.R, y, { size: 8.5, color: w.GREY, align: 'right', maxWidth: w.TW * 0.48 }); y -= 11; }
      w.page.drawLine({ start: { x: w.L, y: w.H - mm(33) }, end: { x: w.R, y: w.H - mm(33) }, thickness: 1.4, color: accent });
    } else {
      w.page.drawRectangle({ x: 0, y: w.H - mm(8), width: w.W, height: mm(8), color: accent });
      w.line(name, w.L, w.H - mm(22), { size: 20, font: w.bold, color: accent, maxWidth: w.TW * 0.55 });
      let y = w.H - mm(16);
      for (const r of rest) { w.line(r, w.R, y, { size: 8.5, color: w.GREY, align: 'right', maxWidth: w.TW * 0.43 }); y -= 11; }
    }
  };
}

// ---------------------------------------------------------------- photo (browser)
/** Decode a photo (EXIF orientation applied by the browser) onto a canvas, longest side ≤ 1400 px. */
export async function loadPhotoSource(blob) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(bmp.width * k)); cv.height = Math.max(1, Math.round(bmp.height * k));
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close?.();
  return cv;
}
/** Source rectangle of a crop {zoom, cx, cy} for 'circle' (1:1) or 'rect' (3:4). */
export function cropBox(src, crop, shape) {
  const ar = shape === 'circle' ? 1 : 3 / 4;
  const sw = src.width, sh = src.height;
  const w = Math.min(sw, sh * ar) / (crop.zoom || 1), h = w / ar;
  return { w, h, x: Math.min(Math.max(0, crop.cx * sw - w / 2), sw - w), y: Math.min(Math.max(0, crop.cy * sh - h / 2), sh - h) };
}
/** Cropped photo for the PDF: circle → PNG with transparent corners, rectangle → JPEG. */
export async function cropPhoto(src, crop, shape) {
  const b = cropBox(src, crop, shape);
  const W = 600, H = shape === 'circle' ? 600 : 800;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (shape === 'circle') { g.beginPath(); g.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2); g.clip(); } else { g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); }
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, b.x, b.y, b.w, b.h, 0, 0, W, H);
  const type = shape === 'circle' ? 'png' : 'jpg';
  const blob = await new Promise(r => c.toBlob(r, type === 'png' ? 'image/png' : 'image/jpeg', 0.9));
  c.width = 0;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type, width: W, height: H };
}
