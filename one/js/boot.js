// FaLe One – first (classic) script. Runs before the app module so the CSP can forbid ALL inline script:
//   1. theme before the first paint (no flash)
//   2. Trusted Types (CSP: require-trusted-types-for 'script'). The app itself never assigns HTML strings
//      (it builds DOM nodes), so the "default" policy only has to cover third-party code (pdf.js):
//      HTML is passed through DOMPurify (vendored, loaded before this file), script URLs must be
//      same-origin, and string-to-code (eval & co.) is refused.
(function () {
  'use strict';
  try { var t = localStorage.getItem('fale-one-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) {}
  var TT = window.trustedTypes;
  if (!TT || typeof TT.createPolicy !== 'function') return;
  try {
    TT.createPolicy('default', {
      createHTML: function (s) {
        var P = window.DOMPurify;
        if (!s) return '';
        if (P && P.sanitize) return P.sanitize(String(s), { RETURN_TRUSTED_TYPE: false, FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed', 'base', 'meta', 'link'] });
        throw new TypeError('HTML assignment blocked');
      },
      createScriptURL: function (s) {
        var u = new URL(String(s), document.baseURI);
        if (u.origin === location.origin) return u.href;
        throw new TypeError('script URL blocked: ' + u.origin);
      },
      createScript: function () { throw new TypeError('string-to-code blocked'); },
    });
  } catch (e) { /* policy exists already */ }
})();
