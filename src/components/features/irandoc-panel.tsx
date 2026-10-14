"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, FileCheck2, Loader2, Paperclip, Upload, X } from "lucide-react";
import { Alert, Badge, Button, Card, EmptyState, type Tone } from "@/components/ui";
import { Input, Textarea } from "@/components/ui/form";
import { apiRequest } from "./api-client";
import type { Dictionary } from "@/i18n/dictionaries";

/**
 * M6 client panel — the internal IranDoc registration and its review.
 *
 * The student records the tracking code and attaches the receipt; the graduate
 * office approves or rejects with a mandatory reason. Every action is re-checked
 * on the server, and the whole history stays visible (records are never deleted).
 */

const STATUS_TONE: Record<string, Tone> = { submitted: "info", approved: "success", rejected: "danger" };

export interface IrandocRecordView {
  id: string;
  trackingCode: string | null;
  registeredAt: string | Date | null;
  receiptFileId: string | null;
  status: string;
  rejectionReason: string | null;
  reviewedAt: string | Date | null;
  reviewedByName: string | null;
  submittedByName: string | null;
  createdAt: string | Date;
}

export function irandocStatusLabel(dict: Dictionary, status: string): string {
  switch (status) {
    case "submitted":
      return dict.irandoc.statusSubmitted;
    case "approved":
      return dict.irandoc.statusApproved;
    case "rejected":
      return dict.irandoc.statusRejected;
    default:
      return status;
  }
}

export function IrandocPanel({ caseId, dict, permissions }: { caseId: string; dict: Dictionary; permissions: string[] }) {
  const router = useRouter();
  const [records, setRecords] = useState<IrandocRecordView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [trackingCode, setTrackingCode] = useState("");
  const [registeredAt, setRegisteredAt] = useState("");
  const [receiptFileId, setReceiptFileId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const canSubmit = permissions.includes("cases.submit_topic");
  const canReview = permissions.includes("cases.review_topic");

  useEffect(() => {
    let alive = true;
    void apiRequest<{ records: IrandocRecordView[] }>(`/api/cases/${caseId}/irandoc`, "GET").then((result) => {
      if (!alive) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.message || dict.irandoc.errorLoading);
        return;
      }
      setRecords(result.data.records);
      setError(null);
    });
    return () => {
      alive = false;
    };
  }, [caseId, dict.irandoc.errorLoading]);

  async function reload() {
    const result = await apiRequest<{ records: IrandocRecordView[] }>(`/api/cases/${caseId}/irandoc`, "GET");
    if (result.ok) setRecords(result.data.records);
  }

  async function uploadReceipt(file: File) {
    setUploading(true);
    setError(null);
    const body = new FormData();
    body.set("file", file);
    body.set("purpose", "irandoc");
    const response = await fetch(`/api/cases/${caseId}/files`, { method: "POST", body, credentials: "same-origin" });
    const json = (await response.json().catch(() => null)) as { ok: boolean; data?: { fileId?: string }; error?: { message?: string } } | null;
    setUploading(false);
    if (!json?.ok || !json.data?.fileId) {
      setError(json?.error?.message ?? dict.common.unknownError);
      return;
    }
    setReceiptFileId(json.data.fileId);
    setSuccess(dict.irandoc.receiptUploaded);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await apiRequest(`/api/cases/${caseId}/irandoc`, "POST", {
      trackingCode,
      registeredAt: registeredAt || null,
      receiptFileId,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message || result.code);
      return;
    }
    setTrackingCode("");
    setRegisteredAt("");
    setReceiptFileId(null);
    setSuccess(dict.irandoc.submitted);
    await reload();
    router.refresh();
  }

  async function decide(recordId: string, decision: "approve" | "reject", reasonText: string | null) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await apiRequest(`/api/cases/${caseId}/irandoc/${recordId}/decision`, "POST", { decision, reason: reasonText });
    setBusy(false);
    if (!result.ok) {
      setError(result.message || result.code);
      return;
    }
    setReasonFor(null);
    setReason("");
    setSuccess(decision === "approve" ? dict.irandoc.approved : dict.irandoc.rejected);
    await reload();
    router.refresh();
  }

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-border p-4">
        <FileCheck2 className="size-5" aria-hidden />
        <h2 className="text-base font-semibold">{dict.irandoc.title}</h2>
      </div>

      <div className="grid gap-4 p-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {success ? <Alert tone="success">{success}</Alert> : null}

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-fg-muted" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {dict.irandoc.loading}
          </p>
        ) : records.length === 0 ? (
          <EmptyState title={dict.irandoc.empty} text={dict.irandoc.emptyHint} />
        ) : (
          <ul className="grid gap-3">
            {records.map((record) => (
              <li key={record.id} className="grid gap-2 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS_TONE[record.status] ?? "neutral"}>{irandocStatusLabel(dict, record.status)}</Badge>
                  <span className="text-sm font-medium">{record.trackingCode}</span>
                  {record.receiptFileId ? (
                    <span className="flex items-center gap-1 text-xs text-fg-muted">
                      <Paperclip className="size-3.5" aria-hidden />
                      {dict.irandoc.receiptAttached}
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-fg-muted">
                  {`${dict.irandoc.registeredAt}: ${record.registeredAt ? String(record.registeredAt).slice(0, 10) : "—"}`}
                  {record.submittedByName ? ` · ${dict.irandoc.submittedBy}: ${record.submittedByName}` : ""}
                  {record.reviewedByName ? ` · ${dict.irandoc.reviewedBy}: ${record.reviewedByName}` : ""}
                </p>
                {record.rejectionReason ? <p className="text-xs text-amber-700 dark:text-amber-300">{`${dict.irandoc.reason}: ${record.rejectionReason}`}</p> : null}

                {canReview && record.status === "submitted" ? (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" onClick={() => decide(record.id, "approve", null)} disabled={busy} aria-busy={busy}>
                      <Check className="size-4" aria-hidden />
                      {dict.irandoc.approve}
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => {
                        setReasonFor(record.id);
                        setReason("");
                      }}
                      disabled={busy}
                    >
                      <X className="size-4" aria-hidden />
                      {dict.irandoc.reject}
                    </Button>
                  </div>
                ) : null}

                {reasonFor === record.id ? (
                  <div className="grid gap-2 rounded-md border border-border bg-surface-2 p-3">
                    <Textarea label={dict.irandoc.reason} required value={reason} onChange={(e) => setReason(e.target.value)} />
                    <p className="text-xs text-fg-muted">{dict.irandoc.reasonRequired}</p>
                    <div className="flex gap-2">
                      <Button variant="danger" disabled={busy || reason.trim().length < 5} onClick={() => decide(record.id, "reject", reason)} aria-busy={busy}>
                        {dict.irandoc.reject}
                      </Button>
                      <Button variant="ghost" onClick={() => setReasonFor(null)}>
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
            <Input
              label={dict.irandoc.trackingCode}
              required
              value={trackingCode}
              onChange={(e) => setTrackingCode(e.target.value)}
              hint={dict.irandoc.trackingCodeHint}
            />
            <Input label={dict.irandoc.registeredAt} type="date" value={registeredAt} onChange={(e) => setRegisteredAt(e.target.value)} />
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <Upload className="size-4" aria-hidden />
              {dict.irandoc.uploadReceipt}
            </label>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              className="min-h-11 text-sm"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadReceipt(file);
              }}
            />
            {uploading ? (
              <span className="flex items-center gap-2 text-xs text-fg-muted" role="status">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {dict.irandoc.uploading}
              </span>
            ) : null}
            <Button variant="primary" onClick={submit} disabled={busy || trackingCode.trim().length < 3} aria-busy={busy}>
              {dict.irandoc.submit}
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
