import { readFileSync } from 'node:fs';
import { startMock, SUPABASE_KEY } from '/home/claude/FalePDF/scripts/android-one-e2e/mock-api.mjs';
import { verifyBackup } from '/home/claude/FalePDF/scripts/android-one-e2e/verify-backup.mjs';
import * as K from '/home/claude/FalePDF/one/js/shared/one/crypto.js';
import { createClient } from '/home/claude/FalePDF/one/js/shared/one/api.js';
import { parseExif, exifToMeta } from '/home/claude/FalePDF/one/js/media.js';
const mock = await startMock({ port: 8799 });
const userId = K.uuid(), mkRaw = K.rnd(32), deviceId = 'E2E_' + K.b64u(K.rnd(12)), deviceName = 'E2E Pixel';
let sess = mock.session({ id: userId, email: 'e2e@example.invalid' }, { accessExpired: true });
let refresh = sess.refresh, access = sess.access;
const getToken = async ({ refresh: force }) => {
  if (force || mock.st.access.get(access) < Date.now()) {
    const r = await fetch(mock.url + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refresh }) });
    const j = await r.json(); if (!r.ok) throw new Error('refresh ' + JSON.stringify(j)); refresh = j.refresh_token; access = j.access_token;
  }
  return access;
};
const api = createClient({ baseUrl: mock.url, getToken });
const keys = await K.deriveKeys(await K.importMasterRaw(mkRaw), userId);
const fid = K.uuid(); const nk = await K.createNodeKey(keys, fid);
await api.mkdir({ nodeId: fid, parentId: null, key: nk.wrapped, meta: await K.sealMeta(nk.key, { userId, kind: 'folder', id: fid }, { v: 1, name: 'Fotos', role: 'photos' }) });
const sof = (w, h) => new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
const dims = { 'fale-e2e-1.jpg': [320, 240], 'fale-e2e-2.jpg': [320, 240], 'fale-e2e-3.jpg': [1800, 2400] };
const fixtures = [];
for (const name of Object.keys(dims)) {
  const bytes = new Uint8Array(readFileSync('/home/claude/FalePDF/scripts/android-one-e2e/fixtures/' + name));
  const [w, h] = dims[name]; const taken = 1777630500000;
  const s = Math.min(1, 256 / Math.max(w, h)), tw = Math.round(w * s), th = Math.round(h * s);
  const big = Math.max(w, h) > 1840; const ps = 1600 / Math.max(w, h);
  const meta = { ...exifToMeta(parseExif(bytes)), w, h, thumbMime: 'image/jpeg', previewMime: 'image/jpeg' };
  if (!meta.takenAt) meta.takenAt = '2026-05-01T10:15:00+02:00';
  await api.uploadFile({ keys, file: bytes, name, mime: 'image/jpeg', mtime: taken, kind: 'photo', parentId: fid, meta, thumb: sof(tw, th), preview: big ? sof(Math.round(w * ps), Math.round(h * ps)) : undefined, deviceId });
  fixtures.push({ name, bytes, taken, w, h });
}
await api.backupReport({ deviceId, status: 'idle', pending: 0, success: true, meta: await K.sealDeviceMeta(keys, deviceId, { v: 1, name: deviceName, platform: 'android', app: 'one-1.0.0' }) });
// (JS uploadFile writes rmeta.thumb without w/h – patch expectation by checking only problems unrelated to that)
const r = await verifyBackup({ mock, mkRaw, userId, deviceId, deviceName, fixtures });
console.log(JSON.stringify(r, null, 1));
console.log('refreshes', mock.st.refreshes, 'reuse', mock.st.reuse, 'chunks of big', mock.photoNodes().map(n => n.head.blobs.map(b => b.purpose + ':' + b.chunks).join(',')));
// reuse detection: present the first (rotated) token again
const rr = await fetch(mock.url + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: sess.refresh }) });
console.log('reuse status', rr.status, 'reuse', mock.st.reuse, 'session alive', !!mock.st.refresh);
await mock.close();
