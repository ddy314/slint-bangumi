import { useMemo } from "react";
import { makeEpisodes, STATUS_COLOR, STATUS_LABEL, type Subject } from "../data";
import { Badge, Button, Card, Chip, Progress, SearchField } from "../ui";
import { Poster } from "../MediaCard";
import {
  ArrowLeft,
  CheckIcon,
  DanmakuIcon,
  FileIcon,
  MoreIcon,
  PlayIcon,
  RefreshIcon,
  ScanIcon,
  SparkleIcon,
  StarIcon,
} from "../icons";
import { cn } from "../utils/cn";

export function DetailPage({
  subject,
  onBack,
  onSnack,
}: {
  subject: Subject;
  onBack: () => void;
  onSnack: (text: string, tone?: "neutral" | "success" | "danger") => void;
}) {
  const episodes = useMemo(() => makeEpisodes(subject), [subject]);
  const isUnmatched = subject.status === "unmatched" || subject.status === "failed";

  return (
    <div className="relative pb-20">
      {/* Hero */}
      <div className="relative h-[440px] w-full overflow-hidden">
        {subject.hero ? (
          <img src={subject.hero} alt={subject.title} className="absolute inset-0 size-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-surface-3)] via-[var(--color-surface-2)] to-[var(--color-surface)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-bg)] via-[var(--color-bg)]/70 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--color-bg)]/70 via-transparent to-[var(--color-bg)]/30" />

        {/* Top bar */}
        <div className="absolute top-0 inset-x-0 flex items-center justify-between px-8 py-5">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 h-9 px-3 rounded-full bg-black/40 backdrop-blur-md text-white text-[13px] hover:bg-black/60 transition-colors"
          >
            <ArrowLeft className="size-4" />
            Back to Library
          </button>
          <button className="size-9 grid place-items-center rounded-full bg-black/40 backdrop-blur-md text-white hover:bg-black/60">
            <MoreIcon className="size-4" />
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="px-10 -mt-44 relative grid grid-cols-[260px_1fr] gap-10 items-start">
        {/* Poster */}
        <div className="relative">
          <div className="aspect-[2/3] rounded-2xl overflow-hidden ring-1 ring-black/40 shadow-2xl shadow-black/60">
            <Poster src={subject.poster} alt={subject.title} className="size-full" />
          </div>
          {subject.rating > 0 && (
            <Card className="mt-4 p-4">
              <div className="flex items-center gap-1.5 text-amber-300">
                <StarIcon className="size-4" />
                <span className="text-[22px] font-semibold tabular-nums">
                  {subject.rating.toFixed(1)}
                </span>
                <span className="text-[12px] text-[var(--color-on-surface-faint)] ml-auto">
                  #{subject.rank}
                </span>
              </div>
              <div className="text-[11px] text-[var(--color-on-surface-faint)] mt-1">
                Bangumi 评分 · 1,243 人
              </div>
            </Card>
          )}
        </div>

        {/* Info */}
        <div className="pt-16">
          <div className="flex items-center gap-2 mb-4">
            <span
              className={cn(
                "inline-flex items-center px-2 h-6 rounded-full text-[11px] font-medium ring-1 ring-inset",
                STATUS_COLOR[subject.status]
              )}
            >
              {STATUS_LABEL[subject.status]}
            </span>
            {subject.newEpisode && (
              <Badge tone="primary">
                <SparkleIcon className="size-3" /> NEW EPISODE
              </Badge>
            )}
            {subject.metadataReady && <Badge tone="success">METADATA READY</Badge>}
          </div>

          <h1 className="text-[44px] font-semibold tracking-tight leading-[1.05]">
            {isUnmatched ? subject.fileSummary.split(".")[0] : subject.title}
          </h1>
          {!isUnmatched && (
            <div className="text-[18px] text-[var(--color-on-surface-muted)] mt-1 font-light">
              {subject.titleCn} · {subject.year} · {subject.airDate}
            </div>
          )}

          {!isUnmatched && (
            <div className="mt-5 flex flex-wrap gap-2">
              {subject.tags.map((t) => (
                <Chip key={t}>{t}</Chip>
              ))}
            </div>
          )}

          {!isUnmatched && subject.summary && (
            <p className="text-[15px] leading-relaxed text-[var(--color-on-surface-muted)] mt-6 max-w-3xl">
              {subject.summary}
            </p>
          )}

          {/* Primary actions */}
          <div className="mt-7 flex flex-wrap items-center gap-2">
            {subject.progress > 0 && subject.progress < 1 ? (
              <Button size="lg" icon={<PlayIcon className="size-4" />}>
                继续 EP{subject.currentEpisode}
              </Button>
            ) : (
              <Button size="lg" icon={<PlayIcon className="size-4" />}>
                Play
              </Button>
            )}
            <Button
              size="lg"
              variant="tonal"
              icon={<DanmakuIcon className="size-4" />}
              onClick={() => onSnack("弹幕加载 IPC 尚未接入")}
            >
              Load Danmaku
            </Button>
            <Button
              size="lg"
              variant="outlined"
              icon={<RefreshIcon className="size-4" />}
              onClick={() => onSnack("正在重新匹配…")}
            >
              Rematch
            </Button>
            {subject.status === "tentative" && (
              <Button
                size="lg"
                variant="outlined"
                icon={<CheckIcon className="size-4" />}
                onClick={() => onSnack("匹配已确认", "success")}
              >
                Confirm Match
              </Button>
            )}
            <Button size="lg" variant="text">
              Refresh Metadata
            </Button>
            <Button size="lg" variant="text">
              Cache Images
            </Button>
          </div>

          {/* Watching progress strip */}
          {subject.progress > 0 && subject.progress < 1 && (
            <div className="mt-6 max-w-lg">
              <div className="flex items-center justify-between text-[12px] text-[var(--color-on-surface-faint)] mb-1.5">
                <span>EP{subject.currentEpisode} · 进行中</span>
                <span className="tabular-nums">{Math.round(subject.progress * 100)}%</span>
              </div>
              <Progress value={subject.progress} />
            </div>
          )}
        </div>
      </div>

      {/* Unmatched candidate UI */}
      {isUnmatched && (
        <div className="px-10 mt-12">
          <h2 className="text-[20px] font-semibold tracking-tight mb-1">未匹配 · 搜索 Bangumi</h2>
          <div className="text-[13px] text-[var(--color-on-surface-faint)] mb-4">
            根据文件名 <code className="px-1 rounded bg-white/5 font-mono">{subject.fileSummary}</code> 查找候选条目
          </div>
          <SearchField value={subject.title} onChange={() => {}} className="max-w-xl" placeholder="搜索 Bangumi…" />
          <Card className="mt-6 p-5 text-[13px] text-[var(--color-on-surface-muted)]">
            当前没有后端返回的候选条目。请先扫描媒体库，再执行元数据匹配。
          </Card>
        </div>
      )}

      {/* Local files & Episodes */}
      <div className="px-10 mt-14 grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-8">
        {/* Files */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[20px] font-semibold tracking-tight">本地文件</h2>
            <div className="text-[12px] text-[var(--color-on-surface-faint)]">
              {subject.files} 个文件 · {subject.totalSize}
            </div>
          </div>
          <Card className="overflow-hidden">
            <div className="grid grid-cols-[1fr_70px_90px_90px_60px] gap-3 px-4 py-2.5 text-[11px] uppercase tracking-wider text-[var(--color-on-surface-faint)] border-b border-[var(--color-outline-soft)] bg-[var(--color-surface)]">
              <div>Filename</div>
              <div>EP</div>
              <div>Size</div>
              <div>Last</div>
              <div className="text-right">Play</div>
            </div>
            {episodes.slice(0, Math.min(8, subject.files)).map((e, i) => (
              <FileRow
                key={e.index}
                ep={e.index}
                name={i === 0 ? subject.fileSummary : `${subject.fileSummary} #${e.index}`}
                size={subject.totalSize}
                last={e.watched ? "已播放" : "—"}
                progress={
                  subject.currentEpisode === e.index ? subject.progress :
                    e.watched ? 1 : 0
                }
                isLast={i === Math.min(8, subject.files) - 1}
              />
            ))}
          </Card>
        </section>

        {/* Episodes */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[20px] font-semibold tracking-tight">分集</h2>
            <div className="flex items-center gap-2">
              <Chip selected>All</Chip>
              <Chip>Unwatched</Chip>
            </div>
          </div>
          <Card className="divide-y divide-[var(--color-outline-soft)] max-h-[520px] overflow-y-auto">
            {episodes.map((e) => (
              <EpisodeRow
                key={e.index}
                index={e.index}
                title={e.title}
                duration={e.duration}
                watched={e.watched}
                current={subject.currentEpisode === e.index}
                airDate={e.airDate}
              />
            ))}
          </Card>
        </section>
      </div>

    </div>
  );
}

function FileRow({
  ep,
  name,
  size,
  last,
  progress,
  isLast,
}: {
  ep: number;
  name: string;
  size: string;
  last: string;
  progress: number;
  isLast: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[1fr_70px_90px_90px_60px] gap-3 px-4 py-3 items-center text-[13px] hover:bg-white/[0.04] transition-colors",
        !isLast && "border-b border-[var(--color-outline-soft)]"
      )}
    >
      <div className="min-w-0 flex items-center gap-2">
        <FileIcon className="size-4 shrink-0 text-[var(--color-on-surface-faint)]" />
        <div className="min-w-0">
          <div className="truncate font-mono text-[12.5px]">{name}</div>
          {progress > 0 && progress < 1 && (
            <div className="mt-1.5"><Progress value={progress} /></div>
          )}
        </div>
      </div>
      <div className="tabular-nums">EP{String(ep).padStart(2, "0")}</div>
      <div className="text-[var(--color-on-surface-muted)] tabular-nums">{size}</div>
      <div className="text-[var(--color-on-surface-faint)]">{last}</div>
      <div className="flex justify-end">
        <button className="size-8 rounded-full bg-[var(--color-primary-soft)] text-[var(--color-primary)] grid place-items-center hover:brightness-110">
          <PlayIcon className="size-3.5 ml-0.5" />
        </button>
      </div>
    </div>
  );
}

function EpisodeRow({
  index,
  title,
  duration,
  watched,
  current,
  airDate,
}: {
  index: number;
  title: string;
  duration: string;
  watched: boolean;
  current: boolean;
  airDate: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3 text-[13px] hover:bg-white/[0.04] transition-colors cursor-pointer",
        current && "bg-[var(--color-primary-soft)]/60"
      )}
    >
      <div
        className={cn(
          "size-7 shrink-0 grid place-items-center rounded-full text-[11px] font-medium tabular-nums",
          current
            ? "bg-[var(--color-primary)] text-[var(--color-on-primary)]"
            : watched
            ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30"
            : "bg-white/5 text-[var(--color-on-surface-muted)] ring-1 ring-inset ring-[var(--color-outline-soft)]"
        )}
      >
        {watched && !current ? <CheckIcon className="size-3.5" /> : index}
      </div>
      <div className="flex-1 min-w-0">
        <div className={cn("truncate", current && "font-medium text-[var(--color-primary)]")}>
          第 {index} 话 · {title}
        </div>
        <div className="text-[11px] text-[var(--color-on-surface-faint)] mt-0.5">
          {airDate} · {duration}
        </div>
      </div>
      {current && (
        <Button size="sm" variant="tonal" icon={<PlayIcon className="size-3.5" />}>继续</Button>
      )}
    </div>
  );
}

// re-export ScanIcon dummy to avoid linter dropping
export { ScanIcon };
