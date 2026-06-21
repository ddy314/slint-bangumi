import { motion } from "framer-motion";
import { Home, Library, Moon, PanelLeftClose, PanelLeftOpen, Search, Settings, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { appleSpring, appleSpringBouncy } from "./motion";
import { cn } from "./utils/cn";

export type Route = "search" | "home" | "library" | "settings";

const items: { id: Route; label: string; icon: ReactNode }[] = [
  { id: "search", label: "搜索", icon: <Search size={21} strokeWidth={2.1} /> },
  { id: "home", label: "主页", icon: <Home size={19} strokeWidth={2} /> },
  { id: "library", label: "媒体库", icon: <Library size={19} strokeWidth={2} /> },
  { id: "settings", label: "设置", icon: <Settings size={19} strokeWidth={2} /> },
];

export function NavRail({
  route,
  onRoute,
  theme,
  onToggleTheme,
  collapsed,
  onToggleCollapsed,
}: {
  route: Route;
  onRoute: (r: Route) => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  return (
    <aside
      className={cn(
        "nav-rail fixed inset-y-0 left-0 z-40 flex w-[var(--nav-width)] shrink-0 flex-col overflow-visible px-4 py-6 backdrop-blur-[32px] backdrop-saturate-[180%]",
        collapsed && "is-collapsed"
      )}
    >
      <div className="nav-brand mb-8 flex items-center justify-between gap-2 px-1">
        <span className="nav-brand-text text-[18px] font-semibold tracking-tight">NexPlay</span>
        <span className="nav-brand-mark hidden text-[17px] font-bold tracking-tight">N</span>
        <button
          type="button"
          className="nav-collapse-button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
          title={collapsed ? "展开侧边栏" : "折叠侧边栏"}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>
      <nav className="relative z-[1] flex w-full flex-col gap-1.5">
        {items.map((item) => {
          const active = route === item.id;
          return (
            <motion.button
              key={item.id}
              type="button"
              onClick={() => onRoute(item.id)}
              title={collapsed ? item.label : undefined}
              aria-label={item.label}
              className={cn(
                "nav-item relative flex h-[44px] w-full items-center gap-3 rounded-[var(--radius-control)] px-3.5 text-[15px] font-medium transition-colors",
                active
                  ? "is-active text-[var(--color-accent)]"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              )}
              whileTap={{ scale: 0.965 }}
              transition={appleSpringBouncy}
            >
              {active && (
                <motion.span
                  layoutId="nav-active-bg"
                  className="nav-active-bg absolute inset-y-[3px] left-1 right-1 rounded-[calc(var(--radius-control)-2px)]"
                  transition={appleSpring}
                />
              )}
              <span className="nav-item-icon relative flex size-6 shrink-0 items-center justify-center">{item.icon}</span>
              <span className="nav-item-label relative leading-none">{item.label}</span>
            </motion.button>
          );
        })}
      </nav>

      <button
        type="button"
        title="切换外观"
        onClick={onToggleTheme}
        aria-label={theme === "light" ? "切换到深色外观" : "切换到浅色外观"}
        className="nav-item relative z-[1] mt-auto flex h-[42px] w-full items-center gap-3 rounded-[var(--radius-control)] px-3.5 text-[14px] font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
      >
        <span className="nav-item-icon flex size-6 shrink-0 items-center justify-center">
          {theme === "light" ? <Moon size={19} strokeWidth={2} /> : <Sun size={19} strokeWidth={2} />}
        </span>
        <span className="nav-item-label">{theme === "light" ? "深色" : "浅色"}</span>
      </button>
    </aside>
  );
}
