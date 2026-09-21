import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { Dropdown } from '@/components/base/dropdown/dropdown';
import { ConfirmDialog } from '@/components/ui/dialog';
import { LineChart } from '@/components/charts/line-chart';
import { Line } from '@/components/charts/line';
import { Grid } from '@/components/charts/grid';
import { XAxis } from '@/components/charts/x-axis';
import { ChartTooltip } from '@/components/charts/tooltip';
import {
  CommercePageFrame,
  Metric,
  Panel,
  StatusBadge,
  cents,
  dateShort,
  statusLabel,
  type CommerceSale,
} from './CommerceShared';

function buyer(sale: CommerceSale) {
  if (typeof sale.customerId === 'object' && sale.customerId) {
    const name = [sale.customerId.firstName, sale.customerId.lastName].filter(Boolean).join(' ');
    return name || sale.customerId.email || 'Client';
  }
  return 'Client';
}

export default function CommerceVentesPage() {
  const [sales, setSales] = React.useState<CommerceSale[]>([]);
  const [period, setPeriod] = React.useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [refundTarget, setRefundTarget] = React.useState<CommerceSale | null>(null);
  const [message, setMessage] = React.useState('');
  const { saleId } = useParams();
  const navigate = useNavigate();

  const refresh = React.useCallback(() => {
    api.commerceSales()
      .then((list) => setSales(list as CommerceSale[]))
      .catch((err) => setMessage(err instanceof Error ? err.message : 'Chargement impossible'));
  }, []);

  React.useEffect(refresh, [refresh]);

  async function refund() {
    if (!refundTarget) return;
    await api.refundCommerceSale(refundTarget._id, {
      amountCents: refundTarget.totalCents,
      reason: 'Remboursement manuel depuis le manager BeautySavage',
    });
    setRefundTarget(null);
    setMessage('Vente remboursee.');
    refresh();
  }

  const filteredSales = React.useMemo(() => filterSalesByPeriod(sales, period), [sales, period]);
  const paid = filteredSales.filter((sale) => sale.paymentStatus === 'PAID');
  const refunded = filteredSales.filter((sale) => sale.paymentStatus === 'REFUNDED');
  const revenue = paid.reduce((sum, sale) => sum + (sale.totalCents || 0), 0);
  const chartData = React.useMemo(() => salesChartData(filteredSales), [filteredSales]);
  const selected = saleId ? sales.find((sale) => sale._id === saleId) || null : null;

  if (saleId) {
    return (
      <CommercePageFrame
        title={selected ? `Commande ${selected.saleNumber}` : 'Commande'}
        description="Fiche de vente detaillee : lignes, factures, avoirs, allocations Stripe et cartes cadeaux."
        actions={<button type="button" onClick={() => navigate('/commerce/ventes')} className="rounded-md border px-3 py-2 text-sm font-semibold hover:bg-muted">Retour aux ventes</button>}
      >
        {message && <p className="rounded-md border p-3 text-sm text-muted-foreground">{message}</p>}
        {!selected ? (
          <Panel title="Chargement">
            <p className="text-sm text-muted-foreground">{sales.length === 0 ? 'Chargement de la commande...' : 'Commande introuvable.'}</p>
          </Panel>
        ) : (
          <SaleDetailCard sale={selected} onRefund={() => setRefundTarget(selected)} />
        )}
        <ConfirmDialog
          open={Boolean(refundTarget)}
          onClose={() => setRefundTarget(null)}
          onConfirm={refund}
          title="Rembourser la vente"
          description={refundTarget ? `Rembourser ${refundTarget.saleNumber} pour ${cents(refundTarget.totalCents)} ?` : ''}
          confirmLabel="Rembourser"
          destructive
        />
      </CommercePageFrame>
    );
  }

  return (
    <CommercePageFrame
      title="Ventes et remboursements"
      description="Consultation des commandes, suivi des paiements, factures et remboursements manuels."
    >
      {message && <p className="rounded-md border p-3 text-sm text-muted-foreground">{message}</p>}
      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Ventes" value={filteredSales.length} />
        <Metric label="Payees" value={paid.length} />
        <Metric label="Remboursees" value={refunded.length} />
        <Metric label="CA paye" value={cents(revenue)} />
      </div>
      <Panel title="Statistiques">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Suivez les commandes et le chiffre d'affaires sur la periode choisie.</p>
          <div className="flex rounded-lg border bg-background p-1 text-sm">
            {[
              ['7d', '7 jours'],
              ['30d', '30 jours'],
              ['90d', '90 jours'],
              ['all', 'Tout'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPeriod(value as typeof period)}
                className={`rounded-md px-3 py-1.5 font-medium ${period === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-lg border bg-card p-3">
            <p className="px-2 pt-1 text-sm font-semibold">Chiffre d'affaires</p>
            <LineChart data={chartData} xDataKey="date" aspectRatio="2.3 / 1" margin={{ top: 28, right: 22, bottom: 38, left: 22 }}>
              <Grid horizontal vertical={false} />
              <XAxis numTicks={5} />
              <ChartTooltip rows={(point) => [{ label: 'CA', value: cents(Number(point.revenue || 0)), color: 'hsl(var(--primary))' }]} />
              <Line dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={3} showMarkers />
            </LineChart>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <p className="px-2 pt-1 text-sm font-semibold">Commandes</p>
            <LineChart data={chartData} xDataKey="date" aspectRatio="1.5 / 1" margin={{ top: 28, right: 22, bottom: 38, left: 22 }}>
              <Grid horizontal vertical={false} />
              <XAxis numTicks={4} />
              <ChartTooltip rows={(point) => [{ label: 'Commandes', value: String(point.orders || 0), color: 'hsl(var(--muted-foreground))' }]} />
              <Line dataKey="orders" stroke="hsl(var(--muted-foreground))" strokeWidth={2.5} showMarkers />
            </LineChart>
          </div>
        </div>
      </Panel>
      <Panel title="Commandes">
        {sales.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucune vente pour le moment.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Commande</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Montant</th>
                  <th className="px-4 py-3">Paiement</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredSales.map((sale) => (
                  <tr key={sale._id} className="border-t">
                    <td className="px-4 py-3">
                      <div className="font-medium">{sale.saleNumber}</div>
                      <div className="text-xs text-muted-foreground">{sale.lines?.length || 0} ligne(s)</div>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs">
                        {sale.invoice?.pdfUrl && <a className="underline" href={sale.invoice.pdfUrl} target="_blank" rel="noreferrer">Facture</a>}
                        {sale.creditNote?.pdfUrl && <a className="underline" href={sale.creditNote.pdfUrl} target="_blank" rel="noreferrer">Avoir</a>}
                      </div>
                    </td>
                    <td className="px-4 py-3">{buyer(sale)}</td>
                    <td className="px-4 py-3">{dateShort(sale.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div>{cents(sale.totalCents)}</div>
                      <div className="text-xs text-muted-foreground">Stripe {cents(sale.stripeAmountCents)} · cartes {cents(sale.giftCardAmountCents)}</div>
                    </td>
                    <td className="px-4 py-3"><StatusBadge>{sale.paymentStatus}</StatusBadge></td>
                    <td className="px-4 py-3">
                      <Dropdown.Root>
                        <Dropdown.DotsButton aria-label={`Actions ${sale.saleNumber}`} />
                        <Dropdown.Popover className="w-52">
                          <Dropdown.Menu>
                            <Dropdown.Section>
                              <Dropdown.Item onAction={() => navigate(`/commerce/ventes/${sale._id}`)}>Voir le detail</Dropdown.Item>
                              {sale.invoice?.pdfUrl && <Dropdown.Item onAction={() => window.open(sale.invoice?.pdfUrl, '_blank')}>Ouvrir la facture</Dropdown.Item>}
                              {sale.creditNote?.pdfUrl && <Dropdown.Item onAction={() => window.open(sale.creditNote?.pdfUrl, '_blank')}>Ouvrir l avoir</Dropdown.Item>}
                            </Dropdown.Section>
                            <Dropdown.Separator />
                            <Dropdown.Section>
                              <Dropdown.Item destructive disabled={sale.paymentStatus === 'REFUNDED'} onAction={() => setRefundTarget(sale)}>Rembourser</Dropdown.Item>
                            </Dropdown.Section>
                          </Dropdown.Menu>
                        </Dropdown.Popover>
                      </Dropdown.Root>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <ConfirmDialog
        open={Boolean(refundTarget)}
        onClose={() => setRefundTarget(null)}
        onConfirm={refund}
        title="Rembourser la vente"
        description={refundTarget ? `Rembourser ${refundTarget.saleNumber} pour ${cents(refundTarget.totalCents)} ?` : ''}
        confirmLabel="Rembourser"
        destructive
      />
    </CommercePageFrame>
  );
}

function filterSalesByPeriod(sales: CommerceSale[], period: '7d' | '30d' | '90d' | 'all') {
  if (period === 'all') return sales;
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const min = Date.now() - days * 24 * 60 * 60 * 1000;
  return sales.filter((sale) => {
    const time = sale.createdAt ? new Date(sale.createdAt).getTime() : 0;
    return Number.isFinite(time) && time >= min;
  });
}

function salesChartData(sales: CommerceSale[]) {
  const groups = new Map<string, { date: Date; revenue: number; orders: number }>();
  for (const sale of sales) {
    const date = sale.createdAt ? new Date(sale.createdAt) : new Date();
    const key = date.toISOString().slice(0, 10);
    const current = groups.get(key) || { date: new Date(`${key}T12:00:00`), revenue: 0, orders: 0 };
    current.orders += 1;
    if (sale.paymentStatus === 'PAID') current.revenue += sale.totalCents || 0;
    groups.set(key, current);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
}

function distanceTrainingBasis(sale: CommerceSale) {
  return (sale.lines || [])
    .filter((line) => line.productSnapshot?.kind === 'DISTANCE_TRAINING')
    .reduce((sum, line) => sum + (line.totalCents || 0), 0);
}

function SaleDetailCard({ sale, onRefund }: { sale: CommerceSale; onRefund: () => void }) {
  const basis = distanceTrainingBasis(sale);
  const devCommission = Math.round(basis * 0.1);
  const stripeCommission = Math.max(0, (sale.stripeAmountCents || 0) - (sale.totalCents || 0));
  return (
    <Panel title={`Detail ${sale.saleNumber}`}>
      <div className="grid gap-4 lg:grid-cols-3">
        <Detail label="Date" value={dateShort(sale.createdAt)} />
        <Detail label="Montant total" value={cents(sale.totalCents)} />
        <Detail label="Paiement" value={statusLabel(sale.paymentStatus)} />
        <Detail label="Stripe encaisse" value={cents(sale.stripeAmountCents)} />
        <Detail label="Cartes cadeaux" value={cents(sale.giftCardAmountCents)} />
        <Detail label="Commission dev estimee" value={cents(devCommission)} />
        <Detail label="Commission Stripe" value={stripeCommission > 0 ? cents(stripeCommission) : 'Non fournie'} />
        <Detail label="Session Stripe" value={sale.stripe?.checkoutSessionId || 'Non renseigne'} />
        <Detail label="Payment intent" value={sale.stripe?.paymentIntentId || 'Non renseigne'} />
      </div>
      <div className="mt-4 grid gap-3">
        <h3 className="text-sm font-semibold">Lignes vendues</h3>
        {(sale.lines || []).map((line, index) => (
          <div key={index} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <span>{line.productSnapshot?.title || 'Produit'} x{line.quantity || 1}</span>
            <strong>{cents(line.totalCents)}</strong>
          </div>
        ))}
        {(sale.giftCardAllocations || []).length > 0 && (
          <div className="rounded-md border bg-muted/20 p-3 text-sm">
            <h3 className="mb-2 font-semibold">Allocations cartes cadeaux</h3>
            {sale.giftCardAllocations?.map((allocation, index) => (
              <div key={index} className="flex justify-between gap-3">
                <span>{allocation.codeMasked || 'Carte cadeau'}</span>
                <strong>{cents(allocation.amountCents)}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {sale.invoice?.pdfUrl && <a href={sale.invoice.pdfUrl} target="_blank" rel="noreferrer" className="rounded-md border px-3 py-2 text-sm font-semibold hover:bg-muted">Ouvrir la facture</a>}
        {sale.creditNote?.pdfUrl && <a href={sale.creditNote.pdfUrl} target="_blank" rel="noreferrer" className="rounded-md border px-3 py-2 text-sm font-semibold hover:bg-muted">Ouvrir l'avoir</a>}
        <button type="button" onClick={onRefund} disabled={sale.paymentStatus === 'REFUNDED'} className="rounded-md border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">Rembourser</button>
      </div>
    </Panel>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 break-all text-sm font-semibold">{value}</p>
    </div>
  );
}
