import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Package } from 'lucide-react';
import { CommerceProductCard, buildReviewSummaries, type ProductReviewSummary } from '@/components/CommerceProductCard';
import { type CommerceProduct } from '@/lib/api';
import { CatalogSearchInput, matchesQuery } from '@/components/CatalogSearch';
import { useCatalog, useCollections, useReviews } from '@/lib/catalogCache';
import { CollectionGrid, CollectionGridSkeleton, buildServiceGroups } from '@/components/ServiceCollections';

function visible(kind: string | undefined, product: CommerceProduct) {
  if (kind === 'training') return product.kind === 'DISTANCE_TRAINING' || product.kind === 'IN_PERSON_TRAINING' || product.kind === 'TRAINING_PACK';
  if (kind === 'pack') return product.kind === 'TRAINING_PACK';
  if (kind === 'service') return product.kind === 'SERVICE';
  if (kind === 'gift') return product.kind === 'GIFT_CARD';
  return true;
}

type CatalogKind = 'all' | 'training' | 'service' | 'gift' | 'pack';

function pageIntro(kind: CatalogKind) {
  if (kind === 'pack') {
    return {
      title: 'Packs de formations',
      text: 'Plusieurs formations en ligne réunies à un prix avantageux : un seul achat, l’accès à toutes, depuis votre espace formation.',
    };
  }
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

export default function CatalogPage({ kind = 'all' }: { kind?: CatalogKind }) {
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

  // Les packs d'abord : c'est l'offre la plus avantageuse de la page formations.
  const inKind = items.filter((item) => visible(kind, item)).sort((a, b) => Number(b.kind === 'TRAINING_PACK') - Number(a.kind === 'TRAINING_PACK'));
  const filtered = inKind.filter((item) => matchesQuery(item, query));
  const intro = pageIntro(kind);
  // Prestations rangées en collections : la page montre d'abord les collections.
  const groups = kind === 'service' && collections ? buildServiceGroups(inKind, collections) : [];
  const searchLabel = kind === 'training' || kind === 'pack' ? 'Rechercher une formation' : kind === 'service' ? 'Rechercher une prestation' : kind === 'gift' ? 'Rechercher une carte cadeau' : 'Rechercher dans la boutique';

  return (
    <section className="mx-auto min-h-screen max-w-6xl px-4 pb-16 pt-20 sm:px-5 sm:pb-24 sm:pt-32 md:px-8">
      <div className="max-w-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] sm:text-sm sm:tracking-[0.18em]" style={{ color: 'var(--v-accent)' }}>BeautySavage</p>
        <h1 className="mt-1.5 text-[1.75rem] font-semibold leading-tight tracking-normal sm:mt-4 sm:text-4xl md:text-6xl">{intro.title}</h1>
        <p className="mt-2 text-sm leading-6 sm:mt-5 sm:text-lg sm:leading-8" style={{ color: 'var(--v-muted-foreground)' }}>
          {intro.text}
        </p>
        {kind === 'training' && items.some((item) => item.kind === 'TRAINING_PACK') && (
          <Link to="/formations/packs" className="mt-4 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold" style={{ borderColor: 'var(--v-accent)', color: 'var(--v-accent)' }} data-testid="catalog-packs-link">
            <Package className="h-4 w-4" aria-hidden="true" /> Voir les packs de formations
          </Link>
        )}
        {kind === 'pack' && (
          <Link to="/formations" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold underline-offset-4 hover:underline" style={{ color: 'var(--v-muted-foreground)' }}>
            Toutes les formations
          </Link>
        )}
      </div>
      {error && <p className="mt-8 rounded-md border px-4 py-3" style={{ borderColor: 'var(--v-border)' }}>{error}</p>}
      {inKind.length > 0 && (
        <form role="search" className="mt-5 flex flex-wrap items-center gap-3 sm:mt-10" onSubmit={(event) => event.preventDefault()}>
          <CatalogSearchInput value={query} onChange={setQuery} label={searchLabel} />
          {query && (
            <p className="text-sm" style={{ color: 'var(--v-muted-foreground)' }} aria-live="polite" data-testid="catalog-search-count">
              {filtered.length} résultat{filtered.length > 1 ? 's' : ''}
            </p>
          )}
        </form>
      )}
      {kind === 'service' && !query && collections === null ? <CollectionGridSkeleton /> : kind === 'service' && !query && groups.length > 0 ? <CollectionGrid groups={groups} /> : (
      <div className="mt-5 grid grid-cols-2 gap-3 sm:mt-8 sm:gap-5 lg:grid-cols-3">
        {filtered.length === 0 && !error ? (
          <p className="col-span-2 rounded-lg border border-dashed p-5 text-sm lg:col-span-3" style={{ borderColor: 'var(--v-border)', color: 'var(--v-muted-foreground)' }}>
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
