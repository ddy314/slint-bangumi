type WorkerDanmakuItem = {
  id: string;
  time: number;
  mode: "scroll" | "top" | "bottom";
  color: number;
  text: string;
};

type RawDanmakuItem = {
  id: string;
  time: number;
  mode: "scroll" | "top" | "bottom";
  color: number;
  text: string;
};

type ActiveDanmaku = WorkerDanmakuItem & {
  lane: number;
  width: number;
  height: number;
  speed: number;
  duration: number;
  bitmap: TextBitmap;
};

type LaneState = {
  nextAt: number;
  clearAt: number;
};

type TextBitmap = {
  canvas: OffscreenCanvas;
  width: number;
  height: number;
};

type ClockState = {
  position: number;
  timestamp: number;
  paused: boolean;
};

type RendererState = {
  cursor: number;
  prewarmCursor: number;
  lastPosition: number;
  drawnPosition: number;
  canvasDirty: boolean;
  active: ActiveDanmaku[];
  lanes: LaneState[];
  width: number;
  height: number;
  dpr: number;
  area: number;
  laneHeight: number;
  visible: boolean;
  seeking: boolean;
};

type WorkerMessage =
  | { type: "init"; canvas: OffscreenCanvas; width: number; height: number; dpr: number; area: number }
  | { type: "resize"; width: number; height: number; dpr: number; area: number }
  | { type: "items"; items: WorkerDanmakuItem[]; position: number }
  | { type: "rawItems"; items: RawDanmakuItem[]; position: number }
  | { type: "reset"; position: number; paused: boolean }
  | { type: "clock"; position: number; paused: boolean; seeking: boolean; timestamp: number }
  | { type: "visible"; visible: boolean; position: number }
  | { type: "area"; area: number; position: number }
  | { type: "profile"; sampleMs: number; targetFps?: number }
  | { type: "renderNow" }
  | { type: "snapshot"; id: number }
  | { type: "dispose" };

const FONT_SIZE = 26;
const FONT_FAMILY = "Inter, Noto Sans SC, system-ui, sans-serif";
const FONT_WEIGHT = 700;
const LINE_HEIGHT = 36;
const FIXED_DURATION = 4;
const SCROLL_DURATION = 8;
const SCROLL_GAP = 112;
const MAX_VISIBLE = 280;
const MAX_EMIT_PER_FRAME = 40;
const EMIT_BUDGET_MS = 3.5;
const MAX_LATE_EMIT_SECONDS = 0.8;
const PREWARM_WINDOW_SECONDS = 3;
const PREWARM_BUDGET_MS = 2;
const HARD_SEEK_THRESHOLD_SECONDS = 3;
const BITMAP_PADDING = 6;
const STROKE_WIDTH = 3;
const MAX_BITMAP_CACHE = 1200;

let ctx: OffscreenCanvasRenderingContext2D | null = null;
let rafId: number | null = null;
let timeoutId: number | null = null;
let disposed = false;
let items: WorkerDanmakuItem[] = [];
let clock: ClockState = {
  position: 0,
  timestamp: performance.now(),
  paused: true,
};
const state: RendererState = {
  cursor: 0,
  prewarmCursor: 0,
  lastPosition: -1,
  drawnPosition: -1,
  canvasDirty: false,
  active: [],
  lanes: [],
  width: 0,
  height: 0,
  dpr: 1,
  area: 0.5,
  laneHeight: LINE_HEIGHT,
  visible: false,
  seeking: false,
};
const bitmapCache = new Map<string, TextBitmap>();
let profile: {
  startedAt: number;
  sampleMs: number;
  targetFrameMs: number;
  frames: number;
  lateFrames: number;
  droppedEstimate: number;
  maxRenderMs: number;
  totalRenderMs: number;
  maxActive: number;
} | null = null;

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  switch (message.type) {
    case "init": {
      ctx = message.canvas.getContext("2d", {
        alpha: true,
        desynchronized: true,
      });
      resize(message.width, message.height, message.dpr, message.area);
      startLoop();
      break;
    }
    case "resize":
      resize(message.width, message.height, message.dpr, message.area);
      resetRendererToPosition(currentClockPosition());
      break;
    case "items":
      items = message.items;
      resetRendererToPosition(message.position);
      break;
    case "rawItems":
      items = normalizeDanmakuItems(message.items);
      resetRendererToPosition(message.position);
      break;
    case "reset":
      resetClockToPosition(message.position, message.paused);
      break;
    case "clock":
      updateClock(message.position, message.paused, message.seeking, message.timestamp);
      break;
    case "visible":
      state.visible = message.visible;
      if (message.visible) {
        resetRendererToPosition(message.position);
      } else {
        clearCanvas();
        state.canvasDirty = false;
      }
      break;
    case "area":
      state.area = clamp(message.area, 0.25, 1);
      state.lanes = createLanes(Math.max(1, Math.floor((state.height * state.area) / state.laneHeight)));
      resetRendererToPosition(message.position);
      break;
    case "profile":
      profile = {
        startedAt: performance.now(),
        sampleMs: Math.max(250, message.sampleMs),
        targetFrameMs: 1000 / Math.max(1, message.targetFps || 60),
        frames: 0,
        lateFrames: 0,
        droppedEstimate: 0,
        maxRenderMs: 0,
        totalRenderMs: 0,
        maxActive: 0,
      };
      break;
    case "renderNow":
      renderFrame();
      break;
    case "snapshot":
      self.postMessage({
        type: "snapshot",
        id: message.id,
        activeCount: state.active.length,
        bitmapCacheSize: bitmapCache.size,
        canvasDirty: state.canvasDirty,
        cursor: state.cursor,
        drawnPosition: Number(state.drawnPosition.toFixed(3)),
        paused: clock.paused,
        visible: state.visible,
      });
      break;
    case "dispose":
      disposed = true;
      stopLoop();
      clearCanvas();
      items = [];
      state.active = [];
      bitmapCache.clear();
      profile = null;
      break;
  }
};

function startLoop() {
  stopLoop();
  disposed = false;
  const step = () => {
    if (disposed) return;
    renderFrame();
    if (typeof self.requestAnimationFrame === "function") {
      rafId = self.requestAnimationFrame(step);
    } else {
      timeoutId = self.setTimeout(step, 1000 / 60);
    }
  };
  step();
}

function stopLoop() {
  if (rafId !== null && typeof self.cancelAnimationFrame === "function") {
    self.cancelAnimationFrame(rafId);
  }
  if (timeoutId !== null) {
    self.clearTimeout(timeoutId);
  }
  rafId = null;
  timeoutId = null;
}

function updateClock(position: number, paused: boolean, seeking: boolean, timestamp: number) {
  void timestamp;
  const now = performance.now();
  const nextPosition = Number.isFinite(position) ? Math.max(0, position) : 0;
  const current = currentClockPosition();
  state.seeking = seeking;

  if (seeking) {
    clock = {
      position: nextPosition,
      timestamp: now,
      paused: true,
    };
    resetRendererToPosition(nextPosition);
    return;
  }

  if (paused) {
    clock = {
      position: clock.paused ? clock.position : current,
      timestamp: now,
      paused: true,
    };
    return;
  }

  const drift = nextPosition - current;
  if (Math.abs(drift) > HARD_SEEK_THRESHOLD_SECONDS) {
    clock = {
      position: nextPosition,
      timestamp: now,
      paused: false,
    };
    resetRendererToPosition(nextPosition);
    return;
  }

  clock = {
    position: Math.abs(drift) > 0.35 ? current + drift * 0.18 : current,
    timestamp: now,
    paused: false,
  };
}

function resetClockToPosition(position: number, paused: boolean) {
  const now = performance.now();
  const nextPosition = Number.isFinite(position) ? Math.max(0, position) : 0;
  state.seeking = false;
  clock = {
    position: nextPosition,
    timestamp: now,
    paused,
  };
  resetRendererToPosition(nextPosition);
}

function renderFrame() {
  if (!ctx) return;
  const profileFrameStart = profile ? performance.now() : 0;
  const currentPosition = currentClockPosition();
  const enabled = state.visible && !state.seeking && items.length > 0;
  if (!enabled || state.width <= 0 || state.height <= 0) {
    if (state.canvasDirty) {
      clearCanvas();
      state.canvasDirty = false;
    }
    state.lastPosition = currentPosition;
    finishProfileFrame(profileFrameStart);
    return;
  }

  if (clock.paused && Math.abs(state.drawnPosition - currentPosition) < 0.001 && state.canvasDirty) {
    state.lastPosition = currentPosition;
    finishProfileFrame(profileFrameStart);
    return;
  }

  if (state.lastPosition >= 0 && currentPosition + 0.05 < state.lastPosition) {
    resetRendererToPosition(currentPosition);
  }

  emitDueItems(ctx, currentPosition);
  drawActiveItems(ctx, currentPosition);
  prewarmUpcomingBitmaps(ctx, currentPosition);
  state.lastPosition = currentPosition;
  state.drawnPosition = currentPosition;
  state.canvasDirty = true;
  finishProfileFrame(profileFrameStart);
}

function finishProfileFrame(startedAt: number) {
  if (!profile) return;
  const now = performance.now();
  const renderMs = now - startedAt;
  profile.frames += 1;
  profile.totalRenderMs += renderMs;
  profile.maxRenderMs = Math.max(profile.maxRenderMs, renderMs);
  profile.maxActive = Math.max(profile.maxActive, state.active.length);
  if (renderMs > profile.targetFrameMs) {
    profile.lateFrames += 1;
  }
  const expectedFrames = Math.max(1, Math.floor((now - profile.startedAt) / profile.targetFrameMs));
  profile.droppedEstimate = Math.max(profile.droppedEstimate, expectedFrames - profile.frames);
  if (now - profile.startedAt < profile.sampleMs) {
    return;
  }

  self.postMessage({
    type: "profileResult",
    durationMs: Number((now - profile.startedAt).toFixed(2)),
    frames: profile.frames,
    achievedFps: Number((profile.frames / ((now - profile.startedAt) / 1000)).toFixed(2)),
    avgRenderMs: Number((profile.totalRenderMs / Math.max(1, profile.frames)).toFixed(3)),
    maxRenderMs: Number(profile.maxRenderMs.toFixed(3)),
    lateFrames: profile.lateFrames,
    droppedFramesEstimate: profile.droppedEstimate,
    maxActive: profile.maxActive,
    bitmapCacheSize: bitmapCache.size,
    totalItems: items.length,
  });
  profile = null;
}

function emitDueItems(context: OffscreenCanvasRenderingContext2D, currentPosition: number) {
  const endCursor = upperBoundByTime(items, currentPosition);
  if (endCursor <= state.cursor) return;

  pruneLaneReservations(currentPosition);
  const emitStartedAt = performance.now();
  let index = state.cursor;
  let emitted = 0;
  for (; index < endCursor; index += 1) {
    if (state.active.length >= MAX_VISIBLE) break;
    if (emitted >= MAX_EMIT_PER_FRAME) break;
    const item = items[index];
    if (!item) continue;
    if (currentPosition - item.time > MAX_LATE_EMIT_SECONDS) continue;
    emitOne(context, item, currentPosition);
    emitted += 1;
    if (performance.now() - emitStartedAt >= EMIT_BUDGET_MS) {
      index += 1;
      break;
    }
  }
  state.cursor = index < endCursor ? index : endCursor;
  if (state.prewarmCursor < state.cursor) {
    state.prewarmCursor = state.cursor;
  }
}

function prewarmUpcomingBitmaps(context: OffscreenCanvasRenderingContext2D, currentPosition: number) {
  const endCursor = upperBoundByTime(items, currentPosition + PREWARM_WINDOW_SECONDS);
  if (endCursor <= state.prewarmCursor) return;

  const startedAt = performance.now();
  let index = Math.max(state.prewarmCursor, state.cursor);
  for (; index < endCursor; index += 1) {
    const item = items[index];
    if (item) {
      getTextBitmap(context, item);
    }
    if (performance.now() - startedAt >= PREWARM_BUDGET_MS) {
      index += 1;
      break;
    }
  }
  state.prewarmCursor = index < endCursor ? index : endCursor;
}

function emitOne(
  context: OffscreenCanvasRenderingContext2D,
  item: WorkerDanmakuItem,
  currentPosition: number,
) {
  const bitmap = getTextBitmap(context, item);
  const lane = item.mode === "bottom"
    ? acquireBottomLane(currentPosition)
    : item.mode === "top"
      ? acquireTopLane(currentPosition)
      : acquireScrollLane(currentPosition);
  if (lane < 0) return;

  const speed = (state.width + bitmap.width) / SCROLL_DURATION;
  const active: ActiveDanmaku = {
    ...item,
    lane,
    width: bitmap.width,
    height: bitmap.height,
    speed,
    duration: item.mode === "scroll" ? SCROLL_DURATION : FIXED_DURATION,
    bitmap,
  };
  reserveLane(active, currentPosition);
  state.active.push(active);
}

function drawActiveItems(context: OffscreenCanvasRenderingContext2D, currentPosition: number) {
  context.save();
  context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  context.clearRect(0, 0, state.width, state.height);
  context.globalAlpha = 0.94;
  context.imageSmoothingEnabled = true;

  let nextLength = 0;
  for (let index = 0; index < state.active.length; index += 1) {
    const item = state.active[index];
    const elapsed = currentPosition - item.time;
    if (elapsed < -0.05) {
      state.active[nextLength++] = item;
      continue;
    }

    const y = (item.lane + 0.5) * state.laneHeight;
    let x = state.width / 2 - item.width / 2;
    let expired = elapsed > item.duration;
    if (item.mode === "scroll") {
      x = state.width - elapsed * item.speed;
      expired = x + item.width < -8;
    }

    if (!expired) {
      context.drawImage(item.bitmap.canvas, x, y - item.height / 2, item.width, item.height);
      state.active[nextLength++] = item;
    }
  }
  state.active.length = nextLength;
  context.restore();
}

function resize(width: number, height: number, dpr: number, area: number) {
  if (!ctx) return;
  const canvas = ctx.canvas;
  state.width = Math.max(0, Math.round(width));
  state.height = Math.max(0, Math.round(height));
  state.dpr = Math.min(Math.max(dpr || 1, 1), 2);
  state.area = clamp(area, 0.25, 1);
  state.laneHeight = LINE_HEIGHT;
  canvas.width = Math.max(1, Math.round(state.width * state.dpr));
  canvas.height = Math.max(1, Math.round(state.height * state.dpr));
  state.lanes = createLanes(Math.max(1, Math.floor((state.height * state.area) / state.laneHeight)));
}

function resetRendererToPosition(nextPosition: number) {
  state.cursor = lowerBoundByTime(items, nextPosition);
  state.prewarmCursor = state.cursor;
  state.lastPosition = nextPosition;
  state.drawnPosition = -1;
  state.canvasDirty = false;
  state.active = [];
  state.lanes = createLanes(Math.max(1, Math.floor((state.height * state.area) / state.laneHeight)));
  clearCanvas();
}

function clearCanvas() {
  if (!ctx) return;
  ctx.save();
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  ctx.clearRect(0, 0, state.width, state.height);
  ctx.restore();
}

function acquireScrollLane(currentPosition: number) {
  for (let index = 0; index < state.lanes.length; index += 1) {
    if (state.lanes[index].nextAt <= currentPosition) {
      return index;
    }
  }
  return -1;
}

function acquireTopLane(currentPosition: number) {
  for (let index = 0; index < state.lanes.length; index += 1) {
    if (state.lanes[index].clearAt <= currentPosition) {
      return index;
    }
  }
  return -1;
}

function acquireBottomLane(currentPosition: number) {
  for (let index = state.lanes.length - 1; index >= 0; index -= 1) {
    if (state.lanes[index].clearAt <= currentPosition) {
      return index;
    }
  }
  return -1;
}

function reserveLane(item: ActiveDanmaku, currentPosition: number) {
  const lane = state.lanes[item.lane];
  if (!lane) return;
  if (item.mode === "scroll") {
    lane.nextAt = currentPosition + (item.width + SCROLL_GAP) / item.speed;
    lane.clearAt = currentPosition + item.duration;
    return;
  }
  lane.nextAt = currentPosition + item.duration;
  lane.clearAt = currentPosition + item.duration;
}

function pruneLaneReservations(currentPosition: number) {
  for (const lane of state.lanes) {
    if (lane.nextAt < currentPosition - SCROLL_DURATION) lane.nextAt = currentPosition;
    if (lane.clearAt < currentPosition - SCROLL_DURATION) lane.clearAt = currentPosition;
  }
}

function createLanes(count: number): LaneState[] {
  return Array.from({ length: count }, () => ({
    nextAt: -Infinity,
    clearAt: -Infinity,
  }));
}

function normalizeDanmakuItems(source: RawDanmakuItem[]): WorkerDanmakuItem[] {
  return source
    .map((item) => ({
      id: item.id,
      text: item.text.trim(),
      time: item.time,
      mode: item.mode,
      color: readableColor(item.color),
    }))
    .filter((item) => item.text.length > 0 && Number.isFinite(item.time) && item.time >= 0)
    .sort((left, right) => left.time - right.time || left.id.localeCompare(right.id));
}

function currentClockPosition() {
  if (clock.paused) {
    return clock.position;
  }
  return Math.max(0, clock.position + (performance.now() - clock.timestamp) / 1000);
}

function lowerBoundByTime(source: WorkerDanmakuItem[], time: number) {
  let low = 0;
  let high = source.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (source[mid].time < time) low = mid + 1;
    else high = mid;
  }
  return low;
}

function upperBoundByTime(source: WorkerDanmakuItem[], time: number) {
  let low = 0;
  let high = source.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (source[mid].time <= time) low = mid + 1;
    else high = mid;
  }
  return low;
}

function getTextBitmap(context: OffscreenCanvasRenderingContext2D, item: WorkerDanmakuItem): TextBitmap {
  const key = `${state.dpr}|${item.color}|${item.text}`;
  const cached = bitmapCache.get(key);
  if (cached) {
    bitmapCache.delete(key);
    bitmapCache.set(key, cached);
    return cached;
  }

  context.font = `${FONT_WEIGHT} ${FONT_SIZE}px ${FONT_FAMILY}`;
  const textWidth = Math.ceil(context.measureText(item.text).width);
  const cssWidth = textWidth + BITMAP_PADDING * 2 + STROKE_WIDTH * 2;
  const cssHeight = LINE_HEIGHT;
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.ceil(cssWidth * state.dpr)),
    Math.max(1, Math.ceil(cssHeight * state.dpr)),
  );
  const bitmapCtx = canvas.getContext("2d");
  if (!bitmapCtx) {
    return { canvas, width: cssWidth, height: cssHeight };
  }

  bitmapCtx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  bitmapCtx.font = `${FONT_WEIGHT} ${FONT_SIZE}px ${FONT_FAMILY}`;
  bitmapCtx.textBaseline = "middle";
  bitmapCtx.lineJoin = "round";
  bitmapCtx.lineWidth = STROKE_WIDTH;
  bitmapCtx.strokeStyle = "rgba(0, 0, 0, 0.82)";
  bitmapCtx.fillStyle = colorToCss(item.color);
  const x = BITMAP_PADDING + STROKE_WIDTH;
  const y = cssHeight / 2;
  bitmapCtx.strokeText(item.text, x, y);
  bitmapCtx.fillText(item.text, x, y);

  const bitmap = { canvas, width: cssWidth, height: cssHeight };
  bitmapCache.set(key, bitmap);
  while (bitmapCache.size > MAX_BITMAP_CACHE) {
    const oldest = bitmapCache.keys().next().value;
    if (!oldest) break;
    bitmapCache.delete(oldest);
  }
  return bitmap;
}

function colorToCss(value: number) {
  return `#${value.toString(16).padStart(6, "0")}`;
}

function readableColor(value: number) {
  const color = Number.isFinite(value) && value >= 0 && value <= 0xff_ffff
    ? Math.round(value)
    : 0xff_ffff;
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (luminance >= 80) {
    return color;
  }

  const mix = 0.38;
  const nr = Math.round(r + (255 - r) * mix);
  const ng = Math.round(g + (255 - g) * mix);
  const nb = Math.round(b + (255 - b) * mix);
  return (nr << 16) | (ng << 8) | nb;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
