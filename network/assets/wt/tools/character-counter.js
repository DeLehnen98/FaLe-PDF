// Tool: character and word counter (Zeichen zählen). Live counts as you type or paste: characters with and
// without spaces (emoji and accents count as one, like people see them), words, sentences, paragraphs,
// lines, reading and speaking time, standard pages (1,800 characters), common length limits (SMS with the
// real encoding rule, meta title/description, posts, captions) and the most frequent words.
// The text never leaves the page and is not stored (noBar: nothing to save).
import { el, clear } from '../lib/dom.js';
import { T, calcCss, fmt, copyBtn, liveRegion } from '../lib/calc-core.js';

calcCss();

const seg = (gran, lang) => (typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(lang, { granularity: gran }) : null);
// GSM 03.38 basic set + extension (extension characters cost two)
const GSM = new Set(Array.from('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'));
const GSM_EXT = new Set(Array.from('^{}\\[~]|€\f'));

/** Text statistics (exported for the unit test). */
export function stats(text, lang = 'de') {
  const g = seg('grapheme', lang), wseg = seg('word', lang), sseg = seg('sentence', lang);
  const graphemes = g ? [...g.segment(text)].length : Array.from(text).length;
  const noSpace = g ? [...g.segment(text.replace(/\s+/g, ''))].length : Array.from(text.replace(/\s+/g, '')).length;
  let words = [];
  if (wseg) words = [...wseg.segment(text)].filter(s => s.isWordLike).map(s => s.segment);
  else words = text.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || [];
  const sentences = sseg ? [...sseg.segment(text)].filter(s => /[\p{L}\p{N}]/u.test(s.segment)).length : (text.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || []).filter(s => /[\p{L}\p{N}]/u.test(s)).length;
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim()).length;
  const lines = text ? text.split(/\r\n|\r|\n/).length : 0;
  // SMS: GSM-7 (160 / 153 per part) unless one character needs Unicode (70 / 67)
  let gsm = true, units = 0;
  for (const ch of text) { if (GSM.has(ch)) units++; else if (GSM_EXT.has(ch)) units += 2; else { gsm = false; break; } }
  const smsLen = gsm ? units : [...text].reduce((s, ch) => s + (ch.codePointAt(0) > 0xffff ? 2 : 1), 0);
  const sms = !text ? 0 : gsm ? (smsLen <= 160 ? 1 : Math.ceil(smsLen / 153)) : (smsLen <= 70 ? 1 : Math.ceil(smsLen / 67));
  const freq = new Map();
  for (const wd of words) { const k = wd.toLocaleLowerCase(lang); if (k.length >= 4) freq.set(k, (freq.get(k) || 0) + 1); }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
  return { chars: graphemes, noSpace, words: words.length, sentences, paragraphs, lines, sms, smsUnicode: !gsm, smsLen,
    readMin: words.length / 220, speakMin: words.length / 130, pages: graphemes / 1800, top };
}

const LIMITS = [
  { id: 'title', label: { de: 'Seitentitel für Suchmaschinen', en: 'Page title for search engines' }, max: 60 },
  { id: 'desc', label: { de: 'Meta-Beschreibung', en: 'Meta description' }, max: 155 },
  { id: 'sms', label: { de: 'SMS (eine Nachricht)', en: 'Text message (one SMS)' }, max: 160 },
  { id: 'post', label: { de: 'Kurzer Social-Media-Post', en: 'Short social media post' }, max: 280 },
  { id: 'caption', label: { de: 'Bildunterschrift (Social Media)', en: 'Photo caption (social media)' }, max: 2200 },
  { id: 'page', label: { de: 'Normseite', en: 'Standard page' }, max: 1800 },
];

export default {
  noBar: true,
  mountStage(stage, state, ctx) { stage.append(build(ctx.lang)); },
  status() { return { ok: false }; },
  async run() { throw Object.assign(new Error('nothing'), { userMessage: { de: 'Hier gibt es nichts zu speichern.', en: 'Nothing to save here.' } }); },
};

function build(lang) {
  const w = (de, en) => T({ de, en }, lang);
  const live = liveRegion();
  const ta = el('textarea', { class: 'calc-textarea', id: 'cc-text', spellcheck: 'true', placeholder: w('Text hier eintippen oder einfügen …', 'Type or paste your text here …'), aria: { label: w('Text', 'Text') } });
  const statsBox = el('div', { class: 'calc-stats' });
  const limits = el('div', { class: 'calc-grid' });
  const more = el('div', { class: 'calc-out' });
  const topBox = el('div');
  const clearBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', onclick: () => { ta.value = ''; update(); ta.focus(); } }, w('Leeren', 'Clear'));
  let timer = 0;
  ta.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(update, ta.value.length > 50000 ? 250 : 30); });
  const min = m => (m < 1 ? w(`${Math.max(1, Math.round(m * 60))} Sek.`, `${Math.max(1, Math.round(m * 60))} sec`) : w(`${fmt(m, { max: 1 })} Min.`, `${fmt(m, { max: 1 })} min`));
  function update() {
    const s = stats(ta.value, lang);
    clear(statsBox); clear(limits); clear(more); clear(topBox);
    const stat = (n, label, copy = false) => el('div', { class: 'calc-stat' }, el('b', {}, fmt(n, { max: 0 })), el('span', {}, label), copy ? copyBtn(() => String(n), w(`${label} kopieren`, `Copy ${label}`), live) : null);
    statsBox.append(stat(s.chars, w('Zeichen mit Leerzeichen', 'Characters with spaces'), true), stat(s.noSpace, w('Zeichen ohne Leerzeichen', 'Characters without spaces'), true),
      stat(s.words, w('Wörter', 'Words'), true), stat(s.sentences, w('Sätze', 'Sentences')));
    const row = (l, val) => el('div', { class: 'calc-row' }, el('span', { class: 'calc-row-label' }, l), el('span', { class: 'calc-row-val' }, val));
    more.append(row(w('Absätze', 'Paragraphs'), fmt(s.paragraphs, { max: 0 })), row(w('Zeilen', 'Lines'), fmt(s.lines, { max: 0 })),
      row(w('Lesezeit', 'Reading time'), s.words ? min(s.readMin) : '–'), row(w('Sprechzeit (Vortrag)', 'Speaking time (talk)'), s.words ? min(s.speakMin) : '–'),
      row(w('Normseiten (1.800 Zeichen)', 'Standard pages (1,800 characters)'), fmt(s.pages, { max: 2 })),
      row(w('SMS', 'SMS'), s.chars ? `${s.sms} ${s.sms === 1 ? w('Nachricht', 'message') : w('Nachrichten', 'messages')}${s.smsUnicode ? w(' (Sonderzeichen: nur 70 je SMS)', ' (special characters: only 70 per SMS)') : ''}` : '–'));
    for (const L of LIMITS) {
      const n = L.id === 'sms' ? s.smsLen : s.chars;
      const max = L.id === 'sms' && s.smsUnicode ? 70 : L.max;
      const over = n > max;
      const bar = el('span');
      bar.style.width = `${Math.min(100, (n / max) * 100)}%`;
      limits.append(el('div', { class: 'calc-limit' + (over ? ' is-over' : '') },
        el('span', {}, T(L.label, lang)), el('b', {}, `${fmt(n, { max: 0 })} / ${fmt(max, { max: 0 })}`),
        el('div', { class: 'calc-meter', role: 'img', aria: { label: `${fmt(n, { max: 0 })} / ${fmt(max, { max: 0 })}` } }, bar)));
    }
    if (s.top.length) topBox.append(el('h3', { class: 'img-h' }, w('Häufigste Wörter', 'Most frequent words')),
      el('ol', { class: 'calc-list' }, s.top.map(([word, c]) => el('li', {}, `${word} – ${c}×`))));
  }
  update();
  setTimeout(() => ta.focus({ preventScroll: true }), 50);
  return el('section', { class: 'img-box calc', aria: { labelledby: 'cc-h' } },
    el('h2', { class: 'img-h', id: 'cc-h' }, w('Zeichen und Wörter zählen', 'Count characters and words')),
    ta, el('div', { class: 'calc-actions' }, clearBtn, el('span', { class: 'calc-hint' }, w('Dein Text bleibt auf dieser Seite und wird nicht gespeichert.', 'Your text stays on this page and is not stored.'))),
    statsBox, more, el('h3', { class: 'img-h' }, w('Längen-Grenzen', 'Length limits')), limits, topBox, live);
}
