// Runs inside the frame of a FaleNetwork web tool in the app (wt-app/<lang>/<id>.html, classic script in <head>,
// before the tool's shell). It connects the tool to the app that hosts it (js/webtools/host.js):
//   - globalThis.faleWtHost: results are saved into the app's file library / shared with the system share sheet
//     (network/assets/wt/lib/download.js uses it), no service worker, no support links (lib/sw.js, support-nudge.js)
//   - „Aus meinen Dateien“: a chip next to the file picker opens the app's library; the chosen files are passed
//     to the tool's shell with the event 'fale-wt-files'
//   - theme (light/dark) follows the app; links to other tools stay inside the app, other links open outside
// Opened on its own (not in the app's frame), the page works like the website tool and this script does nothing.
(function () {
  'use strict';
  var hostWin = null, host = null;
  try {
    if (window.parent && window.parent !== window && window.parent.location.origin === location.origin) {
      hostWin = window.parent;
      host = hostWin.__faleWtHost || null;
    }
  } catch (e) { host = null; }
  if (!host) return;

  var lang = document.documentElement.lang === 'en' ? 'en' : 'de';
  var T = function (de, en) { return lang === 'en' ? en : de; };

  // ---- theme of the app
  try {
    var theme = hostWin.document.documentElement.dataset.theme;
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  } catch (e) { /* default: follows the system */ }

  // ---- bridge (outputs are copied into the app's realm by the host)
  globalThis.faleWtHost = Object.freeze({
    save: function (outputs) { return host.save(outputs); },
    share: function (outputs, title) { return host.share(outputs, title); },
    canShare: function () { return !!host.canShare(); },
  });

  // ---- links: tools → app frame; everything else outside the app (or not at all)
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a || ev.defaultPrevented) return;
    var href = a.getAttribute('href') || '';
    if (/^(blob:|data:|#)/.test(href)) return; // downloads of object URLs / in-page anchors stay as they are
    var url;
    try { url = new URL(href, location.href); } catch (e) { return; }
    ev.preventDefault();
    if (url.origin === location.origin) {
      var m = url.pathname.match(/^\/(?:werkzeuge|en\/tools)\/([a-z0-9-]+)\/?$/);
      if (m) host.openTool(m[1]);
      else if (/^\/wt-app\/(de|en)\/[a-z0-9-]+\.html$/.test(url.pathname)) location.replace(url.pathname + url.search);
      return;
    }
    if (/^(https?|mailto|tel):$/.test(url.protocol)) host.openExternal(url.href);
  }, true);

  // ---- „Aus meinen Dateien“ next to the file picker
  function readConfig() {
    try { return JSON.parse(document.getElementById('wt-config').textContent); } catch (e) { return null; }
  }
  function svgIcon() {
    var NS = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(NS, 'svg');
    [['viewBox', '0 0 24 24'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '2'], ['stroke-linecap', 'round'],
      ['stroke-linejoin', 'round'], ['aria-hidden', 'true'], ['focusable', 'false']].forEach(function (kv) { s.setAttribute(kv[0], kv[1]); });
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z');
    s.appendChild(p);
    return s;
  }
  function addLibraryChip() {
    var cfg = readConfig();
    var pick = document.querySelector('[data-wt-pick]');
    var chips = pick && pick.querySelector('.wt-chips');
    if (!cfg || !chips || pick.hidden || !(cfg.minFiles > 0)) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'wt-chipbtn wt-app-lib';
    b.setAttribute('data-wt-library', '');
    var label = document.createElement('span');
    label.textContent = T('Aus meinen Dateien', 'From my files');
    b.append(svgIcon(), label);
    b.addEventListener('click', function () {
      b.disabled = true;
      Promise.resolve(host.pickDocs({ accepts: cfg.accepts, multiple: !!cfg.multiple, title: cfg.name }))
        .then(function (list) {
          if (!list || !list.length) return;
          var files = list.map(function (x) { return new File([x.buffer], x.name, { type: x.type || '' }); });
          window.dispatchEvent(new CustomEvent('fale-wt-files', { detail: { files: files } }));
        })
        .catch(function (e) { console.warn('FaLe: Dateien aus der App', e); })
        .then(function () { b.disabled = false; });
    });
    chips.prepend(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addLibraryChip);
  else addLibraryChip();

  if (host.frameReady) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { host.frameReady(window); });
    else host.frameReady(window);
  }
})();
