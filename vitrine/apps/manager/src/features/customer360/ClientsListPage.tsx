// M12 / RX-CLIENTS — Gestion clients (point d'entrée du Customer 360). Refonte premium type
// « logiciel pro » : barre de titre + KPIs agrégés, recherche instantanée, filtres/tri/vue
// (grille ou liste), cartes clients enrichies et animées. Mobile-first, cards, aucune table,
// tokens --bs-* uniquement (aucun hex). Lecture seule : le backend agrège et fait autorité.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorState, Dropdown } from '@bs/ui';
import type { CustomerSearchCard } from '@bs/api-client';
import { useCustomerSearch } from './useCustomer360';
import { ClientSearchCard, CustomerEmptyState, money } from './components';
import './customer360.css';

type FilterKey = 'all' | 'active' | 'suspended';
type SortKey = 'recent' | 'name' | 'spent';
type ViewKey = 'grid' | 'list';

const FILTERS: { key: FilterKey; label: string; icon: string }[] = [
  { key: 'all', label: 'Tous', icon: 'bi-people' },
  { key: 'active', label: 'Actifs', icon: 'bi-person-check' },
  { key: 'suspended', label: 'Suspendus', icon: 'bi-person-dash' },
];

const SORTS: { key: SortKey; label: string; icon: string }[] = [
  { key: 'recent', label: 'Récent', icon: 'bi-clock-history' },
  { key: 'name', label: 'Nom', icon: 'bi-sort-alpha-down' },
  { key: 'spent', label: 'Dépenses', icon: 'bi-cash-stack' },
];

function ts(v: string | null): number {
  if (!v) return 0;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function sortCards(list: CustomerSearchCard[], sort: SortKey): CustomerSearchCard[] {
  const copy = [...list];
  switch (sort) {
    case 'name':
      return copy.sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr', { sensitivity: 'base' }));
    case 'spent':
      return copy.sort((a, b) => b.totalSpent - a.totalSpent);
    case 'recent':
    default:
      return copy.sort((a, b) => ts(b.lastVisitAt) - ts(a.lastVisitAt));
  }
}

function GridSkeleton() {
  return (
    <div className="cm-grid" aria-hidden="true" data-testid="c3-skeleton">
      {Array.from({ length: 6 }).map((_, i) => (
        <div className="c3-card cm-card cm-card--grid cm-card--skeleton" key={i}>
          <span className="cm-card__avatar cm-skel" />
          <span className="cm-card__main">
            <span className="cm-skel cm-skel--line" />
            <span className="cm-skel cm-skel--line cm-skel--short" />
            <span className="cm-skel cm-skel--pill" />
          </span>
        </div>
      ))}
    </div>
  );
}

function StatTile({ icon, value, label, tone }: { icon: string; value: string | number; label: string; tone?: string }) {
  return (
    <div className={`c3-card cm-stat${tone ? ` cm-stat--${tone}` : ''}`}>
      <span className="cm-stat__icon"><i className={icon} aria-hidden="true" /></span>
      <span className="cm-stat__value">{value}</span>
      <span className="cm-stat__label">{label}</span>
    </div>
  );
}

export function ClientsListPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sort, setSort] = useState<SortKey>('recent');
  const [view, setView] = useState<ViewKey>('grid');
  const { data, isLoading, isError, isFetching } = useCustomerSearch(search);

  const all = useMemo(() => data ?? [], [data]);
  const stats = useMemo(() => {
    const suspended = all.filter((c) => c.bookingSuspended).length;
    const revenue = all.reduce((sum, c) => sum + (c.totalSpent || 0), 0);
    return { total: all.length, active: all.length - suspended, suspended, revenue };
  }, [all]);

  const results = useMemo(() => {
    let list = all;
    if (filter === 'active') list = list.filter((c) => !c.bookingSuspended);
    else if (filter === 'suspended') list = list.filter((c) => c.bookingSuspended);
    return sortCards(list, sort);
  }, [all, filter, sort]);

  return (
    <section className="c3-page cm-page" data-testid="c3-clients-page">
      {/* Barre de titre */}
      <header className="cm-topbar">
        <div className="cm-topbar__title">
          <span className="cm-topbar__icon"><i className="bi-people-fill" aria-hidden="true" /></span>
          <div>
            <h1 className="cm-topbar__h1">Clients</h1>
            <p className="cm-topbar__sub">Recherchez, filtrez et ouvrez la fiche 360 de chaque client.</p>
          </div>
        </div>
        <span className="cm-topbar__count">
          {isLoading ? '—' : stats.total} client{stats.total > 1 ? 's' : ''}
          {isFetching && !isLoading ? <span className="cm-topbar__spin" aria-hidden="true" /> : null}
        </span>
      </header>

      {/* KPIs */}
      <div className="cm-stats" data-testid="cm-stats">
        <StatTile icon="bi-people" value={isLoading ? '—' : stats.total} label="Clients" tone="primary" />
        <StatTile icon="bi-person-check" value={isLoading ? '—' : stats.active} label="Actifs" tone="success" />
        <StatTile icon="bi-person-dash" value={isLoading ? '—' : stats.suspended} label="Suspendus" tone="danger" />
        <StatTile icon="bi-cash-coin" value={isLoading ? '—' : money(stats.revenue)} label="CA cumulé" tone="accent" />
      </div>

      {/* Recherche */}
      <div className="c3-searchbar cm-searchbar">
        <i className="bi-search" aria-hidden="true" />
        <input
          className="c3-searchinput"
          type="search"
          inputMode="search"
          placeholder="Rechercher un client (nom, e-mail)…"
          aria-label="Rechercher un client"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search ? (
          <button type="button" className="cm-searchbar__clear" aria-label="Effacer" onClick={() => setSearch('')}>
            <i className="bi-x-lg" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {/* Filtres + tri + vue */}
      <div className="cm-toolbar">
        <div className="cm-chips" role="tablist" aria-label="Filtrer les clients">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              className={`cm-chip${filter === f.key ? ' cm-chip--active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              <i className={f.icon} aria-hidden="true" /> {f.label}
            </button>
          ))}
        </div>

        <div className="cm-toolbar__right">
          <Dropdown
            ariaLabel="Trier les clients"
            value={sort}
            options={SORTS.map((s) => ({ value: s.key, label: s.label }))}
            onChange={(v) => setSort(v as SortKey)}
            icon="bi-sort-down"
          />

          <div className="cm-view" role="group" aria-label="Affichage">
            <button type="button" className={`cm-view__btn${view === 'grid' ? ' cm-view__btn--active' : ''}`} aria-pressed={view === 'grid'} aria-label="Vue grille" onClick={() => setView('grid')}>
              <i className="bi-grid-3x3-gap" aria-hidden="true" />
            </button>
            <button type="button" className={`cm-view__btn${view === 'list' ? ' cm-view__btn--active' : ''}`} aria-pressed={view === 'list'} aria-label="Vue liste" onClick={() => setView('list')}>
              <i className="bi-list-ul" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Résultats */}
      {isLoading ? <GridSkeleton /> : null}
      {isError ? <ErrorState title="Recherche indisponible." detail="Réessayez plus tard." /> : null}
      {!isLoading && !isError && results.length === 0 ? (
        <CustomerEmptyState
          label={search ? 'Aucun client ne correspond à votre recherche' : filter !== 'all' ? 'Aucun client dans ce filtre' : 'Aucun client'}
          icon="bi-person-x"
        />
      ) : null}

      {!isLoading && !isError && results.length > 0 ? (
        <div className={view === 'grid' ? 'cm-grid' : 'cm-list'} data-testid="c3-clientlist">
          {results.map((card, i) => (
            <ClientSearchCard key={card.id} card={card} variant={view} index={i} onOpen={(cid) => navigate(`/clients/${cid}`)} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
