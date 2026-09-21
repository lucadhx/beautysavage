import * as React from 'react';
import { Check, ChevronDown, Type } from 'lucide-react';
import { FONT_CATALOG, fontById, ensureCatalogFontsLoaded, type CatalogFont } from '@/lib/fontCatalog';

/**
 * Sélecteur de POLICE — pendant typographique du ColorField : bouton intégré au
 * design, liste déroulante où CHAQUE police est rendue avec sa propre police,
 * navigation clavier (flèches/Entrée/Échap), fermeture au clic extérieur,
 * accessible (listbox/option), responsive. Allowlist stricte : uniquement le
 * catalogue — aucune saisie CSS libre.
 */
export function FontField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const selected = fontById(value) ?? FONT_CATALOG[0];

  React.useEffect(() => {
    ensureCatalogFontsLoaded();
  }, []);

  React.useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, FONT_CATALOG.findIndex((f) => f.id === selected.id)));
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open, selected.id]);

  React.useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const pick = (font: CatalogFont) => {
    onChange(font.id);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, FONT_CATALOG.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(FONT_CATALOG[active]); }
  };

  return (
    <div ref={rootRef} className="relative">
      <label className="mb-1 flex items-center gap-1.5 text-sm font-medium">
        <Type className="h-3.5 w-3.5 text-muted-foreground" /> {label}
      </label>
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`${label} — ${selected.label}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-left text-sm transition-colors hover:border-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        <span style={{ fontFamily: selected.cssFamily }} className="truncate text-base">
          {selected.label}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          aria-label={label}
          className="absolute z-30 mt-1 max-h-72 w-full overflow-auto overscroll-contain rounded-md border border-border bg-card py-1 shadow-lg"
        >
          {FONT_CATALOG.map((font, i) => (
            <li
              key={font.id}
              data-index={i}
              role="option"
              aria-selected={font.id === selected.id}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(font)}
              className={`cursor-pointer px-3 py-2 ${i === active ? 'bg-muted' : ''}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span style={{ fontFamily: font.cssFamily }} className="text-base">
                  {font.label}
                </span>
                {font.id === selected.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </div>
              <p style={{ fontFamily: font.cssFamily }} className="mt-0.5 truncate text-xs text-muted-foreground">
                {font.previewText}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default FontField;
