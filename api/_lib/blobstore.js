'use strict';
// Blob storage for FaLe One: where the encrypted chunks live. Two implementations behind one interface:
//
//   postgres (default, BLOBSTORE=postgres): chunks are bytea rows in public.one_chunks, written/read through the
//            secret-gated RPCs (drivestore). Good for the closed beta; capped by private.fale_one_config.
//   s3       (BLOBSTORE=s3): Hetzner Object Storage or any S3-compatible bucket. Clients upload/download chunks
//            DIRECTLY with short-lived presigned URLs (no bytes through Vercel); the API can also proxy a chunk
//            (fallback when the bucket's CORS is not set up). Env: S3_ENDPOINT, S3_BUCKET, S3_REGION,
//            S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, optional S3_PATH_STYLE (default 1), S3_PREFIX (default 'one/v1').
//            Thumbnails always stay in Postgres (tiny objects; Hetzner bills objects < 64 KB as 64 KB).
//
// Interface (all async unless noted):
//   kind                         'pg' | 's3'
//   direct                       true when clients should use presigned URLs
//   putChunk({ user, blob, idx, data: Buffer })      → { ok, reason? }
//   getChunk({ user, blob, idx })                    → Buffer | null
//   observe({ user, blob, chunks })                  → [size per index, -1 = missing]   (s3 only; pg verifies in SQL)
//   presignPut({ user, blob, idx, size }) (sync)     → { url, method, headers }        (s3 only)
//   presignGet({ user, blob, idx }) (sync)           → { url, method }                 (s3 only)
//   deleteBlob({ user, blob, chunks })               → number of objects removed       (pg: no-op, rows cascade)
// Object keys (s3): <prefix>/<user uuid>/<blob uuid>/<chunk index> – opaque ids only.
const S3 = require('./s3');

const env = k => String(process.env[k] == null ? '' : process.env[k]).trim();

function blobConfig() {
  const kind = (env('BLOBSTORE') || 'postgres').toLowerCase() === 's3' ? 's3' : 'pg';
  const ttl = parseInt(env('ONE_PRESIGN_TTL') || '900', 10);
  return {
    kind,
    presignTtl: Number.isFinite(ttl) ? Math.min(3600, Math.max(60, ttl)) : 900,
    s3: {
      endpoint: env('S3_ENDPOINT').replace(/\/+$/, ''),
      bucket: env('S3_BUCKET'),
      region: env('S3_REGION') || 'eu-central',
      accessKeyId: env('S3_ACCESS_KEY_ID'),
      secretAccessKey: env('S3_SECRET_ACCESS_KEY'),
      pathStyle: !['0', 'false', 'no', 'off'].includes(env('S3_PATH_STYLE').toLowerCase()),
      prefix: (env('S3_PREFIX') || 'one/v1').replace(/^\/+|\/+$/g, ''),
    },
  };
}

function s3Configured(bc) {
  const s = bc.s3;
  return !!(/^https:\/\//.test(s.endpoint) || (process.env.VERCEL_ENV !== 'production' && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(s.endpoint)))
    && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(s.bucket) && s.accessKeyId.length >= 8 && s.secretAccessKey.length >= 16;
}

function postgresBlobstore(store) {
  return {
    kind: 'pg',
    direct: false,
    async putChunk({ user, blob, idx, data }) { return store.chunkPut({ user, blob, idx, data: data.toString('base64') }); },
    async getChunk({ user, blob, idx }) {
      const r = await store.chunkGet({ user, blob, idx });
      return r && r.ok ? Buffer.from(r.data, 'base64') : null;
    },
    async observe() { return null; },
    async deleteBlob() { return 0; },
  };
}

function s3Blobstore(bc, { fetchImpl, now } = {}) {
  const c = S3.client({ ...bc.s3, fetchImpl, now });
  const key = (user, blob, idx) => `${bc.s3.prefix}/${user}/${blob}/${idx}`;
  return {
    kind: 's3',
    direct: true,
    objectKey: key,
    async putChunk({ user, blob, idx, data }) { await c.putObject(key(user, blob, idx), data); return { ok: true }; },
    async getChunk({ user, blob, idx }) { return c.getObject(key(user, blob, idx)); },
    async observe({ user, blob, chunks }) {
      const pre = `${bc.s3.prefix}/${user}/${blob}/`;
      const sizes = new Array(chunks).fill(-1);
      for (const o of await c.listPrefix(pre, chunks + 10)) {
        const i = o.key.slice(pre.length);
        if (/^(0|[1-9][0-9]{0,6})$/.test(i) && +i < chunks) sizes[+i] = o.size;
        else sizes.push(o.size); // a stray object → the SQL check rejects the upload
      }
      return sizes;
    },
    presignPut({ user, blob, idx, size }) { return c.presignPut(key(user, blob, idx), size, bc.presignTtl); },
    presignGet({ user, blob, idx }) { return c.presignGet(key(user, blob, idx), bc.presignTtl); },
    async deleteBlob({ user, blob, chunks }) {
      const keys = Array.from({ length: chunks }, (_, i) => key(user, blob, i));
      return c.deleteObjects(keys);
    },
  };
}

/** The blobstore for content/preview blobs according to env (thumbnails always use postgresBlobstore). */
function makeBlobstore(store, { fetchImpl, now, bc = blobConfig() } = {}) {
  if (bc.kind === 's3') {
    if (!s3Configured(bc)) { const e = new Error('s3 not configured'); e.code = 'blobstore_not_configured'; throw e; }
    return s3Blobstore(bc, { fetchImpl, now });
  }
  return postgresBlobstore(store);
}

module.exports = { blobConfig, s3Configured, makeBlobstore, postgresBlobstore, s3Blobstore };
