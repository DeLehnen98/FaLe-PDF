// Kurze Einführung beim ersten Start (6 Schritte, überspringbar, nur einmal), jeder Schritt mit kleiner Animation:
// 1. Sprache (Begrüßungen in allen Sprachen; ein Tipp stellt FaLe sofort um – nötigenfalls mit Neuladen, die
//    Einführung geht dann an derselben Stelle weiter), 2. Willkommen, 3. Datenschutz,
// 4. Ansicht „Einfach“ (große Kacheln, js/simple.js) oder „Alle Funktionen“ + Schriftgröße,
// 5. Unterschrift einmal üben (freiwillig, wird für später gespeichert; entfällt, wenn schon eine da ist),
// 6. „Was möchtest du zuerst tun?“ (vier große Knöpfe führen direkt hin) + Aussehen, Profil, wo es Hilfe gibt.
// Alles gilt sofort und ist jederzeit in Ich → Einstellungen änderbar.
import { $, $$, h, toast } from '../ui.js';
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

const reveal = () => document.documentElement.classList.remove('ob-first'); // js/boot.js hid the app until the intro is up

export function maybeShowOnboarding() {
  if (onboardingDone()) return reveal(), false;
  // automated test browsers skip the intro unless a test explicitly asks for it
  if (navigator.webdriver && ls.get('fale-onboarding-force') !== '1') return reveal(), false;
  if (location.hash && !/^#\/(start)?$/.test(location.hash) && ls.get(RESUME) === null) return reveal(), false; // opened via a deep link / shared file
  showOnboarding({ first: true }).catch(e => { console.warn(e); reveal(); });
  return true;
}

export async function showOnboarding({ first = false } = {}) {
  if (document.querySelector('.onboard')) return;
  let hasSig = false;
  try { hasSig = (await (await import('../tools/sigstore.js')).listAssets('signature')).length > 0; } catch { /* no store */ }
  if (document.querySelector('.onboard')) return;
  const resume = +ls.get(RESUME) || 0;
  try { localStorage.removeItem(RESUME); } catch {}
  let step = Math.max(0, resume), sawViews = false, dir = resume ? 0 : 1;
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
          <ul class="ob-list"><li>${oicon('check')} Bearbeiten, Unterschreiben, Umwandeln</li><li>${oicon('check')} Fristen im Blick, Dateien im Tresor</li><li>${oicon('check')} Funktioniert auch offline</li></ul>
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
        ${hasSig ? '' : `<section class="ob-step ob-step-sig" data-step="4" hidden>
          <h2 class="ob-h-top">Unterschreib einmal zum Üben <span class="muted ob-opt">(freiwillig)</span></h2>
          <p>Mit dem Finger oder der Maus. FaLe merkt sich die Unterschrift – nur auf diesem Gerät – und setzt sie später mit einem Tipp ein.</p>
          <div class="sig-pad-wrap ob-pad"><canvas class="sig-pad" aria-label="Zeichenfläche"></canvas>
            <svg class="ob-sig-demo" viewBox="0 0 300 90" aria-hidden="true"><path d="M14 62c10-30 26-44 34-30 7 12-6 34 4 32 12-2 16-40 30-38 12 2 0 34 12 34 14 0 18-28 30-26 10 2 2 22 14 22 12 0 20-18 32-16 9 2 6 14 16 14 11 0 22-10 34-12M196 70c26-4 58-6 90-4"/></svg>
            <div class="sig-pad-line"></div><div class="sig-pad-hint">Hier unterschreiben</div></div>
          <div class="ob-sig-row"><button type="button" class="btn btn-ghost btn-sm" data-sig-clear>${oicon('undo')} Neu zeichnen</button><span class="ob-sig-ok" data-sig-ok hidden>${oicon('check')} Gespeichert</span></div>
        </section>`}
        <section class="ob-step ob-step-go" data-step="5" hidden>
          <h2 class="ob-h-top">Was möchtest du zuerst tun?</h2>
          <div class="ob-goals">
            <button type="button" class="ob-goal" data-action="open-file" data-goal="open">${oicon('upload')}<b>Datei öffnen</b><span>PDF, Word, Fotos</span></button>
            <button type="button" class="ob-goal" data-goal="#/werkzeug/scannen">${oicon('scan')}<b>Scannen</b><span>Papier mit der Kamera</span></button>
            <button type="button" class="ob-goal" data-goal="#/werkzeug/unterschreiben">${oicon('sign')}<b>Unterschreiben</b><span>Formulare ausfüllen</span></button>
            <button type="button" class="ob-goal" data-goal="#/schreiben">${oicon('letter')}<b>Brief schreiben</b><span>Kündigung, Widerspruch …</span></button>
          </div>
          <div class="ob-extra">
            <div class="seg ob-theme" role="group" aria-label="Erscheinungsbild"><button type="button" data-theme-opt="auto">Automatisch</button><button type="button" data-theme-opt="light">Hell</button><button type="button" data-theme-opt="dark">Dunkel</button></div>
            <button class="btn btn-soft btn-sm" type="button" data-profile>${oicon('person')} Profil ausfüllen</button>
          </div>
          <p class="ob-help">${oicon('search')} <span>Hilfe: Die Suche oben findet jede Funktion. Diese Einführung findest du wieder unter „Ich → Einstellungen“.</span></p>
        </section>
      </div>
      <div class="ob-foot">
        <div class="ob-dots" aria-hidden="true">${'<span></span>'.repeat(hasSig ? 5 : 6)}</div>
        <div class="ob-btns"><button class="btn btn-ghost" type="button" data-back hidden>Zurück</button><button class="btn btn-primary" type="button" data-next>Weiter</button></div>
      </div>
    </div></div>`);
  if (first) ov.classList.add('ob-first-run'); // very first start: nothing of the app behind the intro
  document.body.appendChild(ov);
  reveal();
  const steps = $$('.ob-step', ov), dots = $$('.ob-dots span', ov);
  const next = $('[data-next]', ov), back = $('[data-back]', ov);
  step = Math.min(step, steps.length - 1);
  // signature practice: the pad (js/tools/sigstore.js), a drawn demo until the first touch, saved when leaving the step
  let pad = null, sigSaved = false;
  const sigStep = $('.ob-step-sig', ov);
  if (sigStep) {
    import('../tools/sigstore.js').then(m => {
      pad = m.setupPad($('.ob-pad', sigStep), m.SIG_COLORS[0].c);
      pad.trim = c => m.trimCanvas(c, 8);
      pad.add = a => m.addAsset(a);
      $('canvas', sigStep).addEventListener('pointerdown', () => { sigStep.classList.add('ob-drawing'); $('[data-sig-ok]', sigStep).hidden = true; sigSaved = false; });
    }).catch(e => console.warn('Unterschrift', e));
    $('[data-sig-clear]', sigStep).addEventListener('click', () => { if (pad) pad.clear(); sigStep.classList.remove('ob-drawing'); sigSaved = false; $('[data-sig-ok]', sigStep).hidden = true; });
  }
  async function saveSig() {
    if (!pad || pad.isEmpty() || sigSaved) return false;
    sigSaved = true;
    try {
      const made = await pad.trim(pad.canvas);
      if (!made) return false;
      await pad.add({ blob: made.blob, kind: 'signature', name: 'Unterschrift', w: made.w, h: made.h });
      $('[data-sig-ok]', sigStep).hidden = false;
      return true;
    } catch (e) { console.warn('Unterschrift speichern', e); sigSaved = false; return false; }
  }
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
    if (steps[step] === sigStep && pad) requestAnimationFrame(() => pad.fit());
    setTimeout(() => next.focus(), 30);
  };
  const close = () => {
    if (sigStep) saveSig(); // drawn but skipped: still keep it
    ls.set(KEY, '1');
    if (sawViews) dismissSimpleHint(); // the view was chosen here – no extra hint card on the start screen
    ov.classList.add('closing');
    document.removeEventListener('keydown', onKey, true);
    setTimeout(() => ov.remove(), 180);
  };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey, true);
  next.addEventListener('click', async () => {
    if (steps[step] === sigStep && await saveSig()) toast('Unterschrift gespeichert – du findest sie beim Unterschreiben.', 'success');
    if (step < steps.length - 1) { step++; dir = 1; paint(); } else close();
  });
  // „Was möchtest du zuerst tun?“: close and go there (Datei öffnen: the app's own picker via data-action)
  $$('[data-goal]', ov).forEach(b => b.addEventListener('click', () => {
    close();
    if (b.dataset.goal.startsWith('#/')) location.hash = b.dataset.goal;
  }));
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
