#!/usr/bin/env node
// Patches the Capacitor-generated ios/ project for FaLe PDF. Deterministic and idempotent: run it after every
// `npx cap add ios` / `npx cap sync ios` (then `pod install` in ios/App, see .github/workflows/ios.yml).
//
//   node scripts/cap-patch-ios.mjs [path/to/ios]
//
// What it does:
//  - Info.plist: display name, version, document types FaLe PDF opens (PDF, Word, Excel, PowerPoint, CSV, Text,
//    Markdown, images), open in place + Files app sharing (Documents is shown as "Auf meinem iPhone › FaLe PDF"),
//    camera / microphone / speech usage texts (scanner, dictation), the AdMob app id the SDK needs at launch
//    (Google's TEST id until ADMOB_IOS_APP_ID is set – ads stay off on iOS for now), no arbitrary loads
//  - App/capacitor.config.json (written by `cap sync`): the app's own plugins from ios-native/ are added to
//    packageClassList, so the bridge creates and loads them like npm plugins (run this after every sync)
//  - Podfile: pod 'FaleNative' from ios-native/, iOS 15
//  - project.pbxproj: MARKETING_VERSION / CURRENT_PROJECT_VERSION from package.json, deployment target 15.0
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IOS = resolve(process.argv[2] || join(ROOT, 'ios'));
const APP = join(IOS, 'App');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const cap = JSON.parse(readFileSync(join(ROOT, 'capacitor.config.json'), 'utf8'));
const must = (c, msg) => { if (!c) throw new Error(msg); };

export function buildNumberOf(version) {
  const m = String(version).match(/^(\d+)\.(\d+)\.(\d+)/);
  must(m, 'package.json version muss x.y.z sein: ' + version);
  const [maj, min, pat] = m.slice(1).map(Number);
  return String(maj * 10000 + min * 100 + pat);
}
const VERSION = process.env.IOS_VERSION || pkg.version;
const BUILD = process.env.IOS_BUILD_NUMBER || buildNumberOf(pkg.version);
const GOOGLE_TEST_APP_ID = 'ca-app-pub-3940256099942544~1458002511'; // Google's documented iOS sample app id
const ADMOB_APP_ID = process.env.ADMOB_IOS_APP_ID || GOOGLE_TEST_APP_ID;

// ------------------------------------------------------------------ minimal XML plist parser / writer
const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const escx = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function parsePlist(xml) {
  let i = 0;
  const skip = () => { for (;;) { const m = /^(\s+|<!--[\s\S]*?-->)/.exec(xml.slice(i)); if (!m) break; i += m[0].length; } };
  const tag = () => { skip(); const m = /^<(\/?)([A-Za-z]+)([^>]*?)(\/?)>/.exec(xml.slice(i)); must(m, 'plist: Tag erwartet bei ' + i); i += m[0].length; return { close: !!m[1], name: m[2], empty: !!m[4] }; };
  const text = name => { const end = xml.indexOf(`</${name}>`, i); must(end >= 0, 'plist: </' + name + '> fehlt'); const t = unesc(xml.slice(i, end)); i = end + name.length + 3; return t; };
  function value() {
    const t = tag();
    if (t.name === 'true' || t.name === 'false') return t.name === 'true';
    if (t.name === 'string') return t.empty ? '' : text('string');
    if (t.name === 'integer') return { $int: text('integer').trim() };
    if (t.name === 'real') return { $real: text('real').trim() };
    if (t.name === 'date') return { $date: text('date').trim() };
    if (t.name === 'data') return { $data: text('data').trim() };
    if (t.name === 'array') {
      const a = [];
      if (t.empty) return a;
      for (;;) { skip(); if (xml.startsWith('</array>', i)) { i += 8; return a; } a.push(value()); }
    }
    if (t.name === 'dict') {
      const d = new Map();
      if (t.empty) return d;
      for (;;) {
        skip();
        if (xml.startsWith('</dict>', i)) { i += 7; return d; }
        const k = tag(); must(k.name === 'key', 'plist: <key> erwartet');
        const key = text('key');
        d.set(key, value());
      }
    }
    throw new Error('plist: unbekannter Typ ' + t.name);
  }
  const start = xml.indexOf('<plist');
  must(start >= 0, 'plist: <plist> fehlt');
  i = xml.indexOf('>', start) + 1;
  return value();
}

export function writePlist(v) {
  const out = [];
  const w = (x, ind) => {
    const p = '\t'.repeat(ind);
    if (x === true) out.push(p + '<true/>');
    else if (x === false) out.push(p + '<false/>');
    else if (typeof x === 'string') out.push(`${p}<string>${escx(x)}</string>`);
    else if (typeof x === 'number') out.push(`${p}<integer>${x}</integer>`);
    else if (Array.isArray(x)) { if (!x.length) out.push(p + '<array/>'); else { out.push(p + '<array>'); x.forEach(y => w(y, ind + 1)); out.push(p + '</array>'); } }
    else if (x instanceof Map) { out.push(p + '<dict>'); for (const [k, y] of x) { out.push(`${p}\t<key>${escx(k)}</key>`); w(y, ind + 1); } out.push(p + '</dict>'); }
    else if (x && x.$int !== undefined) out.push(`${p}<integer>${x.$int}</integer>`);
    else if (x && x.$real !== undefined) out.push(`${p}<real>${x.$real}</real>`);
    else if (x && x.$date !== undefined) out.push(`${p}<date>${x.$date}</date>`);
    else if (x && x.$data !== undefined) out.push(`${p}<data>${x.$data}</data>`);
    else if (x && typeof x === 'object') w(new Map(Object.entries(x)), ind);
    else throw new Error('plist: Wert nicht schreibbar');
  };
  w(v, 0);
  return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n' + out.join('\n') + '\n</plist>\n';
}

// ------------------------------------------------------------------ Info.plist
const docType = (name, types, rank = 'Alternate') => new Map([
  ['CFBundleTypeName', name], ['CFBundleTypeRole', 'Editor'], ['LSHandlerRank', rank], ['LSItemContentTypes', types],
]);
export const DOC_TYPES = [
  docType('PDF', ['com.adobe.pdf']),
  docType('Dokument', ['org.openxmlformats.wordprocessingml.document']),
  docType('Tabelle', ['org.openxmlformats.spreadsheetml.sheet', 'public.comma-separated-values-text']),
  docType('Präsentation', ['org.openxmlformats.presentationml.presentation']),
  docType('Text', ['public.plain-text', 'net.daringfireball.markdown']),
  docType('Bild', ['public.jpeg', 'public.png', 'public.heic', 'org.webmproject.webp', 'com.compuserve.gif', 'com.microsoft.bmp']),
];

export function patchInfo(plist) {
  const d = plist;
  must(d instanceof Map, 'Info.plist: dict erwartet');
  d.set('CFBundleDisplayName', cap.appName);
  d.set('CFBundleShortVersionString', '$(MARKETING_VERSION)');
  d.set('CFBundleVersion', '$(CURRENT_PROJECT_VERSION)');
  d.set('CFBundleDevelopmentRegion', 'de');
  d.set('CFBundleLocalizations', ['de', 'en']);
  d.set('CFBundleDocumentTypes', DOC_TYPES);
  d.set('LSSupportsOpeningDocumentsInPlace', true); // edits can go back into the original (js/origin.js)
  d.set('UIFileSharingEnabled', true); // Documents in the Files app: saved files are easy to find
  d.set('NSCameraUsageDescription', 'FaLe PDF nutzt die Kamera nur zum Scannen von Dokumenten und QR-Codes. Bilder bleiben auf deinem Gerät.');
  d.set('NSMicrophoneUsageDescription', 'FaLe PDF nutzt das Mikrofon nur für das Diktieren im Dokument-Editor, wenn du es startest.');
  d.set('NSSpeechRecognitionUsageDescription', 'Für das Diktieren im Dokument-Editor wird deine Sprache in Text umgewandelt.');
  d.set('GADApplicationIdentifier', ADMOB_APP_ID);
  d.delete('NSAppTransportSecurity'); // default ATS: HTTPS only
  d.set('UIRequiredDeviceCapabilities', ['arm64']);
  // simulator test builds only (FALE_E2E=1 in .github/workflows/ios.yml): URL scheme to open a test file in place
  if (process.env.FALE_E2E === '1') {
    d.set('CFBundleURLTypes', [new Map([['CFBundleURLName', 'dev.fale.pdf.e2e'], ['CFBundleURLSchemes', ['fale-e2e']]])]);
    d.set('FaleE2E', true);
  } else { d.delete('CFBundleURLTypes'); d.delete('FaleE2E'); }
  return d;
}

// ------------------------------------------------------------------ storyboard, Podfile, project
export const OWN_PLUGINS = ['FaleIncomingPlugin', 'FalePrintPlugin']; // @objc names in ios-native/Sources

/** Undo the earlier storyboard approach (custom view controller) – the plain Capacitor controller is used. */
export function patchStoryboard(xml) {
  return xml.replace(/(<viewController\b[^>]*)customClass="FaleBridgeViewController" customModule="FaleNative"/,
    '$1customClass="CAPBridgeViewController" customModule="Capacitor"');
}

export function patchCapConfig(json) {
  const c = JSON.parse(json);
  const list = Array.isArray(c.packageClassList) ? c.packageClassList.filter(n => !OWN_PLUGINS.includes(n)) : [];
  c.packageClassList = [...list, ...OWN_PLUGINS];
  return JSON.stringify(c, null, '\t') + '\n';
}

export function patchPodfile(src, podPath) {
  let s = src.replace(/platform :ios, '[\d.]+'/, "platform :ios, '15.0'");
  const line = `  pod 'FaleNative', :path => '${podPath}'`;
  s = s.replace(/\n\s*pod 'FaleNative'[^\n]*/g, '');
  const m = s.match(/target 'App' do\n(\s*)capacitor_pods\n/);
  must(m, "Podfile: target 'App' mit capacitor_pods nicht gefunden");
  return s.replace(m[0], m[0] + line + '\n');
}

export function patchProject(src) {
  return src
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${VERSION};`)
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${BUILD};`)
    .replace(/IPHONEOS_DEPLOYMENT_TARGET = [\d.]+;/g, 'IPHONEOS_DEPLOYMENT_TARGET = 15.0;');
}

function run() {
  must(existsSync(APP), `iOS-Projekt nicht gefunden: ${APP} (zuerst: npx cap add ios --packagemanager CocoaPods)`);
  const infoP = join(APP, 'App', 'Info.plist');
  writeFileSync(infoP, writePlist(patchInfo(parsePlist(readFileSync(infoP, 'utf8')))));
  const sbP = join(APP, 'App', 'Base.lproj', 'Main.storyboard');
  writeFileSync(sbP, patchStoryboard(readFileSync(sbP, 'utf8')));
  const ccP = join(APP, 'App', 'capacitor.config.json');
  if (existsSync(ccP)) writeFileSync(ccP, patchCapConfig(readFileSync(ccP, 'utf8')));
  else console.log('Hinweis: App/capacitor.config.json fehlt noch – nach `npx cap sync ios` erneut ausführen.');
  const podP = join(APP, 'Podfile');
  writeFileSync(podP, patchPodfile(readFileSync(podP, 'utf8'), relative(APP, join(ROOT, 'ios-native')).split('\\').join('/')));
  const prjP = join(APP, 'App.xcodeproj', 'project.pbxproj');
  writeFileSync(prjP, patchProject(readFileSync(prjP, 'utf8')));
  if (ADMOB_APP_ID === GOOGLE_TEST_APP_ID) console.log('Hinweis: GADApplicationIdentifier = Google TEST-App-ID (Werbung ist auf iOS ohnehin aus).');
  console.log(`iOS gepatcht: ${cap.appId} ${VERSION} (${BUILD}), ${DOC_TYPES.length} Dokumenttypen, FaleNative-Pod, Plugins ${OWN_PLUGINS.join(', ')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
