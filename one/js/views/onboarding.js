// Onboarding / lock screens: sign in or create a FaLe-Konto (e-mail code), set or unlock the Sync-Passwort,
// show the recovery key ONCE with clear guidance.
import { el, clear, icon, logo, toast, saveBlob, errorText } from '../dom.js';
import { t } from '../i18n.js';
import * as A from '../auth.js';
import * as Keys from '../keys.js';
import { PRIVACY_URL, IMPRINT_URL } from '../config.js';

export function mount(root, { step, done, recovery }) {
  const wrap = el('div.gate');
  root.appendChild(wrap);
  const card = el('section.gate-card', { aria: { live: 'polite' } });
  wrap.append(el('div.gate-brand', logo(48), el('span.brand-name', 'FaLe ', el('b', 'One'))), card);
  wrap.append(el('p.gate-foot', el('a', { href: PRIVACY_URL, rel: 'noopener noreferrer', target: '_blank' }, t('Datenschutz')), ' · ', el('a', { href: IMPRINT_URL, rel: 'noopener noreferrer', target: '_blank' }, t('Impressum'))));
  const show = (...nodes) => { clear(card).append(...nodes); const f = card.querySelector('input'); if (f) setTimeout(() => f.focus(), 50); };
  const err = el('p.form-error', { role: 'alert', hidden: true });
  const fail = (e, fb) => { err.textContent = errorText(e, fb); err.hidden = false; };
  const busy = (btn, on, label) => { btn.disabled = on; if (label) btn.textContent = label; };
  let email = '';

  function welcome() {
    err.hidden = true;
    show(
      el('h1.gate-title', t('Deine Fotos und Dateien. Nur für dich lesbar.')),
      el('p.gate-lead', t('FaLe One verschlüsselt alles auf deinem Gerät, bevor es hochgeladen wird – Ende-zu-Ende. Nicht einmal wir können deine Fotos, Dateinamen oder Ortsdaten sehen.')),
      el('ul.gate-points',
        el('li', icon('cloudCheck'), t('Fotos sichern, Ordner und Dateien wie gewohnt')),
        el('li', icon('shield'), t('Kein Scannen, keine Werbung, kein Training mit deinen Daten')),
        el('li', icon('export'), t('Jederzeit alles exportieren – ohne FaLe-Werkzeug lesbar'))),
      el('button.btn.primary.block', { type: 'button', onclick: emailStep }, t('Anmelden oder Konto erstellen')),
      el('p.hint', t('Du hast schon ein FaLe-Konto (z. B. aus FaLe PDF)? Dann melde dich einfach mit derselben E-Mail an.'))
    );
  }
  function emailStep() {
    err.hidden = true;
    const input = el('input.input', { type: 'email', autocomplete: 'email', inputmode: 'email', required: true, placeholder: t('du@beispiel.de'), value: email, id: 'g-email' });
    const btn = el('button.btn.primary.block', { type: 'submit' }, t('Code senden'));
    const form = el('form.gate-form', { onsubmit: async e => {
      e.preventDefault(); err.hidden = true; busy(btn, true, t('Sende …'));
      try { const r = await A.sendCode(input.value); email = r.email; codeStep(); }
      catch (x) { fail(x); busy(btn, false, t('Code senden')); }
    } },
    el('label.field', { for: 'g-email' }, el('span.field-label', t('E-Mail-Adresse')), input), err, btn);
    show(el('h1.gate-title', t('Anmelden')), el('p.gate-lead', t('Wir schicken dir einen 6-stelligen Code. Ein Passwort fürs Konto brauchst du nicht – neue Adressen bekommen automatisch ein Konto.')), form,
      el('button.btn.ghost.block', { type: 'button', onclick: welcome }, t('Zurück')));
  }
  function codeStep() {
    err.hidden = true;
    const input = el('input.input.code', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 10, required: true, placeholder: '123456', id: 'g-code' });
    const btn = el('button.btn.primary.block', { type: 'submit' }, t('Anmelden'));
    const form = el('form.gate-form', { onsubmit: async e => {
      e.preventDefault(); err.hidden = true; busy(btn, true, t('Prüfe …'));
      try { await A.verifyCode(email, input.value); await keyStep(); }
      catch (x) { fail(x); busy(btn, false, t('Anmelden')); }
    } }, el('label.field', { for: 'g-code' }, el('span.field-label', t('Code aus der E-Mail')), input), err, btn);
    show(el('h1.gate-title', t('Code eingeben')), el('p.gate-lead', t('Wir haben einen Code an {email} geschickt. Er ist 10 Minuten gültig.', { email })), form,
      el('button.btn.ghost.block', { type: 'button', onclick: async () => { try { await A.sendCode(email); toast(t('Neuer Code ist unterwegs.')); } catch (x) { fail(x); } } }, t('Neuen Code senden')),
      el('button.btn.ghost.block', { type: 'button', onclick: emailStep }, t('Andere E-Mail-Adresse')));
  }
  async function keyStep() {
    err.hidden = true;
    show(el('p.gate-lead', t('Einen Moment …')));
    let st;
    try { st = await Keys.remoteStatus(); } catch (x) { show(el('h1.gate-title', t('Verbindung fehlt')), el('p.gate-lead', errorText(x)), el('button.btn.primary.block', { type: 'button', onclick: keyStep }, t('Erneut versuchen'))); return; }
    if (!st || !st.key) return setupStep();
    unlockStep();
  }
  function pwField(id, label, autocomplete) {
    const input = el('input.input', { type: 'password', id, autocomplete, minlength: Keys.MIN_PASSWORD, required: true });
    const toggle = el('button.icon-btn.sm.pw-eye', { type: 'button', aria: { label: t('Passwort anzeigen'), pressed: 'false' }, onclick: () => { const on = input.type === 'password'; input.type = on ? 'text' : 'password'; toggle.setAttribute('aria-pressed', String(on)); } }, icon('eye'));
    return { input, node: el('label.field', { for: id }, el('span.field-label', label), el('span.pw-wrap', input, toggle)) };
  }
  function setupStep() {
    err.hidden = true;
    const a = pwField('g-pw1', t('Sync-Passwort (mindestens {n} Zeichen)', { n: Keys.MIN_PASSWORD }), 'new-password');
    const b = pwField('g-pw2', t('Sync-Passwort wiederholen'), 'new-password');
    const meter = el('p.pw-meter', { aria: { live: 'polite' } });
    a.input.addEventListener('input', () => { const v = a.input.value; meter.textContent = !v ? '' : v.length < Keys.MIN_PASSWORD ? t('Noch zu kurz.') : v.length < 14 ? t('Gut. Länger ist noch sicherer – z. B. vier zufällige Wörter.') : t('Stark.'); });
    const btn = el('button.btn.primary.block', { type: 'submit' }, t('Sync-Passwort festlegen'));
    const form = el('form.gate-form', { onsubmit: async e => {
      e.preventDefault(); err.hidden = true;
      if (a.input.value !== b.input.value) { fail({ userMessage: t('Die beiden Passwörter stimmen nicht überein.') }); return; }
      busy(btn, true, t('Erzeuge Schlüssel …'));
      try { const rk = await Keys.setup(a.input.value); a.input.value = b.input.value = ''; recoveryStep(rk); }
      catch (x) { fail(x); busy(btn, false, t('Sync-Passwort festlegen')); if (x.code === 'exists') unlockStep(); }
    } }, a.node, meter, b.node, err, btn);
    show(el('h1.gate-title', t('Sync-Passwort festlegen')),
      el('p.gate-lead', t('Mit diesem Passwort entsperrst du deine verschlüsselten Daten auf jedem neuen Gerät. Es verlässt dein Gerät nie – wir kennen es nicht und können es nicht zurücksetzen.')),
      form);
  }
  function unlockStep(useRecovery = false) {
    err.hidden = true;
    let field;
    if (useRecovery) {
      const input = el('textarea.input.mono', { id: 'g-rk', rows: 3, autocomplete: 'off', spellcheck: 'false', required: true, placeholder: 'XXXX-XXXX-XXXX-…' });
      field = { input, node: el('label.field', { for: 'g-rk' }, el('span.field-label', t('Wiederherstellungsschlüssel')), input) };
    } else field = pwField('g-pw', t('Sync-Passwort'), 'current-password');
    const btn = el('button.btn.primary.block', { type: 'submit' }, t('Entsperren'));
    const form = el('form.gate-form', { onsubmit: async e => {
      e.preventDefault(); err.hidden = true; busy(btn, true, t('Entsperre …'));
      try { await Keys.unlock(useRecovery ? { recovery: field.input.value } : { password: field.input.value }); field.input.value = ''; finish(); }
      catch (x) { fail(x); busy(btn, false, t('Entsperren')); }
    } }, field.node, err, btn);
    show(el('h1.gate-title', t('FaLe One entsperren')),
      el('p.gate-lead', useRecovery ? t('Gib den Wiederherstellungsschlüssel aus deinem Wiederherstellungs-Kit ein. Danach kannst du in den Einstellungen ein neues Sync-Passwort festlegen.')
        : t('Gib dein Sync-Passwort ein – dasselbe wie für FaLe Sync in FaLe PDF. Es wird nur auf diesem Gerät verwendet.')),
      form,
      el('button.btn.ghost.block', { type: 'button', onclick: () => unlockStep(!useRecovery) }, useRecovery ? t('Doch mit Sync-Passwort') : t('Passwort vergessen? Wiederherstellungsschlüssel verwenden')),
      el('button.btn.ghost.block', { type: 'button', onclick: async () => { await A.signOut(); welcome(); } }, t('Abmelden')));
  }
  function recoveryStep(text) {
    err.hidden = true;
    const ok = el('input', { type: 'checkbox', id: 'g-rk-ok' });
    const next = el('button.btn.primary.block', { type: 'button', disabled: true, onclick: () => finish() }, t('Weiter zu FaLe One'));
    ok.addEventListener('change', () => { next.disabled = !ok.checked; });
    const keyBox = el('p.rk', { data: { rk: '' } }, ...text.split('-').map(g => el('span', g)));
    show(el('h1.gate-title', t('Dein Wiederherstellungsschlüssel')),
      el('div.callout.warn', icon('key'), el('p', t('Das ist die einzige Möglichkeit, an deine Daten zu kommen, wenn du dein Sync-Passwort vergisst. Wir zeigen ihn nur jetzt – und wir können ihn nicht wiederherstellen.'))),
      keyBox,
      el('div.row-btns',
        el('button.btn.ghost', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(text); toast(t('Kopiert. Füge ihn in deinen Passwort-Manager ein.')); setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 60000); } catch { toast(t('Kopieren nicht möglich – bitte abschreiben.'), { kind: 'error' }); } } }, icon('copy'), t('Kopieren')),
        el('button.btn.ghost', { type: 'button', onclick: async () => { const u = await A.currentUser(); saveBlob(Keys.recoveryKit(text, u ? u.email : ''), 'FaLe-One-Wiederherstellungs-Kit.txt'); } }, icon('download'), t('Als Datei speichern'))),
      el('ul.gate-points.small',
        el('li', t('Drucke ihn aus oder speichere ihn in einem Passwort-Manager – nicht nur auf diesem Gerät.')),
        el('li', t('Wer den Schlüssel hat, kann deine Daten entschlüsseln. Gib ihn niemandem.'))),
      el('label.check', ok, el('span', t('Ich habe den Schlüssel sicher aufbewahrt.'))),
      next);
  }
  async function finish() { clear(root); await done(); }

  if (step === 'unavailable') show(el('h1.gate-title', t('FaLe One ist bald verfügbar')), el('p.gate-lead', t('Der Dienst ist noch nicht freigeschaltet. Bitte schau später wieder vorbei.')), el('button.btn.ghost.block', { type: 'button', onclick: () => location.reload() }, t('Erneut prüfen')));
  else if (step === 'key') keyStep();
  else if (step === 'deleted') { show(el('h1.gate-title', t('Konto gelöscht')), el('p.gate-lead', t('Dein Konto und alle Daten in FaLe One wurden gelöscht. Auf diesem Gerät ist nichts mehr gespeichert.')), el('button.btn.primary.block', { type: 'button', onclick: welcome }, t('OK'))); }
  else if (step === 'recovery') recoveryStep(recovery);
  else welcome();
  return { destroy() {} };
}
