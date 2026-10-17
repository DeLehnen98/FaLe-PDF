'use strict';
// Storage adapter for "Sicher teilen", "Unterschrift anfordern" and "Geräte verbinden".
//   supabase: SECURITY DEFINER RPCs from supabase/migrations/20261014150000_fale_share.sql, called via
//             PostgREST with the publishable key + FALE_RPC_SECRET (same model as the AI counters).
//   memory:   identical semantics in-process (tests / local harness only).
//
// The store only ever sees ciphertext (base64), opaque headers, sizes, timestamps and SHA-256 hashes
// of capability tokens. Every method resolves to the JSON object the SQL function returns
// ({ ok, reason?, ... }); objects use the SQL field names (chunks, chunk_size, expires_at, …).

function supabaseShareStore(cfg, { fetchImpl = fetch } = {}) {
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
  const iso = d => (d instanceof Date ? d.toISOString() : d);
  return {
    kind: 'supabase',
    rate: ({ day, kind, keys, nLimits, bytes, bLimits }) => rpc('fale_rate', { p_day: day, p_kind: kind, p_keys: keys, p_n_limits: nLimits, p_bytes: bytes, p_b_limits: bLimits }),
    create: (o) => rpc('fale_share_create', { p_id: o.id, p_kind: o.kind, p_owner: o.owner, p_parent: o.parent || null, p_header: o.header, p_size: o.size, p_chunks: o.chunks, p_chunk_size: o.chunkSize, p_expires: iso(o.expiresAt), p_max_downloads: o.maxDownloads == null ? null : o.maxDownloads, p_cap: o.cap }),
    put: ({ id, owner, idx, data }) => rpc('fale_share_put', { p_id: id, p_owner: owner, p_idx: idx, p_data: data }),
    finish: ({ id, owner }) => rpc('fale_share_finish', { p_id: id, p_owner: owner }),
    info: ({ id }) => rpc('fale_share_info', { p_id: id }),
    open: ({ id }) => rpc('fale_share_open', { p_id: id }),
    get: ({ id, idx }) => rpc('fale_share_get', { p_id: id, p_idx: idx }),
    status: ({ id, owner }) => rpc('fale_share_status', { p_id: id, p_owner: owner }),
    remove: ({ id, owner }) => rpc('fale_share_delete', { p_id: id, p_owner: owner }),
    signCreate: ({ id, owner, docId, signers }) => rpc('fale_sign_create', { p_id: id, p_owner: owner, p_doc_id: docId, p_signers: signers }),
    signOpen: ({ signer }) => rpc('fale_sign_open', { p_signer: signer }),
    signResult: (o) => rpc('fale_sign_result', { p_signer: o.signer, p_obj_id: o.id, p_header: o.header, p_size: o.size, p_chunks: o.chunks, p_chunk_size: o.chunkSize, p_cap: o.cap }),
    signFinish: ({ signer }) => rpc('fale_sign_finish', { p_signer: signer }),
    signStatus: ({ id, owner }) => rpc('fale_sign_status', { p_id: id, p_owner: owner }),
    signDelete: ({ id, owner }) => rpc('fale_sign_delete', { p_id: id, p_owner: owner }),
    roomCreate: ({ id, code, host, expiresAt }) => rpc('fale_room_create', { p_id: id, p_code: code, p_host: host, p_expires: iso(expiresAt) }),
    roomJoin: ({ id, code, guest, via }) => rpc('fale_room_join', { p_id: id || null, p_code: code || null, p_guest: guest, p_via: via }),
    roomSend: ({ id, auth, body }) => rpc('fale_room_send', { p_id: id, p_auth: auth, p_body: body }),
    roomPoll: ({ id, auth, after }) => rpc('fale_room_poll', { p_id: id, p_auth: auth, p_after: after || 0 }),
    roomClose: ({ id, auth }) => rpc('fale_room_close', { p_id: id, p_auth: auth }),
    purge: () => rpc('fale_share_purge', {}),
  };
}

// ------------------------------------------------------------------ in-memory (tests)
function memoryShareStore({ now = () => new Date() } = {}) {
  const s = { objects: new Map(), chunks: new Map(), requests: new Map(), signers: new Map(), rooms: new Map(), msgs: [], usage: new Map(), seq: 0 };
  const t = () => now().getTime();
  const json = o => ({ id: o.id, kind: o.kind, header: o.header, size: o.size, chunks: o.chunkCount, chunk_size: o.chunkSize, complete: o.complete,
    expires_at: new Date(o.expiresAt).toISOString(), created_at: new Date(o.createdAt).toISOString(), max_downloads: o.maxDownloads, downloads: o.downloads });
  const chunkKey = (id, i) => `${id}|${i}`;
  function delObject(id) {
    const o = s.objects.get(id);
    if (!o) return false;
    for (let i = 0; i < o.chunkCount; i++) s.chunks.delete(chunkKey(id, i));
    s.objects.delete(id);
    for (const sg of s.signers.values()) if (sg.resultId === id) sg.resultId = null;
    for (const [rid, r] of s.requests) if (r.docId === id) delRequest(rid);
    return true;
  }
  function delRequest(rid) {
    if (!s.requests.has(rid)) return;
    s.requests.delete(rid);
    for (const [k, sg] of s.signers) if (sg.requestId === rid) s.signers.delete(k);
  }
  const expired = o => o.expiresAt <= t();
  const lazy = id => { const o = s.objects.get(id); if (o && expired(o)) delObject(id); };
  const activeTotal = () => [...s.objects.values()].filter(o => !expired(o)).reduce((a, o) => a + o.size, 0);
  const signerOf = hash => [...s.signers.values()].find(x => x.tokenHash === hash) || null;
  const signersOf = rid => [...s.signers.values()].filter(x => x.requestId === rid).sort((a, b) => a.idx - b.idx);
  const iso = ms => (ms == null ? null : new Date(ms).toISOString());
  const chunksOk = (id, o) => {
    let c = 0, b = 0;
    for (let i = 0; i < o.chunkCount; i++) { const d = s.chunks.get(chunkKey(id, i)); if (d) { c++; b += d.length; } }
    return c === o.chunkCount && b === o.size;
  };
  function purge() {
    let objects = 0, rooms = 0, usage = 0;
    for (const [rid, r] of s.requests) if (r.expiresAt <= t()) delRequest(rid);
    for (const [id, o] of [...s.objects]) {
      if (expired(o) || (!o.complete && o.createdAt < t() - 6 * 3600e3) || (o.maxDownloads != null && o.downloads >= o.maxDownloads && o.lastOpenAt < t() - 2 * 3600e3)) { delObject(id); objects++; }
    }
    for (const [id, r] of [...s.rooms]) if (r.expiresAt <= t()) { s.rooms.delete(id); s.msgs = s.msgs.filter(m => m.room !== id); rooms++; }
    const cutoff = new Date(t() - 30 * 864e5).toISOString().slice(0, 10);
    for (const k of [...s.usage.keys()]) if (k.split('|')[0] < cutoff) { s.usage.delete(k); usage++; }
    return { objects, rooms, usage };
  }
  function insertObject(o) {
    s.objects.set(o.id, { id: o.id, kind: o.kind, owner: o.owner, parent: o.parent || null, header: o.header, size: o.size, chunkCount: o.chunks, chunkSize: o.chunkSize,
      complete: false, maxDownloads: o.maxDownloads == null ? null : o.maxDownloads, downloads: 0, lastOpenAt: null, createdAt: t(), expiresAt: new Date(o.expiresAt).getTime() });
  }
  const badChunking = (size, chunks, cs) => chunks !== Math.max(1, Math.ceil(size / cs));

  return {
    kind: 'memory',
    _state: s,
    _reset() { s.objects.clear(); s.chunks.clear(); s.requests.clear(); s.signers.clear(); s.rooms.clear(); s.msgs = []; s.usage.clear(); },
    _purge: purge,
    async rate({ day, kind, keys, nLimits, bytes, bLimits }) {
      const rows = keys.map(k => { const key = `${day}|${k}|${kind}`; if (!s.usage.has(key)) s.usage.set(key, { n: 0, bytes: 0 }); return s.usage.get(key); });
      for (let i = 0; i < rows.length; i++) if (rows[i].n + 1 > nLimits[i] || rows[i].bytes + bytes > bLimits[i]) return { ok: false, index: i };
      rows.forEach(r => { r.n++; r.bytes += bytes; });
      return { ok: true };
    },
    async create(o) {
      const exp = new Date(o.expiresAt).getTime();
      const maxDays = o.kind === 'sign-doc' ? 30 : 7;
      if (exp <= t() || exp > t() + maxDays * 864e5 + 300e3) throw Object.assign(new Error('bad expiry'), { code: 'store_error' });
      if (badChunking(o.size, o.chunks, o.chunkSize)) throw Object.assign(new Error('bad chunking'), { code: 'store_error' });
      if (activeTotal() + o.size > o.cap) return { ok: false, reason: 'capacity' };
      if (s.objects.has(o.id)) throw Object.assign(new Error('duplicate'), { code: 'store_error' });
      insertObject(o);
      return { ok: true, expires_at: iso(exp) };
    },
    async put({ id, owner, idx, data }) {
      const o = s.objects.get(id);
      if (!o || expired(o)) return { ok: false, reason: 'not_found' };
      if (o.owner !== owner) return { ok: false, reason: 'forbidden' };
      if (o.complete) return { ok: false, reason: 'complete' };
      if (idx < 0 || idx >= o.chunkCount) return { ok: false, reason: 'bad_index' };
      const d = Buffer.from(data, 'base64');
      if (d.length < 1 || d.length > o.chunkSize || (idx < o.chunkCount - 1 && d.length !== o.chunkSize)) return { ok: false, reason: 'bad_size' };
      s.chunks.set(chunkKey(id, idx), d);
      return { ok: true };
    },
    async finish({ id, owner }) {
      const o = s.objects.get(id);
      if (!o || expired(o)) return { ok: false, reason: 'not_found' };
      if (o.owner !== owner) return { ok: false, reason: 'forbidden' };
      if (o.complete) return { ok: true, object: json(o) };
      if (!chunksOk(id, o)) return { ok: false, reason: 'incomplete' };
      o.complete = true;
      return { ok: true, object: json(o) };
    },
    async info({ id }) {
      lazy(id);
      const o = s.objects.get(id);
      if (!o || !o.complete) return { ok: false, reason: 'not_found' };
      return { ok: true, object: json(o) };
    },
    async open({ id }) {
      lazy(id);
      const o = s.objects.get(id);
      if (!o || !o.complete) return { ok: false, reason: 'not_found' };
      if (!['file', 'relay'].includes(o.kind)) return { ok: false, reason: 'forbidden' };
      if (o.maxDownloads != null && o.downloads >= o.maxDownloads) return { ok: false, reason: 'exhausted' };
      o.downloads++; o.lastOpenAt = t();
      return { ok: true, object: json(o) };
    },
    async get({ id, idx }) {
      const o = s.objects.get(id);
      if (!o || !o.complete || expired(o)) return { ok: false, reason: 'not_found' };
      const d = s.chunks.get(chunkKey(id, idx));
      if (!d) return { ok: false, reason: 'not_found' };
      return { ok: true, data: d.toString('base64') };
    },
    async status({ id, owner }) {
      lazy(id);
      const o = s.objects.get(id);
      if (!o) return { ok: true, exists: false };
      if (o.owner !== owner) return { ok: false, reason: 'forbidden' };
      return { ok: true, exists: true, object: json(o) };
    },
    async remove({ id, owner }) {
      const o = s.objects.get(id);
      if (!o || o.owner !== owner || !['file', 'relay'].includes(o.kind)) return { ok: true, deleted: false };
      delObject(id);
      return { ok: true, deleted: true };
    },
    async signCreate({ id, owner, docId, signers }) {
      const o = s.objects.get(docId);
      if (!o || expired(o) || !o.complete) return { ok: false, reason: 'not_found' };
      if (o.owner !== owner || o.kind !== 'sign-doc' || o.parent) return { ok: false, reason: 'forbidden' };
      s.requests.set(id, { id, owner, docId, count: signers.length, createdAt: t(), expiresAt: o.expiresAt });
      o.parent = id;
      signers.forEach((h, i) => s.signers.set(`${id}|${i}`, { requestId: id, idx: i, tokenHash: h, status: 'open', viewedAt: null, signedAt: null, resultId: null }));
      return { ok: true, expires_at: iso(o.expiresAt), created_at: iso(t()) };
    },
    async signOpen({ signer }) {
      let sg = signerOf(signer);
      if (!sg) return { ok: false, reason: 'not_found' };
      const r = s.requests.get(sg.requestId);
      if (r.expiresAt <= t()) { for (const [id, o] of [...s.objects]) if (o.parent === r.id) delObject(id); delRequest(r.id); return { ok: false, reason: 'not_found' }; }
      const d = s.objects.get(r.docId);
      let src = d;
      if (sg.idx > 0) {
        const prev = s.signers.get(`${r.id}|${sg.idx - 1}`);
        if (prev.status !== 'signed' || !prev.resultId) return { ok: false, reason: 'waiting', idx: sg.idx, count: r.count };
        src = s.objects.get(prev.resultId);
      }
      if (sg.status === 'open') { sg.status = 'viewed'; sg.viewedAt = t(); }
      const own = sg.resultId ? s.objects.get(sg.resultId) : null;
      return { ok: true, request: r.id, idx: sg.idx, count: r.count, status: sg.status, created_at: iso(r.createdAt), expires_at: iso(r.expiresAt),
        viewed_at: iso(sg.viewedAt), signed_at: iso(sg.signedAt), now: iso(t()), doc: json(d), source: json(src), result: own && own.complete ? json(own) : null };
    },
    async signResult(o) {
      const sg = signerOf(o.signer);
      if (!sg) return { ok: false, reason: 'not_found' };
      const r = s.requests.get(sg.requestId);
      if (r.expiresAt <= t()) return { ok: false, reason: 'not_found' };
      if (sg.status === 'signed') return { ok: false, reason: 'signed' };
      if (sg.status !== 'viewed') return { ok: false, reason: 'forbidden' };
      if (sg.idx > 0 && s.signers.get(`${r.id}|${sg.idx - 1}`).status !== 'signed') return { ok: false, reason: 'waiting' };
      if (badChunking(o.size, o.chunks, o.chunkSize)) throw Object.assign(new Error('bad chunking'), { code: 'store_error' });
      if (activeTotal() + o.size > o.cap) return { ok: false, reason: 'capacity' };
      if (sg.resultId) delObject(sg.resultId);
      insertObject({ id: o.id, kind: 'sign-result', owner: o.signer, parent: r.id, header: o.header, size: o.size, chunks: o.chunks, chunkSize: o.chunkSize, expiresAt: r.expiresAt });
      sg.resultId = o.id;
      return { ok: true, expires_at: iso(r.expiresAt) };
    },
    async signFinish({ signer }) {
      const sg = signerOf(signer);
      if (!sg || !sg.resultId) return { ok: false, reason: 'not_found' };
      if (sg.status === 'signed') return { ok: true, signed_at: iso(sg.signedAt) };
      const o = s.objects.get(sg.resultId);
      if (!o || expired(o)) return { ok: false, reason: 'not_found' };
      if (!chunksOk(o.id, o)) return { ok: false, reason: 'incomplete' };
      o.complete = true;
      sg.status = 'signed'; sg.signedAt = t();
      return { ok: true, signed_at: iso(sg.signedAt) };
    },
    async signStatus({ id, owner }) {
      const r = s.requests.get(id);
      if (!r) return { ok: true, exists: false };
      if (r.owner !== owner) return { ok: false, reason: 'forbidden' };
      if (r.expiresAt <= t()) { for (const [oid, o] of [...s.objects]) if (o.parent === id) delObject(oid); delRequest(id); return { ok: true, exists: false, expired: true }; }
      const signers = signersOf(id).map(sg => {
        const o = sg.resultId ? s.objects.get(sg.resultId) : null;
        return { idx: sg.idx, status: sg.status, viewed_at: iso(sg.viewedAt), signed_at: iso(sg.signedAt), result: o && o.complete ? json(o) : null };
      });
      return { ok: true, exists: true, created_at: iso(r.createdAt), expires_at: iso(r.expiresAt), signers };
    },
    async signDelete({ id, owner }) {
      const r = s.requests.get(id);
      if (!r) return { ok: true, deleted: false };
      if (r.owner !== owner) return { ok: false, reason: 'forbidden' };
      for (const [oid, o] of [...s.objects]) if (o.parent === id || oid === r.docId) delObject(oid);
      delRequest(id);
      return { ok: true, deleted: true };
    },
    async roomCreate({ id, code, host, expiresAt }) {
      const exp = new Date(expiresAt).getTime();
      if (exp <= t() || exp > t() + 2 * 3600e3 + 300e3) throw Object.assign(new Error('bad expiry'), { code: 'store_error' });
      for (const [rid, r] of [...s.rooms]) if (r.expiresAt <= t()) { s.rooms.delete(rid); s.msgs = s.msgs.filter(m => m.room !== rid); }
      if ([...s.rooms.values()].some(r => r.code === code)) return { ok: false, reason: 'code_taken' };
      s.rooms.set(id, { id, code, host, guest: null, via: null, expiresAt: exp });
      return { ok: true, expires_at: iso(exp) };
    },
    async roomJoin({ id, code, guest, via }) {
      const r = id ? s.rooms.get(id) : [...s.rooms.values()].find(x => x.code === code);
      if (!r || r.expiresAt <= t()) return { ok: false, reason: 'not_found' };
      if (r.guest) return { ok: false, reason: 'taken' };
      r.guest = guest; r.via = via;
      return { ok: true, room: r.id, expires_at: iso(r.expiresAt) };
    },
    async roomSend({ id, auth, body }) {
      const r = s.rooms.get(id);
      if (!r || r.expiresAt <= t()) return { ok: false, reason: 'not_found' };
      const role = r.host === auth ? 0 : r.guest === auth ? 1 : null;
      if (role === null) return { ok: false, reason: 'forbidden' };
      if (s.msgs.filter(m => m.room === id).length >= 2000) return { ok: false, reason: 'full' };
      s.msgs.push({ seq: ++s.seq, room: id, sender: role, body });
      return { ok: true };
    },
    async roomPoll({ id, auth, after }) {
      const r = s.rooms.get(id);
      if (!r || r.expiresAt <= t()) return { ok: false, reason: 'not_found' };
      const role = r.host === auth ? 0 : r.guest === auth ? 1 : null;
      if (role === null) return { ok: false, reason: 'forbidden' };
      const msgs = s.msgs.filter(m => m.room === id && m.sender !== role && m.seq > (after || 0)).slice(0, 50).map(m => ({ seq: m.seq, body: m.body }));
      return { ok: true, joined: !!r.guest, via: r.via, expires_at: iso(r.expiresAt), msgs };
    },
    async roomClose({ id, auth }) {
      const r = s.rooms.get(id);
      if (!r || (r.host !== auth && r.guest !== auth)) return { ok: true, deleted: false };
      s.rooms.delete(id); s.msgs = s.msgs.filter(m => m.room !== id);
      return { ok: true, deleted: true };
    },
    async purge() { return purge(); },
  };
}

let mem = null;
function getShareStore(cfg) {
  if (cfg.store === 'memory') { if (!mem) mem = memoryShareStore(); return mem; }
  return supabaseShareStore(cfg);
}
function _memoryShare() { if (!mem) mem = memoryShareStore(); return mem; }

module.exports = { getShareStore, supabaseShareStore, memoryShareStore, _memoryShare };
