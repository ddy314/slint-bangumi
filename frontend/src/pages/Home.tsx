import { useMemo, useRef } from "react";
import { type Subject } from "../data";
import { Badge, Button, Card, Progress } from "../ui";
import { MediaCard, Poster } from "../MediaCard";
import {
  PlayIcon,
  MoreIcon,
  ChevronRight,
  SparkleIcon,
  QueueIcon,
} from "../icons";
import { cn } from "../utils/cn";

export function HomePage({
  subjects,
  loading,
  error,
  onOpen,
  onSnack,
}: {
  subjects: Subject[];
  loading?: boolean;
  error?: string | null;
  onOpen: (s: Subject) => void;
  onSnack: (text: string, tone?: "neutral" | "success" | "danger") => void;
}) {
  const featured = subjects[0];
  const recentlyAdded = useMemo(
    () => subjects.slice(0, 10),
    [subjects]
  );
  const continueWatching = useMemo(
    () => subjects.filter((s) => s.progress > 0 && s.progress < 1).slice(0, 4),
    [subjects]
  );

  const stats = useMemo(() => {
    const matched = subjects.filter((s) => s.status === "matched").length;
    const unmatched = subjects.filter((s) => s.status !== "matched").length;
    return [
      { label: "Indexed Media", value: subjects.length.toString(), hint: loading ? "加载中" : "Rust backend" },
      { label: "Matched", value: matched.toString(), hint: subjects.length ? `${Math.round((matched / subjects.length) * 100)}%` : "0%" },
      { label: "Unmatched", value: unmatched.toString(), hint: "需要确认" },
      { label: "Backend", value: error ? "Disconnected" : "Live", hint: error ? "浏览器无法访问 IPC" : "IPC connected" },
    ];
  }, [error, loading, subjects]);

  if (!featured) {
    return (
      <div className="px-10 py-10">
        <h1 className="text-[36px] font-semibold tracking-tight">NexPlay</h1>
        <div className="mt-3 text-[14px] text-[var(--color-on-surface-muted)]">
          {error ?? "暂无媒体。请先在 config.toml 配置媒体目录，然后扫描媒体库。"}
        </div>
      </div>
    );
  }

  return (
    <div className="relative pb-16">
      {/* Hero */}
      <HeroSection featured={featured} onOpen={() => onOpen(featured)} onSnack={onSnack} />

      <div className="px-10 mt-12 space-y-12">
        {/* Continue watching */}
        <Section title="继续观看" subtitle="Continue Watching" viewAll>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {continueWatching.map((s) => (
              <ContinueCard key={s.id} subject={s} onClick={() => onOpen(s)} />
            ))}
          </div>
        </Section>

        {/* Recently added */}
        <Section title="最近添加" subtitle="Recently Added" viewAll>
          <HorizontalRow>
            {recentlyAdded.map((s) => (
              <MediaCard key={s.id} subject={s} onClick={() => onOpen(s)} />
            ))}
          </HorizontalRow>
        </Section>

        {/* Library overview */}
        <Section title="媒体库概览" subtitle="Library Overview">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {stats.map((s) => (
              <Card key={s.label} className="p-4">
                <div className="text-[11px] uppercase tracking-wider text-[var(--color-on-surface-faint)]">
                  {s.label}
                </div>
                <div className="mt-2 text-[26px] font-semibold tracking-tight tabular-nums">
                  {s.value}
                </div>
                <div className="text-[12px] text-[var(--color-on-surface-muted)] mt-1">
                  {s.hint}
                </div>
              </Card>
            ))}
          </div>
        </Section>

      </div>
    </div>
  );
}

function HeroSection({
  featured,
  onOpen,
  onSnack,
}: {
  featured: Subject;
  onOpen: () => void;
  onSnack: (text: string) => void;
}) {
  return (
    <div className="relative h-[560px] w-full overflow-hidden">
      {/* Background image */}
      <img
        src={featured.hero}
        alt={featured.title}
        className="absolute inset-0 size-full object-cover"
      />
      {/* Scrims */}
      <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-bg)] via-[var(--color-bg)]/60 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-[var(--color-bg)]/90 via-[var(--color-bg)]/40 to-transparent" />
      <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_20%_50%,rgba(255,138,101,0.18),transparent_60%)]" />

      {/* Content */}
      <div className="relative h-full flex items-end px-10 pb-14 anim-fade-up">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 mb-5">
            <Badge tone="primary">
              <SparkleIcon className="size-3" />
              NEW EPISODE
            </Badge>
            <Badge tone="accent">CONTINUE</Badge>
            <Badge tone="success">METADATA READY</Badge>
          </div>
          <div className="text-[12px] tracking-[0.3em] uppercase text-[var(--color-on-surface-muted)] mb-3">
            Featured · {featured.year}
          </div>
          <h1 className="text-[56px] font-semibold leading-[1.05] tracking-tight">
            {featured.title}
          </h1>
          <div className="text-[18px] text-[var(--color-on-surface-muted)] mt-2 font-light">
            {featured.titleCn}
          </div>
          <p className="text-[15px] leading-relaxed text-[var(--color-on-surface-muted)] mt-5 max-w-xl line-clamp-3">
            {featured.summary}
          </p>

          <div className="flex items-center gap-3 mt-8">
            <Button size="lg" onClick={onOpen} icon={<PlayIcon className="size-4" />}>
              继续观看 · EP{featured.currentEpisode}
            </Button>
            <Button
              size="lg"
              variant="tonal"
              icon={<QueueIcon className="size-4" />}
              onClick={() => onSnack(`已加入队列：${featured.title}`)}
            >
              Add to Queue
            </Button>
            <Button size="lg" variant="text" icon={<MoreIcon className="size-4" />}>
              More
            </Button>
          </div>

          {/* progress strip */}
          <div className="mt-7 max-w-md">
            <div className="flex items-center justify-between text-[12px] text-[var(--color-on-surface-faint)] mb-1.5">
              <span>EP{featured.currentEpisode} · 第 {featured.currentEpisode} 话</span>
              <span>10:42 / 24:00</span>
            </div>
            <Progress value={featured.progress} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
  viewAll,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  viewAll?: boolean;
}) {
  return (
    <section>
      <div className="flex items-end justify-between mb-5">
        <div>
          <h2 className="text-[22px] font-semibold tracking-tight">{title}</h2>
          {subtitle && (
            <div className="text-[12px] uppercase tracking-[0.2em] text-[var(--color-on-surface-faint)] mt-1">
              {subtitle}
            </div>
          )}
        </div>
        {viewAll && (
          <button className="inline-flex items-center gap-1 text-[13px] text-[var(--color-on-surface-muted)] hover:text-[var(--color-primary)] transition-colors">
            View All <ChevronRight className="size-4" />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function HorizontalRow({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="relative -mx-2">
      <div
        ref={ref}
        className="flex gap-4 overflow-x-auto px-2 pb-3 hide-scrollbar"
      >
        {children}
      </div>
    </div>
  );
}

function ContinueCard({
  subject,
  onClick,
}: {
  subject: Subject;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative flex gap-4 p-3 rounded-2xl cursor-pointer transition-all",
        "bg-[var(--color-surface-1)] ring-1 ring-inset ring-[var(--color-outline-soft)]",
        "hover:bg-[var(--color-surface-2)] hover:ring-[var(--color-outline)]"
      )}
    >
      <div className="relative w-[110px] aspect-[2/3] rounded-xl overflow-hidden shrink-0 ring-1 ring-black/30">
        <Poster src={subject.poster} alt={subject.title} className="absolute inset-0" />
        <div className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="size-10 rounded-full bg-[var(--color-primary)] grid place-items-center text-[var(--color-on-primary)]">
            <PlayIcon className="size-4 ml-0.5" />
          </div>
        </div>
      </div>
      <div className="flex-1 flex flex-col min-w-0 py-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium truncate">{subject.title}</div>
            <div className="text-[12px] text-[var(--color-on-surface-faint)] truncate">
              {subject.titleCn}
            </div>
          </div>
          {subject.newEpisode && <Badge tone="primary">NEW</Badge>}
        </div>
        <div className="text-[12px] text-[var(--color-on-surface-muted)] mt-2">
          EP{String(subject.currentEpisode).padStart(2, "0")} · {subject.lastPlayed}
        </div>
        <div className="mt-auto pt-3">
          <Progress value={subject.progress} />
          <div className="flex items-center justify-between mt-2">
            <span className="text-[11px] tabular-nums text-[var(--color-on-surface-faint)]">
              {Math.round(subject.progress * 100)}%
            </span>
            <Button
              size="sm"
              variant="tonal"
              icon={<PlayIcon className="size-3.5" />}
              onClick={(e) => {
                e.stopPropagation();
                onClick();
              }}
            >
              继续
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
