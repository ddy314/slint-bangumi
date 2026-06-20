import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock3,
  ListVideo,
  MessageCircle,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  X,
} from "lucide-react";
import { makePlaybackEpisodes, type PlaybackEpisode, type Subject } from "../data";
import { Poster } from "../MediaCard";
import { appleSpringSoft } from "../motion";
import { MpvWebglSurface } from "../MpvWebglSurface";
import { cn } from "../utils/cn";
import type { MediaSource, MpvRenderInfo, MpvState } from "../backend";

const SEEK_COMMIT_DELAY_MS = 80;

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
  const pendingSeekPositionRef = useRef<number | null>(null);
  const latestSeekPositionRef = useRef<number | null>(null);
  const seekCommitTimerRef = useRef<number | null>(null);
  const seekingRef = useRef(false);
  const [currentKey, setCurrentKey] = useState(initialEpisode.key);
  const [source, setSource] = useState<MediaSource | null>(null);
  const [mpvState, setMpvState] = useState<MpvState | null>(null);
  const [loadingSource, setLoadingSource] = useState(true);
  const [danmakuVisible, setDanmakuVisible] = useState(false);
  const [episodeDrawerOpen, setEpisodeDrawerOpen] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [renderInfo, setRenderInfo] = useState<MpvRenderInfo | null>(null);
  const [paused, setPaused] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [scrubPosition, setScrubPosition] = useState<number | null>(null);
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
  const webglTextureReady = renderMode === "webglTexture" && Boolean(textureProbe?.ok);
  const renderBridgeError = textureProbe?.error ?? (renderInfo?.available
    ? renderInfo.probe?.error
    : renderInfo?.reason);
  const duration = mpvState?.duration ?? 0;
  const position = mpvState?.position ?? 0;
  const displayedPosition = scrubPosition ?? position;
  const volume = Math.round(mpvState?.volume ?? 100);

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
      try {
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
    if (loadingSource || playbackError || !window.nexplay?.mpvState) {
      return;
    }

    let disposed = false;
    const refreshState = async () => {
      try {
        const nextState = await window.nexplay?.mpvState();
        if (!disposed && nextState) {
          setMpvState((current) => ({
            ...nextState,
            position: seekingRef.current
              ? latestSeekPositionRef.current ?? current?.position ?? nextState.position
              : nextState.position,
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
  }, [loadingSource, playbackError, source]);

  useEffect(() => {
    return () => {
      if (seekCommitTimerRef.current !== null) {
        window.clearTimeout(seekCommitTimerRef.current);
      }
      void window.nexplay?.mpvStop();
    };
  }, []);

  const switchEpisode = useCallback((episode: PlaybackEpisode | undefined) => {
    if (!episode?.mediaId) {
      return;
    }
    setPlaybackError(null);
    setCurrentKey(episode.key);
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
    if (!window.nexplay) return;
    const nextPaused = !paused;
    try {
      await window.nexplay.mpvSetPause(nextPaused);
      setPaused(nextPaused);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      onSnack(`播放控制失败：${message}`, "danger");
    }
  }, [onSnack, paused]);

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
            setMpvState((current) => ({
              ...current,
              ...nextState,
              source: current?.source ?? source ?? undefined,
              renderMode: current?.renderMode ?? nextState.renderMode,
              textureProbe: current?.textureProbe ?? nextState.textureProbe,
            }));
          }
        } catch (caught) {
          const stillLatest = latestSeekPositionRef.current === targetPosition
            && pendingSeekPositionRef.current === null;
          if (stillLatest) {
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
  }, [onSnack, source]);

  const commitSeek = useCallback((value: number) => {
    if (!window.nexplay || !Number.isFinite(value)) return;
    const nextPosition = Math.max(0, Math.min(duration || value, value));
    latestSeekPositionRef.current = nextPosition;
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
  }, [duration, flushPendingSeek]);

  const setVolume = useCallback(async (value: number) => {
    if (!window.nexplay) return;
    const nextVolume = Math.max(0, Math.min(100, value));
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
  }, [onSnack, source]);

  const handleRenderSurfaceError = useCallback((message: string) => {
    onSnack(`WebGL 画面渲染失败：${message}`, "danger");
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

            <div className="flex min-w-0 items-center gap-3">
              <motion.button
                type="button"
                className="player-toolbar-button"
                disabled={!previousEpisode}
                onClick={() => switchEpisode(previousEpisode)}
                whileTap={{ scale: 0.94 }}
              >
                <SkipBack size={17} />
              </motion.button>
              <motion.button
                type="button"
                className="player-toolbar-button"
                disabled={!nextEpisode}
                onClick={() => switchEpisode(nextEpisode)}
                whileTap={{ scale: 0.94 }}
              >
                <SkipForward size={17} />
              </motion.button>
              <button
                type="button"
                className="player-toolbar-button gap-2 px-3 text-[12px] font-semibold"
                onClick={() => setEpisodeDrawerOpen(true)}
              >
                <ListVideo size={16} />
                选集
              </button>
            </div>
          </header>

          <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto]">
            <div
              className="player-stage relative min-h-0 overflow-hidden rounded-[28px]"
            >
              <div className="absolute inset-0 bg-black" />
              <div className="absolute inset-x-0 top-0 bottom-[86px] overflow-hidden rounded-t-[28px] bg-black">
                {webglTextureReady ? (
                  <MpvWebglSurface
                    active={webglTextureReady && !loadingSource && !playbackError && !seeking}
                    paused={paused}
                    videoWidth={mpvState?.videoWidth}
                    videoHeight={mpvState?.videoHeight}
                    fps={mpvState?.fps}
                    onError={handleRenderSurfaceError}
                  />
                ) : heroSrc ? (
                  <img
                    src={heroSrc}
                    alt=""
                    className="absolute inset-0 size-full object-cover opacity-20"
                    draggable={false}
                  />
                ) : null}
                {!webglTextureReady && <div className="absolute inset-0 bg-black/62" />}

                <div className={cn("danmaku-plane pointer-events-none absolute inset-x-0 top-0 h-[42%]", danmakuVisible ? "opacity-100" : "opacity-0")} />

                {!webglTextureReady && <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-white">
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

              <div className="absolute right-5 top-5 z-20 flex items-center gap-2">
                <button
                  type="button"
                  className={cn(
                    "player-pill flex h-9 items-center gap-2 rounded-full px-3 text-[12px] font-semibold",
                    danmakuVisible ? "text-white" : "text-white/55"
                  )}
                  onClick={() => setDanmakuVisible((current) => !current)}
                >
                  <MessageCircle size={15} />
                  弹幕
                </button>
                <button
                  type="button"
                  className="player-pill flex h-9 items-center gap-2 rounded-full px-3 text-[12px] font-semibold text-white"
                  onClick={() => setEpisodeDrawerOpen(true)}
                >
                  <ListVideo size={15} />
                  选集
                </button>
              </div>

              <div className="mpv-control-bar absolute inset-x-5 bottom-5 z-20 flex items-center gap-3 rounded-full px-4 py-3">
                <button
                  type="button"
                  className="player-round-control"
                  onClick={togglePause}
                  disabled={loadingSource || Boolean(playbackError)}
                >
                  {paused ? <Play size={19} fill="currentColor" /> : <Pause size={19} fill="currentColor" />}
                </button>
                <div className="min-w-[180px] flex-1">
                  <input
                    type="range"
                    className="mpv-progress-slider"
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
                  <div className="mt-1.5 flex items-center justify-between text-[11px] font-semibold tabular-nums text-white/62">
                    <span>{formatTime(displayedPosition)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>
                </div>
                <label className="mpv-volume-control">
                  <Volume2 size={16} />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={volume}
                    onChange={(event) => void setVolume(Number(event.currentTarget.value))}
                  />
                </label>
                <TrackSelect
                  label="音轨"
                  value={selectedTrackValue(mpvState?.audioTracks)}
                  tracks={mpvState?.audioTracks ?? []}
                  emptyLabel="无音轨"
                  onChange={(value) => void setTrack("audio", value)}
                />
                <TrackSelect
                  label="字幕"
                  value={selectedTrackValue(mpvState?.subtitleTracks) ?? "off"}
                  tracks={mpvState?.subtitleTracks ?? []}
                  allowOff
                  emptyLabel="无字幕"
                  onChange={(value) => void setTrack("subtitle", value)}
                />
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
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-40"
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
            className="player-episode-rail absolute bottom-5 right-5 top-5 w-[min(360px,calc(100vw-48px))] rounded-[26px] border border-[var(--color-outline-soft)] bg-[var(--color-surface-1)] px-5 py-5 shadow-[0_30px_90px_rgba(0,0,0,0.18)]"
            initial={{ opacity: 0, x: 28, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 28, scale: 0.98 }}
            transition={appleSpringSoft}
          >
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-[17px] font-bold tracking-tight text-[var(--color-text-primary)]">选集</h2>
                <span className="text-[12px] text-[var(--color-text-tertiary)]">{playableCount} 集可播放</span>
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
            <div className="player-episode-list -mx-1 h-[calc(100%-64px)] overflow-y-auto px-1 pr-1">
              {episodes.map((episode) => {
                const selected = episode.key === currentKey;
                const playable = episode.cached && episode.mediaId;
                return (
                  <motion.button
                    key={episode.key}
                    type="button"
                    className={cn(
                      "group relative mb-2.5 flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors",
                      playable ? "hover:bg-black/[0.035]" : "cursor-default opacity-50",
                      selected && "bg-[var(--color-primary-soft)] hover:bg-[var(--color-primary-soft)]"
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
                      <span className="block truncate text-[13.5px] font-semibold text-[var(--color-text-primary)]">
                        第 {episode.episode} 集
                      </span>
                      <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11.5px] text-[var(--color-text-tertiary)]">
                        <Clock3 size={12} />
                        <span className="truncate">{episode.fileSize || episode.airDate || "未缓存"}</span>
                      </span>
                    </span>
                  </motion.button>
                );
              })}
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

function TrackSelect({
  label,
  value,
  tracks,
  allowOff = false,
  emptyLabel,
  onChange,
}: {
  label: string;
  value?: string;
  tracks: MpvState["audioTracks"];
  allowOff?: boolean;
  emptyLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="mpv-track-select">
      <span>{label}</span>
      <select
        value={value ?? (allowOff ? "off" : "")}
        disabled={!tracks.length && !allowOff}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {allowOff && <option value="off">关闭</option>}
        {!tracks.length && !allowOff && <option value="">{emptyLabel}</option>}
        {tracks.map((track) => (
          <option key={track.id} value={track.id}>
            {trackLabel(track)}
          </option>
        ))}
      </select>
    </label>
  );
}

function trackLabel(track: MpvState["audioTracks"][number]) {
  const parts = [
    track.lang,
    track.title,
    track.codec,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : `${track.kind} #${track.id}`;
}
