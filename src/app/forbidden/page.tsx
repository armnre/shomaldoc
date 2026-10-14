import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui";
import { getServerI18n } from "@/i18n/server";

export const dynamic = "force-dynamic";

export default async function ForbiddenPage() {
  const { dict } = await getServerI18n();
  return (
    <main className="grid flex-1 place-items-center px-6 py-16">
      <Card className="animate-in grid max-w-lg justify-items-center gap-4 p-10 text-center">
        <div className="grid size-16 place-items-center rounded-full bg-danger-soft text-danger">
          <ShieldAlert className="size-8" aria-hidden />
        </div>
        <p className="text-sm font-semibold text-danger">403</p>
        <h1 className="text-2xl font-bold">{dict.errors.forbiddenTitle}</h1>
        <p className="text-fg-muted">{dict.errors.forbiddenText}</p>
        <Link href="/dashboard" className="mt-2 rounded-md bg-primary px-5 py-2.5 font-medium text-primary-fg hover:bg-primary-hover">
          {dict.errors.backHome}
        </Link>
      </Card>
    </main>
  );
}
