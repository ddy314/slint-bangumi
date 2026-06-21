import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock3,
  ListVideo,
  Maximize2,
  MessageCircle,
  Minimize2,
  Pause,
  Play,
  Settings,
  SkipBack,
  SkipForward,
  Volume2,
  X,
} from "lucide-react";
import { makePlaybackEpisodes, type PlaybackEpisode, type Subject } from "../data";
import { DanmakuOverlay } from "../DanmakuOverlay";
import { Poster } from "../MediaCard";
import { appleSpringSoft } from "../motion";
import { MpvWebglSurface } from "../MpvWebglSurface";
import { cn } from "../utils/cn";
import type { MediaSource, MpvFrame, MpvRenderInfo, MpvState, MpvTrack } from "../backend";

const SEEK_COMMIT_DELAY_MS = 80;
const SEEK_POSITION_SETTLE_MS = 3500;
const SEEK_POSITION_ACCEPT_BEFORE_SECONDS = 1.25;
const SEEK_POSITION_ACCEPT_AFTER_SECONDS = 2.5;
const SEEK_FRAME_SYNC_TIMEOUT_MS = 2500;
const SEEK_FRAME_ACCEPT_WINDOW_SECONDS = 8;
const FRAME_CLOCK_PUBLISH_INTERVAL_MS = 250;
const DANMAKU_AREAS = [
  { label: "1/4屏", value: 0.25 },
  { label: "半屏", value: 0.5 },
  { label: "满屏", value: 1 },
] as const;

export function PlayerPage({
  subject,
  initialEpisode,
  onBack,
  onSnack,
}: {
  subject: Subject;
  initialEpisode: PlaybackEpisode;
  onBack: () => void;
  onSnack: (text: string, tone?: "neutral" | "success" | "danger") => void;
}) {
  const episodes = useMemo(() => makePlaybackEpisodes(subject), [subject]);
  const seekInFlightRef = useRef(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const browserVideoRef = useRef<HTMLVideoElement | null>(null);
  const pendingSeekPositionRef = useRef<number | null>(null);
  const latestSeekPositionRef = useRef<number | null>(null);
  const seekStabilizationRef = useRef<{
    target: number;
    startedAt: number;
    until: number;
  } | null>(null);
  const seekFrameSyncRef = useRef<{
    target: number;
    startedAt: number;
  } | null>(null);
  const videoFramePositionRef = useRef<number | null>(null);
  const lastFrameClockPublishAtRef = useRef(0);
  const seekCommitTimerRef = useRef<number | null>(null);
  const seekingRef = useRef(false);
  const [currentKey, setCurrentKey] = useState(initialEpisode.key);
  const [source, setSource] = useState<MediaSource | null>(null);
  const [mpvState, setMpvState] = useState<MpvState | null>(null);
  const [loadingSource, setLoadingSource] = useState(true);
  const [danmakuVisible, setDanmakuVisible] = useState(false);
  const [danmakuArea, setDanmakuArea] = useState<(typeof DANMAKU_AREAS)[number]["value"]>(0.5);
  const [episodeDrawerOpen, setEpisodeDrawerOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [renderInfo, setRenderInfo] = useState<MpvRenderInfo | null>(null);
  const [paused, setPaused] = useState(false);
  const [stageFullscreen, setStageFullscreen] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [scrubPosition, setScrubPosition] = useState<number | null>(null);
  const [videoFramePosition, setVideoFramePosition] = useState<number | null>(null);
  const heroAsset = subject.hero || subject.poster;
  const heroSrc = heroAsset ? window.nexplay?.resolveAssetUrl(heroAsset) ?? heroAsset : "";
  const playableEpisodes = useMemo(() => episodes.filter((episode) => episode.cached && episode.mediaId), [episodes]);
  const currentEpisode = useMemo(
    () => episodes.find((episode) => episode.key === currentKey) ?? initialEpisode,
    [currentKey, episodes, initialEpisode]
  );
  const currentIndex = episodes.findIndex((episode) => episode.key === currentEpisode.key);
  const previousEpisode = [...episodes]
    .slice(0, Math.max(0, currentIndex))
    .reverse()
    .find((episode) => episode.cached && episode.mediaId);
  const nextEpisode = episodes
    .slice(Math.max(0, currentIndex + 1))
    .find((episode) => episode.cached && episode.mediaId);
  const displayEpisodeTitle = episodeTitle(currentEpisode);
  const nativeBridgeReady = Boolean(renderInfo?.available && renderInfo.probe?.ok);
  const textureProbe = mpvState?.textureProbe ?? renderInfo?.textureProbe;
  const renderMode = mpvState?.renderMode;
  const browserVideoReady = renderMode === "browserVideo" && Boolean(source?.sourceUrl);
  const webglTextureReady = renderMode === "webglTexture" && Boolean(textureProbe?.ok);
  const renderBridgeError = textureProbe?.error ?? (renderInfo?.available
    ? renderInfo.probe?.error
    : renderInfo?.reason);
  const duration = mpvState?.duration ?? 0;
  const position = mpvState?.position ?? 0;
  const danmakuPosition = renderMode === "webglTexture" && videoFramePosition !== null
    ? videoFramePosition
    : position;
  const waitingForWebglFrameSync = renderMode === "webglTexture" && seekFrameSyncRef.current !== null;
  const displayedPosition = scrubPosition ?? position;
  const volume = Math.round(mpvState?.volume ?? 100);
  const playbackControlsDisabled = loadingSource || Boolean(playbackError);

  useEffect(() => {
    setCurrentKey(initialEpisode.key);
  }, [initialEpisode.key, subject.id]);

  useEffect(() => {
    let cancelled = false;
    async function loadRenderInfo() {
      if (!window.nexplay?.mpvRenderInfo) return;
      try {
        const info = await window.nexplay.mpvRenderInfo();
        if (!cancelled) {
          setRenderInfo(info);
        }
      } catch (caught) {
        if (!cancelled) {
          const message = caught instanceof Error ? caught.message : String(caught);
          setRenderInfo({ available: false, reason: message });
        }
      }
    }

    void loadRenderInfo();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadSource() {
      if (!currentEpisode.mediaId) {
        setSource(null);
        setLoadingSource(false);
        setPlaybackError("这一集没有可播放的本地文件");
        return;
      }
      if (!window.nexplay) {
        setSource(null);
        setMpvState(null);
        setLoadingSource(false);
        setPlaybackError("当前不是 Electron 环境，无法加载内置播放器");
        onSnack("当前不是 Electron 环境，无法加载内置播放器", "danger");
        return;
      }

      setLoadingSource(true);
      setPlaybackError(null);
      seekStabilizationRef.current = null;
      pendingSeekPositionRef.current = null;
      latestSeekPositionRef.current = null;
      seekFrameSyncRef.current = null;
      videoFramePositionRef.current = null;
      lastFrameClockPublishAtRef.current = 0;
      setVideoFramePosition(null);
      const currentBrowserVideo = browserVideoRef.current;
      if (currentBrowserVideo) {
        currentBrowserVideo.pause();
        currentBrowserVideo.removeAttribute("src");
        currentBrowserVideo.load();
      }
      setSource(null);
      setMpvState(null);
      try {
        const nextSource = await window.nexplay.getMediaSource(currentEpisode.mediaId);
        if (canUseBrowserVideoSource(nextSource)) {
          if (!cancelled) {
            setSource(nextSource);
            setMpvState({
              ok: true,
              loaded: true,
              audioTracks: [],
              subtitleTracks: [],
              duration: 0,
              position: 0,
              paused: false,
              volume: 100,
              source: nextSource,
              renderMode: "browserVideo",
            });
            setPaused(false);
          }
          return;
        }

        const nextState = await window.nexplay.mpvLoad(currentEpisode.mediaId);
        if (!cancelled) {
          setMpvState(nextState);
          setSource(nextState.source ?? null);
          setPaused(false);
        }
      } catch (caught) {
        if (!cancelled) {
          const message = caught instanceof Error ? caught.message : String(caught);
          setSource(null);
          setMpvState(null);
          setPlaybackError(message);
          onSnack(`libmpv 加载失败：${message}`, "danger");
        }
      } finally {
        if (!cancelled) {
          setLoadingSource(false);
        }
      }
    }

    void loadSource();
    return () => {
      cancelled = true;
    };
  }, [currentEpisode.mediaId, onSnack]);

  useEffect(() => {
    if (loadingSource || playbackError || !window.nexplay?.mpvState || mpvState?.renderMode === "browserVideo") {
      return;
    }

    let disposed = false;
    const refreshState = async () => {
      try {
        const nextState = await window.nexplay?.mpvState();
        if (!disposed && nextState) {
          setMpvState((current) => ({
            ...nextState,
            position: resolveStableMpvPosition(current, nextState.position),
            source: current?.source ?? source ?? undefined,
            renderMode: current?.renderMode,
            textureProbe: current?.textureProbe,
          }));
          if (typeof nextState.paused === "boolean") {
            setPaused(nextState.paused);
          }
        }
      } catch {
        // State polling is best-effort; command handlers surface actionable errors.
      }
    };

    const timer = window.setInterval(() => {
      void refreshState();
    }, 650);
    void refreshState();
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [loadingSource, mpvState?.renderMode, playbackError, source]);

  useEffect(() => {
    return () => {
      if (seekCommitTimerRef.current !== null) {
        window.clearTimeout(seekCommitTimerRef.current);
      }
      void window.nexplay?.mpvStop();
    };
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setStageFullscreen(document.fullscreenElement === stageRef.current);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (!settingsMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const menu = settingsMenuRef.current;
      if (!menu || !(event.target instanceof Node) || menu.contains(event.target)) {
        return;
      }
      setSettingsMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [settingsMenuOpen]);

  const switchEpisode = useCallback((episode: PlaybackEpisode | undefined) => {
    if (!episode?.mediaId) {
      return;
    }
    setSettingsMenuOpen(false);
    setPlaybackError(null);
    setCurrentKey(episode.key);
  }, []);

  const openEpisodeDrawer = useCallback(() => {
    setSettingsMenuOpen(false);
    setEpisodeDrawerOpen(true);
  }, []);

  const setTrack = useCallback(async (kind: "audio" | "subtitle", value: string) => {
    if (!window.nexplay) return;
    const trackId = value === "off" ? null : Number(value);
    try {
      const nextState = await window.nexplay.mpvSetTrack(kind, Number.isFinite(trackId) ? trackId : null);
      setMpvState((current) => ({
        ...nextState,
        source: current?.source ?? source ?? undefined,
        renderMode: current?.renderMode,
        textureProbe: current?.textureProbe,
      }));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      onSnack(`切换${kind === "audio" ? "音轨" : "字幕"}失败：${message}`, "danger");
    }
  }, [onSnack, source]);

  const togglePause = useCallback(async () => {
    if (loadingSource || playbackError || !window.nexplay) return;
    const nextPaused = !paused;
    if (mpvState?.renderMode === "browserVideo") {
      const video = browserVideoRef.current;
      if (!video) return;
      try {
        if (nextPaused) {
          video.pause();
        } else {
          await video.play();
        }
        setPaused(nextPaused);
        setMpvState((current) => current ? { ...current, paused: nextPaused } : current);
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        onSnack(`播放控制失败：${message}`, "danger");
      }
      return;
    }

    try {
      await window.nexplay.mpvSetPause(nextPaused);
      setPaused(nextPaused);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      onSnack(`播放控制失败：${message}`, "danger");
    }
  }, [loadingSource, mpvState?.renderMode, onSnack, paused, playbackError]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.key !== " ") {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      void togglePause();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [togglePause]);

  const flushPendingSeek = useCallback(async () => {
    if (!window.nexplay || seekInFlightRef.current) return;
    if (seekCommitTimerRef.current !== null) {
      window.clearTimeout(seekCommitTimerRef.current);
      seekCommitTimerRef.current = null;
    }
    seekInFlightRef.current = true;

    try {
      while (pendingSeekPositionRef.current !== null) {
        const targetPosition = pendingSeekPositionRef.current;
        pendingSeekPositionRef.current = null;

        try {
          const nextState = await window.nexplay.mpvSeek(targetPosition);
          const stillLatest = latestSeekPositionRef.current === targetPosition
            && pendingSeekPositionRef.current === null;
          if (stillLatest) {
            const startedAt = performance.now();
            seekStabilizationRef.current = {
              target: targetPosition,
              startedAt,
              until: startedAt + SEEK_POSITION_SETTLE_MS,
            };
            if ((mpvState?.renderMode ?? "webglTexture") === "webglTexture") {
              seekFrameSyncRef.current = {
                target: targetPosition,
                startedAt,
              };
              videoFramePositionRef.current = null;
              lastFrameClockPublishAtRef.current = 0;
              setVideoFramePosition(null);
            }
            setMpvState((current) => ({
              ...current,
              ...nextState,
              position: targetPosition,
              source: current?.source ?? source ?? undefined,
              renderMode: current?.renderMode ?? nextState.renderMode,
              textureProbe: current?.textureProbe ?? nextState.textureProbe,
            }));
          }
        } catch (caught) {
          const stillLatest = latestSeekPositionRef.current === targetPosition
            && pendingSeekPositionRef.current === null;
          if (stillLatest) {
            seekFrameSyncRef.current = null;
            const message = caught instanceof Error ? caught.message : String(caught);
            onSnack(`跳转失败：${message}`, "danger");
          }
        }
      }
    } finally {
      seekInFlightRef.current = false;
      if (pendingSeekPositionRef.current === null) {
        seekingRef.current = false;
        setSeeking(false);
      } else {
        void flushPendingSeek();
      }
    }
  }, [mpvState?.renderMode, onSnack, source]);

  const commitSeek = useCallback((value: number) => {
    if (!window.nexplay || !Number.isFinite(value)) return;
    const nextPosition = Math.max(0, Math.min(duration || value, value));
    if (mpvState?.renderMode === "browserVideo") {
      const video = browserVideoRef.current;
      if (!video) return;
      video.currentTime = nextPosition;
      latestSeekPositionRef.current = nextPosition;
      seekingRef.current = false;
      setSeeking(false);
      setScrubPosition(null);
      setMpvState((current) => current ? { ...current, position: nextPosition } : current);
      return;
    }

    latestSeekPositionRef.current = nextPosition;
    const startedAt = performance.now();
    seekStabilizationRef.current = {
      target: nextPosition,
      startedAt,
      until: startedAt + SEEK_POSITION_SETTLE_MS,
    };
    if (mpvState?.renderMode === "webglTexture") {
      seekFrameSyncRef.current = {
        target: nextPosition,
        startedAt,
      };
      videoFramePositionRef.current = null;
      lastFrameClockPublishAtRef.current = 0;
      setVideoFramePosition(null);
    } else {
      seekFrameSyncRef.current = null;
    }
    pendingSeekPositionRef.current = nextPosition;
    seekingRef.current = true;
    setSeeking(true);
    setScrubPosition(null);
    setMpvState((current) => current ? { ...current, position: nextPosition } : current);
    if (seekInFlightRef.current) return;
    if (seekCommitTimerRef.current !== null) {
      window.clearTimeout(seekCommitTimerRef.current);
    }
    seekCommitTimerRef.current = window.setTimeout(() => {
      seekCommitTimerRef.current = null;
      void flushPendingSeek();
    }, SEEK_COMMIT_DELAY_MS);
  }, [duration, flushPendingSeek, mpvState?.renderMode]);

  const setVolume = useCallback(async (value: number) => {
    if (!window.nexplay) return;
    const nextVolume = Math.max(0, Math.min(100, value));
    if (mpvState?.renderMode === "browserVideo") {
      const video = browserVideoRef.current;
      if (video) {
        video.volume = nextVolume / 100;
      }
      setMpvState((current) => current ? { ...current, volume: nextVolume } : current);
      return;
    }

    setMpvState((current) => current ? { ...current, volume: nextVolume } : current);
    try {
      const nextState = await window.nexplay.mpvSetVolume(nextVolume);
      setMpvState((current) => ({
        ...nextState,
        source: current?.source ?? source ?? undefined,
        renderMode: current?.renderMode,
        textureProbe: current?.textureProbe,
      }));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      onSnack(`音量调整失败：${message}`, "danger");
    }
  }, [mpvState?.renderMode, onSnack, source]);

  const handleRenderSurfaceError = useCallback((message: string) => {
    onSnack(`WebGL 画面渲染失败：${message}`, "danger");
  }, [onSnack]);

  const handleMpvFrame = useCallback((frame: MpvFrame) => {
    if (typeof frame.position !== "number" || !Number.isFinite(frame.position)) {
      return;
    }

    const framePosition = Math.max(0, frame.position);
    const sync = seekFrameSyncRef.current;
    const now = performance.now();
    let shouldPublishFrameClock = videoFramePositionRef.current === null;
    if (sync) {
      const lowerBound = Math.max(0, sync.target - SEEK_FRAME_ACCEPT_WINDOW_SECONDS);
      const upperBound = sync.target + SEEK_FRAME_ACCEPT_WINDOW_SECONDS;
      const matchesSeekTarget = framePosition >= lowerBound && framePosition <= upperBound;
      const timedOut = now - sync.startedAt >= SEEK_FRAME_SYNC_TIMEOUT_MS;
      if (!matchesSeekTarget && !timedOut) {
        return;
      }
      seekFrameSyncRef.current = null;
      shouldPublishFrameClock = true;
    }

    if (!shouldPublishFrameClock && now - lastFrameClockPublishAtRef.current < FRAME_CLOCK_PUBLISH_INTERVAL_MS) {
      return;
    }

    videoFramePositionRef.current = framePosition;
    lastFrameClockPublishAtRef.current = now;
    setVideoFramePosition(framePosition);
    setMpvState((current) => current ? { ...current, position: framePosition } : current);
  }, []);

  const handleDanmakuError = useCallback((message: string) => {
    onSnack(message, message.includes("旧缓存") ? "neutral" : "danger");
  }, [onSnack]);

  function resolveStableMpvPosition(current: MpvState | null, reportedPosition: number | undefined) {
    const latestSeekPosition = latestSeekPositionRef.current;
    if (seekingRef.current) {
      return latestSeekPosition ?? current?.position ?? reportedPosition;
    }

    const stabilization = seekStabilizationRef.current;
    if (!stabilization || typeof reportedPosition !== "number" || !Number.isFinite(reportedPosition)) {
      return reportedPosition;
    }

    const now = performance.now();
    const elapsedSeconds = Math.max(0, (now - stabilization.startedAt) / 1000);
    const lowerBound = stabilization.target - SEEK_POSITION_ACCEPT_BEFORE_SECONDS;
    const upperBound = stabilization.target + elapsedSeconds + SEEK_POSITION_ACCEPT_AFTER_SECONDS;
    const reportedHasSettled = reportedPosition >= lowerBound && reportedPosition <= upperBound;

    if (reportedHasSettled || now > stabilization.until) {
      seekStabilizationRef.current = null;
      return reportedPosition;
    }

    return current?.position ?? stabilization.target;
  }

  const toggleStageFullscreen = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage) return;
    try {
      if (document.fullscreenElement === stage) {
        await document.exitFullscreen();
      } else {
        await stage.requestFullscreen();
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      onSnack(`全屏切换失败：${message}`, "danger");
    }
  }, [onSnack]);

  return (
    <div className="relative h-full overflow-hidden bg-[var(--color-bg)]">
      <div className="player-page-wash pointer-events-none absolute inset-x-0 top-0 h-[360px]" />

      <div className="relative z-[1] h-full min-w-0">
        <section className="flex h-full min-w-0 flex-col px-8 py-7">
          <header className="mb-7 flex shrink-0 items-center justify-between gap-5">
            <motion.button
              type="button"
              className="group flex items-center gap-2 text-[13px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
              onClick={onBack}
              whileTap={{ scale: 0.96 }}
            >
              <span className="flex size-8 items-center justify-center rounded-full bg-[var(--color-surface-1)] shadow-[inset_0_0_0_0.5px_var(--color-outline-soft)]">
                <ChevronDown size={17} className="transition-transform group-hover:translate-y-0.5" />
              </span>
              收起播放器
            </motion.button>

            <div className="hidden min-w-0 text-right text-[12px] font-semibold text-[var(--color-text-tertiary)] md:block">
              {playableEpisodes.length} 集可播放
            </div>
          </header>

          <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto]">
            <div
              ref={stageRef}
              className="player-stage relative min-h-0 overflow-hidden rounded-[28px]"
            >
              <div className="absolute inset-0 bg-black" />
              <div className="player-video-layer absolute inset-0 overflow-hidden rounded-[28px] bg-black">
                {browserVideoReady ? (
                  <video
                    ref={browserVideoRef}
                    src={source?.sourceUrl}
                    className="absolute inset-0 size-full bg-black object-contain"
                    autoPlay
                    playsInline
                    preload="auto"
                    onLoadedMetadata={(event) => {
                      const video = event.currentTarget;
                      setMpvState((current) => current ? {
                        ...current,
                        duration: Number.isFinite(video.duration) ? video.duration : 0,
                        position: video.currentTime || 0,
                        paused: video.paused,
                        volume: Math.round(video.volume * 100),
                      } : current);
                      setPaused(video.paused);
                    }}
                    onTimeUpdate={(event) => {
                      const video = event.currentTarget;
                      if (seekingRef.current) return;
                      setMpvState((current) => current ? {
                        ...current,
                        duration: Number.isFinite(video.duration) ? video.duration : current.duration,
                        position: video.currentTime || 0,
                        paused: video.paused,
                      } : current);
                    }}
                    onPlay={() => {
                      setPaused(false);
                      setMpvState((current) => current ? { ...current, paused: false } : current);
                    }}
                    onPause={() => {
                      setPaused(true);
                      setMpvState((current) => current ? { ...current, paused: true } : current);
                    }}
                    onError={(event) => {
                      const error = event.currentTarget.error;
                      const message = error?.message || "浏览器原生播放器无法解码当前文件";
                      setPlaybackError(message);
                      onSnack(`原生播放失败：${message}`, "danger");
                    }}
                  />
                ) : webglTextureReady ? (
                  <MpvWebglSurface
                    active={webglTextureReady && !loadingSource && !playbackError && !seeking}
                    paused={paused}
                    videoWidth={mpvState?.videoWidth}
                    videoHeight={mpvState?.videoHeight}
                    fps={mpvState?.fps}
                    onError={handleRenderSurfaceError}
                    onFrame={handleMpvFrame}
                  />
                ) : heroSrc ? (
                  <img
                    src={heroSrc}
                    alt=""
                    className="absolute inset-0 size-full object-cover opacity-20"
                    draggable={false}
                  />
                ) : null}
                {!browserVideoReady && !webglTextureReady && <div className="absolute inset-0 bg-black/62" />}

                <DanmakuOverlay
                  mediaId={currentEpisode.mediaId}
                  visible={danmakuVisible && !loadingSource && !playbackError && !waitingForWebglFrameSync}
                  paused={paused}
                  seeking={seeking || waitingForWebglFrameSync}
                  position={danmakuPosition}
                  duration={duration}
                  area={danmakuArea}
                  onError={handleDanmakuError}
                />

                {!browserVideoReady && !webglTextureReady && <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-white">
                  {loadingSource ? (
                    <div className="text-[14px] text-white/70">正在启动 libmpv</div>
                  ) : playbackError ? null : (
                    <div className="max-w-[520px] opacity-80">
                      <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-white/12">
                        <Play size={24} fill="currentColor" />
                      </div>
                      <h3 className="text-[22px] font-bold">
                        {renderMode === "externalMpv" ? "外部 mpv 窗口播放中" : nativeBridgeReady ? "等待 WebGL 纹理输出" : "libmpv 后端播放中"}
                      </h3>
                      <p className="mt-2 text-[13px] leading-6 text-white/66">
                        {renderBridgeError
                          ? `画面输出暂不可用：${renderBridgeError}`
                          : nativeBridgeReady
                            ? "当前媒体控制已接管，画面将在纹理通道可用后进入播放器舞台。"
                          : renderBridgeError
                            ? `原生渲染桥暂不可用：${renderBridgeError}`
                            : "已接管 MKV、HEVC 10-bit、内封字幕与多音轨，正在等待原生渲染桥探测。"}
                      </p>
                    </div>
                  )}
                </div>}
                <button
                  type="button"
                  className="player-video-hit-area"
                  disabled={playbackControlsDisabled}
                  tabIndex={-1}
                  onClick={() => void togglePause()}
                  aria-label={paused ? "播放" : "暂停"}
                />
              </div>

              {playbackError && !loadingSource && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/72 px-6 text-center">
                  <div className="max-w-[420px] text-white">
                    <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-white/12">
                      <AlertTriangle size={22} />
                    </div>
                    <h3 className="text-[18px] font-bold">当前文件无法原生播放</h3>
                    <p className="mt-2 text-[13px] leading-6 text-white/70">
                      {playbackError}
                    </p>
                  </div>
                </div>
              )}

              <div className="player-stage-controls-scrim" />

              <div className="mpv-control-bar player-control-panel absolute inset-x-5 bottom-5 z-30">
                <div className="player-control-timeline">
                  <span className="player-time">{formatTime(displayedPosition)}</span>
                  <input
                    type="range"
                    className="mpv-progress-slider player-progress-slider"
                    min={0}
                    max={Math.max(1, duration)}
                    step={0.1}
                    value={Math.min(Math.max(0, displayedPosition), Math.max(1, duration))}
                    disabled={!duration}
                    onChange={(event) => setScrubPosition(Number(event.currentTarget.value))}
                    onBlur={(event) => {
                      if (scrubPosition !== null) {
                        void commitSeek(Number(event.currentTarget.value));
                      }
                    }}
                    onPointerUp={(event) => void commitSeek(Number(event.currentTarget.value))}
                    onKeyUp={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        void commitSeek(Number(event.currentTarget.value));
                      }
                    }}
                  />
                  <span className="player-time text-right">{formatTime(duration)}</span>
                </div>

                <div className="player-control-row">
                  <div className="player-now-playing">
                    <span>第 {currentEpisode.episode} 集</span>
                    <span>{source?.fileName || currentEpisode.fileName || displayEpisodeTitle}</span>
                  </div>

                  <div className="player-transport-controls">
                    <button
                      type="button"
                      className="player-icon-control"
                      disabled={!previousEpisode}
                      onClick={() => switchEpisode(previousEpisode)}
                      aria-label="上一集"
                      title="上一集"
                    >
                      <SkipBack size={17} />
                    </button>
                    <button
                      type="button"
                      className="player-play-control"
                      onClick={togglePause}
                      disabled={playbackControlsDisabled}
                      aria-label={paused ? "播放" : "暂停"}
                      title={paused ? "播放" : "暂停"}
                    >
                      {paused ? <Play size={21} fill="currentColor" /> : <Pause size={21} fill="currentColor" />}
                    </button>
                    <button
                      type="button"
                      className="player-icon-control"
                      disabled={!nextEpisode}
                      onClick={() => switchEpisode(nextEpisode)}
                      aria-label="下一集"
                      title="下一集"
                    >
                      <SkipForward size={17} />
                    </button>
                  </div>

                  <div className="player-secondary-actions">
                    <div className={cn("player-volume-menu", playbackControlsDisabled && "is-disabled")}>
                      <button
                        type="button"
                        className="player-icon-control"
                        disabled={playbackControlsDisabled}
                        aria-label={`音量 ${volume}%`}
                        title={`音量 ${volume}%`}
                      >
                        <Volume2 size={17} />
                      </button>
                      <div className="player-volume-flyout">
                        <span className="player-volume-value">{volume}%</span>
                        <input
                          type="range"
                          className="player-volume-slider"
                          min={0}
                          max={100}
                          step={1}
                          value={volume}
                          disabled={playbackControlsDisabled}
                          onChange={(event) => void setVolume(Number(event.currentTarget.value))}
                          aria-label="音量"
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      className={cn("player-icon-control", danmakuVisible && "is-active")}
                      onClick={() => setDanmakuVisible((current) => !current)}
                      aria-label={danmakuVisible ? "关闭弹幕" : "开启弹幕"}
                      aria-pressed={danmakuVisible}
                      title="弹幕"
                    >
                      <MessageCircle size={17} />
                    </button>

                    <button
                      type="button"
                      className="player-icon-control player-episode-control"
                      onClick={openEpisodeDrawer}
                      aria-label="选集"
                      title="选集"
                    >
                      <ListVideo size={17} />
                      <span className="player-episode-label">选集</span>
                    </button>

                    <div className="player-settings-menu" ref={settingsMenuRef}>
                      <button
                        type="button"
                        className={cn("player-icon-control", settingsMenuOpen && "is-active")}
                        onClick={() => setSettingsMenuOpen((current) => !current)}
                        aria-label="播放设置"
                        aria-expanded={settingsMenuOpen}
                        title="播放设置"
                      >
                        <Settings size={17} />
                      </button>
                      <AnimatePresence>
                        {settingsMenuOpen && (
                          <motion.div
                            className="player-settings-popover"
                            initial={{ opacity: 0, y: 10, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 8, scale: 0.98 }}
                            transition={appleSpringSoft}
                          >
                            <div className="mb-4 flex items-center justify-between gap-3">
                              <div>
                                <h3 className="text-[14px] font-bold text-white">播放设置</h3>
                                <p className="mt-1 text-[11px] text-white/52">音轨、字幕与弹幕显示</p>
                              </div>
                            </div>

                            <TrackOptionGroup
                              label="音轨"
                              value={selectedTrackValue(mpvState?.audioTracks)}
                              tracks={mpvState?.audioTracks ?? []}
                              emptyLabel="无音轨"
                              onChange={(value) => void setTrack("audio", value)}
                            />
                            <TrackOptionGroup
                              label="字幕"
                              value={selectedTrackValue(mpvState?.subtitleTracks) ?? "off"}
                              tracks={mpvState?.subtitleTracks ?? []}
                              allowOff
                              emptyLabel="无字幕"
                              onChange={(value) => void setTrack("subtitle", value)}
                            />

                            <div className="player-settings-section">
                              <div className="player-settings-section-head">
                                <span>弹幕区域</span>
                                <span>{danmakuVisible ? DANMAKU_AREAS.find((option) => option.value === danmakuArea)?.label : "已关闭"}</span>
                              </div>
                              <div className="player-segment-row">
                                {DANMAKU_AREAS.map((option) => (
                                  <button
                                    key={option.value}
                                    type="button"
                                    className={cn("player-segment-option", danmakuArea === option.value && "is-selected")}
                                    onClick={() => setDanmakuArea(option.value)}
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    <button
                      type="button"
                      className="player-icon-control"
                      onClick={() => void toggleStageFullscreen()}
                      aria-label={stageFullscreen ? "退出全屏" : "全屏播放"}
                      title={stageFullscreen ? "退出全屏" : "全屏播放"}
                    >
                      {stageFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div
              className="mt-8 flex shrink-0 items-center justify-between gap-5"
            >
              <div className="flex min-w-0 items-center gap-4">
                <div className="relative size-16 shrink-0 overflow-hidden rounded-2xl shadow-[0_16px_36px_rgba(0,0,0,0.16)]">
                  <Poster src={subject.poster} alt={subject.title} className="size-full" />
                </div>
                <div className="min-w-0">
                  <h1 className="truncate text-[28px] font-bold leading-tight tracking-tight text-[var(--color-text-primary)]">
                    {subject.title}
                  </h1>
                  <p className="mt-1 truncate text-[13px] text-[var(--color-text-secondary)]">
                    第 {currentEpisode.episode} 集 · {source?.fileName || currentEpisode.fileName || displayEpisodeTitle}
                  </p>
                </div>
              </div>

              <div className="hidden shrink-0 items-center gap-2 text-[12px] text-[var(--color-text-tertiary)] md:flex">
                <span>{source?.fileSize || currentEpisode.fileSize || ""}</span>
                <span className="h-3 w-px bg-black/10" />
                <span>{playableEpisodes.length} 集可播放</span>
              </div>
            </div>
          </div>
        </section>

        <EpisodeRail
          open={episodeDrawerOpen}
          episodes={episodes}
          playableCount={playableEpisodes.length}
          currentKey={currentEpisode.key}
          onClose={() => setEpisodeDrawerOpen(false)}
          onSelect={(episode) => {
            switchEpisode(episode);
            setEpisodeDrawerOpen(false);
          }}
        />
      </div>
    </div>
  );
}

function EpisodeRail({
  open,
  episodes,
  playableCount,
  currentKey,
  onClose,
  onSelect,
}: {
  open: boolean;
  episodes: PlaybackEpisode[];
  playableCount: number;
  currentKey: string;
  onClose: () => void;
  onSelect: (episode: PlaybackEpisode) => void;
}) {
  const [onlyPlayable, setOnlyPlayable] = useState(false);
  const selectedEpisodeRef = useRef<HTMLButtonElement | null>(null);
  const visibleEpisodes = onlyPlayable
    ? episodes.filter((episode) => episode.cached && episode.mediaId)
    : episodes;

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      selectedEpisodeRef.current?.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentKey, onlyPlayable, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="player-episode-overlay absolute inset-0 z-40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/18"
            onClick={onClose}
            aria-label="关闭选集"
          />
          <motion.aside
            className="player-episode-rail absolute bottom-5 right-5 top-5 flex w-[min(420px,calc(100vw-48px))] flex-col rounded-[26px] border border-[var(--color-outline-soft)] bg-[var(--color-surface-1)] px-5 py-5 shadow-[0_30px_90px_rgba(0,0,0,0.18)]"
            role="dialog"
            aria-modal="true"
            aria-label="选集"
            initial={{ opacity: 0, x: 28, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 28, scale: 0.98 }}
            transition={appleSpringSoft}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-[17px] font-bold tracking-tight text-[var(--color-text-primary)]">选集</h2>
                <span className="mt-1 block text-[12px] text-[var(--color-text-tertiary)]">
                  {playableCount} / {episodes.length} 集可播放
                </span>
              </div>
              <button
                type="button"
                className="flex size-9 items-center justify-center rounded-full bg-black/[0.05] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                onClick={onClose}
                aria-label="关闭选集"
              >
                <X size={17} />
              </button>
            </div>

            <div className="player-episode-filter mb-4">
              <button
                type="button"
                className={cn(!onlyPlayable && "is-selected")}
                onClick={() => setOnlyPlayable(false)}
              >
                全部
              </button>
              <button
                type="button"
                className={cn(onlyPlayable && "is-selected")}
                onClick={() => setOnlyPlayable(true)}
              >
                可播放
              </button>
            </div>

            <div className="player-episode-list -mx-1 min-h-0 flex-1 overflow-y-auto px-1 pr-1">
              {visibleEpisodes.map((episode) => {
                const selected = episode.key === currentKey;
                const playable = Boolean(episode.cached && episode.mediaId);
                const title = episodeTitle(episode);
                return (
                  <motion.button
                    key={episode.key}
                    ref={selected ? selectedEpisodeRef : undefined}
                    type="button"
                    className={cn(
                      "player-episode-row group relative mb-2.5 flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors",
                      playable ? "hover:bg-black/[0.035]" : "cursor-default opacity-54",
                      selected && "is-selected bg-[var(--color-primary-soft)] hover:bg-[var(--color-primary-soft)]"
                    )}
                    disabled={!playable}
                    onClick={() => onSelect(episode)}
                    whileTap={{ scale: 0.985 }}
                  >
                    <span
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums",
                        selected
                          ? "bg-[var(--color-primary)] text-white"
                          : playable
                            ? "bg-black/[0.05] text-[var(--color-text-secondary)]"
                            : "bg-black/[0.035] text-[var(--color-text-tertiary)]"
                      )}
                    >
                      {selected ? <Play size={14} fill="currentColor" /> : playable ? <Check size={15} /> : episode.episode}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[13.5px] font-semibold text-[var(--color-text-primary)]">
                          第 {episode.episode} 集
                          {title && title !== `第 ${episode.episode} 集` ? ` · ${title}` : ""}
                        </span>
                        {selected && (
                          <span className="shrink-0 rounded-full bg-[var(--color-primary)] px-2 py-0.5 text-[10px] font-bold text-white">
                            正在播放
                          </span>
                        )}
                      </span>
                      <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11.5px] text-[var(--color-text-tertiary)]">
                        <Clock3 size={12} />
                        <span className="truncate">
                          {playable
                            ? episode.fileSize || episode.fileName || episode.airDate || "已缓存"
                            : episode.airDate || "未缓存"}
                        </span>
                      </span>
                    </span>
                  </motion.button>
                );
              })}
              {!visibleEpisodes.length && (
                <div className="flex h-28 items-center justify-center rounded-2xl bg-black/[0.035] text-[13px] font-semibold text-[var(--color-text-tertiary)]">
                  没有可播放剧集
                </div>
              )}
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function episodeTitle(episode: PlaybackEpisode) {
  return episode.titleCn || episode.title || `第 ${episode.episode} 集`;
}

function selectedTrackValue(tracks: MpvState["audioTracks"] | undefined) {
  const selected = tracks?.find((track) => track.selected);
  return selected ? String(selected.id) : undefined;
}

function canUseBrowserVideoSource(source: MediaSource) {
  const name = `${source.fileName || ""} ${source.sourceUrl || ""}`.toLowerCase();
  const mime = name.includes(".webm")
    ? "video/webm"
    : name.includes(".mp4") || name.includes(".m4v")
      ? "video/mp4"
      : name.includes(".ogv") || name.includes(".ogg")
        ? "video/ogg"
        : "";
  if (!mime) {
    return false;
  }
  const video = document.createElement("video");
  return video.canPlayType(mime) !== "";
}

function formatTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0:00";
  }
  const total = Math.floor(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName);
}

function TrackOptionGroup({
  label,
  value,
  tracks,
  allowOff = false,
  emptyLabel,
  onChange,
}: {
  label: string;
  value?: string;
  tracks: MpvTrack[];
  allowOff?: boolean;
  emptyLabel: string;
  onChange: (value: string) => void;
}) {
  const selected = tracks.find((track) => String(track.id) === value);
  const summary = selected
    ? trackLabel(selected)
    : allowOff
      ? "关闭"
      : tracks.length
        ? "未选择"
        : emptyLabel;

  return (
    <div className="player-settings-section">
      <div className="player-settings-section-head">
        <span>{label}</span>
        <span>{summary}</span>
      </div>
      <div className="player-track-options">
        {allowOff && (
          <button
            type="button"
            className={cn("player-track-option", (value ?? "off") === "off" && "is-selected")}
            onClick={() => onChange("off")}
          >
            关闭
          </button>
        )}
        {!tracks.length && !allowOff && (
          <div className="player-track-empty">{emptyLabel}</div>
        )}
        {tracks.map((track) => (
          <button
            key={track.id}
            type="button"
            className={cn("player-track-option", String(track.id) === value && "is-selected")}
            onClick={() => onChange(String(track.id))}
          >
            {trackLabel(track)}
          </button>
        ))}
      </div>
    </div>
  );
}

function trackLabel(track: MpvTrack) {
  const parts = [
    track.lang,
    track.title,
    track.codec,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : `${track.kind} #${track.id}`;
}
