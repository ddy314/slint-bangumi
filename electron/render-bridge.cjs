const fs = require("node:fs");
const path = require("node:path");
const { fork } = require("node:child_process");

const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const FAST_REQUEST_TIMEOUT_MS = 1800;
const LOAD_REQUEST_TIMEOUT_MS = 15000;
const RENDER_FRAME_TIMEOUT_MS = 1200;

function timeoutForCommand(command) {
  switch (command?.type) {
    case "info":
    case "probeWebglTextureRenderer":
    case "state":
      return FAST_REQUEST_TIMEOUT_MS;
    case "load":
      return LOAD_REQUEST_TIMEOUT_MS;
    case "renderFrame":
      return RENDER_FRAME_TIMEOUT_MS;
    default:
      return DEFAULT_REQUEST_TIMEOUT_MS;
  }
}

class RenderBridge {
  constructor({ projectRoot }) {
    this.projectRoot = projectRoot;
    this.renderDaemon = null;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.info = null;
  }

  async getInfo() {
    if (this.info) {
      return this.info;
    }

    try {
      const info = await this.request({ type: "info" });
      this.info = {
        ...info,
        available: true,
      };
      return this.info;
    } catch (error) {
      this.info = {
        available: false,
        reason: error instanceof Error ? error.message : String(error),
      };
      return this.info;
    }
  }

  async probeWebglTextureRenderer() {
    try {
      return await this.request({ type: "probeWebglTextureRenderer" });
    } catch (error) {
      return {
        ok: false,
        stage: "electronBridge",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  request(command, options = {}) {
    const child = this.ensureStarted();
    const id = this.nextRequestId++;
    const timeoutMs = options.timeoutMs ?? timeoutForCommand(command);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) {
          return;
        }
        const error = new Error(`native render bridge request timed out: ${command?.type || "unknown"}`);
        reject(error);
        this.restart(error);
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      child.send({ id, command }, (error) => {
        if (error) {
          const pending = this.pending.get(id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(id);
          }
          reject(error);
        }
      });
    });
  }

  ensureStarted() {
    if (this.renderDaemon && !this.renderDaemon.killed && this.renderDaemon.connected) {
      return this.renderDaemon;
    }

    const daemonPath = path.join(this.projectRoot, "native/mpv-render-bridge/renderer-daemon.cjs");
    const addonPath = path.join(this.projectRoot, "native/mpv-render-bridge/build/Release/mpv_render_bridge.node");
    if (!fs.existsSync(daemonPath) || !fs.existsSync(addonPath)) {
      throw new Error("native render bridge is not built");
    }

    const execPath = process.env.NEXPLAY_NODE_BIN || process.execPath;
    const env = { ...process.env };
    if (!process.env.NEXPLAY_NODE_BIN) {
      env.ELECTRON_RUN_AS_NODE = "1";
    }

    const child = fork(daemonPath, [], {
      cwd: this.projectRoot,
      env,
      execPath,
      serialization: "advanced",
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });

    this.renderDaemon = child;
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (text) {
        console.log(`[mpv-render] ${text}`);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (text) {
        console.warn(`[mpv-render] ${text}`);
      }
    });
    child.on("message", (message) => {
      const pending = this.pending.get(message?.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.ok) {
        pending.resolve(message.payload);
      } else {
        pending.reject(new Error(message.error || "native render bridge request failed"));
      }
    });
    child.on("close", () => {
      if (this.renderDaemon === child) {
        this.renderDaemon = null;
        this.info = null;
      }
      this.rejectPending(new Error("native render bridge exited"));
    });
    child.on("error", (error) => {
      this.rejectPending(error);
    });

    return child;
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  restart(error) {
    const child = this.renderDaemon;
    if (!child) {
      return;
    }
    this.renderDaemon = null;
    this.info = null;
    this.rejectPending(error);
    child.kill();
  }

  shutdown() {
    if (this.renderDaemon) {
      this.renderDaemon.kill();
      this.renderDaemon = null;
    }
    this.rejectPending(new Error("native render bridge stopped"));
  }
}

module.exports = {
  RenderBridge,
};
