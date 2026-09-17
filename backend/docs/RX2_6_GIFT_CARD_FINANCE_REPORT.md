# RX2.6 — Gift Card Finance Timeline · Rapport

> La carte cadeau comme **cycle de vie financier complet** (créée → offerte → utilisée → débit manuel →
> solde → transactions → source paiement → acheteur/bénéficiaire → sur place/Stripe → QR → remboursements
> splittés). **Aucune mention d'expiration dans l'UI** ; jamais le code/secret complet ; QR = token opaque.
> Audit : [RX2_6_GIFT_CARD_FINANCE_AUDIT.md](RX2_6_GIFT_CARD_FINANCE_AUDIT.md).

## Backend — `services/finance/giftCardFinanceService.js`
- `listGiftCardFinanceCards(filters)` → `{ summary, cards }` (code masqué `••••XXXX`). Summary :
  `activeBalanceAmount`, `issuedAmount`, `usedAmount` (redeem), `manualDebitAmount`, `count`.
- `getGiftCardFinanceDetail(giftCardId)` → `{ giftCard, actors, paymentSource, currentBalance, lifecycle,
  transactions, refunds, qr, actions }`.
- `resolveGiftCardPaymentSource` (stripe/on_site/unknown + facture Stripe si `saleId`),
  `resolveGiftCardActors` (acheteur = `purchaserName`/`Sale.customer` ; bénéficiaire = `recipientName`/owner),
  `mapGiftCardTransaction`, `mapGiftCardRefund`, `buildGiftCardLifecycle`, `buildGiftCardTransactionTimeline`,
  `buildGiftCardRefundTimeline`.
- **Lifecycle** (chronologique) : `created` (sur place/en ligne), `offered` (si bénéficiaire), `qr_generated`,
  `pdf_generated`, `used`, `manual_debit`, `refund_recredit`, `rollback_needed` (anomalie **danger**),
  `refund_recredit_failed`.
- **Remboursements splittés** : lien carte ↔ refund via `Sale.giftCardUsage.giftCardId` + `saleId` des `credit` ;
  parts Stripe/carte cadeau, `giftCardRefundStatus` (`succeeded`/`pending`/`failed`/**`rollback_needed`**),
  `recovered` = `giftCardRecredited && attempts>1`.
- **QR/privacy** : `qr.available` + `maskedToken:'••••'` ; jamais le token/hash/code/mot de passe.
- Endpoints : `GET /api/gestion/finance/gift-cards` et `/:giftCardId` (admin/dev).

## Intégration Finance Timeline (RX2.2)
Ajout : `gift_card_refund_recredit` (tx `credit`, **neutral**) et `gift_card_recredit_failed`
(refund `rollback_needed`, **neutral**, badge danger). Les mouvements carte cadeau portent une action
`gift_card_view` → `/finance/cartes-cadeaux/:giftCardId`. **Anti-double-count** : émission manuelle = `in`,
usage/recrédit = `neutral`, achat en ligne = déjà un `Sale`. Testé (`grossIn`/`grossOut` inchangés).

## Frontend (manager)
- api-client `finance.ts` : `listFinanceGiftCards`, `getFinanceGiftCardDetail` + types
  (`FinanceGiftCardSummary`, `FinanceGiftCardDetail`, `GiftCardLifecycleItem`, `GiftCardPaymentSource`,
  `GiftCardFinanceTransaction`, `GiftCardRefundTimelineItem`).
- `features/finance/` (préfixe `fin-gc-*`, tokens `--bs-*`, zéro hex, mobile-first, ≥44px) :
  - **FinanceGiftCardsPage** (`/finance/cartes-cadeaux`) : résumé sticky, filtres circuit/statut, liste en cards
    (code masqué, badges Active/Épuisée + Stripe/Paiement sur place).
  - **GiftCardFinanceDetailPage** (`/finance/cartes-cadeaux/:giftCardId`) : solde très visible,
    acheteur/bénéficiaire (liens Customer360), source de paiement, **QR masqué**, cycle de vie (timeline),
    remboursements splittés (parts Stripe/carte cadeau, anomalies rollback), transactions, actions.
- Lien depuis le Finance Dashboard + la timeline (drawer « Voir la carte cadeau »).

## Tests
- Backend (+17) : `financeGiftCardService`, `financeGiftCardRoutes`, `financeGiftCardSplitRefund`,
  `financeGiftCardQrPrivacy` (code/token/mot de passe jamais exposés + **aucun libellé « expir »**),
  `financeGiftCardTimelineIntegration`.
- Frontend (+7) : `financeGiftCardsApi`, `financeGiftCardsPage`, `financeGiftCardDrawer`,
  **`financeGiftCardNoExpiration`** (le DOM ne contient jamais « expir »).
- Tout vert : backend (suite complète) + audits 36/20, react 349, typecheck/lint/build OK.

## Limites V1
- **Aucune expiration** (UI ni libellés) — règle produit.
- `email_sent` non tracé de façon fiable par carte → omis du lifecycle (documenté, pas inventé).
- `qr_generated`/`pdf_generated` datés à `purchasedAt`. `recovered` = heuristique (`attempts>1`).
- « Débiter via QR » = lien vers le Customer360 du propriétaire (le flux M13 y vit) ; pas de caméra ici.

## Prochaine mission recommandée
**RX2.7 — Customer360 Finance** (Phase 7) : vraie section « Finance » narrative dans la fiche client
(agrège ventes/acomptes/soldes/cartes cadeaux/remboursements/factures/commission côté client), en réutilisant
les briques RX2.1→2.6. Puis **RX2.8 Analytics** (cards/graphes lisibles) et **RX2.9 Exports + Avoirs**.
