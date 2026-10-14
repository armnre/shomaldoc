"use client";

import { useEffect, useState } from "react";
import { Alert, Badge } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { apiRequest } from "./api-client";

export interface RuleEvaluation { name: string; allowed: boolean; reasons: string[] }

const LABELS: Record<string, string> = {
  canSubmitProposal: "ارسال پروپوزال",
  canApproveFinal: "تصویب نهایی",
  canRequestExtension: "درخواست تمدید",
  canOpenCommission: "ورود به کمیسیون موارد خاص",
  canRequestDefense: "درخواست دفاع",
  canCloseCase: "بستن پرونده",
};

/** Shows the Rule Engine verdicts with the exact Persian denial reasons. */
export function CaseRulesPanel({ caseId }: { caseId: string }) {
  const { dict } = useI18n();
  const [rows, setRows] = useState<RuleEvaluation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiRequest<{ evaluations: RuleEvaluation[] }>(`/api/cases/${caseId}/rules`, "GET").then((r) => {
      if (!alive) return;
      if (r.ok) setRows(r.data.evaluations);
      else setError(r.message || dict.common.unknownError);
    });
    return () => { alive = false; };
  }, [caseId, dict.common.unknownError]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!rows) return <div className="skeleton h-24 rounded-lg" aria-hidden />;

  return (
    <div className="grid gap-3">
      {rows.map((r) => (
        <div key={r.name} className="rounded-lg border border-border bg-surface-2/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{LABELS[r.name] ?? r.name}</p>
            <Badge tone={r.allowed ? "success" : "neutral"}>{r.allowed ? dict.rules.allowed : dict.rules.denied}</Badge>
          </div>
          {!r.allowed && r.reasons.length > 0 ? (
            <ul className="mt-2 grid gap-1 text-sm text-fg-muted">
              {r.reasons.map((reason, i) => <li key={i}>• {reason}</li>)}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}
