"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Card, EmptyState } from "@/components/ui";
import { Input } from "@/components/ui/form";
import { useI18n } from "@/i18n/provider";
import { formatDateTime } from "@/lib/format";
import { apiRequest, errorText } from "./api-client";
import type { Dictionary } from "@/i18n/dictionaries";

export interface SessionRow {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

function useMsg(dict: Dictionary) {
  return (r: { code: string; message: string }) =>
    errorText(r, { invalidCredentials: "", tooManyAttempts: "", accountDisabled: "", network: dict.common.networkError, unknown: r.message || dict.common.unknownError });
}

/** Real session management: list own devices and revoke one or all. */
export function SessionsPanel({ dict, currentSessionId }: { dict: Dictionary; currentSessionId: string }) {
  const { locale } = useI18n();
  const router = useRouter();
  const toMessage = useMsg(dict);
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await apiRequest<{ sessions: SessionRow[] }>("/api/auth/sessions", "GET");
    if (r.ok) setRows(r.data.sessions);
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const r = await apiRequest<{ sessions: SessionRow[] }>("/api/auth/sessions", "GET");
      if (alive && r.ok) setRows(r.data.sessions);
    };
    void tick();
    return () => { alive = false; };
  }, []);

  const revoke = async (id: string) => {
    setBusyId(id); setMsg(null);
    const r = await apiRequest(`/api/auth/sessions/${id}/revoke`, "POST", {});
    setBusyId(null);
    if (!r.ok) return setMsg({ tone: "danger", text: toMessage(r) });
    setMsg({ tone: "success", text: dict.sessions.revoked });
    void load();
    router.refresh();
  };

  const revokeAll = async () => {
    setBusyId("all"); setMsg(null);
    const r = await apiRequest<{ revoked: number }>("/api/auth/sessions?all=1", "DELETE");
    setBusyId(null);
    if (!r.ok) return setMsg({ tone: "danger", text: toMessage(r) });
    setMsg({ tone: "success", text: dict.sessions.revokedAll });
    void load();
    router.refresh();
  };

  return (
    <Card className="p-6">
      <h2 className="mb-1 text-lg font-semibold">{dict.sessions.title}</h2>
      <p className="mb-4 text-sm text-fg-muted">{dict.sessions.subtitle}</p>
      {msg ? <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div> : null}
      {rows === null ? <div className="skeleton h-24 rounded-lg" aria-hidden /> : rows.length === 0 ? (
        <EmptyState title={dict.sessions.none} />
      ) : (
        <ul className="grid gap-2">
          {rows.map((s) => {
            const isCurrent = s.id === currentSessionId;
            return (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" dir="ltr">{s.userAgent?.slice(0, 70) ?? "—"}</p>
                  <p className="text-xs text-fg-muted">
                    <span dir="ltr">{s.ip ?? "—"}</span> · {dict.sessions.lastSeen}: {formatDateTime(s.lastSeenAt, locale)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {isCurrent ? <Badge tone="success">{dict.sessions.current}</Badge> : (
                    <Button size="sm" variant="danger" loading={busyId === s.id} onClick={() => revoke(s.id)}>{dict.sessions.revoke}</Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-4">
        <Button size="sm" variant="secondary" loading={busyId === "all"} onClick={revokeAll}>{dict.sessions.revokeAll}</Button>
      </div>
    </Card>
  );
}

/** Optional TOTP 2FA enrolment; the secret is shown exactly once. */
export function TwoFactorPanel({ dict }: { dict: Dictionary }) {
  const toMessage = useMsg(dict);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [enroll, setEnroll] = useState<{ otpauthUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const r = await apiRequest<{ enabled: boolean }>("/api/auth/2fa", "GET");
      if (alive && r.ok) setEnabled(r.data.enabled);
    };
    void tick();
    return () => { alive = false; };
  }, []);

  const start = async () => {
    setBusy(true); setMsg(null);
    const r = await apiRequest<{ otpauthUrl: string; secret: string }>("/api/auth/2fa", "POST", { step: "start" });
    setBusy(false);
    if (!r.ok) return setMsg({ tone: "danger", text: toMessage(r) });
    setEnroll(r.data);
  };

  const confirm = async () => {
    setBusy(true); setMsg(null);
    const r = await apiRequest<{ enabled: boolean }>("/api/auth/2fa", "POST", { step: "confirm", code });
    setBusy(false);
    if (!r.ok) return setMsg({ tone: "danger", text: toMessage(r) });
    setEnabled(true); setEnroll(null); setCode("");
    setMsg({ tone: "success", text: dict.sessions.twoFactorEnabled });
  };

  return (
    <Card className="p-6">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{dict.sessions.twoFactor}</h2>
        {enabled === null ? null : <Badge tone={enabled ? "success" : "neutral"}>{enabled ? dict.sessions.twoFactorEnabled : dict.sessions.twoFactorDisabled}</Badge>}
      </div>
      <p className="mb-4 text-sm text-fg-muted">{dict.sessions.twoFactorSubtitle}</p>
      {msg ? <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div> : null}

      {enroll ? (
        <div className="grid gap-3">
          <Alert tone="info">{dict.sessions.scanHint}</Alert>
          <div className="rounded-lg bg-surface-2 p-3">
            <p className="text-xs text-fg-muted">{dict.sessions.secretKey}</p>
            <code className="block break-all text-sm" dir="ltr">{enroll.secret}</code>
            <a href={enroll.otpauthUrl} className="mt-2 inline-block text-xs text-primary hover:underline" dir="ltr">otpauth://…</a>
          </div>
          <Input label={dict.sessions.codeLabel} inputMode="numeric" maxLength={6} dir="ltr" className="text-start tracking-[0.4em]"
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          <div><Button size="sm" loading={busy} disabled={code.length !== 6} onClick={confirm}>{dict.sessions.enrollConfirm}</Button></div>
        </div>
      ) : (
        <div><Button size="sm" variant={enabled ? "secondary" : "primary"} loading={busy} onClick={start}>{dict.sessions.enrollStart}</Button></div>
      )}
    </Card>
  );
}

/** Reports: real CSV/JSON from the database within the caller's visibility scope. */
export function ReportsPanel({ dict }: { dict: Dictionary }) {
  const toMessage = useMsg(dict);
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [total, setTotal] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const params = () => {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    return q.toString();
  };

  const view = async () => {
    setMsg(null);
    const r = await apiRequest<{ total: number }>(`/api/reports/cases?${params()}`, "GET");
    if (!r.ok) return setMsg({ tone: "danger", text: toMessage(r) });
    setTotal(r.data.total);
  };

  return (
    <Card className="p-6">
      <h2 className="mb-1 text-lg font-semibold">{dict.reports.title}</h2>
      <p className="mb-4 text-sm text-fg-muted">{dict.reports.subtitle}</p>
      {msg ? <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div> : null}
      <div className="grid gap-3 md:grid-cols-3">
        <Input label={dict.reports.filterStatus} value={status} onChange={(e) => setStatus(e.target.value)} hint="draft | submitted | approved | …" dir="ltr" className="text-start" />
        <Input label={dict.reports.filterFrom} type="date" dir="ltr" className="text-start" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label={dict.reports.filterTo} type="date" dir="ltr" className="text-start" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={view}>{dict.reports.viewJson}</Button>
        <a href={`/api/reports/cases?format=csv&${params()}`} className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-2">
          {dict.reports.downloadCsv}
        </a>
        <a href={`/api/reports/cases?format=xlsx&${params()}`} className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-2">
          {dict.reports.downloadXlsx}
        </a>
        {total !== null ? <Badge tone="primary">{dict.reports.rows}: {total}</Badge> : null}
      </div>
      <p className="mt-3 text-xs text-fg-muted">{dict.reports.injectionNote}</p>
    </Card>
  );
}
