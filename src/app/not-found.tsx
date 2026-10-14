import Link from "next/link";
import { BrandMark } from "@/components/brand/brand";
import { Card } from "@/components/ui";
import { getServerI18n } from "@/i18n/server";

export default async function NotFound() {
  const { dict } = await getServerI18n();
  return (
    <main className="grid min-h-screen place-items-center bg-waves-dim px-6 py-16">
      <Card className="animate-in grid max-w-lg justify-items-center gap-4 p-10 text-center">
        <BrandMark className="size-14" />
        <p className="text-sm font-semibold text-primary">404</p>
        <h1 className="text-2xl font-bold">{dict.errors.notFoundTitle}</h1>
        <p className="text-fg-muted">{dict.errors.notFoundText}</p>
        <Link href="/dashboard" className="mt-2 rounded-md bg-primary px-5 py-2.5 font-medium text-primary-fg hover:bg-primary-hover">
          {dict.errors.backHome}
        </Link>
      </Card>
    </main>
  );
}
