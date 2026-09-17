# RX2 — Finance Experience · Phase 1 Audit

> Objectif RX2 : créer **le meilleur espace financier** pour un institut (inspiration Stripe / Qonto / Pennylane / Revolut / Linear).
> Jamais de gros tableaux Excel : cards, KPIs, timelines, drawers, actions. Mobile = desktop.
> Audit réalisé le 2026-06-30 (6 agents parallèles + vérifications ciblées).

---

## 0. Verdict global

Le **backend finance est riche et déjà presque complet** (11 modèles, ~15 services, 8 contrôleurs). Le **frontend finance n'existe quasiment pas en React** : tout vit en Vanilla (`salesModule`, `commissionModule`+`commissionPaymentModule`, `invoiceModule`, `refundTrackingModule`, 5 modules gift-card). Les routes React `ventes`, `remboursements`, `commissions`, `parametres` sont des **placeholders vides** (`App.tsx:95-98`).

**RX2 = construire la couche React finance premium par-dessus un backend déjà solide**, en réutilisant le toolkit Customer360 (`c3-*` : cards, timeline, drawer bottom-sheet, KPIs, helpers `money()`/`fmtDate()`).

Maturité par domaine :

| Domaine | Backend | Vanilla | React | Verdict |
|---|---|---|---|---|
| Ventes / acomptes / soldes | ✅ riche | ⚠️ stats+liste, pas d'encaissement | ❌ placeholder | **React à créer** |
| Paiements sur place (M13) | ✅ complet (ServiceBooking) | ❌ | ⚠️ drawers création seulement | **Dashboard encaissement manquant** |
| Remboursements | ✅ moteur split+recovery | ⚠️ lecture seule | ❌ (Customer360 lecture) | **Action admin impossible (route manquante)** |
| Commissions | ✅ très complet | ✅ 2 modules complets | ❌ | **React à créer + simplifier UX** |
| Cartes cadeaux | ✅ riche + ledger | ✅ 5 modules | ⚠️ templates/librairie seulement | **Timeline + 360 manquants** |
| Factures | ✅ interne + Stripe | ⚠️ download public | ⚠️ Customer360 docs | **Liste + envoi manquants** |
| Avoirs | ✅ Stripe credit notes | ❌ | ⚠️ Customer360 docs | **Existe mais caché, error-silent** |
| Exports comptables | ❌ **rien** | ❌ | ❌ | **À créer entièrement** |
| Analytics | ⚠️ stats brutes | ⚠️ 1 graph | ❌ | **À créer** |

---

## 1. VENTES / ACOMPTES / SOLDES / PAIEMENTS SUR PLACE

### Backend (solide)
- **`Sale`** : `totalAmount` (= acompte si deposit, sinon total), `items[]`, `giftCardUsage[]`, `pricingSnapshot` (catalogAmount, soldAmount, giftCardPaymentAmount, stripePaymentAmount, commissionBaseAmount, refundableAmount), `taxSnapshot` (franchise 293B, TVA 0%), `stripeFee`/`stripeNet`.
- **`ServiceBooking`** (cœur M13 sur place) : `paymentType` full/deposit/free · `paymentStatus` pending/deposit_paid/paid/refunded/cancelled · `depositAmount` · `balanceDueAmount` · `balanceSettlementMode` none/pay_on_site · `balancePaidAt` · `source` online/manual_institute · `paymentMode` stripe/on_site · `manualPaymentMethod` cash/card/other · `createdByAdminId` · `manualNote`.
- **`Service`** : `paymentType`, `depositType` percentage/fixed, `depositValue`, `balanceSettlementMode`.
- Endpoints clés :
  - `GET /api/gestion/sales/stats` · `GET /api/gestion/sales` · `GET /api/gestion/sales/:saleId/invoice` · `GET /api/gestion/sales/:saleId/service-booking` · `GET /api/gestion/carts`
  - **M13** : `POST /api/gestion/bookings/manual` · `POST /api/gestion/bookings/hold` (+`/release`) · `POST /api/gestion/bookings/:id/balance-paid` (idempotent, émet `booking.balance_paid_on_site`)
  - **M13 GC** : `POST /api/gestion/gift-cards/manual` · `/lookup-qr` · `/:id/manual-debit`

### React aujourd'hui
- `m13Drawers.tsx` (dans customer360) : **CreateGiftCardDrawer, GiftCardDebitDrawer, ManualBookingDrawer, CustomerNoteDrawer** → création/débit sur place ✅, mais **rien pour encaisser un solde / voir les soldes dus**.

### Gaps
1. Pas de **dashboard d'encaissement sur place** (soldes dus, encaissés aujourd'hui, en attente depuis X jours).
2. Pas de bouton React « solde réglé » (l'endpoint `balance-paid` existe pourtant).
3. `manualPaymentMethod` ne capture que cash/card/other à la création, **pas** la méthode au moment de l'encaissement du solde.
4. Pas de reporting revenu par méthode (Stripe vs espèces vs CB).

### Incohérences / dette
- **`balanceSettlementMode` peut valoir `none` alors que `paymentType=deposit`** → acompte encaissé mais solde non réglable (`balance-paid` renvoie 409). À valider à la création du Service.
- `Sale.totalAmount = depositAmount` mais `pricingSnapshot.soldAmount = totalPrice` → ambiguïté base commission (acompte ou total ?). À clarifier/tester.
- `ServiceBooking.totalSoldAmount` défini mais mis à 0 pour les bookings manuels — sémantique floue.

---

## 2. REMBOURSEMENTS

### Backend (moteur mûr)
- **`RefundRequest`** : `status` requested/pending/succeeded/failed/canceled · split `stripeRefundStatus` + `giftCardRefundStatus` (+`rollback_needed`) · `stripeRefundAmount`/`giftCardRefundAmount` · `trackingToken` (30j) · `creditNoteId`/`creditNotePdfUrl` (avoir) · `eligibleRefund` · `meta.notes`.
- Index unique partiel anti-doublon `(saleId,itemId,itemType)` sur statuts actifs.
- Services : `refundService` (éligibilité présentiel 14j/institut, distanciel post-accès, service), `refundExecutionService` (split Stripe+GC, idempotency key), `refundRequestService` (cap, claim recredit atomique), `refundGiftCardService` (recredit proratisé), `refundRecoveryService` + `giftCardRecreditRecoveryService` (jobs horaires).
- Provision commission au remboursement (`CommissionTransaction sourceType=refund_adjustment`).

### Gaps & BUG confirmé
- **🔴 `updateRefundStatus()` (salesController.js:504) N'EST PAS monté dans `salesRouter.js`** (seul `GET /refunds` existe). **Vérifié.** → aucun admin ne peut valider/refuser un remboursement via l'UI. Manipulation DB requise.
- Aucune UI React de gestion des remboursements (Customer360 = lecture seule).
- Pas de **drawer remboursement 1-clic** (résumé → montant → bouton → confirmation), pas de remboursement partiel exposé (le backend sait le faire via `applyRefundExecutionCap`).
- `rollback_needed` (recredit GC échoué) non surfacé en UI.
- Recredit multi-cartes : si la 2ᵉ carte échoue, les crédits précédents ne sont pas rollback (medium).

---

## 3. COMMISSIONS

### Backend (très complet)
- Modèles : **`CommissionConfig`** (type/value, isActive soft-delete) · **`CommissionPayment`** (singleton mois : grossCommissionAmount, refundDeductionAmount, carryOver, netAmountDue, status, settledReason paid/settled_zero, stripe*, paidAt, sales[]/refunds[]) · **`CommissionSettings`** (latePaymentDays, reminders[], simulatedDate) · **`CommissionTransaction`** (audit sale/refund_adjustment/refund_reversal) · `Contract.commissions {type,value}`.
- Moteur mensuel `commissionPaymentService` : calcul période → refunds proratisés → **carry-over** (déficit reporté) → `netAmountDue`. `getOrComputeCommissionPayment` (idempotent, verrouille si payé). Paiement Stripe **Developer** (PaymentIntent + hosted U3), anti-double-clic atomique. PDF `commissionPdfService`. Job rappels quotidien 08h (3 mails : available/reminder/lastDay) respectant `simulatedDate`.
- Routes : `/api/gestion/commissions/*` (dev) config+stats+history ; `/api/commissions/payments/*` (admin+dev) liste+intent+status ; `/api/commissions/settings/*` (dev).

### Vanilla aujourd'hui
- `commissionModule.js` : 3 onglets (Dashboard graph+transactions / Configuration / Historique).
- `commissionPaymentModule.js` : timeline de cards mensuelles (états unavailable/available/warning/late/paid, countdown, kebab PDF + simuler impayé), modal paiement Stripe, polling 30s, onglet Réglages (latePaymentDays + reminders chips), simulateur de date dev.

### Gaps (UX « trop technique »)
- **Aucun React.** Pas de card « Commission ce mois : 1 240 € — Payée — Voir détail ».
- **Carry-over invisible** : l'admin voit « 0 € dû » sans savoir que c'est un report de déficit.
- PDF sans justification (pas le montant de vente original par ligne).
- Pas de « voir le détail du calcul » (10 ventes +500, 2 refunds −50, report −30 = 420).
- **`models/CommissionInvoiceSettings.js` MANQUANT** (importé par `commissionInvoiceSettingsService` mais le service n'est **importé nulle part** → dead code, pas de crash live ; à créer si on câble le branding facture). **Vérifié.**

### Incohérences
- `Contract.commissions` jamais consulté (le calcul utilise toujours `CommissionConfig` global) → taux par institut = dead code.
- Stripe éparpillé controller+services (devrait être isolé pour tests).
- Cleanup simulated-date destructif (supprime les CommissionPayment futurs).

---

## 4. CARTES CADEAUX

### Backend (riche + ledger)
- **`GiftCard`** : code, balance, reservedAmount, reservations[] (holds Stripe), status active/redeemed, passwordHash (Argon2) + passwordEncrypted (AES-GCM), **M13** recipientName/purchaserName/message/creationMode(online/manual_institute)/paymentMode(stripe/on_site)/manualPaymentMethod/activeTemplateId/createdByAdminId/cardVisualUrl/generatedPdfUrl, **QR** qrTokenHash (SHA256, jamais en clair) + qrPayloadVersion.
- **`GiftCardTransaction`** (LEDGER, parfait pour timeline) : transactionType redeem/manual_debit/credit/manual_issued · source · actorRole · amount · **balanceBefore/balanceAfter** · note · items[].
- `GiftCardConfig` (min/max/presets) · `GiftCardTemplate` (versioning draft/published/archived, 1 active global).
- Débit/recredit **atomiques** (`$gte`), reservations holds checkout, QR opaque (`BSGC.v1.<token>`).

### React aujourd'hui
- `giftCardLibrary` (sélection template actif) + `giftCardTemplates` (studio dev HTML/CSS/versions). **Pas de gestion des cartes émises ni timeline.**

### Gaps
1. **Aucune expiration** : pas de champ `expiryDate`, pas d'état `expired`, pas de job, pas de notif. (state enum = active/redeemed seulement).
2. **Timeline cycle de vie absente** (Créée → Offerte → Utilisée → Débit manuel → Expiration → Solde) alors que le ledger contient tout.
3. QR généré **seulement pour les cartes manuelles**, pas les cartes en ligne (asymétrie).
4. `cleanupExpiredGiftCardReservations()` existe mais **n'est branché à aucun cron**.
5. Pas de régénération/rotation QR si compromis.

---

## 5. FACTURES / AVOIRS / EXPORTS / STRIPE / CUSTOMER360-FINANCE

### Backend
- **`Invoice`** : double système — interne (pdfPath/htmlContent, `documentKind` internal_snapshot/gift_card_usage_receipt, `official:false`) **et** Stripe (stripeInvoiceId/PdfUrl/HostedUrl, `documentKind:stripe_official`, `official:true`). `status` 'draft' sans enum strict.
- **Avoirs** : créés comme **Stripe credit notes** sur premier refund réussi (`stripeRefundEventService` lignes 58-86), stockés dans `RefundRequest.creditNoteId/creditNotePdfUrl`, exposés dans Customer360 Documents. **Création error-silent, sans retry.**
- Stripe (`stripeController`) : config, checkout, webhook, `getTransactionFees` (admin/dev temps réel), `getPendingFeesCount`. Job de récupération des fees silencieux (60s).
- Customer360 (`customer360Mapper.buildFinancial`) expose déjà : totalSpent, depositsPaid, balanceDue, pendingBalances[], giftCardsBalance, refundsTotal, lastInvoice, unpaidInvoicesCount/unpaidInvoices[], + `buildDocuments` (factures + avoirs + consentements), + timeline (achat/document/remboursement).

### React aujourd'hui
- `CustomerFinancialCard` (components.tsx:148) affiche déjà les KPIs financiers + soldes à régler. Onglet **Finances** existe (tabs activite/details/finances). `DocumentsSection` liste factures+avoirs. **C'est une card, pas encore une vraie « histoire financière ».**

### Gaps
1. **Exports comptables : RIEN** (pas de CSV/JSON ventes/factures/refunds/fees, pas de réconciliation, pas de registre fiscal/TVA).
2. **Envoi facture par mail : absent** (générée mais jamais envoyée ; accès uniquement par lien token partagé manuellement).
3. Pas de **liste des factures** côté gestion (filtres date/client/officielle vs interne/statut).
4. Avoirs : pas de section dédiée, création error-silent sans retry, PDF Stripe parfois pas prêt immédiatement (race CDN → 404).
5. Customer360 : pas de section « Finance » narrative (drill-down factures impayées, action régler solde, accès avoir).
6. `Invoice.status` free-form (pas d'enum) → filtre unpaid fragile.
7. Création d'Invoice **non automatique** : risque de ventes orphelines sans facture.

---

## 6. Bugs / blockers transverses à traiter pendant RX2

| # | Sévérité | Constat | Action |
|---|---|---|---|
| B1 | 🔴 Haute | `updateRefundStatus` non monté → admin ne peut pas actionner un remboursement | Monter la route + UI drawer (Phase 4/10) |
| B2 | 🟠 Moyenne | `models/CommissionInvoiceSettings.js` manquant (dead code unwired) | Créer le modèle avant de câbler le branding facture (Phase 5) |
| B3 | 🟠 Moyenne | `cleanupExpiredGiftCardReservations` jamais planifié | Brancher un cron (hors RX2 UI, mais à acter) |
| B4 | 🟠 Moyenne | Recredit GC multi-cartes sans rollback partiel | Robustifier `recreditGiftCardPortion` |
| B5 | 🟡 Basse | `balanceSettlementMode=none` + `paymentType=deposit` → solde non réglable | Valider à la création Service |
| B6 | 🟡 Basse | Avoir error-silent + race PDF Stripe | Retry + readiness check |
| B7 | 🟡 Basse | `Contract.commissions` dead code | Décider : appliquer le taux par institut ou retirer |

---

## 7. Foundation réutilisable (déjà présente)

Toolkit Customer360 (`features/customer360/components.tsx`) — à généraliser pour la finance :
- `money()`, `fmtDate()`, `fmtDateTime()`, `initials()` (helpers)
- `CustomerTimeline` / `TimelineCard` → **timeline financière (Phase 3) + timeline gift-card (Phase 8)**
- `CustomerDrawer` (bottom-sheet mobile / panel desktop) → **drawer remboursement / paiement (Phase 4/10)**
- KPI cards, `CustomerFinancialCard`, Accordion, Tabs, Skeleton, EmptyState, `MobileBottomActions` (mobile-first Phase 11)
- Pattern feature : `useXxx.ts` (TanStack Query) + `components.tsx` + `xxx.css` + `noHardcodedHex.test.ts` + `.test.tsx`
- api-client : un module par feature dans `packages/api-client/src/manager/`

Directive permanente **ProductUXGuideline §15** : nouvelle feature = React only, mobile-first, moins de clics, patterns réutilisés, premium sans gros tableaux, zéro régression vs Vanilla.

---

## 8. Séquence de construction proposée (mapping aux 12 phases)

1. **RX2.0 — Fondations finance** : feature `finance/` + module api-client `finance.ts` + route `ventes`/`commissions`/`remboursements` réelles + extraction des primitives partagées (`fin-*` ou réutilisation `c3-*`). Monter la route `updateRefundStatus` (B1).
2. **RX2.1 — Finance Dashboard (Phase 2)** : page d'accueil financière (Aujourd'hui : ventes, +€, prestations/formations/cartes, soldes à encaisser, remboursements à traiter, factures à envoyer). Cards + KPIs + actions, pas de tableau.
3. **RX2.2 — Timeline financière (Phase 3)** : une timeline ordonnée (Paiement → Acompte → Solde → GC utilisée → Remboursement → Facture → Avoir → Commission).
4. **RX2.3 — Paiements (Phase 4) + UX drawer (Phase 10)** : vues cards, drawer détail (timeline, PJ, liens Customer360), **remboursement 1-clic** (résumé→montant→bouton→confirmation).
5. **RX2.4 — Paiements sur place (Phase 6)** : dashboard soldes dus / encaisser, pattern M13 partout, solde restant toujours visible, méthode d'encaissement.
6. **RX2.5 — Commissions premium (Phase 5)** : card « Commission ce mois », timeline, détail du calcul (carry-over visible), facture, paiement — en cards (créer B2 si branding).
7. **RX2.6 — Gift Cards timeline (Phase 8)** : timeline cycle de vie à partir du ledger ; (option) expiration.
8. **RX2.7 — Customer360 Finance (Phase 7)** : vraie section « Finance » narrative (au-delà de la card actuelle).
9. **RX2.8 — Analytics (Phase 9)** : très peu de graphes lisibles (évolution, top prestations/formations/ventes).
10. **RX2.9 — Exports + Avoirs** : exports comptables (manquants), envoi facture, section avoirs.
11. **Mobile (Phase 11)** transversal à chaque étape (mobile = desktop).
12. **Préparer RX3 (Phase 12)** : finance fermée → RX3 = espace client + auth React complète + bascule flag `REACT_OFFICIAL_FRONTEND`.
</content>
</invoke>
