"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, Coins, Loader2, Paperclip, Upload, Users, X } from "lucide-react";
import { Alert, Badge, Button, Card, EmptyState, type Tone } from "@/components/ui";
import { Input, Select, Textarea } from "@/components/ui/form";
import { apiRequest } from "./api-client";
import type { Dictionary } from "@/i18n/dictionaries";
import { formatNumber } from "@/lib/format";

/**
 * M7 client panels — term extension, committee meetings and finance records.
 *
 * Every card follows the same shape: a loading state, an explicit empty state, the
 * full history (nothing is ever deleted) and only the buttons the viewer is entitled
 * to. All validation is repeated on the server, so hiding a button is never the
 * security boundary.
 */

const EXTENSION_TONE: Record<string, Tone> = { pending: "info", approved: "success", rejected: "danger" };
const MEETING_TONE: Record<string, Tone> = { scheduled: "info", held: "success", cancelled: "neutral" };
const FINANCE_TONE: Record<string, Tone> = { pending: "warning", paid: "success", waived: "neutral" };

export interface ExtensionView {
  id: string;
  requestedTerms: number;
  reason: string;
  status: string;
  decisionReason: string | null;
  termTitle: string | null;
  requestedByName: string | null;
  decidedByName: string | null;
  decidedAt: string | Date | null;
  createdAt: string | Date;
}

export interface CommitteeMemberView {
  id: string;
  fullName: string;
  roleType: string;
  isPresent: boolean;
  userId: string | null;
}

export interface CommitteeMeetingView {
  id: string;
  meetingType: string;
  scheduledAt: string | Date;
  location: string | null;
  status: string;
  result: string | null;
  minutesFa: string | null;
  members: CommitteeMemberView[];
}

export interface FinanceRecordView {
  id: string;
  kind: string;
  amount: number;
  currency: string;
  status: string;
  note: string | null;
  settleReason: string | null;
  settledByName: string | null;
  paidAt: string | Date | null;
  createdAt: string | Date;
}

export function committeeTypeLabel(dict: Dictionary, type: string): string {
  if (type === "proposal_defense") return dict.thesisAdmin.typeProposalDefense;
  if (type === "final_defense") return dict.thesisAdmin.typeFinalDefense;
  return dict.thesisAdmin.typePreDefense;
}

export function financeKindLabel(dict: Dictionary, kind: string): string {
  if (kind === "extension_fee") return dict.thesisAdmin.kindExtension;
  if (kind === "tuition") return dict.thesisAdmin.kindTuition;
  if (kind === "other") return dict.thesisAdmin.kindOther;
  return dict.thesisAdmin.kindDefense;
}

function statusLabel(dict: Dictionary, status: string): string {
  const map: Record<string, string> = {
    pending: dict.thesisAdmin.statusPending,
    approved: dict.thesisAdmin.statusApproved,
    rejected: dict.thesisAdmin.statusRejected,
    scheduled: dict.thesisAdmin.statusScheduled,
    held: dict.thesisAdmin.statusHeld,
    cancelled: dict.thesisAdmin.statusCancelled,
    paid: dict.thesisAdmin.statusPaid,
    waived: dict.thesisAdmin.statusWaived,
  };
  return map[status] ?? status;
}

function useUpload(caseId: string, purpose: string, onError: (message: string) => void) {
  const [uploading, setUploading] = useState(false);
  async function upload(file: File): Promise<string | null> {
    setUploading(true);
    const body = new FormData();
    body.set("file", file);
    body.set("purpose", purpose);
    const response = await fetch(`/api/cases/${caseId}/files`, { method: "POST", body, credentials: "same-origin" });
    const json = (await response.json().catch(() => null)) as { ok: boolean; data?: { fileId?: string }; error?: { message?: string } } | null;
    setUploading(false);
    if (!json?.ok || !json.data?.fileId) {
      onError(json?.error?.message ?? "upload_failed");
      return null;
    }
    return json.data.fileId;
  }
  return { uploading, upload };
}

export function ExtensionPanel({ caseId, dict, permissions }: { caseId: string; dict: Dictionary; permissions: string[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<ExtensionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [requestedTerms, setRequestedTerms] = useState("1");
  const [reason, setReason] = useState("");
  const [fileId, setFileId] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const canRequest = permissions.includes("cases.submit_topic");
  const canReview = permissions.includes("cases.review_topic");
  const { uploading, upload } = useUpload(caseId, "extension", (message) => setError(message));

  useEffect(() => {
    let alive = true;
    void apiRequest<{ extensions: ExtensionView[] }>(`/api/cases/${caseId}/extensions`, "GET").then((result) => {
      if (!alive) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.message || dict.thesisAdmin.errorLoading);
        return;
      }
      setRows(result.data.extensions);
      setError(null);
    });
    return () => {
      alive = false;
    };
  }, [caseId, dict.thesisAdmin.errorLoading]);

  async function reload() {
    const result = await apiRequest<{ extensions: ExtensionView[] }>(`/api/cases/${caseId}/extensions`, "GET");
    if (result.ok) setRows(result.data.extensions);
  }

  async function submitRequest() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await apiRequest(`/api/cases/${caseId}/extensions`, "POST", {
      requestedTerms: Number(requestedTerms) || 1,
      reason,
      fileId,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message || result.code);
      return;
    }
    setReason("");
    setFileId(null);
    setRequestedTerms("1");
    setSuccess(dict.thesisAdmin.extensionSubmitted);
    await reload();
    router.refresh();
  }

  async function decide(extensionId: string, decision: "approve" | "reject", reasonText: string | null) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await apiRequest(`/api/cases/${caseId}/extensions/${extensionId}/decision`, "POST", { decision, reason: reasonText });
    setBusy(false);
    if (!result.ok) {
      setError(result.message || result.code);
      return;
    }
    setRejectFor(null);
    setRejectReason("");
    setSuccess(decision === "approve" ? dict.thesisAdmin.extensionApproved : dict.thesisAdmin.extensionRejected);
    await reload();
    router.refresh();
  }

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-border p-4">
        <CalendarClock className="size-5" aria-hidden />
        <h2 className="text-base font-semibold">{dict.thesisAdmin.extensionsTitle}</h2>
      </div>
      <div className="grid gap-4 p-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {success ? <Alert tone="success">{success}</Alert> : null}
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-fg-muted" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {dict.thesisAdmin.loading}
          </p>
        ) : rows.length === 0 ? (
          <EmptyState title={dict.thesisAdmin.extensionsEmpty} text={dict.thesisAdmin.extensionsEmptyHint} />
        ) : (
          <ul className="grid gap-2">
            {rows.map((row) => (
              <li key={row.id} className="grid gap-2 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={EXTENSION_TONE[row.status] ?? "neutral"}>{statusLabel(dict, row.status)}</Badge>
                  <span className="text-sm font-medium">{`${dict.thesisAdmin.termsRequested}: ${formatNumber(row.requestedTerms, "fa")}`}</span>
                  {row.termTitle ? <span className="text-xs text-fg-muted">{row.termTitle}</span> : null}
                </div>
                <p className="text-sm">{row.reason}</p>
                <p className="text-xs text-fg-muted">
                  {row.requestedByName ? `${dict.thesisAdmin.requestedBy}: ${row.requestedByName}` : ""}
                  {row.decidedByName ? ` · ${dict.thesisAdmin.decidedBy}: ${row.decidedByName}` : ""}
                </p>
                {row.decisionReason ? <p className="text-xs text-amber-700 dark:text-amber-300">{`${dict.thesisAdmin.decisionReason}: ${row.decisionReason}`}</p> : null}
                {canReview && row.status === "pending" ? (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" disabled={busy} aria-busy={busy} onClick={() => decide(row.id, "approve", null)}>
                      <Check className="size-4" aria-hidden />
                      {dict.thesisAdmin.approve}
                    </Button>
                    <Button variant="danger" disabled={busy} onClick={() => { setRejectFor(row.id); setRejectReason(""); }}>
                      <X className="size-4" aria-hidden />
                      {dict.thesisAdmin.reject}
                    </Button>
                  </div>
                ) : null}
                {rejectFor === row.id ? (
                  <div className="grid gap-2 rounded-md border border-border bg-surface-2 p-3">
                    <Textarea label={dict.thesisAdmin.decisionReason} required value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                    <p className="text-xs text-fg-muted">{dict.thesisAdmin.reasonRequired}</p>
                    <div className="flex gap-2">
                      <Button variant="danger" disabled={busy || rejectReason.trim().length < 5} onClick={() => decide(row.id, "reject", rejectReason)}>
                        {dict.thesisAdmin.reject}
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

        {canRequest ? (
          <div className="grid gap-3 rounded-lg border border-dashed border-border p-3">
            <Select label={dict.thesisAdmin.termsRequested} value={requestedTerms} onChange={(e) => setRequestedTerms(e.target.value)}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={String(n)}>
                  {formatNumber(n, "fa")}
                </option>
              ))}
            </Select>
            <Textarea label={dict.thesisAdmin.requestReason} required value={reason} onChange={(e) => setReason(e.target.value)} hint={dict.thesisAdmin.reasonRequired} />
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <Upload className="size-4" aria-hidden />
              {dict.thesisAdmin.uploadOptionalFile}
            </label>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              className="min-h-11 text-sm"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file).then((id) => { if (id) setFileId(id); });
              }}
            />
            {uploading ? <span className="text-xs text-fg-muted">{dict.thesisAdmin.uploading}</span> : null}
            <Button variant="primary" disabled={busy || reason.trim().length < 5} aria-busy={busy} onClick={submitRequest}>
              {dict.thesisAdmin.submitRequest}
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function CommitteePanel({ caseId, dict, permissions }: { caseId: string; dict: Dictionary; permissions: string[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<CommitteeMeetingView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [meetingType, setMeetingType] = useState("pre_defense");
  const [scheduledAt, setScheduledAt] = useState("");
  const [location, setLocation] = useState("");
  const [memberNames, setMemberNames] = useState("");
  const [minutesFor, setMinutesFor] = useState<string | null>(null);
  const [minutes, setMinutes] = useState("");
  const [result, setResult] = useState("passed");

  const canManage = permissions.includes("cases.review_topic");

  useEffect(() => {
    let alive = true;
    void apiRequest<{ meetings: CommitteeMeetingView[] }>(`/api/cases/${caseId}/committee`, "GET").then((result) => {
      if (!alive) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.message || dict.thesisAdmin.errorLoading);
        return;
      }
      setRows(result.data.meetings);
      setError(null);
    });
    return () => {
      alive = false;
    };
  }, [caseId, dict.thesisAdmin.errorLoading]);

  async function reload() {
    const result = await apiRequest<{ meetings: CommitteeMeetingView[] }>(`/api/cases/${caseId}/committee`, "GET");
    if (result.ok) setRows(result.data.meetings);
  }

  async function createMeeting() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const members = memberNames
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, role] = line.split("|").map((part) => part.trim());
        const allowed = ["supervisor", "advisor", "internal", "external", "chair"];
        return { fullName: name, roleType: allowed.includes(role) ? role : "internal", isPresent: true };
      });
    const result = await apiRequest(`/api/cases/${caseId}/committee`, "POST", {
      meetingType,
      scheduledAt: scheduledAt || new Date().toISOString(),
      location,
      members,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message || result.code);
      return;
    }
    setMemberNames("");
    setLocation("");
    setScheduledAt("");
    setSuccess(dict.thesisAdmin.meetingCreated);
    await reload();
    router.refresh();
  }

  async function recordOutcome(meetingId: string, status: "held" | "cancelled") {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const outcome = await apiRequest(`/api/cases/${caseId}/committee/${meetingId}/outcome`, "POST", {
      status,
      result: status === "held" ? result : null,
      minutesFa: status === "held" ? minutes : null,
    });
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.message || outcome.code);
      return;
    }
    setMinutesFor(null);
    setMinutes("");
    setSuccess(status === "held" ? dict.thesisAdmin.meetingHeld : dict.thesisAdmin.meetingCancelled);
    await reload();
    router.refresh();
  }

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-border p-4">
        <Users className="size-5" aria-hidden />
        <h2 className="text-base font-semibold">{dict.thesisAdmin.committeeTitle}</h2>
      </div>
      <div className="grid gap-4 p-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {success ? <Alert tone="success">{success}</Alert> : null}
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-fg-muted" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {dict.thesisAdmin.loading}
          </p>
        ) : rows.length === 0 ? (
          <EmptyState title={dict.thesisAdmin.committeeEmpty} text={dict.thesisAdmin.committeeEmptyHint} />
        ) : (
          <ul className="grid gap-2">
            {rows.map((row) => (
              <li key={row.id} className="grid gap-2 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={MEETING_TONE[row.status] ?? "neutral"}>{statusLabel(dict, row.status)}</Badge>
                  <span className="text-sm font-medium">{committeeTypeLabel(dict, row.meetingType)}</span>
                  <span className="text-xs text-fg-muted">{String(row.scheduledAt).slice(0, 10)}</span>
                  {row.location ? <span className="text-xs text-fg-muted">{row.location}</span> : null}
                  {row.result ? <Badge tone="primary">{row.result}</Badge> : null}
                </div>
                <ul className="flex flex-wrap gap-2 text-xs text-fg-muted">
                  {row.members.map((member) => (
                    <li key={member.id} className="flex items-center gap-1 rounded border border-border px-2 py-1">
                      {member.fullName}
                      <span>({member.roleType})</span>
                      {member.isPresent ? <Check className="size-3 text-emerald-600" aria-hidden /> : null}
                    </li>
                  ))}
                </ul>
                {row.minutesFa ? <p className="whitespace-pre-line text-sm">{row.minutesFa}</p> : null}
                {canManage && row.status === "scheduled" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select label={dict.thesisAdmin.result} value={result} onChange={(e) => setResult(e.target.value)} className="max-w-48">
                      <option value="passed">{dict.thesisAdmin.resultPassed}</option>
                      <option value="revision_required">{dict.thesisAdmin.resultRevision}</option>
                      <option value="rejected">{dict.thesisAdmin.resultRejected}</option>
                    </Select>
                    <Button variant="primary" disabled={busy} onClick={() => { setMinutesFor(row.id); setMinutes(row.minutesFa ?? ""); }}>
                      <Check className="size-4" aria-hidden />
                      {dict.thesisAdmin.markHeld}
                    </Button>
                    <Button variant="ghost" disabled={busy} onClick={() => recordOutcome(row.id, "cancelled")}>
                      {dict.thesisAdmin.markCancelled}
                    </Button>
                  </div>
                ) : null}
                {minutesFor === row.id ? (
                  <div className="grid gap-2 rounded-md border border-border bg-surface-2 p-3">
                    <Textarea label={dict.thesisAdmin.minutes} required value={minutes} onChange={(e) => setMinutes(e.target.value)} hint={dict.thesisAdmin.minutesHint} />
                    <div className="flex gap-2">
                      <Button variant="primary" disabled={busy || minutes.trim().length < 10} onClick={() => recordOutcome(row.id, "held")}>
                        {dict.thesisAdmin.markHeld}
                      </Button>
                      <Button variant="ghost" onClick={() => setMinutesFor(null)}>
                        {dict.common.cancel}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canManage ? (
          <div className="grid gap-3 rounded-lg border border-dashed border-border p-3">
            <Select label={dict.thesisAdmin.meetingType} value={meetingType} onChange={(e) => setMeetingType(e.target.value)}>
              <option value="proposal_defense">{dict.thesisAdmin.typeProposalDefense}</option>
              <option value="pre_defense">{dict.thesisAdmin.typePreDefense}</option>
              <option value="final_defense">{dict.thesisAdmin.typeFinalDefense}</option>
            </Select>
            <Input label={dict.thesisAdmin.scheduledAt} type="date" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
            <Input label={dict.thesisAdmin.location} value={location} onChange={(e) => setLocation(e.target.value)} />
            <Textarea
              label={dict.thesisAdmin.members}
              required
              value={memberNames}
              onChange={(e) => setMemberNames(e.target.value)}
              hint={dict.thesisAdmin.membersHint}
            />
            <Button variant="primary" disabled={busy || memberNames.trim().length === 0} aria-busy={busy} onClick={createMeeting}>
              {dict.thesisAdmin.createMeeting}
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function FinancePanel({ caseId, dict, permissions }: { caseId: string; dict: Dictionary; permissions: string[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<FinanceRecordView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [kind, setKind] = useState("defense_fee");
  const [amount, setAmount] = useState("0");
  const [note, setNote] = useState("");
  const [receiptFileId, setReceiptFileId] = useState<string | null>(null);
  const [waiveFor, setWaiveFor] = useState<string | null>(null);
  const [waiveReason, setWaiveReason] = useState("");

  const canManage = permissions.includes("cases.review_topic");
  const { uploading, upload } = useUpload(caseId, "finance", (message) => setError(message));

  useEffect(() => {
    let alive = true;
    void apiRequest<{ records: FinanceRecordView[] }>(`/api/cases/${caseId}/finance`, "GET").then((result) => {
      if (!alive) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.message || dict.thesisAdmin.errorLoading);
        return;
      }
      setRows(result.data.records);
      setError(null);
    });
    return () => {
      alive = false;
    };
  }, [caseId, dict.thesisAdmin.errorLoading]);

  async function reload() {
    const result = await apiRequest<{ records: FinanceRecordView[] }>(`/api/cases/${caseId}/finance`, "GET");
    if (result.ok) setRows(result.data.records);
  }

  async function create() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await apiRequest(`/api/cases/${caseId}/finance`, "POST", {
      kind,
      amount: Number(amount) || 0,
      note,
      receiptFileId,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message || result.code);
      return;
    }
    setAmount("0");
    setNote("");
    setReceiptFileId(null);
    setSuccess(dict.thesisAdmin.financeCreated);
    await reload();
    router.refresh();
  }

  async function settle(recordId: string, status: "paid" | "waived", reasonText: string | null) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await apiRequest(`/api/cases/${caseId}/finance/${recordId}/settle`, "POST", {
      status,
      reason: reasonText,
      receiptFileId: status === "paid" ? receiptFileId : null,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message || result.code);
      return;
    }
    setWaiveFor(null);
    setWaiveReason("");
    setSuccess(status === "paid" ? dict.thesisAdmin.financePaid : dict.thesisAdmin.financeWaived);
    await reload();
    router.refresh();
  }

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-border p-4">
        <Coins className="size-5" aria-hidden />
        <h2 className="text-base font-semibold">{dict.thesisAdmin.financeTitle}</h2>
      </div>
      <div className="grid gap-4 p-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {success ? <Alert tone="success">{success}</Alert> : null}
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-fg-muted" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {dict.thesisAdmin.loading}
          </p>
        ) : rows.length === 0 ? (
          <EmptyState title={dict.thesisAdmin.financeEmpty} text={dict.thesisAdmin.financeEmptyHint} />
        ) : (
          <ul className="grid gap-2">
            {rows.map((row) => (
              <li key={row.id} className="grid gap-2 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={FINANCE_TONE[row.status] ?? "neutral"}>{statusLabel(dict, row.status)}</Badge>
                  <span className="text-sm font-medium">{financeKindLabel(dict, row.kind)}</span>
                  <span className="text-sm">{`${formatNumber(row.amount, "fa")} ${row.currency === "IRR" ? dict.thesisAdmin.currencyIrr : row.currency}`}</span>
                  {row.settledByName ? <span className="text-xs text-fg-muted">{row.settledByName}</span> : null}
                </div>
                {row.note ? <p className="text-xs text-fg-muted">{row.note}</p> : null}
                {row.settleReason ? <p className="text-xs text-amber-700 dark:text-amber-300">{row.settleReason}</p> : null}
                {canManage && row.status === "pending" ? (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" disabled={busy || !receiptFileId} onClick={() => settle(row.id, "paid", null)} title={receiptFileId ? undefined : dict.thesisAdmin.receiptRequired}>
                      <Paperclip className="size-4" aria-hidden />
                      {dict.thesisAdmin.markPaid}
                    </Button>
                    <Button variant="secondary" disabled={busy} onClick={() => { setWaiveFor(row.id); setWaiveReason(""); }}>
                      {dict.thesisAdmin.markWaived}
                    </Button>
                  </div>
                ) : null}
                {waiveFor === row.id ? (
                  <div className="grid gap-2 rounded-md border border-border bg-surface-2 p-3">
                    <Textarea label={dict.thesisAdmin.waiveReason} required value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)} />
                    <p className="text-xs text-fg-muted">{dict.thesisAdmin.reasonRequired}</p>
                    <div className="flex gap-2">
                      <Button variant="secondary" disabled={busy || waiveReason.trim().length < 5} onClick={() => settle(row.id, "waived", waiveReason)}>
                        {dict.thesisAdmin.markWaived}
                      </Button>
                      <Button variant="ghost" onClick={() => setWaiveFor(null)}>
                        {dict.common.cancel}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canManage ? (
          <div className="grid gap-3 rounded-lg border border-dashed border-border p-3">
            <Select label={dict.thesisAdmin.financeKind} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="defense_fee">{dict.thesisAdmin.kindDefense}</option>
              <option value="extension_fee">{dict.thesisAdmin.kindExtension}</option>
              <option value="tuition">{dict.thesisAdmin.kindTuition}</option>
              <option value="other">{dict.thesisAdmin.kindOther}</option>
            </Select>
            <Input label={dict.thesisAdmin.amount} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} hint={dict.thesisAdmin.amountHint} />
            <Textarea label={dict.thesisAdmin.financeNote} value={note} onChange={(e) => setNote(e.target.value)} />
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <Upload className="size-4" aria-hidden />
              {dict.thesisAdmin.uploadReceipt}
            </label>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              className="min-h-11 text-sm"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file).then((id) => { if (id) setReceiptFileId(id); });
              }}
            />
            {uploading ? <span className="text-xs text-fg-muted">{dict.thesisAdmin.uploading}</span> : null}
            <Button variant="primary" disabled={busy} aria-busy={busy} onClick={create}>
              {dict.thesisAdmin.createFinance}
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
