package dev.fale.one;

// FaleBackup – the web app's handle on the background photo backup (one/js/native.js).
//
//   state()                         armed, prefs, checkpoints, last-run status, live progress, work states, notification permission
//   arm({...})                      store keys + session (Keystore-sealed) and schedule; see BackupStore for what is kept
//   disarm({reason})                wipe at once + cancel all work; → the newest session tokens for the web app
//   setPrefs({userId, on, videos, wifiOnly, lang})   switch + options (off = disarm)
//   runNow({allowMetered})          "Jetzt sichern" / app start (expedited work)
//   token({force})                  the ONE session refresher while armed: → {access_token, refresh_token, expires_in, user}
//                                   | {armed:false} (the web app refreshes itself) | {signedOut:true}
//   getCheckpoint / setCheckpoint   shared checkpoint for the in-app fallback run
//   lock({owner, ttl}) / unlock     the single-writer lock (BackupLock) for the in-app fallback run
//   requestNotifications()          Android 13+ notification permission (optional – backup works without)
// event "backupProgress": {running, done, total, saved, stopped?}
import android.content.Context;
import android.os.Build;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "FaleBackup",
    permissions = { @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" }) }
)
public class FaleBackupPlugin extends Plugin {
    private static final String TAG = BackupStore.TAG;
    private static final Pattern UUID_RE = Pattern.compile("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");
    private static final Pattern DEVICE_RE = Pattern.compile("^[A-Za-z0-9_-]{16,64}$");
    private static final Pattern KEY_RE = Pattern.compile("^[A-Za-z0-9_-]{43}$");
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        BackupEngine.listener = state -> {
            try { notifyListeners("backupProgress", JSObject.fromJSONObject(state)); } catch (Exception ignored) { /* WebView gone */ }
        };
    }

    private Context ctx() { return getContext().getApplicationContext(); }
    private static boolean https(String u) { return u != null && u.matches("^https://[A-Za-z0-9.-]+(:\\d+)?$"); }

    private String notificationState() {
        if (Build.VERSION.SDK_INT < 33) return "granted";
        PermissionState s = getPermissionState("notifications");
        return s == PermissionState.GRANTED ? "granted" : s == PermissionState.DENIED ? "denied" : "prompt";
    }

    private JSObject stateOf() throws Exception {
        Context c = ctx();
        BackupStore.Prefs p = BackupStore.loadPrefs(c);
        JSObject r = new JSObject();
        r.put("armed", BackupStore.armed(c));
        r.put("user", p.user);
        JSObject prefs = new JSObject();
        prefs.put("on", p.on);
        prefs.put("videos", p.videos);
        prefs.put("wifiOnly", p.wifiOnly);
        r.put("prefs", prefs);
        if (p.user != null) {
            JSObject cp = new JSObject();
            for (String kind : new String[] { "image", "video" }) {
                long[] v = BackupStore.checkpoint(c, p.user, kind);
                cp.put(kind, new JSObject().put("since", v[0]).put("afterId", v[1]));
            }
            r.put("checkpoint", cp);
            r.put("status", JSObject.fromJSONObject(BackupStore.status(c, p.user)));
        }
        r.put("live", JSObject.fromJSONObject(BackupEngine.live));
        r.put("lock", BackupLock.holder());
        r.put("work", JSObject.fromJSONObject(BackupScheduler.states(c)));
        r.put("notifications", notificationState());
        r.put("sdk", Build.VERSION.SDK_INT);
        return r;
    }

    @PluginMethod
    public void state(final PluginCall call) {
        io.execute(() -> {
            try { call.resolve(stateOf()); } catch (Exception e) { call.reject("state failed", "FAILED"); }
        });
    }

    /**
     * {userId, email, deviceId, deviceName, kek, dk, dvk (base64url, 32 bytes each), apiBase, supabaseUrl, supabaseKey,
     *  refresh, access?, accessExp?, photosFolderId?, folderName, lang, touchPlatform?}
     * Keeps the stored session when it already belongs to this account (it may be newer than the app's copy).
     */
    @PluginMethod
    public void arm(final PluginCall call) {
        final JSObject d = call.getData();
        io.execute(() -> {
            try {
                String user = d.getString("userId"), device = d.getString("deviceId");
                if (user == null || !UUID_RE.matcher(user).matches() || device == null || !DEVICE_RE.matcher(device).matches()) { call.reject("bad input", "BAD_INPUT"); return; }
                for (String k : new String[] { "kek", "dk", "dvk" }) {
                    String v = d.getString(k);
                    if (v == null || !KEY_RE.matcher(v).matches()) { call.reject("bad key", "BAD_INPUT"); return; }
                }
                if (!https(d.getString("apiBase")) || !https(d.getString("supabaseUrl")) || d.getString("supabaseKey", "").isEmpty() || d.getString("refresh", "").isEmpty()) {
                    call.reject("bad endpoints", "BAD_INPUT");
                    return;
                }
                Context c = ctx();
                synchronized (BackupStore.LOCK) {
                    JSONObject cur = BackupStore.loadSecret(c);
                    boolean same = cur != null && user.equals(cur.optString("userId")) && device.equals(cur.optString("deviceId"));
                    JSONObject s = new JSONObject();
                    s.put("v", 1);
                    s.put("userId", user);
                    s.put("email", d.getString("email", ""));
                    s.put("deviceId", device);
                    s.put("deviceName", d.getString("deviceName", "FaLe One · Android"));
                    s.put("touchPlatform", d.getString("touchPlatform", "web"));
                    for (String k : new String[] { "kek", "dk", "dvk" }) s.put(k, d.getString(k));
                    s.put("apiBase", d.getString("apiBase"));
                    s.put("supabaseUrl", d.getString("supabaseUrl"));
                    s.put("supabaseKey", d.getString("supabaseKey"));
                    s.put("folderName", d.getString("folderName", "Fotos"));
                    String folder = d.getString("photosFolderId", "");
                    if (folder != null && UUID_RE.matcher(folder).matches()) s.put("photosFolderId", folder);
                    else if (same && cur.optString("photosFolderId").length() > 0) s.put("photosFolderId", cur.optString("photosFolderId"));
                    if (same && cur.optString("refresh").length() > 0) {
                        // one session, one refresher: our copy is never older than the app's (it refreshes through us)
                        s.put("refresh", cur.optString("refresh"));
                        s.put("access", cur.optString("access"));
                        s.put("accessExp", cur.optLong("accessExp"));
                    } else {
                        s.put("refresh", d.getString("refresh"));
                        String access = d.getString("access", "");
                        if (access != null && !access.isEmpty()) {
                            s.put("access", access);
                            Object exp = d.opt("accessExp");
                            s.put("accessExp", exp instanceof Number ? ((Number) exp).longValue() : 0L);
                        }
                    }
                    BackupStore.saveSecret(c, s);
                }
                BackupStore.Prefs p = BackupStore.prefsFor(c, user);
                p.lang = "en".equals(d.getString("lang")) ? "en" : "de";
                BackupStore.savePrefs(c, p);
                BackupNotify.cancelSignIn(c);
                BackupScheduler.apply(c, false);
                JSObject r = new JSObject();
                r.put("armed", true);
                call.resolve(r);
            } catch (Exception e) {
                Log.w(TAG, "arm failed: " + e.getClass().getSimpleName());
                call.reject("arm failed", "FAILED");
            }
        });
    }

    /** Wipe now; hands the newest session tokens back so the app never reuses an outdated refresh token. */
    private JSObject disarmNow(String reason) {
        Context c = ctx();
        JSObject r = new JSObject();
        synchronized (BackupStore.LOCK) {
            JSONObject s = BackupStore.loadSecret(c);
            if (s != null) r = tokensOf(s);
            BackupStore.wipe(c, reason == null ? "app" : reason);
        }
        BackupScheduler.cancelAll(c);
        BackupNotify.cancelProgress(c);
        r.put("armed", false);
        return r;
    }
    @PluginMethod
    public void disarm(final PluginCall call) {
        final String reason = call.getString("reason", "app");
        io.execute(() -> call.resolve(disarmNow(reason)));
    }

    @PluginMethod
    public void setPrefs(final PluginCall call) {
        final JSObject d = call.getData();
        io.execute(() -> {
            try {
                Context c = ctx();
                String user = d.getString("userId");
                if (user == null || !UUID_RE.matcher(user).matches()) { call.reject("bad input", "BAD_INPUT"); return; }
                BackupStore.Prefs p = BackupStore.prefsFor(c, user);
                boolean was = p.on, wasWifi = p.wifiOnly, wasVideos = p.videos;
                if (d.has("on")) p.on = d.getBool("on");
                if (d.has("videos")) p.videos = d.getBool("videos");
                if (d.has("wifiOnly")) p.wifiOnly = d.getBool("wifiOnly");
                if (d.has("lang")) p.lang = "en".equals(d.getString("lang")) ? "en" : "de";
                BackupStore.savePrefs(c, p);
                JSObject r = new JSObject();
                if (!p.on) {
                    r = disarmNow("switched off"); // off = nothing stays on the device that could upload
                } else {
                    BackupScheduler.apply(c, was != p.on || wasWifi != p.wifiOnly || wasVideos != p.videos);
                }
                r.put("on", p.on);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("setPrefs failed", "FAILED");
            }
        });
    }

    @PluginMethod
    public void runNow(final PluginCall call) {
        final boolean metered = Boolean.TRUE.equals(call.getBoolean("allowMetered", false));
        io.execute(() -> {
            Context c = ctx();
            if (!BackupStore.armed(c)) { call.reject("not armed", "NOT_ARMED"); return; }
            BackupScheduler.runNow(c, metered);
            call.resolve(new JSObject().put("queued", true));
        });
    }

    private static JSObject tokensOf(JSONObject s) {
        JSObject r = new JSObject();
        r.put("access_token", s.optString("access"));
        r.put("refresh_token", s.optString("refresh"));
        r.put("expires_in", Math.max(0L, (s.optLong("accessExp") - System.currentTimeMillis()) / 1000L));
        r.put("user", new JSObject().put("id", s.optString("userId")).put("email", s.optString("email")));
        return r;
    }
    @PluginMethod
    public void token(final PluginCall call) {
        final boolean force = Boolean.TRUE.equals(call.getBoolean("force", false));
        io.execute(() -> {
            Context c = ctx();
            try {
                JSObject r = tokensOf(BackupApi.session(c, force));
                r.put("armed", true);
                call.resolve(r);
            } catch (BackupApi.NotArmed e) {
                call.resolve(new JSObject().put("armed", false));
            } catch (BackupApi.SignedOut e) {
                BackupStore.wipe(c, "signed out");
                BackupScheduler.cancelAll(c);
                call.resolve(new JSObject().put("armed", false).put("signedOut", true));
            } catch (Exception e) {
                call.reject("refresh failed", "NETWORK");
            }
        });
    }

    @PluginMethod
    public void getCheckpoint(PluginCall call) {
        String user = call.getString("userId"), kind = "video".equals(call.getString("kind")) ? "video" : "image";
        if (user == null || !UUID_RE.matcher(user).matches()) { call.reject("bad input", "BAD_INPUT"); return; }
        long[] v = BackupStore.checkpoint(ctx(), user, kind);
        call.resolve(new JSObject().put("since", v[0]).put("afterId", v[1]));
    }
    @PluginMethod
    public void setCheckpoint(PluginCall call) {
        String user = call.getString("userId"), kind = "video".equals(call.getString("kind")) ? "video" : "image";
        if (user == null || !UUID_RE.matcher(user).matches()) { call.reject("bad input", "BAD_INPUT"); return; }
        Object since = call.getData().opt("since"), after = call.getData().opt("afterId");
        if (!(since instanceof Number) || !(after instanceof Number)) { call.reject("bad input", "BAD_INPUT"); return; }
        BackupStore.setCheckpoint(ctx(), user, kind, ((Number) since).longValue(), ((Number) after).longValue());
        call.resolve();
    }

    @PluginMethod
    public void lock(PluginCall call) {
        String owner = call.getString("owner", "app");
        Object ttl = call.getData().opt("ttl");
        long ms = ttl instanceof Number ? Math.max(10000L, Math.min(600000L, ((Number) ttl).longValue())) : 120000L;
        String token = call.getString("token");
        JSObject r = new JSObject();
        if (token != null) { r.put("token", BackupLock.renew(token, ms) ? token : null); }
        else r.put("token", BackupLock.acquire(owner, ms));
        r.put("holder", BackupLock.holder());
        call.resolve(r);
    }
    @PluginMethod
    public void unlock(PluginCall call) {
        BackupLock.release(call.getString("token"));
        call.resolve();
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve(new JSObject().put("notifications", "granted"));
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsDone");
    }
    @PermissionCallback
    private void notificationsDone(PluginCall call) {
        call.resolve(new JSObject().put("notifications", notificationState()));
    }
}
