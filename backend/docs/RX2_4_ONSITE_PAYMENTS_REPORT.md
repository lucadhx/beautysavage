# RX2.4 — Paiements sur place unifiés & encaissement prestations manuelles · Rapport

> Ferme le trou RX2.3 : les **prestations payées intégralement sur place** (réservation manuelle, sans
> `Sale`) sont désormais représentées ET encaissables, avec un pattern « sur place » unifié partout.
> Audit : [RX2_4_ONSITE_PAYMENTS_AUDIT.md](RX2_4_ONSITE_PAYMENTS_AUDIT.md).

## Constat (vérifié)
Une réservation manuelle full on-site est créée avec `paymentType:'full'`, `paymentMode:'on_site'`,
`paymentStatus:'pending'`, `balanceDueAmount = totalPrice`, `balanceSettlementMode:'pay_on_site'`, **sans Sale**.
Trois incohérences : (G1) `markBalancePaidOnSite` rejetait tout sauf `deposit` → non encaissable ;
(G2) le dashboard exigeait `paymentStatus:'deposit_paid'` → manuelles absentes du « à encaisser » ;
(G3) timeline et dashboard utilisaient des filtres différents.

## Changements

### Backend
- **G1 — Encaissement généralisé** : `markBalancePaidOnSite` accepte aussi `paymentType:'full'` quand
  `paymentMode:'on_site'` + `balanceSettlementMode:'pay_on_site'`. Effet inchangé (`balanceDueAmount→0`,
  `paymentStatus:'paid'`, `balancePaidAt`, `balancePaymentMethod`). Aucun Stripe. Rétro-compatible (acomptes online).
- **G2+G3 — Filtre unifié** `ONSITE_DUE_BOOKING_FILTER` (exporté par `financeTimelineService`, importé par
  `financeService`) : `{ balanceDueAmount:{$gt:0}, balanceSettlementMode:'pay_on_site', status:{$nin:['cancelled','pending_payment']} }`.
  Utilisé par la timeline ET le dashboard → cohérence parfaite. `paymentStatus` n'est plus un critère.
- **Wording adaptatif** (`mapBookingBalanceToFinanceMovement`) : `paymentType:'full'` →
  « Paiement sur place à encaisser / encaissé » ; sinon « Solde à encaisser / encaissé ». Badges « Sur place »,
  « Réservation manuelle », « À encaisser ». Le détail mouvement (`financeMovementDetailService`) suit le même wording.

### Frontend (manager)
- `BalanceCollectPanel` : titre/labels adaptatifs (« Encaisser le paiement sur place » vs « Encaisser le solde »).
- Footer du drawer : CTA unifié « Encaisser sur place ». Dashboard : carte « À encaisser sur place ».
- Aucune logique de montant côté front ; tokens `--bs-*`, zéro hex, mobile-first.

## Représentation
| Booking | Mouvement | direction | amount | net |
|---|---|---|---|---|
| Manuelle full on-site, non encaissée | `balance_due` « Paiement sur place à encaisser » | neutral | `totalPrice` | not_applicable |
| Manuelle full on-site, encaissée | `balance_paid` « Paiement sur place encaissé » | in | `totalPrice` | complete |
| Acompte online, solde dû / encaissé | `balance_due` / `balance_paid` « Solde … » | neutral / in | `balanceDueAmount` / `totalPrice−depositAmount` | not_applicable / complete |

## Tests
- Backend (+9) : `financeOnSitePayments` (wording mapper, timeline inclut manuelle full + exclut annulée,
  dashboard compte les manuelles) + `financeBalanceCollectRoute` (encaissement full on-site).
- Frontend (+1) : panneau wording full on-site.
- Tout vert : backend (suite complète) + audits 36/20, react 331, typecheck/lint/build OK.

## Limites V1
- Acompte d'une réservation **manuelle** non tracé séparément (cas usuel = full on-site sans acompte).
- Toujours pas de `Sale` pour les bookings manuels (volontaire) — la finance les lit via `ServiceBooking`.
- Exports comptables = RX2.9.

## Prochaine mission recommandée
**RX2.5 — Commissions premium** : card « Commission ce mois », timeline, détail du calcul (carry-over
visible), facture + paiement, en cards (créer `models/CommissionInvoiceSettings.js` si branding facture, cf. B2).
