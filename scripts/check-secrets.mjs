// Secret scanner for the repository (runs in CI, see .github/workflows/security.yml; also usable locally).
//   node scripts/check-secrets.mjs            → scan all tracked files (working tree)
//   node scripts/check-secrets.mjs --history  → additionally scan every blob in the git history
// Exit code 1 when something that looks like a real credential is found. Only the file, line and the kind of
// secret are printed – never the value itself (CI logs are readable by everyone with access to the repo).
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HISTORY = process.argv.includes('--history');

const RULES = [
  ['private key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/],
  ['Anthropic API key', /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{20,}/],
  ['OpenAI-style API key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  // AWS's own documentation placeholders end in EXAMPLE (e.g. the SigV4 test vectors) – not credentials
  ['AWS access key', /\b(?:AKIA|ASIA)(?![0-9A-Z]{9}EXAMPLE\b)[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Google OAuth client secret', /\bGOCSPX-[A-Za-z0-9_-]{20,}/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Stripe secret key', /\b[rs]k_live_[A-Za-z0-9]{20,}/],
  ['Supabase secret key', /\bsb_secret_[A-Za-z0-9_-]{20,}/],
  ['Postgres URL with password', /\bpostgres(?:ql)?:\/\/[^\s:@/'"]+:(?!\[YOUR-PASSWORD\]|password@|PASSWORD@|\$\{|\$[A-Z_])[^\s@'"]{6,}@[^\s'"]+/],
  ['Google service-account JSON', /"type"\s*:\s*"service_account"[\s\S]{0,400}"private_key"\s*:\s*"-----BEGIN/],
];
// JWTs: only flag those whose payload claims a privileged Supabase role (anon/publishable keys are public).
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{20,}/g;
function privilegedJwt(line) {
  for (const m of line.matchAll(JWT)) {
    try {
      const p = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
      if (p && (p.role === 'service_role' || p.role === 'supabase_admin')) return true;
    } catch {}
  }
  return false;
}

// Binary/vendor content and the scanner itself are skipped.
const SKIP = [/^vendor\//, /^vendor-extra\//, /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|wasm|gz|zip|pdf|jar|apk|aab)$/i, /^scripts\/check-secrets\.mjs$/, /^package-lock\.json$/];
const ALLOW = /fale-secret-scan:\s*allow/; // mark an intentional test fixture on the same line

function scanText(name, text, hits) {
  if (text.indexOf('\0') >= 0) return; // binary
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 20000 || ALLOW.test(line)) continue;
    for (const [kind, re] of RULES) if (re.test(line)) hits.push({ name, line: i + 1, kind });
    if (line.includes('eyJ') && privilegedJwt(line)) hits.push({ name, line: i + 1, kind: 'Supabase service_role JWT' });
  }
}

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 30 });
const hits = [];
let files = [];
try { files = git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean); } catch { // tracked + new (not ignored)
  console.error('git nicht verfügbar'); process.exit(2); }
for (const f of files) {
  if (SKIP.some(r => r.test(f))) continue;
  if (/(^|\/)(\.env(\..+)?|.*\.(jks|keystore|p12|pem|key))$/i.test(f) && !/\.env\.example$/.test(f)) hits.push({ name: f, line: 0, kind: 'credential file is tracked' });
  let st; try { st = statSync(join(ROOT, f)); } catch { continue; }
  if (!st.isFile() || st.size > 5e6) continue;
  scanText(f, readFileSync(join(ROOT, f), 'utf8'), hits);
}
if (HISTORY) {
  // every blob ever committed (deduplicated by object id)
  const seen = new Set();
  const objs = git('rev-list', '--objects', '--all').split('\n');
  for (const row of objs) {
    const sp = row.indexOf(' ');
    if (sp < 0) continue;
    const id = row.slice(0, sp), path = row.slice(sp + 1);
    if (seen.has(id) || SKIP.some(r => r.test(path))) continue;
    seen.add(id);
    let type; try { type = git('cat-file', '-t', id).trim(); } catch { continue; }
    if (type !== 'blob') continue;
    const size = Number(git('cat-file', '-s', id).trim());
    if (size > 5e6) continue;
    const before = hits.length;
    scanText(path + ' @' + id.slice(0, 10), git('cat-file', 'blob', id), hits);
    for (let i = before; i < hits.length; i++) hits[i].history = true;
  }
}
const uniq = new Map(hits.map(h => [h.name + ':' + h.line + ':' + h.kind, h]));
if (uniq.size) {
  console.error(`Mögliche Geheimnisse gefunden (${uniq.size}) – Werte werden nicht ausgegeben:`);
  for (const h of uniq.values()) console.error(`  ${h.history ? '[Historie] ' : ''}${h.name}${h.line ? ':' + h.line : ''}  →  ${h.kind}`);
  console.error('Echte Schlüssel sofort beim Anbieter widerrufen/rotieren und aus dem Repository entfernen. Beabsichtigte Test-Werte mit "fale-secret-scan: allow" markieren.');
  process.exit(1);
}
console.log(`Secret-Scan ok: ${files.length} Dateien${HISTORY ? ' + gesamte Git-Historie' : ''}, nichts gefunden.`);
