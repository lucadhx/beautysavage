# Webhooks (Stripe & Yousign)

Endpoints **publics au sens réseau** mais protégés par vérification
**cryptographique** de signature. La vérité vient toujours du webhook signé (ou
de la réconciliation), **jamais** d'une redirection navigateur.

## 1. Corps brut (ordre des middlewares)

Les routes webhook sont montées **avant `express.json()`** dans
[app.js](../backend/src/app.js) et utilisent `express.raw()` : la vérification
HMAC exige le payload **non parsé**.

```
app.use('/api/webhooks', webhookRoutes);   // raw body
app.use(express.json());                    // le reste de l'API
```

## 2. Endpoints

| Endpoint | Vérification |
|---|---|
| `POST /api/webhooks/stripe` | `Stripe-Signature` = `t=…,v1=…` ; HMAC-SHA256 sur `${t}.${body}` + tolérance |
| `POST /api/webhooks/yousign` | `x-yousign-signature-256` = `sha256=`+HMAC-SHA256(body) |

Secret résolu par **MODE fournisseur** (jamais par ENV) : on vérifie avec le
secret du **mode actif**, puis en repli avec l'autre mode pour reconnaître un
événement **retardé après un basculement** — dans ce cas l'événement est
**acquitté (2xx) mais NON traité** (aucune pollution inter-mode). Un événement
authentique **sans contrat SB Auto rattachable** répond aussi **2xx** (ignoré
proprement, pour éviter les retries). Seule une **signature invalide → 400**.
Métadonnées Stripe : `providerMode` + `applicationEnvironment` + `contractId`
(audit/réconciliation ; ne remplacent pas la vérification cryptographique).

## 3. Idempotence

Chaque événement est enregistré dans
[WebhookEvent](../backend/src/models/WebhookEvent.model.js) (index unique
`provider + externalEventId`). Un événement déjà reçu → réponse `{duplicate:true}`
sans re-traitement. L'insertion sert de **verrou** contre le double traitement
concurrent (le perdant capte E11000).

## 4. Réponse rapide & traitement

Le traitement est fait de manière synchrone (opérations MongoDB rapides) puis la
réponse est renvoyée. En cas d'erreur, on renvoie **500** pour que le fournisseur
réessaie (l'idempotence protège). La **réconciliation** (voir ci-dessous) est le
filet de sécurité en cas de webhook perdu.

> Note Yousign : timeout 1 s au 1ᵉʳ essai. Le seul traitement potentiellement lent
> (téléchargement du PDF signé) est encapsulé et rattrapé par la réconciliation.

## 5. Configuration côté fournisseur

Pointer les webhooks vers le backend **public** :

```
Stripe  : {PUBLIC_URL}/api/webhooks/stripe
Yousign : {PUBLIC_URL}/api/webhooks/yousign
```

En local, exposer le backend via **ngrok** (`ngrok http 6070`).

> **Les secrets de webhook ne se saisissent plus dans SB Auto.** Les quatre
> fournisseurs sont sous autorité Panel : c'est la plateforme qui provisionne les
> endpoints et qui LIVRE le secret de vérification. Seul Stripe est encore reçu
> localement, et son `webhookSecret` ne permet aucun appel — il sert uniquement à
> constater qu'un événement vient bien de Stripe.
> Voir [INTEGRATED_API.md](INTEGRATED_API.md#7-propriété-des-webhooks).

## 6. Réconciliation (filet de sécurité)

[services/reconciliation.service.js](../backend/src/services/reconciliation.service.js) :
interroge Yousign & Stripe, corrige les états dérivables, réconcilie le statut du
site. Idempotente. **N'est pas un substitut aux webhooks.**

- CLI : `npm run contracts:reconcile`
- Endpoint DEV : `POST /api/contracts/:id/reconcile`

## 7. Événements traités

Voir [STRIPE_INTEGRATION.md](./STRIPE_INTEGRATION.md) §3 et
[SIGNATURE.md](./SIGNATURE.md) §6.

**Frais de lancement** (paiement unique — [STRIPE_LAUNCH_FEE_FLOW.md](./STRIPE_LAUNCH_FEE_FLOW.md)) :
`checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `checkout.session.expired`,
`payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`.
Jamais `PAID` prématurément (paiement asynchrone → `PROCESSING` d'abord). Un
événement d'un mode ne modifie jamais un `Payment` d'un autre mode (`providerMode`).

**Abonnement** ([STRIPE_SUBSCRIPTION_FLOW.md](./STRIPE_SUBSCRIPTION_FLOW.md)) :
`checkout.session.completed` (récupère le statut RÉEL de la Subscription),
`customer.subscription.created/updated/deleted`, `invoice.paid`,
`invoice.payment_failed`. Jamais actif d'office. `invoice.payment_failed` → `PAST_DUE`
(site maintenu actif) ; `subscription.deleted` (fin effective) → contrat `ENDED` +
**suspension automatique du site**.

**Factures** ([STRIPE_BILLING.md](./STRIPE_BILLING.md)) : `invoice.finalized`,
`invoice.paid`, `invoice.payment_failed` reflètent la facture Stripe (numéro, liens
hosted/PDF). Le contrat est résolu metadata → abonnement → client (les factures
n'héritent pas des metadata). Une facture sans contrat est reflétée sans rattachement
(2xx).
