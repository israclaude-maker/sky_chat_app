package com.skychat.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

public class ScreenCaptureService extends Service {
    private static final String CHANNEL_ID = "screen_capture";

    @Override
    public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "Screen Sharing", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Active while sharing your screen");
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification notif = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("SkyChat")
            .setContentText("Screen sharing active")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .build();
        startForeground(100, notif);
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        stopForeground(true);
        super.onDestroy();
    }
}
