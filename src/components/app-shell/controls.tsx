"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Languages, Moon, Sun } from "lucide-react";
import { LOCALE_COOKIE } from "@/i18n/config";
import { useI18n } from "@/i18n/provider";
import { apiRequest } from "@/components/features/api-client";

export function ThemeToggle() {
  const { dict } = useI18n();

  // The icon is switched by the `dark:` variant (driven by data-theme), so no state or effect is needed
  // and the server-rendered markup matches the client exactly.
  const toggle = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("shd-theme", next);
    } catch {
      /* storage may be blocked; the toggle still works for this page view */
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dict.common.theme}
      title={dict.common.theme}
      className="grid size-10 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
    >
      <Moon className="size-5 dark:hidden" aria-hidden />
      <Sun className="hidden size-5 dark:block" aria-hidden />
    </button>
  );
}

export function LocaleToggle() {
  const { locale, dict } = useI18n();
  const router = useRouter();
  const next = locale === "fa" ? "en" : "fa";
  const change = async () => {
    await apiRequest<{ locale: string }>("/api/locale", "POST", { locale: next });
    router.refresh();
  };
  return (
    <button
      type="button"
      onClick={change}
      aria-label={dict.common.language}
      title={dict.common.language}
      data-cookie={LOCALE_COOKIE}
      className="inline-flex h-10 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
    >
      <Languages className="size-4" aria-hidden />
      {next === "en" ? "EN" : "فا"}
    </button>
  );
}
