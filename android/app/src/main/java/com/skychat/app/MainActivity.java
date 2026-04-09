package com.skychat.app;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.AudioAttributes;
import android.media.Image;
import android.media.ImageReader;
import android.media.RingtoneManager;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.KeyEvent;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.PermissionRequest;

import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import androidx.core.graphics.drawable.IconCompat;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

public class MainActivity extends Activity {

    private static final String APP_URL = "https://sky-chat.duckdns.org/chat/";
    private static final int PERMISSION_REQUEST_CODE = 1001;
    private static final int FILE_CHOOSER_REQUEST = 1002;
    private static final int SCREEN_CAPTURE_REQUEST = 1003;
    private static final String CHANNEL_CALL = "skychat_calls";
    private static final String CHANNEL_MSG = "skychat_messages";
    private WebView webView;
    public static WebView webViewRef = null; // for service to inject JS
    private PermissionRequest pendingPermissionRequest;
    private ValueCallback<Uri[]> fileUploadCallback;
    private int msgNotifId = 2000;
    public static boolean isAppInForeground = false;
    private String pendingCallAction = null; // saved until WebView is ready

    // Screen capture fields
    private MediaProjectionManager projectionManager;
    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private Handler frameHandler;
    private boolean isCapturing = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );
        setContentView(com.skychat.app.R.layout.activity_main);

        createNotificationChannels();

        // Start foreground service to keep WebSocket alive in background
        Intent serviceIntent = new Intent(this, KeepAliveService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            String[] perms;
            if (Build.VERSION.SDK_INT >= 33) {
                perms = new String[]{
                    Manifest.permission.RECORD_AUDIO,
                    Manifest.permission.CAMERA,
                    Manifest.permission.MODIFY_AUDIO_SETTINGS,
                    Manifest.permission.POST_NOTIFICATIONS
                };
            } else {
                perms = new String[]{
                    Manifest.permission.RECORD_AUDIO,
                    Manifest.permission.CAMERA,
                    Manifest.permission.MODIFY_AUDIO_SETTINGS
                };
            }
            boolean needRequest = false;
            for (String p : perms) {
                if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) {
                    needRequest = true;
                    break;
                }
            }
            if (needRequest) {
                requestPermissions(perms, PERMISSION_REQUEST_CODE);
            }
        }

        webView = findViewById(com.skychat.app.R.id.webView);
        webViewRef = webView;
        webView.setLayerType(android.view.View.LAYER_TYPE_HARDWARE, null);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setAllowContentAccess(true);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new WebAppInterface(), "AndroidBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // Execute pending call action after page loads
                if (pendingCallAction != null) {
                    final String action = pendingCallAction;
                    pendingCallAction = null;
                    // Wait a bit for JS to initialize
                    view.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            executeCallAction(action);
                        }
                    }, 2000);
                }
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            boolean hasMic = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
                            boolean hasCam = checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
                            if (!hasMic || !hasCam) {
                                pendingPermissionRequest = request;
                                requestPermissions(new String[]{
                                    Manifest.permission.RECORD_AUDIO,
                                    Manifest.permission.CAMERA,
                                    Manifest.permission.MODIFY_AUDIO_SETTINGS
                                }, PERMISSION_REQUEST_CODE);
                                return;
                            }
                        }
                        request.grant(request.getResources());
                    }
                });
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileUploadCallback != null) {
                    fileUploadCallback.onReceiveValue(null);
                }
                fileUploadCallback = callback;
                Intent intent = params.createIntent();
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (Exception e) {
                    fileUploadCallback = null;
                    return false;
                }
                return true;
            }
        });

        webView.loadUrl(APP_URL);

        // Handle call action if app was launched from notification
        Intent launchIntent = getIntent();
        if (launchIntent != null && launchIntent.hasExtra("call_action")) {
            pendingCallAction = launchIntent.getStringExtra("call_action");
        }
    }

    private void executeCallAction(String action) {
        if (webView == null || action == null) return;
        if ("answer".equals(action)) {
            webView.evaluateJavascript(
                "(function(){" +
                "  if(typeof acceptCall==='function'){acceptCall();return 'ok';}" +
                "  return 'no acceptCall';" +
                "})()", null);
        } else if ("decline".equals(action)) {
            webView.evaluateJavascript(
                "(function(){" +
                "  if(typeof rejectCall==='function'){rejectCall();return 'ok';}" +
                "  return 'no rejectCall';" +
                "})()", null);
        }
        // Cancel call notification
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.cancel(CallActionReceiver.CALL_NOTIFICATION_ID);
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);

            // Delete old cached channel
            nm.deleteNotificationChannel("skychat_keepalive");

            // Call channel - HIGH importance, vibrate, ringtone sound
            NotificationChannel callCh = new NotificationChannel(
                CHANNEL_CALL, "Incoming Calls", NotificationManager.IMPORTANCE_HIGH);
            callCh.setDescription("Incoming voice and video call alerts");
            callCh.enableVibration(true);
            callCh.setVibrationPattern(new long[]{0, 1000, 500, 1000, 500, 1000});
            callCh.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            callCh.enableLights(true);
            callCh.setLightColor(Color.GREEN);
            AudioAttributes callAudio = new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .build();
            callCh.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), callAudio);
            nm.createNotificationChannel(callCh);

            // Message channel - DEFAULT importance, notification sound
            NotificationChannel msgCh = new NotificationChannel(
                CHANNEL_MSG, "Messages", NotificationManager.IMPORTANCE_HIGH);
            msgCh.setDescription("New message notifications");
            msgCh.enableVibration(true);
            msgCh.setVibrationPattern(new long[]{0, 250, 100, 250});
            msgCh.enableLights(true);
            msgCh.setLightColor(Color.WHITE);
            msgCh.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
            nm.createNotificationChannel(msgCh);
        }
    }

    public class WebAppInterface {
        @JavascriptInterface
        public void saveCredentials(String token, int userId, String refreshToken) {
            SharedPreferences prefs = getSharedPreferences(KeepAliveService.PREFS_NAME, MODE_PRIVATE);
            prefs.edit()
                .putString("token", token)
                .putInt("user_id", userId)
                .putString("refresh_token", refreshToken)
                .apply();
            // Tell service to reconnect with new token
            Intent svc = new Intent(MainActivity.this, KeepAliveService.class);
            svc.setAction("RECONNECT");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(svc);
            } else {
                startService(svc);
            }
        }

        @JavascriptInterface
        public void showCallNotification(String callerName, String callType) {
            showCallNotif(callerName, callType);
        }

        @JavascriptInterface
        public void showMessageNotification(String senderName, String message) {
            showMessageNotif(senderName, message);
        }

        @JavascriptInterface
        public void cancelCallNotification() {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            nm.cancel(CallActionReceiver.CALL_NOTIFICATION_ID);
        }

        @JavascriptInterface
        public void cancelAllNotifications() {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            nm.cancelAll();
        }

        @JavascriptInterface
        public void vibrate(long ms) {
            Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    v.vibrate(ms);
                }
            }
        }

        @JavascriptInterface
        public boolean isBackground() {
            return !isAppInForeground;
        }

        @JavascriptInterface
        public void startScreenCapture() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    projectionManager = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
                    startActivityForResult(projectionManager.createScreenCaptureIntent(), SCREEN_CAPTURE_REQUEST);
                }
            });
        }

        @JavascriptInterface
        public void stopScreenCapture() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    stopCapture();
                }
            });
        }

        @JavascriptInterface
        public void logout() {
            SharedPreferences prefs = getSharedPreferences(KeepAliveService.PREFS_NAME, MODE_PRIVATE);
            prefs.edit().clear().apply();
            // Stop the service on logout
            stopService(new Intent(MainActivity.this, KeepAliveService.class));
        }
    }

    // ── WhatsApp-style CALL notification with Answer/Decline ──
    private void showCallNotif(String callerName, String callType) {
        // Open app when tapping notification body
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPi = PendingIntent.getActivity(this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // Full-screen intent (shows on lock screen like WhatsApp call)
        Intent fullIntent = new Intent(this, MainActivity.class);
        fullIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        fullIntent.putExtra("call_action", "show");
        PendingIntent fullPi = PendingIntent.getActivity(this, 1, fullIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // Answer button
        Intent answerIntent = new Intent(this, CallActionReceiver.class);
        answerIntent.setAction(CallActionReceiver.ACTION_ANSWER);
        PendingIntent answerPi = PendingIntent.getBroadcast(this, 2, answerIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // Decline button
        Intent declineIntent = new Intent(this, CallActionReceiver.class);
        declineIntent.setAction(CallActionReceiver.ACTION_DECLINE);
        PendingIntent declinePi = PendingIntent.getBroadcast(this, 3, declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Bitmap largeIcon = BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_CALL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setLargeIcon(largeIcon)
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

    // ── WhatsApp-style MESSAGE notification ──
    private void showMessageNotif(String senderName, String message) {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPi = PendingIntent.getActivity(this, 10, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Bitmap largeIcon = BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher);

        Person sender = new Person.Builder()
            .setName(senderName)
            .setIcon(IconCompat.createWithResource(MainActivity.this, R.mipmap.ic_launcher))
            .build();

        NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle(
            new Person.Builder().setName("Me").build()
        );
        style.setConversationTitle(senderName);
        style.addMessage(message, System.currentTimeMillis(), sender);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_MSG)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setLargeIcon(largeIcon)
            .setContentTitle(senderName)
            .setContentText(message)
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
            .setGroup("skychat_messages")
            .setGroupSummary(false);

        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        // Use senderName hashCode for grouping per sender
        nm.notify(senderName.hashCode(), builder.build());
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        // Screen capture result
        if (requestCode == SCREEN_CAPTURE_REQUEST) {
            if (resultCode == RESULT_OK && data != null) {
                // Start foreground service first (required for Android 10+)
                Intent svc = new Intent(MainActivity.this, ScreenCaptureService.class);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(svc);
                } else {
                    startService(svc);
                }
                // Delay slightly to ensure service is running
                final int rc = resultCode;
                final Intent rd = new Intent(data);
                webView.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            mediaProjection = projectionManager.getMediaProjection(rc, rd);
                            startFrameCapture();
                        } catch (Exception e) {
                            e.printStackTrace();
                            webView.evaluateJavascript(
                                "if(window._screenReject){window._screenReject('Failed to start');window._screenReject=null;}",
                                null);
                        }
                    }
                }, 300);
            } else {
                // User denied
                if (webView != null) {
                    webView.evaluateJavascript(
                        "if(window._screenReject){window._screenReject('denied');window._screenReject=null;}",
                        null);
                }
            }
            return;
        }

        // File chooser result
        if (requestCode == FILE_CHOOSER_REQUEST && fileUploadCallback != null) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null && data.getDataString() != null) {
                results = new Uri[]{Uri.parse(data.getDataString())};
            }
            fileUploadCallback.onReceiveValue(results);
            fileUploadCallback = null;
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQUEST_CODE && pendingPermissionRequest != null) {
            final PermissionRequest req = pendingPermissionRequest;
            pendingPermissionRequest = null;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    req.grant(req.getResources());
                }
            });
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onResume() {
        super.onResume();
        isAppInForeground = true;
        webView.onResume();
        // Cancel message notifications when user opens the app (like WhatsApp)
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.cancel(0); // group summary
    }

    @Override
    protected void onPause() {
        isAppInForeground = false;
        // Do NOT pause webView — keep WebSocket alive in background
        super.onPause();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // Handle call answer/decline from notification
        if (intent != null && intent.hasExtra("call_action")) {
            String action = intent.getStringExtra("call_action");
            if ("answer".equals(action) || "decline".equals(action)) {
                executeCallAction(action);
            }
        }
    }

    @Override
    protected void onDestroy() {
        stopCapture();
        // Do NOT stop KeepAlive service — it should keep running for notifications
        super.onDestroy();
    }

    // ── Screen Capture Methods ──
    private void startFrameCapture() {
        if (mediaProjection == null) return;
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        float ratio = (float) metrics.heightPixels / metrics.widthPixels;
        int w = 540;
        int h = (int) (540 * ratio);
        int dpi = metrics.densityDpi;

        imageReader = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2);
        virtualDisplay = mediaProjection.createVirtualDisplay(
            "SkyChat-Screen", w, h, dpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader.getSurface(), null, null);

        isCapturing = true;
        frameHandler = new Handler(Looper.getMainLooper());
        scheduleFrameCapture();
    }

    private void scheduleFrameCapture() {
        if (!isCapturing || frameHandler == null) return;
        frameHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                captureFrame();
                scheduleFrameCapture();
            }
        }, 100); // ~10fps
    }

    private void captureFrame() {
        if (!isCapturing || imageReader == null || webView == null) return;
        Image image = imageReader.acquireLatestImage();
        if (image == null) return;

        try {
            Image.Plane[] planes = image.getPlanes();
            ByteBuffer buffer = planes[0].getBuffer();
            int pixelStride = planes[0].getPixelStride();
            int rowStride = planes[0].getRowStride();
            int imgW = image.getWidth();
            int imgH = image.getHeight();
            int rowPadding = rowStride - pixelStride * imgW;

            Bitmap bitmap = Bitmap.createBitmap(
                imgW + rowPadding / pixelStride, imgH, Bitmap.Config.ARGB_8888);
            bitmap.copyPixelsFromBuffer(buffer);

            if (rowPadding > 0) {
                Bitmap cropped = Bitmap.createBitmap(bitmap, 0, 0, imgW, imgH);
                bitmap.recycle();
                bitmap = cropped;
            }

            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 35, baos);
            bitmap.recycle();

            String base64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
            webView.evaluateJavascript(
                "if(window._onScreenFrame){window._onScreenFrame('data:image/jpeg;base64," + base64 + "');}",
                null);
        } catch (Exception e) {
            // Skip this frame
        } finally {
            image.close();
        }
    }

    private void stopCapture() {
        isCapturing = false;
        if (frameHandler != null) {
            frameHandler.removeCallbacksAndMessages(null);
            frameHandler = null;
        }
        if (virtualDisplay != null) {
            virtualDisplay.release();
            virtualDisplay = null;
        }
        if (imageReader != null) {
            imageReader.close();
            imageReader = null;
        }
        if (mediaProjection != null) {
            mediaProjection.stop();
            mediaProjection = null;
        }
        try {
            stopService(new Intent(this, ScreenCaptureService.class));
        } catch (Exception e) { /* ignore */ }
    }
}
