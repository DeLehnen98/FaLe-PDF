'use strict';
// POST /api/account?a=config|me|link|delete – the server side of the optional FaLe-Konto.
//
// Sign-in (E-Mail + 6-stelliger Code), sessions and FaLe Sync run directly between the app and
// Supabase (Auth REST API, PostgREST RPCs and Storage with RLS on auth.uid()); this endpoint only
//   config  – public settings for the client (Supabase URL + publishable key, feature flags). No secrets.
//   me      – Plus status of the account (Plus can be bought in the Android app and then follows the account)
//   link    – links a Plus subscription that was verified for this device to the signed-in account
//   delete  – deletes the account: the user's sync objects in Storage (with the user's own token – we have
//             no service key), then all rows via a secret-gated SQL function; the auth user is deleted by
//             that function when allowed, else with SUPABASE_SERVICE_ROLE_KEY (optional) or by the owner.
// Access tokens are verified server-side (JWKS or /auth/v1/user, see supa-auth.js). Nothing is logged.
const C = require('./config');
const H = require('./http');
const Sec = require('./security');
const A = require('./supa-auth');
const { getAccountStore } = require('./accountstore');
const { getShareStore } = require('./sharestore');

const BUCKET = 'sync';

function makeAccountCore(overrides = {}) {
  const deps = {
    getConfig: C.getConfig, getAccountStore, getShareStore,
    fetchImpl: (...a) => fetch(...a), now: () => new Date(),
    verify: (cfg, token, opts) => A.verifyAccessToken(cfg, token, { fetchImpl: deps.fetchImpl, ...opts }),
    ...overrides,
  };

  function requireAccount(cfg) {
    if (!C.accountConfigured(cfg)) throw new H.HttpError(503, 'account_not_configured', 'Das FaLe-Konto ist bald verfügbar.');
  }
  function requireStore(cfg) {
    if (!C.secretsConfigured(cfg) || !C.storeConfigured(cfg)) throw new H.HttpError(503, 'account_not_configured', 'Das FaLe-Konto ist bald verfügbar.');
  }
  async function userOf(req, body, cfg, opts) {
    const token = A.bearerOf(req, body);
    if (!token) throw new H.HttpError(401, 'invalid_account', 'Bitte melde dich an.');
    return { user: await deps.verify(cfg, token, opts), token };
  }
  /** Per-account + per-IP daily limit (shared counter table of the share feature; skipped if unavailable). */
  async function limit(cfg, req, user, kind) {
    const now = deps.now();
    const day = Sec.dayKey(cfg.timeZone, now);
    const ip = Sec.ipHash(cfg.ipSalt, H.clientIp(req), day);
    let r;
    try {
      r = await deps.getShareStore(cfg).rate({ day, kind, keys: ['a:' + A.accountKey(cfg.tokenSecret, user.id), 'i:' + ip], nLimits: [cfg.accountDaily, cfg.accountIpDaily], bytes: 0, bLimits: [1, 1] });
    } catch (e) { return; } // counter table missing → no extra limit (Supabase Auth still rate-limits sign-ins)
    if (r && r.ok === false) throw new H.HttpError(429, 'account_limit', 'Zu viele Anfragen heute. Bitte versuche es morgen erneut.');
  }
  const plusView = (p, now) => (p && new Date(p.expiresAt).getTime() > now.getTime()
    ? { active: true, product: p.product, expiresAt: new Date(p.expiresAt).toISOString() } : { active: false });

  // ---------------------------------------------------------------- Storage cleanup with the user's own token
  async function storageCall(cfg, token, method, path, body) {
    const r = await deps.fetchImpl(`${cfg.supabaseUrl}/storage/v1/${path}`, {
      method, headers: { apikey: cfg.supabaseKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) { const e = new Error('storage http ' + r.status); e.status = r.status; throw e; }
    return r.json().catch(() => null);
  }
  /** Delete everything under <uid>/ (two levels: <uid>/<blob>/<n>). Returns { deleted, complete }. */
  async function wipeObjects(cfg, token, uid, deadline) {
    let deleted = 0;
    for (let round = 0; round < 50 && Date.now() < deadline; round++) {
      const top = await storageCall(cfg, token, 'POST', `object/list/${BUCKET}`, { prefix: `${uid}/`, limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } });
      const folders = (Array.isArray(top) ? top : []).map(x => x && x.name).filter(n => typeof n === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(n));
      if (!folders.length) return { deleted, complete: true };
      for (const f of folders) {
        if (Date.now() > deadline) return { deleted, complete: false };
        const files = await storageCall(cfg, token, 'POST', `object/list/${BUCKET}`, { prefix: `${uid}/${f}/`, limit: 1000, offset: 0 });
        const names = (Array.isArray(files) ? files : []).map(x => x && x.name).filter(n => typeof n === 'string' && /^[0-9A-Za-z_.-]{1,64}$/.test(n)).map(n => `${uid}/${f}/${n}`);
        for (let i = 0; i < names.length; i += 900) {
          const del = await storageCall(cfg, token, 'DELETE', `object/${BUCKET}`, { prefixes: names.slice(i, i + 900) });
          deleted += Array.isArray(del) ? del.length : 0;
        }
      }
    }
    return { deleted, complete: false };
  }

  async function adminDeleteUser(cfg, uid) {
    if (!cfg.serviceRoleKey) return false;
    try {
      const r = await deps.fetchImpl(`${cfg.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(uid)}`, {
        method: 'DELETE', headers: { apikey: cfg.serviceRoleKey, Authorization: `Bearer ${cfg.serviceRoleKey}` },
      });
      return r.ok || r.status === 404;
    } catch { return false; }
  }

  const account = H.handler(['POST'], async (req, res, cfg) => {
    const a = String(H.query(req).a || '');
    if (a === 'config') {
      const configured = C.accountConfigured(cfg);
      H.sendJson(res, 200, {
        ok: true, configured,
        supabaseUrl: configured ? cfg.supabaseUrl : null,
        supabaseKey: configured ? cfg.supabaseKey : null, // publishable key – public by design
        features: { email: configured, google: configured && cfg.authGoogle, sync: configured },
        region: 'eu-central-1',
      });
      return;
    }
    requireAccount(cfg);
    const body = await H.readJson(req, 8192);

    if (a === 'me') {
      requireStore(cfg);
      const { user } = await userOf(req, body, cfg);
      await limit(cfg, req, user, 'acct');
      const p = await deps.getAccountStore(cfg).plusGet({ user: user.id });
      H.sendJson(res, 200, { ok: true, user: { id: user.id, email: user.email }, plus: plusView(p, deps.now()) });
      return;
    }
    if (a === 'link') {
      requireStore(cfg);
      const { user } = await userOf(req, body, cfg);
      const device = Sec.verifyToken(cfg.tokenSecret, body.token);
      if (!device) throw new H.HttpError(401, 'invalid_token', 'Gerätekennung ungültig – bitte erneut verbinden');
      await limit(cfg, req, user, 'acct');
      const r = await deps.getAccountStore(cfg).plusLink({ user: user.id, device });
      const p = await deps.getAccountStore(cfg).plusGet({ user: user.id });
      H.sendJson(res, 200, { ok: true, linked: !!(r && r.linked), plus: plusView(p, deps.now()) });
      return;
    }
    if (a === 'delete') {
      requireStore(cfg);
      if (body.confirm !== 'LÖSCHEN') throw new H.HttpError(400, 'bad_input', 'Bitte bestätige das Löschen.');
      const { user, token } = await userOf(req, body, cfg, { fresh: true }); // always ask Supabase Auth: the session must still be valid
      await limit(cfg, req, user, 'acct');
      let wiped = { deleted: 0, complete: false };
      try { wiped = await wipeObjects(cfg, token, user.id, Date.now() + 35000); } catch { /* storage not reachable – remaining objects are reported below */ }
      const r = await deps.getAccountStore(cfg).deleteAccount({ user: user.id });
      let authDeleted = !!r.authDeleted;
      if (!authDeleted && await adminDeleteUser(cfg, user.id)) {
        authDeleted = true;
        try { await deps.getAccountStore(cfg).markDeleted({ user: user.id }); } catch {}
      }
      H.sendJson(res, 200, { ok: true, deleted: true, authDeleted, objectsDeleted: wiped.deleted, remainingObjects: r.remaining });
      return;
    }
    throw new H.HttpError(400, 'unknown_action', 'Unbekannte Aktion');
  }, { getConfig: () => deps.getConfig() });

  return { account, deps };
}

module.exports = { makeAccountCore };
