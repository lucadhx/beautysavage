import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Navigation de pages du document — « ◀ Page 1 / 5 ▶ ».
 *
 * Le contrat n'est plus un long rouleau : on regarde UNE page à la fois. Trois
 * façons d'en changer, parce qu'aucune ne convient partout :
 * clic (souris), flèches ←/→ (clavier), balayage (mobile).
 *
 * Les pastilles ne sont affichées qu'en deçà d'un seuil : au-delà, elles
 * deviennent illisibles et le compteur suffit.
 */
const DOTS_MAX = 12;

export function PageNav({
  page,
  pageCount,
  onChange,
  zonesByPage,
  className,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  /** Nombre de zones par page — repérer d'un coup d'œil où il y a du travail. */
  zonesByPage?: Record<number, number>;
  className?: string;
}) {
  if (pageCount <= 1) return null;
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      <div className="flex items-center gap-1">
        <NavButton label="Page précédente" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </NavButton>
        <span className="min-w-[6.5rem] text-center text-sm font-medium tabular-nums" aria-live="polite">
          Page {page} / {pageCount}
        </span>
        <NavButton label="Page suivante" disabled={page >= pageCount} onClick={() => onChange(page + 1)}>
          <ChevronRight className="h-4 w-4" />
        </NavButton>
      </div>

      {pageCount <= DOTS_MAX && (
        <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Pages du document">
          {pages.map((p) => {
            const count = zonesByPage?.[p] ?? 0;
            const active = p === page;
            return (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={`Page ${p}${count ? ` — ${count} zone(s)` : ''}`}
                onClick={() => onChange(p)}
                className={cn(
                  'relative h-7 min-w-[1.75rem] rounded-md border px-1.5 text-xs font-medium tabular-nums transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {p}
                {/* Une page qui porte des zones se repère sans la visiter. */}
                {count > 0 && (
                  <span
                    className={cn(
                      'absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full',
                      active ? 'bg-primary-foreground' : 'bg-primary'
                    )}
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NavButton({
  label, disabled, onClick, children,
}: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card transition-colors',
        'hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1'
      )}
    >
      {children}
    </button>
  );
}
