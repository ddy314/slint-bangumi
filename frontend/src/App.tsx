import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { NavRail, type Route } from "./NavRail";
import { LibraryPage } from "./pages/Library";
import { DetailPage } from "./pages/Detail";
import { PlayerPage } from "./pages/Player";
import { SettingsPage } from "./pages/Settings";
import { useBackendSnapshot } from "./backend";
import { appleSpringSoft } from "./motion";
import { Snackbar, useSnackbar } from "./ui";
import type { PlaybackEpisode, Subject } from "./data";

type PlaybackState = {
  subject: Subject;
  episode: PlaybackEpisode;
};

export default function App() {
  const [route, setRoute] = useState<Route>("home");
  const [detail, setDetail] = useState<Subject | null>(null);
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [navCollapsed, setNavCollapsed] = useState(false);
  const snack = useSnackbar();
  const backend = useBackendSnapshot();

  const openDetail = useCallback((s: Subject) => {
    setDetail(s);
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, []);

  const handleRoute = useCallback((r: Route) => {
    setPlayback(null);
    setDetail(null);
    setRoute(r);
  }, []);

  return (
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
            key={playback ? `playback-${playback.subject.id}-${playback.episode.key}` : detail ? `detail-${detail.id}` : `route-${route}`}
            className="h-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={appleSpringSoft}
          >
            {playback ? (
              <PlayerPage
                subject={playback.subject}
                initialEpisode={playback.episode}
                onBack={() => {
                  setDetail(playback.subject);
                  setPlayback(null);
                }}
                onSnack={snack.show}
              />
            ) : detail ? (
              <DetailPage
                subject={detail}
                onBack={() => setDetail(null)}
                onPlay={(subject, episode) => setPlayback({ subject, episode })}
                onSnack={snack.show}
              />
            ) : route === "settings" ? (
              <SettingsPage onSnack={snack.show} />
            ) : (
              <LibraryPage
                route={route}
                subjects={backend.subjects}
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
  );
}
