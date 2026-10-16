package dev.fale.one;

// HTTP for the background backup: /api/drive (contract docs/FALE-ONE-API.md §4) and the FaLe-Konto session
// (Supabase Auth refresh-token flow). Same retry rules as js/one/api.js: network errors and 502/503/504 are
// retried with backoff, 401 invalid_account refreshes the session once.
//
// One session, one refresher: while the backup is armed, the web app does NOT refresh on its own – it asks this
// class (FaleBackupPlugin.token), so a rotated refresh token can never be reused by the other side (Supabase
// would treat that as token theft and end the session). Tokens and keys are never logged.
import android.content.Context;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import org.json.JSONObject;

final class BackupApi {
    static final String TAG = BackupStore.TAG;
    static final String APP_VERSION = "one-1.0.0";

    /** HTTP error with the API's error code (or "network" for status 0). */
    static final class HttpError extends IOException {
        final int status;
        final String code;
        final JSONObject body;
        HttpError(int status, String code, JSONObject body) {
            super(code + " (HTTP " + status + ")");
            this.status = status;
            this.code = code;
            this.body = body;
        }
        boolean network() { return status == 0 || status == 502 || status == 503 || status == 504 || "storage_upload_failed".equals(code); }
    }
    /** The session cannot be refreshed any more (signed out elsewhere, device removed, account deleted). */
    static final class SignedOut extends Exception { SignedOut(String why) { super(why); } }
    /** The backup is not set up on this device (no keys). */
    static final class NotArmed extends Exception { NotArmed() { super("not armed"); } }

    private BackupApi() {}

    // ---------------------------------------------------------------- endpoints (debug builds may point them at a mock server)
    static String apiBase(Context c, JSONObject sec) {
        String o = DebugHooks.apiOverride(c);
        return o != null ? o : sec.optString("apiBase", "");
    }
    static String supabaseUrl(Context c, JSONObject sec) {
        String o = DebugHooks.apiOverride(c);
        return o != null ? o : sec.optString("supabaseUrl", "");
    }

    // ---------------------------------------------------------------- raw HTTP
    static final class Res {
        int status;
        byte[] body;
        JSONObject json() {
            try { return new JSONObject(new String(body, StandardCharsets.UTF_8)); } catch (Exception e) { return new JSONObject(); }
        }
    }
    static Res http(String method, String url, String[] headers, byte[] body, int readTimeoutMs) throws IOException {
        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        try {
            con.setRequestMethod(method);
            con.setConnectTimeout(20000);
            con.setReadTimeout(readTimeoutMs);
            con.setUseCaches(false);
            con.setInstanceFollowRedirects(false);
            for (int i = 0; i + 1 < headers.length; i += 2) con.setRequestProperty(headers[i], headers[i + 1]);
            if (body != null) {
                con.setDoOutput(true);
                con.setFixedLengthStreamingMode(body.length);
                try (OutputStream out = con.getOutputStream()) { out.write(body); }
            }
            Res r = new Res();
            r.status = con.getResponseCode();
            InputStream in = r.status >= 400 ? con.getErrorStream() : con.getInputStream();
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            if (in != null) {
                try (InputStream s = in) {
                    byte[] b = new byte[16384];
                    for (int n; (n = s.read(b)) > 0; ) buf.write(b, 0, n);
                }
            }
            r.body = buf.toByteArray();
            return r;
        } finally {
            con.disconnect();
        }
    }

    // ---------------------------------------------------------------- session
    /** Valid access token (refreshed when it expires within a minute, or when forced). */
    static String accessToken(Context c, boolean force) throws IOException, SignedOut, NotArmed {
        return session(c, force).optString("access");
    }
    /** The secret with a valid access token. Refreshes under LOCK: one refresh at a time for app and workers. */
    static JSONObject session(Context c, boolean force) throws IOException, SignedOut, NotArmed {
        synchronized (BackupStore.LOCK) {
            JSONObject s = BackupStore.loadSecret(c);
            if (s == null) throw new NotArmed();
            long exp = s.optLong("accessExp", 0);
            if (!force && s.optString("access", "").length() > 0 && exp - 60000 > System.currentTimeMillis()) return s;
            String url = supabaseUrl(c, s), key = s.optString("supabaseKey", ""), refresh = s.optString("refresh", "");
            if (url.isEmpty() || key.isEmpty() || refresh.isEmpty()) throw new SignedOut("no session");
            JSONObject body = new JSONObject();
            try { body.put("refresh_token", refresh); } catch (Exception e) { throw new IOException(e); }
            Res r;
            try {
                r = http("POST", url + "/auth/v1/token?grant_type=refresh_token",
                    new String[] { "apikey", key, "Content-Type", "application/json", "Accept", "application/json" }, body.toString().getBytes(StandardCharsets.UTF_8), 30000);
            } catch (IOException e) {
                throw new HttpError(0, "network", null);
            }
            if (r.status >= 400 && r.status < 500 && r.status != 429) {
                Log.i(TAG, "session refresh refused (HTTP " + r.status + ")");
                throw new SignedOut("refresh " + r.status);
            }
            if (r.status != 200) throw new HttpError(r.status, "refresh_failed", null);
            JSONObject t = r.json();
            String access = t.optString("access_token", ""), next = t.optString("refresh_token", "");
            if (access.isEmpty() || next.isEmpty()) throw new HttpError(502, "refresh_failed", null);
            JSONObject user = t.optJSONObject("user");
            if (user != null && user.optString("id").length() > 0 && !user.optString("id").equals(s.optString("userId"))) throw new SignedOut("other user");
            try {
                s.put("refresh", next);
                s.put("access", access);
                s.put("accessExp", System.currentTimeMillis() + Math.max(30, t.optLong("expires_in", 3600)) * 1000L);
                if (user != null && user.optString("email").length() > 0) s.put("email", user.optString("email"));
                BackupStore.saveSecret(c, s); // the new refresh token is on disk before anyone uses it
            } catch (Exception e) {
                throw new IOException("session not saved", e);
            }
            return s;
        }
    }

    // ---------------------------------------------------------------- /api/drive
    static final class Drive {
        final Context c;
        final String base, deviceId, userId;
        int retries = 3;
        Drive(Context c, JSONObject sec) {
            this.c = c;
            this.base = apiBase(c, sec).replaceAll("/+$", "");
            this.deviceId = sec.optString("deviceId");
            this.userId = sec.optString("userId");
        }

        private Res send(String action, String query, byte[] body, boolean raw) throws IOException, SignedOut, NotArmed {
            boolean refreshed = false;
            for (int attempt = 0; ; attempt++) {
                String token = accessToken(c, refreshed);
                Res r = null;
                try {
                    r = http("POST", base + "/api/drive?a=" + URLEncoder.encode(action, "UTF-8") + query,
                        new String[] { "Authorization", "Bearer " + token, "Content-Type", raw ? "application/octet-stream" : "application/json" }, body, 90000);
                } catch (IOException e) {
                    r = null;
                }
                int status = r == null ? 0 : r.status;
                if (r != null && status >= 200 && status < 300) return r;
                JSONObject j = r == null ? new JSONObject() : r.json();
                String code = j.optString("error", status == 0 ? "network" : "http_" + status);
                if (status == 401 && !refreshed && "invalid_account".equals(code)) { refreshed = true; continue; }
                if (status == 401 && "no_user".equals(code)) throw new SignedOut("no_user");
                boolean retry = status == 0 || status == 502 || status == 503 || status == 504;
                if (retry && attempt < retries && !"drive_not_configured".equals(code)) {
                    sleep(500L << attempt);
                    continue;
                }
                throw new HttpError(status, code, j);
            }
        }
        JSONObject call(String action, JSONObject body) throws IOException, SignedOut, NotArmed {
            return send(action, "", body.toString().getBytes(StandardCharsets.UTF_8), false).json();
        }
        void putChunk(String uploadId, long i, byte[] sealed) throws IOException, SignedOut, NotArmed {
            send("upload.put", "&u=" + uploadId + "&i=" + i, sealed, true);
        }
        /** Direct upload to the bucket (presigned PUT, S3 backend). */
        void putUrl(JSONObject u, byte[] sealed) throws IOException {
            JSONObject h = u.optJSONObject("headers");
            java.util.List<String> hs = new java.util.ArrayList<>();
            if (h != null) {
                for (Iterator<String> it = h.keys(); it.hasNext(); ) {
                    String k = it.next();
                    if ("content-length".equalsIgnoreCase(k)) continue; // set by the fixed-length body
                    hs.add(k);
                    hs.add(h.optString(k));
                }
            }
            for (int attempt = 0; ; attempt++) {
                Res r = null;
                try { r = http("PUT", u.optString("url"), hs.toArray(new String[0]), sealed, 90000); } catch (IOException e) { r = null; }
                if (r != null && r.status >= 200 && r.status < 300) return;
                if (attempt >= retries) throw new HttpError(r == null ? 0 : r.status, "storage_upload_failed", null);
                sleep(400L << attempt);
            }
        }
    }

    /** FaLe-Konto device heartbeat (same RPC as the web app): → true when this device was removed ("revoked"). */
    static boolean deviceRevoked(Context c, JSONObject sec) throws IOException, SignedOut, NotArmed {
        String url = supabaseUrl(c, sec), key = sec.optString("supabaseKey", "");
        if (url.isEmpty() || key.isEmpty()) return false;
        JSONObject body = new JSONObject();
        try {
            body.put("p_device", sec.optString("deviceId"));
            body.put("p_name", sec.optString("deviceName"));
            body.put("p_platform", sec.optString("touchPlatform", "web"));
            body.put("p_version", APP_VERSION);
        } catch (Exception e) { return false; }
        String token = accessToken(c, false);
        Res r = http("POST", url + "/rest/v1/rpc/fale_device_touch",
            new String[] { "apikey", key, "Authorization", "Bearer " + token, "Content-Type", "application/json" }, body.toString().getBytes(StandardCharsets.UTF_8), 30000);
        if (r.status != 200) return false; // not deployed / temporary: the next run asks again
        return r.json().optBoolean("revoked", false);
    }

    static void sleep(long ms) { try { Thread.sleep(ms); } catch (InterruptedException e) { Thread.currentThread().interrupt(); } }
}
