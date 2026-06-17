import { useState } from "react";
import { NavRail, type Route } from "./NavRail";
import { HomePage } from "./pages/Home";
import { LibraryPage } from "./pages/Library";
import { DetailPage } from "./pages/Detail";
import { SettingsPage } from "./pages/Settings";
import { useBackendSnapshot } from "./backend";
import { Snackbar, useSnackbar } from "./ui";
import type { Subject } from "./data";

export default function App() {
  const [route, setRoute] = useState<Route>("home");
  const [collapsed, setCollapsed] = useState(false);
  const [detail, setDetail] = useState<Subject | null>(null);
  const snack = useSnackbar();
  const backend = useBackendSnapshot();

  const openDetail = (s: Subject) => {
    setDetail(s);
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  };

  return (
    <div className="h-full w-full flex bg-[var(--color-bg)] text-[var(--color-on-surface)]">
      <NavRail
        route={route}
        onRoute={(r) => {
          setDetail(null);
          setRoute(r);
        }}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
      />

      <main className="flex-1 min-w-0 h-full overflow-y-auto mica">
        <div key={detail ? `d-${detail.id}` : `r-${route}`} className="anim-fade-up">
          {detail ? (
            <DetailPage
              subject={detail}
              onBack={() => setDetail(null)}
              onSnack={snack.show}
            />
          ) : route === "home" ? (
            <HomePage
              subjects={backend.subjects}
              loading={backend.loading}
              error={backend.error}
              onOpen={openDetail}
              onSnack={snack.show}
            />
          ) : route === "library" ? (
            <LibraryPage
              subjects={backend.subjects}
              stats={backend.stats}
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
          ) : (
            <SettingsPage onSnack={snack.show} />
          )}
        </div>
      </main>

      <Snackbar msg={snack.msg} onDismiss={snack.dismiss} />
    </div>
  );
}
