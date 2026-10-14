"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Progress } from "@/components/ui";
import { Input, Select, Textarea } from "@/components/ui/form";
import { useI18n } from "@/i18n/provider";
import { formatNumber } from "@/lib/format";
import { apiRequest, errorText } from "./api-client";
import type { Dictionary } from "@/i18n/dictionaries";

export interface CapacityRow {
  userId: string;
  fullName: string;
  academicRank: string | null;
  acceptsStudents: boolean;
  allowed: number;
  used: number;
  remaining: number;
  pendingCount: number;
}

export interface RequestRow {
  id: string;
  caseId: string;
  roleType: string;
  status: string;
  attemptNumber: number;
  message: string | null;
  rejectionReason: string | null;
  createdAt: string;
  caseNumber?: string;
  studentFullName?: string;
  titleFa?: string | null;
  professorName?: string | null;
}

function useMsg(dict: Dictionary) {
  return (r: { code: string; message: string }) =>
    errorText(r, { invalidCredentials: "", tooManyAttempts: "", accountDisabled: "", network: dict.common.networkError, unknown: r.message || dict.common.unknownError });
}

const STATUS_TONE: Record<string, "success" | "danger" | "info" | "neutral" | "warning"> = {
  pending: "info", accepted: "success", rejected: "danger", escalated: "warning",
};

/** Student/staff view: pick a professor with real remaining capacity and send a request. */
export function SupervisorDirectory({ dict, caseId, capacities }: { dict: Dictionary; caseId: string; capacities: CapacityRow[] }) {
  const router = useRouter();
  const { locale } = useI18n();
  const toMessage = useMsg(dict);
  const [selected, setSelected] = useState("");
  const [roleType, setRoleType] = useState<"supervisor" | "advisor">("supervisor");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const submit = async () => {
    setBusy(true); setMsg(null);
    const r = await apiRequest(`/api/cases/${caseId}/supervisor-requests`, "POST", {
      professorUserId: selected, roleType, message: message.trim() || null,
    });
    setBusy(false);
    if (!r.ok) return setMsg({ tone: "danger", text: toMessage(r) });
    setMsg({ tone: "success", text: dict.supervisor.requestCreated });
    setSelected(""); setMessage("");
    router.refresh();
  };

  const num = (n: number) => formatNumber(n, locale);

  return (
    <Card className="p-5">
      <h2 className="mb-1 text-lg font-semibold">{dict.supervisor.directoryTitle}</h2>
      <p className="mb-4 text-sm text-fg-muted">{dict.supervisor.directorySubtitle}</p>
      {msg ? <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div> : null}

      {capacities.length === 0 ? <EmptyState title={dict.supervisor.noProfessors} /> : (
        <ul className="mb-5 grid gap-3">
          {capacities.map((c) => {
            const pct = c.allowed > 0 ? Math.round((c.used / c.allowed) * 100) : 0;
            const full = c.remaining <= 0 || !c.acceptsStudents;
            return (
              <li key={c.userId}>
                <label className={full ? "block cursor-not-allowed rounded-lg border border-border bg-surface-2/60 p-4 opacity-70" : "block cursor-pointer rounded-lg border border-border bg-surface p-4 transition-colors hover:border-primary"}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <input type="radio" name="professor" value={c.userId} disabled={full} checked={selected === c.userId}
                        onChange={() => setSelected(c.userId)} className="size-4 accent-primary" />
                      <span className="font-medium">{c.fullName}</span>
                      {c.academicRank ? <Badge tone="neutral">{c.academicRank}</Badge> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {!c.acceptsStudents ? <Badge tone="neutral">{dict.supervisor.notAccepting}</Badge> : null}
                      {c.remaining <= 0 ? <Badge tone="danger">{dict.supervisor.capacityFull}</Badge> : <Badge tone="success">{dict.supervisor.remaining}: {num(c.remaining)}</Badge>}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-1">
                    <div className="flex justify-between text-xs text-fg-muted">
                      <span>{dict.supervisor.allowed}: {num(c.allowed)}</span>
                      <span>{dict.supervisor.used}: {num(c.used)}</span>
                    </div>
                    <Progress value={pct} label={`${c.fullName} — ${dict.supervisor.used}`} />
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <div className="grid gap-3 border-t border-border pt-4 md:grid-cols-2">
        <Select label={dict.supervisor.roleType} value={roleType} onChange={(e) => setRoleType(e.target.value as "supervisor" | "advisor")}>
          <option value="supervisor">{dict.supervisor.roleSupervisor}</option>
          <option value="advisor">{dict.supervisor.roleAdvisor}</option>
        </Select>
        <Textarea label={dict.supervisor.message} value={message} onChange={(e) => setMessage(e.target.value)} />
        <div className="md:col-span-2">
          <Button onClick={submit} loading={busy} disabled={!selected}>{dict.supervisor.newRequest}</Button>
        </div>
      </div>
    </Card>
  );
}

/** Professor view: their own request queue with accept/reject (reason mandatory on reject). */
export function ProfessorRequestQueue({ dict, requests }: { dict: Dictionary; requests: RequestRow[] }) {
  const router = useRouter();
  const toMessage = useMsg(dict);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const respond = async (id: string, accept: boolean) => {
    setBusyId(id); setMsg(null);
    const r = await apiRequest(`/api/supervisor-requests/${id}/respond`, "POST", { accept, reason: reasons[id]?.trim() || undefined });
    setBusyId(null);
    if (!r.ok) return setMsg({ tone: "danger", text: toMessage(r) });
    setMsg({ tone: "success", text: dict.supervisor.responded });
    setReasons({ ...reasons, [id]: "" });
    router.refresh();
  };

  return (
    <Card className="p-5">
      <h2 className="mb-4 text-lg font-semibold">{dict.supervisor.myQueue}</h2>
      {msg ? <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div> : null}
      {requests.length === 0 ? <EmptyState title={dict.supervisor.noRequests} /> : (
        <ul className="grid gap-3">
          {requests.map((r) => (
            <li key={r.id} className="rounded-lg border border-border bg-surface-2/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{r.studentFullName ?? "—"} <span className="text-xs text-fg-muted" dir="ltr">{r.caseNumber}</span></p>
                  <p className="text-sm text-fg-muted">{r.titleFa ?? dict.cases.noTitle}</p>
                  <p className="mt-1 text-xs text-fg-muted">
                    {r.roleType === "advisor" ? dict.supervisor.roleAdvisor : dict.supervisor.roleSupervisor} · {dict.supervisor.attempt} {formatNumber(r.attemptNumber, "fa")}
                  </p>
                  {r.message ? <p className="mt-1 text-xs">{r.message}</p> : null}
                </div>
                <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{(dict.supervisor as Record<string, string>)[r.status] ?? r.status}</Badge>
              </div>
              {r.status === "pending" ? (
                <div className="mt-3 grid gap-2">
                  <Input label={dict.supervisor.rejectionReason} value={reasons[r.id] ?? ""}
                    onChange={(e) => setReasons({ ...reasons, [r.id]: e.target.value })}
                    hint={dict.supervisor.rejectionReason} />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" loading={busyId === r.id} onClick={() => respond(r.id, true)}>{dict.supervisor.accept}</Button>
                    <Button size="sm" variant="danger" loading={busyId === r.id} disabled={(reasons[r.id] ?? "").trim().length < 3} onClick={() => respond(r.id, false)}>{dict.supervisor.reject}</Button>
                  </div>
                </div>
              ) : null}
              {r.rejectionReason ? <p className="mt-2 text-xs text-danger">{dict.supervisor.rejectionReason}: {r.rejectionReason}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Department head: cases that exceeded the attempt limit, with direct assignment. */
export function DeptHeadQueue({ dict, queue, capacities }: { dict: Dictionary; queue: Array<{ caseId: string; caseNumber: string; studentFullName: string; attempts: number }>; capacities: CapacityRow[] }) {
  const router = useRouter();
  const toMessage = useMsg(dict);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const assign = async (caseId: string) => {
    setBusyId(caseId); setMsg(null);
    const r = await apiRequest(`/api/cases/${caseId}/supervisor-assign`, "POST", {
      professorUserId: selected[caseId], roleType: "supervisor", reason: reasons[caseId]?.trim(),
    });
    setBusyId(null);
    if (!r.ok) return setMsg({ tone: "danger", text: toMessage(r) });
    setMsg({ tone: "success", text: dict.supervisor.responded });
    router.refresh();
  };

  return (
    <Card className="p-5">
      <h2 className="mb-1 text-lg font-semibold">{dict.supervisor.deptHeadQueue}</h2>
      <p className="mb-4 text-sm text-fg-muted">{dict.supervisor.assignReason}</p>
      {msg ? <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div> : null}
      {queue.length === 0 ? <EmptyState title={dict.supervisor.noRequests} /> : (
        <ul className="grid gap-3">
          {queue.map((q) => (
            <li key={q.caseId} className="grid gap-3 rounded-lg border border-border bg-surface-2/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{q.studentFullName} <span className="text-xs text-fg-muted" dir="ltr">{q.caseNumber}</span></p>
                <Badge tone="warning">{dict.supervisor.escalated} · {formatNumber(q.attempts, "fa")}</Badge>
              </div>
              <Select label={dict.supervisor.professor} value={selected[q.caseId] ?? ""} onChange={(e) => setSelected({ ...selected, [q.caseId]: e.target.value })}>
                <option value="">—</option>
                {capacities.filter((c) => c.remaining > 0 && c.acceptsStudents).map((c) => (
                  <option key={c.userId} value={c.userId}>{c.fullName} ({dict.supervisor.remaining}: {formatNumber(c.remaining, "fa")})</option>
                ))}
              </Select>
              <Input label={dict.supervisor.assignReason} value={reasons[q.caseId] ?? ""} onChange={(e) => setReasons({ ...reasons, [q.caseId]: e.target.value })} />
              <div>
                <Button size="sm" loading={busyId === q.caseId} disabled={!selected[q.caseId] || (reasons[q.caseId] ?? "").trim().length < 3} onClick={() => assign(q.caseId)}>
                  {dict.supervisor.assignByDeptHead}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function SupervisorsPageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return <PageHeader title={title} subtitle={subtitle} />;
}
