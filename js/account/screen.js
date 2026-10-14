// #/konto – FaLe-Konto: sign-in with an e-mail code, account + Plus, FaLe Sync, devices, deletion.
import { $, $$, h, esc, toast, errorToast, openDialog, confirmDialog, formatSize } from '../ui.js';
import { oicon } from '../office/kinds.js';
import { isNative } from '../platform.js';
import * as A from './auth.js';
import { loadAccountCss, aicon, ago, syncLine } from './entry.js';
import * as SYNC_GROUPS from '../sync/local.js';
import { copySecret, screenSecure } from '../security.js';

const PRIVACY = 'datenschutz.html';

export async function mount(screen) {
  loadAccountCss();
  screen.root.classList.add('acct-screen');
  const wrap = h('<div class="screen-inner acct-wrap"></div>');
  screen.body.appendChild(wrap);
  screen.setFoot([]);
  const offs = [];
  const render = async () => {
    if (screen.signal.aborted) return;
    const cfg = await A.accountConfig();
    const user = A.maybeSignedIn() ? await A.currentUser() : null;
    wrap.innerHTML = '';
    if (!cfg.configured && !user) { renderSoon(wrap, cfg); return; }
    if (!user) { renderSignIn(wrap, cfg); return; }
    await renderAccount(wrap, user, offs);
  };
  const onAcc = () => render();
  window.addEventListener('fale:account', onAcc);
  await render();
  return () => { window.removeEventListener('fale:account', onAcc); offs.forEach(f => { try { f(); } catch {} }); };
}

function privacyLink(root) {
  $$('[data-privacy]', root).forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    import('../platform.js').then(m => m.openLegalPage(PRIVACY)).catch(() => window.open(PRIVACY, '_blank', 'noopener'));
  }));
}

function renderSoon(wrap, cfg) {
  wrap.appendChild(h(`<div class="empty"><div class="empty-art">${aicon('cloudLock')}</div><h3>${cfg.offline ? 'Du bist offline' : 'Das FaLe-Konto kommt bald'}</h3>
    <p>${cfg.offline ? 'Für das FaLe-Konto brauchst du eine Internetverbindung.' : 'Bald kannst du deine Dateien Ende-zu-Ende-verschlüsselt zwischen deinen Geräten synchronisieren. FaLe PDF funktioniert weiterhin vollständig ohne Konto.'}</p></div>`));
}

// ------------------------------------------------------------------ sign-in
function renderSignIn(wrap, cfg) {
  const box = h(`<div class="acct-signin">
    <div class="card acct-hero"><span class="acct-hero-ic">${aicon('cloudLock')}</span><div>
      <strong>Ein Konto für alle FaLe-Apps – freiwillig</strong>
      <ul class="acct-benefits">
        <li>${oicon('check')}<span><b>FaLe Sync:</b> Dateien, Ordner, Unterschriften und Fristen auf all deinen Geräten – Ende-zu-Ende-verschlüsselt. Wir können nichts davon lesen.</span></li>
        <li>${oicon('check')}<span><b>FaLe Plus</b> und dein KI-Kontingent gelten für dein Konto – auf jedem Gerät.</span></li>
        <li>${oicon('check')}<span>Ohne Konto funktioniert FaLe PDF genauso. Deine Dateien bleiben dann nur auf diesem Gerät.</span></li>
      </ul></div></div>
    <form class="card card-pad acct-form" data-step="email" novalidate>
      <h2 class="acct-h2">Anmelden oder registrieren</h2>
      <p class="muted small">Kein Passwort nötig: Wir schicken dir einen 6-stelligen Code per E-Mail.</p>
      <label class="field"><span class="field-label">E-Mail-Adresse</span>
        <input class="input" type="email" name="email" autocomplete="email" inputmode="email" required placeholder="name@beispiel.de" spellcheck="false"></label>
      <div class="acct-code" hidden>
        <p class="small" data-sent></p>
        <label class="field"><span class="field-label">Code aus der E-Mail</span>
          <input class="input acct-code-input" type="text" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" pattern="[0-9]*" placeholder="123456"></label>
      </div>
      <p class="acct-err" role="alert" hidden></p>
      <div class="acct-actions">
        <button class="btn btn-primary" type="submit" data-submit>Code senden</button>
        <button class="btn btn-ghost btn-sm" type="button" data-resend hidden>Code erneut senden</button>
        <button class="btn btn-ghost btn-sm" type="button" data-other hidden>Andere E-Mail</button>
      </div>
      <div class="acct-google" hidden><div class="acct-or"><span>oder</span></div><button class="btn btn-soft" type="button" data-google>Mit Google anmelden</button></div>
      <p class="muted small acct-legal">Mit der Anmeldung speichern wir deine E-Mail-Adresse in der EU (Frankfurt). <a href="${PRIVACY}" data-privacy>Datenschutz</a></p>
    </form></div>`);
  wrap.appendChild(box);
  privacyLink(box);
  const form = $('form', box);
  const email = $('[name=email]', form), code = $('[name=code]', form), err = $('.acct-err', form);
  const submit = $('[data-submit]', form), resend = $('[data-resend]', form), other = $('[data-other]', form);
  let sentTo = '', cooldown = 0, cdTimer = 0;
  const showErr = m => { err.textContent = m || ''; err.hidden = !m; };
  const busy = (on, label) => { submit.disabled = on; if (label) submit.textContent = label; };
  const tick = () => {
    clearInterval(cdTimer);
    cooldown = 60;
    resend.disabled = true;
    resend.textContent = `Code erneut senden (${cooldown} s)`;
    cdTimer = setInterval(() => {
      cooldown--;
      if (cooldown <= 0 || !document.body.contains(resend)) { clearInterval(cdTimer); resend.disabled = false; resend.textContent = 'Code erneut senden'; return; }
      resend.textContent = `Code erneut senden (${cooldown} s)`;
    }, 1000);
  };
  const toCode = addr => {
    sentTo = addr;
    form.dataset.step = 'code';
    $('[data-sent]', form).textContent = `Wir haben einen Code an ${addr} geschickt. Schau auch im Spam-Ordner nach.`;
    $('.acct-code', form).hidden = false;
    email.readOnly = true;
    resend.hidden = false; other.hidden = false;
    submit.textContent = 'Anmelden';
    tick();
    setTimeout(() => code.focus(), 50);
  };
  const send = async () => {
    showErr('');
    busy(true, 'Wird gesendet …');
    try { const r = await A.sendCode(email.value); toCode(r.email); }
    catch (e) { showErr(e.userMessage || 'Der Code konnte nicht gesendet werden.'); submit.textContent = 'Code senden'; }
    finally { submit.disabled = false; if (form.dataset.step === 'code') submit.textContent = 'Anmelden'; }
  };
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (form.dataset.step === 'email') { send(); return; }
    showErr('');
    busy(true, 'Wird geprüft …');
    try {
      await A.verifyCode(sentTo, code.value);
      toast('Angemeldet', 'success');
    } catch (ex) { showErr(ex.userMessage || 'Die Anmeldung hat nicht geklappt.'); busy(false, 'Anmelden'); }
  });
  code.addEventListener('input', () => { if (code.value.replace(/\D/g, '').length === 6 && !submit.disabled) form.requestSubmit(); });
  resend.addEventListener('click', async () => {
    showErr('');
    try { await A.sendCode(sentTo); tick(); toast('Neuer Code gesendet', 'success'); } catch (e) { showErr(e.userMessage); }
  });
  other.addEventListener('click', () => {
    form.dataset.step = 'email'; email.readOnly = false; $('.acct-code', form).hidden = true; resend.hidden = true; other.hidden = true;
    submit.textContent = 'Code senden'; code.value = ''; clearInterval(cdTimer); email.focus();
  });
  A.googleAvailable().then(ok => {
    if (!ok) return;
    $('.acct-google', form).hidden = false;
    $('[data-google]', form).addEventListener('click', () => A.startGoogle().catch(e => errorToast(e)));
  }).catch(() => {});
  if (!isNative()) setTimeout(() => email.focus(), 80);
}

// ------------------------------------------------------------------ signed in
async function renderAccount(wrap, user, offs) {
  const E = await import('../sync/engine.js');
  await E.init();
  wrap.appendChild(h(`<div class="card acct-head">
    <span class="acct-avatar acct-avatar-lg" aria-hidden="true">${esc((user.email || '?').slice(0, 1).toUpperCase())}</span>
    <div class="acct-head-text"><strong data-no-i18n>${esc(user.email)}</strong><span class="muted small">FaLe-Konto · gespeichert in der EU (Frankfurt)</span>
      <span class="acct-plus" data-plus><span class="muted small">FaLe Plus wird geprüft …</span></span></div>
    <button class="btn btn-ghost btn-sm" type="button" data-signout>${aicon('logout')} Abmelden</button></div>`));
  const syncBox = h('<section class="acct-sync" aria-label="FaLe Sync"></section>');
  wrap.append(h('<h2 class="section-title">FaLe Sync</h2>'), syncBox);
  const devBox = h('<div class="card acct-devices"></div>');
  wrap.append(h(`<h2 class="section-title">Geräte</h2>`), devBox);
  wrap.appendChild(h(`<h2 class="section-title">Konto</h2>`));
  const danger = h(`<div class="card settings-group">
    <div class="settings-row"><div class="label"><strong>Überall abmelden</strong><span>Beendet die Anmeldung auf allen Geräten. Deine Dateien bleiben überall erhalten.</span></div>
      <button class="btn btn-ghost btn-sm" type="button" data-signout-all>${aicon('logout')} Überall abmelden</button></div>
    <div class="settings-row"><div class="label"><strong>Konto löschen</strong><span>Löscht dein Konto und alle Cloud-Daten. Dateien auf deinen Geräten bleiben erhalten.</span></div>
      <button class="btn btn-danger-ghost btn-sm" type="button" data-delete>${oicon('trash')} Konto löschen</button></div></div>`);
  wrap.appendChild(danger);
  wrap.appendChild(h(`<p class="muted small acct-legal">Deine Sync-Daten werden auf deinem Gerät verschlüsselt, bevor sie es verlassen. Gespeichert bei Supabase in Frankfurt (EU). <a href="${PRIVACY}" data-privacy>Datenschutz</a></p>`));
  privacyLink(wrap);

  $('[data-signout]', wrap).addEventListener('click', async () => {
    if (!await confirmDialog('Abmelden?', 'Auf diesem Gerät werden Anmeldung und Sync-Schlüssel entfernt. Deine Dateien bleiben auf diesem Gerät.', { okLabel: 'Abmelden' })) return;
    await A.signOut();
    toast('Abgemeldet', 'success');
  });
  $('[data-signout-all]', wrap).addEventListener('click', async () => {
    if (!await confirmDialog('Überall abmelden?', 'Alle Geräte werden abgemeldet und müssen sich neu anmelden. Deine Dateien bleiben überall erhalten.', { okLabel: 'Überall abmelden' })) return;
    await A.signOut({ everywhere: true });
    toast('Überall abgemeldet', 'success');
  });
  $('[data-delete]', wrap).addEventListener('click', () => deleteAccountFlow());

  // Plus status
  A.accountApi('me').then(r => {
    const el = $('[data-plus]', wrap);
    if (!el) return;
    el.innerHTML = r.plus && r.plus.active
      ? `<span class="badge acct-badge-plus">${oicon('star')} FaLe Plus</span><span class="muted small">aktiv bis ${esc(new Date(r.plus.expiresAt).toLocaleDateString('de-DE'))} – gilt auf allen Geräten</span>`
      : `<span class="muted small">FaLe Plus nicht aktiv</span>`;
  }).catch(() => { const el = $('[data-plus]', wrap); if (el) el.innerHTML = ''; });

  // sync section (live)
  const paintSync = () => renderSync(syncBox, E);
  offs.push(E.onStatus(() => paintSyncThrottled()));
  let pt = 0, last = 0;
  const paintSyncThrottled = () => { const now = Date.now(); clearTimeout(pt); if (now - last > 250) { last = now; paintSync(); } else pt = setTimeout(() => { last = Date.now(); paintSync(); }, 250); };
  paintSync();
  E.refreshRemote().catch(e => { if (e && e.code !== 'signed_out') { const n = $('.acct-sync-err', syncBox); if (n) { n.textContent = e.userMessage || ''; n.hidden = false; } } });
  renderDevices(devBox);
  const iv = setInterval(() => { if (!document.body.contains(syncBox)) { clearInterval(iv); return; } const l = $('[data-sync-line]', syncBox); if (l) l.textContent = syncLine(E.status()); }, 30000);
  offs.push(() => clearInterval(iv));
}

// ------------------------------------------------------------------ FaLe Sync section
function usageMeter(st) {
  if (!st.usage || !st.usage.quota) return '';
  const pct = Math.min(100, (st.usage.used / st.usage.quota) * 100);
  return `<div class="acct-usage"><div class="acct-usage-top"><span>${esc(formatSize(st.usage.used))} von ${esc(formatSize(st.usage.quota))} belegt</span>
    <span class="muted small">${st.usage.plus ? 'FaLe Plus' : 'Kostenlos'}</span></div>
    <div class="acct-bar${pct > 90 ? ' warn' : ''}" role="progressbar" aria-label="Cloud-Speicher" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><span style="width:${pct.toFixed(1)}%"></span></div>
    ${!st.usage.plus ? '<span class="muted small">Mit FaLe Plus hast du 20 GB.</span>' : ''}</div>`;
}

function renderSync(box, E) {
  const st = E.status();
  box.innerHTML = '';
  if (st.needs === 'setup' && !st.enabled) {
    box.appendChild(h(`<div class="card card-pad acct-sync-card">
      <div class="acct-sync-intro">${aicon('cloudLock')}<div><strong>FaLe Sync einrichten</strong>
      <p class="muted small">Deine Daten werden auf diesem Gerät verschlüsselt. Den Schlüssel schützt ein Sync-Passwort, das nur du kennst – zusätzlich bekommst du einen Wiederherstellungsschlüssel zum Ausdrucken. Wir können deine Daten weder lesen noch das Passwort zurücksetzen.</p></div></div>
      <p class="acct-sync-err acct-err" hidden></p>
      <button class="btn btn-primary" type="button" data-setup>${aicon('sync')} FaLe Sync einrichten</button></div>`));
    $('[data-setup]', box).addEventListener('click', () => setupFlow(E));
    return;
  }
  if (!st.enabled && (st.needs === 'unlock' || st.needs === 'keychange' || st.needs == null)) {
    box.appendChild(h(`<div class="card card-pad acct-sync-card">
      <div class="acct-sync-intro">${oicon('key')}<div><strong>${st.needs === 'keychange' ? 'Der Sync-Schlüssel wurde geändert' : 'FaLe Sync auf diesem Gerät entsperren'}</strong>
      <p class="muted small">${st.needs === 'keychange' ? 'FaLe Sync wurde auf einem anderen Gerät neu eingerichtet. Gib das neue Sync-Passwort ein.' : 'Gib dein Sync-Passwort ein. Danach synchronisiert dieses Gerät automatisch.'}</p></div></div>
      <form class="acct-unlock" novalidate>
        <label class="field"><span class="field-label">Sync-Passwort</span><input class="input" type="password" name="pw" autocomplete="current-password"></label>
        <p class="acct-err" role="alert" hidden></p>
        <div class="acct-actions"><button class="btn btn-primary" type="submit">Entsperren</button>
        <button class="btn btn-ghost btn-sm" type="button" data-rk>Passwort vergessen? Wiederherstellungsschlüssel verwenden</button></div>
      </form><p class="acct-sync-err acct-err" hidden></p></div>`));
    const f = $('form', box), err = $('.acct-err', f), btn = $('[type=submit]', f);
    f.addEventListener('submit', async e => {
      e.preventDefault();
      err.hidden = true; btn.disabled = true; btn.textContent = 'Wird entsperrt …';
      try { await E.unlock({ password: $('[name=pw]', f).value }); toast('FaLe Sync ist aktiv', 'success'); }
      catch (ex) { err.textContent = ex.userMessage || 'Das hat nicht geklappt.'; err.hidden = false; btn.disabled = false; btn.textContent = 'Entsperren'; }
    });
    $('[data-rk]', box).addEventListener('click', () => recoveryUnlockFlow(E));
    return;
  }
  // enabled
  const busy = ['checking', 'pulling', 'pushing', 'cleaning'].includes(st.phase);
  const p = st.progress;
  const card = h(`<div class="card card-pad acct-sync-card">
    <div class="acct-sync-status${busy ? ' busy' : ''}${st.error || st.quotaFull ? ' warn' : ''}"><span class="acct-sync-ic">${aicon('sync')}</span>
      <div><strong data-sync-line>${esc(syncLine(st))}</strong>
      ${p && p.total ? `<span class="muted small">${esc(p.label || '')} ${p.done || 0} von ${p.total}</span>` : ''}
      ${st.error ? `<span class="small acct-err-text">${esc(st.error)}</span>` : ''}</div></div>
    ${busy && p && p.total ? `<div class="acct-bar" role="progressbar" aria-label="Fortschritt" aria-valuemin="0" aria-valuemax="${p.total}" aria-valuenow="${p.done || 0}"><span style="width:${Math.min(100, ((p.done || 0) / p.total) * 100).toFixed(1)}%"></span></div>` : ''}
    ${st.quotaFull ? `<div class="acct-note warn">${oicon('info')}<span>Dein Cloud-Speicher ist voll. Neue oder geänderte Dateien bleiben auf diesem Gerät, bis wieder Platz ist.</span></div>` : ''}
    ${st.vaultConflict ? `<div class="acct-note">${oicon('vault')}<span>Auf diesem Gerät gibt es einen anderen Tresor. Er wird nicht synchronisiert.</span></div>` : ''}
    ${st.pausedReason === 'cleared' ? `<div class="acct-note">${oicon('info')}<span>Du hast die Daten auf diesem Gerät gelöscht. Deine Cloud-Daten sind unverändert – „Fortsetzen“ lädt sie wieder herunter.</span></div>` : ''}
    ${usageMeter(st)}
    <div class="acct-actions">
      <button class="btn btn-soft btn-sm" type="button" data-now ${busy || st.paused ? 'disabled' : ''}>${aicon('sync')} Jetzt synchronisieren</button>
      <button class="btn btn-ghost btn-sm" type="button" data-pause>${st.paused ? `${oicon('play')} Fortsetzen` : `${oicon('pause')} Pausieren`}</button>
    </div>
    <p class="acct-sync-err acct-err" hidden></p></div>`);
  box.appendChild(card);
  $('[data-now]', card).addEventListener('click', () => E.syncNow().catch(e => errorToast(e)));
  $('[data-pause]', card).addEventListener('click', () => E.setPaused(!st.paused));

  const { GROUPS } = SYNC_GROUPS;
  const groups = h(`<div class="card settings-group acct-groups"><div class="settings-row acct-groups-head"><div class="label"><strong>Was wird synchronisiert?</strong><span>Alles wird vor dem Hochladen auf diesem Gerät verschlüsselt.</span></div></div></div>`);
  GROUPS.forEach(g => {
    const row = h(`<div class="settings-row"><div class="label"><strong>${esc(g.label)}</strong><span>${esc(g.desc)}</span></div>
      <label class="switch"><input type="checkbox" ${st.groups[g.id] !== false ? 'checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span class="sr-only">${esc(g.label)} synchronisieren</span></label></div>`);
    $('input', row).addEventListener('change', e => E.setGroup(g.id, e.target.checked));
    groups.appendChild(row);
  });
  if (isNative()) {
    const row = h(`<div class="settings-row"><div class="label"><strong>Nur über WLAN</strong><span>Große Dateien nicht über mobile Daten übertragen.</span></div>
      <label class="switch"><input type="checkbox" ${st.wifiOnly ? 'checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span class="sr-only">Nur über WLAN synchronisieren</span></label></div>`);
    $('input', row).addEventListener('change', e => E.setWifiOnly(e.target.checked));
    groups.appendChild(row);
  }
  box.appendChild(groups);

  const adv = h(`<div class="card settings-group">
    <div class="settings-row"><div class="label"><strong>Sync-Passwort ändern</strong><span>Der Wiederherstellungsschlüssel bleibt gültig.</span></div>
      <button class="btn btn-ghost btn-sm" type="button" data-chpw>${oicon('key')} Ändern</button></div>
    <div class="settings-row"><div class="label"><strong>Neuer Wiederherstellungsschlüssel</strong><span>Der bisherige Schlüssel funktioniert danach nicht mehr.</span></div>
      <button class="btn btn-ghost btn-sm" type="button" data-newrk>Neu erstellen</button></div>
    <div class="settings-row"><div class="label"><strong>Sync auf diesem Gerät ausschalten</strong><span>Entfernt den Schlüssel von diesem Gerät. Dateien und Cloud-Daten bleiben erhalten.</span></div>
      <button class="btn btn-ghost btn-sm" type="button" data-off>Ausschalten</button></div>
    <div class="settings-row"><div class="label"><strong>Alle Cloud-Daten löschen</strong><span>Löscht alles, was in der Cloud gespeichert ist, und den Sync-Schlüssel. Deine Dateien auf den Geräten bleiben.</span></div>
      <button class="btn btn-danger-ghost btn-sm" type="button" data-wipe>${oicon('trash')} Cloud-Daten löschen</button></div></div>`);
  box.appendChild(adv);
  $('[data-chpw]', adv).addEventListener('click', () => changePasswordFlow(E));
  $('[data-newrk]', adv).addEventListener('click', () => newRecoveryFlow(E));
  $('[data-off]', adv).addEventListener('click', async () => {
    if (!await confirmDialog('Sync auf diesem Gerät ausschalten?', 'Dieses Gerät synchronisiert nicht mehr, bis du es wieder mit deinem Sync-Passwort entsperrst. Deine Dateien bleiben hier und in der Cloud erhalten.', { okLabel: 'Ausschalten' })) return;
    await E.turnOffHere();
  });
  $('[data-wipe]', adv).addEventListener('click', () => wipeFlow(E));
}

// ------------------------------------------------------------------ flows (dialogs)
function pwStrength(pw) {
  const s = String(pw || '');
  let score = 0;
  if (s.length >= 10) score++;
  if (s.length >= 14) score++;
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) score++;
  if (/\d/.test(s)) score++;
  if (/[^A-Za-z0-9]/.test(s)) score++;
  return s.length < 10 ? 0 : Math.min(4, score);
}
const STRENGTH = ['zu kurz', 'schwach', 'okay', 'gut', 'sehr gut'];

async function setupFlow(E) {
  const r = await openDialog({
    title: 'FaLe Sync einrichten',
    body: `<p>Wähle ein <b>Sync-Passwort</b>. Es verschlüsselt den Schlüssel zu deinen Daten und verlässt dein Gerät nie.</p>
      <label class="field"><span class="field-label">Sync-Passwort (mindestens 10 Zeichen)</span><input class="input" type="password" name="pw" autocomplete="new-password" autofocus></label>
      <div class="acct-strength" data-str><span></span></div><span class="muted small" data-str-label></span>
      <label class="field"><span class="field-label">Sync-Passwort wiederholen</span><input class="input" type="password" name="pw2" autocomplete="new-password"></label>
      <div class="acct-note warn">${oicon('info')}<span>Wir können das Passwort nicht zurücksetzen. Ohne Passwort und Wiederherstellungsschlüssel sind deine Cloud-Daten verloren – deine Dateien auf den Geräten nicht.</span></div>
      <p class="acct-err" role="alert" hidden></p>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Weiter', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => {
      const pw = $('[name=pw]', dlg);
      pw.addEventListener('input', () => {
        const sc = pwStrength(pw.value);
        $('[data-str] span', dlg).style.width = `${(sc / 4) * 100}%`;
        $('[data-str]', dlg).dataset.score = sc;
        $('[data-str-label]', dlg).textContent = pw.value ? `Stärke: ${STRENGTH[sc]}` : '';
      });
      return { collect: () => ({ pw: pw.value, pw2: $('[name=pw2]', dlg).value }) };
    },
    validate: (v, dlg) => {
      const pw = $('[name=pw]', dlg).value, pw2 = $('[name=pw2]', dlg).value, err = $('.acct-err', dlg);
      const msg = pw.length < 10 ? 'Das Sync-Passwort muss mindestens 10 Zeichen lang sein.' : pw !== pw2 ? 'Die Passwörter stimmen nicht überein.' : '';
      err.textContent = msg; err.hidden = !msg;
      return !msg;
    },
  });
  if (r.value !== 'ok' || !r.data) return;
  const wait = await import('../ui.js').then(m => m.progress('Schlüssel werden erzeugt …'));
  let text;
  try { text = await E.setup(r.data.pw); } catch (e) { wait.done(); errorToast(e, 'FaLe Sync konnte nicht eingerichtet werden.'); return; }
  wait.done();
  await showRecoveryKey(text, { first: true });
  E.start();
  toast('FaLe Sync ist aktiv', 'success');
}

/** Show the recovery key once, with copy / PDF and a "saved" confirmation. */
async function showRecoveryKey(text, { first = false } = {}) {
  const user = await A.currentUser();
  const releaseSecure = screenSecure(true); // Android: no screenshots / recents preview of the key
  try { await openDialog({
    title: 'Dein Wiederherstellungsschlüssel',
    dismissable: false,
    body: `<p>Damit kommst du an deine Cloud-Daten, falls du dein Sync-Passwort vergisst. <b>Er wird nur jetzt angezeigt.</b> Drucke ihn aus oder bewahre ihn an einem sicheren Ort auf – nicht nur auf diesem Gerät.</p>
      <div class="acct-rk" data-no-i18n>${text.split('-').map(g => `<span>${esc(g)}</span>`).join('')}</div>
      <div class="acct-actions"><button class="btn btn-soft btn-sm" type="button" data-copy>${oicon('copy')} Kopieren</button>
      <button class="btn btn-soft btn-sm" type="button" data-pdf>${oicon('print')} Als PDF speichern</button></div>
      <label class="acct-check"><input type="checkbox" data-saved> <span>Ich habe den Wiederherstellungsschlüssel sicher gespeichert.</span></label>`,
    actions: [{ label: first ? 'Weiter' : 'Fertig', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => {
      const ok = $('.dlg-actions .btn-primary', dlg);
      ok.disabled = true;
      $('[data-saved]', dlg).addEventListener('change', e => { ok.disabled = !e.target.checked; });
      // cleared from the clipboard again after 60 s (other apps / clipboard history must not keep it)
      $('[data-copy]', dlg).addEventListener('click', async () => { if (await copySecret(text)) toast('Kopiert – wird nach 60 Sekunden aus der Zwischenablage entfernt.', 'success'); else toast('Kopieren ist hier nicht möglich – bitte abschreiben.', 'error'); });
      $('[data-pdf]', dlg).addEventListener('click', () => recoveryPdf(text, user && user.email).catch(e => errorToast(e, 'Das PDF konnte nicht erstellt werden.')));
      dlg.addEventListener('cancel', e => e.preventDefault());
    },
    validate: (v, dlg) => $('[data-saved]', dlg).checked,
  }); } finally { releaseSecure(); }
}

async function recoveryPdf(text, email) {
  const { loadPdfLib } = await import('../pdflib.js');
  const P = await loadPdfLib();
  const doc = await P.PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(P.StandardFonts.Helvetica), bold = await doc.embedFont(P.StandardFonts.HelveticaBold), mono = await doc.embedFont(P.StandardFonts.CourierBold);
  const ink = P.rgb(0.08, 0.09, 0.18), muted = P.rgb(0.31, 0.33, 0.46);
  let y = 770;
  const { t, locale } = await import('../i18n/index.js'); // the PDF follows the UI language
  page.drawText(t('FaLe Sync – Wiederherstellungsschlüssel'), { x: 56, y, size: 20, font: bold, color: ink }); y -= 30;
  page.drawText(t('Konto: {email}', { email: email || '' }), { x: 56, y, size: 11, font, color: muted }); y -= 16;
  page.drawText(t('Erstellt am {date}', { date: new Date().toLocaleDateString(locale()) }), { x: 56, y, size: 11, font, color: muted }); y -= 40;
  page.drawRectangle({ x: 48, y: y - 92, width: 499, height: 112, borderColor: P.rgb(0.23, 0.22, 0.63), borderWidth: 1.5, color: P.rgb(0.96, 0.96, 1) });
  const groups = text.split('-');
  for (let row = 0; row < 2; row++) {
    page.drawText(groups.slice(row * 7, row * 7 + 7).join('  '), { x: 66, y: y - 18 - row * 40, size: 17, font: mono, color: ink });
  }
  y -= 140;
  const lines = [
    'Mit diesem Schlüssel entsperrst du FaLe Sync auf einem neuen Gerät, falls du dein',
    'Sync-Passwort vergessen hast. Bewahre ihn sicher auf (z. B. bei deinen Unterlagen).',
    'Wer diesen Schlüssel UND Zugang zu deinem FaLe-Konto hat, kann deine Cloud-Daten lesen.',
    'FaLe kann den Schlüssel nicht wiederherstellen – es gibt keine Kopie bei uns.',
    '',
    'So geht es: FaLe PDF öffnen > Ich > FaLe-Konto > anmelden >',
    '„Passwort vergessen? Wiederherstellungsschlüssel verwenden“.',
  ];
  for (const l of lines) { page.drawText(l ? t(l) : '', { x: 56, y, size: 11, font, color: ink }); y -= 17; }
  const bytes = await doc.save();
  const { saveFile } = await import('../platform.js');
  await saveFile(bytes, t('FaLe-Sync-Wiederherstellungsschluessel.pdf'), 'application/pdf');
}

async function recoveryUnlockFlow(E) {
  await openDialog({
    title: 'Mit Wiederherstellungsschlüssel entsperren',
    body: `<p>Gib den Wiederherstellungsschlüssel ein, den du beim Einrichten gespeichert hast (Groß-/Kleinschreibung und Bindestriche sind egal).</p>
      <label class="field"><span class="field-label">Wiederherstellungsschlüssel</span><textarea class="input acct-rk-input" name="rk" rows="3" spellcheck="false" autocomplete="off" autofocus></textarea></label>
      <label class="field"><span class="field-label">Neues Sync-Passwort (optional, mindestens 10 Zeichen)</span><input class="input" type="password" name="npw" autocomplete="new-password"></label>
      <p class="acct-err" role="alert" hidden></p>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Entsperren', value: 'ok', kind: 'btn-primary', default: true }],
    validate: (v, dlg) => {
      const err = $('.acct-err', dlg), btn = $('.dlg-actions .btn-primary', dlg);
      const rk = $('[name=rk]', dlg).value, npw = $('[name=npw]', dlg).value;
      if (npw && npw.length < 10) { err.textContent = 'Das Sync-Passwort muss mindestens 10 Zeichen lang sein.'; err.hidden = false; return false; }
      btn.disabled = true; err.hidden = true;
      (async () => {
        try {
          await E.unlock({ recovery: rk });
          if (npw) await E.changePassword({ recovery: rk }, npw);
          dlg.close();
          toast(npw ? 'Entsperrt – neues Sync-Passwort gespeichert' : 'FaLe Sync ist aktiv', 'success');
        } catch (e) { err.textContent = e.userMessage || 'Das hat nicht geklappt.'; err.hidden = false; btn.disabled = false; }
      })();
      return false;
    },
  });
}

async function secretDialog(title, intro, okLabel) {
  const r = await openDialog({
    title,
    body: `<p>${esc(intro)}</p>
      <label class="field"><span class="field-label">Aktuelles Sync-Passwort</span><input class="input" type="password" name="pw" autocomplete="current-password" autofocus></label>
      <p class="acct-err" role="alert" hidden></p>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: okLabel, value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => ({ collect: () => $('[name=pw]', dlg).value }),
  });
  return r.value === 'ok' ? r.data : null;
}

async function changePasswordFlow(E) {
  const r = await openDialog({
    title: 'Sync-Passwort ändern',
    body: `<label class="field"><span class="field-label">Aktuelles Sync-Passwort</span><input class="input" type="password" name="old" autocomplete="current-password" autofocus></label>
      <label class="field"><span class="field-label">Neues Sync-Passwort (mindestens 10 Zeichen)</span><input class="input" type="password" name="pw" autocomplete="new-password"></label>
      <label class="field"><span class="field-label">Neues Sync-Passwort wiederholen</span><input class="input" type="password" name="pw2" autocomplete="new-password"></label>
      <p class="acct-err" role="alert" hidden></p>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Ändern', value: 'ok', kind: 'btn-primary', default: true }],
    validate: (v, dlg) => {
      const err = $('.acct-err', dlg), btn = $('.dlg-actions .btn-primary', dlg);
      const old = $('[name=old]', dlg).value, pw = $('[name=pw]', dlg).value, pw2 = $('[name=pw2]', dlg).value;
      const msg = pw.length < 10 ? 'Das Sync-Passwort muss mindestens 10 Zeichen lang sein.' : pw !== pw2 ? 'Die Passwörter stimmen nicht überein.' : '';
      if (msg) { err.textContent = msg; err.hidden = false; return false; }
      btn.disabled = true; err.hidden = true;
      E.changePassword({ password: old }, pw).then(() => { dlg.close(); toast('Sync-Passwort geändert', 'success'); })
        .catch(e => { err.textContent = e.userMessage || 'Das hat nicht geklappt.'; err.hidden = false; btn.disabled = false; });
      return false;
    },
  });
  void r;
}

async function newRecoveryFlow(E) {
  const pw = await secretDialog('Neuer Wiederherstellungsschlüssel', 'Zur Bestätigung brauchen wir dein Sync-Passwort. Der bisherige Wiederherstellungsschlüssel funktioniert danach nicht mehr.', 'Neu erstellen');
  if (pw == null) return;
  let text;
  try { text = await E.newRecoveryKey({ password: pw }); } catch (e) { errorToast(e, 'Das hat nicht geklappt.'); return; }
  await showRecoveryKey(text);
}

async function wipeFlow(E) {
  if (!await confirmDialog('Alle Cloud-Daten löschen?', 'Alle verschlüsselten Daten in der Cloud und der Sync-Schlüssel werden endgültig gelöscht. Andere Geräte hören auf zu synchronisieren. Deine Dateien auf den Geräten bleiben erhalten.', { okLabel: 'Endgültig löschen', danger: true })) return;
  const { progress } = await import('../ui.js');
  const pr = progress('Cloud-Daten werden gelöscht …');
  try {
    await E.wipeCloud(n => pr.set(`Cloud-Daten werden gelöscht … ${n}`));
    toast('Alle Cloud-Daten wurden gelöscht', 'success');
  } catch (e) { errorToast(e, 'Das Löschen hat nicht vollständig geklappt. Bitte versuche es erneut.'); }
  finally { pr.done(); }
}

async function deleteAccountFlow() {
  const r = await openDialog({
    title: 'Konto löschen?',
    body: `<p><b>Konto und alle Daten werden innerhalb von 30 Tagen vollständig gelöscht.</b> Deine Cloud-Daten (FaLe Sync) entfernen wir sofort, die Anmeldedaten spätestens nach 30 Tagen. Ein laufendes FaLe-Plus-Abo kündigst du bitte selbst bei Google Play.</p>
      <p>Deine Dateien auf deinen Geräten bleiben erhalten.</p>
      <label class="acct-check"><input type="checkbox" data-sure> <span>Ja, mein FaLe-Konto und alle Cloud-Daten endgültig löschen.</span></label>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Konto löschen', value: 'ok', kind: 'btn-danger' }],
    onMount: dlg => {
      const b = $('.dlg-actions .btn-danger', dlg);
      b.disabled = true;
      $('[data-sure]', dlg).addEventListener('change', e => { b.disabled = !e.target.checked; });
    },
  });
  if (r.value !== 'ok') return;
  const { progress } = await import('../ui.js');
  const pr = progress('Konto wird gelöscht …');
  try {
    await A.deleteAccount();
    toast('Dein Konto wurde gelöscht.', 'success', { timeout: 6000 });
  } catch (e) { errorToast(e, 'Das Konto konnte gerade nicht gelöscht werden. Bitte versuche es später erneut.'); }
  finally { pr.done(); }
}

// ------------------------------------------------------------------ devices
async function renderDevices(box) {
  box.innerHTML = '<div class="acct-dev-loading muted small">Geräte werden geladen …</div>';
  let list = [], me = null;
  try { [list, me] = await Promise.all([A.listDevices(), A.deviceId()]); }
  catch (e) { box.innerHTML = `<p class="muted small acct-dev-loading">${esc(e.userMessage || 'Die Geräteliste ist gerade nicht verfügbar.')}</p>`; return; }
  box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<p class="muted small acct-dev-loading">Noch keine Geräte.</p>'; return; }
  list.sort((a, b) => (a.device_id === me ? -1 : b.device_id === me ? 1 : 0));
  for (const d of list) {
    const mine = d.device_id === me;
    const row = h(`<div class="acct-dev"><span class="acct-dev-ic">${aicon(d.platform === 'android' ? 'phone' : 'devices')}</span>
      <div class="acct-dev-text"><strong><span data-no-i18n>${esc(d.name || 'Gerät')}</span>${mine ? ' <span class="badge">Dieses Gerät</span>' : ''}</strong>
      <span class="muted small">${d.platform === 'android' ? 'Android-App' : 'Web'} · zuletzt aktiv ${esc(ago(Date.parse(d.last_seen_at)))}</span></div>
      ${mine ? `<button class="btn btn-ghost btn-sm" type="button" data-rename>${oicon('edit')} Umbenennen</button>` : `<button class="btn btn-ghost btn-sm" type="button" data-revoke>${aicon('logout')} Abmelden</button>`}</div>`);
    if (mine) $('[data-rename]', row).addEventListener('click', async () => {
      const { promptDialog } = await import('../ui.js');
      const name = await promptDialog('Gerät umbenennen', 'Name dieses Geräts', d.name || '', { okLabel: 'Speichern' });
      if (name == null) return;
      try { await A.renameDevice(name); renderDevices(box); } catch (e) { errorToast(e); }
    });
    else $('[data-revoke]', row).addEventListener('click', async () => {
      if (!await confirmDialog('Gerät abmelden?', `„${d.name || 'Gerät'}“ wird abgemeldet und entfernt beim nächsten Kontakt seinen Sync-Schlüssel. Dateien auf dem Gerät bleiben erhalten.`, { okLabel: 'Abmelden' })) return;
      try { await A.revokeDevice(d.device_id); toast('Gerät abgemeldet', 'success'); renderDevices(box); } catch (e) { errorToast(e); }
    });
    box.appendChild(row);
  }
}
