const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { contextBridge, ipcRenderer } = require("electron");

const { RenderBridge } = require("./render-bridge.cjs");

const projectRoot = path.join(__dirname, "..");
const renderBridge = new RenderBridge({ projectRoot });
let activeMpvMode = null;
let activeTextureProbe = null;
let renderInfoPromise = null;
let textureProbePromise = null;

function resolveAssetUrl(value) {
  if (typeof value !== "string" || !value.startsWith("file://")) {
    return value;
  }

  const filePath = decodeURIComponent(value.slice("file://".length));
  return `nexplay-asset://local/${encodeURIComponent(filePath)}`;
}

function mediaPathFromSourceUrl(sourceUrl) {
  return typeof sourceUrl === "string" && sourceUrl.startsWith("file://")
    ? fileURLToPath(sourceUrl)
    : sourceUrl;
}

function normalizeMediaSource(source) {
  return {
    ...source,
    sourceUrl: resolveAssetUrl(source.sourceUrl),
  };
}

function getRenderInfoCached() {
  if (!renderInfoPromise) {
    renderInfoPromise = renderBridge.getInfo().catch((error) => {
      renderInfoPromise = null;
      throw error;
    });
  }
  return renderInfoPromise;
}

function probeWebglTextureRendererCached() {
  if (!textureProbePromise) {
    textureProbePromise = renderBridge.probeWebglTextureRenderer().catch((error) => {
      textureProbePromise = null;
      throw error;
    });
  }
  return textureProbePromise;
}

async function loadMpvMedia(mediaId) {
  const source = await ipcRenderer.invoke("backend:media-source", mediaId);
  const [bridgeInfo, textureProbe] = await Promise.all([
    getRenderInfoCached(),
    probeWebglTextureRendererCached(),
  ]);
  const canUseTextureRenderer = Boolean(bridgeInfo.available && textureProbe.ok);

  if (!canUseTextureRenderer) {
    activeMpvMode = "externalMpv";
    activeTextureProbe = textureProbe;
    return ipcRenderer.invoke("mpv:load", mediaId);
  }

  const state = await renderBridge.request({
    type: "load",
    path: mediaPathFromSourceUrl(source.sourceUrl),
  });
  if (state && state.ok === false) {
    throw new Error(state.error || "libmpv failed to load media");
  }

  activeMpvMode = "webglTexture";
  activeTextureProbe = textureProbe;
  return {
    ...state,
    source: normalizeMediaSource(source),
    renderMode: "webglTexture",
    textureProbe,
  };
}

async function controlMpv(command, fallback) {
  if (activeMpvMode !== "webglTexture") {
    return fallback();
  }

  const state = await renderBridge.request(command);
  if (state && state.ok === false) {
    throw new Error(state.error || "libmpv renderer command failed");
  }
  return state;
}

window.addEventListener("beforeunload", () => {
  renderBridge.shutdown();
});

contextBridge.exposeInMainWorld("nexplay", {
  appName: "NexPlay",
  getSnapshot: () => ipcRenderer.invoke("backend:snapshot"),
  scanLibrary: () => ipcRenderer.invoke("backend:scan"),
  getSettings: () => ipcRenderer.invoke("backend:settings"),
  saveSettings: (settings) => ipcRenderer.invoke("backend:save-settings", settings),
  searchCatalog: (payload) => ipcRenderer.invoke("backend:search-catalog", payload),
  onlineSubject: (payload) => ipcRenderer.invoke("backend:online-subject", payload),
  refreshSubjectMetadata: (payload) => ipcRenderer.invoke("backend:refresh-subject-metadata", payload),
  episodeResources: (payload) => ipcRenderer.invoke("backend:episode-resources", payload),
  startResourceDownload: (payload) => ipcRenderer.invoke("backend:start-resource-download", payload),
  downloadTasks: () => ipcRenderer.invoke("backend:download-tasks"),
  controlDownloadTask: (payload) => ipcRenderer.invoke("backend:control-download-task", payload),
  testQbittorrentConnection: () => ipcRenderer.invoke("backend:test-qbittorrent"),
  openMedia: (mediaId) => ipcRenderer.invoke("backend:open-media", mediaId),
  getMediaSource: async (mediaId) => {
    const source = await ipcRenderer.invoke("backend:media-source", mediaId);
    return normalizeMediaSource(source);
  },
  danmakuTrack: (mediaId) => ipcRenderer.invoke("backend:danmaku-track", mediaId),
  mpvLoad: (mediaId) => loadMpvMedia(mediaId),
  mpvSetTrack: (kind, id) => controlMpv(
    { type: "setTrack", kind, id },
    () => ipcRenderer.invoke("mpv:set-track", { kind, id }),
  ),
  mpvSetPause: (paused) => controlMpv(
    { type: "setPause", paused },
    () => ipcRenderer.invoke("mpv:set-pause", paused),
  ),
  mpvSeek: (position) => controlMpv(
    { type: "seek", position },
    () => ipcRenderer.invoke("mpv:seek", position),
  ),
  mpvSetVolume: (volume) => controlMpv(
    { type: "setVolume", volume },
    () => ipcRenderer.invoke("mpv:set-volume", volume),
  ),
  mpvStop: async () => {
    const state = await controlMpv(
      { type: "stop" },
      () => ipcRenderer.invoke("mpv:stop"),
    );
    activeMpvMode = null;
    activeTextureProbe = null;
    return state;
  },
  mpvState: () => controlMpv(
    { type: "state" },
    () => ipcRenderer.invoke("mpv:state"),
  ),
  mpvRenderInfo: () => getRenderInfoCached(),
  mpvProbeWebglTextureRenderer: async () => {
    textureProbePromise = renderBridge.probeWebglTextureRenderer().catch((error) => {
      textureProbePromise = null;
      throw error;
    });
    activeTextureProbe = await textureProbePromise;
    return activeTextureProbe;
  },
  mpvRenderFrame: async (width, height) => {
    if (activeMpvMode !== "webglTexture") {
      return ipcRenderer.invoke("mpv-render:frame", { width, height });
    }
    return renderBridge.request({ type: "renderFrame", width, height });
  },
  onBackendEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("backend:event", listener);
    return () => ipcRenderer.removeListener("backend:event", listener);
  },
  resolveAssetUrl,
});
