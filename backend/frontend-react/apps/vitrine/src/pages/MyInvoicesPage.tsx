// RX4 — Mes factures (P6). Historique d'achats en cards + téléchargement facture. Le suivi de
// remboursement se fait par lien e-mail (pas de liste client — cf. audit §2.7).
import { EmptyState, ErrorState, Skeleton } from '@bs/ui';
import { formatPrice, saleInvoiceUrl, type ClientSale } from '@bs/api-client';
import { AccountShell, useMySales, formatShortDate } from '../features/account';

function SaleRow({ sale }: { sale: ClientSale }) {
  const title = sale.items[0]?.name || `${sale.itemCount} article(s)`;
  const extra = sale.itemCount > 1 ? ` +${sale.itemCount - 1}` : '';
  const href = sale.invoice?.downloadUrl ? saleInvoiceUrl(sale.id) : sale.invoice?.stripeInvoicePdfUrl || null;
  return (
    <div className="bs-row">
      <span className="bs-row__icon" aria-hidden="true"><i className="bi bi-receipt" /></span>
      <span className="bs-row__body">
        <span className="bs-row__title">{title}{extra}</span>
        <span className="bs-row__meta">{formatShortDate(sale.dateAchat)}{sale.invoice?.number ? ` · Facture ${sale.invoice.number}` : ''}</span>
      </span>
      <span className="bs-row__aside">
        <span className="bs-row__amount">{formatPrice(sale.totalAmount)}</span>
        {href ? (
          <a className="bs-hub__section-link" href={href} target="_blank" rel="noopener noreferrer">
            <i className="bi bi-download" aria-hidden="true" /> Facture
          </a>
        ) : null}
      </span>
    </div>
  );
}

export function MyInvoicesPage() {
  const query = useMySales();

  return (
    <AccountShell title="Mes factures">
      {query.isPending ? (
        <Skeleton variant="block" height="72px" count={3} />
      ) : query.isError ? (
        <ErrorState title="Impossible de charger votre historique." />
      ) : (query.data ?? []).length === 0 ? (
        <EmptyState label="Aucun achat pour le moment." />
      ) : (
        <div className="bs-hub__list">
          {(query.data ?? []).map((sale) => <SaleRow key={sale.id} sale={sale} />)}
        </div>
      )}
    </AccountShell>
  );
}
