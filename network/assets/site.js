/* FaleNetwork site script – loaded synchronously in <head> (tiny, same-origin only).
 * 1. Applies the saved colour theme before first paint.
 * 2. Wires the theme button and the FaLe-Konto links once the DOM is ready.
 * No tracking, no cookies; localStorage holds only the theme choice ("fale-theme").
 */
(function () {
  'use strict';

  /* ---- Single place for network-wide settings ------------------------------
   * kontoUrl:       sign-in page of the FaLe-Konto (lives inside FaLe PDF for now).
   *                 After the domain move: https://pdf.fale.network/#/konto
   * kontoAvailable: set to true once the FaLe-Konto is live – this reveals every
   *                 element marked [data-konto-signin] and hides [data-konto-soon].
   */
  var FALE_CONFIG = {
    kontoUrl: 'https://fale-pdf.vercel.app/#/konto',
    kontoAvailable: false
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

    var links = document.querySelectorAll('[data-konto-link]');
    for (var j = 0; j < links.length; j++) links[j].setAttribute('href', FALE_CONFIG.kontoUrl);
    if (FALE_CONFIG.kontoAvailable) {
      var on = document.querySelectorAll('[data-konto-signin]');
      for (var k = 0; k < on.length; k++) on[k].hidden = false;
      var off = document.querySelectorAll('[data-konto-soon]');
      for (var m = 0; m < off.length; m++) off[m].hidden = true;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
