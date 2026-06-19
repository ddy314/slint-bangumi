const { execFileSync } = require("node:child_process");
const { fork } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const projectRoot = path.resolve(__dirname, "..");
const defaultMedia =
  "/mnt/media/entertainment/bangumi/[SweetSub&LoliHouse] Takopii no Genzai/[SweetSub&LoliHouse] Takopii no Genzai - 01 [WebRip 1080p HEVC-10bit AAC ASSx2].mkv";
const rawArgs = process.argv.slice(2);
const discover = rawArgs.includes("--discover");
const discoverDirCandidate = rawArgs[rawArgs.indexOf("--discover") + 1];
const discoverDirArg = discoverDirCandidate && !discoverDirCandidate.startsWith("--") ? discoverDirCandidate : null;
const limitArg = Number(rawArgs[rawArgs.indexOf("--limit") + 1]);
const discoverProbeLimit = Number.isFinite(limitArg) && limitArg > 0 ? Math.round(limitArg) : 400;
const optionValueIndexes = new Set(
  ["--discover", "--limit"]
    .map((option) => rawArgs.indexOf(option) + 1)
    .filter((index) => index > 0),
);
const mediaArgs = rawArgs.filter((arg, index) => !arg.startsWith("--") && !optionValueIndexes.has(index));
const mediaPath = mediaArgs.join(" ") || process.env.NEXPLAY_DIAG_MEDIA || defaultMedia;
const daemonPath = path.join(projectRoot, "native/mpv-render-bridge/renderer-daemon.cjs");

if (!discover && !fs.existsSync(mediaPath)) {
  console.error(JSON.stringify({ ok: false, error: `media file not found: ${mediaPath}` }, null, 2));
  process.exit(1);
}

const daemon = fork(daemonPath, [], {
  cwd: projectRoot,
  serialization: "advanced",
  stdio: ["ignore", "ignore", "inherit", "ipc"],
});

let nextRequestId = 1;

function request(command, timeoutMs = 20000) {
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      daemon.off("message", onMessage);
      reject(new Error(`timeout waiting for ${command.type}`));
    }, timeoutMs);
    const onMessage = (message) => {
      if (message.id !== id) return;
      clearTimeout(timeout);
      daemon.off("message", onMessage);
      message.ok ? resolve(message.payload) : reject(new Error(message.error));
    };
    daemon.on("message", onMessage);
    daemon.send({ id, command });
  });
}

function frameStats(frame) {
  let nonBlack = 0;
  let alphaNonOpaque = 0;
  for (let index = 0; index < frame.pixels.length; index += 4) {
    if (frame.pixels[index] || frame.pixels[index + 1] || frame.pixels[index + 2]) {
      nonBlack += 1;
    }
    if (frame.pixels[index + 3] !== 255) {
      alphaNonOpaque += 1;
    }
  }
  return { nonBlack, alphaNonOpaque };
}

function diffFrames(left, right) {
  const length = Math.min(left.pixels.length, right.pixels.length);
  let changedPixels = 0;
  let totalDelta = 0;
  for (let index = 0; index < length; index += 4) {
    const delta =
      Math.abs(left.pixels[index] - right.pixels[index]) +
      Math.abs(left.pixels[index + 1] - right.pixels[index + 1]) +
      Math.abs(left.pixels[index + 2] - right.pixels[index + 2]);
    if (delta > 18) {
      changedPixels += 1;
      totalDelta += delta;
    }
  }
  return { changedPixels, totalDelta };
}

function writePpm(filePath, frame) {
  const header = Buffer.from(`P6\n${frame.width} ${frame.height}\n255\n`);
  const rgb = Buffer.alloc(frame.width * frame.height * 3);
  for (let src = 0, dst = 0; src < frame.pixels.length; src += 4, dst += 3) {
    rgb[dst] = frame.pixels[src];
    rgb[dst + 1] = frame.pixels[src + 1];
    rgb[dst + 2] = frame.pixels[src + 2];
  }
  fs.writeFileSync(filePath, Buffer.concat([header, rgb]));
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPosition(position) {
  let state = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await sleep(60);
    state = await request({ type: "state" });
    if (typeof state.position !== "number" || Math.abs(state.position - position) < 1.25) {
      return state;
    }
  }
  return state || request({ type: "state" });
}

async function renderAt(position, subtitleId, frameSize) {
  await request({ type: "setPause", paused: true });
  await request({ type: "setTrack", kind: "subtitle", id: subtitleId });
  await request({ type: "seek", position });
  const state = await waitForPosition(position);
  await request({ type: "renderFrame", width: frameSize.width, height: frameSize.height });
  await sleep(40);
  const frame = await request({ type: "renderFrame", width: frameSize.width, height: frameSize.height });
  return { frame, state };
}

async function renderSameFrameWithSubtitle(position, subtitleId, frameSize) {
  const withSubtitle = await renderAt(position, subtitleId, frameSize);
  await request({ type: "setPause", paused: true });
  await sleep(40);
  const withSubtitleAgain = {
    frame: await request({ type: "renderFrame", width: frameSize.width, height: frameSize.height }),
    state: await request({ type: "state" }),
  };
  await request({ type: "setPause", paused: true });
  await request({ type: "setTrack", kind: "subtitle", id: null });
  await request({ type: "setPause", paused: true });
  await sleep(120);
  const withoutSubtitle = {
    frame: await request({ type: "renderFrame", width: frameSize.width, height: frameSize.height }),
    state: await request({ type: "state" }),
  };
  return { withSubtitle, withSubtitleAgain, withoutSubtitle };
}

function frameSizeFromState(state) {
  return {
    width: Math.max(2, Math.min(3840, Math.round(state.videoWidth || 1280))),
    height: Math.max(2, Math.min(2160, Math.round(state.videoHeight || 720))),
  };
}

async function renderMeasurementFrame(load, frameSize) {
  const duration = load.duration || 0;
  const candidates = [0, 8, 20, 45, 90, 180, 300, 420]
    .filter((position) => position === 0 || position < duration || !duration);
  let fallback = null;
  for (const position of candidates) {
    if (position > 0) {
      await request({ type: "setPause", paused: true });
      await request({ type: "seek", position }, 30000);
      await sleep(120);
    }
    const start = performance.now();
    const frame = await request({ type: "renderFrame", width: frameSize.width, height: frameSize.height }, 30000);
    const ms = performance.now() - start;
    const stats = frameStats(frame);
    const measurement = { position, frame, ms, stats };
    fallback = fallback || measurement;
    if (stats.nonBlack > 0) {
      return measurement;
    }
  }
  return fallback;
}

function discoverMediaFiles(root) {
  const output = execFileSync("find", [
    root,
    "-type",
    "f",
    "(",
    "-iname",
    "*.mkv",
    "-o",
    "-iname",
    "*.mp4",
    "-o",
    "-iname",
    "*.webm",
    ")",
  ], { encoding: "utf8" });
  return output.split("\n").filter(Boolean);
}

function probeMedia(filePath) {
  try {
    const output = execFileSync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,avg_frame_rate,r_frame_rate",
      "-of",
      "json",
      filePath,
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const stream = JSON.parse(output).streams?.[0] || {};
    const rate = stream.avg_frame_rate || stream.r_frame_rate || "0/1";
    const [num, den] = rate.split("/").map(Number);
    const fps = den ? num / den : 0;
    return {
      filePath,
      width: stream.width || 0,
      height: stream.height || 0,
      fps,
      pixelsPerSecond: (stream.width || 0) * (stream.height || 0) * fps,
    };
  } catch {
    return null;
  }
}

function selectDiscoveredSamples(root, probeLimit) {
  const samples = discoverMediaFiles(root)
    .slice(0, probeLimit)
    .map(probeMedia)
    .filter(Boolean)
    .sort((left, right) => right.pixelsPerSecond - left.pixelsPerSecond);
  const selected = [];
  for (const sample of samples) {
    if (!selected.some((current) => current.width === sample.width && current.height === sample.height && Math.round(current.fps) === Math.round(sample.fps))) {
      selected.push(sample);
    }
    if (selected.length >= 5) break;
  }
  return selected;
}

async function diagnoseMedia(currentMediaPath, { includeSubtitles = true } = {}) {
  const result = {
    ok: false,
    mediaPath: currentMediaPath,
    render: {},
    seek: {},
    subtitles: {},
    artifacts: {},
  };

  const info = await request({ type: "info" });
  const load = await request({ type: "load", path: currentMediaPath }, 30000);
  await sleep(500);
  const state = await request({ type: "state" });
  const frameSize = frameSizeFromState(state);

  const measurement = await renderMeasurementFrame(load, frameSize);
  const frame = measurement.frame;
  const renderMs = measurement.ms;
  const renderSamples = [renderMs];
  for (let index = 0; index < 11; index += 1) {
    const sampleStart = performance.now();
    await request({ type: "renderFrame", width: frameSize.width, height: frameSize.height }, 30000);
    renderSamples.push(performance.now() - sampleStart);
  }
  const avgRenderMs = renderSamples.reduce((sum, value) => sum + value, 0) / renderSamples.length;
  result.render = {
    renderMode: `libmpv-${info.build?.renderApi || info.probe?.renderApi || "unknown"}-ipc`,
    width: frame.width,
    height: frame.height,
    ms: Number(renderMs.toFixed(2)),
    measuredAt: measurement.position,
    avgMs: Number(avgRenderMs.toFixed(2)),
    maxMs: Number(Math.max(...renderSamples).toFixed(2)),
    sourceFrameBudgetMs: Number((1000 / Math.max(1, state.fps || 24)).toFixed(2)),
    ...frameStats(frame),
  };

  const seekStart = performance.now();
  await request({ type: "seek", position: Math.min(300, Math.max(20, (load.duration || 600) / 3)) }, 30000);
  const seekDone = performance.now();
  await request({ type: "renderFrame", width: frameSize.width, height: frameSize.height }, 30000);
  result.seek = {
    commandMs: Number((seekDone - seekStart).toFixed(2)),
    firstFrameMs: Number((performance.now() - seekDone).toFixed(2)),
  };

  const seekPositions = [30, 90, 180, 300, 420].filter((position) => position < (load.duration || Infinity));
  const seekSamples = [];
  for (const position of seekPositions) {
    const start = performance.now();
    await request({ type: "seek", position }, 30000);
    const seekCommandDone = performance.now();
    await request({ type: "renderFrame", width: frameSize.width, height: frameSize.height }, 30000);
    const frameDone = performance.now();
    seekSamples.push({
      position,
      commandMs: Number((seekCommandDone - start).toFixed(2)),
      firstFrameMs: Number((frameDone - seekCommandDone).toFixed(2)),
    });
  }
  result.continuousSeek = {
    samples: seekSamples,
    maxFirstFrameMs: Number(Math.max(...seekSamples.map((sample) => sample.firstFrameMs)).toFixed(2)),
  };

  const selectedSubtitle = includeSubtitles
    ? state.subtitleTracks?.find((track) => track.selected) || state.subtitleTracks?.[0]
    : null;
  if (selectedSubtitle) {
    const candidates = [12, 30, 60, 90, 120, 180, 300, 420].filter((value) => value < (load.duration || Infinity));
    let best = null;
    for (const position of candidates) {
      const { withSubtitle, withSubtitleAgain, withoutSubtitle } = await renderSameFrameWithSubtitle(
        position,
        selectedSubtitle.id,
        frameSize,
      );
      const baseline = diffFrames(withSubtitle.frame, withSubtitleAgain.frame);
      const diff = diffFrames(withSubtitle.frame, withoutSubtitle.frame);
      const score = Math.max(0, diff.changedPixels - baseline.changedPixels);
      if (!best || score > best.score) {
        best = { position, withSubtitle, withoutSubtitle, baseline, diff, score };
      }
    }

    if (best) {
      const prefix = `/tmp/nexplay-subtitle-check-${process.pid}`;
      const withPath = `${prefix}-with-sub.ppm`;
      const withoutPath = `${prefix}-without-sub.ppm`;
      writePpm(withPath, best.withSubtitle.frame);
      writePpm(withoutPath, best.withoutSubtitle.frame);
      const totalPixels = best.withSubtitle.frame.width * best.withSubtitle.frame.height;
      const suspiciousWholeFrameDiff = best.diff.changedPixels > totalPixels * 0.7;
      result.subtitles = {
        trackId: selectedSubtitle.id,
        title: selectedSubtitle.title,
        lang: selectedSubtitle.lang,
        codec: selectedSubtitle.codec,
        bestPosition: best.position,
        baselineChangedPixels: best.baseline.changedPixels,
        changedPixels: best.diff.changedPixels,
        netChangedPixels: best.score,
        totalDelta: best.diff.totalDelta,
        suspiciousWholeFrameDiff,
        detected: best.score > Math.max(800, best.baseline.changedPixels * 3) && !suspiciousWholeFrameDiff,
      };
      result.artifacts = {
        withSubtitle: withPath,
        withoutSubtitle: withoutPath,
      };
    }
  }

  result.ok =
    info.probe?.ok === true &&
    result.render.nonBlack > 0 &&
    result.render.width === frameSize.width &&
    result.render.height === frameSize.height &&
    result.render.avgMs < Math.max(16.7, 1000 / Math.max(1, state.fps || 24)) &&
    result.seek.firstFrameMs < 120 &&
    result.continuousSeek.maxFirstFrameMs < 140 &&
    (!includeSubtitles || (state.subtitleTracks?.length ? result.subtitles.detected === true : true));
  result.state = {
    duration: load.duration,
    fps: state.fps,
    videoWidth: state.videoWidth,
    videoHeight: state.videoHeight,
    audioTracks: state.audioTracks?.length || 0,
    subtitleTracks: state.subtitleTracks?.length || 0,
  };

  return result;
}

async function main() {
  if (discover) {
    const root = discoverDirArg || "/mnt/media/entertainment/bangumi";
    const samples = selectDiscoveredSamples(root, discoverProbeLimit);
    const results = [];
    for (const sample of samples) {
      results.push(await diagnoseMedia(sample.filePath, { includeSubtitles: false }));
    }
    await request({ type: "shutdown" });
    const output = {
      ok: results.every((result) => result.ok),
      root,
      probeLimit: discoverProbeLimit,
      samples: results,
    };
    console.log(JSON.stringify(output, null, 2));
    if (!output.ok) process.exit(1);
    return;
  }

  const result = await diagnoseMedia(mediaPath);
  await request({ type: "shutdown" });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exit(1);
  }
}

main().catch(async (error) => {
  try {
    await request({ type: "shutdown" }, 1000);
  } catch {
    daemon.kill();
  }
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
