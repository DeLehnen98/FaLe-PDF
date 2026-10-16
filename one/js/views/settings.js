// Settings: account, storage, backup devices, sign-ins, Sync-Passwort / recovery key, this device, language,
// theme, export / import, about & privacy (honest list of what the server sees), delete account.
import { el, clear, icon, toast, errorToast, errorText, openDialog, confirmDialog, promptDialog, saveBlob } from '../dom.js';
import { t, tp, fmtSize, fmtDateTime, ago, langPref, setLangPref, getLang } from '../i18n.js';
import * as A from '../auth.js';
import * as Keys from '../keys.js';
import * as E from '../engine.js';
import { VERSION, SUPPORT_MAIL } from '../config.js';
import { quotaWidget, waitLabel } from '../app.js';

export function mount(main, { setTitle }) {
  setTitle(t('Einstellungen'));
  const wrap = el('div.view.settings');
  main.appendChild(wrap);
  const sec = (id, title, ...body) => el('section.card.set-sec', { aria: { labelledby: 'set-' + id } }, el('h2.set-title', { id: 'set-' + id }, title), ...body);
  const acct = el('div'), storage = el('div'), backups = el('div'), devices = el('div'), local = el('div'), emBox = el('div');
  wrap.append(
    el('div.view-head', el('h2.view-title', t('Einstellungen'))),
    sec('acct', t('Konto'), acct),
    sec('storage', t('Speicher'), storage),
    sec('backup', t('Sicherung'), backups),
    sec('devices', t('Angemeldete Geräte'), devices),
    sec('security', t('Sicherheit'),
      el('p.muted', t('Dein Sync-Passwort und dein Wiederherstellungsschlüssel schützen den Schlüssel, mit dem alles verschlüsselt ist. Beides kennt nur du.')),
      el('div.set-btns',
        el('button.btn.ghost', { type: 'button', onclick: changePassword }, icon('key'), t('Sync-Passwort ändern')),
        el('button.btn.ghost', { type: 'button', onclick: newRecovery }, icon('shield'), t('Wiederherstellungs-Kit neu erstellen')))),
    sec('notfall', t('Notfallzugang'), emBox),
    sec('local', t('Auf diesem Gerät'), local),
    sec('look', t('Darstellung'), looks()),
    sec('data', t('Deine Daten'),
      el('p.muted', t('Du kannst jederzeit gehen: Der Export enthält alle Originale, Ordner, Daten und Alben als normale Dateien.')),
      el('div.set-btns',
        el('button.btn.ghost', { type: 'button', onclick: async () => (await import('../export.js')).exportAll() }, icon('export'), t('Alles exportieren')),
        el('button.btn.ghost', { type: 'button', onclick: async () => (await import('./fotos.js')).takeoutDialog() }, icon('zip'), t('Aus Google Takeout importieren')))),
    sec('about', t('Über FaLe One & Datenschutz'), about()),
    sec('danger', t('Konto löschen'),
      el('p.muted', t('Löscht dein FaLe-Konto mit allen Daten in FaLe One und FaLe Sync – auf dem Server sofort und endgültig. Exportiere vorher, was du behalten möchtest.')),
      el('button.btn.danger', { type: 'button', onclick: deleteAccount }, icon('trash'), t('Konto löschen …'))),
  );

  async function paintAcct() {
    const s = await A.session();
    if (!s) return;
    clear(acct).append(
      el('div.kv-row', el('span.avatar.lg', (s.user.email || '?').slice(0, 1).toUpperCase()), el('div', el('strong', s.user.email), el('span.muted', t('FaLe-Konto · auch für FaLe PDF')))),
      el('div.kv-row', icon('devices'), el('div', el('span', t('Dieses Gerät: {name}', { name: s.deviceName || A.defaultDeviceName() })),
        el('button.link-btn', { type: 'button', onclick: async () => { const n = await promptDialog({ title: t('Gerät umbenennen'), label: t('Name'), value: s.deviceName || '' }); if (n) { try { await A.renameDevice(n); toast(t('Gespeichert.')); paintAcct(); } catch (e) { errorToast(e); } } } }, t('Umbenennen')))),
      el('div.set-btns',
        el('button.btn.ghost', { type: 'button', onclick: async () => { if (await confirmDialog({ title: t('Abmelden?'), text: t('Auf diesem Gerät werden Schlüssel, Index, Offline-Kopien und Vorschaubilder gelöscht. In der Cloud bleibt alles erhalten.'), ok: t('Abmelden') })) { E.stop(); await A.signOut(); } } }, icon('logout'), t('Abmelden')),
        el('button.btn.ghost', { type: 'button', onclick: async () => { if (await confirmDialog({ title: t('Überall abmelden?'), text: t('Alle Geräte und Apps mit deinem FaLe-Konto werden abgemeldet – auch FaLe PDF.'), ok: t('Überall abmelden') })) { E.stop(); await A.signOut({ everywhere: true }); } } }, t('Überall abmelden'))));
  }
  function paintStorage() {
    const q = E.state.quota;
    clear(storage).append(quotaWidget());
    if (q && q.usage) {
      const u = q.usage;
      storage.append(el('dl.kvs.compact',
        ...[[t('Dateien und Fotos'), u.files], [t('Ältere Versionen'), u.versions], [t('Papierkorb'), u.trash], [t('Laufende Uploads'), u.pending], [t('Namen und Metadaten (verschlüsselt)'), u.meta]]
          .map(([k, v]) => el('div.kv', el('dt', k), el('dd', fmtSize(v || 0))))));
    }
    storage.append(el('p.muted', t('Dein Speicher gehört nur FaLe One – er bremst keine anderen Apps aus. Ist er voll, bleibt alles lesbar und nichts wird automatisch gelöscht.')),
      el('div.set-btns', el('a.btn.ghost', { href: '#/drive/papierkorb' }, icon('trash'), t('Papierkorb')), el('a.btn.ghost', { href: '#/fotos/duplikate' }, icon('dup'), t('Duplikate finden'))));
  }
  function paintBackups() {
    const b = E.state.backup;
    clear(backups);
    if (!b) { backups.append(el('p.muted', t('Lade …'))); return; }
    if (!b.devices.length) { backups.append(el('p.muted', t('Noch kein Gerät hat Fotos gesichert.'))); return; }
    backups.append(el('p.muted', t('Wenn ein Gerät länger als {n} Tage nichts gesichert hat, zeigen wir eine Warnung.', { n: b.warnDays || 3 })));
    for (const d of b.devices) {
      const name = (d.meta && d.meta.name) || t('Unbekanntes Gerät');
      backups.append(el('div.dev-row' + (d.stale ? '.stale' : ''),
        icon(d.stale ? 'warning' : 'cloudCheck'),
        el('div.dev-text', el('strong', name + (d.self ? ' · ' + t('dieses Gerät') : '')),
          el('span.muted', [d.lastSuccessAt ? t('Letzte Sicherung {when}', { when: ago(d.lastSuccessAt) }) : t('Noch keine erfolgreiche Sicherung'), d.pending ? tp(d.pending, '{n} wartend', '{n} wartend') : null, d.error ? t('Fehler') : null].filter(Boolean).join(' · '))),
        d.self ? null : el('button.btn.ghost.sm', { type: 'button', onclick: async () => { if (!(await confirmDialog({ title: t('Gerät vergessen?'), text: t('„{name}“ wird aus der Sicherungsliste entfernt. Gesicherte Fotos bleiben erhalten.', { name }), ok: t('Vergessen') }))) return; try { await E.call('backupForget', { deviceId: d.deviceId }); E.refreshBackup(); } catch (e) { errorToast(e); } } }, t('Vergessen'))));
    }
  }
  async function paintDevices() {
    clear(devices).append(el('p.muted', t('Lade …')));
    let list = [];
    const s = await A.session();
    try { list = await A.listDevices(); } catch (e) { clear(devices).append(el('p.muted', errorText(e))); return; }
    clear(devices).append(el('p.muted', t('Alle Geräte und Apps, die mit deinem FaLe-Konto angemeldet sind.')));
    for (const d of list) {
      const self = s && d.device_id === s.device;
      devices.append(el('div.dev-row', icon('devices'), el('div.dev-text', el('strong', (d.name || t('Unbekanntes Gerät')) + (self ? ' · ' + t('dieses Gerät') : '')), el('span.muted', t('Zuletzt aktiv {when}', { when: ago(d.last_seen_at) }))),
        self ? null : el('button.btn.ghost.sm', { type: 'button', onclick: async () => { if (!(await confirmDialog({ title: t('Gerät abmelden?'), text: t('„{name}“ wird abgemeldet und löscht beim nächsten Start seine Schlüssel.', { name: d.name }), ok: t('Abmelden') }))) return; try { await A.revokeDevice(d.device_id); paintDevices(); } catch (e) { errorToast(e); } } }, t('Abmelden'))));
    }
  }
  function paintEm() {
    const st = E.state.em;
    const own = st && st.own;
    const active = own ? own.contacts.filter(c => c.status === 'active').length : 0;
    clear(emBox).append(
      el('p.muted', own ? (active && active >= own.setup.threshold ? t('Aktiv · {n} · {w} Wartezeit', { n: tp(active, '{n} Person', '{n} Personen'), w: waitLabel(own.setup.waitHours) }) : t('Fast fertig – eine Vertrauensperson muss noch bestätigt werden.'))
        : t('Vertrauenspersonen können im Notfall Zugang zu dem anfragen, was du freigibst. Du kannst jede Anfrage ablehnen.')),
      el('div.set-btns',
        el('a.btn.ghost', { href: own ? '#/notfall' : '#/notfall/einrichten' }, icon('shield'), own ? t('Verwalten') : t('Einrichten')),
        el('a.btn.ghost', { href: '#/notfall/fuer-andere' }, icon('user'), t('Für andere da'))));
  }
  function paintLocal() {
    clear(local).append(
      el('div.kv-row', icon('offline'), el('div', el('span', t('Offline-Kopien: {size}', { size: fmtSize(E.state.offline.bytes) })), el('a.link-btn', { href: '#/drive/offline' }, t('Verwalten')))),
      el('p.muted', t('Im Browser liegen deine Fotos nicht in der Galerie des Telefons. „Nur vom Gerät entfernen“, um Platz auf dem Telefon zu schaffen, kommt mit der App für Android – im Browser gibt es nur „Überall löschen“ mit 30 Tagen Papierkorb.')),
      el('div.set-btns',
        el('button.btn.ghost', { type: 'button', onclick: async () => { await E.call('clearThumbCache'); toast(t('Vorschaubilder auf diesem Gerät gelöscht. Sie werden bei Bedarf neu geladen.')); } }, t('Vorschaubild-Cache leeren')),
        el('button.btn.ghost', { type: 'button', onclick: async () => { await E.syncNow(); toast(E.state.syncError ? errorText(E.state.syncError) : t('Synchronisiert.')); } }, icon('refresh'), t('Jetzt synchronisieren'))));
  }
  function looks() {
    const box = el('div');
    const seg = (label, items, cur, onPick) => el('div.field', el('span.field-label', label), el('div.seg', { role: 'group', aria: { label } }, items.map(([v, l]) => el('button', { type: 'button', aria: { pressed: String(v === cur) }, onclick: () => onPick(v) }, l))));
    let theme = 'auto';
    try { theme = localStorage.getItem('fale-one-theme') || 'auto'; } catch {}
    box.append(
      seg(t('Sprache'), [['auto', t('Automatisch')], ['de', 'Deutsch'], ['en', 'English']], langPref(), v => { setLangPref(v); location.reload(); }),
      seg(t('Design'), [['auto', t('Wie System')], ['light', t('Hell')], ['dark', t('Dunkel')]], theme, v => {
        try { if (v === 'auto') localStorage.removeItem('fale-one-theme'); else localStorage.setItem('fale-one-theme', v); } catch {}
        if (v === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = v;
        clear(box).append(...looks().childNodes);
      }));
    return box;
  }
  function about() {
    return el('div',
      el('p', t('FaLe One verschlüsselt auf deinem Gerät, bevor etwas hochgeladen wird (AES-256-GCM). Der Schlüssel entsteht aus deinem Sync-Passwort bzw. Wiederherstellungsschlüssel und verlässt deine Geräte nie.')),
      el('h3.set-sub', t('Was der Server sieht')),
      el('ul.plain',
        el('li', t('Deine E-Mail-Adresse und Konto-ID')),
        el('li', t('Anzahl und Größe der verschlüsselten Daten, Zeitpunkte von Änderungen')),
        el('li', t('Zufällige IDs, die Ordnerstruktur als IDs (ohne Namen) und welche IDs in welchem Album sind')),
        el('li', t('Ob zwei deiner Dateien gleich sind (verschlüsselter Fingerabdruck, nur innerhalb deines Kontos)')),
        el('li', t('Wann deine Geräte zuletzt gesichert haben')),
        el('li', t('Notfallzugang: die E-Mail-Adressen deiner Vertrauenspersonen, welche IDs abgedeckt sind und das Protokoll (wer wann angefragt, geöffnet oder heruntergeladen hat)'))),
      el('h3.set-sub', t('Was der Server nicht sieht')),
      el('ul.plain',
        el('li', t('Dateinamen, Ordnernamen, Albumnamen, Dateitypen und echte Größen')),
        el('li', t('Fotos, Vorschaubilder, Aufnahmedatum, Ort, Kamera')),
        el('li', t('Dein Sync-Passwort und deinen Wiederherstellungsschlüssel'))),
      el('p.muted', t('Kein Scannen, keine Gesichtserkennung auf dem Server, kein Training mit deinen Daten, keine Werbung. Auf diesem Gerät liegen Index und Vorschaubilder verschlüsselt; entschlüsselte Inhalte nur im Arbeitsspeicher.')),
      el('p.muted', t('Version {v} · Fragen? {mail}', { v: VERSION, mail: SUPPORT_MAIL })),
      el('div.set-btns',
        el('a.btn.ghost', { href: 'https://fale.network/datenschutz/', target: '_blank', rel: 'noopener noreferrer' }, t('Datenschutzerklärung')),
        el('a.btn.ghost', { href: 'https://fale.network/impressum/', target: '_blank', rel: 'noopener noreferrer' }, t('Impressum'))));
  }

  // ---------------------------------------------------------------- dialogs
  async function secretDialog(title, text, { withNew = false } = {}) {
    let useRk = false;
    const cur = el('input.input', { type: 'password', autocomplete: 'current-password', required: true, id: 'sd-cur' });
    const curLabel = el('span.field-label', t('Aktuelles Sync-Passwort'));
    const n1 = el('input.input', { type: 'password', autocomplete: 'new-password', minlength: Keys.MIN_PASSWORD, id: 'sd-n1' });
    const n2 = el('input.input', { type: 'password', autocomplete: 'new-password', minlength: Keys.MIN_PASSWORD, id: 'sd-n2' });
    const err = el('p.form-error', { role: 'alert', hidden: true });
    const r = await openDialog({
      title,
      body: [el('p.dlg-text', text), el('label.field', { for: 'sd-cur' }, curLabel, cur),
        el('button.link-btn', { type: 'button', onclick: e => { useRk = !useRk; curLabel.textContent = useRk ? t('Wiederherstellungsschlüssel') : t('Aktuelles Sync-Passwort'); cur.type = useRk ? 'text' : 'password'; e.target.textContent = useRk ? t('Doch mit Sync-Passwort') : t('Passwort vergessen? Wiederherstellungsschlüssel verwenden'); } }, t('Passwort vergessen? Wiederherstellungsschlüssel verwenden')),
        withNew ? el('label.field', { for: 'sd-n1' }, el('span.field-label', t('Neues Sync-Passwort (mindestens {n} Zeichen)', { n: Keys.MIN_PASSWORD })), n1) : null,
        withNew ? el('label.field', { for: 'sd-n2' }, el('span.field-label', t('Neues Sync-Passwort wiederholen')), n2) : null, err],
      actions: [{ label: t('Abbrechen'), value: 'cancel' }, { label: t('Weiter'), value: 'ok', default: true }],
      onMount: () => ({ collect: () => {
        if (!cur.value) { cur.focus(); return false; }
        if (withNew && (n1.value.length < Keys.MIN_PASSWORD || n1.value !== n2.value)) { err.textContent = n1.value !== n2.value ? t('Die beiden Passwörter stimmen nicht überein.') : t('Das Sync-Passwort muss mindestens {n} Zeichen lang sein.', { n: Keys.MIN_PASSWORD }); err.hidden = false; return false; }
        return { secret: useRk ? { recovery: cur.value } : { password: cur.value }, newPw: n1.value };
      } }),
    });
    return r.value === 'ok' ? r.data : null;
  }
  async function changePassword() {
    const d = await secretDialog(t('Sync-Passwort ändern'), t('Gilt danach für alle Geräte und für FaLe Sync in FaLe PDF. Dein Wiederherstellungsschlüssel bleibt gültig.'), { withNew: true });
    if (!d) return;
    try { await Keys.changePassword(d.secret, d.newPw); toast(t('Sync-Passwort geändert.')); } catch (e) { errorToast(e); }
  }
  async function newRecovery() {
    const d = await secretDialog(t('Wiederherstellungs-Kit neu erstellen'), t('Deinen bisherigen Schlüssel können wir nicht noch einmal anzeigen – er ist nirgends im Klartext gespeichert. Du bekommst einen neuen; der alte wird sofort ungültig.'));
    if (!d) return;
    let text;
    try { text = await Keys.newRecoveryKey(d.secret); } catch (e) { errorToast(e); return; }
    const u = await A.currentUser();
    const ok = el('input', { type: 'checkbox' });
    await openDialog({
      title: t('Dein neuer Wiederherstellungsschlüssel'), dismiss: false,
      body: [el('div.callout.warn', icon('key'), el('p', t('Bewahre ihn offline auf. Wir zeigen ihn nur jetzt.'))), el('p.rk', ...text.split('-').map(g => el('span', g))),
        el('div.row-btns', el('button.btn.ghost', { type: 'button', onclick: () => saveBlob(Keys.recoveryKit(text, u ? u.email : ''), 'FaLe-One-Wiederherstellungs-Kit.txt') }, icon('download'), t('Als Datei speichern')),
          el('button.btn.ghost', { type: 'button', onclick: () => navigator.clipboard.writeText(text).then(() => toast(t('Kopiert.'))).catch(() => {}) }, icon('copy'), t('Kopieren'))),
        el('label.check', ok, el('span', t('Ich habe den Schlüssel sicher aufbewahrt.')))],
      actions: [{ label: t('Fertig'), value: 'ok', default: true }],
      onMount: () => ({ collect: () => (ok.checked ? true : (ok.focus(), false)) }),
    });
  }
  async function deleteAccount() {
    const exp = await openDialog({ title: t('Vorher exportieren?'), body: el('p.dlg-text', t('Nach dem Löschen kann niemand deine Daten wiederherstellen – auch wir nicht. Möchtest du vorher alles exportieren?')),
      actions: [{ label: t('Abbrechen'), value: 'cancel' }, { label: t('Ohne Export weiter'), value: 'skip' }, { label: t('Erst exportieren'), value: 'export', default: true }] });
    if (exp.value === 'cancel') return;
    if (exp.value === 'export') { (await import('../export.js')).exportAll(); return; }
    const word = getLang() === 'en' ? 'DELETE' : 'LÖSCHEN';
    const input = el('input.input', { type: 'text', autocomplete: 'off', placeholder: word, id: 'del-confirm' });
    const r = await openDialog({ title: t('Konto endgültig löschen'),
      body: [el('p.dlg-text', t('Gib LÖSCHEN ein, um dein FaLe-Konto mit allen Fotos, Dateien, Alben und FaLe-Sync-Daten endgültig zu löschen.')), el('label.field', { for: 'del-confirm' }, el('span.field-label', t('Bestätigung')), input)],
      actions: [{ label: t('Abbrechen'), value: 'cancel' }, { label: t('Endgültig löschen'), value: 'ok', kind: 'danger-solid' }],
      onMount: () => ({ collect: () => (['LÖSCHEN', 'DELETE'].includes(input.value.trim().toUpperCase()) ? true : (input.focus(), false)) }) });
    if (r.value !== 'ok') return;
    try { await A.deleteAccount(); E.stop(); } catch (e) { errorToast(e); }
  }

  paintAcct(); paintStorage(); paintBackups(); paintDevices(); paintLocal(); paintEm();
  E.refreshQuota(); E.refreshBackup(); E.refreshOffline();
  return {
    update(w) { if (w.has('quota')) paintStorage(); if (w.has('backup')) paintBackups(); if (w.has('offline')) paintLocal(); if (w.has('em')) paintEm(); },
  };
}
