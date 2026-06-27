const path = require("node:path");

const bridge = require(path.join(__dirname, "build/Release/mpv_render_bridge.node"));

function success(id, payload) {
  if (process.send) {
    process.send({ id, ok: true, payload });
  }
}

function failure(id, error) {
  if (process.send) {
    process.send({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function assertOk(result) {
  if (result && result.ok === false) {
    throw new Error(result.error || "libmpv render bridge command failed");
  }
  return result;
}

process.on("message", (message) => {
  const id = message?.id;
  const command = message?.command;
  if (!id || !command) {
    return;
  }

  try {
    switch (command.type) {
      case "info":
        success(id, {
          available: true,
          build: bridge.getBuildInfo(),
          probe: assertOk(bridge.probeRenderContext()),
          textureProbe: bridge.probeWebglTextureRenderer(),
        });
        break;
      case "probeWebglTextureRenderer":
        success(id, bridge.probeWebglTextureRenderer());
        break;
      case "load":
        success(id, assertOk(bridge.load(command.path)));
        break;
      case "setTrack":
        success(id, assertOk(bridge.setTrack(command.kind, command.id ?? null)));
        break;
      case "addSubtitle":
        success(id, assertOk(bridge.addSubtitle(command.path)));
        break;
      case "setPause":
        success(id, assertOk(bridge.setPause(Boolean(command.paused))));
        break;
      case "seek":
        success(id, assertOk(bridge.seek(Number(command.position) || 0)));
        break;
      case "setVolume":
        success(id, assertOk(bridge.setVolume(Number(command.volume) || 0)));
        break;
      case "stop":
        success(id, assertOk(bridge.stop()));
        break;
      case "state":
        success(id, assertOk(bridge.getState()));
        break;
      case "renderFrame":
        success(id, assertOk(bridge.renderFrame(command.width, command.height)));
        break;
      case "shutdown":
        success(id, assertOk(bridge.shutdown()));
        process.exit(0);
        break;
      default:
        throw new Error(`unsupported renderer command: ${command.type}`);
    }
  } catch (error) {
    failure(id, error);
  }
});

process.on("disconnect", () => {
  try {
    bridge.shutdown();
  } finally {
    process.exit(0);
  }
});
