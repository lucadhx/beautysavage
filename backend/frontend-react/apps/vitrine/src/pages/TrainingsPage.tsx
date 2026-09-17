import { Link } from 'react-router-dom';
import {
  SectionHeader,
  CatalogueGrid,
  CatalogueCard,
  MediaImage,
  PriceLabel,
  PawRatingSummary,
  LoadingState,
  ErrorState,
  EmptyState,
} from '@bs/ui';
import { resolveMediaUrl, type PublicTraining } from '@bs/api-client';
import { usePublicTrainings } from '../features/catalog/hooks/usePublicTrainings';
import { trainingPriceProps } from '../features/catalog/priceProps';
import { useCatalogueQuery, type CatalogueAccessors } from '../features/catalog/catalogueQuery';
import { CatalogueToolbar, type TypeFilterOption } from '../features/catalog/components/CatalogueToolbar';

const TYPE_LABEL: Record<string, string> = {
  distanciel: 'En ligne — accès à vie',
  presentiel: 'Présentiel',
};

const TYPE_FILTERS: TypeFilterOption[] = [
  { value: 'presentiel', label: 'Présentiel' },
  { value: 'distanciel', label: 'En ligne' },
];

const ACCESSORS: CatalogueAccessors<PublicTraining> = {
  text: (t) => t.name,
  price: (t) => t.finalPrice ?? t.price,
  date: (t) => (t.createdAt ? Date.parse(t.createdAt) : 0),
  type: (t) => t.type ?? '',
};

export function TrainingsPage() {
  const { data, isPending, isError } = usePublicTrainings();
  const { query, results, setQ, setSort, setType } = useCatalogueQuery(data, ACCESSORS);

  return (
    <section className="vitrine-page">
      <SectionHeader title="Formations" subtitle="Formations en ligne et en présentiel." />
      {isPending ? <LoadingState label="Chargement des formations…" /> : null}
      {isError ? <ErrorState title="Impossible de charger les formations." /> : null}
      {!isPending && !isError ? (
        data?.length ? (
          <>
            <CatalogueToolbar
              query={query}
              onQ={setQ}
              onSort={setSort}
              onType={setType}
              typeFilters={TYPE_FILTERS}
              resultCount={results.length}
              searchPlaceholder="Rechercher une formation…"
            />
            {results.length ? (
              <CatalogueGrid>
                {results.map((t) => (
                  <CatalogueCard
                    key={t.id}
                    media={<MediaImage src={resolveMediaUrl(t.coverImage)} alt={t.name} />}
                    badge={t.activePromotion ? t.activePromotion.label ?? 'Promo' : undefined}
                    title={t.name}
                    rating={<PawRatingSummary average={t.averageRating ?? 0} count={t.reviewCount ?? 0} />}
                    meta={t.type ? TYPE_LABEL[t.type] ?? t.type : undefined}
                    price={<PriceLabel {...trainingPriceProps(t)} />}
                    action={
                      <Link className="bs-btn bs-btn--secondary-solid" to={`/formations/${t.id}`}>
                        Voir
                      </Link>
                    }
                  />
                ))}
              </CatalogueGrid>
            ) : (
              <EmptyState icon="bi-search" label="Aucune formation ne correspond à votre recherche." hint="Essayez un autre mot-clé ou réinitialisez la recherche." />
            )}
          </>
        ) : (
          <EmptyState icon="bi-mortarboard" label="Aucune formation disponible pour le moment." hint="De nouvelles formations seront bientôt en ligne." />
        )
      ) : null}
    </section>
  );
}
