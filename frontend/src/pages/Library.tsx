import { useMemo, useState } from "react";
import { STATUS_LABEL, STATUS_COLOR, type Subject, type MatchStatus } from "../data";
import type { LibraryStats } from "../backend";
import { Badge, Button, Card, Chip, Progress, SearchField, Segmented } from "../ui";
import { MediaCard, Poster } from "../MediaCard";
import {
  FolderPlus,
  GridIcon,
  ListIcon,
  PlayIcon,
  ScanIcon,
  SortIcon,
  MoreIcon,
  ChevronDown,
  CheckIcon,
} from "../icons";
import { cn } from "../utils/cn";

type FilterKey = "all" | "watching" | "completed" | "unmatched" | "tentative";

export function LibraryPage({
  subjects,
  stats,
  onOpen,
  onSnack,
  onScan,
}: {
  subjects: Subject[];
  stats: LibraryStats;
  onOpen: (s: Subject) => void;
  onSnack: (text: string, tone?: "neutral" | "success" | "danger") => void;
  onScan: () => void | Promise<void>;
}) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<"title" | "date" | "progress" | "match">("date");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = subjects.slice();
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.titleCn.includes(query) ||
          s.fileSummary.toLowerCase().includes(q)
      );
    }
    switch (filter) {
      case "watching":
        list = list.filter((s) => s.progress > 0 && s.progress < 1);
        break;
      case "completed":
        list = list.filter((s) => s.progress >= 1);
        break;
      case "unmatched":
        list = list.filter((s) => s.status === "unmatched" || s.status === "failed");
        break;
      case "tentative":
        list = list.filter((s) => s.status === "tentative");
        break;
    }
    switch (sort) {
      case "title":
        list.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "progress":
        list.sort((a, b) => b.progress - a.progress);
        break;
      case "match":
        const order: Record<MatchStatus, number> = { matched: 0, tentative: 1, unmatched: 2, failed: 3 };
        list.sort((a, b) => order[a.status] - order[b.status]);
        break;
    }
    return list;
  }, [filter, sort, query, subjects]);

  const filters: { key: FilterKey; label: string }[] = [
    { key: "all", label: "All" },
    { key: "watching", label: "Watching" },
    { key: "completed", label: "Completed" },
    { key: "unmatched", label: "Unmatched" },
    { key: "tentative", label: "Tentative" },
  ];

  const selected = selectedId ? subjects.find((s) => s.id === selectedId) : null;
  const showEmpty = filtered.length === 0;

  return (
    <div className="px-10 py-10 pb-20">
      {/* Header */}
      <div className="flex items-end justify-between mb-2">
        <div>
          <h1 className="text-[36px] font-semibold tracking-tight leading-tight">媒体库</h1>
          <div className="text-[14px] text-[var(--color-on-surface-muted)] mt-2">
            <span className="tabular-nums">{stats.total}</span> items ·{" "}
            <span className="text-emerald-300 tabular-nums">{stats.matched}</span> matched ·{" "}
            <span className="text-amber-300 tabular-nums">{stats.unmatched}</span> unmatched
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outlined"
            icon={<FolderPlus className="size-4" />}
            onClick={() => onSnack("目录选择尚未接入。请先编辑 config.toml 的 media_libraries。")}
          >
            Add Folder
          </Button>
          <Button
            icon={<ScanIcon className="size-4" />}
            onClick={() => {
              onSnack("已开始扫描媒体目录…");
              void onScan();
            }}
          >
            Scan Now
          </Button>
        </div>
      </div>

      {/* Command Bar */}
      <Card className="mt-7 p-3 flex flex-wrap items-center gap-3 acrylic">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="搜索标题、文件名、标签…"
          className="min-w-[280px] flex-1 max-w-md"
        />
        <div className="h-6 w-px bg-[var(--color-outline-soft)]" />
        <div className="flex items-center gap-2 flex-wrap">
          {filters.map((f) => (
            <Chip
              key={f.key}
              selected={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </Chip>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <SortMenu sort={sort} onChange={setSort} />
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: "grid", label: "", icon: <GridIcon className="size-4" /> },
              { value: "list", label: "", icon: <ListIcon className="size-4" /> },
            ]}
          />
        </div>
      </Card>

      {/* Body */}
      <div className={cn("mt-8 grid gap-8", selected ? "grid-cols-[1fr_320px]" : "grid-cols-1")}>
        <div>
          {showEmpty ? (
            <EmptyState query={query} onClear={() => setQuery("")} />
          ) : view === "grid" ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-5 gap-y-8">
              {filtered.map((s) => (
                <div key={s.id} className="flex justify-center">
                  <MediaCard
                    subject={s}
                    selected={selectedId === s.id}
                    onClick={() => {
                      if (selectedId === s.id) onOpen(s);
                      else setSelectedId(s.id);
                    }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <Card className="overflow-hidden">
              <ListHeader />
              {filtered.map((s, i) => (
                <ListRow
                  key={s.id}
                  subject={s}
                  isLast={i === filtered.length - 1}
                  onOpen={() => onOpen(s)}
                />
              ))}
            </Card>
          )}
        </div>

        {selected && (
          <PreviewPanel
            subject={selected}
            onClose={() => setSelectedId(null)}
            onOpen={() => onOpen(selected)}
          />
        )}
      </div>
    </div>
  );
}

function SortMenu({
  sort,
  onChange,
}: {
  sort: "title" | "date" | "progress" | "match";
  onChange: (v: any) => void;
}) {
  const [open, setOpen] = useState(false);
  const items = [
    { v: "title", l: "Title" },
    { v: "date", l: "Date Added" },
    { v: "progress", l: "Progress" },
    { v: "match", l: "Match Status" },
  ] as const;
  const current = items.find((i) => i.v === sort)?.l;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 h-9 px-3 text-[13px] rounded-full bg-[var(--color-surface-2)] ring-1 ring-inset ring-[var(--color-outline-soft)] hover:bg-[var(--color-surface-3)] text-[var(--color-on-surface)]"
      >
        <SortIcon className="size-4 text-[var(--color-on-surface-faint)]" />
        Sort · <span className="text-[var(--color-on-surface)] font-medium">{current}</span>
        <ChevronDown className="size-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-20 w-44 rounded-xl bg-[var(--color-surface-3)] ring-1 ring-inset ring-[var(--color-outline)] shadow-xl py-1.5">
            {items.map((it) => (
              <button
                key={it.v}
                onClick={() => {
                  onChange(it.v);
                  setOpen(false);
                }}
                className="w-full flex items-center justify-between px-3 py-2 text-[13px] text-left hover:bg-white/[0.06]"
              >
                {it.l}
                {sort === it.v && <CheckIcon className="size-4 text-[var(--color-primary)]" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ListHeader() {
  return (
    <div className="grid grid-cols-[64px_1fr_140px_120px_140px_80px] gap-4 px-5 py-3 text-[11px] uppercase tracking-wider text-[var(--color-on-surface-faint)] border-b border-[var(--color-outline-soft)] bg-[var(--color-surface)]">
      <div></div>
      <div>Title</div>
      <div>Status</div>
      <div>Progress</div>
      <div>Last Played</div>
      <div className="text-right">Action</div>
    </div>
  );
}

function ListRow({
  subject,
  onOpen,
  isLast,
}: {
  subject: Subject;
  onOpen: () => void;
  isLast: boolean;
}) {
  return (
    <div
      onClick={onOpen}
      className={cn(
        "grid grid-cols-[64px_1fr_140px_120px_140px_80px] gap-4 px-5 py-3 items-center cursor-pointer transition-colors hover:bg-white/[0.04]",
        !isLast && "border-b border-[var(--color-outline-soft)]"
      )}
    >
      <div className="aspect-[2/3] w-12 rounded-md overflow-hidden ring-1 ring-black/40">
        <Poster src={subject.poster} alt={subject.title} className="size-full" />
      </div>
      <div className="min-w-0">
        <div className="text-[14px] font-medium truncate flex items-center gap-2">
          {subject.title}
          {subject.newEpisode && <Badge tone="primary">NEW</Badge>}
        </div>
        <div className="text-[12px] text-[var(--color-on-surface-faint)] truncate font-mono">
          {subject.fileSummary}
        </div>
      </div>
      <div>
        <span
          className={cn(
            "inline-flex items-center px-2 h-6 rounded-full text-[11px] font-medium ring-1 ring-inset",
            STATUS_COLOR[subject.status]
          )}
        >
          {STATUS_LABEL[subject.status]}
        </span>
      </div>
      <div className="flex flex-col gap-1 text-[12px]">
        <Progress value={subject.progress} />
        <span className="text-[var(--color-on-surface-faint)] tabular-nums">
          {subject.watchedEpisodes}/{subject.episodes || "?"} ep
        </span>
      </div>
      <div className="text-[12px] text-[var(--color-on-surface-muted)]">
        {subject.lastPlayed ?? "—"}
      </div>
      <div className="flex justify-end">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="size-9 rounded-full bg-[var(--color-primary-soft)] text-[var(--color-primary)] hover:brightness-110 grid place-items-center"
        >
          <PlayIcon className="size-4 ml-0.5" />
        </button>
      </div>
    </div>
  );
}

function PreviewPanel({
  subject,
  onClose,
  onOpen,
}: {
  subject: Subject;
  onClose: () => void;
  onOpen: () => void;
}) {
  return (
    <Card className="sticky top-6 p-5 self-start">
      <div className="flex items-start gap-3">
        <div className="w-[88px] aspect-[2/3] rounded-lg overflow-hidden ring-1 ring-black/40 shrink-0">
          <Poster src={subject.poster} alt={subject.title} className="size-full" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-medium leading-tight truncate">{subject.title}</div>
          <div className="text-[12px] text-[var(--color-on-surface-faint)] mt-1 truncate">
            {subject.titleCn}
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            {subject.tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="px-2 h-5 inline-flex items-center text-[10px] rounded-full bg-white/5 text-[var(--color-on-surface-muted)] ring-1 ring-inset ring-[var(--color-outline-soft)]"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
        <button
          onClick={onClose}
          className="size-7 rounded-full grid place-items-center hover:bg-white/[0.08] text-[var(--color-on-surface-faint)]"
        >
          <MoreIcon className="size-4" />
        </button>
      </div>

      <p className="text-[13px] leading-relaxed text-[var(--color-on-surface-muted)] mt-4 line-clamp-4">
        {subject.summary || "暂无简介。"}
      </p>

      <div className="mt-4 space-y-2 text-[12px]">
        <Row k="文件" v={`${subject.files} · ${subject.totalSize}`} />
        <Row k="集数" v={`${subject.watchedEpisodes}/${subject.episodes || "?"}`} />
        <Row k="评分" v={subject.rating ? subject.rating.toFixed(1) : "—"} />
        <Row k="最近播放" v={subject.lastPlayed ?? "—"} />
      </div>

      <div className="mt-5 flex flex-col gap-2">
        <Button icon={<PlayIcon className="size-4" />} onClick={onOpen}>
          打开详情
        </Button>
        <Button variant="tonal">查看文件</Button>
      </div>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[var(--color-on-surface-faint)]">{k}</span>
      <span className="text-[var(--color-on-surface)]">{v}</span>
    </div>
  );
}

function EmptyState({ query, onClear }: { query: string; onClear: () => void }) {
  if (query) {
    return (
      <Card className="p-12 grid place-items-center text-center">
        <div className="size-14 rounded-2xl bg-[var(--color-surface-3)] grid place-items-center mb-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="size-6 text-[var(--color-on-surface-muted)]">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
        </div>
        <div className="text-[16px] font-medium">没有找到 "{query}"</div>
        <div className="text-[13px] text-[var(--color-on-surface-faint)] mt-1">
          换个关键词试试，或者清除搜索查看全部。
        </div>
        <Button variant="tonal" className="mt-5" onClick={onClear}>
          Clear Search
        </Button>
      </Card>
    );
  }
  return (
    <Card className="p-12 grid place-items-center text-center">
      <div className="size-16 rounded-2xl bg-[var(--color-primary-soft)] grid place-items-center mb-4">
        <FolderPlus className="size-7 text-[var(--color-primary)]" />
      </div>
      <div className="text-[18px] font-medium">媒体库为空</div>
      <div className="text-[13px] text-[var(--color-on-surface-faint)] mt-1 max-w-sm">
        当前后端没有返回媒体。请先编辑 config.toml 的 media_libraries，然后点击 Scan Now。
      </div>
      <Button className="mt-5" variant="outlined" icon={<FolderPlus className="size-4" />}>
        Add Folder
      </Button>
    </Card>
  );
}
