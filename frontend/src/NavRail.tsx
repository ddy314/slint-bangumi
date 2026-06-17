import type { ReactNode } from "react";
import { cn } from "./utils/cn";
import {
  HomeIcon,
  LibraryIcon,
  SettingsIcon,
  CollapseIcon,
  ExpandIcon,
  BellIcon,
} from "./icons";

export type Route = "home" | "library" | "settings";

const items: { id: Route; label: string; icon: (p: any) => ReactNode }[] = [
  { id: "home", label: "Home", icon: HomeIcon },
  { id: "library", label: "Library", icon: LibraryIcon },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

export function NavRail({
  route,
  onRoute,
  collapsed,
  onToggleCollapsed,
}: {
  route: Route;
  onRoute: (r: Route) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  return (
    <aside
      className={cn(
        "h-full shrink-0 flex flex-col items-stretch border-r border-[var(--color-outline-soft)] mica",
        "bg-[var(--color-surface)]/80",
        collapsed ? "w-[72px]" : "w-[228px]"
      )}
    >
      {/* Brand */}
      <div className={cn("flex items-center px-4 pt-5 pb-4", collapsed && "justify-center px-0")}>
        <div className="size-9 rounded-xl bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] grid place-items-center shadow-md">
          <svg viewBox="0 0 24 24" className="size-5 text-[var(--color-on-primary)]" fill="currentColor">
            <path d="M12 2l2.4 6.9H22l-6 4.4 2.3 7L12 16l-6.3 4.3 2.3-7-6-4.4h7.6z" />
          </svg>
        </div>
        {!collapsed && (
          <div className="ml-2.5 min-w-0">
            <div className="text-[15px] font-semibold tracking-tight leading-none">NexPlay</div>
            <div className="text-[11px] text-[var(--color-on-surface-faint)] mt-1">本地番剧库</div>
          </div>
        )}
      </div>

      {/* Items */}
      <nav className={cn("flex-1 flex flex-col gap-1", collapsed ? "px-2" : "px-3")}>
        {items.map((it) => {
          const active = route === it.id;
          const Icon = it.icon;
          return (
            <button
              key={it.id}
              onClick={() => onRoute(it.id)}
              className={cn(
                "group relative flex items-center h-11 rounded-xl transition-all",
                collapsed ? "justify-center px-0" : "px-3 gap-3",
                active
                  ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
                  : "text-[var(--color-on-surface-muted)] hover:bg-white/[0.06] hover:text-[var(--color-on-surface)]"
              )}
            >
              {/* M3 active indicator (left bar) */}
              <span
                className={cn(
                  "absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-[var(--color-primary)] transition-all",
                  active ? "h-6 opacity-100" : "h-0 opacity-0"
                )}
              />
              <Icon className="size-[20px] shrink-0" />
              {!collapsed && (
                <span className="text-[14px] font-medium tracking-tight">{it.label}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer / collapse */}
      <div className={cn("p-3 border-t border-[var(--color-outline-soft)]", collapsed && "flex flex-col items-center gap-1")}>
        {!collapsed ? (
          <div className="flex items-center gap-2 mb-2 px-2 py-2 rounded-xl hover:bg-white/[0.05] transition-colors cursor-pointer">
            <div className="size-7 rounded-full bg-gradient-to-br from-orange-300 to-violet-400 grid place-items-center text-[11px] font-semibold text-stone-900">
              茉
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] leading-tight truncate">本地用户</div>
              <div className="text-[10px] text-[var(--color-on-surface-faint)]">3 个媒体库</div>
            </div>
            <button className="size-7 rounded-full hover:bg-white/[0.08] grid place-items-center text-[var(--color-on-surface-muted)]">
              <BellIcon className="size-4" />
            </button>
          </div>
        ) : (
          <button className="size-9 rounded-full hover:bg-white/[0.08] grid place-items-center text-[var(--color-on-surface-muted)]">
            <BellIcon className="size-[18px]" />
          </button>
        )}
        <button
          onClick={onToggleCollapsed}
          className={cn(
            "w-full h-9 rounded-xl flex items-center justify-center gap-2 text-[12px]",
            "text-[var(--color-on-surface-faint)] hover:bg-white/[0.05] hover:text-[var(--color-on-surface)] transition-colors"
          )}
        >
          {collapsed ? <ExpandIcon className="size-4" /> : <CollapseIcon className="size-4" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
