// RX3 — Logique de recherche/tri/filtre catalogue PARTAGÉE (pure, testable). Uniformise prestations,
// formations et produits (mêmes contrôles, même comportement). Le backend reste l'autorité sur les prix ;
// ici on ne fait que filtrer/trier une liste déjà chargée (aucun N+1, aucun fetch par carte).
import { useMemo, useState } from 'react';

export type CatalogueSort = 'featured' | 'price-asc' | 'price-desc' | 'recent';

export interface CatalogueAccessors<T> {
  /** Texte recherchable (nom + description…). */
  text: (item: T) => string;
  /** Prix effectif (pour tri prix). */
  price: (item: T) => number;
  /** Timestamp (ms) pour le tri « récents ». Absent → tri récent = ordre d'origine. */
  date?: (item: T) => number;
  /** Type (ex. présentiel/distanciel) pour le filtre. Absent → pas de filtre type. */
  type?: (item: T) => string;
}

export interface CatalogueQueryState {
  q: string;
  sort: CatalogueSort;
  /** '' = tous les types. */
  type: string;
}

export const DEFAULT_CATALOGUE_QUERY: CatalogueQueryState = { q: '', sort: 'featured', type: '' };

// Marques diacritiques combinantes (U+0300–U+036F) — construit sans caractères combinants littéraux
// dans la source (évite le warning ESLint no-misleading-character-class).
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(DIACRITICS, '');
}

/** Applique recherche + filtre type + tri à une liste (immuable). */
export function applyCatalogueQuery<T>(items: T[], query: CatalogueQueryState, acc: CatalogueAccessors<T>): T[] {
  const q = normalize(query.q.trim());
  let out = items;

  if (q) {
    out = out.filter((it) => normalize(acc.text(it)).includes(q));
  }
  if (query.type && acc.type) {
    out = out.filter((it) => acc.type!(it) === query.type);
  }

  if (query.sort === 'price-asc' || query.sort === 'price-desc') {
    const dir = query.sort === 'price-asc' ? 1 : -1;
    out = [...out].sort((a, b) => (acc.price(a) - acc.price(b)) * dir);
  } else if (query.sort === 'recent' && acc.date) {
    const date = acc.date;
    out = [...out].sort((a, b) => date(b) - date(a));
  }
  // 'featured' (ou 'recent' sans date) → ordre d'origine (boosts/serveur).
  return out;
}

/** Hook d'état des contrôles catalogue + application mémoïsée. */
export function useCatalogueQuery<T>(
  items: T[] | undefined,
  acc: CatalogueAccessors<T>,
  initial: Partial<CatalogueQueryState> = {},
) {
  const [query, setQuery] = useState<CatalogueQueryState>({ ...DEFAULT_CATALOGUE_QUERY, ...initial });
  const results = useMemo(() => applyCatalogueQuery(items ?? [], query, acc), [items, query, acc]);
  return {
    query,
    results,
    setQ: (q: string) => setQuery((s) => ({ ...s, q })),
    setSort: (sort: CatalogueSort) => setQuery((s) => ({ ...s, sort })),
    setType: (type: string) => setQuery((s) => ({ ...s, type })),
  };
}
