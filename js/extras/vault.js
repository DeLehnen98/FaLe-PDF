// Privater Tresor: Dateien verschlüsselt in IndexedDB (AES-GCM 256), Schlüssel aus PIN/Passphrase via
// PBKDF2-SHA-256 (600.000 Runden, OWASP 2023; ältere Tresore mit 400.000 werden beim Entsperren angehoben). Ein zufälliger Datenschlüssel (DEK) wird mit dem PIN-Schlüssel verpackt –
// so kann die PIN geändert werden, ohne alle Dateien neu zu verschlüsseln. Entschlüsselt wird nur im Arbeitsspeicher.
// Keine Hintertür: Ohne PIN (oder ein PRF-fähiges Biometrie-Gerät, das selbst einen Schlüssel liefert) sind die Daten verloren.
import * as db from '../db.js';
import { $, $$, h, esc, toast, errorToast, openDialog, confirmDialog, downloadBlob, shareBlob, pickFiles, formatSize, formatDate, progress } from '../ui.js';
import { oicon, kindTile, kindOf, KINDS, detectKind, ACCEPT_ALL } from '../office/kinds.js';
import { emitChange, dropThumb } from '../library.js';
import { track } from './stats.js';
import { screenSecure, sanitizeDocHtml } from '../security.js';

export const ITERATIONS = 600000; // PBKDF2-SHA-256 (OWASP 2023); vaults created with fewer rounds are upgraded on unlock
const HEADER_KEY = 'vault';
const LOCK_KEY = 'fale-vault-autolock';
const enc = new TextEncoder();
const dec = new TextDecoder();
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
export function b64(buf) { const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
export function unb64(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

// ---------------- state ----------------
const state = { dek: null, unlocked: false, sessionDek: null, timer: 0, hold: 0 };
/** Run fn while the "lock when the app is hidden" rule is paused (system file picker, biometric prompt). */
async function holdLock(fn) { state.hold++; try { return await fn(); } finally { setTimeout(() => { state.hold = Math.max(0, state.hold - 1); }, 1500); } }
const listeners = new Set();
export function onVaultChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = () => listeners.forEach(fn => { try { fn(); } catch {} });

export function cryptoAvailable() { return !!(globalThis.crypto && crypto.subtle && window.isSecureContext !== false); }
export async function getHeader() { return db.getSetting(HEADER_KEY, null); }
export async function isSetUp() { return !!(await getHeader()); }
export function isUnlocked() { return state.unlocked && !!state.dek; }

async function deriveKek(pin, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(String(pin).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}
async function unwrapDek(wrapped, kek, iv) {
  return crypto.subtle.unwrapKey('raw', wrapped, kek, { name: 'AES-GCM', iv }, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** Create a new vault with this PIN. */
export async function setupVault(pin) {
  if (!cryptoAvailable()) throw Object.assign(new Error('no crypto'), { userMessage: 'Verschlüsselung ist in diesem Browser nicht verfügbar (sichere Verbindung nötig).' });
  if (String(pin).length < 6) throw Object.assign(new Error('short'), { userMessage: 'Die PIN muss mindestens 6 Zeichen lang sein.' });
  const salt = rnd(16), iv = rnd(12);
  const kek = await deriveKek(pin, salt, ITERATIONS);
  const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const wrapped = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv });
  await db.setSetting(HEADER_KEY, { v: 1, kdf: 'PBKDF2-SHA256', iter: ITERATIONS, salt: b64(salt), iv: b64(iv), wrapped: b64(wrapped), createdAt: Date.now(), bio: null });
  setUnlocked(dek);
  return true;
}

/** Try to unlock with the PIN. Resolves false for a wrong PIN. */
export async function unlock(pin) {
  const hd = await getHeader();
  if (!hd) return false;
  try {
    const kek = await deriveKek(pin, unb64(hd.salt), hd.iter || ITERATIONS);
    const dek = await unwrapDek(unb64(hd.wrapped), kek, unb64(hd.iv));
    setUnlocked(dek);
    if ((hd.iter || 0) < ITERATIONS) upgradeKdf(pin, dek).catch(() => {}); // re-wrap with today's work factor
    return true;
  } catch { return false; }
}

/** Re-wrap the DEK with ITERATIONS rounds (fresh salt + IV); the files themselves stay as they are. */
async function upgradeKdf(pin, dek) {
  const hd = await getHeader();
  if (!hd || (hd.iter || 0) >= ITERATIONS) return;
  const salt = rnd(16), iv = rnd(12);
  const wrapped = await crypto.subtle.wrapKey('raw', dek, await deriveKek(pin, salt, ITERATIONS), { name: 'AES-GCM', iv });
  await db.setSetting(HEADER_KEY, { ...hd, iter: ITERATIONS, salt: b64(salt), iv: b64(iv), wrapped: b64(wrapped) });
}

function setUnlocked(dek) {
  state.dek = dek;
  state.unlocked = true;
  state.sessionDek = null;
  armTimer();
  emit();
}

/** Lock now. With the biometric "gate" mode the key stays in memory for this session (honestly labelled in the UI). */
export async function lock({ hard = false } = {}) {
  if (!state.unlocked && !state.sessionDek) return;
  const hd = await getHeader().catch(() => null);
  const gate = hd && hd.bio && hd.bio.mode === 'gate';
  state.sessionDek = gate && !hard ? state.dek : null;
  state.dek = null;
  state.unlocked = false;
  clearTimeout(state.timer);
  emit();
}

export function autoLockMinutes() { try { return Math.max(1, +(localStorage.getItem(LOCK_KEY) || 3)); } catch { return 3; } }
export function setAutoLockMinutes(m) { try { localStorage.setItem(LOCK_KEY, String(m)); } catch {} armTimer(); }
function armTimer() {
  clearTimeout(state.timer);
  if (!state.unlocked) return;
  state.timer = setTimeout(() => { lock(); toast('Tresor wurde automatisch gesperrt.', 'info'); }, autoLockMinutes() * 60000);
}
if (typeof document !== 'undefined') {
  const poke = () => { if (state.unlocked) armTimer(); };
  document.addEventListener('pointerdown', poke, { passive: true, capture: true });
  document.addEventListener('keydown', poke, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && state.unlocked && !state.hold) lock(); });
  window.addEventListener('pagehide', () => { state.dek = null; state.sessionDek = null; state.unlocked = false; });
}

// ---------------- items ----------------
async function encryptBytes(bytes, id) {
  const iv = rnd(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(id) }, state.dek, bytes);
  return { iv, ct };
}
async function decryptBytes(iv, ct, id, key = state.dek) {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(id) }, key, ct);
}
function need() { if (!isUnlocked()) throw Object.assign(new Error('locked'), { userMessage: 'Der Tresor ist gesperrt.' }); armTimer(); }

/** Encrypt and store a blob. Returns the decrypted meta. */
export async function addBlob(blob, { name, kind = null }) {
  need();
  const id = db.uid();
  const meta = { name: String(name || 'Datei'), kind: kind || detectKind({ name, type: blob.type }) || 'other', mime: blob.type || 'application/octet-stream', size: blob.size, addedAt: Date.now() };
  const m = await encryptBytes(enc.encode(JSON.stringify(meta)), id);
  const d = await encryptBytes(await blob.arrayBuffer(), id);
  await db.putVaultItem({ id, v: 1, metaIv: m.iv, meta: m.ct, dataIv: d.iv, data: d.ct });
  track('vault_added');
  emit();
  return { id, ...meta };
}

/** Move library files into the vault (removed from the library for good – no Papierkorb copy). */
export async function moveDocsToVault(ids) {
  need();
  const prog = ids.length > 1 ? progress('Dateien werden verschlüsselt …') : null;
  let n = 0;
  try {
    for (const id of ids) {
      const meta = await db.getDoc(id);
      const blob = await db.getFile(id);
      if (!meta || !blob) continue;
      await addBlob(blob, { name: meta.name, kind: meta.kind || 'pdf' });
      await db.purgeDoc(id);
      dropThumb(id);
      n++;
      prog && prog.set(`Dateien werden verschlüsselt … ${n}/${ids.length}`);
    }
  } finally { prog && prog.done(); }
  emitChange();
  return n;
}

export async function listItems() {
  need();
  const recs = await db.listVault();
  const out = [];
  for (const r of recs) {
    try { out.push({ id: r.id, ...JSON.parse(dec.decode(await decryptBytes(r.metaIv, r.meta, r.id))) }); } catch { out.push({ id: r.id, name: 'Nicht lesbarer Eintrag', kind: 'other', size: r.data ? r.data.byteLength : 0, broken: true }); }
  }
  return out.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}
export async function getBlob(id) {
  need();
  const r = await db.getVaultItem(id);
  if (!r) throw Object.assign(new Error('missing'), { userMessage: 'Datei nicht gefunden.' });
  const meta = JSON.parse(dec.decode(await decryptBytes(r.metaIv, r.meta, r.id)));
  const bytes = await decryptBytes(r.dataIv, r.data, r.id);
  return { meta, blob: new Blob([bytes], { type: meta.mime || 'application/octet-stream' }) };
}
export async function removeItem(id) { need(); await db.deleteVaultItem(id); emit(); }
/** Decrypt back into the normal library. */
export async function restoreToLibrary(id) {
  const { meta, blob } = await getBlob(id);
  const { importAny } = await import('../library.js');
  const file = new File([blob], meta.name, { type: meta.mime });
  const doc = await importAny(file, { source: 'Tresor', quiet: true });
  await db.deleteVaultItem(id);
  emit();
  return doc;
}

export async function changePin(oldPin, newPin) {
  const hd = await getHeader();
  if (String(newPin).length < 6) throw Object.assign(new Error('short'), { userMessage: 'Die neue PIN muss mindestens 6 Zeichen lang sein.' });
  let dek;
  try { dek = await unwrapDek(unb64(hd.wrapped), await deriveKek(oldPin, unb64(hd.salt), hd.iter), unb64(hd.iv)); } catch { throw Object.assign(new Error('wrong'), { userMessage: 'Die bisherige PIN ist falsch.' }); }
  const salt = rnd(16), iv = rnd(12);
  const wrapped = await crypto.subtle.wrapKey('raw', dek, await deriveKek(newPin, salt, ITERATIONS), { name: 'AES-GCM', iv });
  await db.setSetting(HEADER_KEY, { ...hd, iter: ITERATIONS, salt: b64(salt), iv: b64(iv), wrapped: b64(wrapped) });
  setUnlocked(dek);
}

export async function destroyVault() {
  await db.clearVault();
  await db.setSetting(HEADER_KEY, null);
  state.dek = null; state.sessionDek = null; state.unlocked = false;
  emit();
}

// ---------------- backup ----------------
export async function exportBackup() {
  const hd = await getHeader();
  const recs = await db.listVault();
  const items = recs.map(r => ({ id: r.id, metaIv: b64(r.metaIv), meta: b64(r.meta), dataIv: b64(r.dataIv), data: b64(r.data) }));
  const { bio, ...header } = hd;
  void bio;
  const json = JSON.stringify({ app: 'FaLe PDF', type: 'tresor-backup', v: 1, exportedAt: new Date().toISOString(), header, items });
  return new Blob([json], { type: 'application/json' });
}
/** Import a backup (needs the PIN that was valid when the backup was made). Returns number of items. */
export async function importBackup(file, pin) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw Object.assign(new Error('bad'), { userMessage: 'Die Datei ist kein FaLe-Tresor-Backup.' }); }
  if (!data || data.type !== 'tresor-backup' || !data.header || !Array.isArray(data.items)) throw Object.assign(new Error('bad'), { userMessage: 'Die Datei ist kein FaLe-Tresor-Backup.' });
  const hd = data.header;
  let bdek;
  try { bdek = await unwrapDek(unb64(hd.wrapped), await deriveKek(pin, unb64(hd.salt), hd.iter || ITERATIONS), unb64(hd.iv)); } catch { throw Object.assign(new Error('wrong'), { userMessage: 'Die PIN passt nicht zu diesem Backup.' }); }
  const existing = await getHeader();
  if (!existing) {
    await db.setSetting(HEADER_KEY, { ...hd, bio: null, createdAt: Date.now() });
    for (const it of data.items) await db.putVaultItem({ id: it.id, v: 1, metaIv: unb64(it.metaIv), meta: unb64(it.meta).buffer, dataIv: unb64(it.dataIv), data: unb64(it.data).buffer });
    setUnlocked(bdek);
    return data.items.length;
  }
  need();
  let n = 0;
  for (const it of data.items) {
    const meta = JSON.parse(dec.decode(await decryptBytes(unb64(it.metaIv), unb64(it.meta), it.id, bdek)));
    const bytes = await decryptBytes(unb64(it.dataIv), unb64(it.data), it.id, bdek);
    await addBlob(new Blob([bytes], { type: meta.mime }), { name: meta.name, kind: meta.kind });
    n++;
  }
  return n;
}

// ---------------- biometrics (WebAuthn platform authenticator) ----------------
export async function biometricsAvailable() {
  try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; }
}
async function prfKey(prfOut) {
  const base = await crypto.subtle.importKey('raw', prfOut, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(16), info: enc.encode('FaLe Tresor v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}
export async function enrollBiometrics() {
  need();
  const prfSalt = rnd(32);
  const cred = await holdLock(() => navigator.credentials.create({ publicKey: {
    challenge: rnd(32), rp: { name: 'FaLe PDF' }, user: { id: rnd(16), name: 'tresor', displayName: 'FaLe Tresor' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
    timeout: 60000, extensions: { prf: { eval: { first: prfSalt } } },
  } }));
  if (!cred) throw Object.assign(new Error('cancel'), { userMessage: 'Biometrie wurde nicht eingerichtet.' });
  const credId = b64(cred.rawId);
  let out = null;
  const ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
  if (ext.prf && ext.prf.results && ext.prf.results.first) out = ext.prf.results.first;
  else if (ext.prf && ext.prf.enabled) {
    const a = await navigator.credentials.get({ publicKey: { challenge: rnd(32), allowCredentials: [{ type: 'public-key', id: unb64(credId) }], userVerification: 'required', extensions: { prf: { eval: { first: prfSalt } } } } });
    const r = a && a.getClientExtensionResults().prf;
    if (r && r.results && r.results.first) out = r.results.first;
  }
  const hd = await getHeader();
  if (out) {
    const iv = rnd(12);
    const wrapped = await crypto.subtle.wrapKey('raw', state.dek, await prfKey(out), { name: 'AES-GCM', iv });
    hd.bio = { mode: 'prf', credId, prfSalt: b64(prfSalt), iv: b64(iv), wrapped: b64(wrapped) };
  } else hd.bio = { mode: 'gate', credId };
  await db.setSetting(HEADER_KEY, hd);
  emit();
  return hd.bio.mode;
}
export async function disableBiometrics() { const hd = await getHeader(); hd.bio = null; await db.setSetting(HEADER_KEY, hd); state.sessionDek = null; emit(); }
/** Unlock with biometrics. 'prf' unwraps the key; 'gate' only works while the PIN-derived key is still in memory. */
export async function unlockBiometric() {
  const hd = await getHeader();
  if (!hd || !hd.bio) return false;
  if (hd.bio.mode === 'gate' && !state.sessionDek) throw Object.assign(new Error('pin'), { userMessage: 'Bitte gib nach dem Neustart der App einmal deine PIN ein.' });
  const a = await holdLock(() => navigator.credentials.get({ publicKey: {
    challenge: rnd(32), allowCredentials: [{ type: 'public-key', id: unb64(hd.bio.credId) }], userVerification: 'required', timeout: 60000,
    ...(hd.bio.mode === 'prf' ? { extensions: { prf: { eval: { first: unb64(hd.bio.prfSalt) } } } } : {}),
  } }));
  if (!a) return false;
  if (hd.bio.mode === 'gate') { setUnlocked(state.sessionDek); return true; }
  const r = a.getClientExtensionResults().prf;
  if (!r || !r.results || !r.results.first) throw Object.assign(new Error('prf'), { userMessage: 'Das Gerät hat keinen Schlüssel geliefert. Bitte entsperre mit der PIN.' });
  try { setUnlocked(await unwrapDek(unb64(hd.bio.wrapped), await prfKey(r.results.first), unb64(hd.bio.iv))); return true; } catch { return false; }
}

// ---------------- dialogs usable from anywhere ----------------
/** Make sure the vault is unlocked (asks for the PIN). Resolves true when unlocked. */
export async function ensureUnlocked() {
  if (isUnlocked()) return true;
  if (!(await isSetUp())) { location.hash = '#/tresor'; return false; }
  const hd = await getHeader();
  const canBio = hd.bio && (hd.bio.mode === 'prf' || state.sessionDek) && await biometricsAvailable();
  const r = await openDialog({
    title: 'Tresor entsperren',
    body: `<label class="field"><span class="field-label">PIN oder Passphrase</span><input class="input" type="password" name="pin" autocomplete="current-password" autofocus></label>
      ${canBio ? `<button class="btn btn-soft btn-block" type="button" data-bio>${oicon('fingerprint')} Mit Biometrie entsperren</button>` : ''}`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Entsperren', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => {
      const b = $('[data-bio]', dlg);
      if (b) b.addEventListener('click', async () => { try { if (await unlockBiometric()) dlg.close(); } catch (e) { errorToast(e, 'Biometrie fehlgeschlagen.'); } });
      return { collect: () => $('[name=pin]', dlg).value };
    },
  });
  if (isUnlocked()) return true;
  if (r.value !== 'ok' || !r.data) return false;
  if (await unlock(r.data)) return true;
  toast('Falsche PIN.', 'error');
  return false;
}

// ---------------- screen ----------------
export async function mount(screen, { params }) {
  // Android: no screenshots / app-switcher thumbnails of the vault (FLAG_SECURE) while it is open
  const releaseSecure = screenSecure(true);
  const wrap = h('<div class="screen-inner vault-screen"></div>');
  screen.body.appendChild(wrap);
  screen.setFoot([]);
  let viewerUrl = null;
  const lockBtn = h(`<button class="btn btn-ghost btn-sm" type="button" data-lock hidden>${oicon('lock')}<span class="hide-sm">Sperren</span></button>`);
  screen.extra.appendChild(lockBtn);
  lockBtn.addEventListener('click', () => lock());

  async function render() {
    closeViewer();
    lockBtn.hidden = !isUnlocked();
    if (!cryptoAvailable()) { wrap.innerHTML = `<div class="empty"><div class="empty-art">${oicon('vault')}</div><h3>Verschlüsselung nicht verfügbar</h3><p>Der Tresor braucht eine sichere Verbindung (HTTPS) oder die installierte App.</p></div>`; return; }
    if (!(await isSetUp())) return renderSetup();
    if (!isUnlocked()) return renderLocked();
    return renderOpen();
  }

  function honesty(hd) {
    const bio = hd && hd.bio;
    return `<details class="card vault-honest"><summary>${oicon('info')}<span>Was schützt deine Dateien?</span>${oicon('chevronDown')}</summary><div class="vh-body">
      <p>Jede Datei wird mit <b>AES-GCM (256 Bit)</b> verschlüsselt, bevor sie gespeichert wird – auch der Dateiname. Der Schlüssel entsteht aus deiner PIN mit <b>PBKDF2-SHA-256 und ${ITERATIONS.toLocaleString('de-DE')} Runden</b> und wird nirgends gespeichert.</p>
      <p>Entsperrt liegen Dateien nur im Arbeitsspeicher. Der Tresor sperrt sich nach ${autoLockMinutes()} Minuten ohne Aktivität und sofort, wenn du die App verlässt.</p>
      ${bio ? (bio.mode === 'prf' ? '<p><b>Biometrie:</b> Dein Gerät liefert über die WebAuthn-PRF-Erweiterung einen eigenen Schlüssel – damit kann der Tresor auch ohne PIN entsperrt werden.</p>' : '<p><b>Biometrie:</b> Dein Gerät unterstützt keine Schlüsselableitung. Fingerabdruck/Gesicht dienen daher nur als bequeme Zugangssperre, solange die App geöffnet ist. Nach einem Neustart brauchst du die PIN; die Verschlüsselung selbst beruht immer auf der PIN.</p>') : ''}
      <p>Eine kurze PIN ist bequem, aber leichter zu erraten, falls jemand dein entsperrtes Gerät und den Browser-Speicher in die Hände bekommt. Für sehr Vertrauliches nimm eine längere Passphrase.</p>
      <p><b>Keine Hintertür:</b> Wer die PIN vergisst, kann die Dateien nicht mehr öffnen – auch nicht mit Hilfe von FaLe.</p></div></details>`;
  }

  function renderSetup() {
    wrap.innerHTML = `<div class="card vault-hero"><span class="vault-ic">${oicon('vault')}</span><div><h2>Dein privater Tresor</h2>
      <p>Für Ausweis-Scans, Verträge, Arztbriefe und alles, was niemand sehen soll – selbst wenn jemand dein entsperrtes Handy in der Hand hat. Dateien werden mit deiner PIN verschlüsselt und bleiben auf diesem Gerät.</p></div></div>
      <form class="card card-pad vault-setup" novalidate>
        <h3>Tresor einrichten</h3>
        <label class="field"><span class="field-label">PIN oder Passphrase (mind. 6 Zeichen)</span><input class="input" type="password" name="pin" autocomplete="new-password" minlength="6" required></label>
        <label class="field"><span class="field-label">Wiederholen</span><input class="input" type="password" name="pin2" autocomplete="new-password" required></label>
        <div class="notice danger-notice">${oicon('info')}<span><b>Wichtig:</b> Wenn du die PIN vergisst, sind die Dateien im Tresor verloren. Es gibt keine Hintertür und keine Wiederherstellung – auch nicht durch FaLe. Erstelle bei Bedarf ein Backup.</span></div>
        <label class="check"><input type="checkbox" name="ack"> Ich habe verstanden, dass eine vergessene PIN nicht ersetzt werden kann.</label>
        <div class="row-actions"><button class="btn btn-primary" type="submit">${oicon('lock')} Tresor einrichten</button>
          <button class="btn btn-ghost" type="button" data-import>${oicon('upload')} Backup importieren</button></div>
      </form>${honesty(null)}`;
    const f = $('form', wrap);
    f.addEventListener('submit', async ev => {
      ev.preventDefault();
      const pin = f.pin.value, pin2 = f.pin2.value;
      if (pin.length < 6) { toast('Die PIN muss mindestens 6 Zeichen lang sein.', 'error'); f.pin.focus(); return; }
      if (pin !== pin2) { toast('Die beiden Eingaben stimmen nicht überein.', 'error'); f.pin2.focus(); return; }
      if (!f.ack.checked) { toast('Bitte bestätige den Hinweis zur PIN.', 'error'); return; }
      const btn = $('[type=submit]', f); btn.disabled = true;
      try { await setupVault(pin); toast('Tresor eingerichtet', 'success'); await afterUnlock(); } catch (e) { errorToast(e, 'Der Tresor konnte nicht eingerichtet werden.'); } finally { btn.disabled = false; }
    });
    $('[data-import]', wrap).addEventListener('click', importFlow);
  }

  async function renderLocked() {
    const hd = await getHeader();
    const canBio = hd.bio && await biometricsAvailable();
    const n = (await db.listVault()).length;
    wrap.innerHTML = `<div class="vault-lock card">
      <span class="vault-ic big">${oicon('lock')}</span>
      <h2>Tresor gesperrt</h2><p class="muted">${n === 1 ? '1 verschlüsselte Datei' : `${n} verschlüsselte Dateien`}</p>
      <form class="vault-unlock" novalidate>
        <label class="sr-only" for="vault-pin">PIN oder Passphrase</label>
        <input class="input" id="vault-pin" type="password" name="pin" autocomplete="current-password" placeholder="PIN oder Passphrase" autofocus>
        <button class="btn btn-primary btn-block" type="submit">Entsperren</button>
        ${canBio ? `<button class="btn btn-soft btn-block" type="button" data-bio>${oicon('fingerprint')} Mit Biometrie entsperren</button>` : ''}
      </form>
      <details class="vault-forgot"><summary>PIN vergessen?</summary><p class="muted small">Ohne PIN lassen sich die Dateien nicht entschlüsseln – das ist der Sinn des Tresors. Du kannst den Tresor nur komplett löschen und neu beginnen.</p>
        <button class="btn btn-danger-ghost btn-sm" type="button" data-destroy>${oicon('trash')} Tresor löschen</button></details>
    </div>${honesty(hd)}`;
    const f = $('form', wrap);
    setTimeout(() => f.pin.focus(), 50);
    f.addEventListener('submit', async ev => {
      ev.preventDefault();
      const btn = $('[type=submit]', f); btn.disabled = true; btn.textContent = 'Wird geprüft …';
      const ok = await unlock(f.pin.value);
      btn.disabled = false; btn.textContent = 'Entsperren';
      if (ok) await afterUnlock();
      else { toast('Falsche PIN.', 'error'); f.pin.select(); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); }
    });
    const b = $('[data-bio]', wrap);
    if (b) b.addEventListener('click', async () => { try { if (await unlockBiometric()) await afterUnlock(); } catch (e) { errorToast(e, 'Biometrie fehlgeschlagen.'); } });
    $('[data-destroy]', wrap).addEventListener('click', async () => {
      if (!await confirmDialog('Tresor endgültig löschen?', 'Alle Dateien im Tresor werden unwiderruflich gelöscht. Das kann nicht rückgängig gemacht werden.', { okLabel: 'Endgültig löschen', danger: true })) return;
      await destroyVault(); toast('Tresor gelöscht'); render();
    });
  }

  async function afterUnlock() {
    const add = params && params.get('add');
    if (add) {
      const ids = add.split(',').filter(Boolean);
      try { const n = await moveDocsToVault(ids); if (n) toast(n === 1 ? 'Datei in den Tresor verschoben' : `${n} Dateien in den Tresor verschoben`, 'success'); } catch (e) { errorToast(e, 'Verschieben fehlgeschlagen.'); }
      history.replaceState(history.state, '', '#/tresor');
      params.delete('add');
    }
    render();
  }

  async function renderOpen() {
    const hd = await getHeader();
    const items = await listItems();
    const bioOk = await biometricsAvailable();
    wrap.innerHTML = `<div class="vault-bar">
        <div><strong>${items.length === 1 ? '1 Datei' : `${items.length} Dateien`}</strong><span class="muted small"> · entsperrt, sperrt nach ${autoLockMinutes()} Min. Inaktivität</span></div>
        <div class="row-actions"><button class="btn btn-soft btn-sm" type="button" data-from-lib>${oicon('folderMove')} Aus Dateien</button>
        <button class="btn btn-primary btn-sm" type="button" data-from-dev>${oicon('upload')} Vom Gerät</button></div></div>
      <div class="doc-list vault-list"></div>
      <h2 class="section-title">Einstellungen</h2>
      <div class="card settings-group">
        <div class="settings-row"><div class="label"><strong>Automatisch sperren</strong><span>Nach Inaktivität. Beim Verlassen der App sperrt der Tresor immer sofort.</span></div>
          <select class="select" data-autolock aria-label="Automatisch sperren nach">${[1, 3, 5, 15].map(m => `<option value="${m}" ${m === autoLockMinutes() ? 'selected' : ''}>${m} Minute${m === 1 ? '' : 'n'}</option>`).join('')}</select></div>
        ${bioOk ? `<div class="settings-row"><div class="label"><strong>Biometrie</strong><span>${hd.bio ? (hd.bio.mode === 'prf' ? 'Aktiv – dein Gerät liefert einen eigenen Schlüssel (PRF).' : 'Aktiv als Zugangssperre in dieser Sitzung (Gerät ohne PRF).') : 'Mit Fingerabdruck oder Gesicht entsperren.'}</span></div>
          <button class="btn btn-${hd.bio ? 'ghost' : 'soft'} btn-sm" type="button" data-bio-toggle>${oicon('fingerprint')} ${hd.bio ? 'Deaktivieren' : 'Einrichten'}</button></div>` : ''}
        <div class="settings-row"><div class="label"><strong>PIN ändern</strong><span>Die Dateien bleiben verschlüsselt, nur der Zugang ändert sich.</span></div>
          <button class="btn btn-ghost btn-sm" type="button" data-pin>${oicon('key')} Ändern</button></div>
        <div class="settings-row"><div class="label"><strong>Backup</strong><span>Verschlüsselte Sicherung – zum Öffnen brauchst du deine aktuelle PIN.</span></div>
          <div class="row-actions"><button class="btn btn-ghost btn-sm" type="button" data-export>${oicon('download')} Exportieren</button><button class="btn btn-ghost btn-sm" type="button" data-import>${oicon('upload')} Importieren</button></div></div>
        <div class="settings-row"><div class="label"><strong>Tresor löschen</strong><span>Entfernt alle Dateien im Tresor unwiderruflich.</span></div>
          <button class="btn btn-danger-ghost btn-sm" type="button" data-destroy>${oicon('trash')} Löschen</button></div>
      </div>${honesty(hd)}`;
    const list = $('.vault-list', wrap);
    if (!items.length) list.appendChild(h(`<div class="empty" style="grid-column:1/-1"><div class="empty-art">${oicon('vault')}</div><h3>Noch leer</h3><p>Lege Dateien aus deiner Bibliothek oder direkt vom Gerät hier ab. Im Menü jeder Datei findest du auch „In den Tresor verschieben“.</p></div>`));
    items.forEach(it => list.appendChild(itemRow(it)));
    $('[data-from-lib]', wrap).addEventListener('click', fromLibrary);
    $('[data-from-dev]', wrap).addEventListener('click', fromDevice);
    $('[data-autolock]', wrap).addEventListener('change', e => { setAutoLockMinutes(+e.target.value); toast('Gespeichert', 'success'); });
    const bt = $('[data-bio-toggle]', wrap);
    if (bt) bt.addEventListener('click', async () => {
      try {
        if (hd.bio) { await disableBiometrics(); toast('Biometrie deaktiviert'); }
        else { const mode = await enrollBiometrics(); toast(mode === 'prf' ? 'Biometrie eingerichtet (mit eigenem Schlüssel)' : 'Biometrie eingerichtet (als Zugangssperre)', 'success'); }
      } catch (e) { errorToast(e, 'Biometrie konnte nicht eingerichtet werden.'); }
      render();
    });
    $('[data-pin]', wrap).addEventListener('click', pinFlow);
    $('[data-export]', wrap).addEventListener('click', async () => { try { downloadBlob(await exportBackup(), `FaLe-Tresor-Backup-${new Date().toISOString().slice(0, 10)}.json`); toast('Backup exportiert – es ist weiterhin verschlüsselt.', 'success'); } catch (e) { errorToast(e, 'Export fehlgeschlagen.'); } });
    $('[data-import]', wrap).addEventListener('click', importFlow);
    $('[data-destroy]', wrap).addEventListener('click', async () => {
      if (!await confirmDialog('Tresor endgültig löschen?', 'Alle Dateien im Tresor werden unwiderruflich gelöscht.', { okLabel: 'Endgültig löschen', danger: true })) return;
      await destroyVault(); toast('Tresor gelöscht'); render();
    });
  }

  function itemRow(it) {
    const kind = KINDS[it.kind] ? it.kind : null;
    const el = h(`<article class="doc vault-item" data-vid="${esc(it.id)}"><button class="doc-open" type="button" aria-label="${esc(it.name)} ansehen">
      <span class="doc-thumb kind">${kind ? kindTile(kind) : `<span class="kind-tile" style="--kc:#5D6488">${oicon('file')}</span>`}</span>
      <span class="doc-info"><span class="doc-name">${esc(it.name)}</span><span class="doc-meta">${oicon('lock')} ${formatSize(it.size)} · ${formatDate(it.addedAt)}</span></span></button>
      <button class="icon-btn more-btn" type="button" aria-label="Aktionen für ${esc(it.name)}">${oicon('more')}</button></article>`);
    $('.doc-open', el).addEventListener('click', () => view(it));
    $('.more-btn', el).addEventListener('click', async e => {
      const anchor = e.currentTarget;
      const { officeMenu } = await import('../office/kinds.js');
      officeMenu(anchor, [
        { label: 'Ansehen', icon: 'eye', onClick: () => view(it) },
        { label: 'Zurück in Dateien holen', icon: 'unlock', onClick: async () => { try { const d = await restoreToLibrary(it.id); toast(`„${d.name}“ liegt wieder unverschlüsselt in deinen Dateien.`, 'success'); render(); } catch (err) { errorToast(err, 'Das hat nicht geklappt.'); } } },
        { label: 'Herunterladen (entschlüsselt)', icon: 'download', onClick: async () => { const { blob, meta } = await getBlob(it.id); downloadBlob(blob, meta.name); } },
        { label: 'Teilen (entschlüsselt)', icon: 'share', onClick: async () => { const { blob, meta } = await getBlob(it.id); shareBlob(blob, meta.name, meta.mime); } },
        '-',
        { label: 'Endgültig löschen', icon: 'trash', danger: true, onClick: async () => { if (await confirmDialog('Datei endgültig löschen?', `„${it.name}“ wird unwiderruflich aus dem Tresor entfernt.`, { okLabel: 'Löschen', danger: true })) { await removeItem(it.id); render(); } } },
      ], { label: it.name });
    });
    return el;
  }

  async function fromLibrary() {
    const docs = await db.listFiles();
    if (!docs.length) { toast('Deine Dateien sind leer.', 'info'); return; }
    const r = await openDialog({
      title: 'Dateien in den Tresor verschieben', wide: true,
      body: `<p class="small">Die gewählten Dateien werden verschlüsselt und aus deinen normalen Dateien entfernt (nicht in den Papierkorb).</p><div class="pick-list">${docs.map(d => `<label class="pick-item"><input type="checkbox" value="${esc(d.id)}"><span class="doc-thumb kind">${kindTile(kindOf(d))}</span><span class="doc-info"><span class="doc-name">${esc(d.name)}</span><span class="doc-meta">${formatSize(d.size)}</span></span></label>`).join('')}</div>`,
      actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Verschieben', value: 'ok', kind: 'btn-primary', default: true }],
      onMount: dlg => ({ collect: () => $$('input:checked', dlg).map(i => i.value) }),
    });
    if (r.value !== 'ok' || !r.data || !r.data.length) return;
    try { const n = await moveDocsToVault(r.data); toast(n === 1 ? 'Datei in den Tresor verschoben' : `${n} Dateien in den Tresor verschoben`, 'success'); } catch (e) { errorToast(e, 'Verschieben fehlgeschlagen.'); }
    render();
  }
  async function fromDevice() {
    const files = await holdLock(() => pickFiles({ accept: ACCEPT_ALL + ',*/*', multiple: true }));
    if (!files.length) return;
    const prog = progress('Wird verschlüsselt …');
    try { for (const f of files) await addBlob(f, { name: f.name }); toast(files.length === 1 ? 'Datei verschlüsselt gespeichert' : `${files.length} Dateien verschlüsselt gespeichert`, 'success'); } catch (e) { errorToast(e, 'Verschlüsseln fehlgeschlagen.'); } finally { prog.done(); }
    render();
  }
  async function pinFlow() {
    const r = await openDialog({
      title: 'PIN ändern',
      body: `<label class="field"><span class="field-label">Bisherige PIN</span><input class="input" type="password" name="old" autocomplete="current-password" autofocus></label>
        <label class="field"><span class="field-label">Neue PIN (mind. 6 Zeichen)</span><input class="input" type="password" name="new" autocomplete="new-password"></label>
        <label class="field"><span class="field-label">Neue PIN wiederholen</span><input class="input" type="password" name="new2" autocomplete="new-password"></label>`,
      actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Ändern', value: 'ok', kind: 'btn-primary', default: true }],
      onMount: dlg => ({ collect: () => ({ o: $('[name=old]', dlg).value, n: $('[name=new]', dlg).value, n2: $('[name=new2]', dlg).value }) }),
    });
    if (r.value !== 'ok') return;
    if (r.data.n !== r.data.n2) { toast('Die neuen PINs stimmen nicht überein.', 'error'); return; }
    try { await changePin(r.data.o, r.data.n); toast('PIN geändert', 'success'); } catch (e) { errorToast(e, 'PIN konnte nicht geändert werden.'); }
  }
  async function importFlow() {
    const files = await holdLock(() => pickFiles({ accept: '.json,application/json', multiple: false }));
    if (!files.length) return;
    const r = await openDialog({ title: 'Backup importieren', body: '<label class="field"><span class="field-label">PIN, mit der das Backup erstellt wurde</span><input class="input" type="password" name="pin" autofocus></label>', actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Importieren', value: 'ok', kind: 'btn-primary', default: true }], onMount: dlg => ({ collect: () => $('[name=pin]', dlg).value }) });
    if (r.value !== 'ok') return;
    if ((await isSetUp()) && !isUnlocked() && !(await ensureUnlocked())) return;
    const prog = progress('Backup wird importiert …');
    try { const n = await importBackup(files[0], r.data); toast(`${n} Datei${n === 1 ? '' : 'en'} importiert`, 'success'); } catch (e) { errorToast(e, 'Import fehlgeschlagen.'); } finally { prog.done(); }
    render();
  }

  // ---- in-memory viewer ----
  function closeViewer() {
    const ov = document.querySelector('.vault-viewer');
    if (ov) ov.remove();
    if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null; }
  }
  async function view(it) {
    let res;
    try { res = await getBlob(it.id); } catch (e) { errorToast(e, 'Die Datei konnte nicht entschlüsselt werden.'); return; }
    closeViewer();
    const { meta, blob } = res;
    const ov = h(`<div class="vault-viewer" role="dialog" aria-label="${esc(meta.name)}"><header class="vv-head"><button class="icon-btn" type="button" data-close aria-label="Schließen">${oicon('close')}</button><strong>${esc(meta.name)}</strong><span class="vv-badge">${oicon('lock')} nur im Speicher</span></header><div class="vv-body"><div class="v-loading"><div><span class="spinner dark"></span></div></div></div></div>`);
    screen.root.appendChild(ov);
    $('[data-close]', ov).addEventListener('click', closeViewer);
    const body = $('.vv-body', ov);
    const kind = meta.kind;
    try {
      if (kind === 'image') { viewerUrl = URL.createObjectURL(blob); body.innerHTML = `<img class="vv-img" src="${viewerUrl}" alt="${esc(meta.name)}">`; }
      else if (kind === 'txt' || kind === 'md' || kind === 'csv') { body.innerHTML = `<pre class="vv-text"></pre>`; $('pre', body).textContent = await blob.text(); }
      else if (kind === 'pdf') {
        const { loadPdf, renderPage } = await import('../pdfcore.js');
        const { pdf } = await loadPdf(new Uint8Array(await blob.arrayBuffer()), { name: meta.name });
        body.innerHTML = '<div class="vv-pages"></div>';
        const pages = $('.vv-pages', body);
        const w = Math.min(900, body.clientWidth - 24);
        for (let i = 1; i <= Math.min(pdf.numPages, 60); i++) {
          if (!ov.isConnected) break;
          const page = await pdf.getPage(i);
          const c = await renderPage(page, { width: w, dpr: Math.min(2, window.devicePixelRatio || 1) });
          c.classList.add('vv-page'); c.style.width = `${w}px`;
          pages.appendChild(c);
        }
        pdf.destroy();
      } else if (kind === 'docx') {
        const { docxToHtml } = await import('../office/docx-read.js');
        const { sanitizeHtml } = await import('../office/writer.js');
        const r2 = await docxToHtml(await blob.arrayBuffer(), meta.name);
        let clean = sanitizeHtml(r2.html);
        try { clean = await sanitizeDocHtml(clean); } catch {}
        body.innerHTML = `<div class="vv-doc doc-page">${clean}</div>`;
      } else {
        body.innerHTML = `<div class="empty"><div class="empty-art">${oicon('file')}</div><h3>Keine Vorschau</h3><p>Hole die Datei zurück in deine Dateien oder lade sie herunter, um sie zu öffnen.</p></div>`;
      }
    } catch (e) { console.warn(e); body.innerHTML = '<p class="panel-empty">Vorschau nicht möglich.</p>'; }
  }

  try { await render(); } catch (e) { releaseSecure(); throw e; }
  const off = onVaultChange(() => { render(); });
  return () => { off(); closeViewer(); releaseSecure(); };
}
