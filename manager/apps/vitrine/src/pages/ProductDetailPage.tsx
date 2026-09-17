import { Link, useParams } from 'react-router-dom';
import { Card, MediaImage, PriceLabel, LoadingState, ErrorState } from '@bs/ui';
import { resolveMediaUrl } from '@bs/api-client';
import { usePublicProduct } from '../features/catalog/hooks/usePublicProducts';
import { productPriceProps } from '../features/catalog/priceProps';

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isPending, isError } = usePublicProduct(id);

  if (isPending) return <LoadingState label="Chargement du produit…" />;
  if (isError || !data) return <ErrorState title="Produit introuvable." />;

  return (
    <article>
      <p>
        <Link to="/produits">← Produits</Link>
      </p>
      <Card>
        <MediaImage src={resolveMediaUrl(data.coverImage)} alt={data.name} ratio="16 / 9" />
        <h1>{data.name}</h1>
        <PriceLabel {...productPriceProps(data)} />
        {data.editorialHtml ? <div dangerouslySetInnerHTML={{ __html: data.editorialHtml }} /> : null}
      </Card>
    </article>
  );
}
