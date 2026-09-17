# RX2.2 — Financial Timeline Premium · Rapport

> Colonne vertébrale narrative de la finance BeautySavage. Cards/drawer, jamais de table, mobile = desktop.
> Vertical complet : backend + api-client + React + tests + docs. Audit : [RX2_FINANCIAL_TIMELINE_AUDIT.md](RX2_FINANCIAL_TIMELINE_AUDIT.md).

## Sources de vérité (aucun montant inventé)

| `type` | Source | `direction` | `amount` | compté |
|---|---|---|---|---|
| `sale` / `deposit` | `Sale` (deposit = Sale liée à booking `paymentType=deposit`) | in | `totalAmount` | grossIn |
| `balance_due` | `ServiceBooking.balanceDueAmount>0` | neutral | `balanceDueAmount` | balanceDueAmount |
| `balance_paid` | `ServiceBooking.balancePaidAt` | in | `totalPrice − depositAmount` | grossIn |
| `refund` | `RefundRequest` | out | `amount` | grossOut |
| `gift_card_issue` | `GiftCardTransaction:manual_issued` | in | `amount` | grossIn |
| `gift_card_usage` / `gift_card_manual_debit` | `GiftCardTransaction:redeem/manual_debit` | neutral | `amount` | exclu |
| `commission` | `CommissionPayment` (`netAmountDue`) | out | `netAmountDue` | grossOut |
| `invoice` | `Invoice:official` (filtre explicite seulement) | neutral | `totalAmount` | exclu |

## Summary (recalculé par filtres)
`netAmount = grossIn − grossOut` ; `grossIn`/`grossOut` (Σ par direction) ; `balanceDueAmount` ; `count` ;
`refundCount`. Calculé sur **tout** l'ensemble filtré (avant `limit`).

## No double-count (testé `financeTimelineNoDoubleCount`)
1. **Facture ≠ ligne par défaut** : lien `invoice_view` sur la vente ; ligne `invoice` uniquement si
   `type=invoice`, et `neutral` → `netAmount` invariant.
2. **Carte cadeau utilisée = moyen de paiement** (déjà dans `Sale.totalAmount`) → `neutral`.
3. **`gift_card_issue` = cartes MANUELLES seules** (les cartes en ligne sont déjà des `Sale`).
4. **Acompte + solde = total** sans double-count.
5. **Commission = `CommissionPayment`** (billing plateforme), pas `CommissionTransaction` (accruals).

## Endpoint
`GET /api/gestion/finance/timeline?period=today|week|month|all&type=&status=&limit=` — admin/dev
(`financeRouter`, monté avant les broad-mounts dev-only). Retour `{ ok, summary, items }`.

## React (`features/finance/`)
`FinanceTimelinePage` (route `/finance/timeline`, lien depuis le dashboard) : résumé sticky
(`FinanceTimelineSummary`), chips période + type (`FinancePeriodChips`/`FinanceTypeChips`), liste de cards
(`FinanceTimelineList`/`FinanceTimelineCard`, ligne verticale subtile desktop), drawer détail
(`FinanceMovementDrawer` : montant/statut/client/origine/actions). Tokens `--bs-*` (préfixe `fin-tl-*`),
zéro hex, ≥44px, reduced-motion. api-client `getFinanceTimeline` + types (`FinanceTimelineItem`/`…Summary`/
`…Filters`/`FinanceMovementType`/`FinanceMovementStatus`).

## Actions structurées (préparent RX2.3)
`customer_view` (→ `/clients/:id`), `invoice_view` (lien PDF), `refund_process` (→ `/remboursements`,
route B1 prête), `balance_collect` (→ `/reservations`), `sale_view`/`commission_view` (`enabled:false`).
Boutons désactivés si la cible n'est pas prête — aucune action profonde implémentée hors RX2.2.

## Tests
- Backend (+21) : `financeTimelineService` (mappers + intégration), `financeTimelineSummary` (computeSummary),
  `financeTimelineNoDoubleCount`, `financeTimelineRoutes` (HTTP, mount-order admin, 403 client).
- Frontend (+9) : `financeTimeline.test.tsx` (summary/chips/cards/drawer/empty/error/actions, pas de table),
  `financeTimelineApi.test.ts`, `noHardcodedHex`.
- Tout vert : backend 794, react 320 ; audits business 36 / commissions 20 ; typecheck/lint/build OK.

## Limites V1 (assumées)
- `netAmount` = flux de **transactions**, pas trésorerie (carte cadeau prépayée comptée à l'émission +
  dans la vente qui la consomme) → vrai rapprochement en **Phase 9 (Analytics)**.
- Prestations 100 % payées sur place (réservation manuelle sans `Sale` ni `balancePaidAt`) non représentées
  → **RX2.4 (paiements sur place)**.
- Split prestations/formations au niveau item (filtre V1 au niveau mouvement) ; frais Stripe non agrégés ici.
- Avoirs = lien sur le mouvement `refund` (section dédiée en RX2.9).

## Prochaine mission recommandée
**RX2.3 — Paiements + drawer remboursement 1-clic** : exploite `refund_process`/`balance_collect` et la
route B1 (`POST /api/gestion/refunds/:id/status`) pour le remboursement (résumé → montant → confirmer)
et l'encaissement de solde, en réutilisant le drawer de la timeline.
