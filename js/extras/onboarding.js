// Kurze Einführung beim ersten Start (4 Schritte, überspringbar, nur einmal). Schritt 3 fragt nach der Ansicht:
// „Einfach“ (große Kacheln, js/simple.js) oder „Alle Funktionen“ – und nach der Schriftgröße (Normal / Groß /
// Sehr groß). Beides gilt sofort und ist jederzeit in Ich → Einstellungen änderbar.
import { $, $$, h } from '../ui.js';
import { oicon } from '../office/kinds.js';
import { applyTheme, currentTheme } from '../theme.js';
import { logo } from '../icons.js';
import { langSelectHtml } from '../i18n/index.js';
import { simpleOn, setSimple, dismissSimpleHint, textSizeSeg, bindTextSize } from '../simple.js';

const KEY = 'fale-onboarded';
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

export function onboardingDone() { return ls.get(KEY) === '1'; }
export function resetOnboarding() { try { localStorage.removeItem(KEY); } catch {} }

export function maybeShowOnboarding() {
  if (onboardingDone()) return false;
  // automated test browsers skip the intro unless a test explicitly asks for it
  if (navigator.webdriver && ls.get('fale-onboarding-force') !== '1') return false;
  if (location.hash && !/^#\/(start)?$/.test(location.hash)) return false; // opened via a deep link / shared file
  showOnboarding();
  return true;
}

export function showOnboarding() {
  if (document.querySelector('.onboard')) return;
  let step = 0, sawViews = false;
  const ov = h(`<div class="onboard" role="dialog" aria-modal="true" aria-labelledby="ob-title">
    <div class="ob-card">
      <button class="ob-skip btn btn-ghost btn-sm" type="button" data-skip>Überspringen</button>
      <div class="ob-steps">
        <section class="ob-step" data-step="0">
          <div class="ob-art ob-art-1"><span class="ob-logo">${logo(56)}</span><span class="ob-f f1">${oicon('kpdf')}</span><span class="ob-f f2">${oicon('kdoc')}</span><span class="ob-f f3">${oicon('ksheet')}</span><span class="ob-f f4">${oicon('kslides')}</span></div>
          <h2 id="ob-title">Willkommen bei FaLe</h2>
          <p>PDFs lesen, unterschreiben und bearbeiten, Dokumente, Tabellen und Präsentationen erstellen – und Alltagsbriefe wie Kündigungen in einer Minute schreiben.</p>
          <ul class="ob-list"><li>${oicon('check')} Alle Pro-Funktionen gratis</li><li>${oicon('check')} Fristen im Blick, Dateien im Tresor</li><li>${oicon('check')} Funktioniert auch offline</li></ul>
          <label class="ob-lang" style="display:flex;align-items:center;justify-content:center;gap:10px;margin-top:14px;flex-wrap:wrap"><span class="muted" style="white-space:nowrap">Sprache / Language</span>${langSelectHtml()}</label>
        </section>
        <section class="ob-step" data-step="1" hidden>
          <div class="ob-art ob-art-2"><span class="ob-shield">${oicon('shield')}</span></div>
          <h2>Deine Dateien gehören dir</h2>
          <p>Kein Konto, kein Tracking. Alles, was du öffnest oder erstellst, bleibt auf diesem Gerät. Nur wenn du die optionale Cloud-KI nutzt, wird der dafür nötige Text verarbeitet – und Werbung gibt es nur freiwillig, gegen Extra-KI-Anfragen.</p>
          <ul class="ob-list"><li>${oicon('lock')} Privater Tresor mit eigener PIN</li><li>${oicon('cloud')} Nichts verlässt dein Gerät – außer du teilst es selbst</li><li>${oicon('heart')} Keine Abo-Fallen, keine Nerv-Banner</li></ul>
        </section>
        <section class="ob-step" data-step="2" hidden>
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
        <section class="ob-step" data-step="3" hidden>
          <div class="ob-art ob-art-3"><span class="ob-me">${oicon('person')}</span></div>
          <h2>Kurz einrichten <span class="muted ob-opt">(optional)</span></h2>
          <p>Wie soll FaLe aussehen?</p>
          <div class="seg ob-theme" role="group" aria-label="Erscheinungsbild"><button type="button" data-theme-opt="auto">Automatisch</button><button type="button" data-theme-opt="light">Hell</button><button type="button" data-theme-opt="dark">Dunkel</button></div>
          <p class="ob-p2">Mit deinem Profil füllt FaLe Absender in Briefen und Formularen automatisch aus – gespeichert nur hier.</p>
          <button class="btn btn-soft" type="button" data-profile>${oicon('person')} Profil ausfüllen</button>
        </section>
      </div>
      <div class="ob-foot">
        <div class="ob-dots" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
        <div class="ob-btns"><button class="btn btn-ghost" type="button" data-back hidden>Zurück</button><button class="btn btn-primary" type="button" data-next>Weiter</button></div>
      </div>
    </div></div>`);
  document.body.appendChild(ov);
  const steps = $$('.ob-step', ov), dots = $$('.ob-dots span', ov);
  const next = $('[data-next]', ov), back = $('[data-back]', ov);
  const paint = () => {
    steps.forEach((s, i) => { s.hidden = i !== step; });
    dots.forEach((d, i) => d.classList.toggle('on', i === step));
    back.hidden = step === 0;
    next.textContent = step === steps.length - 1 ? 'Los geht’s' : 'Weiter';
    $$('[data-theme-opt]', ov).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeOpt === currentTheme())));
    $$('[data-view]', ov).forEach(b => { const sel = (b.dataset.view === 'simple') === simpleOn(); b.setAttribute('aria-checked', String(sel)); b.tabIndex = sel ? 0 : -1; });
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
  next.addEventListener('click', () => { if (step < steps.length - 1) { step++; paint(); } else close(); });
  back.addEventListener('click', () => { if (step > 0) { step--; paint(); } });
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
