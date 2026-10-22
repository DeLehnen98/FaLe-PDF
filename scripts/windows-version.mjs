#!/usr/bin/env node
// Keeps the Windows app version (windows/src-tauri: Cargo.toml + tauri.conf.json) equal to package.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const v = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error('package.json version must be x.y.z: ' + v);
const cargo = join(ROOT, 'windows/src-tauri/Cargo.toml');
writeFileSync(cargo, readFileSync(cargo, 'utf8').replace(/^version = "[^"]*"/m, `version = "${v}"`));
const conf = join(ROOT, 'windows/src-tauri/tauri.conf.json');
const j = JSON.parse(readFileSync(conf, 'utf8'));
j.version = v;
writeFileSync(conf, JSON.stringify(j, null, 2) + '\n');
console.log('Windows app version', v);
