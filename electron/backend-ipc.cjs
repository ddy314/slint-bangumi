const http = require("node:http");
const { BrowserWindow, ipcMain, shell } = require("electron");

const PROGRESS_EVENT_THROTTLE_MS = 100;
const throttledEventTypes = new Set(["scanProgress", "metadataProgress"]);
const flushBeforeEventTypes = new Set(["scanStarted", "scanFinished", "scanFailed", "metadataFailed"]);

function registerBackendIpc(backendClient, options = {}) {
  const onSettingsChanged = typeof options.onSettingsChanged === "function"
    ? options.onSettingsChanged
    : async () => {};
  let pendingProgressEvents = new Map();
  let progressFlushTimer = null;
  let lastProgressFlushAt = 0;
  let bangumiOAuthServer = null;

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

  const stopBangumiOAuthServer = () => {
    if (bangumiOAuthServer) {
      bangumiOAuthServer.close();
      bangumiOAuthServer = null;
    }
  };

  const startBangumiOAuthServer = (login) => new Promise((resolve, reject) => {
    stopBangumiOAuthServer();
    const redirect = new URL(login.redirectUri);
    const port = Number(redirect.port || 80);
    const expectedPath = redirect.pathname;
    const expectedState = login.state;

    const server = http.createServer(async (request, response) => {
      const requestUrl = new URL(request.url || "/", login.redirectUri);
      if (requestUrl.pathname !== expectedPath) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not Found");
        return;
      }

      const code = requestUrl.searchParams.get("code") || "";
      const state = requestUrl.searchParams.get("state") || "";
      const error = requestUrl.searchParams.get("error") || "";
      if (error) {
        response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        response.end("<h1>NexPlay Bangumi 登录失败</h1><p>可以关闭这个窗口。</p>");
        sendBackendEvent({ type: "bangumiOAuthFailed", message: error });
        stopBangumiOAuthServer();
        return;
      }
      if (!code || state !== expectedState) {
        response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        response.end("<h1>NexPlay Bangumi 登录失败</h1><p>OAuth state 不匹配，可以关闭这个窗口。</p>");
        sendBackendEvent({ type: "bangumiOAuthFailed", message: "Bangumi OAuth state mismatch" });
        stopBangumiOAuthServer();
        return;
      }

      try {
        const status = await backendClient.request("completeBangumiOAuth", { code, state });
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end("<h1>NexPlay Bangumi 登录完成</h1><p>可以关闭这个窗口并回到 NexPlay。</p>");
        sendBackendEvent({
          type: "bangumiOAuthCompleted",
          message: status.nickname || status.username || "Bangumi 登录完成",
        });
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        response.writeHead(500, { "content-type": "text/html; charset=utf-8" });
        response.end("<h1>NexPlay Bangumi 登录失败</h1><p>可以关闭这个窗口并回到 NexPlay 查看错误。</p>");
        sendBackendEvent({ type: "bangumiOAuthFailed", message });
      } finally {
        stopBangumiOAuthServer();
      }
    });

    server.once("error", reject);
    server.listen(port, redirect.hostname, () => {
      bangumiOAuthServer = server;
      resolve();
    });
  });

  ipcMain.handle("backend:snapshot", () => backendClient.request("snapshot"));
  ipcMain.handle("backend:scan", () => backendClient.request("scanLibrary"));
  ipcMain.handle("backend:settings", () => backendClient.request("getSettings"));
  ipcMain.handle("backend:save-settings", async (_event, payload) => {
    const settings = await backendClient.request("saveSettings", payload);
    try {
      await onSettingsChanged(settings);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[backend] failed to refresh settings-dependent state: ${message}`);
    }
    return settings;
  });
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
  ipcMain.handle("backend:prepare-resource-download", (_event, payload) => (
    backendClient.request("prepareResourceDownload", payload)
  ));
  ipcMain.handle("backend:confirm-resource-download", (_event, payload) => (
    backendClient.request("confirmResourceDownload", payload)
  ));
  ipcMain.handle("backend:download-tasks", () => backendClient.request("downloadTasks"));
  ipcMain.handle("backend:control-download-task", (_event, payload) => (
    backendClient.request("controlDownloadTask", payload)
  ));
  ipcMain.handle("backend:bangumi-auth-status", () => backendClient.request("bangumiAuthStatus"));
  ipcMain.handle("backend:start-bangumi-login", async () => {
    const login = await backendClient.request("startBangumiLogin");
    await startBangumiOAuthServer(login);
    await shell.openExternal(login.authorizeUrl);
    return login;
  });
  ipcMain.handle("backend:complete-bangumi-oauth", (_event, payload) => (
    backendClient.request("completeBangumiOAuth", payload)
  ));
  ipcMain.handle("backend:logout-bangumi", () => backendClient.request("logoutBangumi"));
  ipcMain.handle("backend:sync-bangumi-now", () => backendClient.request("syncBangumiNow"));
  ipcMain.handle("backend:sync-bangumi-subject", (_event, payload) => (
    backendClient.request("syncBangumiSubject", payload)
  ));
  ipcMain.handle("backend:update-bangumi-collection", (_event, payload) => (
    backendClient.request("updateBangumiCollection", payload)
  ));
  ipcMain.handle("backend:update-bangumi-episode", (_event, payload) => (
    backendClient.request("updateBangumiEpisode", payload)
  ));
  ipcMain.handle("backend:batch-update-bangumi-episodes", (_event, payload) => (
    backendClient.request("batchUpdateBangumiEpisodes", payload)
  ));
  ipcMain.handle("backend:report-playback-progress", (_event, payload) => (
    backendClient.request("reportPlaybackProgress", payload)
  ));
  ipcMain.handle("backend:test-qbittorrent", () => backendClient.request("testQbittorrentConnection"));
}

module.exports = {
  registerBackendIpc,
};
