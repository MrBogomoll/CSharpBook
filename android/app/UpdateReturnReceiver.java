package ru.csharpbook.reader;

import android.app.ActivityManager;
import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.PowerManager;

public final class UpdateReturnReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) return;
        SharedPreferences prefs = context.getSharedPreferences(BookUpdater.PREFS, Context.MODE_PRIVATE);
        int installTask = prefs.getInt(BookUpdater.INSTALL_TASK, -1);
        if (installTask < 0) return;
        prefs.edit().remove(BookUpdater.INSTALL_TASK).apply();
        if (!BuildConfig.VERSION_NAME.equals(prefs.getString("version", "")) || Build.VERSION.SDK_INT < 32) return;
        if (!context.getSystemService(PowerManager.class).isInteractive() ||
                context.getSystemService(KeyguardManager.class).isKeyguardLocked()) return;

        // Only resume the task from which the user opened the installer, while it is on screen.
        // Some installers use their own task. Their completion screen can offer "Open" instead.
        ActivityManager manager = context.getSystemService(ActivityManager.class);
        for (ActivityManager.AppTask task : manager.getAppTasks()) {
            try {
                ActivityManager.RecentTaskInfo info = task.getTaskInfo();
                if (info.taskId == installTask && info.isVisible()) {
                    Intent openBook = Intent.makeMainActivity(new ComponentName(context, BookActivity.class));
                    context.startActivity(openBook.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                    return;
                }
            } catch (IllegalArgumentException | SecurityException ignored) {
                // Android can remove the task or restrict the launch during the replacement.
            }
        }
    }
}
