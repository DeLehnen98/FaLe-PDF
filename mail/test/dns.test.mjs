// node --test mail/test/  – DNS sync against a mocked Vercel REST API and a local HTTPS status.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { desiredRecords, planChanges, slotOf, main } from '../../scripts/mail-dns.mjs';
import { STATUS } from './fixtures.mjs';


test('desired records cover MX, SPF, DKIM, DMARC, MTA-STS, TLS-RPT, SRV, CAA', () => {
  const d = desiredRecords({ ipv4: STATUS.ipv4, ipv6: STATUS.ipv6, dkim: STATUS.dkim });
  const by = (slot) => d.find((r) => r.slot === slot);
  assert.equal(by('mail-a').value, '203.0.113.25');
  assert.equal(by('mx').value, 'mail.fale.network');
  assert.equal(by('mx').mxPriority, 10);
  assert.match(by('dmarc').value, /^v=DMARC1; p=none; rua=mailto:dmarc-reports@fale\.network/);
  assert.match(by('mta-sts').value, /^v=STSv1; id=[0-9a-f]{20}$/);
  assert.equal(by('dkim:v1-rsa-20261016').name, 'v1-rsa-20261016._domainkey');
  assert.deepEqual(by('srv:_submissions._tcp').srv, { priority: 0, weight: 1, port: 465, target: 'mail.fale.network' });
  assert.equal(by('caa').value, '0 issue "letsencrypt.org"');
  assert.notEqual(by('mta-sts').value, desiredRecords({ ipv4: '1.2.3.4', mtaSts: 'enforce' }).find((r) => r.slot === 'mta-sts').value);
  assert.equal(desiredRecords({ ipv4: '1.2.3.4', dkim: [{ selector: 'bad selector', value: 'x' }] }).filter((r) => r.slot.startsWith('dkim:')).length, 0);
});

test('slotOf leaves unrelated records alone', () => {
  assert.equal(slotOf({ name: '', type: 'TXT', value: 'google-site-verification=abc' }), null);
  assert.equal(slotOf({ name: '', type: 'A', value: '76.76.21.21' }), null);
  assert.equal(slotOf({ name: 'www', type: 'CNAME', value: 'cname.vercel-dns.com' }), null);
  assert.equal(slotOf({ name: '', type: 'TXT', value: '"v=spf1 include:x ~all"' }), 'spf');
});

test('planChanges: create, update, noop, foreign, prune stale DKIM', () => {
  const desired = desiredRecords({ ipv4: '203.0.113.25', dkim: STATUS.dkim });
  const existing = [
    { id: 'r1', name: 'mail', type: 'A', value: '198.51.100.1' },
    { id: 'r2', name: '', type: 'TXT', value: 'v=spf1 mx ~all' },
    { id: 'r3', name: 'v0-rsa-20260101._domainkey', type: 'TXT', value: 'v=DKIM1; k=rsa; p=OLD' },
    { id: 'r4', name: 'legacy._domainkey', type: 'TXT', value: 'v=DKIM1; p=OTHER' },
    { id: 'r5', name: '', type: 'MX', value: 'mx.forwarder.example', mxPriority: 10 },
    { id: 'r6', name: '', type: 'MX', value: 'mx2.forwarder.example', mxPriority: 20 },
    { id: 'r7', name: '', type: 'CAA', value: '0 issue "letsencrypt.org"' },
    { id: 'r8', name: '', type: 'TXT', value: 'google-site-verification=abc' },
  ];
  const c = planChanges(existing, desired);
  const act = (id) => c.find((x) => x.have?.id === id)?.action;
  assert.equal(act('r1'), 'update');
  assert.equal(act('r2'), 'noop');
  assert.equal(act('r3'), 'foreign');
  assert.equal(act('r4'), 'foreign');
  assert.equal(act('r5'), 'update');
  assert.equal(act('r6'), 'foreign');
  assert.equal(act('r7'), undefined, 'CAA is add-only');
  assert.equal(act('r8'), undefined);
  const pruned = planChanges(existing, desired, { prune: true });
  assert.equal(pruned.find((x) => x.have?.id === 'r3').action, 'delete');
  assert.equal(pruned.find((x) => x.have?.id === 'r4').action, 'foreign', 'non-Stalwart selectors are never deleted');
  assert.equal(pruned.find((x) => x.have?.id === 'r6').action, 'delete');
  assert.ok(!c.some((x) => x.slot === 'caa' && x.action === 'create'), 'existing CAA is enough');
});

function mockVercel() {
  const records = [{ id: 'rec_site', name: '', type: 'A', value: '76.76.21.21', ttl: 60 }, { id: 'rec_old', name: 'mail', type: 'A', value: '198.51.100.7', ttl: 60 }];
  let n = 0;
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      calls.push(`${req.method} ${url.pathname}`);
      if (req.headers.authorization !== 'Bearer test-token' || url.searchParams.get('teamId') !== 'team_test') { res.writeHead(403); return res.end('{}'); }
      const send = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      const b = body ? JSON.parse(body) : {};
      if (req.method === 'GET' && url.pathname === '/v4/domains/fale.network/records') {
        const start = Number(url.searchParams.get('until') || 0), page = records.slice(start, start + 5);
        return send({ records: page, pagination: { next: start + 5 < records.length ? start + 5 : null } });
      }
      if (req.method === 'POST' && url.pathname === '/v2/domains/fale.network/records') {
        assert.ok(b.type && 'name' in b && (b.type === 'SRV' ? b.srv?.target : b.value));
        const rec = { id: `rec_${++n}`, ...b };
        if (b.type === 'SRV') rec.value = `${b.srv.priority} ${b.srv.weight} ${b.srv.port} ${b.srv.target}`;
        records.push(rec);
        return send({ uid: rec.id, updated: Date.now() });
      }
      const m = url.pathname.match(/^\/v1\/domains\/records\/(.+)$/);
      if (req.method === 'PATCH' && m) { Object.assign(records.find((r) => r.id === m[1]), b); return send({ id: m[1] }); }
      const d = url.pathname.match(/^\/v2\/domains\/fale\.network\/records\/(.+)$/);
      if (req.method === 'DELETE' && d) { records.splice(records.findIndex((r) => r.id === d[1]), 1); return send({}); }
      res.writeHead(404); res.end('{}');
    });
  });
  return { server, records, calls };
}

test('end to end: status.json over HTTPS → plan → apply against mocked Vercel API → idempotent', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'fale-dns-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem')], { stdio: 'ignore' });
  const st = https.createServer({ key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) }, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(STATUS));
  });
  const v = mockVercel();
  await new Promise((r) => st.listen(0, '127.0.0.1', r));
  await new Promise((r) => v.server.listen(0, '127.0.0.1', r));
  t.after(() => { st.close(); v.server.close(); });
  const env = { VERCEL_TOKEN: 'test-token', VERCEL_TEAM_ID: 'team_test', VERCEL_API: `http://127.0.0.1:${v.server.address().port}` };
  const args = ['--status-url', `https://127.0.0.1:${st.address().port}/fale/status.json`, '--insecure', '--apply'];
  const logs = [];
  await assert.rejects(main(args.filter((a) => a !== '--insecure'), env, () => {}), /self[- ]signed|certificate/i, 'TLS is verified unless --insecure');
  await main(args, env, (l) => logs.push(l));
  const rec = (name, type) => v.records.filter((r) => r.name === name && r.type === type);
  assert.deepEqual(rec('mail', 'A').map((r) => r.value), ['203.0.113.25']);
  assert.equal(rec('mail', 'A')[0].id, 'rec_old', 'existing record updated in place');
  assert.deepEqual(rec('', 'A').map((r) => r.value), ['76.76.21.21'], 'website record untouched');
  assert.equal(rec('', 'MX')[0].mxPriority, 10);
  assert.equal(rec('v1-rsa-20261016._domainkey', 'TXT').length, 1);
  assert.equal(rec('_submissions._tcp', 'SRV')[0].srv.port, 465);
  assert.equal(rec('', 'CAA').length, 1);
  const before = v.records.length;
  const again = [];
  await main(args, env, (l) => again.push(l));
  assert.equal(v.records.length, before);
  assert.match(again.at(-1), /^0 change\(s\)/);
  assert.ok(!v.calls.some((c) => c.startsWith('DELETE')), 'nothing deleted without --prune');
});
