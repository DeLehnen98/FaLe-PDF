// Language switch of the static legal pages (datenschutz.html, impressum.html) – external file so the
// pages need no inline script (Content-Security-Policy: script-src 'self').
// Language of the legal page (same setting as the app: fale-lang = auto | de | en; Automatisch = device language).
(function () {
  var l = null;
  try { l = localStorage.getItem('fale-lang'); } catch (e) {}
  var q = /[?&]lang=(de|en)\b/.exec(location.search); if (q) l = q[1];
  if (l !== 'de' && l !== 'en') {
    l = 'en';
    var nl = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'de'];
    for (var i = 0; i < nl.length; i++) { if (/^de\b/i.test(nl[i])) { l = 'de'; break; } if (/^en\b/i.test(nl[i])) break; }
  }
  var mains = document.querySelectorAll('main[data-lang]');
  var has = false;
  for (var j = 0; j < mains.length; j++) if (mains[j].getAttribute('data-lang') === l) has = true;
  if (!has) return;
  for (var k = 0; k < mains.length; k++) mains[k].hidden = mains[k].getAttribute('data-lang') !== l;
  document.documentElement.lang = l;
  var shown = document.querySelector('main[data-lang="' + l + '"]');
  if (shown && shown.getAttribute('data-title')) document.title = shown.getAttribute('data-title') + ' – FaLe PDF';
})();
