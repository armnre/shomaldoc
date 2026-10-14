"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Alert, Badge, Button } from "@/components/ui";
import { Input, Select, Switch, Textarea } from "@/components/ui/form";
import { useI18n } from "@/i18n/provider";
import { apiRequest, errorText } from "./api-client";
import type { Dictionary } from "@/i18n/dictionaries";

export interface DefinitionRow {
  id: number;
  code: string;
  titleFa: string;
  version: number;
  isPublished: boolean;
  isActive: boolean;
  pendingUniversityApproval: boolean;
  openInstances: number;
}

export interface StepRow {
  id: number;
  stepKey: string;
  titleFa: string;
  orderIndex: number;
  isInitial: boolean;
  isTerminal: boolean;
}

export interface TransitionRow {
  id: number;
  fromStep: string;
  action: string;
  actionLabelFa: string;
  toStep: string;
  requiredPermission: string;
  reasonRequired: boolean;
  assignRole: string | null;
  dueDays: number | null;
  escalationRole: string | null;
}

export interface GraphIssue {
  code: string;
  messageFa: string;
  step?: string;
}

export interface Detail {
  definition: DefinitionRow;
  steps: StepRow[];
  transitions: TransitionRow[];
  issues: GraphIssue[];
}

const ROLE_KEYS = ["student", "supervisor", "advisor", "dept_head", "grad_office", "finance", "reviewer", "graduation_officer", "system_admin"];

/**
 * Workflow editor. Editing a definition that already runs instances publishes a
 * NEW version (open instances keep their version); nothing is mutated in place.
 */
export function WorkflowEditor({ dict, detail, canManage, permissionOptions }: { dict: Dictionary; detail: Detail; canManage: boolean; permissionOptions: string[] }) {
  const router = useRouter();
  const { locale } = useI18n();
  const [steps, setSteps] = useState<StepRow[]>(detail.steps);
  const [transitions, setTransitions] = useState<TransitionRow[]>(detail.transitions);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const toMessage = (r: { code: string; message: string; details?: unknown }) => {
    const issues = (r.details as { issues?: GraphIssue[] } | undefined)?.issues;
    if (issues?.length) return issues.map((i) => i.messageFa).join(" · ");
    return errorText(r, { invalidCredentials: "", tooManyAttempts: "", accountDisabled: "", network: dict.common.networkError, unknown: r.message || dict.common.unknownError });
  };

  // Local graph preview: exit counts and destinations per step.
  const graph = useMemo(() => {
    const exits = new Map<string, number>();
    for (const t of transitions) exits.set(t.fromStep, (exits.get(t.fromStep) ?? 0) + 1);
    return steps.map((s) => ({ ...s, exits: exits.get(s.stepKey) ?? 0 }));
  }, [steps, transitions]);

  const num = (n: number) => n.toLocaleString(locale === "fa" ? "fa-IR" : "en-US");
  const dirty =
    JSON.stringify(steps.map((s) => [s.stepKey, s.titleFa, s.orderIndex, s.isInitial, s.isTerminal])) !==
      JSON.stringify(detail.steps.map((s) => [s.stepKey, s.titleFa, s.orderIndex, s.isInitial, s.isTerminal])) ||
    JSON.stringify(transitions.map((t) => [t.fromStep, t.action, t.actionLabelFa, t.toStep, t.requiredPermission, t.reasonRequired, t.assignRole, t.dueDays, t.escalationRole])) !==
      JSON.stringify(detail.transitions.map((t) => [t.fromStep, t.action, t.actionLabelFa, t.toStep, t.requiredPermission, t.reasonRequired, t.assignRole, t.dueDays, t.escalationRole]));

  const addStep = () =>
    setSteps([...steps, { id: 0, stepKey: "", titleFa: "", orderIndex: steps.length, isInitial: false, isTerminal: false }]);
  const removeStep = (key: string) => {
    setSteps(steps.filter((s) => s.stepKey !== key));
    setTransitions(transitions.filter((t) => t.fromStep !== key && t.toStep !== key));
  };
  const moveStep = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    setSteps(next.map((s, i) => ({ ...s, orderIndex: i })));
  };
  const addTransition = () =>
    setTransitions([
      ...transitions,
      { id: 0, fromStep: steps[0]?.stepKey ?? "", action: "", actionLabelFa: "", toStep: steps[0]?.stepKey ?? "", requiredPermission: "", reasonRequired: false, assignRole: null, dueDays: null, escalationRole: null },
    ]);

  const publish = async () => {
    setBusy(true);
    setMessage(null);
    const result = await apiRequest<{ id: number }>("/api/admin/workflows/" + detail.definition.id, "POST", {
      steps: steps.map((s) => ({ stepKey: s.stepKey, titleFa: s.titleFa, orderIndex: s.orderIndex, isInitial: s.isInitial, isTerminal: s.isTerminal })),
      transitions: transitions.map((t) => ({
        fromStep: t.fromStep,
        action: t.action,
        actionLabelFa: t.actionLabelFa,
        toStep: t.toStep,
        requiredPermission: t.requiredPermission,
        reasonRequired: t.reasonRequired,
        assignRole: t.assignRole,
        dueDays: t.dueDays,
        escalationRole: t.escalationRole,
      })),
      reason: reason.trim(),
    });
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: "danger", text: toMessage(result) });
      return;
    }
    setMessage({ tone: "success", text: dict.workflow.versionCreated });
    router.refresh();
  };

  const togglePublished = async (published: boolean) => {
    setBusy(true);
    setMessage(null);
    const result = await apiRequest<{ id: number }>("/api/admin/workflows/" + detail.definition.id, "PATCH", { published, reason: reason.trim() });
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: "danger", text: toMessage(result) });
      return;
    }
    setMessage({ tone: "success", text: published ? dict.workflow.published : dict.workflow.unpublished });
    router.refresh();
  };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-lg font-semibold">{detail.definition.titleFa}</h2>
        <Badge tone="primary">{dict.workflow.version}: {num(detail.definition.version)}</Badge>
        <Badge tone={detail.definition.isPublished ? "success" : "neutral"}>{detail.definition.isPublished ? dict.workflow.published : dict.workflow.draft}</Badge>
        {detail.definition.pendingUniversityApproval ? <Badge tone="warning">{dict.workflow.pendingApproval}</Badge> : null}
        <Badge tone="info">{dict.workflow.openInstances}: {num(detail.definition.openInstances)}</Badge>
        <code className="text-xs text-fg-muted" dir="ltr">{detail.definition.code}</code>
      </div>

      {detail.issues.length > 0 ? (
        <Alert tone="warning" title={dict.workflow.graphIssues}>
          <ul className="grid gap-1">
            {detail.issues.map((i, idx) => (
              <li key={`${i.code}-${idx}`}>{i.messageFa}</li>
            ))}
          </ul>
        </Alert>
      ) : (
        <Alert tone="success">{dict.workflow.graphValid}</Alert>
      )}

      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}

      {/* Graph preview */}
      <section className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h3 className="mb-4 text-base font-semibold">{dict.workflow.graphPreview}</h3>
        <ol className="grid gap-2">
          {graph.map((s, i) => (
            <li key={`${s.stepKey}-${i}`} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-4 py-2.5 text-sm">
              <span className="tabular w-6 text-fg-muted">{num(i + 1)}</span>
              <code className="font-mono text-xs" dir="ltr">{s.stepKey || "—"}</code>
              <span className="font-medium">{s.titleFa || dict.workflow.untitled}</span>
              {s.isInitial ? <Badge tone="info">{dict.workflow.initial}</Badge> : null}
              {s.isTerminal ? <Badge tone="neutral">{dict.workflow.terminal}</Badge> : null}
              {s.exits === 0 && !s.isTerminal ? <Badge tone="danger">{dict.workflow.noExit}</Badge> : null}
            </li>
          ))}
        </ol>
      </section>

      {/* Steps */}
      <section className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold">{dict.workflow.steps}</h3>
          {canManage ? <Button size="sm" variant="secondary" onClick={addStep}>{dict.workflow.addStep}</Button> : null}
        </div>
        <div className="grid gap-3">
          {steps.map((s, i) => (
            <div key={`${s.stepKey}-${i}`} className="grid gap-3 rounded-lg bg-surface-2 p-4 md:grid-cols-[1fr_1fr_auto_auto_auto]">
              <Input label={dict.workflow.stepKey} dir="ltr" className="text-start" value={s.stepKey} disabled={!canManage}
                onChange={(e) => setSteps(steps.map((x, xi) => (xi === i ? { ...x, stepKey: e.target.value.toUpperCase().replace(/\s+/g, "_") } : x)))} />
              <Input label={dict.workflow.stepTitle} value={s.titleFa} disabled={!canManage}
                onChange={(e) => setSteps(steps.map((x, xi) => (xi === i ? { ...x, titleFa: e.target.value } : x)))} />
              <div className="grid content-center gap-1">
                <span className="text-xs text-fg-muted">{dict.workflow.initial}</span>
                <Switch checked={s.isInitial} disabled={!canManage} label={dict.workflow.initial}
                  onChange={(v) => setSteps(steps.map((x, xi) => (xi === i ? { ...x, isInitial: v } : x)))} />
              </div>
              <div className="grid content-center gap-1">
                <span className="text-xs text-fg-muted">{dict.workflow.terminal}</span>
                <Switch checked={s.isTerminal} disabled={!canManage} label={dict.workflow.terminal}
                  onChange={(v) => setSteps(steps.map((x, xi) => (xi === i ? { ...x, isTerminal: v } : x)))} />
              </div>
              {canManage ? (
                <div className="flex items-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => moveStep(i, -1)} aria-label={dict.common.previous}>↑</Button>
                  <Button size="sm" variant="ghost" onClick={() => moveStep(i, 1)} aria-label={dict.common.next}>↓</Button>
                  <Button size="sm" variant="danger" onClick={() => removeStep(s.stepKey)}>{dict.common.delete}</Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {/* Transitions */}
      <section className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold">{dict.workflow.transitions}</h3>
          {canManage ? <Button size="sm" variant="secondary" onClick={addTransition}>{dict.workflow.addTransition}</Button> : null}
        </div>
        <div className="grid gap-3">
          {transitions.map((t, i) => (
            <div key={`${t.action}-${i}`} className="grid gap-3 rounded-lg bg-surface-2 p-4 lg:grid-cols-3">
              <Select label={dict.workflow.fromStep} value={t.fromStep} disabled={!canManage}
                onChange={(e) => setTransitions(transitions.map((x, xi) => (xi === i ? { ...x, fromStep: e.target.value } : x)))}>
                <option value="">—</option>
                {steps.map((s) => <option key={s.stepKey} value={s.stepKey}>{s.titleFa || s.stepKey}</option>)}
              </Select>
              <Input label={dict.workflow.actionKey} dir="ltr" className="text-start" value={t.action} disabled={!canManage}
                onChange={(e) => setTransitions(transitions.map((x, xi) => (xi === i ? { ...x, action: e.target.value.toLowerCase().replace(/\s+/g, "_") } : x)))} />
              <Input label={dict.workflow.actionLabel} value={t.actionLabelFa} disabled={!canManage}
                onChange={(e) => setTransitions(transitions.map((x, xi) => (xi === i ? { ...x, actionLabelFa: e.target.value } : x)))} />
              <Select label={dict.workflow.toStep} value={t.toStep} disabled={!canManage}
                onChange={(e) => setTransitions(transitions.map((x, xi) => (xi === i ? { ...x, toStep: e.target.value } : x)))}>
                <option value="">—</option>
                {steps.map((s) => <option key={s.stepKey} value={s.stepKey}>{s.titleFa || s.stepKey}</option>)}
              </Select>
              <Select label={dict.workflow.requiredPermission} value={t.requiredPermission} disabled={!canManage}
                onChange={(e) => setTransitions(transitions.map((x, xi) => (xi === i ? { ...x, requiredPermission: e.target.value } : x)))}>
                <option value="">—</option>
                {permissionOptions.map((p) => <option key={p} value={p} dir="ltr">{p}</option>)}
              </Select>
              <Select label={dict.workflow.assignRole} value={t.assignRole ?? ""} disabled={!canManage}
                onChange={(e) => setTransitions(transitions.map((x, xi) => (xi === i ? { ...x, assignRole: e.target.value || null } : x)))}>
                <option value="">—</option>
                {ROLE_KEYS.map((r) => <option key={r} value={r}>{(dict.roleNames as Record<string, string>)[r] ?? r}</option>)}
              </Select>
              <Input label={dict.workflow.dueDays} type="number" min={1} max={365} dir="ltr" className="text-start" value={t.dueDays ?? ""} disabled={!canManage}
                onChange={(e) => setTransitions(transitions.map((x, xi) => (xi === i ? { ...x, dueDays: e.target.value ? Number(e.target.value) : null } : x)))} />
              <Select label={dict.workflow.escalationRole} value={t.escalationRole ?? ""} disabled={!canManage}
                onChange={(e) => setTransitions(transitions.map((x, xi) => (xi === i ? { ...x, escalationRole: e.target.value || null } : x)))}>
                <option value="">—</option>
                {ROLE_KEYS.map((r) => <option key={r} value={r}>{(dict.roleNames as Record<string, string>)[r] ?? r}</option>)}
              </Select>
              <div className="grid content-center gap-1">
                <span className="text-xs text-fg-muted">{dict.workflow.reasonRequired}</span>
                <Switch checked={t.reasonRequired} disabled={!canManage} label={dict.workflow.reasonRequired}
                  onChange={(v) => setTransitions(transitions.map((x, xi) => (xi === i ? { ...x, reasonRequired: v } : x)))} />
              </div>
              {canManage ? (
                <div className="flex items-end">
                  <Button size="sm" variant="danger" onClick={() => setTransitions(transitions.filter((_, xi) => xi !== i))}>{dict.common.delete}</Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {canManage ? (
        <section className="grid gap-4 rounded-xl border border-border bg-surface p-5 shadow-soft">
          <p className="text-sm text-fg-muted">{dict.workflow.versioningNote}</p>
          <Textarea label={dict.workflow.reasonLabel} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={dict.workflow.reasonPlaceholder} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={publish} loading={busy} disabled={!dirty || reason.trim().length < 3}>{dict.workflow.publishVersion}</Button>
            <Button variant="secondary" onClick={() => togglePublished(!detail.definition.isPublished)} loading={busy} disabled={reason.trim().length < 3}>
              {detail.definition.isPublished ? dict.workflow.unpublish : dict.workflow.publish}
            </Button>
          </div>
        </section>
      ) : (
        <Alert tone="info">{dict.errors.forbiddenText}</Alert>
      )}
    </div>
  );
}
