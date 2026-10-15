// Seven more CV designs for lib/tpl-cv.js (Vorlagen-Archiv "Design-Galerie"): elegant (serif, centred), timeline
// (dates on a vertical line), minimal (monochrome, labels on the left), creative (solid accent sidebar), ATS-friendly
// (one column, no graphics, no photo, plain text), academic (serif, dates on the right, publications) and school
// leaver (education first, colour band). Same model as lib/tpl-cv.js (newCv), same writer (lib/tpl-pdf.js): text
// stays real, searchable text in any design, Unicode via lib/unifont.js, content flows over as many pages as needed.
// tpl-cv.js calls cvPdfMore()/cvHeadMore() for these ids and passes its helpers (no import cycle).
import { createWriter, collectText, mm, hexColor, tint } from './tpl-pdf.js';

export const MORE_DESIGNS = [
  { id: 'elegant', de: 'Elegant', en: 'Elegant', family: 'serif' },
  { id: 'timeline', de: 'Zeitstrahl', en: 'Timeline', family: 'sans' },
  { id: 'minimal', de: 'Minimal', en: 'Minimal', family: 'sans' },
  { id: 'creative', de: 'Kreativ', en: 'Creative', family: 'sans' },
  { id: 'ats', de: 'ATS-freundlich', en: 'ATS-friendly', family: 'sans' },
  { id: 'academic', de: 'Akademisch', en: 'Academic', family: 'serif' },
  { id: 'school', de: 'Schule & Ausbildung', en: 'School leaver', family: 'sans' },
];
export const isMoreDesign = id => MORE_DESIGNS.some(d => d.id === id);

// section titles that differ in a design
const TITLES = {
  school: { edu: { de: 'Schulbildung', en: 'Education' }, exp: { de: 'Praktika & Nebenjobs', en: 'Work experience & placements' } },
  academic: { courses: { de: 'Stipendien, Kurse & Zertifikate', en: 'Grants, courses & certificates' } },
};
const SCHOOL_ORDER = ['edu', 'exp', 'courses', 'skills', 'langs', 'hobbies', 'pubs'];
const MARGINS = {
  elegant: { l: 24, r: 24, t: 20, b: 20 }, timeline: { l: 18, r: 18, t: 16, b: 18 }, minimal: { l: 22, r: 22, t: 22, b: 20 },
  creative: { l: 68 + 10, r: 15, t: 18, b: 18 }, ats: { l: 20, r: 20, t: 18, b: 18 }, academic: { l: 24, r: 22, t: 22, b: 22 }, school: { l: 18, r: 18, t: 14, b: 18 },
};

/** CV → PDF in one of the MORE_DESIGNS. H: helpers of tpl-cv.js. → {bytes, missing, pages} */
export async function cvPdfMore(v, lang, photo, H) {
  const d = MORE_DESIGNS.find(x => x.id === v.design) || MORE_DESIGNS[0];
  const id = d.id, de = lang === 'de', t = H.t;
  const title = sid => ((TITLES[id] && TITLES[id][sid]) || H.SECTION_TITLES[sid])[lang];
  let order = H.normOrder(v);
  if (id === 'school' && order.join() === H.SECTION_IDS.join()) order = SCHOOL_ORDER.filter(x => order.includes(x));
  const secs = order.filter(sid => H.visibleSections(v).includes(sid));
  const text = collectText({ ...v, hide: null }).join('\n') + ' ' + H.SECTION_IDS.map(title).join(' ') + ' Curriculum Vitae Kontakt Contact';
  const w = await createWriter({ text, lang, family: d.family, margins: MARGINS[id] });
  const { rgb } = w;
  const WHITE = rgb(1, 1, 1);
  const mono = id === 'minimal' || id === 'ats';
  const acc = hexColor(w.PDFLib, v.accent);
  const accent = mono ? w.INK : acc;
  const soft = tint(w.PDFLib, acc, 0.88);
  const img = photo && id !== 'ats' ? await (photo.type === 'png' ? w.doc.embedPng(photo.bytes) : w.doc.embedJpg(photo.bytes)) : null;
  const sideW = mm(68);
  if (id === 'creative') w.onPage = ww => { ww.page.drawRectangle({ x: 0, y: 0, width: sideW, height: ww.H, color: acc }); };
  w.newPage();
  const L = w.L, R = w.R;
  const S = { body: 10, small: 8.8, head: id === 'academic' ? 11 : 11.5 };
  if (id === 'minimal') Object.assign(S, { body: 9.6, small: 8.5, head: 8.5 });
  const contact = H.contactLines(v);
  const personal = [t(v.birth) ? `${de ? 'Geboren' : 'Born'}: ${t(v.birth)}` : '', t(v.nationality) ? `${de ? 'Staatsangehörigkeit' : 'Nationality'}: ${t(v.nationality)}` : ''].filter(Boolean);
  const name = t(v.name) || (de ? 'Dein Name' : 'Your name');
  const drawPhoto = (x, yTop, wd, ht) => { if (img) w.page.drawImage(img, { x, y: yTop - ht, width: wd, height: ht }); };
  const photoH = wd => (v.photoShape === 'circle' ? wd : wd * 4 / 3);

  // ------------------------------------------------ header
  if (id === 'elegant') {
    if (img) { const pw = mm(28); drawPhoto((w.W - pw) / 2, w.y, pw, photoH(pw)); w.y -= photoH(pw) + 10; }
    w.para(name, { font: w.bold, size: 24, align: 'center', lead: 1.15, after: 2, color: accent });
    if (t(v.title)) w.para(t(v.title), { font: w.italic, size: 12, align: 'center', color: w.GREY, after: 5 });
    w.para([...contact, ...personal].join('  ·  '), { size: S.small, align: 'center', color: w.GREY, lead: 1.5, after: 6 });
    w.hr({ color: accent, thickness: 0.6 }); w.space(2); w.hr({ color: accent, thickness: 0.3 });
    w.space(6);
  } else if (id === 'timeline') {
    const pw = img ? mm(26) : 0, ph = img ? photoH(pw) : 0;
    const top = w.y, x = L + (img ? pw + mm(6) : 0), wd = R - x;
    drawPhoto(L, top, pw, ph);
    w.para(name, { font: w.bold, size: 23, x, width: wd, color: accent, lead: 1.1, after: 2 });
    if (t(v.title)) w.para(t(v.title), { size: 12, x, width: wd, color: w.GREY, after: 4 });
    w.para([...contact, ...personal].join('  ·  '), { size: S.small, x, width: wd, color: w.GREY, lead: 1.45, after: 2 });
    w.y = Math.min(w.y, top - ph) - 6;
    w.page.drawRectangle({ x: L, y: w.y - 2.2, width: R - L, height: 2.2, color: accent });
    w.space(8);
  } else if (id === 'minimal') {
    const pw = img ? mm(24) : 0, ph = img ? photoH(pw) : 0, top = w.y;
    drawPhoto(R - pw, top, pw, ph);
    const wd = R - L - (img ? pw + mm(6) : 0);
    w.para(name, { size: 26, width: wd, lead: 1.1, after: 3 });
    if (t(v.title)) w.para(t(v.title).toUpperCase(), { size: 9, width: wd, color: w.GREY, after: 8 });
    w.para([...contact, ...personal].join('   '), { size: S.small, width: wd, color: w.GREY, lead: 1.5 });
    w.y = Math.min(w.y, top - ph) - 14;
  } else if (id === 'creative') {
    w.para(name, { font: w.bold, size: 25, color: acc, lead: 1.1, after: 2 });
    if (t(v.title)) w.para(t(v.title), { size: 13, color: w.GREY, after: 6 });
    w.page.drawRectangle({ x: L, y: w.y - 3, width: mm(18), height: 3, color: acc });
    w.space(10);
  } else if (id === 'ats') {
    w.para(name, { font: w.bold, size: 18, lead: 1.15, after: 1 });
    if (t(v.title)) w.para(t(v.title), { size: 11.5, after: 3 });
    for (const c of [...contact, ...personal]) w.para(c, { size: S.body - 0.5, lead: 1.35 });
    w.space(4);
  } else if (id === 'academic') {
    const pw = img ? mm(24) : 0, ph = img ? photoH(pw) : 0, top = w.y;
    const wd = (R - L) * 0.55;
    w.para(name, { font: w.bold, size: 21, width: wd, lead: 1.15, after: 2 });
    w.para(t(v.title) || 'Curriculum Vitae', { font: w.italic, size: 11.5, width: wd, color: w.GREY, after: 2 });
    let cy = top - 2;
    const cx = R - (img ? pw + mm(5) : 0);
    for (const c of [...contact, ...personal]) { w.line(c, cx, cy - S.small, { size: S.small, color: w.GREY, align: 'right', maxWidth: (R - L) * 0.42 - (img ? pw : 0) }); cy -= S.small * 1.45; }
    drawPhoto(R - pw, top, pw, ph);
    w.y = Math.min(w.y, cy, top - ph) - 4;
    w.hr({ color: w.INK, thickness: 0.8 });
    w.space(4);
  } else if (id === 'school') {
    const bandH = mm(34), top = w.H;
    w.page.drawRectangle({ x: 0, y: top - bandH, width: w.W, height: bandH, color: acc });
    const pw = img ? mm(26) : 0;
    if (img) drawPhoto(R - pw, top - mm(4), pw, photoH(pw));
    const wd = R - L - (img ? pw + mm(6) : 0);
    w.y = top - mm(12);
    w.para(name, { font: w.bold, size: 22, width: wd, color: WHITE, lead: 1.1, after: 2 });
    if (t(v.title)) w.para(t(v.title), { size: 12, width: wd, color: WHITE, after: 0 });
    w.y = Math.min(top - bandH - mm(5), img ? top - mm(4) - photoH(pw) - mm(3) : Infinity);
    w.para([...contact, ...personal].join('  ·  '), { size: S.small, color: w.GREY, lead: 1.5, width: wd, after: 4 });
  }

  // ------------------------------------------------ section heading
  const labelW = mm(36);
  const head = (txt, x = L, width = R - L) => {
    w.ensure(S.head * 5);
    if (id === 'elegant') {
      w.space(12);
      const s = txt.toUpperCase(), tw = w.width(s, w.bold, S.head);
      const cy = w.y - S.head * 0.65;
      w.line(s, x + width / 2, w.y - S.head, { size: S.head, font: w.bold, color: accent, align: 'center' });
      const gap = 8, half = (width - tw) / 2 - gap;
      if (half > 10) { w.page.drawLine({ start: { x, y: cy + 3 }, end: { x: x + half, y: cy + 3 }, thickness: 0.4, color: accent }); w.page.drawLine({ start: { x: x + width - half, y: cy + 3 }, end: { x: x + width, y: cy + 3 }, thickness: 0.4, color: accent }); }
      w.y -= S.head * 1.25 + 9;
    } else if (id === 'timeline') {
      w.space(10);
      w.page.drawRectangle({ x, y: w.y - S.head + 1, width: 6, height: 6, color: accent });
      w.para(txt, { font: w.bold, size: S.head, x: x + 12, width: width - 12, color: accent, lead: 1.2, after: 3 });
      w.hr({ x1: x, x2: x + width, color: w.LINE, thickness: 0.5 }); w.space(8);
    } else if (id === 'creative') {
      w.space(11);
      w.para(txt, { font: w.bold, size: S.head + 0.5, x, width, color: acc, lead: 1.2, after: 3 });
      w.page.drawRectangle({ x, y: w.y - 1, width: mm(10), height: 2, color: acc }); w.space(9);
    } else if (id === 'ats') {
      w.space(10);
      w.para(txt.toUpperCase(), { font: w.bold, size: 11, x, width, lead: 1.2, after: 5 });
    } else if (id === 'academic') {
      w.space(12);
      w.para(txt.toUpperCase(), { font: w.bold, size: S.head, x, width, lead: 1.2, after: 2 });
      w.hr({ x1: x, x2: x + width, color: w.INK, thickness: 0.4 }); w.space(7);
    } else if (id === 'school') {
      w.space(10);
      w.page.drawRectangle({ x, y: w.y - S.head * 1.55, width, height: S.head * 1.55, color: soft });
      w.page.drawRectangle({ x, y: w.y - S.head * 1.55, width: 3, height: S.head * 1.55, color: acc });
      w.line(txt, x + 9, w.y - S.head * 1.12, { size: S.head, font: w.bold, color: acc, maxWidth: width - 12 });
      w.y -= S.head * 1.55 + 8;
    }
  };

  // ------------------------------------------------ entries (exp, edu, courses, pubs)
  const dateW = id === 'timeline' ? mm(30) : mm(36);
  const descText = e => t(e.desc).split('\n').map(l => l.replace(/^\s*[-•*]\s*/, id === 'ats' ? '- ' : '• ')).join('\n');
  const entries = (list, x = L, width = R - L) => {
    const items = (list || []).filter(H.filled);
    items.forEach((e, idx) => {
      const dt = H.span(e, lang);
      const sub = [t(e.role) ? t(e.org) : '', t(e.place)].filter(Boolean).join(', ');
      const lines = w.wrap(t(e.desc), w.font, S.small + 0.4, width - dateW).length + 2;
      w.ensure(Math.min(lines, 7) * S.body * 1.35);
      if (id === 'ats') {
        w.para(t(e.role) || t(e.org), { font: w.bold, size: S.body + 0.5, x, width, lead: 1.3 });
        const meta = [sub, dt].filter(Boolean).join(' | ');
        if (meta) w.para(meta, { size: S.body - 0.3, x, width, lead: 1.3 });
        if (t(e.desc)) w.para(descText(e), { size: S.body - 0.3, x, width, lead: 1.35 });
        w.space(7);
        return;
      }
      if (id === 'academic') {
        const y0 = w.y;
        const dw = dt ? w.width(dt, w.font, S.small + 0.4) + 10 : 0;
        if (dt) w.line(dt, x + width, y0 - S.body, { size: S.small + 0.4, color: w.GREY, align: 'right' });
        w.para(t(e.role) || t(e.org), { font: w.bold, size: S.body, x, width: width - dw, lead: 1.3 });
        if (sub) w.para(sub, { font: w.italic, size: S.body - 0.3, x, width: width - dw, lead: 1.3 });
        if (t(e.desc)) w.para(descText(e), { size: S.small + 0.4, x: x + 8, width: width - 8, lead: 1.35, color: rgb(0.22, 0.22, 0.26) });
        w.space(6);
        return;
      }
      const y0 = w.y;
      const cx = x + dateW + (id === 'timeline' ? 14 : 0), cw = width - (cx - x);
      if (dt) w.line(dt, x, y0 - S.body, { size: S.small + 0.2, color: w.GREY, maxWidth: dateW - 6, font: id === 'timeline' ? w.bold : w.font });
      w.para(t(e.role) || t(e.org), { font: w.bold, size: S.body, x: cx, width: cw, lead: 1.3 });
      if (sub) w.para(sub, { size: S.body - 0.5, x: cx, width: cw, lead: 1.3, color: id === 'minimal' ? w.GREY : id === 'elegant' ? accent : w.INK, font: id === 'elegant' ? w.italic : w.font });
      if (t(e.desc)) w.para(descText(e), { size: S.small + 0.4, x: cx, width: cw, lead: 1.35, color: rgb(0.25, 0.26, 0.3) });
      if (id === 'timeline' && w.page) {
        const lx = x + dateW + 4;
        const yEnd = idx < items.length - 1 ? w.y - 7 : w.y + 2;
        // the line only runs on the page where the entry started; a break simply starts a new segment
        if (yEnd < y0) w.page.drawLine({ start: { x: lx, y: Math.min(y0 - 2, w.top) }, end: { x: lx, y: yEnd }, thickness: 1, color: tint(w.PDFLib, acc, 0.55) });
        w.page.drawCircle({ x: lx, y: Math.min(y0, w.top) - S.body * 0.62, size: 3.2, color: acc, borderColor: WHITE, borderWidth: 1 });
      }
      w.space(id === 'minimal' ? 8 : 7);
    });
  };
  // ------------------------------------------------ skills / languages
  const dots = (x, y, score, color = accent, off = tint(w.PDFLib, acc, 0.75)) => { for (let i = 0; i < 5; i++) w.page.drawCircle({ x: x + i * 6.6, y: y + 2.2, size: 2.2, color: i < score ? color : mono ? rgb(0.82, 0.82, 0.85) : off }); };
  const bar = (x, y, width, score, fg, bg) => { w.page.drawRectangle({ x, y, width, height: 3.2, color: bg }); w.page.drawRectangle({ x, y, width: width * score / 5, height: 3.2, color: fg }); };
  const skillItems = () => (v.skills || []).filter(e => t(e.name));
  const langItems = () => (v.langs || []).filter(e => t(e.name));
  const inlineList = sid => (sid === 'skills'
    ? skillItems().map(e => (+e.level ? `${t(e.name)} (${H.SKILL_LEVELS[lang][+e.level]})` : t(e.name)))
    : langItems().map(e => `${t(e.name)} (${H.LANG_LEVELS[lang][e.level] || ''})`)).join(id === 'ats' ? ', ' : '  ·  ');
  const listBlock = (sid, x, width) => {
    if (id === 'ats' || id === 'minimal' || id === 'elegant') {
      w.para(inlineList(sid), { size: S.body, x, width, lead: 1.45, after: 2, align: id === 'elegant' ? 'center' : 'left' });
      return;
    }
    if (id === 'academic') {
      const rows = sid === 'skills' ? skillItems().map(e => [t(e.name), +e.level ? H.SKILL_LEVELS[lang][+e.level] : '']) : langItems().map(e => [t(e.name), H.LANG_LEVELS[lang][e.level] || '']);
      w.kv(rows, { size: S.body, labelWidth: Math.min(mm(55), width * 0.45), x, width, after: 1 });
      return;
    }
    // timeline, school: name + dots + level text
    const items = sid === 'skills' ? skillItems().map(e => [t(e.name), Math.max(0, Math.min(5, +e.level || 0)), +e.level ? H.SKILL_LEVELS[lang][+e.level] : ''])
      : langItems().map(e => [t(e.name), H.LANG_SCORE[e.level] || 0, H.LANG_LEVELS[lang][e.level] || '']);
    for (const [nm, score, lvl] of items) {
      w.ensure(S.body * 2.4);
      const nameW = width - mm(56), y0 = w.y;
      w.para(nm, { size: S.body, x, width: nameW, lead: 1.32 });
      if (score) dots(x + nameW + 4, y0 - S.body, Math.round(score));
      if (lvl) w.line(lvl, x + nameW + 40, y0 - S.body, { size: S.small - 0.4, color: w.GREY, maxWidth: mm(56) - 42 });
      w.space(2);
    }
  };
  const section = (sid, x = L, width = R - L) => {
    if (id === 'minimal') {
      w.ensure(S.body * 4);
      w.space(8);
      w.line(title(sid).toUpperCase(), x, w.y - S.body, { size: S.head, font: w.bold, color: w.GREY, maxWidth: labelW - 8 });
      const cx = x + labelW, cw = width - labelW;
      if (['exp', 'edu', 'courses', 'pubs'].includes(sid)) entries(v[sid], cx, cw);
      else if (sid === 'hobbies') w.para(t(v.hobbies), { size: S.body, x: cx, width: cw, lead: 1.45, after: 4 });
      else listBlock(sid, cx, cw);
      w.space(4);
      return;
    }
    head(title(sid), x, width);
    if (['exp', 'edu', 'courses', 'pubs'].includes(sid)) entries(v[sid], x, width);
    else if (sid === 'hobbies') w.para(t(v.hobbies), { size: S.body, x, width, lead: 1.42, after: 2, align: id === 'elegant' ? 'center' : 'left' });
    else listBlock(sid, x, width);
  };
  const side = id === 'creative' ? secs.filter(sid => sid === 'skills' || sid === 'langs' || sid === 'hobbies') : [];
  for (const sid of secs.filter(x => !side.includes(x))) section(sid);
  // closing line: place, date, signature line
  if (v.signLine && (t(v.place) || v.date)) {
    w.space(22); w.ensure(50);
    w.para(`${t(v.place)}${t(v.place) && v.date ? ', ' : ''}${v.date ? H.fmtD(v.date, lang) : ''}`, { size: S.body, after: 22 });
    w.page.drawLine({ start: { x: L, y: w.y }, end: { x: L + mm(60), y: w.y }, thickness: 0.6, color: w.INK });
    w.space(4);
    w.para(t(v.name), { size: S.small, color: w.GREY });
  }
  // ------------------------------------------------ creative: sidebar content (page 1, continues on page 2 if needed)
  if (id === 'creative') {
    const sx = mm(9), swd = sideW - mm(18);
    const main = { page: w.page, y: w.y, L: w.L, R: w.R };
    let pi = 0;
    w.page = w.pages[0]; w.y = w.H - mm(14); w.L = sx; w.R = sx + swd;
    const origNew = w.newPage.bind(w);
    w.newPage = function () { pi++; if (this.pages[pi]) { this.page = this.pages[pi]; this.y = this.top; return this.page; } return origNew(); };
    if (img) { const ph = photoH(swd); drawPhoto(sx, w.y, swd, ph); w.y -= ph + 12; }
    const lightBg = tint(w.PDFLib, acc, 0.6);
    const sideHead = s => { w.ensure(30); w.space(8); w.para(s.toUpperCase(), { font: w.bold, size: 9.5, color: WHITE, after: 2 }); w.hr({ color: WHITE, thickness: 0.6 }); w.space(6); };
    sideHead(de ? 'Kontakt' : 'Contact');
    for (const c of [...contact, ...personal]) w.para(c, { size: S.small, lead: 1.35, after: 2, color: WHITE });
    for (const sid of side) {
      sideHead(title(sid));
      if (sid === 'hobbies') { w.para(t(v.hobbies), { size: S.small + 0.4, lead: 1.4, color: WHITE }); continue; }
      const items = sid === 'skills' ? skillItems().map(e => [t(e.name), +e.level || 0, '']) : langItems().map(e => [t(e.name), H.LANG_SCORE[e.level] || 0, H.LANG_LEVELS[lang][e.level] || '']);
      for (const [nm, score, lvl] of items) {
        w.ensure(S.body * 2.6);
        w.para(nm, { size: S.body - 0.5, lead: 1.25, color: WHITE });
        if (lvl) w.para(lvl, { size: S.small - 0.4, lead: 1.25, color: WHITE });
        if (score) { bar(sx, w.y - 4.5, swd, Math.min(5, score), WHITE, lightBg); w.space(11); } else w.space(4);
      }
    }
    w.newPage = origNew; w.L = main.L; w.R = main.R; w.page = main.page; w.y = main.y;
  }
  w.numberPages({ y: mm(8) });
  return w.finish({ title: `${de ? 'Lebenslauf' : 'CV'} ${t(v.name)}`.trim() });
}

/** Letterhead of the cover letter in the matching design (drawLetter head hook). */
export function cvHeadMore(v) {
  return (w, m) => {
    const id = v.design;
    const acc = hexColor(w.PDFLib, v.accent);
    const name = m.sender[0] || '';
    const rest = [...m.sender.slice(1), ...m.contact];
    const white = w.rgb(1, 1, 1);
    if (id === 'elegant') {
      w.line(name, w.W / 2, w.H - mm(19), { size: 19, font: w.bold, align: 'center', color: acc, maxWidth: w.TW });
      w.line(rest.join('  ·  '), w.W / 2, w.H - mm(26), { size: 8.5, color: w.GREY, align: 'center', maxWidth: w.TW });
      w.page.drawLine({ start: { x: w.L, y: w.H - mm(30) }, end: { x: w.R, y: w.H - mm(30) }, thickness: 0.6, color: acc });
      w.page.drawLine({ start: { x: w.L, y: w.H - mm(30.8) }, end: { x: w.R, y: w.H - mm(30.8) }, thickness: 0.3, color: acc });
    } else if (id === 'timeline') {
      w.line(name, w.L, w.H - mm(20), { size: 19, font: w.bold, color: acc, maxWidth: w.TW * 0.55 });
      let y = w.H - mm(14);
      for (const r of rest) { w.line(r, w.R, y, { size: 8.5, color: w.GREY, align: 'right', maxWidth: w.TW * 0.43 }); y -= 11; }
      w.page.drawRectangle({ x: w.L, y: w.H - mm(33), width: w.TW, height: 2.2, color: acc });
    } else if (id === 'minimal' || id === 'ats') {
      w.line(name, w.L, w.H - mm(20), { size: id === 'ats' ? 16 : 20, font: id === 'ats' ? w.bold : w.font, maxWidth: w.TW * 0.55 });
      let y = w.H - mm(15);
      for (const r of rest) { w.line(r, w.R, y, { size: 8.5, color: id === 'ats' ? w.INK : w.GREY, align: 'right', maxWidth: w.TW * 0.43 }); y -= 11; }
    } else if (id === 'creative') {
      w.page.drawRectangle({ x: 0, y: w.H - mm(36), width: mm(8), height: mm(36), color: acc });
      w.line(name, w.L, w.H - mm(20), { size: 20, font: w.bold, color: acc, maxWidth: w.TW * 0.55 });
      w.page.drawRectangle({ x: w.L, y: w.H - mm(24), width: mm(18), height: 2.5, color: acc });
      let y = w.H - mm(15);
      for (const r of rest) { w.line(r, w.R, y, { size: 8.5, color: w.GREY, align: 'right', maxWidth: w.TW * 0.43 }); y -= 11; }
    } else if (id === 'academic') {
      w.line(name, w.L, w.H - mm(20), { size: 17, font: w.bold, maxWidth: w.TW * 0.55 });
      let y = w.H - mm(15);
      for (const r of rest) { w.line(r, w.R, y, { size: 8.5, color: w.GREY, align: 'right', maxWidth: w.TW * 0.43 }); y -= 11; }
      w.page.drawLine({ start: { x: w.L, y: w.H - mm(33) }, end: { x: w.R, y: w.H - mm(33) }, thickness: 0.8, color: w.INK });
    } else { // school
      w.page.drawRectangle({ x: 0, y: w.H - mm(26), width: w.W, height: mm(26), color: acc });
      w.line(name, w.L, w.H - mm(15), { size: 18, font: w.bold, color: white, maxWidth: w.TW });
      w.line(rest.join('  ·  '), w.L, w.H - mm(21.5), { size: 8.2, color: white, maxWidth: w.TW });
    }
  };
}
