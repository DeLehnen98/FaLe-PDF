// S3 blob store for FaLe One: SigV4 against the AWS test vectors, the S3 client against a mock S3 that VERIFIES
// every signature (header auth + presigned URLs, signed content-length), and the whole drive flow with BLOBSTORE=s3
// (direct presigned upload/download, commit verification by listing, gc queue, account deletion).
//   node test_one_s3.mjs        (harness 8912/8913, mock S3 8916, database fale_one_s3)
process.env.PGDB = process.env.PGDB || 'fale_one_s3';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire('/home/claude/FalePDF/api/x.js');
const S = require('./_lib/s3.js');
const B = require('./_lib/blobstore.js');
let pass = 0, fail = 0;
function check(name, cond, info = '') { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (info !== '' ? '  [' + JSON.stringify(info).slice(0, 500) + ']' : '')); } }
const bytes = n => new Uint8Array(crypto.randomBytes(n));
const eq = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

// ================================================================== 1. SigV4 test vectors
{
  const suite = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 'service' };
  const E = S.EMPTY_SHA256, D = '20150830T123600Z';
  const host = { host: 'example.amazonaws.com', 'x-amz-date': D };
  // aws-sig-v4-test-suite (get-vanilla, get-vanilla-query-order-key-case, post-vanilla)
  const gv = S.signature({ method: 'GET', path: '/', query: [], headers: host, payloadHash: E }, suite, D);
  check('vector get-vanilla: canonical request', gv.canonicalRequest === 'GET\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  check('vector get-vanilla: string to sign', gv.stringToSign === 'AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\nbb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63');
  check('vector get-vanilla: signature', gv.signature === '5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31', gv.signature);
  check('vector get-vanilla-query-order-key-case', S.signature({ method: 'GET', path: '/', query: [['Param2', 'value2'], ['Param1', 'value1']], headers: host, payloadHash: E }, suite, D).signature === 'b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500');
  check('vector post-vanilla', S.signature({ method: 'POST', path: '/', query: [], headers: host, payloadHash: E }, suite, D).signature === '5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b');
  // S3 documentation examples (sig-v4-header-based-auth / query-string-auth)
  const s3c = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1' }; // AWS SigV4 documentation test vector – fale-secret-scan: allow
  const SD = '20130524T000000Z', H = 'examplebucket.s3.amazonaws.com';
  check('S3 example: GET object with Range', S.signature({ method: 'GET', path: '/test.txt', query: [], headers: { host: H, range: 'bytes=0-9', 'x-amz-content-sha256': E, 'x-amz-date': SD }, payloadHash: E }, s3c, SD).signature === 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  const ph = S.sha256hex('Welcome to Amazon S3.');
  check('S3 example: PUT object (key needing encoding: test$file.text)', S.signature({ method: 'PUT', path: '/' + S.uriEncode('test$file.text', true), query: [], headers: { host: H, date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-date': SD, 'x-amz-storage-class': 'REDUCED_REDUNDANCY', 'x-amz-content-sha256': ph }, payloadHash: ph }, s3c, SD).signature === '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
  check('S3 example: GET bucket (list) with query', S.signature({ method: 'GET', path: '/', query: [['max-keys', '2'], ['prefix', 'J']], headers: { host: H, 'x-amz-content-sha256': E, 'x-amz-date': SD }, payloadHash: E }, s3c, SD).signature === '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
  const pre = S.presign({ method: 'GET', path: '/test.txt', headers: { host: H } }, s3c, 86400, { amzDate: SD });
  check('S3 example: presigned GET URL', pre.signature === 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404', pre.signature);
  check('uriEncode: RFC 3986 (space, unicode, slash kept only in paths)', S.uriEncode('a b/ü~') === 'a%20b%2F%C3%BC~' && S.uriEncode('a b/ü~', true) === 'a%20b/%C3%BC~');
  const sh = S.signHeaders({ method: 'GET', path: '/x', query: [], headers: { host: 'h' }, payloadHash: E }, s3c, { amzDate: SD });
  check('signHeaders: Authorization header format', /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20130524\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/.test(sh.headers.Authorization), sh.headers.Authorization); // AWS SigV4 documentation test vector – fale-secret-scan: allow
}

// ================================================================== 2. mock S3 that verifies signatures
const S3_PORT = 8916, BUCKET = 'fale-one-test', AK = 'TESTACCESSKEY01', SK = 'test-secret-key-0123456789abcdef', REGION = 'eu-central';
const objects = new Map(); // key → Buffer
const s3log = [];
let pageSize = 1000;
function verify(req, u, body) {
  const q = [...u.searchParams.entries()];
  const rawPath = u.pathname; // already encoded as sent
  const creds = { accessKeyId: AK, secretAccessKey: SK, region: REGION, service: 's3' };
  if (u.searchParams.has('X-Amz-Signature')) {
    const sig = u.searchParams.get('X-Amz-Signature');
    const date = u.searchParams.get('X-Amz-Date');
    const exp = Number(u.searchParams.get('X-Amz-Expires'));
    const t = Date.parse(date.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
    if (!(t + exp * 1000 > Date.now())) return 'expired';
    if (!u.searchParams.get('X-Amz-Credential').startsWith(AK + '/')) return 'bad credential';
    const names = u.searchParams.get('X-Amz-SignedHeaders').split(';');
    const headers = Object.fromEntries(names.map(n => [n, n === 'host' ? req.headers.host : String(req.headers[n] ?? '')]));
    if (names.includes('content-length') && Number(req.headers['content-length']) !== body.length) return 'length';
    const s = S.signature({ method: req.method, path: rawPath, query: q.filter(([k]) => k !== 'X-Amz-Signature'), headers, payloadHash: 'UNSIGNED-PAYLOAD' }, creds, date);
    return s.signature === sig ? null : 'signature mismatch';
  }
  const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([0-9a-f]{64})$/.exec(String(req.headers.authorization || ''));
  if (!m || m[1] !== AK || m[3] !== REGION) return 'no auth';
  const names = m[4].split(';');
  const headers = Object.fromEntries(names.map(n => [n, n === 'host' ? req.headers.host : String(req.headers[n] ?? '')]));
  const ph = String(req.headers['x-amz-content-sha256'] || '');
  if (ph !== S.sha256hex(body)) return 'payload hash';
  if (req.headers['content-md5'] && req.headers['content-md5'] !== crypto.createHash('md5').update(body).digest('base64')) return 'md5';
  const s = S.signature({ method: req.method, path: rawPath, query: q, headers, payloadHash: ph }, creds, String(req.headers['x-amz-date']));
  return s.signature === m[5] ? null : 'signature mismatch';
}
const s3srv = http.createServer(async (req, res) => {
  const ch = []; for await (const c of req) ch.push(c);
  const body = Buffer.concat(ch);
  const u = new URL(req.url, 'http://x');
  const bad = verify(req, u, body);
  s3log.push({ method: req.method, path: u.pathname, presigned: u.searchParams.has('X-Amz-Signature'), bad });
  if (bad) { res.statusCode = 403; return res.end(`<Error><Code>SignatureDoesNotMatch</Code><Message>${bad}</Message></Error>`); }
  const parts = u.pathname.split('/').slice(1);
  if (parts[0] !== BUCKET) { res.statusCode = 404; return res.end('<Error><Code>NoSuchBucket</Code></Error>'); }
  const key = parts.slice(1).map(decodeURIComponent).join('/');
  if (req.method === 'PUT' && key) { objects.set(key, body); res.statusCode = 200; res.setHeader('ETag', '"x"'); return res.end(); }
  if (req.method === 'GET' && key) { const o = objects.get(key); if (!o) { res.statusCode = 404; return res.end('<Error><Code>NoSuchKey</Code></Error>'); } res.statusCode = 200; return res.end(o); }
  if (req.method === 'GET' && !key && u.searchParams.get('list-type') === '2') {
    const prefix = u.searchParams.get('prefix') || '';
    const max = Math.min(pageSize, Number(u.searchParams.get('max-keys') || 1000));
    const all = [...objects.keys()].filter(k => k.startsWith(prefix)).sort();
    const start = u.searchParams.get('continuation-token') ? all.indexOf(Buffer.from(u.searchParams.get('continuation-token'), 'base64url').toString()) + 1 : 0;
    const page = all.slice(start, start + max);
    const trunc = start + max < all.length;
    const xml = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${BUCKET}</Name><Prefix>${prefix}</Prefix><KeyCount>${page.length}</KeyCount><IsTruncated>${trunc}</IsTruncated>`
      + (trunc ? `<NextContinuationToken>${Buffer.from(page.at(-1)).toString('base64url')}</NextContinuationToken>` : '')
      + page.map(k => `<Contents><Key>${k.replace(/&/g, '&amp;')}</Key><Size>${objects.get(k).length}</Size></Contents>`).join('') + '</ListBucketResult>';
    res.statusCode = 200; res.setHeader('Content-Type', 'application/xml'); return res.end(xml);
  }
  if (req.method === 'POST' && !key && u.searchParams.has('delete')) {
    if (!req.headers['content-md5']) { res.statusCode = 400; return res.end('<Error><Code>MissingContentMD5</Code></Error>'); }
    for (const m of body.toString().matchAll(/<Key>([\s\S]*?)<\/Key>/g)) objects.delete(m[1].replace(/&amp;/g, '&'));
    res.statusCode = 200; return res.end('<DeleteResult/>');
  }
  res.statusCode = 400; res.end('<Error><Code>Unsupported</Code></Error>');
});
await new Promise(r => s3srv.listen(S3_PORT, '127.0.0.1', r));
const S3_ENV = { BLOBSTORE: 's3', S3_ENDPOINT: `http://127.0.0.1:${S3_PORT}`, S3_BUCKET: BUCKET, S3_REGION: REGION, S3_ACCESS_KEY_ID: AK, S3_SECRET_ACCESS_KEY: SK };

// ================================================================== 3. S3 client / blobstore in isolation
{
  const c = S.client({ endpoint: S3_ENV.S3_ENDPOINT, bucket: BUCKET, region: REGION, accessKeyId: AK, secretAccessKey: SK });
  await c.putObject('t/a b/ü&1', Buffer.from('hallo'));
  check('client: PUT with header auth (key with space, umlaut, &) accepted by the verifying mock', objects.get('t/a b/ü&1')?.toString() === 'hallo', s3log.at(-1));
  check('client: GET', (await c.getObject('t/a b/ü&1')).toString() === 'hallo');
  check('client: GET missing → null', (await c.getObject('t/none')) === null);
  for (let i = 0; i < 5; i++) await c.putObject(`t/p/${i}`, Buffer.alloc(i + 1));
  pageSize = 2;
  const l = await c.listPrefix('t/p/');
  pageSize = 1000;
  check('client: ListObjectsV2 follows continuation tokens', l.length === 5 && l.map(x => x.size).join() === '1,2,3,4,5', l);
  const n = await c.deleteObjects(['t/p/0', 't/p/1', 't/a b/ü&1']);
  check('client: DeleteObjects (Content-MD5, XML-escaped keys)', n === 3 && !objects.has('t/p/0') && !objects.has('t/a b/ü&1') && objects.has('t/p/2'));
  const bad = S.client({ endpoint: S3_ENV.S3_ENDPOINT, bucket: BUCKET, region: REGION, accessKeyId: AK, secretAccessKey: 'wrong-secret-key-0123456789abcdef' });
  let e = null; try { await bad.putObject('t/x', Buffer.from('x')); } catch (x) { e = x; }
  check('mock rejects a wrong secret (signature check is real)', e && e.status === 403 && e.code === 's3_error');
  const p = c.presignPut('t/direct', 4, 600);
  let r = await fetch(p.url, { method: 'PUT', headers: p.headers, body: Buffer.from('1234') });
  check('presigned PUT with the signed content-length works', r.status === 200 && objects.get('t/direct').toString() === '1234');
  r = await fetch(p.url, { method: 'PUT', body: Buffer.from('12345') });
  check('presigned PUT with another length is rejected', r.status === 403);
  const g = c.presignGet('t/direct', 600);
  r = await fetch(g.url);
  check('presigned GET', r.status === 200 && (await r.text()) === '1234');
  r = await fetch(g.url.replace('t/direct', 't/p/2'));
  check('presigned GET URL cannot be reused for another key', r.status === 403);
  const old = S.client({ endpoint: S3_ENV.S3_ENDPOINT, bucket: BUCKET, region: REGION, accessKeyId: AK, secretAccessKey: SK, now: () => new Date(Date.now() - 3600e3) }).presignGet('t/direct', 60);
  r = await fetch(old.url);
  check('expired presigned URL is rejected', r.status === 403);
  const vh = S.client({ endpoint: 'https://fsn1.your-objectstorage.com', bucket: 'b1', region: 'eu-central', accessKeyId: AK, secretAccessKey: SK, pathStyle: false });
  check('virtual-hosted style URL', vh.url('one/v1/x').startsWith('https://b1.fsn1.your-objectstorage.com/one/v1/x'));
  Object.assign(process.env, S3_ENV);
  const bc = B.blobConfig();
  check('blobConfig from env (BLOBSTORE=s3), s3Configured', bc.kind === 's3' && B.s3Configured(bc) && bc.s3.prefix === 'one/v1');
  check('s3Configured: http endpoint refused on production', (() => { process.env.VERCEL_ENV = 'production'; const x = B.s3Configured(B.blobConfig()); delete process.env.VERCEL_ENV; return x === false; })());
  check('s3Configured: missing secret → false', (() => { const k = process.env.S3_SECRET_ACCESS_KEY; delete process.env.S3_SECRET_ACCESS_KEY; const x = B.s3Configured(B.blobConfig()); process.env.S3_SECRET_ACCESS_KEY = k; return x === false; })());
  for (const k of Object.keys(S3_ENV)) delete process.env[k];
  check('default backend is postgres', B.blobConfig().kind === 'pg');
  objects.clear();
}

// ================================================================== 4. drive API with BLOBSTORE=s3
const { startHarness } = await import('../acct/account_harness.mjs');
const K = await import('/home/claude/FalePDF/js/one/crypto.js');
const { createClient } = await import('/home/claude/FalePDF/js/one/api.js');
const PORT = 8912;
const { SB } = await startHarness(PORT);
const APP = `http://127.0.0.1:${PORT}`;
const PKEY = 'sb_publishable_test_key_0123456789';
const T = (p, o) => fetch(APP + p, o).then(r => r.json());
const sql = async (q) => { const r = await T('/__test/sql', { method: 'POST', body: q }); if (r.error) throw new Error(r.error); return r.rows; };
const qs = o => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
await T('/__test/reset?' + qs({ ...S3_ENV, ONE_CHUNK_KB: '64', CRON_SECRET: 'cron-secret-0123456789abcdef' }));
async function signIn(email) {
  const post = (p, b) => fetch(SB + p, { method: 'POST', headers: { apikey: PKEY, 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
  await post('/auth/v1/otp', { email, create_user: true });
  const { code } = await T(`/__test/otp?email=${encodeURIComponent(email)}`);
  const s = await post('/auth/v1/verify', { type: 'email', email, token: code });
  const keys = await K.deriveKeys(await K.importMasterRaw(new Uint8Array(crypto.randomBytes(32))), s.user.id);
  return { token: s.access_token, id: s.user.id, keys, one: createClient({ baseUrl: APP, getToken: async () => s.access_token, retries: 1, retryDelayMs: 10 }) };
}
async function api(a, body, { token, query = '', raw } = {}) {
  const headers = { 'Content-Type': raw ? 'application/octet-stream' : 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${APP}/api/drive?a=${a}${query}`, { method: 'POST', headers, body: raw || JSON.stringify(body || {}) });
  const buf = Buffer.from(await r.arrayBuffer());
  let j = null; try { j = JSON.parse(buf.toString()); } catch {}
  return { status: r.status, ...(j || {}), _buf: buf };
}
const s3FlowStart = s3log.length;
{
  const A = await signIn('s3anna@example.com');
  let r = await api('config');
  check('config: backend s3, direct uploads', r.backend === 's3' && r.direct === true, r);
  const content = bytes(200000), thumb = bytes(3000);
  const logBefore = (await T('/__test/log')).n;
  const s3Before = s3log.length;
  const up = await A.one.uploadFile({ keys: A.keys, file: content, name: 'Foto.jpg', kind: 'photo', thumb });
  const node = up.node;
  const cblob = node.head.blobs.find(b => b.purpose === 'content'), tblob = node.head.blobs.find(b => b.purpose === 'thumb');
  check('content blob on s3, thumbnail in Postgres', cblob.backend === 's3' && tblob.backend === 'pg', node.head.blobs);
  const keysInS3 = [...objects.keys()].filter(k => k.startsWith(`one/v1/${A.id}/${cblob.id}/`));
  check('chunks stored as one/v1/<user>/<blob>/<i> objects', keysInS3.length === cblob.chunks && cblob.chunks === 4, keysInS3);
  const direct = s3log.slice(s3Before).filter(x => x.method === 'PUT' && x.presigned && !x.bad).length;
  check('client uploaded every chunk directly with presigned PUTs', direct === 4, s3log.slice(s3Before));
  const rpcLog = (await T('/__test/log?since=' + logBefore)).log;
  check('no content chunk passed through the database', !rpcLog.some(l => l.path.includes('fale_one_chunk_put') && l.size > 10000));
  const back = await A.one.downloadFile({ keys: A.keys, node });
  check('download via presigned GETs decrypts', eq(back, content));
  r = await api('get', null, { token: A.token, query: `&b=${cblob.id}&i=1` });
  check('API proxy download (fallback) also works for s3 blobs', r.status === 200 && r._buf.length === 65536, r.status);
  check('thumbnail batch still served from Postgres', (await A.one.thumbnails(A.keys, [node])).get(node.id).length === 3000);
  r = await api('download.urls', { blobId: tblob.id }, { token: A.token });
  check('download.urls for a Postgres blob → 409 not_direct', r.status === 409 && r.error === 'not_direct', r);

  // commit verification by listing
  const nodeId = K.uuid(), revId = K.uuid();
  const nk = await K.createNodeKey(A.keys, nodeId);
  const fk = await K.createFileKey(nk.key, { userId: A.id, nodeId, revId });
  const lay = K.layout(150000, 65536);
  const s = await A.one.uploadCreate({ purpose: 'content', size: lay.cipherSize, chunks: lay.chunks });
  check('upload.create on s3: direct', s.backend === 's3' && s.direct === true, s);
  const urls = (await A.one.uploadUrls(s.uploadId)).urls;
  check('upload.urls: one presigned PUT per chunk with exact sizes', urls.length === 3 && urls[0].size === 65536 && urls[2].size === lay.cipherSize - 2 * 65536 && urls[0].headers['Content-Length'] === '65536', urls.map(u => u.size));
  const ctx = { userId: A.id, nodeId, revId, blobId: s.uploadId, purpose: 'content' };
  const bk = await K.blobKey(fk.key, s.uploadId, 'content');
  const plain = bytes(150000);
  const sealed = [];
  for (let i = 0; i < 3; i++) sealed.push(await K.sealChunk(bk, ctx, i, 3, plain.subarray(i * lay.plainChunk, (i + 1) * lay.plainChunk)));
  await fetch(urls[2].url, { method: 'PUT', headers: urls[2].headers, body: sealed[2] });
  await fetch(urls[0].url, { method: 'PUT', headers: urls[0].headers, body: sealed[0] });
  let st = await A.one.uploadStatus(s.uploadId);
  check('upload.status on s3 lists what arrived', JSON.stringify(st.received) === '[0,2]', st);
  const rm = await K.sealRevMeta(fk.key, { userId: A.id, nodeId, revId }, { v: 1, size: 150000, digest: K.hex(await K.contentDigest(plain)) });
  const nm = await K.sealMeta(nk.key, { userId: A.id, kind: 'file', id: nodeId }, { v: 1, name: 'x.bin' });
  const body = { nodeId, kind: 'file', baseVersion: 0, key: nk.wrapped, meta: nm, rev: { id: revId, key: fk.wrapped, meta: rm }, content: s.uploadId };
  r = await api('commit', body, { token: A.token });
  check('commit with a missing object → 409 incomplete', r.status === 409 && r.error === 'incomplete', r);
  r = await api('upload.put', null, { token: A.token, query: `&u=${s.uploadId}&i=1`, raw: sealed[1].subarray(0, 100) });
  check('proxy upload.put checks the size for s3 too', r.status === 400 && r.error === 'bad_size', r);
  r = await api('upload.put', null, { token: A.token, query: `&u=${s.uploadId}&i=1`, raw: sealed[1] });
  check('proxy upload.put (fallback) stores into the bucket', r.status === 200 && objects.has(`one/v1/${A.id}/${s.uploadId}/1`), r);
  objects.set(`one/v1/${A.id}/${s.uploadId}/7`, Buffer.alloc(10));
  r = await api('commit', body, { token: A.token });
  check('commit with a stray extra object → 409 incomplete', r.status === 409 && r.error === 'incomplete', r);
  objects.delete(`one/v1/${A.id}/${s.uploadId}/7`);
  objects.set(`one/v1/${A.id}/${s.uploadId}/2`, Buffer.alloc(5));
  r = await api('commit', body, { token: A.token });
  check('commit with a wrong object size → 409 incomplete', r.status === 409 && r.error === 'incomplete', r);
  objects.set(`one/v1/${A.id}/${s.uploadId}/2`, Buffer.from(sealed[2]));
  r = await api('commit', body, { token: A.token });
  check('commit when the listing matches exactly', r.status === 200 && r.node.head.blobs[0].backend === 's3', r);
  const n2 = r.node;
  check('download of the mixed (direct + proxied) upload', eq(await A.one.downloadFile({ keys: A.keys, node: n2 }), plain));
  r = await api('upload.urls', { uploadId: s.uploadId }, { token: A.token });
  check('no presigned PUT for a committed blob', r.status === 404 && r.error === 'no_upload', r);

  // deletion → gc queue → worker removes objects
  await A.one.trash(n2.id);
  await A.one.deleteForever(n2.id);
  const [q] = await sql(`select count(*) n from private.fale_one_gc where blob_id = '${n2.head.blobs[0].id}'`);
  check('deleted s3 blob is queued for the gc worker', q.n === '1', q);
  check('objects still there before gc', objects.has(`one/v1/${A.id}/${n2.head.blobs[0].id}/0`));
  r = await fetch(`${APP}/api/drive?a=gc`, { headers: { Authorization: 'Bearer wrong-secret-0123456789' } });
  check('gc with a wrong CRON_SECRET → 403', r.status === 403);
  r = await fetch(`${APP}/api/drive?a=gc`, { headers: { Authorization: 'Bearer cron-secret-0123456789abcdef' } }).then(x => x.json());
  check('gc worker (GET, Vercel Cron style) deletes the objects and the queue entry', r.ok && r.deleted >= 1 && ![...objects.keys()].some(k => k.includes(n2.head.blobs[0].id)), r);
  const [q2] = await sql(`select count(*) n from private.fale_one_gc`);
  check('gc queue empty afterwards', q2.n === '0', q2);
  const ab = await A.one.uploadCreate({ purpose: 'content', size: 1000, chunks: 1 });
  const u0 = (await A.one.uploadUrls(ab.uploadId)).urls[0];
  await fetch(u0.url, { method: 'PUT', headers: u0.headers, body: Buffer.alloc(1000) });
  await A.one.uploadAbort(ab.uploadId);
  await fetch(`${APP}/api/drive?a=gc`, { headers: { Authorization: 'Bearer cron-secret-0123456789abcdef' } });
  check('aborted direct upload: objects removed by gc', ![...objects.keys()].some(k => k.includes(ab.uploadId)));

  // account deletion removes the bucket objects immediately (hook in /api/account?a=delete)
  const D = await signIn('s3dora@example.com');
  const dn = (await D.one.uploadFile({ keys: D.keys, file: bytes(100000), name: 'd.bin' })).node;
  check('D has objects in the bucket', [...objects.keys()].some(k => k.startsWith(`one/v1/${D.id}/`)));
  r = await fetch(`${APP}/api/account?a=delete`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${D.token}` }, body: JSON.stringify({ confirm: 'LÖSCHEN' }) }).then(x => x.json());
  check('account deletion removes the user\'s bucket objects', r.ok && ![...objects.keys()].some(k => k.startsWith(`one/v1/${D.id}/`)) && dn, r);
  check('A\'s objects untouched', objects.has(`one/v1/${A.id}/${cblob.id}/0`));
  check('every request the API/clients sent to S3 in the drive flow carried a valid signature', s3log.slice(s3FlowStart).every(x => !x.bad) && s3log.length - s3FlowStart > 20, s3log.slice(s3FlowStart).filter(x => x.bad));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
