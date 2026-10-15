'use strict';
// Minimal S3 client (AWS Signature Version 4) with node:crypto only – for Hetzner Object Storage (or any
// S3-compatible store). Used by api/_lib/blobstore.js when BLOBSTORE=s3. Nothing secret lives in code: the
// credentials come from env (S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY) and are never logged.
//
//   signHeaders(req, creds)        → headers incl. Authorization (header auth, for server-side calls)
//   presign(req, creds, expires)   → URL with X-Amz-* query auth (direct browser PUT/GET, no secret on the client)
//   client(opts)                   → { putObject, getObject, listPrefix, deleteObjects, presignPut, presignGet, url }
//
// Conventions follow the S3 flavour of SigV4: the canonical URI is the URI-encoded object path (each segment
// encoded once, '/' kept); presigned requests use UNSIGNED-PAYLOAD; header auth signs x-amz-content-sha256.
// Tested against the AWS SigV4 test-suite vectors and the S3 documentation examples (see the test suite).
const crypto = require('node:crypto');

const sha256hex = d => crypto.createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const EMPTY_SHA256 = sha256hex('');

/** RFC 3986 encoding as SigV4 requires (unreserved: A-Z a-z 0-9 - _ . ~). */
function uriEncode(str, keepSlash) {
  let out = '';
  for (const ch of Buffer.from(String(str), 'utf8')) {
    const c = String.fromCharCode(ch);
    if (/[A-Za-z0-9\-_.~]/.test(c) || (keepSlash && c === '/')) out += c;
    else out += '%' + ch.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

function canonicalQuery(pairs) {
  return pairs.map(([k, v]) => [uriEncode(k), uriEncode(v == null ? '' : v)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`).join('&');
}

const trimAll = v => String(v).trim().replace(/\s+/g, ' ');

function signingKey(secret, date, region, service) {
  return hmac(hmac(hmac(hmac('AWS4' + secret, date), region), service), 'aws4_request');
}

/**
 * Core signer. req: { method, path (already the canonical, encoded URI), query: [[k, v], …] (raw values),
 * headers: { name: value } (must include host), payloadHash }. creds: { accessKeyId, secretAccessKey, region,
 * service = 's3' }. amzDate: 'YYYYMMDDTHHMMSSZ'.
 */
function signature(req, creds, amzDate) {
  const date = amzDate.slice(0, 8);
  const service = creds.service || 's3';
  const scope = `${date}/${creds.region}/${service}/aws4_request`;
  const hdrs = Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), trimAll(v)]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const signedHeaders = hdrs.map(h => h[0]).join(';');
  const canonicalRequest = [req.method, req.path || '/', canonicalQuery(req.query || []),
    hdrs.map(([k, v]) => `${k}:${v}\n`).join(''), signedHeaders, req.payloadHash].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const sig = hmac(signingKey(creds.secretAccessKey, date, creds.region, service), stringToSign).toString('hex');
  return { signature: sig, signedHeaders, scope, canonicalRequest, stringToSign };
}

const amzDateOf = (now = new Date()) => now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Header authentication: returns the headers to send (incl. x-amz-date, x-amz-content-sha256, Authorization). */
function signHeaders(req, creds, { now = new Date(), amzDate = amzDateOf(now), contentSha = true } = {}) {
  const headers = { ...req.headers, 'x-amz-date': amzDate };
  if (contentSha) headers['x-amz-content-sha256'] = req.payloadHash;
  const s = signature({ ...req, headers }, creds, amzDate);
  headers.Authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${s.scope}, SignedHeaders=${s.signedHeaders}, Signature=${s.signature}`;
  return { headers, ...s };
}

/** Query-string authentication (presigned URL). signedHeaders: extra headers the client MUST send (e.g. content-length). */
function presign(req, creds, expires, { now = new Date(), amzDate = amzDateOf(now) } = {}) {
  const date = amzDate.slice(0, 8);
  const service = creds.service || 's3';
  const headers = { ...req.headers };
  const names = Object.keys(headers).map(k => k.toLowerCase()).sort().join(';');
  const query = [...(req.query || []),
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${creds.accessKeyId}/${date}/${creds.region}/${service}/aws4_request`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expires)],
    ['X-Amz-SignedHeaders', names]];
  const s = signature({ method: req.method, path: req.path, query, headers, payloadHash: 'UNSIGNED-PAYLOAD' }, creds, amzDate);
  return { query: canonicalQuery([...query, ['X-Amz-Signature', s.signature]]), ...s };
}

// ------------------------------------------------------------------ client
/**
 * opts: { endpoint: 'https://fsn1.your-objectstorage.com', bucket, region, accessKeyId, secretAccessKey,
 *         pathStyle = true, fetchImpl = fetch, now = () => new Date() }
 */
function client(opts) {
  const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));
  const now = opts.now || (() => new Date());
  const ep = new URL(opts.endpoint);
  if (!/^https?:$/.test(ep.protocol)) throw new Error('s3 endpoint must be http(s)');
  const creds = { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey, region: opts.region || 'us-east-1', service: 's3' };
  const pathStyle = opts.pathStyle !== false;
  const host = pathStyle ? ep.host : `${opts.bucket}.${ep.host}`;
  const basePath = ep.pathname.replace(/\/+$/, '');
  const pathOf = key => (pathStyle ? `${basePath}/${uriEncode(opts.bucket)}` : basePath) + '/' + uriEncode(key, true);
  const bucketPath = () => (pathStyle ? `${basePath}/${uriEncode(opts.bucket)}` : basePath) || '/';
  const url = (path, qs) => `${ep.protocol}//${host}${path}${qs ? '?' + qs : ''}`;

  async function call(method, path, query, body, extraHeaders = {}) {
    const payload = body == null ? Buffer.alloc(0) : Buffer.from(body);
    const req = { method, path, query, headers: { host, ...extraHeaders }, payloadHash: sha256hex(payload) };
    const { headers } = signHeaders(req, creds, { now: now() });
    delete headers.host; // fetch sets Host itself (same value)
    const r = await fetchImpl(url(path, canonicalQuery(query)), { method, headers, body: body == null ? undefined : payload });
    return r;
  }
  const fail = async (r, what) => { const e = new Error(`s3 ${what} http ${r.status}`); e.code = 's3_error'; e.status = r.status; try { await r.arrayBuffer(); } catch {} throw e; };

  return {
    creds: { region: creds.region },
    url: key => url(pathOf(key)),
    async putObject(key, data, { contentType = 'application/octet-stream' } = {}) {
      const r = await call('PUT', pathOf(key), [], data, { 'content-type': contentType, 'content-length': String(Buffer.byteLength(data)) });
      if (!r.ok) await fail(r, 'put');
      await r.arrayBuffer().catch(() => null);
      return true;
    },
    async getObject(key) {
      const r = await call('GET', pathOf(key), [], null);
      if (r.status === 404) { await r.arrayBuffer().catch(() => null); return null; }
      if (!r.ok) await fail(r, 'get');
      return Buffer.from(await r.arrayBuffer());
    },
    /** ListObjectsV2 under a prefix → [{ key, size }] (all pages, at most maxKeys in total). */
    async listPrefix(prefix, maxKeys = 100000) {
      const out = [];
      let token = null;
      for (let page = 0; page < 1000 && out.length < maxKeys; page++) {
        const q = [['list-type', '2'], ['prefix', prefix], ['max-keys', '1000']];
        if (token) q.push(['continuation-token', token]);
        const r = await call('GET', bucketPath(), q, null);
        if (!r.ok) await fail(r, 'list');
        const xml = await r.text();
        for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const k = /<Key>([\s\S]*?)<\/Key>/.exec(m[1]), sz = /<Size>(\d+)<\/Size>/.exec(m[1]);
          if (k && sz) out.push({ key: xmlDecode(k[1]), size: Number(sz[1]) });
        }
        const trunc = /<IsTruncated>true<\/IsTruncated>/.test(xml);
        const nt = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml);
        if (!trunc || !nt) break;
        token = xmlDecode(nt[1]);
      }
      return out;
    },
    /** DeleteObjects (batches of 1000; Content-MD5 is required by S3). → number of keys sent */
    async deleteObjects(keys) {
      let n = 0;
      for (let i = 0; i < keys.length; i += 1000) {
        const part = keys.slice(i, i + 1000);
        const body = `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>${part.map(k => `<Object><Key>${xmlEncode(k)}</Key></Object>`).join('')}</Delete>`;
        const md5 = crypto.createHash('md5').update(body).digest('base64');
        const r = await call('POST', bucketPath(), [['delete', '']], body, { 'content-md5': md5, 'content-type': 'application/xml' });
        if (!r.ok) await fail(r, 'delete');
        await r.text().catch(() => '');
        n += part.length;
      }
      return n;
    },
    /** Presigned PUT – the client must send exactly `size` bytes (content-length is signed). */
    presignPut(key, size, expires) {
      const path = pathOf(key);
      const p = presign({ method: 'PUT', path, headers: { host, 'content-length': String(size) } }, creds, expires, { now: now() });
      return { url: url(path, p.query), method: 'PUT', headers: { 'Content-Length': String(size) } };
    },
    presignGet(key, expires) {
      const path = pathOf(key);
      const p = presign({ method: 'GET', path, headers: { host } }, creds, expires, { now: now() });
      return { url: url(path, p.query), method: 'GET' };
    },
  };
}

function xmlDecode(s) { return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&'); }
function xmlEncode(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

module.exports = { uriEncode, canonicalQuery, signature, signHeaders, presign, client, amzDateOf, sha256hex, EMPTY_SHA256 };
