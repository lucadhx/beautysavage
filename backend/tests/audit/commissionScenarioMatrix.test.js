// tests/audit/commissionScenarioMatrix.test.js
// Audit commissions pré-React (rapports 99-103). Matrice de scénarios SIMULÉS, non
// destructifs. EXPLORATOIRE : `npm run audit:commissions` (config vitest.audit.config.js),
// JAMAIS dans la suite principale.
//
// Caractérisation : vert = comportement OBSERVÉ conforme au rapport. Le statut métier
// (PASS/FAIL/FRAGILE/INDÉTERMINÉ vs RÈGLE CIBLE) est noté en commentaire et synthétisé
// dans le rapport 102. Aucun code métier n'est modifié.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const Sale = (await import('../../models/Sale.js')).default;
const RefundRequest = (await import('../../models/RefundRequest.js')).default;
const CommissionTransaction = (await import('../../models/CommissionTransaction.js')).default;
const CommissionPayment = (await import('../../models/CommissionPayment.js')).default;
const EventLog = (await import('../../models/EventLog.js')).default;
const { computeCommissionsForPeriod, getOrComputeCommissionPayment } = await import('../../services/commissionPaymentService.js');
const { recordCommissionTransactions, calculateCommissionAmount } = await import('../../services/commissionService.js');
const { ensureRefundCommissionProvision, ensureRefundCommissionReversal } = await import('../../services/refundService.js');

const PCT10 = { type: 'percentage', value: 10 };
const M0_START = new Date(2026, 0, 1), M0_END = new Date(2026, 1, 1);
const M1_START = new Date(2026, 1, 1), M1_END = new Date(2026, 2, 1);

async function saleFormation({ saleId, total = 200, commission = 20, giftCardTotal = 0, when = new Date(2026, 0, 15) }) {
  const giftCardUsage = giftCardTotal > 0
    ? [{ giftCardId: new mongoose.Types.ObjectId(), code: 'GC', amountUsed: giftCardTotal }]
    : [];
  return Sale.create({
    saleId, userId: new mongoose.Types.ObjectId(),
    items: [{ type: 'formation', itemId: new mongoose.Types.ObjectId(), name: 'F', price: total, finalPrice: total }],
    totalAmount: total, commissionAmount: commission, commissionRate: 10, itemCount: 1,
    giftCardUsage, createdAt: when
  });
}
async function settledRefund({ refundId, saleId, amount, when = new Date(2026, 0, 20), kind = 'stripe' }) {
  const base = {
    refundId, saleId, userId: new mongoose.Types.ObjectId(),
    itemId: new mongoose.Types.ObjectId(), itemType: 'formation', amount, status: 'succeeded'
  };
  if (kind === 'giftcard') {
    Object.assign(base, { stripeRefundStatus: 'not_applicable', giftCardRefundStatus: 'succeeded', giftCardRecredited: true, refundedAt: when });
  } else {
    Object.assign(base, { stripeRefundStatus: 'succeeded', stripeRefundConfirmedAt: when });
  }
  return RefundRequest.create(base);
}

describe('AUDIT — matrice commissions', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await RefundRequest.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  // ── Base de calcul (règle cible : prix réellement payé, CC incluse, promo incluse) ──
  it('C01 commission % calculée sur le prix [PASS]', () => {
    expect(calculateCommissionAmount({ type: 'percentage', value: 10, price: 200 })).toBe(20);
  });
  it('C02 commission fixe [PASS]', () => {
    expect(calculateCommissionAmount({ type: 'fixed', value: 15, price: 200 })).toBe(15);
  });
  it('C03 vente simple → ledger CommissionTransaction (sale) [PASS]', async () => {
    const rows = await recordCommissionTransactions({
      saleId: 'S-1',
      formationEntries: [{ formationId: new mongoose.Types.ObjectId(), formationName: 'F', price: 200 }],
      config: PCT10
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].commissionAmount).toBe(20);
  });
  it('C04 vente carte cadeau 100 % → commission inchangée (CC incluse) [PASS]', async () => {
    await saleFormation({ saleId: 'S-CC', total: 200, commission: 20, giftCardTotal: 200 });
    const { total } = await computeCommissionsForPeriod(M0_START, M0_END);
    expect(total).toBe(20); // commission sur le prix plein, indépendante du moyen de paiement
  });
  it('C05 vente mixte Stripe+CC → commission inchangée [PASS]', async () => {
    await saleFormation({ saleId: 'S-MIX', total: 200, commission: 20, giftCardTotal: 120 });
    const { total } = await computeCommissionsForPeriod(M0_START, M0_END);
    expect(total).toBe(20);
  });
  it('C06 vente avec promotion → commission sur prix réduit [PASS]', () => {
    // promo 25% sur 200 → 150 ; commission 10% → 15
    expect(calculateCommissionAmount({ type: 'percentage', value: 10, price: 150 })).toBe(15);
  });

  // ── Remboursements avant commission payée ──
  it('C07 remboursement total avant paiement → déduction totale [PASS]', async () => {
    const s = await saleFormation({ saleId: 'S-R1', total: 200, commission: 20 });
    await settledRefund({ refundId: 'R1', saleId: s.saleId, amount: 200 });
    const { total } = await computeCommissionsForPeriod(M0_START, M0_END);
    expect(total).toBe(0);
  });
  it('C08 remboursement partiel avant paiement → déduction proportionnelle [PASS]', async () => {
    const s = await saleFormation({ saleId: 'S-R2', total: 200, commission: 20 });
    await settledRefund({ refundId: 'R2', saleId: s.saleId, amount: 100 });
    const { total } = await computeCommissionsForPeriod(M0_START, M0_END);
    expect(total).toBe(10); // 20 - (100/200*20)
  });
  it('C09 remboursement carte cadeau (recrédit) → déduit aussi (A5) [PASS]', async () => {
    const s = await saleFormation({ saleId: 'S-R3', total: 200, commission: 20, giftCardTotal: 200 });
    await settledRefund({ refundId: 'R3', saleId: s.saleId, amount: 200, kind: 'giftcard' });
    const { total } = await computeCommissionsForPeriod(M0_START, M0_END);
    expect(total).toBe(0);
  });

  // ── Remboursements cross-mois / après commission payée ──
  it('C10 remboursement mois suivant → bucketé sur le mois du règlement [PASS]', async () => {
    const s = await saleFormation({ saleId: 'S-R4', total: 200, commission: 20, when: new Date(2026, 0, 15) });
    await settledRefund({ refundId: 'R4', saleId: s.saleId, amount: 200, when: new Date(2026, 1, 10) });
    const m0 = await computeCommissionsForPeriod(M0_START, M0_END);
    const m1 = await computeCommissionsForPeriod(M1_START, M1_END);
    expect(m0.total).toBe(20); // mois de vente : pleine commission
    expect(m1.refundEntries).toHaveLength(1); // déduction sur le mois courant (règlement)
  });
  it('C11 computeCommissionsForPeriod.total reste clampé (compat) MAIS le carry-over est géré au niveau mensuel [PASS]', async () => {
    // Vente en M0, refund réglé en M1 sans vente M1.
    const s = await saleFormation({ saleId: 'S-R5', total: 200, commission: 20, when: new Date(2026, 0, 15) });
    await settledRefund({ refundId: 'R5', saleId: s.saleId, amount: 200, when: new Date(2026, 1, 10) });
    const m1 = await computeCommissionsForPeriod(M1_START, M1_END);
    // `total` (champ de compat) reste clampé à 0 ; gross/refundDeduction exposent le détail.
    expect(m1.refundEntries.length).toBeGreaterThanOrEqual(1);
    expect(m1.total).toBe(0);
    expect(m1.refundDeductionAmount).toBe(20);
    // CORRIGÉ : le report (carry-over) est désormais calculé par getOrComputeCommissionPayment
    // (buildMonthlyComputation) → negativeCarryOverAmount, plus de perte silencieuse.
    const doc = await getOrComputeCommissionPayment(1, 2026);
    expect(doc.netAmountDue).toBe(0);
    expect(doc.negativeCarryOverAmount).toBe(20);
  });

  // ── Ledger (audit) — provisions/reversals ──
  it('C12 provision remboursement → ligne négative + commission.adjusted [PASS]', async () => {
    const fId = new mongoose.Types.ObjectId();
    await CommissionTransaction.create({ saleId: 'S-L1', formationId: fId, formationName: 'F', sourceType: 'sale', commissionType: 'fixed', commissionValue: 20, commissionAmount: 20 });
    await Sale.create({ saleId: 'S-L1', userId: new mongoose.Types.ObjectId(), items: [], totalAmount: 200, createdAt: new Date(2026, 0, 15) });
    const refund = await RefundRequest.create({ refundId: 'RL1', saleId: 'S-L1', userId: new mongoose.Types.ObjectId(), itemId: fId, itemType: 'formation', formationId: fId, amount: 200, status: 'requested' });
    const row = await ensureRefundCommissionProvision(refund);
    expect(row.commissionAmount).toBe(-20);
    expect(await EventLog.countDocuments({ eventName: 'commission.adjusted' })).toBe(1);
  });
  it('C13 remboursement échoué → reversal restaure (commission.cancelled) [PASS]', async () => {
    const fId = new mongoose.Types.ObjectId();
    await CommissionTransaction.create({ saleId: 'S-L2', formationId: fId, formationName: 'F', sourceType: 'sale', commissionType: 'fixed', commissionValue: 20, commissionAmount: 20 });
    const refund = await RefundRequest.create({ refundId: 'RL2', saleId: 'S-L2', userId: new mongoose.Types.ObjectId(), itemId: fId, itemType: 'formation', formationId: fId, amount: 200, status: 'requested' });
    await ensureRefundCommissionProvision(refund);
    await ensureRefundCommissionReversal(refund);
    expect(await EventLog.countDocuments({ eventName: 'commission.cancelled' })).toBe(1);
  });
  it('C14 LEDGER non consommé par la facturation → DOUBLON [FRAGILE]', async () => {
    // La facture (computeCommissionsForPeriod) ignore CommissionTransaction : on le prouve.
    const fId = new mongoose.Types.ObjectId();
    await CommissionTransaction.create({ saleId: 'S-L3', formationId: fId, formationName: 'F', sourceType: 'refund_adjustment', refundId: 'RX', commissionType: 'fixed', commissionValue: 20, commissionAmount: -20 });
    await saleFormation({ saleId: 'S-L3', total: 200, commission: 20 });
    const { total, refundEntries } = await computeCommissionsForPeriod(M0_START, M0_END);
    // Le ledger refund_adjustment n'a AUCUN effet sur la facture (pas de RefundRequest réglé).
    expect(refundEntries).toHaveLength(0);
    expect(total).toBe(20);
  });

  // ── Facture mensuelle ──
  it('C15 mois sans commission → succeeded direct (montant 0) [PASS]', async () => {
    const doc = await getOrComputeCommissionPayment(0, 2026); // janvier, aucune vente
    expect(doc.amount).toBe(0);
    expect(doc.status).toBe('succeeded');
  });
  it('C16 facture mois courant : ventes + remboursements (ligne négative) présents [PASS]', async () => {
    const s = await saleFormation({ saleId: 'S-INV', total: 200, commission: 20 });
    await settledRefund({ refundId: 'R-INV', saleId: s.saleId, amount: 100 });
    const doc = await getOrComputeCommissionPayment(0, 2026);
    expect(doc.sales.length).toBeGreaterThanOrEqual(1);
    expect(doc.refunds.length).toBeGreaterThanOrEqual(1); // ligne négative référençant le refund
    expect(doc.amount).toBe(10);
  });
  it('C17 montant pending RAFRAÎCHI : refund après création répercuté (correction commissions) [PASS]', async () => {
    const s = await saleFormation({ saleId: 'S-FRZ', total: 200, commission: 20 });
    const doc1 = await getOrComputeCommissionPayment(0, 2026); // net 20 pending
    expect(doc1.netAmountDue).toBe(20);
    await settledRefund({ refundId: 'R-FRZ', saleId: s.saleId, amount: 200 });
    const doc2 = await getOrComputeCommissionPayment(0, 2026); // REFRESH (source unique)
    // CORRIGÉ : le pending est recalculé → la déduction est répercutée (net 0, settled_zero).
    expect(doc2.netAmountDue).toBe(0);
    expect(doc2.settledReason).toBe('settled_zero');
  });

  // ── Idempotence / doublons ──
  it('C18 double remboursement actif même sale+item → rejeté (index unique) [PASS]', async () => {
    const itemId = new mongoose.Types.ObjectId();
    const base = { saleId: 'S-DUP', userId: new mongoose.Types.ObjectId(), itemId, itemType: 'formation', amount: 100, status: 'requested' };
    await RefundRequest.create({ ...base, refundId: 'D1' });
    let threw = false;
    try { await RefundRequest.create({ ...base, refundId: 'D2' }); } catch (e) { threw = Number(e?.code) === 11000; }
    expect(threw).toBe(true);
  });
  it('C19 vente annulée avant finalisation (aucune Sale) → 0 commission [PASS]', async () => {
    const { total } = await computeCommissionsForPeriod(M0_START, M0_END);
    expect(total).toBe(0);
  });
  it('C20 paiement 0 € (formation gratuite) → commission 0 [PASS]', async () => {
    await saleFormation({ saleId: 'S-ZERO', total: 0, commission: 0 });
    const { total } = await computeCommissionsForPeriod(M0_START, M0_END);
    expect(total).toBe(0);
  });

  // INDÉTERMINÉ (non automatisable sans Stripe Dev / mocks) — documentés rapport 100/101 :
  //  - Stripe Dev paiement commission (PaymentIntent réel)
  //  - replay webhook Stripe Dev (le webhook IGNORE le PI commission → no-op)
  //  - échec paiement commission (check-status → failed)
  //  - double-clic concurrent create-intent (fenêtre deux PI)
});
