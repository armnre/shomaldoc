import { UniversityLogo } from "@/components/brand/brand";
import type { Dictionary } from "@/i18n/dictionaries";

/** Shared footer used on every page. The developer name links to paramistech.ir. */
export function SiteFooter({ dict, alt }: { dict: Dictionary; alt: string }) {
  const developer = dict.brand.developer;
  const parts = dict.brand.developedBy.split(developer);
  return (
    <footer className="mt-auto border-t border-border bg-surface/70 px-4 py-6 text-sm text-fg-muted backdrop-blur sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 text-center sm:flex-row sm:justify-between sm:text-start">
        <div className="flex items-center gap-3">
          <UniversityLogo alt={alt} size={44} />
          <div className="leading-relaxed">
            <p>{dict.brand.copyright}</p>
            <p>
              {parts.length === 2 ? (
                <>
                  {parts[0]}
                  <a
                    href={dict.brand.developerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-primary underline-offset-4 hover:underline"
                  >
                    {developer}
                  </a>
                  {parts[1]}
                </>
              ) : (
                dict.brand.developedBy
              )}
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
