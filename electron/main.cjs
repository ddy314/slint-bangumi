const { app, BrowserWindow, ipcMain, nativeTheme } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");

const isDev = !app.isPackaged;
const useDevRenderer = isDev && process.env.NEXPLAY_RENDERER_MODE !== "production";
const projectRoot = path.join(__dirname, "..");

app.commandLine.appendSwitch("no-sandbox");

function runBackend(command) {
  const backendBin = process.env.NEXPLAY_BACKEND_BIN;
  const executable = backendBin || "cargo";
  const args = backendBin ? [command] : ["run", "--quiet", "--", command];

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `backend exited with code ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`failed to parse backend JSON: ${error.message}\n${stderr}`));
      }
    });
  });
}

ipcMain.handle("backend:snapshot", () => runBackend("snapshot"));
ipcMain.handle("backend:scan", () => runBackend("scan"));

function createMainWindow() {
  nativeTheme.themeSource = "dark";

  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    title: "NexPlay",
    backgroundColor: "#14110f",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (useDevRenderer) {
    window.loadURL("http://127.0.0.1:5173");
  } else {
    window.loadFile(path.join(__dirname, "../dist/renderer/index.html"));
  }
}

app.whenReady().then(() => {
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
