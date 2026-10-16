package dev.fale.one;

// When the background backup runs (WorkManager, all work in this app's process):
//
//   periodic  every 6 h (flex 1 h) – the safety net; also keeps the device's "last backup" fresh on the server
//   trigger   one-time work with content-URI triggers on MediaStore images (+ videos when on): runs shortly after
//             new photos appear; re-arms itself as an appended follow-up (content triggers fire once)
//   run       one-time: "Jetzt sichern" / app start (expedited when possible) and the continuation of a run that
//             hit its time budget
// Constraints: network (unmetered when "Nur im WLAN" is on) and battery not low (not for expedited work, which
// Android only allows with a network constraint). Every worker type runs the same BackupEngine behind the
// single-writer BackupLock, so overlapping triggers never upload twice. The switch off (or a wipe) cancels all.
import android.content.Context;
import android.os.Build;
import android.provider.MediaStore;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.OutOfQuotaPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkInfo;
import androidx.work.WorkManager;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

final class BackupScheduler {
    static final String PERIODIC = "fale-one-backup-periodic", TRIGGER = "fale-one-backup-trigger", RUN = "fale-one-backup-run";
    static final String TAG_ALL = "fale-one-backup";

    private BackupScheduler() {}

    private static Constraints constraints(BackupStore.Prefs p, boolean batteryNotLow, boolean allowMetered) {
        Constraints.Builder b = new Constraints.Builder()
            .setRequiredNetworkType(p.wifiOnly && !allowMetered ? NetworkType.UNMETERED : NetworkType.CONNECTED);
        if (batteryNotLow) b.setRequiresBatteryNotLow(true);
        return b.build();
    }
    private static Data src(String s, boolean metered) { return new Data.Builder().putString("src", s).putBoolean("metered", metered).build(); }

    private static OneTimeWorkRequest triggerRequest(BackupStore.Prefs p) {
        Constraints.Builder cb = new Constraints.Builder()
            .setRequiredNetworkType(p.wifiOnly ? NetworkType.UNMETERED : NetworkType.CONNECTED)
            .setRequiresBatteryNotLow(true);
        if (Build.VERSION.SDK_INT >= 24) {
            cb.addContentUriTrigger(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true);
            if (p.videos) cb.addContentUriTrigger(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, true);
            cb.setTriggerContentUpdateDelay(30, TimeUnit.SECONDS);
            cb.setTriggerContentMaxDelay(5, TimeUnit.MINUTES);
        }
        return new OneTimeWorkRequest.Builder(BackupWorker.class)
            .setConstraints(cb.build())
            .setInputData(src("trigger", false))
            .addTag(TAG_ALL)
            .build();
    }

    /** Apply switch + options: schedule everything (replace = options changed) or cancel everything. */
    static void apply(Context c, boolean replace) {
        BackupStore.Prefs p = BackupStore.loadPrefs(c);
        WorkManager wm = WorkManager.getInstance(c);
        if (!p.on || !BackupStore.armed(c)) {
            cancelAll(c);
            return;
        }
        PeriodicWorkRequest per = new PeriodicWorkRequest.Builder(BackupWorker.class, 6, TimeUnit.HOURS, 1, TimeUnit.HOURS)
            .setConstraints(constraints(p, true, false))
            .setInputData(src("periodic", false))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 5, TimeUnit.MINUTES)
            .addTag(TAG_ALL)
            .build();
        wm.enqueueUniquePeriodicWork(PERIODIC, replace ? ExistingPeriodicWorkPolicy.UPDATE : ExistingPeriodicWorkPolicy.KEEP, per);
        if (Build.VERSION.SDK_INT >= 24) wm.enqueueUniqueWork(TRIGGER, replace ? ExistingWorkPolicy.REPLACE : ExistingWorkPolicy.KEEP, triggerRequest(p));
    }
    /** Inside a trigger run: the next content trigger, appended so it starts observing when this run ends. */
    static void rearmTrigger(Context c) {
        BackupStore.Prefs p = BackupStore.loadPrefs(c);
        if (!p.on || !BackupStore.armed(c) || Build.VERSION.SDK_INT < 24) return;
        WorkManager.getInstance(c).enqueueUniqueWork(TRIGGER, ExistingWorkPolicy.APPEND_OR_REPLACE, triggerRequest(p));
    }
    /** "Jetzt sichern" / app start: expedited when Android grants the quota, otherwise as normal work. */
    static void runNow(Context c, boolean allowMetered) {
        BackupStore.Prefs p = BackupStore.loadPrefs(c);
        if (!BackupStore.armed(c)) return;
        OneTimeWorkRequest r = new OneTimeWorkRequest.Builder(BackupWorker.class)
            .setConstraints(constraints(p, false, allowMetered))
            .setInputData(src("run", allowMetered))
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
            .addTag(TAG_ALL)
            .build();
        WorkManager.getInstance(c).enqueueUniqueWork(RUN, ExistingWorkPolicy.KEEP, r);
    }
    /** A run hit its time budget: continue as soon as the constraints allow (after the current run). */
    static void continueSoon(Context c, boolean allowMetered) {
        BackupStore.Prefs p = BackupStore.loadPrefs(c);
        if (!p.on || !BackupStore.armed(c)) return;
        OneTimeWorkRequest r = new OneTimeWorkRequest.Builder(BackupWorker.class)
            .setConstraints(constraints(p, true, allowMetered))
            .setInputData(src("run", allowMetered))
            .setInitialDelay(15, TimeUnit.SECONDS)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
            .addTag(TAG_ALL)
            .build();
        WorkManager.getInstance(c).enqueueUniqueWork(RUN, ExistingWorkPolicy.APPEND_OR_REPLACE, r);
    }
    static void cancelAll(Context c) {
        WorkManager wm = WorkManager.getInstance(c);
        wm.cancelUniqueWork(PERIODIC);
        wm.cancelUniqueWork(TRIGGER);
        wm.cancelUniqueWork(RUN);
        wm.cancelAllWorkByTag(TAG_ALL);
    }

    /** {periodic, trigger, run}: the state of each unique work ("ENQUEUED", "RUNNING", … or "NONE"). Blocking. */
    static JSONObject states(Context c) {
        JSONObject o = new JSONObject();
        WorkManager wm = WorkManager.getInstance(c);
        for (String[] w : new String[][] { { "periodic", PERIODIC }, { "trigger", TRIGGER }, { "run", RUN } }) {
            String st = "NONE";
            try {
                List<WorkInfo> list = wm.getWorkInfosForUniqueWork(w[1]).get(5, TimeUnit.SECONDS);
                for (WorkInfo i : list) {
                    if (!i.getState().isFinished()) { st = i.getState().name(); break; }
                    st = i.getState().name();
                }
            } catch (Exception e) {
                st = "UNKNOWN";
            }
            try { o.put(w[0], st); } catch (Exception ignored) { /* never */ }
        }
        return o;
    }
}
