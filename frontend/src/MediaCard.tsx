import { useState } from "react";
import { cn } from "./utils/cn";
import { PlayIcon, InfoIcon } from "./icons";
import { Badge, Progress } from "./ui";
import { STATUS_COLOR, STATUS_LABEL, type Subject } from "./data";

export function Poster({
  src,
  alt,
  className,
}: {
  src?: string;
  alt: string;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
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
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={cn(
          "size-full object-cover transition-all duration-500",
          loaded ? "opacity-100" : "opacity-0"
        )}
      />
    </div>
  );
}

export function MediaCard({
  subject,
  onClick,
  selected,
  size = "md",
}: {
  subject: Subject;
  onClick?: () => void;
  selected?: boolean;
  size?: "sm" | "md";
}) {
  const sizeCls = size === "sm" ? "w-[150px]" : "w-[180px]";

  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative text-left rounded-2xl transition-all duration-200",
        "focus:outline-none",
        sizeCls,
        selected && "ring-2 ring-[var(--color-primary)] ring-offset-2 ring-offset-[var(--color-bg)]"
      )}
    >
      {/* Poster */}
      <div className="relative aspect-[2/3] rounded-2xl overflow-hidden bg-[var(--color-surface-2)] ring-1 ring-[var(--color-outline-soft)] group-hover:ring-[var(--color-outline)] transition-all group-hover:scale-[1.025] group-hover:shadow-xl group-hover:shadow-black/40">
        <Poster src={subject.poster} alt={subject.title} className="absolute inset-0" />

        {/* gradient bottom for legibility */}
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />

        {/* top-right badges */}
        <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
          {subject.newEpisode && <Badge tone="primary">NEW</Badge>}
          {subject.currentEpisode && subject.status === "matched" && (
            <Badge tone="neutral">EP{String(subject.currentEpisode).padStart(2, "0")}</Badge>
          )}
          {subject.status !== "matched" && (
            <span
              className={cn(
                "inline-flex items-center px-2 h-6 rounded-full text-[11px] font-medium ring-1 ring-inset",
                STATUS_COLOR[subject.status]
              )}
            >
              {STATUS_LABEL[subject.status]}
            </span>
          )}
        </div>

        {/* hover overlay */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 grid place-items-center">
          <div className="flex items-center gap-2">
            <div className="size-12 rounded-full bg-[var(--color-primary)] grid place-items-center text-[var(--color-on-primary)] shadow-lg shadow-black/40 scale-90 group-hover:scale-100 transition-transform">
              <PlayIcon className="size-5 ml-0.5" />
            </div>
            <div className="size-10 rounded-full bg-white/15 backdrop-blur-md grid place-items-center text-white scale-90 group-hover:scale-100 transition-transform delay-50">
              <InfoIcon className="size-4" />
            </div>
          </div>
        </div>

        {/* progress */}
        {subject.progress > 0 && subject.progress < 1 && (
          <div className="absolute inset-x-3 bottom-3">
            <Progress value={subject.progress} />
          </div>
        )}
      </div>

      {/* title */}
      <div className="px-1 pt-3">
        <div className="text-[13.5px] font-medium leading-tight truncate group-hover:text-[var(--color-primary)] transition-colors">
          {subject.title}
        </div>
        <div className="text-[11.5px] text-[var(--color-on-surface-faint)] mt-1 truncate">
          {subject.titleCn} · {subject.year}
        </div>
      </div>
    </button>
  );
}
