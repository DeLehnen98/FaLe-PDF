// Tool: password and passphrase generator (no file intake). Everything is generated in the browser with
// crypto.getRandomValues; nothing is stored or sent. Live list with copy buttons, exact entropy with an
// honest explanation, batch generation; the primary action saves the current list as a TXT file.
import { el, icon, clear } from '../lib/dom.js';
import { makePassword, makePassphrase, passwordBits, passphraseBits, rating, crackTime, groups } from '../lib/seo-pwgen.js';
import { seoCss, copyText, svgIcon } from '../lib/seo-ui.js';

seoCss();
const LANG = document.documentElement.lang === 'en' ? 'en' : 'de';
const T = (v, lang = LANG) => (typeof v === 'string' ? v : v[lang] ?? v.de);
const lists = {};
async function wordList(l) {
  if (!lists[l]) lists[l] = (l === 'en' ? import('../lib/seo-words-en.js') : import('../lib/seo-words-de.js')).then(m => m.default);
  return lists[l];
}

const pw = v => v.mode !== 'phrase';
const ph = v => v.mode === 'phrase';

let stageCtl = null;

/** Validation of the current settings → null or {de, en}. */
function problem(v) {
  if (pw(v) && !groups(v).length) return { de: 'Wähle mindestens eine Zeichenart aus.', en: 'Choose at least one character type.' };
  return null;
}

export default {
  labels: { back_to_files: { de: 'Zurück zum Generator', en: 'Back to the generator' } },
  options: [
    { id: 'mode', type: 'radio', default: 'password', label: { de: 'Art', en: 'Type' },
      choices: [
        { value: 'password', label: { de: 'Passwort', en: 'Password' }, hint: { de: 'Zufällige Zeichen', en: 'Random characters' } },
        { value: 'phrase', label: { de: 'Passphrase', en: 'Passphrase' }, hint: { de: 'Zufällige Wörter, leichter zu merken', en: 'Random words, easier to remember' } },
      ] },
    { id: 'length', type: 'range', default: 20, min: 6, max: 64, step: 1, label: { de: 'Länge', en: 'Length' },
      format: (v, lang) => `${v} ${lang === 'de' ? 'Zeichen' : 'characters'}`, when: pw },
    { id: 'upper', type: 'toggle', default: true, label: { de: 'Großbuchstaben (A–Z)', en: 'Upper case (A–Z)' }, when: pw },
    { id: 'lower', type: 'toggle', default: true, label: { de: 'Kleinbuchstaben (a–z)', en: 'Lower case (a–z)' }, when: pw },
    { id: 'digits', type: 'toggle', default: true, label: { de: 'Ziffern (0–9)', en: 'Digits (0–9)' }, when: pw },
    { id: 'symbols', type: 'toggle', default: true, label: { de: 'Sonderzeichen (!#$% …)', en: 'Symbols (!#$% …)' }, when: pw },
    { id: 'similar', type: 'toggle', default: true, label: { de: 'Verwechselbare Zeichen weglassen', en: 'Leave out look-alike characters' },
      hint: { de: 'Ohne I, l, 1, O, 0 und o – gut zum Abtippen.', en: 'Without I, l, 1, O, 0 and o – easier to type from paper.' }, when: pw },
    { id: 'words', type: 'range', default: 6, min: 3, max: 10, step: 1, label: { de: 'Anzahl Wörter', en: 'Number of words' },
      format: (v, lang) => `${v} ${lang === 'de' ? 'Wörter' : 'words'}`, when: ph },
    { id: 'wordLang', type: 'select', default: LANG, label: { de: 'Sprache der Wörter', en: 'Word language' }, when: ph,
      choices: [{ value: 'de', label: { de: 'Deutsch', en: 'German' } }, { value: 'en', label: { de: 'Englisch', en: 'English' } }] },
    { id: 'separator', type: 'select', default: '-', label: { de: 'Trennzeichen', en: 'Separator' }, when: ph,
      choices: [{ value: '-', label: { de: 'Bindestrich (-)', en: 'Hyphen (-)' } }, { value: ' ', label: { de: 'Leerzeichen', en: 'Space' } },
        { value: '.', label: { de: 'Punkt (.)', en: 'Dot (.)' } }, { value: '_', label: { de: 'Unterstrich (_)', en: 'Underscore (_)' } },
        { value: '', label: { de: 'Keins', en: 'None' } }] },
    { id: 'capitalize', type: 'toggle', default: true, label: { de: 'Wörter großschreiben', en: 'Capitalise words' }, when: ph },
    { id: 'digit', type: 'toggle', default: false, label: { de: 'Eine Ziffer einfügen', en: 'Add a digit' },
      hint: { de: 'Für Dienste, die eine Ziffer verlangen.', en: 'For services that require a digit.' }, when: ph },
    { id: 'count', type: 'select', default: 1, label: { de: 'Wie viele?', en: 'How many?' },
      choices: [1, 5, 10, 20, 50].map(n => ({ value: n, label: String(n) })) },
  ],

  mountStage(stage, state, ctx) { stageCtl = pwStage(stage, state, ctx); },
  onOptionsChange() { stageCtl?.generate(); },

  status(v) {
    const p = problem(v);
    if (p) return { ok: false, hint: p };
    const list = v.list || [];
    if (!list.length) return { ok: false };
    const n = list.length;
    return { summary: n === 1 ? { de: '1 Passwort', en: '1 password' } : { de: `${n} Passwörter`, en: `${n} passwords` } };
  },

  async run(inputs, opts, ctx) {
    const list = opts.list || [];
    if (!list.length) throw Object.assign(new Error('empty'), { userMessage: { de: 'Noch nichts erzeugt.', en: 'Nothing generated yet.' } });
    const name = ctx.lang === 'de' ? (opts.mode === 'phrase' ? 'Passphrasen.txt' : 'Passwörter.txt') : (opts.mode === 'phrase' ? 'Passphrases.txt' : 'Passwords.txt');
    ctx.note({ de: 'Die Datei ist nicht verschlüsselt. Übertrag die Passwörter in deinen Passwort-Manager und lösch die Datei danach.', en: 'The file is not encrypted. Move the passwords into your password manager and delete the file afterwards.' });
    return { outputs: [{ name, blob: new Blob([list.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' }) }] };
  },
};

// ---------------------------------------------------------------- stage: live list + strength
function pwStage(stage, state, ctx) {
  const lang = ctx.lang;
  const listEl = el('ol', { class: 'seo-pw-list', aria: { label: T({ de: 'Erzeugte Passwörter', en: 'Generated passwords' }, lang) } });
  const live = el('p', { class: 'seo-sr', role: 'status', aria: { live: 'polite' } });
  const regen = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet seo-pw-regen', onclick: () => generate() },
    icon('restart'), el('span', {}, T({ de: 'Neu erzeugen', en: 'Generate new' }, lang)));
  const copyAll = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet', hidden: true, onclick: () => doCopy((state.values.list || []).join('\n'), copyAll) },
    svgIcon('copy'), el('span', {}, T({ de: 'Alle kopieren', en: 'Copy all' }, lang)));
  const meterBar = el('span', { class: 'seo-meter-bar' });
  const meter = el('div', { class: 'seo-meter', role: 'img' }, meterBar);
  const strength = el('p', { class: 'seo-pw-strength' });
  const detail = el('p', { class: 'img-muted seo-pw-detail' });
  const err = el('p', { class: 'img-note', hidden: true });
  const explain = el('details', { class: 'seo-details' },
    el('summary', {}, T({ de: 'Wie wird die Stärke berechnet?', en: 'How is the strength calculated?' }, lang)),
    el('p', {}, T({
      de: 'Gezählt wird, wie viele verschiedene Ergebnisse diese Einstellung erzeugen kann – angegeben in Bit (jedes Bit verdoppelt die Zahl der Möglichkeiten). Wir nehmen dabei an, dass ein Angreifer das Verfahren, die Zeichen und sogar die Wortliste kennt. Die Zeitangabe gilt für 10 Milliarden Versuche pro Sekunde, wie sie ein schneller Rechner gegen eine schlecht geschützte, gestohlene Passwort-Datenbank schaffen kann; bei normalen Logins sind viel weniger Versuche möglich.',
      en: 'We count how many different results these settings can produce – given in bits (every bit doubles the number of possibilities). We assume an attacker knows the method, the characters and even the word list. The time is for 10 billion guesses per second, which a fast computer can manage against a poorly protected, stolen password database; normal logins allow far fewer attempts.' }, lang)),
    el('p', {}, T({
      de: 'Das gilt nur für zufällig erzeugte Passwörter wie diese. Ein selbst ausgedachtes Passwort ist meist viel schwächer, als es aussieht. Und: Nutze jedes Passwort nur für einen Dienst.',
      en: 'This only holds for randomly generated passwords like these. A password you make up yourself is usually much weaker than it looks. And: use each password for one service only.' }, lang)));
  const box = el('section', { class: 'img-box seo-pw', aria: { labelledby: 'seo-pw-h' } },
    el('h2', { class: 'img-h', id: 'seo-pw-h' }, T({ de: 'Dein Passwort', en: 'Your password' }, lang)),
    err, listEl, el('div', { class: 'seo-pw-actions' }, regen, copyAll), meter, strength, detail, explain, live);
  stage.append(box);

  async function doCopy(text, btn) {
    const ok = await copyText(text);
    live.textContent = ok ? T({ de: 'In die Zwischenablage kopiert.', en: 'Copied to the clipboard.' }, lang)
      : T({ de: 'Kopieren hat nicht geklappt – markiere den Text und kopiere ihn von Hand.', en: 'Copying didn’t work – select the text and copy it by hand.' }, lang);
    if (ok && btn) { btn.classList.add('is-done'); setTimeout(() => btn.classList.remove('is-done'), 1400); }
  }

  let seq = 0;
  async function generate() {
    const v = state.values;
    const my = ++seq;
    const p = problem(v);
    err.hidden = !p; clear(err); if (p) err.append(icon('alert'), el('span', {}, T(p, lang)));
    if (p) { v.list = []; render([], 0); state.results.clear(); ctx.refresh(); return; }
    const n = Math.max(1, +v.count || 1);
    let list, bits;
    if (ph(v)) {
      const words = await wordList(v.wordLang === 'en' ? 'en' : 'de');
      if (my !== seq) return;
      list = Array.from({ length: n }, () => makePassphrase(words, v));
      bits = passphraseBits(words.length, v);
    } else {
      list = Array.from({ length: n }, () => makePassword(v));
      bits = passwordBits(v);
    }
    v.list = list;
    listEl.classList.toggle('is-phrase', ph(v));
    render(list, bits);
    state.results.clear();
    ctx.refresh();
    live.textContent = T(n === 1 ? { de: 'Neues Passwort erzeugt.', en: 'New password generated.' } : { de: `${n} neue Passwörter erzeugt.`, en: `${n} new passwords generated.` }, lang);
  }

  function render(list, bits) {
    clear(listEl);
    list.forEach((s, i) => {
      const code = el('code', { class: 'seo-pw-value', translate: 'no', spellcheck: 'false' }, s);
      const label = list.length === 1 ? T({ de: 'Kopieren', en: 'Copy' }, lang) : T({ de: `Nr. ${i + 1} kopieren`, en: `Copy no. ${i + 1}` }, lang);
      const btn = el('button', { type: 'button', class: 'wt-btn wt-btn-primary seo-copy', aria: { label }, onclick: () => doCopy(s, btn) },
        svgIcon('copy'), el('span', { class: list.length === 1 ? '' : 'seo-sr' }, T({ de: 'Kopieren', en: 'Copy' }, lang)));
      listEl.append(el('li', { class: 'seo-pw-item' + (list.length === 1 ? ' is-single' : '') }, code, btn));
    });
    copyAll.hidden = list.length < 2;
    if (!list.length) { meter.hidden = true; strength.textContent = ''; detail.textContent = ''; return; }
    const r = rating(bits);
    meter.hidden = false;
    meter.dataset.level = String(r.level);
    meterBar.style.width = `${Math.max(6, Math.min(100, bits / 128 * 100))}%`;
    meter.setAttribute('aria-label', `${T(r, lang)} (${Math.round(bits)} ${lang === 'de' ? 'Bit' : 'bits'})`);
    strength.textContent = `${T(r, lang)} · ${Math.round(bits)} ${lang === 'de' ? 'Bit' : 'bits'}`;
    detail.textContent = T({ de: `Durchprobieren dauert im Schnitt ${crackTime(bits).de}.`, en: `Guessing takes ${crackTime(bits).en} on average.` }, lang);
  }

  generate();
  return { generate };
}
