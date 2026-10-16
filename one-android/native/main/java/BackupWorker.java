package dev.fale.one;

// WorkManager worker of the background photo backup (scheduled by BackupScheduler). Runs BackupEngine on
// WorkManager's background thread. While an upload actually runs it asks for a foreground service of type
// dataSync with the small "FaLe One sichert Fotos …" notification; Android 12+ refuses that for jobs started in
// the background (unless the app is visible or exempt) – then the run continues as a normal job within Android's
// job time limit (~10 min) with an ordinary progress notification, and a follow-up run continues the rest.
import android.content.Context;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.work.ForegroundInfo;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

public class BackupWorker extends Worker {
    static final long BUDGET = 8 * 60 * 1000L; // inside JobScheduler's 10 minutes for normal jobs

    public BackupWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }

    static ForegroundInfo info(Context c, int done, int total) {
        if (Build.VERSION.SDK_INT >= 29) return new ForegroundInfo(BackupNotify.PROGRESS_ID, BackupNotify.progress(c, done, total), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        return new ForegroundInfo(BackupNotify.PROGRESS_ID, BackupNotify.progress(c, done, total));
    }

    /** Expedited work on Android < 12 runs as a foreground service and needs this. */
    @NonNull
    @Override
    public ForegroundInfo getForegroundInfo() { return info(getApplicationContext(), 0, 0); }

    @NonNull
    @Override
    public Result doWork() {
        final Context c = getApplicationContext();
        final String src = getInputData().getString("src") == null ? "run" : getInputData().getString("src");
        final boolean metered = getInputData().getBoolean("metered", false);
        if ("trigger".equals(src)) BackupScheduler.rearmTrigger(c);
        BackupEngine.Host host = new BackupEngine.Host() {
            boolean refused = false;
            @Override public boolean stopped() { return isStopped(); }
            @Override public boolean foreground(int done, int total) {
                if (refused) return false;
                try {
                    setForegroundAsync(info(c, done, total)).get();
                    return true;
                } catch (Throwable t) {
                    // ForegroundServiceStartNotAllowedException (Android 12+, started in the background) or no permission
                    refused = true;
                    Log.i(BackupStore.TAG, "no foreground service (" + t.getClass().getSimpleName() + ") – running as a normal job");
                    return false;
                }
            }
        };
        BackupEngine.Result r;
        try {
            r = BackupEngine.run(c, host, src, metered, BUDGET);
        } catch (Throwable t) {
            Log.w(BackupStore.TAG, "worker failed: " + t.getClass().getSimpleName());
            return Result.retry();
        }
        switch (r) {
            case MORE:
                if (!isStopped()) BackupScheduler.continueSoon(c, metered);
                else BackupScheduler.continueSoon(c, false);
                return Result.success();
            case RETRY:
                return getRunAttemptCount() < 8 ? Result.retry() : Result.success();
            default:
                return Result.success();
        }
    }
}
