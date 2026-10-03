import * as React from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { CommerceProductCard, buildReviewSummaries, type ProductReviewSummary } from '@/components/CommerceProductCard';
import { buildServiceGroups, CollectionGridSkeleton } from '@/components/ServiceCollections';
import { CatalogSearchInput, matchesQuery } from '@/components/CatalogSearch';
import { SortMenu, type SortOption } from '@/components/SortMenu';
import { type CommerceProduct } from '@/lib/api';
import { useCatalog, useCollections, useReviews } from '@/lib/catalogCache';
import NotFoundPage from '@/pages/NotFoundPage';

type SortKey = 'ordre' | 'prix-croissant' | 'prix-decroissant' | 'duree' | 'nom';

const SORTS: SortOption<SortKey>[] = [
  { key: 'ordre', label: 'Notre sélection' },
  { key: 'prix-croissant', label: 'Prix : du moins cher au plus cher' },
  { key: 'prix-decroissant', label: 'Prix : du plus cher au moins cher' },
  { key: 'duree', label: 'Durée : la plus courte d’abord' },
  { key: 'nom', label: 'Nom : de A à Z' },
];

const price = (p: CommerceProduct) => Number(p.price?.amountCents || 0);
const byName = (a: CommerceProduct, b: CommerceProduct) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' });

/** Tri stable : à égalité, l'ordre choisi au Manager départage. */
function sortItems(items: CommerceProduct[], key: SortKey) {
  const indexed = items.map((item, index) => ({ item, index }));
  const compare: Record<SortKey, (a: CommerceProduct, b: CommerceProduct) => number> = {
    ordre: () => 0,
    'prix-croissant': (a, b) => price(a) - price(b),
    'prix-decroissant': (a, b) => price(b) - price(a),
    // Une prestation sans durée renseignée passe après celles qui en ont une.
    duree: (a, b) => (a.durationMinutes || Infinity) - (b.durationMinutes || Infinity),
    nom: byName,
  };
  return indexed.sort((a, b) => compare[key](a.item, b.item) || a.index - b.index).map((x) => x.item);
}

/**
 * UNE COLLECTION OUVERTE — ses prestations, dans l'ordre choisi au Manager,
 * avec une recherche, un tri, et un retour vers toutes les collections qui
 * reste à portée de main pendant le défilement.
 */
export default function ServiceCollectionPage() {
  const { slug = '' } = useParams();
  const items = useCatalog();
  const collections = useCollections();
  const reviewItems = useReviews();
  const reviews = React.useMemo<Record<string, ProductReviewSummary>>(() => buildReviewSummaries(reviewItems as any[]), [reviewItems]);
  const services = items.filter((p) => p.kind === 'SERVICE');
  const groups = collections ? buildServiceGroups(services, collections) : [];
  const group = groups.find((g) => g.slug === slug);

  // Recherche et tri vivent dans l'adresse : un retour arrière les retrouve.
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const sortParam = params.get('tri') as SortKey | null;
  const sort: SortKey = SORTS.some((s) => s.key === sortParam) ? (sortParam as SortKey) : 'ordre';
  const setParam = (name: string, value: string, empty: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== empty) next.set(name, value); else next.delete(name);
    setParams(next, { replace: true });
  };

  const shown = React.useMemo(
    () => (group ? sortItems(group.items.filter((p) => matchesQuery(p, query)), sort) : []),
    [group, query, sort],
  );

  React.useEffect(() => { window.scrollTo({ top: 0 }); }, [slug]);

  if (collections && items.length && !group) return <NotFoundPage />;

  return (
    <section className="mx-auto min-h-screen max-w-6xl px-5 pb-24 pt-28 md:px-8" data-testid="collection-page">
      {/* Retour collant : il glisse sous la barre de navigation et y reste. */}
      <div
        className="sticky z-20 -mx-2 px-2 py-2"
        style={{ top: 'calc(var(--vv-top, 0px) + 5.5rem)' }}
        data-testid="collection-back-bar"
      >
        <Link
          to="/prestations"
          className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold shadow-md transition hover:opacity-90"
          style={{
            borderColor: 'var(--v-border)',
            background: 'color-mix(in srgb, var(--v-surface) 88%, transparent)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            boxShadow: '0 10px 24px -14px color-mix(in srgb, var(--v-foreground) 50%, transparent)',
          }}
          data-testid="back-to-collections"
        >
          <ArrowLeft className="h-4 w-4" /> Toutes les collections
        </Link>
      </div>
      {!group ? <CollectionGridSkeleton /> : (
        <>
          <div className="mt-6 max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--v-accent)' }}>Prestations</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-normal md:text-6xl">{group.title}</h1>
            {group.description && <p className="mt-5 text-lg leading-8" style={{ color: 'var(--v-muted-foreground)' }}>{group.description}</p>}
            <p className="mt-3 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>{group.items.length} prestation{group.items.length > 1 ? 's' : ''}</p>
          </div>
          <form role="search" className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center" onSubmit={(event) => event.preventDefault()}>
            <CatalogSearchInput value={query} onChange={(v) => setParam('q', v, '')} label="Rechercher dans la collection" />
            <SortMenu value={sort} options={SORTS} onChange={(k) => setParam('tri', k, 'ordre')} />
            {query && (
              <p className="text-sm" style={{ color: 'var(--v-muted-foreground)' }} aria-live="polite" data-testid="catalog-search-count">
                {shown.length} résultat{shown.length > 1 ? 's' : ''}
              </p>
            )}
          </form>
          <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3" data-testid="collection-items">
            {shown.length === 0 ? (
              <p className="rounded-lg border border-dashed p-5 text-sm md:col-span-2 lg:col-span-3" style={{ borderColor: 'var(--v-border)', color: 'var(--v-muted-foreground)' }}>
                Aucune prestation de cette collection ne correspond à cette recherche.
              </p>
            ) : shown.map((product) => (
              <CommerceProductCard key={product.id} item={product} review={reviews[product.id]} showKind={false} />
            ))}
          </div>
          <div className="mt-12">
            <Link
              to="/prestations"
              className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold"
              style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)', borderRadius: 'var(--v-radius)' }}
            >
              <ArrowLeft className="h-4 w-4" /> Retour aux collections
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
