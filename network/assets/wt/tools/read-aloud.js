// Tool: read a PDF (or a text file) aloud with the device's own voices (Web Speech API – no server, no account,
// no listening limit). Text comes from the PDF layout analysis (lib/conv-pdfmodel.js): reading order with
// columns, hyphenated words re-joined, page numbers and running headers/footers left out; optionally tables and
// the bibliography too. Scanned pages can be made readable with text recognition first. The current sentence is
// highlighted (word by word where the voice reports it), any paragraph starts on tap, speed and voice can be
// changed while reading, the position is remembered per file. Sentences are spoken one by one: long utterances
// stop in some browsers, and pausing = stopping at the sentence, which works everywhere.
import { el, clear } from '../lib/dom.js';
import { ensureCss, T, svg, ICON } from '../lib/new-ui.js';

ensureCss();

const STORE = 'fale-wt-read-aloud';
const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
const ICONS = {
  play: ['M7 4l13 8-13 8z'], pause: ['M7 4h4v16H7z', 'M13 4h4v16h-4z'], stop: ['M6 6h12v12H6z'],
  prev: ['M18 18L9 12l9-6z', 'M6 6v12'], next: ['M6 6l9 6-9 6z', 'M18 6v12'],
};
const BIB_RE = /^(literatur(verzeichnis)?|quellen(verzeichnis)?|references|bibliography|literature)\s*:?\s*$/i;

/** Split a paragraph into sentences (keeps abbreviations like "z. B." and "Nr. 5" together). */
export function sentences(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const out = [];
  const re = /[^.!?…]+(?:[.!?…]+["“”»)]*|$)/g;
  let m, buf = '';
  while ((m = re.exec(t))) {
    const part = m[0];
    if (!part.trim()) break;
    buf += part;
    // abbreviation or number before the dot ("z. B.", "Nr.", "3.") → keep going unless the sentence is long
    const tail = buf.trim().split(' ').pop();
    if (/^(z|u|d|s|bzw|ca|etc|evtl|ggf|inkl|max|min|Nr|Str|Tel|Dr|Prof|Hr|Fr|vgl|usw|e\.g|i\.e|Mr|Mrs|Ms|St|No|vs|[A-Z]|\d+)\.$/i.test(tail) && buf.length < 300) continue;
    out.push(buf.trim());
    buf = '';
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Readable blocks from a document model: [{ text, kind: 'h'|'p'|'li'|'table', page }]. */
export function blocksFromModel(model, { tables = false, bibliography = false } = {}) {
  const out = [];
  let page = 1, stop = false;
  for (const b of model.blocks) {
    if (b.type === 'pagebreak') { page++; continue; }
    if (stop) continue;
    if (b.type === 'table') {
      if (tables) out.push({ text: b.rows.map(r => r.map(c => c.blocks.map(x => (x.runs || []).map(r2 => r2.text || '').join('')).join(' ')).filter(Boolean).join(', ')).join('. '), kind: 'table', page });
      continue;
    }
    if (b.type !== 'para') continue;
    const text = (b.runs || []).map(r => (r.br ? ' ' : r.text || '')).join('').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (!bibliography && b.tag !== 'p' && BIB_RE.test(text)) { stop = true; continue; }
    out.push({ text, kind: b.tag !== 'p' ? 'h' : b.list ? 'li' : 'p', page });
  }
  return out;
}

export default {
  labels: { back_to_files: { de: 'Zurück', en: 'Back' } },
  options: [
    { id: 'tables', type: 'toggle', default: false, label: { de: 'Tabellen mit vorlesen', en: 'Read tables, too' } },
    { id: 'bib', type: 'toggle', default: false, label: { de: 'Literaturverzeichnis mit vorlesen', en: 'Read the bibliography, too' },
      hint: { de: 'Aus: Beim Abschnitt „Literatur“ / „Quellen“ ist Schluss.', en: 'Off: reading stops at the “References” / “Bibliography” section.' } },
  ],
  mountStage(stage, state, ctx) { stageApi = readerStage(stage, state, ctx); },
  onInputs(inputs) { stageApi?.load(inputs); },
  onOptionsChange() { stageApi?.load(null, true); },
  status(values, inputs) { const i = inputs.find(x => !x.locked); return i ? { summary: i.name } : null; },
  async run(inputs) {
    // the bar button starts reading (see readerStage); this fallback returns the text as a file
    const t = stageApi?.text() || '';
    return { outputs: [{ name: (inputs[0]?.name || 'Text').replace(/\.[^.]+$/, '') + '.txt', blob: new Blob([t.replace(/\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' }) }] };
  },
};
let stageApi = null;

function readerStage(stage, state, ctx) {
  const lang = ctx.lang;
  let blocks = [], flat = [], pos = 0, playing = false, voices = [], current = null, loading = 0, utt = null;
  const info = el('p', { class: 'new-muted', role: 'status' });
  const btn = (icon, label, onclick, cls = 'wt-btn wt-btn-quiet') => el('button', { type: 'button', class: cls + ' ra-btn', aria: { label: T(lang, label) }, title: T(lang, label), onclick }, svg(icon));
  const play = btn(ICONS.play, { de: 'Vorlesen', en: 'Read aloud' }, () => (playing ? pause() : start()), 'wt-btn wt-btn-primary');
  const prev = btn(ICONS.prev, { de: 'Vorheriger Absatz', en: 'Previous paragraph' }, () => jumpPara(-1));
  const next = btn(ICONS.next, { de: 'Nächster Absatz', en: 'Next paragraph' }, () => jumpPara(1));
  const stopB = btn(ICONS.stop, { de: 'Stopp – zurück zum Anfang', en: 'Stop – back to the start' }, () => { pause(); pos = 0; mark(); save(); });
  const rate = el('input', { type: 'range', id: 'ra-rate', min: '0.6', max: '2', step: '0.1', value: '1', oninput: () => { rateOut.textContent = `${(+rate.value).toFixed(1)}×`; restartIfPlaying(); save(); } });
  const rateOut = el('output', { for: 'ra-rate' }, '1.0×');
  const voiceSel = el('select', { id: 'ra-voice', class: 'wt-input', onchange: () => { restartIfPlaying(); save(); } });
  const progress = el('progress', { class: 'ra-progress', max: '1', value: '0' });
  const textBox = el('div', { class: 'ra-text', aria: { label: T(lang, { de: 'Text – Absatz antippen, um dort zu starten', en: 'Text – tap a paragraph to start there' }) } });
  const ocrBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet', hidden: true, onclick: () => runOcr() }, T(lang, { de: 'Gescannte Seiten erkennen (OCR)', en: 'Recognise scanned pages (OCR)' }));
  const box = el('section', { class: 'new-box ra', aria: { labelledby: 'ra-h' } },
    el('h2', { id: 'ra-h' }, T(lang, { de: 'Vorlesen', en: 'Read aloud' })), info,
    el('div', { class: 'ra-controls' }, prev, play, next, stopB),
    progress,
    el('div', { class: 'ra-settings' },
      el('div', { class: 'wt-opt' }, el('label', { for: 'ra-rate' }, T(lang, { de: 'Tempo', en: 'Speed' }), ' ', rateOut), rate),
      el('div', { class: 'wt-opt' }, el('label', { for: 'ra-voice' }, T(lang, { de: 'Stimme', en: 'Voice' })), voiceSel)),
    ocrBtn, textBox);
  stage.append(box);

  if (!synth) {
    clear(box).append(el('h2', {}, T(lang, { de: 'Vorlesen', en: 'Read aloud' })), el('p', {}, T(lang, { de: 'Dieser Browser hat keine Sprachausgabe. Probier einen aktuellen Browser auf dem Handy oder Computer.', en: 'This browser has no speech output. Try a current browser on your phone or computer.' })));
  }

  // the bar's main button starts reading
  document.querySelector('.wt-bar')?.addEventListener('click', e => {
    if (e.target.closest('.wt-btn-primary') && state.phase === 'files') { e.preventDefault(); e.stopPropagation(); playing ? pause() : start(); }
  }, true);

  // ---------- voices
  function loadVoices() {
    if (!synth) return;
    voices = synth.getVoices();
    const docLang = guessLang();
    const sorted = voices.slice().sort((a, b) => (b.lang.startsWith(docLang) - a.lang.startsWith(docLang)) || (b.localService - a.localService) || a.name.localeCompare(b.name));
    const keep = voiceSel.value || prefs().voice;
    clear(voiceSel).append(...sorted.map(v => el('option', { value: v.voiceURI }, `${v.name} (${v.lang})${v.localService ? '' : ' ☁'}`)));
    if (keep && sorted.some(v => v.voiceURI === keep)) voiceSel.value = keep;
    else { const best = sorted.find(v => v.lang.startsWith(docLang)); if (best) voiceSel.value = best.voiceURI; }
    if (!sorted.length) voiceSel.append(el('option', { value: '' }, T(lang, { de: 'Standardstimme', en: 'Default voice' })));
  }
  synth?.addEventListener?.('voiceschanged', loadVoices);
  loadVoices();
  function guessLang() {
    const sample = flat.slice(0, 40).map(s => s.text).join(' ').toLowerCase();
    if (!sample) return lang;
    const de = (sample.match(/\b(der|die|und|das|ist|nicht|mit|für|ein|eine)\b/g) || []).length;
    const en = (sample.match(/\b(the|and|is|of|to|with|for|not|this|that)\b/g) || []).length;
    return de >= en ? 'de' : 'en';
  }

  // ---------- prefs + position
  function prefs() { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; } }
  function save() {
    try {
      const p = prefs();
      p.rate = rate.value; p.voice = voiceSel.value;
      if (current) { p.pos = p.pos || {}; p.pos[key(current)] = pos; const keys = Object.keys(p.pos); if (keys.length > 30) delete p.pos[keys[0]]; }
      localStorage.setItem(STORE, JSON.stringify(p));
    } catch { /* private mode */ }
  }
  const key = input => `${input.name}|${input.size}`;
  { const p = prefs(); if (p.rate) { rate.value = p.rate; rateOut.textContent = `${(+p.rate).toFixed(1)}×`; } }

  // ---------- text
  async function load(inputs = state.inputs, force = false) {
    const usable = (inputs || state.inputs).filter(i => !i.error && !i.locked);
    const input = usable[0] || null;
    if (input === current && !force) return;
    pause();
    current = input;
    blocks = []; flat = []; pos = 0;
    clear(textBox);
    if (!input) { info.textContent = T(lang, { de: 'Gib zuerst das Passwort der PDF ein.', en: 'Enter the PDF’s password first.' }); return; }
    const my = ++loading;
    info.textContent = T(lang, { de: 'Text wird vorbereitet …', en: 'Preparing the text …' });
    try {
      if (input.kind === 'pdf') {
        const { analysePdf, dropRunningLines, buildModel } = await import('../lib/conv-pdfmodel.js');
        const pdf = await input.pdfjs();
        const idx = Array.from({ length: pdf.numPages }, (_, i) => i);
        const pages = await analysePdf(pdf, idx, ctx, { onPage: (k, n) => { if (my === loading) info.textContent = T(lang, { de: `Seite ${k + 1} von ${n} wird gelesen …`, en: `Reading page ${k + 1} of ${n} …` }); } });
        dropRunningLines(pages);
        const scanned = pages.filter(p => p.chars < 15).map(p => p.index);
        const { model } = buildModel(pages, { tables: true, pageBreaks: true });
        if (my !== loading) return;
        blocks = blocksFromModel(model, { tables: state.values.tables, bibliography: state.values.bib });
        ocrBtn.hidden = !scanned.length;
        ocrBtn._pages = scanned;
        if (scanned.length) info.dataset.scanned = String(scanned.length);
      } else {
        const text = new TextDecoder().decode(await input.bytes());
        blocks = text.replace(/\r/g, '').split(/\n\s*\n/).map(t => ({ text: t.replace(/\s+/g, ' ').trim(), kind: 'p', page: 1 })).filter(b => b.text);
        ocrBtn.hidden = true;
      }
    } catch (err) {
      console.warn(err);
      info.textContent = T(lang, { de: 'Der Text konnte nicht gelesen werden.', en: 'The text could not be read.' });
      return;
    }
    render();
    pos = Math.min(prefs().pos?.[key(input)] || 0, Math.max(0, flat.length - 1));
    mark();
    loadVoices();
  }

  function render() {
    flat = [];
    clear(textBox);
    blocks.forEach((b, bi) => {
      const node = el(b.kind === 'h' ? 'h3' : 'p', { class: `ra-block ra-${b.kind}` });
      for (const s of sentences(b.text)) {
        const span = el('span', { class: 'ra-s' }, s + ' ');
        const idx = flat.length;
        span.addEventListener('click', () => { pos = idx; save(); start(); });
        flat.push({ text: s, span, block: bi });
        node.append(span);
      }
      textBox.append(node);
    });
    const words = flat.reduce((s, x) => s + x.text.split(' ').length, 0);
    const minutes = Math.max(1, Math.round(words / 150));
    const scanned = +info.dataset.scanned || 0;
    info.textContent = !flat.length
      ? T(lang, { de: 'In dieser Datei wurde kein Text gefunden – vermutlich ist sie gescannt. Tippe auf „Gescannte Seiten erkennen“.', en: 'No text was found in this file – it is probably scanned. Tap “Recognise scanned pages”.' })
      : T(lang, { de: `${current.name} · ca. ${minutes} Min. Vorlesezeit${scanned ? ` · ${scanned} gescannte Seiten ohne Text` : ''}`, en: `${current.name} · about ${minutes} min reading time${scanned ? ` · ${scanned} scanned pages without text` : ''}` });
    delete info.dataset.scanned;
    play.disabled = !flat.length;
  }

  async function runOcr() {
    if (!current || current.kind !== 'pdf') return;
    pause();
    ocrBtn.disabled = true;
    try {
      const { loadOcr, ocrPdfPage } = await import('./ocr-pdf.js');
      const ocr = await loadOcr();
      const pdf = await current.pdfjs();
      const added = [];
      for (const [k, index] of (ocrBtn._pages || []).entries()) {
        info.textContent = T(lang, { de: `Texterkennung: Seite ${k + 1} von ${ocrBtn._pages.length} …`, en: `Text recognition: page ${k + 1} of ${ocrBtn._pages.length} …` });
        const page = await pdf.getPage(index + 1);
        const r = await ocrPdfPage(ocr, page, { lang: 'deu+eng' });
        page.cleanup();
        for (const p of r.paragraphs || []) added.push({ text: p.text.replace(/-\n(\p{Ll})/gu, '$1').replace(/\s+/g, ' ').trim(), kind: 'p', page: index + 1 });
      }
      blocks = [...blocks, ...added].sort((a, b) => a.page - b.page);
      ocrBtn.hidden = true;
      render();
      mark();
    } catch (err) {
      console.warn(err);
      info.textContent = T(lang, { de: 'Die Texterkennung hat nicht geklappt.', en: 'Text recognition did not work.' });
    } finally { ocrBtn.disabled = false; }
  }

  // ---------- speaking
  function voice() { return voices.find(v => v.voiceURI === voiceSel.value) || null; }
  function start() {
    if (!synth || !flat.length) return;
    if (pos >= flat.length) pos = 0;
    playing = true;
    play.replaceChildren(svg(ICONS.pause)); play.setAttribute('aria-label', T(lang, { de: 'Pause', en: 'Pause' }));
    speak();
  }
  function speak() {
    if (!playing) return;
    synth.cancel();
    const item = flat[pos];
    if (!item) { pause(); pos = 0; save(); return; }
    mark();
    const u = new SpeechSynthesisUtterance(item.text);
    const v = voice();
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = guessLang() === 'de' ? 'de-DE' : 'en-GB';
    u.rate = +rate.value;
    u.onboundary = e => {
      if (e.name && e.name !== 'word') return;
      const t = item.text, i = e.charIndex || 0;
      const end = (t.slice(i).search(/\s/) + 1 || t.length - i + 1) - 1 + i;
      item.span.replaceChildren(t.slice(0, i), el('mark', { class: 'ra-w' }, t.slice(i, end)), t.slice(end) + ' ');
    };
    u.onend = () => { if (utt !== u) return; item.span.textContent = item.text + ' '; if (!playing) return; pos++; save(); speak(); };
    u.onerror = e => { if (utt !== u) return; if (e.error === 'interrupted' || e.error === 'canceled') return; console.warn('speech', e.error); pause(); };
    utt = u;
    synth.speak(u);
  }
  function pause() {
    if (playing) save();
    playing = false;
    utt = null;
    synth?.cancel();
    play.replaceChildren(svg(ICONS.play)); play.setAttribute('aria-label', T(lang, { de: 'Vorlesen', en: 'Read aloud' }));
    flat.forEach(x => { if (x.span.firstElementChild) x.span.textContent = x.text + ' '; });
  }
  function restartIfPlaying() { if (playing) speak(); }
  function jumpPara(d) {
    if (!flat.length) return;
    const b = flat[pos]?.block ?? 0;
    const target = d < 0
      ? (flat.findIndex(x => x.block === b) < pos ? flat.findIndex(x => x.block === b) : flat.findIndex(x => x.block === Math.max(0, b - 1)))
      : flat.findIndex(x => x.block > b);
    pos = target < 0 ? (d < 0 ? 0 : flat.length - 1) : target;
    mark(); save();
    if (playing) speak();
  }
  function mark() {
    flat.forEach((x, i) => x.span.classList.toggle('is-current', i === pos));
    progress.value = flat.length ? pos / flat.length : 0;
    const cur = flat[pos]?.span;
    if (cur && playing) cur.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    prev.disabled = next.disabled = stopB.disabled = !flat.length;
  }

  window.addEventListener('pagehide', () => synth?.cancel());
  load();
  return { load, text: () => blocks.map(b => b.text).join('\n\n') };
}
