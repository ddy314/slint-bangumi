import { memo, useCallback, useState, type CSSProperties } from "react";
import { Play } from "lucide-react";
import { cn } from "./utils/cn";
import { Badge } from "./ui";
import { STATUS_COLOR, STATUS_LABEL, type Subject } from "./data";
import { resolveAssetUrl } from "./utils/assets";

type ImageLoading = "eager" | "lazy";
type ImageFetchPriority = "auto" | "high" | "low";

export const Poster = memo(function Poster({
  src,
  alt,
  className,
  loading = "lazy",
  fetchPriority = "auto",
}: {
  src?: string;
  alt: string;
  className?: string;
  loading?: ImageLoading;
  fetchPriority?: ImageFetchPriority;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const resolvedSrc = resolveAssetUrl(src);
  if (!src || failed) {
    return (
      <div
        className={cn(
          "relative grid place-items-center bg-gradient-to-br from-[var(--color-surface-3)] to-[var(--color-surface-1)] text-[var(--color-on-surface-faint)]",
          className
        )}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} className="size-10 opacity-70">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="10" r="1.5" />
          <path d="M3 16l5-5 5 5 3-3 5 5" />
        </svg>
        <span className="text-[10px] mt-2 tracking-wide uppercase">No Poster</span>
      </div>
    );
  }
  return (
    <div className={cn("relative overflow-hidden", className)}>
      {!loaded && <div className="absolute inset-0 skeleton" />}
      <img
        src={resolvedSrc}
        alt={alt}
        loading={loading}
        decoding="async"
        fetchPriority={fetchPriority}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={cn(
          "size-full object-cover transition-all duration-500",
          loaded ? "opacity-100" : "opacity-0"
        )}
      />
    </div>
  );
});

export const MediaCard = memo(function MediaCard({
  subject,
  onOpen,
  selected,
  index = 0,
  imageLoading = "lazy",
  imageFetchPriority = "auto",
}: {
  subject: Subject;
  onOpen?: (subject: Subject) => void;
  selected?: boolean;
  index?: number;
  imageLoading?: ImageLoading;
  imageFetchPriority?: ImageFetchPriority;
}) {
  const progressText = `${subject.watchedEpisodes} / ${subject.episodes || subject.files || "?"} 话`;
  const resolvedPoster = resolveAssetUrl(subject.poster);
  const handleClick = useCallback(() => {
    onOpen?.(subject);
  }, [onOpen, subject]);
  const progressStyle = {
    "--media-card-progress": `${Math.min(100, Math.max(0, subject.progress * 100))}%`,
  } as CSSProperties;
  const entryStyle = {
    "--media-card-enter-delay": `${Math.min(index, 12) * 12}ms`,
  } as CSSProperties;

  return (
    <button
      type="button"
      onClick={handleClick}
      data-timeline-year={subject.year > 0 ? subject.year : undefined}
      className={cn(
        "media-card cv-media-card group relative min-w-0 cursor-pointer text-left focus:outline-none",
        selected && "ring-2 ring-[var(--color-primary)] ring-offset-2 ring-offset-[var(--color-bg)]"
      )}
      style={entryStyle}
    >
      <div className="relative mb-2.5">
        {resolvedPoster && (
          <div
            className="absolute inset-[8%] -z-10 translate-y-4 scale-[0.88] rounded-[var(--radius-card)] bg-cover bg-center opacity-0 blur-[24px] saturate-[1.25] transition-opacity duration-300 group-hover:opacity-[0.16]"
            style={{ backgroundImage: `url(${resolvedPoster})` }}
          />
        )}
        <div className="media-card-poster relative aspect-[3/4] overflow-hidden rounded-[var(--radius-card)] bg-[var(--color-surface-elevated)]">
          <Poster
            src={subject.poster}
            alt={subject.title}
            className="absolute inset-0"
            loading={imageLoading}
            fetchPriority={imageFetchPriority}
          />

          <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/25 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/40 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

          <div className="absolute right-2.5 top-2.5 translate-y-1 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
            {subject.rating > 0 ? (
              <div className="glass-dark flex items-center gap-1 rounded-[var(--radius-control)] px-2 py-[3px] text-[10.5px] font-semibold tracking-wide text-white">
                <span className="text-amber-400">★</span> {subject.rating.toFixed(1)}
              </div>
            ) : subject.status !== "matched" ? (
              <span
                className={cn(
                  "inline-flex h-6 items-center rounded-full px-2 text-[11px] font-medium ring-1 ring-inset",
                  STATUS_COLOR[subject.status]
                )}
              >
                {STATUS_LABEL[subject.status]}
              </span>
            ) : null}
          </div>

          {subject.newEpisode && (
            <div className="absolute left-2.5 top-2.5">
              <Badge tone="primary">NEW</Badge>
            </div>
          )}
          {!subject.local && (
            <div className="absolute left-2.5 top-2.5">
              <Badge tone="neutral">ONLINE</Badge>
            </div>
          )}

          <div className="absolute inset-0 flex scale-75 items-center justify-center opacity-0 transition-all duration-300 group-hover:scale-100 group-hover:opacity-100">
            <div className="media-card-play relative flex size-12 items-center justify-center rounded-full bg-white/92">
              <Play size={18} className="ml-0.5 text-[var(--color-text-primary)]" fill="currentColor" />
            </div>
          </div>

          {subject.progress > 0 && (
            <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/20">
              <div className="media-card-progress h-full rounded-r-full" style={progressStyle} />
            </div>
          )}

          <div className="pointer-events-none absolute inset-0 rounded-[var(--radius-card)] ring-1 ring-inset ring-black/[0.05]" />
        </div>
      </div>

      <div className="px-0.5">
        <h3 className="truncate text-[15px] font-semibold leading-tight text-[var(--color-text-primary)] transition-colors duration-200 group-hover:text-[var(--color-accent)]">
          {subject.title}
        </h3>
        <p className="mt-1.5 truncate text-[13px] font-medium text-[var(--color-text-tertiary)]">
          {subject.titleCn} · {subject.year}
        </p>
        {subject.progress > 0 && subject.progress < 1 && (
          <p className="mt-1.5 text-[13px] font-medium tabular-nums text-[var(--color-accent)]/80">
            {progressText}
          </p>
        )}
        {subject.progress >= 1 && (
          <p className="mt-1.5 text-[13px] font-medium text-green-600/80">
            已完成 · {subject.episodes || subject.files || "?"} 话
          </p>
        )}
      </div>
    </button>
  );
});
