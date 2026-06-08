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
  screen,
} = require("electron");
const path = require("path");
const fs = require("fs");
const robot = require("@jitsi/robotjs");

let mainWindow;
let tray;
let isQuitting = false;
let activeCallNotification = null;

// ─── Config ───────────────────────────────────────────────────
let config = {
  serverUrl: "https://sky-chat.duckdns.org",
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

// ─── robotjs key map ──────────────────────────────────────────
const keyMap = {
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
  Shift: "shift",
  Control: "control",
  Alt: "alt",
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
  Home: "home",
  End: "end",
  PageUp: "pageup",
  PageDown: "pagedown",
};

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

// ─── Create main window ───────────────────────────────────────
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
    (request, callback) => {
      desktopCapturer
        .getSources({ types: ["screen", "window"] })
        .then((sources) => {
          callback(sources.length > 0 ? { video: sources[0] } : {});
        })
        .catch(() => callback({}));
    },
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
    // mainWindow.webContents.openDevTools(); // production mein comment out rakho
  });

  mainWindow.webContents.on("did-finish-load", () => {
    injectDesktopHelpers();
  });

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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

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
      if (window.DesktopBridge) {
        window.DesktopBridge.onCallAction(function(action) {
          console.log('[Desktop] Call action:', action);
          if (action === 'answer' && typeof acceptCall === 'function') acceptCall();
          else if (action === 'decline' && typeof rejectCall === 'function') rejectCall();
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
// IPC HANDLERS
// ═══════════════════════════════════════════════════════════════

// ─── Remote Control ───────────────────────────────────────────
ipcMain.on("rc-event", (event, rawData) => {
  try {
    const data = typeof rawData === "string" ? JSON.parse(rawData) : rawData;

    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const x = Math.round(data.x * width);
    const y = Math.round(data.y * height);

    console.log(
      `RC [${data.event}] x=${x} y=${y} key=${data.key || ""} dir=${data.direction || ""}`,
    );

    if (data.event === "mousemove") {
      robot.moveMouse(x, y);
    } else if (data.event === "click") {
      robot.moveMouse(x, y);
      setTimeout(() => robot.mouseClick(), 50);
    } else if (data.event === "scroll") {
      // robotjs scrollMouse: positive = up, negative = down
      const delta = Math.max(1, Math.round((data.delta || 120) / 40));
      const scrollAmt = data.direction === "down" ? -delta : delta;
      robot.scrollMouse(0, scrollAmt);
    } else if (data.event === "keypress") {
      const k = data.key;
      // Special keys pehle check karo
      const mapped = keyMap[k] || (k.length === 1 ? k.toLowerCase() : null);
      if (mapped) {
        robot.keyTap(mapped);
        console.log(`RC keyTap: "${mapped}"`);
      } else {
        console.log(`RC key not mapped: "${k}"`);
      }
    }
  } catch (e) {
    console.error("RC error:", e.message);
  }
});

// ─── Call notification ────────────────────────────────────────
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
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send("call-action", "answer");
    } else {
      mainWindow.webContents.send("call-action", "decline");
    }
  });
  notif.on("click", () => {
    mainWindow.show();
    mainWindow.focus();
  });
  notif.show();
  activeCallNotification = notif;
  if (mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true);
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
  if (mainWindow && mainWindow.isFocused()) return;
  const notif = new Notification({
    title: data.senderName || "New Message",
    body: data.message || "",
    icon: getIcon(),
    silent: true,
  });
  notif.on("click", () => {
    mainWindow.show();
    mainWindow.focus();
  });
  notif.show();
  if (mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true);
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
  mainWindow.on("focus", () => mainWindow.flashFrame(false));
}

// ═══════════════════════════════════════════════════════════════
// APP LIFECYCLE
// ═══════════════════════════════════════════════════════════════
app.whenReady().then(() => {
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

app.on("before-quit", () => {
  isQuitting = true;
});

// Accept self-signed certs in dev
app.on("certificate-error", (event, wc, url, error, cert, callback) => {
  event.preventDefault();
  callback(true);
});
