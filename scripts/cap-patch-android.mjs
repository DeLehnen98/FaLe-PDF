#!/usr/bin/env node
// Patches the Capacitor-generated android/ project for FaLe PDF. Deterministic and
// idempotent: run it after every `npx cap add android` / `npx cap sync android`.
//
//   node scripts/cap-patch-android.mjs [path/to/android]
//
// Env overrides:
//   ANDROID_VERSION_CODE   versionCode (default: major*10000 + minor*100 + patch from package.json)
//   ANDROID_VERSION_NAME   versionName (default: package.json version)
//   ANDROID_TARGET_SDK     minimum compile/target SDK (default 36 – Google Play requirement since 31.08.2026)
//   ADMOB_APP_ID           AdMob app id (default: ADMOB_APP_ID in js/ai/config.js – Google's TEST id until replaced)
//
// What it does: app id/name/version, release signing from env (FALE_KEYSTORE_*), permissions
// (camera, legacy storage), "Öffnen mit"/"Teilen" intent filters, MainActivity + FaleIncoming
// plugin (incoming files, system bar colours), theme colours, splash, launcher + notification icons.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as png from './cap-png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID = resolve(process.argv[2] || join(ROOT, 'android'));
const APP = join(ANDROID, 'app');
const MAIN = join(APP, 'src', 'main');
const RES = join(MAIN, 'res');

const cap = JSON.parse(readFileSync(join(ROOT, 'capacitor.config.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const APP_ID = cap.appId;
const APP_NAME = cap.appName;
if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(APP_ID)) throw new Error('Ungültige appId in capacitor.config.json: ' + APP_ID);

export function versionCodeOf(version) {
  const m = String(version).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error('package.json version muss x.y.z sein: ' + version);
  const [maj, min, pat] = m.slice(1).map(Number);
  if (min > 99 || pat > 99) throw new Error('minor/patch müssen ≤ 99 sein (versionCode-Schema)');
  return maj * 10000 + min * 100 + pat;
}
const VERSION_NAME = process.env.ANDROID_VERSION_NAME || pkg.version;
const VERSION_CODE = parseInt(process.env.ANDROID_VERSION_CODE || '', 10) || versionCodeOf(pkg.version);
const TARGET_SDK = parseInt(process.env.ANDROID_TARGET_SDK || '', 10) || 36;

// Theme colours (keep in sync with styles.css --bg and the icon ink)
const C = {
  bgLight: '#F5F6FB', bgDark: '#171542', primary: '#3B37A0', primaryDark: '#2A2783', accent: '#2DD4BF',
  splashLight: '#F5F6FB', splashDark: '#171542',
};

// File types the app can open (keep in sync with manifest.webmanifest / js/office/kinds.js)
const MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv', 'text/comma-separated-values',
  'text/plain', 'text/markdown', 'text/x-markdown',
  'image/*',
];

const log = (...a) => console.log('[cap-patch]', ...a);
const read = p => readFileSync(p, 'utf8');
function write(p, s) {
  mkdirSync(dirname(p), { recursive: true });
  if (existsSync(p) && read(p) === s) return;
  writeFileSync(p, s);
}
function must(cond, msg) { if (!cond) throw new Error('[cap-patch] ' + msg); }
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, "\\'");

/** Replace the block between markers (or insert it with `insert`) — keeps the patch idempotent. */
function upsertBlock(src, name, block, insert, cmt = ['<!--', '-->'], pad = '') {
  const mk = what => `${cmt[0]} fale:${name}:${what} ${cmt[1]}`.trim();
  const full = `${pad}${mk('start')}\n${block}\n${pad}${mk('end')}`;
  const q = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`[ \\t]*${q(mk('start'))}[\\s\\S]*?${q(mk('end'))}`);
  if (re.test(src)) return src.replace(re, () => full);
  return insert(src, full);
}
const indent = (s, n) => s.split('\n').map(l => (l ? ' '.repeat(n) + l : l)).join('\n');

// ------------------------------------------------------------------ gradle
function patchVariables() {
  const p = join(ANDROID, 'variables.gradle');
  if (!existsSync(p)) return log('variables.gradle fehlt – übersprungen');
  let s = read(p);
  for (const key of ['compileSdkVersion', 'targetSdkVersion']) {
    s = s.replace(new RegExp(`(${key}\\s*=\\s*)(\\d+)`), (m, a, v) => a + Math.max(+v, TARGET_SDK));
  }
  write(p, s);
}

function patchAppGradle() {
  const p = join(APP, 'build.gradle');
  must(existsSync(p), 'app/build.gradle fehlt – ist das ein Capacitor-Android-Projekt?');
  let s = read(p);
  s = s.replace(/applicationId\s+"[^"]*"/, `applicationId "${APP_ID}"`);
  s = s.replace(/versionCode\s+\d+/, `versionCode ${VERSION_CODE}`);
  s = s.replace(/versionName\s+"[^"]*"/, `versionName "${VERSION_NAME}"`);
  must(s.includes(`versionCode ${VERSION_CODE}`), 'versionCode nicht gefunden');
  const signing = indent(`signingConfigs {
    release {
        // Upload key from CI secrets (see store/KEYSTORE.md). Without it, release builds stay unsigned.
        def ksFile = System.getenv('FALE_KEYSTORE_FILE')
        if (ksFile) {
            storeFile file(ksFile)
            storePassword System.getenv('FALE_KEYSTORE_PASSWORD')
            keyAlias System.getenv('FALE_KEY_ALIAS')
            keyPassword System.getenv('FALE_KEY_PASSWORD')
        }
    }
}`, 4);
  s = upsertBlock(s, 'signing', signing, (src, full) => {
    const i = src.search(/\n\s*buildTypes\s*\{/);
    must(i >= 0, 'buildTypes-Block nicht gefunden');
    return src.slice(0, i + 1) + full + '\n' + src.slice(i + 1);
  }, ['//', ''], '    ');
  const use = indent(`if (System.getenv('FALE_KEYSTORE_FILE')) {
    signingConfig signingConfigs.release
}`, 12);
  s = upsertBlock(s, 'release-signing', use, (src, full) => {
    const m = src.match(/buildTypes\s*\{\s*release\s*\{\n/);
    must(m, 'buildTypes.release nicht gefunden');
    const at = m.index + m[0].length;
    return src.slice(0, at) + full + '\n' + src.slice(at);
  }, ['//', ''], '            ');
  write(p, s);
}

// ------------------------------------------------------------------ manifest
function patchManifest() {
  const p = join(MAIN, 'AndroidManifest.xml');
  must(existsSync(p), 'AndroidManifest.xml fehlt');
  let s = read(p);

  const perms = [
    '<uses-permission android:name="android.permission.CAMERA" />',
    '<uses-feature android:name="android.hardware.camera" android:required="false" />',
    '<uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />',
    '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
    '<uses-permission android:name="android.permission.VIBRATE" />',
    '<!-- Speichern in Dokumente/FaLe PDF bis Android 10 -->',
    '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />',
    '<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />',
    '<!-- Exakte Alarme braucht die App nicht (Play-Richtlinie); Erinnerungen dürfen ein paar Minuten später kommen -->',
    '<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" tools:node="remove" />',
    '<uses-permission android:name="android.permission.USE_EXACT_ALARM" tools:node="remove" />',
  ].join('\n');
  s = upsertBlock(s, 'permissions', indent(perms, 4), (src, full) => src.replace(/\n*<\/manifest>\s*$/, () => `\n\n${full}\n</manifest>\n`), undefined, '    ');

  // tools namespace for tools:node="remove"
  if (!/xmlns:tools=/.test(s)) s = s.replace(/<manifest\b/, '<manifest xmlns:tools="http://schemas.android.com/tools"');

  // <application …> attributes
  s = s.replace(/<application\b([^>]*)>/, (m, attrs) => {
    let a = attrs;
    if (!/requestLegacyExternalStorage/.test(a)) a = a.replace(/\s*$/, '') + '\n        android:requestLegacyExternalStorage="true"';
    return `<application${a}>`;
  });

  // MainActivity attributes
  const actRe = /<activity\b([^>]*android:name="\.MainActivity"[^>]*)>/;
  must(actRe.test(s), 'MainActivity nicht im Manifest gefunden');
  s = s.replace(actRe, (m, attrs) => {
    let a = attrs;
    if (!/windowSoftInputMode/.test(a)) a = a.replace(/\s*$/, '') + '\n            android:windowSoftInputMode="adjustResize"';
    if (/android:configChanges="([^"]*)"/.test(a) && !/density/.test(a.match(/android:configChanges="([^"]*)"/)[1])) {
      a = a.replace(/android:configChanges="([^"]*)"/, (mm, v) => `android:configChanges="${v}|density"`);
    }
    return `<activity${a}>`;
  });

  const data = MIME_TYPES.map(t => `    <data android:mimeType="${t}" />`).join('\n');
  const filters = `<!-- „Öffnen mit …“ -->
<intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
${data}
</intent-filter>
<!-- „Teilen“ (eine Datei / mehrere Dateien) -->
<intent-filter>
    <action android:name="android.intent.action.SEND" />
    <category android:name="android.intent.category.DEFAULT" />
${data}
</intent-filter>
<intent-filter>
    <action android:name="android.intent.action.SEND_MULTIPLE" />
    <category android:name="android.intent.category.DEFAULT" />
${data}
</intent-filter>`;
  s = upsertBlock(s, 'intents', indent(filters, 12), (src, full) => {
    const am = src.match(actRe);
    const close = src.indexOf('</activity>', am.index);
    must(close > 0, '</activity> nicht gefunden');
    const lineStart = src.lastIndexOf('\n', close) + 1;
    return src.slice(0, lineStart) + full + '\n\n' + src.slice(lineStart);
  }, undefined, '            ');
  write(p, s);
}

// ------------------------------------------------------------------ AdMob (rewarded videos, js/ai/ads.js)
export const ADMOB_TEST_APP_ID = 'ca-app-pub-3940256099942544~3347511713';
export function admobAppId() {
  if (process.env.ADMOB_APP_ID) return process.env.ADMOB_APP_ID.trim();
  try {
    const m = read(join(ROOT, 'js', 'ai', 'config.js')).match(/ADMOB_APP_ID:\s*'([^']+)'/);
    if (m) return m[1];
  } catch { /* fall through */ }
  return ADMOB_TEST_APP_ID;
}
function patchAds() {
  const id = admobAppId();
  must(/^ca-app-pub-\d+~\d+$/.test(id), 'ADMOB_APP_ID ungültig (Format ca-app-pub-…~…): ' + id);
  write(join(RES, 'values', 'fale_admob.xml'), `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/cap-patch-android.mjs (AdMob app id from js/ai/config.js or ADMOB_APP_ID) -->
<resources>
    <string name="admob_app_id" translatable="false">${esc(id)}</string>
</resources>
`);
  const p = join(MAIN, 'AndroidManifest.xml');
  let s = read(p);
  // App id (required by the Google Mobile Ads SDK) + no measurement before the user opts into an ad
  const meta = `<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="@string/admob_app_id" />
<meta-data android:name="com.google.android.gms.ads.DELAY_APP_MEASUREMENT_INIT" android:value="true" />
<meta-data android:name="com.google.android.gms.ads.flag.OPTIMIZE_INITIALIZATION" android:value="true" />
<meta-data android:name="com.google.android.gms.ads.flag.OPTIMIZE_AD_LOADING" android:value="true" />`;
  s = upsertBlock(s, 'admob', indent(meta, 8), (src, full) => {
    const i = src.lastIndexOf('</application>');
    must(i > 0, '</application> nicht gefunden');
    const lineStart = src.lastIndexOf('\n', i) + 1;
    return src.slice(0, lineStart) + full + '\n' + src.slice(lineStart);
  }, undefined, '        ');
  write(p, s);
  if (id === ADMOB_TEST_APP_ID) log('AdMob: TEST-App-ID aktiv (js/ai/config.js) – vor dem Release ersetzen, siehe store/AI-SETUP.md');
}

// ------------------------------------------------------------------ java
function findMainActivity() {
  const javaRoot = join(MAIN, 'java');
  const want = join(javaRoot, ...APP_ID.split('.'), 'MainActivity.java');
  if (existsSync(want)) return want;
  const walk = d => readdirSync(d).flatMap(n => { const q = join(d, n); return statSync(q).isDirectory() ? walk(q) : [q]; });
  const found = existsSync(javaRoot) ? walk(javaRoot).filter(f => /MainActivity\.(java|kt)$/.test(f)) : [];
  must(found.length, 'MainActivity nicht gefunden');
  return found[0];
}

function patchJava() {
  const main = findMainActivity();
  must(main.endsWith('.java'), 'MainActivity.kt wird nicht unterstützt (Capacitor-Vorlage ist Java)');
  const pkgName = (read(main).match(/^\s*package\s+([\w.]+)\s*;/m) || [])[1] || APP_ID;
  const dir = dirname(main);
  write(main, MAIN_ACTIVITY(pkgName));
  write(join(dir, 'FaleIncomingPlugin.java'), INCOMING_PLUGIN(pkgName));
}

const MAIN_ACTIVITY = pkgName => `package ${pkgName};

// Generated by scripts/cap-patch-android.mjs – edit there, not here.
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Custom plugins must be registered before super.onCreate (Capacitor 3+).
        registerPlugin(FaleIncomingPlugin.class);
        super.onCreate(savedInstanceState);
    }
    // onNewIntent: BridgeActivity forwards new intents to every plugin
    // (FaleIncomingPlugin.handleOnNewIntent). Camera permission for getUserMedia and
    // <input capture> is requested at runtime by Capacitor's BridgeWebChromeClient.
}
`;

const INCOMING_PLUGIN = pkgName => `package ${pkgName};

// Generated by scripts/cap-patch-android.mjs – edit there, not here.
// Hands files from "Öffnen mit" (ACTION_VIEW) and "Teilen" (ACTION_SEND/_MULTIPLE) to the
// web app: content is copied into cache/incoming/, JS fetches it via convertFileSrc
// (or readFile as fallback) after a "filesReady" event / takePending() call.
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Parcelable;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "FaleIncoming")
public class FaleIncomingPlugin extends Plugin {
    private static final String TAG = "FaleIncoming";
    static final long MAX_BYTES = 100L * 1024L * 1024L;
    private static final String HANDLED = "fale.incoming.handled";

    private final Object lock = new Object();
    private final List<JSObject> pending = new ArrayList<>();
    private final List<JSObject> skipped = new ArrayList<>();
    private String lastAction = "VIEW";
    private int counter = 0;
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        deleteChildren(incomingDir());
        handleIntent(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        handleIntent(intent);
    }

    private File incomingDir() {
        File dir = new File(getContext().getCacheDir(), "incoming");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private static void deleteChildren(File dir) {
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File f : files) f.delete();
    }

    @SuppressWarnings("deprecation")
    private static List<Uri> collectUris(Intent intent) {
        List<Uri> uris = new ArrayList<>();
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action)) {
            if (intent.getData() != null) uris.add(intent.getData());
        } else if (Intent.ACTION_SEND.equals(action)) {
            Parcelable p = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (p instanceof Uri) uris.add((Uri) p);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Parcelable> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) for (Parcelable p : list) if (p instanceof Uri) uris.add((Uri) p);
        }
        if (uris.isEmpty() && intent.getClipData() != null) {
            ClipData clip = intent.getClipData();
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri u = clip.getItemAt(i).getUri();
                if (u != null) uris.add(u);
            }
        }
        return uris;
    }

    private void handleIntent(Intent intent) {
        if (intent == null || intent.getBooleanExtra(HANDLED, false)) return;
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        final String action = intent.getAction();
        if (!Intent.ACTION_VIEW.equals(action) && !Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;
        final List<Uri> uris = collectUris(intent);
        final String text = (Intent.ACTION_SEND.equals(action) && uris.isEmpty()) ? intent.getStringExtra(Intent.EXTRA_TEXT) : null;
        if (uris.isEmpty() && (text == null || text.trim().isEmpty())) return;
        intent.putExtra(HANDLED, true);
        final String type = intent.getType();
        final String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        final String act = Intent.ACTION_VIEW.equals(action) ? "VIEW" : "SEND";
        io.execute(() -> {
            for (Uri u : uris) importUri(u, type);
            if (text != null && uris.isEmpty()) importText(text, subject);
            int count;
            synchronized (lock) {
                lastAction = act;
                count = pending.size() + skipped.size();
            }
            JSObject ev = new JSObject();
            ev.put("count", count);
            notifyListeners("filesReady", ev);
        });
    }

    private static String cleanName(String name) {
        String n = name == null ? "" : name.replaceAll("[\\\\\\\\/:*?\\"<>|\\\\u0000-\\\\u001f]+", " ").trim();
        if (n.isEmpty()) n = "Datei";
        return n.length() > 150 ? n.substring(0, 150) : n;
    }

    private File newTarget(String name) {
        synchronized (lock) {
            counter++;
            return new File(incomingDir(), counter + "-" + name);
        }
    }

    private void addSkipped(String name, String reason) {
        JSObject o = new JSObject();
        o.put("name", name);
        o.put("reason", reason);
        synchronized (lock) { skipped.add(o); }
    }

    private void importUri(Uri uri, String fallbackType) {
        ContentResolver cr = getContext().getContentResolver();
        String name = null;
        long size = -1;
        try (Cursor c = cr.query(uri, new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int ni = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int si = c.getColumnIndex(OpenableColumns.SIZE);
                if (ni >= 0 && !c.isNull(ni)) name = c.getString(ni);
                if (si >= 0 && !c.isNull(si)) size = c.getLong(si);
            }
        } catch (Exception e) {
            Log.w(TAG, "query failed", e);
        }
        if (name == null) name = uri.getLastPathSegment();
        name = cleanName(name);
        String mime = null;
        try { mime = cr.getType(uri); } catch (Exception ignored) { }
        if (mime == null && fallbackType != null && !fallbackType.contains("*")) mime = fallbackType;
        if (size > MAX_BYTES) { addSkipped(name, "too-large"); return; }

        File out = newTarget(name);
        long total = 0;
        boolean tooBig = false;
        try (InputStream in = cr.openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
            if (in == null) throw new IOException("no input stream");
            byte[] buf = new byte[64 * 1024];
            int r;
            while ((r = in.read(buf)) != -1) {
                total += r;
                if (total > MAX_BYTES) { tooBig = true; break; }
                os.write(buf, 0, r);
            }
        } catch (Exception e) {
            Log.w(TAG, "read failed: " + uri, e);
            out.delete();
            addSkipped(name, "unreadable");
            return;
        }
        if (tooBig) { out.delete(); addSkipped(name, "too-large"); return; }
        JSObject o = new JSObject();
        o.put("name", name);
        o.put("mimeType", mime == null ? "" : mime);
        o.put("size", total);
        o.put("path", out.getAbsolutePath());
        synchronized (lock) { pending.add(o); }
    }

    private void importText(String text, String subject) {
        String name = cleanName(subject != null && !subject.trim().isEmpty() ? subject : "Geteilter Text");
        if (!name.toLowerCase().endsWith(".txt")) name = name + ".txt";
        File out = newTarget(name);
        try (OutputStream os = new FileOutputStream(out)) {
            os.write(text.getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            addSkipped(name, "unreadable");
            return;
        }
        JSObject o = new JSObject();
        o.put("name", name);
        o.put("mimeType", "text/plain");
        o.put("size", out.length());
        o.put("path", out.getAbsolutePath());
        synchronized (lock) { pending.add(o); }
    }

    private File insideIncoming(String path) throws IOException {
        if (path == null) throw new IOException("path missing");
        File f = new File(path).getCanonicalFile();
        File dir = incomingDir().getCanonicalFile();
        if (!f.getPath().startsWith(dir.getPath() + File.separator)) throw new IOException("path outside incoming dir");
        return f;
    }

    /** Returns and clears the queued files: {action, files:[{name,mimeType,size,path}], skipped:[{name,reason}]} */
    @PluginMethod
    public void takePending(PluginCall call) {
        JSObject ret = new JSObject();
        JSArray files = new JSArray();
        JSArray skip = new JSArray();
        synchronized (lock) {
            for (JSObject o : pending) files.put(o);
            for (JSObject o : skipped) skip.put(o);
            pending.clear();
            skipped.clear();
            ret.put("action", lastAction);
        }
        ret.put("files", files);
        ret.put("skipped", skip);
        call.resolve(ret);
    }

    /** Fallback when fetch(convertFileSrc(path)) is not possible: base64 over the bridge. */
    @PluginMethod
    public void readFile(PluginCall call) {
        final String path = call.getString("path");
        io.execute(() -> {
            try {
                File f = insideIncoming(path);
                try (InputStream in = new FileInputStream(f); ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
                    byte[] buf = new byte[64 * 1024];
                    int r;
                    while ((r = in.read(buf)) != -1) bos.write(buf, 0, r);
                    JSObject ret = new JSObject();
                    ret.put("data", Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP));
                    call.resolve(ret);
                }
            } catch (Exception e) {
                call.reject("readFile failed: " + e.getMessage());
            }
        });
    }

    /** Delete imported copies once the web app has stored them. */
    @PluginMethod
    public void release(PluginCall call) {
        JSArray paths = call.getArray("paths");
        if (paths != null) {
            for (int i = 0; i < paths.length(); i++) {
                try { insideIncoming(paths.getString(i)).delete(); } catch (Exception ignored) { }
            }
        }
        call.resolve();
    }

    /** Status/navigation bar colours to match the web app theme: {color:"#RRGGBB", dark:boolean} */
    @PluginMethod
    @SuppressWarnings("deprecation")
    public void setBarColors(PluginCall call) {
        final String color = call.getString("color", "#F5F6FB");
        final boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        getActivity().runOnUiThread(() -> {
            try {
                int c = Color.parseColor(color);
                Window w = getActivity().getWindow();
                w.getDecorView().setBackgroundColor(c);
                if (Build.VERSION.SDK_INT < 35) {
                    w.setStatusBarColor(c);
                    w.setNavigationBarColor(c);
                }
                WindowInsetsControllerCompat ic = WindowCompat.getInsetsController(w, w.getDecorView());
                ic.setAppearanceLightStatusBars(!dark);
                ic.setAppearanceLightNavigationBars(!dark);
                call.resolve();
            } catch (Exception e) {
                call.reject("setBarColors failed: " + e.getMessage());
            }
        });
    }
}
`;

// ------------------------------------------------------------------ resources
function patchResources() {
  // strings
  const sp = join(RES, 'values', 'strings.xml');
  if (existsSync(sp)) {
    let s = read(sp);
    s = s.replace(/(<string name="app_name">)[^<]*(<\/string>)/, `$1${esc(APP_NAME)}$2`);
    s = s.replace(/(<string name="title_activity_main">)[^<]*(<\/string>)/, `$1${esc(APP_NAME)}$2`);
    write(sp, s);
  }
  // colours (own files → no clash with the template's resources)
  const colors = (bg, splash, light) => `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/cap-patch-android.mjs -->
<resources>
    <color name="fale_bg">${bg}</color>
    <color name="fale_splash_bg">${splash}</color>
    <color name="fale_primary">${C.primary}</color>
    <color name="fale_primary_dark">${C.primaryDark}</color>
    <color name="fale_accent">${C.accent}</color>
    <bool name="fale_light_bars">${light}</bool>
</resources>
`;
  write(join(RES, 'values', 'fale_colors.xml'), colors(C.bgLight, C.splashLight, true));
  write(join(RES, 'values-night', 'fale_colors.xml'), colors(C.bgDark, C.splashDark, false));

  // theme: names are fixed by Capacitor (AppTheme, AppTheme.NoActionBar, AppTheme.NoActionBarLaunch)
  write(join(RES, 'values', 'styles.xml'), `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/cap-patch-android.mjs – edit there, not here. -->
<resources>

    <style name="AppTheme" parent="Theme.AppCompat.DayNight.DarkActionBar">
        <item name="colorPrimary">@color/fale_primary</item>
        <item name="colorPrimaryDark">@color/fale_bg</item>
        <item name="colorAccent">@color/fale_accent</item>
    </style>

    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">@null</item>
        <item name="colorPrimary">@color/fale_primary</item>
        <item name="colorPrimaryDark">@color/fale_bg</item>
        <item name="colorAccent">@color/fale_accent</item>
        <item name="android:windowBackground">@color/fale_bg</item>
        <item name="android:statusBarColor">@color/fale_bg</item>
        <item name="android:navigationBarColor">@color/fale_bg</item>
        <item name="android:windowLightStatusBar">@bool/fale_light_bars</item>
    </style>

    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:background">@drawable/splash</item>
        <item name="windowSplashScreenBackground">@color/fale_splash_bg</item>
        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
    </style>
</resources>
`);

  // splash for Android < 12: replace the Capacitor logo PNGs by a layer-list
  if (existsSync(RES)) {
    for (const d of readdirSync(RES)) {
      if (!d.startsWith('drawable')) continue;
      for (const f of ['splash.png', 'splash.9.png', 'splash.jpg']) rmSync(join(RES, d, f), { force: true });
    }
  }
  write(join(RES, 'drawable', 'splash.xml'), `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/cap-patch-android.mjs -->
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/fale_splash_bg" />
    <item android:width="160dp" android:height="160dp" android:gravity="center"
        android:drawable="@mipmap/ic_launcher_foreground" />
</layer-list>
`);
}

// ------------------------------------------------------------------ icons
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const INK_TOP = [49, 46, 129], INK_BOTTOM = [23, 21, 66]; // same gradient as scripts/make_icons.py

function writePng(p, img) {
  const buf = png.encodePng(img);
  mkdirSync(dirname(p), { recursive: true });
  if (existsSync(p) && readFileSync(p).equals(buf)) return;
  writeFileSync(p, buf);
}

function patchIcons() {
  const icon = png.decodePng(readFileSync(join(ROOT, 'icons', 'icon-512.png')));
  const mask = png.decodePng(readFileSync(join(ROOT, 'icons', 'icon-maskable-512.png')));
  for (const [d, f] of Object.entries(DENSITIES)) {
    const dir = join(RES, `mipmap-${d}`);
    const legacy = Math.round(48 * f), layer = Math.round(108 * f);
    // legacy launcher icons (Android 7)
    writePng(join(dir, 'ic_launcher.png'), png.resize(icon, legacy, legacy));
    writePng(join(dir, 'ic_launcher_round.png'), png.circleMask(png.resize(mask, legacy, legacy)));
    // adaptive icon layers (108dp; the visible part is the centre 72dp)
    const inner = Math.round(76 * f), off = Math.round((layer - inner) / 2);
    const fg = png.composite(png.createImage(layer, layer), png.resize(mask, inner, inner), off, off);
    writePng(join(dir, 'ic_launcher_foreground.png'), fg);
    writePng(join(dir, 'ic_launcher_background.png'), png.verticalGradient(layer, layer, INK_TOP, INK_BOTTOM, off, off + inner - 1));
    writePng(join(dir, 'ic_launcher_monochrome.png'), png.silhouette(fg));
    // notification icon (24dp, white on transparent): the page mark only
    const crop = cropImage(mask, 106, 106, 300, 300);
    const n = Math.round(24 * f);
    writePng(join(RES, `drawable-${d}`, 'ic_stat_fale.png'), png.silhouette(png.resize(crop, n, n)));
  }
  const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/cap-patch-android.mjs -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
`;
  write(join(RES, 'mipmap-anydpi-v26', 'ic_launcher.xml'), adaptive);
  write(join(RES, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'), adaptive);
}

function cropImage(img, x, y, w, h) {
  const out = png.createImage(w, h);
  for (let r = 0; r < h; r++) {
    const s = ((y + r) * img.width + x) * 4;
    out.data.set(img.data.subarray(s, s + w * 4), r * w * 4);
  }
  return out;
}

// ------------------------------------------------------------------ main
function main() {
  must(existsSync(ANDROID), `${ANDROID} fehlt – zuerst \`npx cap add android\` ausführen.`);
  patchVariables();
  patchAppGradle();
  patchManifest();
  patchAds();
  patchJava();
  patchResources();
  patchIcons();
  log(`OK: ${APP_ID} „${APP_NAME}“ ${VERSION_NAME} (versionCode ${VERSION_CODE}, targetSdk ≥ ${TARGET_SDK})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
