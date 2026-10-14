import { redirect } from "next/navigation";
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Progress, Skeleton, StatCard, StatusPill, Stepper, Timeline } from "@/components/ui";
import { DesignDemos } from "@/components/features/design-demos";
import { can, requireUser } from "@/server/auth/current-user";
import { getEnv } from "@/server/env";
import { getServerI18n } from "@/i18n/server";
import { Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

const SWATCHES = [
  { name: "primary (navy)", cls: "bg-primary" },
  { name: "primary-soft", cls: "bg-primary-soft" },
  { name: "accent (gold)", cls: "bg-accent" },
  { name: "accent-soft", cls: "bg-accent-soft" },
  { name: "teal-500", cls: "bg-teal-500" },
  { name: "success", cls: "bg-success" },
  { name: "warning", cls: "bg-warning" },
  { name: "danger", cls: "bg-danger" },
  { name: "info", cls: "bg-info" },
  { name: "surface-2", cls: "bg-surface-2" },
];

export default async function DesignPage() {
  const user = await requireUser();
  const env = getEnv();
  if (env.APP_ENV === "production" && !can(user, "system.design")) redirect("/forbidden");
  const { dict } = await getServerI18n();

  return (
    <>
      <PageHeader title={dict.design.title} subtitle={dict.design.subtitle} />
      <div className="grid gap-6">
        <Card className="p-6">
          <h2 className="mb-4 text-lg font-semibold">{dict.design.tokens}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {SWATCHES.map((s) => (
              <div key={s.name} className="grid gap-1.5 text-xs">
                <span className={`h-14 rounded-lg border border-border ${s.cls}`} />
                <span className="text-fg-muted" dir="ltr">{s.name}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="grid gap-4 p-6">
          <h2 className="text-lg font-semibold">{dict.design.typography}</h2>
          <p className="text-4xl font-bold text-primary">{dict.design.sampleTitle}</p>
          <p className="text-xl font-semibold">{dict.design.sampleTitle} — ۱۴۰۵/۰۱/۰۱</p>
          <p className="max-w-2xl text-fg-muted">{dict.design.sampleBody} ۰۱۲۳۴۵۶۷۸۹ · 0123456789</p>
          <p className="tabular text-lg" dir="ltr">1234567890 · 0123.45</p>
        </Card>

        <Card className="grid gap-5 p-6">
          <h2 className="text-lg font-semibold">{dict.design.buttons}</h2>
          <div className="flex flex-wrap gap-3">
            <Button>Primary</Button>
            <Button variant="accent">Accent</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button loading>Loading</Button>
            <Button disabled>Disabled</Button>
            <Button size="sm">Small</Button>
            <Button size="lg">Large</Button>
          </div>
        </Card>

        <Card className="grid gap-5 p-6">
          <h2 className="text-lg font-semibold">{dict.design.feedback}</h2>
          <div className="flex flex-wrap gap-2">
            <StatusPill status="pending" label={dict.statuses.pending} />
            <StatusPill status="approved" label={dict.statuses.approved} />
            <StatusPill status="needsRevision" label={dict.statuses.needsRevision} />
            <StatusPill status="rejected" label={dict.statuses.rejected} />
            <StatusPill status="draft" label={dict.statuses.draft} />
            <Badge tone="accent">Accent</Badge>
          </div>
          <Alert tone="info" title="اطلاع">{dict.design.sampleBody}</Alert>
          <Alert tone="success" title="موفق">{dict.common.saved}</Alert>
          <Alert tone="warning" title="هشدار">{dict.auth.mustChangeNotice}</Alert>
          <Alert tone="danger" title="خطا">{dict.common.unknownError}</Alert>
          <Progress value={64} label="پیشرفت نمونه" />
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          <StatCard label={dict.design.sampleTitle} value="۱٬۲۳۴" hint={dict.design.sampleBody} icon={<Sparkles className="size-5" aria-hidden />} />
          <StatCard label={dict.design.sampleTitle} value="۸۷٪" tone="accent" />
        </div>

        <Card className="grid gap-5 p-6">
          <h2 className="text-lg font-semibold">{dict.design.stepper}</h2>
          <Stepper steps={["ثبت موضوع", "تأیید استاد", "تأیید گروه", "پروپوزال"]} current={1} />
          <h2 className="pt-4 text-lg font-semibold">{dict.design.timeline}</h2>
          <Timeline
            emptyText={dict.dashboard.noActivity}
            items={[
              { id: 1, title: "ثبت موضوع پایان‌نامه", description: "توسط دانشجو", time: "۱۴۰۵/۰۱/۱۰", tone: "success" },
              { id: 2, title: "بازبینی استاد راهنما", description: "نیاز به اصلاح عنوان", time: "۱۴۰۵/۰۱/۱۵", tone: "warning" },
              { id: 3, title: "رد درخواست (نمونه)", description: "نمونه‌ای از حالت رد", time: "۱۴۰۵/۰۲/۰۱", tone: "danger" },
            ]}
          />
        </Card>

        <Card className="grid gap-4 p-6">
          <h2 className="text-lg font-semibold">{dict.design.states}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /></div>
            <EmptyState title={dict.common.empty} text={dict.users.emptyText} />
          </div>
        </Card>

        <Card className="grid gap-5 p-6">
          <h2 className="text-lg font-semibold">{dict.design.forms} · {dict.design.overlays} · {dict.design.uploads}</h2>
          <DesignDemos />
        </Card>
      </div>
    </>
  );
}
