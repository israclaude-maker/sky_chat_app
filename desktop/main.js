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

// ─── Debug logging to file (kyunki packaged .exe mein terminal nahi dikhta) ───
const fs = require("fs");
const logFile = path.join(app.getPath("userData"), "rc-debug.log");
function rcLog(...args) {
  const line = "[" + new Date().toISOString() + "] " + args.join(" ") + "\n";
  try { fs.appendFileSync(logFile, line); } catch (e) {}
  console.log(...args);
}

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
    .catch(() => { });
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
const { screen } = require("electron");
const koffi = require("koffi");

// ─── Native Windows cursor hide/restore ───────────────────────
let overlayWindow = null;
let cursorHidden = false;
let user32, SetSystemCursor, SystemParametersInfoW, CreateCursorFn, CopyIconFn, blankCursor;

function initNativeCursorAPI() {
  if (user32) return true;
  try {
    user32 = koffi.load("user32.dll");
    SetSystemCursor = user32.func("__stdcall", "SetSystemCursor", "bool", ["void*", "uint32"]);
    SystemParametersInfoW = user32.func("__stdcall", "SystemParametersInfoW", "bool", ["uint32", "uint32", "void*", "uint32"]);
    CreateCursorFn = user32.func("__stdcall", "CreateCursor", "void*", ["void*", "int", "int", "int", "int", "void*", "void*"]);
    CopyIconFn = user32.func("__stdcall", "CopyIcon", "void*", ["void*"]);

    // Fully transparent 32x32 cursor (AND mask all 1s = invisible, XOR mask all 0s)
    const AND = Buffer.alloc(128, 0xff);
    const XOR = Buffer.alloc(128, 0x00);
    blankCursor = CreateCursorFn(null, 0, 0, 32, 32, AND, XOR);
    rcLog("[RC] initNativeCursorAPI ok, blankCursor handle:", blankCursor);
    return !!blankCursor;
  } catch (e) {
    rcLog("[RC] Native cursor API init failed:", e.message, e.stack);
    return false;
  }
}

// Standard Windows system cursor IDs (OCR_*)
const OCR_IDS = [32512, 32513, 32514, 32515, 32516, 32640, 32641, 32642, 32643, 32644, 32645, 32646, 32648, 32649, 32650, 32651];
const OCR_NAMES = {
  32512: "OCR_NORMAL (default arrow)",
  32513: "OCR_IBEAM",
  32514: "OCR_WAIT",
  32515: "OCR_CROSS",
  32516: "OCR_UP",
  32640: "OCR_SIZE",
  32641: "OCR_ICON",
  32642: "OCR_SIZENWSE",
  32643: "OCR_SIZENESW",
  32644: "OCR_SIZEWE",
  32645: "OCR_SIZENS",
  32646: "OCR_SIZEALL",
  32648: "OCR_NO",
  32649: "OCR_HAND",
  32650: "OCR_APPSTARTING",
  32651: "OCR_HELP",
};

function hideSystemCursor() {
  if (cursorHidden) { rcLog("[RC] hideSystemCursor: already hidden, skipping"); return; }
  if (!initNativeCursorAPI()) { rcLog("[RC] hideSystemCursor: initNativeCursorAPI failed"); return; }
  if (!blankCursor) { rcLog("[RC] hideSystemCursor: blankCursor handle is falsy:", blankCursor); return; }
  let okCount = 0, failCount = 0;
  const failedNames = [];
  OCR_IDS.forEach((id) => {
    try {
      const copy = CopyIconFn(blankCursor); // SetSystemCursor consumes the handle, so copy each time
      const result = SetSystemCursor(copy, id);
      if (result) okCount++; else { failCount++; failedNames.push(OCR_NAMES[id] || id); }
    } catch (e) {
      failCount++;
      failedNames.push((OCR_NAMES[id] || id) + " (threw: " + e.message + ")");
    }
  });
  rcLog("[RC] hideSystemCursor done — ok:", okCount, "failed:", failCount, "of", OCR_IDS.length, "| failed IDs:", failedNames.join(", "));
  cursorHidden = true;
}

function restoreSystemCursor() {
  if (!cursorHidden) return;
  try {
    const r = SystemParametersInfoW(0x0057 /* SPI_SETCURSORS */, 0, null, 0);
    rcLog("[RC] restoreSystemCursor SystemParametersInfoW result:", r);
  } catch (e) {
    rcLog("[RC] restoreSystemCursor failed:", e.message);
  }
  cursorHidden = false;
}

// ─── Cursor overlay window (shows BOTH the "Controller" cursor AND the
//     screen-owner's own real cursor, labeled separately) ───────────
function createCursorOverlay(controllerName, selfName) {
  // Defensive: if overlayWindow points to an already-destroyed window
  // (stale reference), treat it as gone and proceed to create a fresh one.
  if (overlayWindow && overlayWindow.isDestroyed()) {
    rcLog("[RC] createCursorOverlay: clearing stale destroyed overlayWindow reference");
    overlayWindow = null;
  }
  if (overlayWindow) {
    rcLog("[RC] createCursorOverlay: overlay already exists and is alive, skipping");
    return;
  }
  const display = screen.getPrimaryDisplay();
  overlayWindow = new BrowserWindow({
    x: 0, y: 0,
    width: display.bounds.width,
    height: display.bounds.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    resizable: false,
    webPreferences: { contextIsolation: false, nodeIntegration: true },
  });
  overlayWindow.setIgnoreMouseEvents(true);
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.loadFile(path.join(__dirname, "cursor-overlay.html"));
  overlayWindow.webContents.once("did-finish-load", () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    overlayWindow.webContents.send("set-names", {
      controllerName: controllerName || "Controller",
      selfName: selfName || "Me",
    });
    // Seed the "self" badge at wherever the real cursor already is,
    // so it doesn't default to (0,0) before the first poll tick.
    const seed = getRealCursorPos();
    rcLog("[RC] overlay loaded, seed self pos:", JSON.stringify(seed), "scaleFactor:", getScaleFactor());
    if (seed) overlayWindow.webContents.send("move-self-cursor", toOverlayCoords(seed.x, seed.y));
  });
  overlayWindow.on("closed", () => { overlayWindow = null; });
}

function destroyCursorOverlay() {
  if (!overlayWindow) return;
  try {
    if (!overlayWindow.isDestroyed()) {
      // .destroy() is synchronous/forceful and guaranteed to remove the
      // window immediately — unlike .close(), which is async and can be
      // slow or silently fail to actually go away, leaving an orphaned
      // "zombie" overlay window behind that a later createCursorOverlay()
      // call won't know about (since we'd have already nulled the
      // reference). That zombie window is exactly what was causing extra
      // stale badges to show up across sessions.
      overlayWindow.destroy();
    }
  } catch (e) {
    rcLog("[RC] destroyCursorOverlay error:", e.message);
  }
  overlayWindow = null;
}

// Controller's (remote) cursor — driven purely by incoming RC coordinates,
// never touches the real OS pointer.
//
// IMPORTANT — DPI SCALING: robotjs (getMousePos/moveMouse/getScreenSize)
// works in PHYSICAL pixels, but the Electron overlay BrowserWindow lays
// out in DIP/logical pixels. On any display where Windows scaling isn't
// exactly 100% (125%, 150% are very common), sending raw robot-space
// coordinates straight to the overlay puts the badge off-canvas —
// which looks exactly like "badge never appears". We convert every
// position through toOverlayCoords() before sending it to the HTML.
function getScaleFactor() {
  try {
    return screen.getPrimaryDisplay().scaleFactor || 1;
  } catch (e) {
    return 1;
  }
}
function toOverlayCoords(x, y) {
  const sf = getScaleFactor();
  return { x: x / sf, y: y / sf };
}

function updateOverlayCursor(x, y) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    const p = toOverlayCoords(x, y);
    overlayWindow.webContents.send("move-cursor", p);
  }
}

// Performs a real click at (x,y) on the screen-owner's machine, then
// snaps the real OS cursor back to wherever the screen-owner had last
// actually left it — so their real cursor doesn't visibly "stick" at
// the click point afterward. `suppressSelfTrackUntil` stops the self
// poll from mistaking this teleport-and-restore for genuine movement.
function performRemoteClick(x, y, button) {
  const restoreTo = lastKnownSelfPos; // where Isra genuinely left it
  suppressSelfTrackUntil = Date.now() + 250;
  rcLog("[RC] performRemoteClick", button, "target:", x, y, "will restore to:", JSON.stringify(restoreTo));
  robot.moveMouse(x, y);
  updateOverlayCursor(x, y);
  setTimeout(() => {
    try { robot.mouseClick(button); } catch (e) { rcLog("[RC] mouseClick failed:", e.message); }
    setTimeout(() => {
      if (restoreTo) {
        try {
          robot.moveMouse(restoreTo.x, restoreTo.y);
          rcLog("[RC] restored real cursor to:", JSON.stringify(restoreTo));
        } catch (e) { rcLog("[RC] restore moveMouse failed:", e.message); }
      } else {
        rcLog("[RC] no restoreTo position available — lastKnownSelfPos was null");
      }
    }, 25);
  }, 30);
}

// ─── Real cursor position — used to track the screen owner's OWN
//     physical mouse, independent of anything robot.moveMouse does.
//     Uses robotjs's own getMousePos() (already a proven dependency in
//     this file for moveMouse/click/scroll) instead of a hand-rolled
//     koffi/GetCursorPos buffer call, which was unreliable. ───────────
function getRealCursorPos() {
  try {
    const p = robot.getMousePos();
    if (!p || typeof p.x !== "number") return null;
    return { x: p.x, y: p.y };
  } catch (e) {
    rcLog("[RC] getRealCursorPos failed:", e.message);
    return null;
  }
}

// Tracks the screen-owner's last known REAL position, i.e. wherever they
// themselves actually left the mouse. Updated by the poll below whenever
// we're NOT in the middle of a robot-driven click teleport (see
// `suppressSelfTrackUntil`), and used to snap the real OS cursor back
// after a remote click so it doesn't visibly "stick" at the click point.
let lastKnownSelfPos = null;
let suppressSelfTrackUntil = 0; // Date.now() timestamp

let selfCursorPollTimer = null;
let cursorReassertTimer = null;
let _selfPollTickCount = 0;
function startSelfCursorPoll() {
  if (selfCursorPollTimer) return;
  lastKnownSelfPos = getRealCursorPos();
  rcLog("[RC] startSelfCursorPoll, initial real pos:", JSON.stringify(lastKnownSelfPos), "scaleFactor:", getScaleFactor());
  selfCursorPollTimer = setInterval(() => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    if (Date.now() < suppressSelfTrackUntil) return; // mid-click teleport — don't record this as "real"
    const pos = getRealCursorPos();
    if (pos) {
      lastKnownSelfPos = pos;
      const p = toOverlayCoords(pos.x, pos.y);
      overlayWindow.webContents.send("move-self-cursor", p);
      _selfPollTickCount++;
      if (_selfPollTickCount % 50 === 1) {
        // log roughly every ~2s so the file doesn't explode, but confirms it's alive
        rcLog("[RC] self poll tick, real:", JSON.stringify(pos), "sent(overlay-space):", JSON.stringify(p));
      }
    }
  }, 40); // ~25fps — smooth enough, cheap enough

  // Windows sometimes silently resets the system cursor scheme mid-session
  // (theme/display events, or another app calling SystemParametersInfoW).
  // Re-apply the blank cursor every 3s while RC is active as a safety net.
  cursorReassertTimer = setInterval(() => {
    cursorHidden = false; // force hideSystemCursor() to actually re-run, not skip
    hideSystemCursor();
  }, 3000);
}
function stopSelfCursorPoll() {
  if (selfCursorPollTimer) {
    clearInterval(selfCursorPollTimer);
    selfCursorPollTimer = null;
  }
  if (cursorReassertTimer) {
    clearInterval(cursorReassertTimer);
    cursorReassertTimer = null;
  }
  lastKnownSelfPos = null;
  suppressSelfTrackUntil = 0;
  _selfPollTickCount = 0;
}

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
  rcLog("[RC] Raw data received:", rawData);
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
      // IMPORTANT: do NOT move the real OS cursor here — only update the
      // visual "Controller" badge in the overlay window. This keeps the
      // real system cursor free to reflect the screen-owner's own hand,
      // so the self-cursor poll (used for the "self" badge) stays
      // trustworthy. The real cursor only teleports at actual click time
      // (below), and is restored right after — see performRemoteClick().
      updateOverlayCursor(x, y);
    } else if (data.event === "click") {
      performRemoteClick(x, y, "left");
    } else if (data.event === "rightclick") {
      performRemoteClick(x, y, "right");
    } else if (data.event === "scroll") {
      // ── Scroll: correct API + fast speed ──
      // Adjust SCROLL_MULTIPLIER to control speed (higher = faster)
      var SCROLL_MULTIPLIER = 8;
      var scrollAmt = Math.max(15, Math.floor((data.delta || 120) / 3)) * SCROLL_MULTIPLIER;
      var dir = data.direction || "down";
      try {
        var yVal = dir === "up" ? -scrollAmt : scrollAmt;
        robot.scrollMouse(0, yVal);
      } catch (e) {
        // Keyboard fallback
        try {
          robot.keyTap(dir === "up" ? "pageup" : "pagedown");
        } catch (e2) { }
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
          } catch (e) { }
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
            } catch (e2) { }
          }
        }
      } else if (keyMap[k]) {
        // Special keys: Enter, Backspace, ArrowLeft, Tab, etc.
        try {
          robot.keyTap(keyMap[k], modifiers);
        } catch (e) { }
      }
    }
  } catch (e) {
    console.error("[RC] Error:", e.message);
  }
});
ipcMain.on("rc-start-overlay", (event, data) => {
  rcLog("[RC] rc-start-overlay IPC received, name:", data && data.name, "selfName:", data && data.selfName);
  // Guaranteed clean slate: force-destroy any overlay that might still be
  // hanging around (e.g. from a previous RC session in this same running
  // app that didn't get torn down cleanly) before creating a fresh one.
  // This prevents stale "zombie" overlay windows from ever stacking up.
  destroyCursorOverlay();
  createCursorOverlay(data && data.name, data && data.selfName);
  startSelfCursorPoll();
  // Hide the real OS cursor (Windows-level, via SetSystemCursor). This IS
  // still needed: Electron's desktopCapturer-based screen share (used via
  // setDisplayMediaRequestHandler) does NOT respect the `cursor: "never"`
  // MediaTrackConstraint set in chat.js's getDisplayMedia calls — that
  // constraint only applies to Chromium's native picker flow, not
  // Electron's custom desktopCapturer flow. Without this, the real native
  // cursor gets burned into the captured frame right next to our overlay
  // badges, looking like "2 mice" per badge. This only hides Isra's own
  // LOCAL system cursor while RC is active — self-cursor badge tracking
  // (via robot.getMousePos()) still works fine since it reads real cursor
  // position regardless of its visibility.
  hideSystemCursor();
  rcLog("[RC] after start -> overlayWindow created:", !!overlayWindow, "cursorHidden:", cursorHidden);
});

ipcMain.on("rc-stop-overlay", () => {
  rcLog("[RC] rc-stop-overlay IPC received");
  destroyCursorOverlay();
  stopSelfCursorPoll();
  restoreSystemCursor();
});
app.on("before-quit", () => {
  isQuitting = true;
  restoreSystemCursor();
});

// Accept self-signed certs in dev
app.on("certificate-error", (event, wc, url, error, cert, callback) => {
  event.preventDefault();
  callback(true);
});