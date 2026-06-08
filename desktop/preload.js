const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("DesktopBridge", {
  // Notifications
  showCallNotification: (callerName, callType, callId, callerId) => {
    ipcRenderer.send("show-call-notification", {
      callerName,
      callType,
      callId,
      callerId,
    });
  },
  cancelCallNotification: () => {
    ipcRenderer.send("cancel-call-notification");
  },
  showMessageNotification: (senderName, message, avatar) => {
    ipcRenderer.send("show-message-notification", {
      senderName,
      message,
      avatar,
    });
  },
  cancelAllNotifications: () => {
    ipcRenderer.send("cancel-all-notifications");
  },

  // Window control
  isBackground: () => ipcRenderer.sendSync("is-background"),
  flashWindow: () => ipcRenderer.send("flash-window"),
  setBadgeCount: (count) => ipcRenderer.send("set-badge-count", count),

  // Remote Control — seedha main process ko bhejo, loop nahi
  sendRCEvent: (data) => {
    ipcRenderer.send("rc-event", data);
  },

  // Callbacks from main process
  onCallAction: (callback) => {
    ipcRenderer.on("call-action", (event, action) => callback(action));
  },
  onNotificationClick: (callback) => {
    ipcRenderer.on("notification-click", (event, data) => callback(data));
  },
});

// Electron detection
contextBridge.exposeInMainWorld("ElectronBridge", {
  isElectron: true,
  platform: process.platform,
});

// ← YAHAN SE WALI LINE HATA DI — infinite loop thi
// ipcRenderer.on('rc-event',(_,d)=>ipcRenderer.send('rc-event',d));
