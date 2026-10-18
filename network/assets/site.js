/* FaleNetwork site script – loaded synchronously in <head> (tiny, same-origin only).
 * 1. Applies the saved colour theme before first paint.
 * 2. Wires the theme button and the FaLe-Konto links once the DOM is ready.
 * No tracking, no cookies; localStorage holds only the theme choice ("fale-theme").
 */
(function () {
  'use strict';

  /* ---- 0. Language: the site follows the device language – there is no switch. German devices get the German
   * pages, every other language the English ones (the site exists in de + en). The other version of a page is
   * the <link rel="alternate" hreflang> in <head> (above this script). Crawlers are never redirected (each version
   * is indexed through hreflang), automated test browsers only when they ask for it. */
  try {
    var ua = navigator.userAgent || '';
    var test = false;
    try { test = localStorage.getItem('fale-lang-test-redirect') === '1'; } catch (e) { /* storage blocked */ }
    if (!/bot|crawl|spider|slurp|duckduck|baidu|yandex|facebookexternalhit|embedly|lighthouse|preview/i.test(ua) && (!navigator.webdriver || test)) {
      var langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'de'];
      var want = 'en';
      for (var li = 0; li < langs.length; li++) {
        var base = String(langs[li]).toLowerCase().split(/[-_]/)[0];
        if (base === 'de' || base === 'en') { want = base; break; }
      }
      var pageLang = (document.documentElement.lang || 'de').toLowerCase().slice(0, 2);
      var alt = want !== pageLang && document.querySelector('link[rel="alternate"][hreflang="' + want + '"]');
      if (alt) {
        var target = new URL(alt.getAttribute('href'), location.href).pathname;
        if (target !== location.pathname) location.replace(target + location.search + location.hash);
      }
    }
  } catch (e) { /* stay on this page */ }

  /* ---- Single place for network-wide settings ------------------------------
   * kontoUrl:       sign-in page of the FaLe-Konto (lives inside FaLe PDF for now).
   *                 Written by tools/build_pages.py from PDF_ORIGIN – change it there, not here.
   * kontoAvailable: set to true once the FaLe-Konto is live – this reveals every
   *                 element marked [data-konto-signin] and hides [data-konto-soon].
   */
  var FALE_CONFIG = {
    kontoUrl: 'https://pdf.fale.network/app/#/konto',
    kontoAvailable: true
  };
  window.FALE_CONFIG = FALE_CONFIG;

  var KEY = 'fale-theme';
  var root = document.documentElement;
  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function save(v) { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (e) { /* private mode */ } }
  function systemDark() { return !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); }
  function isDark() { var t = root.getAttribute('data-theme'); return t ? t === 'dark' : systemDark(); }

  var initial = stored();
  if (initial === 'light' || initial === 'dark') root.setAttribute('data-theme', initial);

  function syncButtons() {
    var dark = isDark();
    var btns = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      b.setAttribute('aria-pressed', String(dark));
      var label = dark ? b.getAttribute('data-label-light') : b.getAttribute('data-label-dark');
      if (label) { b.setAttribute('aria-label', label); b.setAttribute('title', label); }
    }
  }

  function ready() {
    var btns = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].hidden = false;
      btns[i].addEventListener('click', function () {
        var next = isDark() ? 'light' : 'dark';
        // Going back to what the system prefers clears the override.
        if ((next === 'dark') === systemDark()) { root.removeAttribute('data-theme'); save(null); }
        else { root.setAttribute('data-theme', next); save(next); }
        syncButtons();
      });
    }
    syncButtons();
    if (window.matchMedia) {
      var mq = matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', syncButtons);
    }

    // The "Mehr" menu in the header is a plain <details> (works without JS); here it only learns to close
    // on a tap outside, on Escape and after picking a link.
    var menus = document.querySelectorAll('[data-nav-more]');
    if (menus.length) {
      document.addEventListener('click', function (ev) {
        var inside = ev.target.closest ? ev.target.closest('[data-nav-more]') : null;
        for (var n = 0; n < menus.length; n++) if (menus[n] !== inside) menus[n].open = false;
        if (inside && ev.target.closest('a')) inside.open = false;
      });
      document.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Escape') return;
        for (var n = 0; n < menus.length; n++) {
          if (menus[n].open) { menus[n].open = false; menus[n].querySelector('summary').focus(); }
        }
      });
    }

    var links = document.querySelectorAll('[data-konto-link]');
    for (var j = 0; j < links.length; j++) links[j].setAttribute('href', FALE_CONFIG.kontoUrl);
    if (FALE_CONFIG.kontoAvailable) {
      var on = document.querySelectorAll('[data-konto-signin]');
      for (var k = 0; k < on.length; k++) on[k].hidden = false;
      var off = document.querySelectorAll('[data-konto-soon]');
      for (var m = 0; m < off.length; m++) off[m].hidden = true;
    }
  }

  // "share this site" buttons (support page): system share sheet, else copy the link
  function shareButtons() {
    var btns = document.querySelectorAll('[data-share-url]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var b = this, u = b.getAttribute('data-share-url'), text = b.getAttribute('data-share-text') || '';
        function copied() { var old = b.textContent; b.textContent = b.getAttribute('data-share-done') || old; setTimeout(function () { b.textContent = old; }, 2200); }
        if (navigator.share) { navigator.share({ title: document.title, text: text, url: u }).catch(function () {}); return; }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(copied, function () { b.textContent = u; });
        else b.textContent = u;   // no clipboard: show the address to copy by hand
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', shareButtons); else shareButtons();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
