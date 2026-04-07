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

        // Open app
        Intent appIntent = new Intent(context, MainActivity.class);
        appIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        if (ACTION_ANSWER.equals(action)) {
            appIntent.putExtra("call_action", "answer");
        } else if (ACTION_DECLINE.equals(action)) {
            appIntent.putExtra("call_action", "decline");
        }

        context.startActivity(appIntent);
    }
}
