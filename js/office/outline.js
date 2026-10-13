// „Folien aus Gliederung“: Stichpunkte (oder .docx/.txt/.md) → fertige Präsentation mit Design,
// Titelfolie, Agenda, einer Folie pro Überschrift (lange Listen werden aufgeteilt) und Abschlussfolie.
import { $, $$, h, esc, toast, errorToast, pickFiles, debounce } from '../ui.js';
import { oicon } from './kinds.js';
import { SLIDE_THEMES } from './templates.js';
import { makeSlide, slideHandoff } from './slides.js';
import { slidePreview } from './slide-render.js';
import { decodeText } from './vendor.js';

const EXAMPLE = `# Unser Sommerfest 2026
Warum ein Sommerfest?
- Team zusammenbringen
- Danke sagen für ein starkes Jahr
- Neue Kolleginnen und Kollegen kennenlernen
Ablauf
- 15:00 Ankommen und Begrüßung
- 16:00 Spiele im Park
  - Boule-Turnier
  - Staffellauf
- 18:00 Grillen
- 20:00 Musik
> Hier an die Wetter-Alternative erinnern.
Budget
- Essen und Getränke: 1.200 €
- Musik: 400 €
- Deko: 150 €
Nächste Schritte
- Termin bestätigen
- Helferliste aufstellen
- Einladung verschicken`;

/** Parse an outline into { title, sections: [{ heading, bullets: [{ text, level }], notes }] }. */
export function parseOutline(text) {
  const out = { title: '', sections: [] };
  let cur = null;
  const ensure = () => { if (!cur) { cur = { heading: '', bullets: [], notes: [] }; out.sections.push(cur); } return cur; };
  for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) continue;
    const line = raw.replace(/\t/g, '    ');
    const ind = line.length - line.trimStart().length;
    const t = line.trim();
    let m;
    if ((m = /^#\s+(.+)$/.exec(t)) && !out.title && !out.sections.length) { out.title = m[1].trim(); continue; }
    if ((m = /^#{1,3}\s+(.+)$/.exec(t))) { cur = { heading: m[1].trim(), bullets: [], notes: [] }; out.sections.push(cur); continue; }
    if ((m = /^>\s?(.*)$/.exec(t))) { ensure().notes.push(m[1]); continue; }
    m = /^([-*•–]|\d+[.)])\s+(.+)$/.exec(t);
    if (m) { ensure().bullets.push({ text: m[2].trim(), level: Math.min(2, Math.floor(ind / 2)) }); continue; }
    if (ind >= 2) { ensure().bullets.push({ text: t, level: Math.min(2, Math.max(0, Math.floor(ind / 2) - 1)) }); continue; }
    cur = { heading: t.replace(/:$/, ''), bullets: [], notes: [] };
    out.sections.push(cur);
  }
  // normalise bullet levels so the first bullet of a slide is level 0
  out.sections.forEach(s => { const min = Math.min(...s.bullets.map(b => b.level), 0); s.bullets.forEach(b => { b.level = Math.max(0, b.level - min); }); });
  return out;
}

/** HTML (e.g. from a .docx) → outline text. */
export function htmlToOutline(html) {
  const d = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const lines = [];
  let firstH1 = true;
  const walk = (el, depth) => {
    for (const c of Array.from(el.children)) {
      const t = (c.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^H1$/.test(c.tagName)) { if (t) lines.push(`${firstH1 ? '#' : '##'} ${t}`); firstH1 = false; }
      else if (/^H[2]$/.test(c.tagName)) { if (t) lines.push(`## ${t}`); }
      else if (/^H[3-6]$/.test(c.tagName)) { if (t) lines.push(`- ${t}`); }
      else if (c.tagName === 'UL' || c.tagName === 'OL') {
        for (const li of Array.from(c.children)) {
          const own = Array.from(li.childNodes).filter(n => !(n.nodeType === 1 && /^(UL|OL)$/.test(n.tagName))).map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
          if (own) lines.push(`${'  '.repeat(depth)}- ${own}`);
          Array.from(li.children).filter(x => /^(UL|OL)$/.test(x.tagName)).forEach(x => walk({ children: [x] }, depth + 1));
        }
      } else if (c.tagName === 'P' || c.tagName === 'BLOCKQUOTE') { if (t) lines.push(`- ${t.length > 160 ? t.slice(0, 157) + '…' : t}`); }
      else if (c.tagName === 'TABLE') { /* skip tables */ }
      else walk(c, depth);
    }
  };
  walk(d.body, 0);
  return lines.join('\n');
}

const R = (text, size, color, font, b = false) => ({ text, size, color, font, b, i: false });

/** Build a presentation model from a parsed outline. */
export function buildDeck(outline, { themeId = 'indigo', title = '', subtitle = '', agenda = true, closing = 'Vielen Dank!', closingSub = 'Fragen?', maxBullets = 6 } = {}) {
  const theme = SLIDE_THEMES.find(t => t.id === themeId) || SLIDE_THEMES[0];
  const W = 13.333, H = 7.5;
  const slides = [];
  const deckTitle = title || outline.title || (outline.sections[0] && outline.sections[0].heading) || 'Präsentation';
  const setText = (el, text, size, bold) => { el.text.paras = [{ align: 'l', level: 0, runs: [R(text, size, el.role === 'title' ? theme.title : theme.text, theme.font, bold)] }]; };
  // title slide
  const ts = makeSlide('title', theme, W, H);
  const tEls = ts.els.filter(e => e.text);
  setText(tEls.find(e => e.role === 'title'), deckTitle, deckTitle.length > 40 ? 36 : 44, true);
  const sub = tEls.find(e => e.role === 'sub');
  if (subtitle) setText(sub, subtitle, 22, false); else ts.els = ts.els.filter(e => e !== sub);
  slides.push(ts);
  const sections = outline.sections.filter(s => s.heading || s.bullets.length);
  // agenda
  const heads = sections.map(s => s.heading).filter(Boolean);
  if (agenda && heads.length >= 2) {
    for (let k = 0; k < heads.length; k += 8) {
      const part = heads.slice(k, k + 8);
      slides.push(contentSlide(heads.length > 8 ? `Agenda (${k / 8 + 1}/${Math.ceil(heads.length / 8)})` : 'Agenda', part.map(t => ({ text: t, level: 0 })), [], { numbered: true }));
    }
  }
  for (const s of sections) {
    const chunks = [];
    for (let k = 0; k < s.bullets.length; k += maxBullets) chunks.push(s.bullets.slice(k, k + maxBullets));
    if (!chunks.length) {
      // section divider
      const d = makeSlide('title', theme, W, H);
      setText(d.els.find(e => e.role === 'title'), s.heading || 'Abschnitt', 40, true);
      d.els = d.els.filter(e => e.role !== 'sub');
      if (s.notes.length) d.notes = s.notes.join('\n');
      slides.push(d);
      continue;
    }
    chunks.forEach((ch, i) => slides.push(contentSlide(chunks.length > 1 ? `${s.heading || deckTitle} (${i + 1}/${chunks.length})` : (s.heading || deckTitle), ch, i === 0 ? s.notes : [])));
  }
  if (closing) {
    const c = makeSlide('title', theme, W, H);
    setText(c.els.find(e => e.role === 'title'), closing, 44, true);
    const cs = c.els.find(e => e.role === 'sub');
    if (closingSub) setText(cs, closingSub, 24, false); else c.els = c.els.filter(e => e !== cs);
    slides.push(c);
  }
  return { w: W, h: H, theme: theme.id, slides };

  function contentSlide(heading, bullets, notes, { numbered = false } = {}) {
    const sl = makeSlide('title-text', theme, W, H);
    const tEl = sl.els.find(e => e.role === 'title');
    setText(tEl, heading, heading.length > 48 ? 28 : 34, true);
    const body = sl.els.find(e => e.role === 'body');
    const longest = Math.max(...bullets.map(b => b.text.length));
    const base = bullets.length <= 3 && longest < 70 ? 24 : bullets.length <= 5 && longest < 90 ? 22 : 20;
    let n = 0;
    body.text.paras = bullets.map(b => ({
      align: 'l', level: b.level, bullet: numbered ? { num: true, n: ++n } : { char: b.level ? '–' : '•' }, spcBef: 6,
      runs: [R(b.text, Math.max(14, base - b.level * 2), theme.text, theme.font)], endSize: base,
    }));
    if (notes && notes.length) sl.notes = notes.join('\n');
    return sl;
  }
}

// ---------------- screen ----------------
export async function mount(screen) {
  const wrap = h(`<div class="ol-app">
    <div class="ol-form">
      <div class="card intro"><span class="tile-ic">${oicon('kslides')}</span><div><strong>So geht’s</strong>
        <p>Eine Zeile ohne Zeichen davor wird zur Folie, Zeilen mit „-“ werden Stichpunkte (eingerückt = Unterpunkt). „#“ am Anfang setzt den Titel, „&gt;“ wird zur Sprechernotiz. Oder lade ein Word-Dokument, eine Text- oder Markdown-Datei.</p></div></div>
      <div class="ol-actions"><button class="btn btn-soft btn-sm" type="button" data-example>${oicon('sparkle')} Beispiel einfügen</button><button class="btn btn-ghost btn-sm" type="button" data-load>${oicon('upload')} Datei laden</button></div>
      <label class="field"><span class="field-label">Gliederung</span><textarea class="input ol-text" spellcheck="true" lang="de-DE" placeholder="# Titel der Präsentation&#10;Erste Folie&#10;- Punkt eins&#10;- Punkt zwei&#10;Zweite Folie&#10;- …"></textarea></label>
      <div class="field-row"><label class="field"><span class="field-label">Titel (optional)</span><input class="input" name="title" placeholder="aus der Gliederung"></label>
        <label class="field"><span class="field-label">Untertitel (optional)</span><input class="input" name="sub" placeholder="z. B. Name · Datum"></label></div>
      <div class="field"><span class="field-label">Design</span><div class="ol-themes" role="radiogroup" aria-label="Design">${SLIDE_THEMES.map((t, i) => `<button type="button" class="theme-card ol-theme${i === 0 ? ' on' : ''}" role="radio" aria-checked="${i === 0}" data-theme="${t.id}" style="background:${t.bg};color:${t.title}"><span class="tc-bar" style="background:${t.accent}"></span><strong style="font-family:${t.font}">${t.name}</strong></button>`).join('')}</div></div>
      <div class="field-row"><label class="check"><input type="checkbox" name="agenda" checked> Agenda-Folie</label>
        <label class="field"><span class="field-label">Max. Punkte je Folie</span><select class="select" name="max">${[4, 5, 6, 7, 8].map(n => `<option ${n === 6 ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
      <div class="field-row"><label class="field"><span class="field-label">Abschlussfolie</span><input class="input" name="closing" value="Vielen Dank!"></label>
        <label class="field"><span class="field-label">Untertitel Abschluss</span><input class="input" name="closingSub" value="Fragen?"></label></div>
    </div>
    <aside class="ol-side" aria-label="Vorschau"><div class="ol-side-head"><strong data-count>Vorschau</strong></div><div class="ol-prev"></div></aside>
  </div>`);
  screen.body.classList.add('ol-body');
  screen.body.appendChild(wrap);
  const ta = $('.ol-text', wrap), prev = $('.ol-prev', wrap);
  let themeId = SLIDE_THEMES[0].id;
  const go = h(`<button class="btn btn-primary" type="button" data-ol-create>${oicon('kslides')} Präsentation erstellen</button>`);
  screen.setFoot([go]);
  const opts = () => ({ themeId, title: $('[name=title]', wrap).value.trim(), subtitle: $('[name=sub]', wrap).value.trim(), agenda: $('[name=agenda]', wrap).checked, maxBullets: +$('[name=max]', wrap).value, closing: $('[name=closing]', wrap).value.trim(), closingSub: $('[name=closingSub]', wrap).value.trim() });
  const render = () => {
    const ol = parseOutline(ta.value);
    prev.innerHTML = '';
    if (!ol.sections.length && !ol.title) { prev.innerHTML = '<p class="panel-empty">Die Vorschau erscheint, sobald du etwas eingibst.</p>'; $('[data-count]', wrap).textContent = 'Vorschau'; go.disabled = true; return; }
    go.disabled = false;
    const pres = buildDeck(ol, opts());
    $('[data-count]', wrap).textContent = `Vorschau · ${pres.slides.length} Folien`;
    const phone = matchMedia('(max-width: 720px)').matches;
    const w = Math.floor(phone ? Math.max(120, (prev.clientWidth - 30 - 12) / 2) : 220);
    prev.style.setProperty('--olw', `${w}px`);
    pres.slides.forEach((sl, i) => {
      const it = h(`<div class="ol-slide"><span class="ol-num">${i + 1}</span></div>`);
      it.appendChild(slidePreview(pres, sl, w));
      if (sl.notes) it.appendChild(h(`<span class="ol-note" title="${esc(sl.notes)}">${oicon('notes')}</span>`));
      prev.appendChild(it);
    });
  };
  const later = debounce(render, 250);
  wrap.addEventListener('input', later);
  wrap.addEventListener('change', later);
  $$('.ol-theme', wrap).forEach(b => b.addEventListener('click', () => { themeId = b.dataset.theme; $$('.ol-theme', wrap).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); }); render(); }));
  $('[data-example]', wrap).addEventListener('click', () => { ta.value = EXAMPLE; render(); });
  $('[data-load]', wrap).addEventListener('click', async () => {
    const files = await pickFiles({ accept: '.docx,.txt,.md,.markdown,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document', multiple: false });
    if (!files.length) return;
    try {
      const f = files[0];
      if (/\.docx$/i.test(f.name)) { const { docxToHtml } = await import('./docx-read.js'); ta.value = htmlToOutline((await docxToHtml(await f.arrayBuffer(), f.name)).html); }
      else ta.value = await decodeText(f);
      if (!$('[name=title]', wrap).value && !/^#\s/.test(ta.value)) $('[name=title]', wrap).value = f.name.replace(/\.[^.]+$/, '');
      render();
      toast(`„${f.name}“ übernommen – du kannst die Gliederung noch anpassen.`, 'success');
    } catch (e) { errorToast(e, 'Die Datei konnte nicht gelesen werden.'); }
  });
  go.addEventListener('click', () => {
    const ol = parseOutline(ta.value);
    if (!ol.sections.length && !ol.title) { toast('Bitte gib zuerst eine Gliederung ein.', 'error'); return; }
    const pres = buildDeck(ol, opts());
    slideHandoff.pres = pres;
    slideHandoff.name = (opts().title || ol.title || 'Präsentation').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80);
    location.hash = '#/neu/praesentation?gliederung=1';
  });
  const ro = new ResizeObserver(debounce(render, 150));
  ro.observe(prev);
  render();
  setTimeout(() => ta.focus(), 60);
  wrap._outlineApi = { setText: t => { ta.value = t; render(); }, build: () => buildDeck(parseOutline(ta.value), opts()) };
  return () => ro.disconnect();
}
