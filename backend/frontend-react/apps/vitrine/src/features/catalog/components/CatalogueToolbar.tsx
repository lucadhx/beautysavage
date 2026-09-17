import { Chip, Select, TextInput } from '@bs/ui';
import type { CatalogueQueryState, CatalogueSort } from '../catalogueQuery';
import './catalogueToolbar.css';

// RX3 — Barre d'outils catalogue partagée (recherche + tri + filtre type). Utilisée à l'identique par
// prestations / formations / produits → expérience homogène. Le libellé du tri/filtre actif est TOUJOURS
// visible (corrige les « labels vides » de la vitrine Vanilla). Cibles ≥44px, tokens --bs-*.

export interface TypeFilterOption {
  value: string;
  label: string;
}

const SORT_LABELS: Record<CatalogueSort, string> = {
  featured: 'En vedette',
  'price-asc': 'Prix croissant',
  'price-desc': 'Prix décroissant',
  recent: 'Nouveautés',
};

export interface CatalogueToolbarProps {
  query: CatalogueQueryState;
  onQ: (q: string) => void;
  onSort: (sort: CatalogueSort) => void;
  onType?: (type: string) => void;
  /** Options de tri proposées (ordre = affichage). */
  sortOptions?: CatalogueSort[];
  /** Filtres de type (chips). Si absent → pas de ligne de filtre. */
  typeFilters?: TypeFilterOption[];
  /** Nombre de résultats après filtrage (feedback). */
  resultCount: number;
  searchPlaceholder?: string;
}

export function CatalogueToolbar({
  query,
  onQ,
  onSort,
  onType,
  sortOptions = ['featured', 'price-asc', 'price-desc', 'recent'],
  typeFilters,
  resultCount,
  searchPlaceholder = 'Rechercher…',
}: CatalogueToolbarProps) {
  return (
    <div className="ct">
      <div className="ct__row">
        <div className="ct__search">
          <i className="bi bi-search ct__search-icon" aria-hidden="true" />
          <TextInput
            type="search"
            value={query.q}
            onChange={(e) => onQ(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label="Rechercher dans le catalogue"
            className="ct__search-input"
          />
        </div>
        <label className="ct__sort">
          <span className="ct__sort-label">Trier</span>
          <Select value={query.sort} onChange={(e) => onSort(e.target.value as CatalogueSort)} aria-label="Trier">
            {sortOptions.map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {typeFilters && onType ? (
        <div className="ct__filters" role="group" aria-label="Filtrer par type">
          <Chip tap active={query.type === ''} onClick={() => onType('')}>
            Tout
          </Chip>
          {typeFilters.map((f) => (
            <Chip key={f.value} tap active={query.type === f.value} onClick={() => onType(f.value)}>
              {f.label}
            </Chip>
          ))}
        </div>
      ) : null}

      <p className="ct__count" aria-live="polite">
        {resultCount} résultat{resultCount > 1 ? 's' : ''}
      </p>
    </div>
  );
}
