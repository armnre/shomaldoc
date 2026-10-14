import Image from "next/image";
import { cn } from "@/lib/cn";

/** Inline version of the ShomalDoc mark so it inherits theme and needs no extra request. */
export function BrandMark({ className, title }: { className?: string; title?: string }) {
  // Identical gradient definitions share one id, which is valid SVG even when repeated on a page.
  const gradientId = "shd-mark-grad";
  return (
    <svg viewBox="0 0 64 64" className={cn("size-10 shrink-0", className)} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#222F74" />
          <stop offset="1" stopColor="#0E7880" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${gradientId})`} />
      <path d="M16 11h22l9 9v33a1 1 0 0 1-1 1H16a1 1 0 0 1-1-1V12a1 1 0 0 1 1-1z" fill="#F8F5EE" />
      <path d="M38 11v9h9z" fill="#C9C8F2" />
      <path d="M32 19l2.2 6.8L41 28l-6.8 2.2L32 37l-2.2-6.8L23 28l6.8-2.2z" fill="#E07C1F" />
      <path d="M21 42q3.5-3 7 0t7 0 7 0 7 0" fill="none" stroke="#0E7880" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M21 48q3.5-3 7 0t7 0 7 0 7 0" fill="none" stroke="#2F6DB5" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export function BrandLogo({ light = false, subtitle, className }: { light?: boolean; subtitle?: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <BrandMark />
      <div className="leading-tight">
        <p className={cn("text-xl font-bold", light ? "text-white" : "text-primary")}>شمال‌داک</p>
        {subtitle ? <p className={cn("text-xs", light ? "text-white/75" : "text-fg-muted")}>{subtitle}</p> : null}
      </div>
    </div>
  );
}

/** Official university mark, served locally from public/branding (no CDN). */
export function UniversityLogo({ alt, size = 56, className }: { alt: string; size?: number; className?: string }) {
  return (
    <span className={cn("inline-grid shrink-0 place-items-center overflow-hidden rounded-lg bg-white p-1 shadow-soft", className)}>
      <Image src="/branding/university-logo.jpg" alt={alt} width={size} height={size} className="rounded-md object-contain" />
    </span>
  );
}

/** Decorative hero illustration: a sunrise over the Caspian waves with a thesis document. */
export function BrandIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 480 340" className={cn("w-full max-w-md", className)} aria-hidden>
      <defs>
        <radialGradient id="shd-sun" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#F5A04A" />
          <stop offset="1" stopColor="#E07C1F" stopOpacity="0.85" />
        </radialGradient>
        <linearGradient id="shd-sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0E7880" stopOpacity="0.85" />
          <stop offset="1" stopColor="#14205A" />
        </linearGradient>
      </defs>
      <circle cx="240" cy="168" r="96" fill="url(#shd-sun)" opacity="0.9" />
      <circle cx="240" cy="168" r="132" fill="none" stroke="#C9C8F2" strokeOpacity="0.25" strokeWidth="1.5" />
      <circle cx="240" cy="168" r="170" fill="none" stroke="#C9C8F2" strokeOpacity="0.15" strokeWidth="1.5" />
      <rect x="176" y="72" width="128" height="158" rx="16" fill="#F8F5EE" />
      <path d="M270 72v28h34z" fill="#C9C8F2" />
      <path d="M240 108l6 18 18 6-18 6-6 18-6-18-18-6 18-6z" fill="#E07C1F" />
      <path d="M196 186q11-9 22 0t22 0 22 0 22 0" fill="none" stroke="#0E7880" strokeWidth="4" strokeLinecap="round" />
      <path d="M196 204q11-9 22 0t22 0 22 0 22 0" fill="none" stroke="#2F6DB5" strokeWidth="4" strokeLinecap="round" />
      <path d="M0 250q60-30 120 0t120 0 120 0 120 0V340H0z" fill="#2F6DB5" opacity="0.5" />
      <path d="M0 278q60-26 120 0t120 0 120 0 120 0V340H0z" fill="url(#shd-sea)" />
      <path d="M0 306q60-20 120 0t120 0 120 0 120 0V340H0z" fill="#121A42" />
    </svg>
  );
}
