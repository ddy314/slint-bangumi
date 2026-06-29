import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
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
import { BootSplash, Snackbar, useSnackbar } from "./ui";
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

  // Boot splash: shown until the first backend snapshot resolves, with a small
  // minimum duration so it never flashes, then fades out.
  const [bootDone, setBootDone] = useState(false);
  const [bootLeaving, setBootLeaving] = useState(false);
  const [minElapsed, setMinElapsed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMinElapsed(true), 650);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (bootDone || bootLeaving) return;
    if (!backend.loading && minElapsed) setBootLeaving(true);
  }, [backend.loading, minElapsed, bootDone, bootLeaving]);
  useEffect(() => {
    if (!bootLeaving) return;
    const t = setTimeout(() => setBootDone(true), 480);
    return () => clearTimeout(t);
  }, [bootLeaving]);

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

  const mergeFreshSubject = useCallback((current: Subject, updated: Subject): Subject => ({
    ...current,
    ...updated,
    summary: updated.summary || current.summary,
    poster: updated.poster || current.poster,
    hero: updated.hero || current.hero,
    episodesDetail: updated.episodesDetail.length ? updated.episodesDetail : current.episodesDetail,
  }), []);

  const sameSubject = useCallback((left: Subject, right: Subject) => {
    if (left.provider === right.provider && left.providerSubjectId && right.providerSubjectId) {
      return left.providerSubjectId === right.providerSubjectId;
    }
    return left.id === right.id;
  }, []);

  const refreshSubjectInStack = useCallback(async (baseSubject: Subject) => {
    const next = await backend.refresh();
    const candidates = [...next.subjects, ...next.bangumiCollections];
    const updated = candidates.find((candidate) => sameSubject(candidate, baseSubject));
    if (!updated) return;
    setViewStack((current) => current.map((view) => {
      if (view.kind === "detail" && sameSubject(view.subject, updated)) {
        return { ...view, subject: mergeFreshSubject(view.subject, updated) };
      }
      if (view.kind === "playback" && sameSubject(view.playback.subject, updated)) {
        return {
          ...view,
          playback: {
            ...view.playback,
            subject: mergeFreshSubject(view.playback.subject, updated),
          },
        };
      }
      if (view.kind === "resources" && view.prefill?.subject && sameSubject(view.prefill.subject, updated)) {
        return {
          ...view,
          prefill: {
            ...view.prefill,
            subject: mergeFreshSubject(view.prefill.subject, updated),
          },
        };
      }
      return view;
    }));
  }, [backend, mergeFreshSubject, sameSubject]);

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
        onMouseDownCapture={suppressNonTextControlFocus}
        onPointerUpCapture={blurActiveNonTextControl}
        onKeyDownCapture={(event) => {
          if (event.key.startsWith("Arrow")) {
            blurActiveNonTextControl();
          }
        }}
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
                  onSubjectUpdated={refreshSubjectInStack}
                  onSnack={snack.show}
                />
              ) : currentView.kind === "detail" ? (
                <DetailPage
                  subject={currentView.subject}
                  onBack={goBack}
                  onPlay={(subject, episode) => setViewStack((current) => [...current, { kind: "playback", playback: { subject, episode } }])}
                  onFindResources={openResourceSearch}
                  onSubjectUpdated={async () => {
                    await refreshSubjectInStack(currentView.subject);
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
        {!bootDone && <BootSplash leaving={bootLeaving} />}
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

function suppressNonTextControlFocus(event: MouseEvent<HTMLElement>) {
  const target = event.target;
  if (!(target instanceof HTMLElement) || isTextEntryTarget(target)) return;
  const control = target.closest("button, [role='button'], [tabindex]");
  if (control instanceof HTMLElement && !control.closest("[data-allow-focus='true']")) {
    event.preventDefault();
  }
}

function blurActiveNonTextControl() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || isTextEntryTarget(active)) return;
  if (active.matches("button, [role='button'], input[type='range'], [tabindex]")) {
    active.blur();
  }
}

function isTextEntryTarget(target: HTMLElement) {
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && target.type !== "range";
}
