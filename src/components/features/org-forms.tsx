"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Badge } from "@/components/ui";
import { Input, Select } from "@/components/ui/form";
import { useI18n } from "@/i18n/provider";
import { apiRequest, errorText } from "./api-client";
import type { Dictionary } from "@/i18n/dictionaries";

export interface FacultyRow {
  id: number;
  nameFa: string;
  code: string | null;
}

export interface DepartmentRow {
  id: number;
  nameFa: string;
  code: string | null;
  facultyId: number | null;
  facultyNameFa: string | null;
  isActive: boolean;
  caseCount: number;
  userCount: number;
}

export function OrganizationManager({
  dict,
  faculties: initialFaculties,
  departments: initialDepartments,
  canManage,
}: {
  dict: Dictionary;
  faculties: FacultyRow[];
  departments: DepartmentRow[];
  canManage: boolean;
}) {
  const { locale } = useI18n();
  const router = useRouter();
  const toMessage = (r: { code: string; message: string }) =>
    errorText(r, { invalidCredentials: "", tooManyAttempts: "", accountDisabled: "", network: dict.common.networkError, unknown: dict.common.unknownError });

  const [facultyName, setFacultyName] = useState("");
  const [facultyCode, setFacultyCode] = useState("");
  const [deptName, setDeptName] = useState("");
  const [deptCode, setDeptCode] = useState("");
  const [deptFaculty, setDeptFaculty] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const num = (n: number) => n.toLocaleString(locale === "fa" ? "fa-IR" : "en-US");

  const addFaculty = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await apiRequest<{ id: number }>("/api/admin/organization?kind=faculty", "POST", {
      nameFa: facultyName.trim(),
      code: facultyCode.trim() || null,
    });
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: "danger", text: toMessage(result) });
      return;
    }
    setMessage({ tone: "success", text: dict.cases.org.created });
    setFacultyName("");
    setFacultyCode("");
    router.refresh();
  };

  const addDepartment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await apiRequest<{ id: number }>("/api/admin/organization?kind=department", "POST", {
      nameFa: deptName.trim(),
      code: deptCode.trim() || null,
      facultyId: deptFaculty ? Number(deptFaculty) : null,
    });
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: "danger", text: toMessage(result) });
      return;
    }
    setMessage({ tone: "success", text: dict.cases.org.created });
    setDeptName("");
    setDeptCode("");
    setDeptFaculty("");
    router.refresh();
  };

  const toggleDepartment = async (dept: DepartmentRow) => {
    setBusy(true);
    setMessage(null);
    const result = await apiRequest<{ id: number }>(`/api/admin/organization/departments/${dept.id}`, "PATCH", {
      isActive: !dept.isActive,
    });
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: "danger", text: toMessage(result) });
      return;
    }
    setMessage({ tone: "success", text: dict.cases.org.updated });
    router.refresh();
  };

  return (
    <div className="grid gap-6">
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Faculties */}
        <section className="rounded-xl border border-border bg-surface p-6 shadow-soft">
          <h2 className="mb-4 text-lg font-semibold">{dict.cases.org.faculties}</h2>
          {initialFaculties.length === 0 ? (
            <p className="mb-4 text-sm text-fg-muted">{dict.cases.org.noFaculties}</p>
          ) : (
            <ul className="mb-5 grid gap-2">
              {initialFaculties.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-4 py-2.5">
                  <span className="font-medium">{f.nameFa}</span>
                  {f.code ? <span className="font-mono text-xs text-fg-muted" dir="ltr">{f.code}</span> : null}
                </li>
              ))}
            </ul>
          )}
          {canManage ? (
            <form onSubmit={addFaculty} className="grid gap-3 border-t border-border pt-4">
              <Input label={dict.cases.org.facultyName} placeholder={dict.cases.org.namePlaceholder} required value={facultyName} onChange={(e) => setFacultyName(e.target.value)} />
              <Input label={dict.cases.org.facultyCode} dir="ltr" className="text-start" value={facultyCode} onChange={(e) => setFacultyCode(e.target.value)} />
              <div className="justify-self-start">
                <Button type="submit" size="sm" loading={busy} disabled={facultyName.trim().length < 2}>{dict.cases.org.addFaculty}</Button>
              </div>
            </form>
          ) : null}
        </section>

        {/* Departments */}
        <section className="rounded-xl border border-border bg-surface p-6 shadow-soft">
          <h2 className="mb-4 text-lg font-semibold">{dict.cases.org.departments}</h2>
          {initialDepartments.length === 0 ? (
            <p className="mb-4 text-sm text-fg-muted">{dict.cases.org.noDepartments}</p>
          ) : (
            <ul className="mb-5 grid gap-2">
              {initialDepartments.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="font-medium">{d.nameFa}</p>
                    <p className="text-xs text-fg-muted">
                      {d.facultyNameFa ?? "—"} · {dict.cases.org.caseCount}: {num(d.caseCount)} · {dict.cases.org.userCount}: {num(d.userCount)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!d.isActive ? <Badge tone="neutral">{dict.cases.org.inactive}</Badge> : null}
                    {canManage ? (
                      <Button variant="ghost" size="sm" onClick={() => toggleDepartment(d)} disabled={busy}>
                        {d.isActive ? dict.cases.org.deactivate : dict.cases.org.activate}
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {canManage ? (
            <form onSubmit={addDepartment} className="grid gap-3 border-t border-border pt-4">
              <Input label={dict.cases.org.departmentName} placeholder={dict.cases.org.namePlaceholder} required value={deptName} onChange={(e) => setDeptName(e.target.value)} />
              <Select
                label={dict.cases.org.parentFaculty}
                value={deptFaculty}
                onChange={(e) => setDeptFaculty(e.target.value)}
              >
                <option value="">— {dict.common.all} —</option>
                {initialFaculties.map((f) => (
                  <option key={f.id} value={f.id}>{f.nameFa}</option>
                ))}
              </Select>
              <Input label={dict.cases.org.departmentCode} dir="ltr" className="text-start" value={deptCode} onChange={(e) => setDeptCode(e.target.value)} />
              <div className="justify-self-start">
                <Button type="submit" size="sm" loading={busy} disabled={deptName.trim().length < 2}>{dict.cases.org.addDepartment}</Button>
              </div>
            </form>
          ) : null}
        </section>
      </div>
    </div>
  );
}
