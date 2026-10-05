import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { Dropdown } from '@/components/base/dropdown/dropdown';
import { ConfirmDialog } from '@/components/ui/dialog';
import { CardsSkeleton, FormSkeleton, Skeleton, TableSkeleton } from '@/components/ui/Skeleton';
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
  type CommerceSale,
} from './CommerceShared';
import { SaleDetail } from './SaleDetail';

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
  const [loaded, setLoaded] = React.useState(false);
  const { saleId } = useParams();
  const navigate = useNavigate();

  const refresh = React.useCallback(() => {
    api.commerceSales()
      .then((list) => setSales(list as CommerceSale[]))
      .catch((err) => setMessage(err instanceof Error ? err.message : 'Chargement impossible'))
      .finally(() => setLoaded(true));
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
        description="Cliente, articles, règlement, paiement Stripe (commission et net versé) et facture."
        actions={<button type="button" onClick={() => navigate('/commerce/ventes')} className="rounded-md border px-3 py-2 text-sm font-semibold hover:bg-muted">Retour aux ventes</button>}
      >
        {message && <p className="rounded-md border p-3 text-sm text-muted-foreground">{message}</p>}
        {!loaded ? (
          <FormSkeleton fields={6} />
        ) : !selected ? (
          <Panel title="Chargement">
            <p className="text-sm text-muted-foreground">Commande introuvable.</p>
          </Panel>
        ) : (
          <SaleDetail sale={selected} onRefund={() => setRefundTarget(selected)} />
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
      {!loaded ? <CardsSkeleton count={4} className="md:grid-cols-4" /> : (
        <div className="grid gap-4 md:grid-cols-4">
          <Metric label="Ventes" value={filteredSales.length} />
          <Metric label="Payees" value={paid.length} />
          <Metric label="Remboursees" value={refunded.length} />
          <Metric label="CA paye" value={cents(revenue)} />
        </div>
      )}
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
            {!loaded ? <Skeleton className="mt-3 aspect-[2.3/1] w-full" /> : (
              <LineChart data={chartData} xDataKey="date" aspectRatio="2.3 / 1" margin={{ top: 28, right: 22, bottom: 38, left: 22 }}>
                <Grid horizontal vertical={false} />
                <XAxis numTicks={5} />
                <ChartTooltip rows={(point) => [{ label: 'CA', value: cents(Number(point.revenue || 0)), color: 'hsl(var(--primary))' }]} />
                <Line dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={3} showMarkers />
              </LineChart>
            )}
          </div>
          <div className="rounded-lg border bg-card p-3">
            <p className="px-2 pt-1 text-sm font-semibold">Commandes</p>
            {!loaded ? <Skeleton className="mt-3 aspect-[1.5/1] w-full" /> : (
              <LineChart data={chartData} xDataKey="date" aspectRatio="1.5 / 1" margin={{ top: 28, right: 22, bottom: 38, left: 22 }}>
                <Grid horizontal vertical={false} />
                <XAxis numTicks={4} />
                <ChartTooltip rows={(point) => [{ label: 'Commandes', value: String(point.orders || 0), color: 'hsl(var(--muted-foreground))' }]} />
                <Line dataKey="orders" stroke="hsl(var(--muted-foreground))" strokeWidth={2.5} showMarkers />
              </LineChart>
            )}
          </div>
        </div>
      </Panel>
      <Panel title="Commandes">
        {!loaded ? <TableSkeleton rows={6} cols={6} /> : sales.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucune vente pour le moment.</p>
        ) : (
          <div className="m-table max-w-full overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Commande</th>
                  <th className="m-hide px-4 py-3">Client</th>
                  <th className="m-hide px-4 py-3">Date</th>
                  <th className="px-4 py-3">Montant</th>
                  <th className="px-4 py-3">Paiement</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredSales.map((sale) => (
                  <tr key={sale._id} className="cursor-pointer border-t transition-colors hover:bg-muted/40" onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button,[role="menu"]')) navigate(`/commerce/ventes/${sale._id}`); }} data-testid="sale-row">
                    <td className="px-4 py-3">
                      <div className="font-medium">{sale.saleNumber}</div>
                      <div className="text-xs text-muted-foreground">{sale.lines?.length || 0} ligne(s)</div>
                      <div className="mt-0.5 text-xs text-muted-foreground sm:hidden">{buyer(sale)} · {dateShort(sale.createdAt)}</div>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs">
                        {sale.invoiceUrl && <a className="underline" href={sale.invoiceUrl} target="_blank" rel="noreferrer" data-testid="sale-invoice">Facture</a>}
                      </div>
                    </td>
                    <td className="m-hide px-4 py-3">{buyer(sale)}</td>
                    <td className="m-hide whitespace-nowrap px-4 py-3">{dateShort(sale.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="whitespace-nowrap">{cents(sale.totalCents)}</div>
                      <div className="hidden text-xs text-muted-foreground sm:block">Stripe {cents(sale.stripeAmountCents)} · cartes {cents(sale.giftCardAmountCents)}</div>
                    </td>
                    <td className="px-4 py-3"><StatusBadge>{sale.paymentStatus}</StatusBadge></td>
                    <td className="px-4 py-3">
                      <Dropdown.Root>
                        <Dropdown.DotsButton aria-label={`Actions ${sale.saleNumber}`} />
                        <Dropdown.Popover className="w-52">
                          <Dropdown.Menu>
                            <Dropdown.Section>
                              <Dropdown.Item onAction={() => navigate(`/commerce/ventes/${sale._id}`)}>Voir le detail</Dropdown.Item>
                              {sale.invoiceUrl && <Dropdown.Item onAction={() => window.open(sale.invoiceUrl, '_blank')}>Ouvrir la facture Stripe</Dropdown.Item>}
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

