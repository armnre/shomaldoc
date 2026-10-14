"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Badge, Button, EmptyState } from "@/components/ui";
import { Input, Select, Switch } from "@/components/ui/form";
import { useI18n } from "@/i18n/provider";
import { apiRequest, errorText } from "./api-client";
import type { Dictionary } from "@/i18n/dictionaries";

export interface FieldRow { id: number; nameFa: string; code: string | null; degreeLevel: string; departmentId: number | null; isActive: boolean }
export interface TrackRow { id: number; fieldId: number; nameFa: string; isActive: boolean }
export interface TermRow { id: number; code: string; titleFa: string; startDate: string | null; endDate: string | null; isCurrent: boolean; isActive: boolean }
export interface DeptOption { id: number; nameFa: string }

function useMsg(dict: Dictionary) {
  return (r: { code: string; message: string }) =>
    errorText(r, { invalidCredentials: "", tooManyAttempts: "", accountDisabled: "", network: dict.common.networkError, unknown: r.message || dict.common.unknownError });
}

export function FieldsManager({ dict, fields, departments, canManage }: { dict: Dictionary; fields: FieldRow[]; departments: DeptOption[]; canManage: boolean }) {
  const router = useRouter();
  const toMessage = useMsg(dict);
  const [form, setForm] = useState({ nameFa: "", code: "", degreeLevel: "کارشناسی ارشد", departmentId: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await apiRequest("/api/admin/organization/fields", "POST", {
      nameFa: form.nameFa.trim(),
      code: form.code.trim() || null,
      degreeLevel: form.degreeLevel,
      departmentId: form.departmentId ? Number(form.departmentId) : null,
    });
    setBusy(false);
    if (!r.ok) return setMsg({ tone: "danger", text: toMessage(r) });
    setMsg({ tone: "success", text: dict.cases.org.created });
    setForm({ nameFa: "", code: "", degreeLevel: "کارشناسی ارشد", departmentId: "" });
    router.refresh();
  };

  const toggle = async (f: FieldRow) => {
    setBusy(true); setMsg(null);
    const r = await apiRequest(`/api/admin/organization/fields/${f.id}`, "PATCH", { isActive: !f.isActive });
    setBusy(false);
    if (!r.ok) return setMsg({ tone: "danger", text: toMessage(r) });
    setMsg({ tone: "success", text: dict.cases.org.updated });
    router.refresh();
  };

  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-soft">
      <h3 className="mb-4 text-base font-semibold">{dict.org.fields}</h3>
      {msg ? <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div> : null}
      {fields.length === 0 ? <EmptyState title={dict.org.noFields} /> : (
        <ul className="mb-5 grid gap-2">
          {fields.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-4 py-2.5 text-sm">
              <div>
                <p className="font-medium">{f.nameFa} <span className="text-xs text-fg-muted">({f.degreeLevel})</span></p>
                <p className="text-xs text-fg-muted">{departments.find((d) => d.id === f.departmentId)?.nameFa ?? "—"}{f.code ? ` · ${f.code}` : ""}</p>
              </div>
              <div className="flex items-center gap-2">
                {!f.isActive ? <Badge tone="neutral">{dict.common.inactive}</Badge> : null}
                {canManage ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => toggle(f)}>{f.isActive ? dict.cases.org.deactivate : dict.cases.org.activate}</Button> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <form onSubmit={submit} className="grid gap-3 border-t border-border pt-4 md:grid-cols-2">
          <Input label={dict.org.fieldName} required value={form.nameFa} onChange={(e) => setForm({ ...form, nameFa: e.target.value })} />
          <Select label={dict.org.parentDepartment} value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
            <option value="">—</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.nameFa}</option>)}
          </Select>
          <Input label={dict.org.fieldCode} dir="ltr" className="text-start" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <Select label={dict.org.degreeLevel} value={form.degreeLevel} onChange={(e) => setForm({ ...form, degreeLevel: e.target.value })}>
            <option value="کارشناسی ارشد">کارشناسی ارشد</option>
            <option value="دکتری">دکتری</option>
          </Select>
          <div className="md:col-span-2"><Button type="submit" size="sm" loading={busy} disabled={form.nameFa.trim().length < 2}>{dict.org.addField}</Button></div>
        </form>
      ) : null}
    </section>
  );
}

export function TracksManager({ dict, tracks, fields, canManage }: { dict: Dictionary; tracks: TrackRow[]; fields: FieldRow[]; canManage: boolean }) {
  const router = useRouter();
  const toMessage = useMsg(dict);
  const [form, setForm] = useState({ fieldId: "", nameFa: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await apiRequest("/api/admin/organization/tracks", "POST", { fieldId: Number(form.fieldId), nameFa: form.nameFa.trim() });
    setBusy(false);
    if (!r.ok) return setMsg({ tone: "danger", text: toMessage(r) });
    setMsg({ tone: "success", text: dict.cases.org.created });
    setForm({ fieldId: "", nameFa: "" });
    router.refresh();
  };

  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-soft">
      <h3 className="mb-4 text-base font-semibold">{dict.org.tracks}</h3>
      {msg ? <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div> : null}
      {tracks.length === 0 ? <EmptyState title={dict.org.noTracks} /> : (
        <ul className="mb-5 grid gap-2">
          {tracks.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-4 py-2.5 text-sm">
              <span className="font-medium">{t.nameFa}</span>
              <span className="text-xs text-fg-muted">{fields.find((f) => f.id === t.fieldId)?.nameFa ?? "—"}</span>
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <form onSubmit={submit} className="grid gap-3 border-t border-border pt-4 md:grid-cols-2">
          <Select label={dict.org.field} required value={form.fieldId} onChange={(e) => setForm({ ...form, fieldId: e.target.value })}>
            <option value="">—</option>
            {fields.map((f) => <option key={f.id} value={f.id}>{f.nameFa}</option>)}
          </Select>
          <Input label={dict.org.trackName} required value={form.nameFa} onChange={(e) => setForm({ ...form, nameFa: e.target.value })} />
          <div className="md:col-span-2"><Button type="submit" size="sm" loading={busy} disabled={!form.fieldId || form.nameFa.trim().length < 2}>{dict.org.addTrack}</Button></div>
        </form>
      ) : null}
    </section>
  );
}

export function TermsManager({ dict, terms, canManage }: { dict: Dictionary; terms: TermRow[]; canManage: boolean }) {
  const router = useRouter();
  const toMessage = useMsg(dict);
  const [form, setForm] = useState({ code: "", titleFa: "", startDate: "", endDate: "", isCurrent: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await apiRequest("/api/admin/organization/terms", "POST", {
      code: form.code.trim(),
      titleFa: form.titleFa.trim(),
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      isCurrent: form.isCurrent,
    });
    setBusy(false);
    if (!r.ok) return setMsg({ tone: "danger", text: toMessage(r) });
    setMsg({ tone: "success", text: dict.cases.org.created });
    setForm({ code: "", titleFa: "", startDate: "", endDate: "", isCurrent: false });
    router.refresh();
  };

  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-soft">
      <h3 className="mb-4 text-base font-semibold">{dict.org.terms}</h3>
      {msg ? <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div> : null}
      {terms.length === 0 ? <EmptyState title={dict.org.noTerms} /> : (
        <ul className="mb-5 grid gap-2">
          {terms.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-4 py-2.5 text-sm">
              <div>
                <p className="font-medium">{t.titleFa}</p>
                <p className="text-xs text-fg-muted" dir="ltr">{t.code}</p>
              </div>
              {t.isCurrent ? <Badge tone="success">{dict.org.currentTerm}</Badge> : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <form onSubmit={submit} className="grid gap-3 border-t border-border pt-4 md:grid-cols-2">
          <Input label={dict.org.termCode} required dir="ltr" className="text-start" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <Input label={dict.org.termTitle} required value={form.titleFa} onChange={(e) => setForm({ ...form, titleFa: e.target.value })} />
          <Input label={dict.org.termStart} type="date" dir="ltr" className="text-start" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          <Input label={dict.org.termEnd} type="date" dir="ltr" className="text-start" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          <div className="flex items-center gap-3 md:col-span-2">
            <Switch checked={form.isCurrent} onChange={(v) => setForm({ ...form, isCurrent: v })} label={dict.org.currentTerm} />
            <span className="text-sm text-fg-muted">{dict.org.currentTermHint}</span>
          </div>
          <div className="md:col-span-2"><Button type="submit" size="sm" loading={busy} disabled={form.code.trim().length < 2 || form.titleFa.trim().length < 2}>{dict.org.addTerm}</Button></div>
        </form>
      ) : null}
    </section>
  );
}

/** Bulk import: preview first, then apply only validated rows. Nothing is guessed. */
export function UserImportPanel({ dict }: { dict: Dictionary }) {
  const router = useRouter();
  const toMessage = useMsg(dict);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [preview, setPreview] = useState<{ batchId: string; results: Array<{ line: number; status: string; errors: string[]; row: { username: string; email: string; fullName: string; roleKeys: string[] } }> } | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const run = async (mode: "preview" | "apply") => {
    if (!file && mode === "preview") return setMsg({ tone: "danger", text: dict.org.importPickFile });
    setBusy(true); setMsg(null);
    const fd = new FormData();
    if (file) fd.append("file", file);
    if (mode === "apply" && preview) fd.append("batchId", preview.batchId);
    try {
      const res = await fetch(`/api/admin/users/import?mode=${mode}`, { method: "POST", credentials: "same-origin", body: fd });
      const json = (await res.json().catch(() => null)) as { ok: boolean; data?: unknown; error?: { message: string } } | null;
      if (!res.ok || !json?.ok) {
        setMsg({ tone: "danger", text: json?.error?.message ? toMessage({ code: "X", message: json.error.message }) : dict.common.unknownError });
        return;
      }
      if (mode === "preview") {
        setPreview(json.data as typeof preview);
        setMsg({ tone: "success", text: dict.org.importPreviewDone });
      } else {
        const applied = json.data as { applied: number; skipped: number };
        setMsg({ tone: "success", text: `${dict.org.importApplied} (${applied.applied}) — ${dict.org.importSkipped} (${applied.skipped})` });
        setPreview(null); setFile(null);
        router.refresh();
      }
    } catch {
      setMsg({ tone: "danger", text: dict.common.networkError });
    } finally {
      setBusy(false);
    }
  };

  const validCount = preview?.results.filter((r) => r.status === "valid").length ?? 0;

  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-soft">
      <h3 className="mb-2 text-base font-semibold">{dict.org.importTitle}</h3>
      <p className="mb-4 text-sm text-fg-muted">{dict.org.importHint}</p>
      {msg ? <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div> : null}
      <label className="mb-3 block">
        <span className="sr-only">{dict.org.importPickFile}</span>
        <input type="file" accept=".csv,.xlsx" className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" loading={busy} disabled={!file} onClick={() => run("preview")}>{dict.org.importPreview}</Button>
        <Button size="sm" loading={busy} disabled={!preview || validCount === 0} onClick={() => run("apply")}>{dict.org.importApply}</Button>
      </div>
      {preview ? (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-surface-2 text-fg-muted">
              <tr><th className="p-2 text-start">{dict.org.importLine}</th><th className="p-2 text-start">{dict.users.colUsername}</th><th className="p-2 text-start">{dict.users.colName}</th><th className="p-2 text-start">{dict.users.colRoles}</th><th className="p-2 text-start">{dict.common.status}</th></tr>
            </thead>
            <tbody>
              {preview.results.slice(0, 200).map((r) => (
                <tr key={r.line} className="border-t border-border align-top">
                  <td className="tabular p-2" dir="ltr">{r.line}</td>
                  <td className="p-2 font-mono text-xs" dir="ltr">{r.row.username}</td>
                  <td className="p-2">{r.row.fullName}</td>
                  <td className="p-2 text-xs">{r.row.roleKeys.join("، ")}</td>
                  <td className="p-2">
                    {r.status === "valid" ? <Badge tone="success">{dict.org.importValid}</Badge> : (
                      <div className="grid gap-1"><Badge tone="danger">{dict.org.importInvalid}</Badge>
                        <ul className="text-xs text-danger">{r.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
