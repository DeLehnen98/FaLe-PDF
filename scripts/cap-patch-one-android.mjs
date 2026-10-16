#!/usr/bin/env node
// FaLe One Android app (Capacitor project in one-android/). Deterministic and idempotent.
//
//   node scripts/cap-patch-one-android.mjs --web       copy one/ → one-android/www (Capacitor webDir)
//   node scripts/cap-patch-one-android.mjs [android]   patch the generated one-android/android project
//                                                      (run after every `cap add android` / `cap sync android`)
//
// Env overrides: ANDROID_VERSION_CODE, ANDROID_VERSION_NAME (default: VERSION in one/js/config.js),
// ANDROID_TARGET_SDK (default 36).
//
// What the patch does: app id/name/version; permissions to read the phone's photos and videos (READ_MEDIA_*
// on Android 13+, partial access on Android 14+, READ_EXTERNAL_STORAGE up to Android 12, ACCESS_MEDIA_LOCATION
// so EXIF GPS stays in the originals – FaLe One encrypts it); MainActivity with the FaleMedia plugin (MediaStore
// listing for the automatic photo backup) and the FaleSystem plugin (system bar colours, network type, app
// settings, resume event); back button = web history (dialogs first), never closes the app on sub-pages; theme
// colours, splash, launcher icons from one/icons; security hardening as in FaLe PDF (no Android backups of app
// data, HTTPS only, system CAs for release builds, WebView without file/content URL access).
// Nothing here is shared with FaLe PDF's android/ project (scripts/cap-patch-android.mjs).
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as png from './cap-png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ONE = join(ROOT, 'one');
const PROJECT = join(ROOT, 'one-android');
const WEB_MODE = process.argv.includes('--web');
const argPath = process.argv.slice(2).find(a => !a.startsWith('--'));
const ANDROID = resolve(argPath || join(PROJECT, 'android'));
const APP = join(ANDROID, 'app');
const MAIN = join(APP, 'src', 'main');
const RES = join(MAIN, 'res');

const cap = JSON.parse(readFileSync(join(PROJECT, 'capacitor.config.json'), 'utf8'));
const APP_ID = cap.appId;
const APP_NAME = cap.appName;
if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(APP_ID)) throw new Error('Ungültige appId in one-android/capacitor.config.json: ' + APP_ID);

export function oneVersion() {
  const m = readFileSync(join(ONE, 'js', 'config.js'), 'utf8').match(/export const VERSION = '(\d+\.\d+\.\d+)'/);
  if (!m) throw new Error('VERSION (x.y.z) in one/js/config.js nicht gefunden');
  return m[1];
}
export function versionCodeOf(version) {
  const m = String(version).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error('Version muss x.y.z sein: ' + version);
  const [maj, min, pat] = m.slice(1).map(Number);
  if (min > 99 || pat > 99) throw new Error('minor/patch müssen ≤ 99 sein (versionCode-Schema)');
  return maj * 10000 + min * 100 + pat;
}

const log = (...a) => console.log('[cap-patch-one]', ...a);
const read = p => readFileSync(p, 'utf8');
function write(p, s) {
  mkdirSync(dirname(p), { recursive: true });
  if (existsSync(p) && read(p) === s) return;
  writeFileSync(p, s);
}
function must(cond, msg) { if (!cond) throw new Error('[cap-patch-one] ' + msg); }
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, "\\'");
const walk = d => readdirSync(d).flatMap(n => { const q = join(d, n); return statSync(q).isDirectory() ? walk(q) : [q]; });

/** Replace the block between markers (or insert it with `insert`) — keeps the patch idempotent. */
function upsertBlock(src, name, block, insert, cmt = ['<!--', '-->'], pad = '') {
  const mk = what => `${cmt[0]} fale-one:${name}:${what} ${cmt[1]}`.trim();
  const full = `${pad}${mk('start')}\n${block}\n${pad}${mk('end')}`;
  const q = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`[ \\t]*${q(mk('start'))}[\\s\\S]*?${q(mk('end'))}`);
  if (re.test(src)) return src.replace(re, () => full);
  return insert(src, full);
}
const indent = (s, n) => s.split('\n').map(l => (l ? ' '.repeat(n) + l : l)).join('\n');

// ------------------------------------------------------------------ web assets (webDir)
// one/ is deployed as is to the web; the app gets a copy without the hosting files. The service worker is
// left out on purpose (the app never registers one – see one/js/app.js): it must never intercept Capacitor's
// /_capacitor_content_/ and /_capacitor_file_/ URLs.
const WEB_SKIP = new Set(['vercel.json', 'README.md', 'sw.js', '.vercelignore']);
function prepareWeb() {
  const www = join(PROJECT, cap.webDir || 'www');
  must(www.startsWith(PROJECT + '/'), 'webDir muss innerhalb von one-android/ liegen');
  rmSync(www, { recursive: true, force: true });
  mkdirSync(www, { recursive: true });
  for (const name of readdirSync(ONE)) {
    if (WEB_SKIP.has(name) || name.startsWith('.')) continue;
    cpSync(join(ONE, name), join(www, name), { recursive: true });
  }
  // Android: no viewport-fit=cover → Capacitor's SystemBars keeps the WebView clear of the system bars.
  const ix = join(www, 'index.html');
  const html = read(ix);
  const out = html.replace(/,\s*viewport-fit=cover/, '');
  must(out !== html, 'viewport-fit=cover in one/index.html nicht gefunden');
  writeFileSync(ix, out);
  const files = walk(www).length;
  log(`Web-Dateien: ${files} nach ${www} kopiert`);
}

// ------------------------------------------------------------------ gradle
function patchVariables(targetSdk) {
  const p = join(ANDROID, 'variables.gradle');
  if (!existsSync(p)) return log('variables.gradle fehlt – übersprungen');
  let s = read(p);
  for (const key of ['compileSdkVersion', 'targetSdkVersion']) {
    s = s.replace(new RegExp(`(${key}\\s*=\\s*)(\\d+)`), (m, a, v) => a + Math.max(+v, targetSdk));
  }
  write(p, s);
}

function patchAppGradle(versionName, versionCode) {
  const p = join(APP, 'build.gradle');
  must(existsSync(p), 'app/build.gradle fehlt – ist das ein Capacitor-Android-Projekt?');
  let s = read(p);
  s = s.replace(/applicationId\s+"[^"]*"/, `applicationId "${APP_ID}"`);
  s = s.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
  s = s.replace(/versionName\s+"[^"]*"/, `versionName "${versionName}"`);
  must(s.includes(`versionCode ${versionCode}`), 'versionCode nicht gefunden');
  must(s.includes(`applicationId "${APP_ID}"`), 'applicationId nicht gefunden');
  write(p, s);
}

// ------------------------------------------------------------------ manifest
export const PERMISSIONS = [
  '<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
  '<!-- Automatische Fotosicherung: Fotos und Videos lesen (Android 13+), Teilzugriff (Android 14+), bis Android 12 Speicher lesen -->',
  '<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />',
  '<uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />',
  '<uses-permission android:name="android.permission.READ_MEDIA_VISUAL_USER_SELECTED" />',
  '<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />',
  '<!-- Ortsdaten (EXIF-GPS) bleiben im Original erhalten; FaLe One verschlüsselt sie auf dem Gerät -->',
  '<uses-permission android:name="android.permission.ACCESS_MEDIA_LOCATION" />',
];
function patchManifest() {
  const p = join(MAIN, 'AndroidManifest.xml');
  must(existsSync(p), 'AndroidManifest.xml fehlt');
  let s = read(p);
  s = upsertBlock(s, 'permissions', indent(PERMISSIONS.join('\n'), 4), (src, full) => src.replace(/\n*<\/manifest>\s*$/, () => `\n\n${full}\n</manifest>\n`), undefined, '    ');

  s = s.replace(/<application\b([^>]*)>/, (m, attrs) => {
    let a = attrs;
    // Security: keys, index and tokens never leave the device via Android backup or device transfer;
    // HTTPS only; release builds trust system CAs only.
    const set = (name, value) => {
      const re = new RegExp(`android:${name}="[^"]*"`);
      a = re.test(a) ? a.replace(re, `android:${name}="${value}"`) : a.replace(/\s*$/, '') + `\n        android:${name}="${value}"`;
    };
    set('allowBackup', 'false');
    set('fullBackupContent', 'false');
    set('dataExtractionRules', '@xml/fale_data_extraction_rules');
    set('usesCleartextTraffic', 'false');
    set('networkSecurityConfig', '@xml/fale_network_security_config');
    return `<application${a}>`;
  });
  s = s.replace(/<provider\b([^>]*?)(\/?)>/g, (m, attrs, close) => (/android:exported=/.test(attrs) ? m.replace(/android:exported="[^"]*"/, 'android:exported="false"') : `<provider${attrs.replace(/\s*$/, '')}\n            android:exported="false"${close}>`));

  const actRe = /<activity\b([^>]*android:name="\.MainActivity"[^>]*)>/;
  must(actRe.test(s), 'MainActivity nicht im Manifest gefunden');
  s = s.replace(actRe, (m, attrs) => {
    let a = attrs;
    if (!/windowSoftInputMode/.test(a)) a = a.replace(/\s*$/, '') + '\n            android:windowSoftInputMode="adjustResize"';
    return `<activity${a}>`;
  });
  write(p, s);
}

// ------------------------------------------------------------------ java
function findMainActivity() {
  const javaRoot = join(MAIN, 'java');
  const want = join(javaRoot, ...APP_ID.split('.'), 'MainActivity.java');
  if (existsSync(want)) return want;
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
  write(join(dir, 'FaleMediaPlugin.java'), MEDIA_PLUGIN(pkgName));
  write(join(dir, 'FaleSystemPlugin.java'), SYSTEM_PLUGIN(pkgName));
}

const MAIN_ACTIVITY = pkgName => `package ${pkgName};

// Generated by scripts/cap-patch-one-android.mjs – edit there, not here.
import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Custom plugins must be registered before super.onCreate (Capacitor 3+).
        registerPlugin(FaleMediaPlugin.class);
        registerPlugin(FaleSystemPlugin.class);
        super.onCreate(savedInstanceState);
        hardenWebView();
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                back();
            }
        });
    }

    /**
     * Back button: first the web app may close an open dialog (window.faleOneBack()), then the web history
     * (sub-pages, photo viewer), and only on the start page the app goes to the background – it is never
     * closed from a sub-page.
     */
    private void back() {
        final WebView wv = getBridge() != null ? getBridge().getWebView() : null;
        if (wv == null) {
            moveTaskToBack(true);
            return;
        }
        try {
            wv.evaluateJavascript("(function(){try{return !!(window.faleOneBack&&window.faleOneBack());}catch(e){return false;}})()", res -> {
                boolean history = wv.canGoBack();
                Log.i("FaleOne", "back: dialog=" + res + " canGoBack=" + history);
                if ("true".equals(res)) return;
                if (history) wv.goBack();
                else moveTaskToBack(true);
            });
        } catch (Exception e) {
            if (wv.canGoBack()) wv.goBack();
            else moveTaskToBack(true);
        }
    }

    /**
     * Security: the app is served by Capacitor's local https://localhost server, so the WebView never needs
     * file:// or content:// URLs (photos are read through the local server); no debugging in release builds.
     */
    private void hardenWebView() {
        try {
            if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) == 0) WebView.setWebContentsDebuggingEnabled(false);
            WebView wv = getBridge() != null ? getBridge().getWebView() : null;
            if (wv == null) return;
            WebSettings s = wv.getSettings();
            s.setAllowFileAccess(false);
            s.setAllowContentAccess(false);
            s.setAllowFileAccessFromFileURLs(false);
            s.setAllowUniversalAccessFromFileURLs(false);
            s.setGeolocationEnabled(false);
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        } catch (Exception ignored) {
            // never block the app start
        }
    }
}
`;

// MediaStore listing for the automatic photo backup (one/js/native.js). The web app pages through the
// phone's photos with a checkpoint (date_added, _id) and fetches each original through Capacitor's local
// server (convertFileSrc(content://…)), then hands it to the existing backup path (dedupe by content hash).
const MEDIA_PLUGIN = pkgName => `package ${pkgName};

// Generated by scripts/cap-patch-one-android.mjs – edit there, not here.
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Log;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "FaleMedia",
    permissions = {
        @Permission(alias = "media", strings = { "android.permission.READ_MEDIA_IMAGES", "android.permission.READ_MEDIA_VIDEO" }),
        @Permission(alias = "mediaSelected", strings = { "android.permission.READ_MEDIA_VISUAL_USER_SELECTED" }),
        @Permission(alias = "storage", strings = { "android.permission.READ_EXTERNAL_STORAGE" }),
        @Permission(alias = "location", strings = { "android.permission.ACCESS_MEDIA_LOCATION" })
    }
)
public class FaleMediaPlugin extends Plugin {
    private static final String TAG = "FaleMedia";
    private static final int MAX_LIMIT = 500;
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    private boolean granted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }

    /** "granted" (all photos), "limited" (Android 14+: only photos the user picked), "denied" or "prompt". */
    private String mediaState() {
        int sdk = Build.VERSION.SDK_INT;
        if (sdk >= 33) {
            if (granted("android.permission.READ_MEDIA_IMAGES")) return "granted";
            if (sdk >= 34 && granted("android.permission.READ_MEDIA_VISUAL_USER_SELECTED")) return "limited";
            return stateOf("media");
        }
        if (granted("android.permission.READ_EXTERNAL_STORAGE")) return "granted";
        return stateOf("storage");
    }

    private String stateOf(String alias) {
        try {
            PermissionState st = getPermissionState(alias);
            if (st == PermissionState.DENIED) return "denied";
        } catch (Exception ignored) {
            // unknown alias state → ask
        }
        return "prompt";
    }

    private boolean locationGranted() {
        return Build.VERSION.SDK_INT < 29 || granted("android.permission.ACCESS_MEDIA_LOCATION");
    }

    private boolean videoGranted() {
        if (Build.VERSION.SDK_INT >= 33) return granted("android.permission.READ_MEDIA_VIDEO") || (Build.VERSION.SDK_INT >= 34 && granted("android.permission.READ_MEDIA_VISUAL_USER_SELECTED"));
        return granted("android.permission.READ_EXTERNAL_STORAGE");
    }

    private JSObject states() {
        JSObject r = new JSObject();
        r.put("media", mediaState());
        r.put("video", videoGranted());
        r.put("location", locationGranted() ? "granted" : "denied");
        r.put("sdk", Build.VERSION.SDK_INT);
        return r;
    }

    @Override
    @PluginMethod
    public void checkPermissions(PluginCall call) {
        call.resolve(states());
    }

    @Override
    @PluginMethod
    public void requestPermissions(PluginCall call) {
        int sdk = Build.VERSION.SDK_INT;
        List<String> aliases = new ArrayList<>();
        if (sdk >= 33) {
            aliases.add("media");
            if (sdk >= 34) aliases.add("mediaSelected");
        } else {
            aliases.add("storage");
        }
        if (sdk >= 29) aliases.add("location");
        requestPermissionForAliases(aliases.toArray(new String[0]), call, "permissionsDone");
    }

    @PermissionCallback
    private void permissionsDone(PluginCall call) {
        call.resolve(states());
    }

    private static final class Query {
        String selection;
        String[] args;
    }

    /** checkpoint: since = date_added in seconds, afterId = MediaStore _ID (unique across images and videos) */
    private static Query query(long since, long afterId) {
        Query q = new Query();
        q.selection = "(date_added > ? OR (date_added = ? AND _id > ?))";
        q.args = new String[] { String.valueOf(since), String.valueOf(since), String.valueOf(afterId) };
        return q;
    }

    /** kind: "image" | "video" | "all" (includeVideos: true → "all") */
    private static String[] kindsOf(PluginCall call) {
        String kind = call.getString("kind", null);
        if (kind == null) kind = Boolean.TRUE.equals(call.getBoolean("includeVideos", false)) ? "all" : "image";
        if ("all".equals(kind)) return new String[] { "image", "video" };
        return new String[] { "video".equals(kind) ? "video" : "image" };
    }

    private static Uri collection(String kind) {
        return "video".equals(kind) ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
    }

    private Cursor open(Uri uri, String[] projection, Query q, int limit) {
        ContentResolver cr = getContext().getContentResolver();
        String order = "date_added ASC, _id ASC";
        if (Build.VERSION.SDK_INT >= 26) {
            Bundle b = new Bundle();
            b.putString(ContentResolver.QUERY_ARG_SQL_SELECTION, q.selection);
            b.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, q.args);
            b.putString(ContentResolver.QUERY_ARG_SQL_SORT_ORDER, order);
            if (limit > 0) b.putInt(ContentResolver.QUERY_ARG_LIMIT, limit);
            return cr.query(uri, projection, b, null);
        }
        return cr.query(uri, projection, q.selection, q.args, limit > 0 ? order + " LIMIT " + limit : order);
    }

    private boolean canRead() {
        String st = mediaState();
        return "granted".equals(st) || "limited".equals(st);
    }

    /** JSON numbers arrive as Integer or Long (or Double) – PluginCall.getLong only accepts Long. */
    private static long longArg(PluginCall call, String name, long fallback) {
        Object v = call.getData().opt(name);
        return v instanceof Number ? ((Number) v).longValue() : fallback;
    }

    private static long longAt(Cursor c, int i, long fallback) {
        return i >= 0 && !c.isNull(i) ? c.getLong(i) : fallback;
    }

    /** Up to max rows of one collection after the checkpoint, in checkpoint order. */
    private void readRows(String kind, Query q, int max, boolean original, List<JSObject> out) {
        final boolean video = "video".equals(kind);
        final Uri base = collection(kind);
        String[] projection = { "_id", "_display_name", "mime_type", "_size", "date_added", "date_modified", "datetaken" };
        Cursor c = null;
        try {
            c = open(base, projection, q, max);
            if (c == null) return;
            int iId = c.getColumnIndex("_id"), iName = c.getColumnIndex("_display_name"), iMime = c.getColumnIndex("mime_type"),
                iSize = c.getColumnIndex("_size"), iAdded = c.getColumnIndex("date_added"), iMod = c.getColumnIndex("date_modified"),
                iTaken = c.getColumnIndex("datetaken");
            int n = 0;
            while (n < max && c.moveToNext()) {
                n++;
                long id = longAt(c, iId, -1);
                if (id < 0) continue;
                Uri plain = ContentUris.withAppendedId(base, id);
                Uri uri = plain;
                if (original) {
                    try {
                        uri = MediaStore.setRequireOriginal(plain);
                    } catch (Exception e) {
                        uri = plain;
                    }
                }
                long added = longAt(c, iAdded, 0);
                long modified = longAt(c, iMod, added);
                long taken = longAt(c, iTaken, 0);
                if (taken <= 0) taken = (modified > 0 ? modified : added) * 1000L;
                String name = iName >= 0 && !c.isNull(iName) ? c.getString(iName) : null;
                String mime = iMime >= 0 && !c.isNull(iMime) ? c.getString(iMime) : null;
                JSObject o = new JSObject();
                o.put("id", id);
                o.put("uri", uri.toString());
                o.put("plainUri", plain.toString());
                o.put("name", name == null || name.trim().isEmpty() ? (video ? "VID_" : "IMG_") + id : name);
                o.put("mime", mime == null ? "" : mime);
                o.put("size", longAt(c, iSize, 0));
                o.put("taken", taken);
                o.put("modified", modified);
                o.put("added", added);
                o.put("video", video);
                out.add(o);
            }
        } finally {
            if (c != null) c.close();
        }
    }

    /**
     * {kind?: "image"|"video"|"all", includeVideos?, since?: seconds, afterId?, limit?} →
     * {items: [{id, uri, plainUri, name, mime, size, taken (ms), modified (s), added (s), video}], hasMore}
     * ordered by date_added, _id ascending (the checkpoint order).
     */
    @PluginMethod
    public void list(final PluginCall call) {
        if (!canRead()) {
            call.reject("Kein Zugriff auf Fotos", "PERMISSION");
            return;
        }
        final String[] kinds = kindsOf(call);
        final long since = Math.max(0L, longArg(call, "since", 0L));
        final long afterId = Math.max(0L, longArg(call, "afterId", 0L));
        final int limit = (int) Math.max(1L, Math.min(MAX_LIMIT, longArg(call, "limit", 100L)));
        io.execute(() -> {
            try {
                boolean original = locationGranted() && Build.VERSION.SDK_INT >= 29;
                List<JSObject> rows = new ArrayList<>();
                Query q = query(since, afterId);
                for (String kind : kinds) readRows(kind, q, limit + 1, original, rows);
                Collections.sort(rows, (a, b) -> {
                    int c = Long.compare(a.optLong("added"), b.optLong("added"));
                    return c != 0 ? c : Long.compare(a.optLong("id"), b.optLong("id"));
                });
                JSArray items = new JSArray();
                for (int i = 0; i < Math.min(limit, rows.size()); i++) items.put(rows.get(i));
                JSObject ret = new JSObject();
                ret.put("items", items);
                ret.put("hasMore", rows.size() > limit);
                call.resolve(ret);
            } catch (Exception e) {
                Log.w(TAG, "list failed", e);
                call.reject("list failed: " + e.getMessage(), "FAILED");
            }
        });
    }

    /** Number of photos (and videos) after a checkpoint: {kind?, includeVideos?, since?, afterId?} → {count} */
    @PluginMethod
    public void count(final PluginCall call) {
        if (!canRead()) {
            call.reject("Kein Zugriff auf Fotos", "PERMISSION");
            return;
        }
        final String[] kinds = kindsOf(call);
        final long since = Math.max(0L, longArg(call, "since", 0L));
        final long afterId = Math.max(0L, longArg(call, "afterId", 0L));
        io.execute(() -> {
            try {
                int total = 0;
                for (String kind : kinds) {
                    try (Cursor c = open(collection(kind), new String[] { "_id" }, query(since, afterId), 0)) {
                        total += c == null ? 0 : c.getCount();
                    }
                }
                JSObject ret = new JSObject();
                ret.put("count", total);
                call.resolve(ret);
            } catch (Exception e) {
                Log.w(TAG, "count failed", e);
                call.reject("count failed: " + e.getMessage(), "FAILED");
            }
        });
    }
}
`;

// System bars, network type, app settings and a resume event for the web app (one/js/native.js).
const SYSTEM_PLUGIN = pkgName => `package ${pkgName};

// Generated by scripts/cap-patch-one-android.mjs – edit there, not here.
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FaleSystem")
public class FaleSystemPlugin extends Plugin {
    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        notifyListeners("appResume", new JSObject());
    }

    /** Status/navigation bar colours to match the web app theme: {color:"#RRGGBB", dark:boolean} */
    @PluginMethod
    @SuppressWarnings("deprecation")
    public void setBarColors(PluginCall call) {
        final String color = call.getString("color", "#F2F3F9");
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

    /** {connected, wifi (Wi-Fi or Ethernet), metered, known} */
    @PluginMethod
    public void network(PluginCall call) {
        JSObject r = new JSObject();
        try {
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            Network n = cm != null ? cm.getActiveNetwork() : null;
            NetworkCapabilities caps = n != null ? cm.getNetworkCapabilities(n) : null;
            boolean connected = caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
            boolean wifi = caps != null && (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET));
            r.put("known", cm != null);
            r.put("connected", connected);
            r.put("wifi", wifi);
            r.put("metered", cm != null && cm.isActiveNetworkMetered());
        } catch (Exception e) {
            r.put("known", false);
        }
        call.resolve(r);
    }

    /** Opens this app's page in the Android settings (to allow photo access after "Nicht mehr fragen"). */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("openAppSettings failed: " + e.getMessage());
        }
    }
}
`;

// ------------------------------------------------------------------ security resources
function patchSecurityXml() {
  write(join(RES, 'xml', 'fale_network_security_config.xml'), `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/cap-patch-one-android.mjs -->
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
    <debug-overrides>
        <trust-anchors>
            <certificates src="user" />
        </trust-anchors>
    </debug-overrides>
</network-security-config>
`);
  // Nothing of the app's private data (master key, sealed index, account tokens) goes into cloud backups or
  // device-to-device transfers. The user's data lives end-to-end encrypted in FaLe One itself.
  const none = ['root', 'file', 'database', 'sharedpref', 'external'].map(d => `        <exclude domain="${d}" path="." />`).join('\n');
  write(join(RES, 'xml', 'fale_data_extraction_rules.xml'), `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/cap-patch-one-android.mjs -->
<data-extraction-rules>
    <cloud-backup>
${none}
    </cloud-backup>
    <device-transfer>
${none}
    </device-transfer>
</data-extraction-rules>
`);
}

// ------------------------------------------------------------------ resources
// Theme colours: keep in sync with one/index.html (theme-color) and one/css/fale-tokens.css
const C = { bgLight: '#F2F3F9', bgDark: '#0E0D23', primary: '#2F6BE0', primaryDark: '#1A2A86', accent: '#2DD4BF' };
const GRAD_TOP = [47, 107, 224], GRAD_BOTTOM = [26, 42, 134]; // one/icons/favicon.svg gradient

function patchResources() {
  const sp = join(RES, 'values', 'strings.xml');
  if (existsSync(sp)) {
    let s = read(sp);
    s = s.replace(/(<string name="app_name">)[^<]*(<\/string>)/, `$1${esc(APP_NAME)}$2`);
    s = s.replace(/(<string name="title_activity_main">)[^<]*(<\/string>)/, `$1${esc(APP_NAME)}$2`);
    write(sp, s);
  }
  const colors = (bg, light) => `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/cap-patch-one-android.mjs -->
<resources>
    <color name="fale_bg">${bg}</color>
    <color name="fale_splash_bg">${bg}</color>
    <color name="fale_primary">${C.primary}</color>
    <color name="fale_primary_dark">${C.primaryDark}</color>
    <color name="fale_accent">${C.accent}</color>
    <bool name="fale_light_bars">${light}</bool>
</resources>
`;
  write(join(RES, 'values', 'fale_colors.xml'), colors(C.bgLight, true));
  write(join(RES, 'values-night', 'fale_colors.xml'), colors(C.bgDark, false));

  write(join(RES, 'values', 'styles.xml'), `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/cap-patch-one-android.mjs – edit there, not here. -->
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

  if (existsSync(RES)) {
    for (const d of readdirSync(RES)) {
      if (!d.startsWith('drawable')) continue;
      for (const f of ['splash.png', 'splash.9.png', 'splash.jpg']) rmSync(join(RES, d, f), { force: true });
    }
  }
  write(join(RES, 'drawable', 'splash.xml'), `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/cap-patch-one-android.mjs -->
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/fale_splash_bg" />
    <item android:width="160dp" android:height="160dp" android:gravity="center"
        android:drawable="@mipmap/ic_launcher_foreground" />
</layer-list>
`);
}

// ------------------------------------------------------------------ icons (one/icons: FaLe One cloud)
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
function writePng(p, img) {
  const buf = png.encodePng(img);
  mkdirSync(dirname(p), { recursive: true });
  if (existsSync(p) && readFileSync(p).equals(buf)) return;
  writeFileSync(p, buf);
}
function patchIcons() {
  const icon = png.decodePng(readFileSync(join(ONE, 'icons', 'icon-512.png')));
  const mask = png.decodePng(readFileSync(join(ONE, 'icons', 'icon-maskable-512.png')));
  for (const [d, f] of Object.entries(DENSITIES)) {
    const dir = join(RES, `mipmap-${d}`);
    const legacy = Math.round(48 * f), layer = Math.round(108 * f);
    writePng(join(dir, 'ic_launcher.png'), png.resize(icon, legacy, legacy));
    writePng(join(dir, 'ic_launcher_round.png'), png.circleMask(png.resize(mask, legacy, legacy)));
    // adaptive icon: the maskable icon is full-bleed (gradient + cloud inside its safe zone), so it fills the
    // whole 108dp layer; the launcher shows the centre 72dp – the cloud stays fully visible.
    const fg = png.resize(mask, layer, layer);
    writePng(join(dir, 'ic_launcher_foreground.png'), fg);
    writePng(join(dir, 'ic_launcher_background.png'), png.verticalGradient(layer, layer, GRAD_TOP, GRAD_BOTTOM));
    writePng(join(dir, 'ic_launcher_monochrome.png'), png.silhouette(fg, 115));
  }
  const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/cap-patch-one-android.mjs -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
`;
  write(join(RES, 'mipmap-anydpi-v26', 'ic_launcher.xml'), adaptive);
  write(join(RES, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'), adaptive);
}

// ------------------------------------------------------------------ main
function main() {
  if (WEB_MODE) return prepareWeb();
  must(existsSync(ANDROID), `${ANDROID} fehlt – zuerst \`cap add android\` in one-android/ ausführen.`);
  const versionName = process.env.ANDROID_VERSION_NAME || oneVersion();
  const versionCode = parseInt(process.env.ANDROID_VERSION_CODE || '', 10) || versionCodeOf(oneVersion());
  const targetSdk = parseInt(process.env.ANDROID_TARGET_SDK || '', 10) || 36;
  patchVariables(targetSdk);
  patchAppGradle(versionName, versionCode);
  patchManifest();
  patchJava();
  patchResources();
  patchSecurityXml();
  patchIcons();
  log(`OK: ${APP_ID} „${APP_NAME}“ ${versionName} (versionCode ${versionCode}, targetSdk ≥ ${targetSdk})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
