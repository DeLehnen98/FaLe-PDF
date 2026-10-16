// FaLe Seal v1 interoperability: browser/Node (WebCrypto) ↔ server agent (Python, cryptography).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPair, seal, unseal, kidOf } from '../tools/seal.mjs';

const AGENT = join(dirname(fileURLToPath(import.meta.url)), '../server/fale-mail-agent.py');
const py = (code, env, input) => {
  const r = spawnSync('python3', ['-c', `import importlib.util as u,sys,json\ns=u.spec_from_file_location('agent',${JSON.stringify(AGENT)});a=u.module_from_spec(s);s.loader.exec_module(a)\n${code}`],
    { env: { ...process.env, ...env }, input, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

test('JS round trip and tamper detection', async () => {
  const kp = await generateKeyPair();
  const box = await seal(kp.jwk, 'geheim ✓');
  assert.equal(await unseal(kp.privateKey, kp.jwk, box), 'geheim ✓');
  const bad = { ...box, ct: box.ct.slice(0, -2) + (box.ct.endsWith('A') ? 'BA' : 'AA') };
  await assert.rejects(unseal(kp.privateKey, kp.jwk, bad));
  const other = await generateKeyPair();
  await assert.rejects(unseal(other.privateKey, other.jwk, box), /kid mismatch/);
});

test('browser → server: JS seals to the server key, Python agent unseals', async (t) => {
  const etc = mkdtempSync(join(tmpdir(), 'fale-seal-'));
  t.after(() => rmSync(etc, { recursive: true, force: true }));
  const env = { FALE_MAIL_ETC: etc };
  py('a.cmd_keygen()', env);
  const jwk = JSON.parse(py('print(json.dumps(a.jwk_from_public(a.load_seal_key().public_key())))', env));
  assert.equal(JSON.parse(py(`print(json.dumps(a.kid_of(${JSON.stringify(jwk)})))`, env)), await kidOf(jwk));
  const box = await seal(jwk, JSON.stringify({ name: 'backup', env: { RESTIC_REPOSITORY: 's3:https://x/y' } }));
  const out = py('print(a.unseal(a.load_seal_key(), json.load(sys.stdin)).decode())', env, JSON.stringify(box));
  assert.equal(JSON.parse(out).env.RESTIC_REPOSITORY, 's3:https://x/y');
});

test('server → browser: Python agent seals to a phone key, JS unseals', async () => {
  const kp = await generateKeyPair();
  const box = JSON.parse(py(`print(json.dumps(a.seal(${JSON.stringify(kp.jwk)}, 'admin-pw'.encode())))`, {}));
  assert.equal(box.v, 'fale-seal-1');
  assert.equal(await unseal(kp.privateKey, kp.jwk, box), 'admin-pw');
});
