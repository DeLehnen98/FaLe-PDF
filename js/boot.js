// FaLe PDF – first script of index.html (classic, synchronous, before the app module).
// It replaces the former inline <script>, so the Content-Security-Policy can forbid ALL inline script
// (script-src 'self'; no 'unsafe-inline'). Four jobs:
//   1. theme before first paint (no flash)
//   2. UI language (Automatisch = first German/English entry of navigator.languages, else English);
//      in English mode the page stays hidden until the first translation pass (max. 150 ms)
//   3. Trusted Types (CSP: require-trusted-types-for 'script'): a "default" policy that every HTML
//      string assignment (innerHTML, insertAdjacentHTML, outerHTML, document.write, DOMParser …) passes
//      through. Untrusted data is escaped by the app itself (ui.js esc()); this policy is the safety net:
//      it removes active content (script/iframe/object/embed/base/meta, on* handlers, javascript: URLs)
//      that should never be there. Script URLs (workers, vendor scripts) must be same-origin or blob:,
//      string-to-code (eval, new Function, setTimeout("…")) is refused. See docs/SECURITY.md.
//   4. small polyfills for older Android System WebViews (AbortSignal.any, async iteration of
//      ReadableStream – pdf.js 6 uses both on the main thread; missing → text layer, search and
//      "Ersetzen" fail with "… is not async iterable" / "AbortSignal.any is not a function")
(function () {
  'use strict';
  try { var t = localStorage.getItem('fale-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) {}
  // text size + simple view (js/simple.js) before the first paint – no flash of the normal size on slow devices
  try {
    var ts = localStorage.getItem('fale-textsize');
    if (ts === 'l' || ts === 'xl') document.documentElement.classList.add('ts-' + ts);
    if (localStorage.getItem('fale-simple') === '1') document.documentElement.classList.add('simple');
  } catch (e) {}
  try {
    // same rule as js/i18n/index.js deviceLang(): first device language we have, else English
    var LANGS = ['de', 'en', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'tr', 'uk', 'ru', 'zh']; // = LANGS in js/i18n/index.js
    var l = localStorage.getItem('fale-lang');
    if (LANGS.indexOf(l) < 0) {
      l = 'en';
      var nl = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'de'];
      for (var i = 0; i < nl.length; i++) {
        var b = String(nl[i]).toLowerCase().split(/[-_]/)[0];
        if (b === 'in') b = 'id';
        if (LANGS.indexOf(b) >= 0) { l = b; break; }
      }
    }
    document.documentElement.lang = l;
    // translated languages: hide the German first paint until js/i18n has translated it (max. 300 ms)
    if (l !== 'de') { document.documentElement.classList.add('i18n-hold'); setTimeout(function () { document.documentElement.classList.remove('i18n-hold'); }, 300); }
  } catch (e) {}

  // "Install as an app" (web build): the browser's install event can fire before the app module has loaded –
  // keep it for js/install.js. The native apps never get this event.
  try { window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); window.__faleInstallEvt = e; }); } catch (e) {}

  // ---------------------------------------------------------------- Trusted Types
  var TT = window.trustedTypes;
  if (!TT || typeof TT.createPolicy !== 'function') return;
  var internal, inertDoc;
  try {
    // only for the inert parse inside the sanitizer below (template content never runs or loads anything)
    internal = TT.createPolicy('fale-internal', { createHTML: function (s) { return s; } });
  } catch (e) { return; } // policy already defined (e.g. script loaded twice)

  var BAD_TAGS = { SCRIPT: 1, IFRAME: 1, FRAME: 1, FRAMESET: 1, OBJECT: 1, EMBED: 1, APPLET: 1, BASE: 1, META: 1, NOSCRIPT: 1, MATH: 1, PORTAL: 1, FENCEDFRAME: 1 };
  var URL_ATTRS = { href: 1, src: 1, action: 1, formaction: 1, 'xlink:href': 1, data: 1, poster: 1, background: 1, cite: 1, ping: 1, srcset: 1, lowsrc: 1, dynsrc: 1, codebase: 1 };
  // anything that MIGHT be active content takes the slow path (false positives only cost a parse)
  var SUSPICIOUS = /<\s*\/?\s*(script|iframe|i?frame|frameset|object|embed|applet|base|meta|noscript|math|portal|fencedframe|animate|set|handler|listener)\b|[\s"'\/]on[a-z]+\s*=|(java|vb)script\s*:|data\s*:\s*(text|application)|srcdoc|&#|&(tab|newline|colon);/i;
  var BAD_URL = /^(?:javascript|vbscript|data:(?!image\/(?:png|jpe?g|gif|webp|bmp|avif|x-icon|svg\+xml)[;,])|blob:(?!https?:))/i;

  function cleanUrl(v) { return String(v || '').replace(/[\u0000-\u0020\u007f-\u009f]+/g, '').toLowerCase(); }
  function scrub(node) {
    var els = node.querySelectorAll('*');
    for (var i = els.length - 1; i >= 0; i--) {
      var el = els[i];
      var tag = String(el.tagName || '').toUpperCase();
      if (BAD_TAGS[tag]) { el.remove(); continue; }
      if ((tag === 'ANIMATE' || tag === 'SET' || tag === 'ANIMATEMOTION' || tag === 'ANIMATETRANSFORM') && /href|xlink/i.test(el.getAttribute('attributeName') || '')) { el.remove(); continue; }
      var attrs = el.attributes;
      for (var j = attrs.length - 1; j >= 0; j--) {
        var n = attrs[j].name.toLowerCase();
        if (n.slice(0, 2) === 'on' || n === 'srcdoc' || n === 'formaction') { el.removeAttribute(attrs[j].name); continue; }
        if (URL_ATTRS[n] && BAD_URL.test(cleanUrl(attrs[j].value))) el.removeAttribute(attrs[j].name);
      }
      if (tag === 'TEMPLATE' && el.content) scrub(el.content);
    }
  }
  function sanitize(html) {
    if (!inertDoc) inertDoc = document.implementation.createHTMLDocument('');
    var tpl = inertDoc.createElement('template');
    tpl.innerHTML = internal.createHTML(html);
    scrub(tpl.content);
    if (window.__faleTT) window.__faleTT.sanitized++;
    return tpl.innerHTML;
  }
  // the iPhone app is served from capacitor://localhost (WKWebView custom scheme; its URL origin can be "null")
  var APP_SCHEME = location.protocol === 'capacitor:';
  var APP_BASE = location.protocol + '//' + location.host + '/';
  function sameOriginScript(u) {
    var url;
    try { url = new URL(String(u), document.baseURI); } catch (e) { return null; }
    if (url.protocol === 'blob:' && url.href.indexOf('blob:' + location.origin + '/') === 0) return String(u);
    if (url.origin === location.origin && (url.protocol === 'https:' || url.protocol === 'http:')) return String(u);
    if (APP_SCHEME && url.protocol === 'blob:' && url.href.indexOf('blob:' + APP_BASE) === 0) return String(u);
    if (APP_SCHEME && url.href.indexOf(APP_BASE) === 0) return String(u); // own app files (pdf.js / OCR workers)
    return null; // → TypeError, the script/worker is not loaded
  }
  try {
    window.__faleTT = { sanitized: 0 };
    TT.createPolicy('default', {
      // (value, 'TrustedHTML', sink): DOMParser documents are inert (no scripts, no loads) and are used for
      // XML/HTML data extraction only – they pass unchanged so .docx/.xlsx XML is never altered
      createHTML: function (s, type, sink) {
        s = String(s);
        if (/DOMParser/i.test(String(sink || type || ''))) return s;
        return SUSPICIOUS.test(s) ? sanitize(s) : s;
      },
      createScriptURL: sameOriginScript,
      createScript: function () { return null; }, // no eval / new Function / setTimeout(string)
    });
  } catch (e) {}

  // ---------------------------------------------------------------- compat (older WebViews)
  try {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any !== 'function') {
      AbortSignal.any = function (signals) {
        var ctrl = new AbortController();
        var list = Array.prototype.slice.call(signals || []);
        for (var i = 0; i < list.length; i++) if (list[i].aborted) { ctrl.abort(list[i].reason); return ctrl.signal; }
        var onAbort = function (ev) {
          ctrl.abort(ev && ev.target ? ev.target.reason : undefined);
          for (var j = 0; j < list.length; j++) list[j].removeEventListener('abort', onAbort);
        };
        for (var k = 0; k < list.length; k++) list[k].addEventListener('abort', onAbort);
        return ctrl.signal;
      };
    }
    if (typeof ReadableStream !== 'undefined' && typeof Symbol !== 'undefined' && !ReadableStream.prototype[Symbol.asyncIterator]) {
      var streamValues = function (opts) {
        var reader = this.getReader();
        var keep = !!(opts && opts.preventCancel);
        var it = {
          next: function () { return reader.read().then(function (r) { if (r.done) reader.releaseLock(); return r; }); },
          'return': function (v) {
            return (keep ? Promise.resolve() : reader.cancel(v)).then(function () { reader.releaseLock(); return { done: true, value: v }; });
          },
        };
        it[Symbol.asyncIterator] = function () { return it; };
        return it;
      };
      Object.defineProperty(ReadableStream.prototype, 'values', { value: streamValues, configurable: true, writable: true });
      Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, { value: streamValues, configurable: true, writable: true });
    }
  } catch (e) {}
})();
