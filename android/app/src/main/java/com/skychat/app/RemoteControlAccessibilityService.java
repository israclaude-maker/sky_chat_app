package com.skychat.app;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;

public class RemoteControlAccessibilityService extends AccessibilityService {

    private static final String TAG = "SkyChatRC";
    public static RemoteControlAccessibilityService instance = null;
    private int screenW, screenH;

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
        DisplayMetrics dm = getResources().getDisplayMetrics();
        screenW = dm.widthPixels;
        screenH = dm.heightPixels;
        Log.d(TAG, "RC service connected " + screenW + "x" + screenH);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {}

    @Override
    public void onInterrupt() {}

    @Override
    public void onDestroy() {
        super.onDestroy();
        instance = null;
    }

    public static boolean isEnabled() {
        return instance != null;
    }

    // normX / normY are 0..1 (as sent by chat.js)
    public void tap(float normX, float normY) {
        float x = normX * screenW;
        float y = normY * screenH;
        Path path = new Path();
        path.moveTo(x, y);
        GestureDescription.Builder b = new GestureDescription.Builder();
        b.addStroke(new GestureDescription.StrokeDescription(path, 0, 50));
        dispatchGesture(b.build(), null, null);
    }

    public void longPress(float normX, float normY) {
        float x = normX * screenW;
        float y = normY * screenH;
        Path path = new Path();
        path.moveTo(x, y);
        GestureDescription.Builder b = new GestureDescription.Builder();
        b.addStroke(new GestureDescription.StrokeDescription(path, 0, 600));
        dispatchGesture(b.build(), null, null);
    }

    public void scroll(String direction, float amount) {
        float cx = screenW / 2f;
        float startY = direction.equals("down") ? screenH * 0.7f : screenH * 0.3f;
        float endY = direction.equals("down") ? screenH * 0.3f : screenH * 0.7f;
        Path path = new Path();
        path.moveTo(cx, startY);
        path.lineTo(cx, endY);
        GestureDescription.Builder b = new GestureDescription.Builder();
        b.addStroke(new GestureDescription.StrokeDescription(path, 0, 250));
        dispatchGesture(b.build(), null, null);
    }

    // Only a few keys map cleanly onto Android without a custom keyboard (IME).
    public void handleKey(String key) {
        if (key == null) return;
        switch (key) {
            case "Escape":
            case "Backspace":
                performGlobalAction(GLOBAL_ACTION_BACK);
                break;
            case "Home":
                performGlobalAction(GLOBAL_ACTION_HOME);
                break;
            default:
                // no-op — arbitrary text typing needs a custom IME (separate task)
                break;
        }
    }
}