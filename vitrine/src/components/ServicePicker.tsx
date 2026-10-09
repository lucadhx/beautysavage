import * as React from 'react';
import { Loader2, Plus, Search } from 'lucide-react';
import { commerceApi, type CommerceProduct } from '@/lib/api';
import { durationText } from '@/components/CommerceProductCard';

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/**
 * CHOISIR UNE PRESTATION À AJOUTER — une liste cherchable des prestations
 * réservables du catalogue (durée, prix). Sert à « enchaîner une autre
 * prestation » depuis une fiche, et à « ajouter une prestation juste après »
 * depuis l'espace client.
 */
export function ServicePicker({ exclude = [], onPick, onCancel }: {
  exclude?: string[];
  onPick: (product: CommerceProduct) => void;
  onCancel?: () => void;
}) {
  const [all, setAll] = React.useState<CommerceProduct[] | null>(null);
  const [query, setQuery] = React.useState('');
  React.useEffect(() => {
    let alive = true;
    commerceApi.catalog()
      .then((list) => alive && setAll(list.filter((p) => p.kind === 'SERVICE')))
      .catch(() => alive && setAll([]));
    return () => { alive = false; };
  }, []);
  const words = query.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean);
  const list = (all || [])
    .filter((p) => !exclude.includes(p.id))
    .filter((p) => {
      const title = p.title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      return words.every((w) => title.includes(w));
    });
  return (
    <div className="grid gap-3 rounded-xl border p-3" style={{ borderColor: 'var(--v-border)' }} data-testid="service-picker">
      <div className="flex items-center gap-2 rounded-md border px-3" style={{ borderColor: 'var(--v-border)' }}>
        <Search className="h-4 w-4 shrink-0" style={{ color: 'var(--v-muted-foreground)' }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher une prestation"
          aria-label="Rechercher une prestation"
          className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none sm:text-sm"
          data-testid="service-picker-search"
        />
      </div>
      {all === null ? (
        <p className="flex items-center gap-2 text-sm" style={{ color: 'var(--v-muted-foreground)' }}><Loader2 className="h-4 w-4 animate-spin" /> Chargement des prestations…</p>
      ) : list.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--v-muted-foreground)' }}>Aucune prestation ne correspond.</p>
      ) : (
        <ul className="grid max-h-72 gap-1.5 overflow-y-auto">
          {list.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onPick(p)} data-testid="service-picker-item" data-title={p.title}
                className="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition hover:opacity-90"
                style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{p.title}</span>
                  <span className="block text-xs" style={{ color: 'var(--v-muted-foreground)' }}>
                    {durationText(p.durationMinutes) || '—'} · {euro.format(p.price.amountCents / 100)}
                    {(p.options || []).length > 0 ? ' · options disponibles' : ''}
                  </span>
                </span>
                <Plus className="h-4 w-4 shrink-0" style={{ color: 'var(--v-accent)' }} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {onCancel && (
        <button type="button" onClick={onCancel} className="justify-self-start text-xs font-semibold underline" style={{ color: 'var(--v-muted-foreground)' }}>Fermer la liste</button>
      )}
    </div>
  );
}
