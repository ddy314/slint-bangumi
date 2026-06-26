import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Download, Loader2, Search, ShieldCheck } from "lucide-react";
import { searchEpisodeResources, startResourceDownload, type EpisodeResource } from "../backend";
import type { Subject } from "../data";
import { appleSpringBouncy, appleSpringSoft } from "../motion";

export type ResourceSearchPrefill = {
  subject: Subject;
};

type ResourceSort = "score" | "seeders" | "downloads" | "date" | "size";
type ResolutionFilter = "all" | "2160p" | "1440p" | "1080p" | "720p";
type BatchFilter = "all" | "batch" | "single";

export function ResourcesPage({
  prefill,
  onBackToDetail,
  onSnack,
}: {
  prefill: ResourceSearchPrefill | null;
  onBackToDetail: (subject: Subject) => void;
  onSnack: (text: string, tone?: "neutral" | "success" | "danger") => void;
}) {
  const [query, setQuery] = useState("");
  const [context, setContext] = useState<Subject | null>(null);
  const [resources, setResources] = useState<EpisodeResource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [sort, setSort] = useState<ResourceSort>("score");
  const [resolution, setResolution] = useState<ResolutionFilter>("all");
  const [batchFilter, setBatchFilter] = useState<BatchFilter>("all");
  const searchRequestIdRef = useRef(0);

  const keywordOptions = useMemo(() => {
    const values = [
      context?.title,
      context?.titleCn,
      ...(context?.aliases || []),
    ].filter((value): value is string => Boolean(value?.trim()));
    return Array.from(new Map(values.map((value) => [normalizeOption(value), value.trim()])).values());
  }, [context]);

  const searchTitle = query.trim();
  const canSearch = searchTitle.length >= 2;

  const runSearch = useCallback(async () => {
    if (!canSearch) {
      searchRequestIdRef.current += 1;
      setResources([]);
      return;
    }
    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const response = await searchEpisodeResources({
        subjectProvider: context?.provider || "manual",
        providerSubjectId: context?.providerSubjectId || searchTitle,
        title: searchTitle,
        titleCn: "",
        aliases: [],
        limit: 80,
      });
      if (searchRequestIdRef.current !== requestId) return;
      setResources(response.resources);
      if (!response.resources.length) {
        setError("没有找到匹配资源。");
      }
    } catch (caught) {
      if (searchRequestIdRef.current !== requestId) return;
      const message = caught instanceof Error ? caught.message : String(caught);
      setResources([]);
      setError(message);
    } finally {
      if (searchRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [canSearch, context, searchTitle]);

  useEffect(() => {
    if (!prefill) return;
    setContext(prefill.subject);
    setQuery(prefill.subject.title || prefill.subject.titleCn);
  }, [prefill]);

  useEffect(() => {
    if (!prefill) return;
    const timer = window.setTimeout(() => {
      void runSearch();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [prefill, runSearch]);

  const visibleResources = useMemo(() => resources
    .filter((resource) => resolution === "all" || resource.resolution === resolution)
    .filter((resource) => batchFilter === "all" || (batchFilter === "batch" ? resource.batch : !resource.batch))
    .sort(resourceSorter(sort)), [batchFilter, resources, resolution, sort]);

  const downloadResource = useCallback(async (resource: EpisodeResource) => {
    setDownloadingId(resource.id);
    try {
      const task = await startResourceDownload({
        resource,
        subjectProvider: context?.provider || "manual",
        providerSubjectId: context?.providerSubjectId || searchTitle,
      });
      if (task.status === "failed") {
        onSnack(`添加下载失败：${task.error || "qBittorrent 返回失败"}`, "danger");
      } else {
        onSnack("已添加到 qBittorrent 下载队列。", "success");
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      onSnack(`添加下载失败：${message}`, "danger");
    } finally {
      setDownloadingId(null);
    }
  }, [context, onSnack, searchTitle]);

  const subtitle = loading ? "正在搜索 Nyaa RSS" : `${visibleResources.length}/${resources.length} 个资源`;

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <motion.div
        className="page-shell"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={appleSpringSoft}
      >
        <header className="page-header">
          <div>
            <motion.h1
              className="text-[42px] font-bold leading-[1] tracking-tight text-[var(--color-text-primary)]"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={appleSpringSoft}
            >
              资源搜索
            </motion.h1>
            <motion.p
              className="mt-2.5 text-[17px] font-medium text-[var(--color-text-secondary)]"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={appleSpringSoft}
            >
              {subtitle}
            </motion.p>
          </div>
          {context && (
            <motion.button
              type="button"
              onClick={() => onBackToDetail(context)}
              className="flex h-10 items-center justify-center gap-2 rounded-[var(--radius-pill)] bg-black/[0.055] px-4 text-[13px] font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-black/[0.08]"
              whileTap={{ scale: 0.96 }}
              transition={appleSpringBouncy}
            >
              <ArrowLeft size={15} />
              返回详情
            </motion.button>
          )}
        </header>

        {keywordOptions.length > 0 && (
          <div className="resource-keyword-strip">
            {keywordOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={normalizeOption(option) === normalizeOption(query) ? "active" : undefined}
                onClick={() => setQuery(option)}
              >
                {option}
              </button>
            ))}
          </div>
        )}

        <div className="resource-search-bar">
          <label className="search-field flex h-12 min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-pill)] px-4">
            <Search size={21} className="text-[var(--color-text-tertiary)]" strokeWidth={2.1} />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                if (!keywordOptions.some((option) => normalizeOption(option) === normalizeOption(event.target.value))) {
                  setContext(null);
                }
              }}
              placeholder="输入番剧原名、译名或别名"
              className="min-w-0 flex-1 bg-transparent text-[16px] font-semibold text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]/85"
            />
          </label>
          <motion.button
            type="button"
            onClick={() => void runSearch()}
            disabled={!canSearch || loading}
            className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-pill)] bg-[var(--color-primary)] px-5 text-[13px] font-semibold text-white disabled:opacity-50"
            whileTap={{ scale: 0.96 }}
            transition={appleSpringBouncy}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            搜索
          </motion.button>
        </div>

        <div className="search-filter-row resource-filter-row">
          <label>
            <span>排序</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as ResourceSort)}>
              <option value="score">推荐</option>
              <option value="seeders">做种数</option>
              <option value="downloads">下载量</option>
              <option value="date">发布时间</option>
              <option value="size">体积</option>
            </select>
          </label>
          <label>
            <span>清晰度</span>
            <select value={resolution} onChange={(event) => setResolution(event.target.value as ResolutionFilter)}>
              <option value="all">全部</option>
              <option value="2160p">2160p</option>
              <option value="1440p">1440p</option>
              <option value="1080p">1080p</option>
              <option value="720p">720p</option>
            </select>
          </label>
          <label>
            <span>类型</span>
            <select value={batchFilter} onChange={(event) => setBatchFilter(event.target.value as BatchFilter)}>
              <option value="all">全部</option>
              <option value="batch">合集</option>
              <option value="single">单集</option>
            </select>
          </label>
        </div>

        {error && (
          <div className="mt-5 rounded-[var(--radius-card)] bg-rose-500/8 px-4 py-3 text-[13px] font-medium text-rose-600">
            {error}
          </div>
        )}

        <div className="mt-6 grid gap-2.5 pb-10">
          {visibleResources.map((resource) => (
            <ResourceRow
              key={`${resource.id}-${resource.infoHash || resource.torrentUrl}`}
              resource={resource}
              downloading={downloadingId === resource.id}
              disabled={downloadingId !== null}
              onDownload={() => void downloadResource(resource)}
            />
          ))}
          {!loading && !error && visibleResources.length === 0 && (
            <div className="flex min-h-[280px] items-center justify-center text-[13px] font-medium text-[var(--color-text-tertiary)]">
              暂无资源结果
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function ResourceRow({
  resource,
  downloading,
  disabled,
  onDownload,
}: {
  resource: EpisodeResource;
  downloading: boolean;
  disabled: boolean;
  onDownload: () => void;
}) {
  return (
    <motion.div
      className="resource-row"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={appleSpringSoft}
    >
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-[13.5px] font-semibold leading-relaxed text-[var(--color-text-primary)]">
          {resource.title}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-[var(--color-text-tertiary)]">
          <Badge>{resource.subtitleGroup}</Badge>
          <Badge>{resource.resolution}</Badge>
          {resource.size && <Badge>{resource.size}</Badge>}
          <Badge tone="good">S {resource.seeders}</Badge>
          <Badge>L {resource.leechers}</Badge>
          <Badge>D {resource.downloads}</Badge>
          {resource.trusted && <Badge tone="info"><ShieldCheck size={12} /> trusted</Badge>}
          {resource.batch && <Badge tone="warn">合集</Badge>}
          {resource.episodeEnd > resource.episodeStart && (
            <Badge tone="warn">
              覆盖 {resource.episodeStart === 1 && resource.episodeEnd >= 999 ? "全季" : `${resource.episodeStart}-${resource.episodeEnd}`}
            </Badge>
          )}
          {resource.remake && <Badge tone="bad">remake</Badge>}
        </div>
      </div>
      <button
        type="button"
        onClick={onDownload}
        disabled={disabled}
        className="flex h-9 shrink-0 items-center justify-center gap-2 rounded-full bg-[var(--color-primary)] px-4 text-[12px] font-semibold text-white disabled:opacity-60"
      >
        {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
        下载
      </button>
    </motion.div>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "good" | "info" | "warn" | "bad";
}) {
  const toneClasses = {
    good: "bg-emerald-500/8 text-emerald-600",
    info: "bg-blue-500/8 text-blue-600",
    warn: "bg-amber-500/8 text-amber-600",
    bad: "bg-rose-500/8 text-rose-600",
  };
  const toneClass = tone ? toneClasses[tone] : "bg-black/[0.035]";
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-[2px] ${toneClass}`}>{children}</span>;
}

function resourceSorter(sort: ResourceSort) {
  return (left: EpisodeResource, right: EpisodeResource) => {
    if (sort === "seeders") return right.seeders - left.seeders || right.score - left.score;
    if (sort === "downloads") return right.downloads - left.downloads || right.score - left.score;
    if (sort === "date") return Date.parse(right.publishedAt || "") - Date.parse(left.publishedAt || "") || right.score - left.score;
    if (sort === "size") return parseSize(right.size) - parseSize(left.size) || right.score - left.score;
    return right.score - left.score || right.seeders - left.seeders;
  };
}

function parseSize(value: string) {
  const match = value.match(/([\d.]+)\s*([KMGT]i?B|[KMGT]B)/i);
  if (!match) return 0;
  const amount = Number(match[1]) || 0;
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    kb: 1024,
    kib: 1024,
    mb: 1024 ** 2,
    mib: 1024 ** 2,
    gb: 1024 ** 3,
    gib: 1024 ** 3,
    tb: 1024 ** 4,
    tib: 1024 ** 4,
  };
  return amount * (multipliers[unit] || 1);
}

function normalizeOption(value: string) {
  return value.trim().toLowerCase();
}
