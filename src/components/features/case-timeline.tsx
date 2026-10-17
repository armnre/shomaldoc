"use client";

import { useMemo, useState } from "react";
import { Check, Circle, Clock3, FileUp, GitCommitHorizontal, MessageSquareText, UserRound } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { Select } from "@/components/ui/form";
import type { Dictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/config";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";

type StepState = "done" | "current" | "upcoming";
interface ProgressStep {
  key: string; titleFa: string; state: StepState; startedAt: string | null; endedAt: string | null;
  responsibleName: string | null; responsibleRole: string | null; dueDate: string | null; actionTitle: string | null;
}
interface CaseEvent {
  id: number; eventType: string; description: string | null; actorFullName: string | null;
  actorRole: string | null; reason: string | null; createdAt: string;
}

type EventCategory = "status" | "file" | "review" | "other";
function categoryOf(type: string): EventCategory {
  if (type.includes("status") || type.includes("transition")) return "status";
  if (type.includes("file") || type.includes("upload") || type.includes("receipt")) return "file";
  if (type.includes("approve") || type.includes("reject") || type.includes("review") || type.includes("revision") || type.includes("decision")) return "review";
  return "other";
}

export function CaseTimeline({
  dict, locale, progress, events,
}: {
  dict: Dictionary;
  locale: Locale;
  progress: { currentStep: string; steps: ProgressStep[] } | null;
  events: CaseEvent[];
}) {
  const [filter, setFilter] = useState<"all" | EventCategory>("all");
  const [now] = useState(() => Date.now());
  const currentIndex = progress?.steps.findIndex((step) => step.state === "current") ?? -1;
  const filtered = useMemo(() => events.filter((event) => filter === "all" || categoryOf(event.eventType) === filter), [events, filter]);
  const grouped = useMemo(() => {
    const groups = new Map<string, CaseEvent[]>();
    filtered.forEach((event) => {
      const day = formatDate(event.createdAt, locale);
      groups.set(day, [...(groups.get(day) ?? []), event]);
    });
    return [...groups];
  }, [filtered, locale]);

  return <div className="grid gap-6">
    <Card className="overflow-hidden">
      <div className="border-b border-border p-5 sm:p-6">
        <h2 className="text-lg font-semibold">{dict.caseTimeline.title}</h2>
        <p className="text-sm text-fg-muted">{dict.caseTimeline.subtitle}</p>
      </div>
      {!progress || progress.steps.length === 0 ? <p className="p-8 text-center text-sm text-fg-muted">{dict.caseTimeline.noProgress}</p> : <>
        <div className="overflow-x-auto p-5 sm:p-6">
          <ol className="flex min-w-max items-start" aria-label={dict.caseTimeline.title}>
            {progress.steps.map((step, index) => {
              const overdue = step.state === "current" && step.dueDate && new Date(step.dueDate).getTime() < now;
              return <li key={step.key} className="relative flex w-44 flex-col items-center px-2 text-center" aria-current={step.state === "current" ? "step" : undefined}>
                {index > 0 ? <span aria-hidden className={cn("absolute end-1/2 top-5 h-0.5 w-full", step.state === "upcoming" ? "bg-border" : "bg-success")} /> : null}
                <span className={cn("relative z-10 grid size-10 place-items-center rounded-full border-4 border-surface", step.state === "done" && "bg-success text-white", step.state === "current" && "bg-primary text-primary-fg shadow-glow", step.state === "upcoming" && "bg-surface-2 text-fg-muted")}>
                  {step.state === "done" ? <Check className="size-5" /> : step.state === "current" ? <Clock3 className="size-5" /> : <Circle className="size-4" />}
                </span>
                <strong className={cn("mt-2 text-sm", step.state === "upcoming" && "text-fg-muted")}>{step.titleFa}</strong>
                <span className="mt-1 text-xs text-fg-muted">{step.state === "done" ? dict.caseTimeline.done : step.state === "current" ? dict.caseTimeline.current : dict.caseTimeline.upcoming}</span>
                {overdue ? <Badge tone="danger" className="mt-2">{dict.caseTimeline.overdue}</Badge> : null}
              </li>;
            })}
          </ol>
        </div>
        <div className="grid gap-2 border-t border-border bg-surface-2/50 p-4 sm:p-5">
          {progress.steps.map((step, index) => {
            const overdue = step.state === "current" && step.dueDate && new Date(step.dueDate).getTime() < now;
            return <details key={step.key} className="rounded-lg border border-border bg-surface" open={index === currentIndex}>
              <summary className="flex cursor-pointer items-center gap-3 p-4">
                <span className={cn("size-2.5 rounded-full", step.state === "done" ? "bg-success" : step.state === "current" ? "bg-primary" : "bg-border-strong")} />
                <span className="font-medium">{step.titleFa}</span>
                <Badge className="ms-auto" tone={step.state === "done" ? "success" : step.state === "current" ? "primary" : "neutral"}>{step.state === "done" ? dict.caseTimeline.done : step.state === "current" ? dict.caseTimeline.current : dict.caseTimeline.upcoming}</Badge>
              </summary>
              <dl className="grid gap-3 border-t border-border p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-xs text-fg-muted">{dict.caseTimeline.startedAt}</dt><dd title={step.startedAt ?? undefined}>{step.startedAt ? formatDateTime(step.startedAt, locale) : "—"}</dd></div>
                <div><dt className="text-xs text-fg-muted">{dict.caseTimeline.endedAt}</dt><dd title={step.endedAt ?? undefined}>{step.endedAt ? formatDateTime(step.endedAt, locale) : "—"}</dd></div>
                <div><dt className="text-xs text-fg-muted">{dict.caseTimeline.responsible}</dt><dd>{step.responsibleName ?? (step.responsibleRole ? dict.roleNames[step.responsibleRole] ?? step.responsibleRole : step.state === "current" ? dict.caseTimeline.noResponsible : "—")}</dd></div>
                <div><dt className="text-xs text-fg-muted">{dict.caseTimeline.dueDate}</dt><dd className={overdue ? "font-semibold text-danger" : ""} title={step.dueDate ?? undefined}>{step.dueDate ? formatDateTime(step.dueDate, locale) : "—"}</dd></div>
                {step.actionTitle ? <div className="sm:col-span-2 lg:col-span-4"><dt className="text-xs text-fg-muted">{dict.caseTimeline.nextStep}</dt><dd className="font-medium text-primary">{step.actionTitle}</dd></div> : null}
              </dl>
            </details>;
          })}
        </div>
      </>}
    </Card>

    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border p-5 sm:p-6">
        <div><h2 className="text-lg font-semibold">{dict.caseTimeline.activityTitle}</h2><p className="text-sm text-fg-muted">{dict.caseTimeline.activitySubtitle}</p></div>
        <div className="min-w-48"><Select label={dict.caseTimeline.filterType} value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">{dict.caseTimeline.allEvents}</option><option value="status">{dict.caseTimeline.statusEvents}</option><option value="file">{dict.caseTimeline.fileEvents}</option><option value="review">{dict.caseTimeline.reviewEvents}</option><option value="other">{dict.caseTimeline.otherEvents}</option></Select></div>
      </div>
      <div className="p-5 sm:p-6">
        {grouped.length === 0 ? <p className="py-8 text-center text-sm text-fg-muted">{dict.cases.noEvents}</p> : grouped.map(([day, dayEvents]) => <section key={day} className="mb-7 last:mb-0">
          <h3 className="sticky top-32 z-10 mb-3 w-fit rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-fg-muted">{day}</h3>
          <ol className="relative ms-4 border-s border-border ps-6">
            {dayEvents.map((event) => {
              const category = categoryOf(event.eventType);
              const Icon = category === "file" ? FileUp : category === "review" ? MessageSquareText : category === "status" ? GitCommitHorizontal : UserRound;
              const color = category === "file" ? "bg-info-soft text-info" : category === "review" ? "bg-warning-soft text-warning" : category === "status" ? "bg-primary-soft text-primary" : "bg-surface-2 text-fg-muted";
              return <li key={event.id} className="relative pb-6 last:pb-0">
                <span className={cn("absolute -start-[2.35rem] grid size-7 place-items-center rounded-full ring-4 ring-surface", color)}><Icon className="size-3.5" /></span>
                <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-medium">{event.description ?? event.eventType}</p><p className="text-xs text-fg-muted">{event.actorFullName ?? dict.common.system}{event.actorRole ? ` · ${dict.roleNames[event.actorRole] ?? event.actorRole}` : ""}</p></div><time className="text-xs text-fg-muted" title={event.createdAt}>{formatDateTime(event.createdAt, locale)}</time></div>
                {event.reason ? <p className="mt-2 rounded-lg bg-surface-2 p-3 text-sm"><span className="font-medium">{dict.common.reason}: </span>{event.reason}</p> : null}
              </li>;
            })}
          </ol>
        </section>)}
      </div>
    </Card>
  </div>;
}
