"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, FileClock, GitCompare, Loader2, Send, X } from "lucide-react";
import { Alert, Badge, Button, Card, EmptyState, type Tone } from "@/components/ui";
import { Input, Textarea } from "@/components/ui/form";
import { apiRequest } from "./api-client";
import type { Dictionary } from "@/i18n/dictionaries";

/**
 * M4 client panels: the versioned topic workflow and the literature-review workflow.
 *
 * The UI only offers what the viewer is entitled to; every action is re-checked on the
 * server (permission, status, mandatory reason, configured stage limit). Attachments are
 * referenced by the id of a file already uploaded to the case, so no second copy of a
 * document ever exists.
 */

const TOPIC_TONE: Record<string, Tone> = {
  draft: "neutral",
  pending_supervisor: "info",
  pending_group: "primary",
  approved: "success",
  revision_required: "warning",
  rejected: "danger",
};

export interface TopicVersionView {
  id: string;
  version: number;
  titleFa: string;
  titleEn: string | null;
  keywords: string | null;
  description: string | null;
  status: string;
  isActive: boolean;
  changeReason: string | null;
  fileId: string | null;
  submittedByName: string | null;
  submittedAt: string | Date | null;
  decisionReason: string | null;
  reviewStage: string | null;
}

export function topicStatusLabel(dict: Dictionary, status: string): string {
  switch (status) {
    case "draft":
      return dict.topic.statusDraft;
    case "pending_supervisor":
      return dict.topic.statusPendingSupervisor;
    case "pending_group":
      return dict.topic.statusPendingGroup;
    case "approved":
      return dict.topic.statusApproved;
    case "revision_required":
      return dict.topic.statusRevision;
    case "rejected":
      return dict.topic.statusRejected;
    default:
      return status;
  }
}

function Diff({ previous, current, dict }: { previous: TopicVersionView | null; current: TopicVersionView; dict: Dictionary }) {
  if (!previous) {
    return <p className="text-xs text-fg-muted">{dict.topic.diffNone}</p>;
  }
  const fields: Array<{ label: string; before: string | null; after: string | null }> = [
    { label: dict.topic.titleFa, before: previous.titleFa, after: current.titleFa },
    { label: dict.topic.titleEn, before: previous.titleEn, after: current.titleEn },
    { label: dict.topic.keywords, before: previous.keywords, after: current.keywords },
    { label: dict.topic.description, before: previous.description, after: current.description },
  ];
  const changed = fields.filter((f) => (f.before ?? "") !== (f.after ?? ""));
  if (changed.length === 0) return <p className="text-xs text-fg-muted">{dict.topic.diffNone}</p>;
  return (
    <ul className="grid gap-2 text-xs">
      {changed.map((f) => (
        <li key={f.label} className="rounded-md border border-border bg-surface-2 p-3">
          <p className="mb-1 font-medium">{f.label}</p>
          <p className="text-fg-muted">
            <span className="me-1 line-through decoration-danger/60">{f.before || "—"}</span>
          </p>
          <p className="text-emerald-700 dark:text-emerald-300">{f.after || "—"}</p>
        </li>
      ))}
    </ul>
  );
}

export function TopicVersionsPanel({
  caseId,
  dict,
  permissions,
  canSubmit,
}: {
  caseId: string;
  dict: Dictionary;
  permissions: string[];
  canSubmit: boolean;
}) {
  const router = useRouter();
  const [versions, setVersions] = useState<TopicVersionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<{ id: string; decision: string } | null>(null);
  const [reason, setReason] = useState("");
  const [form, setForm] = useState({ titleFa: "", titleEn: "", keywords: "", description: "", fileId: "", changeReason: "" });

  const reload = useCallback(async () => {
    const result = await apiRequest<{ versions: TopicVersionView[] }>(`/api/cases/${caseId}/topic/versions`, "GET");
    if (result.ok) {
      setVersions(result.data.versions);
      setError(null);
    } else {
      setError(result.message || dict.topic.loadError);
    }
    setLoading(false);
  }, [caseId, dict.topic.loadError]);

  useEffect(() => {
    // Initial read only; every mutation calls `reload` explicitly.
    let alive = true;
    apiRequest<{ versions: TopicVersionView[] }>(`/api/cases/${caseId}/topic/versions`, "GET").then((result) => {
      if (!alive) return;
      if (result.ok) {
        setVersions(result.data.versions);
        setError(null);
      } else {
        setError(result.message || dict.topic.loadError);
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [caseId, dict.topic.loadError]);

  const activeVersion = versions.find((v) => v.isActive) ?? null;

  async function submit(submitForReview: boolean) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await apiRequest(`/api/cases/${caseId}/topic/versions`, "POST", {
      titleFa: form.titleFa,
      titleEn: form.titleEn || null,
      keywords: form.keywords || null,
      description: form.description || null,
      fileId: form.fileId || null,
      changeReason: form.changeReason || null,
      submitForReview,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message || result.code);
      return;
    }
    setSuccess(submitForReview ? dict.topic.submitted : dict.topic.saved);
    setForm({ titleFa: "", titleEn: "", keywords: "", description: "", fileId: "", changeReason: "" });
    setOpen(false);
    await reload();
    router.refresh();
  }

  async function decide(versionId: string, decision: string, decisionReason: string | null) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await apiRequest(`/api/cases/${caseId}/topic/versions/${versionId}/decision`, "POST", { decision, reason: decisionReason });
    setBusy(false);
    if (!result.ok) {
      setError(result.message || result.code);
      return;
    }
    setReason("");
    setReasonFor(null);
    await reload();
    router.refresh();
  }

  function actionsFor(version: TopicVersionView) {
    const actions: Array<{ decision: string; label: string; variant?: "primary" | "secondary" | "danger"; needsReason?: boolean }> = [];
    if (version.status === "pending_supervisor" && (permissions.includes("cases.review_topic") || permissions.includes("cases.view_all"))) {
      actions.push({ decision: "approve_supervisor", label: dict.topic.approveSupervisor, variant: "primary" });
      actions.push({ decision: "request_revision", label: dict.topic.requestRevision, variant: "secondary", needsReason: true });
      actions.push({ decision: "reject", label: dict.topic.reject, variant: "danger", needsReason: true });
    } else if (version.status === "pending_group" && permissions.includes("cases.approve_topic_group")) {
      actions.push({ decision: "approve_group", label: dict.topic.approveGroup, variant: "primary" });
      actions.push({ decision: "request_revision", label: dict.topic.requestRevision, variant: "secondary", needsReason: true });
      actions.push({ decision: "reject", label: dict.topic.reject, variant: "danger", needsReason: true });
    }
    return actions;
  }

  return (
    <Card className="grid gap-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <FileClock className="size-5 text-primary" aria-hidden />
            {dict.topic.title}
          </h2>
          <p className="mt-1 text-sm text-fg-muted">{dict.topic.subtitle}</p>
        </div>
        {canSubmit ? (
          <Button variant={open ? "secondary" : "primary"} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {activeVersion ? dict.topic.changeTopic : dict.topic.newVersion}
          </Button>
        ) : null}
      </div>

      {error ? (
        <Alert tone="danger">
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4" aria-hidden />
            {error}
          </span>
        </Alert>
      ) : null}
      {success ? (
        <Alert tone="success">
          <span className="flex items-center gap-2">
            <Check className="size-4" aria-hidden />
            {success}
          </span>
        </Alert>
      ) : null}

      <p className="text-sm">
        <span className="me-2 text-fg-muted">{dict.topic.activeVersion}:</span>
        {activeVersion ? <Badge tone="success">{`${dict.topic.versionLabel} ${activeVersion.version}`}</Badge> : <span className="text-fg-muted">{dict.topic.noActive}</span>}
      </p>

      {open && canSubmit ? (
        <div className="grid gap-4 rounded-lg border border-border p-4">
          <Input label={dict.topic.titleFa} required value={form.titleFa} onChange={(e) => setForm({ ...form, titleFa: e.target.value })} />
          <Input label={dict.topic.titleEn} dir="ltr" className="text-start" value={form.titleEn} onChange={(e) => setForm({ ...form, titleEn: e.target.value })} />
          <Input label={dict.topic.keywords} value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} />
          <Textarea label={dict.topic.description} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          {activeVersion ? (
            <>
              <Textarea label={dict.topic.changeReason} hint={dict.topic.changeReasonHint} required value={form.changeReason} onChange={(e) => setForm({ ...form, changeReason: e.target.value })} />
              <Input label={dict.topic.fileId} dir="ltr" className="text-start" hint={dict.topic.attachFileHint} value={form.fileId} onChange={(e) => setForm({ ...form, fileId: e.target.value })} />
            </>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => submit(false)} disabled={busy || form.titleFa.trim().length < 5} aria-busy={busy}>
              {dict.topic.saveDraft}
            </Button>
            <Button onClick={() => submit(true)} disabled={busy || form.titleFa.trim().length < 5} aria-busy={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
              {dict.topic.submit}
            </Button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {dict.topic.loading}
        </p>
      ) : versions.length === 0 ? (
        <EmptyState title={dict.topic.noVersions} />
      ) : (
        <ol className="grid gap-3">
          {versions.map((version, index) => {
            const previous = versions[index + 1] ?? null;
            const actions = actionsFor(version);
            return (
              <li key={version.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge tone={TOPIC_TONE[version.status] ?? "neutral"}>{`${dict.topic.versionLabel} ${version.version}`}</Badge>
                    <span className="text-sm">{topicStatusLabel(dict, version.status)}</span>
                    {version.isActive ? <Badge tone="success">{dict.topic.activeVersion}</Badge> : null}
                  </div>
                  <button
                    type="button"
                    className="flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-primary hover:bg-surface-2"
                    aria-expanded={expanded === version.id}
                    onClick={() => setExpanded(expanded === version.id ? null : version.id)}
                  >
                    <GitCompare className="size-4" aria-hidden />
                    {dict.topic.diff}
                  </button>
                </div>
                <p className="mt-2 font-medium">{version.titleFa}</p>
                {version.titleEn ? <p className="text-sm text-fg-muted" dir="ltr">{version.titleEn}</p> : null}
                {version.changeReason ? <p className="mt-1 text-xs text-fg-muted">{dict.topic.changeReason}: {version.changeReason}</p> : null}
                {version.decisionReason ? <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{dict.topic.reason}: {version.decisionReason}</p> : null}
                <p className="mt-1 text-xs text-fg-muted">
                  {version.submittedByName ?? ""} {version.submittedAt ? `· ${String(version.submittedAt).slice(0, 10)}` : ""}
                </p>

                {expanded === version.id ? (
                  <div className="mt-3">
                    <Diff previous={previous} current={version} dict={dict} />
                  </div>
                ) : null}

                {actions.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {actions.map((action) =>
                      action.needsReason ? (
                        <Button
                          key={action.decision}
                          variant={action.variant}
                          onClick={() => {
                            setReasonFor({ id: version.id, decision: action.decision });
                            setReason("");
                          }}
                          disabled={busy}
                        >
                          {action.label}
                        </Button>
                      ) : (
                        <Button key={action.decision} variant={action.variant} onClick={() => decide(version.id, action.decision, null)} disabled={busy} aria-busy={busy}>
                          {action.label}
                        </Button>
                      ),
                    )}
                  </div>
                ) : null}

                {reasonFor?.id === version.id ? (
                  <div className="mt-3 grid gap-3 rounded-md border border-border bg-surface-2 p-3">
                    <Textarea label={dict.topic.reason} required value={reason} onChange={(e) => setReason(e.target.value)} />
                    <p className="text-xs text-fg-muted">{dict.topic.reasonRequired}</p>
                    <div className="flex gap-2">
                      <Button
                        variant={reasonFor.decision === "reject" ? "danger" : "primary"}
                        disabled={busy || reason.trim().length < 5}
                        onClick={() => decide(version.id, reasonFor.decision, reason)}
                        aria-busy={busy}
                      >
                        {reasonFor.decision === "reject" ? dict.topic.reject : dict.topic.requestRevision}
                      </Button>
                      <Button variant="ghost" onClick={() => setReasonFor(null)}>
                        <X className="size-4" aria-hidden />
                        {dict.common.cancel}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Literature review
// ---------------------------------------------------------------------------

export interface LiteratureVersionView {
  id: string;
  version: number;
  summaryFa: string;
  objectivesFa: string | null;
  gapFa: string | null;
  keywords: string | null;
  referencesCount: number | null;
  status: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  decisionReason: string | null;
}

export interface LiteratureReviewView {
  id: string;
  status: string;
  isActive: boolean;
  rounds: number;
  versions: LiteratureVersionView[];
}

const LIT_TONE: Record<string, Tone> = {
  submitted: "info",
  approved: "success",
  revision_required: "warning",
  rejected: "danger",
};

export function literatureStatusLabel(dict: Dictionary, status: string): string {
  switch (status) {
    case "submitted":
      return dict.literature.statusSubmitted;
    case "approved":
      return dict.literature.statusApproved;
    case "revision_required":
      return dict.literature.statusRevision;
    case "rejected":
      return dict.literature.statusRejected;
    default:
      return status;
  }
}

export function LiteraturePanel({ caseId, dict, permissions }: { caseId: string; dict: Dictionary; permissions: string[] }) {
  const router = useRouter();
  const [reviews, setReviews] = useState<LiteratureReviewView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ summaryFa: "", objectivesFa: "", gapFa: "", keywords: "", referencesCount: "", fileId: "" });
  const [reasonFor, setReasonFor] = useState<{ id: string; decision: string } | null>(null);
  const [reason, setReason] = useState("");

  const reload = useCallback(async () => {
    const result = await apiRequest<{ reviews: LiteratureReviewView[] }>(`/api/cases/${caseId}/literature`, "GET");
    if (result.ok) {
      setReviews(result.data.reviews);
      setError(null);
    } else {
      setError(result.message || dict.literature.loadError);
    }
    setLoading(false);
  }, [caseId, dict.literature.loadError]);

  useEffect(() => {
    let alive = true;
    apiRequest<{ reviews: LiteratureReviewView[] }>(`/api/cases/${caseId}/literature`, "GET").then((result) => {
      if (!alive) return;
      if (result.ok) {
        setReviews(result.data.reviews);
        setError(null);
      } else {
        setError(result.message || dict.literature.loadError);
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [caseId, dict.literature.loadError]);

  async function submit() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await apiRequest(`/api/cases/${caseId}/literature`, "POST", {
      summaryFa: form.summaryFa,
      objectivesFa: form.objectivesFa || null,
      gapFa: form.gapFa || null,
      keywords: form.keywords || null,
      referencesCount: form.referencesCount === "" ? null : Number(form.referencesCount),
      fileId: form.fileId || null,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message || result.code);
      return;
    }
    setSuccess(dict.literature.submitted);
    setForm({ summaryFa: "", objectivesFa: "", gapFa: "", keywords: "", referencesCount: "", fileId: "" });
    await reload();
    router.refresh();
  }

  async function decide(versionId: string, decision: string, decisionReason: string | null) {
    setBusy(true);
    setError(null);
    const result = await apiRequest(`/api/cases/${caseId}/literature/${versionId}/decision`, "POST", { decision, reason: decisionReason });
    setBusy(false);
    if (!result.ok) {
      setError(result.message || result.code);
      return;
    }
    setReason("");
    setReasonFor(null);
    await reload();
    router.refresh();
  }

  const canReview = permissions.includes("cases.review_topic");
  const canSubmit = permissions.includes("cases.submit_literature");
  const latestStatus = reviews[0]?.status ?? null;
  const needsResubmit = reviews.some((r) => r.isActive && r.status === "in_review" && r.versions.some((v) => v.status === "revision_required"));

  return (
    <Card className="grid gap-5 p-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <FileClock className="size-5 text-teal-600" aria-hidden />
          {dict.literature.title}
        </h2>
        <p className="mt-1 text-sm text-fg-muted">{dict.literature.subtitle}</p>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {success ? <Alert tone="success">{success}</Alert> : null}

      {canSubmit && (!latestStatus || latestStatus !== "approved") ? (
        <div className="grid gap-4 rounded-lg border border-border p-4">
          <Textarea label={dict.literature.summaryFa} required value={form.summaryFa} onChange={(e) => setForm({ ...form, summaryFa: e.target.value })} />
          <Textarea label={dict.literature.objectivesFa} value={form.objectivesFa} onChange={(e) => setForm({ ...form, objectivesFa: e.target.value })} />
          <Textarea label={dict.literature.gapFa} value={form.gapFa} onChange={(e) => setForm({ ...form, gapFa: e.target.value })} />
          <Input label={dict.literature.keywords} value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} />
          <Input
            label={dict.literature.referencesCount}
            type="number"
            dir="ltr"
            className="text-start"
            hint={dict.literature.referencesHint}
            value={form.referencesCount}
            onChange={(e) => setForm({ ...form, referencesCount: e.target.value })}
          />
          <Input label={dict.topic.fileId} dir="ltr" className="text-start" hint={dict.topic.attachFileHint} value={form.fileId} onChange={(e) => setForm({ ...form, fileId: e.target.value })} />
          <div>
            <Button onClick={submit} disabled={busy || form.summaryFa.trim().length < 50} aria-busy={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
              {needsResubmit ? dict.literature.resubmit : dict.literature.submit}
            </Button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {dict.literature.loading}
        </p>
      ) : reviews.length === 0 ? (
        <EmptyState title={dict.literature.noReviews} />
      ) : (
        <ol className="grid gap-4">
          {reviews.map((review) => (
            <li key={review.id} className="rounded-lg border border-border p-4">
              <p className="mb-3 text-sm font-medium">{`${dict.literature.round} ${review.rounds}`}</p>
              <ul className="grid gap-3">
                {review.versions.map((version) => (
                  <li key={version.id} className="rounded-md bg-surface-2 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={LIT_TONE[version.status] ?? "neutral"}>{`${dict.topic.versionLabel} ${version.version}`}</Badge>
                      <span className="text-sm">{literatureStatusLabel(dict, version.status)}</span>
                      {version.referencesCount != null ? <span className="text-xs text-fg-muted">{dict.literature.referencesCount}: {version.referencesCount}</span> : null}
                    </div>
                    <p className="mt-2 text-sm">{version.summaryFa}</p>
                    {version.gapFa ? <p className="mt-1 text-xs text-fg-muted">{dict.literature.gapFa}: {version.gapFa}</p> : null}
                    {version.decisionReason ? <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{dict.literature.reason}: {version.decisionReason}</p> : null}

                    {canReview && version.status === "submitted" ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button variant="primary" onClick={() => decide(version.id, "approve", null)} disabled={busy} aria-busy={busy}>
                          {dict.literature.approve}
                        </Button>
                        <Button variant="secondary" onClick={() => { setReasonFor({ id: version.id, decision: "request_revision" }); setReason(""); }} disabled={busy}>
                          {dict.literature.requestRevision}
                        </Button>
                        <Button variant="danger" onClick={() => { setReasonFor({ id: version.id, decision: "reject" }); setReason(""); }} disabled={busy}>
                          {dict.literature.reject}
                        </Button>
                      </div>
                    ) : null}

                    {reasonFor?.id === version.id ? (
                      <div className="mt-3 grid gap-3 rounded-md border border-border bg-surface p-3">
                        <Textarea label={dict.literature.reason} required value={reason} onChange={(e) => setReason(e.target.value)} />
                        <p className="text-xs text-fg-muted">{dict.literature.reasonRequired}</p>
                        <div className="flex gap-2">
                          <Button variant={reasonFor.decision === "reject" ? "danger" : "primary"} disabled={busy || reason.trim().length < 5} onClick={() => decide(version.id, reasonFor.decision, reason)} aria-busy={busy}>
                            {reasonFor.decision === "reject" ? dict.literature.reject : dict.literature.requestRevision}
                          </Button>
                          <Button variant="ghost" onClick={() => setReasonFor(null)}>
                            <X className="size-4" aria-hidden />
                            {dict.common.cancel}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
