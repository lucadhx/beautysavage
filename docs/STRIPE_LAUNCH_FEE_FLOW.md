# Frais de lancement — Stripe Checkout (paiement unique)

Paiement **unique** des frais de lancement via **Stripe Checkout** (mode
`payment`). Ce lot ne branche NI l'abonnement, NI la résiliation, NI l'activation
finale du site, NI les factures périodiques, NI Brevo. Toute la couche Stripe passe
par IntegratedAPI (mode actif + base URL configurable, jamais d'URL codée en dur).

Parcours cible :

```
Contrat entièrement signé
→ « Payer les frais de lancement »
→ redirection Stripe Checkout (TEST)
→ paiement
→ retour Manager (page de vérification)
→ confirmation par WEBHOOK signé
→ badge « Payé » + timeline mise à jour
```

La présence de `session_id` / `status=success` dans l'URL de retour **ne vaut
JAMAIS** confirmation : seule la confirmation **webhook** (ou la **réconciliation**
serveur) fait foi.

## 1. Conditions d'accès (contrôle backend)

Le paiement ne peut être démarré que si (revérifié côté serveur —
[payment.service.js](../backend/src/services/payment.service.js) `launchFeePayableIssues`) :

- le contrat est **validé/verrouillé** ;
- il est **entièrement signé** (signature DEV **et** ADMIN confirmées par Yousign) ;
- les **frais de lancement** sont configurés et **> 0** ;
- les frais **ne sont pas déjà payés** ;
- le **mode Stripe actif** est configuré **et vérifié** (`assertProviderReady('STRIPE')`).

Erreur structurée en cas de non-respect :

```json
{
  "success": false,
  "code": "LAUNCH_FEE_NOT_PAYABLE",
  "message": "Les frais de lancement ne peuvent pas encore être réglés.",
  "details": { "missing": ["CONTRACT_NOT_FULLY_SIGNED"] }
}
```

Codes stables : `CONTRACT_NOT_VALIDATED`, `CONTRACT_NOT_FULLY_SIGNED`,
`LAUNCH_FEE_NOT_CONFIGURED`, `LAUNCH_FEE_ALREADY_PAID` (Stripe non prêt →
`INTEGRATION_NOT_READY`). Le frontend n'est **jamais** la seule protection.

## 2. Montants

Stockés en **centimes entiers** (jamais de flottant). La **source de vérité** du
montant est le **snapshot contractuel verrouillé** (`pricing.launchFee`) — le
frontend n'envoie jamais le montant. Stripe reçoit le **TTC** en `unit_amount`
(unité minimale). Exemple : 990 € HT, TVA 20 % → HT 99000, TVA 19800, **TTC
118800**.

## 3. Journal `Payment` et projection contrat

- [Payment](../backend/src/models/Payment.model.js) = **journal financier**
  (append-only) : `providerMode` (mode Stripe), `applicationEnvironment`, `type`,
  `status`, montants, `stripe.{checkoutSessionId, paymentIntentId, customerId,
  paymentStatus, sessionStatus}`, `idempotencyKey`, `attempt`, `contractVersion`,
  `lastError`, horodatages. Index **unique** sur `stripe.checkoutSessionId` + index
  `contractId+type+status`. Jamais de suppression physique.
- `contract.stripe.launchFee` = **projection lisible** (source de vérité = Payment) :
  `status` (`NOT_REQUIRED | PENDING | CHECKOUT_CREATED | PROCESSING | PAID | FAILED
  | CANCELLED | EXPIRED | REFUNDED`), `paymentId`, `checkoutSessionId`,
  `paymentIntentId`, `attempt`, `paidAt`, `lastError`.

`projectLaunchFee(contract, payment)` synchronise les deux (une seule source de
vérité, pas d'états contradictoires).

### Machine à états du paiement

```
PENDING ─▶ PROCESSING ─▶ PAID
   │            │          └─▶ REFUNDED (charge.refunded)
   │            └─▶ FAILED
   ├─▶ EXPIRED  (session Stripe expirée)
   └─▶ CANCELLED
```

`PAID` et `REFUNDED` sont **terminaux** (jamais rétrogradés). Une tentative
`EXPIRED`/`FAILED`/`CANCELLED` autorise une **nouvelle tentative** (attempt + 1).

## 4. Création de la Checkout Session

`POST /api/my-contract/create-launch-checkout` (ADMIN — le DEV reste superset).
Backend :

1. `assertLaunchFeePayable` (gate) puis `assertProviderReady('STRIPE')` ;
2. crée (ou **réutilise**) un `Payment` (`PENDING`) ;
3. crée une **Checkout Session** `mode: payment`, `unit_amount` = TTC, devise du
   contrat, description claire (« Frais de lancement — <référence> », paiement
   unique) ;
4. **metadata** : `contractId`, `paymentType=LAUNCH_FEE`, `providerMode`,
   `applicationEnvironment`, `paymentId` (aucun secret) ;
5. **clé d'idempotence stable** (voir §6) ;
6. persiste `checkoutSessionId` sur le `Payment` + projette sur le contrat ;
7. renvoie **uniquement** l'URL Stripe.

Le `customerId` Stripe est réutilisé s'il existe. Un `beginActivation` fait passer
le contrat `INACTIVE → ACTIVATION_IN_PROGRESS` (aucune activation de site).

## 5. URLs de retour

Construites **côté backend** depuis `SystemConfiguration.network.managerUrl`
(jamais codées en dur, jamais fournies par le client) :

```
success_url = <managerUrl>/contrat/retour-paiement?status=success&session_id={CHECKOUT_SESSION_ID}
cancel_url  = <managerUrl>/contrat/retour-paiement?status=cancel
```

## 6. Idempotence & doubles clics

- Recherche d'une tentative **ouverte** (`PENDING`/`PROCESSING`) : si sa session
  Stripe est encore `open`, la **même URL** est renvoyée (aucune 2ᵉ session).
- Si la session est déjà payée/complète → réconciliation immédiate ; si expirée →
  nouvelle tentative contrôlée.
- **Clé d'idempotence Stripe** stable par tentative :
  `launch-<contractId>-v<version>-a<attempt>-<mode>` (dérivée de contrat + version
  verrouillée + n° de tentative + mode). Un double clic sur la même tentative
  renvoie la même session Stripe.
- Garde-fou base : index **unique** sur `stripe.checkoutSessionId` (deux paiements
  ne peuvent pointer la même session) ; concurrence gérée (E11000 → réutilisation).

## 7. Retour Manager

Route `/contrat/retour-paiement`
([ContractReturnPage](../manager/src/pages/ContractReturnPage.tsx)) : **n'affiche
jamais** un succès sur la foi de l'URL. Elle interroge
`GET /my-contract/launch-fee-status`, **polle** toutes les 2 s pendant ~30 s
(15 tentatives), puis propose **« Vérifier à nouveau »**. États gérés : vérification,
payé, en cours de confirmation, échoué, interrompu (annulation), en attente.

`GET /api/my-contract/launch-fee-status` renvoie (sans donnée Stripe sensible) :

```json
{ "required": true, "status": "PAID", "paidAt": "…",
  "amount": { "excludingTax": 99000, "tax": 19800, "includingTax": 118800, "currency": "EUR" },
  "attempt": 1, "lastError": null, "hasOpenCheckout": false }
```

## 8. Webhook Stripe

Route existante `POST /api/webhooks/stripe` (corps **brut**, signature vérifiée —
voir [WEBHOOKS.md](./WEBHOOKS.md)). Événements **frais de lancement** traités :

| Événement | Effet |
|---|---|
| `checkout.session.completed` (`payment_status=paid`) | `PAID` |
| `checkout.session.completed` (asynchrone, non payé) | `PROCESSING` |
| `checkout.session.async_payment_succeeded` | `PAID` |
| `checkout.session.async_payment_failed` | `FAILED` |
| `checkout.session.expired` | `EXPIRED` |
| `payment_intent.succeeded` | `PAID` |
| `payment_intent.payment_failed` | `FAILED` |
| `charge.refunded` | `REFUNDED` |

**Paiement synchrone** (carte) : `checkout.session.completed` avec
`payment_status=paid` fait foi. **Paiement asynchrone** : jamais `PAID` trop tôt —
`PROCESSING` puis `async_payment_succeeded`/`failed` (ou le PaymentIntent) tranche.

Résolution du `Payment` : `metadata.paymentId` → session → PaymentIntent →
tentative ouverte du contrat. Un événement authentique **sans contrat rattachable**
→ **2xx** (ignoré, journalisé) ; **signature invalide** → **400** ; **rejeu** →
`{ duplicate: true }` (idempotence via `WebhookEvent`, unique `provider+event_id`).

### Cohérence de mode

Sélection du secret par **mode actif** (jamais l'ENV) avec repli contrôlé pour un
événement retardé après bascule (acquitté mais **non traité**). En complément, un
événement d'un mode ne modifie **jamais** un `Payment` d'un autre mode
(`providerMode` comparé au mode de l'événement) — aucune bascule silencieuse.

## 9. Réconciliation (filet de sécurité)

Si un webhook est retardé/perdu, la réconciliation relit Stripe (Checkout Session
+ PaymentIntent) et corrige l'état — **idempotente**, ne crée **jamais** de
paiement :

- **CLI** : `npm run payments:sync` (contrats avec une tentative ouverte) ;
- **Endpoint DEV** : `POST /api/contracts/:id/sync-payment` ;
- intégrée aussi à `POST /api/contracts/:id/sync` (réconciliation du contrat).

Le bouton « Synchroniser le paiement » (DEV) ne crée jamais de paiement.

## 10. Remboursement & annulation

- **Remboursement** (`charge.refunded`) → `Payment` `REFUNDED`, projection + timeline.
  La **conséquence contractuelle** d'un remboursement (désactivation, etc.) sera
  définie dans un **lot ultérieur** (non traitée ici).
- **Annulation frontend** (`cancel_url`) : ne prouve pas l'annulation Stripe →
  « Paiement interrompu », puis vérification du statut réel.
- **Session expirée** (Stripe) → `EXPIRED` : nouvelle tentative possible (pas un
  échec bancaire).

## 11. Parcours ADMIN & DEV (Manager)

- **ADMIN** ([MyContractPage](../manager/src/pages/MyContractPage.tsx)) : montant
  HT/TVA/TTC, badge (`À payer` / `Paiement en attente` / `en cours de confirmation`
  / `Payé` / `échoué`), CTA **Payer** / **Reprendre** / **Réessayer**. L'étape
  abonnement reste **visible mais non fonctionnelle** (lot suivant).
- **DEV** ([DevContractsPage](../manager/src/pages/dev/DevContractsPage.tsx)) :
  panneau Stripe (statut, mode, Session/PaymentIntent **raccourcis**, dernière
  erreur sûre, bouton **Synchroniser le paiement**). Aucune clé exposée.

## 12. Sécurité

Aucun montant ni URL de retour acceptés du frontend ; aucune clé Stripe exposée ;
aucune donnée bancaire stockée ; aucune confiance dans la redirection ; webhook
signé ; idempotence ; contrôle des rôles (ADMIN = son contrat, DEV = global) ;
validation ; erreurs Stripe normalisées ; logs sans payload sensible.

## 13. Environnement Stripe (TEST vs PROD)

Le **mode Stripe actif** (TEST=sandbox / PROD=prod) est **indépendant de `ENV`**
(cf. [INTEGRATED_API.md](./INTEGRATED_API.md)). La base URL est configurable par
mode. Un contrat TEST ne pilote jamais la prod, et inversement.

## 14. Tests

- **Automatisés (provider simulé, aucun appel réel)** : `npm run test:payments`
  ([payments-flow.test.js](../backend/src/scripts/payments-flow.test.js), 55
  assertions) — gate, checkout (montant, metadata, idempotence, double clic),
  webhooks (payé/asynchrone/PaymentIntent/remboursement/expiration/mode mismatch/
  orphelin/doublon), projection, timeline, statut ADMIN/DEV, paiement unique,
  réconciliation idempotente.
- **Sandbox TEST réel** : `npm run stripe:test:launch-fee -- <contractId>` — crée
  une vraie Checkout Session TEST pour un contrat **explicitement de test**
  entièrement signé ; **refuse** si le mode actif n'est pas TEST ; n'affiche aucun
  secret ; ne crée aucun paiement réel. Webhooks TEST : gérés automatiquement
  à distance dès qu'un tunnel ngrok expose le backend — voir
  [GENERIC_WEBHOOK_PROVIDER_ARCHITECTURE.md](./GENERIC_WEBHOOK_PROVIDER_ARCHITECTURE.md).

## 15. Endpoints (récapitulatif)

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/api/my-contract/create-launch-checkout` | ADMIN — créer/réutiliser la Checkout Session |
| GET | `/api/my-contract/launch-fee-status` | ADMIN — statut des frais (sans secret) |
| GET | `/api/contracts/:id/payments` | DEV — journal des paiements |
| POST | `/api/contracts/:id/sync-payment` | DEV — réconcilier les frais |
| POST | `/api/webhooks/stripe` | Webhook signé + idempotent |

## 16. Limites de ce lot / prochain lot

Non implémentés (lots ultérieurs) : abonnement Stripe, résiliation, activation
finale du site, factures périodiques, Brevo, conséquences contractuelles d'un
remboursement. L'étape « Abonnement » du parcours reste visible mais inactive.
