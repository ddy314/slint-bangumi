import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { NavRail, type Route } from "./NavRail";
import { LibraryPage } from "./pages/Library";
import { DetailPage } from "./pages/Detail";
import { PlayerPage } from "./pages/Player";
import { DiscoverPage } from "./pages/Discover";
import { DownloadsPage } from "./pages/Downloads";
import { ResourcesPage, type ResourceSearchPrefill } from "./pages/Resources";
import { ProfilePage } from "./pages/Profile";
import { SettingsPage } from "./pages/Settings";
import { useBackendSnapshot } from "./backend";
import { appleSpringSoft } from "./motion";
import { Snackbar, useSnackbar } from "./ui";
import type { PlaybackEpisode, Subject } from "./data";

type PlaybackState = {
  subject: Subject;
  episode: PlaybackEpisode;
};

type AppView =
  | { kind: "route"; route: Route }
  | { kind: "detail"; subject: Subject }
  | { kind: "playback"; playback: PlaybackState }
  | { kind: "resources"; prefill: ResourceSearchPrefill | null };

export default function App() {
  const [viewStack, setViewStack] = useState<AppView[]>([{ kind: "route", route: "home" }]);
  const [searchQuery, setSearchQuery] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">(() => readStoredTheme());
  const [navCollapsed, setNavCollapsed] = useState(() => readStoredBoolean("nexplay.navCollapsed", false));
  const snack = useSnackbar();
  const backend = useBackendSnapshot();
  const collectionSubjects = useMemo(() => {
    const localBgm = backend.subjects.filter((subject) => subject.bgmCollectionType);
    const seen = new Set<string>();
    const merged: Subject[] = [];
    for (const subject of [...localBgm, ...backend.bangumiCollections]) {
      const key = `${subject.provider}:${subject.providerSubjectId || subject.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(subject);
    }
    return merged;
  }, [backend.bangumiCollections, backend.subjects]);
  const currentView = viewStack[viewStack.length - 1] ?? { kind: "route", route: "home" as Route };
  const route = currentView.kind === "route"
    ? currentView.route
    : [...viewStack].reverse().find((view): view is { kind: "route"; route: Route } => view.kind === "route")?.route ?? "home";

  const openDetail = useCallback((s: Subject) => {
    setViewStack((current) => [...current, { kind: "detail", subject: s }]);
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, []);

  const handleRoute = useCallback((r: Route) => {
    setViewStack([{ kind: "route", route: r }]);
  }, []);

  const openResourceSearch = useCallback((subject: Subject) => {
    setViewStack((current) => [...current, { kind: "resources", prefill: { subject } }]);
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, []);

  const goBack = useCallback(() => {
    setViewStack((current) => current.length > 1 ? current.slice(0, -1) : current);
  }, []);

  const replaceTop = useCallback((view: AppView) => {
    setViewStack((current) => [...current.slice(0, -1), view]);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("nexplay.theme", theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("nexplay.navCollapsed", navCollapsed ? "true" : "false");
  }, [navCollapsed]);

  return (
    <MotionConfig reducedMotion="user">
      <div
        data-theme={theme}
        data-nav-collapsed={navCollapsed ? "true" : "false"}
        className="app-shell relative h-screen w-screen overflow-hidden bg-[var(--color-bg)] text-[var(--color-text-primary)]"
      >
        <NavRail
          route={route}
          onRoute={handleRoute}
          theme={theme}
          onToggleTheme={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
          collapsed={navCollapsed}
          onToggleCollapsed={() => setNavCollapsed((current) => !current)}
        />

        <main className="app-main absolute inset-0 z-10 min-w-0 overflow-hidden pl-[var(--nav-width)] transition-[padding] duration-200 ease-out">
          <AnimatePresence mode="wait">
            <motion.div
              key={
                currentView.kind === "playback"
                  ? `playback-${currentView.playback.subject.id}-${currentView.playback.episode.key}`
                  : currentView.kind === "detail"
                    ? `detail-${currentView.subject.id}`
                    : currentView.kind === "resources"
                      ? `resources-${currentView.prefill?.subject.id ?? "manual"}`
                      : `route-${currentView.route}`
              }
              className="h-full"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={appleSpringSoft}
            >
              {currentView.kind === "playback" ? (
                <PlayerPage
                  subject={currentView.playback.subject}
                  initialEpisode={currentView.playback.episode}
                  onBack={goBack}
                  onSnack={snack.show}
                />
              ) : currentView.kind === "detail" ? (
                <DetailPage
                  subject={currentView.subject}
                  onBack={goBack}
                  onPlay={(subject, episode) => setViewStack((current) => [...current, { kind: "playback", playback: { subject, episode } }])}
                  onFindResources={openResourceSearch}
                  onSubjectUpdated={async () => {
                    const next = await backend.refresh();
                    const candidates = [...next.subjects, ...next.bangumiCollections];
                    const updated = candidates.find((subject) => subject.providerSubjectId === currentView.subject.providerSubjectId);
                    if (updated) replaceTop({
                      kind: "detail",
                      subject: {
                        ...currentView.subject,
                        ...updated,
                        summary: updated.summary || currentView.subject.summary,
                        poster: updated.poster || currentView.subject.poster,
                        hero: updated.hero || currentView.subject.hero,
                        episodesDetail: updated.episodesDetail.length ? updated.episodesDetail : currentView.subject.episodesDetail,
                      },
                    });
                  }}
                  onSnack={snack.show}
                />
              ) : currentView.kind === "resources" ? (
                <ResourcesPage
                  prefill={currentView.prefill}
                  onBackToDetail={() => goBack()}
                  onSnack={snack.show}
                />
              ) : route === "settings" ? (
                <SettingsPage onSnack={snack.show} />
              ) : route === "downloads" ? (
                <DownloadsPage onSnack={snack.show} />
              ) : route === "home" ? (
                <DiscoverPage
                  auth={backend.bangumiAuth}
                  syncStatus={backend.bangumiSyncStatus}
                  localSubjects={backend.subjects}
                  collectionSubjects={collectionSubjects}
                  onOpen={openDetail}
                  onSnack={snack.show}
                  onNavigate={handleRoute}
                />
              ) : route === "profile" ? (
                <ProfilePage
                  auth={backend.bangumiAuth}
                  subjects={collectionSubjects.length ? collectionSubjects : backend.subjects}
                />
              ) : (
                <LibraryPage
                  route={route === "search" ? "search" : "library"}
                  subjects={backend.subjects}
                  cloudSubjects={collectionSubjects}
                  searchQuery={searchQuery}
                  onSearchQueryChange={setSearchQuery}
                  scanStatus={backend.scanStatus}
                  logs={backend.logs}
                  loading={backend.loading}
                  error={backend.error}
                  onOpen={openDetail}
                  onSnack={snack.show}
                  onScan={async () => {
                    try {
                      const result = await backend.scanLibrary();
                      if (!result) {
                        snack.show("当前不是 Electron 环境，无法调用 Rust 后端", "danger");
                        return;
                      }
                      snack.show(
                        `扫描完成：新增 ${result.summary.added}，修改 ${result.summary.modified}，刮削 ${result.scraped}，删除 ${result.summary.deleted}`,
                        "success"
                      );
                    } catch (caught) {
                      const message = caught instanceof Error ? caught.message : String(caught);
                      snack.show(`扫描失败：${message}`, "danger");
                    }
                  }}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        <Snackbar msg={snack.msg} onDismiss={snack.dismiss} />
      </div>
    </MotionConfig>
  );
}

function readStoredTheme(): "light" | "dark" {
  const value = window.localStorage.getItem("nexplay.theme");
  if (value === "dark" || value === "light") {
    return value;
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStoredBoolean(key: string, fallback: boolean) {
  const value = window.localStorage.getItem(key);
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}
