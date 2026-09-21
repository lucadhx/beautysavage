import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { SITE_ICON_CATALOG, siteIcon } from '@/lib/siteIcons';
import { cn } from '@/lib/utils';

/**
 * CHOISIR UNE ICÔNE — dans le catalogue, et nulle part ailleurs.
 *
 * ══ POURQUOI PAS UN CHAMP DE TEXTE ══════════════════════════════════════════
 *
 * Parce que le nom d'une icône Lucide est de la donnée TECHNIQUE : « Cog »,
 * « MoveHorizontal », « CornerUpRight ». Le taper de mémoire produit un nom
 * inconnu, et le rendu retombe alors sur un point d'interrogation — pour une
 * fiche que l'administrateur croit correcte, puisqu'il a bien saisi quelque
 * chose. Une grille montre CE QU'ON VA VOIR ; c'est la seule forme qui ne
 * puisse pas se tromper.
 */
export function IconPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (name: string) => void;
  className?: string;
}) {
  const [ouvert, setOuvert] = React.useState(false);
  const boite = React.useRef<HTMLDivElement>(null);
  const Icone = siteIcon(value);

  // Un clic hors de la boîte la referme — sinon deux sélecteurs ouverts se
  // superposent et l'on ne sait plus lequel on modifie.
  React.useEffect(() => {
    if (!ouvert) return undefined;
    const auClic = (e: MouseEvent) => {
      if (boite.current && !boite.current.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener('mousedown', auClic);
    return () => document.removeEventListener('mousedown', auClic);
  }, [ouvert]);

  const courante = SITE_ICON_CATALOG.find((i) => i.name === value);

  return (
    <div ref={boite} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={ouvert}
        className="flex h-10 w-full items-center gap-2 rounded-md border border-border bg-background px-3 text-sm transition-colors hover:bg-muted"
      >
        <Icone className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">
          {courante?.label ?? value ?? 'Icône'}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', ouvert && 'rotate-180')} />
      </button>

      {ouvert && (
        <div
          role="listbox"
          /*
            `overscroll-contain` : arrivé en butée dans la grille, le geste ne
            doit PAS repartir dans la page derrière — sinon la modale défile
            sous les doigts pendant qu'on cherche une icône. Règle générale du
            Manager, vérifiée par `scrollArchitecture.test.mjs`.
          */
          className="absolute left-0 z-50 mt-1 max-h-64 w-64 overflow-y-auto overscroll-contain rounded-lg border border-border bg-background p-2 shadow-xl"
        >
          <div className="grid grid-cols-4 gap-1">
            {SITE_ICON_CATALOG.map((entree) => {
              const I = siteIcon(entree.name);
              const actif = entree.name === value;
              return (
                <button
                  key={entree.name}
                  type="button"
                  role="option"
                  aria-selected={actif}
                  title={entree.label}
                  onClick={() => {
                    onChange(entree.name);
                    setOuvert(false);
                  }}
                  className={cn(
                    'flex aspect-square flex-col items-center justify-center gap-1 rounded-md border p-1 transition-colors',
                    actif
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <I className="h-4 w-4" />
                  <span className="w-full truncate text-[9px] leading-tight">{entree.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
