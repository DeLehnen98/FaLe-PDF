#!/usr/bin/env node
// FaLe Mail – DNS records for fale.network in Vercel DNS, derived from the mail server's public status.json.
//
//   node scripts/mail-dns.mjs                         # plan only (reads https://mail.fale.network/fale/status.json)
//   node scripts/mail-dns.mjs --apply                 # create/update records (needs env VERCEL_TOKEN)
//   node scripts/mail-dns.mjs --status-url https://<server-ip>/fale/status.json --insecure --apply
//                                                     # very first run, before mail.fale.network resolves
// Options: --ipv4 A --ipv6 B (override), --dmarc none|quarantine|reject (default none),
//          --mta-sts testing|enforce (default testing), --prune (delete stale DKIM selectors + foreign MX), --json
// Env: VERCEL_TOKEN, VERCEL_TEAM_ID (default: FaleNetwork team), VERCEL_API (tests).
// Only records this script owns are touched: other apex TXT (site verification etc.) and CAA entries stay.
import https from 'node:https';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DOMAIN = 'fale.network';
export const MAIL_HOST = `mail.${DOMAIN}`;
const TEAM_DEFAULT = 'team_RORTRNxCPjEZkE9WHaPcyQRu';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TTL = 300;
const DKIM_SELECTOR = /^v\d+-(rsa|ed25519)-\d{8}$/;

export function mtaStsPolicy(mode = 'testing') {
  const base = readFileSync(join(ROOT, 'mail/mta-sts/mta-sts.txt'), 'utf8');
  return base.replace(/^mode: .*$/m, `mode: ${mode}`);
}
export const mtaStsId = (policy) => createHash('sha256').update(policy).digest('hex').slice(0, 20);

const norm = (s) => String(s ?? '').trim().replace(/^"|"$/g, '').replace(/\.$/, '').toLowerCase();
// TXT values are case-sensitive (DKIM keys); long values may come back split into quoted chunks.
const txt = (s) => String(s ?? '').trim().replace(/"\s*"/g, '').replace(/^"|"$/g, '').replace(/\s+/g, '');

/** Desired record set. Each entry: {name,type,value,ttl,mxPriority?,srv?,slot} – `slot` decides which existing records it owns. */
export function desiredRecords({ ipv4, ipv6, dkim = [], dmarc = 'none', mtaSts = 'testing' }) {
  const r = [];
  const add = (name, type, value, slot, extra = {}) => r.push({ name, type, value, ttl: TTL, slot, ...extra });
  if (ipv4) add('mail', 'A', ipv4, 'mail-a');
  if (ipv6) add('mail', 'AAAA', ipv6, 'mail-aaaa');
  add('', 'MX', MAIL_HOST, 'mx', { mxPriority: 10 });
  add('', 'TXT', 'v=spf1 mx ~all', 'spf');
  add('mail', 'TXT', 'v=spf1 a -all', 'spf-helo');
  add('_dmarc', 'TXT', `v=DMARC1; p=${dmarc}; rua=mailto:dmarc-reports@${DOMAIN}; adkim=r; aspf=r`, 'dmarc');
  for (const k of dkim) {
    if (!k?.selector || !/^[a-z0-9-]+$/i.test(k.selector) || !/^v=DKIM1;/.test(k.value || '')) continue;
    add(`${k.selector}._domainkey`, 'TXT', k.value, `dkim:${k.selector}`);
  }
  add('_smtp._tls', 'TXT', `v=TLSRPTv1; rua=mailto:tls-reports@${DOMAIN}`, 'tlsrpt');
  add('mta-sts', 'CNAME', 'cname.vercel-dns.com', 'mta-sts-host');
  add('_mta-sts', 'TXT', `v=STSv1; id=${mtaStsId(mtaStsPolicy(mtaSts))}`, 'mta-sts');
  add('autoconfig', 'CNAME', MAIL_HOST, 'autoconfig');
  add('autodiscover', 'CNAME', MAIL_HOST, 'autodiscover');
  for (const [svc, port] of [['_submissions._tcp', 465], ['_submission._tcp', 587], ['_imaps._tcp', 993], ['_jmap._tcp', 443], ['_autodiscover._tcp', 443]]) {
    add(svc, 'SRV', `0 1 ${port} ${MAIL_HOST}`, `srv:${svc}`, { srv: { priority: 0, weight: 1, port, target: MAIL_HOST } });
  }
  add('', 'CAA', '0 issue "letsencrypt.org"', 'caa');
  return r;
}

/** Which slot does an existing Vercel record belong to (or null = not ours)? */
export function slotOf(rec) {
  const name = norm(rec.name), type = rec.type, v = norm(rec.value);
  if (type === 'A' && name === 'mail') return 'mail-a';
  if (type === 'AAAA' && name === 'mail') return 'mail-aaaa';
  if (type === 'MX' && name === '') return 'mx';
  if (type === 'TXT' && name === '' && v.startsWith('v=spf1')) return 'spf';
  if (type === 'TXT' && name === 'mail' && v.startsWith('v=spf1')) return 'spf-helo';
  if (type === 'TXT' && name === '_dmarc') return 'dmarc';
  if (type === 'TXT' && name.endsWith('._domainkey')) return `dkim:${name.slice(0, -'._domainkey'.length)}`;
  if (type === 'TXT' && name === '_smtp._tls') return 'tlsrpt';
  if (type === 'TXT' && name === '_mta-sts') return 'mta-sts';
  if (name === 'mta-sts') return 'mta-sts-host';
  if (name === 'autoconfig') return 'autoconfig';
  if (name === 'autodiscover') return 'autodiscover';
  if (type === 'SRV' && /^_[a-z]+\._tcp$/.test(name)) return `srv:${name}`;
  if (type === 'CAA' && name === '') return 'caa';
  return null;
}

function srvOf(rec) {
  if (rec.srv) return rec.srv;
  const t = String(rec.value ?? '').trim().split(/\s+/);
  if (t.length === 4) return { priority: +t[0], weight: +t[1], port: +t[2], target: t[3] };
  if (t.length === 3) return { priority: rec.priority ?? rec.mxPriority ?? 0, weight: +t[0], port: +t[1], target: t[2] };
  return null;
}

export function sameRecord(a, b) {
  if (a.type !== b.type) return false;
  if (a.type === 'MX') return norm(a.value) === norm(b.value) && Number(a.mxPriority ?? a.priority) === Number(b.mxPriority ?? b.priority);
  if (a.type === 'SRV') {
    const x = srvOf(a), y = srvOf(b);
    return !!x && !!y && x.priority === y.priority && x.weight === y.weight && x.port === y.port && norm(x.target) === norm(y.target);
  }
  if (a.type === 'TXT') return txt(a.value) === txt(b.value);
  return norm(a.value) === norm(b.value);
}

/** Diff existing Vercel records against the desired set. */
export function planChanges(existing, desired, { prune = false } = {}) {
  const changes = [];
  const bySlot = new Map();
  for (const rec of existing) {
    const s = slotOf(rec);
    if (s) bySlot.set(s, [...(bySlot.get(s) || []), rec]);
  }
  for (const want of desired) {
    const have = bySlot.get(want.slot) || [];
    bySlot.delete(want.slot);
    if (want.slot === 'caa') { // add-only: never touch other CAA entries (Vercel manages its own)
      if (!have.some((h) => sameRecord(h, want))) changes.push({ action: 'create', want });
      continue;
    }
    const exact = have.find((h) => sameRecord(h, want) && h.type === want.type);
    const rest = have.filter((h) => h !== exact);
    if (exact) changes.push({ action: 'noop', want, have: exact });
    else if (rest.length && rest[0].type === want.type) changes.push({ action: 'update', want, have: rest.shift() });
    else if (rest.length && want.type === 'CNAME') changes.push({ action: 'replace', want, have: rest.shift() });
    else changes.push({ action: 'create', want });
    for (const extra of rest) changes.push({ action: prune ? 'delete' : 'foreign', have: extra, slot: want.slot });
  }
  for (const [slot, recs] of bySlot) { // owned slots that are no longer desired (e.g. rotated-out DKIM selectors)
    for (const have of recs) {
      const stale = slot.startsWith('dkim:') && DKIM_SELECTOR.test(slot.slice(5));
      changes.push({ action: prune && stale ? 'delete' : 'foreign', have, slot });
    }
  }
  return changes;
}

// ---------------------------------------------------------------- Vercel REST API
export function vercelClient({ token, teamId = TEAM_DEFAULT, api = 'https://api.vercel.com', fetchImpl = globalThis.fetch }) {
  const q = `teamId=${encodeURIComponent(teamId)}`;
  const call = async (method, path, body) => {
    const res = await fetchImpl(`${api}${path}${path.includes('?') ? '&' : '?'}${q}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Vercel ${method} ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  };
  const payload = (w) => {
    const b = { name: w.name, type: w.type, ttl: w.ttl, comment: 'FaLe Mail (scripts/mail-dns.mjs)' };
    if (w.type === 'SRV') b.srv = w.srv; else b.value = w.value;
    if (w.type === 'MX') b.mxPriority = w.mxPriority;
    return b;
  };
  return {
    async list(domain = DOMAIN) {
      const out = [];
      let until;
      for (let i = 0; i < 50; i++) {
        const page = await call('GET', `/v4/domains/${domain}/records?limit=100${until ? `&until=${until}` : ''}`);
        out.push(...(page.records || []));
        until = page.pagination?.next;
        if (!until) break;
      }
      return out;
    },
    create: (w, domain = DOMAIN) => call('POST', `/v2/domains/${domain}/records`, payload(w)),
    update: (id, w) => call('PATCH', `/v1/domains/records/${id}`, payload(w)),
    remove: (id, domain = DOMAIN) => call('DELETE', `/v2/domains/${domain}/records/${id}`),
  };
}

export async function applyChanges(client, changes) {
  const done = [];
  for (const c of changes) {
    if (c.action === 'create') await client.create(c.want);
    else if (c.action === 'update') await client.update(c.have.id, c.want);
    else if (c.action === 'replace') { await client.remove(c.have.id); await client.create(c.want); }
    else if (c.action === 'delete') await client.remove(c.have.id);
    else continue;
    done.push(c);
  }
  return done;
}

// ---------------------------------------------------------------- status.json
export function fetchStatus(url, { insecure = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { rejectUnauthorized: !insecure, timeout: 20000, headers: { 'Cache-Control': 'no-cache' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`status.json HTTP ${res.statusCode}`)); }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; if (data.length > 2e6) req.destroy(new Error('status.json too large')); });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

export function parseArgs(argv) {
  const o = { statusUrl: `https://${MAIL_HOST}/fale/status.json`, dmarc: 'none', mtaSts: 'testing', apply: false, prune: false, insecure: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '--apply') o.apply = true;
    else if (a === '--prune') o.prune = true;
    else if (a === '--insecure') o.insecure = true;
    else if (a === '--json') o.json = true;
    else if (a === '--status-url') o.statusUrl = next();
    else if (a === '--ipv4') o.ipv4 = next();
    else if (a === '--ipv6') o.ipv6 = next();
    else if (a === '--dmarc') o.dmarc = next();
    else if (a === '--mta-sts') o.mtaSts = next();
    else throw new Error(`unknown option ${a}`);
  }
  if (!['none', 'quarantine', 'reject'].includes(o.dmarc)) throw new Error('--dmarc must be none|quarantine|reject');
  if (!['testing', 'enforce'].includes(o.mtaSts)) throw new Error('--mta-sts must be testing|enforce');
  return o;
}

export async function main(argv = process.argv.slice(2), env = process.env, log = console.log) {
  const o = parseArgs(argv);
  const status = await fetchStatus(o.statusUrl, { insecure: o.insecure });
  if (status.schema !== 'fale-mail-status/1') throw new Error('unexpected status.json schema');
  const ipv4 = o.ipv4 || status.ipv4, ipv6 = o.ipv6 || status.ipv6;
  if (!ipv4) throw new Error('no IPv4 known (status.json has none and --ipv4 not given)');
  const desired = desiredRecords({ ipv4, ipv6, dkim: status.dkim || [], dmarc: o.dmarc, mtaSts: o.mtaSts });
  if (!env.VERCEL_TOKEN) {
    if (o.apply) throw new Error('VERCEL_TOKEN is not set');
    log(o.json ? JSON.stringify({ desired }) : desired.map((d) => `want ${d.type.padEnd(5)} ${(d.name || '@').padEnd(28)} ${d.type === 'MX' ? d.mxPriority + ' ' : ''}${d.value}`).join('\n'));
    return { desired, changes: null };
  }
  const client = vercelClient({ token: env.VERCEL_TOKEN, teamId: env.VERCEL_TEAM_ID || TEAM_DEFAULT, api: env.VERCEL_API });
  const changes = planChanges(await client.list(), desired, { prune: o.prune });
  for (const c of changes) {
    const r = c.want || c.have;
    if (c.action !== 'noop') log(`${c.action.padEnd(7)} ${r.type.padEnd(5)} ${(r.name || '@').padEnd(28)} ${String(r.value ?? '').slice(0, 90)}`);
  }
  const pending = changes.filter((c) => ['create', 'update', 'replace', 'delete'].includes(c.action));
  log(`${pending.length} change(s), ${changes.filter((c) => c.action === 'noop').length} up to date, ${changes.filter((c) => c.action === 'foreign').length} left untouched`);
  if (o.apply && pending.length) log(`applied ${(await applyChanges(client, pending)).length} change(s)`);
  return { desired, changes };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(`mail-dns: ${e.message}`); process.exit(1); });
}
