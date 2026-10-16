#!/usr/bin/env node
// FaLe One – Java ↔ JS crypto cross-test on the JVM (CI build job; runs locally with a JDK ≥ 17):
// compiles FaleCrypto + CryptoSelfTest (one-android/native) with javac, lets Java open vectors sealed by the
// web worker's code and seal its own, then opens Java's output with the JS code (crossvec.mjs). Also compares the
// EXIF / MP4 metadata parser (BackupExif, a port of one/js/media.js) with the JS parser on the test photos and a
// synthetic MP4 header.
//   node scripts/android-one-e2e/crypto-cross.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeVectors, checkJava } from './crossvec.mjs';
import { parseExif, exifToMeta } from '../../one/js/media.js';
import { readdirSync } from 'node:fs';

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
    join(NATIVE, 'main', 'java', 'FaleCrypto.java'), join(NATIVE, 'debug', 'java', 'CryptoSelfTest.java'), join(NATIVE, 'test', 'CryptoCrossTest.java'),
    join(NATIVE, 'main', 'java', 'BackupExif.java'), join(NATIVE, 'test', 'ExifCrossTest.java')], { stdio: 'inherit' });
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
  // metadata parser parity (EXIF of every test photo + an MP4 header with creation time, duration and ©xyz location)
  const fx = join(ROOT, 'scripts', 'android-one-e2e', 'fixtures');
  const files = readdirSync(fx).filter(f => f.endsWith('.jpg')).map(f => join(fx, f));
  const mp4 = Buffer.alloc(200);
  mp4.write('ftypisom', 4, 'latin1');
  const mv = 40; mp4.write('mvhd', mv, 'latin1'); mp4[mv + 4] = 0;
  mp4.writeUInt32BE(3860000000, mv + 8); mp4.writeUInt32BE(1000, mv + 16); mp4.writeUInt32BE(12345, mv + 20);
  mp4.write('\u00a9xyz', 120, 'latin1'); mp4.write('+54.3100+008.6020/', 128, 'latin1');
  const mp4File = join(dir, 'clip.mp4'); writeFileSync(mp4File, mp4);
  const lines = execFileSync('java', ['-cp', join(dir, 'classes'), 'dev.fale.one.ExifCrossTest', ...files, mp4File], { encoding: 'utf8' }).trim().split('\n');
  const { readMediaMeta } = await import('../../one/js/media.js');
  const exifProblems = [];
  for (const [i, f] of [...files, mp4File].entries()) {
    const bytes = new Uint8Array(readFileSync(f));
    const j = JSON.parse(lines[i]);
    const jsExif = exifToMeta(parseExif(bytes.subarray(0, 512 * 1024)));
    const isMp4 = f.endsWith('.mp4');
    const jsMp4 = isMp4 ? await readMediaMeta(new File([bytes], 'clip.mp4', { type: 'video/mp4' }), 'video/mp4') : null;
    if (JSON.stringify(j.exif) !== JSON.stringify(jsExif)) exifProblems.push(`${f.split('/').pop()} EXIF: Java ${JSON.stringify(j.exif)} ≠ JS ${JSON.stringify(jsExif)}`);
    if (isMp4 && JSON.stringify(j.mp4) !== JSON.stringify(jsMp4)) exifProblems.push(`MP4: Java ${JSON.stringify(j.mp4)} ≠ JS ${JSON.stringify(jsMp4)}`);
  }
  if (exifProblems.length) { console.log(`::error title=Metadaten-Kreuztest (JVM)::${esc(exifProblems.join('\n'))}`); process.exit(1); }
  console.log(`::notice title=Metadaten-Kreuztest (JVM)::EXIF/MP4 wie media.js: ${files.length} Fotos + 1 MP4-Kopf identisch`);
  console.log(`::notice title=Krypto-Kreuztest (JVM)::${n} Java-Prüfungen bestanden, JS öffnet alle Java-Daten (Schlüssel, Metadaten, Teile, Vorschaubild, Gerät, Prüfsumme)`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
