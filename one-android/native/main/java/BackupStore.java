package dev.fale.one;

// State of the background photo backup on this device.
//
//   secret    what a run needs while nobody uses the app: user id, device id, the account keys KEK / DK / DVK
//             (derived from the master key by the web app – the master key itself never leaves the WebView),
//             the FaLe-Konto session (refresh + access token) and the API endpoints. Sealed with a
//             non-exportable AES-256-GCM key in the Android Keystore and stored in noBackupFilesDir (never part of
//             Android backups; the app also sets allowBackup=false). Wiped on sign-out, when the switch is turned
//             off, when the device was removed and when the session cannot be refreshed any more.
//   inflight  the upload that is in progress (ids, KEK-wrapped keys, upload id, hash) so the next run resumes
//             it – sealed the same way. No plaintext.
//   prefs     switch + options, checkpoints (date_added, _id) per kind, status of the last run – SharedPreferences
//             (not secret; excluded from backups by the data extraction rules).
// Never logs keys or tokens.
import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Log;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.Key;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

final class BackupStore {
    static final String TAG = "FaleBackup";
    /** One lock for secret file, inflight file and token refresh (plugin threads + workers in one process). */
    static final Object LOCK = new Object();
    private static final String ALIAS = "fale-one-backup-v1";
    private static final byte[] AAD = "fale-one-bg|v1".getBytes(StandardCharsets.UTF_8);
    private static final String SECRET = "fale-one-bg-secret.bin";
    private static final String INFLIGHT = "fale-one-bg-inflight.bin";
    private static final String PREFS = "fale_one_backup";

    private BackupStore() {}

    static SharedPreferences prefs(Context c) { return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    // ---------------------------------------------------------------- Keystore sealing
    private static SecretKey keystoreKey(boolean create) throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        Key k = ks.getKey(ALIAS, null);
        if (k instanceof SecretKey) return (SecretKey) k;
        if (!create) return null;
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true)
            // backups run while the phone is locked (at night, charging): no user authentication, no unlocked-device binding
            .setUserAuthenticationRequired(false)
            .build());
        return kg.generateKey();
    }
    private static void deleteKeystoreKey() {
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS);
        } catch (Exception e) {
            Log.w(TAG, "keystore delete failed: " + e.getClass().getSimpleName());
        }
    }
    /** 0x01 ‖ ivLen ‖ IV ‖ AES-GCM(plain) */
    private static byte[] seal(byte[] plain) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, keystoreKey(true));
        byte[] iv = c.getIV();
        c.updateAAD(AAD);
        byte[] ct = c.doFinal(plain);
        byte[] out = new byte[2 + iv.length + ct.length];
        out[0] = 1;
        out[1] = (byte) iv.length;
        System.arraycopy(iv, 0, out, 2, iv.length);
        System.arraycopy(ct, 0, out, 2 + iv.length, ct.length);
        return out;
    }
    private static byte[] unseal(byte[] sealed) throws Exception {
        SecretKey k = keystoreKey(false);
        if (k == null || sealed.length < 2 || sealed[0] != 1) return null;
        int ivLen = sealed[1] & 255;
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, k, new GCMParameterSpec(128, Arrays.copyOfRange(sealed, 2, 2 + ivLen)));
        c.updateAAD(AAD);
        return c.doFinal(sealed, 2 + ivLen, sealed.length - 2 - ivLen);
    }

    private static File file(Context c, String name) { return new File(c.getApplicationContext().getNoBackupFilesDir(), name); }
    private static void writeSealed(Context c, String name, JSONObject o) throws Exception {
        byte[] plain = o.toString().getBytes(StandardCharsets.UTF_8);
        byte[] sealed;
        try { sealed = seal(plain); } finally { Arrays.fill(plain, (byte) 0); }
        File f = file(c, name), tmp = file(c, name + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(sealed);
            out.getFD().sync();
        }
        if (!tmp.renameTo(f)) throw new IOException("rename failed");
    }
    private static JSONObject readSealed(Context c, String name) {
        File f = file(c, name);
        if (!f.exists()) return null;
        byte[] plain = null;
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[(int) f.length()];
            int off = 0;
            while (off < buf.length) { int n = in.read(buf, off, buf.length - off); if (n < 0) break; off += n; }
            plain = unseal(buf);
            if (plain == null) { f.delete(); return null; }
            return new JSONObject(new String(plain, StandardCharsets.UTF_8));
        } catch (Exception e) {
            // key gone (wiped / restored to another device) or file damaged: the data is useless, start over
            Log.w(TAG, "sealed state unreadable (" + name + "): " + e.getClass().getSimpleName());
            f.delete();
            return null;
        } finally {
            if (plain != null) Arrays.fill(plain, (byte) 0);
        }
    }

    // ---------------------------------------------------------------- secret (keys + session)
    static boolean armed(Context c) { return file(c, SECRET).exists(); }
    static JSONObject loadSecret(Context c) { synchronized (LOCK) { return readSealed(c, SECRET); } }
    static void saveSecret(Context c, JSONObject s) throws Exception { synchronized (LOCK) { writeSealed(c, SECRET, s); } }
    /** Sign-out, switch off, device removed, session gone: delete keys, tokens and the upload in progress at once. */
    static void wipe(Context c, String reason) {
        synchronized (LOCK) {
            file(c, SECRET).delete();
            file(c, SECRET + ".tmp").delete();
            file(c, INFLIGHT).delete();
            file(c, INFLIGHT + ".tmp").delete();
            deleteKeystoreKey(); // old sealed copies (if a delete failed) can never be opened again
            prefs(c).edit().remove("lastTouch").remove("lastIdleReport").apply();
        }
        Log.i(TAG, "wiped (" + reason + ")");
    }

    // ---------------------------------------------------------------- upload in progress
    static JSONObject loadInflight(Context c) { synchronized (LOCK) { return readSealed(c, INFLIGHT); } }
    static void saveInflight(Context c, JSONObject o) {
        synchronized (LOCK) {
            try { writeSealed(c, INFLIGHT, o); } catch (Exception e) { Log.w(TAG, "inflight not saved: " + e.getClass().getSimpleName()); }
        }
    }
    static void clearInflight(Context c) { synchronized (LOCK) { file(c, INFLIGHT).delete(); } }

    // ---------------------------------------------------------------- prefs (per account)
    static final class Prefs {
        String user;
        boolean on, videos, wifiOnly = true;
        String lang = "de";
    }
    static Prefs loadPrefs(Context c) {
        SharedPreferences p = prefs(c);
        Prefs r = new Prefs();
        r.user = p.getString("user", null);
        r.on = p.getBoolean("on", false);
        r.videos = p.getBoolean("videos", false);
        r.wifiOnly = p.getBoolean("wifiOnly", true);
        r.lang = p.getString("lang", "de");
        return r;
    }
    /** Switch the account the prefs belong to: another account starts with the defaults (off). */
    static Prefs prefsFor(Context c, String user) {
        Prefs r = loadPrefs(c);
        if (user != null && !user.equals(r.user)) {
            prefs(c).edit().putString("user", user).putBoolean("on", false).putBoolean("videos", false).putBoolean("wifiOnly", true).apply();
            r = loadPrefs(c);
        }
        return r;
    }
    static void savePrefs(Context c, Prefs r) {
        prefs(c).edit().putString("user", r.user).putBoolean("on", r.on).putBoolean("videos", r.videos).putBoolean("wifiOnly", r.wifiOnly)
            .putString("lang", "en".equals(r.lang) ? "en" : "de").apply();
    }

    // ---------------------------------------------------------------- checkpoints (shared by the app run and the workers)
    /** {since (date_added s), afterId (_id)} after which photos still need a backup. */
    static long[] checkpoint(Context c, String user, String kind) {
        SharedPreferences p = prefs(c);
        String k = "cp." + user + "." + kind;
        return new long[] { p.getLong(k + ".since", 0L), p.getLong(k + ".after", 0L) };
    }
    static void setCheckpoint(Context c, String user, String kind, long since, long afterId) {
        String k = "cp." + user + "." + kind;
        long[] cur = checkpoint(c, user, kind);
        // never move backwards (two writers after each other: the later item wins)
        if (since < cur[0] || (since == cur[0] && afterId < cur[1])) return;
        prefs(c).edit().putLong(k + ".since", since).putLong(k + ".after", afterId).apply();
    }
    static void resetCheckpoints(Context c, String user) {
        prefs(c).edit().remove("cp." + user + ".image.since").remove("cp." + user + ".image.after")
            .remove("cp." + user + ".video.since").remove("cp." + user + ".video.after").apply();
    }

    // ---------------------------------------------------------------- status of the last run (shown in the app)
    static JSONObject status(Context c, String user) {
        try { return new JSONObject(prefs(c).getString("status." + user, "{}")); } catch (Exception e) { return new JSONObject(); }
    }
    static void setStatus(Context c, String user, JSONObject s) { prefs(c).edit().putString("status." + user, s.toString()).apply(); }
}
