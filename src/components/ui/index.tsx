import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-fg shadow-soft hover:bg-primary-hover",
  accent: "bg-accent text-accent-fg shadow-glow hover:brightness-95",
  secondary: "border border-border bg-surface text-fg hover:bg-surface-2",
  ghost: "text-fg hover:bg-surface-2",
  danger: "border border-danger/30 bg-danger-soft text-danger hover:brightness-95",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-5 text-[0.95rem]",
  lg: "h-12 px-6 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-all duration-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden
          className="size-4 animate-spin rounded-full border-2 border-current border-e-transparent"
        />
      ) : null}
      {children}
    </button>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-xl border border-border bg-surface shadow-soft", className)}
      {...props}
    />
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="animate-in mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1.5 text-sm text-fg-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info" | "accent";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-fg-muted",
  primary: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  accent: "bg-accent-soft text-accent-fg",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export type WorkflowStatus = "pending" | "approved" | "needsRevision" | "rejected" | "draft" | "info";

const STATUS_TONE: Record<WorkflowStatus, Tone> = {
  pending: "info",
  approved: "success",
  needsRevision: "warning",
  rejected: "danger",
  draft: "neutral",
  info: "primary",
};

export function StatusPill({ status, label }: { status: WorkflowStatus; label: string }) {
  return (
    <Badge tone={STATUS_TONE[status]}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {label}
    </Badge>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title?: string;
  children?: ReactNode;
}) {
  const map = {
    info: "border-info/30 bg-info-soft text-info",
    success: "border-success/30 bg-success-soft text-success",
    warning: "border-warning/30 bg-warning-soft text-warning",
    danger: "border-danger/30 bg-danger-soft text-danger",
  } as const;
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-lg border px-4 py-3 text-sm", map[tone])}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={cn(title && "mt-1")}>{children}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton rounded-md", className)} />;
}

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon?: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="animate-in flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon ? (
        <div className="grid size-14 place-items-center rounded-full bg-primary-soft text-primary">{icon}</div>
      ) : null}
      <p className="text-base font-semibold text-fg">{title}</p>
      {text ? <p className="max-w-md text-sm text-fg-muted">{text}</p> : null}
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "primary",
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: ReactNode;
  tone?: "primary" | "accent" | "teal" | "info";
}) {
  const accent = {
    primary: "from-navy-600/15 text-primary",
    accent: "from-gold-500/20 text-accent-fg",
    teal: "from-teal-500/20 text-teal-600",
    info: "from-wave/20 text-info",
  }[tone];
  return (
    <Card className="animate-in relative overflow-hidden p-5">
      <div aria-hidden className={cn("pointer-events-none absolute -top-10 -end-10 size-32 rounded-full bg-gradient-to-br to-transparent opacity-80", accent.split(" ")[0])} />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-fg-muted">{label}</p>
          <p className="tabular mt-2 text-3xl font-bold text-fg">{value}</p>
          {hint ? <p className="mt-1 text-xs text-fg-muted">{hint}</p> : null}
        </div>
        {icon ? <div className={cn("grid size-11 place-items-center rounded-lg bg-surface-2", accent.split(" ")[1])}>{icon}</div> : null}
      </div>
    </Card>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initial = name.trim().charAt(0) || "؟";
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-navy-600 to-teal-600 text-sm font-semibold text-white",
        className,
      )}
    >
      {initial}
    </span>
  );
}

export function Progress({ value, label }: { value: number; label: string }) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100} className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
      <div className="h-full rounded-full bg-gradient-to-l from-teal-500 to-primary transition-[width] duration-700" style={{ width: `${clamped}%` }} />
    </div>
  );
}

export interface TimelineItem {
  id: string | number;
  title: string;
  description?: string;
  meta?: string;
  time?: string;
  tone?: Tone;
}

export function Timeline({ items, emptyText }: { items: TimelineItem[]; emptyText: string }) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-fg-muted">{emptyText}</p>;
  return (
    <ol className="relative flex flex-col gap-5 ps-6">
      <span aria-hidden className="absolute start-[7px] top-2 bottom-2 w-px bg-gradient-to-b from-teal-500/60 via-border-strong to-transparent" />
      {items.map((item) => (
        <li key={item.id} className="animate-in relative">
          <span
            aria-hidden
            className={cn(
              "absolute -start-6 top-1.5 size-3.5 rounded-full ring-4 ring-surface",
              item.tone === "success" ? "bg-success" : item.tone === "danger" ? "bg-danger" : item.tone === "warning" ? "bg-warning" : "bg-accent",
            )}
          />
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-semibold text-fg">{item.title}</p>
            {item.time ? <time className="tabular text-xs text-fg-muted">{item.time}</time> : null}
          </div>
          {item.description ? <p className="mt-0.5 text-sm text-fg-muted">{item.description}</p> : null}
          {item.meta ? <p className="mt-0.5 text-xs text-fg-muted">{item.meta}</p> : null}
        </li>
      ))}
    </ol>
  );
}

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-3" aria-label="مراحل">
      {steps.map((label, index) => {
        const state = index < current ? "done" : index === current ? "active" : "todo";
        return (
          <li key={label} className="flex items-center gap-2" aria-current={state === "active" ? "step" : undefined}>
            <span
              className={cn(
                "grid size-8 place-items-center rounded-full text-sm font-semibold tabular",
                state === "done" && "bg-success text-white",
                state === "active" && "bg-accent text-accent-fg shadow-glow",
                state === "todo" && "bg-surface-2 text-fg-muted",
              )}
            >
              {index + 1}
            </span>
            <span className={cn("text-sm", state === "todo" ? "text-fg-muted" : "font-medium text-fg")}>{label}</span>
            {index < steps.length - 1 ? <span aria-hidden className="mx-1 h-px w-8 bg-border-strong" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function Breadcrumb({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav aria-label="مسیر" className="mb-3 text-sm text-fg-muted">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
            {item.href ? (
              <a href={item.href} className="rounded hover:text-primary hover:underline">
                {item.label}
              </a>
            ) : (
              <span aria-current="page" className="font-medium text-fg">{item.label}</span>
            )}
            {i < items.length - 1 ? <span aria-hidden>/</span> : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Toast({ tone = "success", title, children }: { tone?: "success" | "danger" | "info"; title: string; children?: ReactNode }) {
  const bar = { success: "bg-success", danger: "bg-danger", info: "bg-info" }[tone];
  return (
    <div role="status" className="animate-pop relative flex w-full max-w-sm overflow-hidden rounded-lg border border-border bg-surface shadow-lift">
      <span aria-hidden className={cn("w-1.5 shrink-0", bar)} />
      <div className="p-4">
        <p className="font-semibold text-fg">{title}</p>
        {children ? <p className="mt-0.5 text-sm text-fg-muted">{children}</p> : null}
      </div>
    </div>
  );
}

export function KeyValue({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg bg-surface-2 p-4">
          <dt className="text-xs text-fg-muted">{item.label}</dt>
          <dd className="mt-1 font-medium text-fg">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
