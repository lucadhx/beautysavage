# Intégration Stripe (paiements & abonnements)

Adaptateur fin ([services/stripe/](../backend/src/services/stripe/)), SDK officiel
`stripe`. Clé secrète résolue via le coffre-fort IntegratedAPI selon le MODE Stripe ACTIF (activeMode), indépendant de l'ENV applicatif.
Aucun appel Stripe depuis les contrôleurs.

## 1. Checkout hébergé

On utilise **Stripe Checkout** (redirection), pas de formulaire carte maison.

- **Frais de lancement** — `mode: 'payment'`, `price_data` inline,
  `unit_amount = TTC` (centimes).
- **Abonnement** — `mode: 'subscription'`, `price_data` inline avec
  `recurring.interval = 'month'`. Le montant est **figé pour le contrat** (une
  modification tarifaire future n'altère pas un abonnement existant).

**Métadonnées** sur chaque objet : `contractId`, `paymentType`
(`LAUNCH_FEE|SUBSCRIPTION`), `providerMode` + `applicationEnvironment` (`TEST|PROD`)
et, pour les frais, `paymentId` → rattachement sans ambiguïté au webhook.

**Idempotence** : clés stables → un double clic renvoie la même session. Pour les
frais de lancement, la clé est dérivée par tentative
(`launch-<id>-v<version>-a<attempt>-<mode>`, cf.
[STRIPE_LAUNCH_FEE_FLOW.md](./STRIPE_LAUNCH_FEE_FLOW.md) §6) ; abonnement/résiliation :
`checkout-sub-<id>`, `cancel-<subId>`.

## 2. URLs de retour

Construites depuis `SystemConfiguration.network.managerUrl` (jamais codées en
dur) :
`{managerUrl}/contrat/retour-paiement` et `/contrat/retour-abonnement`.

## 3. Webhooks

Endpoint `POST /api/webhooks/stripe` (voir [WEBHOOKS.md](./WEBHOOKS.md)).
- Vérification : header `Stripe-Signature` (`t=…,v1=…`), HMAC-SHA256 sur
  `${t}.${corps_brut}`, temps constant + tolérance temporelle.
- **Corps brut requis** : la route est montée avant `express.json` (voir app.js).

Événements traités :

| Événement | Effet |
|---|---|
| `checkout.session.completed` (LAUNCH_FEE) | frais → PAID (`payment_status=paid`) ou PROCESSING (asynchrone) |
| `checkout.session.async_payment_succeeded/failed` (LAUNCH_FEE) | frais → PAID / FAILED |
| `checkout.session.expired` (LAUNCH_FEE) | tentative → EXPIRED (nouvelle possible) |
| `payment_intent.succeeded/payment_failed` (LAUNCH_FEE) | frais → PAID / FAILED |
| `charge.refunded` (LAUNCH_FEE) | frais → REFUNDED |
| `checkout.session.completed` (SUBSCRIPTION) | rattache `subscriptionId`/`customerId` |
| `invoice.finalized` | miroir de la facture Stripe (numéro + PDF) |
| `invoice.paid` | miroir Invoice (PAID) + paiement de cycle (abonnement) |
| `invoice.payment_failed` | miroir + abonnement PAST_DUE (voir politique impayé ci-dessous) |
| `customer.subscription.created/updated` | statut + période + `cancel_at_period_end` |
| `customer.subscription.deleted` | abonnement ENDED → contrat ENDED → site suspendu |

**Outils de synchronisation (DEV)** : les actions « Synchroniser » du Manager
(section **Diagnostic et synchronisation**, repliée, à l'écart des CTA) sont des
outils de **réconciliation** : ils interrogent Stripe pour réaligner l'état local
quand un webhook a été manqué/retardé, ou qu'une opération a été faite directement
dans Stripe. Ils **ne créent rien** — aucun Checkout, aucun abonnement, aucun
client, aucun prix (garanti par test : lectures Stripe uniquement). Ils affichent
le résultat du dernier passage, « aucun écart détecté » compris.

**Paiements asynchrones** : on n'acquitte les frais que si
`payment_status === 'paid'` (jamais sur la seule `checkout.session.completed`).
Le parcours **frais de lancement** (journal Payment, idempotence, réconciliation,
retour Manager) est détaillé dans [STRIPE_LAUNCH_FEE_FLOW.md](./STRIPE_LAUNCH_FEE_FLOW.md).
Le parcours **abonnement** (Product/Price immuables, activation, résiliation, fin de
période, impayé, réconciliation) est détaillé dans
[STRIPE_SUBSCRIPTION_FLOW.md](./STRIPE_SUBSCRIPTION_FLOW.md). L'abonnement utilise un
**Price Stripe immuable par version de contrat** (plus de `price_data` inline).

## 4. Résiliation

`cancelSubscriptionAtPeriodEnd` → `cancel_at_period_end = true`. Le contrat passe
`CANCEL_AT_PERIOD_END` (site actif jusqu'à l'échéance). La **fin effective** vient
de `customer.subscription.deleted` → contrat `ENDED` → site suspendu.

## 5. Politique d'impayé (V1)

`invoice.payment_failed` **ne suspend pas** immédiatement. La fin effective
d'abonnement (`customer.subscription.deleted`, après les tentatives Stripe) fait
foi. `CONTRACT_PAYMENT_GRACE_DAYS` réservé si une politique de grâce explicite
est implémentée ultérieurement.

## 6. Factures

Stripe reste la **source juridique**. On conserve un miroir interne
([Invoice](../backend/src/models/Invoice.model.js)) avec `hostedInvoiceUrl` /
`invoicePdfUrl` (liens Stripe) + snapshot. Les factures d'abonnement sont émises
automatiquement par Stripe ; les **frais de lancement** obtiennent une facture via
`invoice_creation` sur le Checkout. Historique + PDF + backfill :
[STRIPE_BILLING.md](./STRIPE_BILLING.md). Pages : `/api/my-invoices` (ADMIN),
`/api/invoices` (DEV) ; backfill `/api/contracts/:id/sync-invoices` (DEV) +
`npm run invoices:sync`.

## 7. Tests & sandbox

`npm run test:stripe` (28 : checkout frais/abo, idempotence, résiliation, webhook
valide/altéré/hors-tolérance, mapping statuts). Provider simulé :
`STRIPE_PROVIDER=stub`. Sandbox réelle : `npm run integrated-api:test:stripe`.

Checklist Stripe **Test mode** : configurer les clés `sk_test_`/`whsec_` dans le
Manager, exposer le webhook via ngrok, utiliser les cartes de test Stripe
(`4242 4242 4242 4242`).
