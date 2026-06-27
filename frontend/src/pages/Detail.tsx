import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Calendar, Check, CirclePlay, CloudOff, Download, Film, HardDrive, Loader2, RefreshCw, Search, Star, Tv } from "lucide-react";
import { batchUpdateBangumiEpisodes, syncBangumiSubject, updateBangumiCollection, updateBangumiEpisode } from "../backend";
import { makePlaybackEpisodes, type PlaybackEpisode, type Subject } from "../data";
import { Poster } from "../MediaCard";
import { useIncrementalItems } from "../hooks/useIncrementalItems";
import { usePosterPalette } from "../hooks/usePosterPalette";
import { appleSpring, appleSpringBouncy, appleSpringSoft } from "../motion";
import { loadSubjectDetailWithFallback, mergeMissingDisplayMetadata, shouldHydrateSubject } from "../subjectHydration";
import { Badge, Dropdown } from "../ui";
import { resolveAssetUrl } from "../utils/assets";
import { cn } from "../utils/cn";

export function DetailPage({
  subject: initialSubject,
  onBack,
  onPlay,
  onFindResources,
  onSubjectUpdated,
  onSnack,
}: {
  subject: Subject;
  onBack: () => void;
  onPlay: (subject: Subject, episode: PlaybackEpisode) => void;
  onFindResources: (subject: Subject) => void;
  onSubjectUpdated?: () => void | Promise<void>;
  onSnack: (text: string, tone?: "neutral" | "success" | "danger") => void;
}) {
  const [subject, setSubject] = useState(initialSubject);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const rows = useMemo(() => makePlaybackEpisodes(subject), [subject]);
  const cachedCount = useMemo(() => rows.filter((row) => row.cached).length, [rows]);
  const nextPlayableRow = useMemo(
    () => rows.find((row) => row.cached && row.episode > subject.watchedEpisodes) ?? rows.find((row) => row.cached),
    [rows, subject.watchedEpisodes]
  );
  const {
    hasMore,
    loadMore,
    sentinelRef,
    visibleCount,
    visibleItems: visibleRows,
  } = useIncrementalItems(rows, {
    initialCount: 80,
    step: 80,
    resetKey: subject.id,
  });
  const heroAsset = subject.hero || subject.poster;
  const heroSrc = resolveAssetUrl(heroAsset);
  const palette = usePosterPalette(heroSrc);
  const visibleTags = subject.tags.slice(0, 5);
  const progressPercent = Math.min(100, Math.max(0, subject.progress * 100));
  const remainingRows = Math.max(0, rows.length - visibleCount);
  const hasPlayableAction = subject.local && Boolean(nextPlayableRow?.mediaId);
  const detailFrame = "mx-auto w-full max-w-[1120px] px-6 sm:px-8";
  const bgmSubjectId = subject.provider === "bangumi" ? Number(subject.providerSubjectId) : NaN;
  const canUseBangumi = Number.isFinite(bgmSubjectId) && bgmSubjectId > 0;
  const episodeTotal = subject.episodes || rows.length || subject.files;
  const hasLocalWatchProgress = subject.watchedEpisodes > 0;
  const localWatchLabel = subject.progress >= 1
    ? `本地看完 ${subject.watchedEpisodes}/${episodeTotal || "?"}`
    : `本地在看 ${subject.watchedEpisodes}/${episodeTotal || "?"}`;

  useEffect(() => {
    setSubject(initialSubject);
  }, [initialSubject]);

  useEffect(() => {
    if (!shouldHydrateSubject(subject)) return;
    let cancelled = false;
    loadSubjectDetailWithFallback(subject)
      .then((detail) => {
        if (!cancelled) {
          setSubject((current) => current.id === subject.id
            ? mergeMissingDisplayMetadata(current, detail)
            : current);
        }
      })
      .catch(() => {
        // Detail metadata hydration is best-effort; the page remains usable.
      });
    return () => {
      cancelled = true;
    };
  }, [
    subject.id,
    subject.provider,
    subject.providerSubjectId,
    subject.summary,
    subject.poster,
    subject.hero,
    subject.tags.length,
  ]);

  useEffect(() => {
    if (!canUseBangumi) return;
    let cancelled = false;
    syncBangumiSubject(bgmSubjectId)
      .then(() => {
        if (!cancelled) void onSubjectUpdated?.();
      })
      .catch(() => {
        // Detail sync is opportunistic; explicit controls surface actionable errors.
      });
    return () => {
      cancelled = true;
    };
  }, [bgmSubjectId, canUseBangumi]);

  const openEpisode = useCallback((row: PlaybackEpisode | undefined) => {
    if (!row?.mediaId) {
      if (!row) {
        onSnack("没有可打开的本地文件", "danger");
        return;
      }
      onSnack("这一话还没有本地文件，可以用番剧资源按钮统一搜索。", "neutral");
      return;
    }
    onPlay(subject, row);
  }, [onPlay, onSnack, subject]);

  const changeCollection = async (collectionType: number, rate = subject.bgmRate || null) => {
    if (!canUseBangumi) return;
    setBusyAction("collection");
    try {
      const result = await updateBangumiCollection({
        subjectId: bgmSubjectId,
        collectionType,
        rate,
      });
      await onSubjectUpdated?.();
      onSnack(result.message, result.queued > 0 ? "neutral" : "success");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      onSnack(`更新 Bangumi 状态失败：${message}`, "danger");
    } finally {
      setBusyAction(null);
    }
  };

  const changeRate = async (rate: number) => {
    await changeCollection(subject.bgmCollectionType || 3, rate);
  };

  const markEpisodeWatched = async (row: PlaybackEpisode) => {
    if (!canUseBangumi || !row.bgmEpisodeId) return;
    setBusyAction(`episode-${row.bgmEpisodeId}`);
    try {
      const result = await updateBangumiEpisode({
        subjectId: bgmSubjectId,
        episodeId: row.bgmEpisodeId,
        collectionType: 2,
      });
      await onSubjectUpdated?.();
      onSnack(result.message, result.queued > 0 ? "neutral" : "success");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      onSnack(`更新 Bangumi 单集失败：${message}`, "danger");
    } finally {
      setBusyAction(null);
    }
  };

  const markCachedEpisodesWatched = async () => {
    if (!canUseBangumi) return;
    const episodeIds = rows
      .filter((row) => row.cached && row.bgmEpisodeId && row.bgmCollectionType !== 2)
      .map((row) => row.bgmEpisodeId!)
      .filter((id, index, array) => array.indexOf(id) === index);
    if (!episodeIds.length) {
      onSnack("没有可批量标记的本地缓存集。", "neutral");
      return;
    }
    setBusyAction("batch");
    try {
      const result = await batchUpdateBangumiEpisodes({
        subjectId: bgmSubjectId,
        episodeIds,
        collectionType: 2,
      });
      await onSubjectUpdated?.();
      onSnack(result.message, result.queued > 0 ? "neutral" : "success");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      onSnack(`批量更新 Bangumi 单集失败：${message}`, "danger");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="relative h-full overflow-y-auto overflow-x-hidden">
      <motion.div
        className="relative min-h-full overflow-hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={appleSpringSoft}
      >
        <div className="pointer-events-none absolute inset-x-[-72px] top-0 h-[540px] overflow-hidden">
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(135deg, ${palette.secondary}, transparent 42%), linear-gradient(180deg, ${palette.tertiary}, var(--color-bg))`,
            }}
          />
          <div className="detail-hero-scrim absolute inset-0" />
          <div className="detail-hero-side-light absolute inset-0" />
          <div className="detail-hero-bottom-fade absolute inset-x-0 bottom-0 h-52" />
        </div>

        <section className="relative z-[1] pb-9 pt-16 sm:pt-20">
          <div className={cn(detailFrame, "relative flex items-end gap-6 md:gap-8 max-md:flex-col max-md:items-start")}>
            <motion.button
              type="button"
              className="absolute left-6 top-[-56px] z-10 flex size-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-colors hover:bg-black/50 sm:left-8 sm:top-[-60px]"
              onClick={onBack}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.92 }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={appleSpringBouncy}
            >
              <ArrowLeft size={17} />
            </motion.button>

            <motion.div
              className="relative shrink-0"
              initial={{ opacity: 0, y: 18, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={appleSpringSoft}
            >
              <div className="shadow-glass-elevated relative h-[238px] w-[170px] overflow-hidden rounded-2xl sm:h-[266px] sm:w-[190px]">
                <Poster
                  src={subject.poster}
                  alt={subject.title}
                  className="size-full"
                  loading="eager"
                  fetchPriority="high"
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-black/15 to-transparent" />
                <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-black/[0.06]" />
              </div>
            </motion.div>

            <motion.div
              className="min-w-0 flex-1 pb-1 md:max-w-[760px]"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={appleSpringSoft}
            >
              <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
                {visibleTags.map((tag) => (
                  <span key={tag} className="tag-chip rounded-full px-2.5 py-[3px] text-[11px] text-[var(--color-text-secondary)] backdrop-blur-sm">
                    {tag}
                  </span>
                ))}
                <span className="rounded-full border-[0.5px] border-[var(--color-accent)]/15 bg-[var(--color-accent)]/8 px-2.5 py-[3px] text-[11px] font-medium text-[var(--color-accent)]">
                  {subject.status === "matched" ? "已匹配" : "待整理"}
                </span>
              </div>

              <h1 className="max-w-full break-words text-[30px] font-bold leading-[1.08] tracking-tight text-[var(--color-text-primary)] sm:text-[34px] lg:text-[38px]">
                {subject.title}
              </h1>
              <p className="mt-1 max-w-full truncate text-[14px] font-light tracking-wide text-[var(--color-text-tertiary)]">
                {subject.titleCn || subject.fileSummary}
              </p>

              <div className="mt-3.5 flex max-w-full flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-[var(--color-text-secondary)]">
                {subject.rating > 0 && (
                  <span className="flex items-center gap-1.5">
                    <Star size={14} className="text-amber-500" fill="currentColor" />
                    <span className="font-semibold text-[var(--color-text-primary)]">{subject.rating.toFixed(1)}</span>
                  </span>
                )}
                <MetaSep />
                <span className="flex items-center gap-1.5">
                  <Calendar size={13} strokeWidth={1.8} />
                  {subject.year || "未知年份"}
                </span>
                <MetaSep />
                <span className="flex items-center gap-1.5">
                  <Film size={13} strokeWidth={1.8} />
                  {rows.length || subject.episodes || subject.files} 话
                </span>
                <MetaSep />
                <span className="flex items-center gap-1.5">
                  <Tv size={13} strokeWidth={1.8} />
                  {subject.files} 文件
                </span>
                {subject.totalSize && (
                  <>
                    <MetaSep />
                    <span className="flex items-center gap-1.5">
                      <HardDrive size={13} strokeWidth={1.8} />
                      {subject.totalSize}
                    </span>
                  </>
                )}
              </div>

              {subject.progress > 0 && (
                <div className="mt-4">
                  <div className="mb-1.5 flex items-center justify-between text-[11px] text-[var(--color-text-tertiary)]">
                    <span>观看进度</span>
                    <span className="tabular-nums">{subject.watchedEpisodes}/{subject.episodes || rows.length} 话</span>
                  </div>
                  <div className="h-[5px] w-full max-w-60 overflow-hidden rounded-full bg-black/[0.05]">
                    <motion.div
                      className="relative h-full overflow-hidden rounded-full"
                      style={{ background: "var(--color-primary)" }}
                      initial={{ width: 0 }}
                      animate={{ width: `${progressPercent}%` }}
                      transition={appleSpring}
                    >
                    </motion.div>
                  </div>
                </div>
              )}

              <div className="mt-5 flex max-w-full flex-wrap items-center gap-3">
                {hasPlayableAction && (
                  <motion.button
                    type="button"
                    className="relative flex min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-full bg-[var(--color-primary)] px-6 py-2.5 text-[13px] font-semibold text-white sm:px-7"
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.96 }}
                    transition={appleSpringBouncy}
                    onClick={() => openEpisode(nextPlayableRow)}
                  >
                    <CirclePlay size={16} fill="white" className="shrink-0" />
                    <span className="truncate">
                      {subject.progress > 0 ? `继续播放 · 第${nextPlayableRow?.episode ?? subject.watchedEpisodes + 1}话` : "开始播放"}
                    </span>
                  </motion.button>
                )}
                <motion.button
                  type="button"
                  className={cn(
                    "flex h-10 items-center gap-2 rounded-full px-4 text-[13px] font-semibold transition-colors",
                    hasPlayableAction
                      ? "bg-black/[0.055] text-[var(--color-text-primary)] hover:bg-black/[0.08]"
                      : "bg-[var(--color-primary)] text-white"
                  )}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.96 }}
                  transition={appleSpringBouncy}
                  onClick={() => onFindResources(subject)}
                >
                  <Search size={15} />
                  搜索资源
                </motion.button>
              </div>
            </motion.div>
          </div>
        </section>

        {canUseBangumi && (
          <motion.section
            className="relative z-[1] py-5"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={appleSpringSoft}
          >
            <div className={detailFrame}>
              <div className="rounded-[var(--radius-card)] bg-[var(--color-surface-elevated)] p-4 shadow-[inset_0_0_0_0.5px_var(--color-outline-soft)]">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-text-primary)]">Bangumi 同步</h2>
                      {subject.bgmPending ? (
                        <Badge tone="warning"><CloudOff size={11} /> 待同步</Badge>
                      ) : subject.bgmCollectionType ? (
                        <Badge tone="success"><Check size={11} /> 已同步</Badge>
                      ) : hasLocalWatchProgress ? (
                        <Badge tone="primary">{localWatchLabel}</Badge>
                      ) : (
                        <Badge tone="neutral">未标记</Badge>
                      )}
                    </div>
                    <p className="mt-1.5 max-w-xl text-[12px] leading-relaxed text-[var(--color-text-tertiary)]">
                      {hasLocalWatchProgress && !subject.bgmCollectionType
                        ? "已检测到本地观看进度；继续播放会自动把 Bangumi 条目标记为「在看」，看完一集后同步单集「看过」。"
                        : "看完一集（进度 ≥ 90%）会自动标记为「看过」并回写 Bangumi；离线时进入待同步队列，下次打开或同步时自动重试。"}
                    </p>
                  </div>
                  {busyAction && (
                    <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-[var(--color-text-tertiary)]">
                      <Loader2 size={13} className="animate-spin" />
                      同步中
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-[12px] font-semibold text-[var(--color-text-secondary)]">
                    状态
                    <Dropdown
                      size="sm"
                      value={subject.bgmCollectionType || 3}
                      disabled={Boolean(busyAction)}
                      onChange={(value) => void changeCollection(Number(value))}
                      options={[
                        { value: 1, label: "想看" },
                        { value: 3, label: "在看" },
                        { value: 2, label: "看过" },
                        { value: 4, label: "搁置" },
                        { value: 5, label: "抛弃" },
                      ]}
                      matchWidth={false}
                      className="min-w-[96px]"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-[12px] font-semibold text-[var(--color-text-secondary)]">
                    评分
                    <Dropdown
                      size="sm"
                      value={subject.bgmRate || 0}
                      disabled={Boolean(busyAction)}
                      onChange={(value) => void changeRate(Number(value))}
                      options={[
                        { value: 0, label: "未评分" },
                        ...Array.from({ length: 10 }, (_, index) => ({ value: index + 1, label: `${index + 1} 分` })),
                      ]}
                      matchWidth={false}
                      className="min-w-[96px]"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void markCachedEpisodesWatched()}
                    disabled={Boolean(busyAction)}
                    className="flex h-9 items-center gap-1.5 rounded-full bg-black/[0.055] px-4 text-[12px] font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-black/[0.08] disabled:opacity-50 dark:bg-white/[0.08] dark:hover:bg-white/[0.12]"
                  >
                    <RefreshCw size={13} />
                    标记本地缓存为看过
                  </button>
                </div>
              </div>
            </div>
          </motion.section>
        )}

        {subject.summary && <SummarySection summary={subject.summary} detailFrame={detailFrame} />}

        <div className="relative z-[1]">
          <div className={detailFrame}>
            <div className="h-px bg-black/[0.05]" />
          </div>
        </div>

        <motion.section
          className="relative z-[1] py-6 pb-10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, y: 0 }}
          transition={appleSpringSoft}
        >
          <div className={detailFrame}>
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-[16px] font-semibold tracking-tight text-[var(--color-text-primary)]">
                剧集 <span className="ml-1 text-[13px] font-normal text-[var(--color-text-tertiary)]">{rows.length} 话</span>
              </h2>
              <span className="text-[12px] text-[var(--color-text-tertiary)]">
                {cachedCount}/{rows.length} 已缓存
              </span>
            </div>
            <div className="grid gap-1.5">
              {visibleRows.map((row) => (
                <EpisodeRow
                  key={row.key}
                  row={row}
                  onOpen={() => openEpisode(row)}
                  onMarkWatched={() => void markEpisodeWatched(row)}
                  busy={row.bgmEpisodeId ? busyAction === `episode-${row.bgmEpisodeId}` : false}
                />
              ))}
              {hasMore && (
                <div ref={sentinelRef} className="flex justify-center py-4">
                  <button
                    type="button"
                    onClick={loadMore}
                    className="glass-light h-8 rounded-full px-3 text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  >
                    继续加载剩余 {remainingRows} 集
                  </button>
                </div>
              )}
            </div>
          </div>
        </motion.section>
      </motion.div>
    </div>
  );
}

function MetaSep() {
  return <span className="hidden h-3 w-px shrink-0 bg-black/10 sm:inline-block" />;
}

function SummarySection({
  summary,
  detailFrame,
}: {
  summary: string;
  detailFrame: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const text = summary.trim();
  const shouldCollapse = text.length > 320 || text.split(/\r?\n/).length > 5;

  return (
    <motion.section
      className="relative z-[1] py-7"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, y: 0 }}
      transition={appleSpringSoft}
    >
      <div className={cn(detailFrame, "grid gap-3 md:grid-cols-[88px_minmax(0,760px)] md:gap-6")}>
        <div className="text-[16px] font-semibold tracking-tight text-[var(--color-text-primary)]">简介</div>
        <div className="min-w-0">
          <div className="relative">
            <p
              className={cn(
                "whitespace-pre-line text-[13.5px] leading-[1.85] text-[var(--color-text-secondary)]",
                shouldCollapse && !expanded && "max-h-[176px] overflow-hidden"
              )}
            >
              {text}
            </p>
            {shouldCollapse && !expanded && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--color-bg)] to-transparent" />
            )}
          </div>
          {shouldCollapse && (
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="mt-3 text-[12px] font-semibold text-[var(--color-accent)] transition-colors hover:text-[var(--color-accent-hover)]"
            >
              {expanded ? "收起简介" : "展开简介"}
            </button>
          )}
        </div>
      </div>
    </motion.section>
  );
}

const EpisodeRow = memo(function EpisodeRow({
  row,
  onOpen,
  onMarkWatched,
  busy,
}: {
  row: PlaybackEpisode;
  onOpen: () => void;
  onMarkWatched: () => void;
  busy: boolean;
}) {
  const title = row.titleCn || row.title || `Episode ${row.episode}`;
  const collectionLabel = row.watched && row.bgmCollectionType !== 2
    ? "本地看过"
    : row.bgmCollectionLabel;
  return (
    <div
      className={cn(
        "cv-episode-row episode-row-action group flex items-center gap-4 rounded-[14px] border-[0.5px] px-4 py-3 text-left transition-all duration-200",
        "cursor-pointer hover:border-black/[0.03] hover:bg-black/[0.025]",
        "border-transparent"
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-4 text-left"
        onClick={onOpen}
      >
        <div
          className={cn(
            "w-7 text-center text-[14px] font-medium tabular-nums",
            row.cached ? "text-[var(--color-text-secondary)]" : "text-[var(--color-text-tertiary)]/60"
          )}
        >
          {String(row.episode).padStart(2, "0")}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium text-[var(--color-text-primary)]">{title}</div>
          <div className="mt-0.5 truncate text-[11.5px] text-[var(--color-text-tertiary)]">
            {row.fileName || row.airDate || "暂无本地文件"}
          </div>
        </div>
      </button>
      <div className="flex items-center gap-2">
        {collectionLabel && (
          <span className="hidden rounded-full bg-[var(--color-primary-soft)] px-2.5 py-[3px] text-[11px] font-medium text-[var(--color-primary)] sm:inline-flex">
            {collectionLabel}{row.bgmPending ? " · 待同步" : ""}
          </span>
        )}
        {row.cached ? (
          <span className="flex items-center gap-1 rounded-full bg-green-500/8 px-2.5 py-[3px] text-[11px] text-green-600">
            <Check size={12} /> 本地
          </span>
        ) : (
          <span className="flex items-center gap-1 rounded-full bg-black/[0.035] px-2.5 py-[3px] text-[11px] text-[var(--color-text-tertiary)]">
            <Download size={12} /> 未缓存
          </span>
        )}
        {row.fileSize && (
          <span className="hidden text-[11px] tabular-nums text-[var(--color-text-tertiary)] md:inline">
            {row.fileSize}
          </span>
        )}
        {row.bgmEpisodeId && row.bgmCollectionType !== 2 && (
          <button
            type="button"
            onClick={onMarkWatched}
            disabled={busy}
            className="rounded-full bg-black/[0.055] px-2.5 py-[3px] text-[11px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            {busy ? "同步中" : row.watched ? "同步看过" : "看过"}
          </button>
        )}
      </div>
    </div>
  );
});
