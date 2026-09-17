// tests/p1/financeOnSitePayments.test.js
// RX2.4 — Paiements sur place unifiés : prestations manuelles payées 100 % sur place représentées
// (timeline + dashboard) avec wording adaptatif ; filtre unifié ONSITE_DUE_BOOKING_FILTER.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import ServiceBooking from '../../models/ServiceBooking.js';
import { buildFinanceTimeline, mapBookingBalanceToFinanceMovement } from '../../services/finance/financeTimelineService.js';
import { buildFinanceDashboard } from '../../services/financeService.js';

const oid = () => new mongoose.Types.ObjectId();

function manualFullOnSite(overrides = {}) {
  return {
    bookingId: `BKG-${Math.random().toString(36).slice(2, 9)}`,
    serviceId: oid(), practitionerId: oid(), clientId: oid(),
    startAt: new Date(Date.now() + 86400000), endAt: new Date(Date.now() + 90000000),
    totalPrice: 90, depositAmount: 0, balanceDueAmount: 90,
    balanceSettlementMode: 'pay_on_site', paymentType: 'full', paymentStatus: 'pending',
    status: 'confirmed', source: 'manual_institute', paymentMode: 'on_site',
    ...overrides,
  };
}

describe('RX2.4 — wording mapper adaptatif', () => {
  it('prestation full on-site non encaissée → « Paiement sur place à encaisser »', () => {
    const m = mapBookingBalanceToFinanceMovement(manualFullOnSite({ createdAt: new Date() }));
    expect(m.type).toBe('balance_due');
    expect(m.title).toBe('Paiement sur place à encaisser');
    expect(m.amount).toBe(90);
    expect(m.badges.some((b) => b.label === 'Sur place')).toBe(true);
    expect(m.badges.some((b) => b.label === 'Réservation manuelle')).toBe(true);
  });

  it('prestation full on-site encaissée → « Paiement sur place encaissé » (in, totalPrice)', () => {
    const m = mapBookingBalanceToFinanceMovement(manualFullOnSite({ balanceDueAmount: 0, balancePaidAt: new Date() }));
    expect(m.type).toBe('balance_paid');
    expect(m.direction).toBe('in');
    expect(m.title).toBe('Paiement sur place encaissé');
    expect(m.amount).toBe(90);
  });

  it('acompte (deposit) garde le wording « Solde à encaisser »', () => {
    const m = mapBookingBalanceToFinanceMovement({ bookingId: 'B', clientId: oid(), totalPrice: 120, depositAmount: 70, balanceDueAmount: 50, paymentType: 'deposit', paymentMode: 'stripe', source: 'online', createdAt: new Date() });
    expect(m.title).toBe('Solde à encaisser');
  });
});

describe('RX2.4 — timeline + dashboard incluent les manuelles full on-site', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('timeline : la prestation manuelle full on-site apparaît en balance_due', async () => {
    await ServiceBooking.create(manualFullOnSite());
    const { items } = await buildFinanceTimeline({ type: 'balance', limit: 50 });
    const due = items.find((i) => i.type === 'balance_due');
    expect(due).toBeTruthy();
    expect(due.title).toBe('Paiement sur place à encaisser');
    expect(due.amount).toBe(90);
  });

  it('timeline : une réservation annulée avec solde dû est EXCLUE', async () => {
    await ServiceBooking.create(manualFullOnSite({ status: 'cancelled' }));
    const { items } = await buildFinanceTimeline({ type: 'balance', limit: 50 });
    expect(items.some((i) => i.type === 'balance_due')).toBe(false);
  });

  it('dashboard : la manuelle full on-site est comptée dans « à encaisser »', async () => {
    await ServiceBooking.create(manualFullOnSite({ balanceDueAmount: 90 }));
    await ServiceBooking.create(manualFullOnSite({ balanceDueAmount: 60 }));
    const dash = await buildFinanceDashboard({ range: 'today' });
    expect(dash.actions.balancesToCollect.count).toBe(2);
    expect(dash.actions.balancesToCollect.total).toBe(150);
  });
});
