import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { CommerceProductCard, buildReviewSummaries, type ProductReviewSummary } from '@/components/CommerceProductCard';
import { type CommerceProduct } from '@/lib/api';
import { CatalogSearchInput, matchesQuery } from '@/components/CatalogSearch';
import { useCatalog, useCollections, useReviews } from '@/lib/catalogCache';
import { CollectionGrid, CollectionGridSkeleton, buildServiceGroups } from '@/components/ServiceCollections';

function visible(kind: string | undefined, product: CommerceProduct) {
  if (kind === 'training') return product.kind === 'DISTANCE_TRAINING' || product.kind === 'IN_PERSON_TRAINING';
  if (kind === 'service') return product.kind === 'SERVICE';
  if (kind === 'gift') return product.kind === 'GIFT_CARD';
  return true;
}

function pageIntro(kind: 'all' | 'training' | 'service' | 'gift') {
  if (kind === 'training') {
    return {
      title: 'Formations',
      text: 'Parcours en présentiel ou en ligne, avec fiche claire, prix, sessions et accès client après achat.',
    };
  }
  if (kind === 'service') {
    return {
      title: 'Prestations',
      text: 'Les soins de l’institut disponibles à la réservation, présentés avec leur visuel, leur tarif et les avis clientes.',
    };
  }
  if (kind === 'gift') {
    return {
      title: 'Cartes cadeaux',
      text: 'Des cartes cadeaux à personnaliser, acheter et recevoir après paiement confirmé.',
    };
  }
  return {
    title: 'Boutique',
    text: 'Produits, prestations, formations et cartes cadeaux réunis dans un panier commun, avec espace client.',
  };
}

export default function CatalogPage({ kind = 'all' }: { kind?: 'all' | 'training' | 'service' | 'gift' }) {
  // Même cache que l'accueil : le catalogue est déjà là quand on arrive ici.
  const items = useCatalog();
  const reviewItems = useReviews();
  const collections = useCollections();
  const reviews = React.useMemo<Record<string, ProductReviewSummary>>(() => buildReviewSummaries(reviewItems as any[]), [reviewItems]);
  const error = '';

  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const setQuery = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('q', value); else next.delete('q');
    setParams(next, { replace: true });
  };

  const inKind = items.filter((item) => visible(kind, item));
  const filtered = inKind.filter((item) => matchesQuery(item, query));
  const intro = pageIntro(kind);
  // Prestations rangées en collections : la page montre d'abord les collections.
  const groups = kind === 'service' && collections ? buildServiceGroups(inKind, collections) : [];
  const searchLabel = kind === 'training' ? 'Rechercher une formation' : kind === 'service' ? 'Rechercher une prestation' : kind === 'gift' ? 'Rechercher une carte cadeau' : 'Rechercher dans la boutique';

  return (
    <section className="mx-auto min-h-screen max-w-6xl px-5 pb-24 pt-32 md:px-8">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--v-accent)' }}>BeautySavage</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-normal md:text-6xl">{intro.title}</h1>
        <p className="mt-5 text-lg leading-8" style={{ color: 'var(--v-muted-foreground)' }}>
          {intro.text}
        </p>
      </div>
      {error && <p className="mt-8 rounded-md border px-4 py-3" style={{ borderColor: 'var(--v-border)' }}>{error}</p>}
      {inKind.length > 0 && (
        <form role="search" className="mt-10 flex flex-wrap items-center gap-3" onSubmit={(event) => event.preventDefault()}>
          <CatalogSearchInput value={query} onChange={setQuery} label={searchLabel} />
          {query && (
            <p className="text-sm" style={{ color: 'var(--v-muted-foreground)' }} aria-live="polite" data-testid="catalog-search-count">
              {filtered.length} résultat{filtered.length > 1 ? 's' : ''}
            </p>
          )}
        </form>
      )}
      {kind === 'service' && !query && collections === null ? <CollectionGridSkeleton /> : kind === 'service' && !query && groups.length > 0 ? <CollectionGrid groups={groups} /> : (
      <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {filtered.length === 0 && !error ? (
          <p className="rounded-lg border border-dashed p-5 text-sm md:col-span-2 lg:col-span-3" style={{ borderColor: 'var(--v-border)', color: 'var(--v-muted-foreground)' }}>
            {query ? 'Aucune offre ne correspond à cette recherche.' : 'Les offres publiées depuis le manager apparaîtront ici.'}
          </p>
        ) : filtered.map((product) => (
          <CommerceProductCard
            key={product.id}
            item={product}
            review={reviews[product.id]}
            showKind={kind !== 'service'}
          />
        ))}
      </div>
      )}
    </section>
  );
}
