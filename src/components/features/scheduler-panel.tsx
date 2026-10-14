"use client";

import { useState, useTransition } from "react";
import { Activity, AlertTriangle, CheckCircle2, Loader2, Play, Timer } from "lucide-react";
import { Badge, Button, Card, type Tone } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import { apiRequest } from "./api-client";

/**
 * Admin scheduler panel.
 *
 * Shows the most recent run (status, counts, explicit skip reason or error) and
 * lets an administrator trigger a run manually. The manual trigger is a
 * monitoring tool; the scheduler itself runs automatically in-process.
 */

export interface SchedulerRunView {
  id: number;
  jobKey: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  processed: number;
  created: number;
  escalated: number;
  note: string | null;
  error: string | null;
}

export interface SchedulerLabels {
  title: string;
  subtitle: string;
  lastRun: string;
  lastSuccess: string;
  never: string;
  status: string;
  processed: string;
  created: string;
  escalated: string;
  note: string;
  error: string;
  runNow: string;
  running: string;
  finished: string;
  statusOk: string;
  statusSkipped: string;
  statusFailed: string;
  statusRunning: string;
  enabled: string;
  disabled: string;
}

const TONES: Record<string, Tone> = { ok: "success", running: "info", skipped: "warning", failed: "danger" };

export function SchedulerPanel({
  lastRun,
  lastSuccess,
  enabled,
  labels,
  locale,
  canRun,
}: {
  lastRun: SchedulerRunView | null;
  lastSuccess: SchedulerRunView | null;
  enabled: boolean;
  labels: SchedulerLabels;
  /** Locale for date rendering: a function prop cannot cross the server boundary. */
  locale: Locale;
  canRun: boolean;
}) {
  const [current, setCurrent] = useState<SchedulerRunView | null>(lastRun);
  const [previousSuccess, setPreviousSuccess] = useState<SchedulerRunView | null>(lastSuccess);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  const formatter = (value: string | null) => (value ? formatDateTime(value, locale) : labels.never);

  const statusLabel = (status: string) =>
    status === "ok" ? labels.statusOk : status === "failed" ? labels.statusFailed : status === "skipped" ? labels.statusSkipped : labels.statusRunning;

  async function runNow() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await apiRequest<{
        ran: boolean;
        jobs: Array<{ jobKey: string; created: number; skippedReason: string | null }>;
        lastRun: SchedulerRunView | null;
      }>("/api/admin/scheduler/run", "POST", {});
      if (!result.ok) {
        setError(result.message || result.code);
        return;
      }
      const run = result.data.lastRun;
      setMessage(result.data.ran ? labels.finished : labels.disabled);
      if (run) {
        startTransition(() => {
          setCurrent(run);
          if (run.status === "ok" || run.status === "skipped") setPreviousSuccess(run);
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6 grid gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Timer className="size-5 text-teal-600" aria-hidden />
            {labels.title}
          </h2>
          <p className="mt-1 text-sm text-fg-muted">{labels.subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={enabled ? "success" : "warning"}>{enabled ? labels.enabled : labels.disabled}</Badge>
          {canRun ? (
            <Button type="button" onClick={runNow} disabled={busy || pending} aria-busy={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
              {busy ? labels.running : labels.runNow}
            </Button>
          ) : null}
        </div>
      </div>

      {message ? (
        <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300" role="status">
          <CheckCircle2 className="size-4" aria-hidden />
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="flex items-center gap-2 text-sm text-danger" role="alert">
          <AlertTriangle className="size-4" aria-hidden />
          {error}
        </p>
      ) : null}

      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={labels.lastRun} value={current ? formatter(current.startedAt) : labels.never} />
        <Stat label={labels.status} value={current ? statusLabel(current.status) : "—"} tone={current ? TONES[current.status] ?? "neutral" : undefined} />
        <Stat label={labels.lastSuccess} value={previousSuccess ? formatter(previousSuccess.startedAt) : labels.never} />
        <Stat
          label={`${labels.processed} / ${labels.created} / ${labels.escalated}`}
          value={current ? `${current.processed} / ${current.created} / ${current.escalated}` : "—"}
        />
      </dl>

      {current?.note ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
          <strong className="me-1">{labels.note}:</strong>
          {current.note}
        </p>
      ) : null}
      {current?.error ? (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-700/60 dark:bg-red-950/40 dark:text-red-200" role="alert">
          <strong className="me-1">{labels.error}:</strong>
          {current.error}
        </p>
      ) : null}

      <p className="flex items-center gap-2 text-xs text-fg-muted">
        <Activity className="size-4" aria-hidden />
        {current?.jobKey ? `${current.jobKey} · ${statusLabel(current.status)}` : ""}
      </p>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="rounded-md border border-border bg-surface-2 px-4 py-3">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="mt-1 text-sm font-semibold" data-tone={tone} lang="fa">
        {value}
      </dd>
    </div>
  );
}
