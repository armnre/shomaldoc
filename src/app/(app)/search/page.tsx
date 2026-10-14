import Link from "next/link";
import { Search as SearchIcon } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireCaseViewPage } from "@/server/auth/current-user";
import { searchCases } from "@/server/services/search";
import { getServerI18n } from "@/i18n/server";

export const dynamic = "force-dynamic";

/**
 * M13 — server-rendered global search.
 *
 * The form works without JavaScript (a plain GET), and because the search itself runs
 * on the server with the caller's visibility scope, a hand-crafted query string can
 * never reveal another student's case.
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireCaseViewPage();
  const { dict } = await getServerI18n();
  const { q } = await searchParams;
  const term = (q ?? "").trim();
  const hits = term.length >= 2 ? await searchCases(user, term) : [];

  return (
    <>
      <PageHeader title={dict.search.title} subtitle={dict.search.subtitle} />
      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-2" action="/search" method="get" role="search">
          <label className="grid flex-1 gap-1 text-sm">
            <span className="font-medium">{dict.search.label}</span>
            <input
              type="search"
              name="q"
              defaultValue={term}
              minLength={2}
              required
              placeholder={dict.search.placeholder}
              className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
            />
          </label>
          <button type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-fg">
            <SearchIcon className="size-4" aria-hidden />
            {dict.search.submit}
          </button>
        </form>
        {term.length === 1 ? <p className="mt-3 text-xs text-fg-muted">{dict.search.tooShort}</p> : null}
        {term.length >= 2 ? <p className="mt-3 text-xs text-fg-muted">{`${dict.search.results}: ${hits.length}`}</p> : null}
      </Card>

      {term.length >= 2 ? (
        hits.length === 0 ? (
          <EmptyState icon={<SearchIcon className="size-6" aria-hidden />} title={dict.search.empty} text={dict.search.emptyHint} />
        ) : (
          <ul className="mt-4 grid gap-2">
            {hits.map((hit) => (
              <li key={hit.caseId} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="info">{hit.caseNumber}</Badge>
                  <Badge tone="neutral">{dict.search.fields[hit.matchedField]}</Badge>
                  <span className="text-sm font-medium">{hit.titleFa ?? dict.cases.noTitle}</span>
                  {hit.studentName ? <span className="text-xs text-fg-muted">{hit.studentName}</span> : null}
                  {hit.department ? <span className="text-xs text-fg-muted">{hit.department}</span> : null}
                  <Link className="ms-auto text-sm text-primary underline" href={`/cases/${hit.caseId}`}>
                    {dict.search.open}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </>
  );
}
