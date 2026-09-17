# RX2.5 — Commissions premium · Rapport

> Expérience premium des commissions plateforme (commission du mois, détail du calcul + carry-over,
> statut/retards, facture + paiement Stripe Dev hébergé), **sans réinventer le calcul** ni casser le
> système unifié. Audit : [RX2_5_COMMISSION_PREMIUM_AUDIT.md](RX2_5_COMMISSION_PREMIUM_AUDIT.md).

## Réutilisation (zéro régression métier)
Le calcul reste 100 % `commissionPaymentService` : commission = **formations uniquement**
(`Sale.commissionAmount>0`), remboursement = déduction proportionnelle, carry-over négatif reporté,
`getOrComputeCommissionPayment` idempotent (verrouille un mois payé). RX2.5 **n'a pas touché le moteur** :
il ajoute une couche lecture/termes par-dessus.

## Backend
- **Termes de paiement** : `CommissionSettings` étendu (`gracePeriodDays`, `blockingMode`
  `none|warning_only|block_purchases|block_manager`, `suspensionWarningAfterDays`). `latePaymentDays`
  conservé = délai de paiement. PATCH `/api/commissions/settings` (dev) accepte les nouveaux champs.
- **`services/finance/commissionFinanceService.js`** : `resolveCommissionPaymentTerms` (hook override
  contrat documenté), `computeCommissionDueDates` (availability = 1er du mois suivant, dueAt = +délai,
  graceEndsAt = +grace), `resolveCommissionLateStatus`
  (`pending_due|due|grace|overdue|suspension_risk|paid|settled_zero`), `buildCommissionBreakdown`
  (Formations vendues / Remboursements / Report précédent / À payer + report négatif),
  `getCurrentCommissionOverview` / `getCommissionPaymentDetail` / `getCommissionPaymentHistory`.
- **Snapshot** : champs additifs nullables sur `CommissionPayment` (`dueAt`, `graceEndsAt`,
  `paymentTermsSnapshot`) **lazy-persistés uniquement par le service finance** (moteur intact).
- **Routes lecture** : `GET /api/gestion/finance/commissions/current|/history|/:year/:month` (admin/dev,
  respectent la date simulée via `getNow`). **Paiement réutilisé** : `POST /api/commissions/payments/:id/
  create-intent` (Stripe Dev **hébergé** U3 → `{mode:'hosted', url}` ; `settledZero` si 0 €).
- **Timeline** : le mouvement `commission` enrichi (badge À payer/Payée + action `commission_view` →
  `/finance/commissions/:year/:month`). **Pas de nouveaux types** → pas de double-count (commission comptée
  une seule fois en sortie). Carry-over reste dans le détail.

## Frontend (manager)
- api-client `manager/commissionFinance.ts` : `getCommissionOverview/History/Detail`,
  `createCommissionPaymentIntent`, `checkCommissionPaymentStatus` + types.
- Feature `features/finance/` (préfixe `fin-comm-*`, tokens `--bs-*`, zéro hex, mobile-first, ≥44px) :
  - **CommissionOverviewPage** (`/finance/commissions`, nav « Commissions ») : `CommissionCurrentCard`
    (« Commission ce mois · 1 340 € · À payer avant le … · Voir détail · Payer »), `CommissionSettingsPreview`,
    `CommissionHistoryList` (cards).
  - **CommissionDetailPage** (`/finance/commissions/:year/:month`) : `CommissionBreakdownCard`
    (carry-over visible), `CommissionPaymentStatusCard`, `CommissionInvoiceCard`, `CommissionPaymentAction`.
  - `CommissionLateStatusBadge`, `CommissionPaymentAction` (paiement hébergé : redirection si `url`,
    « Aucune commission à payer » si `settledZero`).
- Lien depuis le Finance Dashboard + la timeline (drawer « Voir la commission »).

## Délais / retards / blocages (décision)
- Source = **`CommissionSettings`** (dev-only). Resolver `resolveCommissionPaymentTerms` ; override contrat =
  hook documenté (le `Contract` n'a pas de champs de termes → non inventés).
- `lateStatus` = affichage + alerte. **Blocage V1 = `none`/`warning_only` only** ; aucune suspension
  automatique agressive (réservée à un audit juridique/produit).

## Notifications (parité)
Les relances existantes (`commissionReminderJob` : available/reminder/lastDay, idempotentes, respectent la
date simulée) sont **conservées telles quelles**. RX2.5 **n'envoie aucun nouveau mail** ; `lateStatus` est
purement informatif. Events `commission.due_soon/overdue/grace` = futur si besoin (avec idempotence).

## Tests
- Backend (+34) : `commissionPaymentTerms`, `commissionLateStatus`, `commissionFinanceOverview`,
  `commissionFormationOnlyRegression`, `commissionFinanceTimeline`, `commissionStripeDevHostedPayment`.
- Frontend (+13) : `commissionFinanceApi`, `commissionOverview`, `commissionDetail`, `commissionTimeline`.
- Tout vert : backend (suite complète) + audits 36/20, react 342, typecheck/lint/build OK.

## Limites V1
- Paiement React = hébergé U3 (flag ON) ; flag OFF → message « paiement hébergé indisponible » (Elements
  reste Vanilla). Pas de Stripe.js React.
- Pas de blocage automatique du site/achats (statut/alertes only).
- Override contrat des termes non implémenté (hook documenté) ; branding facture (`CommissionInvoiceSettings`)
  hors périmètre ; édition dev des termes reste Vanilla (preview read-only en React).

## Prochaine mission recommandée
**RX2.6 — Cartes cadeaux timeline & cycle de vie** (Phase 8 de l'EPIC) : timeline Créée → Offerte → Utilisée →
Débit manuel → Expiration → Solde à partir du ledger `GiftCardTransaction` ; puis **RX2.7 Customer360 Finance**.
