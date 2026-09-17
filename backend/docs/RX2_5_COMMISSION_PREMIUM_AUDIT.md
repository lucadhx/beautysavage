# RX2.5 — Commissions premium · Audit

> Objectif : expérience premium des commissions plateforme (commission du mois, détail du calcul,
> carry-over, statut/retards, facture + paiement Stripe Dev hébergé), **sans réinventer le calcul** ni
> casser le système unifié. Règle d'or : aucun montant inventé, formation-only inchangé.

Prolonge le mega-audit RX2 (commissions) + [RX2_FINANCE_AUDIT.md](RX2_FINANCE_AUDIT.md).

---

## 1. Comment une commission est calculée (vérifié)

- **Formations UNIQUEMENT** : `Sale.commissionAmount > 0` (rempli par `recordCommissionTransactions`
  à partir des items `formation` ; prestation/produit/carte = 0). `computeCommissionsForPeriod` somme les
  ventes de la période avec commission > 0.
- **Remboursement = déduction** proportionnelle (`refundAmount/totalAmount × commissionAmount`), tous moyens
  (Stripe + carte cadeau), à la date de règlement réelle.
- **Carry-over** mensuel (`buildMonthlyComputation`) :
  `netAmountDue = max(0, gross − refundDeduction − carryOverIn)` ;
  `negativeCarryOver = max(0, refundDeduction + carryOverIn − gross)` (déficit reporté au mois suivant).
- `getOrComputeCommissionPayment(month, year)` : crée/rafraîchit le `CommissionPayment` (idempotent ;
  **verrouille un mois `settledReason:'paid'`**). `netAmountDue ≤ 0` → `status:'succeeded'`, `settledReason:'settled_zero'`.
- Carte cadeau = moyen de paiement (déjà dans `Sale.totalAmount`), pas une remise.

## 2. Comment elle est payée / facturée (vérifié)

- `POST /api/commissions/payments/:id/create-intent` (admin+dev) : **refresh obligatoire**, puis
  - `netAmountDue ≤ 0` → `{ ok, settledZero:true }` (aucun paiement) ;
  - **flag U3 `isPlatformCheckoutHostedEnabled()` ON** → Stripe Dev **Checkout HÉBERGÉ** → `{ ok, mode:'hosted', url }` ;
  - sinon → PaymentIntent direct (`clientSecret`) — Elements (Vanilla).
- Finalisation : `finalizeCommissionPaymentById` (webhook Dev `payment_intent.succeeded` + polling
  `check-status`), idempotent → `settledReason:'paid'`, `paidAt`, émet `commission.paid`, génère la
  **facture Stripe Dev** (`stripeInvoicePdfUrl`).
- `GET /api/commissions/payments` (admin+dev) : tous les mois depuis `Contract.activatedAt`
  (`getMonthsFromContractStart`, séquentiel pour le carry-over). **404 si aucun contrat actif.**

## 3. Retards / délais / blocages existants

- `CommissionSettings` (singleton) : `latePaymentDays` (défaut 15), `reminders[]` (jours avant échéance),
  `simulatedDate` (dev). **Pas de grace period, pas de blocage configurable.**
- `automatisme/commissionReminderJob.js` (quotidien 08h, respecte `simulatedDate`) : 3 mails idempotents
  — `available` (1er du mois suivant), `reminder` (J−X configurés), `lastDay` (= échéance). Marqueurs
  `availableMailSentAt`/`reminderMailsSentDays[]`/`lastDayMailSentAt`.
- **Aucun blocage automatique** du site/achats lié aux commissions aujourd'hui (la suspension existante
  dépend du **contrat** `no_contract/pending`, pas des impayés de commission).
- Date d'échéance = `1er du mois suivant + latePaymentDays`. Pas de statut « overdue/grace » exposé.

## 4. Règles hardcodées / à rendre configurables

| Aujourd'hui | RX2.5 |
|---|---|
| `latePaymentDays` (configurable, dev) | conservé = `paymentDueDays` |
| `reminders[]` (configurable, dev) | conservé |
| Grace period : **absente** | + `gracePeriodDays` (CommissionSettings, défaut 0) |
| Blocage : **absent** | + `blockingMode` (`none`/`warning_only`/`block_purchases`/`block_manager`, défaut **none**) + `suspensionWarningAfterDays` (display only) |
| `Contract.commissions {type,value}` : **dead code** (calcul utilise `CommissionConfig` global) | non touché ; hook resolver documenté |

## 5. Décision produit (Part 2/3)

- **Source de config = `CommissionSettings`** (dev-only, déjà l'endroit des délais/relances). On l'étend
  (`gracePeriodDays`, `blockingMode`, `suspensionWarningAfterDays`) plutôt que créer un nouveau modèle.
  `models/CommissionInvoiceSettings.js` (B2, dead code) **reste hors périmètre** (branding facture = futur).
- **Resolver** `resolveCommissionPaymentTerms(settings, contract)` : défauts settings ; **hook** d'override
  contrat documenté (le `Contract` n'a pas encore de champs de termes → pas inventés).
- **Dates & statut calculés** : `availabilityAt = periodEnd` (1er du mois suivant), `dueAt = availabilityAt +
  paymentDueDays`, `graceEndsAt = dueAt + gracePeriodDays`.
  `lateStatus` ∈ `pending_due | due | grace | overdue | suspension_risk | paid | settled_zero`.
- **Snapshot** : champs additifs nullables sur `CommissionPayment` (`dueAt`, `graceEndsAt`,
  `paymentTermsSnapshot`) **lazy-persistés uniquement par le service finance** (jamais par le moteur
  `commissionPaymentService`) → snapshot durable au 1er affichage, **moteur unifié intact**.
- **Blocage** : V1 = `none`/`warning_only` (statut + alertes only). **Aucune suspension automatique
  agressive** (réservée à un audit juridique/produit).
- **Notifications** : on **réutilise** le job de relances existant (parité) ; RX2.5 **n'envoie aucun
  nouveau mail** (lateStatus = affichage). Events `commission.due_soon/overdue/grace` = futur si besoin.

## 6. Intégration finance (RX2.1→2.4)

- Le mouvement `commission` existe déjà dans la timeline (RX2.2, `direction:'out'`, `amount:netAmountDue`,
  émis si > 0). RX2.5 : **enrichit le badge** (Payée/À payer) et **active `commission_view`** → ouvre
  `/finance/commissions/:year/:month`. **Pas de nouveaux types de mouvement** (évite double-count et churn :
  la commission est déjà comptée une fois en sortie). Le carry-over reste **dans le détail**, pas une ligne.

## 7. Routes

- **Lecture premium (NEW)** : `GET /api/gestion/finance/commissions/current|/history|/:year/:month` (admin+dev,
  financeRouter).
- **Paiement (réutilisé)** : `POST /api/commissions/payments/:id/create-intent` (hosted U3),
  `GET /api/commissions/payments/:id/check-status`.
- **Settings (étendu)** : `PATCH /api/commissions/settings` (dev) accepte `gracePeriodDays`/`blockingMode`/
  `suspensionWarningAfterDays`.

## 8. Limites V1

- Paiement React = **hébergé U3 uniquement** (flag ON) ; flag OFF → message « paiement hébergé indisponible »
  (Elements reste Vanilla). Pas de Stripe.js React.
- Pas de blocage automatique du site/achats (statut/alertes only).
- `Contract.commissions`/override contrat non implémenté (hook documenté).
- Branding facture (`CommissionInvoiceSettings`) hors périmètre.
- UI dev d'édition des termes = **preview read-only** en React (édition reste Vanilla `Réglages`) ; édition
  React = futur.
