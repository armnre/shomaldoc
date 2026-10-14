import { redirect } from "next/navigation";
import { BrandIllustration, BrandLogo, UniversityLogo } from "@/components/brand/brand";
import { LoginForm } from "@/components/features/login-form";
import { SiteFooter } from "@/components/app-shell/site-footer";
import { Card } from "@/components/ui";
import { getCurrentUser } from "@/server/auth/current-user";
import { getServerI18n } from "@/i18n/server";
import { CheckCircle2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");
  const { dict } = await getServerI18n();
  const points = [dict.auth.panelPoint1, dict.auth.panelPoint2, dict.auth.panelPoint3];

  return (
    <div className="flex min-h-screen flex-col">
      <div className="grid flex-1 lg:grid-cols-2">
        <section className="relative isolate hidden overflow-hidden bg-gradient-to-br from-navy-800 via-navy-600 to-teal-600 text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
          <div aria-hidden className="bg-waves absolute inset-0 -z-10 opacity-70" />
          <div aria-hidden className="absolute -top-24 -start-24 -z-10 size-96 rounded-full bg-lavender/15 blur-3xl" />
          <div aria-hidden className="absolute -bottom-32 -end-20 -z-10 size-96 rounded-full bg-gold-500/25 blur-3xl" />
          <BrandLogo light subtitle={dict.brand.subTagline} />

          <div className="animate-in my-10 flex flex-col items-start gap-6">
            <h1 className="text-4xl font-bold leading-tight">{dict.auth.panelTitle}</h1>
            <p className="max-w-lg text-white/80">{dict.auth.panelText}</p>
            <ul className="grid gap-3">
              {points.map((p) => (
                <li key={p} className="flex items-center gap-3 text-white/90">
                  <CheckCircle2 className="size-5 shrink-0 text-gold-500" aria-hidden />
                  {p}
                </li>
              ))}
            </ul>
            <BrandIllustration className="mt-4 max-w-sm opacity-95" />
          </div>

          <div className="flex items-center gap-3 text-sm text-white/85">
            <UniversityLogo alt={dict.brand.universityLogoAlt} size={48} />
            <div>
              <p className="font-semibold">{dict.brand.university}</p>
              <p className="text-white/70">{dict.auth.panelFooter}</p>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center bg-waves-dim px-5 py-12 sm:px-10">
          <div className="w-full max-w-md">
            <div className="mb-8 flex flex-col items-center gap-3 text-center lg:hidden">
              <BrandLogo />
              <p className="text-sm text-fg-muted">{dict.brand.university}</p>
            </div>
            <Card className="animate-in p-7 sm:p-9">
              <h2 className="text-2xl font-bold text-fg">{dict.auth.loginTitle}</h2>
              <p className="mb-6 mt-1.5 text-sm text-fg-muted">{dict.auth.loginSubtitle}</p>
              <LoginForm />
            </Card>
            <p className="mt-6 text-center text-xs text-fg-muted">{dict.brand.fullName}</p>
          </div>
        </section>
      </div>
      <SiteFooter dict={dict} alt={dict.brand.universityLogoAlt} />
    </div>
  );
}
