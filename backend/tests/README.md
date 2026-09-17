# BeautySavage - Backend test harness (Phase 0.2)

A characterization-first test harness put in place **before** any P0/P1 business
fix, so that financial / booking / refund / security flows can be corrected with a
safety net. The harness itself changed no business logic (only a minimal,
documented startup adaptation in `app.js`).

> **Phase 1 update (credential vault)** — third-party secrets (Stripe Institut/Dev
> `secret_key`, Brevo `api_key`) are now sourced from the `IntegratedApi` vault via
> `getCredential()` (AES-256-GCM, `utils/credentialVault.js`). Tests inject a fake
> 64-hex `CREDENTIAL_VAULT_KEY` and set `ALLOW_ENV_CREDENTIAL_FALLBACK=true`
> (`tests/setup/testEnv.js`) so vault-miss reads fall back to the fake provider env
> vars — existing Stripe/Brevo tests are unaffected. New green tests:
> `tests/p1/credentialVault.test.js`, `tests/p1/integratedApiCredentials.test.js`,
> `tests/p1/integratedApiSeed.test.js`. See `Rapports/version 1/49_rapport_phase1_coffre_integrated_api.md`.

> **Phase 1B update** — Stripe `publishable_key` and `webhook_secret` (Institut +
> Dev) now come from the vault too. New green tests:
> `tests/p1/stripeCredentialMigration.test.js` (publishable from vault, fallback
> gating), `tests/p1/stripeWebhookCredentialVault.test.js` (webhook secret from
> vault via a mocked `stripe`, invalid signature → 400, missing → 500),
> `tests/p1/credentialVaultRotation.test.js` (key rotation dry-run/apply). The
> webhook test mocks `stripe` so `constructEvent` records which secret it received.
> See `Rapports/version 1/51_rapport_phase1b_stripe_credentials_rotation.md`.

> **Phase 2 update (SendLog & Brevo observability)** — outbound email now writes a
> `SendLog` (queued→sent→delivered→opened / bounced / failed); a Brevo webhook
> updates it by `providerMessageId`; a dev-only `GET /api/gestion/dev/send-logs`
> exposes the logs. New green tests: `tests/p1/sendLog.test.js` (mocks `fetch` to
> drive `postToBrevo`), `tests/p1/brevoWebhook.test.js` (controller-level
> delivered/opened/bounce + shared-secret), `tests/p1/sendLogEndpoint.test.js`
> (requireStrictDev via the seeded dev/admin/client users). No email/secret is ever
> stored or logged (recipient is a SHA-256 hash). Note: an unused live Stripe key
> was removed from `testEnv.js` (see report 52). See
> `Rapports/version 1/53_rapport_sendlog_brevo_observability.md`.

> **Phase 3 update (event bus)** — a backend event bus persists `EventLog` rows and
> notifies in-process subscribers; SendLog transitions emit `email.*` events; a
> dev-only `GET /api/gestion/dev/events` exposes them. New green tests:
> `tests/p1/eventBus.test.js` (persist + redaction + subscriber isolation),
> `tests/p1/sendLogEvents.test.js` (SendLog→events + context), `tests/p1/
> eventLogEndpoint.test.js` (requireStrictDev). Payloads are redacted (no
> email/secret). See `Rapports/version 1/56_rapport_phase3_event_bus.md`.

> **Consolidation @180054c** — suite verte : **130 tests / 33 fichiers** (p0 = 44,
> p1 = 80, integration = 6). Snapshot complet du projet :
> `Rapports/version 1/57_audit_documentation_consistency.md` (cohérence doc/code) et
> `Rapports/version 1/58_architecture_snapshot_2026.md` (photographie d'architecture).

> **Phase 4A update (business events)** — business mutations now emit audit-only
> EventLog entries via `services/businessEventService.js` (sale/booking/refund/
> gift_card/commission). New green tests: `tests/p1/businessEvents.test.js`
> (emission + a failing EventBus never breaks the flow + no SendLog side effect) and
> `tests/p1/businessEventPayloadSafety.test.js` (no email/secret/token in payloads).
> Suite: **140 tests / 35 files** (p0 44, p1 90, integration 6). See
> `Rapports/version 1/60_rapport_phase4a_business_events.md`.

> **Phase 4B update** — more deferred business events wired (booking.reminded/
> no_show_marked/client_suspended, commission.paid, gift_card.created) and email
> SendLog `contextId` attached for refund/commission. New green tests:
> `tests/p1/deferredBusinessEvents.test.js` (incl. gift-card password never leaks)
> and `tests/p1/sendLogContextAttachment.test.js` (postToBrevo(payload, context) →
> SendLog/email.* contextType+contextId; explicit context wins over tag-derived).
> Suite: **151 tests / 37 files** (p0 44, p1 101, integration 6). See
> `Rapports/version 1/62_rapport_phase4b_deferred_events_contexts.md`.

> **Phase 4C update** — password_reset email now carries `contextType:user`/
> `contextId:user._id`; notifications audited (none migrated). New green tests:
> `tests/p1/emailRemainingContexts.test.js` (password_reset/email_confirmation/
> system/gift_card contexts; no email/code stored) and
> `tests/p1/notificationMigrationAudit.test.js` (emitting business events creates
> NO Notification and NO email — audit-only, no subscriber). Suite: **157 tests /
> 39 files** (p0 44, p1 107, integration 6). See
> `Rapports/version 1/65_rapport_phase4c_contexts_notifications_audit.md`.

> **Phase 4D update** — first EventBus→Notification subscriber (flag-gated,
> idempotent, in-app only). New green tests:
> `tests/p1/notificationEventSubscriber.test.js` (flag off → no notif; registered →
> new_sale / no_show_recorded; incomplete payload safe; no email) and
> `tests/p1/notificationEventIdempotence.test.js` (re-emit → single notif; handler
> failure never throws to emitter). Tests register subscribers explicitly
> (`registerNotificationSubscribers()`); the boot flag
> `ENABLE_EVENT_NOTIFICATION_SUBSCRIBERS` stays off in test. Suite: **166 tests /
> 41 files** (p0 44, p1 116, integration 6). See
> `Rapports/version 1/67_rapport_phase4d_notification_subscriber.md`.

> **Phase 4E update** — subscriber now has an off/shadow/active mode
> (`EVENT_NOTIFICATION_SUBSCRIBER_MODE`, default off) and re-fetches the business
> object for parity. New green tests: `tests/p1/notificationEventParity.test.js`
> (re-fetch builds the same variables as the direct call; client email excluded;
> object-not-found → no notif/no throw) and `tests/p1/notificationEventShadowMode.test.js`
> (off → nothing; shadow → delivery status "shadow", no notif; active → notif;
> shadow→active upgrade). The Phase 4D subscriber tests now set
> `EVENT_NOTIFICATION_SUBSCRIBER_MODE=active` and seed real ServiceBooking fixtures.
> Suite: **173 tests / 43 files** (p0 44, p1 123, integration 6). See
> `Rapports/version 1/70_rapport_phase4e_notification_parity_shadow.md`.

> **Phase 5A update (email template versioning)** — `EmailTemplate` gains
> version/status; the runtime serves the published version (legacy/no-status docs
> treated as published; content unchanged). New green tests:
> `tests/p1/emailTemplateVersioning.test.js` (migration v1 published + dry-run,
> single-published partial unique, draft/publish lifecycle, sanitization),
> `tests/p1/emailTemplateRuntimePublished.test.js` (loadTemplate → published /
> legacy fallback / default; draft & archived never served),
> `tests/p1/emailTemplateRollback.test.js` (rollback = new published copy, old
> archived). Tests call `EmailTemplate.syncIndexes()` and insert legacy docs via
> `collection.insertOne` to bypass schema defaults. Suite: **185 tests / 46 files**
> (p0 44, p1 135, integration 6). See
> `Rapports/version 1/72_rapport_phase5a_email_template_versioning.md`.

> **Phase 1A update** - the simple security P0s are now **fixed** (mock-pay
> production guard, removed hardcoded secret fallbacks, gift-card password no
> longer leaked by the public tracking endpoint, tracking-token debug log
> removed). New green tests under `tests/p0/security.*` lock these in. The fixtures
> (`seedTestData`) now also create an **active contract** so API routes pass
> `contractGuard()` (otherwise it returns 503 `CONTRACT_INACTIVE` and tests never
> reach the handlers). See `Rapports/version 1/23_rapport_phase1a_securite_p0.md`.
>
> **Phase 1B-1 update** - two financial P0s are now **fixed**: (1) Stripe webhook
> idempotence is atomic (unique partial index on `Sale.stripePaymentIntentId`, set
> at insert in `persistSale`, + `E11000` handled as idempotent), and (2) gift-card
> debit is atomic (`debitGiftCardBalanceAtomic` - conditional `findOneAndUpdate`,
> never negative). New green tests: `stripe.webhook.idempotence` and
> `giftcard.concurrentDebit.test.js`. See
> `Rapports/version 1/25_rapport_phase1b1_stripe_giftcard.md`.
>
> **Phase 1B-2 update** - the refund P0 trio is now **fixed**: (1) duplicate
> `RefundRequest` creation is blocked per active `saleId + itemId + itemType`
> (unique partial index + `createRefundRequestOnce` refetch on duplicate), (2)
> gift-card recredit is idempotent under duplicate `charge.refund.updated`
> delivery (`giftCardRecreditInProgress` claim + single credit transaction), and
> (3) refund execution is capped to the paid sale total. New green tests:
> `refund.doubleRequest.characterization.test.js`,
> `refund.recreditIdempotent.test.js`, `refund.overRefund.test.js`. See
> `Rapports/version 1/27_rapport_phase1b2_remboursements.md`.
>
> **Phase 1B-4 update** - the last P0 is now **fixed**: a 0 EUR order (100% gift
> card or a genuinely free item) is finalized server-side via
> `POST /api/client/checkout/finalize-free`, which reuses the SAME finalizer as the
> Stripe webhook (`processCheckoutStatePurchase`) — no parallel flow. It creates the
> Sale + booking, debits the gift card atomically, is idempotent on double submit
> (synthetic `free_<key>` ref on the Phase 1B-1 unique index), and refuses to
> finalize a partially-paid order for free (`requireZeroRemaining` → 402). The
> `giftcard.zeroPayment.characterization.test.js` todo is now a full green test. See
> `Rapports/version 1/32_rapport_phase1b4_zero_payment.md`. **The P0 harness now has
> zero todo and zero expected-fail.**
>
> **Phase 1B-4B update** - the frontend is now wired to consume that backend fix:
> any checkout whose due-now amount is `0 EUR` goes through
> `checkoutToken + freeCheckout=1` to the payment result screen, which calls
> `POST /api/client/checkout/finalize-free` with `idempotencyKey = checkoutToken`
> and never loads Stripe. A focused frontend regression test,
> `purchaseFlowService.zeroPayment.wiring.test.js`, locks the request shape and the
> clear `402 PAYMENT_REQUIRED` error path. See
> `Rapports/version 1/34_rapport_phase1b4b_front_zero_payment.md`.
>
> **Phase 1B-5 update** - the new booking cleanup job expires stale `pending_payment`
> bookings after 30 minutes, releases their slot locks, and keeps paid/confirmed
> bookings untouched. The regression test
> `booking.pendingPaymentCleanup.test.js` covers the expiration, idempotence, and
> success-before-expiration cases. See
> `Rapports/version 1/37_rapport_phase1b5_pending_payment.md`.
>
> **Phase P1-1 update** - the role split is now real: `requireStrictDev` is dev-only,
> admin/dev routes stay inclusive where expected, and admins cannot create or
> promote `dev` accounts through user management. Dedicated rate limits now cover
> `POST /auth/login` and the password-reset routes. The new focused tests live in
> `tests/p1/`. See `Rapports/version 1/39_rapport_p1_roles_rate_limit.md`.
>
> **Phase P1-3 update** - blocked refunds are now retryable instead of getting
> consumed on a failed trigger, and Stripe refund credit notes / invoices use
> stable idempotency keys so replayed executions stay safe. New focused tests:
> `refund.recovery.test.js`, `refund.creditNoteIdempotence.test.js`,
> `invoice.recovery.test.js`. See
> `Rapports/version 1/43_rapport_p1_refund_recovery_credit_notes.md`.

## How to run

```bash
npm test                 # run everything once (vitest run)
npm run test:watch       # watch mode
npm run test:integration # only tests/integration (health + auth)
npm run test:p0          # only tests/p0 (P0 characterizations)
```

Requirements: Node 22+. The first run downloads a `mongodb-memory-server` binary
(cached afterwards). Tests never touch the real `.env`, real database, Brevo or
Stripe - see "Safety" below.
`npm run test:p1` runs only the new P1 security harness.

## What passes vs. what is intentionally red

### Green (these MUST pass)
- `tests/integration/health.test.js` - the app boots in `NODE_ENV=test` against an
  in-memory MongoDB, is connected to a local (not prod) cluster, and serves a
  public endpoint without leaking secret keys.
- `tests/integration/auth.test.js` - signup creates an unverified client + issues a
  code (mail mocked), login is refused while unverified, verify-email activates the
  account and opens a session, and a verified client can login + reach `/auth/me`.
- `tests/p0/mockPay.exposure.test.js` - documents that `POST /api/client/mock-pay`
  is blocked in production.
- `tests/p0/stripe.webhook.idempotence.characterization.test.js` - one sale per
  Stripe PaymentIntent, including replay/concurrent delivery.
- `tests/p0/giftcard.concurrentDebit.test.js` - gift-card debit stays atomic.
- `tests/p0/refund.doubleRequest.characterization.test.js` - duplicate refund
  creation is rejected/refetched, with one active refund and one financial trigger.
- `tests/p0/refund.recreditIdempotent.test.js` - duplicate refund webhook delivery
  recredits the gift card exactly once.
- `tests/p0/refund.overRefund.test.js` - refund execution is capped to the paid
  sale total for mixed and gift-card-only refunds.
- `tests/p0/booking.doubleSlot.characterization.test.js` - service booking rejects
  exact double-booking, partial overlap, past slots, off-schedule slots and blocked
  slots, while still allowing a slot reopened by a `modify` exception.
- `tests/p0/booking.slotRevalidation.test.js` - final Stripe-side service booking
  creation is revalidated server-side and refuses a slot that became unavailable.
- `tests/p0/booking.pendingPaymentCleanup.test.js` - stale `pending_payment`
  bookings expire after 30 minutes, release their locks, and remain idempotent on
  repeated cleanup runs while leaving paid/confirmed bookings untouched.
- `tests/p0/giftcard.zeroPayment.characterization.test.js` - a 0 EUR order (100% gift
  card or a free item) is finalized via `POST /api/client/checkout/finalize-free`:
  Sale + ServiceBooking created, gift card debited (capped to the due amount),
  double-submit is idempotent (one sale, one debit), and a still-due balance is
  refused (402 `PAYMENT_REQUIRED`).
- `tests/p0/purchaseFlowService.zeroPayment.wiring.test.js` - frontend wiring:
  zero-payment checkout posts to `/api/client/checkout/finalize-free`, sends a
  stable `idempotencyKey`, and surfaces `402 PAYMENT_REQUIRED` clearly.

### P1 (these MUST pass before the next security phase)
- `tests/p1/security.roles.test.js` - `requireStrictDev` is dev-only, admin/dev
  access remains available where expected, and admins cannot create/promote `dev`
  via user management.
- `tests/p1/auth.rateLimit.test.js` - dedicated rate limits for login and
  password-reset routes.
- `tests/p1/refund.recovery.test.js` - blocked refund requests remain retryable
  and can be recovered by the dedicated replay job.
- `tests/p1/refund.creditNoteIdempotence.test.js` - replaying a refund webhook
  does not create a second Stripe credit note.
- `tests/p1/invoice.recovery.test.js` - Stripe invoice creation is replay-safe
  and returns the persisted invoice on retry.

### Expected-fail (`it.fails`)

Currently none in the P0 harness.

### Todo (`it.todo`) - documented gap not yet automated

Currently none — every P0 scenario is now an executable assertion.

## How to use these tests to guide the fixes

1. Add or update a characterization/regression test for the P0.
2. Implement the fix behind the failing assertion.
3. Re-run `npm run test:p0` until the regression is permanently green.
4. Repeat. The harness keeps you from breaking the already-green flows while you fix.

For the `it.todo` items, build the missing fixture/endpoint, then implement the
assertion described in the todo string.

## Structure

```text
tests/
  setup/
    testEnv.js
    testDb.js
    testApp.js
    seedTestData.js
    stripeWebhookTestUtils.js
  integration/
    health.test.js
    auth.test.js
  p0/
    mockPay.exposure.test.js
    security.secrets.test.js
    security.tracking-token.test.js
    security.logging.test.js
    stripe.webhook.idempotence.characterization.test.js
    giftcard.concurrentDebit.test.js
    refund.doubleRequest.characterization.test.js
    refund.recreditIdempotent.test.js
    refund.overRefund.test.js
    booking.doubleSlot.characterization.test.js
    booking.slotRevalidation.test.js
    booking.pendingPaymentCleanup.test.js
    giftcard.zeroPayment.characterization.test.js
  p1/
    security.roles.test.js
    auth.rateLimit.test.js
    refund.recovery.test.js
    refund.creditNoteIdempotence.test.js
    invoice.recovery.test.js
    legalConsentCheckout.test.js           # Sprint pré-React A1
    businessTimezone.test.js               # Sprint pré-React A2
    brevoWebhookProductionSecurity.test.js # Sprint pré-React A3
    adminRefundAudit.test.js               # Sprint pré-React A4
    commissionRefundConsistency.test.js    # Sprint pré-React A5
    stripeWebhookFailureObservability.test.js # Sprint pré-React A6
    depositDistanceLearningGuards.test.js  # Sprint pré-React A7
    ... (et autres suites p1)
```

## Sprint pré-React A1-A3 (rapports 85 / 86)

- **A1 — consentement légal serveur** (`p1/legalConsentCheckout.test.js`) : refus
  sans CGV / distanciel sans renonciation / prestation datée sans reconnaissance →
  code `LEGAL_CONSENT_REQUIRED` ; consentement complet → checkout continue ; free
  checkout 0€ applique les **mêmes** règles ; snapshot `Sale.legalConsentSnapshot`
  présent. Fixture adaptée : `p0/giftcard.zeroPayment.characterization.test.js`
  (Test 1) fournit la renonciation pour une prestation dans la fenêtre de rétractation.
- **A2 — timezone Europe/Paris** (`p1/businessTimezone.test.js`) :
  `BUSINESS_TIMEZONE === 'Europe/Paris'`, disponibilité câblée sur la constante,
  offsets DST, garde de démarrage. Forçage `process.env.TZ` désactivé en test.
- **A3 — webhook Brevo prod** (`p1/brevoWebhookProductionSecurity.test.js`) : prod
  sans secret → 503, mauvais secret → 401, bon secret → 200, dev/test sans secret →
  200 (toléré) ; le secret n'est jamais loggé.

## Sprint pré-React A4-A7 (rapports 87 / 88)

- **A4 — gouvernance admin** (`p1/adminRefundAudit.test.js`) : `refund.failed`/
  `refund.requested` émis avec la raison admin + persistance dans `meta.notes` ;
  `booking.cancelled` admin émis avec raison. Aucun remboursement silencieux.
- **A5 — commissions post-remboursement** (`p1/commissionRefundConsistency.test.js`) :
  déduction d'un remboursement 100 % carte cadeau (trou corrigé), déduction Stripe,
  events `commission.adjusted` / `commission.reversal_required` (vente déjà payée) /
  `commission.cancelled` (reversal).
- **A6 — pannes webhook Stripe** (`p1/stripeWebhookFailureObservability.test.js`) :
  signature invalide → failure safe (400), contexte introuvable → failure safe (500),
  replay idempotent → 200 sans failure, aucune donnée sensible stockée.
- **A7 — acompte / distanciel** (`p1/depositDistanceLearningGuards.test.js`) : offre
  acompte bloquée (`OFFER_BALANCE_UNSUPPORTED`), distanciel immédiat sans accès bloqué
  (`OFFER_ACCESS_UNAVAILABLE`), distanciel manuel marqué `accessDeliveryStatus='manual_pending'`.

## Sprint pré-React B1-B2 (rapports 97 / 98)

- **B1 — V1 sans TVA** (`p1/v1TaxMode.test.js`) : contrat fiscal central
  (`constants/tax.js`, franchise 293 B, taux 0), `buildTaxSnapshot` (HT=TTC, vatAmount 0),
  `Sale.taxSnapshot` porté par chaque vente, label fiscal sourcé d'une seule constante.
- **B2 — serveur source de vérité du montant** :
  - `p1/serverCheckoutPricing.test.js` — montant serveur (produit/formation/prestation/
    panier/carte cadeau, couverture carte cadeau partielle/100 %).
  - `p1/checkoutAmountTampering.test.js` — sous-paiement client → `CHECKOUT_AMOUNT_MISMATCH`,
    conforme → OK, carte cadeau sur-déclarée capée, carte inactive ignorée.
  - `p1/serverPricingGiftCardPromotion.test.js` — promo active/expirée, promo + carte cadeau,
    solde insuffisant.
- Commissions **non modifiées** (exclusion volontaire ; prochaine étape = discussion produit).

## Sprint React R0 — Infrastructure frontend-react (rapports 156-157)

Tests **frontend** (séparés du backend, dans `frontend-react/`, lancés par `npm run react:test`
ou `cd frontend-react && npm run test` — Vitest + Testing Library/jsdom). N'affectent ni n'utilisent
la suite backend ; le `npm test` backend reste à 394.
- `packages/api-client/src/apiFetch.test.ts` (3) — succès JSON, `ApiError{status,code}` sur non-ok, erreur sans JSON propre.
- `packages/auth/src/guards.test.tsx` (4) — `RequireAuth` bloque l'anonyme / laisse passer l'authentifié ; `RequireRole` refuse un rôle insuffisant / accepte un rôle autorisé.
- `apps/vitrine/src/App.test.tsx` (1) — rendu de la page d'accueil.
- `apps/manager/src/App.test.tsx` (4) — anonyme→/login, admin→dashboard, dev→/dev, admin bloqué sur /dev.
- Total R0 : **12 tests frontend verts**. `loader` injectable dans `AuthProvider` (pas d'appel réseau en test). Aucun secret.

### MAJ R1 — Vitrine catalogue (rapports 158-159)
Tests frontend ajoutés (`npm run react:test`, total **26 verts**) :
- `packages/config/src/proxy.test.ts` (3) — `PROXY_PATHS`/`buildProxyMap` couvrent `/api`,`/auth`,`/uploads` + cible par défaut/personnalisée.
- `packages/api-client/src/catalog/mappers.test.ts` (5) — mapping tolérant prestation/formation/produit/site-status/gift-card (champs absents, coercition id, statut inconnu→active).
- `apps/vitrine/src/pages/catalogPages.test.tsx` (5) — prestations loading→cards, formations empty state, produits error state, accueil rend les sections, route détail prestation par slug.
- `apps/vitrine/src/App.test.tsx` (2, mis à jour) — accueil (hero) + bandeau maintenance via `/api/site-status`.
- Helper `apps/vitrine/src/test/utils.tsx` : `stubFetch`/`jsonResponse`/`renderWithProviders` (QueryClient retry off + AuthProvider anonyme + MemoryRouter). Aucun appel réseau réel.

### MAJ Theme Foundation — Thème vitrine/panel (rapports 160-162)
Tests frontend ajoutés (`npm run react:test`, total **38 verts**) :
- `packages/ui/src/theme/theme.test.tsx` (7) — `themeToCssVars` expose toutes les vars ; `mergeTheme` ; `normalizeHex` ; `ThemeProvider` applique scope vitrine/panel + surcharge.
- `apps/vitrine/src/features/theme/theme.test.tsx` (4) — `mapVitrineThemeToTokens` ({} si vide, hex invalides ignorés) ; `VitrineThemeProvider` fallback `defaultVitrineTheme` si API KO ; applique la couleur backend.
- `apps/manager/src/theme.test.tsx` (1) — manager rend le dashboard + applique `defaultPanelTheme` (distinct vitrine).
- Règle vérifiée : aucun hex en dur dans les `.tsx` (composants lisent les CSS vars `--bs-*`).

## Sprint T1 — Thème backend multi-scope (rapports 163-164)

Backend (+10) :
- `tests/p1/themeMultiScopeBackend.test.js` (6) — legacy sans scope = vitrine ; createTheme scope (défaut vitrine / manager / invalide→400) ; 1 actif par scope + activer un scope n'affecte pas l'autre ; `/api/vitrine/theme` & `/api/theme/manager` renvoient le bon scope ; `theme:null` si aucun manager ; CRUD refusé hors dev.
- `tests/p1/themeScopeMigration.test.js` (4) — dry-run sans écriture ; `--apply` (legacy→vitrine + manager créé + vitrine actif conservé) ; idempotence ; dédoublonnage des actifs.
- ⚠️ `mongodb-memory-server` est standalone → activation rendue **séquentielle** (pas de transaction). Index unique partiel `theme_active_per_scope` garantit l'unicité ; les tests appellent `Theme.syncIndexes()`.

Frontend (+3 → 41 verts) :
- `apps/manager/src/features/theme/themeMultiScope.test.tsx` — `PanelThemeProvider` : fallback `defaultPanelTheme` si `theme:null` / si endpoint échoue ; applique la couleur backend manager.
- Total backend après T1 : **404** tests (96+ fichiers).

## Sprint React R2A — Préparation checkout (rapports 165-166)

Frontend uniquement (`npm run react:test`, total **54 verts**, +13) ; **aucun test backend** (zéro changement backend) :
- `packages/api-client/src/booking/booking.test.ts` (5) — mapping disponibilités (slots/jours), `isLegalConsentComplete`, `buildCheckoutPreparationPayload` (pur, sans réseau, contient slot + consentements).
- `apps/vitrine/src/features/cart/cart.test.tsx` (4) — storage vide/roundtrip, version incompatible → reset, CartProvider add/remove/persist/résumé indicatif.
- `apps/vitrine/src/pages/r2aFlow.test.tsx` (6) — panier vide ; panier prestation+créneau+retrait ; checkout bouton désactivé→payload préparé (slot+CGV) ; **aucun appel réseau lors de la préparation** ; sélection jour→créneau→ajout panier ; jour sans créneau → empty state.
- Backend (`npm test` 404, audits 36/20) **inchangé** : R2A ne touche pas le backend.

## Sprint React R2B — Paiement hébergé + finalize-free (rapports 167-168)

Frontend uniquement (`npm run react:test`, total **71 verts**, +17) ; **aucun test backend** (zéro changement backend) :
- `packages/api-client/src/checkout/checkout.test.ts` (10) — `buildServiceCheckoutState` (sans montant / null hors service), `buildIdempotencyKey` (alphanum 8-128), `createCheckoutSession` (hosted/free/elements/ApiError 400), `finalizeFreeCheckout` (saleId / 401).
- `apps/vitrine/src/pages/r2bPayment.test.tsx` (10) — bouton désactivé→activé ; createCheckoutSession reçoit le checkoutState attendu (sans `totals`) ; hosted → `window.location.assign(url)` ; free → finalize-free + navigation succès ; erreur backend → ErrorState ; 401 → connexion requise ; succès free ; succès hosted pending (wording prudent) ; annulation conserve le panier ; **aucune dépendance `stripe` dans les package.json front**.
- Garanties vérifiées : aucun import `@stripe/stripe-js`, aucun hex dans les `.tsx`. Backend (404 + 36/20) **inchangé**.

## Sprint React R2C — Retour Stripe React + login client (rapports 169-170)

Backend (+7 → **411**) :
- `tests/p1/hostedCheckoutReactReturnUrls.test.js` (3) — sans `CHECKOUT_RETURN_BASE_URL` → URLs Vanilla ; base http(s) → URLs React (`/paiement/succes?session_id={CHECKOUT_SESSION_ID}&checkoutId=…`, `/paiement/annule`) ; base sans schéma → fallback Vanilla (anti open-redirect).
- `tests/p1/checkoutSessionStatus.test.js` (4) — `session-status` résout `cs_…` (Checkout Session → PaymentIntent) ; `pi_…` inchangé ; `cs_` sans PI → open/unpaid ; 401 si non authentifié.
- Stripe mocké via `stripeConfigService.getStripeClient`. Aucun changement pricing/finalizer/consentement.

Frontend (+13 → **91 verts**) :
- `apps/vitrine/src/pages/r2cReturnLogin.test.tsx` (9) — succès `session_id` → session-status + panier vidé ; pending → panier conservé ; `payment_intent` failed ; `free=1` (panier vidé, aucun réseau) ; login succès → redirect interne ; login erreur → message ; checkout 401 → lien `/connexion?redirect=/checkout` + panier conservé.
- Garanties : aucun import Stripe.js, aucun hex tsx, aucun token en localStorage (cookie HttpOnly only).

## Sprint M1 — Identités de communication (rapports 171-172)

Backend (+31 → **442**), aucun vrai e-mail (Brevo mocké) :
- `tests/p1/communicationIdentityModel.test.js` (6) — enums, scope cohérent (support=platform), client refusé, displayName requis, email lowercase, 1 actif/role-scope (index unique partiel).
- `tests/p1/communicationIdentityService.test.js` (9) — create support/commerciale (scope déduit), client refusé, scope incohérent, displayName, setActive interdit si non vérifié / ok si vérifié, getActiveIdentity, assertIdentityReady (strict|warn).
- `tests/p1/communicationRoleResolver.test.js` (7) — sender support/commerciale, fromRole invalide, recipient client depuis contexte, client absent, identité absente, resolveMailEnvelope.
- `tests/p1/communicationIdentityRoutes.test.js` (7) — dev crée support, admin crée commerciale, admin ne gère pas support (403/fall-through), dev request-verification (mock Brevo), liste, non-connecté refusé, payload sans secret.
- `tests/p1/communicationIdentityBrevoVerification.test.js` (2) — request→confirm→refresh (verified + domainAuthenticated + dnsRecords), échec provider → lastErrorMessageSafe sans secret. Mock `integratedApiCredentialService.getCredential` + `globalThis.fetch`.
- Brevo Sender API mockée via `vi.mock('../../services/communicationBrevoSenderAdapter.js')` (routes/service) ou getCredential+fetch (adapter). mailService/SendLog/webhook **non touchés**.

## Sprint M2 — Mail Event Dispatch Engine (rapports 173-174)

Backend (+25 → **467**), aucun vrai e-mail (Brevo mocké getCredential+fetch) :
- `tests/p1/mailDispatchRules.test.js` (5) — lookup règle, liste, flag runtime, aucune adresse dans les règles.
- `tests/p1/mailEventDispatchService.test.js` (9) — dispatchTemplateByRoles sent (SendLog templateKey + tags from:/to:, e-mail non fuité), template absent → skipped_template_missing, identity_missing, client_missing, support→commerciale ; dispatchMailForEvent no rule / shadow (skipped_duplicate_direct_sender) + ledger / idempotent.
- `tests/p1/mailEventSubscriber.test.js` (4) — flag off no-op, flag on dispatch (ledger shadow), event hors règles no-op, jamais de throw.
- `tests/p1/mailEventDeliveryIdempotence.test.js` (4) — replay → 1 entrée, contextes distincts → 2, index unique E11000, concurrent → 1 entrée.
- `tests/p1/mailRoleResolverIntegration.test.js` (3) — commerciale→client (sender/to corrects), support→commerciale, aucun fallback hardcodé (identity_missing → aucun envoi).
- SendLog/EventLog **non modifiés** (enum strict) ; statuts M2 sur le ledger `MailEventDelivery`.

## Sprint M3A — Notification Target Engine admin/dev (rapports 175-176)

Backend (+35), notifications in-app uniquement (aucun e-mail) :
- `tests/p1/notificationTargetModel.test.js` (5) — `Notification.targetRole` default admin, enum admin|dev, rejet `client`/`practitioner`.
- `tests/p1/notificationTargetService.test.js` (13) — mapping admin/dev, défaut admin, override explicite, `createdFromDevContext`, `normalizeNotificationTargetRole`, `canReadNotification`/`assertCanReadNotification` (client jamais, dev seul lit dev) + `triggerNotification` (ancien appelant → résolu, type technique → dev, options.targetRole prioritaire).
- `tests/p1/notificationTargetRoutes.test.js` (9) — manager n'expose pas dev, dev n'expose pas admin, admin interdit sur `/dev` (403), client/non-auth interdits, dev voit le panel manager, mark-read respecte l'audience, payload safe (aucun e-mail/secret, `variables` non sérialisées).
- `tests/p1/notificationTargetBackfill.test.js` (4) — dry-run no-op, `--apply` remplit + mapping correct, idempotence, aucune suppression. Inserts legacy via collection brute (notificationId unique).
- `tests/p1/notificationEventSubscriberTargetRole.test.js` (4) — subscriber crée `targetRole='admin'` (new_sale, no_show_recorded), aucune notif dev, pas de fuite e-mail client.
- **Fix d'ordre de montage** : `notificationRouter` remonté AVANT les routeurs dev-only broad-mount sur `/api/gestion` (ex. `commissionRouter requireStrictDev`) qui shadowaient `/api/gestion/notifications` (403 admins, pré-existant). Manager filtre `targetRole {$ne:'dev'}` (legacy-safe), dev filtre `targetRole 'dev'` (requireStrictDev).

## Sprint M10 — Planning global institut + suppression multi-prestatrices (rapports 197-198)

Backend (+5 fichiers / 17 cas) + frontend (+11 cas → **164 tests**). Additif & non destructif.
- `tests/p1/globalCalendarService.test.js` — `listGlobalCalendarItems` (réservations + formations présentielles, global) ; mappers (acompte/solde/actions ; 1 item/jour de session). Client sans nom → `null` (jamais d'e-mail).
- `tests/p1/globalCalendarRoutes.test.js` — `GET /api/gestion/calendar/items` : admin/dev 200, filtre type, client/anon 401-403, dates manquantes 400, aucun e-mail exposé.
- `tests/p1/noPractitionerBooking.test.js` — réservation **sans** practitionerId (résolu = institut), practitionerId legacy **ignoré**, double-booking global impossible (409).
- `tests/p1/globalAvailabilityNoPractitioner.test.js` — disponibilité globale sans practitionerId ; le créneau réservé disparaît (conflit global).
- `tests/p1/calendarFormationSessions.test.js` — sessions présentielles exposées (places/statut) ; distancielles exclues.
- `frontend-react/packages/api-client/src/manager/calendarApi.test.ts` (4) — scope→endpoint, cancel/balance POST, reschedule lève.
- `frontend-react/apps/manager/src/features/planning/planning.test.tsx` (6) — vue jour/semaine, cartes, drawer + solde, action solde, filtres, report désactivé, pas de table.
- `frontend-react/apps/manager/src/features/planning/noHardcodedHex.test.ts` (1).

## Sprint M9 — Notification Center React + UX Motion (rapports 195-196)

Backend (+1 fichier / 5 cas) + frontend (+19 cas → **153 tests**). Backend quasi inchangé (sérialisation enrichie).
- `tests/p1/notificationCenterSerialization.test.js` — la liste expose categorySnapshot/priority/persistent/action/templateKey/templateVersion ; **jamais `variablesSnapshot`** ni `templateRuntimeStatus` ni e-mail ; défauts sûrs pour une notif legacy.
- `frontend-react/apps/manager/src/features/notifications/notificationCenter.test.tsx` (9) — badge non-lus, scope admin→`/api/gestion/notifications` / dev→`/api/gestion/dev/notifications`, drawer + cartes (pas de table), couleur/icône du snapshot, badges priorité/persistant, mark-read API, état vide, bandeau « +3 » + shake quand non-lus augmentent.
- `frontend-react/apps/manager/src/features/notifications/notifications.unit.test.ts` (2) — `shouldPulse` (shake uniquement si augmentation), `pulseBannerText`.
- `frontend-react/apps/manager/src/features/notifications/noHardcodedHex.test.ts` (1) — aucun hex dans les `.tsx`.
- `frontend-react/packages/api-client/src/manager/notificationsApi.test.ts` (5) — scope→endpoint, mark/markAll/delete (PATCH/DELETE), stats dérivées, `resolveNotificationAction`.
- `frontend-react/packages/ui/src/motion.test.ts` (2) — `prefersReducedMotion`, `motionTransition` (vide si reduced-motion).
- `App.test.tsx`/`theme.test.tsx` : enveloppés d'un `QueryClientProvider` (le shell monte la cloche).

## Sprint M8 — NotificationEngine branché sur les templates (rapports 193-194)

Backend (+6 fichiers / 14 cas) + frontend (+1 fichier / 2 cas → **134 tests**). Additif & non destructif.
- `tests/p1/notificationTemplateRuntime.test.js` — service runtime : render `{{var}}` + strip HTML, `sanitizeVariablesSnapshot` (drop email/secret/token), `getPublishedNotificationTemplate`, `getCategorySnapshot` (name/slug/icon/color only), `buildNotificationPayloadFromTemplate`.
- `tests/p1/notificationRuntimeFallback.test.js` — sans template publié → legacy identique (`fallback_template_missing`) ; flag OFF → `legacy_runtime_disabled` ; ni template ni eventConfig → aucune notif.
- `tests/p1/notificationRuntimeTrigger.test.js` — template publié prioritaire sur la config legacy (title/priority/persistent/action) ; enum legacy `category` non corrompue par le slug ; `targetRole` toujours choisi par le moteur (M3A : dev pour type dev).
- `tests/p1/notificationRuntimeCategorySnapshot.test.js` — snapshot catégorie figé après modif de la catégorie ; template sans catégorie → snapshot null, pas d'échec validation.
- `tests/p1/notificationRuntimeSubscriber.test.js` — `sale.finalized` → notif rendue depuis le template, corrélée (M3B), cible admin (M3A), sans doublon, aucune fuite e-mail.
- `tests/p1/notificationRuntimePrivacy.test.js` — `variablesSnapshot` sanitizé (ni e-mail ni secret).
- `frontend-react/packages/api-client/src/manager/notifications.test.ts` (2) — helpers `notificationDisplayColor`/`Icon` (source = snapshot, défaut `bi-bell`).

## Sprint M7 — Notification Studio React + Categories (rapports 191-192)

Backend (+4) + frontend (+9 → **132 tests / 31 fichiers**).
- `tests/p1/notificationTemplateStudioApi.test.js` (4) — catégories CRUD (slug auto) ; template create→draft→publish→rollback (1 publié/clé) ; liste 1 ligne/clé ; admin interdit (403) ; **aucun scope/targetRole** dans le payload.
- `packages/api-client/src/manager/notificationStudioApi.test.ts` (3) — catégories CRUD + templates endpoints + `previewNotificationTemplate` (front, variables inconnues) + body sans scope/targetRole.
- `apps/manager/src/features/notificationTemplates/notificationStudio.test.tsx` (5) — liste cards (pas de table), blocage admin (dev-only), catégories CRUD (création POST), éditeur (sélecteurs priorité/persistent/action, preview, save→draft sans targetRole), aucune fuite e-mail.
- `apps/manager/src/features/notificationTemplates/noHardcodedHex.test.ts` (1) — aucun hex dans les `.tsx`.

## Sprint M6 — Mail Template Studio React (rapports 189-190)

Frontend (+11 → **123 tests / 28 fichiers**) ; **backend inchangé**.
- `packages/api-client/src/manager/mailTemplatesApi.test.ts` (6) — endpoints `/api/gestion/mails` (list/get/versions/draft/publish/archive/rollback), `getTemplateRoleBinding` (rôles, **aucun e-mail**), `previewMailTemplate` (front : interpolation + détection variables inconnues, aucun envoi).
- `apps/manager/src/features/mailTemplates/mailTemplates.test.tsx` (5) — liste en cards + rôles from→to sans e-mail, blocage admin (dev-only), éditeur (chargement, warning variable inconnue, device toggle mobile/desktop), save→draft + publish (API), page versions.
- `apps/manager/src/features/mailTemplates/noHardcodedHex.test.ts` (1) — aucun hex dans les `.tsx`.

## Sprint M5 — Theme Studio React (rapports 187-188)

Frontend (+19 → **112 tests / 25 fichiers**) + backend (controller étendu → +6).
- `packages/api-client/src/manager/themeStudioApi.test.ts` (6) — mapping panel↔manager, URLs CRUD, body (scope backend + tokens visuels), getActive null.
- `apps/manager/src/features/themeStudio/themeStudio.test.tsx` (7) — dashboard 2 thèmes, blocage admin (dev-only), éditeurs vitrine/panel chargés, **preview live** à la modification d'une couleur, sauvegarde → updateTheme (PUT), pas de `<table>`.
- `apps/manager/src/features/themeStudio/noHardcodedHex.test.ts` (1) — aucun hex dans les .tsx.
- `tests/p1/themeStudioApi.test.js` (6) — persistance typography/radius/shadow/spacing (create+update), activation + GET public, scope manager, admin interdit (403), spacing robuste.
- Note : `communication/noHardcodedHex.test.ts` migré vers `import.meta.glob('?raw')` (typecheck propre).

## Sprint M4 — React Communication Center (rapports 185-186)

Frontend uniquement (backend inchangé). `npm run react:test` : **98 tests / 22 fichiers** (+15) ;
`react:build`, `react:lint`, `typecheck` verts.
- `packages/api-client/src/manager/communicationIdentitiesApi.test.ts` (6) — URLs/scopes (admin→commerciale, dev→support), bodies, liste vide.
- `packages/api-client/src/manager/mailSupervisionScope.test.ts` (3) — base admin vs dev, mapping du `/dev/send-logs` legacy `{logs}` → `SendLogSummary`.
- `apps/manager/src/features/communication/communication.test.tsx` (6) — dashboard admin, blocage admin sur `/dev/communication`, dev OK, journal en **cards** (pas de `<table>`), création identité (POST `/commerciale`), aucune fuite d'e-mail (recipientHash).
- `apps/manager/src/features/communication/noHardcodedHex.test.ts` (1) — aucun hex couleur dans les `.tsx`.

## Sprint M3E — Supervision MailEventDelivery + SendLog (rapports 183-184)

Backend (+29) + frontend (+5). Lecture seule ; aucun envoi ; Brevo non sollicité :
- `tests/p1/mailSupervisionService.test.js` (10) — dev voit tout / admin masque la plateforme (commission) ; filtres status/event/template ; limit borné 100 ; détail safe + corrélation SendLog ; send-logs denylist admin.
- `tests/p1/mailSupervisionRoutesDev.test.js` (7) — endpoints dev (mail-deliveries[/:id|/stats], send-logs/stats), `/dev/send-logs` existant conservé ; admin/client refusés (403).
- `tests/p1/mailSupervisionRoutesAdmin.test.js` (6) — endpoints admin (roleView=admin) ; plateforme exclue ; détail hors audience → 404 ; client interdit.
- `tests/p1/mailSupervisionPrivacy.test.js` (2) — aucun e-mail complet, aucun secret/payload ; recipientHash + providerMessageId exposés ; senderRole/recipientRole depuis tags.
- `tests/p1/mailSupervisionStats.test.js` (4) — byStatus/byEvent, shadow/active (mode règle), failuresLast24h, date range.
- Frontend : `frontend-react/packages/api-client/src/manager/mailSupervisionApi.test.ts` (5) — client typé (listMailDeliveries/getMailDeliveryDetail/getMailDeliveryStats/listSendLogs/getSendLogStats), fetch mocké.

## Sprint M3D — Alignement & activation booking.confirmed (rapports 181-182)

Backend (13 nouveaux tests), Brevo mocké, aucun vrai e-mail. 2e flux migré (`booking.confirmed`),
aligné sur tous les chemins de confirmation, piloté par `MAIL_ROLE_RESOLVER_ENABLED` :
- `tests/p1/mailEventActivationBookingConfirmed.test.js` (4) — flag true → e-mail engine (SendLog `role-engine`/`from:commerciale`, ledger `sent`) ; flag false → moteur no-op ; commerciale absente → `identity_missing` ; client sans e-mail → `client_missing`.
- `tests/p1/bookingConfirmedEventAlignment.test.js` (3) — règle active ; l'event porte contextType `service_booking` + related IDs (resolver-ready) ; deux bookings distincts (checkout + report) → deux confirmations (`contextId` discrimine).
- `tests/p1/mailEventBookingVariableParity.test.js` (3) — `buildBookingConfirmedVariables` parité legacy (servicename, dates, practitionername, cancellationdays, paymenttype, depositamount, remainingamount), pas d'e-mail dans variables ; booking introuvable → null.
- `tests/p1/mailEventBookingIdempotence.test.js` (3) — replay (même booking) → 1 e-mail ; report (nouveau booking) → 2 confirmations ; concurrent (même booking) → 1.
- Maintenance : l'ancien `mailEventActivationBooking.test.js` (M3C, « booking reste shadow ») supprimé ; `mailEventDeliveryIdempotence.test.js` repointé sur `sale.finalized` (règle shadow, intention inchangée).

## Sprint M3C — Activation e-mail événementiel (rapports 179-180)

Backend (+14), Brevo mocké (getCredential + fetch), aucun vrai e-mail. 1er flux migré
(`refund.succeeded`) du direct vers le moteur M2, piloté par `MAIL_ROLE_RESOLVER_ENABLED` :
- `tests/p1/mailEventActivationRefund.test.js` (6) — flag true → e-mail engine (SendLog `role-engine`/`from:commerciale`, ledger `sent`, direct non envoyé) ; flag false → direct legacy (pas de ledger) ; variante service → `refund_confirmed_service` ; replay → 1 e-mail ; commerciale absente → `identity_missing` ; client absent → `client_missing`.
- `tests/p1/mailEventActivationBooking.test.js` (3) — `booking.confirmed` reste **shadow** (non migré, misalignement) ; `buildBookingConfirmedVariables` parité (client + servicename, pas d'e-mail dans variables).
- `tests/p1/mailEventVariableParity.test.js` (3) — `buildRefundSucceededVariables` produit les mêmes variables que le direct (via `buildCommonMailVars`), variante service/non-service, aucun e-mail/secret, refund introuvable → null.
- `tests/p1/mailEventActivationRollbackFlag.test.js` (2) — rollback : flag false → direct + event émis + 0 ledger ; flag true → moteur + ledger `sent`. L'event `refund.succeeded` est toujours émis.
- Aucune régression : les tests M2 existants (sale.finalized/booking.confirmed restent shadow) inchangés.

## Sprint M3B — Event Context Enrichment (rapports 177-178)

Backend (+30), aucun vrai e-mail, EventLog non cassé (additif) :
- `tests/p1/eventContextSchema.test.js` (4) — `createEventContext` (forme + defaults + stringify IDs), contextTypes connus, listes de clés (related/actors/sensitive).
- `tests/p1/eventContextBuilder.test.js` (9) — builders sale/booking/refund/commission/gift_card produisent le contexte standard (related IDs + variables) ; `sanitizeEventContext` retire e-mail/secret/token/password/code ; `clientName` toléré + flaggé ; entrée null sûre.
- `tests/p1/businessEventContextEnrichment.test.js` (6) — chaque emitter attache `payloadSafe.context` (related IDs + variables) ; EventLog sans e-mail/secret ; clés legacy conservées.
- `tests/p1/mailEventContextResolver.test.js` (7) — `resolveClientForEvent` retrouve le client via sale (`Sale.customer`)/booking (`ServiceBooking.clientId`)/refund (`userId`/`saleId` fallback) ; `resolveCommercialeForEvent` via identité M1 ; introuvable → null ; `resolveMailContextForEvent` (pont M2). Aucun envoi.
- `tests/p1/notificationContextEnrichment.test.js` (4) — `triggerNotification({event})` persiste `eventId/eventName/contextType/contextId` ; subscriber corrèle + garde `targetRole` admin ; replay → 1 seule notif ; aucun SendLog.
- Ajustement : `businessEventPayloadSafety` inclut la clé `context` (vérifiée sans PII).

## Sprint U3 — UnifiedCheckout plateforme Stripe Dev (rapports 154-155)

- `platformCheckoutFeatureFlag.test.js` (+2) — `PLATFORM_CHECKOUT_HOSTED` false → clientSecret (Dev) ; true → url hosted (commission).
- `platformCommissionHostedCheckout.test.js` (+2) — Session Dev + UnifiedCheckout commission + metadata ; netAmountDue=0 → settled_zero.
- `platformLaunchFeeHostedCheckout.test.js` (+1) — Session Dev (payment) + UnifiedCheckout launch_fee + ContractCheckoutIntent.
- `platformSubscriptionHostedCheckout.test.js` (+1) — Stripe Checkout mode setup + UnifiedCheckout subscription + ContractCheckoutIntent monthly.
- `platformCheckoutWebhookFinalization.test.js` (+3) — `checkout.session.completed` réconcilie l'UC ; commission `payment_intent.succeeded` finalise (existant) ; replay idempotent ; metadata inconnue → 200.
- Client Stripe Dev mocké via `utils/stripeDevClient` ; flag off = anciens flows Dev byte-identiques ; Stripe Institut non impacté.

## Sprint U2 — UnifiedCheckout câblé + Stripe Checkout hébergé (rapports 152-153)

- `hostedCheckoutFeatureFlag.test.js` (+2) — `CHECKOUT_HOSTED` false → clientSecret Elements ; true → url hosted (aucun secret).
- `hostedCheckoutSessionCreation.test.js` (+1) — Session `mode:payment`, `line_items.unit_amount=amountToPay`, metadata checkoutId, UnifiedCheckout `payment_pending`.
- `hostedCheckoutGiftCardZero.test.js` (+2) — 100 % carte cadeau → `mode:free` (aucune Session) ; partielle → Session pour le reste (carte cadeau jamais un discount).
- `hostedCheckoutWebhookFinalization.test.js` (+3) — `checkout.session.completed` finalise via `processCheckoutStatePurchase`, replay idempotent, metadata inconnue → 200.
- `unifiedCheckoutLiveWiring.test.js` (+3) — flag off : aucun UnifiedCheckout + clientSecret ; flag on : UnifiedCheckout créé + hosted ; finalize-free intact.
- Le client Stripe est mocké via `stripeConfigService.getStripeClient` ; flag off = comportement byte-identique (fallback Elements).

## Sprint U1 — Fondations UnifiedCheckout (rapports 150-151)

- `unifiedCheckoutModel.test.js` (+6) — modèle : requis/enums/défauts, `checkoutId` unique,
  `idempotencyKey` unique **partiel**, aucun password stocké.
- `unifiedCheckoutFactory.test.js` (+4) — factory : snapshots pricing/tax/legal présents,
  sanitisation (pas de password carte cadeau).
- `unifiedCheckoutInstituteKinds.test.js` (+5) — product/formation/gift_card/cart/service → bon kind.
- `unifiedCheckoutIdempotence.test.js` (+3) — même idempotencyKey → même checkout (concurrence incluse).
- `unifiedCheckoutParity.test.js` (+3) — endpoints publics inchangés (finalize-free 401/400,
  create-checkout-session 401, config) + finaliseur unifié réutilise `processCheckoutStatePurchase`
  (même Sale). Moteur **non câblé** aux endpoints live en U1.

## Plan UnifiedCheckout + React parallèle (rapports 143-149)

Documentation + scaffold uniquement (aucun test ajouté/modifié, aucun code backend). Le futur
moteur **UnifiedCheckout** (143/144) réutilisera les **finalizers existants** déjà couverts par les
353 tests (processCheckoutStatePurchase, finalizeCommissionPaymentById, handlers contrat) → la
parité Sale/booking/commission/contrat sera validée par des **tests de caractérisation** au moment
de l'implémentation (mission dédiée). E2E React : Playwright (rapport 140), non installé.

## Audit React & architecture cible (rapports 133-142)

Documentation uniquement (aucun test ajouté/modifié). Plan E2E **Playwright** (non installé)
défini au rapport 140 : 16 scénarios critiques (login manager, onboarding contrat, checkout
Stripe/0€/carte cadeau, distanciel, remboursement, paiement commission, blocages site/suspension/
maintenance, accès dev). Le gate principal reste les **353 tests Vitest backend** ; l'E2E
validera l'intégration front↔API avant chaque bascule de domaine React.

## Sprint F3B — Split interne de mailService (rapports 131-132)

- `mailServiceCharacterization.test.js` (+4) — **caractérisation avant split** (verte avant/après) :
  `postToBrevo` (endpoint Brevo + header `api-key` + SendLog sent/failed, **aucun email/clé en clair**),
  `loadTemplate` fallback défaut, `sendPasswordResetEmail` bout-en-bout (rendu → payload Brevo).
- `mailService.js` 3845 → 49 lignes (**façade**) ; scindé en `services/mail/` : `mailRenderer`,
  `mailTemplateRuntime`, `mailBrevoGateway`, `mailDomainDispatchers`, `mailTrackingService`,
  `mailContextResolver`. Isolation : `fetch`/`api-key` → gateway, `EmailTemplate` → runtime,
  SendLog → tracking. Les tests qui mockent `mailService` restent valides (façade re-exporte l'API).

## Sprint F3A — Extraction facturation contrat (rapports 129-130)

- `contractBillingCharacterization.test.js` (+11) — **caractérisation écrite AVANT extraction**
  (verte avant ET après), fige le contrat HTTP de la facturation contrat : getStripeDevConfig,
  createLaunchIntent (+409 déjà payé), createMonthlySetup, verifyLaunch/MonthlySetup,
  checkPaymentStatus (steps), activate (+lockedUntil null), cancel (period-end vs immédiat), sync.
- `contractController` 1098 → 687 lignes ; facturation extraite vers
  `services/stripe/dev/stripeDevContractBillingService` + `stripeDevContractSyncService` +
  `services/contract/{contractStateService,contractResponseMapper}`. Client Dev via le shim
  `utils/stripeDevClient` (mocks inchangés) ; aucun secret réel.

## Sprint F2B — Extraction Stripe Dev / plateforme (rapports 127-128)

- `stripeDevExtractionParity.test.js` (+5) — extraction structurelle du domaine Dev/plateforme :
  identité référentielle (`utils/stripeDevClient` shim === `stripeDevConfigService`), contrôleur
  webhook délégateur, publishable key Dev inchangée, et **accountPurpose** (`stripe-dev→platform_billing`,
  `stripe-institut→customer_payments`, `brevo→messaging`, legacy→null).
- `stripeDevWebhookExtractionParity.test.js` (+4) — routing webhook Dev inchangé : client absent → 500,
  signature invalide → 400, event non géré → 200 `{received:true}`, résultat structuré du service.
- `commissionDevWebhookFinalization` / `commissionPaymentIdempotence` / `commissionPaymentRefresh`
  (inchangés) : mockent `utils/stripeDevClient` (le shim reste l'accesseur mockable) — aucun secret réel.

## Sprint F2 — Extraction Stripe (rapports 125-126)

- `stripeControllerExtractionParity.test.js` (+4) — le contrôleur `stripeController` (1727 → 135
  lignes) n'est qu'un délégateur : la logique vit dans `services/stripe/*`. Vérifie les 7 handlers,
  `GET /config` 200/500, createCheckoutSession 401, **aucun secret exposé**.
- `stripeWebhookExtractionParity.test.js` (+4) — routing webhook inchangé après extraction :
  signature invalide → 400, event non géré → 200 `{received:true}`, résultat structuré
  `{status, json}` du service, `payment_intent.payment_failed` sans id → 200.
- Domaine couvert inchangé (idempotence PI/refund, secret coffre, failure log safe, pricing
  serveur, amount tampering, invoices officielles) par les suites existantes, toutes vertes.

## Sprint F1 — Extraction Checkout (rapports 123-124)

- `checkoutExtractionParity.test.js` (+4) — prouve que l'extraction du domaine Checkout hors de
  `clientController` (3253 → 1707 lignes) est **purement structurelle** :
  (1) **identité référentielle** — `checkoutFacade.X === sousService.X` pour les 11 fonctions
  ré-exportées (une seule définition, aucune duplication) ;
  (2) **contrat HTTP `finalize-free` inchangé** — 401 sans auth, 400 `CHECKOUT_STATE_REQUIRED`,
  402 `PAYMENT_REQUIRED` (solde dû).
- Les 8 suites qui finalisaient via `processCheckoutStatePurchase` importent désormais ce
  finaliseur depuis `services/checkout/checkoutFacade.js` (au lieu de `controllers/clientController.js`) —
  aucun changement de comportement, mêmes assertions.
- Domaine couvert inchangé (Stripe checkout, 0 €, carte cadeau, acompte, consentement, slot,
  distanciel, promotion, webhook idempotent) par les suites existantes.

## Pré-React E1-E2 (rapports 120-122)

- **E1 — Promotion source unique DÉFINITIVE** : `promotionMigrationService.test.js` et
  `promotionSingleApplication.test.js` mis à jour — le fallback legacy `Service.promotion` a
  disparu du runtime. `resolveEffectiveServiceUnitPrice` sans Promotion(service) → **prix
  plein** (`source: null`) ; une Promotion(service) fait foi. Migration dry-run/`--apply`
  toujours validée (idempotence).
- **E2 — Refactor SEAM-FIRST (zéro changement de comportement)** : `planGiftCardUsage` /
  `finalizeGiftCardUsage` déplacés vers `services/checkout/checkoutGiftCardService.js` ; les
  11 sites d'appel dans `clientController` (couverts par les tests checkout/webhook/0 €)
  passent inchangés par import. Seams re-export `services/stripe/*Facade.js` et
  `services/mail/mailDispatcher.js` (consommés par clientController). Aucun test nouveau requis
  (extraction structurelle), suite **317 verte** inchangée.

## Pré-React D1-D4 (rapports 115-119)

- `promotionMigrationService.test.js` (D1) — Promotion source unique (priorité Promotion,
  fallback Service.promotion legacy, jamais les deux) ; migration dry-run/--apply.
- `giftCardUsageReceipt.test.js` (D2) — commande 100 % carte cadeau → reçu interne non fiscal
  (`gift_card_usage_receipt`) ; facture officielle = Stripe ; label 293 B.
- `depositPaymentFlow.test.js` (D3) — acompte autorisé si `pay_on_site` (sinon bloqué) ;
  solde tracé ; remboursement capé à l'acompte ; `markBalancePaidOnSite`.
- `businessHistoryCleanup.test.js` (D4) — dry-run ne supprime rien ; `--apply` cible les
  collections transactionnelles ; configuration (Service…) toujours intacte.

## Unification promotions + base commission (rapports 113-114)

- `promotionSingleApplication.test.js` — une seule promotion (pickSinglePromotion meilleure
  réduction) ; Promotion/Service.promotion disjointes (pas de cumul) ; promo expirée ignorée.
- `giftCardPaymentNotDiscount.test.js` — carte cadeau = moyen de paiement (ne réduit ni
  soldPrice ni commissionBase) ; capée au prix vendu ; stripe = sold − giftCard.
- `commissionBaseIncludesGiftCard.test.js` — base commission = soldPrice quel que soit le
  split carte cadeau/Stripe ; remboursement partiel → déduction proportionnelle sur la base.
- `invoiceGiftCardPaymentLine.test.js` — ligne facturée = prix vendu ; carte cadeau =
  règlement séparé ; facture officielle = Stripe.

## Pré-React C1-C3 (rapports 107-112)

- `giftCardRecreditRecovery.test.js` (C1) — reprise `rollback_needed` (réussie, idempotente
  sans double-crédit, balayage, échec persistant → compteur, refund succeeded intact).
- `stripeInvoicesOfficialSource.test.js` (C2) — facture officielle = Stripe ; PDF interne
  non fiscal ; 0 € sans facture officielle ; commission Stripe Dev ; label 293 B.
- `distanceLearningLifetimeAccessRefund.test.js` (C3) — distanciel sans renonciation refusé ;
  accès immédiat → granted/lifetime + snapshot légal ; remboursement après accès refusé.

## Correction commissions (rapports 104-106)

Six suites `p1` valident l'unification de la facturation des commissions :
- `commissionMonthlySourceOfTruth.test.js` — source unique (gross/refundDeduction/netAmountDue),
  carte cadeau + promo incluses, ligne négative refundId+saleId, ledger non facturant.
- `commissionCarryOver.test.js` — report négatif (facture 0 € + carry-over appliqué le mois suivant).
- `commissionPaymentRefresh.test.js` — refresh obligatoire avant PaymentIntent ; settled_zero.
- `commissionPaymentIdempotence.test.js` — double-clic concurrent → un seul PaymentIntent ; mois payé → 409.
- `commissionDevWebhookFinalization.test.js` — webhook Dev finalise (idempotent) ; polling fallback.
- `integratedApiAccountPurpose.test.js` — accountPurpose seedé + backfill.

Harnais `npm run audit:commissions` (20 probes) mis à jour : C11/C17 caractérisent désormais
le comportement **corrigé** (carry-over, refresh).

## Audit pré-React — matrice de scénarios métier (rapports 89-96)

Harnais **exploratoire et isolé** : `tests/audit/businessScenarioMatrix.test.js`
(**36 probes de caractérisation** vertes). Couvre créneaux/locks multi-praticiennes,
éligibilités remboursement, split carte cadeau, commission (A5), promotions, garde-fous
offres (A7), consentement (A1), observabilité webhook (A6), anti-doublon remboursement.

- Lancement dédié : `npm run audit:business-scenarios` (config `vitest.audit.config.js`).
- **Exclu** de `npm test` (via `exclude: ['tests/audit/**']` dans `vitest.config.js`) pour
  qu'un scénario révélant un FAIL/FRAGILE ne casse jamais le CI P0/P1/integration.
- Chaque probe fige le comportement OBSERVÉ ; les risques (PASS/FAIL/FRAGILE/INDÉTERMINÉ)
  sont classés analytiquement dans le rapport 90.

### Audit commissions (rapports 99-103)

`tests/audit/commissionScenarioMatrix.test.js` (**20 probes** vertes), lancé via
`npm run audit:commissions`. Couvre : base de calcul (prix payé, carte cadeau incluse, promo),
remboursements avant/après commission, cross-mois, ledger vs facturation (doublon),
montant figé (refresh non câblé), clamp à 0, idempotence/doublon, 0 €. Caractérisation :
vert = comportement observé ; les FRAGILE (C11 clamp, C14 doublon ledger, C17 montant figé)
sont documentés dans les rapports 99/102/103.

## Safety (no real secrets / no real DB)

- `tests/setup/testEnv.js` sets fake values for every sensitive env var **before**
  `app.js` runs `import 'dotenv/config'`. Since dotenv does not override existing
  vars, the real `.env` values can never enter a test run.
- `tests/setup/testApp.js` refuses to boot unless `MONGODB_URI` points to a local
  in-memory server (guards against connecting to a real cluster).
- The mail service is mocked or outbound HTTP is stubbed in tests that would
  otherwise send email.
- `app.js` skips background schedulers and `app.listen()` when `NODE_ENV==='test'`.


## M11A — Checkout global booking (rapports 199-200)

Quatre fichiers `tests/p1/` couvrent le branchement du checkout prod sur le calendrier global institut :
- `checkoutGlobalBookingProduction.test.js` — webhook Stripe + finalize-free creent une booking GLOBALE (practitionerId = institut) + BookingSlotLock institut ; Sale = montant catalogue.
- `checkoutGlobalBookingLegacyPayload.test.js` — practitionerId legacy bidon / absent dans le checkoutState : accepte mais IGNORE (rattachement institut).
- `globalBookingAvailabilityOfficial.test.js` — GET availability/slots sans practitionerId, practitionerId legacy sans effet, double-booking global bloque (409).
- `globalBookingNoPractitionerRegression.test.js` — route directe POST /api/client/bookings sans/avec practitionerId legacy, assertGlobalServiceSlotBookable sans practitionerId, regression acompte/remboursement (Sale = acompte, solde trace).


## M11B — Finalisation calendrier global (rapports 201-202)

Cinq fichiers tests/p1/ : adminBookingRescheduleGlobal (HTTP admin -> 200 + deplacement EN PLACE + locks deplaces + 409/400/404 ; verifie le correctif mount-order M3A), refundRescheduleGlobalBooking (applyFlowServiceRescheduleDecision -> booking global, sans practitionerId, double-booking 409), practitionerLegacyCleanup (dry-run sans ecriture / --apply consolide+archive sans delete / idempotent / --create-global-index), globalBookingIndexes (index {startAt,status} + unique {practitionerId,startAt} + double-booking global + index global unique slotStartAt), noRuntimePractitionerDependency (dispo/assert/create/checkout/reschedule sans practitionerId). Front : calendarApiReschedule.test.ts + planningReschedule.test.tsx (UI report mobile, loading/error/success, pas de table, pas de texte prestataire/praticienne).


## M12 — Customer 360 (rapports 203-204)

Cinq fichiers tests/p1/ : customer360Service (agregation toutes sections + KPIs + 404/400), customer360Timeline (fusion multi-types + tri desc + cap + curation EventLog), customer360Financial (totalSpent/acomptes/soldes/cartes/remboursements/facture/impayees), customer360Route (HTTP admin -> 200, verifie le mount-order M3A ; recherche ; 404/400 ; client refuse), customer360Privacy (aucun secret/PII ; communications sans e-mail/hash ; identite du client expose sur sa propre fiche). Front : customer360Api.test.ts + customer360.test.tsx (recherche/navigation, hero/KPIs/quick/timeline, onglets/accordions/finances, aucune table, drawer) + noHardcodedHex.test.ts.


## M13 — Gift Card 360 + Manual Booking + Template Studio (rapports 205-206)

Quatre fichiers tests/p1/ :
- `giftCardQrService.test.js` (pur) — le payload QR ne contient JAMAIS le code/mot de passe/montant ; token opaque + hash sha256 ; parse rejette les payloads invalides ; rotation change le hash.
- `giftCardTemplateStudio.test.js` — seed du template par defaut ACTIF (idempotent) ; regle « jamais zero actif » (archive de l'actif interdite, 409 TEMPLATE_ACTIVE_LOCKED) ; selection de l'actif (1 seul) ; versioning draft->publish (archive l'ancien, l'actif suit) ; studio dev-only (admin 403 / dev 200) ; librairie admin (liste + activate).
- `giftCardManualFlows.test.js` — creation manuelle (201, paymentMode=on_site, paymentLabel, code+mot de passe, transaction manual_issued, AUCUNE Sale ni Invoice Stripe, qrTokenHash sans le code, event gift_card.manual_created) ; recipientName obligatoire (400) ; debit manuel par id (motif obligatoire 400, refus > solde 409, preview sans ecriture, debit reel + event) ; lookup par code (GET) et par QR ; QR invalide 404.
- `manualBookingFlows.test.js` — reservation manuelle (201, source=manual_institute, paymentMode=on_site, confirmed, pay_on_site, pas de Sale, verrous permanents) ; anti-double-booking (409 SLOT_UNAVAILABLE) ; hold temporaire (verrou hold + expiresAt, 2e hold refuse, release) ; confirmation avec holdToken.

GC-TPL-AUDIT — 5 fichiers tests/p1/ (livraison PDF depuis le template ACTIF) :
- `giftCardTemplateActiveSeed.test.js` — `ensureDefaultGiftCardTemplate` : seed BeautySavage Classic actif au 1er boot ; activation du meilleur candidat si publies sans actif (sans doublon) ; idempotence + ne desactive jamais l'actif ; resolver OrSeed/assert garantit un actif.
- `giftCardTemplateDeliveryPipeline.test.js` — `generateGiftCardAssets` : HTML+PDF depuis le template actif, variables resolues, QR reel (img base64) ; seed auto si aucun actif ; preview studio = QR factice (jamais le vrai token), pas de PDF.
- `giftCardOnlinePurchaseTemplate.test.js` — achat en ligne (`createGiftCardForPurchase`) fige `activeTemplateId`, QR reel + PDF, event `gift_card.online_created` SANS secret ; seed auto si aucun actif.
- `giftCardManualTemplateSelection.test.js` — manuel : template actif par defaut + PDF attache + « Paiement sur place » + `manual_issued` ; `templateId` explicite publie fige ce template ; non publie -> 404.
- `giftCardTemplateNoHardcodedPdf.test.js` — le rendu reflete le template ACTIF (marqueur HTML unique), jamais un generique ; template explicite prioritaire.

Note harnais : le seed du template carte cadeau ne tourne PAS en mode test (boot gate) -> les tests appellent seedGiftCardTemplates()/ensureDefaultGiftCardTemplate() explicitement. Le routeur gestion cartes cadeaux est monte AVANT les broad-mounts dev-only (sinon shadow 403 admin, cf. M3A).

Front (apps/manager) : tests des drawers Customer 360 (creation carte / debit code+QR / reservation manuelle+hold / note), du Gift Card Template Studio (preview iframe sandbox), de la librairie admin (badge actif + modal activation), noHardcodedHex.test.ts par feature.


## Sprint P1 — Product Polish & UX (rapports 207-208)

Front uniquement (aucun test backend ajouté ; suites backend inchangées et vertes). Nouveaux tests @bs/ui :
- packages/ui/src/polish/polish.test.tsx (9) — presets de motion (+ vide en reduced-motion), primitives harmonisées (Badge/Chip/IconButton/Skeleton/Spinner : rôles, aria-pressed/busy, aria-label obligatoire), garde zéro-hex sur components.tsx.
- packages/ui/src/polish/polishCss.test.ts (8) — contrats de polish.css : focus-visible global, cible tactile 44px, overflow-x:clip (et PAS hidden → préserve sticky), skip-link, shimmer tokenisé (--bs-motion-shimmer), presets @keyframes, état nav actif.
2 erreurs typecheck pré-existantes corrigées (planningReschedule.test.tsx, M11B). React : 54 fichiers / 237 tests verts, lint/typecheck/build OK.


## C1 — Catalogue Studio + Vitrine (rapports 209-210)

Backend : `tests/p1/catalogueC1.test.js` — duplication prestation (brouillon, slug unique) & formation
(draft, nom unique), single-GET formation (+404), `balanceSettlementMode` (paiement sur place), config
cartes cadeaux `maxAmount`/`presetAmounts` (tri/dédup, min>max → 400), QR session (opaque, idempotent,
régénérable, payload `BS-SESSION:<id>:<token>`), permission client refusée. Note : correctif mount-order
(serviceRouter/availabilityRouter/serviceSettingsRouter remontés avant les broad-mounts dev-only —
`commissionRouter` requireStrictDev shadowait `/services` pour les admins). Suites p0+p1+integration : 699 verts.

Front (apps/manager + packages) : `features/catalogue/validation.test.ts` (statuts par module + blocages),
`catalogue.test.tsx` (dashboard/liste/ModuleStepper/drawer/giftcard, zéro `<table>`), `noHardcodedHex.test.ts`,
`manager/catalogueApi.test.ts` (URLs/méthodes/envelope), `catalog/reviewsApi.test.ts` (avis vitrine). Suite
front : 264 verts ; typecheck/lint/build OK.


## C2 — Learning Studio + Présence (rapports 211-212)

Backend `tests/p1/learningC2.test.js` : computeProgress pur (% chapitre/formation, leçons cachées ignorées),
chapitres/leçons CRUD (distanciel only → 404 sur présentiel), accès apprenant gated par Purchase (403 sans
achat → 200 avec), progression 0→50→100% + completedAt + idempotence, liste mes formations, présence
(token opaque par participant, scan payload BS-PRESENCE → present, participants summary, QR invalide 404),
permissions (client refusé sur endpoints présence manager). Routers montés avant broad-mounts dev-only.

Front : `packages/ui/src/embed.test.ts` (resolveEmbed YouTube/Vimeo/Loom/Wistia/iframe + validation),
`manager/learningApi.test.ts` + `catalog/learningApi.test.ts` (URLs/méthodes), `apps/vitrine/.../player.test.tsx`
(vidéo embed iframe + complétion → %, zéro table), `apps/manager/.../presence.test.tsx` (participants +
marquage), noHardcodedHex ×3. Suite front : 284 verts.


## C3 — Attestations, QR prod, reorder, avis (rapports 215-216)

Backend `tests/p1/learningC3.test.js` (6) : attestation (409 NOT_COMPLETED si non terminée → PDF
application/pdf si terminée, idempotent client+manager, 403 sans achat), modération avis (reject masque la
vitrine via stats/list, avis legacy sans statut reste visible, client refusé sur endpoints modération),
reorder chapitres persiste l'ordre. Front : `manager/reviewModerationApi.test.ts` (list/PATCH + URLs
attestation), `features/reviews/reviews.test.tsx` (cards, masquer, zéro table), `features/learning/qrScanner.test.tsx`
(fallback saisie manuelle + debounce, caméra indisponible en jsdom), `features/learning/player.test.tsx` (bouton
attestation à 100% + href), noHardcodedHex. Suite front : 299 verts.

## S1B — Décommission `.env` (credentials & config métier)
- `p1/integratedApiNoEnvFallbackProd` : le fallback `.env` des credentials est refusé en
  production (`NODE_ENV=production`), autorisé en dev/test seulement si
  `ALLOW_ENV_CREDENTIAL_FALLBACK=true` ; sinon fail-loud.
- `p1/communicationIdentityNoMailFrom` : l'expéditeur (`mailSenderResolver.buildSender`) vient de
  CommunicationIdentity (`commerciale`) ; prod sans identité → `null` (jamais `MAIL_FROM`) ; dev → fallback.
- `p1/systemConfigurationInstituteInfo` : `getInstituteInfo()` lit la config ; en prod le fallback
  `INSTITUTE_*` est ignoré, en dev il est autorisé.
- `p1/envDecommissionRuntime` : garde statique — aucune lecture runtime directe des variables
  décommissionnées ; Stripe/Brevo via `getCredential`. Rapports 217/218.


## RC1 — Release Candidate audit (rapports 219-220)

`tests/p1/rc1MountOrder.test.js` : régression du bug P0 mount-order — admin atteint promotions/boosts/
social-links/home-settings sans 403 (commissionRouter requireStrictDev déplacé en dernier) ; les routes
/api/gestion/commissions/* restent dev-only (admin 403, dev OK). Suppression d'un console.log debug
(refundExecutionService) et du script npm cassé `support:cleanup`. Aucune suite cassée par les quick wins.


## RX1 — React frontend officiel (rapports 221-222)

`tests/p1/rx1ReactFrontend.test.js` : flag OFF (rollback) → `/`→/vitrine.html, /vitrine.html sert Vanilla ;
flag ON → `/`→/app/, /vitrine.html→/app/, /gestion.html→/manager/ ; le serving React ne shadow PAS /api ;
/app & /manager servis en SPA (200 si build, 503 sinon, jamais 404/500). Le flag REACT_OFFICIAL_FRONTEND est
lu dynamiquement → togglé par test (restauré en afterEach). Front : `apps/vitrine/src/pages/myAccount.test.tsx`
(espace compte : profil + hub + déconnexion signOut + non-auth, zéro table). Suite front : 302 verts.

## S1C — NGROK_DOMAIN supprimé + politique Vault uniforme (rapport 224)
- `p1/s1cDomainResolverVaultPolicy` : garde statique (aucun fichier runtime ne lit `NGROK_DOMAIN`,
  le resolver ne lit ni NGROK ni `APP_BASE_URL` ni `process.env`) ; DomainResolver = SystemConfiguration
  → `http://localhost:3000` (premier boot) ; vault clé injectée → OK, clé absente → throw (tout `NODE_ENV`).
- `p1/integratedApiEnvFallbackPolicy` (remplace `…NoEnvFallbackProd`) : fallback `.env` des credentials
  = opt-in flag-only, **identique** dev/test/production.
- `p1/credentialVault` : `validateCredentialVaultKey` throw uniformément (aucune logique d'environnement).
- 9 tests Checkout hébergé : la base publique vient de `SystemConfiguration.domains` (seed en `beforeEach`),
  plus aucun `NGROK_DOMAIN`. `tests/setup/testEnv.js` : plus aucune variable de domaine.

## RX2 — Finance Experience
- `p1/financeDashboard` : instantané dashboard (today/7d/30d, backlog soldes/remboursements/factures).
- `p1/financeTimelineService` : mappers purs + agrégation `buildFinanceTimeline` (tous types, tri, limit).
- `p1/financeTimelineSummary` : `computeSummary` (in/out/net/balanceDue/count/refundCount).
- `p1/financeTimelineNoDoubleCount` : facture non comptée (lien sur la vente), carte cadeau utilisée neutre.
- `p1/financeTimelineRoutes` : `GET /api/gestion/finance/timeline` (admin 200 mount-order, client 403, filtres).

## RX2.3 — Paiements, remboursements, profit net
- `p1/financeMovementDetail` : breakdown + lignes par type (vente/solde/refund/carte cadeau).
- `p1/financeStripeFeesBreakdown` : frais Stripe available/pending/not_applicable (centimes/100, jamais estimés).
- `p1/financeDevCommissionFormationOnly` : commission Dev formations only (prestation = 0, badge).
- `p1/financeNetProfit` : net = payé − frais − commission − remboursements ; partial si frais en attente.
- `p1/financeRefundActionRoute` : POST /refunds/:id/status (accepter/refuser, 409 sans vente, 403 client).
- `p1/financeBalanceCollectRoute` : POST /bookings/:id/balance-paid + moyen de paiement, idempotent, 403 client.

## RX2.4 — Paiements sur place unifiés
- `p1/financeOnSitePayments` : wording mapper (full « Paiement sur place » vs acompte « Solde ») ; timeline
  inclut la prestation manuelle full on-site et exclut les annulées ; dashboard compte les manuelles full on-site.
- `p1/financeBalanceCollectRoute` (étendu) : encaissement d'une prestation full on-site (paymentType full).

## RX2.5 — Commissions premium
- `p1/commissionPaymentTerms` : resolver termes + dates échéance/grace (respecte snapshot).
- `p1/commissionLateStatus` : pending_due/due/grace/overdue/suspension_risk/paid/settled_zero.
- `p1/commissionFinanceOverview` : breakdown, overview (contrat/no-contract), history, detail.
- `p1/commissionFormationOnlyRegression` : prestation = 0 commission, formation comptée.
- `p1/commissionFinanceTimeline` : mouvement commission (commission_view → détail, pas de double-count).
- `p1/commissionStripeDevHostedPayment` : routes finance commission (commission_pay activé/désactivé, 403 client).

## RX2.6 — Gift Card Finance
- `p1/financeGiftCardService` : liste + détail (source paiement, acteurs, solde, transactions, lifecycle, QR masqué).
- `p1/financeGiftCardRoutes` : endpoints admin/dev, 404, 403 client, code masqué.
- `p1/financeGiftCardSplitRefund` : remboursements splittés (mix Stripe+GC, 100% GC, rollback_needed, recovered).
- `p1/financeGiftCardQrPrivacy` : jamais le code/token/mot de passe ; AUCUN libellé « expir ».
- `p1/financeGiftCardTimelineIntegration` : gift_card_refund_recredit + gift_card_recredit_failed (neutral, pas de double-count) + action gift_card_view.

## RX3 Session 3 — Checkout multi-item (frontend, front-only)
- `apps/vitrine/src/features/legal/cartLegalRequirements.test.ts` — moteur légal par item + payload.
- `apps/vitrine/src/features/checkout/buildCartCheckoutState.test.ts` — totaux + carte cadeau capée + shape.
- `apps/vitrine/src/pages/checkoutMultiItem.test.tsx` — gating légal + hosted redirect, gift card apply, session complète bloque.
- `apps/vitrine/src/features/trainingDetail/formationPurchase.test.tsx` — achat présentiel (session obligatoire) / distanciel.
Backend non modifié → aucun test backend ajouté. `npm --prefix frontend-react run test|lint|typecheck|build` verts.

## RX3 Session 4 — Storefront premium
- Front : `apps/vitrine/src/pages/homePremium.test.tsx`, `features/giftcard/giftCardPurchase.test.tsx`,
  `features/giftcard/giftCardPreview.test.tsx` (+ MAJ `pages/catalogPages.test.tsx`).
- Backend : `tests/p1/giftCardPurchaseRecipient.test.js` (persistance bénéficiaire carte cadeau).
Backend touché (minimal) → p1 822 verts + p0/integration/audits.

## RX-RUN / RX-RUN-2 — Lancement & commande unique
- `tests/p1/rxRunLaunchReadiness.test.js` — préflight `evaluateReadiness` (env obligatoires, format vault,
  builds, flag informatif).
- `tests/p1/rxRunOneCommandScripts.test.js` — commande unique : injection flag React (dev/start=ON,
  `--vanilla`=OFF), env non muté, URLs affichées, `build` inclut React, aucun script `run/` n'écrit le `.env`.
Scripts `run/` (dev/start/build) NON lancés en test (bootent l'app réelle) → couverture par helpers purs +
lecture package.json. Cf. `docs/RX_RUN_LAUNCH_AUDIT.md` + `docs/RX_RUN_2_ONE_COMMAND_REPORT.md`.

## RX-BLOCKER-2 — Comptes manager, invitations & routage reset (auth/mail sensibles)
- `tests/p1/managerUsersInvitation.test.js` — accès `/api/gestion/manager-users` (dev 200 / admin 403 /
  client 403 / anonyme refusé), création admin+dev **sans mot de passe** + token **hashé** en DB
  (`tokenHash !== token brut`), 409 doublon, acceptation (GET safe → accept → login) + **usage unique**
  (`400 used`), mots de passe faibles/mismatch/token invalide.
- `tests/p1/authMailSenderRouting.test.js` — routage expéditeur au niveau service : invitation & reset
  **manager → support**, reset **client → commerciale** ; liens `/manager/invitation`,
  `/manager/reinitialiser-mot-de-passe`, `/app` ; **aucun sender hardcodé**.
- `tests/p1/managerPasswordResetRouting.test.js` — `POST /auth/password-reset/request` route par rôle
  (admin/dev → sender manager ; client → sender client), **200 neutre** anti-énumération, reset manager
  **bout-en-bout** (validate → complete → login) + usage unique.
- Front : `apps/manager/src/features/managerUsers/managerUsers.test.tsx` (cards/zéro table, création sans champ
  password, renvoi invitation) + `apps/manager/src/pages/managerAuthPages.test.tsx` (invitation/forgot/reset :
  états valide/faible/expiré/invalide).
- **Brevo mocké partout** (aucun mail réel) ; tokens jamais loggés en clair. Cf.
  `docs/RX_BLOCKER_2_USERS_INVITATIONS_REPORT.md`.

## RX-POLISH-BLOCKER — Manager UX, planning, avis, dev panel

Backend :
- `tests/p1/planningAvailabilitySettings.test.js` — horaires hebdomadaires manager, sauvegarde et lecture.
- `tests/p1/planningDayExceptions.test.js` — blocage journée/créneau, conflits, garde backend autoritaire.
- `tests/p1/reviewManualCreation.test.js` — avis manuel prestation sans faux client, publication/modération,
  exposition publique stats/liste.
- `tests/p1/managerDevPanelRoutes.test.js` — accès dev aux diagnostics utiles, admin autorisé sur les routes
  manager partagées mais refusé sur les diagnostics strictement dev.

Frontend :
- `frontend-react/apps/manager/src/features/planning/managerPlanningCalendar.test.tsx`
- `frontend-react/apps/manager/src/features/planning/managerPlanningAvailability.test.tsx`
- `frontend-react/apps/manager/src/features/planning/bookingDetailAmounts.test.tsx`
- `frontend-react/apps/manager/src/features/devPanel/devPanelNoEmptyComingSoon.test.tsx`
- `frontend-react/apps/vitrine/src/features/account/pawRatingEverywhere.test.tsx`
- Mises à jour :
  `frontend-react/apps/manager/src/features/reviews/reviews.test.tsx`,
  `frontend-react/apps/vitrine/src/features/serviceDetail/serviceDetail.test.tsx`,
  `frontend-react/packages/api-client/src/catalog/reviewsApi.test.ts`,
  `frontend-react/packages/api-client/src/manager/reviewModerationApi.test.ts`.
