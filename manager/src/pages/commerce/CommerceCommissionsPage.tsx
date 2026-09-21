import * as React from 'react';
import { api } from '@/lib/api';
import {
  CommercePageFrame,
  Metric,
  Panel,
  StatusBadge,
  cents,
  dateShort,
  type CommerceCommission,
} from './CommerceShared';

export default function CommerceCommissionsPage() {
  const [commissions, setCommissions] = React.useState<CommerceCommission[]>([]);
  const [message, setMessage] = React.useState('');

  const refresh = React.useCallback(() => {
    api.commerceCommissions()
      .then((list) => setCommissions(list as CommerceCommission[]))
      .catch((err) => setMessage(err instanceof Error ? err.message : 'Chargement impossible'));
  }, []);

  React.useEffect(refresh, [refresh]);

  async function pay(commission: CommerceCommission) {
    await api.payCommerceCommission(commission._id, { paymentReference: `Paiement manuel ${new Date().toISOString()}` });
    setMessage('Commission marquee comme payee.');
    refresh();
  }

  async function recalculate() {
    await api.recalculateCommerceCommissions();
    setMessage('Commissions mensuelles recalculees depuis les ventes payees.');
    refresh();
  }

  const due = commissions.filter((commission) => commission.status === 'DUE' || commission.status === 'PAYMENT_PENDING');
  const dueAmount = due.reduce((sum, commission) => sum + (commission.amountCents || 0), 0);

  return (
    <CommercePageFrame
      title="Commissions"
      description="Suivi des commissions dues a la plateforme et validation des paiements effectues."
      actions={<button onClick={recalculate} className="rounded-md border px-3 py-2 text-sm font-semibold">Recalculer</button>}
    >
      {message && <p className="rounded-md border p-3 text-sm text-muted-foreground">{message}</p>}
      <div className="grid gap-4 md:grid-cols-3">
        <Metric label="Commissions ouvertes" value={due.length} />
        <Metric label="Montant a payer" value={cents(dueAmount)} />
        <Metric label="Historique" value={commissions.length} detail="Toutes periodes confondues" />
      </div>
      <Panel title="A payer et historique">
        {commissions.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Aucune commission due pour le moment.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Commission</th>
                  <th className="px-4 py-3">Echeance</th>
                  <th className="px-4 py-3">Montant</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {commissions.map((commission) => (
                  <tr key={commission._id} className="border-t">
                    <td className="px-4 py-3">
                      <div className="font-medium">{commission.label}</div>
                      <div className="text-xs text-muted-foreground">Base {cents(commission.basisCents)} · taux {((commission.rateBps || 0) / 100).toFixed(2)}%</div>
                      {commission.paymentReference && (
                        <div className="text-xs text-muted-foreground">{commission.paymentReference}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">{dateShort(commission.dueAt)}</td>
                    <td className="px-4 py-3">{cents(commission.amountCents)}</td>
                    <td className="px-4 py-3"><StatusBadge>{commission.status}</StatusBadge></td>
                    <td className="px-4 py-3">
                      {commission.status === 'PAID' ? (
                        <span className="text-xs text-muted-foreground">Payee le {dateShort(commission.paidAt)}</span>
                      ) : (
                        <button onClick={() => pay(commission)} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
                          Marquer payee
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </CommercePageFrame>
  );
}
