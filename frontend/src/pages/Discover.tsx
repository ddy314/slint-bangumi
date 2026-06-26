import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Compass,
  DownloadCloud,
  Flame,
  HardDrive,
  Library,
  Loader2,
  PlayCircle,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Star,
  Tags,
  TrendingUp,
  UserRound,
} from "lucide-react";
import {
  syncBangumiNow,
  type BangumiAuthStatus,
  type BangumiSyncStatus,
} from "../backend";
import type { Subject } from "../data";
import { fetchBangumiDiscovery, type DiscoveryFeed } from "../discover";
import { appleSpringBouncy, appleSpringSoft } from "../motion";
import { Button, Progress } from "../ui";
import { resolveAssetUrl } from "../utils/assets";
import { cn } from "../utils/cn";

type HomeRoute = "search" | "library" | "settings" | "profile";

const statusMeta: Record<number, { label: string; tone: string }> = {
  1: { label: "想看", tone: "text-sky-600" },
  2: { label: "看过", tone: "text-emerald-600" },
  3: { label: "在看", tone: "text-[var(--color-accent)]" },
  4: { label: "搁置", tone: "text-amber-600" },
  5: { label: "抛弃", tone: "text-rose-600" },
};

export function DiscoverPage({
  auth,
  syncStatus,
  localSubjects,
  collectionSubjects,
  onOpen,
  onSnack,
  onNavigate,
}: {
  auth: BangumiAuthStatus;
  syncStatus: BangumiSyncStatus;
  localSubjects: Subject[];
  collectionSubjects: Subject[];
  onOpen: (subject: Subject) => void;
  onSnack: (text: string, tone?: "neutral" | "success" | "danger") => void;
  onNavigate?: (route: HomeRoute) => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [discovery, setDiscovery] = useState<DiscoveryFeed | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchBangumiDiscovery()
      .then((feed) => {
        if (!cancelled) setDiscovery(feed);
      })
      .catch(() => {
        // Discovery is best-effort; the home page still works from local/BGM data.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const allSubjects = useMemo(
    () => mergeSubjects(collectionSubjects, localSubjects),
    [collectionSubjects, localSubjects]
  );
  const profile = useMemo(
    () => buildHomeProfile(collectionSubjects, allSubjects, discovery),
    [allSubjects, collectionSubjects, discovery]
  );
  const spotlight = profile.continuing[0]
    ?? profile.highlights[0]
    ?? profile.completed[0]
    ?? profile.watching[0]
    ?? profile.wish[0]
    ?? profile.localPlayable[0]
    ?? profile.popular[0]
    ?? discovery?.today[0]
    ?? discovery?.trending[0];
  const shelves = useMemo(() => buildShelves(profile, auth.authenticated), [auth.authenticated, profile]);
  const isSyncing = syncStatus.running || syncing;

  const runSync = async () => {
    if (!auth.authenticated) {
      onSnack("请先在设置页登录 Bangumi", "danger");
      return;
    }
    setSyncing(true);
    try {
      const summary = await syncBangumiNow();
      onSnack(summary.message || "Bangumi 同步完成", "success");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      onSnack(`Bangumi 同步失败：${message}`, "danger");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-[linear-gradient(180deg,rgba(0,122,255,0.045)_0%,transparent_220px),var(--color-bg)]">
      <motion.div
        className="page-shell max-w-[1560px] pb-12"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={appleSpringSoft}
      >
        <header className="page-header">
          <div>
            <h1 className="text-[40px] font-bold leading-[1] tracking-tight text-[var(--color-text-primary)]">主页</h1>
            <p className="mt-2 text-[15px] font-medium text-[var(--color-text-secondary)]">
              账号状态、观看历史、本地资源和推荐内容的综合中心
            </p>
          </div>
          <Button
            variant="tonal"
            icon={<RefreshCw size={16} className={isSyncing ? "animate-spin" : ""} />}
            loading={isSyncing}
            disabled={!auth.authenticated}
            onClick={() => void runSync()}
          >
            {isSyncing ? "同步中" : "同步 BGM"}
          </Button>
        </header>

        <div className="mt-7 grid items-start gap-5 xl:grid-cols-[minmax(0,1.52fr)_minmax(340px,0.78fr)]">
          <div className="min-w-0">
            {spotlight ? (
              <Spotlight subject={spotlight} profile={profile} onOpen={() => onOpen(spotlight)} />
            ) : (
              <StarterHero auth={auth} syncing={isSyncing} onNavigate={onNavigate} />
            )}
            <InsightStrip profile={profile} auth={auth} />
            <BrowseTiles profile={profile} onOpen={onOpen} onNavigate={onNavigate} />
          </div>
          <StatusColumn
            auth={auth}
            status={syncStatus}
            syncing={isSyncing}
            profile={profile}
            onNavigate={onNavigate}
          />
        </div>

        {profile.tags.length > 0 && (
          <TagRiver tags={profile.tags} />
        )}

        {shelves.length > 0 ? (
          <div className="mt-9 grid gap-9">
            {shelves.map((shelf) => (
              <Shelf
                key={shelf.id}
                title={shelf.title}
                subtitle={shelf.subtitle}
                icon={shelf.icon}
                subjects={shelf.subjects}
                onOpen={onOpen}
                layout={shelf.layout}
              />
            ))}
          </div>
        ) : (
          <StarterActions
            authenticated={auth.authenticated}
            hasLocal={localSubjects.length > 0}
            onNavigate={onNavigate}
          />
        )}
      </motion.div>
    </div>
  );
}

function Spotlight({
  subject,
  profile,
  onOpen,
}: {
  subject: Subject;
  profile: HomeProfile;
  onOpen: () => void;
}) {
  const image = resolveAssetUrl(subject.hero || subject.poster);
  const poster = resolveAssetUrl(subject.poster || subject.hero);
  const title = subject.titleCn || subject.title;
  const status = statusLabel(subject);
  const sourceCount = profile.totalCollections || profile.totalSubjects;
  const summary = subject.summary || subject.fileSummary || (sourceCount > 0 ? `来自 ${sourceCount} 个条目的主页推荐` : "Bangumi 推荐条目");
  return (
    <motion.button
      type="button"
      className="home-feature-panel group relative min-h-[330px] self-start overflow-hidden rounded-[26px] text-left"
      onClick={onOpen}
      whileHover={{ scale: 1.002 }}
      whileTap={{ scale: 0.99 }}
      transition={appleSpringBouncy}
    >
      {image ? (
        <img
          src={image}
          alt={title}
          className="absolute inset-0 size-full scale-110 object-cover opacity-[0.18] blur-2xl saturate-[1.25] transition-transform duration-700 group-hover:scale-[1.15]"
        />
      ) : (
        <div className="absolute inset-0 bg-[var(--color-surface-elevated)]" />
      )}
      <div className="absolute inset-0 bg-white/58 backdrop-blur-[26px] backdrop-saturate-[165%] dark:bg-black/30" />
      <div className="relative grid min-h-[330px] md:grid-cols-[250px_minmax(0,1fr)]">
        <div className="flex items-center justify-center p-7">
          <div className="relative aspect-[3/4] w-[172px] overflow-hidden rounded-[18px] bg-black/5 shadow-[0_22px_48px_rgba(0,0,0,0.18)] ring-1 ring-inset ring-black/5">
            {poster ? (
              <img
                src={poster}
                alt={title}
                className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.025]"
              />
            ) : (
              <div className="grid size-full place-items-center text-[44px] font-bold text-[var(--color-text-tertiary)]">
                {title.slice(0, 1) || "N"}
              </div>
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-col justify-center px-7 pb-8 pt-0 md:px-7 md:py-8">
          <div className="mb-4 text-[12px] font-bold uppercase tracking-[0.16em] text-[var(--color-accent)]">
            {subject.progress > 0 && subject.progress < 1 ? "继续观看" : "精选条目"}
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Pill tone="light" icon={<Activity size={12} />}>{status}</Pill>
            {scoreLabel(subject) && <Pill tone="light" icon={<Star size={12} />}>{scoreLabel(subject)}</Pill>}
            {subject.files > 0 && <Pill tone="light" icon={<HardDrive size={12} />}>本地可播</Pill>}
          </div>
          <motion.h2
            className="line-clamp-3 max-w-[720px] text-[32px] font-bold leading-[1.08] tracking-tight text-[var(--color-text-primary)] md:text-[38px]"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={appleSpringSoft}
          >
            {title}
          </motion.h2>
          {subject.titleCn && subject.titleCn !== subject.title && (
            <div className="mt-2 truncate text-[15px] font-semibold text-[var(--color-text-tertiary)]">
              {subject.title}
            </div>
          )}
          <p className="mt-4 line-clamp-2 max-w-[720px] text-[14px] font-medium leading-relaxed text-[var(--color-text-secondary)]">
            {summary}
          </p>
          {subject.progress > 0 && (
            <div className="mt-6 max-w-[420px]">
              <div className="mb-2 flex justify-between text-[12px] font-semibold text-[var(--color-text-tertiary)]">
                <span>观看进度</span>
                <span>{Math.round(subject.progress * 100)}%</span>
              </div>
              <Progress value={subject.progress} className="h-1.5 bg-black/10 dark:bg-white/10" tone="success" />
            </div>
          )}
        </div>
      </div>
    </motion.button>
  );
}

function StarterHero({
  auth,
  syncing,
  onNavigate,
}: {
  auth: BangumiAuthStatus;
  syncing: boolean;
  onNavigate?: (route: HomeRoute) => void;
}) {
  return (
    <section className="home-panel grid min-h-[330px] self-start rounded-[26px] p-7 md:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col justify-end">
        <div className="mb-5 flex size-12 items-center justify-center rounded-[8px] bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
          {syncing ? <Loader2 size={22} className="animate-spin" /> : <Compass size={22} />}
        </div>
        <h2 className="max-w-xl text-[34px] font-bold leading-[1.08] tracking-tight text-[var(--color-text-primary)]">
          {auth.authenticated ? "正在等待 Bangumi 条目数据" : "连接账号或导入本地媒体后，主页会自动成型"}
        </h2>
        <p className="mt-3 max-w-xl text-[14px] font-medium leading-relaxed text-[var(--color-text-secondary)]">
          主页会根据看过、评分、标签、本地可播放资源和同步状态生成内容；没有 BGM 数据时也会显示本地媒体与开始入口。
        </p>
        <div className="mt-7 flex flex-wrap gap-2">
          <ActionButton icon={<Settings size={15} />} onClick={() => onNavigate?.("settings")}>账号设置</ActionButton>
          <ActionButton icon={<Search size={15} />} onClick={() => onNavigate?.("search")}>搜索条目</ActionButton>
          <ActionButton icon={<Library size={15} />} onClick={() => onNavigate?.("library")}>媒体库</ActionButton>
        </div>
      </div>
      <div className="grid content-end gap-3">
        <StarterStep icon={<Settings size={17} />} title="连接 Bangumi" desc="同步状态、评分和单集数据" active={auth.authenticated} />
        <StarterStep icon={<Search size={17} />} title="搜索条目" desc="打开详情后可查资源和更新状态" />
        <StarterStep icon={<HardDrive size={17} />} title="扫描本地媒体" desc="本地资源作为可播放状态显示" />
      </div>
    </section>
  );
}

function StatusColumn({
  auth,
  status,
  syncing,
  profile,
  onNavigate,
}: {
  auth: BangumiAuthStatus;
  status: BangumiSyncStatus;
  syncing: boolean;
  profile: HomeProfile;
  onNavigate?: (route: HomeRoute) => void;
}) {
  const error = status.lastError ?? auth.lastError;
  const accountName = auth.nickname || auth.username;
  const progress = status.total > 0 ? status.processed / status.total : syncing ? 0.2 : 1;
  return (
    <aside className="grid gap-3">
      <section className={cn(
        "home-panel rounded-[24px] p-5",
        error && "ring-rose-500/20"
      )}>
        <div className="flex items-center gap-3">
          <div className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-[8px]",
            error ? "bg-rose-500/10 text-rose-500" : "bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
          )}>
            {syncing ? <Loader2 size={18} className="animate-spin" /> : error ? <AlertCircle size={18} /> : <UserRound size={18} />}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-bold text-[var(--color-text-primary)]">
              {error
                ? "Bangumi 同步需要处理"
                : auth.authenticated
                  ? `已连接 ${accountName ? `@${accountName}` : "Bangumi"}`
                  : "Bangumi 未连接"}
            </div>
            <div className="mt-1 truncate text-[12px] font-medium text-[var(--color-text-tertiary)]">
              {syncing ? status.message || "正在同步云端条目" : error || (auth.authenticated ? "云端状态以账号为准" : "设置页可配置 OAuth")}
            </div>
          </div>
        </div>
        {syncing && (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-[11px] font-semibold text-[var(--color-text-tertiary)]">
              <span>同步进度</span>
              <span>{status.total > 0 ? `${status.processed}/${status.total}` : "连接中"}</span>
            </div>
            <Progress value={progress} />
          </div>
        )}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <MiniMetric label="云端" value={profile.totalCollections} />
          <MiniMetric label="待同步" value={auth.pendingSyncCount} warn={auth.pendingSyncCount > 0} />
          <MiniMetric label="本地" value={profile.localPlayable.length} />
        </div>
      </section>

      <section className="home-panel rounded-[24px] p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-[var(--color-text-primary)]">状态概览</h2>
          <button
            type="button"
            className="flex items-center gap-1 text-[12px] font-semibold text-[var(--color-accent)]"
            onClick={() => onNavigate?.("profile")}
          >
            个人页 <ArrowRight size={13} />
          </button>
        </div>
        <StatusBars counts={profile.statusCounts} total={Math.max(1, profile.totalCollections)} />
      </section>

      <section className="home-panel rounded-[24px] p-5">
        <div className="mb-4 flex items-center gap-2">
          <Sparkles size={16} className="text-[var(--color-accent)]" />
          <h2 className="text-[15px] font-bold text-[var(--color-text-primary)]">快速入口</h2>
        </div>
        <div className="grid gap-2">
          <QuickLink icon={<Search size={15} />} label="搜索 Bangumi 条目" onClick={() => onNavigate?.("search")} />
          <QuickLink icon={<Library size={15} />} label="查看云端条目" onClick={() => onNavigate?.("library")} />
          <QuickLink icon={<Library size={15} />} label="查看本地媒体库" onClick={() => onNavigate?.("library")} />
        </div>
      </section>
    </aside>
  );
}

function InsightStrip({
  profile,
  auth,
}: {
  profile: HomeProfile;
  auth: BangumiAuthStatus;
}) {
  const primaryStatus = profile.primaryStatus;
  if (profile.totalSubjects === 0 && profile.totalCollections === 0) {
    return (
      <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Insight label="数据状态" value="等待" />
        <Insight label="账号连接" value={auth.authenticated ? "已登录" : "未登录"} />
        <Insight label="同步队列" value={auth.pendingSyncCount ? `${auth.pendingSyncCount} 个` : "空"} warn={auth.pendingSyncCount > 0} />
        <Insight label="内容来源" value="BGM/本地" />
        <Insight label="下一步" value="导入" />
      </section>
    );
  }
  return (
    <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Insight label="云端条目" value={profile.totalCollections || profile.totalSubjects} />
      <Insight label={primaryStatus ? `最多：${primaryStatus.label}` : "主要状态"} value={primaryStatus?.count ?? 0} />
      <Insight label="看过作品" value={profile.completed.length} />
      <Insight label="平均评分" value={profile.averageRate ? profile.averageRate.toFixed(1) : "--"} />
      <Insight label="待同步" value={auth.pendingSyncCount} warn={auth.pendingSyncCount > 0} />
    </section>
  );
}

function Insight({
  label,
  value,
  warn,
}: {
  label: string;
  value: ReactNode;
  warn?: boolean;
}) {
  return (
    <div className={cn(
      "home-panel rounded-[16px] px-4 py-3",
      warn && "bg-amber-500/8 ring-amber-500/15"
    )}>
      <div className="text-[24px] font-bold leading-none tracking-tight text-[var(--color-text-primary)]">{value}</div>
      <div className="mt-1.5 text-[11px] font-semibold text-[var(--color-text-tertiary)]">{label}</div>
    </div>
  );
}

function BrowseTiles({
  profile,
  onOpen,
  onNavigate,
}: {
  profile: HomeProfile;
  onOpen: (subject: Subject) => void;
  onNavigate?: (route: HomeRoute) => void;
}) {
  const tiles = [
    {
      id: "continue",
      title: "继续观看",
      count: profile.continuing.length,
      subject: profile.continuing[0],
      icon: <PlayCircle size={19} />,
    },
    {
      id: "completed",
      title: "看过档案",
      count: profile.completed.length,
      subject: profile.completed[0],
      icon: <CheckCircle2 size={19} />,
    },
    {
      id: "recommend",
      title: "为你推荐",
      count: profile.recommendations.length || profile.trending.length,
      subject: profile.recommendations[0] ?? profile.trending[0],
      icon: <Sparkles size={19} />,
    },
    {
      id: "local",
      title: "本地可播",
      count: profile.localPlayable.length,
      subject: profile.localPlayable[0],
      icon: <HardDrive size={19} />,
      route: "library" as HomeRoute,
    },
  ].filter((tile) => tile.count > 0 || tile.route);

  if (!tiles.length) return null;

  return (
    <section className="mt-8">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[24px] font-bold leading-none tracking-tight text-[var(--color-text-primary)]">类别浏览</h2>
          <p className="mt-2 text-[13px] font-medium text-[var(--color-text-tertiary)]">按观看状态和资源来源进入内容</p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile, index) => (
          <BrowseTile
            key={tile.id}
            title={tile.title}
            count={tile.count}
            icon={tile.icon}
            subject={tile.subject}
            index={index}
            onClick={() => {
              if (tile.subject) {
                onOpen(tile.subject);
                return;
              }
              if (tile.route) onNavigate?.(tile.route);
            }}
          />
        ))}
      </div>
    </section>
  );
}

function BrowseTile({
  title,
  count,
  icon,
  subject,
  index,
  onClick,
}: {
  title: string;
  count: number;
  icon: ReactNode;
  subject?: Subject;
  index: number;
  onClick: () => void;
}) {
  const image = resolveAssetUrl(subject?.hero || subject?.poster);
  return (
    <motion.button
      type="button"
      className="home-browse-tile group relative min-h-[138px] overflow-hidden rounded-[22px] p-5 text-left"
      onClick={onClick}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...appleSpringSoft, delay: index * 0.025 }}
      whileHover={{ y: -2 }}
    >
      {image && (
        <img
          src={image}
          alt={subject?.titleCn || subject?.title || title}
          loading="lazy"
          className="absolute inset-0 size-full object-cover opacity-78 transition-transform duration-500 group-hover:scale-[1.035]"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/34 to-black/10" />
      <div className="relative flex h-full min-h-[98px] flex-col justify-between">
        <div className="flex size-9 items-center justify-center rounded-full bg-white/20 text-white ring-1 ring-inset ring-white/20 backdrop-blur">
          {icon}
        </div>
        <div>
          <div className="text-[22px] font-bold leading-tight tracking-tight text-white">{title}</div>
          <div className="mt-1 text-[12px] font-semibold text-white/70">{count > 0 ? `${count} 个条目` : "打开媒体库"}</div>
        </div>
      </div>
    </motion.button>
  );
}

function TagRiver({ tags }: { tags: Array<[string, number]> }) {
  return (
    <section className="mt-8 flex flex-wrap items-center gap-2">
      <div className="mr-1 flex items-center gap-2 text-[13px] font-bold text-[var(--color-text-primary)]">
        <Tags size={15} className="text-[var(--color-accent)]" />
        标签偏好
      </div>
      {tags.slice(0, 14).map(([tag, weight], index) => (
        <span
          key={tag}
          className="home-chip rounded-full px-3 py-1.5 font-semibold text-[var(--color-text-secondary)]"
          style={{ fontSize: `${Math.min(15, 11 + Math.log2(weight + 1) + index * 0.02)}px` }}
        >
          {tag}
        </span>
      ))}
    </section>
  );
}

function Shelf({
  title,
  subtitle,
  icon,
  subjects,
  onOpen,
  layout = "poster",
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  subjects: Subject[];
  onOpen: (subject: Subject) => void;
  layout?: "poster" | "wide";
}) {
  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[var(--color-text-primary)]">
            <span className="home-chip flex size-7 items-center justify-center rounded-[10px] text-[var(--color-accent)]">
              {icon}
            </span>
            <h2 className="text-[24px] font-bold leading-none tracking-tight">{title}</h2>
          </div>
          <p className="mt-2 text-[13px] font-medium text-[var(--color-text-tertiary)]">{subtitle}</p>
        </div>
      </div>
      <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {subjects.map((subject, index) => (
          <SubjectTile
            key={`${subject.provider}-${subject.providerSubjectId}-${subject.id}-${title}`}
            subject={subject}
            index={index}
            onOpen={() => onOpen(subject)}
            layout={layout}
          />
        ))}
      </div>
    </section>
  );
}

function SubjectTile({
  subject,
  index,
  onOpen,
  layout,
}: {
  subject: Subject;
  index: number;
  onOpen: () => void;
  layout: "poster" | "wide";
}) {
  const image = resolveAssetUrl(subject.poster || subject.hero);
  const title = subject.titleCn || subject.title;
  return (
    <motion.button
      type="button"
      className={cn("group shrink-0 text-left", layout === "wide" ? "w-[260px]" : "w-[164px]")}
      onClick={onOpen}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...appleSpringSoft, delay: Math.min(index, 10) * 0.018 }}
      whileHover={{ y: -2 }}
    >
      <div className={cn(
        "relative overflow-hidden rounded-[14px] bg-[var(--color-surface-elevated)] shadow-[0_8px_22px_rgba(0,0,0,0.08)] ring-1 ring-inset ring-black/[0.05]",
        layout === "wide" ? "aspect-[16/9]" : "aspect-[3/4]"
      )}>
        {image ? (
          <img
            src={image}
            alt={title}
            loading={index < 6 ? "eager" : "lazy"}
            className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.035]"
          />
        ) : (
          <div className="flex size-full items-center justify-center px-4 text-center text-[22px] font-bold text-[var(--color-text-tertiary)]">
            {title.slice(0, 1) || "N"}
          </div>
        )}
        {subject.progress > 0 && (
          <div className="absolute inset-x-2 bottom-2">
            <Progress value={subject.progress} className="h-1 bg-black/25" tone="success" />
          </div>
        )}
      </div>
      <div className="mt-2 min-w-0">
        <div className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">{title}</div>
        <div className="mt-1 flex items-center gap-2 truncate text-[11px] font-medium text-[var(--color-text-tertiary)]">
          <span className="truncate">{statusLabel(subject)}</span>
          {subject.files > 0 && <HardDrive size={11} className="shrink-0" />}
          {subject.bgmRate > 0 && <span>{subject.bgmRate}/10</span>}
        </div>
      </div>
    </motion.button>
  );
}

function StarterActions({
  authenticated,
  hasLocal,
  onNavigate,
}: {
  authenticated: boolean;
  hasLocal: boolean;
  onNavigate?: (route: HomeRoute) => void;
}) {
  const actions = [
    {
      icon: authenticated ? <RefreshCw size={18} /> : <Settings size={18} />,
      title: authenticated ? "重新同步 Bangumi" : "配置 Bangumi",
      desc: authenticated ? "拉取状态、评分和单集数据" : "登录后主页会按你的云端条目重排",
      route: "settings" as HomeRoute,
    },
    {
      icon: <Search size={18} />,
      title: "搜索条目",
      desc: "从搜索页打开条目、查资源或更新状态",
      route: "search" as HomeRoute,
    },
    {
      icon: <Library size={18} />,
      title: hasLocal ? "查看本地媒体" : "扫描媒体库",
      desc: hasLocal ? "本地文件会作为可播放性显示" : "没有账号数据时本地媒体也能撑起主页",
      route: "library" as HomeRoute,
    },
  ];
  return (
    <section className="mt-9 grid gap-3 md:grid-cols-3">
      {actions.map((action) => (
        <button
          key={action.title}
          type="button"
          className="home-panel rounded-[22px] p-5 text-left transition-colors hover:bg-white/78 dark:hover:bg-white/10"
          onClick={() => onNavigate?.(action.route)}
        >
          <div className="mb-4 flex size-10 items-center justify-center rounded-[8px] bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
            {action.icon}
          </div>
          <div className="text-[15px] font-bold text-[var(--color-text-primary)]">{action.title}</div>
          <div className="mt-1 text-[12px] font-medium leading-relaxed text-[var(--color-text-tertiary)]">{action.desc}</div>
        </button>
      ))}
    </section>
  );
}

function MiniMetric({
  label,
  value,
  warn,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div className={cn("rounded-[8px] bg-black/[0.035] px-3 py-2", warn && "bg-amber-500/10")}>
      <div className="text-[18px] font-bold leading-none text-[var(--color-text-primary)]">{value}</div>
      <div className="mt-1 text-[10.5px] font-semibold text-[var(--color-text-tertiary)]">{label}</div>
    </div>
  );
}

function StatusBars({
  counts,
  total,
}: {
  counts: Array<{ type: number; label: string; count: number }>;
  total: number;
}) {
  if (!counts.some((item) => item.count > 0)) {
    return (
      <div className="rounded-[8px] bg-black/[0.025] px-4 py-5 text-[12px] font-medium leading-relaxed text-[var(--color-text-tertiary)]">
        还没有可统计的 BGM 状态。同步账号或扫描本地媒体后，这里会切换成状态占比。
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      {counts.map((item) => (
        <div key={item.type}>
          <div className="mb-1 flex justify-between text-[12px] font-medium text-[var(--color-text-secondary)]">
            <span>{item.label}</span>
            <span>{item.count}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-black/[0.055]">
            <motion.div
              className="h-full rounded-full bg-[var(--color-accent)]"
              initial={{ width: 0 }}
              animate={{ width: `${(item.count / total) * 100}%` }}
              transition={appleSpringSoft}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function StarterStep({
  icon,
  title,
  desc,
  active,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  active?: boolean;
}) {
  return (
    <div className="rounded-[8px] bg-black/[0.035] p-4">
      <div className="flex items-center gap-3">
        <div className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-[8px]",
          active ? "bg-emerald-500/10 text-emerald-600" : "bg-white/70 text-[var(--color-accent)]"
        )}>
          {active ? <CheckCircle2 size={17} /> : icon}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-bold text-[var(--color-text-primary)]">{title}</div>
          <div className="mt-0.5 truncate text-[11px] font-medium text-[var(--color-text-tertiary)]">{desc}</div>
        </div>
      </div>
    </div>
  );
}

function QuickLink({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex h-10 items-center justify-between rounded-[8px] px-3 text-[12.5px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-black/[0.035] hover:text-[var(--color-text-primary)]"
      onClick={onClick}
    >
      <span className="flex items-center gap-2">{icon}{label}</span>
      <ArrowRight size={13} />
    </button>
  );
}

function ActionButton({
  icon,
  children,
  onClick,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex h-9 items-center gap-2 rounded-full bg-black/[0.045] px-3 text-[12px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
}

function Pill({
  icon,
  children,
  tone = "dark",
}: {
  icon?: ReactNode;
  children: ReactNode;
  tone?: "dark" | "light";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold backdrop-blur",
        tone === "light"
          ? "bg-white/72 text-[var(--color-text-primary)] ring-1 ring-inset ring-white/70 dark:bg-white/12 dark:text-white dark:ring-white/14"
          : "bg-white/16 text-white ring-1 ring-inset ring-white/16"
      )}
    >
      {icon}
      {children}
    </span>
  );
}

type HomeProfile = ReturnType<typeof buildHomeProfile>;

function buildHomeProfile(collectionSubjects: Subject[], allSubjects: Subject[], discovery?: DiscoveryFeed | null) {
  const statusCounts = [3, 1, 2, 4, 5].map((type) => ({
    type,
    label: statusMeta[type].label,
    count: collectionSubjects.filter((subject) => subject.bgmCollectionType === type).length,
  }));
  const rated = collectionSubjects.filter((subject) => subject.bgmRate > 0);
  const continuing = allSubjects
    .filter((subject) => subject.progress > 0 && subject.progress < 1)
    .sort(progressSorter)
    .slice(0, 16);
  const watching = collectionSubjects
    .filter((subject) => subject.bgmCollectionType === 3)
    .sort(progressSorter)
    .slice(0, 16);
  const wish = collectionSubjects
    .filter((subject) => subject.bgmCollectionType === 1)
    .sort(prioritySorter)
    .slice(0, 16);
  const completed = collectionSubjects
    .filter((subject) => subject.bgmCollectionType === 2 || subject.progress >= 1)
    .sort(prioritySorter)
    .slice(0, 16);
  const localPlayable = allSubjects
    .filter((subject) => subject.local || subject.files > 0)
    .sort(prioritySorter)
    .slice(0, 16);
  const highlights = (rated.length ? rated : collectionSubjects)
    .filter((subject) => subject.bgmCollectionType !== 5)
    .sort(prioritySorter)
    .slice(0, 16);
  const popular = allSubjects
    .filter((subject) => subject.rating > 0 || subject.rank > 0)
    .sort(popularSorter)
    .slice(0, 16);
  const tags = buildTags(collectionSubjects.length ? collectionSubjects : allSubjects);

  // The recommendation candidate pool blends the user's own subjects with the public
  // Bangumi discovery feed, so recommendations are never limited to local anime.
  const ownedKeys = new Set(allSubjects.map(subjectKey));
  const today = (discovery?.today ?? []).filter((subject) => !ownedKeys.has(subjectKey(subject))).slice(0, 16);
  const trending = (discovery?.trending ?? []).filter((subject) => !ownedKeys.has(subjectKey(subject))).slice(0, 16);
  const recommendationPool = mergeSubjects(allSubjects, discovery?.trending ?? []);
  const collectionKeys = new Set(collectionSubjects.map(subjectKey));
  const recommendations = recommendSubjects(recommendationPool, tags, collectionKeys)
    .filter((subject) => subject.bgmCollectionType !== 5)
    .slice(0, 16);
  const primaryStatus = [...statusCounts].sort((left, right) => right.count - left.count)[0];
  return {
    totalSubjects: allSubjects.length,
    totalCollections: collectionSubjects.length,
    statusCounts,
    primaryStatus: primaryStatus?.count ? primaryStatus : null,
    averageRate: rated.length ? rated.reduce((sum, subject) => sum + subject.bgmRate, 0) / rated.length : 0,
    continuing,
    watching,
    wish,
    completed,
    localPlayable,
    highlights,
    popular,
    recommendations,
    today,
    trending,
    tags,
  };
}

function buildShelves(profile: HomeProfile, authenticated: boolean) {
  const shelves: Array<{
    id: string;
    title: string;
    subtitle: string;
    icon: ReactNode;
    subjects: Subject[];
    layout?: "poster" | "wide";
  }> = [];
  if (profile.continuing.length) {
    shelves.push({
      id: "continue",
      title: "继续观看",
      subtitle: `${profile.continuing.length} 部有进度`,
      icon: <PlayCircle size={18} />,
      subjects: profile.continuing,
      layout: "wide",
    });
  }
  if (profile.today.length) {
    shelves.push({
      id: "today",
      title: "今日放送",
      subtitle: "Bangumi 每日放送 · 今天更新",
      icon: <CalendarDays size={18} />,
      subjects: profile.today,
    });
  }
  if (profile.completed.length) {
    shelves.push({
      id: "completed",
      title: profile.continuing.length ? "看过回顾" : "你的看过档案",
      subtitle: "只标看过也会成为主页核心内容",
      icon: <CheckCircle2 size={18} />,
      subjects: profile.completed,
    });
  }
  if (profile.highlights.length && hasDistinctSubjects(profile.highlights, profile.completed)) {
    shelves.push({
      id: "highlights",
      title: "高分与重点条目",
      subtitle: profile.averageRate ? `平均评分 ${profile.averageRate.toFixed(1)}` : "按云端状态优先级整理",
      icon: <Star size={18} />,
      subjects: profile.highlights,
    });
  }
  if (profile.watching.length) {
    shelves.push({
      id: "watching",
      title: "Bangumi 在看",
      subtitle: `${profile.watching.length} 部正在追`,
      icon: <Activity size={18} />,
      subjects: profile.watching,
      layout: "wide",
    });
  }
  if (profile.wish.length) {
    shelves.push({
      id: "wish",
      title: "想看队列",
      subtitle: "下一批可以安排的条目",
      icon: <Clock3 size={18} />,
      subjects: profile.wish,
    });
  }
  if (profile.recommendations.length) {
    shelves.push({
      id: "recommendations",
      title: authenticated ? "为你推荐" : "可能感兴趣",
      subtitle: profile.tags.length ? "结合你的标签偏好与当季热度" : "结合公开评分、排名与当季热度",
      icon: <Sparkles size={18} />,
      subjects: profile.recommendations,
    });
  }
  if (profile.trending.length) {
    shelves.push({
      id: "trending",
      title: "热门新番",
      subtitle: "Bangumi 当季热度排行",
      icon: <Flame size={18} />,
      subjects: profile.trending,
    });
  }
  if (profile.localPlayable.length) {
    shelves.push({
      id: "local",
      title: "本地可播放",
      subtitle: "本地文件只表示可播放性，不覆盖 BGM 状态",
      icon: <DownloadCloud size={18} />,
      subjects: profile.localPlayable,
      layout: "wide",
    });
  }
  if (profile.popular.length) {
    shelves.push({
      id: "popular",
      title: "热门与高分",
      subtitle: "按公开评分与排名整理",
      icon: <TrendingUp size={18} />,
      subjects: profile.popular,
    });
  }
  return dedupeShelves(shelves).slice(0, 8);
}

function hasDistinctSubjects(subjects: Subject[], baseline: Subject[]) {
  if (!baseline.length) return true;
  const baselineKeys = new Set(baseline.map(subjectKey));
  return subjects.some((subject) => !baselineKeys.has(subjectKey(subject)));
}

function dedupeShelves<T extends { subjects: Subject[] }>(shelves: T[]) {
  return shelves
    .map((shelf) => {
      const seen = new Set<string>();
      return {
        ...shelf,
        subjects: shelf.subjects.filter((subject) => {
          const key = subjectKey(subject);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      };
    })
    .filter((shelf) => shelf.subjects.length > 0);
}

function buildTags(subjects: Subject[]) {
  const weights = new Map<string, number>();
  for (const subject of subjects) {
    const weight = Math.max(1, subject.bgmRate || Math.round(subject.rating) || 1);
    for (const tag of subject.tags.slice(0, 6)) {
      weights.set(tag, (weights.get(tag) ?? 0) + weight);
    }
  }
  return [...weights.entries()].sort((a, b) => b[1] - a[1]);
}

function recommendSubjects(pool: Subject[], tags: Array<[string, number]>, collectionKeys: Set<string>) {
  const tagScore = new Map(tags);
  return [...pool].sort((left, right) => (
    recommendationScore(right, tagScore, collectionKeys) - recommendationScore(left, tagScore, collectionKeys)
  ));
}

function recommendationScore(subject: Subject, tagScore: Map<string, number>, collectionKeys: Set<string>) {
  const key = subjectKey(subject);
  const tagValue = subject.tags.reduce((sum, tag) => sum + (tagScore.get(tag) ?? 0), 0);
  const publicScore = subject.rating > 0 ? subject.rating : 0;
  const userScore = subject.bgmRate > 0 ? subject.bgmRate * 2 : 0;
  const rankScore = subject.rank > 0 ? Math.max(0, 10 - Math.log10(subject.rank + 1)) : 0;
  // Recommendations should surface fresh titles: things already in the user's
  // collection are pushed down so discovery results can rise to the top.
  const collectedPenalty = collectionKeys.has(key) ? 1000 : 0;
  return tagValue + publicScore + userScore + rankScore - collectedPenalty;
}

function mergeSubjects(primary: Subject[], secondary: Subject[]) {
  const seen = new Set<string>();
  const result: Subject[] = [];
  for (const subject of [...primary, ...secondary]) {
    const key = subjectKey(subject);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(subject);
  }
  return result;
}

function subjectKey(subject: Subject) {
  return `${subject.provider}:${subject.providerSubjectId || subject.id}`;
}

function progressSorter(left: Subject, right: Subject) {
  return (right.progress - left.progress) || prioritySorter(left, right);
}

function prioritySorter(left: Subject, right: Subject) {
  return (right.bgmRate - left.bgmRate)
    || (right.rating - left.rating)
    || ((left.rank || Number.MAX_SAFE_INTEGER) - (right.rank || Number.MAX_SAFE_INTEGER))
    || left.title.localeCompare(right.title);
}

function popularSorter(left: Subject, right: Subject) {
  const leftRank = left.rank > 0 ? left.rank : Number.MAX_SAFE_INTEGER;
  const rightRank = right.rank > 0 ? right.rank : Number.MAX_SAFE_INTEGER;
  return (right.rating - left.rating) || (leftRank - rightRank) || left.title.localeCompare(right.title);
}

function scoreLabel(subject: Subject) {
  if (subject.bgmRate > 0) return `我的评分 ${subject.bgmRate}/10`;
  if (subject.rating > 0) return `评分 ${subject.rating.toFixed(1)}`;
  return "";
}

function statusLabel(subject: Subject) {
  if (subject.bgmCollectionType) return statusMeta[subject.bgmCollectionType]?.label ?? "BGM 状态";
  if (subject.local || subject.files > 0) return "本地媒体";
  return "Bangumi";
}
