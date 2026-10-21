'use strict';
// Storage for „Brief per Post“ jobs (api/_lib/postal.js).
//   supabase: SECURITY DEFINER RPCs from supabase/migrations/20261020200000_fale_post.sql (PostgREST, publishable key
//             + FALE_RPC_SECRET – same model as the share store).
//   memory:   identical semantics in-process (tests / local harness only).
//
// A job holds the letter PDF (base64) only until it was handed to the print service (then it is set to null) or
// for at most 24 hours when nobody paid; a fax keeps it until it went through or finally failed (max. 24 hours). Fields use the SQL names (owner_hash, cap_hash, price_cents …).

const STATUSES = ['pending_payment', 'paid', 'submitted', 'sent', 'failed', 'refunded', 'canceled'];
const PATCHABLE = ['status', 'session_id', 'payment_intent', 'provider_id', 'provider_status', 'tracking', 'error', 'pdf', 'paid_at', 'sent_at'];

function supabasePostStore(cfg, { fetchImpl = fetch } = {}) {
  async function rpc(fn, args) {
    const r = await fetchImpl(`${cfg.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: cfg.supabaseKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ p_secret: cfg.rpcSecret, ...args }),
    });
    if (!r.ok) {
      const e = new Error(`store ${fn} http ${r.status}`);
      e.code = 'store_error';
      e.status = r.status; // 404 = function missing (migration not applied yet)
      throw e;
    }
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }
  return {
    kind: 'supabase',
    create: (o) => rpc('fale_post_create', { p_id: o.id, p_owner: o.owner, p_cap: o.cap, p_options: o.options, p_price: o.priceCents, p_pages: o.pages, p_pdf: o.pdf }),
    get: ({ id, withPdf = false }) => rpc('fale_post_get', { p_id: id, p_with_pdf: !!withPdf }),
    patch: ({ id, from = null, patch }) => rpc('fale_post_patch', { p_id: id, p_from: from, p_patch: patch }),
    remove: ({ id }) => rpc('fale_post_delete', { p_id: id }),
    open: ({ limit = 40 } = {}) => rpc('fale_post_open', { p_limit: limit }),
  };
}

// ------------------------------------------------------------------ in-memory (tests)
function memoryPostStore({ now = () => new Date() } = {}) {
  const jobs = new Map();
  const iso = () => now().toISOString();
  const view = (j, withPdf) => { const o = { ...j, options: { ...j.options } }; if (!withPdf) delete o.pdf; return o; };
  function purge() {
    const t = now().getTime();
    for (const [id, j] of jobs) {
      if (j.status === 'pending_payment' && j.pdf && t - Date.parse(j.created_at) > 24 * 3600e3) { j.pdf = null; j.status = 'canceled'; }
      if (j.pdf && t - Date.parse(j.created_at) > 24 * 3600e3) j.pdf = null; // e.g. a fax nobody checked on
      if (t - Date.parse(j.created_at) > 180 * 86400e3) jobs.delete(id);
    }
  }
  return {
    kind: 'memory',
    async create(o) {
      purge();
      if (jobs.has(o.id)) return { ok: false, reason: 'exists' };
      jobs.set(o.id, { id: o.id, owner_hash: o.owner, cap_hash: o.cap, status: 'pending_payment', options: { ...o.options }, price_cents: o.priceCents, pages: o.pages,
        pdf: o.pdf, session_id: null, payment_intent: null, provider_id: null, provider_status: null, tracking: null, error: null,
        created_at: iso(), updated_at: iso(), paid_at: null, sent_at: null });
      return { ok: true };
    },
    async get({ id, withPdf = false }) {
      purge();
      const j = jobs.get(id);
      return j ? { ok: true, job: view(j, withPdf) } : { ok: false, reason: 'not_found' };
    },
    async patch({ id, from = null, patch }) {
      const j = jobs.get(id);
      if (!j) return { ok: false, reason: 'not_found' };
      if (from && j.status !== from) return { ok: false, reason: 'status', status: j.status };
      for (const [k, v] of Object.entries(patch || {})) {
        if (!PATCHABLE.includes(k)) return { ok: false, reason: 'bad_field' };
        if (k === 'status' && !STATUSES.includes(v)) return { ok: false, reason: 'bad_status' };
        j[k] = v;
      }
      j.updated_at = iso();
      return { ok: true, job: view(j, false) };
    },
    async remove({ id }) { return { ok: true, deleted: jobs.delete(id) }; },
    async open({ limit = 40 } = {}) {
      purge();
      const t = now().getTime();
      const list = [...jobs.values()].filter(j => (j.status === 'pending_payment' && j.session_id && t - Date.parse(j.created_at) > 120e3 && t - Date.parse(j.created_at) < 24 * 3600e3)
        || (j.status === 'submitted' && t - Date.parse(j.created_at) < 30 * 86400e3));
      list.sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at));
      return { ok: true, jobs: list.slice(0, Math.max(1, Math.min(limit, 100))).map(j => view(j, false)) };
    },
    _jobs: jobs,
  };
}

let mem = null;
function getPostStore(cfg) {
  if (cfg.store === 'memory') { if (!mem) mem = memoryPostStore(); return mem; }
  return supabasePostStore(cfg);
}

module.exports = { getPostStore, supabasePostStore, memoryPostStore, STATUSES, PATCHABLE };
