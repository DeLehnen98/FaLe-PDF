'use strict';
// FaLe One · Notfallzugang – the `em.*` actions of POST /api/drive (contract: docs/FALE-ONE-API.md §12).
// The server only stores ciphertext (wrapped keys, sealed packages, envelopes) and enforces the time lock: a
// contact's sealed package and the covered items are handed out by the SQL functions only after the waiting
// period passed without a veto. Nothing here can decrypt anything.
const H = require('./http');
const { makeNotifier, notifyConfig, flushOutbox } = require('./notify');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const B64_RE = /^[A-Za-z0-9_-]+$/;
const KID_RE = /^[A-Za-z0-9_-]{16,32}$/;
const WAITS = [24, 72, 168, 336, 720];
const bad = (msg = 'Ungültige Anfrage') => new H.HttpError(400, 'bad_input', msg);
const isUuid = v => typeof v === 'string' && UUID_RE.test(v);
const needUuid = (v, what = 'ID') => { if (!isUuid(v)) throw bad(`Ungültige ${what}`); return v; };
const b64 = (v, min, max) => typeof v === 'string' && v.length >= min && v.length <= max && B64_RE.test(v);
const intIn = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;

const MESSAGES = {
  not_found: [404, 'Nicht gefunden'],
  exists: [409, 'Existiert bereits'],
  conflict: [409, 'Wurde inzwischen auf einem anderen Gerät geändert.'],
  too_many: [409, 'Zu viele Einträge.'],
  self: [400, 'Du kannst nicht deine eigene Vertrauensperson sein.'],
  no_key: [409, 'Bitte zuerst den Schlüssel für den Notfallzugang anlegen.'],
  key_changed: [409, 'Der Schlüssel dieser Person hat sich geändert. Bitte vergleicht den Sicherheitscode neu.'],
  incomplete: [409, 'Alle aktiven Vertrauenspersonen müssen neu versiegelt werden.'],
  busy: [409, 'Der Zugang ist gerade freigegeben. Widerrufe ihn zuerst.'],
  no_request: [409, 'Es gibt keine offene Anfrage.'],
  released: [409, 'Die Wartezeit ist schon abgelaufen. Du kannst den Zugang aber widerrufen.'],
  expired: [410, 'Die Einladung ist abgelaufen. Bitte um eine neue.'],
  not_ready: [409, 'Der Notfallzugang ist noch nicht vollständig eingerichtet.'],
  cooldown: [429, 'Die letzte Anfrage wurde abgelehnt. Eine neue Anfrage ist später möglich.'],
  locked: [403, 'Der Zugang ist (noch) nicht freigegeben.'],
  reseal: [409, 'Die Anzahl der nötigen Personen ändert sich über „Neu versiegeln“.'],
  no_user: [401, 'Bitte melde dich erneut an.'],
  bad_input: [400, 'Ungültige Anfrage'],
};
function fail(r) {
  const reason = (r && r.reason) || 'not_found';
  const [status, msg] = MESSAGES[reason] || [400, 'Ungültige Anfrage'];
  const extra = {};
  if (r && r.retry_at) extra.retryAt = r.retry_at;
  if (r && r.version != null) extra.version = Number(r.version);
  if (r && r.slot != null) extra.slot = Number(r.slot);
  return new H.HttpError(status, reason, msg, Object.keys(extra).length ? extra : undefined);
}
const ok = r => { if (!r || !r.ok) throw fail(r); return r; };

// ------------------------------------------------------------------ JSON shapes (camelCase)
function requestOut(r) {
  if (!r) return null;
  return { id: r.id, status: r.status, threshold: Number(r.threshold), waitHours: Number(r.wait_hours), startedAt: r.started_at, thresholdAt: r.threshold_at || null,
    releaseAt: r.release_at || null, releasedAt: r.released_at || null, now: r.now, requesters: (r.requesters || []).map(q => ({ slot: Number(q.slot), at: q.at })) };
}
const closedOut = c => (c ? { status: c.status, closedAt: c.closed_at || null, retryAt: c.retry_at || null } : null);
const logOut = l => ({ id: l.id == null ? undefined : Number(l.id), at: l.at, event: l.event, slot: l.slot == null ? null : Number(l.slot), detail: l.detail || null });
function ownOut(o) {
  if (!o || !o.setup) return null;
  const s = o.setup;
  return {
    setup: { id: s.id, version: Number(s.version), waitHours: Number(s.wait_hours), threshold: Number(s.threshold), ownerKey: s.owner_key, ownerKid: s.owner_kid, scope: s.scope,
      createdAt: s.created_at, updatedAt: s.updated_at, nodeKeys: Number(s.node_keys || 0), albumKeys: Number(s.album_keys || 0) },
    contacts: (o.contacts || []).map(c => ({ slot: Number(c.slot), email: c.email, status: c.status, contactId: c.contact_id || null, kid: c.kid || null, publicJwk: c.pub || null,
      invitedAt: c.invited_at, inviteExpiresAt: c.invite_expires_at, expired: !!c.expired, acceptedAt: c.accepted_at || null, confirmedAt: c.confirmed_at || null })),
    request: requestOut(o.request), lastClosed: closedOut(o.last_closed), log: (o.log || []).map(logOut),
  };
}
function otherOut(x) {
  return { setupId: x.setup_id, ownerId: x.owner_id, ownerEmail: x.owner_email, ownerKid: x.owner_kid, waitHours: Number(x.wait_hours), threshold: Number(x.threshold),
    slot: Number(x.slot), status: x.status, kid: x.kid || null, contacts: Number(x.contacts), inviteExpiresAt: x.invite_expires_at, acceptedAt: x.accepted_at || null,
    confirmedAt: x.confirmed_at || null, request: requestOut(x.request), requested: !!x.requested, readable: !!x.readable, lastClosed: closedOut(x.last_closed) };
}
const blobOut = b => ({ id: b.id, purpose: b.purpose, size: Number(b.size), chunks: Number(b.chunks), chunkSize: Number(b.chunk_size), backend: b.backend });
function emNodeOut(n) {
  const h = n.head;
  return { t: 'node', id: n.id, parent: n.parent || null, kind: n.kind, version: Number(n.version), emKey: n.em_key, meta: n.meta, createdAt: n.created_at, updatedAt: n.updated_at,
    head: h ? { id: h.id, key: h.key, meta: h.meta, size: Number(h.size), createdAt: h.created_at, blobs: (h.blobs || []).map(blobOut) } : null };
}
const emAlbumOut = a => ({ t: 'album', id: a.id, version: Number(a.version), emKey: a.em_key, meta: a.meta, createdAt: a.created_at, updatedAt: a.updated_at, items: a.items || [] });

/**
 * ctx: { store, user, body, limit(kind, nLimits, bytes?, bLimits?), dc (drive config), blobs (blobstore), presignTtl }
 */
function makeEmergency({ fetchImpl } = {}) {
  let notifier = null;
  const getNotifier = () => (notifier || (notifier = makeNotifier({ fetchImpl })));
  const resetNotifier = () => { notifier = null; };

  async function flush(store) {
    try { return await flushOutbox(store, getNotifier(), { limit: 20, budgetMs: 3000 }); } catch { return { sent: 0, failed: 0 }; }
  }

  /** JSON actions. Returns the response object (without ok). */
  async function json(a, { store, user, body, limit, dc, blobs, presignTtl = 900 }) {
    const u = user.id;
    const emLimit = () => limit('one_em', [dc.emDaily, dc.emIpDaily]);
    const setup = () => needUuid(body.setupId, 'Notfall-ID');
    switch (a) {
      case 'em.identity': {
        await emLimit();
        const r = ok(await store.emIdentityGet({ user: u }));
        return { key: r.key ? { keyId: r.key.key_id, publicJwk: r.key.public_jwk, wrappedPrivate: r.key.wrapped_private } : null };
      }
      case 'em.identity.put': {
        await emLimit();
        const j = body.publicJwk;
        if (!KID_RE.test(String(body.keyId || '')) || !j || typeof j !== 'object' || !b64(body.wrapped, 40, 2000) || !['create', 'rewrap'].includes(body.mode)) throw bad();
        ok(await store.emIdentityPut({ user: u, keyId: body.keyId, publicJwk: { kty: j.kty, crv: j.crv, x: j.x, y: j.y }, wrapped: body.wrapped, mode: body.mode }));
        return {};
      }
      case 'em.status': {
        await emLimit();
        const r = ok(await store.emStatus({ user: u }));
        await flush(store);
        return { own: ownOut(r.own), others: (r.others || []).map(otherOut), now: r.now, notify: notifyConfig().kind !== 'none' };
      }
      case 'em.setup': {
        await emLimit();
        const base = body.baseVersion;
        if (!intIn(base, 0, Number.MAX_SAFE_INTEGER) || !WAITS.includes(body.waitHours) || !b64(body.scope, 24, 16384)) throw bad();
        if (base === 0 && (!b64(body.ownerKey, 40, 200) || !KID_RE.test(String(body.ownerKid || '')))) throw bad();
        if (body.threshold != null && !intIn(body.threshold, 1, 3)) throw bad();
        const r = ok(await store.emSetupPut({ user: u, setup: setup(), baseVersion: base, waitHours: body.waitHours, ownerKey: body.ownerKey, ownerKid: body.ownerKid, scope: body.scope,
          threshold: body.threshold == null ? null : body.threshold }));
        return { own: ownOut(r) };
      }
      case 'em.delete': {
        await emLimit();
        if (body.confirm !== true) throw bad('Bitte bestätige das Beenden des Notfallzugangs.');
        const r = ok(await store.emSetupDelete({ user: u }));
        await flush(store);
        return { deleted: !!r.deleted };
      }
      case 'em.invite': {
        await emLimit();
        const email = String(body.email || '').trim().toLowerCase();
        if (email.length < 3 || email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Bitte gib eine gültige E-Mail-Adresse ein.');
        await limit('one_em_inv', [dc.emInviteDaily, dc.emInviteIpDaily]);
        const r = ok(await store.emInvite({ user: u, setup: setup(), email }));
        const f = await flush(store);
        return { slot: Number(r.slot), mailed: f.sent > 0, own: ownOut(r) };
      }
      case 'em.remove': {
        await emLimit();
        if (!intIn(body.slot, 1, 3)) throw bad();
        const r = ok(await store.emContactRemove({ user: u, setup: setup(), slot: body.slot }));
        await flush(store);
        return { own: ownOut(r) };
      }
      case 'em.seal': {
        await emLimit();
        const p = body.packages;
        if (!intIn(body.baseVersion, 1, Number.MAX_SAFE_INTEGER) || !intIn(body.threshold, 1, 3) || !Array.isArray(p) || p.length < 1 || p.length > 3
          || !p.every(x => x && intIn(x.slot, 1, 3) && KID_RE.test(String(x.kid || '')) && b64(x.package, 40, 4000))) throw bad();
        const r = ok(await store.emSeal({ user: u, setup: setup(), baseVersion: body.baseVersion, threshold: body.threshold,
          packages: p.map(x => ({ slot: x.slot, kid: x.kid, package: x.package })) }));
        await flush(store);
        return { own: ownOut(r) };
      }
      case 'em.deny': case 'em.revoke': {
        await emLimit();
        const r = ok(a === 'em.deny' ? await store.emDeny({ user: u, setup: setup() }) : await store.emRevoke({ user: u, setup: setup() }));
        await flush(store);
        return { own: ownOut(r) };
      }
      case 'em.log': {
        await emLimit();
        if (body.before != null && !intIn(body.before, 1, Number.MAX_SAFE_INTEGER)) throw bad();
        if (body.limit != null && !intIn(body.limit, 1, 500)) throw bad();
        const r = ok(await store.emLog({ user: u, before: body.before, limit: body.limit || 100 }));
        return { log: (r.log || []).map(logOut) };
      }
      case 'em.keys.digest': {
        await emLimit();
        const r = ok(await store.emKeysDigest({ user: u, setup: setup() }));
        return { count: Number(r.count), digest: r.digest };
      }
      case 'em.keys.list': {
        await emLimit();
        if (body.after != null && !(typeof body.after === 'string' && /^(node|album):[0-9a-f-]{36}$/.test(body.after))) throw bad();
        if (body.limit != null && !intIn(body.limit, 1, 10000)) throw bad();
        const r = ok(await store.emKeysList({ user: u, setup: setup(), after: body.after || null, limit: body.limit || 5000 }));
        return { items: r.items || [], next: r.next || null };
      }
      case 'em.keys.put': {
        await emLimit();
        const it = body.items;
        if (!Array.isArray(it) || it.length > 500 || !it.every(x => x && ['node', 'album'].includes(x.kind) && isUuid(x.id) && b64(x.key, 40, 200))) throw bad();
        const r = ok(await store.emKeysPut({ user: u, setup: setup(), items: it.map(x => ({ kind: x.kind, id: x.id, key: x.key })) }));
        return { added: Number(r.added), skipped: Number(r.skipped) };
      }
      case 'em.keys.del': {
        await emLimit();
        const it = body.items;
        if (!Array.isArray(it) || it.length > 2000 || !it.every(x => x && ['node', 'album'].includes(x.kind) && isUuid(x.id))) throw bad();
        const r = ok(await store.emKeysDel({ user: u, setup: setup(), items: it.map(x => ({ kind: x.kind, id: x.id })) }));
        return { removed: Number(r.removed) };
      }
      case 'em.accept': case 'em.leave': {
        await emLimit();
        const r = ok(a === 'em.accept' ? await store.emAccept({ user: u, setup: setup() }) : await store.emLeave({ user: u, setup: setup() }));
        await flush(store);
        return a === 'em.accept' ? { slot: Number(r.slot), status: r.status, kid: r.kid } : {};
      }
      case 'em.request': {
        await emLimit();
        await limit('one_em_req', [dc.emRequestDaily, dc.emRequestIpDaily]);
        const r = ok(await store.emRequest({ user: u, setup: setup() }));
        const f = await flush(store);
        return { joined: !!r.joined, request: requestOut(r.request), mailed: f.sent > 0 };
      }
      case 'em.package': {
        await emLimit();
        const r = ok(await store.emPackage({ user: u, setup: setup() }));
        return { ownerId: r.owner_id, slot: Number(r.slot), package: r.package,
          requesters: (r.requesters || []).map(q => ({ slot: Number(q.slot), contactId: q.contact_id, kid: q.kid, publicJwk: q.pub })),
          pool: (r.pool || []).map(p => ({ from: Number(p.from), sealed: p.sealed })) };
      }
      case 'em.pool': {
        await emLimit();
        const it = body.items;
        if (!Array.isArray(it) || it.length > 3 || !it.every(x => x && intIn(x.to, 1, 3) && b64(x.sealed, 40, 4000))) throw bad();
        const r = ok(await store.emPoolPut({ user: u, setup: setup(), items: it.map(x => ({ to: x.to, sealed: x.sealed })) }));
        return { stored: Number(r.stored) };
      }
      case 'em.items': {
        await emLimit();
        if (body.after != null && !isUuid(body.after)) throw bad();
        if (body.limit != null && !intIn(body.limit, 1, 1000)) throw bad();
        const r = ok(await store.emItems({ user: u, setup: setup(), after: body.after || null, limit: body.limit || 500 }));
        return { ownerId: r.owner_id, scope: r.scope, nodes: (r.nodes || []).map(emNodeOut), albums: r.albums ? r.albums.map(emAlbumOut) : null, next: r.next || null };
      }
      case 'em.thumbs': {
        await emLimit();
        const ids = body.ids;
        if (!Array.isArray(ids) || ids.length > 100 || !ids.every(isUuid)) throw bad();
        const r = ok(await store.emThumbs({ user: u, setup: setup(), blobs: [...new Set(ids)] }));
        return { thumbs: r.thumbs || {} };
      }
      case 'em.download.urls': {
        await emLimit();
        const blob = needUuid(body.blobId);
        const from = body.from == null ? 0 : body.from, count = body.count == null ? 100 : body.count;
        if (!intIn(from, 0, 199999) || !intIn(count, 1, 200)) throw bad();
        const r = ok(await store.emBlobInfo({ user: u, setup: setup(), blob, log: from === 0 }));
        const b = r.blob;
        if (b.backend !== 's3' || !blobs || blobs.kind !== 's3') throw new H.HttpError(409, 'not_direct', 'Diese Datei läuft über die API (em.get).');
        const urls = [];
        for (let i = from; i < Math.min(Number(b.chunks), from + count); i++) {
          const size = i < b.chunks - 1 ? Number(b.chunk_size) : Number(b.size) - (b.chunks - 1) * Number(b.chunk_size);
          urls.push({ i, size, ...blobs.presignGet({ user: b.owner, blob, idx: i }) });
        }
        await limit('one_dl', [dc.dailyChunks, dc.ipDailyChunks], urls.reduce((s, x) => s + x.size, 0), [dc.downloadDailyBytes, dc.ipDownloadDailyBytes]);
        return { urls, expiresIn: presignTtl };
      }
      default:
        throw new H.HttpError(400, 'unknown_action', 'Unbekannte Aktion');
    }
  }

  /** Raw chunk of a covered file: POST /api/drive?a=em.get&s=<setupId>&b=<blobId>&i=<index> → bytes */
  async function getChunk({ store, user, setupId, blob, idx, blobs }) {
    const r = await store.emChunkGet({ user: user.id, setup: setupId, blob, idx });
    if (r && r.ok) return Buffer.from(r.data, 'base64');
    if (blobs && blobs.kind === 's3') { // proxy fallback for s3 blobs
      const info = await store.emBlobInfo({ user: user.id, setup: setupId, blob, log: idx === 0 });
      if (info && info.ok && info.blob.backend === 's3' && idx < Number(info.blob.chunks)) return blobs.getChunk({ user: info.blob.owner, blob, idx });
    }
    throw fail({ reason: 'not_found' });
  }

  return { json, getChunk, flush, resetNotifier };
}

module.exports = { makeEmergency, ownOut };
