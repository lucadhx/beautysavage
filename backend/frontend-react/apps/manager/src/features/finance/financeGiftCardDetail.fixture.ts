// RX2.6 — Fixture partagée de détail carte cadeau pour les tests React.
export const GIFT_CARD_DETAIL = {
  ok: true,
  giftCard: { id: 'GC1', maskedCode: '••••1234', status: 'active', creationMode: 'manual_institute', paymentMode: 'on_site', paymentLabel: 'Paiement sur place', message: 'Joyeux anniversaire', purchasedAt: '2026-06-01T00:00:00Z' },
  actors: { purchaser: { name: 'Bob', id: 'b1' }, recipient: { name: 'Alice', id: 'a1' } },
  paymentSource: { mode: 'on_site', label: 'Paiement sur place', invoice: null, sale: null },
  currentBalance: { amount: 100, balance: 70, reserved: 0, available: 70, status: 'active' },
  lifecycle: [
    { type: 'created', title: 'Carte cadeau créée (paiement sur place)', subtitle: 'Paiement sur place', amount: 100, balanceAfter: 100, occurredAt: '2026-06-01T00:00:00Z', status: 'success', source: {} },
    { type: 'used', title: 'Carte cadeau utilisée', subtitle: 'Moyen de paiement', amount: -30, balanceAfter: 70, occurredAt: '2026-06-05T00:00:00Z', status: 'neutral', source: {} },
  ],
  transactions: [
    { id: 't1', type: 'redeem', title: 'Carte cadeau utilisée', amount: -30, balanceBefore: 100, balanceAfter: 70, occurredAt: '2026-06-05T00:00:00Z', note: '', saleId: 'S1', actorRole: 'client', source: 'client' },
  ],
  refunds: [
    { refundId: 'REF-1', saleId: 'S1', amount: 60, stripeRefundAmount: 40, giftCardRefundAmount: 20, giftCardRefundStatus: 'succeeded', status: 'succeeded', recovered: false, isSplit: true, creditNoteUrl: null, occurredAt: '2026-06-10T00:00:00Z' },
  ],
  qr: { available: true, maskedToken: '••••' },
  actions: [
    { kind: 'customer_view', enabled: true, to: '/clients/a1' },
    { kind: 'gift_card_debit', enabled: true, to: '/clients/a1' },
  ],
};
