'use strict';
// Request handling for the FaLe PDF AI endpoints. The files in /api only wire these
// handlers to Vercel; tests call them directly with an in-memory store and the mock provider.
//
// Privacy: no request content is logged or stored. The store only keeps counters keyed by a
// pseudonymous device hash and a salted, day-scoped IP hash (purged after 30 days).
const C = require('./config');
const H = require('./http');
const Sec = require('./security');
const { TASKS, finishJson, finishText } = require('./tasks');
const { getStore } = require('./store');
const { getProvider, ProviderError } = require('./providers');

const round6 = x => Math.round(x * 1e6) / 1e6;
const estTokens = chars => Math.ceil(chars / 3.2);

function makeCore(overrides = {}) {
  const deps = {
    getConfig: C.getConfig,
    getStore,
    getProvider,
    fetchImpl: (...a) => fetch(...a),
    now: () => new Date(),
    ...overrides,
  };

  function ctxOf(req, cfg) {
    const now = deps.now();
    const day = Sec.dayKey(cfg.timeZone, now);
    return { now, day, month: day.slice(0, 7), ip: Sec.ipHash(cfg.ipSalt, H.clientIp(req), day) };
  }

  function requireBase(cfg) {
    if (!C.secretsConfigured(cfg) || !C.storeConfigured(cfg)) throw new H.HttpError(503, 'ai_not_configured', 'KI kommt bald');
  }

  function deviceOf(cfg, token) {
    const dh = Sec.verifyToken(cfg.tokenSecret, token);
    if (!dh) throw new H.HttpError(401, 'invalid_token', 'Gerätekennung ungültig – bitte erneut verbinden');
    return dh;
  }

  async function plusOf(store, device, now) {
    try {
      const p = await store.plusGet({ device });
      if (p && new Date(p.expiresAt).getTime() > now.getTime()) return { active: true, product: p.product, expiresAt: new Date(p.expiresAt).toISOString() };
    } catch (e) { if (e && e.code === 'store_error') throw e; }
    return { active: false };
  }

  function quotaView(cfg, st, plus) {
    const limit = plus.active ? cfg.plusDaily : cfg.freeDaily + (st.rewarded || 0) * cfg.rewardBonus;
    return {
      used: st.used || 0, limit, remaining: Math.max(0, limit - (st.used || 0)),
      free: cfg.freeDaily, rewarded: st.rewarded || 0, bonus: cfg.rewardBonus,
      rewardsLeft: plus.active || !cfg.adsEnabled ? 0 : Math.max(0, cfg.rewardMaxPerDay - (st.rewarded || 0)),
      plus: plus.active, plusUntil: plus.expiresAt || null,
    };
  }

  function providerInfo(cfg) {
    return { id: cfg.provider, label: cfg.providerLabel, company: cfg.providerCompany, privacy: cfg.providerNote };
  }

  // ---------------------------------------------------------------- POST /api/ai/register
  const register = H.handler(['POST'], async (req, res, cfg) => {
    requireBase(cfg);
    const body = await H.readJson(req, 4096);
    const id = body.deviceId;
    if (typeof id !== 'string' || !Sec.DEVICE_ID_RE.test(id)) throw new H.HttpError(400, 'bad_input', 'Ungültige Gerätekennung');
    const c = ctxOf(req, cfg);
    const store = deps.getStore(cfg);
    const r = await store.registerIp({ ip: c.ip, day: c.day, limit: cfg.registerIpDaily });
    if (!r || !r.ok) throw new H.HttpError(429, 'ip_limit', 'Zu viele neue Geräte von diesem Netzwerk heute.');
    const token = Sec.issueToken(cfg.tokenSecret, Sec.deviceHash(cfg.tokenSecret, id), c.now.getTime());
    H.sendJson(res, 200, { ok: true, token });
  }, { getConfig: () => deps.getConfig() });

  // ---------------------------------------------------------------- POST /api/ai/quota
  // Without a token: anonymous availability check (nothing is stored or counted).
  const quota = H.handler(['POST'], async (req, res, cfg) => {
    const body = await H.readJson(req, 4096);
    const configured = C.providerConfigured(cfg) && C.secretsConfigured(cfg) && C.storeConfigured(cfg);
    const out = {
      ok: true, configured, provider: providerInfo(cfg),
      features: { ads: cfg.adsEnabled, plus: C.plusConfigured(cfg) },
      limits: { free: cfg.freeDaily, bonus: cfg.rewardBonus, maxRewards: cfg.rewardMaxPerDay, plusDaily: cfg.plusDaily },
    };
    if (configured && body.token) {
      const device = deviceOf(cfg, body.token);
      const c = ctxOf(req, cfg);
      const store = deps.getStore(cfg);
      const [st, plus, bud] = await Promise.all([store.status({ device, day: c.day }), plusOf(store, device, c.now), store.budgetStatus({ month: c.month })]);
      out.quota = quotaView(cfg, st || {}, plus);
      out.budgetExhausted = (Number(bud && bud.spent) || 0) + (Number(bud && bud.reserved) || 0) >= cfg.monthlyBudgetUsd * 0.995;
    }
    H.sendJson(res, 200, out);
  }, { getConfig: () => deps.getConfig() });

  // ---------------------------------------------------------------- POST /api/ai
  const ai = H.handler(['POST'], async (req, res, cfg) => {
    if (!C.providerConfigured(cfg)) throw new H.HttpError(503, 'ai_not_configured', 'KI kommt bald');
    requireBase(cfg);
    const body = await H.readJson(req, cfg.maxBodyBytes);
    const device = deviceOf(cfg, body.token);
    const task = Object.prototype.hasOwnProperty.call(TASKS, body.task) ? TASKS[body.task] : null;
    if (!task) throw new H.HttpError(400, 'unknown_task', 'Unbekannte Aufgabe');
    const input = body.input && typeof body.input === 'object' && !Array.isArray(body.input) ? body.input : {};
    const options = body.options && typeof body.options === 'object' && !Array.isArray(body.options) ? body.options : {};
    const prep = task.prepare(input, options); // throws 400 bad_input

    const c = ctxOf(req, cfg);
    const store = deps.getStore(cfg);
    const plus = await plusOf(store, device, c.now);

    // 1) quota (atomic check + increment)
    const q = await store.consume({ device, ip: c.ip, day: c.day, free: cfg.freeDaily, bonus: cfg.rewardBonus, plus: plus.active, plusLimit: cfg.plusDaily, ipLimit: cfg.ipDaily });
    if (!q || !q.ok) {
      const view = quotaView(cfg, { used: q ? q.used : 0, rewarded: q ? q.rewarded : 0 }, plus);
      if (q && q.reason === 'ip') throw new H.HttpError(429, 'ip_limit', 'Für dein Netzwerk ist das Tageslimit erreicht. Morgen geht es weiter.', { quota: view });
      throw new H.HttpError(429, 'quota_exhausted', 'Dein KI-Kontingent für heute ist aufgebraucht.', { quota: view });
    }
    let refunded = false;
    const refund = async () => { if (refunded) return; refunded = true; try { await store.refund({ device, ip: c.ip, day: c.day, plus: plus.active }); } catch {} };

    // 2) budget reservation (estimated worst case for this call)
    const inTok = estTokens(prep.system.length + prep.user.length);
    const est = round6((inTok * cfg.priceInUsdPerMTok + prep.maxTokens * cfg.priceOutUsdPerMTok) / 1e6);
    let b;
    try { b = await store.budgetReserve({ month: c.month, est, cap: round6(cfg.monthlyBudgetUsd) }); }
    catch (e) { await refund(); throw e; }
    if (!b || !b.ok) { await refund(); throw new H.HttpError(429, 'budget_exhausted', 'KI-Kontingent für diesen Monat aufgebraucht'); }

    const quotaAfter = quotaView(cfg, { used: q.used, rewarded: q.rewarded }, plus);
    let settled = false;
    const settle = async (usage) => {
      if (settled) return; settled = true;
      const actual = usage ? round6(((usage.input || 0) * cfg.priceInUsdPerMTok + (usage.output || 0) * cfg.priceOutUsdPerMTok) / 1e6) : 0;
      try { await store.budgetSettle({ month: c.month, est, actual }); } catch (e) { console.error('[fale-api] budget settle failed'); }
    };

    const provider = deps.getProvider(cfg, { fetchImpl: deps.fetchImpl });
    const ac = new AbortController();
    res.on && res.on('close', () => { if (!res.writableEnded) ac.abort(); });
    const wantStream = !!task.stream && body.stream === true;
    const call = { task: body.task, system: prep.system, user: prep.user, maxTokens: prep.maxTokens, signal: ac.signal };

    if (!wantStream) {
      let r;
      try { r = await provider.complete({ ...call, stream: false }); }
      catch (e) { await settle(null); await refund(); throw providerHttpError(e); }
      await settle(r.usage);
      let output;
      try { output = task.schema ? finishJson(task, r.text) : finishText(r.text); }
      catch (e) { await refund(); throw e; }
      if (!task.schema && !output) { await refund(); throw new H.HttpError(502, 'bad_output', 'Die KI hat keine Antwort geliefert. Bitte versuche es erneut.'); }
      const cut = r.stop === 'max_tokens' || r.stop === 'length';
      H.sendJson(res, 200, { ok: true, task: body.task, output, truncated: !!prep.truncated, note: prep.note || '', cut, consumed: prep.consumed || null, quota: quotaAfter });
      return;
    }

    // ---- streaming (SSE)
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    const send = (event, data) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {} };
    send('meta', { task: body.task, truncated: !!prep.truncated, note: prep.note || '', quota: quotaAfter });
    let got = '';
    try {
      const r = await provider.complete({ ...call, stream: true, onDelta: t => { got += t; send('delta', { t }); } });
      await settle(r.usage);
      if (!finishText(r.text || got)) { await refund(); send('error', { error: 'bad_output', message: 'Die KI hat keine Antwort geliefert. Bitte versuche es erneut.', quota: quotaView(cfg, { used: q.used - 1, rewarded: q.rewarded }, plus) }); }
      else send('done', { quota: quotaAfter, cut: r.stop === 'max_tokens' || r.stop === 'length', consumed: prep.consumed || null });
    } catch (e) {
      await settle(null);
      if (!got) await refund();
      const he = providerHttpError(e);
      send('error', { error: he.code, message: he.message, quota: got ? quotaAfter : quotaView(cfg, { used: q.used - 1, rewarded: q.rewarded }, plus) });
    }
    res.end();
  }, { getConfig: () => deps.getConfig() });

  // ---------------------------------------------------------------- GET /api/admob-ssv
  const ssv = H.handler(['GET'], async (req, res, cfg) => {
    if (!C.secretsConfigured(cfg) || !C.storeConfigured(cfg)) throw new H.HttpError(503, 'not_configured', 'not configured');
    const raw = H.rawQuery(req);
    const v = await Sec.verifySsv(raw, force => (deps.getVerifierKeys ? deps.getVerifierKeys(force) : Sec.fetchVerifierKeys(cfg.admobKeysUrl, { force, fetchImpl: deps.fetchImpl })));
    if (!v.ok) throw new H.HttpError(400, 'invalid_signature', v.reason);
    const p = v.params;
    if (cfg.admobRewardUnits.length && p.ad_unit && !cfg.admobRewardUnits.some(u => u.endsWith('/' + p.ad_unit) || u === p.ad_unit)) {
      throw new H.HttpError(400, 'unknown_ad_unit', 'unknown ad unit');
    }
    // AdMob's "verify callback" test in the console has no custom data → acknowledge only.
    if (!p.custom_data) { H.sendJson(res, 200, { ok: true, test: true }); return; }
    const device = Sec.verifyToken(cfg.tokenSecret, p.custom_data);
    if (!device) throw new H.HttpError(400, 'invalid_token', 'invalid custom data');
    const tx = String(p.transaction_id || '');
    if (!/^[A-Za-z0-9._:-]{4,128}$/.test(tx)) throw new H.HttpError(400, 'bad_input', 'transaction id');
    const ts = Number(p.timestamp);
    const now = deps.now();
    if (Number.isFinite(ts) && Math.abs(now.getTime() - ts) > 3 * 86400000) throw new H.HttpError(400, 'stale', 'stale callback');
    const day = Sec.dayKey(cfg.timeZone, now);
    const r = await deps.getStore(cfg).rewardRecord({ txid: tx, device, day, max: cfg.rewardMaxPerDay });
    H.sendJson(res, 200, { ok: true, duplicate: !!(r && r.duplicate), capped: !!(r && r.capped) });
  }, { getConfig: () => deps.getConfig(), cors: false });

  // ---------------------------------------------------------------- POST /api/plus-verify
  const plusVerify = H.handler(['POST'], async (req, res, cfg) => {
    if (!C.plusConfigured(cfg)) throw new H.HttpError(503, 'plus_not_configured', 'FaLe Plus ist bald verfügbar.');
    requireBase(cfg);
    const body = await H.readJson(req, 8192);
    const device = deviceOf(cfg, body.token);
    const productId = String(body.productId || '');
    const purchaseToken = String(body.purchaseToken || '');
    if (!cfg.plusProducts.includes(productId)) throw new H.HttpError(400, 'bad_input', 'Unbekanntes Produkt');
    if (!/^[A-Za-z0-9._:-]{10,2000}$/.test(purchaseToken)) throw new H.HttpError(400, 'bad_input', 'Ungültiger Kauf');
    const verify = deps.verifyPlayPurchase || verifyPlaySubscription;
    let sub;
    try { sub = await verify(cfg, purchaseToken, deps.fetchImpl); }
    catch (e) { throw new H.HttpError(502, 'verify_failed', 'Der Kauf konnte gerade nicht bei Google Play geprüft werden. Bitte später erneut versuchen.'); }
    if (!sub || !sub.active) { H.sendJson(res, 200, { ok: true, active: false, reason: sub ? sub.state : 'unknown' }); return; }
    if (sub.productId && sub.productId !== productId && !cfg.plusProducts.includes(sub.productId)) throw new H.HttpError(400, 'bad_input', 'Produkt passt nicht');
    const tokenHash = Sec.sha256hex('play:' + purchaseToken);
    await deps.getStore(cfg).plusUpsert({ device, tokenHash, product: sub.productId || productId, expiresAt: sub.expiresAt });
    H.sendJson(res, 200, { ok: true, active: true, product: sub.productId || productId, expiresAt: sub.expiresAt });
  }, { getConfig: () => deps.getConfig() });

  return { register, quota, ai, ssv, plusVerify, deps };
}

function providerHttpError(e) {
  if (e instanceof H.HttpError) return e;
  if (e instanceof ProviderError) {
    if (e.kind === 'timeout') return new H.HttpError(504, 'provider_timeout', 'Die KI hat zu lange gebraucht. Bitte versuche es mit weniger Text erneut.');
    if (e.kind === 'rate_limited') return new H.HttpError(503, 'provider_busy', 'Die KI ist gerade ausgelastet. Bitte versuche es gleich noch einmal.');
    return new H.HttpError(502, 'provider_error', 'Die KI ist gerade nicht erreichbar. Bitte versuche es später erneut.');
  }
  return new H.HttpError(502, 'provider_error', 'Die KI ist gerade nicht erreichbar. Bitte versuche es später erneut.');
}

/** Google Play Developer API: purchases.subscriptionsv2.get */
async function verifyPlaySubscription(cfg, purchaseToken, fetchImpl = fetch) {
  const at = await Sec.googleAccessToken(cfg.playSaJson, 'https://www.googleapis.com/auth/androidpublisher', { fetchImpl });
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(cfg.playPackage)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const r = await fetchImpl(url, { headers: { Authorization: `Bearer ${at}` } });
  if (r.status === 404 || r.status === 410) return { active: false, state: 'not_found' };
  if (!r.ok) throw new Error('play http ' + r.status);
  const j = await r.json();
  const state = j.subscriptionState || '';
  const items = Array.isArray(j.lineItems) ? j.lineItems : [];
  const best = items.map(li => ({ productId: li.productId, exp: Date.parse(li.expiryTime || '') || 0 })).sort((a, b) => b.exp - a.exp)[0];
  const okState = ['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'SUBSCRIPTION_STATE_CANCELED'].includes(state);
  // CANCELED = auto-renew off but still paid until expiry → active until expiryTime.
  const active = okState && best && best.exp > Date.now();
  return { active: !!active, state, productId: best && best.productId, expiresAt: best ? new Date(best.exp).toISOString() : null };
}

module.exports = { makeCore, verifyPlaySubscription, providerHttpError };
