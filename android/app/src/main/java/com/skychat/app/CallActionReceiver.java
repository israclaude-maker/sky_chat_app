package com.skychat.app;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class CallActionReceiver extends BroadcastReceiver {

    public static final String ACTION_ANSWER = "com.skychat.app.ACTION_ANSWER";
    public static final String ACTION_DECLINE = "com.skychat.app.ACTION_DECLINE";
    public static final int CALL_NOTIFICATION_ID = 9999;

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();

        // Cancel the call notification
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.cancel(CALL_NOTIFICATION_ID);

        if (ACTION_DECLINE.equals(action)) {
            // Reject call directly via service WebSocket — no need to open app
            if (KeepAliveService.instance != null) {
                KeepAliveService.instance.rejectCallViaWs();
            }
            return; // Don't open app
        }

        // Answer — open app with call data
        android.content.SharedPreferences prefs = context.getSharedPreferences(KeepAliveService.PREFS_NAME, Context.MODE_PRIVATE);
        Intent appIntent = new Intent(context, MainActivity.class);
        appIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        appIntent.putExtra("call_action", "answer");
        appIntent.putExtra("call_id", prefs.getInt("pending_call_id", -1));
        appIntent.putExtra("caller_id", prefs.getInt("pending_caller_id", -1));
        appIntent.putExtra("caller_name", prefs.getString("pending_caller_name", "Unknown"));
        appIntent.putExtra("call_type", prefs.getString("pending_call_type", "voice"));
        appIntent.putExtra("caller_username", prefs.getString("pending_caller_username", ""));
        appIntent.putExtra("caller_pic", prefs.getString("pending_caller_pic", ""));
        context.startActivity(appIntent);
    }
}
