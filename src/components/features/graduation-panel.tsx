"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, GraduationCap, Loader2, ShieldCheck, X } from "lucide-react";
import { Alert, Badge, Button, Card, EmptyState, type Tone } from "@/components/ui";
import { Textarea } from "@/components/ui/form";
import { apiRequest } from "./api-client";
import type { Dictionary } from "@/i18n/dictionaries";

/**
 * M10 client panel — graduation request, review and closure.
 *
 * The verdict that blocks or allows a step is produced by the rule engine on the
 * server; when it denies, the panel shows exactly the Persian reasons it returned.
 * The same text would appear for a tampered request, because the decision is never
 * taken in the browser.
 */

const STATUS_TONE: Record<string, Tone> = { requested: "info", approved: "success", rejected: "danger" };

export interface GraduationRecordView {
  id: string;
  status: string;
  thesisVersionId: string | null;
  note: string | null;
  decisionReason: string | null;
  requestedByName: string | null;
  decidedByName: string | null;
  decidedAt: string | Date | null;
  createdAt: string | Date;
}

export interface ClosureView {
  id: string;
  closedAt: string | Date;
  reason: string | null;
}

export function graduationStatusLabel(dict: Dictionary, status: string): string {
  if (status === "approved") return dict.graduation.statusApproved;
  if (status === "rejected") return dict.graduation.statusRejected;
  return dict.graduation.statusRequested;
}

export function GraduationPanel({ caseId, dict, permissions }: { caseId: string; dict: Dictionary; permissions: string[] }) {
  const router = useRouter();
  const [records, setRecords] = useState<GraduationRecordView[]>([]);
  const [closures, setClosures] = useState<ClosureView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [closeReason, setCloseReason] = useState("");
  const [ruleReasons, setRuleReasons] = useState<string[]>([]);

  const canRequest = permissions.includes("cases.submit_topic");
  const canDecide = permissions.includes("cases.archive") || permissions.includes("cases.review_topic");
  const canClose = permissions.includes("cases.archive") && closures.length === 0;

  useEffect(() => {
    let alive = true;
    void apiRequest<{ records: GraduationRecordView[]; closures: ClosureView[] }>(`/api/cases/${caseId}/graduation`, "GET").then((result) => {
      if (!alive) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.message || dict.graduation.errorLoading);
        return;
      }
      setRecords(result.data.records);
      setClosures(result.data.closures);
      setError(null);
    });
    // The closure gate shown to the reviewer is the rule engine's own verdict.
    void apiRequest<{ evaluations: Array<{ name: string; allowed: boolean; reasons: string[] }> }>(`/api/cases/${caseId}/rules`, "GET").then((rules) => {
      if (!alive || !rules.ok) return;
      const close = rules.data.evaluations.find((e) => e.name === "canCloseCase");
      setRuleReasons(close ? close.reasons : []);
    });
    return () => {
      alive = false;
    };
  }, [caseId, dict.graduation.errorLoading]);

  async function reload() {
    const result = await apiRequest<{ records: GraduationRecordView[]; closures: ClosureView[] }>(`/api/cases/${caseId}/graduation`, "GET");
    if (result.ok) {
      setRecords(result.data.records);
      setClosures(result.data.closures);
    }
  }

  /** The rule engine's own reasons, listed so the user sees what is missing. */
  async function loadReasons() {
    const result = await apiRequest<{ evaluations: Array<{ name: string; allowed: boolean; reasons: string[] }> }>(`/api/cases/${caseId}/rules`, "GET");
    if (!result.ok) return;
    const close = result.data.evaluations.find((e) => e.name === "canCloseCase");
    setRuleReasons(close ? close.reasons : []);
  }

  async function request() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await apiRequest(`/api/cases/${caseId}/graduation`, "POST", { note: note || null });
    setBusy(false);
    if (!result.ok) {
      setError(result.message || result.code);
      return;
    }
    setNote("");
    setSuccess(dict.graduation.requested);
    await reload();
    router.refresh();
  }

  async function decide(recordId: string, decision: "approve" | "reject", reasonText: string | null) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await apiRequest(`/api/cases/${caseId}/graduation/${recordId}/decision`, "POST", { decision, reason: reasonText });
    setBusy(false);
    if (!result.ok) {
      setError(result.message || result.code);
      return;
    }
    setRejectFor(null);
    setRejectReason("");
    setSuccess(decision === "approve" ? dict.graduation.approved : dict.graduation.rejected);
    await reload();
    void loadReasons();
    router.refresh();
  }

  async function close() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await apiRequest(`/api/cases/${caseId}/close`, "POST", { reason: closeReason });
    setBusy(false);
    if (!result.ok) {
      setError(result.message || result.code);
      void loadReasons();
      return;
    }
    setCloseReason("");
    setSuccess(dict.graduation.closed);
    await reload();
    router.refresh();
  }

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-border p-4">
        <GraduationCap className="size-5" aria-hidden />
        <h2 className="text-base font-semibold">{dict.graduation.title}</h2>
      </div>
      <div className="grid gap-4 p-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {success ? <Alert tone="success">{success}</Alert> : null}

        {closures.length > 0 ? (
          <Alert tone="success">
            {`${dict.graduation.closedAt}: ${String(closures[0].closedAt).slice(0, 10)}${closures[0].reason ? ` — ${closures[0].reason}` : ""}`}
          </Alert>
        ) : null}

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-fg-muted" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {dict.graduation.loading}
          </p>
        ) : records.length === 0 ? (
          <EmptyState title={dict.graduation.empty} text={dict.graduation.emptyHint} />
        ) : (
          <ul className="grid gap-2">
            {records.map((row) => (
              <li key={row.id} className="grid gap-2 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>{graduationStatusLabel(dict, row.status)}</Badge>
                  {row.requestedByName ? <span className="text-xs text-fg-muted">{`${dict.graduation.requestedBy}: ${row.requestedByName}`}</span> : null}
                  {row.decidedByName ? <span className="text-xs text-fg-muted">{` · ${dict.graduation.decidedBy}: ${row.decidedByName}`}</span> : null}
                </div>
                {row.note ? <p className="text-sm">{row.note}</p> : null}
                {row.decisionReason ? <p className="text-xs text-amber-700 dark:text-amber-300">{`${dict.graduation.decisionReason}: ${row.decisionReason}`}</p> : null}
                {canDecide && row.status === "requested" ? (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" disabled={busy} aria-busy={busy} onClick={() => decide(row.id, "approve", null)}>
                      <Check className="size-4" aria-hidden />
                      {dict.graduation.approve}
                    </Button>
                    <Button variant="danger" disabled={busy} onClick={() => { setRejectFor(row.id); setRejectReason(""); }}>
                      <X className="size-4" aria-hidden />
                      {dict.graduation.reject}
                    </Button>
                  </div>
                ) : null}
                {rejectFor === row.id ? (
                  <div className="grid gap-2 rounded-md border border-border bg-surface-2 p-3">
                    <Textarea label={dict.graduation.decisionReason} required value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                    <p className="text-xs text-fg-muted">{dict.graduation.reasonRequired}</p>
                    <div className="flex gap-2">
                      <Button variant="danger" disabled={busy || rejectReason.trim().length < 5} onClick={() => decide(row.id, "reject", rejectReason)}>
                        {dict.graduation.reject}
                      </Button>
                      <Button variant="ghost" onClick={() => setRejectFor(null)}>
                        {dict.common.cancel}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canRequest && !closures.length ? (
          <div className="grid gap-3 rounded-lg border border-dashed border-border p-3">
            <Textarea label={dict.graduation.note} value={note} onChange={(e) => setNote(e.target.value)} />
            <Button variant="primary" disabled={busy} aria-busy={busy} onClick={request}>
              {dict.graduation.request}
            </Button>
          </div>
        ) : null}

        {canClose ? (
          <div className="grid gap-3 rounded-lg border border-dashed border-border p-3">
            <p className="flex items-center gap-2 text-xs text-fg-muted">
              <ShieldCheck className="size-4" aria-hidden />
              {dict.graduation.closeGate}
            </p>
            {ruleReasons.length > 0 ? (
              <ul className="grid list-inside list-disc gap-1 text-xs text-amber-700 dark:text-amber-300">
                {ruleReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
            <Textarea label={dict.graduation.closeReason} required value={closeReason} onChange={(e) => setCloseReason(e.target.value)} />
            <Button variant="secondary" disabled={busy || closeReason.trim().length < 5} aria-busy={busy} onClick={close}>
              {dict.graduation.close}
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
