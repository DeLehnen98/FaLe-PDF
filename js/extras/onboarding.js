// Kurze Einführung beim ersten Start (5 Schritte, überspringbar, nur einmal), jeder Schritt mit kleiner Animation:
// 1. Sprache (Begrüßungen in allen Sprachen; ein Tipp stellt FaLe sofort um – nötigenfalls mit Neuladen, die
//    Einführung geht dann an derselben Stelle weiter), 2. Willkommen, 3. Datenschutz,
// 4. Ansicht „Einfach“ (große Kacheln, js/simple.js) oder „Alle Funktionen“ + Schriftgröße, 5. Aussehen + Profil.
// Alles gilt sofort und ist jederzeit in Ich → Einstellungen änderbar.
import { $, $$, h } from '../ui.js';
import { oicon } from '../office/kinds.js';
import { applyTheme, currentTheme } from '../theme.js';
import { logo } from '../icons.js';
import { simpleOn, setSimple, dismissSimpleHint, textSizeSeg, bindTextSize } from '../simple.js';
import { LANGS, LANG_NAMES, HELLO, lang, deviceLang, getLangSetting, setLang } from '../i18n/index.js';

const KEY = 'fale-onboarded';
const RESUME = 'fale-onboarding-step'; // the step to continue with after the page reloaded for a new language


/** Pick a language: the device language means „follow the device“ (setting 'auto'). Reloads when needed. */
export function chooseLang(code) {
  return setLang(code === deviceLang() ? 'auto' : code);
}
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

export function onboardingDone() { return ls.get(KEY) === '1'; }
export function resetOnboarding() { try { localStorage.removeItem(KEY); } catch {} }

export function maybeShowOnboarding() {
  if (onboardingDone()) return false;
  // automated test browsers skip the intro unless a test explicitly asks for it
  if (navigator.webdriver && ls.get('fale-onboarding-force') !== '1') return false;
  if (location.hash && !/^#\/(start)?$/.test(location.hash) && ls.get(RESUME) === null) return false; // opened via a deep link / shared file
  showOnboarding();
  return true;
}

export function showOnboarding() {
  if (document.querySelector('.onboard')) return;
  const resume = +ls.get(RESUME) || 0;
  try { localStorage.removeItem(RESUME); } catch {}
  let step = Math.max(0, Math.min(4, resume)), sawViews = false, dir = resume ? 0 : 1;
  const cur = lang(), dev = deviceLang();
  const langBtns = [dev, ...LANGS.filter(c => c !== dev)].map(c => `<button type="button" class="ob-lang" role="radio" data-lang="${c}" lang="${c}" aria-checked="${c === cur}">
      <span class="ob-lang-n" data-no-i18n>${LANG_NAMES[c]}</span>${c === dev ? '<span class="ob-lang-dev">Gerätesprache</span>' : ''}<span class="ob-lang-ok" aria-hidden="true">${oicon('check')}</span></button>`).join('');
  const hello = HELLO.map((w, i) => `<span class="ob-hi" style="--i:${i}" data-no-i18n>${w}</span>`).join('');
  const ov = h(`<div class="onboard" role="dialog" aria-modal="true" aria-labelledby="ob-title">
    <div class="ob-card">
      <button class="ob-skip btn btn-ghost btn-sm" type="button" data-skip>Überspringen</button>
      <div class="ob-steps">
        <section class="ob-step ob-step-lang" data-step="0">
          <div class="ob-art ob-art-lang" aria-hidden="true"><span class="ob-globe">${oicon('language')}</span>${hello}</div>
          <h2 id="ob-title">Wähle deine Sprache</h2>
          <p>FaLe stellt sich sofort um. Ändern kannst du sie jederzeit unter „Ich → Einstellungen“.</p>
          <div class="ob-langs" role="radiogroup" aria-label="Sprache">${langBtns}</div>
        </section>
        <section class="ob-step" data-step="1" hidden>
          <div class="ob-art ob-art-1"><span class="ob-logo">${logo(56)}</span><span class="ob-f f1">${oicon('kpdf')}</span><span class="ob-f f2">${oicon('kdoc')}</span><span class="ob-f f3">${oicon('ksheet')}</span><span class="ob-f f4">${oicon('kslides')}</span></div>
          <h2>Willkommen bei FaLe</h2>
          <p>PDFs lesen, unterschreiben und bearbeiten, Dokumente, Tabellen und Präsentationen erstellen – und Alltagsbriefe wie Kündigungen in einer Minute schreiben.</p>
          <ul class="ob-list"><li>${oicon('check')} Alle Pro-Funktionen gratis</li><li>${oicon('check')} Fristen im Blick, Dateien im Tresor</li><li>${oicon('check')} Funktioniert auch offline</li></ul>
        </section>
        <section class="ob-step" data-step="2" hidden>
          <div class="ob-art ob-art-2"><span class="ob-ring" aria-hidden="true"></span><span class="ob-shield">${oicon('shield')}</span><span class="ob-lockbadge" aria-hidden="true">${oicon('lock')}</span></div>
          <h2>Deine Dateien gehören dir</h2>
          <p>Kein Konto, kein Tracking. Alles, was du öffnest oder erstellst, bleibt auf diesem Gerät. Nur wenn du die optionale Cloud-KI nutzt, wird der dafür nötige Text verarbeitet – und Werbung gibt es nur freiwillig, gegen Extra-KI-Anfragen.</p>
          <ul class="ob-list"><li>${oicon('lock')} Privater Tresor mit eigener PIN</li><li>${oicon('cloud')} Nichts verlässt dein Gerät – außer du teilst es selbst</li><li>${oicon('heart')} Keine Abo-Fallen, keine Nerv-Banner</li></ul>
        </section>
        <section class="ob-step" data-step="3" hidden>
          <h2 class="ob-h-top">Wie möchtest du starten?</h2>
          <p>Du kannst das jederzeit unter „Ich → Einstellungen“ ändern. Die Suche findet immer alles.</p>
          <div class="ob-views" role="radiogroup" aria-label="Ansicht">
            <button type="button" class="ob-view" role="radio" data-view="simple">
              <span class="ob-mini ob-mini-simple" aria-hidden="true"><i class="w"></i><i></i><i></i><i></i><i></i></span>
              <span class="ob-view-t"><b>Einfach</b><span>Das Wichtigste in großen Kacheln: öffnen, scannen, unterschreiben, umwandeln</span></span>
            </button>
            <button type="button" class="ob-view" role="radio" data-view="full">
              <span class="ob-mini ob-mini-full" aria-hidden="true"><i class="w"></i><i class="r"></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
              <span class="ob-view-t"><b>Alle Funktionen</b><span>Alles auf einen Blick, mit Assistenten, KI und Vorlagen</span></span>
            </button>
          </div>
          <div class="ob-size"><span class="ob-size-l">Schriftgröße</span>${textSizeSeg('ob-ts')}</div>
        </section>
        <section class="ob-step" data-step="4" hidden>
          <div class="ob-art ob-art-3"><span class="ob-me">${oicon('person')}</span><span class="ob-form" aria-hidden="true"><i></i><i></i><i></i></span></div>
          <h2>Kurz einrichten <span class="muted ob-opt">(optional)</span></h2>
          <p>Wie soll FaLe aussehen?</p>
          <div class="seg ob-theme" role="group" aria-label="Erscheinungsbild"><button type="button" data-theme-opt="auto">Automatisch</button><button type="button" data-theme-opt="light">Hell</button><button type="button" data-theme-opt="dark">Dunkel</button></div>
          <p class="ob-p2">Mit deinem Profil füllt FaLe Absender in Briefen und Formularen automatisch aus – gespeichert nur hier.</p>
          <button class="btn btn-soft" type="button" data-profile>${oicon('person')} Profil ausfüllen</button>
        </section>
      </div>
      <div class="ob-foot">
        <div class="ob-dots" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
        <div class="ob-btns"><button class="btn btn-ghost" type="button" data-back hidden>Zurück</button><button class="btn btn-primary" type="button" data-next>Weiter</button></div>
      </div>
    </div></div>`);
  document.body.appendChild(ov);
  const steps = $$('.ob-step', ov), dots = $$('.ob-dots span', ov);
  const next = $('[data-next]', ov), back = $('[data-back]', ov);
  const paint = () => {
    steps.forEach((s, i) => {
      s.hidden = i !== step;
      s.classList.remove('ob-in-next', 'ob-in-back');
      if (i === step && dir) { void s.offsetWidth; s.classList.add(dir > 0 ? 'ob-in-next' : 'ob-in-back'); } // slide in from the side we move to
    });
    dots.forEach((d, i) => d.classList.toggle('on', i === step));
    back.hidden = step === 0;
    next.textContent = step === steps.length - 1 ? 'Los geht’s' : 'Weiter';
    $$('[data-theme-opt]', ov).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeOpt === currentTheme())));
    $$('[data-view]', ov).forEach(b => { const sel = (b.dataset.view === 'simple') === simpleOn(); b.setAttribute('aria-checked', String(sel)); b.tabIndex = sel ? 0 : -1; });
    $$('[data-lang]', ov).forEach(b => { b.tabIndex = b.getAttribute('aria-checked') === 'true' ? 0 : -1; });
    syncSize();
    if (steps[step].querySelector('[data-view]')) sawViews = true;
    setTimeout(() => next.focus(), 30);
  };
  const close = () => {
    ls.set(KEY, '1');
    if (sawViews) dismissSimpleHint(); // the view was chosen here – no extra hint card on the start screen
    ov.classList.add('closing');
    document.removeEventListener('keydown', onKey, true);
    setTimeout(() => ov.remove(), 180);
  };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey, true);
  next.addEventListener('click', () => { if (step < steps.length - 1) { step++; dir = 1; paint(); } else close(); });
  back.addEventListener('click', () => { if (step > 0) { step--; dir = -1; paint(); } });
  // language: one tap switches FaLe right away (a reload continues here, on the same step)
  const langs = $$('[data-lang]', ov);
  langs.forEach((b, i) => {
    b.addEventListener('click', async () => {
      langs.forEach(x => x.setAttribute('aria-checked', String(x === b)));
      const code = b.dataset.lang;
      if (code === lang() && (getLangSetting() === 'auto') === (code === dev)) return;
      ls.set(RESUME, String(step));
      try { await chooseLang(code); } catch (e) { console.warn('Sprache', e); }
      if (lang() === code) { try { localStorage.removeItem(RESUME); } catch {} } // switched in place – otherwise the page is reloading
      paint();
    });
    b.addEventListener('keydown', e => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      langs[(i + d + langs.length) % langs.length].focus();
    });
  });
  $('[data-skip]', ov).addEventListener('click', close);
  $('[data-profile]', ov).addEventListener('click', () => { close(); location.hash = '#/profil'; });
  $$('[data-theme-opt]', ov).forEach(b => b.addEventListener('click', () => {
    applyTheme(b.dataset.themeOpt);
    $$('[data-action="toggle-theme"]').forEach(t => { t.innerHTML = oicon(document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches) ? 'sun' : 'moon'); });
    paint();
  }));
  // a bigger text makes the step taller – keep the size buttons in view (the buttons below stay pinned)
  const syncSize = bindTextSize(ov, () => requestAnimationFrame(() => { const z = $('.ob-size', ov); if (z) z.scrollIntoView({ block: 'nearest' }); }));
  const views = $$('[data-view]', ov);
  views.forEach((b, i) => {
    b.addEventListener('click', () => { setSimple(b.dataset.view === 'simple'); paint(); setTimeout(() => b.focus(), 40); });
    b.addEventListener('keydown', e => { // radio group: arrow keys move and select
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      views[(i + d + views.length) % views.length].click();
    });
  });
  paint();
}
