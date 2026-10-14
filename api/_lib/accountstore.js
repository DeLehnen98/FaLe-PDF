'use strict';
// Storage adapter for the FaLe-Konto parts that our API handles (Plus per account, account deletion).
//   supabase: SECURITY DEFINER RPCs from supabase/migrations/20261014180000_fale_account_sync.sql via
//             PostgREST with the publishable key + FALE_RPC_SECRET (same model as the AI counters).
//   memory:   same semantics in-process (tests only).
// Sync data itself never passes through our API: devices talk to Supabase directly (RLS + auth.uid()).
//
// Interface (all async):
//   plusGet({ user })                                   → { product, expiresAt } | null
//   plusUpsert({ user, tokenHash, product, expiresAt }) → { ok }
//   plusLink({ user, device })                          → { ok, linked, product?, expiresAt? }
//   deleteAccount({ user })                             → { ok, authDeleted, remaining }
//   markDeleted({ user })                               → void

function supabaseAccountStore(cfg, { fetchImpl = fetch } = {}) {
  async function rpc(fn, args) {
    const r = await fetchImpl(`${cfg.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: cfg.supabaseKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ p_secret: cfg.rpcSecret, ...args }),
    });
    if (!r.ok) {
      const e = new Error(`store ${fn} http ${r.status}`);
      e.code = 'store_error';
      e.status = r.status;
      throw e;
    }
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }
  return {
    kind: 'supabase',
    plusGet: async ({ user }) => {
      const r = await rpc('fale_account_plus_get', { p_user: user });
      return r && r.expires_at ? { product: r.product, expiresAt: r.expires_at } : null;
    },
    plusUpsert: ({ user, tokenHash, product, expiresAt }) => rpc('fale_account_plus_upsert', { p_user: user, p_token_hash: tokenHash, p_product: product, p_expires: expiresAt }),
    plusLink: async ({ user, device }) => {
      const r = await rpc('fale_account_plus_link', { p_user: user, p_device: device });
      return { ok: !!(r && r.ok), linked: !!(r && r.linked), product: r && r.product, expiresAt: r && r.expires_at };
    },
    deleteAccount: async ({ user }) => {
      const r = await rpc('fale_account_delete', { p_user: user });
      return { ok: !!(r && r.ok), authDeleted: !!(r && r.auth_deleted), remaining: Number((r && r.remaining_objects) || 0) };
    },
    markDeleted: ({ user }) => rpc('fale_account_deleted', { p_user: user }),
  };
}

function memoryAccountStore() {
  const s = { plus: new Map(), deleted: new Map() };
  return {
    kind: 'memory',
    _state: s,
    _reset() { s.plus.clear(); s.deleted.clear(); },
    async plusGet({ user }) { const p = s.plus.get(user); return p ? { product: p.product, expiresAt: p.expiresAt } : null; },
    async plusUpsert({ user, tokenHash, product, expiresAt }) {
      for (const [u, p] of s.plus) if (p.tokenHash === tokenHash && u !== user) s.plus.delete(u);
      s.plus.set(user, { tokenHash, product, expiresAt });
      return { ok: true };
    },
    async plusLink({ user, device }) {
      const { _memory } = require('./store');
      const d = _memory()._state.plus.get(device);
      if (!d || new Date(d.expiresAt).getTime() <= Date.now()) return { ok: true, linked: false };
      for (const [u, p] of s.plus) if (p.tokenHash === d.tokenHash && u !== user) s.plus.delete(u);
      s.plus.set(user, { tokenHash: d.tokenHash, product: d.product, expiresAt: d.expiresAt });
      return { ok: true, linked: true, product: d.product, expiresAt: d.expiresAt };
    },
    async deleteAccount({ user }) { s.plus.delete(user); s.deleted.set(user, Date.now()); return { ok: true, authDeleted: false, remaining: 0 }; },
    async markDeleted() {},
  };
}

let mem = null;
function getAccountStore(cfg) {
  if (cfg.store === 'memory') { if (!mem) mem = memoryAccountStore(); return mem; }
  return supabaseAccountStore(cfg);
}
function _memoryAccount() { if (!mem) mem = memoryAccountStore(); return mem; }

module.exports = { getAccountStore, supabaseAccountStore, memoryAccountStore, _memoryAccount };
