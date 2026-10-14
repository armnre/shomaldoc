import "@fontsource-variable/vazirmatn";
import "./globals.css";
import { headers } from "next/headers";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { I18nProvider } from "@/i18n/provider";
import { getServerI18n } from "@/i18n/server";
import { PwaRegister } from "@/components/pwa-register";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getServerI18n();
  return {
    title: {
      default: dict.brand.fullName,
      template: `%s · ${dict.brand.name}`,
    },
    description: dict.brand.subTagline,
    applicationName: dict.brand.name,
    icons: {
      icon: [{ url: "/icons/favicon.svg", type: "image/svg+xml" }],
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
    },
    appleWebApp: { capable: true, title: dict.brand.name, statusBarStyle: "default" },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#222f74" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1230" },
  ],
  width: "device-width",
  initialScale: 1,
};

// Applies the saved theme before first paint to avoid a light→dark flash.
const themeInitScript = `(function(){try{var t=localStorage.getItem('shd-theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;}catch(e){}})();`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale, dir } = await getServerI18n();
  // Per-request CSP nonce supplied by middleware, applied to the only inline script.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen bg-bg font-sans text-fg antialiased">
        <I18nProvider locale={locale}>
          {children}
          <PwaRegister />
        </I18nProvider>
      </body>
    </html>
  );
}
