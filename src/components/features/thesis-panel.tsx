"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, FileText, Gauge, Loader2, Upload } from "lucide-react";
import { Alert, Badge, Button, Card, EmptyState, type Tone } from "@/components/ui";
import { Input, Textarea } from "@/components/ui/form";
import { apiRequest } from "./api-client";
import type { Dictionary } from "@/i18n/dictionaries";
import { formatNumber } from "@/lib/format";

/**
 * M8 client panels — the versioned thesis file and the similarity check.
 *
 * A version always points at a file that was really uploaded to the case, so the
 * UI cannot show a version without a document. The similarity verdict is computed
 * on the server against the configured limit and the message shown here is the
 * very same Persian text the rule engine returns.
 */

const VERSION_TONE: Record<string, Tone> = { draft: "neutral", submitted: "info", approved: "success", revision_required: "warning", rejected: "danger" };
const CHECK_TONE: Record<string, Tone> = { pass: "success", revision_required: "warning", pending: "neutral" };

export interface ThesisVersionView {
  id: string;
  version: number;
  isActive: boolean;
  titleFa: string | null;
  fileId: string;
  changeReason: string | null;
  status: string;
  submittedByName: string | null;
  fileName: string | null;
  submittedAt: string | Date | null;
  decisionReason: string | null;
}

export interface SimilarityCheckView {
  id: string;
  similarityPercent: number | null;
  maxPercentAtTime: number | null;
  result: string;
  reportId: string | null;
  checkedAt: string | Date | null;
  registeredByName: string | null;
  certificateFileId: string | null;
}

export function thesisStatusLabel(dict: Dictionary, status: string): string {
  const map: Record<string, string> = {
    draft: dict.thesis.statusDraft,
    submitted: dict.thesis.statusSubmitted,
    approved: dict.thesis.statusApproved,
    revision_required: dict.thesis.statusRevision,
    rejected: dict.thesis.statusRejected,
  };
  return map[status] ?? status;
}

async function uploadToCase(caseId: string, file: File, purpose: string): Promise<{ id: string | null; error: string | null }> {
  const body = new FormData();
  body.set("file", file);
  body.set("purpose", purpose);
  const response = await fetch(`/api/cases/${caseId}/files`, { method: "POST", body, credentials: "same-origin" });
  const json = (await response.json().catch(() => null)) as { ok: boolean; data?: { fileId?: string }; error?: { message?: string } } | null;
  if (!json?.ok || !json.data?.fileId) return { id: null, error: json?.error?.message ?? null };
  return { id: json.data.fileId, error: null };
}

export function ThesisVersionPanel({ caseId, dict, permissions }: { caseId: string; dict: Dictionary; permissions: string[] }) {
  const router = useRouter();
  const [versions, setVersions] = useState<ThesisVersionView[]>([]);
  const [similarityMessage, setSimilarityMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [changeReason, setChangeReason] = useState("");
  const [titleFa, setTitleFa] = useState("");

  const [reason, setReason] = useState("");
  const [decideFor, setDecideFor] = useState<{ id: string; decision: string } | null>(null);

  const canSubmit = permissions.includes("cases.submit_topic");
  const canReview = permissions.includes("cases.review_topic");

  useEffect(() => {
    let alive = true;
    void apiRequest<{ versions: ThesisVersionView[]; similarityMessage: string | null }>(`/api/cases/${caseId}/thesis`, "GET").then((result) => {
      if (!alive) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.message || dict.thesis.errorLoading);
        return;
      }
      setVersions(result.data.versions);
      setSimilarityMessage(result.data.similarityMessage);
      setError(null);
    });
    return () => {
      alive = false;
    };
  }, [caseId, dict.thesis.errorLoading]);

  async function reload() {
    const result = await apiRequest<{ versions: ThesisVersionView[]; similarityMessage: string | null }>(`/api/cases/${caseId}/thesis`, "GET");
    if (result.ok) {
      setVersions(result.data.versions);
      setSimilarityMessage(result.data.similarityMessage);
    }
  }

  async function decideVersion(versionId: string, decision: string, reasonText: string | null) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await apiRequest(`/api/cases/${caseId}/thesis/${versionId}/decision`, "POST", { decision, reason: reasonText });
    setBusy(false);
    if (!result.ok) {
      setError(result.message || result.code);
      return;
    }
    setDecideFor(null);
    setReason("");
    setSuccess(decision === "approve" ? dict.thesis.versionApproved : decision === "reject" ? dict.thesis.versionRejected : dict.thesis.versionRevision);
    await reload();
    router.refresh();
  }

  async function submitVersion() {
    if (!fileId) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await apiRequest(`/api/cases/${caseId}/thesis`, "POST", {
      fileId,
      titleFa: titleFa || null,
      changeReason: changeReason || null,
      submitForReview: true,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message || result.code);
      return;
    }
    setFileId(null);
    setFileName(null);
    setChangeReason("");
    setTitleFa("");
    setSuccess(dict.thesis.versionSubmitted);
    await reload();
    router.refresh();
  }

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-border p-4">
        <FileText className="size-5" aria-hidden />
        <h2 className="text-base font-semibold">{dict.thesis.versionsTitle}</h2>
      </div>
      <div className="grid gap-4 p-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {success ? <Alert tone="success">{success}</Alert> : null}
        {similarityMessage ? <Alert tone="warning">{similarityMessage}</Alert> : null}

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-fg-muted" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {dict.thesis.loading}
          </p>
        ) : versions.length === 0 ? (
          <EmptyState title={dict.thesis.versionsEmpty} text={dict.thesis.versionsEmptyHint} />
        ) : (
          <ul className="grid gap-2">
            {versions.map((row) => (
              <li key={row.id} className="grid gap-2 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={VERSION_TONE[row.status] ?? "neutral"}>{thesisStatusLabel(dict, row.status)}</Badge>
                  {row.isActive ? <Badge tone="primary">{dict.thesis.activeVersion}</Badge> : null}
                  <span className="text-sm font-medium">{`${dict.thesis.versionLabel} ${formatNumber(row.version, "fa")}`}</span>
                  {row.fileName ? (
                    <a className="text-xs text-primary underline" href={`/api/files/${row.fileId}/download`}>
                      {row.fileName}
                    </a>
                  ) : null}
                </div>
                {row.titleFa ? <p className="text-sm">{row.titleFa}</p> : null}
                {row.changeReason ? <p className="text-xs text-fg-muted">{`${dict.thesis.changeReason}: ${row.changeReason}`}</p> : null}
                {row.submittedByName ? <p className="text-xs text-fg-muted">{`${dict.thesis.submittedBy}: ${row.submittedByName}`}</p> : null}
                {row.decisionReason ? <p className="text-xs text-amber-700 dark:text-amber-300">{row.decisionReason}</p> : null}
                {canReview && row.status === "submitted" ? (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" disabled={busy} aria-busy={busy} onClick={() => decideVersion(row.id, "approve", null)}>
                      <Check className="size-4" aria-hidden />
                      {dict.thesis.approve}
                    </Button>
                    <Button variant="secondary" disabled={busy} onClick={() => { setDecideFor({ id: row.id, decision: "request_revision" }); setReason(""); }}>
                      {dict.thesis.requestRevision}
                    </Button>
                    <Button variant="danger" disabled={busy} onClick={() => { setDecideFor({ id: row.id, decision: "reject" }); setReason(""); }}>
                      {dict.thesis.rejectVersion}
                    </Button>
                  </div>
                ) : null}
                {decideFor?.id === row.id ? (
                  <div className="grid gap-2 rounded-md border border-border bg-surface-2 p-3">
                    <Textarea label={dict.thesis.changeReason} required value={reason} onChange={(e) => setReason(e.target.value)} hint={dict.thesis.reasonRequired} />
                    <div className="flex gap-2">
                      <Button
                        variant={decideFor.decision === "reject" ? "danger" : "primary"}
                        disabled={busy || reason.trim().length < 5}
                        onClick={() => decideVersion(row.id, decideFor.decision, reason)}
                      >
                        {decideFor.decision === "reject" ? dict.thesis.rejectVersion : dict.thesis.requestRevision}
                      </Button>
                      <Button variant="ghost" onClick={() => setDecideFor(null)}>
                        {dict.common.cancel}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canSubmit ? (
          <div className="grid gap-3 rounded-lg border border-dashed border-border p-3">
            <Input label={dict.thesis.titleFa} value={titleFa} onChange={(e) => setTitleFa(e.target.value)} />
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <Upload className="size-4" aria-hidden />
              {dict.thesis.uploadFile}
            </label>
            <input
              type="file"
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="min-h-11 text-sm"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setUploading(true);
                void uploadToCase(caseId, file, "thesis").then(({ id, error: uploadError }) => {
                  setUploading(false);
                  if (!id) {
                    setError(uploadError ?? dict.common.unknownError);
                    return;
                  }
                  setFileId(id);
                  setFileName(file.name);
                });
              }}
            />
            {uploading ? (
              <span className="flex items-center gap-2 text-xs text-fg-muted" role="status">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {dict.thesis.uploading}
              </span>
            ) : null}
            {fileName ? <span className="text-xs text-emerald-700 dark:text-emerald-300">{`${dict.thesis.fileReady}: ${fileName}`}</span> : null}
            {versions.length > 0 ? (
              <Textarea
                label={dict.thesis.changeReason}
                required
                value={changeReason}
                onChange={(e) => setChangeReason(e.target.value)}
                hint={dict.thesis.changeReasonHint}
              />
            ) : null}
            <Button
              variant="primary"
              disabled={busy || uploading || !fileId || (versions.length > 0 && changeReason.trim().length < 5)}
              aria-busy={busy}
              onClick={submitVersion}
            >
              {versions.length === 0 ? dict.thesis.submitVersion : dict.thesis.submitNewVersion}
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function SimilarityPanel({ caseId, dict, permissions }: { caseId: string; dict: Dictionary; permissions: string[] }) {
  const router = useRouter();
  const [checks, setChecks] = useState<SimilarityCheckView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [percent, setPercent] = useState("0");
  const [reportId, setReportId] = useState("");
  const [checkedAt, setCheckedAt] = useState("");

  const canRecord = permissions.includes("cases.review_topic") || permissions.includes("cases.submit_topic");

  useEffect(() => {
    let alive = true;
    void apiRequest<{ checks: SimilarityCheckView[] }>(`/api/cases/${caseId}/similarity`, "GET").then((result) => {
      if (!alive) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.message || dict.thesis.errorLoading);
        return;
      }
      setChecks(result.data.checks);
      setError(null);
    });
    return () => {
      alive = false;
    };
  }, [caseId, dict.thesis.errorLoading]);

  async function reload() {
    const result = await apiRequest<{ checks: SimilarityCheckView[] }>(`/api/cases/${caseId}/similarity`, "GET");
    if (result.ok) setChecks(result.data.checks);
  }

  async function record() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await apiRequest<{ messageFa: string }>(`/api/cases/${caseId}/similarity`, "POST", {
      similarityPercent: Number(percent) || 0,
      reportId: reportId || null,
      checkedAt: checkedAt || null,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message || result.code);
      return;
    }
    setSuccess(result.data.messageFa);
    await reload();
    router.refresh();
  }

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-border p-4">
        <Gauge className="size-5" aria-hidden />
        <h2 className="text-base font-semibold">{dict.thesis.similarityTitle}</h2>
      </div>
      <div className="grid gap-4 p-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {success ? <Alert tone="success">{success}</Alert> : null}
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-fg-muted" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {dict.thesis.loading}
          </p>
        ) : checks.length === 0 ? (
          <EmptyState title={dict.thesis.similarityEmpty} text={dict.thesis.similarityEmptyHint} />
        ) : (
          <ul className="grid gap-2">
            {checks.map((row) => (
              <li key={row.id} className="grid gap-1 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={CHECK_TONE[row.result] ?? "neutral"}>
                    {row.result === "pass" ? dict.thesis.resultPass : dict.thesis.resultRevision}
                  </Badge>
                  <span className="text-sm font-medium">
                    {`${formatNumber(row.similarityPercent ?? 0, "fa")}٪ / ${dict.thesis.limit}: ${formatNumber(row.maxPercentAtTime ?? 0, "fa")}٪`}
                  </span>
                  {row.reportId ? <span className="text-xs text-fg-muted">{`${dict.thesis.reportId}: ${row.reportId}`}</span> : null}
                </div>
                <p className="text-xs text-fg-muted">
                  {row.checkedAt ? `${dict.thesis.checkedAt}: ${String(row.checkedAt).slice(0, 10)}` : ""}
                  {row.registeredByName ? ` · ${dict.thesis.registeredBy}: ${row.registeredByName}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}

        {canRecord && !checks.some((c) => c.result === "pass") ? (
          <div className="grid gap-3 rounded-lg border border-dashed border-border p-3">
            <p className="flex items-center gap-2 text-xs text-fg-muted">
              <AlertTriangle className="size-4" aria-hidden />
              {dict.thesis.similarityLimitNote}
            </p>
            <Input label={dict.thesis.percent} type="number" value={percent} onChange={(e) => setPercent(e.target.value)} />
            <Input label={dict.thesis.reportId} value={reportId} onChange={(e) => setReportId(e.target.value)} />
            <Input label={dict.thesis.checkedAt} type="date" value={checkedAt} onChange={(e) => setCheckedAt(e.target.value)} />
            <Button variant="primary" disabled={busy} aria-busy={busy} onClick={record}>
              <Check className="size-4" aria-hidden />
              {dict.thesis.recordCheck}
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
