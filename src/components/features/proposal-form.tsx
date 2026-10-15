"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, FileSignature, Loader2, Paperclip, Send } from "lucide-react";
import { Alert, Badge, Button, Card, EmptyState, type Tone } from "@/components/ui";
import { Input, Select, Textarea } from "@/components/ui/form";
import { apiRequest } from "./api-client";
import type { Dictionary } from "@/i18n/dictionaries";
import type { FormFieldView } from "./form-builder";

/**
 * Student-facing proposal form.
 *
 * The form is *rendered from the published definition* — fields, order, required flags,
 * options and the simple conditional-display rule all come from the database. Conditional
 * visibility is evaluated live, and the same rule is re-checked on the server, so hiding a
 * field in the UI can never bypass a rule.
 */

export interface ProposalDefinitionView extends FormFieldView {
  version: number;
  fields: FormFieldView[];
}

export interface ProposalVersionView {
  id: string;
  version: number;
  formCode: string;
  formVersion: number;
  status: string;
  titleFa: string | null;
  answers: Record<string, string | number | boolean | null>;
  submittedAt: string | null;
  decisionReason: string | null;
}

const STATUS_TONE: Record<string, Tone> = {
  draft: "neutral",
  submitted: "info",
  approved: "success",
  revision_required: "warning",
  rejected: "danger",
};

export function proposalStatusLabel(dict: Dictionary, status: string): string {
  switch (status) {
    case "draft":
      return dict.proposal.statusDraft;
    case "submitted":
      return dict.proposal.statusSubmitted;
    case "approved":
      return dict.proposal.statusApproved;
    case "revision_required":
      return dict.proposal.statusRevision;
    case "rejected":
      return dict.proposal.statusRejected;
    default:
      return status;
  }
}

/** Splits the field list into wizard steps without ever reordering it. */
function chunk<T>(list: T[], size: number): T[][] {
  if (list.length === 0) return [[]];
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out.length > 0 ? out : [[]];
}

function isVisible(field: FormFieldView, answers: Record<string, string>): boolean {
  if (!field.visibleWhen || !field.visibleWhen.fieldKey) return true;
  const controlling = answers[field.visibleWhen.fieldKey] ?? "";
  if (field.visibleWhen.equals !== undefined) return controlling === field.visibleWhen.equals;
  if (field.visibleWhen.notEquals !== undefined) return controlling !== field.visibleWhen.notEquals;
  return true;
}

export function ProposalPanel({
  caseId,
  dict,
  canSubmit,
  canReview = false,
}: {
  caseId: string;
  dict: Dictionary;
  canSubmit: boolean;
  canReview?: boolean;
}) {
  const router = useRouter();
  const [definition, setDefinition] = useState<ProposalDefinitionView | null>(null);
  const [fields, setFields] = useState<FormFieldView[]>([]);
  const [formVersion, setFormVersion] = useState<number | null>(null);
  const [versions, setVersions] = useState<ProposalVersionView[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [decisionFor, setDecisionFor] = useState<{ id: string; decision: string } | null>(null);

  useEffect(() => {
    let alive = true;
    apiRequest<{ definition: ProposalDefinitionView | null; versions: ProposalVersionView[] }>(
      `/api/cases/${caseId}/proposal`,
      "GET",
    ).then((result) => {
      if (!alive) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.message || dict.proposal.errorLoading);
        return;
      }
      setDefinition(result.data.definition);
      setFields(result.data.definition?.fields ?? []);
      setFormVersion(result.data.definition?.version ?? null);
      setVersions(result.data.versions);
      setError(null);
    });
    return () => {
      alive = false;
    };
  }, [caseId, dict.proposal.errorLoading]);

  async function save(submitForReview: boolean) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await apiRequest(`/api/cases/${caseId}/proposal`, "POST", {
      code: "proposal",
      answers,
      submitForReview,
      attachmentFileId,
    });
    setBusy(false);
    if (!result.ok) {
      const details = (result.details as { issues?: string[] } | undefined)?.issues;
      setError(details && details.length > 0 ? `${result.message} ${details.join(" ")}` : result.message || result.code);
      return;
    }
    setSuccess(submitForReview ? dict.proposal.submitted : dict.proposal.saved);
    const refreshed = await apiRequest<{ definition: unknown; versions: ProposalVersionView[] }>(`/api/cases/${caseId}/proposal`, "GET");
    if (refreshed.ok) setVersions(refreshed.data.versions);
    router.refresh();
  }

  const visibleFields = fields.filter((f) => f.isActive !== false && isVisible(f, answers));

  // ---- wizard: the definition's own field order is chunked into 3 steps -------------
  const steps = chunk(visibleFields, Math.max(1, Math.ceil(visibleFields.length / 3)));
  const [step, setStep] = useState(0);
  const currentStepFields = steps[Math.min(step, steps.length - 1)] ?? [];
  const isLastStep = step >= steps.length - 1;
  const missingOnStep = currentStepFields.filter((f) => f.isRequired && !String(answers[f.fieldKey] ?? "").trim());

  // ---- draft autosave (debounced) ---------------------------------------------------
  const [autosaveState, setAutosaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [attachmentFileId, setAttachmentFileId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const dirtyRef = useRef(false);

  const answersRef = useRef(answers);
  const attachmentRef = useRef<string | null>(null);
  const hasDefinition = definition !== null;

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    attachmentRef.current = attachmentFileId;
  }, [attachmentFileId]);

  useEffect(() => {
    // Debounced autosave of the in-progress draft. Skipped until the student has
    // actually typed something, and never fires for a viewer without submit rights.
    if (!canSubmit || !hasDefinition || !dirtyRef.current) return;
    if (Object.keys(answers).length === 0) return;
    const timer = setTimeout(() => {
      setAutosaveState("saving");
      void apiRequest(`/api/cases/${caseId}/proposal`, "POST", {
        code: "proposal",
        answers: answersRef.current,
        submitForReview: false,
        attachmentFileId: attachmentRef.current,
      }).then((result) => {
        setAutosaveState(result.ok ? "saved" : "idle");
      });
    }, 2500);
    return () => clearTimeout(timer);
  }, [answers, canSubmit, hasDefinition, caseId]);

  function updateAnswer(key: string, value: string) {
    dirtyRef.current = true;
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }

  /** Uploads a document into the case's file vault and references it by id. */
  async function uploadAttachment(file: File) {
    setUploading(true);
    setError(null);
    const body = new FormData();
    body.set("file", file);
    body.set("purpose", "proposal");
    const response = await fetch(`/api/cases/${caseId}/files`, { method: "POST", body, credentials: "same-origin" });
    const json = (await response.json().catch(() => null)) as { ok: boolean; data?: { fileId?: string }; error?: { message?: string } } | null;
    setUploading(false);
    if (!json?.ok || !json.data?.fileId) {
      setError(json?.error?.message ?? dict.common.unknownError);
      return;
    }
    setAttachmentFileId(json.data.fileId);
    setSuccess(dict.proposal.attachmentUploaded);
  }

  async function decide(versionId: string, decision: string, reasonText: string | null) {
    setBusy(true);
    setError(null);
    const result = await apiRequest(`/api/cases/${caseId}/proposal/${versionId}/decision`, "POST", { decision, reason: reasonText });
    setBusy(false);
    if (!result.ok) {
      setError(result.message || result.code);
      return;
    }
    setReason("");
    setDecisionFor(null);
    const refreshed = await apiRequest<{ definition: unknown; versions: ProposalVersionView[] }>(`/api/cases/${caseId}/proposal`, "GET");
    if (refreshed.ok) setVersions(refreshed.data.versions);
    router.refresh();
  }

  return (
    <Card className="grid gap-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <FileSignature className="size-5 text-primary" aria-hidden />
            {dict.proposal.title}
          </h2>
          <p className="mt-1 text-sm text-fg-muted">{dict.proposal.subtitle}</p>
        </div>
        {formVersion != null ? <Badge tone="info">{`${dict.proposal.formVersion} ${formVersion}`}</Badge> : null}
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {success ? <Alert tone="success">{success}</Alert> : null}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {dict.proposal.loading}
        </p>
      ) : !definition || fields.length === 0 ? (
        <EmptyState title={dict.proposal.noForm} />
      ) : (
        <>
          <form className="grid gap-4" onSubmit={(e) => e.preventDefault()}>
            <p className="flex items-center justify-between text-sm text-fg-muted">
              <span>{`${dict.proposal.step} ${step + 1} / ${steps.length}`}</span>
              <span aria-live="polite">
                {autosaveState === "saving" ? dict.proposal.autosaving : autosaveState === "saved" ? dict.proposal.autosaved : ""}
              </span>
            </p>
            <ol className="flex flex-wrap gap-2" aria-label={dict.proposal.stepsLabel}>
              {steps.map((_, index) => (
                <li key={index}>
                  <button
                    type="button"
                    onClick={() => setStep(index)}
                    aria-current={index === step}
                    className={`min-h-11 rounded-md border px-3 text-sm ${index === step ? "border-primary bg-surface-2 font-medium" : "border-border hover:bg-surface-2"}`}
                  >
                    {`${dict.proposal.step} ${index + 1}`}
                  </button>
                </li>
              ))}
            </ol>

            {currentStepFields.map((field) => {
              const value = answers[field.fieldKey] ?? "";
              const onChange = (next: string) => updateAnswer(field.fieldKey, next);
              if (field.fieldType === "textarea") {
                return <Textarea key={field.fieldKey} label={field.labelFa} required={field.isRequired} hint={field.helpFa ?? undefined} value={value} onChange={(e) => onChange(e.target.value)} />;
              }
              if (field.fieldType === "select" || field.fieldType === "radio") {
                return (
                  <Select key={field.fieldKey} label={field.labelFa} required={field.isRequired} hint={field.helpFa ?? undefined} value={value} onChange={(e) => onChange(e.target.value)}>
                    <option value="">{field.placeholderFa ?? "—"}</option>
                    {(field.options ?? []).map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </Select>
                );
              }
              if (field.fieldType === "checkbox") {
                const options = field.options && field.options.length > 0 ? field.options : [field.labelFa];
                return (
                  <fieldset key={field.fieldKey} className="grid gap-2 rounded-lg border border-border p-3">
                    <legend className="px-1 text-sm font-medium">{field.labelFa}</legend>
                    {options.map((option) => (
                      <label key={option} className="flex min-h-11 items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={value.split("، ").includes(option)}
                          onChange={(e) => {
                            const list = new Set(value ? value.split("، ") : []);
                            if (e.target.checked) list.add(option);
                            else list.delete(option);
                            onChange([...list].join("، "));
                          }}
                        />
                        {option}
                      </label>
                    ))}
                  </fieldset>
                );
              }
              return (
                <Input
                  key={field.fieldKey}
                  label={field.labelFa}
                  required={field.isRequired}
                  hint={field.helpFa ?? undefined}
                  type={field.fieldType === "number" ? "number" : field.fieldType === "date" ? "date" : "text"}
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                />
              );
            })}

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
                <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
                {dict.proposal.previous}
              </Button>
              <Button variant="secondary" onClick={() => setStep(Math.min(steps.length - 1, step + 1))} disabled={isLastStep}>
                <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
                {dict.proposal.next}
              </Button>
              {missingOnStep.length > 0 ? (
                <span className="text-xs text-amber-700 dark:text-amber-300" role="status">
                  {`${dict.proposal.missingOnStep}: ${missingOnStep.map((f) => f.labelFa).join("، ")}`}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
                  <Check className="size-4" aria-hidden />
                  {dict.proposal.stepComplete}
                </span>
              )}
            </div>

            {canSubmit ? (
              <div className="grid gap-2 rounded-lg border border-dashed border-border p-3">
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <Paperclip className="size-4" aria-hidden />
                  {dict.proposal.attachFile}
                </label>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="min-h-11 text-sm"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadAttachment(file);
                  }}
                />
                {uploading ? (
                  <span className="flex items-center gap-2 text-xs text-fg-muted">
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    {dict.proposal.uploading}
                  </span>
                ) : null}
                {attachmentFileId ? <span className="text-xs text-emerald-700 dark:text-emerald-300">{dict.proposal.attachmentReady}</span> : null}
              </div>
            ) : null}
          </form>

          {canSubmit ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => save(false)} disabled={busy} aria-busy={busy}>
                {dict.proposal.saveDraft}
              </Button>
              <Button onClick={() => save(true)} disabled={busy} aria-busy={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
                {dict.proposal.submit}
              </Button>
            </div>
          ) : null}
        </>
      )}

      <div className="grid gap-3">
        <h3 className="text-sm font-semibold">{dict.proposal.versions}</h3>
        {versions.length === 0 ? (
          <p className="text-sm text-fg-muted">{dict.proposal.noVersions}</p>
        ) : (
          <ul className="grid gap-2">
            {versions.map((version) => (
              <li key={version.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS_TONE[version.status] ?? "neutral"}>{`${dict.forms.version} ${version.version}`}</Badge>
                  <span className="text-sm">{proposalStatusLabel(dict, version.status)}</span>
                  <span className="text-xs text-fg-muted">{`${dict.proposal.formVersion} ${version.formVersion}`}</span>
                </div>
                {version.titleFa ? <p className="mt-2 text-sm font-medium">{version.titleFa}</p> : null}
                {version.decisionReason ? <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{version.decisionReason}</p> : null}
                {canReview && version.status === "submitted" ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="primary" onClick={() => decide(version.id, "approve", null)} disabled={busy} aria-busy={busy}>
                      {dict.proposal.approve}
                    </Button>
                    <Button variant="secondary" onClick={() => { setDecisionFor({ id: version.id, decision: "request_revision" }); setReason(""); }} disabled={busy}>
                      {dict.proposal.requestRevision}
                    </Button>
                    <Button variant="danger" onClick={() => { setDecisionFor({ id: version.id, decision: "reject" }); setReason(""); }} disabled={busy}>
                      {dict.proposal.reject}
                    </Button>
                  </div>
                ) : null}
                {decisionFor?.id === version.id ? (
                  <div className="mt-3 grid gap-3 rounded-md border border-border bg-surface-2 p-3">
                    <Textarea label={dict.proposal.reason} required value={reason} onChange={(e) => setReason(e.target.value)} />
                    <p className="text-xs text-fg-muted">{dict.proposal.reasonRequired}</p>
                    <div className="flex gap-2">
                      <Button
                        variant={decisionFor.decision === "reject" ? "danger" : "primary"}
                        disabled={busy || reason.trim().length < 5}
                        onClick={() => decide(version.id, decisionFor.decision, reason)}
                        aria-busy={busy}
                      >
                        {decisionFor.decision === "reject" ? dict.proposal.reject : dict.proposal.requestRevision}
                      </Button>
                      <Button variant="ghost" onClick={() => setDecisionFor(null)}>{dict.common.cancel}</Button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
