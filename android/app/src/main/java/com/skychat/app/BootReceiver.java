package com.skychat.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            // Only start if user was logged in
            SharedPreferences prefs = context.getSharedPreferences(
                KeepAliveService.PREFS_NAME, Context.MODE_PRIVATE);
            String token = prefs.getString("token", null);

            if (token != null) {
                Log.d("BootReceiver", "Boot completed — starting KeepAliveService");
                Intent serviceIntent = new Intent(context, KeepAliveService.class);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent);
                } else {
                    context.startService(serviceIntent);
                }
            }
        }
    }
}
