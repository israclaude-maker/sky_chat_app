const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  Notification,
  shell,
  ipcMain,
  desktopCapturer,
} = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow;
let tray;
let isQuitting = false;
let activeCallNotification = null;

// ─── Config ───────────────────────────────────────────────────
let config = {
  serverUrl: "https://skyfinancia.com",
  appName: "SkyChat",
  mode: "remote",
};
try {
  const cfgPath = path.join(__dirname, "config.json");
  if (fs.existsSync(cfgPath)) {
    Object.assign(config, JSON.parse(fs.readFileSync(cfgPath, "utf8")));
  }
} catch (e) {
  console.error("Config load error:", e.message);
}

const SERVER_URL = config.serverUrl;
const CHAT_URL = SERVER_URL + "/chat/";

// ─── Icon helper ──────────────────────────────────────────────
function getIcon(size) {
  const iconPath = path.join(__dirname, "icon.png");
  try {
    if (fs.existsSync(iconPath)) {
      const img = nativeImage.createFromPath(iconPath);
      return size ? img.resize({ width: size, height: size }) : img;
    }
  } catch (e) {
    /* ignore */
  }
  return nativeImage.createEmpty();
}

// ─── Single instance ──────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ─── Create main window ──────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 420,
    minHeight: 600,
    icon: getIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      spellcheck: true,
    },
    frame: true,
    titleBarStyle: "default",
    backgroundColor: "#111b21",
    show: false,
    title: "SkyChat",
  });

  mainWindow.setMenuBarVisibility(false);

  // ─── Screen sharing: auto-pick entire screen ───
  mainWindow.webContents.session.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen"],
          thumbnailSize: { width: 150, height: 100 },
        });
        if (sources.length > 0) {
          callback({ video: sources[0], audio: false });
        } else {
          callback({});
        }
      } catch (err) {
        console.error("[ScreenShare] error:", err);
        callback({});
      }
    },
    { useSystemPicker: true },
  );

  // ─── Permission grants ───
  mainWindow.webContents.session.setPermissionRequestHandler((wc, perm, cb) => {
    cb(
      [
        "media",
        "mediaKeySystem",
        "notifications",
        "fullscreen",
        "clipboard-read",
      ].includes(perm),
    );
  });

  // ─── Load chat URL ───
  mainWindow.loadURL(CHAT_URL).catch((err) => {
    console.error("Load failed:", err.message);
    showOfflinePage();
  });

  mainWindow.webContents.on("did-fail-load", (ev, code, desc) => {
    console.error("did-fail-load:", code, desc);
    showOfflinePage();
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.webContents.openDevTools();
  });

  // ─── Inject DesktopBridge helpers after every page load ───
  mainWindow.webContents.on("did-finish-load", () => {
    injectDesktopHelpers();
  });

  // ─── Keyboard shortcuts ───
  mainWindow.webContents.on("before-input-event", (ev, input) => {
    if (input.key === "F5" || (input.control && input.key === "r")) {
      mainWindow.webContents.reload();
      ev.preventDefault();
    }
    if (input.control && input.shift && input.key === "I") {
      mainWindow.webContents.toggleDevTools();
      ev.preventDefault();
    }
  });

  // ─── External links in default browser ───
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // ─── Minimize to tray ───
  mainWindow.on("close", (ev) => {
    if (!isQuitting) {
      ev.preventDefault();
      mainWindow.hide();
    }
  });
}

// ─── Offline / error page ─────────────────────────────────────
function showOfflinePage() {
  if (!mainWindow) return;
  const html = `data:text/html;charset=utf-8,
    <html><head><style>
      body{font-family:'Segoe UI',sans-serif;background:#111b21;color:#fff;
        display:flex;justify-content:center;align-items:center;height:100vh;margin:0;flex-direction:column}
      h1{color:#25d366;margin-bottom:8px} p{color:#aaa;margin:6px 0}
      button{background:#25d366;border:none;color:#fff;padding:12px 28px;font-size:15px;
        border-radius:8px;cursor:pointer;margin-top:18px}
      button:hover{background:#128c7e}
    </style></head><body>
      <h1>SkyChat</h1>
      <p>Unable to connect to server</p>
      <p>Check your internet connection and try again.</p>
      <button onclick="location.href='${CHAT_URL}'">Retry</button>
    </body></html>`;
  mainWindow.loadURL(html);
}

// ─── Inject JS into WebView ───────────────────────────────────
function injectDesktopHelpers() {
  if (!mainWindow || !mainWindow.webContents) return;
  mainWindow.webContents
    .executeJavaScript(
      `
    (function() {
      if (window._desktopInjected) return;
      window._desktopInjected = true;
      window._isDesktop = true;

      // Scroll test: call from DevTools with window.DesktopBridge.testScroll()
      if (window.DesktopBridge && !window.DesktopBridge.testScroll) {
        window.DesktopBridge.testScroll = function() {
          window.DesktopBridge.sendRCEvent(JSON.stringify({event:"scroll",direction:"down",delta:120,x:0,y:0}));
          console.log("[TestScroll] Sent test scroll event - check main process log at C:\\\\SkyChat_scroll_debug.txt");
        };
      }

      // Listen for call actions from main process (Answer/Decline from notification)
      if (window.DesktopBridge) {
        window.DesktopBridge.onCallAction(function(action) {
          console.log('[Desktop] Call action:', action);
          if (action === 'answer' && typeof acceptCall === 'function') {
            acceptCall();
          } else if (action === 'decline' && typeof rejectCall === 'function') {
            rejectCall();
          }
        });
      }
    })();
  `,
    )
    .catch(() => {});
}

// ─── System tray ──────────────────────────────────────────────
function createTray() {
  const icon = getIcon(16);
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open SkyChat",
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip("SkyChat");
  tray.setContextMenu(contextMenu);
  tray.on("click", () => {
    if (mainWindow.isVisible()) mainWindow.focus();
    else mainWindow.show();
  });
  tray.on("double-click", () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

// ═══════════════════════════════════════════════════════════════
// IPC HANDLERS (from preload / renderer)
// ═══════════════════════════════════════════════════════════════

// ─── Call notification with Answer/Decline actions ────────────
ipcMain.on("show-call-notification", (event, data) => {
  if (activeCallNotification) {
    try {
      activeCallNotification.close();
    } catch (e) {
      /* ignore */
    }
  }

  const callLabel =
    data.callType === "video" ? "Incoming Video Call" : "Incoming Voice Call";

  const notif = new Notification({
    title: data.callerName || "Incoming Call",
    body: callLabel,
    icon: getIcon(),
    urgency: "critical",
    silent: false,
    timeoutType: "never",
    actions: [
      { type: "button", text: "Answer" },
      { type: "button", text: "Decline" },
    ],
  });

  notif.on("action", (ev, index) => {
    if (index === 0) {
      // Answer
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send("call-action", "answer");
    } else {
      // Decline
      mainWindow.webContents.send("call-action", "decline");
    }
  });

  notif.on("click", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  notif.show();
  activeCallNotification = notif;

  // Flash taskbar
  if (mainWindow && !mainWindow.isFocused()) {
    mainWindow.flashFrame(true);
  }
});

ipcMain.on("cancel-call-notification", () => {
  if (activeCallNotification) {
    try {
      activeCallNotification.close();
    } catch (e) {
      /* ignore */
    }
    activeCallNotification = null;
  }
  if (mainWindow) mainWindow.flashFrame(false);
});

// ─── Message notification ─────────────────────────────────────
ipcMain.on("show-message-notification", (event, data) => {
  // Don't show if window is focused
  if (mainWindow && mainWindow.isFocused()) return;

  const notif = new Notification({
    title: data.senderName || "New Message",
    body: data.message || "",
    icon: getIcon(),
    silent: true, // web app plays its own sound
  });

  notif.on("click", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  notif.show();

  // Flash taskbar
  if (mainWindow && !mainWindow.isFocused()) {
    mainWindow.flashFrame(true);
  }
});

ipcMain.on("cancel-all-notifications", () => {
  if (activeCallNotification) {
    try {
      activeCallNotification.close();
    } catch (e) {
      /* ignore */
    }
    activeCallNotification = null;
  }
  if (mainWindow) mainWindow.flashFrame(false);
});

ipcMain.on("is-background", (event) => {
  event.returnValue = mainWindow ? !mainWindow.isFocused() : true;
});

ipcMain.on("flash-window", () => {
  if (mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true);
});

ipcMain.on("set-badge-count", (event, count) => {
  if (app.setBadgeCount) app.setBadgeCount(count);
  if (tray)
    tray.setToolTip(count > 0 ? `SkyChat (${count} unread)` : "SkyChat");
});

// ─── Focus: stop flash ────────────────────────────────────────
function setupFocusHandlers() {
  mainWindow.on("focus", () => {
    mainWindow.flashFrame(false);
  });
}

// ═══════════════════════════════════════════════════════════════
// APP LIFECYCLE
// ═══════════════════════════════════════════════════════════════
app.whenReady().then(() => {
  // Set app user model ID for Windows notifications
  app.setAppUserModelId("com.skychat.desktop");

  createWindow();
  createTray();
  setupFocusHandlers();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

const robot = require("@jitsi/robotjs");

// Log robotjs capabilities at startup
const _scrollLog = [];
function _logScroll(msg) {
  _scrollLog.push(new Date().toISOString() + " " + msg);
  console.log(msg);
  // Write to file for debugging
  try {
    const logPath = require("path").join(require("os").homedir(), "SkyChat_scroll_debug.txt");
    require("fs").writeFileSync(logPath, _scrollLog.join("\n"));
  } catch(e) {}
}
_logScroll("[robotjs] scrollMouse type: " + typeof robot.scrollMouse);
_logScroll("[robotjs] getScreenSize: " + JSON.stringify(robot.getScreenSize()));

// Test handler: call from renderer with window.DesktopBridge.testScroll()
ipcMain.on("test-scroll", () => {
  _logScroll("[TEST] Testing scroll...");
  try { robot.scrollMouse(0, 5); _logScroll("[TEST] scrollMouse(0, 5) OK"); } catch(e) { _logScroll("[TEST] FAILED: " + e.message); }
});

// ─── Key name mapping for robotjs ────────────────────────────
const keyMap = {
  // Navigation keys
  Enter: "enter",
  Backspace: "backspace",
  Delete: "delete",
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  Tab: "tab",
  Escape: "escape",
  " ": "space",
  // Modifiers
  Shift: "shift",
  Control: "control",
  Alt: "alt",
  Meta: "command",
  // Function keys
  F1: "f1",
  F2: "f2",
  F3: "f3",
  F4: "f4",
  F5: "f5",
  F6: "f6",
  F7: "f7",
  F8: "f8",
  F9: "f9",
  F10: "f10",
  F11: "f11",
  F12: "f12",
  // Special keys
  Home: "home",
  End: "end",
  PageUp: "page_up",
  PageDown: "page_down",
  Insert: "insert",
  CapsLock: "caps_lock",
};

ipcMain.on("rc-event", (event, rawData) => {
  console.log("[RC] Raw data received:", rawData);
  try {
    const data = typeof rawData === "string" ? JSON.parse(rawData) : rawData;

    const screenSize = robot.getScreenSize();
    const x = Math.round(
      Math.max(0, Math.min(1, data.x || 0)) * screenSize.width,
    );
    const y = Math.round(
      Math.max(0, Math.min(1, data.y || 0)) * screenSize.height,
    );

    if (data.event === "mousemove") {
      robot.moveMouse(x, y);
    } else if (data.event === "click") {
      robot.moveMouse(x, y);
      setTimeout(() => robot.mouseClick("left"), 30);
    } else if (data.event === "rightclick") {
      robot.moveMouse(x, y);
      setTimeout(() => robot.mouseClick("right"), 30);
    } else if (data.event === "scroll") {
      // ─── SCROLL: multiple methods + file logging ───
      var scrollAmt = Math.max(3, Math.floor((data.delta || 120) / 20));
      var dir = data.direction || "down";
      _logScroll("[SCROLL] dir:" + dir + " delta:" + data.delta + " amt:" + scrollAmt);

      // Method 1: scrollMouse(deltaX, deltaY)
      try {
        var yVal = dir === "up" ? -scrollAmt : scrollAmt;
        robot.scrollMouse(0, yVal);
        _logScroll("[SCROLL] scrollMouse(0, " + yVal + ") OK");
      } catch (e1) {
        _logScroll("[SCROLL] Method1 FAIL: " + e1.message);
        // Method 2: keyboard fallback (Page Up / Page Down)
        try {
          if (dir === "up") {
            robot.keyTap("pageup");
          } else {
            robot.keyTap("pagedown");
          }
          _logScroll("[SCROLL] keyboard fallback OK");
        } catch (e2) {
          _logScroll("[SCROLL] ALL FAIL: " + e2.message);
        }
      }
    } else if (data.event === "keypress") {
      const k = data.key;
      if (!k) return;

      const modifiers = [];
      if (data.ctrl) modifiers.push("control");
      if (data.alt) modifiers.push("alt");
      if (data.shift) modifiers.push("shift");
      if (data.meta) modifiers.push("command");

      if (k.length === 1) {
        // Ctrl/Alt shortcuts (Ctrl+C, Ctrl+V, Alt+F4, etc.)
        if (data.ctrl || data.alt) {
          try {
            robot.keyTap(k.toLowerCase(), modifiers);
          } catch (e) {}
        } else {
          // Normal characters — clipboard method use karo
          // (yeh symbols, capitals, sab handle karta hai)
          try {
            const { clipboard } = require("electron");
            const prev = clipboard.readText();
            clipboard.writeText(k);
            robot.keyTap("v", ["control"]);
            setTimeout(() => clipboard.writeText(prev), 300);
          } catch (e) {
            try {
              robot.typeString(k);
            } catch (e2) {}
          }
        }
      } else if (keyMap[k]) {
        // Special keys: Enter, Backspace, ArrowLeft, Tab, etc.
        try {
          robot.keyTap(keyMap[k], modifiers);
        } catch (e) {}
      }
    }
  } catch (e) {
    console.error("[RC] Error:", e.message);
  }
});

app.on("before-quit", () => {
  isQuitting = true;
});

// Accept self-signed certs in dev
app.on("certificate-error", (event, wc, url, error, cert, callback) => {
  event.preventDefault();
  callback(true);
});
