// FaLe PDF i18n runtime.
// The UI is written in German directly in the source. In English mode this module translates the
// rendered DOM (text nodes + a few attributes) on the first paint and for every later change
// (MutationObserver), using the dictionary in ./en.js and the matching engine in ./core.js.
// German mode does nothing at all (no dictionary is loaded).
//
//   import { t, lang, setLang } from './i18n/index.js';
//   t('(komprimiert)')                      → '(compressed)' in English, unchanged in German
//   t('Seite {n} von {N}', { n: 1, N: 9 })  → 'Page 1 of 9' / 'Seite 1 von 9'
//
// Containers holding user content (file names, document pages, editors, letters that stay German)
// are never touched: mark them with [data-no-i18n] or add a selector to SKIP below.
import { createTranslator, subst } from './core.js';

const KEY = 'fale-lang';
export const LANG_SETTINGS = ['auto', 'de', 'en'];

// --- user content that must never be translated ---------------------------------------------------
const SKIP = [
  '[data-no-i18n]', 'script', 'style', 'textarea', 'svg', 'canvas', 'pre', 'code', 'kbd',
  '[contenteditable]:not([contenteditable="false"])',
  // file names, tags, folders
  '.doc-name', '.title-btn', '.fr-name', '.tchip', '.tag-dot', '.ft-txt strong', '.folder-crumbs strong', '.folder-crumbs a:not(:first-child)',
  '.result-head strong', '.hit-snippet', '.rem-note', '.rem-title', '.fc-name', '.ss-font-sample',
  // PDF viewer pages, text/annotation layers
  '.pdfViewer', '.textLayer', '.annotationLayer', '.v-stage .page', '.page-canvas',
  // office editors: document page, sheet cells, slides, notes, comments, outlines
  '.doc-page', '.doc-sheet', '.sh-cells', '.sh-tab', '.slide-stage', '.slide-strip', '.ss-stage', '.slideshow .ss-stage',
  '.pv-notes-text', '.slide-notes', '.ol-slide', '.w-cmt-text', '.w-outline-list', '.toc', '.sheet-app .sh-fx-input',
  // generated content: letters (stay German on purpose), compare text, reader text, QR results, vault viewer
  '.lt-paper', '.cmp-text', '.cmp-text-page', '.rf-sec-body', '.qs-text', '.vv-text', '.vv-pages',
  '.bm-title', '.toc-title',
  // previews of extracted/recognized data, screen-reader echo of cell contents
  '.x2-table', '.ocr-tbl', '#sh-live',
];
const SKIP_SEL = SKIP.join(',');
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-tooltip', 'aria-description', 'data-label'];
const BTN_INPUT = /^(button|submit|reset)$/i;

// Default values of text inputs that are generated text (e.g. watermark "VERTRAULICH"):
// translated once when the input appears, if the user has not typed anything yet.
let DEFAULT_VALUES = {};

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} },
};

export function getLangSetting() {
  const v = ls.get(KEY);
  return LANG_SETTINGS.includes(v) ? v : 'auto';
}

/** Language of the device: the first of navigator.languages that is German or English (else English). */
export function deviceLang() {
  const list = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'de']);
  for (const l of list) {
    if (/^de\b/i.test(l)) return 'de';
    if (/^en\b/i.test(l)) return 'en';
  }
  return 'en';
}
export const resolveLang = setting => (setting === 'de' || setting === 'en' ? setting : deviceLang());

let current = 'de';
let tr = null;
let observer = null;
const doneText = new WeakMap();
const doneAttr = new WeakMap();

/** Current UI language: 'de' | 'en'. */
export function lang() { return current; }
export const isEnglish = () => current === 'en';
/** Locale for Intl/toLocale* calls. */
export const locale = () => (current === 'en' ? 'en-GB' : 'de-DE');

/** Translate a German source string (for text outside the DOM: file names, share titles, PDF text …). */
export function t(german, vars) {
  if (tr) return tr.t(german, vars);
  return vars ? subst(german, vars) : german;
}

// ------------------------------------------------------------------ DOM translation
function skipped(el) {
  try { return !!(el && el.closest && el.closest(SKIP_SEL)); } catch { return false; }
}

function trText(node) {
  const v = node.nodeValue;
  if (!v || v.length > 2000 || doneText.get(node) === v) return;
  if (!/[\p{L}\d]/u.test(v)) return;
  const out = tr.lookup(v);
  if (out == null) { doneText.set(node, v); return; }
  const lead = /^\s*/.exec(v)[0], trail = /\s*$/.exec(v)[0];
  const nv = lead + out + trail;
  doneText.set(node, nv);
  if (nv !== v) node.nodeValue = nv;
}

function trAttrs(el) {
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v) trAttr(el, a, v);
  }
  if (el.tagName === 'INPUT') {
    if (BTN_INPUT.test(el.type)) { const v = el.getAttribute('value'); if (v) trAttr(el, 'value', v); }
    else if (!el.dataset.i18nDef && (el.type === 'text' || el.type === 'search' || !el.type)) {
      el.dataset.i18nDef = '1';
      const dv = el.getAttribute('value');
      if (dv && DEFAULT_VALUES[dv] && el.value === dv) {
        el.value = DEFAULT_VALUES[dv];
        el.setAttribute('value', DEFAULT_VALUES[dv]);
        el.dispatchEvent(new Event('input', { bubbles: true })); // let the tool pick up the translated default
      }
    }
  }
}

function trAttr(el, a, v) {
  let m = doneAttr.get(el);
  if (m && m[a] === v) return;
  const out = tr.lookupAttr(a, v);
  if (!m) { m = {}; doneAttr.set(el, m); }
  m[a] = out == null ? v : out;
  if (out != null && out !== v) el.setAttribute(a, out);
}

// Elements whose whole text is one dictionary entry although split by inline formatting
// (e.g. "Tippe auf <b>Teilen</b>") are translated as a unit.
const INLINE = new Set(['B', 'STRONG', 'EM', 'I', 'U', 'SMALL', 'MARK', 'BR', 'SUP', 'SUB']);
function trElementUnit(el) {
  const kids = el.childNodes;
  if (kids.length < 2 || kids.length > 12) return false;
  let hasEl = false;
  for (const k of kids) {
    if (k.nodeType === 1) { if (!INLINE.has(k.tagName) || k.attributes.length || k.children.length) return false; hasEl = true; }
    else if (k.nodeType !== 3) return false;
  }
  if (!hasEl) return false;
  const full = el.textContent;
  if (!tr.has(full)) return false;
  const out = tr.lookup(full);
  if (out == null) return false;
  el.textContent = out;
  doneText.set(el.firstChild, el.firstChild.nodeValue);
  return true;
}

const FILTER = {
  acceptNode(n) {
    if (n.nodeType === 3) return NodeFilter.FILTER_ACCEPT;
    if (n.matches(SKIP_SEL)) {
      // a textarea's content is user text, but its placeholder/title are UI chrome
      if (n.tagName === 'TEXTAREA' && !n.closest('[data-no-i18n]')) trTextareaAttrs(n);
      return NodeFilter.FILTER_REJECT;
    }
    return NodeFilter.FILTER_ACCEPT;
  },
};

function trTextareaAttrs(el) {
  for (const a of ['placeholder', 'title', 'aria-label']) {
    const v = el.getAttribute(a);
    if (v) trAttr(el, a, v);
  }
}

function translateTree(root) {
  if (!tr || !root) return;
  if (root.nodeType === 3) { if (!skipped(root.parentElement)) trText(root); return; }
  if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
  if (root.nodeType === 1) {
    if (skipped(root)) { if (root.tagName === 'TEXTAREA' && !root.closest('[data-no-i18n]')) trTextareaAttrs(root); return; }
    trAttrs(root);
    if (trElementUnit(root)) return;
  }
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, FILTER);
  let n;
  while ((n = w.nextNode())) {
    if (n.nodeType === 3) trText(n);
    else { trAttrs(n); if (n.childNodes.length > 1 && trElementUnit(n)) continue; }
  }
}

/** Translate a subtree now (English mode only). */
export function translateNow(root = document.body) {
  if (!tr) return;
  translateTree(root);
  trTitle();
}

function trTitle() {
  const v = document.title;
  if (!v || doneText.get(document) === v) return;
  const out = tr.lookup(v);
  const nv = out == null ? v : out;
  doneText.set(document, nv);
  if (nv !== v) document.title = nv;
}

let pending = new Set();
let scheduled = false;
function flush() {
  scheduled = false;
  const list = pending;
  pending = new Set();
  for (const n of list) {
    if (!n.isConnected) continue;
    if (n.nodeType === 3) { if (!skipped(n.parentElement)) trText(n); }
    else if (n.nodeType === 1) translateTree(n);
  }
  trTitle();
}

function onMutations(records) {
  for (const r of records) {
    if (r.type === 'childList') {
      if (r.target === document.head || (r.target.nodeName === 'TITLE')) { pending.add(document.head); continue; }
      r.addedNodes.forEach(n => pending.add(n));
    } else if (r.type === 'characterData') pending.add(r.target);
    else if (r.type === 'attributes') {
      const el = r.target;
      if (skipped(el)) continue;
      const v = el.getAttribute(r.attributeName);
      if (v && (r.attributeName !== 'value' || (el.tagName === 'INPUT' && BTN_INPUT.test(el.type)))) trAttr(el, r.attributeName, v);
    }
  }
  // Mutation callbacks run as a microtask before the next paint: translate right away,
  // so no German text is ever painted. Large bursts are processed in one batch.
  if (!scheduled) { scheduled = true; flush(); }
}

function startObserver() {
  if (observer) return;
  observer = new MutationObserver(onMutations);
  observer.observe(document.documentElement, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: [...ATTRS, 'value'],
  });
}

const CSS = `
:lang(en) .s-text:empty::before, :lang(en) .pt-text:empty::before, :lang(en) .pt-etext-in:empty::before { content: "Enter text"; }
:lang(en) .doc-page hr[data-page-break]::after { content: "Page break"; }
`;
function injectStyle() {
  if (document.getElementById('i18n-style')) return;
  const st = document.createElement('style');
  st.id = 'i18n-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}

function release() {
  document.documentElement.classList.remove('i18n-hold');
}

async function startEnglish() {
  const mod = await import('./en.js');
  tr = createTranslator(mod.default);
  DEFAULT_VALUES = mod.defaultValues || {};
  current = 'en';
  document.documentElement.lang = 'en';
  injectStyle();
  translateNow(document.documentElement);
  startObserver();
  patchNativeDialogs();
}

function patchNativeDialogs() {
  for (const k of ['alert', 'confirm', 'prompt']) {
    const orig = window[k];
    if (typeof orig !== 'function' || orig.__i18n) continue;
    const f = function (msg, ...rest) { return orig.call(window, msg == null ? msg : t(String(msg)), ...rest); };
    f.__i18n = true;
    window[k] = f;
  }
}

/** Change the language setting ('auto' | 'de' | 'en'). Switching to German reloads the page. */
export async function setLang(setting) {
  if (!LANG_SETTINGS.includes(setting)) setting = 'auto';
  ls.set(KEY, setting);
  const next = resolveLang(setting);
  if (next === current) { window.dispatchEvent(new CustomEvent('fale:lang', { detail: { lang: current, setting } })); return current; }
  if (next === 'de') {
    // German is the source language: re-render everything from scratch.
    location.reload();
    return next;
  }
  try { await startEnglish(); } catch (e) { tr = null; current = 'de'; document.documentElement.lang = 'de'; throw e; }
  window.dispatchEvent(new CustomEvent('fale:lang', { detail: { lang: current, setting } }));
  return current;
}

// ------------------------------------------------------------------ language picker (settings, onboarding)
/** <select> for Automatisch / Deutsch / English. Changes are handled by a delegated listener below. */
export function langSelectHtml(id = '') {
  const cur = getLangSetting();
  const opt = (v, label, raw) => `<option value="${v}"${v === cur ? ' selected' : ''}${raw ? ' data-no-i18n' : ''}>${label}</option>`;
  return `<select class="select" data-lang-select${id ? ` id="${id}"` : ''} aria-label="Sprache / Language">${opt('auto', 'Automatisch (Gerätesprache)')}${opt('de', 'Deutsch', true)}${opt('en', 'English', true)}</select>`;
}

/** Adds the language row to Ich › Einstellungen (called from views.js renderSettings). */
export function mountLangSettings(root) {
  if (!root || root.querySelector('[data-lang-row]')) return;
  const group = root.querySelector('.settings-group');
  if (!group) return;
  const row = document.createElement('div');
  row.className = 'settings-row';
  row.dataset.langRow = '';
  row.innerHTML = `<div class="label"><strong>Sprache / Language</strong><span>Automatisch folgt der Sprache deines Geräts.</span></div>${langSelectHtml('set-lang')}`;
  const themeRow = group.querySelector('[data-theme-opt]');
  const after = themeRow ? themeRow.closest('.settings-row') : null;
  if (after && after.nextSibling) group.insertBefore(row, after.nextSibling); else group.prepend(row);
}

if (typeof document !== 'undefined') {
  document.addEventListener('change', async e => {
    const sel = e.target && e.target.closest && e.target.closest('[data-lang-select]');
    if (!sel) return;
    document.querySelectorAll('[data-lang-select]').forEach(s => { if (s !== sel) s.value = sel.value; });
    try { await setLang(sel.value); } catch (err) {
      // e.g. offline before the English dictionary was ever cached
      console.warn('i18n: switching language failed', err);
      try { (await import('../ui.js')).toast('Die Sprache konnte gerade nicht gewechselt werden. Bitte später erneut versuchen.', 'error'); } catch {}
    }
  });
}

// ------------------------------------------------------------------ boot
// Runs before the rest of the app (first import in app.js): with top-level await the first render
// already happens in English. index.html hides the page (html.i18n-hold) until this pass, max 150 ms.
const initial = resolveLang(getLangSetting());
if (initial === 'en') {
  try { await startEnglish(); } catch (e) { console.warn('i18n: English dictionary could not be loaded', e); document.documentElement.lang = 'de'; }
} else {
  document.documentElement.lang = 'de';
}
release();

if (typeof window !== 'undefined') window.FaLeI18n = { t, lang, setLang, getLangSetting, translateNow, SKIP_SEL };
