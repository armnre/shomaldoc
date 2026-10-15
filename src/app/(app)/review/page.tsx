import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { Alert, Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth/current-user";
import { listReviewQueue } from "@/server/services/topic";
import { listIrandocReviewQueue } from "@/server/services/irandoc";
import { getServerI18n } from "@/i18n/server";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * M4/M6 — the reviewer's pending queues in one place.
 *
 * Only users holding `cases.review_topic` see the queues; a server-side permission
 * check backs this the same way it backs every decision API. Each row links to the
 * case, where the actual (server-authoritative) decision buttons live.
 */
export default async function ReviewPage() {
  const user = await requireUser();
  const { dict, locale } = await getServerI18n();

  if (!user.permissions.includes("cases.review_topic")) {
    return (
      <>
        <PageHeader title={dict.review.title} subtitle={dict.review.subtitle} />
        <Alert tone="warning">{dict.review.noAccess}</Alert>
      </>
    );
  }

  let error: string | null = null;
  let topics: Awaited<ReturnType<typeof listReviewQueue>> | null = null;
  let irandoc: Awaited<ReturnType<typeof listIrandocReviewQueue>> = [];
  try {
    topics = await listReviewQueue();
    irandoc = await listIrandocReviewQueue();
  } catch (err) {
    error = err instanceof Error ? err.message : dict.review.errorLoading;
  }

  const empty = topics !== null && topics.topic.length === 0 && topics.literature.length === 0 && irandoc.length === 0;

  return (
    <>
      <PageHeader title={dict.review.title} subtitle={dict.review.subtitle} />
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {topics !== null && !empty ? (
        <div className="grid gap-4">
          <Card>
            <h2 className="border-b border-border p-4 text-base font-semibold">{dict.review.topicQueue}</h2>
            {topics.topic.length === 0 ? (
              <p className="p-4 text-sm text-fg-muted">{dict.review.nothingInQueue}</p>
            ) : (
              <ul className="grid gap-2 p-4">
                {topics.topic.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm">
                    <Badge tone="info">{dict.review.topicBadge}</Badge>
                    <span className="font-medium">{row.caseNumber}</span>
                    <span>{`${dict.topic.versionLabel} ${row.version}`}</span>
                    <span className="text-fg-muted">{row.titleFa}</span>
                    <span className="text-xs text-fg-muted">{formatDateTime(row.submittedAt, locale)}</span>
                    <Link className="ms-auto text-primary underline" href={`/cases/${row.caseId}`}>
                      {dict.review.openCase}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="border-b border-border p-4 text-base font-semibold">{dict.review.literatureQueue}</h2>
            {topics.literature.length === 0 ? (
              <p className="p-4 text-sm text-fg-muted">{dict.review.nothingInQueue}</p>
            ) : (
              <ul className="grid gap-2 p-4">
                {topics.literature.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm">
                    <Badge tone="primary">{dict.review.literatureBadge}</Badge>
                    <span className="font-medium">{row.caseNumber}</span>
                    <span>{`${dict.topic.versionLabel} ${row.version}`}</span>
                    <span className="text-xs text-fg-muted">{formatDateTime(row.submittedAt, locale)}</span>
                    <Link className="ms-auto text-primary underline" href={`/cases/${row.caseId}`}>
                      {dict.review.openCase}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="flex items-center gap-2 border-b border-border p-4 text-base font-semibold">
              <ClipboardCheck className="size-5" aria-hidden />
              {dict.review.irandocQueue}
            </h2>
            {irandoc.length === 0 ? (
              <p className="p-4 text-sm text-fg-muted">{dict.review.nothingInQueue}</p>
            ) : (
              <ul className="grid gap-2 p-4">
                {irandoc.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm">
                    <Badge tone="warning">{dict.review.irandocBadge}</Badge>
                    <span className="font-medium">{row.caseNumber}</span>
                    <span>{row.trackingCode}</span>
                    <span className="text-fg-muted">{row.studentName ?? "—"}</span>
                    <span className="text-xs text-fg-muted">{formatDateTime(row.createdAt, locale)}</span>
                    <Link className="ms-auto text-primary underline" href={`/cases/${row.caseId}`}>
                      {dict.review.openCase}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : null}

      {empty ? <EmptyState icon={<ClipboardCheck className="size-6" aria-hidden />} title={dict.review.empty} text={dict.review.emptyHint} /> : null}
    </>
  );
}
