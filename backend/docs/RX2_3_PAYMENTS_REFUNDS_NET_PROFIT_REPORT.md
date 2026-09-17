# RX2.3 — Paiements, Remboursements 1-clic, Commissions & Profit Net · Rapport

> Détail financier d'un mouvement (breakdown paiement + **profit net estimé**) et actions interactives
> dans le `FinanceMovementDrawer`. Aucun montant inventé ; frais Stripe inconnus → « en attente »,
> jamais d'estimation. Audit : [RX2_3_PAYMENTS_REFUNDS_NET_PROFIT_AUDIT.md](RX2_3_PAYMENTS_REFUNDS_NET_PROFIT_AUDIT.md).

## Backend

### Détail mouvement — `services/finance/financeMovementDetailService.js`
`GET /api/gestion/finance/movement-detail?sourceModel=&sourceId=&type=` (admin/dev). Renvoie
`{ movement, paymentBreakdown, lines, actions }`. Charge la source par (`sourceModel`,`sourceId`).

`paymentBreakdown` : `paidAmount`, `stripePaidAmount`, `giftCardPaidAmount`, `onSitePaidAmount`,
`refundAmount`, `stripeFeesAmount`, `stripeFeesStatus`, `devCommissionAmount`, `netProfitAmount`,
`netProfitStatus`. `lines[]` = lignes lisibles (`income`/`fee`/`commission`/`refund`/`net`/`method`/`balance`).

### Frais Stripe (jamais recalculés)
`Sale.stripeFee` en **centimes**, rempli async par `stripeFeeService`. Statut dérivé :
`not_applicable` (pas de vrai PI / `free_`), `pending` (PI mais `stripeFee===null`), `available`
(`stripeFee/100`). Si `pending` → ligne « Frais Stripe : en attente de synchronisation ».

### Commission Dev — **formations uniquement**
Source `CommissionTransaction` (sourceType `sale`) filtré par `saleId` ; `recordCommissionTransactions`
ne prend que des `formationEntries` → prestation = 0, aucune ligne. Badge « Commission formation » sur la card.

### Profit net estimé
`netProfit = paidAmount − stripeFees(si available) − devCommission − refunds(succeeded)`.
`netProfitStatus` : `complete` (composants connus), `partial` (frais Stripe en attente → non déduits),
`not_applicable` (balance_due, gift_card_usage/issue, commission, invoice).

### Encaissement solde sur place
`ServiceBooking.balancePaymentMethod` (cash/card/other, **additif**) ; `markBalancePaidOnSite` (M11)
accepte désormais un `paymentMethod` optionnel. Aucun Stripe.

### Remboursement
Réutilise la route B1 `POST /api/gestion/refunds/:refundId/status` (RX2.1) → `refundService`
(aucune logique dupliquée). Accepter → `succeeded`, Refuser → `canceled`.

## Frontend (manager)

### api-client `manager/finance.ts`
`getFinanceMovementDetail`, `processRefundStatus(refundId, 'accept'|'refuse', reason)`,
`markBookingBalancePaid(bookingId, method)` + types (`FinanceMovementDetail`, `FinancePaymentBreakdown`,
`FinanceBreakdownLine`, `NetProfitStatus`, `StripeFeesStatus`, `FinanceActionKind`). Aucun calcul côté front.

### `FinanceMovementDrawer` premium (`movementDrawer.tsx`)
Sections : résumé (montant signé + badges) → **Détail du paiement** (`FinancePaymentBreakdownCard`) →
**Profit net estimé** (`FinanceNetProfitCard`, gère « Données partielles ») → **Documents liés**
(`FinanceDocumentLinks`) → footer sticky (`FinanceActionFooter`). Panneaux : `RefundProcessPanel`
(accepter/refuser + motif + confirmation douce + succès) et `BalanceCollectPanel` (CB/espèces/autre +
confirmation + succès). Mutations TanStack → invalidation `['finance']` (refetch timeline + dashboard +
détail). Le montant + les actions s'affichent depuis l'item même si le détail n'est pas encore chargé
(zéro régression RX2.2). Préfixe `fin-md-*`, tokens `--bs-*`, zéro hex, mobile-first, ≥44px, reduced-motion.

### Cards timeline enrichies
Badge « Commission formation » (formations), « À encaisser » (balance_due) ; **max 2 badges** sur la card,
le reste dans le drawer.

## Tests
- Backend (+24) : `financeMovementDetail`, `financeStripeFeesBreakdown`, `financeDevCommissionFormationOnly`,
  `financeNetProfit`, `financeRefundActionRoute`, `financeBalanceCollectRoute`.
- Frontend (+10) : `financeMovementDetailApi`, `financeMovementDrawer`, `financeRefundProcess`,
  `financeBalanceCollect`. React 330 verts, typecheck/lint/build OK.

## Wording (sans jargon)
« Montant payé », « Payé en ligne », « Payé par carte cadeau », « Payé sur place », « Frais Stripe »,
« Commission plateforme », « Remboursé », « Profit net estimé », « Données partielles ».

## Limites V1
- Profit net = estimation **par mouvement**, pas un P&L consolidé (charges fixes hors périmètre → Analytics).
- Frais Stripe `pending` → net `partial` (jamais d'estimation).
- Commission Dev affichée = brute de la vente ; impact d'un remboursement partiel sur la commission montré
  seulement si une `CommissionTransaction:refund_adjustment` existe.
- Cartes cadeaux prépayées / prestations 100 % sur place sans Sale : hors périmètre (Analytics / RX2.4).

## Prochaine mission recommandée
**RX2.4 — Paiements sur place & encaissement (M13 partout)** : représenter les prestations payées
intégralement sur place (réservation manuelle), unifier le pattern d'encaissement, et préparer les
exports comptables (RX2.9). Puis **RX2.5 — Commissions premium** (cards/timeline/facture).
