"use client";

import { useEffect } from "react";
import { Button, Card } from "@/components/ui";
import { useI18n } from "@/i18n/provider";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { dict } = useI18n();
  useEffect(() => {
    // Only the digest is reported to the browser console; stack traces stay on the server log.
    console.error("ui_error", error.digest);
  }, [error]);
  return (
    <main className="grid flex-1 place-items-center px-6 py-16">
      <Card className="animate-in grid max-w-lg justify-items-center gap-4 p-10 text-center">
        <p className="text-sm font-semibold text-danger">500</p>
        <h1 className="text-2xl font-bold">{dict.errors.serverTitle}</h1>
        <p className="text-fg-muted">{dict.errors.serverText}</p>
        {error.digest ? <p className="text-xs text-fg-muted" dir="ltr">{dict.errors.errorCode}: {error.digest}</p> : null}
        <div className="flex flex-wrap justify-center gap-3">
          <Button onClick={() => reset()}>{dict.common.retry}</Button>
          <Button variant="secondary" onClick={() => { window.location.href = "/dashboard"; }}>{dict.errors.backHome}</Button>
        </div>
      </Card>
    </main>
  );
}
