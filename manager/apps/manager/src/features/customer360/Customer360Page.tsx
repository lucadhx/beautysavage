// M12 - Customer 360 (Client Hub). Page fiche client: Hero -> KPIs -> Quick Actions -> tabs
// (Activite / Details / Finances) avec timeline + sections repliables. Mobile-first.
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorState } from '@bs/ui';
import type { TimelineItem, CustomerBooking, CustomerSale } from '@bs/api-client';
import { useCustomer360 } from './useCustomer360';
import {
  CustomerHeader, CustomerHeroCard, CustomerSummaryCards, QuickActions, MobileBottomActions,
  CustomerFinancialCard, CustomerTimeline, Accordion, BookingSection, SaleSection, FormationSection,
  ProductSection, GiftCardSection, RefundSection, DocumentsSection, CommunicationsSection,
  NotificationSection, CustomerTabs, CustomerDrawer, CustomerSkeleton, fmtDateTime, fmtDate, money,
  type C3Tab, type QuickAction,
} from './components';
import {
  CreateGiftCardDrawer, ManualGiftCardDebitDrawer, CustomerNoteDrawer,
} from './m13Drawers';
import './customer360.css';

type M13Drawer = 'giftcard' | 'debit' | 'note' | null;

type DrawerState = { title: string; rows: { label: string; value: string }[] } | null;

export function Customer360Page() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useCustomer360(id);
  const [tab, setTab] = useState<C3Tab>('activite');
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [m13Drawer, setM13Drawer] = useState<M13Drawer>(null);

  const phone = data?.summary.phone || null;
  const invalidate360 = () => {
    if (id) void qc.invalidateQueries({ queryKey: ['customer360', id] });
  };

  const callClient = () => {
    if (phone) window.location.href = `tel:${phone}`;
  };

  const scrollToRefunds = () => {
    setTab('details');
    setTimeout(() => {
      document.querySelector('[data-testid="c3-acc-refunds"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

  const quickActions: QuickAction[] = useMemo(() => [
    { key: 'giftcard', icon: 'bi-gift', label: 'Créer carte cadeau', onClick: () => setM13Drawer('giftcard') },
    { key: 'note', icon: 'bi-journal-plus', label: 'Ajouter une note', onClick: () => setM13Drawer('note') },
    { key: 'call', icon: 'bi-telephone', label: 'Appeler le client', onClick: callClient, disabled: !phone },
    { key: 'refund', icon: 'bi-arrow-counterclockwise', label: 'Achats remboursables', onClick: scrollToRefunds },
    { key: 'debit', icon: 'bi-credit-card-2-back', label: 'Débit carte cadeau', onClick: () => setM13Drawer('debit') },
  ], [phone]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <section className="c3-page"><CustomerSkeleton /></section>;
  if (isError || !data) {
    return (
      <section className="c3-page">
        <ErrorState title="Fiche client indisponible." detail="Impossible de charger les données." />
        <button type="button" className="c3-quickbtn" onClick={() => void refetch()} style={{ marginTop: 'var(--bs-space-3)' }}>
          Réessayer
        </button>
      </section>
    );
  }

  const onTimelineSelect = (it: TimelineItem) => {
    setDrawer({
      title: it.title,
      rows: [
        { label: 'Type', value: it.type },
        { label: 'Date', value: fmtDateTime(it.date) },
        ...(it.subtitle ? [{ label: 'Détail', value: it.subtitle }] : []),
        ...(it.refId ? [{ label: 'Référence', value: it.refId }] : []),
      ],
    });
  };

  const onBookingSelect = (booking: CustomerBooking) => {
    setDrawer({
      title: booking.serviceName,
      rows: [
        { label: 'Quand', value: fmtDateTime(booking.startAt) },
        { label: 'Statut', value: booking.status },
        { label: 'Total', value: money(booking.totalPrice) },
        { label: 'Acompte', value: money(booking.depositAmount) },
        { label: 'Solde sur place', value: money(booking.balanceDueAmount) },
      ],
    });
  };

  const onSaleSelect = (sale: CustomerSale) => {
    setDrawer({
      title: `Achat ${sale.saleId}`,
      rows: [
        { label: 'Date', value: fmtDate(sale.createdAt) },
        { label: 'Montant', value: money(sale.totalAmount) },
        { label: 'Articles', value: sale.items.map((item) => item.name).join(', ') || '—' },
      ],
    });
  };

  return (
    <section className="c3-page" data-testid="c3-page">
      <CustomerHeader summary={data.summary} onBack={() => navigate('/clients')} />
      <CustomerHeroCard summary={data.summary} />
      <CustomerSummaryCards summary={data.summary} />
      <QuickActions actions={quickActions} />

      <CustomerTabs value={tab} onChange={setTab} />

      {tab === 'activite' ? (
        <CustomerTimeline items={data.timeline} onSelect={onTimelineSelect} />
      ) : null}

      {tab === 'finances' ? (
        <CustomerFinancialCard financial={data.financial} />
      ) : null}

      {tab === 'details' ? (
        <div className="c3-sections">
          <Accordion title="Réservations" icon="bi-calendar-check" count={data.bookings.length} defaultOpen testid="c3-acc-bookings">
            <BookingSection bookings={data.bookings} onSelect={onBookingSelect} />
          </Accordion>
          <Accordion title="Achats" icon="bi-bag-check" count={data.sales.length} testid="c3-acc-sales">
            <SaleSection sales={data.sales} onSelect={onSaleSelect} />
          </Accordion>
          <Accordion title="Formations" icon="bi-mortarboard" count={data.formations.length} testid="c3-acc-formations">
            <FormationSection formations={data.formations} customerId={id} />
          </Accordion>
          <Accordion title="Produits" icon="bi-box-seam" count={data.products.length} testid="c3-acc-products">
            <ProductSection products={data.products} />
          </Accordion>
          <Accordion title="Cartes cadeaux" icon="bi-gift" count={data.giftCards.length} testid="c3-acc-giftcards">
            <GiftCardSection giftCards={data.giftCards} />
          </Accordion>
          <Accordion title="Remboursements" icon="bi-arrow-counterclockwise" count={data.refunds.length} testid="c3-acc-refunds">
            <RefundSection refunds={data.refunds} />
          </Accordion>
          <Accordion title="Documents" icon="bi-folder2-open" count={data.documents.length} testid="c3-acc-documents">
            <DocumentsSection documents={data.documents} />
          </Accordion>
          <Accordion title="Communications" icon="bi-envelope" count={data.communications.length} testid="c3-acc-comms">
            <CommunicationsSection communications={data.communications} />
          </Accordion>
          <Accordion title="Notifications" icon="bi-bell" count={data.notifications.length} testid="c3-acc-notifs">
            <NotificationSection notifications={data.notifications} />
          </Accordion>
        </div>
      ) : null}

      <MobileBottomActions actions={quickActions} />

      <CustomerDrawer open={Boolean(drawer)} title={drawer?.title || ''} onClose={() => setDrawer(null)}>
        {drawer ? (
          <div className="c3-detail">
            {drawer.rows.map((row) => (
              <div className="c3-row" key={row.label}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </CustomerDrawer>

      {id ? (
        <>
          <CreateGiftCardDrawer open={m13Drawer === 'giftcard'} customerId={id} onClose={() => setM13Drawer(null)} onDone={invalidate360} />
          <ManualGiftCardDebitDrawer open={m13Drawer === 'debit'} onClose={() => setM13Drawer(null)} onDone={invalidate360} />
          <CustomerNoteDrawer open={m13Drawer === 'note'} customerId={id} onClose={() => setM13Drawer(null)} onDone={invalidate360} />
        </>
      ) : null}
    </section>
  );
}
