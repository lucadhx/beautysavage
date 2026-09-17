// RX4 — Mes documents (P11). Regroupe factures (ventes) + attestations (formations terminées) dans une
// même UX de cards téléchargeables. Réutilise sales + learning (C3). Extensible aux documents futurs.
import { EmptyState, Skeleton } from '@bs/ui';
import { formatPrice, saleInvoiceUrl, attestationDownloadUrl } from '@bs/api-client';
import { AccountShell, useMySales, formatShortDate } from '../features/account';
import { useMyLearningFormations } from '../features/learning/hooks';

interface DocRow {
  key: string;
  icon: string;
  title: string;
  meta: string;
  href: string | null;
}

export function MyDocumentsPage() {
  const sales = useMySales();
  const learning = useMyLearningFormations();
  const loading = sales.isPending || learning.isPending;

  const invoices: DocRow[] = (sales.data ?? [])
    .filter((s) => s.invoice)
    .map((s) => ({
      key: `inv-${s.id}`,
      icon: 'bi-receipt',
      title: `Facture ${s.invoice?.number || ''}`.trim(),
      meta: `${formatShortDate(s.invoice?.date || s.dateAchat)} · ${formatPrice(s.totalAmount)}`,
      href: s.invoice?.downloadUrl ? saleInvoiceUrl(s.id) : s.invoice?.stripeInvoicePdfUrl || null,
    }));

  const attestations: DocRow[] = (learning.data ?? [])
    .filter((f) => f.completedAt)
    .map((f) => ({
      key: `att-${f.formationId}`,
      icon: 'bi-patch-check',
      title: `Attestation — ${f.name}`,
      meta: `Terminée le ${formatShortDate(f.completedAt)}`,
      href: attestationDownloadUrl(f.formationId),
    }));

  const rows = [...invoices, ...attestations];

  return (
    <AccountShell title="Mes documents">
      {loading ? (
        <Skeleton variant="block" height="72px" count={3} />
      ) : rows.length === 0 ? (
        <EmptyState label="Aucun document disponible pour le moment." />
      ) : (
        <div className="bs-hub__list">
          {rows.map((r) => (
            <div key={r.key} className="bs-row">
              <span className="bs-row__icon" aria-hidden="true"><i className={`bi ${r.icon}`} /></span>
              <span className="bs-row__body">
                <span className="bs-row__title">{r.title}</span>
                <span className="bs-row__meta">{r.meta}</span>
              </span>
              <span className="bs-row__aside">
                {r.href ? (
                  <a className="bs-hub__section-link" href={r.href} target="_blank" rel="noopener noreferrer">
                    <i className="bi bi-download" aria-hidden="true" /> Télécharger
                  </a>
                ) : <span className="bs-row__meta">Indisponible</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </AccountShell>
  );
}
