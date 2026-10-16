#!/usr/bin/env node
// FaLe One – Java ↔ JS crypto cross-test on the JVM (CI build job; runs locally with a JDK ≥ 17):
// compiles FaleCrypto + CryptoSelfTest (one-android/native) with javac, lets Java open vectors sealed by the
// web worker's code and seal its own, then opens Java's output with the JS code (crossvec.mjs).
//   node scripts/android-one-e2e/crypto-cross.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeVectors, checkJava } from './crossvec.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NATIVE = join(ROOT, 'one-android', 'native');
const esc = s => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const props = o => Object.entries(o).map(([k, v]) => `${k}=${String(v).replace(/\\/g, '\\\\')}`).join('\n') + '\n';
function parseProps(s) {
  const o = {};
  for (const line of s.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const m = /^((?:\\.|[^=:\\])+)[=:](.*)$/.exec(line);
    if (m) o[m[1].replace(/\\(.)/g, '$1')] = m[2].replace(/\\(.)/g, '$1');
  }
  return o;
}

const dir = mkdtempSync(join(tmpdir(), 'fale-cross-'));
try {
  execFileSync('javac', ['-encoding', 'UTF-8', '-d', join(dir, 'classes'),
    join(NATIVE, 'main', 'java', 'FaleCrypto.java'), join(NATIVE, 'debug', 'java', 'CryptoSelfTest.java'), join(NATIVE, 'test', 'CryptoCrossTest.java')], { stdio: 'inherit' });
  const vec = await makeVectors();
  writeFileSync(join(dir, 'in.properties'), props(vec));
  execFileSync('java', ['-cp', join(dir, 'classes'), 'dev.fale.one.CryptoCrossTest', join(dir, 'in.properties'), join(dir, 'out.properties')], { stdio: 'inherit' });
  const out = parseProps(readFileSync(join(dir, 'out.properties'), 'utf8'));
  const problems = await checkJava(vec, out);
  const n = Object.keys(out).filter(k => k.startsWith('check.')).length;
  if (problems.length) {
    console.log(`::error title=Krypto-Kreuztest (JVM)::${esc(problems.join('\n'))}`);
    process.exit(1);
  }
  console.log(`::notice title=Krypto-Kreuztest (JVM)::${n} Java-Prüfungen bestanden, JS öffnet alle Java-Daten (Schlüssel, Metadaten, Teile, Vorschaubild, Gerät, Prüfsumme)`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
