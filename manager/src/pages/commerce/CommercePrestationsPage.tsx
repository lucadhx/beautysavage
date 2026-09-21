import * as React from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/dialog';
import { Button } from '@/components/ui/primitives';
import {
  CommercePageFrame,
  Metric,
  Panel,
  ProductTable,
  cents,
  type CommerceProduct,
  type CommerceSale,
} from './CommerceShared';

export default function CommercePrestationsPage() {
  const [products, setProducts] = React.useState<CommerceProduct[]>([]);
  const [sales, setSales] = React.useState<CommerceSale[]>([]);
  const [error, setError] = React.useState('');
  const [deleteTarget, setDeleteTarget] = React.useState<CommerceProduct | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const refresh = React.useCallback(() => {
    Promise.all([api.commerceProducts(), api.commerceSales()])
      .then(([productList, saleList]) => {
        setProducts(productList as CommerceProduct[]);
        setSales(saleList as CommerceSale[]);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Chargement impossible'));
  }, []);

  React.useEffect(refresh, [refresh]);

  const prestations = products.filter((product) => product.kind === 'SERVICE');
  const prestationLines = sales.flatMap((sale) => sale.lines || [])
    .filter((line) => line.productSnapshot?.kind === 'SERVICE');
  const revenue = prestationLines.reduce((sum, line) => sum + (line.totalCents || 0), 0);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError('');
    try {
      await api.deleteCommerceProduct(deleteTarget._id);
      setDeleteTarget(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suppression impossible');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <CommercePageFrame
      title="Management des prestations"
      description="Gestion des soins, rendez-vous et prestations institut vendables ou reservables depuis la vitrine."
      actions={<Link to="/commerce/prestations/nouveau" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Nouvelle prestation</Link>}
    >
      {error && <p className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
      <div className="grid gap-4 md:grid-cols-3">
        <Metric label="Prestations catalogue" value={prestations.length} />
        <Metric label="Prestations vendues" value={prestationLines.length} />
        <Metric label="CA prestations" value={cents(revenue)} />
      </div>
      <Panel title="Prestations">
        <ProductTable products={prestations} editBase="/commerce/prestations" onDelete={setDeleteTarget} />
      </Panel>
      <Modal open={Boolean(deleteTarget)} onClose={() => !deleting && setDeleteTarget(null)} title="Supprimer cette prestation" className="max-w-lg">
        <div className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            Cette prestation sera retiree du catalogue. Si elle apparait deja dans une vente ou une reservation, elle sera archivee pour conserver l'historique client.
          </p>
          {deleteTarget && (
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="font-semibold">{deleteTarget.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{deleteTarget.subtitle || deleteTarget.description || 'Aucune description courte renseignee.'}</p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Annuler</Button>
            <Button type="button" variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Suppression...' : 'Supprimer'}
            </Button>
          </div>
        </div>
      </Modal>
    </CommercePageFrame>
  );
}
