// RX4 — Mes rendez-vous (P2/P3). Cards interactives (jamais de tableau) : chaque carte ouvre un drawer
// détail premium avec les actions autorisées (facture, annulation). Annulation = parcours intégré au drawer
// (éligibilité → conséquences → confirmation → succès → refresh). Report actif = non supporté côté client
// (flux tokenisé e-mail, cf. audit §2) → aucun bouton factice.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, EmptyState, ErrorState, Skeleton } from '@bs/ui';
import { formatPrice, type ClientBooking } from '@bs/api-client';
import {
  AccountShell,
  BookingDetailDrawer,
  useMyBookings,
  formatLongDate,
  formatTimeRange,
  bookingBalanceDue,
  bookingStatusLabel,
  bookingStatusTone,
  isUpcomingBooking,
} from '../features/account';

function BookingCard({ b, onOpen }: { b: ClientBooking; onOpen: () => void }) {
  const balance = bookingBalanceDue(b);
  return (
    <button type="button" className="bs-hl bs-hl--plain" style={{ cursor: 'pointer', textAlign: 'left', width: '100%' }} onClick={onOpen}>
      <div className="bs-hl__row">
        <h2 className="bs-hl__title">{b.serviceName || 'Prestation'}</h2>
        <Badge tone={bookingStatusTone(b.status, b.startAt)}>{bookingStatusLabel(b.status)}</Badge>
      </div>
      <div className="bs-hl__meta">
        <span><i className="bi bi-calendar3" aria-hidden="true" /> {formatLongDate(b.startAt) || '—'}</span>
        <span><i className="bi bi-clock" aria-hidden="true" /> {formatTimeRange(b.startAt, b.endAt) || '—'}</span>
        <span><i className="bi bi-cash-coin" aria-hidden="true" /> {formatPrice(b.totalPrice)}</span>
        {balance > 0 ? <span><i className="bi bi-wallet2" aria-hidden="true" /> Reste {formatPrice(balance)}</span> : null}
      </div>
      <span className="bs-hub__section-link" aria-hidden="true">Voir le détail <i className="bi bi-chevron-right" /></span>
    </button>
  );
}

function Section({ title, bookings, onOpen }: { title: string; bookings: ClientBooking[]; onOpen: (b: ClientBooking) => void }) {
  if (bookings.length === 0) return null;
  return (
    <div className="bs-hub__section">
      <div className="bs-hub__section-head"><h2 className="bs-hub__section-title">{title}</h2></div>
      <div className="bs-hub__list">{bookings.map((b) => <BookingCard key={b.id} b={b} onOpen={() => onOpen(b)} />)}</div>
    </div>
  );
}

export function MyAppointmentsPage() {
  const query = useMyBookings();
  const [selected, setSelected] = useState<ClientBooking | null>(null);

  const bookings = query.data ?? [];
  const upcoming = bookings.filter((b) => isUpcomingBooking(b));
  const past = bookings.filter((b) => !isUpcomingBooking(b));

  return (
    <AccountShell title="Mes rendez-vous">
      {query.isPending ? (
        <Skeleton variant="block" height="120px" count={2} />
      ) : query.isError ? (
        <ErrorState title="Impossible de charger vos rendez-vous." />
      ) : bookings.length === 0 ? (
        <>
          <EmptyState label="Vous n'avez pas encore de rendez-vous." />
          <Link className="bs-btn" to="/prestations" style={{ marginTop: 'var(--bs-space-2)' }}>Découvrir les prestations</Link>
        </>
      ) : (
        <>
          <Section title="À venir" bookings={upcoming} onOpen={setSelected} />
          <Section title="Passés" bookings={past} onOpen={setSelected} />
        </>
      )}
      {selected ? <BookingDetailDrawer booking={selected} onClose={() => setSelected(null)} /> : null}
    </AccountShell>
  );
}
