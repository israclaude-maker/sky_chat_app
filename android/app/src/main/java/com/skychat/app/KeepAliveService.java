package com.skychat.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import androidx.core.graphics.drawable.IconCompat;

import org.json.JSONObject;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

import java.util.concurrent.TimeUnit;

public class KeepAliveService extends Service {

    private static final String TAG = "KeepAlive";
    private static final String CHANNEL_ID = "skychat_bg_v2";
    private static final String CHANNEL_CALL = "skychat_calls";
    private static final String CHANNEL_MSG = "skychat_messages";
    private static final String WS_BASE = "wss://sky-chat.duckdns.org/ws/chat/";
    public static final String PREFS_NAME = "skychat_prefs";

    private PowerManager.WakeLock wakeLock;
    private OkHttpClient httpClient;
    private WebSocket webSocket;
    private Handler reconnectHandler;
    private boolean isRunning = false;
    private int reconnectDelay = 3000; // start 3s, max 30s

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "Service onCreate");
        reconnectHandler = new Handler(Looper.getMainLooper());
        createChannels();

        // Foreground notification
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setContentIntent(pi)
            .setOngoing(true)
            .setSilent(true)
            .build();

        startForeground(1, notification);

        // Wake lock
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "skychat:keepalive");
        wakeLock.acquire();

        isRunning = true;
        connectWebSocket();
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);

            // Delete old channel that was cached with wrong settings
            nm.deleteNotificationChannel("skychat_keepalive");

            // Keep-alive channel (completely silent & hidden)
            NotificationChannel keepCh = new NotificationChannel(
                CHANNEL_ID, "Background Service", NotificationManager.IMPORTANCE_MIN);
            keepCh.setDescription("Keeps SkyChat connected");
            keepCh.setShowBadge(false);
            keepCh.enableVibration(false);
            keepCh.enableLights(false);
            keepCh.setSound(null, null);
            keepCh.setLockscreenVisibility(Notification.VISIBILITY_SECRET);
            nm.createNotificationChannel(keepCh);

            // Calls channel
            NotificationChannel callCh = new NotificationChannel(
                CHANNEL_CALL, "Incoming Calls", NotificationManager.IMPORTANCE_HIGH);
            callCh.setDescription("Incoming voice and video calls");
            callCh.enableVibration(true);
            callCh.setVibrationPattern(new long[]{0, 1000, 500, 1000, 500, 1000});
            callCh.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            callCh.enableLights(true);
            callCh.setLightColor(Color.GREEN);
            nm.createNotificationChannel(callCh);

            // Messages channel
            NotificationChannel msgCh = new NotificationChannel(
                CHANNEL_MSG, "Messages", NotificationManager.IMPORTANCE_HIGH);
            msgCh.setDescription("New message notifications");
            msgCh.enableVibration(true);
            msgCh.setVibrationPattern(new long[]{0, 250, 100, 250});
            msgCh.enableLights(true);
            msgCh.setLightColor(Color.WHITE);
            nm.createNotificationChannel(msgCh);
        }
    }

    private void connectWebSocket() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String token = prefs.getString("token", null);
        int userId = prefs.getInt("user_id", -1);

        if (token == null || userId == -1) {
            Log.d(TAG, "No token/userId saved, waiting...");
            // Retry in 5s in case user is logging in
            reconnectHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (isRunning) connectWebSocket();
                }
            }, 5000);
            return;
        }

        String url = WS_BASE + "user_" + userId + "/?token=" + token;
        Log.d(TAG, "Connecting WS: user_" + userId);

        if (httpClient != null) {
            httpClient.dispatcher().cancelAll();
        }

        httpClient = new OkHttpClient.Builder()
            .readTimeout(0, TimeUnit.MILLISECONDS) // no timeout for WS
            .pingInterval(30, TimeUnit.SECONDS)    // keep alive ping
            .build();

        Request request = new Request.Builder().url(url).build();

        webSocket = httpClient.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket ws, Response response) {
                Log.d(TAG, "WebSocket connected");
                reconnectDelay = 3000; // reset
            }

            @Override
            public void onMessage(WebSocket ws, String text) {
                Log.d(TAG, "WS message: " + text.substring(0, Math.min(text.length(), 100)));
                handleMessage(text);
            }

            @Override
            public void onClosing(WebSocket ws, int code, String reason) {
                Log.d(TAG, "WS closing: " + code + " " + reason);
                ws.close(1000, null);
                scheduleReconnect();
            }

            @Override
            public void onFailure(WebSocket ws, Throwable t, Response response) {
                Log.e(TAG, "WS failed: " + t.getMessage());
                scheduleReconnect();
            }
        });
    }

    private void scheduleReconnect() {
        if (!isRunning) return;
        Log.d(TAG, "Reconnecting in " + reconnectDelay + "ms");
        reconnectHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (isRunning) connectWebSocket();
            }
        }, reconnectDelay);
        // Exponential backoff, max 30s
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    }

    private void handleMessage(String text) {
        try {
            JSONObject data = new JSONObject(text);
            String type = data.optString("type", "");

            // Always handle call cancel events
            if ("call_ended".equals(type) || "call_cancelled".equals(type) || "call_rejected".equals(type)) {
                cancelCallNotification();
                return;
            }

            // Skip other notifications when app is in foreground
            if (MainActivity.isAppInForeground) return;

            switch (type) {
                case "call_incoming":
                    showCallNotification(
                        data.optString("caller_name", "Unknown"),
                        data.optString("call_type", "voice").equals("video")
                            ? "Incoming Video Call" : "Incoming Voice Call"
                    );
                    break;

                case "group_call_notify": {
                    String gName = safeStr(data, "group_name", "Group");
                    String cName = safeStr(data, "caller_name", "Someone");
                    String cType = data.optString("call_type", "voice").equals("video") ? "Video" : "Voice";
                    showCallNotification(gName, cName + " \u2014 " + cType + " Call");
                    break;
                }

                case "new_message_notify": {
                    String senderName = safeStr(data, "sender_name", "Unknown");
                    String groupName = safeStr(data, "group_name", "");
                    String msgText = safeStr(data, "message", "New message");
                    String title = groupName.isEmpty() ? senderName : senderName + " in " + groupName;
                    showMessageNotification(title, msgText);
                    break;
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Parse error: " + e.getMessage());
        }
    }

    // Safe string extractor — handles JSON null and literal "null"
    private String safeStr(JSONObject obj, String key, String fallback) {
        if (obj.isNull(key)) return fallback;
        String val = obj.optString(key, fallback);
        if ("null".equals(val) || val.isEmpty()) return fallback;
        return val;
    }

    private void showCallNotification(String callerName, String callType) {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPi = PendingIntent.getActivity(this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // Full-screen intent for lock screen
        Intent fullIntent = new Intent(this, MainActivity.class);
        fullIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        fullIntent.putExtra("call_action", "show");
        PendingIntent fullPi = PendingIntent.getActivity(this, 1, fullIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // Answer
        Intent answerIntent = new Intent(this, CallActionReceiver.class);
        answerIntent.setAction(CallActionReceiver.ACTION_ANSWER);
        PendingIntent answerPi = PendingIntent.getBroadcast(this, 2, answerIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // Decline
        Intent declineIntent = new Intent(this, CallActionReceiver.class);
        declineIntent.setAction(CallActionReceiver.ACTION_DECLINE);
        PendingIntent declinePi = PendingIntent.getBroadcast(this, 3, declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_CALL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setLargeIcon(BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher))
            .setContentTitle(callerName)
            .setContentText(callType)
            .setSubText("SkyChat")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openPi)
            .setFullScreenIntent(fullPi, true)
            .setOngoing(true)
            .setAutoCancel(false)
            .setColor(Color.parseColor("#00a884"))
            .setVibrate(new long[]{0, 1000, 500, 1000, 500, 1000})
            .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", declinePi)
            .addAction(android.R.drawable.ic_menu_call, "Answer", answerPi);

        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.notify(CallActionReceiver.CALL_NOTIFICATION_ID, builder.build());
    }

    private void showMessageNotification(String senderName, String message) {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPi = PendingIntent.getActivity(this, 10, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Person sender = new Person.Builder()
            .setName(senderName)
            .setIcon(IconCompat.createWithResource(this, R.mipmap.ic_launcher))
            .build();

        NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle(
            new Person.Builder().setName("Me").build()
        );
        style.setConversationTitle(senderName);
        style.addMessage(message, System.currentTimeMillis(), sender);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_MSG)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setLargeIcon(BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher))
            .setStyle(style)
            .setSubText("SkyChat")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setContentIntent(openPi)
            .setAutoCancel(true)
            .setColor(Color.parseColor("#00a884"))
            .setVibrate(new long[]{0, 250, 100, 250})
            .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
            .setGroup("skychat_messages");

        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.notify(senderName.hashCode(), builder.build());
    }

    private void cancelCallNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.cancel(CallActionReceiver.CALL_NOTIFICATION_ID);
    }

    // Called from MainActivity when token is updated
    public void reconnect() {
        if (webSocket != null) {
            webSocket.close(1000, "reconnecting");
        }
        reconnectDelay = 1000;
        reconnectHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (isRunning) connectWebSocket();
            }
        }, 500);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "RECONNECT".equals(intent.getAction())) {
            reconnect();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        Log.d(TAG, "Service destroyed");
        isRunning = false;
        reconnectHandler.removeCallbacksAndMessages(null);
        if (webSocket != null) webSocket.close(1000, "service stopped");
        if (httpClient != null) httpClient.dispatcher().cancelAll();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();

        // Restart service (START_STICKY backup)
        Intent restartIntent = new Intent(this, KeepAliveService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(restartIntent);
        } else {
            startService(restartIntent);
        }
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // App swiped from recents — restart service
        Log.d(TAG, "Task removed, restarting service");
        Intent restartIntent = new Intent(this, KeepAliveService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(restartIntent);
        } else {
            startService(restartIntent);
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
