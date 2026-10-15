'use strict';
// Metadata store for FaLe One (Drive + Fotos): the secret-gated SECURITY DEFINER RPCs from
// supabase/migrations/20261015220000_fale_one_drive.sql, called via PostgREST with the publishable key +
// FALE_RPC_SECRET (same model as sharestore.js / accountstore.js). Every method resolves to the JSON object
// the SQL function returns ({ ok, reason?, … }, snake_case field names). No in-memory variant: the tests run
// against the real SQL in a local PostgreSQL (see the test harness).

function supabaseDriveStore(cfg, { fetchImpl = (...a) => fetch(...a) } = {}) {
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
      try { await r.arrayBuffer(); } catch {}
      throw e;
    }
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }
  const arr = a => (a && a.length ? a : null);
  return {
    kind: 'supabase',
    status: ({ user, detail }) => rpc('fale_one_status', { p_user: user, p_detail: !!detail }),
    changes: ({ user, after, limit }) => rpc('fale_one_changes', { p_user: user, p_after: after, p_limit: limit }),
    mkdir: ({ user, node, parent, key, meta }) => rpc('fale_one_mkdir', { p_user: user, p_node: node, p_parent: parent || null, p_key: key, p_meta: meta }),
    uploadCreate: (o) => rpc('fale_one_upload_create', { p_user: o.user, p_blob: o.blob, p_purpose: o.purpose, p_size: o.size, p_chunks: o.chunks,
      p_chunk_size: o.chunkSize, p_backend: o.backend, p_hash: o.hash || null }),
    chunkPut: ({ user, blob, idx, data }) => rpc('fale_one_chunk_put', { p_user: user, p_blob: blob, p_idx: idx, p_data: data }),
    chunkGet: ({ user, blob, idx }) => rpc('fale_one_chunk_get', { p_user: user, p_blob: blob, p_idx: idx }),
    uploadStatus: ({ user, blob }) => rpc('fale_one_upload_status', { p_user: user, p_blob: blob }),
    uploadAbort: ({ user, blob }) => rpc('fale_one_upload_abort', { p_user: user, p_blob: blob }),
    blobInfo: ({ user, blob }) => rpc('fale_one_blob_info', { p_user: user, p_blob: blob }),
    thumbs: ({ user, blobs }) => rpc('fale_one_thumbs', { p_user: user, p_blobs: blobs }),
    commit: (o) => rpc('fale_one_commit', { p_user: o.user, p_node: o.node, p_parent: o.parent || null, p_kind: o.kind, p_base_version: o.baseVersion,
      p_key: o.key || null, p_meta: o.meta || null, p_rev: o.rev, p_rev_key: o.revKey, p_rev_meta: o.revMeta, p_hash: o.hash || null,
      p_content: o.content, p_thumb: o.thumb || null, p_preview: o.preview || null, p_observed: o.observed || null, p_device: o.device || null }),
    update: (o) => rpc('fale_one_update', { p_user: o.user, p_node: o.node, p_base_version: o.baseVersion, p_move: !!o.move, p_parent: o.parent || null, p_meta: o.meta || null }),
    trash: ({ user, node, baseVersion }) => rpc('fale_one_trash', { p_user: user, p_node: node, p_base_version: baseVersion == null ? null : baseVersion }),
    restore: ({ user, node }) => rpc('fale_one_restore', { p_user: user, p_node: node }),
    remove: ({ user, node }) => rpc('fale_one_delete', { p_user: user, p_node: node }),
    trashEmpty: ({ user }) => rpc('fale_one_trash_empty', { p_user: user }),
    versions: ({ user, node }) => rpc('fale_one_versions', { p_user: user, p_node: node }),
    versionRestore: ({ user, node, rev, baseVersion }) => rpc('fale_one_version_restore', { p_user: user, p_node: node, p_rev: rev, p_base_version: baseVersion }),
    versionDelete: ({ user, node, rev }) => rpc('fale_one_version_delete', { p_user: user, p_node: node, p_rev: rev }),
    albumPut: ({ user, album, baseVersion, key, meta }) => rpc('fale_one_album_put', { p_user: user, p_album: album, p_base_version: baseVersion, p_key: key || null, p_meta: meta }),
    albumDelete: ({ user, album }) => rpc('fale_one_album_delete', { p_user: user, p_album: album }),
    albumItems: ({ user, album, add, remove }) => rpc('fale_one_album_items', { p_user: user, p_album: album, p_add: arr(add), p_remove: arr(remove) }),
    backupReport: (o) => rpc('fale_one_backup_report', { p_user: o.user, p_device: o.device, p_meta: o.meta || null, p_status: o.status, p_pending: o.pending,
      p_pending_bytes: o.pendingBytes, p_success: !!o.success, p_error: o.error || null }),
    backupList: ({ user }) => rpc('fale_one_backup_list', { p_user: user }),
    backupForget: ({ user, device }) => rpc('fale_one_backup_forget', { p_user: user, p_device: device }),
    dedupe: ({ user, hashes }) => rpc('fale_one_dedupe', { p_user: user, p_hashes: hashes }),
    exportPage: ({ user, after, limit }) => rpc('fale_one_export', { p_user: user, p_after: after || null, p_limit: limit }),
    gcTake: ({ limit }) => rpc('fale_one_gc_take', { p_limit: limit }),
    gcDone: ({ ids }) => rpc('fale_one_gc_done', { p_ids: ids }),
  };
}

function getDriveStore(cfg) { return supabaseDriveStore(cfg); }

module.exports = { getDriveStore, supabaseDriveStore };
