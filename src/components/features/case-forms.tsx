"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Badge } from "@/components/ui";
import { Input, Textarea, Select } from "@/components/ui/form";
import { useI18n } from "@/i18n/provider";
import { apiRequest, errorText } from "./api-client";
import type { Dictionary } from "@/i18n/dictionaries";
import type { TransitionDef } from "@/server/workflows";

// ---------------------------------------------------------------------------
// Create case form (server-rendered page passes dict as prop)
// ---------------------------------------------------------------------------

export function CaseCreateForm({ dict, departments = [] }: { dict: Dictionary; departments?: Array<{ id: number; nameFa: string; facultyNameFa: string | null }> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    studentFullName: "",
    studentNumber: "",
    department: "",
    departmentId: null as number | null,
    degreeLevel: "کارشناسی ارشد",
    fieldOfStudy: "",
    academicYear: "",
    titleFa: "",
    titleEn: "",
  });

  const update = (key: string, value: string) => setForm({ ...form, [key]: value });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await apiRequest<{ id: string; caseNumber: string }>("/api/cases", "POST", {
      ...form,
      studentNumber: form.studentNumber || null,
      department: form.department || null,
      departmentId: form.departmentId,
      fieldOfStudy: form.fieldOfStudy || null,
      academicYear: form.academicYear || null,
      titleFa: form.titleFa || null,
      titleEn: form.titleEn || null,
    });
    setBusy(false);
    if (!result.ok) {
      setError(errorText(result, { invalidCredentials: "", tooManyAttempts: "", accountDisabled: "", network: dict.common.networkError, unknown: dict.common.unknownError }));
      return;
    }
    router.push(`/cases/${result.data.id}`);
    router.refresh();
  };

  return (
    <form onSubmit={submit} noValidate className="grid max-w-2xl gap-6">
      {error && <Alert tone="danger">{error}</Alert>}

      <div className="rounded-xl border border-border bg-surface p-6">
        <h2 className="mb-4 text-lg font-semibold">{dict.cases.studentInfo}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={dict.cases.form.studentFullName} name="studentFullName" required value={form.studentFullName} onChange={(e) => update("studentFullName", e.target.value)} />
          <Input label={dict.cases.form.studentNumber} name="studentNumber" dir="ltr" className="text-start" value={form.studentNumber} onChange={(e) => update("studentNumber", e.target.value)} hint={dict.common.optional} />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-6">
        <h2 className="mb-4 text-lg font-semibold">{dict.cases.academicInfo}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {departments.length > 0 ? (
            <Select
              label={dict.cases.form.department}
              value={form.departmentId ? String(form.departmentId) : ""}
              onChange={(e) => {
                const id = e.target.value ? Number(e.target.value) : null;
                const name = departments.find((d) => d.id === id)?.nameFa ?? "";
                setForm({ ...form, departmentId: id, department: name });
              }}
              hint={dict.common.optional}
            >
              <option value="">— {dict.common.all} —</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.facultyNameFa ? `${d.nameFa} — ${d.facultyNameFa}` : d.nameFa}</option>
              ))}
            </Select>
          ) : (
            <Input label={dict.cases.form.department} value={form.department} onChange={(e) => update("department", e.target.value)} hint={dict.cases.org.noDepartments} />
          )}
          <Select label={dict.cases.form.degreeLevel} name="degreeLevel" value={form.degreeLevel} onChange={(e) => update("degreeLevel", e.target.value)}>
            <option value="کارشناسی ارشد">کارشناسی ارشد</option>
            <option value="دکتری">دکتری</option>
          </Select>
          <Input label={dict.cases.form.fieldOfStudy} name="fieldOfStudy" value={form.fieldOfStudy} onChange={(e) => update("fieldOfStudy", e.target.value)} hint={dict.common.optional} />
          <Input label={dict.cases.form.academicYear} name="academicYear" dir="ltr" className="text-start" value={form.academicYear} onChange={(e) => update("academicYear", e.target.value)} hint={dict.common.optional} />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-6">
        <h2 className="mb-4 text-lg font-semibold">{dict.cases.topicInfo}</h2>
        <div className="grid gap-4">
          <Input label={dict.cases.form.titleFa} name="titleFa" value={form.titleFa} onChange={(e) => update("titleFa", e.target.value)} hint={dict.common.optional} />
          <Input label={dict.cases.form.titleEn} name="titleEn" dir="ltr" className="text-start" value={form.titleEn} onChange={(e) => update("titleEn", e.target.value)} hint={dict.common.optional} />
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={() => router.back()}>{dict.common.cancel}</Button>
        <Button type="submit" loading={busy}>{dict.common.create}</Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Topic submission form
// ---------------------------------------------------------------------------

export function TopicForm({ caseId, dict, existing }: { caseId: string; dict: Dictionary; existing?: { titleFa?: string; titleEn?: string; keywords?: string } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState({
    titleFa: existing?.titleFa ?? "",
    titleEn: existing?.titleEn ?? "",
    keywords: existing?.keywords ?? "",
    description: "",
  });

  const submit = async (submitForReview: boolean) => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await apiRequest("/api/cases/" + caseId + "/topic", "POST", { ...form, submitForReview });
    setBusy(false);
    if (!result.ok) {
      setError(errorText(result, { invalidCredentials: "", tooManyAttempts: "", accountDisabled: "", network: dict.common.networkError, unknown: dict.common.unknownError }));
      return;
    }
    setSuccess(submitForReview ? dict.cases.topicSubmitted : dict.cases.topicSaved);
    router.refresh();
  };

  return (
    <div className="grid gap-4 pt-4">
      {error && <Alert tone="danger">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}
      <Input label={dict.cases.form.titleFa} required value={form.titleFa} onChange={(e) => setForm({ ...form, titleFa: e.target.value })} />
      <Input label={dict.cases.form.titleEn} dir="ltr" className="text-start" value={form.titleEn} onChange={(e) => setForm({ ...form, titleEn: e.target.value })} hint={dict.common.optional} />
      <Input label={dict.cases.form.keywords} value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} hint={dict.common.optional} />
      <Textarea label={dict.cases.form.description} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} hint={dict.common.optional} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => submit(false)} loading={busy} disabled={!form.titleFa}>{dict.cases.saveDraft}</Button>
        <Button onClick={() => submit(true)} loading={busy} disabled={!form.titleFa}>{dict.cases.submitForReview}</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status transition form
// ---------------------------------------------------------------------------

export function CaseTransitionForm({ caseId, currentStatus, transitions, dict }: { caseId: string; currentStatus: string; transitions: TransitionDef[]; dict: Dictionary }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [selectedTo, setSelectedTo] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedDef = transitions.find((t) => t.to === selectedTo);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await apiRequest("/api/cases/" + caseId + "/transitions", "POST", { to: selectedTo, reason: reason || undefined });
    setBusy(false);
    if (!result.ok) {
      setError(errorText(result, { invalidCredentials: "", tooManyAttempts: "", accountDisabled: "", network: dict.common.networkError, unknown: dict.common.unknownError }));
      return;
    }
    setSuccess(dict.cases.statusChanged);
    setSelectedTo("");
    setReason("");
    router.refresh();
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-3">
      {error && <Alert tone="danger">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}
      <Select label={dict.cases.transitionStatus} value={selectedTo} onChange={(e) => setSelectedTo(e.target.value)}>
        <option value="">{dict.common.all}</option>
        {transitions.map((t) => (
          <option key={t.to} value={t.to}>{t.label} ({dict.cases.statusLabels[t.to as keyof typeof dict.cases.statusLabels] ?? t.to})</option>
        ))}
      </Select>
      {selectedDef?.reasonRequired ? (
        <Textarea label={dict.cases.reasonRequired} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder={dict.cases.reasonRequired} />
      ) : (
        <Textarea label={dict.common.reason} value={reason} onChange={(e) => setReason(e.target.value)} hint={dict.common.optional} />
      )}
      <Button type="submit" loading={busy} disabled={!selectedTo}>{dict.common.confirm}</Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Add supervisor form
// ---------------------------------------------------------------------------

export function AddSupervisorForm({ caseId, dict }: { caseId: string; dict: Dictionary }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState({ supervisorName: "", roleType: "supervisor" as string });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await apiRequest("/api/cases/" + caseId + "/supervisors", "POST", form);
    setBusy(false);
    if (!result.ok) {
      setError(errorText(result, { invalidCredentials: "", tooManyAttempts: "", accountDisabled: "", network: dict.common.networkError, unknown: dict.common.unknownError }));
      return;
    }
    setSuccess(dict.cases.supervisorAdded);
    setForm({ supervisorName: "", roleType: "supervisor" });
    router.refresh();
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-3 pt-4">
      {error && <Alert tone="danger">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}
      <Input label={dict.cases.form.supervisorName} required value={form.supervisorName} onChange={(e) => setForm({ ...form, supervisorName: e.target.value })} />
      <Select label={dict.cases.form.supervisorRole} value={form.roleType} onChange={(e) => setForm({ ...form, roleType: e.target.value })}>
        <option value="supervisor">{dict.cases.form.supervisorRoles.supervisor}</option>
        <option value="co_supervisor">{dict.cases.form.supervisorRoles.co_supervisor}</option>
        <option value="advisor">{dict.cases.form.supervisorRoles.advisor}</option>
      </Select>
      <Button type="submit" loading={busy} disabled={!form.supervisorName}>{dict.cases.addSupervisor}</Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Case edit form
// ---------------------------------------------------------------------------

export function CaseEditForm({ caseId, dict, existing, departments = [] }: { caseId: string; dict: Dictionary; existing: Record<string, unknown>; departments?: Array<{ id: number; nameFa: string; facultyNameFa: string | null }> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState({
    studentFullName: (existing.studentFullName as string) ?? "",
    studentNumber: (existing.studentNumber as string) ?? "",
    department: (existing.department as string) ?? "",
    departmentId: ((existing.departmentId as number | null) ?? null) as number | null,
    fieldOfStudy: (existing.fieldOfStudy as string) ?? "",
    academicYear: (existing.academicYear as string) ?? "",
    reason: "",
  });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await apiRequest("/api/cases/" + caseId, "PATCH", form);
    setBusy(false);
    if (!result.ok) {
      setError(errorText(result, { invalidCredentials: "", tooManyAttempts: "", accountDisabled: "", network: dict.common.networkError, unknown: dict.common.unknownError }));
      return;
    }
    setSuccess(dict.cases.caseUpdated);
    router.refresh();
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      {error && <Alert tone="danger">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}
      <Input label={dict.cases.form.studentFullName} value={form.studentFullName} onChange={(e) => setForm({ ...form, studentFullName: e.target.value })} />
      <Input label={dict.cases.form.studentNumber} dir="ltr" className="text-start" value={form.studentNumber} onChange={(e) => setForm({ ...form, studentNumber: e.target.value })} />
      {departments.length > 0 ? (
        <Select
          label={dict.cases.form.department}
          value={form.departmentId ? String(form.departmentId) : ""}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            const name = departments.find((d) => d.id === id)?.nameFa ?? "";
            setForm({ ...form, departmentId: id, department: name });
          }}
          hint={dict.common.optional}
        >
          <option value="">— {dict.common.all} —</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.facultyNameFa ? `${d.nameFa} — ${d.facultyNameFa}` : d.nameFa}</option>
          ))}
        </Select>
      ) : (
        <Input label={dict.cases.form.department} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} hint={dict.cases.org.noDepartments} />
      )}
      <Input label={dict.cases.form.fieldOfStudy} value={form.fieldOfStudy} onChange={(e) => setForm({ ...form, fieldOfStudy: e.target.value })} />
      <Input label={dict.cases.form.academicYear} dir="ltr" className="text-start" value={form.academicYear} onChange={(e) => setForm({ ...form, academicYear: e.target.value })} />
      <Textarea label={dict.common.reason} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} hint={dict.common.optional} />
      <Button type="submit" loading={busy}>{dict.common.save}</Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// File upload component
// ---------------------------------------------------------------------------

export function CaseFileUpload({ caseId, dict, canDelete = false }: { caseId: string; dict: Dictionary; canDelete?: boolean }) {
  const [deleteReason, setDeleteReason] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const removeFile = async (fileId: string) => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await apiRequest(`/api/cases/${caseId}/files/${fileId}`, "DELETE", { reason: deleteReason.trim() });
    setBusy(false);
    if (!result.ok) {
      setError(errorText(result, { invalidCredentials: "", tooManyAttempts: "", accountDisabled: "", network: dict.common.networkError, unknown: dict.common.unknownError }));
      return;
    }
    setSuccess(dict.cases.fileDeleted);
    setDeletingId(null);
    setDeleteReason("");
    router.refresh();
  };

  const handleUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const fileInput = formEl.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput?.files?.[0]) return;
    setBusy(true);
    setError(null);
    setSuccess(null);

    const formData = new FormData();
    formData.append("file", fileInput.files[0]);
    formData.append("purpose", "general");

    try {
      const response = await fetch(`/api/cases/${caseId}/files`, {
        method: "POST",
        credentials: "same-origin",
        body: formData,
      });
      const json = (await response.json().catch(() => null)) as { ok: boolean; error?: { message: string } } | null;
      if (response.ok && json?.ok) {
        setSuccess(dict.cases.fileUploaded);
        fileInput.value = "";
        router.refresh();
      } else {
        setError(json?.error?.message ?? dict.common.unknownError);
      }
    } catch {
      setError(dict.common.networkError);
    }
    setBusy(false);
  };

  return (
    <div className="pt-4">
      {error && <Alert tone="danger">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}
      <form onSubmit={handleUpload} className="flex flex-wrap items-end gap-3 pt-3">
        <label className="flex-1">
          <span className="sr-only">{dict.cases.uploadFile}</span>
          <input type="file" accept=".pdf,.docx,.doc,.jpg,.jpeg,.png" className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm" disabled={busy} />
        </label>
        <Button type="submit" loading={busy} size="sm">{dict.cases.uploadFile}</Button>
      </form>
      {canDelete ? (
        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <Input
            label={dict.cases.deleteReasonLabel}
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
            placeholder={dict.cases.deleteReasonPlaceholder}
            disabled={busy || !deletingId}
          />
          <Button
            variant="danger"
            size="sm"
            loading={busy && !!deletingId}
            disabled={!deletingId || deleteReason.trim().length < 3}
            onClick={() => deletingId && removeFile(deletingId)}
          >
            {dict.cases.deleteFile}
          </Button>
        </div>
      ) : null}
    </div>
  );
}