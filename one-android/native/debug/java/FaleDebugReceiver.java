package dev.fale.one;

// DEBUG BUILDS ONLY: adb hooks for the emulator smoke test. Exported but protected by android.permission.DUMP,
// which only the shell (adb) holds:
//   am broadcast -n dev.fale.one/.FaleDebugReceiver -a dev.fale.one.debug.API --es api http://10.0.2.2:8787   (empty = off)
//   am broadcast -n dev.fale.one/.FaleDebugReceiver -a dev.fale.one.debug.RUN          enqueue a run now
//   am broadcast -n dev.fale.one/.FaleDebugReceiver -a dev.fale.one.debug.CHECKPOINT   forget the checkpoints
//   am broadcast -n dev.fale.one/.FaleDebugReceiver -a dev.fale.one.debug.STATE        log the state (no secrets)
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public class FaleDebugReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        final Context c = context.getApplicationContext();
        final String a = intent.getAction() == null ? "" : intent.getAction();
        final PendingResult pr = goAsync();
        new Thread(() -> {
            try {
                if (a.endsWith(".API")) {
                    String api = intent.getStringExtra("api");
                    c.getSharedPreferences("fale_debug", Context.MODE_PRIVATE).edit().putString("api", api == null || api.isEmpty() ? null : api).commit();
                    Log.i("FaleDebug", "api override = " + DebugHooks.apiOverride(c));
                } else if (a.endsWith(".RUN")) {
                    BackupScheduler.runNow(c, true);
                    Log.i("FaleDebug", "run enqueued");
                } else if (a.endsWith(".CHECKPOINT")) {
                    BackupStore.Prefs p = BackupStore.loadPrefs(c);
                    if (p.user != null) BackupStore.resetCheckpoints(c, p.user);
                    Log.i("FaleDebug", "checkpoints reset");
                } else if (a.endsWith(".STATE")) {
                    BackupStore.Prefs p = BackupStore.loadPrefs(c);
                    Log.i("FaleDebug", "state armed=" + BackupStore.armed(c) + " on=" + p.on + " wifiOnly=" + p.wifiOnly + " work=" + BackupScheduler.states(c)
                        + " lock=" + BackupLock.holder() + " live=" + BackupEngine.live + (p.user != null ? " status=" + BackupStore.status(c, p.user) : ""));
                }
            } catch (Exception e) {
                Log.w("FaleDebug", a + " failed: " + e);
            } finally {
                pr.finish();
            }
        }).start();
    }
}
