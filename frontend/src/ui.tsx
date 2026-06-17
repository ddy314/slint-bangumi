import { useEffect, useState, type ReactNode, type ButtonHTMLAttributes } from "react";
import { cn } from "./utils/cn";
import { CheckIcon, CloseIcon } from "./icons";

// ----- Buttons (M3 variants) -----
type BtnVariant = "filled" | "tonal" | "outlined" | "text" | "danger";
type BtnSize = "sm" | "md" | "lg";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant;
  size?: BtnSize;
  icon?: ReactNode;
  loading?: boolean;
};

export function Button({
  variant = "filled",
  size = "md",
  icon,
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const sizes: Record<BtnSize, string> = {
    sm: "h-8 px-3 text-[13px] gap-1.5 rounded-full",
    md: "h-10 px-5 text-sm gap-2 rounded-full",
    lg: "h-12 px-6 text-[15px] gap-2 rounded-full",
  };
  const variants: Record<BtnVariant, string> = {
    filled:
      "bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:brightness-110 active:brightness-95 shadow-sm shadow-orange-900/40",
    tonal:
      "bg-[var(--color-primary-soft)] text-[var(--color-primary)] hover:bg-[#5a3527] active:bg-[#4f2e22]",
    outlined:
      "bg-transparent text-[var(--color-on-surface)] ring-1 ring-inset ring-[var(--color-outline)] hover:bg-white/5",
    text: "bg-transparent text-[var(--color-on-surface)] hover:bg-white/[0.06]",
    danger:
      "bg-[var(--color-danger)]/15 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/25 ring-1 ring-inset ring-[var(--color-danger)]/30",
  };
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center font-medium transition-all duration-150 select-none",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        sizes[size],
        variants[variant],
        className
      )}
    >
      {loading ? (
        <span className="inline-block size-4 rounded-full border-2 border-current border-r-transparent animate-spin" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}

// ----- Icon Button (Fluent rounded icon button) -----
export function IconButton({
  className,
  children,
  active,
  size = "md",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "size-8", md: "size-10", lg: "size-12" };
  return (
    <button
      {...rest}
      className={cn(
        "inline-flex items-center justify-center rounded-full transition-all",
        "text-[var(--color-on-surface)] hover:bg-white/[0.08] active:bg-white/[0.12]",
        active && "bg-white/[0.10]",
        sizes[size],
        className
      )}
    >
      {children}
    </button>
  );
}

// ----- Chip (M3 filter chip) -----
export function Chip({
  children,
  selected,
  onClick,
  icon,
  className,
}: {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 h-8 px-3 text-[13px] rounded-full transition-all",
        "ring-1 ring-inset",
        selected
          ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)] ring-[var(--color-primary)]/40"
          : "bg-transparent text-[var(--color-on-surface-muted)] ring-[var(--color-outline)] hover:bg-white/5 hover:text-[var(--color-on-surface)]",
        className
      )}
    >
      {selected && <CheckIcon className="size-3.5" />}
      {!selected && icon}
      {children}
    </button>
  );
}

// ----- Badge -----
export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "primary" | "success" | "warning" | "danger" | "accent";
  className?: string;
}) {
  const tones = {
    neutral: "bg-white/10 text-white/90 ring-white/15",
    primary: "bg-[var(--color-primary)]/20 text-[var(--color-primary)] ring-[var(--color-primary)]/30",
    success: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
    warning: "bg-amber-500/15 text-amber-300 ring-amber-400/30",
    danger: "bg-rose-500/15 text-rose-300 ring-rose-400/30",
    accent: "bg-violet-500/15 text-violet-300 ring-violet-400/30",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 h-6 rounded-full text-[11px] font-medium tracking-wide ring-1 ring-inset",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

// ----- Segmented Control -----
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
}) {
  return (
    <div className="inline-flex p-1 rounded-full bg-[var(--color-surface-2)] ring-1 ring-inset ring-[var(--color-outline-soft)]">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-3 text-[13px] rounded-full transition-all",
              active
                ? "bg-[var(--color-surface-4)] text-[var(--color-on-surface)] shadow-sm"
                : "text-[var(--color-on-surface-muted)] hover:text-[var(--color-on-surface)]"
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ----- Progress bar -----
export function Progress({
  value,
  className,
  tone = "primary",
}: {
  value: number; // 0..1
  className?: string;
  tone?: "primary" | "accent" | "success";
}) {
  const tones = {
    primary: "bg-[var(--color-primary)]",
    accent: "bg-[var(--color-accent)]",
    success: "bg-emerald-400",
  };
  return (
    <div className={cn("h-1 w-full overflow-hidden rounded-full bg-white/10", className)}>
      <div
        className={cn("h-full rounded-full transition-all", tones[tone])}
        style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }}
      />
    </div>
  );
}

// ----- Switch -----
export function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-7 w-12 rounded-full transition-all ring-1 ring-inset",
        checked
          ? "bg-[var(--color-primary)] ring-[var(--color-primary)]"
          : "bg-[var(--color-surface-3)] ring-[var(--color-outline)]"
      )}
    >
      <span
        className={cn(
          "absolute top-1/2 -translate-y-1/2 size-5 rounded-full bg-white transition-all shadow",
          checked ? "left-[22px]" : "left-1"
        )}
      />
    </button>
  );
}

// ----- Snackbar -----
export type SnackMsg = { id: number; text: string; tone?: "neutral" | "success" | "danger" };
export function Snackbar({ msg, onDismiss }: { msg: SnackMsg | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(onDismiss, 3200);
    return () => clearTimeout(t);
  }, [msg, onDismiss]);
  if (!msg) return null;
  const tones = {
    neutral: "bg-[var(--color-surface-4)]",
    success: "bg-emerald-600/90",
    danger: "bg-rose-600/90",
  };
  return (
    <div
      className={cn(
        "anim-snackbar fixed bottom-8 left-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-xl ring-1 ring-white/10 text-sm text-white",
        tones[msg.tone ?? "neutral"]
      )}
    >
      <span>{msg.text}</span>
      <button onClick={onDismiss} className="opacity-70 hover:opacity-100">
        <CloseIcon className="size-4" />
      </button>
    </div>
  );
}

export function useSnackbar() {
  const [msg, setMsg] = useState<SnackMsg | null>(null);
  return {
    msg,
    show: (text: string, tone?: SnackMsg["tone"]) =>
      setMsg({ id: Date.now(), text, tone }),
    dismiss: () => setMsg(null),
  };
}

// ----- Search input -----
export function SearchField({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 h-10 px-3.5 rounded-full bg-[var(--color-surface-2)] ring-1 ring-inset ring-[var(--color-outline-soft)] focus-within:ring-[var(--color-primary)]/40 transition-all",
        className
      )}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-4 text-[var(--color-on-surface-faint)]">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-transparent outline-none text-sm text-[var(--color-on-surface)] placeholder:text-[var(--color-on-surface-faint)] flex-1 min-w-0"
      />
      {value && (
        <button onClick={() => onChange("")} className="text-[var(--color-on-surface-faint)] hover:text-[var(--color-on-surface)]">
          <CloseIcon className="size-4" />
        </button>
      )}
    </div>
  );
}

// ----- Skeleton -----
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-lg", className)} />;
}

// ----- Tooltip-ish title (just relies on title attribute, no need) -----

// ----- Card -----
export function Card({
  children,
  className,
  elevated,
}: {
  children: ReactNode;
  className?: string;
  elevated?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-[var(--color-surface-1)] ring-1 ring-inset ring-[var(--color-outline-soft)]",
        elevated && "shadow-lg shadow-black/30",
        className
      )}
    >
      {children}
    </div>
  );
}
