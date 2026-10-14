'use strict';
// Storage adapter for counters (no document content is ever stored).
//   supabase: SECURITY DEFINER RPC functions (supabase/migrations/*) via PostgREST with the
//             publishable key; every call carries the server secret FALE_RPC_SECRET.
//   memory:   same semantics in-process (tests / local harness only – not persistent).
//
// Interface (all async):
//   registerIp({ ip, day, limit })                                   → { ok }
//   consume({ device, ip, day, free, bonus, plus, plusLimit, ipLimit }) → { ok, reason?, used, limit, rewarded }
//   refund({ device, ip, day, plus })                                → void
//   status({ device, day })                                          → { used, rewarded }
//   budgetReserve({ month, est, cap })                               → { ok, reserved, spent }
//   budgetSettle({ month, est, actual })                             → void
//   budgetStatus({ month })                                          → { reserved, spent }
//   rewardRecord({ txid, device, day, max })                         → { ok, duplicate, capped, rewarded }
//   plusGet({ device })                                              → { product, expiresAt } | null
//   plusUpsert({ device, tokenHash, product, expiresAt })           → void

function supabaseStore(cfg, { fetchImpl = fetch } = {}) {
  async function rpc(fn, args) {
    const r = await fetchImpl(`${cfg.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: cfg.supabaseKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ p_secret: cfg.rpcSecret, ...args }),
    });
    if (!r.ok) {
      const e = new Error(`store ${fn} http ${r.status}`);
      e.code = 'store_error';
      throw e;
    }
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }
  return {
    kind: 'supabase',
    registerIp: ({ ip, day, limit }) => rpc('fale_register_ip', { p_ip: ip, p_day: day, p_limit: limit }),
    consume: ({ device, ip, day, free, bonus, plus, plusLimit, ipLimit }) => rpc('fale_quota_consume', { p_device: device, p_ip: ip, p_day: day, p_free: free, p_bonus: bonus, p_plus: !!plus, p_plus_limit: plusLimit, p_ip_limit: ipLimit }),
    refund: ({ device, ip, day, plus }) => rpc('fale_quota_refund', { p_device: device, p_ip: ip, p_day: day, p_plus: !!plus }),
    status: ({ device, day }) => rpc('fale_quota_status', { p_device: device, p_day: day }),
    budgetReserve: ({ month, est, cap }) => rpc('fale_budget_reserve', { p_month: month, p_est: est, p_cap: cap }),
    budgetSettle: ({ month, est, actual }) => rpc('fale_budget_settle', { p_month: month, p_est: est, p_actual: actual }),
    budgetStatus: ({ month }) => rpc('fale_budget_status', { p_month: month }),
    rewardRecord: ({ txid, device, day, max }) => rpc('fale_reward_record', { p_txid: txid, p_device: device, p_day: day, p_max: max }),
    plusGet: async ({ device }) => {
      const r = await rpc('fale_plus_get', { p_device: device });
      return r && r.expires_at ? { product: r.product, expiresAt: r.expires_at } : null;
    },
    plusUpsert: ({ device, tokenHash, product, expiresAt }) => rpc('fale_plus_upsert', { p_device: device, p_token_hash: tokenHash, p_product: product, p_expires: expiresAt }),
  };
}

// ------------------------------------------------------------------ in-memory (tests)
function memoryStore() {
  const s = { usage: new Map(), ip: new Map(), budget: new Map(), rewards: new Map(), plus: new Map() };
  const uKey = (day, d) => `${day}|${d}`;
  const usage = (day, d) => { const k = uKey(day, d); if (!s.usage.has(k)) s.usage.set(k, { used: 0, rewarded: 0 }); return s.usage.get(k); };
  const ipRow = (day, ip) => { const k = uKey(day, ip); if (!s.ip.has(k)) s.ip.set(k, { used: 0, registered: 0 }); return s.ip.get(k); };
  const bud = m => { if (!s.budget.has(m)) s.budget.set(m, { reserved: 0, spent: 0 }); return s.budget.get(m); };
  const round6 = x => Math.round(x * 1e6) / 1e6;
  return {
    kind: 'memory',
    _state: s,
    _reset() { Object.values(s).forEach(m => m.clear()); },
    async registerIp({ ip, day, limit }) {
      const r = ipRow(day, ip);
      if (r.registered >= limit) return { ok: false, registered: r.registered };
      r.registered++;
      return { ok: true, registered: r.registered };
    },
    async consume({ device, ip, day, free, bonus, plus, plusLimit, ipLimit }) {
      const u = usage(day, device);
      const limit = plus ? plusLimit : free + u.rewarded * bonus;
      if (u.used >= limit) return { ok: false, reason: 'quota', used: u.used, limit, rewarded: u.rewarded };
      if (!plus) {
        const r = ipRow(day, ip);
        if (r.used >= ipLimit) return { ok: false, reason: 'ip', used: u.used, limit, rewarded: u.rewarded };
        r.used++;
      }
      u.used++;
      return { ok: true, used: u.used, limit, rewarded: u.rewarded };
    },
    async refund({ device, ip, day, plus }) {
      const u = usage(day, device); u.used = Math.max(0, u.used - 1);
      if (!plus) { const r = ipRow(day, ip); r.used = Math.max(0, r.used - 1); }
    },
    async status({ device, day }) { const u = s.usage.get(uKey(day, device)) || { used: 0, rewarded: 0 }; return { used: u.used, rewarded: u.rewarded }; },
    async budgetReserve({ month, est, cap }) {
      const b = bud(month);
      if (b.spent + b.reserved + est > cap) return { ok: false, reserved: b.reserved, spent: b.spent };
      b.reserved = round6(b.reserved + est);
      return { ok: true, reserved: b.reserved, spent: b.spent };
    },
    async budgetSettle({ month, est, actual }) { const b = bud(month); b.reserved = Math.max(0, round6(b.reserved - est)); b.spent = round6(b.spent + actual); },
    async budgetStatus({ month }) { const b = s.budget.get(month) || { reserved: 0, spent: 0 }; return { reserved: b.reserved, spent: b.spent }; },
    async rewardRecord({ txid, device, day, max }) {
      if (s.rewards.has(txid)) return { ok: true, duplicate: true, capped: false, rewarded: usage(day, device).rewarded };
      s.rewards.set(txid, { device, day, at: Date.now() });
      const u = usage(day, device);
      if (u.rewarded >= max) return { ok: true, duplicate: false, capped: true, rewarded: u.rewarded };
      u.rewarded++;
      return { ok: true, duplicate: false, capped: false, rewarded: u.rewarded };
    },
    async plusGet({ device }) { const p = s.plus.get(device); return p ? { product: p.product, expiresAt: p.expiresAt } : null; },
    async plusUpsert({ device, tokenHash, product, expiresAt }) {
      for (const [d, p] of s.plus) if (p.tokenHash === tokenHash && d !== device) s.plus.delete(d);
      s.plus.set(device, { tokenHash, product, expiresAt });
    },
  };
}

let mem = null;
function getStore(cfg) {
  if (cfg.store === 'memory') { if (!mem) mem = memoryStore(); return mem; }
  return supabaseStore(cfg);
}
function _memory() { if (!mem) mem = memoryStore(); return mem; }

module.exports = { getStore, supabaseStore, memoryStore, _memory };
