"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Rocket, Save, ShieldCheck, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Toast } from "@/components/ui";
import { Input, Select, Switch, Textarea } from "@/components/ui/form";
import { useI18n } from "@/i18n/provider";
import { apiRequest, errorText } from "./api-client";
import type { Dictionary } from "@/i18n/dictionaries";

export interface DefinitionRow {
  id: number; code: string; titleFa: string; version: number; isPublished: boolean;
  isActive: boolean; pendingUniversityApproval: boolean; openInstances: number;
}
export interface StepRow { id: number; stepKey: string; titleFa: string; orderIndex: number; isInitial: boolean; isTerminal: boolean }
export interface TransitionRow {
  id: number; fromStep: string; action: string; actionLabelFa: string; toStep: string;
  requiredPermission: string; reasonRequired: boolean; assignRole: string | null;
  dueDays: number | null; escalationRole: string | null;
}
export interface GraphIssue { code: string; messageFa: string; step?: string }
export interface Detail { definition: DefinitionRow; steps: StepRow[]; transitions: TransitionRow[]; issues: GraphIssue[] }

const ROLE_KEYS = ["student", "supervisor", "advisor", "dept_head", "grad_office", "finance", "reviewer", "graduation_officer", "system_admin"];
type PendingAction = "save" | "publish";

function stepSignature(step: StepRow) {
  return [step.stepKey, step.titleFa, step.orderIndex, step.isInitial, step.isTerminal].join("|");
}
function transitionSignature(transition: TransitionRow) {
  return [transition.fromStep, transition.action, transition.actionLabelFa, transition.toStep, transition.requiredPermission, transition.reasonRequired, transition.assignRole, transition.dueDays, transition.escalationRole].join("|");
}

export function WorkflowEditor({
  dict, detail, publishedDetail, canManage, permissionOptions,
}: {
  dict: Dictionary; detail: Detail; publishedDetail?: Detail | null; canManage: boolean; permissionOptions: string[];
}) {
  const router = useRouter();
  const { locale } = useI18n();
  const [steps, setSteps] = useState<StepRow[]>(detail.steps);
  const [transitions, setTransitions] = useState<TransitionRow[]>(detail.transitions);
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState("");
  const [toast, setToast] = useState<{ tone: "success" | "danger" | "info"; title: string; text?: string } | null>(null);
  const [validationIssues, setValidationIssues] = useState<GraphIssue[] | null>(null);

  const num = (value: number) => value.toLocaleString(locale === "fa" ? "fa-IR" : "en-US");
  const changedCount = useMemo(() => {
    let count = Math.abs(steps.length - detail.steps.length) + Math.abs(transitions.length - detail.transitions.length);
    steps.forEach((step, index) => { if (stepSignature(step) !== (detail.steps[index] ? stepSignature(detail.steps[index]) : "")) count += 1; });
    transitions.forEach((transition, index) => { if (transitionSignature(transition) !== (detail.transitions[index] ? transitionSignature(detail.transitions[index]) : "")) count += 1; });
    return count;
  }, [detail.steps, detail.transitions, steps, transitions]);
  const dirty = changedCount > 0;

  const graphIssues = useMemo(() => {
    const issues: GraphIssue[] = [];
    const keys = new Set(steps.map((step) => step.stepKey));
    if (steps.filter((step) => step.isInitial).length !== 1) issues.push({ code: "INITIAL", messageFa: dict.workflow.graphIssues });
    for (const step of steps) {
      if (!step.isTerminal && !transitions.some((transition) => transition.fromStep === step.stepKey)) {
        issues.push({ code: "NO_EXIT", messageFa: `${step.titleFa || step.stepKey}: ${dict.workflow.noExit}`, step: step.stepKey });
      }
    }
    for (const transition of transitions) {
      if (!keys.has(transition.fromStep) || !keys.has(transition.toStep) || !transition.requiredPermission) {
        issues.push({ code: "INVALID_TRANSITION", messageFa: `${dict.workflow.transitions}: ${transition.actionLabelFa || transition.action}` });
      }
    }
    return issues;
  }, [dict.workflow, steps, transitions]);

  const diff = useMemo(() => {
    if (!publishedDetail) return { added: 0, removed: 0, changed: 0 };
    const publishedSteps = new Map(publishedDetail.steps.map((step) => [step.stepKey, stepSignature(step)]));
    const draftSteps = new Map(steps.map((step) => [step.stepKey, stepSignature(step)]));
    const publishedTransitions = new Map(publishedDetail.transitions.map((transition) => [`${transition.fromStep}|${transition.action}`, transitionSignature(transition)]));
    const draftTransitions = new Map(transitions.map((transition) => [`${transition.fromStep}|${transition.action}`, transitionSignature(transition)]));
    const added = [...draftSteps.keys()].filter((key) => !publishedSteps.has(key)).length + [...draftTransitions.keys()].filter((key) => !publishedTransitions.has(key)).length;
    const removed = [...publishedSteps.keys()].filter((key) => !draftSteps.has(key)).length + [...publishedTransitions.keys()].filter((key) => !draftTransitions.has(key)).length;
    const changed = [...draftSteps].filter(([key, value]) => publishedSteps.has(key) && publishedSteps.get(key) !== value).length + [...draftTransitions].filter(([key, value]) => publishedTransitions.has(key) && publishedTransitions.get(key) !== value).length;
    return { added, removed, changed };
  }, [publishedDetail, steps, transitions]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const protectLinks = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a");
      if (!anchor || anchor.target === "_blank" || anchor.origin !== window.location.origin) return;
      if (!window.confirm(dict.workflow.leaveWarning)) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", protectLinks, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", protectLinks, true); };
  }, [dict.workflow.leaveWarning, dirty]);

  const payload = (auditReason: string) => ({
    steps: steps.map(({ stepKey, titleFa, orderIndex, isInitial, isTerminal }) => ({ stepKey, titleFa, orderIndex, isInitial, isTerminal })),
    transitions: transitions.map(({ fromStep, action, actionLabelFa, toStep, requiredPermission, reasonRequired, assignRole, dueDays, escalationRole }) => ({ fromStep, action, actionLabelFa, toStep, requiredPermission, reasonRequired, assignRole, dueDays, escalationRole })),
    reason: auditReason.trim(),
  });

  const toMessage = (result: { code: string; message: string; details?: unknown }) => {
    const issues = (result.details as { issues?: GraphIssue[] } | undefined)?.issues;
    if (issues?.length) return issues.map((issue) => issue.messageFa).join(" · ");
    return errorText(result, { invalidCredentials: "", tooManyAttempts: "", accountDisabled: "", network: dict.common.networkError, unknown: result.message || dict.common.unknownError });
  };

  async function persist(action: PendingAction) {
    if (reason.trim().length < 3) return;
    setBusy(true);
    let targetId = detail.definition.id;
    if (dirty || detail.definition.isPublished) {
      const saved = await apiRequest<{ id: number }>(`/api/admin/workflows/${detail.definition.id}`, "POST", payload(reason));
      if (!saved.ok) { setBusy(false); setToast({ tone: "danger", title: dict.common.unknownError, text: toMessage(saved) }); return; }
      targetId = saved.data.id;
    }
    if (action === "publish") {
      const published = await apiRequest<{ id: number }>(`/api/admin/workflows/${targetId}`, "PATCH", { published: true, reason: reason.trim() });
      if (!published.ok) { setBusy(false); setToast({ tone: "danger", title: dict.common.unknownError, text: toMessage(published) }); return; }
      setToast({ tone: "success", title: dict.workflow.published });
    } else {
      sessionStorage.setItem("workflow-toast", dict.workflow.draftSaved);
    }
    setBusy(false);
    setPendingAction(null);
    setReason("");
    router.replace(`/admin/workflows?id=${targetId}`);
    router.refresh();
  }

  useEffect(() => {
    const message = sessionStorage.getItem("workflow-toast");
    if (!message) return;
    sessionStorage.removeItem("workflow-toast");
    const timer = window.setTimeout(() => setToast({ tone: "success", title: message }), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function validate() {
    setValidationIssues(graphIssues);
    setToast(graphIssues.length ? { tone: "danger", title: dict.workflow.graphIssues, text: graphIssues.map((issue) => issue.messageFa).join(" · ") } : { tone: "success", title: dict.workflow.validationDone });
  }

  const statusLabel = detail.definition.isPublished ? dict.workflow.published : detail.definition.isActive ? dict.workflow.draft : dict.workflow.draft;
  const addStep = () => setSteps([...steps, { id: 0, stepKey: `STEP_${steps.length + 1}`, titleFa: "", orderIndex: steps.length, isInitial: steps.length === 0, isTerminal: false }]);
  const removeStep = (index: number) => {
    const key = steps[index]?.stepKey;
    setSteps(steps.filter((_, itemIndex) => itemIndex !== index).map((step, orderIndex) => ({ ...step, orderIndex })));
    setTransitions(transitions.filter((transition) => transition.fromStep !== key && transition.toStep !== key));
  };
  const addTransition = () => setTransitions([...transitions, { id: 0, fromStep: steps[0]?.stepKey ?? "", action: `action_${transitions.length + 1}`, actionLabelFa: "", toStep: steps[0]?.stepKey ?? "", requiredPermission: "", reasonRequired: false, assignRole: null, dueDays: null, escalationRole: null }]);

  return (
    <div className="grid gap-6">
      <section className="sticky top-16 z-20 -mx-2 rounded-xl border border-border bg-surface/95 p-3 shadow-lift backdrop-blur sm:p-4" aria-label={dict.workflow.editorFlow}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="me-auto min-w-48">
            <p className="text-xs font-medium text-fg-muted">{dict.workflow.editorFlow}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <strong>{detail.definition.titleFa}</strong>
              <Badge tone="primary">{dict.workflow.version} {num(detail.definition.version)}</Badge>
              <Badge tone={detail.definition.isPublished ? "success" : "warning"}>{statusLabel}</Badge>
              {dirty ? <Badge tone="danger">{num(changedCount)} {dict.workflow.unsavedCount}</Badge> : <Badge tone="success"><CheckCircle2 className="size-3" />{dict.common.saved}</Badge>}
            </div>
          </div>
          {canManage ? <>
            <Button size="sm" variant="secondary" onClick={() => setPendingAction("save")} disabled={!dirty && !detail.definition.isPublished}><Save className="size-4" />{dict.workflow.saveDraft}</Button>
            <Button size="sm" variant="secondary" onClick={validate}><ShieldCheck className="size-4" />{dict.workflow.validate}</Button>
            <Button size="sm" onClick={() => setPendingAction("publish")} disabled={detail.definition.isPublished && !dirty}><Rocket className="size-4" />{dict.workflow.publish}</Button>
          </> : null}
        </div>
      </section>

      <Alert tone="info">{dict.workflow.editorHelp}</Alert>

      <section className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{dict.workflow.graphDiagram}</h3><span className="text-xs text-fg-muted" dir="ltr">{detail.definition.code}</span></div>
        <div className="overflow-x-auto pb-3">
          <svg width={Math.max(720, steps.length * 190)} height="170" role="img" aria-label={dict.workflow.graphDiagram} className="min-w-full">
            <defs><marker id="workflow-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" className="fill-primary" /></marker></defs>
            {steps.slice(0, -1).map((_, index) => <line key={`line-${index}`} x1={150 + index * 190} y1="72" x2={205 + index * 190} y2="72" className="stroke-primary" strokeWidth="2" markerEnd="url(#workflow-arrow)" />)}
            {steps.map((step, index) => {
              const noExit = !step.isTerminal && !transitions.some((transition) => transition.fromStep === step.stepKey);
              return <g key={`${step.stepKey}-${index}`} transform={`translate(${20 + index * 190}, 30)`}>
                <rect width="130" height="84" rx="14" className={noExit ? "fill-danger-soft stroke-danger" : step.isInitial ? "fill-primary-soft stroke-primary" : "fill-surface-2 stroke-border-strong"} strokeWidth="2" />
                <text x="65" y="32" textAnchor="middle" className="fill-fg text-sm font-semibold">{(step.titleFa || dict.workflow.untitled).slice(0, 17)}</text>
                <text x="65" y="55" textAnchor="middle" className="fill-fg-muted text-[10px]">{step.stepKey}</text>
                <text x="65" y="73" textAnchor="middle" className="fill-fg-muted text-[10px]">{transitions.filter((transition) => transition.fromStep === step.stepKey).length} {dict.workflow.transitions}</text>
              </g>;
            })}
          </svg>
        </div>
      </section>

      {!detail.definition.isPublished && publishedDetail ? <section className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h3 className="mb-3 font-semibold">{dict.workflow.comparePublished}</h3>
        {diff.added + diff.removed + diff.changed === 0 ? <p className="text-sm text-fg-muted">{dict.workflow.noDiff}</p> : <div className="flex flex-wrap gap-2"><Badge tone="success">{dict.workflow.addedItems}: {num(diff.added)}</Badge><Badge tone="danger">{dict.workflow.removedItems}: {num(diff.removed)}</Badge><Badge tone="warning">{dict.workflow.changedItems}: {num(diff.changed)}</Badge></div>}
      </section> : null}

      {(validationIssues ?? detail.issues).length > 0 ? <Alert tone="warning" title={dict.workflow.graphIssues}><ul>{(validationIssues ?? detail.issues).map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.messageFa}</li>)}</ul></Alert> : <Alert tone="success">{dict.workflow.graphValid}</Alert>}

      <section className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <div className="mb-4 flex items-center justify-between gap-3"><h3 className="font-semibold">{dict.workflow.steps}</h3>{canManage ? <Button size="sm" variant="secondary" onClick={addStep}>{dict.workflow.addStep}</Button> : null}</div>
        <div className="grid gap-3">
          {steps.map((step, index) => <details key={`${step.stepKey}-${index}`} className="rounded-lg border border-border bg-surface-2" open={index === 0}>
            <summary className="flex cursor-pointer items-center gap-2 p-4 font-medium"><span className="grid size-7 place-items-center rounded-full bg-primary-soft text-xs text-primary">{num(index + 1)}</span>{step.titleFa || dict.workflow.untitled}<code className="ms-auto text-xs text-fg-muted" dir="ltr">{step.stepKey}</code></summary>
            <div className="grid gap-3 border-t border-border p-4 md:grid-cols-2">
              <Input label={dict.workflow.stepKey} dir="ltr" value={step.stepKey} disabled={!canManage} onChange={(event) => setSteps(steps.map((item, itemIndex) => itemIndex === index ? { ...item, stepKey: event.target.value.toUpperCase().replace(/\s+/g, "_") } : item))} />
              <Input label={dict.workflow.stepTitle} value={step.titleFa} disabled={!canManage} onChange={(event) => setSteps(steps.map((item, itemIndex) => itemIndex === index ? { ...item, titleFa: event.target.value } : item))} />
              <Switch label={dict.workflow.initial} checked={step.isInitial} disabled={!canManage} onChange={(checked) => setSteps(steps.map((item, itemIndex) => ({ ...item, isInitial: itemIndex === index ? checked : checked ? false : item.isInitial })))} />
              <Switch label={dict.workflow.terminal} checked={step.isTerminal} disabled={!canManage} onChange={(checked) => setSteps(steps.map((item, itemIndex) => itemIndex === index ? { ...item, isTerminal: checked } : item))} />
              {canManage ? <Button size="sm" variant="danger" className="justify-self-start" onClick={() => removeStep(index)}><Trash2 className="size-4" />{dict.common.delete}</Button> : null}
            </div>
          </details>)}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <div className="mb-4 flex items-center justify-between gap-3"><h3 className="font-semibold">{dict.workflow.transitions}</h3>{canManage ? <Button size="sm" variant="secondary" onClick={addTransition}>{dict.workflow.addTransition}</Button> : null}</div>
        <div className="grid gap-3">
          {transitions.map((transition, index) => <details key={`${transition.action}-${index}`} className="rounded-lg border border-border bg-surface-2">
            <summary className="flex cursor-pointer items-center gap-2 p-4 font-medium"><span>{transition.actionLabelFa || transition.action || dict.workflow.untitled}</span><ArrowLeft className="size-4 text-primary" /><span>{steps.find((step) => step.stepKey === transition.toStep)?.titleFa || transition.toStep}</span></summary>
            <div className="grid gap-3 border-t border-border p-4 md:grid-cols-2 lg:grid-cols-3">
              <Select label={dict.workflow.fromStep} value={transition.fromStep} disabled={!canManage} onChange={(event) => setTransitions(transitions.map((item, itemIndex) => itemIndex === index ? { ...item, fromStep: event.target.value } : item))}>{steps.map((step) => <option key={step.stepKey} value={step.stepKey}>{step.titleFa || step.stepKey}</option>)}</Select>
              <Select label={dict.workflow.toStep} value={transition.toStep} disabled={!canManage} onChange={(event) => setTransitions(transitions.map((item, itemIndex) => itemIndex === index ? { ...item, toStep: event.target.value } : item))}>{steps.map((step) => <option key={step.stepKey} value={step.stepKey}>{step.titleFa || step.stepKey}</option>)}</Select>
              <Input label={dict.workflow.actionKey} dir="ltr" value={transition.action} disabled={!canManage} onChange={(event) => setTransitions(transitions.map((item, itemIndex) => itemIndex === index ? { ...item, action: event.target.value.toLowerCase().replace(/\s+/g, "_") } : item))} />
              <Input label={dict.workflow.actionLabel} value={transition.actionLabelFa} disabled={!canManage} onChange={(event) => setTransitions(transitions.map((item, itemIndex) => itemIndex === index ? { ...item, actionLabelFa: event.target.value } : item))} />
              <Select label={dict.workflow.requiredPermission} value={transition.requiredPermission} disabled={!canManage} onChange={(event) => setTransitions(transitions.map((item, itemIndex) => itemIndex === index ? { ...item, requiredPermission: event.target.value } : item))}><option value="">—</option>{permissionOptions.map((permission) => <option key={permission} value={permission}>{permission}</option>)}</Select>
              <Select label={dict.workflow.assignRole} value={transition.assignRole ?? ""} disabled={!canManage} onChange={(event) => setTransitions(transitions.map((item, itemIndex) => itemIndex === index ? { ...item, assignRole: event.target.value || null } : item))}><option value="">—</option>{ROLE_KEYS.map((role) => <option key={role} value={role}>{dict.roleNames[role] ?? role}</option>)}</Select>
              <Input label={dict.workflow.dueDays} type="number" min={1} max={365} value={transition.dueDays ?? ""} disabled={!canManage} onChange={(event) => setTransitions(transitions.map((item, itemIndex) => itemIndex === index ? { ...item, dueDays: event.target.value ? Number(event.target.value) : null } : item))} />
              <Switch label={dict.workflow.reasonRequired} checked={transition.reasonRequired} disabled={!canManage} onChange={(checked) => setTransitions(transitions.map((item, itemIndex) => itemIndex === index ? { ...item, reasonRequired: checked } : item))} />
              {canManage ? <Button size="sm" variant="danger" className="justify-self-start" onClick={() => setTransitions(transitions.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="size-4" />{dict.common.delete}</Button> : null}
            </div>
          </details>)}
        </div>
      </section>

      {pendingAction ? <div className="fixed inset-0 z-[var(--z-modal)] grid place-items-center bg-navy-900/60 p-4" role="dialog" aria-modal="true" aria-labelledby="workflow-reason-title">
        <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-6 shadow-lift">
          <h2 id="workflow-reason-title" className="text-lg font-semibold">{dict.workflow.reasonDialogTitle}</h2>
          <p className="mt-1 text-sm text-fg-muted">{dict.workflow.reasonDialogText}</p>
          <Textarea autoFocus className="mt-4" label={dict.workflow.reasonLabel} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={dict.workflow.reasonPlaceholder} />
          <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => { setPendingAction(null); setReason(""); }} disabled={busy}>{dict.common.cancel}</Button><Button onClick={() => void persist(pendingAction)} loading={busy} disabled={reason.trim().length < 3}>{dict.workflow.continueAction}</Button></div>
        </div>
      </div> : null}

      {toast ? <div className="fixed bottom-5 end-5 z-[var(--z-toast)] w-[min(24rem,calc(100vw-2rem))]" onClick={() => setToast(null)}><Toast tone={toast.tone} title={toast.title}>{toast.text}</Toast></div> : null}
    </div>
  );
}
