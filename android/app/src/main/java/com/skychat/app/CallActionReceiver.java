package com.skychat.app;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;

public class CallActionReceiver extends BroadcastReceiver {

    public static final String ACTION_ANSWER = "com.skychat.app.ACTION_ANSWER";
    public static final String ACTION_DECLINE = "com.skychat.app.ACTION_DECLINE";
    public static final String ACTION_HANGUP = "com.skychat.app.ACTION_HANGUP";
    public static final int CALL_NOTIFICATION_ID = 9999;
    public static final int ONGOING_CALL_NOTIFICATION_ID = 8888; // ongoing call notif (with Hang Up)

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);

        if (ACTION_HANGUP.equals(action)) {
            // Cancel the ongoing-call notification
            nm.cancel(ONGOING_CALL_NOTIFICATION_ID);

            // App zinda hai (WebView foreground service ke sath alive rehti hai)
            // to seedha JS ko bol do call end karo — koi UI khulwane ki zaroorat nahi
            if (MainActivity.webViewRef != null) {
                final android.webkit.WebView wv = MainActivity.webViewRef;
                new Handler(Looper.getMainLooper()).post(new Runnable() {
                    @Override
                    public void run() {
                        wv.evaluateJavascript(
                            "(function(){" +
                            "  try {" +
                            "    if (typeof GC !== 'undefined' && GC.active) {" +
                            "      if (typeof leaveGroupCall === 'function') leaveGroupCall();" +
                            "    } else if (typeof CallState !== 'undefined' && CallState.isInCall) {" +
                            "      if (typeof endCall === 'function') endCall();" +
                            "    } else if (typeof cancelCall === 'function' && typeof CallState !== 'undefined' && CallState.remoteUserId) {" +
                            "      cancelCall();" +
                            "    }" +
                            "  } catch(e) {}" +
                            "})()", null);
                    }
                });
            }
            return;
        }

        // Cancel the incoming call notification (Answer/Decline flow)
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