import { Search, X } from 'lucide-react';
import { type CommerceProduct } from '@/lib/api';
import { richTextToPlain } from '@/lib/richText';

/** Recherche tolérante : sans accents ni casse, tous les mots doivent figurer. */
function normalize(value?: string) {
  return (value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
export function matchesQuery(product: CommerceProduct, query: string) {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalize([product.title, product.subtitle, richTextToPlain(product.description)].filter(Boolean).join(' '));
  return words.every((word) => haystack.includes(word));
}

/** Le champ de recherche des catalogues (pastille, loupe, bouton d'effacement). */
export function CatalogSearchInput({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <label className="relative block w-full sm:max-w-md">
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--v-muted-foreground)' }} aria-hidden />
      <input
        type="search"
        name="q"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={`${label}…`}
        data-testid="catalog-search"
        className="h-12 w-full rounded-full border pl-11 pr-11 text-base outline-none transition focus:ring-2"
        style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)', color: 'var(--v-foreground)' }}
      />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="Effacer la recherche" className="absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full" style={{ color: 'var(--v-muted-foreground)' }}>
          <X className="h-4 w-4" />
        </button>
      )}
    </label>
  );
}
