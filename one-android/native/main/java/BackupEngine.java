package dev.fale.one;

// One background backup run – the same algorithm as the web worker's photo backup (docs/FALE-ONE-API.md §7.2,
// §7.6; one/js/worker.js prepare/putBlob/runJob), producing byte-compatible ciphertext:
//
//   for every photo (and video, when on) after the per-account checkpoint (date_added, _id), oldest first:
//     content digest + keyed dedupe hash → already stored? skip (server dedupe)
//     EXIF / video metadata, thumbnail + preview (BackupMedia)
//     new node key NK (wrapped by KEK) + file key FK (wrapped by NK), chunks sealed with HKDF(FK, blob) and uploaded
//     (resumable: the upload in progress is remembered sealed and continued by the next run)
//     revision + node envelopes, commit into the "Fotos" folder with this device id
//     → the checkpoint moves only after the photo is stored (or skipped for good)
//   backup.report (running / idle + success / error) with the encrypted device name
//
// Stops cleanly (checkpoint + upload state kept) when WorkManager stops the worker, the time budget is used up,
// the Wi-Fi-only rule no longer holds, the account is full or a daily limit is reached. A refused session refresh
// or a removed device wipes the stored keys and asks (notification) to open the app.
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.ParcelFileDescriptor;
import android.util.Log;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

final class BackupEngine {
    static final String TAG = BackupStore.TAG;

    /** What the worker reports back to WorkManager. */
    enum Result { DONE, MORE, RETRY, STOPPED, SIGNED_OUT, NOT_ARMED, BUSY }

    interface Host {
        boolean stopped();
        /** Ask for a foreground service (dataSync) with the progress notification; false when Android refuses. */
        boolean foreground(int done, int total);
    }

    /** Live progress for the app (FaleBackupPlugin forwards it to the web app). */
    interface Listener { void progress(JSONObject state); }
    static volatile Listener listener;
    static volatile JSONObject live = new JSONObject();

    private static final class Stop extends Exception {
        final String reason;
        final boolean retry;
        Stop(String reason, boolean retry) { super(reason); this.reason = reason; this.retry = retry; }
    }

    private final Context c;
    private final Host host;
    private final String src;
    private final boolean allowMetered;
    private long deadline;
    static final long FG_BUDGET = 45 * 60 * 1000L; // with a foreground service (Android 15 caps dataSync at 6 h a day)
    private JSONObject sec;
    private String user;
    private BackupStore.Prefs prefs;
    private BackupApi.Drive api;
    private byte[] kek, dk, dvk;
    private int chunkSize = 1048576;
    private long maxFileBytes = Long.MAX_VALUE;
    private int done, total, saved, skipped, unreadable;
    private boolean fg, notified;

    private BackupEngine(Context c, Host host, String src, boolean allowMetered, long budgetMs) {
        this.c = c.getApplicationContext();
        this.host = host;
        this.src = src;
        this.allowMetered = allowMetered;
        this.deadline = System.currentTimeMillis() + budgetMs;
    }

    static Result run(Context c, Host host, String src, boolean allowMetered, long budgetMs) {
        return new BackupEngine(c, host, src, allowMetered, budgetMs).run();
    }

    // ---------------------------------------------------------------- progress
    private void publish(boolean running, String stopped) {
        try {
            JSONObject s = new JSONObject();
            s.put("running", running);
            s.put("done", done);
            s.put("total", total);
            s.put("saved", saved);
            s.put("src", src);
            if (stopped != null) s.put("stopped", stopped);
            live = s;
            Listener l = listener;
            if (l != null) l.progress(s);
        } catch (Exception ignored) { /* UI only */ }
    }
    private void finishStatus(String stopped, boolean ok) {
        try {
            JSONObject st = BackupStore.status(c, user);
            long now = System.currentTimeMillis();
            st.put("lastRun", now);
            if (ok) st.put("lastOk", now);
            st.put("saved", saved);
            st.put("skipped", skipped);
            st.put("unreadable", unreadable);
            st.put("total", st.optLong("total", 0) + saved);
            if (stopped == null) st.remove("stopped"); else st.put("stopped", stopped);
            st.put("src", src);
            BackupStore.setStatus(c, user, st);
        } catch (Exception ignored) { /* status only */ }
    }

    private boolean metered() {
        try {
            ConnectivityManager cm = (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
            Network n = cm == null ? null : cm.getActiveNetwork();
            NetworkCapabilities caps = n == null ? null : cm.getNetworkCapabilities(n);
            if (caps == null) return false; // unknown → like the app: allowed (the job constraint already waited for the right network)
            return !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED);
        } catch (Exception e) {
            return false;
        }
    }

    // ---------------------------------------------------------------- the run
    private Result run() {
        sec = BackupStore.loadSecret(c);
        if (sec == null) { BackupScheduler.cancelAll(c); return Result.NOT_ARMED; }
        user = sec.optString("userId");
        prefs = BackupStore.loadPrefs(c);
        if (!prefs.on || !user.equals(prefs.user)) { BackupScheduler.cancelAll(c); return Result.STOPPED; }
        String lock = BackupLock.acquire(src, Math.max(60000L, deadline - System.currentTimeMillis()) + 120000L);
        if (lock == null) { Log.i(TAG, "run (" + src + "): another run is active (" + BackupLock.holder() + ")"); return Result.BUSY; }
        String stopped = null;
        Result result = Result.DONE;
        try {
            kek = FaleCrypto.unb64u(sec.optString("kek"));
            dk = FaleCrypto.unb64u(sec.optString("dk"));
            dvk = FaleCrypto.unb64u(sec.optString("dvk"));
            api = new BackupApi.Drive(c, sec);
            Log.i(TAG, "run (" + src + ") start");
            publish(true, null);
            if (!BackupMedia.canRead(c)) throw new Stop("perm", false);
            if (prefs.wifiOnly && !allowMetered && metered()) throw new Stop("wifi", false);
            touchDevice();
            JSONObject q = api.call("quota", new JSONObject().put("detail", false));
            chunkSize = q.optInt("chunkSize", chunkSize);
            JSONObject lim = q.optJSONObject("limits");
            if (lim != null && lim.optLong("maxFileBytes", 0) > 0) maxFileBytes = lim.optLong("maxFileBytes");
            if (q.optBoolean("readOnly", false)) throw new Stop("full", false);
            String[] kinds = prefs.videos && BackupMedia.videoGranted(c) ? new String[] { "image", "video" } : new String[] { "image" };
            for (String kind : kinds) { long[] cp = BackupStore.checkpoint(c, user, kind); total += BackupMedia.count(c, kind, cp[0], cp[1]); }
            publish(true, null);
            if (total == 0) {
                idleReport(false);
                Log.i(TAG, "run (" + src + "): nothing new");
                return result = Result.DONE;
            }
            fg = host.foreground(0, total);
            if (fg) { deadline = System.currentTimeMillis() + FG_BUDGET; BackupLock.renew(lock, FG_BUDGET + 120000L); }
            else { BackupNotify.showProgress(c, 0, total); notified = true; }
            report("running", total, null, false);
            for (String kind : kinds) {
                for (;;) {
                    long[] cp = BackupStore.checkpoint(c, user, kind);
                    List<BackupMedia.Item> items = BackupMedia.list(c, kind, cp[0], cp[1], 20);
                    if (items.isEmpty()) break;
                    for (BackupMedia.Item it : items) {
                        if (host.stopped()) throw new Stop("stopped", true);
                        if (System.currentTimeMillis() > deadline) throw new Stop("budget", true);
                        if (!BackupStore.armed(c)) throw new Stop("off", false);
                        if (prefs.wifiOnly && !allowMetered && metered()) throw new Stop("wifi", false);
                        String r = item(it);
                        if ("saved".equals(r)) saved++; else if ("dup".equals(r)) skipped++; else unreadable++;
                        BackupStore.setCheckpoint(c, user, kind, it.added, it.id);
                        done++;
                        publish(true, null);
                        if (fg) host.foreground(done, total); else BackupNotify.showProgress(c, done, total);
                    }
                }
            }
            report("idle", 0, null, true);
            Log.i(TAG, "run (" + src + ") done: " + saved + " saved, " + skipped + " already stored, " + unreadable + " skipped");
            return result = Result.DONE;
        } catch (Stop s) {
            if ("budget".equals(s.reason) || "stopped".equals(s.reason)) {
                Log.i(TAG, "run (" + src + ") paused (" + s.reason + ") after " + done + "/" + total);
                reportQuietly("running", Math.max(0, total - done), null);
                return result = Result.MORE;
            }
            stopped = s.reason;
            Log.i(TAG, "run (" + src + ") stopped: " + s.reason);
            reportQuietly("paused", Math.max(0, total - done), s.reason);
            return result = s.retry ? Result.RETRY : Result.STOPPED;
        } catch (BackupApi.SignedOut e) {
            stopped = "signin";
            signedOut();
            return result = Result.SIGNED_OUT;
        } catch (BackupApi.NotArmed e) {
            stopped = "off";
            return result = Result.NOT_ARMED;
        } catch (BackupApi.HttpError e) {
            stopped = stopReason(e);
            Log.i(TAG, "run (" + src + ") stopped: " + e.code + " (" + e.status + ")");
            reportQuietly(e.network() ? "paused" : "error", Math.max(0, total - done), e.network() ? null : e.code.replaceAll("[^a-z0-9_]", "").toLowerCase(java.util.Locale.ROOT));
            return result = e.network() || "limit".equals(stopped) ? Result.RETRY : Result.STOPPED;
        } catch (IOException e) {
            stopped = "network";
            Log.i(TAG, "run (" + src + ") network: " + e.getClass().getSimpleName());
            return result = Result.RETRY;
        } catch (Exception e) {
            stopped = "error";
            Log.w(TAG, "run (" + src + ") failed: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            reportQuietly("error", Math.max(0, total - done), "internal");
            return result = Result.RETRY;
        } finally {
            FaleCrypto.wipe(kek);
            FaleCrypto.wipe(dk);
            FaleCrypto.wipe(dvk);
            if (notified || fg) BackupNotify.cancelProgress(c);
            if (result != Result.BUSY && result != Result.NOT_ARMED && user != null) {
                boolean ok = result == Result.DONE;
                finishStatus(result == Result.MORE ? null : stopped, ok);
            }
            publish(false, result == Result.MORE ? null : stopped);
            BackupLock.release(lock);
        }
    }
    private static String stopReason(BackupApi.HttpError e) {
        if ("quota_exceeded".equals(e.code)) return "full";
        if ("drive_limit".equals(e.code) || "too_many_pending".equals(e.code)) return "limit";
        if (e.network()) return "network";
        return "error";
    }

    private void signedOut() {
        Log.i(TAG, "session gone: wiping the background backup keys");
        BackupStore.wipe(c, "signed out");
        BackupScheduler.cancelAll(c);
        BackupNotify.signInNeeded(c);
    }
    /** At most every 12 h: the FaLe-Konto device heartbeat. A removed device wipes its keys (like the web app). */
    private void touchDevice() throws Exception {
        long last = BackupStore.prefs(c).getLong("lastTouch", 0);
        if (System.currentTimeMillis() - last < 12 * 3600 * 1000L) return;
        boolean revoked;
        try { revoked = BackupApi.deviceRevoked(c, sec); } catch (IOException e) { return; } // unreachable: ask next time
        if (revoked) throw new BackupApi.SignedOut("device removed");
        BackupStore.prefs(c).edit().putLong("lastTouch", System.currentTimeMillis()).apply();
    }

    // ---------------------------------------------------------------- backup.report
    private String deviceMeta() throws Exception {
        JSONObject m = new JSONObject();
        m.put("v", 1);
        m.put("name", sec.optString("deviceName"));
        m.put("platform", "android");
        m.put("app", BackupApi.APP_VERSION);
        return FaleCrypto.sealDeviceMeta(dvk, user, sec.optString("deviceId"), m.toString());
    }
    private void report(String status, int pending, String error, boolean success) throws Exception {
        JSONObject b = new JSONObject();
        b.put("deviceId", sec.optString("deviceId"));
        b.put("status", status);
        b.put("pending", pending);
        if (success) b.put("success", true);
        if (error != null && !error.isEmpty()) b.put("error", error.length() > 40 ? error.substring(0, 40) : error);
        b.put("meta", deviceMeta());
        api.call("backup.report", b);
        if (success) BackupStore.prefs(c).edit().putLong("lastIdleReport", System.currentTimeMillis()).apply();
    }
    private void reportQuietly(String status, int pending, String error) {
        try { report(status, pending, error, false); } catch (Exception ignored) { /* best effort */ }
    }
    /** Nothing to do: tell the server this device is up to date (at most hourly – keeps "last backup" fresh). */
    private void idleReport(boolean force) throws Exception {
        long last = BackupStore.prefs(c).getLong("lastIdleReport", 0);
        if (!force && System.currentTimeMillis() - last < 3600 * 1000L) return;
        report("idle", 0, null, true);
    }

    // ---------------------------------------------------------------- one photo / video
    /** Positional reads of the original (MediaStore files are local and seekable). */
    private static final class Source implements AutoCloseable {
        final ParcelFileDescriptor pfd;
        final FileInputStream in;
        final FileChannel ch;
        final long size;
        Source(ParcelFileDescriptor pfd) {
            this.pfd = pfd;
            this.in = new FileInputStream(pfd.getFileDescriptor());
            this.ch = in.getChannel();
            long s = pfd.getStatSize();
            long cs;
            try { cs = ch.size(); } catch (IOException e) { cs = -1; }
            this.size = s >= 0 ? s : cs;
        }
        void read(long pos, byte[] buf, int len) throws IOException {
            ByteBuffer bb = ByteBuffer.wrap(buf, 0, len);
            while (bb.hasRemaining()) {
                int n = ch.read(bb, pos + bb.position());
                if (n < 0) throw new IOException("short read");
            }
        }
        @Override public void close() {
            try { in.close(); } catch (IOException ignored) { /* closed */ }
            try { pfd.close(); } catch (IOException ignored) { /* closed */ }
        }
    }
    private ParcelFileDescriptor openFd(BackupMedia.Item it) throws FileNotFoundException {
        try {
            return c.getContentResolver().openFileDescriptor(it.uri, "r");
        } catch (SecurityException | UnsupportedOperationException e) {
            // no ACCESS_MEDIA_LOCATION: Android hands out the photo without GPS (the app path does the same)
            return c.getContentResolver().openFileDescriptor(it.plainUri, "r");
        }
    }

    /** → "saved" | "dup" | "skip" */
    private String item(BackupMedia.Item it) throws Exception {
        String mime = BackupMedia.mimeOf(it.name, it.mime);
        if (!BackupMedia.isMedia(mime)) return "skip";
        ParcelFileDescriptor pfd;
        try { pfd = openFd(it); } catch (FileNotFoundException | SecurityException e) { return "skip"; }
        if (pfd == null) return "skip";
        try (Source s = new Source(pfd)) {
            if (s.size <= 0) return "skip";
            if (s.size > maxFileBytes) return "skip";
            return upload(it, s, mime);
        }
    }

    private String upload(BackupMedia.Item it, Source s, String mime) throws Exception {
        // resume the upload of an earlier run when it is the same photo
        JSONObject inf = BackupStore.loadInflight(c);
        if (inf != null && !(inf.optLong("mediaId") == it.id && inf.optString("kind").equals(it.kind) && inf.optLong("size") == s.size
            && inf.optLong("modified") == it.modified && user.equals(inf.optString("user")))) {
            abortQuietly(inf);
            BackupStore.clearInflight(c);
            inf = null;
        }
        String hash, digestHex;
        if (inf != null) {
            hash = inf.optString("hash");
            digestHex = inf.optString("digest");
        } else {
            FaleCrypto.Digest d = new FaleCrypto.Digest();
            byte[] buf = new byte[256 * 1024];
            for (long pos = 0; pos < s.size; ) {
                if (host.stopped()) throw new Stop("stopped", true);
                int n = (int) Math.min(buf.length, s.size - pos);
                s.read(pos, buf, n);
                d.update(buf, 0, n);
                pos += n;
            }
            byte[] digest = d.finish();
            digestHex = FaleCrypto.hex(digest);
            hash = FaleCrypto.dedupeHash(dk, digest);
            JSONObject dd = api.call("dedupe", new JSONObject().put("hashes", new JSONArray().put(hash)));
            JSONObject m = dd.optJSONObject("matches");
            JSONArray hit = m == null ? null : m.optJSONArray(hash);
            if (hit != null && hit.length() > 0) return "dup";
        }

        // metadata + derivatives (cheap to redo on resume; the revision envelope is only written at commit)
        JSONObject meta = new JSONObject();
        BackupMedia.Derived der;
        boolean video = mime.startsWith("video/");
        if (video) {
            der = BackupMedia.video(c, it.uri, meta);
        } else {
            int orientation = 0;
            try (java.io.InputStream in = c.getContentResolver().openInputStream(it.uri)) {
                if (in != null) orientation = BackupMedia.exifInto(new android.media.ExifInterface(in), meta);
            } catch (Exception e) { /* no EXIF */ }
            der = BackupMedia.image(c, it.uri, mime, s.size, orientation);
            if (der == null) meta.put("noPreview", true);
        }
        if (der != null) {
            meta.put("w", der.w);
            meta.put("h", der.h);
            if (der.durationMs > 0) meta.put("durationMs", der.durationMs);
        }
        if (!meta.has("takenAt")) meta.put("takenAt", BackupMedia.fallbackTakenAt(it.taken));

        // keys: new node + file key (or the ones of the upload being resumed)
        String nodeId, revId, wrappedNK, wrappedFK;
        byte[] nk, fk;
        if (inf != null) {
            nodeId = inf.optString("nodeId"); revId = inf.optString("revId");
            wrappedNK = inf.optString("nk"); wrappedFK = inf.optString("fk");
            nk = FaleCrypto.openNodeKey(kek, user, nodeId, wrappedNK);
            fk = FaleCrypto.openFileKey(nk, user, nodeId, revId, wrappedFK);
        } else {
            nodeId = FaleCrypto.uuid(); revId = FaleCrypto.uuid();
            FaleCrypto.Wrapped n = FaleCrypto.createNodeKey(kek, user, nodeId);
            FaleCrypto.Wrapped f = FaleCrypto.createFileKey(n.raw, user, nodeId, revId);
            nk = n.raw; fk = f.raw; wrappedNK = n.wrapped; wrappedFK = f.wrapped;
            inf = new JSONObject();
            inf.put("user", user); inf.put("mediaId", it.id); inf.put("kind", it.kind); inf.put("size", s.size); inf.put("modified", it.modified);
            inf.put("nodeId", nodeId); inf.put("revId", revId); inf.put("nk", wrappedNK); inf.put("fk", wrappedFK);
            inf.put("hash", hash); inf.put("digest", digestHex);
        }
        try {
            String content = putBlob(inf, "content", s, null, fk, nodeId, revId, hash);
            String thumb = der != null && der.thumb != null ? putBlob(inf, "thumb", null, der.thumb.bytes, fk, nodeId, revId, null) : null;
            String preview = der != null && der.preview != null ? putBlob(inf, "preview", null, der.preview.bytes, fk, nodeId, revId, null) : null;
            if (host.stopped()) throw new Stop("stopped", true);

            JSONObject rmeta = new JSONObject();
            rmeta.put("v", 1);
            rmeta.put("size", s.size);
            rmeta.put("mime", mime);
            rmeta.put("mtime", it.taken);
            rmeta.put("digest", digestHex);
            if (thumb != null) rmeta.put("thumb", new JSONObject().put("mime", "image/jpeg").put("w", der.thumb.w).put("h", der.thumb.h));
            if (preview != null) rmeta.put("preview", new JSONObject().put("mime", "image/jpeg").put("w", der.preview.w).put("h", der.preview.h));
            JSONObject nmeta = new JSONObject();
            nmeta.put("v", 1);
            nmeta.put("name", it.name);
            for (java.util.Iterator<String> k = meta.keys(); k.hasNext(); ) { String key = k.next(); nmeta.put(key, meta.get(key)); }

            JSONObject commit = new JSONObject();
            commit.put("nodeId", nodeId);
            commit.put("kind", "photo");
            commit.put("baseVersion", 0);
            commit.put("key", wrappedNK);
            commit.put("meta", FaleCrypto.sealMeta(nk, "photo", user, nodeId, nmeta.toString()));
            commit.put("rev", new JSONObject().put("id", revId).put("key", wrappedFK).put("meta", FaleCrypto.sealRevMeta(fk, user, nodeId, revId, rmeta.toString())).put("hash", hash));
            commit.put("content", content);
            if (thumb != null) commit.put("thumb", thumb);
            if (preview != null) commit.put("preview", preview);
            commit.put("deviceId", sec.optString("deviceId"));
            commitInto(commit);
            BackupStore.clearInflight(c);
            return "saved";
        } catch (BackupApi.HttpError e) {
            if ("too_large".equals(e.code) || "bad_size".equals(e.code) || "bad_input".equals(e.code)) {
                Log.w(TAG, "photo skipped for good: " + e.code);
                abortQuietly(inf);
                BackupStore.clearInflight(c);
                return "skip";
            }
            if ("no_upload".equals(e.code)) { abortQuietly(inf); BackupStore.clearInflight(c); } // expired: start over next time
            throw e;
        } finally {
            FaleCrypto.wipe(nk);
            FaleCrypto.wipe(fk);
        }
    }

    /** Commit into the photos folder; a deleted/trashed folder is replaced by a new one (role "photos"). */
    private void commitInto(JSONObject commit) throws Exception {
        for (int attempt = 0; attempt < 2; attempt++) {
            String parent = photosFolder(attempt > 0);
            commit.put("parentId", parent == null ? JSONObject.NULL : parent);
            try {
                api.call("commit", commit);
                return;
            } catch (BackupApi.HttpError e) {
                if ("exists".equals(e.code)) return; // an earlier commit of this very node went through (response lost)
                if ("bad_parent".equals(e.code) && attempt == 0) continue;
                throw e;
            }
        }
    }
    private String photosFolder(boolean fresh) throws Exception {
        String id = sec.optString("photosFolderId", "");
        if (!fresh && !id.isEmpty()) return id;
        String nodeId = FaleCrypto.uuid();
        FaleCrypto.Wrapped nk = FaleCrypto.createNodeKey(kek, user, nodeId);
        try {
            JSONObject meta = new JSONObject().put("v", 1).put("name", sec.optString("folderName", "Fotos")).put("role", "photos");
            api.call("mkdir", new JSONObject().put("nodeId", nodeId).put("parentId", JSONObject.NULL).put("key", nk.wrapped)
                .put("meta", FaleCrypto.sealMeta(nk.raw, "folder", user, nodeId, meta.toString())));
        } finally {
            FaleCrypto.wipe(nk.raw);
        }
        synchronized (BackupStore.LOCK) {
            JSONObject cur = BackupStore.loadSecret(c);
            if (cur != null) { cur.put("photosFolderId", nodeId); BackupStore.saveSecret(c, cur); }
        }
        sec.put("photosFolderId", nodeId);
        return nodeId;
    }

    private void abortQuietly(JSONObject inf) {
        if (inf == null) return;
        JSONObject up = inf.optJSONObject("up");
        if (up == null) return;
        for (java.util.Iterator<String> k = up.keys(); k.hasNext(); ) {
            try { api.call("upload.abort", new JSONObject().put("uploadId", up.optString(k.next()))); } catch (Exception ignored) { /* expires anyway */ }
        }
    }

    /** Encrypt + upload one blob (resumable for the content). → upload id */
    private String putBlob(JSONObject inf, String purpose, Source src, byte[] data, byte[] fk, String nodeId, String revId, String hash) throws Exception {
        long size = src != null ? src.size : data.length;
        long[] lay = FaleCrypto.layout(size, chunkSize);
        long chunks = lay[0], plainChunk = lay[1], cipherSize = lay[2];
        JSONObject up = inf.optJSONObject("up");
        if (up == null) { up = new JSONObject(); inf.put("up", up); }
        String uploadId = up.optString(purpose, "");
        java.util.Set<Long> received = new java.util.HashSet<>();
        boolean direct = false;
        if (!uploadId.isEmpty()) {
            try {
                JSONObject st = api.call("upload.status", new JSONObject().put("uploadId", uploadId));
                if (!"pending".equals(st.optString("status")) || st.optBoolean("expired") || st.optLong("chunks") != chunks || st.optLong("size") != cipherSize) uploadId = "";
                else {
                    JSONArray rec = st.optJSONArray("received");
                    if (rec != null) for (int i = 0; i < rec.length(); i++) received.add(rec.optLong(i));
                    direct = "s3".equals(st.optString("backend"));
                }
            } catch (BackupApi.HttpError e) {
                if (e.status == 404) uploadId = ""; else throw e;
            }
        }
        if (uploadId.isEmpty()) {
            JSONObject b = new JSONObject().put("purpose", purpose).put("size", cipherSize).put("chunks", chunks);
            if (hash != null) b.put("hash", hash);
            JSONObject r = api.call("upload.create", b);
            uploadId = r.optString("uploadId");
            direct = r.optBoolean("direct", false);
            up.put(purpose, uploadId);
            if ("content".equals(purpose)) BackupStore.saveInflight(c, inf); // resume point
        }
        FaleCrypto.Ctx ctx = new FaleCrypto.Ctx(user, nodeId, revId, uploadId, purpose);
        byte[] bk = FaleCrypto.blobKey(fk, uploadId, purpose);
        java.util.Map<Long, JSONObject> urls = new java.util.HashMap<>();
        byte[] buf = src != null ? new byte[(int) Math.min(plainChunk, size)] : null;
        try {
            for (long i = 0; i < chunks; i++) {
                if (received.contains(i)) continue;
                if (host.stopped()) throw new Stop("stopped", true);
                long off = i * plainChunk;
                int len = (int) Math.min(plainChunk, size - off);
                byte[] sealed;
                if (src != null) {
                    src.read(off, buf, len);
                    sealed = FaleCrypto.sealChunk(bk, ctx, i, chunks, buf, 0, len);
                } else {
                    sealed = FaleCrypto.sealChunk(bk, ctx, i, chunks, data, (int) off, len);
                }
                if (direct) {
                    if (!urls.containsKey(i)) {
                        JSONObject r = api.call("upload.urls", new JSONObject().put("uploadId", uploadId).put("from", i).put("count", 100));
                        JSONArray list = r.optJSONArray("urls");
                        if (list != null) for (int k = 0; k < list.length(); k++) { JSONObject u = list.optJSONObject(k); urls.put(u.optLong("i"), u); }
                    }
                    JSONObject u = urls.get(i);
                    if (u == null) throw new BackupApi.HttpError(502, "storage_upload_failed", null);
                    api.putUrl(u, sealed);
                } else {
                    api.putChunk(uploadId, i, sealed);
                }
            }
        } finally {
            FaleCrypto.wipe(bk);
            if (buf != null) FaleCrypto.wipe(buf);
        }
        return uploadId;
    }
}
