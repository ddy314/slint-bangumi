const { BrowserWindow, ipcMain } = require("electron");

const PROGRESS_EVENT_THROTTLE_MS = 100;
const throttledEventTypes = new Set(["scanProgress", "metadataProgress"]);
const flushBeforeEventTypes = new Set(["scanStarted", "scanFinished", "scanFailed", "metadataFailed"]);

function registerBackendIpc(backendClient) {
  let pendingProgressEvents = new Map();
  let progressFlushTimer = null;
  let lastProgressFlushAt = 0;

  const sendBackendEvent = (event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("backend:event", event);
    }
  };

  const flushProgressEvents = () => {
    if (progressFlushTimer !== null) {
      clearTimeout(progressFlushTimer);
      progressFlushTimer = null;
    }
    if (pendingProgressEvents.size === 0) {
      return;
    }
    const events = Array.from(pendingProgressEvents.values());
    pendingProgressEvents = new Map();
    lastProgressFlushAt = Date.now();
    for (const event of events) {
      sendBackendEvent(event);
    }
  };

  const queueProgressEvent = (event) => {
    pendingProgressEvents.set(event.type, event);
    const elapsed = Date.now() - lastProgressFlushAt;
    if (elapsed >= PROGRESS_EVENT_THROTTLE_MS) {
      flushProgressEvents();
      return;
    }
    if (progressFlushTimer === null) {
      progressFlushTimer = setTimeout(flushProgressEvents, PROGRESS_EVENT_THROTTLE_MS - elapsed);
    }
  };

  backendClient.on("backend:event", (event) => {
    if (throttledEventTypes.has(event.type)) {
      queueProgressEvent(event);
      return;
    }
    if (flushBeforeEventTypes.has(event.type)) {
      flushProgressEvents();
    }
    sendBackendEvent(event);
  });

  ipcMain.handle("backend:snapshot", () => backendClient.request("snapshot"));
  ipcMain.handle("backend:scan", () => backendClient.request("scanLibrary"));
  ipcMain.handle("backend:settings", () => backendClient.request("getSettings"));
  ipcMain.handle("backend:save-settings", (_event, payload) => (
    backendClient.request("saveSettings", payload)
  ));
  ipcMain.handle("backend:open-media", (_event, mediaId) => (
    backendClient.request("openMedia", { mediaId })
  ));
  ipcMain.handle("backend:media-source", (_event, mediaId) => (
    backendClient.request("mediaSource", { mediaId })
  ));
  ipcMain.handle("backend:danmaku-track", (_event, mediaId) => (
    backendClient.request("danmakuTrack", { mediaId })
  ));
  ipcMain.handle("backend:search-catalog", (_event, payload) => (
    backendClient.request("searchCatalog", payload)
  ));
  ipcMain.handle("backend:online-subject", (_event, payload) => (
    backendClient.request("onlineSubject", payload)
  ));
  ipcMain.handle("backend:refresh-subject-metadata", (_event, payload) => (
    backendClient.request("refreshSubjectMetadata", payload)
  ));
  ipcMain.handle("backend:episode-resources", (_event, payload) => (
    backendClient.request("episodeResources", payload)
  ));
  ipcMain.handle("backend:start-resource-download", (_event, payload) => (
    backendClient.request("startResourceDownload", payload)
  ));
  ipcMain.handle("backend:download-tasks", () => backendClient.request("downloadTasks"));
  ipcMain.handle("backend:control-download-task", (_event, payload) => (
    backendClient.request("controlDownloadTask", payload)
  ));
  ipcMain.handle("backend:test-qbittorrent", () => backendClient.request("testQbittorrentConnection"));
}

module.exports = {
  registerBackendIpc,
};
