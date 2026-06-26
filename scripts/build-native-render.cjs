const { spawnSync } = require("node:child_process");

if (process.platform === "win32" && process.env.NEXPLAY_REQUIRE_NATIVE_RENDER !== "1") {
  console.log("Skipping native mpv render bridge build on Windows.");
  process.exit(0);
}

const result = spawnSync(
  process.platform === "win32" ? "node-gyp.cmd" : "node-gyp",
  ["rebuild", "--directory", "native/mpv-render-bridge"],
  {
    stdio: "inherit",
    shell: false,
  },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
