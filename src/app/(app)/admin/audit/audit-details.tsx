"use client";

import { useState } from "react";

export function AuditDetails({
  before,
  after,
  reason,
  labels,
}: {
  before: unknown;
  after: unknown;
  reason: string | null;
  labels: { show: string; hide: string; before: string; after: string; reason: string };
}) {
  const [open, setOpen] = useState(false);
  const hasDetails = before !== null || after !== null || !!reason;
  if (!hasDetails) return <span className="text-fg-muted">—</span>;
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-xs font-medium text-primary hover:underline">
        {open ? labels.hide : labels.show}
      </button>
      {open ? (
        <div className="mt-2 grid gap-2 animate-pop">
          {reason ? <p className="text-xs"><span className="font-semibold">{labels.reason}:</span> {reason}</p> : null}
          {before !== null ? (
            <div>
              <p className="text-xs font-semibold">{labels.before}</p>
              <pre dir="ltr" className="overflow-x-auto rounded-md bg-surface-2 p-2 text-[0.7rem] leading-relaxed">{JSON.stringify(before, null, 2)}</pre>
            </div>
          ) : null}
          {after !== null ? (
            <div>
              <p className="text-xs font-semibold">{labels.after}</p>
              <pre dir="ltr" className="overflow-x-auto rounded-md bg-surface-2 p-2 text-[0.7rem] leading-relaxed">{JSON.stringify(after, null, 2)}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
