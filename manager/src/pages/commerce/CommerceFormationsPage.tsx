import * as React from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import {
  CommercePageFrame,
  Metric,
  Panel,
  ProductTable,
  cents,
  type CommerceProduct,
  type CommerceSale,
} from './CommerceShared';

const TRAINING_KINDS = ['DISTANCE_TRAINING', 'IN_PERSON_TRAINING'] as const;

export default function CommerceFormationsPage() {
  const [products, setProducts] = React.useState<CommerceProduct[]>([]);
  const [sales, setSales] = React.useState<CommerceSale[]>([]);
  const [error, setError] = React.useState('');

  const refresh = React.useCallback(() => {
    Promise.all([api.commerceProducts(), api.commerceSales()])
      .then(([productList, saleList]) => {
        setProducts(productList as CommerceProduct[]);
        setSales(saleList as CommerceSale[]);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Chargement impossible'));
  }, []);

  React.useEffect(refresh, [refresh]);

  const formations = products.filter((product) => TRAINING_KINDS.includes(product.kind as typeof TRAINING_KINDS[number]));
  const paidTrainingLines = sales.flatMap((sale) => sale.lines || [])
    .filter((line) => TRAINING_KINDS.includes(line.productSnapshot?.kind as typeof TRAINING_KINDS[number]));
  const revenue = paidTrainingLines.reduce((sum, line) => sum + (line.totalCents || 0), 0);

  return (
    <CommercePageFrame
      title="Management des formations"
      description="Catalogue des formations en ligne et en presentiel, avec suivi des inscriptions vendues depuis la vitrine."
      actions={<Link to="/commerce/formations/nouveau" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Nouvelle formation</Link>}
    >
      {error && <p className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
      <div className="grid gap-4 md:grid-cols-3">
        <Metric label="Formations catalogue" value={formations.length} />
        <Metric label="Inscriptions vendues" value={paidTrainingLines.length} />
        <Metric label="CA formations" value={cents(revenue)} />
      </div>
      <Panel title="Formations">
        <ProductTable products={formations} editBase="/commerce/formations" />
      </Panel>
    </CommercePageFrame>
  );
}
