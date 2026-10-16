package dev.fale.one;

// Notifications of the background backup: a small, silent progress notification only while an upload runs
// (also the foreground-service notification when Android allows one), and one notification asking to open the
// app when the session cannot be refreshed. Without the notification permission (Android 13+) nothing is shown
// and the backup still runs. Texts follow the app language (de/en, set by the web app).
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

final class BackupNotify {
    static final int PROGRESS_ID = 4101, SIGNIN_ID = 4102;
    static final String CH_PROGRESS = "fale_backup", CH_ACCOUNT = "fale_account";

    private BackupNotify() {}

    static String t(Context c, String de, String en) { return "en".equals(BackupStore.loadPrefs(c).lang) ? en : de; }

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel p = new NotificationChannel(CH_PROGRESS, t(c, "Automatische Sicherung", "Automatic backup"), NotificationManager.IMPORTANCE_LOW);
        p.setDescription(t(c, "Zeigt an, während Fotos gesichert werden.", "Shown while photos are being backed up."));
        p.setShowBadge(false);
        p.setSound(null, null);
        p.enableVibration(false);
        nm.createNotificationChannel(p);
        NotificationChannel a = new NotificationChannel(CH_ACCOUNT, t(c, "Konto", "Account"), NotificationManager.IMPORTANCE_DEFAULT);
        a.setDescription(t(c, "Wenn die Sicherung eine Anmeldung braucht.", "When backup needs you to sign in."));
        nm.createNotificationChannel(a);
    }
    private static int icon(Context c) {
        int id = c.getResources().getIdentifier("fale_ic_backup", "drawable", c.getPackageName());
        return id != 0 ? id : android.R.drawable.stat_sys_upload;
    }
    private static PendingIntent openApp(Context c) {
        Intent i = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        if (i == null) return null;
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        return PendingIntent.getActivity(c, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
    @SuppressWarnings("deprecation")
    private static Notification.Builder builder(Context c, String channel) {
        return Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, channel) : new Notification.Builder(c);
    }

    /** "FaLe One sichert Fotos …" with "3 von 20" and a progress bar (silent, ongoing). */
    static Notification progress(Context c, int done, int total) {
        channels(c);
        Notification.Builder b = builder(c, CH_PROGRESS)
            .setSmallIcon(icon(c))
            .setContentTitle(t(c, "FaLe One sichert Fotos …", "FaLe One is backing up photos …"))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(Notification.CATEGORY_PROGRESS);
        if (total > 0) {
            b.setContentText(t(c, done + " von " + total, done + " of " + total));
            b.setProgress(total, Math.min(done, total), false);
        } else {
            b.setProgress(0, 0, true);
        }
        PendingIntent pi = openApp(c);
        if (pi != null) b.setContentIntent(pi);
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }
    static void showProgress(Context c, int done, int total) {
        try {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (nm != null) nm.notify(PROGRESS_ID, progress(c, done, total));
        } catch (Exception ignored) { /* no permission: the backup runs without a notification */ }
    }
    static void cancelProgress(Context c) {
        try {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (nm != null) nm.cancel(PROGRESS_ID);
        } catch (Exception ignored) { /* nothing to cancel */ }
    }
    /** The session is gone (signed out elsewhere, device removed): ask to open the app. */
    static void signInNeeded(Context c) {
        try {
            channels(c);
            String text = t(c, "Bitte öffne FaLe One und melde dich an, damit deine Fotos weiter gesichert werden.",
                "Please open FaLe One and sign in so your photos keep being backed up.");
            Notification.Builder b = builder(c, CH_ACCOUNT)
                .setSmallIcon(icon(c))
                .setContentTitle(t(c, "Sicherung angehalten", "Backup paused"))
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setAutoCancel(true);
            PendingIntent pi = openApp(c);
            if (pi != null) b.setContentIntent(pi);
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (nm != null) nm.notify(SIGNIN_ID, b.build());
        } catch (Exception ignored) { /* no permission */ }
    }
    static void cancelSignIn(Context c) {
        try {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (nm != null) nm.cancel(SIGNIN_ID);
        } catch (Exception ignored) { /* nothing to cancel */ }
    }
}
