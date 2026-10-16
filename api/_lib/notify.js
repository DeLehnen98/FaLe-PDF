'use strict';
// Pluggable notifier for FaLe One (Notfallzugang e-mails). The SQL functions write events into an outbox
// (private.fale_em_outbox); the API flushes it after each emergency action and in the gc cron.
//
//   NOTIFY_PROVIDER=resend   RESEND_API_KEY=…, NOTIFY_FROM="FaLe One <notfall@fale.network>"   (https://resend.com)
//   NOTIFY_PROVIDER=webhook  NOTIFY_WEBHOOK_URL=https://…  (+ NOTIFY_WEBHOOK_SECRET → header X-Fale-Signature: HMAC-SHA256 hex of the body)
//   unset / anything else    'none': nothing is sent; the apps show every event in-app (banner on the next start).
//
// Supabase's built-in SMTP only sends Auth mails (and without custom SMTP only to team addresses), so it cannot
// be used here. Mails never contain names, file names or links with secrets – only "who asked / what happened"
// and the app URL.
const crypto = require('node:crypto');

const env = k => String(process.env[k] == null ? '' : process.env[k]).trim();
const { publicOneUrl } = require('./config.js');
const APP_URL = () => publicOneUrl(); // env FALE_ONE_URL or PRIMARY_ONE_URL in config.js

function notifyConfig() {
  const p = env('NOTIFY_PROVIDER').toLowerCase();
  if (p === 'resend' && env('RESEND_API_KEY') && env('NOTIFY_FROM')) return { kind: 'resend' };
  if (p === 'webhook' && /^https:\/\//.test(env('NOTIFY_WEBHOOK_URL'))) return { kind: 'webhook' };
  return { kind: 'none' };
}

/** German + English text for an outbox event. Only addresses and times – never content. */
function render(kind, data = {}) {
  const app = APP_URL();
  const who = data.owner_email || data.contact_email || '';
  const when = data.release_at ? new Date(data.release_at) : null;
  const de = when ? when.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' }) : '';
  const en = when ? when.toLocaleString('en-GB', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' }) + ' (Berlin)' : '';
  const T = {
    invite: [`${who} möchte dich als Vertrauensperson für den Notfall`, `${who} hat dich in FaLe One als Vertrauensperson für den Notfallzugang eingetragen. Melde dich mit dieser E-Mail-Adresse in FaLe One an, um die Einladung anzunehmen und den Sicherheitscode mit ${who} zu vergleichen.`,
      `${who} asked you to be their trusted emergency contact`, `${who} named you as a trusted contact for their FaLe One emergency access. Sign in to FaLe One with this e-mail address to accept and compare the safety code with ${who}.`],
    accepted: [`${who} hat deine Einladung angenommen`, `${who} ist jetzt bereit, deine Vertrauensperson zu sein. Öffne FaLe One und vergleicht den Sicherheitscode (persönlich oder am Telefon), damit der Notfallzugang aktiv wird.`,
      `${who} accepted your invitation`, `${who} is ready to be your trusted contact. Open FaLe One and compare the safety code (in person or by phone) to activate emergency access.`],
    request: [`Notfallzugang angefragt von ${who}`, (when ? `${who} hat Zugang zu deinem Notfallordner angefragt. Ohne Widerspruch wird er am ${de} freigegeben.` : `${who} hat Zugang zu deinem Notfallordner angefragt. Es müssen noch weitere Vertrauenspersonen anfragen.`) + ` Wenn du das nicht willst, öffne FaLe One und tippe auf „Ablehnen“.`,
      `Emergency access requested by ${who}`, (when ? `${who} requested access to your emergency folder. Unless you deny it, it will be released on ${en}.` : `${who} requested access to your emergency folder. More trusted contacts have to ask as well.`) + ` If you don't want this, open FaLe One and tap “Deny”.`],
    denied: [`Anfrage abgelehnt`, `${who} hat deine Anfrage für den Notfallzugang abgelehnt.`, `Request denied`, `${who} denied your emergency access request.`],
    revoked: [`Notfallzugang beendet`, `${who} hat den Notfallzugang widerrufen.`, `Emergency access withdrawn`, `${who} withdrew the emergency access.`],
    released_contact: [`Notfallzugang freigegeben`, `Die Wartezeit ist abgelaufen. Du kannst die Dateien, die ${who} für den Notfall freigegeben hat, jetzt in FaLe One öffnen.`,
      `Emergency access released`, `The waiting period is over. You can now open the files ${who} shared for emergencies in FaLe One.`],
    released_owner: [`Dein Notfallzugang wurde freigegeben`, `Die Wartezeit ist ohne Widerspruch abgelaufen. Deine Vertrauensperson kann deinen Notfallordner jetzt lesen. Du kannst den Zugang in FaLe One jederzeit widerrufen.`,
      `Your emergency access was released`, `The waiting period passed without a veto. Your trusted contact can now read your emergency folder. You can withdraw access in FaLe One at any time.`],
    confirmed: [`Du bist jetzt Vertrauensperson`, `${who} hat den Sicherheitscode bestätigt. Du kannst im Notfall in FaLe One Zugang anfragen.`, `You are now a trusted contact`, `${who} confirmed the safety code. In an emergency you can request access in FaLe One.`],
    removed: [`Nicht mehr Vertrauensperson`, `${who} hat dich als Vertrauensperson entfernt.`, `No longer a trusted contact`, `${who} removed you as a trusted contact.`],
    ended: [`Notfallzugang beendet`, `${who} hat den Notfallzugang beendet.`, `Emergency access ended`, `${who} ended their emergency access.`],
    left: [`Vertrauensperson hat abgesagt`, `${who} ist nicht mehr deine Vertrauensperson.`, `Trusted contact stepped down`, `${who} is no longer your trusted contact.`],
  }[kind];
  if (!T) return null;
  const subject = `FaLe One: ${T[0]} / ${T[2]}`;
  const text = `${T[1]}\n\n${app}\n\n—\n\n${T[3]}\n\n${app}\n\nFaLe One · Ende-zu-Ende-verschlüsselt / end-to-end encrypted\n`;
  return { subject, text };
}

function makeNotifier({ fetchImpl = (...a) => fetch(...a) } = {}) {
  const c = notifyConfig();
  if (c.kind === 'resend') {
    return { kind: 'resend', async send({ to, subject, text }) {
      const r = await fetchImpl('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env('NOTIFY_FROM'), to: [to], subject, text }), signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw Object.assign(new Error('notify http ' + r.status), { code: 'notify_failed' });
    } };
  }
  if (c.kind === 'webhook') {
    return { kind: 'webhook', async send(msg) {
      const body = JSON.stringify(msg);
      const headers = { 'Content-Type': 'application/json' };
      if (env('NOTIFY_WEBHOOK_SECRET')) headers['X-Fale-Signature'] = crypto.createHmac('sha256', env('NOTIFY_WEBHOOK_SECRET')).update(body).digest('hex');
      const r = await fetchImpl(env('NOTIFY_WEBHOOK_URL'), { method: 'POST', headers, body, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw Object.assign(new Error('notify http ' + r.status), { code: 'notify_failed' });
    } };
  }
  return { kind: 'none', async send() { throw Object.assign(new Error('no notifier'), { code: 'notify_off' }); } };
}

/** Send pending outbox events (best effort, bounded). → { sent, failed } */
async function flushOutbox(store, notifier, { limit = 20, budgetMs = 4000 } = {}) {
  const out = { sent: 0, failed: 0 };
  if (!notifier || notifier.kind === 'none') return out;
  const until = Date.now() + budgetMs;
  const r = await store.emOutboxTake({ limit });
  const done = [];
  for (const it of (r && r.items) || []) {
    if (Date.now() > until) break;
    const m = render(it.kind, it.data || {});
    if (!m || !it.to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(it.to)) { done.push(Number(it.id)); continue; }
    try { await notifier.send({ to: it.to, event: it.kind, ...m }); done.push(Number(it.id)); out.sent++; }
    catch { out.failed++; }
  }
  if (done.length) await store.emOutboxDone({ ids: done });
  return out;
}

module.exports = { makeNotifier, notifyConfig, flushOutbox, render };
