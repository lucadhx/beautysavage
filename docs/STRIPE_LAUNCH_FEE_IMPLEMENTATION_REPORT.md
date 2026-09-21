# Rapport d'implémentation — LOT F : Stripe Checkout des frais de lancement

Mission : brancher **Stripe Checkout** pour le **paiement unique** des frais de
lancement, avec un vrai parcours testable (contrat signé → Checkout TEST → webhook
→ badge « Payé »). Sans abonnement, résiliation, activation de site, factures
périodiques ni Brevo.

## 1. Analyse de l'existant

Le socle était déjà largement présent (module contrats + IntegratedAPI + webhooks
signés + parcours Yousign terminé) :

- **Existait** : `stripe.service.createLaunchFeeCheckout` (mode `payment`, TTC,
  metadata providerMode/applicationEnvironment, idempotence par contrat) ;
  `contract.admin.controller.createLaunchCheckout` (URLs depuis
  `SystemConfiguration.network.managerUrl`) ; webhook `checkout.session.completed`
  (frais → PAID minimal) ; `ContractReturnPage` (polling activation) ; modèle
  `Payment` minimal ; projection `contract.stripe.launchFee`.
- **Manquait** (comblé par ce lot) : journal `Payment` robuste (mode, bloc Stripe,
  idempotence, PROCESSING/CANCELLED/EXPIRED, index d'unicité) ; gate backend
  structuré ; réutilisation idempotente + anti double-clic ; événements asynchrones
  / PaymentIntent / remboursement / expiration ; cohérence de mode par paiement ;
  réconciliation des frais ; endpoint de statut ; UI ADMIN/DEV enrichie ; page de
  retour spécifique au paiement ; tests dédiés ; scripts.

## 2. Documentation Stripe consultée

Checkout Sessions en mode `payment` ; `payment_status` vs statut du PaymentIntent ;
paiements asynchrones (`checkout.session.async_payment_succeeded/failed`) ;
`checkout.session.expired` ; `payment_intent.succeeded/payment_failed` ;
`charge.refunded` ; clés d'idempotence ; metadata ; `success_url`/`cancel_url` avec
`{CHECKOUT_SESSION_ID}` ; récupération d'une Checkout Session / d'un PaymentIntent.
Aucune donnée sensible (clé, `whsec_`, token) n'est reproduite ici.

## 3. Roadmap exécutée

F1 modèle/état · F2 service Stripe + stub/provider · F3 webhooks · F4 endpoints +
réconciliation · F5 frontend · F6 tests + scripts · F7 documentation. Tout exécuté.

## 4. Modèles créés/étendus

- **Payment** (étendu) : `providerMode`, `applicationEnvironment`, `stripe.*`,
  `idempotencyKey`, `attempt`, `contractVersion`, `lastError`, `cancelledAt` ;
  statuts `PROCESSING/CANCELLED/EXPIRED` ajoutés ; index **unique**
  `stripe.checkoutSessionId` (partiel) + `contractId+type+status`.
- **Contract.stripe.launchFee** (étendu) : `paymentId`, `attempt`, `lastError` ;
  statut projeté `LAUNCH_FEE_STATUS` (ajoute `NOT_REQUIRED`, `CHECKOUT_CREATED`).
- Constantes : `PAYMENT_STATUS` (+3), `LAUNCH_FEE_STATUS`, actions d'audit paiement.

## 5. Machine à états du paiement

`PENDING → PROCESSING → PAID` ; `PAID → REFUNDED` ; `PENDING/PROCESSING → FAILED` ;
`PENDING → EXPIRED | CANCELLED`. `PAID`/`REFUNDED` terminaux (non rétrogradés).
Détail : [STRIPE_LAUNCH_FEE_FLOW.md](./STRIPE_LAUNCH_FEE_FLOW.md) §3.

## 6. Création Checkout, idempotence, metadata

Session `mode: payment`, `unit_amount` = **TTC du snapshot verrouillé**, description
claire. Metadata : `contractId`, `paymentType`, `providerMode`,
`applicationEnvironment`, `paymentId` (aucun secret). Clé d'idempotence stable
`launch-<id>-v<version>-a<attempt>-<mode>`. Réutilisation d'une session ouverte
(anti double-clic) ; garde-fou index unique + gestion E11000.

## 7. Gestion des retours

Page `/contrat/retour-paiement` : interroge `launch-fee-status`, polling 2 s / ~30 s
puis « Vérifier à nouveau ». La présence de `session_id`/`status=success` ne vaut
jamais confirmation.

## 8. Événements Stripe traités & statut HTTP

`checkout.session.completed`, `…async_payment_succeeded`, `…async_payment_failed`,
`…expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`,
`charge.refunded`. Signature invalide → **400** ; événement authentique sans
contrat → **2xx** (ignoré) ; rejeu → `{ duplicate: true }` (2xx) ; erreur de
traitement → **500** (Stripe réessaie, idempotence protège).

## 9. Paiements asynchrones

Jamais `PAID` prématurément : `checkout.session.completed` non payé → `PROCESSING` ;
l'événement `async_payment_succeeded`/`failed` (ou le PaymentIntent) fait foi.

## 10. Synchronisation

`npm run payments:sync` + `POST /contracts/:id/sync-payment` (+ intégré à
`/contracts/:id/sync`). Idempotente ; relit session + PaymentIntent ; ne crée
jamais de paiement.

## 11. Timeline / ADMIN / DEV

Timeline : session créée, en cours de confirmation, frais payés, échoué, annulé,
remboursé (dédupliqués via l'idempotence webhook). ADMIN : badge + CTA
Payer/Reprendre/Réessayer, montant HT/TVA/TTC. DEV : panneau Stripe (statut, mode,
identifiants raccourcis, erreur sûre, synchronisation).

## 12. Cohérence de mode

Secret par mode actif (repli contrôlé, acquitté-mais-ignoré si mode ≠ actif). En
complément : un événement d'un mode ne modifie jamais un `Payment` d'un autre mode.

## 13. Tests automatisés

`npm run test:payments` — **55 assertions**, provider simulé, **aucun appel réel**.
Suite complète backend **verte** : `npm test` (promote 54, integrated-api 62,
env-independence 4, contracts 38, yousign 34, yousign-flow 42, stripe 29,
**payments-flow 55**, lifecycle 43, stripe-cli 35, smoke 102).

## 14. Test Stripe TEST réel

Script fourni : `npm run stripe:test:launch-fee -- <contractId>` (refuse hors mode
TEST, exige un contrat de test signé, crée une vraie session TEST sans paiement
réel, masque les secrets). **Non exécuté dans ce rapport** faute de clé sandbox
réelle et de contrat signé sandbox dans l'environnement d'exécution — aucun succès
n'est fabriqué. Procédure manuelle : ouvrir la page contrat ADMIN → payer avec une
carte de test Stripe → attendre le webhook (`npm run dev` + Stripe CLI) → vérifier
le badge « Payé », le `Payment`, la timeline, puis l'idempotence par rejeu.

## 15. Builds & typechecks

Manager : `tsc -b --noEmit` **OK**, `vite build` **OK**. Backend : suite de tests
autonome verte.

## 16. Fichiers créés / modifiés

**Créés** : `backend/src/services/payment.service.js`,
`backend/src/scripts/payments-flow.test.js`, `backend/src/scripts/payments-sync.js`,
`backend/src/scripts/stripe-launch-fee.js`, `docs/STRIPE_LAUNCH_FEE_FLOW.md`, ce
rapport.

**Modifiés (backend)** : `utils/contractConstants.js`, `models/Payment.model.js`,
`models/Contract.model.js`, `middlewares/error.middleware.js`,
`services/stripe/stripe.service.js`, `services/stripe/stripe.stub.js`,
`services/stripe/stripe.provider.js`, `services/contractWebhook.service.js`,
`services/contract.service.js`, `services/reconciliation.service.js`,
`controllers/contract.admin.controller.js`, `controllers/contract.dev.controller.js`,
`routes/myContract.routes.js`, `routes/contract.routes.js`,
`scripts/contracts.test.js`, `package.json`.

**Modifiés (manager)** : `types/index.ts`, `lib/api.ts`,
`components/contracts/status.tsx`, `pages/MyContractPage.tsx`,
`pages/ContractReturnPage.tsx`, `pages/dev/DevContractsPage.tsx`.

**Docs mis à jour** : README, API, ARCHITECTURE, CONTRACTS, STRIPE_INTEGRATION,
WEBHOOKS, CONTRACT_ACTIVATION_FLOW, INTEGRATED_API, RAPPORT.

## 17. Commits

```
bdfda18 feat(payments): add launch fee payment model, state and structured errors
c4ff52f feat(stripe): create and reconcile launch fee checkout sessions
0d609da feat(webhooks): process Stripe launch fee payment events
b487210 feat(api): launch fee status, checkout and DEV payment endpoints
8f7df0b test(payments): cover launch fee lifecycle
84e63c7 feat(manager): add launch fee payment flow (ADMIN & DEV)
docs(stripe): document launch fee checkout flow  (ce lot documentaire)
```

Backend + frontend poussés sur `origin/main` (commits ci-dessus). Le commit de
documentation clôt le lot.

## 18. Limites & prochain lot

Non implémentés (par périmètre) : abonnement Stripe, résiliation, activation finale
du site, factures périodiques, Brevo, conséquences contractuelles d'un
remboursement. L'étape « Abonnement » reste visible mais inactive jusqu'au prochain
lot.

## Contraintes respectées

Montant issu du contrat verrouillé ; aucun paiement validé par redirection ; aucune
confirmation sans webhook/réconciliation ; aucun secret exposé ni commité ; Stripe
choisi par `activeMode` (indépendant de `ENV`) ; webhooks idempotents ; montants en
centimes ; PDF original et signé inchangés ; tous les tests au vert ; commits
atomiques ; documentation synchronisée.
