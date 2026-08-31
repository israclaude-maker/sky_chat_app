const { contextBridge, ipcRenderer } = require("electron");

// Expose a DesktopBridge to the web page (similar to AndroidBridge in APK)
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

    cancelAllNotifications: () => {
    ipcRenderer.send("cancel-all-notifications");
  },

  // Remote Control request notification
  showRCNotification: (requesterName, requesterId) => {
    ipcRenderer.send("show-rc-notification", { requesterName, requesterId });
  },
  cancelRCNotification: () => {
    ipcRenderer.send("cancel-rc-notification");
  },
  onRCNotificationAction: (callback) => {
    ipcRenderer.on("rc-notification-action", (event, data) => callback(data));
  },

  // Window control
  isBackground: () => ipcRenderer.sendSync("is-background"),
  flashWindow: () => ipcRenderer.send("flash-window"),
  setBadgeCount: (count) => ipcRenderer.send("set-badge-count", count),

  // Remote Control
  sendRCEvent: (data) => ipcRenderer.send("rc-event", data),
  startCursorOverlay: (name, selfName) =>
    ipcRenderer.send("rc-start-overlay", { name, selfName }),
  stopCursorOverlay: () => ipcRenderer.send("rc-stop-overlay"),

  // Screen share border indicator
  startScreenShareBorder: () => ipcRenderer.send("share-border-start"),
  stopScreenShareBorder: () => ipcRenderer.send("share-border-stop"),

  // Callbacks from main process
  onCallAction: (callback) => {
    ipcRenderer.on("call-action", (event, action) => callback(action));
  },
  onNotificationClick: (callback) => {
    ipcRenderer.on("notification-click", (event, data) => callback(data));
  },
});

// Also expose as ElectronBridge for explicit detection
contextBridge.exposeInMainWorld("ElectronBridge", {
  isElectron: true,
  platform: process.platform,
});