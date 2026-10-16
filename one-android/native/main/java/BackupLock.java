package dev.fale.one;

// Single-writer lock for the photo backup: at most one run (periodic job, new-photo trigger, "Jetzt sichern",
// or the in-app fallback run of native.js) uploads at a time, so the same photo is never uploaded twice
// concurrently. The app and all WorkManager workers run in this one process, so an in-memory lease is enough;
// it expires by itself if the holder dies without releasing it (crash inside a run, killed WebView).
// The server-side dedupe by keyed hash stays the last line of defence.
import java.util.UUID;

final class BackupLock {
    private static String token, owner;
    private static long until;

    private BackupLock() {}

    static synchronized String acquire(String who, long ttlMs) {
        long now = System.currentTimeMillis();
        if (token != null && now < until) return null;
        token = UUID.randomUUID().toString();
        owner = who;
        until = now + ttlMs;
        return token;
    }
    static synchronized boolean renew(String t, long ttlMs) {
        if (t == null || !t.equals(token)) return false;
        until = System.currentTimeMillis() + ttlMs;
        return true;
    }
    static synchronized void release(String t) {
        if (t != null && t.equals(token)) { token = null; owner = null; until = 0; }
    }
    /** Who holds it right now ("app", "periodic", "trigger", "run") or null. */
    static synchronized String holder() { return token != null && System.currentTimeMillis() < until ? owner : null; }
}
