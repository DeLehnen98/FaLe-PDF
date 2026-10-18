// pdf.fale.network start page. Runs first (in <head>):
//  1. Old links into the app (shared files #/s/…, signature requests #/u/…, upload requests #/r/…, account and
//     sign-in callbacks) used to point at "/" – they belong to the app, which now lives at /app/.
//  2. An app service worker that was installed for "/" (before the app moved) would keep showing the old app here.
//  3. Store buttons (android, ios, windows): /site/stores.json (written by scripts/vercel-build.mjs from network/tools/apps.json).
//  4. The download button for Windows/Mac names the visitor's system.
(function () {
  'use strict';
  var h = location.hash || '', q = location.search || '';
  // app routes are "#/…"; sign-in callbacks carry tokens in the hash – plain anchors (#computer, #fragen) stay here
  var appHash = /^#\//.test(h) || /^#.*\b(access_token|refresh_token|error|error_description|type|code|token)=/.test(h);
  if (appHash || /[?&](code|token|access_token|error|error_description|type)=/.test(q)) {
    location.replace('/app/' + q + h);
    return;
  }
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      navigator.serviceWorker.getRegistrations().then(function (regs) {
        regs.forEach(function (r) { if (r.scope === location.origin + '/') r.unregister(); });
      }).catch(function () {});
    }
  } catch (e) { /* no service workers here */ }
  function stores() {
    fetch('/site/stores.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (s) {
      if (!s) return;
      document.querySelectorAll('[data-store]').forEach(function (el) {
        var url = s[el.getAttribute('data-store')];
        if (!url || !/^https:\/\//.test(url)) return;
        var a = document.createElement('a');
        a.className = 'store';
        a.href = url;
        a.rel = 'noopener';
        var sm = document.createElement('small'); sm.textContent = el.querySelector('small').textContent;
        var sp = document.createElement('span'); sp.textContent = el.getAttribute('data-ready');
        a.append(sm, sp);
        el.replaceWith(a);
      });
    }).catch(function () {});
  }
  // "Herunterladen" (→ /app/?install=1, the app offers the install there): name the computer's system on the button
  function download() {
    var u = navigator.userAgent || '', os = '';
    if (/iPhone|iPad|iPod|Android/.test(u) || (/Macintosh/.test(u) && navigator.maxTouchPoints > 1)) return;
    if (/Windows/.test(u)) os = 'windows';
    else if (/Macintosh|Mac OS X/.test(u)) os = 'mac';
    if (!os) return;
    document.querySelectorAll('[data-dl]').forEach(function (a) {
      var t = a.getAttribute('data-dl-' + os);
      if (t) a.textContent = t;
    });
  }
  function fan() {
    var f = document.querySelector('.fan');
    if (!f) return;
    f.classList.add('closed');
    requestAnimationFrame(function () { requestAnimationFrame(function () { f.classList.remove('closed'); }); });
  }
  document.addEventListener('DOMContentLoaded', function () { stores(); download(); fan(); });
})();
