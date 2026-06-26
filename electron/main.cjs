const path = require("node:path");
const { app, BrowserWindow, Menu, nativeTheme, protocol } = require("electron");

const { registerAssetProtocol } = require("./asset-protocol.cjs");
const { BackendRpcClient } = require("./backend-rpc-client.cjs");
const { registerBackendIpc } = require("./backend-ipc.cjs");
const { PlayerControl } = require("./player-control.cjs");
const { RenderBridge } = require("./render-bridge.cjs");

const isDev = !app.isPackaged;
const useDevRenderer = isDev && process.env.NEXPLAY_RENDERER_MODE !== "production";
const projectRoot = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
let assetRoots = [];

process.env.NEXPLAY_PROJECT_ROOT = projectRoot;

if (app.isPackaged && !process.env.NEXPLAY_CONFIG) {
  process.env.NEXPLAY_CONFIG = path.join(app.getPath("userData"), "config.toml");
}

app.commandLine.appendSwitch("no-sandbox");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "nexplay-asset",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

const backendClient = new BackendRpcClient({ projectRoot });
const renderBridge = new RenderBridge({ projectRoot });
const playerControl = new PlayerControl({
  projectRoot,
  backendClient,
  renderBridge,
});

function resolveConfiguredPath(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return path.isAbsolute(value) ? value : path.join(projectRoot, value);
}

function buildAssetRoots(settings = null) {
  const roots = [app.getPath("userData")];
  if (!app.isPackaged) {
    roots.push(path.join(projectRoot, "data"));
  }

  for (const library of settings?.mediaLibraries || []) {
    const resolved = resolveConfiguredPath(library);
    if (resolved) {
      roots.push(resolved);
    }
  }

  const databasePath = resolveConfiguredPath(settings?.databasePath || "data/nexplay.sqlite3");
  if (databasePath) {
    const databaseDir = path.dirname(databasePath);
    roots.push(databaseDir);
    roots.push(path.join(databaseDir, "cache", "images"));
  }

  return roots;
}

async function refreshAssetRoots() {
  try {
    const settings = await backendClient.request("getSettings");
    assetRoots = buildAssetRoots(settings);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[asset] failed to refresh configured roots: ${message}`);
    assetRoots = buildAssetRoots();
  }
}

registerBackendIpc(backendClient, {
  onSettingsChanged: async () => {
    await refreshAssetRoots();
  },
});
playerControl.registerIpc();

function createMainWindow() {
  nativeTheme.themeSource = "system";
  Menu.setApplicationMenu(null);
  const backgroundColor = nativeTheme.shouldUseDarkColors ? "#1c1c1e" : "#f2f2f7";

  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    title: "NexPlay",
    backgroundColor,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  window.setMenu(null);

  if (useDevRenderer) {
    window.loadURL("http://127.0.0.1:5173");
  } else {
    window.loadFile(path.join(__dirname, "../dist/renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  assetRoots = buildAssetRoots();
  registerAssetProtocol({
    getAllowedRoots: () => assetRoots,
  });
  await refreshAssetRoots();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  playerControl.shutdown();
  renderBridge.shutdown();
  backendClient.shutdown();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
