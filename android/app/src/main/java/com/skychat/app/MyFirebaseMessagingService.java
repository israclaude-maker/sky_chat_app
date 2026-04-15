package com.skychat.app;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.media.RingtoneManager;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import androidx.core.graphics.drawable.IconCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import org.json.JSONObject;

import java.util.Map;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;

public class MyFirebaseMessagingService extends FirebaseMessagingService {

    private static final String TAG = "FCM";
    private static final String CHANNEL_CALL = "skychat_calls";
    private static final String CHANNEL_MSG = "skychat_messages";

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        Log.d(TAG, "New FCM token: " + token.substring(0, 20) + "...");
        // Save token locally — will be sent to server on next login/reconnect
        SharedPreferences prefs = getSharedPreferences(KeepAliveService.PREFS_NAME, MODE_PRIVATE);
        prefs.edit().putString("fcm_token", token).apply();
        // If user is logged in, send to server immediately
        sendTokenToServer(token);
    }

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        Log.d(TAG, "FCM message received from: " + remoteMessage.getFrom());

        // If app is in foreground, let WebSocket handle it
        if (MainActivity.isAppInForeground) {
            Log.d(TAG, "App in foreground, skipping FCM notification");
            return;
        }

        Map<String, String> data = remoteMessage.getData();
        String type = data.get("type");

        if ("call".equals(type)) {
            handleCallNotification(data);
        } else {
            handleMessageNotification(remoteMessage);
        }
    }

    private void handleCallNotification(Map<String, String> data) {
        String callerName = data.get("caller_name");
        String callType = data.get("call_type");
        if (callerName == null) callerName = "Unknown";
        String callLabel = "video".equals(callType) ? "Incoming Video Call" : "Incoming Voice Call";

        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPi = PendingIntent.getActivity(this, 100, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent fullIntent = new Intent(this, MainActivity.class);
        fullIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        fullIntent.putExtra("call_action", "show");
        PendingIntent fullPi = PendingIntent.getActivity(this, 101, fullIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent answerIntent = new Intent(this, CallActionReceiver.class);
        answerIntent.setAction(CallActionReceiver.ACTION_ANSWER);
        PendingIntent answerPi = PendingIntent.getBroadcast(this, 102, answerIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent declineIntent = new Intent(this, CallActionReceiver.class);
        declineIntent.setAction(CallActionReceiver.ACTION_DECLINE);
        PendingIntent declinePi = PendingIntent.getBroadcast(this, 103, declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_CALL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setLargeIcon(BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher))
            .setContentTitle(callerName)
            .setContentText(callLabel)
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

    private void handleMessageNotification(RemoteMessage remoteMessage) {
        String title = "SkyChat";
        String body = "New message";

        // Try data payload first
        Map<String, String> data = remoteMessage.getData();
        if (data.containsKey("title")) title = data.get("title");
        if (data.containsKey("body")) body = data.get("body");

        // Then notification payload
        RemoteMessage.Notification notification = remoteMessage.getNotification();
        if (notification != null) {
            if (notification.getTitle() != null) title = notification.getTitle();
            if (notification.getBody() != null) body = notification.getBody();
        }

        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPi = PendingIntent.getActivity(this, 200, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Person sender = new Person.Builder()
            .setName(title)
            .setIcon(IconCompat.createWithResource(this, R.mipmap.ic_launcher))
            .build();

        NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle(
            new Person.Builder().setName("Me").build()
        );
        style.setConversationTitle(title);
        style.addMessage(body, System.currentTimeMillis(), sender);

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
        nm.notify(title.hashCode(), builder.build());
    }

    private void sendTokenToServer(String fcmToken) {
        SharedPreferences prefs = getSharedPreferences(KeepAliveService.PREFS_NAME, MODE_PRIVATE);
        String authToken = prefs.getString("token", null);
        String refreshTokenStr = prefs.getString("refresh_token", null);

        if (authToken == null) return;

        // Refresh JWT first, then send FCM token
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    OkHttpClient client = new OkHttpClient();
                    String currentToken = authToken;

                    // Try to refresh token first
                    if (refreshTokenStr != null) {
                        MediaType JSON = MediaType.parse("application/json; charset=utf-8");
                        String refreshBody = "{\"refresh\":\"" + refreshTokenStr + "\"}";
                        Request refreshReq = new Request.Builder()
                            .url("https://sky-chat.duckdns.org/api/auth/token/refresh/")
                            .post(RequestBody.create(refreshBody, JSON))
                            .build();
                        okhttp3.Response refreshResp = client.newCall(refreshReq).execute();
                        if (refreshResp.isSuccessful()) {
                            String respBody = refreshResp.body().string();
                            JSONObject json = new JSONObject(respBody);
                            currentToken = json.getString("access");
                            prefs.edit().putString("token", currentToken).apply();
                        }
                    }

                    // Send FCM token to server
                    MediaType JSON = MediaType.parse("application/json; charset=utf-8");
                    String body = "{\"token\":\"" + fcmToken + "\",\"device_type\":\"android\"}";
                    Request request = new Request.Builder()
                        .url("https://sky-chat.duckdns.org/api/users/fcm_register/")
                        .header("Authorization", "Bearer " + currentToken)
                        .post(RequestBody.create(body, JSON))
                        .build();

                    okhttp3.Response response = client.newCall(request).execute();
                    Log.d(TAG, "FCM token sent to server: " + response.code());
                } catch (Exception e) {
                    Log.e(TAG, "Failed to send FCM token: " + e.getMessage());
                }
            }
        }).start();
    }
}
