import { useEffect, useRef, useState } from "react";
import type { DanmakuTrack } from "./backend";
import { cn } from "./utils/cn";

type DanmakuOverlayProps = {
  mediaId?: number | null;
  visible: boolean;
  paused: boolean;
  seeking: boolean;
  seekReset?: { version: number; position: number } | null;
  position: number;
  duration: number;
  area: number;
  className?: string;
  onError?: (message: string) => void;
  onLoaded?: (track: DanmakuTrack) => void;
};

type ClockState = {
  mediaId?: number | null;
  position: number;
  timestamp: number;
  paused: boolean;
};

type NormalizedDanmakuItem = {
  id: string;
  time: number;
  mode: "scroll" | "top" | "bottom";
  color: number;
  text: string;
};

type ActiveDanmaku = NormalizedDanmakuItem & {
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
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
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
  area: number;
  laneHeight: number;
};

type WorkerMessage =
  | { type: "init"; canvas: OffscreenCanvas; width: number; height: number; dpr: number; area: number }
  | { type: "resize"; width: number; height: number; dpr: number; area: number }
  | { type: "items"; items: NormalizedDanmakuItem[]; position: number }
  | { type: "rawItems"; items: DanmakuTrack["items"]; position: number }
  | { type: "reset"; position: number; paused: boolean }
  | { type: "clock"; position: number; paused: boolean; seeking: boolean; timestamp: number }
  | { type: "visible"; visible: boolean; position: number }
  | { type: "area"; area: number; position: number }
  | { type: "dispose" };

const FONT_SIZE = 26;
const FONT_FAMILY = "Inter, Noto Sans SC, system-ui, sans-serif";
const FONT_WEIGHT = 700;
const LINE_HEIGHT = 36;
const FIXED_DURATION = 4;
const SCROLL_DURATION = 8;
const SCROLL_GAP = 112;
const MAX_VISIBLE = 180;
const MAX_EMIT_PER_FRAME = 32;
const EMIT_BUDGET_MS = 3.5;
const MAX_LATE_EMIT_SECONDS = 0.8;
const PREWARM_WINDOW_SECONDS = 3;
const PREWARM_BUDGET_MS = 2;
const HARD_SEEK_THRESHOLD_SECONDS = 3;
const CLOCK_DRIFT_THRESHOLD_SECONDS = 0.35;
const CLOCK_CORRECTION_FACTOR = 0.18;
const BITMAP_PADDING = 6;
const STROKE_WIDTH = 3;
const MAX_BITMAP_CACHE = 900;
const bitmapCaches = new WeakMap<HTMLCanvasElement, Map<string, TextBitmap>>();

export function DanmakuOverlay({
  mediaId,
  visible,
  paused,
  seeking,
  seekReset,
  position,
  duration,
  area,
  className,
  onError,
  onLoaded,
}: DanmakuOverlayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const rawTrackRef = useRef<DanmakuTrack | null>(null);
  const itemsRef = useRef<NormalizedDanmakuItem[]>([]);
  const stateRef = useRef<RendererState>(createRendererState());
  const clockRef = useRef<ClockState>({
    mediaId: null,
    position: 0,
    timestamp: performance.now(),
    paused: true,
  });
  const visibleRef = useRef(visible);
  const seekingRef = useRef(seeking);
  const areaRef = useRef(area);
  const durationRef = useRef(duration);
  const [track, setTrack] = useState<DanmakuTrack | null>(null);

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    seekingRef.current = seeking;
  }, [seeking]);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    areaRef.current = area;
    resizeCanvas();
    const position = currentClockPosition(clockRef.current);
    postWorkerMessage({ type: "area", area, position });
    resetRendererToPosition(position);
  }, [area]);

  useEffect(() => {
    if (!seekReset) return;
    const now = performance.now();
    const nextPosition = Number.isFinite(seekReset.position) ? Math.max(0, seekReset.position) : 0;
    clockRef.current = {
      mediaId,
      position: nextPosition,
      timestamp: now,
      paused,
    };
    postWorkerMessage({ type: "reset", position: nextPosition, paused });
    resetRendererToPosition(nextPosition);
  }, [mediaId, paused, seekReset?.version]);

  useEffect(() => {
    const now = performance.now();
    const current = currentClockPosition(clockRef.current);
    const nextPosition = Number.isFinite(position) ? Math.max(0, position) : 0;
    const mediaChanged = clockRef.current.mediaId !== mediaId;

    if (mediaChanged || seeking) {
      clockRef.current = {
        mediaId,
        position: nextPosition,
        timestamp: now,
        paused: true,
      };
      postWorkerClock();
      resetRendererToPosition(nextPosition);
      return;
    }

    if (paused) {
      clockRef.current = {
        mediaId,
        position: clockRef.current.paused ? clockRef.current.position : current,
        timestamp: now,
        paused: true,
      };
      postWorkerClock();
      return;
    }

    const drift = nextPosition - current;
    if (Math.abs(drift) > HARD_SEEK_THRESHOLD_SECONDS) {
      clockRef.current = {
        mediaId,
        position: nextPosition,
        timestamp: now,
        paused: false,
      };
      postWorkerClock();
      resetRendererToPosition(nextPosition);
      return;
    }

    if (Math.abs(drift) > CLOCK_DRIFT_THRESHOLD_SECONDS) {
      clockRef.current = {
        mediaId,
        position: Math.max(0, current + drift * CLOCK_CORRECTION_FACTOR),
        timestamp: now,
        paused: false,
      };
      postWorkerClock();
      return;
    }

    clockRef.current = {
      mediaId,
      position: current,
      timestamp: now,
      paused: false,
    };
    postWorkerClock();
  }, [mediaId, paused, position, seeking]);

  useEffect(() => {
    let cancelled = false;
    setTrack(null);
    rawTrackRef.current = null;
    itemsRef.current = [];
    const position = currentClockPosition(clockRef.current);
    postWorkerMessage({ type: "items", items: [], position });
    resetRendererToPosition(position);

    if (!mediaId || !window.nexplay?.danmakuTrack) {
      return () => {
        cancelled = true;
      };
    }

    window.nexplay
      .danmakuTrack(mediaId)
      .then((nextTrack) => {
        if (cancelled) return;
        rawTrackRef.current = nextTrack;
        setTrack(nextTrack);
        onLoaded?.(nextTrack);
        if (nextTrack.stale) {
          onError?.("弹幕服务器暂时不可用，已使用本地旧缓存");
        }
      })
      .catch((caught) => {
        if (cancelled) return;
        const message = caught instanceof Error ? caught.message : String(caught);
        onError?.(`弹幕加载失败：${message}`);
      });

    return () => {
      cancelled = true;
    };
  }, [mediaId, onError, onLoaded]);

  useEffect(() => {
    const position = currentClockPosition(clockRef.current);
    if (!track) {
      itemsRef.current = [];
      postWorkerMessage({ type: "items", items: [], position });
      resetRendererToPosition(position);
      return;
    }

    if (workerRef.current) {
      itemsRef.current = [];
      postWorkerMessage({ type: "rawItems", items: track.items, position });
      return;
    }

    const normalizedItems = normalizeDanmakuItems(track);
    itemsRef.current = normalizedItems;
    postWorkerMessage({ type: "items", items: normalizedItems, position });
    resetRendererToPosition(position);
  }, [track]);

  useEffect(() => {
    const position = currentClockPosition(clockRef.current);
    postWorkerMessage({ type: "visible", visible, position });
    if (visible) {
      resetRendererToPosition(position);
    } else {
      clearCanvas();
      stateRef.current.canvasDirty = false;
    }
  }, [visible]);

  useEffect(() => {
    initializeWorkerRenderer();
    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
      resetRendererToPosition(currentClockPosition(clockRef.current));
    });
    const container = containerRef.current;
    if (container) {
      resizeObserver.observe(container);
      resizeCanvas();
    }

    let disposed = false;
    let rafId = 0;
    const loop = () => {
      if (disposed) return;
      if (!workerRef.current) {
        renderFrame();
      }
      rafId = window.requestAnimationFrame(loop);
    };
    rafId = window.requestAnimationFrame(loop);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      workerRef.current?.postMessage({ type: "dispose" });
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        "danmaku-plane pointer-events-none absolute inset-0",
        visible ? "opacity-100" : "opacity-0",
        className,
      )}
      aria-hidden
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />
    </div>
  );

  function renderFrame() {
    if (workerRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const state = stateRef.current;
    const currentPosition = currentClockPosition(clockRef.current);
    const enabled = visibleRef.current && !seekingRef.current && itemsRef.current.length > 0;
    if (!enabled || state.width <= 0 || state.height <= 0) {
      if (state.canvasDirty) {
        clearCanvas();
        state.canvasDirty = false;
      }
      state.lastPosition = currentPosition;
      return;
    }

    if (
      clockRef.current.paused
      && Math.abs(state.drawnPosition - currentPosition) < 0.001
      && state.canvasDirty
    ) {
      state.lastPosition = currentPosition;
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
  }

  function emitDueItems(ctx: CanvasRenderingContext2D, currentPosition: number) {
    const state = stateRef.current;
    const items = itemsRef.current;
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
      emitOne(ctx, item, currentPosition);
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

  function prewarmUpcomingBitmaps(ctx: CanvasRenderingContext2D, currentPosition: number) {
    const state = stateRef.current;
    const items = itemsRef.current;
    const endCursor = upperBoundByTime(items, currentPosition + PREWARM_WINDOW_SECONDS);
    if (endCursor <= state.prewarmCursor) return;

    const startedAt = performance.now();
    let index = Math.max(state.prewarmCursor, state.cursor);
    for (; index < endCursor; index += 1) {
      const item = items[index];
      if (item) {
        getTextBitmap(ctx, item);
      }
      if (performance.now() - startedAt >= PREWARM_BUDGET_MS) {
        index += 1;
        break;
      }
    }
    state.prewarmCursor = index < endCursor ? index : endCursor;
  }

  function emitOne(
    ctx: CanvasRenderingContext2D,
    item: NormalizedDanmakuItem,
    currentPosition: number,
  ) {
    const state = stateRef.current;
    const bitmap = getTextBitmap(ctx, item);
    const width = bitmap.width;
    const height = bitmap.height;
    const lane = item.mode === "bottom"
      ? acquireBottomLane(currentPosition)
      : item.mode === "top"
        ? acquireTopLane(currentPosition)
        : acquireScrollLane(currentPosition);
    if (lane < 0) return;

    const speed = (state.width + width) / SCROLL_DURATION;
    const active: ActiveDanmaku = {
      ...item,
      lane,
      width,
      height,
      speed,
      duration: item.mode === "scroll" ? SCROLL_DURATION : FIXED_DURATION,
      bitmap,
    };
    reserveLane(active, currentPosition);
    state.active.push(active);
  }

  function drawActiveItems(ctx: CanvasRenderingContext2D, currentPosition: number) {
    const state = stateRef.current;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, state.width, state.height);
    ctx.globalAlpha = 0.94;
    ctx.imageSmoothingEnabled = true;

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

      if (expired) continue;
      ctx.drawImage(item.bitmap.canvas, x, y - item.height / 2, item.width, item.height);
      state.active[nextLength++] = item;
    }
    state.active.length = nextLength;
    ctx.restore();
  }

  function resizeCanvas() {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(0, Math.round(container.clientWidth));
    const height = Math.max(0, Math.round(container.clientHeight));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const state = stateRef.current;
    state.width = width;
    state.height = height;
    state.area = clamp(areaRef.current, 0.25, 1);
    state.laneHeight = LINE_HEIGHT;
    state.lanes = createLanes(Math.max(1, Math.floor((height * state.area) / LINE_HEIGHT)));

    if (workerRef.current) {
      postWorkerMessage({
        type: "resize",
        width,
        height,
        dpr,
        area: state.area,
      });
      return;
    }

    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
  }

  function resetRendererToPosition(nextPosition: number) {
    if (workerRef.current) return;
    const state = stateRef.current;
    state.cursor = lowerBoundByTime(itemsRef.current, nextPosition);
    state.prewarmCursor = state.cursor;
    state.lastPosition = nextPosition;
    state.drawnPosition = -1;
    state.canvasDirty = false;
    state.active = [];
    state.lanes = createLanes(Math.max(1, Math.floor((state.height * state.area) / state.laneHeight)));
    clearCanvas();
  }

  function clearCanvas() {
    if (workerRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, stateRef.current.width, stateRef.current.height);
    ctx.restore();
  }

  function acquireScrollLane(currentPosition: number) {
    const state = stateRef.current;
    for (let index = 0; index < state.lanes.length; index += 1) {
      if (state.lanes[index].nextAt <= currentPosition) {
        return index;
      }
    }
    return -1;
  }

  function acquireTopLane(currentPosition: number) {
    const state = stateRef.current;
    for (let index = 0; index < state.lanes.length; index += 1) {
      if (state.lanes[index].clearAt <= currentPosition) {
        return index;
      }
    }
    return -1;
  }

  function acquireBottomLane(currentPosition: number) {
    const state = stateRef.current;
    for (let index = state.lanes.length - 1; index >= 0; index -= 1) {
      if (state.lanes[index].clearAt <= currentPosition) {
        return index;
      }
    }
    return -1;
  }

  function reserveLane(item: ActiveDanmaku, currentPosition: number) {
    const lane = stateRef.current.lanes[item.lane];
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
    for (const lane of stateRef.current.lanes) {
      if (lane.nextAt < currentPosition - SCROLL_DURATION) lane.nextAt = currentPosition;
      if (lane.clearAt < currentPosition - SCROLL_DURATION) lane.clearAt = currentPosition;
    }
  }

  function initializeWorkerRenderer() {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (
      !canvas
      || !container
      || typeof Worker === "undefined"
      || typeof OffscreenCanvas === "undefined"
      || !("transferControlToOffscreen" in canvas)
    ) {
      return;
    }

    try {
      const worker = new Worker(new URL("./danmaku.worker.ts", import.meta.url), { type: "module" });
      const offscreen = canvas.transferControlToOffscreen();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(0, Math.round(container.clientWidth));
      const height = Math.max(0, Math.round(container.clientHeight));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      workerRef.current = worker;
      worker.postMessage({
        type: "init",
        canvas: offscreen,
        width,
        height,
        dpr,
        area: clamp(areaRef.current, 0.25, 1),
      }, [offscreen]);
      const position = currentClockPosition(clockRef.current);
      if (rawTrackRef.current) {
        worker.postMessage({
          type: "rawItems",
          items: rawTrackRef.current.items,
          position,
        });
      } else {
        worker.postMessage({
          type: "items",
          items: itemsRef.current,
          position,
        });
      }
      worker.postMessage({
        type: "visible",
        visible: visibleRef.current,
        position,
      });
      postWorkerClock();
    } catch {
      workerRef.current?.terminate();
      workerRef.current = null;
    }
  }

  function postWorkerClock() {
    postWorkerMessage({
      type: "clock",
      position: clockRef.current.position,
      paused: clockRef.current.paused,
      seeking: seekingRef.current,
      timestamp: clockRef.current.timestamp,
    });
  }

  function postWorkerMessage(message: WorkerMessage) {
    workerRef.current?.postMessage(message);
  }
}

function createRendererState(): RendererState {
  return {
    cursor: 0,
    prewarmCursor: 0,
    lastPosition: -1,
    drawnPosition: -1,
    canvasDirty: false,
    active: [],
    lanes: [],
    width: 0,
    height: 0,
    area: 0.5,
    laneHeight: LINE_HEIGHT,
  };
}

function createLanes(count: number): LaneState[] {
  return Array.from({ length: count }, () => ({
    nextAt: -Infinity,
    clearAt: -Infinity,
  }));
}

function normalizeDanmakuItems(track: DanmakuTrack | null): NormalizedDanmakuItem[] {
  if (!track) {
    return [];
  }
  return track.items
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

function currentClockPosition(clock: ClockState) {
  if (clock.paused) {
    return clock.position;
  }
  return Math.max(0, clock.position + (performance.now() - clock.timestamp) / 1000);
}

function lowerBoundByTime(items: NormalizedDanmakuItem[], time: number) {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (items[mid].time < time) low = mid + 1;
    else high = mid;
  }
  return low;
}

function upperBoundByTime(items: NormalizedDanmakuItem[], time: number) {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (items[mid].time <= time) low = mid + 1;
    else high = mid;
  }
  return low;
}

function getTextBitmap(ctx: CanvasRenderingContext2D, item: NormalizedDanmakuItem): TextBitmap {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const key = `${dpr}|${item.color}|${item.text}`;
  const cache = stateCache(ctx);
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  ctx.font = `${FONT_WEIGHT} ${FONT_SIZE}px ${FONT_FAMILY}`;
  const textWidth = Math.ceil(ctx.measureText(item.text).width);
  const cssWidth = textWidth + BITMAP_PADDING * 2 + STROKE_WIDTH * 2;
  const cssHeight = LINE_HEIGHT;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(cssWidth * dpr));
  canvas.height = Math.max(1, Math.ceil(cssHeight * dpr));
  const bitmapCtx = canvas.getContext("2d");
  if (!bitmapCtx) {
    return { canvas, width: cssWidth, height: cssHeight };
  }

  bitmapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
  cache.set(key, bitmap);
  while (cache.size > MAX_BITMAP_CACHE) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
  return bitmap;
}

function stateCache(ctx: CanvasRenderingContext2D) {
  let cache = bitmapCaches.get(ctx.canvas);
  if (!cache) {
    cache = new Map();
    bitmapCaches.set(ctx.canvas, cache);
  }
  return cache;
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
  return (nr << 16) + (ng << 8) + nb;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
