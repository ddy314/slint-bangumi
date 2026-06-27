import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Check, Download, File, Loader2, Search, ShieldCheck, X } from "lucide-react";
import {
  confirmResourceDownload,
  controlDownloadTask,
  prepareResourceDownload,
  searchEpisodeResources,
  type DownloadTask,
  type EpisodeResource,
  type TorrentFile,
} from "../backend";
import type { Subject } from "../data";
import { appleSpringBouncy, appleSpringSoft } from "../motion";
import { Dropdown } from "../ui";

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] font-semibold text-[var(--color-text-tertiary)]">{label}</span>
      {children}
    </div>
  );
}

export type ResourceSearchPrefill = {
  subject: Subject;
};

type ResourceSort = "score" | "seeders" | "downloads" | "date" | "size";
type ResolutionFilter = "all" | "2160p" | "1440p" | "1080p" | "720p";
type BatchFilter = "all" | "batch" | "single";
type DownloadPickerState = {
  resource: EpisodeResource;
  task: DownloadTask | null;
  files: TorrentFile[];
  selected: Set<number>;
  loading: boolean;
  confirming: boolean;
  closing: boolean;
  error: string | null;
};

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
  const [downloadPicker, setDownloadPicker] = useState<DownloadPickerState | null>(null);
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

  const openDownloadPicker = useCallback(async (resource: EpisodeResource) => {
    setDownloadingId(resource.id);
    setDownloadPicker({
      resource,
      task: null,
      files: [],
      selected: new Set(),
      loading: true,
      confirming: false,
      closing: false,
      error: null,
    });
    try {
      const prepared = await prepareResourceDownload({
        resource,
        subjectProvider: context?.provider || "manual",
        providerSubjectId: context?.providerSubjectId || searchTitle,
      });
      setDownloadPicker({
        resource,
        task: prepared.task,
        files: prepared.files,
        selected: new Set(prepared.files.map((file) => file.index)),
        loading: false,
        confirming: false,
        closing: false,
        error: prepared.files.length ? null : "qBittorrent 没有返回文件列表。",
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setDownloadPicker((current) => current && current.resource.id === resource.id
        ? { ...current, loading: false, error: message }
        : current);
      onSnack(`读取种子文件失败：${message}`, "danger");
    } finally {
      setDownloadingId(null);
    }
  }, [context, onSnack, searchTitle]);

  const closeDownloadPicker = useCallback(async () => {
    const taskId = downloadPicker?.task?.id;
    setDownloadPicker((current) => current ? { ...current, closing: true } : current);
    try {
      if (taskId) {
        await controlDownloadTask({ taskId, action: "cancel", deleteFiles: false });
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      onSnack(`取消下载任务失败：${message}`, "danger");
    } finally {
      setDownloadPicker(null);
    }
  }, [downloadPicker?.task?.id, onSnack]);

  const confirmDownloadPicker = useCallback(async () => {
    if (!downloadPicker?.task) return;
    const selectedFileIndexes = Array.from(downloadPicker.selected).sort((left, right) => left - right);
    if (!selectedFileIndexes.length) {
      setDownloadPicker((current) => current ? { ...current, error: "至少选择一个文件。" } : current);
      return;
    }
    setDownloadPicker((current) => current ? { ...current, confirming: true, error: null } : current);
    try {
      const task = await confirmResourceDownload({
        taskId: downloadPicker.task.id,
        selectedFileIndexes,
      });
      if (task.status === "failed") {
        onSnack(`添加下载失败：${task.error || "qBittorrent 返回失败"}`, "danger");
      } else {
        onSnack(`已添加 ${selectedFileIndexes.length} 个文件到 qBittorrent 下载队列。`, "success");
      }
      setDownloadPicker(null);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      onSnack(`添加下载失败：${message}`, "danger");
      setDownloadPicker((current) => current ? { ...current, confirming: false, error: message } : current);
    }
  }, [downloadPicker, onSnack]);

  const toggleDownloadFile = useCallback((index: number) => {
    setDownloadPicker((current) => {
      if (!current) return current;
      const selected = new Set(current.selected);
      if (selected.has(index)) {
        selected.delete(index);
      } else {
        selected.add(index);
      }
      return { ...current, selected, error: null };
    });
  }, []);

  const selectAllDownloadFiles = useCallback((checked: boolean) => {
    setDownloadPicker((current) => current
      ? { ...current, selected: checked ? new Set(current.files.map((file) => file.index)) : new Set(), error: null }
      : current);
  }, []);

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

        <div className="resource-filter-row mt-3 flex flex-wrap items-center gap-3">
          <FilterField label="排序">
            <Dropdown
              size="sm"
              value={sort}
              onChange={(value) => setSort(value)}
              matchWidth={false}
              className="min-w-[104px]"
              options={[
                { value: "score", label: "推荐" },
                { value: "seeders", label: "做种数" },
                { value: "downloads", label: "下载量" },
                { value: "date", label: "发布时间" },
                { value: "size", label: "体积" },
              ]}
            />
          </FilterField>
          <FilterField label="清晰度">
            <Dropdown
              size="sm"
              value={resolution}
              onChange={(value) => setResolution(value)}
              matchWidth={false}
              className="min-w-[96px]"
              options={[
                { value: "all", label: "全部" },
                { value: "2160p", label: "2160p" },
                { value: "1440p", label: "1440p" },
                { value: "1080p", label: "1080p" },
                { value: "720p", label: "720p" },
              ]}
            />
          </FilterField>
          <FilterField label="类型">
            <Dropdown
              size="sm"
              value={batchFilter}
              onChange={(value) => setBatchFilter(value)}
              matchWidth={false}
              className="min-w-[88px]"
              options={[
                { value: "all", label: "全部" },
                { value: "batch", label: "合集" },
                { value: "single", label: "单集" },
              ]}
            />
          </FilterField>
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
              onDownload={() => void openDownloadPicker(resource)}
            />
          ))}
          {!loading && !error && visibleResources.length === 0 && (
            <div className="flex min-h-[280px] items-center justify-center text-[13px] font-medium text-[var(--color-text-tertiary)]">
              暂无资源结果
            </div>
          )}
        </div>
      </motion.div>
      {downloadPicker && (
        <DownloadFilePicker
          state={downloadPicker}
          onClose={() => void closeDownloadPicker()}
          onConfirm={() => void confirmDownloadPicker()}
          onToggleFile={toggleDownloadFile}
          onSelectAll={selectAllDownloadFiles}
        />
      )}
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

function DownloadFilePicker({
  state,
  onClose,
  onConfirm,
  onToggleFile,
  onSelectAll,
}: {
  state: DownloadPickerState;
  onClose: () => void;
  onConfirm: () => void;
  onToggleFile: (index: number) => void;
  onSelectAll: (checked: boolean) => void;
}) {
  const selectedCount = state.selected.size;
  const selectedSize = state.files
    .filter((file) => state.selected.has(file.index))
    .reduce((total, file) => total + file.size, 0);
  const allSelected = state.files.length > 0 && selectedCount === state.files.length;
  const busy = state.loading || state.confirming || state.closing;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-5 py-6 backdrop-blur-sm">
      <motion.div
        className="flex max-h-[86vh] w-full max-w-[760px] flex-col overflow-hidden rounded-[20px] bg-[var(--color-surface)] shadow-2xl ring-1 ring-black/10"
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={appleSpringSoft}
      >
        <div className="flex items-start justify-between gap-4 border-b border-black/10 px-5 py-4">
          <div className="min-w-0">
            <div className="text-[18px] font-bold text-[var(--color-text-primary)]">选择下载文件</div>
            <div className="mt-1 line-clamp-2 text-[12px] font-medium text-[var(--color-text-secondary)]">
              {state.resource.title}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/[0.055] text-[var(--color-text-secondary)] disabled:opacity-50"
          >
            {state.closing ? <Loader2 size={16} className="animate-spin" /> : <X size={17} />}
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-black/10 px-5 py-3">
          <label className="flex min-w-0 items-center gap-3 text-[12px] font-semibold text-[var(--color-text-primary)]">
            <input
              type="checkbox"
              checked={allSelected}
              disabled={busy || state.files.length === 0}
              onChange={(event) => onSelectAll(event.target.checked)}
              className="h-4 w-4 accent-[var(--color-primary)]"
            />
            全选
          </label>
          <div className="shrink-0 text-[12px] font-semibold text-[var(--color-text-tertiary)]">
            {selectedCount}/{state.files.length} · {formatBytes(selectedSize)}
          </div>
        </div>

        <div className="min-h-[260px] flex-1 overflow-y-auto px-3 py-2">
          {state.loading && (
            <div className="flex h-[260px] items-center justify-center gap-2 text-[13px] font-semibold text-[var(--color-text-secondary)]">
              <Loader2 size={17} className="animate-spin" />
              正在读取种子文件
            </div>
          )}
          {!state.loading && state.files.map((file) => (
            <button
              key={file.index}
              type="button"
              onClick={() => onToggleFile(file.index)}
              disabled={busy}
              className="grid w-full grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition-colors hover:bg-black/[0.045] disabled:opacity-60"
            >
              <span className={`flex h-5 w-5 items-center justify-center rounded border text-white ${state.selected.has(file.index) ? "border-[var(--color-primary)] bg-[var(--color-primary)]" : "border-black/20 bg-transparent"}`}>
                {state.selected.has(file.index) && <Check size={14} strokeWidth={2.4} />}
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <File size={15} className="shrink-0 text-[var(--color-text-tertiary)]" />
                <span className="min-w-0 truncate text-[13px] font-semibold text-[var(--color-text-primary)]">{file.name}</span>
              </span>
              <span className="text-[12px] font-semibold text-[var(--color-text-tertiary)]">{formatBytes(file.size)}</span>
            </button>
          ))}
          {!state.loading && !state.files.length && (
            <div className="flex h-[260px] items-center justify-center text-[13px] font-semibold text-[var(--color-text-tertiary)]">
              没有可选择的文件
            </div>
          )}
        </div>

        {state.error && (
          <div className="mx-5 mb-3 rounded-[12px] bg-rose-500/8 px-3 py-2 text-[12px] font-semibold text-rose-600">
            {state.error}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-black/10 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex h-10 items-center justify-center rounded-full bg-black/[0.055] px-4 text-[13px] font-semibold text-[var(--color-text-primary)] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || selectedCount === 0}
            className="flex h-10 items-center justify-center gap-2 rounded-full bg-[var(--color-primary)] px-5 text-[13px] font-semibold text-white disabled:opacity-55"
          >
            {state.confirming ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            开始下载
          </button>
        </div>
      </motion.div>
    </div>
  );
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

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
}

function normalizeOption(value: string) {
  return value.trim().toLowerCase();
}
