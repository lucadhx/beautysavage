import { Link } from 'react-router-dom';
import {
  SectionHeader,
  CatalogueGrid,
  CatalogueCard,
  MediaImage,
  PriceLabel,
  LoadingState,
  ErrorState,
  EmptyState,
} from '@bs/ui';
import { resolveMediaUrl, type PublicProduct } from '@bs/api-client';
import { usePublicProducts } from '../features/catalog/hooks/usePublicProducts';
import { productPriceProps } from '../features/catalog/priceProps';
import { useCatalogueQuery, type CatalogueAccessors } from '../features/catalog/catalogueQuery';
import { CatalogueToolbar } from '../features/catalog/components/CatalogueToolbar';

const ACCESSORS: CatalogueAccessors<PublicProduct> = {
  text: (p) => p.name,
  price: (p) => p.finalPrice ?? p.price,
  date: (p) => (p.createdAt ? Date.parse(p.createdAt) : 0),
};

export function ProductsPage() {
  const { data, isPending, isError } = usePublicProducts();
  const { query, results, setQ, setSort } = useCatalogueQuery(data, ACCESSORS);

  return (
    <section className="vitrine-page">
      <SectionHeader title="Produits" subtitle="Nos produits à la vente." />
      {isPending ? <LoadingState label="Chargement des produits…" /> : null}
      {isError ? <ErrorState title="Impossible de charger les produits." /> : null}
      {!isPending && !isError ? (
        data?.length ? (
          <>
            <CatalogueToolbar
              query={query}
              onQ={setQ}
              onSort={setSort}
              sortOptions={['featured', 'price-asc', 'price-desc', 'recent']}
              resultCount={results.length}
              searchPlaceholder="Rechercher un produit…"
            />
            {results.length ? (
              <CatalogueGrid>
                {results.map((p) => (
                  <CatalogueCard
                    key={p.id}
                    media={<MediaImage src={resolveMediaUrl(p.coverImage)} alt={p.name} />}
                    badge={p.activePromotion ? p.activePromotion.label ?? 'Promo' : undefined}
                    title={p.name}
                    price={<PriceLabel {...productPriceProps(p)} />}
                    action={
                      <Link className="bs-btn bs-btn--secondary" to={`/produits/${p.id}`}>
                        Détail
                      </Link>
                    }
                  />
                ))}
              </CatalogueGrid>
            ) : (
              <EmptyState icon="bi-search" label="Aucun produit ne correspond à votre recherche." hint="Essayez un autre mot-clé ou réinitialisez la recherche." />
            )}
          </>
        ) : (
          <EmptyState icon="bi-box-seam" label="Aucun produit disponible pour le moment." hint="Nos produits seront bientôt disponibles à la vente." />
        )
      ) : null}
    </section>
  );
}
