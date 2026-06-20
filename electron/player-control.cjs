const { ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const { fileURLToPath } = require("node:url");

const { backendArgs } = require("./backend-rpc-client.cjs");

class PlayerControl {
  constructor({ projectRoot, backendClient, renderBridge }) {
    this.projectRoot = projectRoot;
    this.backendClient = backendClient;
    this.renderBridge = renderBridge;
    this.playerDaemon = null;
    this.nextPlayerRequestId = 1;
    this.pendingPlayerRequests = new Map();
  }

  registerIpc() {
    ipcMain.handle("mpv:load", (_event, mediaId) => this.loadMpvMedia(mediaId));
    ipcMain.handle("mpv:set-track", (_event, payload) => this.controlMpv(
      { type: "setTrack", kind: payload.kind, id: payload.id ?? null },
      () => this.playerRequest({
        type: "setTrack",
        kind: payload.kind,
        id: payload.id ?? null,
      }),
    ));
    ipcMain.handle("mpv:set-pause", (_event, paused) => this.controlMpv(
      { type: "setPause", paused },
      () => this.playerRequest({ type: "setPause", paused }),
    ));
    ipcMain.handle("mpv:seek", (_event, position) => this.controlMpv(
      { type: "seek", position },
      () => this.playerRequest({ type: "seek", position }),
    ));
    ipcMain.handle("mpv:set-volume", (_event, volume) => this.controlMpv(
      { type: "setVolume", volume },
      () => this.playerRequest({ type: "setVolume", volume }),
    ));
    ipcMain.handle("mpv:stop", () => this.controlMpv(
      { type: "stop" },
      () => this.playerRequest({ type: "stop" }),
    ));
    ipcMain.handle("mpv:state", () => this.controlMpv(
      { type: "state" },
      () => this.playerRequest({ type: "state" }),
    ));
    ipcMain.handle("mpv-render:info", () => this.renderBridge.getInfo());
    ipcMain.handle("mpv-render:probe-webgl-texture", () => (
      this.renderBridge.probeWebglTextureRenderer()
    ));
    ipcMain.handle("mpv-render:frame", async (_event, payload) => {
      const width = Math.min(Math.max(Math.round(Number(payload.width) || 2), 2), 3840);
      const height = Math.min(Math.max(Math.round(Number(payload.height) || 2), 2), 2160);
      const frame = await this.renderBridge.request({ type: "renderFrame", width, height });
      if (frame && frame.ok === false) {
        throw new Error(frame.error || "failed to render diagnostic libmpv frame");
      }
      return {
        ...frame,
        diagnosticOnly: false,
      };
    });
  }

  async loadMpvMedia(mediaId) {
    const source = await this.backendClient.request("mediaSource", { mediaId });
    const mediaPath = source.sourceUrl.startsWith("file://")
      ? fileURLToPath(source.sourceUrl)
      : source.sourceUrl;
    const bridgeInfo = await this.renderBridge.getInfo();
    const textureProbe = await this.renderBridge.probeWebglTextureRenderer();
    const canUseTextureRenderer = Boolean(bridgeInfo.available && textureProbe.ok);
    const state = canUseTextureRenderer
      ? await this.renderBridge.request({ type: "load", path: mediaPath })
      : await this.playerRequest({ type: "load", path: mediaPath });
    if (state && state.ok === false) {
      throw new Error(state.error || "libmpv failed to load media");
    }
    return {
      ...state,
      source,
      renderMode: canUseTextureRenderer ? "webglTexture" : "externalMpv",
      textureProbe,
    };
  }

  async controlMpv(command, fallback) {
    const textureProbe = await this.renderBridge.probeWebglTextureRenderer();
    if (textureProbe.ok) {
      let state;
      switch (command.type) {
        case "setTrack":
          state = await this.renderBridge.request({ type: "setTrack", kind: command.kind, id: command.id ?? null });
          break;
        case "setPause":
          state = await this.renderBridge.request({ type: "setPause", paused: Boolean(command.paused) });
          break;
        case "seek":
          state = await this.renderBridge.request({ type: "seek", position: command.position });
          break;
        case "setVolume":
          state = await this.renderBridge.request({ type: "setVolume", volume: command.volume });
          break;
        case "stop":
          state = await this.renderBridge.request({ type: "stop" });
          break;
        case "state":
          state = await this.renderBridge.request({ type: "state" });
          break;
        default:
          throw new Error(`unsupported native mpv command: ${command.type}`);
      }
      if (state && state.ok === false) {
        throw new Error(state.error || "libmpv renderer command failed");
      }
      return state;
    }
    return fallback();
  }

  ensurePlayerDaemon() {
    if (this.playerDaemon && !this.playerDaemon.killed) {
      return this.playerDaemon;
    }

    const { executable, args } = backendArgs("player-daemon");
    const child = spawn(executable, args, {
      cwd: this.projectRoot,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.playerDaemon = child;
    let stdoutBuffer = "";

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let response;
        try {
          response = JSON.parse(trimmed);
        } catch {
          continue;
        }
        const pending = this.pendingPlayerRequests.get(response.id);
        if (!pending) continue;
        this.pendingPlayerRequests.delete(response.id);
        if (response.ok) {
          pending.resolve(response.state || {});
        } else {
          pending.reject(new Error(response.error || "libmpv request failed"));
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (text) {
        console.warn(`[libmpv] ${text}`);
      }
    });

    child.on("close", () => {
      if (this.playerDaemon === child) {
        this.playerDaemon = null;
      }
      this.rejectPendingPlayerRequests(new Error("libmpv daemon exited"));
    });

    child.on("error", (error) => {
      this.rejectPendingPlayerRequests(error);
    });

    return child;
  }

  playerRequest(command) {
    const child = this.ensurePlayerDaemon();
    const id = this.nextPlayerRequestId++;
    const payload = JSON.stringify({ id, command });
    return new Promise((resolve, reject) => {
      this.pendingPlayerRequests.set(id, { resolve, reject });
      child.stdin.write(`${payload}\n`, (error) => {
        if (error) {
          this.pendingPlayerRequests.delete(id);
          reject(error);
        }
      });
    });
  }

  rejectPendingPlayerRequests(error) {
    for (const pending of this.pendingPlayerRequests.values()) {
      pending.reject(error);
    }
    this.pendingPlayerRequests.clear();
  }

  shutdown() {
    if (this.playerDaemon) {
      this.playerDaemon.kill();
      this.playerDaemon = null;
    }
    this.rejectPendingPlayerRequests(new Error("libmpv daemon stopped"));
  }
}

module.exports = {
  PlayerControl,
};
