import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, compareDns, annotate, main } from '../tools/monitor.mjs';
import { desiredRecords } from '../../scripts/mail-dns.mjs';
import { STATUS } from './fixtures.mjs';

const healthy = (over = {}) => ({
  ...STATUS, generatedAt: new Date().toISOString(), versions: { stalwart: '0.16.25' },
  gitops: { ok: true, commit: 'abc' }, tls: { issuer: "CN=R11,O=Let's Encrypt,C=US", daysLeft: 60 },
  queue: { size: 0 }, disk: { usedPct: 12 }, blocklists: { 'zen.spamhaus.org': 'clean' }, port25Outbound: true,
  ptr: { ipv4: 'mail.fale.network', ipv6: 'mail.fale.network' }, backup: { enabled: true, lastSuccess: new Date().toISOString() },
  sealed: {}, ...over,
});
const levels = (f) => f.filter((x) => x.level !== 'notice').map((x) => `${x.level}:${x.msg}`);

test('healthy status yields only notices', () => {
  assert.deepEqual(levels(evaluate(healthy())), []);
});

test('problems are classified', () => {
  const f = levels(evaluate(healthy({
    generatedAt: new Date(Date.now() - 9 * 3600e3).toISOString(), gitops: { ok: false, error: 'hash mismatch' },
    tls: { issuer: 'CN=rcgen self signed cert', daysLeft: 9999 }, queue: { size: 5000 }, disk: { usedPct: 85 },
    blocklists: { 'zen.spamhaus.org': 'listed:127.0.0.2', 'bl.spamcop.net': 'error' }, port25Outbound: false,
    ptr: { ipv4: 'static.25.113.0.203.clients.your-server.de' }, backup: { enabled: true, lastSuccess: null }, dkim: [],
  })));
  for (const re of [/^error:status\.json is stale/, /^error:GitOps failed: hash mismatch/, /^error:No ACME certificate/, /^error:Mail queue: 5000/,
    /^warning:Disk 85%/, /^error:IPv4 .* zen\.spamhaus\.org/, /^warning:Blocklist bl\.spamcop\.net/, /^warning:Outbound port 25/,
    /^warning:Reverse DNS/, /^error:Backup failing/, /^error:No DKIM/]) {
    assert.ok(f.some((x) => re.test(x)), `missing ${re}`);
  }
  assert.equal(evaluate({ schema: 'x' })[0].level, 'error');
});

test('compareDns flags missing DKIM as error and wrong SRV as warning', () => {
  const desired = desiredRecords({ ipv4: STATUS.ipv4, dkim: STATUS.dkim });
  const live = {
    'A mail.fale.network': ['203.0.113.25'],
    'MX fale.network': ['10 mail.fale.network'],
    'TXT v1-rsa-20261016._domainkey.fale.network': [],
    'TXT v1-ed25519-20261016._domainkey.fale.network': [STATUS.dkim[0].value],
    'SRV _imaps._tcp.fale.network': ['0 1 143 mail.fale.network'],
  };
  const f = compareDns(desired, live);
  assert.equal(f.length, 2);
  assert.ok(f.some((x) => x.level === 'error' && x.msg.includes('v1-rsa-20261016')));
  assert.ok(f.some((x) => x.level === 'warning' && x.msg.includes('_imaps')));
});

test('annotations and exit code', () => {
  const out = [];
  assert.equal(annotate([{ level: 'notice', msg: 'a' }, { level: 'warning', msg: 'b\nc' }], (l) => out.push(l)), 0);
  assert.deepEqual(out, ['::notice title=FaLe Mail::a', '::warning title=FaLe Mail::b c']);
  assert.equal(annotate([{ level: 'error', msg: 'x' }], () => {}), 1);
});

test('no server yet → notice and exit 0 (workflow must not fail)', async () => {
  const out = [];
  const code = await main({}, (l) => out.push(l), { resolve4: async () => { const e = new Error('nx'); e.code = 'ENOTFOUND'; throw e; } });
  assert.equal(code, 0);
  assert.match(out[0], /^::notice .*No mail server yet/);
});

test('server announced but unreachable → warning unless MAIL_SERVER_EXPECTED', async () => {
  const unreachable = { MAIL_SERVER_IP: '127.0.0.1' }; // nothing listens on 443 here
  const out = [];
  assert.equal(await main(unreachable, (l) => out.push(l), { resolve4: async () => [] }), 0);
  assert.match(out[0], /^::warning .*status\.json not reachable/);
  assert.equal(await main({ ...unreachable, MAIL_SERVER_EXPECTED: 'true' }, () => {}, { resolve4: async () => [] }), 1);
});
