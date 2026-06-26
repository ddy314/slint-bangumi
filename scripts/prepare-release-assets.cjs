const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");
const backendDist = path.join(distRoot, "backend");
const nativeDist = path.join(distRoot, "native", "mpv-render-bridge");
const executableName = process.platform === "win32" ? "nexplay.exe" : "nexplay";
const backendSource = path.join(projectRoot, "target", "release", executableName);

function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  if (process.platform !== "win32") {
    fs.chmodSync(destination, 0o755);
  }
}

function copyDirectoryIfPresent(source, destination) {
  if (!fs.existsSync(source)) {
    return false;
  }
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, { recursive: true });
  return true;
}

if (!fs.existsSync(backendSource)) {
  throw new Error(`release backend binary not found: ${backendSource}`);
}

fs.rmSync(backendDist, { recursive: true, force: true });
copyFile(backendSource, path.join(backendDist, executableName));

fs.rmSync(nativeDist, { recursive: true, force: true });
copyFile(
  path.join(projectRoot, "native", "mpv-render-bridge", "renderer-daemon.cjs"),
  path.join(nativeDist, "renderer-daemon.cjs"),
);
copyFile(
  path.join(projectRoot, "native", "mpv-render-bridge", "package.json"),
  path.join(nativeDist, "package.json"),
);
copyDirectoryIfPresent(
  path.join(projectRoot, "native", "mpv-render-bridge", "build"),
  path.join(nativeDist, "build"),
);

const nativeAddonPath = path.join(nativeDist, "build", "Release", "mpv_render_bridge.node");
if (process.platform !== "win32" && !fs.existsSync(nativeAddonPath)) {
  throw new Error(`native render bridge build not found: ${nativeAddonPath}`);
}

console.log(`Prepared release backend: dist/backend/${executableName}`);
