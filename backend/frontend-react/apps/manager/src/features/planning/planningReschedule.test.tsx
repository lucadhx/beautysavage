// M11B — UI report (mobile-first) : ouverture du formulaire, soumission (payload), états
// loading/success/error. Aucune table ; aucun texte « prestataire/praticienne » ; pas de hex.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { CalendarItem } from '@bs/api-client';
import { CalendarItemDetailDrawer } from './components';

const ITEM: CalendarItem = {
  id: 'BKG-1', type: 'service_booking', title: 'Soin visage',
  startAt: '2026-07-01T10:00:00', endAt: '2026-07-01T11:00:00',
  status: 'confirmed', client: { name: 'Jane D.' }, participant: null,
  paymentStatus: 'paid', paymentType: 'full', refundStatus: null,
  totalAmount: 100, depositAmount: 0, amountPaidOnline: 100, balanceDueAmount: 0,
  balanceSettlementMode: null,
  actionLinks: { detail: true, cancel: true, markBalancePaid: false, reschedule: true },
  sourceModel: 'ServiceBooking', sourceId: 'x',
};

function renderDrawer(onReschedule: (i: CalendarItem, p: unknown) => Promise<void>) {
  return render(
    <CalendarItemDetailDrawer
      item={ITEM}
      onClose={() => {}}
      onCancel={() => {}}
      onMarkPaid={() => {}}
      onReschedule={onReschedule as never}
    />,
  );
}

describe('Planning report UI (M11B)', () => {
  it('ouvre le formulaire de report puis soumet le bon payload (succès)', async () => {
    const onReschedule = vi.fn(async () => {});
    renderDrawer(onReschedule);
    fireEvent.click(screen.getByTestId('pl-reschedule-open'));
    expect(screen.getByTestId('pl-reschedule-form')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('pl-reschedule-submit'));
    await waitFor(() => expect(onReschedule).toHaveBeenCalledTimes(1));
    const payload = (onReschedule.mock.calls[0] as unknown[])[1] as { newStartAt: string; newEndAt: string };
    expect(payload.newStartAt).toContain('2026-07-01T10:00');
    expect(typeof payload.newEndAt).toBe('string');
    await waitFor(() => expect(screen.getByTestId('pl-reschedule-success')).toBeInTheDocument());
  });

  it('affiche une erreur si la mutation échoue', async () => {
    const onReschedule = vi.fn(async () => { throw new Error('Ce creneau n est plus disponible.'); });
    renderDrawer(onReschedule);
    fireEvent.click(screen.getByTestId('pl-reschedule-open'));
    fireEvent.click(screen.getByTestId('pl-reschedule-submit'));
    await waitFor(() => expect(screen.getByTestId('pl-reschedule-error')).toBeInTheDocument());
    expect(screen.getByTestId('pl-reschedule-error')).toHaveTextContent(/disponible/i);
  });

  it('aucune table, aucun texte « prestataire/praticienne »', () => {
    const { container } = renderDrawer(async () => {});
    fireEvent.click(screen.getByTestId('pl-reschedule-open'));
    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent || '').not.toMatch(/prestataire|praticienne/i);
  });
});
