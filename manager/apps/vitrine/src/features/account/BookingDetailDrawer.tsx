// RX4 S2 — Drawer détail réservation + parcours d'annulation intégré (jamais de popup native).
// detail → confirmation (conséquences + remboursement estimé) → loading → succès → refresh (query invalidée).
// Le backend est l'autorité : éligibilité et exécution du remboursement sont calculées côté serveur.
import { useState } from 'react';
import { Badge, Button, Drawer, ErrorState, Skeleton } from '@bs/ui';
import { formatPrice, formatDuration, bookingInvoiceUrl, type ClientBooking, type BookingCancelResult } from '@bs/api-client';
import { useBookingRefundEligibility, useCancelBooking } from './hooks';
import {
  formatLongDate,
  formatTimeRange,
  bookingDurationMinutes,
  bookingBalanceDue,
  bookingStatusLabel,
  bookingStatusTone,
  isUpcomingBooking,
  refundReasonLabel,
} from './format';

type Mode = 'detail' | 'confirm' | 'success';

function DetailRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="bs-bk-row">
      <span className="bs-bk-row__label"><i className={`bi ${icon}`} aria-hidden="true" /> {label}</span>
      <span className="bs-bk-row__value">{value}</span>
    </div>
  );
}

export function BookingDetailDrawer({ booking, onClose }: { booking: ClientBooking; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('detail');
  const [result, setResult] = useState<BookingCancelResult | null>(null);
  const cancellable = isUpcomingBooking(booking);
  const eligibility = useBookingRefundEligibility(mode === 'confirm' ? booking.bookingId : undefined);
  const cancel = useCancelBooking();

  const balance = bookingBalanceDue(booking);
  const duration = bookingDurationMinutes(booking.startAt, booking.endAt);

  function onConfirmCancel() {
    cancel.mutate(booking.bookingId, {
      onSuccess: (res) => { setResult(res); setMode('success'); },
    });
  }

  const title =
    mode === 'confirm' ? 'Annuler le rendez-vous' : mode === 'success' ? 'Rendez-vous annulé' : 'Détail du rendez-vous';

  return (
    <Drawer open title={title} onClose={onClose} footer={renderFooter()}>
      {mode === 'detail' ? (
        <div className="bs-hub__section">
          <div className="bs-hl__row">
            <h2 className="bs-hl__title" style={{ margin: 0 }}>{booking.serviceName || 'Prestation'}</h2>
            <Badge tone={bookingStatusTone(booking.status, booking.startAt)}>{bookingStatusLabel(booking.status)}</Badge>
          </div>
          <div className="bs-bk-list">
            <DetailRow icon="bi-calendar3" label="Date" value={formatLongDate(booking.startAt) || '—'} />
            <DetailRow icon="bi-clock" label="Horaire" value={formatTimeRange(booking.startAt, booking.endAt) || '—'} />
            {duration > 0 ? <DetailRow icon="bi-hourglass-split" label="Durée" value={formatDuration(duration)} /> : null}
            {booking.selectedOptions.length > 0 ? (
              <DetailRow icon="bi-plus-circle" label="Options" value={booking.selectedOptions.map((o) => o.name).filter(Boolean).join(', ') || `${booking.selectedOptions.length}`} />
            ) : null}
            <DetailRow icon="bi-cash-coin" label="Total" value={formatPrice(booking.totalPrice)} />
            {Number(booking.depositAmount) > 0 ? <DetailRow icon="bi-wallet2" label="Acompte réglé" value={formatPrice(booking.depositAmount)} /> : null}
            {balance > 0 ? <DetailRow icon="bi-hourglass" label="Reste à régler" value={formatPrice(balance)} /> : null}
          </div>
        </div>
      ) : null}

      {mode === 'confirm' ? (
        <div className="bs-hub__section">
          <p style={{ margin: 0 }}>
            Vous êtes sur le point d'annuler <strong>{booking.serviceName || 'cette prestation'}</strong> du{' '}
            {formatLongDate(booking.startAt)}. Le créneau sera libéré.
          </p>
          {eligibility.isPending ? (
            <Skeleton variant="block" height="80px" />
          ) : eligibility.isError || !eligibility.data ? (
            <ErrorState title="Impossible de vérifier l'éligibilité au remboursement." />
          ) : (
            <div className={`bs-bk-consequence ${eligibility.data.eligibleRefund ? 'bs-bk-consequence--ok' : 'bs-bk-consequence--none'}`}>
              <i className={`bi ${eligibility.data.eligibleRefund ? 'bi-check-circle' : 'bi-info-circle'}`} aria-hidden="true" />
              <div>
                {eligibility.data.eligibleRefund ? (
                  <><strong>Remboursement estimé : {formatPrice(eligibility.data.refundAmount)}</strong>
                    <span className="bs-row__meta"> — le suivi vous sera envoyé par e-mail.</span></>
                ) : (
                  <strong>Aucun remboursement</strong>
                )}
                <p className="bs-row__meta" style={{ margin: '4px 0 0' }}>{refundReasonLabel(eligibility.data.reason, eligibility.data.eligibleRefund)}</p>
              </div>
            </div>
          )}
          {cancel.isError ? <ErrorState title="L'annulation a échoué. Réessayez." /> : null}
        </div>
      ) : null}

      {mode === 'success' ? (
        <div className="bs-hub__section" role="status">
          <div className="bs-bk-consequence bs-bk-consequence--ok">
            <i className="bi bi-check2-circle" aria-hidden="true" />
            <div>
              <strong>Votre rendez-vous a bien été annulé.</strong>
              <p className="bs-row__meta" style={{ margin: '4px 0 0' }}>
                {result?.eligibleRefund
                  ? `Un remboursement de ${formatPrice(result.refundAmount)} a été lancé. Vous recevrez le suivi par e-mail.`
                  : 'Aucun remboursement ne s\'applique à cette annulation.'}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </Drawer>
  );

  function renderFooter() {
    if (mode === 'success') return <Button onClick={onClose}>Fermer</Button>;
    if (mode === 'confirm') {
      return (
        <div className="bs-bk-actions">
          <Button variant="secondary" onClick={() => setMode('detail')} disabled={cancel.isPending}>Garder mon rendez-vous</Button>
          <button type="button" className="bs-btn bs-btn-danger" onClick={onConfirmCancel} disabled={cancel.isPending}>
            {cancel.isPending ? 'Annulation…' : "Confirmer l'annulation"}
          </button>
        </div>
      );
    }
    // detail
    return (
      <div className="bs-bk-actions">
        {booking.saleId ? (
          <a className="bs-btn bs-btn--secondary" href={bookingInvoiceUrl(booking.bookingId)} target="_blank" rel="noopener noreferrer">
            <i className="bi bi-download" aria-hidden="true" /> Facture
          </a>
        ) : null}
        {cancellable ? (
          <button type="button" className="bs-btn bs-btn-danger" onClick={() => setMode('confirm')}>Annuler</button>
        ) : null}
      </div>
    );
  }
}
