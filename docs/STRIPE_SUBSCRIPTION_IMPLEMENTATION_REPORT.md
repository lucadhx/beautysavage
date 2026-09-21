# Rapport d'implémentation — LOT G+H : Abonnement Stripe, activation, résiliation, suspension

Mission : abonnement Stripe mensuel, activation finale du site, résiliation en fin
de période, fin effective du contrat, suspension automatique du site et
réconciliation des abonnements. Sans Brevo, sans pages de factures, sans relances
email, sans politique d'impayé configurable avancée.

## 1. Analyse de l'existant

Socle déjà présent (lots précédents) : contrats + machine à états, IntegratedAPI
(modes indépendants de `ENV`), Yousign complet (mocks), frais de lancement Stripe,
webhooks signés/idempotents, journal `Payment`, timeline, réconciliation,
**composition entitlement technique/contractuel déjà implémentée et testée**
(`siteEnforcement`, `SiteStatus`, `contract-lifecycle.test`).

Manquait (ce lot) : projection abonnement complète, Product/Price immuables,
Customer explicite, service d'abonnement dédié, mapper étendu/contextuel, politique
impayé `PAST_DUE`, `latestInvoiceId`/`lastError`, endpoints statut/sync, moteur de
réconciliation d'abonnement + `verify-entitlements`, UI ADMIN/DEV/Dashboard, tests,
documentation.

## 2. Documentation Stripe consultée

Checkout Session `mode=subscription` ; Customer ; Product/Price ; Subscription
(`status`, `current_period_start/end`, `cancel_at_period_end`, `latest_invoice`) ;
`customer.subscription.created/updated/deleted` ; `invoice.paid` /
`invoice.payment_failed` ; paiements asynchrones ; clés d'idempotence. Aucun secret
n'est reproduit ici.

## 3. Roadmap exécutée

G1 modèle/statuts/mapper · G2 service + Product/Price + réconciliation · G3 webhooks
+ politique impayé · G4 endpoints + scripts · G5 frontend · G6 tests · G7
documentation. Tout exécuté.

## 4. Modèle abonnement

Projection `contract.stripe.subscription` : statut (14 valeurs, superset Stripe +
métier), `subscriptionId/customerId/productId/priceId/priceContractVersion/
latestInvoiceId`, période, `cancelAtPeriodEnd/cancelledAt/endedAt`,
`lastError { code, message, at }`. Journal de cycle = `Payment` (type SUBSCRIPTION,
1 ligne par invoice). Index existants : `stripe.subscription.subscriptionId` (requête),
`contractId+type`.

## 5. Stratégie Product / Price

`Product` + `Price` **immuables par version de contrat** (idempotents,
`…-<id>-v<version>-<mode>`), metadata complète. Un Price verrouillé n'est jamais
modifié ; un changement de version crée un nouveau Price. Montant = **TTC du snapshot
verrouillé** (Stripe Tax non activé en V1 ; HT/TVA portés par le contrat).

## 6. Checkout, idempotence, metadata

`mode: subscription`, `line_items: [{ price, quantity }]`, metadata (`contractId`,
`paymentType`, `providerMode`, `applicationEnvironment`, `contractVersion`) sur
session + subscription, clé `checkout-sub-<id>-v<version>-<mode>`. Réutilisation
d'une session ouverte (double clic).

## 7. Mapping des statuts

Centralisé, testé, contextuel (`cancel_at_period_end`) — cf.
[STRIPE_SUBSCRIPTION_FLOW.md](./STRIPE_SUBSCRIPTION_FLOW.md) §5.

## 8. Webhooks & invoice events

`checkout.session.completed` (vérifie le statut RÉEL), `customer.subscription.*`,
`invoice.paid` (Payment de cycle + récupération PAST_DUE→ACTIVE),
`invoice.payment_failed` (PAST_DUE). Statut HTTP : signature invalide 400 ; sans
contrat 2xx ; rejeu `{duplicate:true}` ; erreur de traitement 500 (retry Stripe).

## 9. Politique impayé (V1)

`invoice.payment_failed` → `PAST_DUE`, **site maintenu actif**. Suspension seulement
à la fin effective (statut terminal). Pas de délai de grâce maison ; `CONTRACT_PAYMENT_GRACE_DAYS`
non utilisé.

## 10. Activation, entitlement, suspension, résiliation, fin de période

- **Activation** : action ADMIN explicite, revérification backend, unicité,
  atomicité (une transition + save ; double clic inopérant).
- **Entitlement** : composition technique/contractuel — voir
  [SITE_CONTRACT_ENTITLEMENT.md](./SITE_CONTRACT_ENTITLEMENT.md).
- **Résiliation** : `cancel_at_period_end`, contrat `CANCEL_AT_PERIOD_END`, site
  actif jusqu'à l'échéance (ADMIN et DEV).
- **Fin effective** : `subscription.deleted` → `ENDED` + suspension automatique.

## 11. Réconciliation

`subscriptions:sync`, `POST /contracts/:id/sync-subscription`,
`contracts:verify-entitlements` — voir
[SUBSCRIPTION_RECONCILIATION.md](./SUBSCRIPTION_RECONCILIATION.md).

## 12. Parcours ADMIN / DEV

ADMIN : étape abonnement (badge/CTA), vue active (période, échéance, alerte impayé,
résiliation programmée), page de retour à polling borné. DEV : panneau abonnement
(statut, période, Price immuable, dernière erreur, synchronisation). Dashboard :
carte « Contrat & site ».

## 13. Tests automatisés

`npm run test:subscriptions` — **56 assertions**, provider simulé, **aucun appel
réel**. Suite complète **verte** : `npm test` (promote 54, integrated-api 62,
env-independence 4, contracts 38, yousign 34, yousign-flow 42, stripe 34,
payments-flow 55, **subscription-flow 56**, lifecycle 43, stripe-cli 35, smoke 102 =
**559 assertions**).

## 14. Test Stripe TEST réel

Script fourni `npm run stripe:test:subscription -- <contractId>` (refuse hors mode
TEST, contrat de test, aucun paiement réel, secrets masqués). **Non exécuté ici**
faute de clé sandbox réelle dans l'environnement d'exécution — aucun succès n'est
fabriqué. Procédure manuelle : contrat de test signé → « Activer l'abonnement » →
Checkout TEST → carte de test Stripe → webhook (`npm run dev` + Stripe CLI) →
abonnement ACTIVE → « Activer mon site » → résiliation → fin de période. La fin
réelle de période peut être testée via **Stripe Test Clocks** (intégration
officielle) ou, à défaut, via les mocks (transition `subscription.deleted`).

## 15. État de la recette Yousign réelle

Les clés Yousign Sandbox réelles ne sont **pas** renseignées. Toute la couche
Yousign passe par le provider et les **mocks** en test. **La recette Sandbox Yousign
complète reste OBLIGATOIRE avant commercialisation** — elle n'est pas validée par ce
lot.

## 16. Builds & typechecks

Manager : `tsc -b --noEmit` **OK**, `vite build` **OK**. Backend : suite autonome
verte.

## 17. Fichiers créés / modifiés

**Créés** : `backend/src/services/subscription.service.js`,
`backend/src/scripts/{subscription-flow.test.js, subscriptions-sync.js,
verify-entitlements.js, stripe-subscription.js}`, `docs/{STRIPE_SUBSCRIPTION_FLOW,
SITE_CONTRACT_ENTITLEMENT, SUBSCRIPTION_RECONCILIATION,
STRIPE_SUBSCRIPTION_IMPLEMENTATION_REPORT}.md`.

**Modifiés (backend)** : `utils/contractConstants.js`, `models/Contract.model.js`,
`services/contractStateMachine.js`, `services/stripe/{stripe.provider,stripe.stub,
stripe.service}.js`, `services/contractWebhook.service.js`, `services/contract.service.js`,
`services/reconciliation.service.js`, `controllers/{contract.admin,contract.dev}.controller.js`,
`routes/{myContract,contract}.routes.js`, `scripts/stripe.test.js`, `package.json`.

**Modifiés (manager)** : `types/index.ts`, `lib/api.ts`,
`components/contracts/status.tsx`, `pages/{MyContractPage,ContractReturnPage,
DashboardPage}.tsx`, `pages/dev/DevContractsPage.tsx`.

**Docs mis à jour** : README, API, ARCHITECTURE, CONTRACTS, STRIPE_INTEGRATION,
WEBHOOKS, CONTRACT_ACTIVATION_FLOW, INTEGRATED_API, RAPPORT, VPS_DEPLOYMENT_GUIDE.

## 18. Commits

```
2d8d5e4 feat(subscriptions): add subscription state, immutable price and status mapping
a262058 feat(subscriptions): add subscription service and reconciliation
eecdd17 feat(webhooks): process subscription and invoice events
fbe53df feat(api): subscription checkout, status and DEV sync endpoints
b4a86d8 test(subscriptions): cover subscription, activation and entitlement lifecycle
053d187 feat(manager): add subscription activation and cancellation UX
docs(subscriptions): document Stripe subscription flow  (ce lot documentaire)
```

Backend + frontend poussés sur `origin/main`. Le commit de documentation clôt le lot.

## 19. Limites & prochain lot

Non implémentés (par périmètre) : Brevo, pages complètes de factures, relances email,
politique d'impayé configurable avancée, Stripe Tax. **Recette Sandbox Yousign
réelle** à réaliser avant commercialisation.

## Contraintes respectées

`ENV` ne sélectionne pas le mode Stripe ; montants en centimes ; un seul abonnement
par contrat ; un seul contrat actif ; aucun site actif sans entitlement (enforcement
ON) ; suspension technique indépendante ; résiliation en fin de période sans
suspension immédiate ; fin effective → suspension automatique ; `invoice.payment_failed`
→ pas de suspension immédiate ; aucun secret exposé/commité ; webhooks idempotents ;
tous les tests au vert ; documentation synchronisée ; commits atomiques.
