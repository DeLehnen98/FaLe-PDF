// Trusted Types for the tool pages (CSP: require-trusted-types-for 'script'; trusted-types default).
// The tools never build HTML from strings (the DOM is created with lib/dom.js), so the default policy
// only has to vouch for script URLs: workers (pdf.js), the service worker and module scripts. They must
// be same-origin (or a blob: URL created by this page). Anything else – HTML strings, string-to-code –
// has no handler and is therefore refused by the browser.
const TT = globalThis.trustedTypes;
if (TT && typeof TT.createPolicy === 'function' && !TT.defaultPolicy) {
  try {
    TT.createPolicy('default', {
      createScriptURL(value) {
        const url = new URL(String(value), document.baseURI);
        if (url.origin === location.origin && (url.protocol === 'https:' || url.protocol === 'http:')) return url.href;
        if (url.protocol === 'blob:' && url.href.startsWith(`blob:${location.origin}/`)) return url.href;
        throw new TypeError('Blocked script URL: ' + url.origin);
      },
    });
  } catch { /* a policy with this name exists already */ }
}
export {};
