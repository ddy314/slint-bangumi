import { memo, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Calendar, Check, CirclePlay, Download, Film, HardDrive, Search, Star, Tv } from "lucide-react";
import { makePlaybackEpisodes, type PlaybackEpisode, type Subject } from "../data";
import { Poster } from "../MediaCard";
import { useIncrementalItems } from "../hooks/useIncrementalItems";
import { usePosterPalette } from "../hooks/usePosterPalette";
import { appleSpring, appleSpringBouncy, appleSpringSoft } from "../motion";
import { resolveAssetUrl } from "../utils/assets";
import { cn } from "../utils/cn";

export function DetailPage({
  subject,
  onBack,
  onPlay,
  onFindResources,
  onSnack,
}: {
  subject: Subject;
  onBack: () => void;
  onPlay: (subject: Subject, episode: PlaybackEpisode) => void;
  onFindResources: (subject: Subject) => void;
  onSnack: (text: string, tone?: "neutral" | "success" | "danger") => void;
}) {
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
                <MetaSep />
                <span className="flex items-center gap-1.5">
                  <HardDrive size={13} strokeWidth={1.8} />
                  {subject.totalSize}
                </span>
              </div>

              {subject.progress > 0 && (
                <div className="mt-4">
                  <div className="mb-1.5 flex items-center justify-between text-[11px] text-[var(--color-text-tertiary)]">
                    <span>观看进度</span>
                    <span className="tabular-nums">{subject.watchedEpisodes} / {subject.episodes || rows.length}</span>
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

        {subject.summary && (
          <motion.section
            className="relative z-[1] py-7"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, y: 0 }}
            transition={appleSpringSoft}
          >
            <div className={detailFrame}>
              <h2 className="mb-2.5 text-[16px] font-semibold tracking-tight text-[var(--color-text-primary)]">简介</h2>
              <p className="max-w-2xl text-[13.5px] leading-[1.8] text-[var(--color-text-secondary)]">
                {subject.summary}
              </p>
            </div>
          </motion.section>
        )}

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

const EpisodeRow = memo(function EpisodeRow({
  row,
  onOpen,
}: {
  row: PlaybackEpisode;
  onOpen: () => void;
}) {
  const title = row.titleCn || row.title || `Episode ${row.episode}`;
  return (
    <button
      type="button"
      className={cn(
        "cv-episode-row episode-row-action group flex items-center gap-4 rounded-[14px] border-[0.5px] px-4 py-3 text-left transition-all duration-200",
        "cursor-pointer hover:border-black/[0.03] hover:bg-black/[0.025]",
        "border-transparent"
      )}
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
      <div className="flex items-center gap-2">
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
      </div>
    </button>
  );
});
