import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock3,
  FilePlus2,
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
  VolumeX,
} from "lucide-react";
import { makePlaybackEpisodes, type PlaybackEpisode, type Subject } from "../data";
import { DanmakuOverlay } from "../DanmakuOverlay";
import { Poster } from "../MediaCard";
import { appleSpringSoft } from "../motion";
import { MpvWebglSurface } from "../MpvWebglSurface";
import { resolveAssetUrl } from "../utils/assets";
import { cn } from "../utils/cn";
import { reportPlaybackProgress, type MediaSource, type MpvFrame, type MpvRenderInfo, type MpvState, type MpvTrack } from "../backend";

const SEEK_COMMIT_DELAY_MS = 80;
const SEEK_POSITION_SETTLE_MS = 3500;
const SEEK_POSITION_ACCEPT_BEFORE_SECONDS = 1.25;
const SEEK_POSITION_ACCEPT_AFTER_SECONDS = 2.5;
const FRAME_CLOCK_PUBLISH_INTERVAL_MS = 250;
const DANMAKU_SEEK_RESET_DELAY_MS = 650;
const CONTROLS_IDLE_HIDE_MS = 1400;
const KEYBOARD_SEEK_STEP_SECONDS = 5;
const KEYBOARD_VOLUME_STEP = 5;
const DANMAKU_AREAS = [
  { label: "1/4屏", value: 0.25 },
  { label: "半屏", value: 0.5 },
  { label: "满屏", value: 1 },
] as const;

export function PlayerPage({
  subject,
  initialEpisode,
  onBack,
  onSubjectUpdated,
  onSnack,
}: {
  subject: Subject;
  initialEpisode: PlaybackEpisode;
  onBack: () => void;
  onSubjectUpdated?: (subject: Subject) => void | Promise<void>;
  onSnack: (text: string, tone?: "neutral" | "success" | "danger") => void;
}) {
  const episodes = useMemo(() => makePlaybackEpisodes(subject), [subject]);
  const seekInFlightRef = useRef(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const volumeMenuRef = useRef<HTMLDivElement | null>(null);
  const browserVideoRef = useRef<HTMLVideoElement | null>(null);
  const pendingSeekPositionRef = useRef<number | null>(null);
  const latestSeekPositionRef = useRef<number | null>(null);
  const seekStabilizationRef = useRef<{
    target: number;
    startedAt: number;
    until: number;
  } | null>(null);
  const lastFrameClockPublishAtRef = useRef(0);
  const danmakuSeekResetTimerRef = useRef<number | null>(null);
  const danmakuSeekResetVersionRef = useRef(0);
  const seekCommitTimerRef = useRef<number | null>(null);
  const seekingRef = useRef(false);
  const completedSyncKeyRef = useRef<string | null>(null);
  const localProgressReportRef = useRef<{ key: string; position: number; reportedAt: number } | null>(null);
  const playbackProgressContextRef = useRef<{
    subjectId: number;
    episodeId: number;
    mediaId?: number;
    episodeKey: string;
    position: number;
    duration: number;
  } | null>(null);
  const controlsIdleTimerRef = useRef<number | null>(null);
  const pointerOverControlsRef = useRef(false);
  const previousVolumeRef = useRef(100);
  const latestVolumeRef = useRef(100);
  const [currentKey, setCurrentKey] = useState(initialEpisode.key);
  const [source, setSource] = useState<MediaSource | null>(null);
  const [mpvState, setMpvState] = useState<MpvState | null>(null);
  const [loadingSource, setLoadingSource] = useState(true);
  const [danmakuVisible, setDanmakuVisible] = useState(() => readDanmakuPref(subject.id));
  const [danmakuArea, setDanmakuArea] = useState<(typeof DANMAKU_AREAS)[number]["value"]>(0.5);
  const [episodePanelOpen, setEpisodePanelOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [renderInfo, setRenderInfo] = useState<MpvRenderInfo | null>(null);
  const [paused, setPaused] = useState(false);
  const [stageFullscreen, setStageFullscreen] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [scrubPosition, setScrubPosition] = useState<number | null>(null);
  const [danmakuSeekSuspended, setDanmakuSeekSuspended] = useState(false);
  const [danmakuSeekReset, setDanmakuSeekReset] = useState<{ version: number; position: number } | null>(null);
  const [renderFrameGeneration, setRenderFrameGeneration] = useState(0);
  const heroAsset = subject.hero || subject.poster;
  const heroSrc = resolveAssetUrl(heroAsset);
  const playableEpisodes = useMemo(() => episodes.filter((episode) => episode.cached && episode.mediaId), [episodes]);
  const {
    currentEpisode,
    previousEpisode,
    nextEpisode,
  } = useMemo(() => {
    const index = episodes.findIndex((episode) => episode.key === currentKey);
    const safeIndex = index >= 0 ? index : -1;
    const selectedEpisode = safeIndex >= 0 ? episodes[safeIndex] : initialEpisode;
    let previous: PlaybackEpisode | undefined;
    let next: PlaybackEpisode | undefined;

    for (let i = safeIndex - 1; i >= 0; i -= 1) {
      const episode = episodes[i];
      if (episode.cached && episode.mediaId) {
        previous = episode;
        break;
      }
    }

    for (let i = Math.max(0, safeIndex + 1); i < episodes.length; i += 1) {
      const episode = episodes[i];
      if (episode.cached && episode.mediaId) {
        next = episode;
        break;
      }
    }

    return {
      currentEpisode: selectedEpisode,
      previousEpisode: previous,
      nextEpisode: next,
    };
  }, [currentKey, episodes, initialEpisode]);
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
  const displayedPosition = scrubPosition ?? position;
  const volume = Math.round(mpvState?.volume ?? 100);
  const playbackControlsDisabled = loadingSource || Boolean(playbackError);
  const bgmSubjectId = subject.provider === "bangumi" ? Number(subject.providerSubjectId) : NaN;

  useEffect(() => {
    latestVolumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    playbackProgressContextRef.current = {
      subjectId: Number.isFinite(bgmSubjectId) ? bgmSubjectId : 0,
      episodeId: currentEpisode.bgmEpisodeId ?? 0,
      mediaId: currentEpisode.mediaId,
      episodeKey: currentEpisode.key,
      position,
      duration,
    };
  });

  const flushPlaybackProgress = useCallback((positionOverride?: number, durationOverride?: number) => {
    const context = playbackProgressContextRef.current;
    if (!context?.mediaId || !window.nexplay) {
      return;
    }
    const nextPosition = Number.isFinite(positionOverride) ? Math.max(0, positionOverride ?? 0) : context.position;
    const nextDuration = Number.isFinite(durationOverride) ? Math.max(0, durationOverride ?? 0) : context.duration;
    if (!Number.isFinite(nextPosition) || !Number.isFinite(nextDuration) || nextDuration <= 0 || nextPosition <= 0) {
      return;
    }
    localProgressReportRef.current = {
      key: context.episodeKey,
      position: nextPosition,
      reportedAt: Date.now(),
    };
    void reportPlaybackProgress({
      subjectId: context.subjectId,
      episodeId: context.episodeId,
      mediaId: context.mediaId,
      position: nextPosition,
      duration: nextDuration,
    }).catch(() => {
      // Best-effort persistence; the periodic reporter will retry while playback continues.
    });
  }, []);

  const clearDanmakuSeekResetTimer = useCallback(() => {
    if (danmakuSeekResetTimerRef.current !== null) {
      window.clearTimeout(danmakuSeekResetTimerRef.current);
      danmakuSeekResetTimerRef.current = null;
    }
  }, []);

  const suspendDanmakuForSeek = useCallback(() => {
    clearDanmakuSeekResetTimer();
    setDanmakuSeekSuspended(true);
  }, [clearDanmakuSeekResetTimer]);

  const scheduleDanmakuSeekReset = useCallback((targetPosition: number) => {
    clearDanmakuSeekResetTimer();
    setDanmakuSeekSuspended(true);
    danmakuSeekResetTimerRef.current = window.setTimeout(() => {
      danmakuSeekResetTimerRef.current = null;
      danmakuSeekResetVersionRef.current += 1;
      setDanmakuSeekReset({
        version: danmakuSeekResetVersionRef.current,
        position: targetPosition,
      });
      setDanmakuSeekSuspended(false);
    }, DANMAKU_SEEK_RESET_DELAY_MS);
  }, [clearDanmakuSeekResetTimer]);

  const settleDanmakuClockAtPosition = useCallback((targetPosition: number) => {
    if (!Number.isFinite(targetPosition)) return null;
    const position = Math.max(0, targetPosition);
    clearDanmakuSeekResetTimer();
    setDanmakuSeekSuspended(false);
    seekStabilizationRef.current = null;
    latestSeekPositionRef.current = position;
    return position;
  }, [clearDanmakuSeekResetTimer]);

  const cancelDanmakuSeekReset = useCallback(() => {
    clearDanmakuSeekResetTimer();
    setDanmakuSeekSuspended(false);
  }, [clearDanmakuSeekResetTimer]);

  useEffect(() => {
    setCurrentKey(initialEpisode.key);
  }, [initialEpisode.key, subject.id]);

  // Remember the danmaku on/off choice per subject, and re-read it when switching subjects.
  useEffect(() => {
    setDanmakuVisible(readDanmakuPref(subject.id));
  }, [subject.id]);
  useEffect(() => {
    try {
      window.localStorage.setItem(`nexplay.danmaku.${subject.id}`, danmakuVisible ? "1" : "0");
    } catch {
      // ignore storage failures (private mode etc.)
    }
  }, [danmakuVisible, subject.id]);

  useEffect(() => {
    const episodeId = currentEpisode.bgmEpisodeId;
    const hasBangumiCompletionTarget = Number.isFinite(bgmSubjectId) && episodeId;
    if (!currentEpisode.mediaId || !Number.isFinite(duration) || !Number.isFinite(position) || duration <= 0) {
      return;
    }
    const threshold = Math.max(duration * 0.9, duration - 90);
    if (position < threshold) {
      return;
    }
    const syncKey = hasBangumiCompletionTarget
      ? `${bgmSubjectId}:${episodeId}`
      : `local:${currentEpisode.key}:${currentEpisode.mediaId}`;
    if (completedSyncKeyRef.current === syncKey) {
      return;
    }
    completedSyncKeyRef.current = syncKey;
    reportPlaybackProgress({
      subjectId: hasBangumiCompletionTarget ? bgmSubjectId : 0,
      episodeId: episodeId ?? 0,
      mediaId: currentEpisode.mediaId,
      position,
      duration,
    })
      .then((result) => {
        void onSubjectUpdated?.(subject);
        if (result.episodes > 0 || result.queued > 0) {
          onSnack(result.message, result.queued > 0 ? "neutral" : "success");
        }
      })
      .catch((caught) => {
        completedSyncKeyRef.current = null;
        const message = caught instanceof Error ? caught.message : String(caught);
        onSnack(hasBangumiCompletionTarget ? `Bangumi 完播同步失败：${message}` : `保存播放进度失败：${message}`, "danger");
      });
  }, [bgmSubjectId, currentEpisode.bgmEpisodeId, currentEpisode.key, currentEpisode.mediaId, duration, onSnack, onSubjectUpdated, position, subject]);

  useEffect(() => {
    if (!currentEpisode.mediaId || !Number.isFinite(duration) || !Number.isFinite(position) || duration <= 0 || position <= 0) {
      return;
    }
    const threshold = Math.max(duration * 0.9, duration - 90);
    if (position >= threshold) {
      return;
    }
    const now = Date.now();
    const last = localProgressReportRef.current;
    if (
      last?.key === currentEpisode.key
      && now - last.reportedAt < 10_000
      && Math.abs(position - last.position) < 5
    ) {
      return;
    }
    localProgressReportRef.current = { key: currentEpisode.key, position, reportedAt: now };
    reportPlaybackProgress({
      subjectId: Number.isFinite(bgmSubjectId) ? bgmSubjectId : 0,
      episodeId: currentEpisode.bgmEpisodeId ?? 0,
      mediaId: currentEpisode.mediaId,
      position,
      duration,
    }).catch(() => {
      localProgressReportRef.current = last;
    });
  }, [bgmSubjectId, currentEpisode.bgmEpisodeId, currentEpisode.key, currentEpisode.mediaId, duration, position]);

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
      setRenderFrameGeneration((generation) => generation + 1);
      seekStabilizationRef.current = null;
      pendingSeekPositionRef.current = null;
      latestSeekPositionRef.current = null;
      lastFrameClockPublishAtRef.current = 0;
      cancelDanmakuSeekReset();
      setDanmakuSeekReset(null);
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
        const resumePosition = resumePositionFromSource(nextSource);
        if (canUseBrowserVideoSource(nextSource)) {
          if (!cancelled) {
            setSource(nextSource);
            setMpvState({
              ok: true,
              loaded: true,
              audioTracks: [],
              subtitleTracks: [],
              duration: 0,
              position: resumePosition,
              paused: false,
              volume: 100,
              source: nextSource,
              renderMode: "browserVideo",
            });
            setPaused(false);
          }
          return;
        }

        let nextState = await window.nexplay.mpvLoad(currentEpisode.mediaId);
        const loadedRenderMode = nextState.renderMode;
        const loadedTextureProbe = nextState.textureProbe;
        const rememberedSubtitlePath = readRememberedSubtitlePath(currentEpisode.mediaId);
        if (rememberedSubtitlePath && window.nexplay.mpvAddSubtitlePath) {
          try {
            const restoredSubtitle = await window.nexplay.mpvAddSubtitlePath(rememberedSubtitlePath);
            nextState = {
              ...restoredSubtitle.state,
              source: nextSource,
              renderMode: loadedRenderMode,
              textureProbe: loadedTextureProbe,
            };
          } catch {
            forgetRememberedSubtitlePath(currentEpisode.mediaId);
          }
        }
        if (resumePosition > 1) {
          try {
            const seekState = await window.nexplay.mpvSeek(resumePosition);
            nextState = {
              ...seekState,
              source: nextSource,
              renderMode: loadedRenderMode,
              textureProbe: loadedTextureProbe,
            };
            latestSeekPositionRef.current = resumePosition;
            seekStabilizationRef.current = {
              target: resumePosition,
              startedAt: performance.now(),
              until: performance.now() + SEEK_POSITION_SETTLE_MS,
            };
            scheduleDanmakuSeekReset(resumePosition);
          } catch {
            // Resume is opportunistic; playback should still start if the seek fails.
          }
        }
        if (!cancelled) {
          setMpvState({
            ...nextState,
            position: resumePosition > 1 ? resumePosition : nextState.position,
            source: nextSource,
            renderMode: loadedRenderMode,
            textureProbe: loadedTextureProbe,
          });
          setSource(nextSource);
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
  }, [cancelDanmakuSeekReset, currentEpisode.mediaId, onSnack, scheduleDanmakuSeekReset]);

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
      flushPlaybackProgress();
      if (seekCommitTimerRef.current !== null) {
        window.clearTimeout(seekCommitTimerRef.current);
      }
      clearDanmakuSeekResetTimer();
      void window.nexplay?.mpvStop();
    };
  }, [clearDanmakuSeekResetTimer, flushPlaybackProgress]);

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
    flushPlaybackProgress();
    setSettingsMenuOpen(false);
    setEpisodePanelOpen(false);
    setPlaybackError(null);
    setCurrentKey(episode.key);
  }, [flushPlaybackProgress]);

  const toggleEpisodePanel = useCallback(() => {
    setSettingsMenuOpen(false);
    setVolumeOpen(false);
    setEpisodePanelOpen((current) => !current);
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

  const addSubtitle = useCallback(async () => {
    if (!window.nexplay || !currentEpisode.mediaId) return;
    try {
      const result = await window.nexplay.mpvAddSubtitle();
      if (!result) {
        return;
      }
      rememberSubtitlePath(currentEpisode.mediaId, result.path);
      setMpvState((current) => ({
        ...result.state,
        source: current?.source ?? source ?? undefined,
        renderMode: current?.renderMode,
        textureProbe: current?.textureProbe,
      }));
      onSnack("已添加外部字幕", "success");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      onSnack(`添加字幕失败：${message}`, "danger");
    }
  }, [currentEpisode.mediaId, onSnack, source]);

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
        const nextPosition = video.currentTime || 0;
        if (nextPaused) {
          settleDanmakuClockAtPosition(nextPosition);
          flushPlaybackProgress(nextPosition, Number.isFinite(video.duration) ? video.duration : duration);
        }
        setPaused(nextPaused);
        setMpvState((current) => current ? { ...current, paused: nextPaused, position: nextPosition } : current);
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        onSnack(`播放控制失败：${message}`, "danger");
      }
      return;
    }

    try {
      const nextState = await window.nexplay.mpvSetPause(nextPaused);
      const nextPosition = Number.isFinite(nextState.position) ? Math.max(0, nextState.position ?? 0) : null;
      if (nextPaused && nextPosition !== null) {
        settleDanmakuClockAtPosition(nextPosition);
        flushPlaybackProgress(nextPosition, nextState.duration ?? duration);
      }
      setPaused(nextPaused);
      setMpvState((current) => ({
        ...nextState,
        position: nextPosition ?? nextState.position,
        source: current?.source ?? source ?? undefined,
        renderMode: current?.renderMode ?? nextState.renderMode,
        textureProbe: current?.textureProbe ?? nextState.textureProbe,
      }));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      onSnack(`播放控制失败：${message}`, "danger");
    }
  }, [duration, flushPlaybackProgress, loadingSource, mpvState?.renderMode, onSnack, paused, playbackError, settleDanmakuClockAtPosition, source]);

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
            scheduleDanmakuSeekReset(targetPosition);
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
            cancelDanmakuSeekReset();
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
  }, [cancelDanmakuSeekReset, onSnack, scheduleDanmakuSeekReset, source]);

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
      scheduleDanmakuSeekReset(nextPosition);
      setMpvState((current) => current ? { ...current, position: nextPosition } : current);
      return;
    }

    latestSeekPositionRef.current = nextPosition;
    setRenderFrameGeneration((generation) => generation + 1);
    const startedAt = performance.now();
    seekStabilizationRef.current = {
      target: nextPosition,
      startedAt,
      until: startedAt + SEEK_POSITION_SETTLE_MS,
    };
    suspendDanmakuForSeek();
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
  }, [duration, flushPendingSeek, mpvState?.renderMode, scheduleDanmakuSeekReset, suspendDanmakuForSeek]);

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
    const now = performance.now();
    if (now - lastFrameClockPublishAtRef.current < FRAME_CLOCK_PUBLISH_INTERVAL_MS) {
      return;
    }

    lastFrameClockPublishAtRef.current = now;
    setMpvState((current) => current ? {
      ...current,
      position: resolveStableMpvPosition(current, framePosition),
    } : current);
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

  const toggleMute = useCallback(() => {
    if (volume > 0) {
      previousVolumeRef.current = volume;
      void setVolume(0);
    } else {
      void setVolume(previousVolumeRef.current || 100);
    }
  }, [setVolume, volume]);

  const seekByKeyboard = useCallback((deltaSeconds: number) => {
    const pendingPosition = pendingSeekPositionRef.current;
    const basePosition = pendingPosition
      ?? (seekingRef.current ? latestSeekPositionRef.current : null)
      ?? scrubPosition
      ?? position;
    const limit = duration > 0 ? duration : Number.POSITIVE_INFINITY;
    const nextPosition = Math.min(limit, Math.max(0, basePosition + deltaSeconds));
    commitSeek(nextPosition);
  }, [commitSeek, duration, position, scrubPosition]);

  const adjustVolumeByKeyboard = useCallback((delta: number) => {
    const nextVolume = Math.max(0, Math.min(100, latestVolumeRef.current + delta));
    latestVolumeRef.current = nextVolume;
    void setVolume(nextVolume);
  }, [setVolume]);

  // Auto-hide the on-stage controls after the pointer goes idle.
  const keepControlsRef = useRef(false);
  const clearControlsIdleTimer = useCallback(() => {
    if (controlsIdleTimerRef.current !== null) {
      window.clearTimeout(controlsIdleTimerRef.current);
      controlsIdleTimerRef.current = null;
    }
  }, []);

  const scheduleControlsHide = useCallback(() => {
    clearControlsIdleTimer();
    controlsIdleTimerRef.current = window.setTimeout(() => {
      controlsIdleTimerRef.current = null;
      if (keepControlsRef.current || pointerOverControlsRef.current) return;
      setSettingsMenuOpen(false);
      setVolumeOpen(false);
      setEpisodePanelOpen(false);
      setControlsVisible(false);
    }, CONTROLS_IDLE_HIDE_MS);
  }, [clearControlsIdleTimer]);

  useEffect(() => {
    keepControlsRef.current =
      loadingSource || Boolean(playbackError);
    if (keepControlsRef.current) {
      setControlsVisible(true);
      clearControlsIdleTimer();
    } else {
      scheduleControlsHide();
    }
  }, [clearControlsIdleTimer, loadingSource, playbackError, scheduleControlsHide]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (keepControlsRef.current) {
      clearControlsIdleTimer();
      return;
    }
    scheduleControlsHide();
  }, [clearControlsIdleTimer, scheduleControlsHide]);

  useEffect(() => {
    return () => {
      clearControlsIdleTimer();
    };
  }, [clearControlsIdleTimer]);

  // Keyboard shortcuts: space play/pause, arrows seek/volume, F fullscreen, M mute, D danmaku.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      blurActiveNonTextControl();
      if (isEditableTarget(event.target)) {
        if (event.code === "Space" && event.target instanceof HTMLButtonElement) {
          event.preventDefault();
          event.stopPropagation();
          event.target.blur();
          void togglePause();
        }
        return;
      }
      switch (event.code) {
        case "Space":
          event.preventDefault();
          void togglePause();
          break;
        case "ArrowLeft":
          event.preventDefault();
          seekByKeyboard(-KEYBOARD_SEEK_STEP_SECONDS);
          break;
        case "ArrowRight":
          event.preventDefault();
          seekByKeyboard(KEYBOARD_SEEK_STEP_SECONDS);
          break;
        case "ArrowUp":
          event.preventDefault();
          adjustVolumeByKeyboard(KEYBOARD_VOLUME_STEP);
          break;
        case "ArrowDown":
          event.preventDefault();
          adjustVolumeByKeyboard(-KEYBOARD_VOLUME_STEP);
          break;
        case "KeyF":
          event.preventDefault();
          void toggleStageFullscreen();
          break;
        case "KeyM":
          event.preventDefault();
          revealControls();
          toggleMute();
          break;
        case "KeyD":
          event.preventDefault();
          revealControls();
          setDanmakuVisible((current) => !current);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [adjustVolumeByKeyboard, revealControls, seekByKeyboard, toggleMute, togglePause, toggleStageFullscreen]);

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
            <div className="player-watch-layout min-h-0">
              <div
                ref={stageRef}
                className={cn(
                  "player-stage relative min-h-0 overflow-hidden rounded-[28px]",
                  !controlsVisible && "cursor-none"
                )}
                onMouseMove={revealControls}
                onMouseLeave={() => {
                  if (!keepControlsRef.current) setControlsVisible(false);
                }}
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
                      const resumePosition = source ? resumePositionFromSource(source) : 0;
                      if (resumePosition > 1 && Number.isFinite(video.duration)) {
                        video.currentTime = Math.min(resumePosition, Math.max(0, video.duration - 2));
                      }
                      setMpvState((current) => current ? {
                        ...current,
                        duration: Number.isFinite(video.duration) ? video.duration : 0,
                        position: video.currentTime || resumePosition,
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
                      const video = browserVideoRef.current;
                      if (video) {
                        flushPlaybackProgress(video.currentTime || 0, Number.isFinite(video.duration) ? video.duration : duration);
                      }
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
                    generation={renderFrameGeneration}
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

                {danmakuVisible && (
                  <DanmakuOverlay
                    mediaId={currentEpisode.mediaId}
                    visible={!loadingSource && !playbackError}
                    paused={paused}
                    seeking={seeking || danmakuSeekSuspended}
                    seekReset={danmakuSeekReset}
                    position={position}
                    duration={duration}
                    area={danmakuArea}
                    onError={handleDanmakuError}
                  />
                )}

                {!browserVideoReady && !webglTextureReady && <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-white">
                  {loadingSource ? (
                    <div className="text-[14px] text-white/70">正在启动 libmpv</div>
                  ) : playbackError ? null : (
                    <div className="max-w-[520px] opacity-80">
                      <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-white/12">
                        <Play size={24} fill="currentColor" />
                      </div>
                      <h3 className="text-[22px] font-bold">
                        {nativeBridgeReady ? "等待 WebGL 纹理输出" : "内嵌播放器准备中"}
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
                {paused && !loadingSource && !playbackError && (
                  <div className="player-paused-indicator" aria-hidden>
                    <span>
                      <Pause size={22} fill="currentColor" />
                    </span>
                    <strong>已暂停</strong>
                  </div>
                )}
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

              <div className={cn("player-stage-controls-scrim transition-opacity duration-300", !controlsVisible && "opacity-0")} />

              <div
                className={cn(
                  "mpv-control-bar player-control-panel absolute inset-x-5 bottom-5 z-30 transition-all duration-300",
                  !controlsVisible && "pointer-events-none translate-y-3 opacity-0"
                )}
                onMouseEnter={() => {
                  pointerOverControlsRef.current = true;
                }}
                onMouseLeave={() => {
                  pointerOverControlsRef.current = false;
                  if (!keepControlsRef.current) scheduleControlsHide();
                }}
              >
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
                    <div
                      className={cn("player-volume-menu", playbackControlsDisabled && "is-disabled")}
                      ref={volumeMenuRef}
                      onMouseEnter={() => {
                        if (!playbackControlsDisabled) {
                          setSettingsMenuOpen(false);
                          setEpisodePanelOpen(false);
                          setVolumeOpen(true);
                        }
                      }}
                      onMouseLeave={() => setVolumeOpen(false)}
                    >
                      <button
                        type="button"
                        className={cn("player-icon-control", volumeOpen && "is-active")}
                        disabled={playbackControlsDisabled}
                        onClick={toggleMute}
                        aria-label={`音量 ${volume}%`}
                        aria-expanded={volumeOpen}
                        title={`音量 ${volume}%`}
                      >
                        {volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
                      </button>
                      <div className={cn("player-volume-flyout", volumeOpen && "is-open")}>
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
                      className={cn("player-icon-control player-episode-control", episodePanelOpen && "is-active")}
                      onClick={toggleEpisodePanel}
                      aria-label="选集"
                      aria-expanded={episodePanelOpen}
                      title="选集"
                    >
                      <ListVideo size={17} />
                      <span className="player-episode-label">选集</span>
                    </button>

                    <div className="player-settings-menu" ref={settingsMenuRef}>
                      <button
                        type="button"
                        className={cn("player-icon-control", settingsMenuOpen && "is-active")}
                        onClick={() => {
                          setVolumeOpen(false);
                          setEpisodePanelOpen(false);
                          setSettingsMenuOpen((current) => !current);
                        }}
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
                              onAddSubtitle={() => void addSubtitle()}
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

                <AnimatePresence>
                  {episodePanelOpen && (
                    <motion.div
                      className="player-episode-popover"
                      initial={{ opacity: 0, y: 12, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.98 }}
                      transition={appleSpringSoft}
                    >
                      <EpisodeListPanel
                        episodes={episodes}
                        playableCount={playableEpisodes.length}
                        currentKey={currentEpisode.key}
                        variant="overlay"
                        onSelect={switchEpisode}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              </div>

              <EpisodeListPanel
                episodes={episodes}
                playableCount={playableEpisodes.length}
                currentKey={currentEpisode.key}
                variant="sidebar"
                onSelect={switchEpisode}
              />
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

      </div>
    </div>
  );
}

function EpisodeListPanel({
  episodes,
  playableCount,
  currentKey,
  variant,
  onSelect,
}: {
  episodes: PlaybackEpisode[];
  playableCount: number;
  currentKey: string;
  variant: "sidebar" | "overlay";
  onSelect: (episode: PlaybackEpisode) => void;
}) {
  const [onlyPlayable, setOnlyPlayable] = useState(false);
  const selectedEpisodeRef = useRef<HTMLButtonElement | null>(null);
  const visibleEpisodes = useMemo(
    () => onlyPlayable
      ? episodes.filter((episode) => episode.cached && episode.mediaId)
      : episodes,
    [episodes, onlyPlayable]
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      selectedEpisodeRef.current?.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentKey, onlyPlayable]);

  return (
    <aside
      className={cn("player-episode-panel", variant === "overlay" ? "is-overlay" : "is-sidebar")}
      aria-label="选集"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold tracking-tight">选集</h2>
          <span className="mt-1 block text-[12px] opacity-60">
            {playableCount} / {episodes.length} 集可播放
          </span>
        </div>
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
            <button
              key={episode.key}
              ref={selected ? selectedEpisodeRef : undefined}
              type="button"
              className={cn(
                "cv-episode-row player-episode-row group relative mb-2.5 flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors",
                playable ? "hover:bg-black/[0.035] dark:hover:bg-white/[0.07]" : "cursor-default opacity-54",
                selected && "is-selected"
              )}
              disabled={!playable}
              onClick={() => onSelect(episode)}
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums",
                  selected
                    ? "bg-[var(--color-primary)] text-white"
                    : playable
                      ? "bg-black/[0.05] text-[var(--color-text-secondary)] dark:bg-white/[0.08]"
                      : "bg-black/[0.035] text-[var(--color-text-tertiary)] dark:bg-white/[0.05]"
                )}
              >
                {selected ? <Play size={14} fill="currentColor" /> : playable ? <Check size={15} /> : episode.episode}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[13.5px] font-semibold">
                    第 {episode.episode} 集
                    {title && title !== `第 ${episode.episode} 集` ? ` · ${title}` : ""}
                  </span>
                  {selected && (
                    <span className="shrink-0 rounded-full bg-[var(--color-primary)] px-2 py-0.5 text-[10px] font-bold text-white">
                      正在播放
                    </span>
                  )}
                </span>
                <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11.5px] opacity-55">
                  <Clock3 size={12} />
                  <span className="truncate">
                    {playable
                      ? episode.fileSize || episode.fileName || episode.airDate || "已缓存"
                      : episode.airDate || "未缓存"}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
        {!visibleEpisodes.length && (
          <div className="flex h-28 items-center justify-center rounded-2xl bg-black/[0.035] text-[13px] font-semibold opacity-60">
            没有可播放剧集
          </div>
        )}
      </div>
    </aside>
  );
}

function blurActiveNonTextControl() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || isEditableTarget(active)) return;
  if (active.matches("button, [role='button'], input[type='range'], [tabindex]")) {
    active.blur();
  }
}

function episodeTitle(episode: PlaybackEpisode) {
  return episode.titleCn || episode.title || `第 ${episode.episode} 集`;
}

function readDanmakuPref(subjectId: string): boolean {
  try {
    const stored = window.localStorage.getItem(`nexplay.danmaku.${subjectId}`);
    if (stored === "0") return false;
    if (stored === "1") return true;
  } catch {
    // ignore
  }
  return true; // danmaku on by default
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

function resumePositionFromSource(source: MediaSource | null | undefined) {
  const position = source?.playbackPosition;
  const duration = source?.playbackDuration;
  if (!Number.isFinite(position) || !Number.isFinite(duration) || !position || !duration) {
    return 0;
  }
  if (duration <= 0 || position < 3 || position >= duration - 10) {
    return 0;
  }
  return Math.max(0, position);
}

function subtitleMemoryKey(mediaId: number) {
  return `nexplay.subtitle.${mediaId}`;
}

function readRememberedSubtitlePath(mediaId: number | undefined) {
  if (!mediaId) return null;
  try {
    return window.localStorage.getItem(subtitleMemoryKey(mediaId));
  } catch {
    return null;
  }
}

function rememberSubtitlePath(mediaId: number, path: string) {
  try {
    window.localStorage.setItem(subtitleMemoryKey(mediaId), path);
  } catch {
    // ignore storage failures
  }
}

function forgetRememberedSubtitlePath(mediaId: number | undefined) {
  if (!mediaId) return;
  try {
    window.localStorage.removeItem(subtitleMemoryKey(mediaId));
  } catch {
    // ignore storage failures
  }
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
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }
  return target instanceof HTMLInputElement && target.type !== "range";
}

function TrackOptionGroup({
  label,
  value,
  tracks,
  allowOff = false,
  emptyLabel,
  onChange,
  onAddSubtitle,
}: {
  label: string;
  value?: string;
  tracks: MpvTrack[];
  allowOff?: boolean;
  emptyLabel: string;
  onChange: (value: string) => void;
  onAddSubtitle?: () => void;
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
        {onAddSubtitle && (
          <button
            type="button"
            className="player-track-option"
            onClick={onAddSubtitle}
          >
            <FilePlus2 size={14} />
            添加字幕
          </button>
        )}
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
