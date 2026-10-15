// FaLe-Konto master key (MK) for FaLe One (contract §5.1). The same key as FaLe Sync in FaLe PDF:
// created on the first device, wrapped by the Sync-Passwort and by the printable recovery key, stored
// server-side only in wrapped form (sync_keys via the sync_status / sync_keys_put RPCs).
// On this device MK lives only as a NON-EXTRACTABLE HKDF CryptoKey in IndexedDB; the raw bytes exist for a
// moment while (un)wrapping and are wiped right after.
import * as SK from './shared/sync/crypto.js';
import { rpc, currentUser } from './auth.js';
import { kv } from './idb.js';
import { t } from './i18n.js';

export const MIN_PASSWORD = 10;
const userErr = (code, msg) => Object.assign(new Error(msg), { code, userMessage: msg });

/** Server state: { key: record | null } */
export async function remoteStatus() { return rpc('sync_status'); }

/** The unlocked master key of this device, or null. → { key: CryptoKey, keyId } */
export async function localKey() {
  const key = await kv.get('mk', null).catch(() => null);
  const keyId = await kv.get('mkId', null).catch(() => null);
  return key && keyId ? { key, keyId } : null;
}
async function store(key, keyId) { await kv.set('mk', key); await kv.set('mkId', keyId); }
export async function forgetLocalKey() { await kv.del('mk'); await kv.del('mkId'); }

/** First device: create MK. Returns the recovery key text – show it ONCE. */
export async function setup(password) {
  if (String(password || '').length < MIN_PASSWORD) throw userErr('short', t('Das Sync-Passwort muss mindestens {n} Zeichen lang sein.', { n: MIN_PASSWORD }));
  const user = await currentUser();
  const k = await SK.createKeys(user.id, password);
  const r = await rpc('sync_keys_put', { p_key_id: k.record.key_id, p_kdf: k.record.kdf, p_wrapped_pw: k.record.wrapped_pw, p_wrapped_rk: k.record.wrapped_rk, p_mode: 'create' });
  if (!r || !r.ok) {
    if (r && r.reason === 'exists') throw userErr('exists', t('Für dein Konto gibt es schon ein Sync-Passwort. Bitte entsperre mit diesem Passwort.'));
    if (r && r.reason === 'not_empty') throw userErr('not_empty', t('In deinem Konto liegen noch alte FaLe-Sync-Daten ohne Schlüssel. Lösche sie zuerst in FaLe PDF (Konto → Cloud-Daten löschen).'));
    throw userErr('failed', t('Das Sync-Passwort konnte nicht gespeichert werden. Bitte versuche es erneut.'));
  }
  await store(k.key, k.keyId);
  return k.recoveryText;
}

/** Another device: unlock with the Sync-Passwort or the recovery key. */
export async function unlock({ password = null, recovery = null }) {
  const user = await currentUser();
  const st = await remoteStatus();
  if (!st || !st.key) throw userErr('no_key', t('Für dein Konto ist noch kein Sync-Passwort festgelegt.'));
  const raw = await SK.unwrapMaster(user.id, st.key, password != null ? { password } : { recovery });
  let imported;
  try { imported = await SK.importMaster(raw); } finally { raw.fill(0); }
  if (imported.keyId !== st.key.key_id) throw userErr('mismatch', t('Der Schlüssel passt nicht zu diesem Konto.'));
  await store(imported.key, imported.keyId);
  return true;
}

/** Is the stored key still the account's key? (another device may have created a new one after a reset) */
export async function verifyLocal() {
  const lk = await localKey();
  if (!lk) return 'locked';
  const st = await remoteStatus();
  if (!st || !st.key) return 'nokey';
  return st.key.key_id === lk.keyId ? 'ok' : 'changed';
}

async function withMaster(secret, fn) {
  const user = await currentUser();
  const st = await remoteStatus();
  if (!st || !st.key) throw userErr('no_key', t('Für dein Konto ist noch kein Sync-Passwort festgelegt.'));
  const raw = await SK.unwrapMaster(user.id, st.key, secret);
  try { return await fn(user, raw, st.key); } finally { raw.fill(0); }
}
/** Change the Sync-Passwort (needs the current password or the recovery key). The recovery key stays valid. */
export async function changePassword(secret, newPassword) {
  if (String(newPassword || '').length < MIN_PASSWORD) throw userErr('short', t('Das Sync-Passwort muss mindestens {n} Zeichen lang sein.', { n: MIN_PASSWORD }));
  return withMaster(secret, async (user, raw, rec) => {
    const { record } = await SK.rewrap(user.id, rec, raw, { password: newPassword });
    const r = await rpc('sync_keys_put', { p_key_id: record.key_id, p_kdf: record.kdf, p_wrapped_pw: record.wrapped_pw, p_wrapped_rk: record.wrapped_rk, p_mode: 'update' });
    if (!r || !r.ok) throw userErr('failed', t('Das Passwort konnte nicht geändert werden.'));
    return true;
  });
}
/** New recovery key (the old one stops working immediately). → key text, shown once */
export async function newRecoveryKey(secret) {
  return withMaster(secret, async (user, raw, rec) => {
    const { record, recoveryText } = await SK.rewrap(user.id, rec, raw, { newRecovery: true });
    const r = await rpc('sync_keys_put', { p_key_id: record.key_id, p_kdf: record.kdf, p_wrapped_pw: record.wrapped_pw, p_wrapped_rk: record.wrapped_rk, p_mode: 'update' });
    if (!r || !r.ok) throw userErr('failed', t('Der Schlüssel konnte nicht erneuert werden.'));
    return recoveryText;
  });
}
/** Recovery kit as a plain text file (no secrets other than the key itself). */
export function recoveryKit(text, email) {
  const lines = [
    t('FaLe One – Wiederherstellungs-Kit'), '',
    t('Konto: {email}', { email }),
    t('Erstellt: {date}', { date: new Date().toLocaleString() }), '',
    t('Wiederherstellungsschlüssel:'), '', '    ' + text, '',
    t('Mit diesem Schlüssel entsperrst du deine verschlüsselten Fotos und Dateien, wenn du dein Sync-Passwort vergessen hast.'),
    t('Bewahre ihn offline auf (ausgedruckt oder in einem Passwort-Manager). Wer ihn hat, kann deine Daten entschlüsseln.'),
    t('FaLe kennt weder dein Passwort noch diesen Schlüssel und kann beides nicht zurücksetzen.'), '',
  ];
  return new Blob([lines.join('\r\n')], { type: 'text/plain;charset=utf-8' });
}
export { SK };
