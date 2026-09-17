# RX2.3 — Paiements, Remboursements 1-clic, Commissions & Profit Net · Audit

> Objectif : détail financier d'un mouvement (breakdown paiement + **profit net estimé**) et actions
> interactives dans le `FinanceMovementDrawer` (remboursement 1-clic, encaissement solde sur place).
> Règle d'or : **aucun montant inventé**. Si un frais Stripe n'est pas connu → « non encore disponible »,
> jamais d'estimation. Ne pas confondre CA / encaissement / trésorerie / **profit net**.

Prolonge [RX2_FINANCIAL_TIMELINE_AUDIT.md](RX2_FINANCIAL_TIMELINE_AUDIT.md) (RX2.2).

---

## 1. Sources de vérité (vérifiées dans le code)

### Frais Stripe — `Sale.stripeFee` / `Sale.stripeNet`
- **Stockés en CENTIMES** (issus de Stripe `balanceTransaction.fee`/`net`). Conversion € = `/100`.
- Remplis **de façon asynchrone** par `services/stripe/stripeFeeService.recoverStripeFeesAndUpdateSale`
  (webhook + job de relance). `stripeFee = null` tant que non synchronisé.
- 0 € « free » : `stripePaymentIntentId` préfixé `free_` → **aucune charge Stripe** (exclu du sweep).
- **`stripeFeesStatus`** dérivé (jamais recalculé par formule) :
  - `not_applicable` : pas de vrai PI (null / vide / `free_`) → paiement sur place ou carte cadeau only.
  - `pending` : vrai PI mais `stripeFee === null` → « Frais Stripe : en attente de synchronisation ».
  - `available` : `stripeFee` est un nombre → montant € = `stripeFee/100`.

### Commission Dev — **formations uniquement** (vérifié)
- `services/commissionService.recordCommissionTransactions({ saleId, formationEntries })` ne prend QUE des
  `formationEntries` ; appelé depuis `checkoutFinalizationService`/`clientController` à partir des items
  `type==='formation'` (`buildFormationEntryFromSale`). **Aucune commission sur prestation/produit/carte.**
- `Sale.commissionAmount` = somme des `CommissionTransaction.commissionAmount` de la vente
  (`checkoutPersistenceService`), 0 pour une vente sans formation.
- **Source retenue pour le détail** : `CommissionTransaction` (sourceType `sale`) filtré par `saleId`
  → formation-only par construction, robuste, traçable (formationId/formationName).
- Remboursement formation : `CommissionTransaction` sourceType `refund_adjustment` (montant négatif) +
  `commissionPaymentService.computeCommissionsForPeriod` (déduction proportionnelle). Impact affiché si dispo.

### Remboursements — `RefundRequest`
- Lié à la vente par `saleId`. `amount` (€), `status` (succeeded=remboursé). Split
  `stripeRefundAmount`/`giftCardRefundAmount`, avoir `creditNotePdfUrl`.
- Pour le net d'une vente : Σ `RefundRequest.amount` où `saleId == sale.saleId` ET `status==='succeeded'`.

### Formation vs prestation — `Sale.items[].type`
- `service` = prestation (pas de commission Dev), `formation` = formation (commission Dev), `gift-card`,
  `product`. Une vente peut être mixte ; la commission ne porte que sur les items formation.

### Moyen de paiement — `Sale.pricingSnapshot` / `giftCardUsage`
- `stripePaymentAmount` (cash en ligne), `giftCardPaymentAmount` (carte cadeau = **moyen de paiement**,
  pas remise), `Sale.totalAmount` = montant catalogue complet payé. Paiement sur place = `ServiceBooking`
  (`balancePaidAt`, `paymentMode='on_site'`) ou `GiftCardTransaction:manual_issued`.

### Encaissement solde — `POST /api/gestion/bookings/:bookingId/balance-paid`
- Existant (M11/D3) : `balanceDueAmount→0`, `paymentStatus='paid'`, `balancePaidAt=now`, idempotent,
  émet `booking.balance_paid_on_site`. **N'enregistrait pas le moyen de paiement** → RX2.3 ajoute le champ
  additif `ServiceBooking.balancePaymentMethod` (cash/card/other, optionnel) renseigné depuis le drawer.

---

## 2. Profit net estimé (définition RX2.3)

```
profit net = montant payé − frais Stripe − commission Dev (si formation) − remboursements
```
- `paidAmount` = `Sale.totalAmount` (ou solde encaissé pour balance_paid).
- `stripeFeesAmount` soustrait **seulement si** `stripeFeesStatus==='available'`.
- `devCommissionAmount` = Σ `CommissionTransaction(sale)` (0 pour prestation).
- `refundAmount` = Σ refunds `succeeded` de la vente.
- **`netProfitStatus`** :
  - `complete` : tous les composants connus (sur place sans Stripe, OU en ligne avec frais disponibles).
  - `partial` : vente en ligne dont `stripeFeesStatus==='pending'` (frais pas encore synchronisés).
  - `not_applicable` : mouvement sans profit propre (balance_due, gift_card_usage/manual_debit,
    gift_card_issue, commission, invoice).

---

## 3. Quelles ventes ont un profit net fiable ?

| Cas | stripeFees | devCommission | netProfitStatus |
|---|---|---|---|
| Vente en ligne, frais synchronisés | available | selon formation | **complete** |
| Vente en ligne, frais en attente | pending | selon formation | **partial** |
| Paiement sur place (solde encaissé) | not_applicable | 0 (prestation) | **complete** |
| Carte cadeau utilisée / émise / débit | not_applicable | — | **not_applicable** |
| Solde à encaisser (non payé) | — | — | **not_applicable** |
| Remboursement / commission / facture | — | — | **not_applicable** |

---

## 4. Actions interactives (drawer)

- **`refund_process`** → `POST /api/gestion/refunds/:refundId/status` (route B1, RX2.1). Accepter →
  `status='succeeded'` (déclenche `triggerRefundExecution` via `refundService`, NE PAS dupliquer la logique),
  Refuser → `status='canceled'`. Champ note/motif transmis en `reason`.
- **`balance_collect`** → `POST /api/gestion/bookings/:bookingId/balance-paid` (M11), + `paymentMethod`
  (cash/card/other) additif. Aucun Stripe (paiement sur place).
- Après succès : refetch timeline + dashboard + detail.

---

## 5. Endpoint détail

`GET /api/gestion/finance/movement-detail?sourceModel=&sourceId=&type=` — admin/dev. Charge la source par
(`sourceModel`,`sourceId`), renvoie `{ movement, paymentBreakdown, lines, actions }`. Aucun calcul de montant
côté front. `movementId` du timeline (`sale:<saleId>`…) est dérivé de la source → on passe `sourceModel`+
`sourceId`+`type` (stables) plutôt qu'un id DB opaque.

---

## 6. Limites V1 (assumées, documentées)

- Profit net = estimation **par mouvement**, pas un résultat comptable consolidé (pas de charges fixes,
  loyers, salaires…). Vue P&L globale = ultérieur (Analytics Phase 9).
- Frais Stripe `pending` → net `partial` tant que le job de synchro n'a pas tourné (jamais d'estimation).
- Commission Dev affichée = brute de la vente ; l'impact d'un remboursement partiel sur la commission est
  affiché si une `CommissionTransaction:refund_adjustment` existe, sinon omis (pas inventé).
- Carte cadeau prépayée : profit reconnu à l'usage non modélisé en V1 (gift_card_issue = not_applicable).
- Prestations 100 % payées sur place sans `Sale` ni `balancePaidAt` : hors périmètre (RX2.4).
