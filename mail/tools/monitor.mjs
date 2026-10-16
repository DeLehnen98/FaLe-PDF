#!/usr/bin/env node
// FaLe Mail monitor (used by .github/workflows/mail-monitor.yml; runs anywhere with Node ≥ 20, no SSH).
// Reads https://mail.fale.network/fale/status.json, checks live DNS, TLS and the MTA-STS policy, and prints
// GitHub annotations (::notice/::warning/::error). Exit 1 only on errors. While no server exists yet
// (mail.fale.network does not resolve and MAIL_SERVER_IP is unset) it prints a notice and exits 0.
import { Resolver } from 'node:dns/promises';
import tls from 'node:tls';
import https from 'node:https';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { desiredRecords, fetchStatus, mtaStsPolicy, MAIL_HOST, DOMAIN } from '../../scripts/mail-dns.mjs';

const H = 3600e3;

/** Pure checks on status.json → findings. */
export function evaluate(s, now = Date.now()) {
  const f = [];
  const add = (level, msg) => f.push({ level, msg });
  if (s?.schema !== 'fale-mail-status/1') return [{ level: 'error', msg: 'status.json has an unexpected schema' }];
  const age = now - Date.parse(s.generatedAt);
  if (!(age < 8 * H)) add('error', `status.json is stale (generated ${s.generatedAt}) – agent or server down?`);
  else if (age > 4 * H) add('warning', `status.json is ${Math.round(age / H)} h old`);
  if (!s.gitops?.ok) add('error', `GitOps failed: ${s.gitops?.error || 'never ran'}`);
  if (s.tls?.error) add('error', `TLS: ${s.tls.error}`);
  else if (/self signed/i.test(s.tls?.issuer || '')) add('error', 'No ACME certificate yet (self-signed) – DNS for mail.fale.network set? port 443 reachable?');
  else if (s.tls?.daysLeft < 14) add('error', `TLS certificate expires in ${s.tls.daysLeft} days`);
  else if (s.tls?.daysLeft < 21) add('warning', `TLS certificate expires in ${s.tls.daysLeft} days`);
  if (s.stalwartError) add('error', `Stalwart API: ${s.stalwartError}`);
  const q = s.queue?.size ?? 0;
  if (q > 1000) add('error', `Mail queue: ${q} messages`); else if (q > 100) add('warning', `Mail queue: ${q} messages`);
  const d = s.disk?.usedPct ?? 0;
  if (d > 90) add('error', `Disk ${d}% used`); else if (d > 80) add('warning', `Disk ${d}% used`);
  for (const [zone, res] of Object.entries(s.blocklists || {})) {
    if (String(res).startsWith('listed')) add('error', `IPv4 ${s.ipv4} is listed on ${zone} (${res})`);
    else if (res === 'error') add('warning', `Blocklist ${zone} could not be queried`);
  }
  if (s.port25Outbound === false) add('warning', 'Outbound port 25 is blocked – request the unblock at the provider (docs/FALE-MAIL.md)');
  if (s.ipv4 && s.ptr?.ipv4 !== MAIL_HOST) add('warning', `Reverse DNS (PTR) of ${s.ipv4} is "${s.ptr?.ipv4 || 'missing'}", expected ${MAIL_HOST}`);
  if (s.ipv6 && s.ptr?.ipv6 && s.ptr.ipv6 !== MAIL_HOST) add('warning', `Reverse DNS (PTR) of ${s.ipv6} is "${s.ptr.ipv6}", expected ${MAIL_HOST}`);
  if (!s.dkim?.length) add('error', 'No DKIM keys reported');
  if (!s.backup?.enabled) add('notice', 'Backups not configured yet (optional, see docs/FALE-MAIL.md#backups)');
  else if (!s.backup.lastSuccess || now - Date.parse(s.backup.lastSuccess) > 48 * H) add('error', `Backup failing (last success: ${s.backup.lastSuccess || 'never'})`);
  for (const [name, r] of Object.entries(s.sealed || {})) if (!r.ok) add('warning', `Sealed secret "${name}" not usable: ${r.error}`);
  add('notice', `Stalwart ${s.versions?.stalwart} · cert ${s.tls?.daysLeft ?? '?'} d · queue ${q} · disk ${d}% · commit ${(s.gitops?.commit || '').slice(0, 10)}`);
  return f;
}

/** Compare live DNS answers with the desired records. `live` maps "TYPE name" → array of normalised strings. */
export function compareDns(desired, live) {
  const f = [];
  for (const r of desired) {
    const fq = r.name ? `${r.name}.${DOMAIN}` : DOMAIN;
    const key = `${r.type} ${fq}`;
    const got = live[key];
    if (got === undefined) continue; // not looked up
    const want = r.type === 'MX' ? `${r.mxPriority} ${r.value}` : r.type === 'SRV' ? `${r.srv.priority} ${r.srv.weight} ${r.srv.port} ${r.srv.target}` : r.value;
    const n = (x) => String(x).replace(/\s+/g, '').replace(/\.$/, '');
    if (!got.some((g) => (r.type === 'TXT' ? n(g) === n(want) : n(g).toLowerCase() === n(want).toLowerCase()))) {
      f.push({ level: r.slot.startsWith('dkim:') || ['mx', 'mail-a', 'spf'].includes(r.slot) ? 'error' : 'warning',
        msg: `DNS ${key}: expected "${want.slice(0, 80)}", found ${got.length ? got.map((g) => `"${String(g).slice(0, 60)}"`).join(', ') : 'nothing'} – run scripts/mail-dns.mjs --apply` });
    }
  }
  return f;
}

export async function lookupDns(desired, servers = ['1.1.1.1', '9.9.9.9']) {
  const res = new Resolver({ timeout: 5000, tries: 2 });
  res.setServers(servers);
  const live = {};
  const q = async (type, fq) => {
    try {
      if (type === 'A') return await res.resolve4(fq);
      if (type === 'AAAA') return await res.resolve6(fq);
      if (type === 'MX') return (await res.resolveMx(fq)).map((m) => `${m.priority} ${m.exchange}`);
      if (type === 'TXT') return (await res.resolveTxt(fq)).map((c) => c.join(''));
      if (type === 'CNAME') return await res.resolveCname(fq);
      if (type === 'SRV') return (await res.resolveSrv(fq)).map((s) => `${s.priority} ${s.weight} ${s.port} ${s.name}`);
      if (type === 'CAA') return (await res.resolveCaa(fq)).map((c) => `${c.critical} ${c.issue ? `issue "${c.issue}"` : JSON.stringify(c)}`);
    } catch (e) {
      if (['ENOTFOUND', 'ENODATA'].includes(e.code)) return [];
      throw e;
    }
    return [];
  };
  for (const r of desired) {
    const fq = r.name ? `${r.name}.${DOMAIN}` : DOMAIN;
    const key = `${r.type} ${fq}`;
    if (!(key in live)) live[key] = await q(r.type, fq);
  }
  return live;
}

export function tlsCheck(port, host = MAIL_HOST) {
  return new Promise((resolve) => {
    const sock = tls.connect({ host, port, servername: host, timeout: 10000 }, () => {
      const c = sock.getPeerCertificate();
      resolve({ port, ok: sock.authorized, error: sock.authorizationError, daysLeft: Math.floor((Date.parse(c.valid_to) - Date.now()) / (24 * H)) });
      sock.end();
    });
    sock.on('error', (e) => resolve({ port, ok: false, error: e.code || e.message }));
    sock.on('timeout', () => { resolve({ port, ok: false, error: 'timeout' }); sock.destroy(); });
  });
}

function fetchText(url) {
  return new Promise((resolve) => {
    https.get(url, { timeout: 10000 }, (r) => { let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => resolve({ status: r.statusCode, body: d })); })
      .on('error', (e) => resolve({ status: 0, body: e.message }));
  });
}

export function annotate(findings, out = console.log) {
  for (const { level, msg } of findings) out(`::${level} title=FaLe Mail::${msg.replace(/\r?\n/g, ' ')}`);
  return findings.some((x) => x.level === 'error') ? 1 : 0;
}

export async function main(env = process.env, out = console.log, { resolve4 = (h) => new Resolver().resolve4(h) } = {}) {
  const summary = (lines) => { if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n'); };
  let ips = [];
  try { ips = await resolve4(MAIL_HOST); } catch { /* not there yet */ }
  if (!ips.length && !env.MAIL_SERVER_IP) {
    out(`::notice title=FaLe Mail::No mail server yet (${MAIL_HOST} does not resolve, MAIL_SERVER_IP unset) – skipping checks.`);
    summary(['### FaLe Mail', '', 'No server yet – nothing to check.']);
    return 0;
  }
  const bootstrap = !ips.length;
  const url = bootstrap ? `https://${env.MAIL_SERVER_IP}/fale/status.json` : `https://${MAIL_HOST}/fale/status.json`;
  let status;
  try {
    status = await fetchStatus(url, { insecure: bootstrap });
  } catch (e) {
    const level = env.MAIL_SERVER_EXPECTED === 'true' ? 'error' : 'warning';
    out(`::${level} title=FaLe Mail::status.json not reachable at ${url}: ${e.message}`);
    return level === 'error' ? 1 : 0;
  }
  const findings = evaluate(status);
  if (bootstrap) {
    findings.push({ level: 'warning', msg: `${MAIL_HOST} has no DNS yet – run scripts/mail-dns.mjs --status-url ${url} --insecure --apply` });
  } else {
    const desired = desiredRecords({ ipv4: status.ipv4, ipv6: status.ipv6, dkim: status.dkim, dmarc: env.MAIL_DMARC || 'none', mtaSts: env.MAIL_MTA_STS || 'testing' });
    findings.push(...compareDns(desired, await lookupDns(desired)));
    for (const port of [443, 465, 993]) {
      const t = await tlsCheck(port);
      if (!t.ok) findings.push({ level: 'error', msg: `TLS on ${MAIL_HOST}:${port}: ${t.error}` });
      else if (t.daysLeft < 14) findings.push({ level: 'error', msg: `TLS on port ${port} expires in ${t.daysLeft} days` });
    }
    const p = await fetchText(`https://mta-sts.${DOMAIN}/.well-known/mta-sts.txt`);
    if (p.status !== 200 || p.body.replace(/\r/g, '').trim() !== mtaStsPolicy(env.MAIL_MTA_STS || 'testing').trim()) {
      findings.push({ level: 'warning', msg: `MTA-STS policy at https://mta-sts.${DOMAIN}/.well-known/mta-sts.txt missing or different (HTTP ${p.status}) – copy mail/mta-sts/mta-sts.txt to network/.well-known/` });
    }
  }
  summary(['### FaLe Mail', '', '| Level | Finding |', '|---|---|', ...findings.map((x) => `| ${x.level} | ${x.msg.replace(/\|/g, '/')} |`)]);
  return annotate(findings, out);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => process.exit(code), (e) => { console.log(`::error title=FaLe Mail::monitor crashed: ${e.message}`); process.exit(1); });
}
