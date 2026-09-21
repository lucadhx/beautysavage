import * as React from 'react';
import { CommerceProductCard, buildReviewSummaries, type ProductReviewSummary } from '@/components/CommerceProductCard';
import { commerceApi, type CommerceProduct } from '@/lib/api';

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
      text: 'Parcours presentiels ou en ligne, avec fiche claire, prix, sessions et acces client apres achat.',
    };
  }
  if (kind === 'service') {
    return {
      title: 'Prestations',
      text: 'Les soins institut disponibles a la reservation, presentes avec leur visuel, leur tarif et les avis clientes.',
    };
  }
  if (kind === 'gift') {
    return {
      title: 'Cartes cadeaux',
      text: 'Des cartes cadeaux a personnaliser, acheter et recevoir apres paiement confirme.',
    };
  }
  return {
    title: 'Boutique',
    text: 'Produits, prestations, formations et cartes cadeaux geres depuis un panier commun avec espace client.',
  };
}

export default function CatalogPage({ kind = 'all' }: { kind?: 'all' | 'training' | 'service' | 'gift' }) {
  const [items, setItems] = React.useState<CommerceProduct[]>([]);
  const [reviews, setReviews] = React.useState<Record<string, ProductReviewSummary>>({});
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    commerceApi.catalog().then(setItems).catch((err) => setError(err.message));
    commerceApi.reviews(undefined).then((data) => setReviews(buildReviewSummaries(data))).catch(() => setReviews({}));
  }, []);

  const filtered = items.filter((item) => visible(kind, item));
  const intro = pageIntro(kind);

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
      <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {filtered.length === 0 && !error ? (
          <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground md:col-span-2 lg:col-span-3">
            Les offres publiees depuis le manager apparaitront ici.
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
    </section>
  );
}
