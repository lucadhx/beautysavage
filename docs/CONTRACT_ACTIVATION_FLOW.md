# Parcours d'activation du contrat

Deux parcours : **DEV** (préparation) puis **ADMIN** (activation commerciale).

## 1. Parcours DEV (préparation)

Préfixe `/api/contracts` (DEV uniquement). Prérequis **vérifié backend** : pour
chaque fournisseur requis, le **mode ACTIF** (jamais l'ENV) doit être
**configuré ET vérifié** (test réussi). Sinon `400` structuré :

```json
{ "success": false, "message": "Stripe et Yousign doivent être configurés et testés (mode actif).",
  "details": { "code": "INTEGRATIONS_NOT_READY",
               "missing": [ { "provider": "YOUSIGN", "activeMode": "TEST", "reason": "NOT_VERIFIED" } ] } }
```

Le mode utilisé pour créer le contrat est le **mode actif** de chaque
fournisseur : une app `ENV=PROD` avec Stripe/Yousign en **TEST** crée des
contrats **TEST**.

1. **Créer** (`POST /`) → `DRAFT`.
2. **Document** (`POST /:id/document`, multipart `file`) → validation PDF + pages.
3. **Zones de signature** (`PUT /:id/signature-configuration`) → ≥ 1 zone par
   signataire (DEVELOPER + CLIENT), coordonnées en ratios.
4. **Tarification** (`PUT /:id/draft`) → frais et/ou abonnement en euros HT + TVA.
5. **Valider** (`POST /:id/validate`) → verrouille PDF + zones + montants, fige le
   **snapshot des parties** (DevCompany / Company), passe `PENDING_DEV_SIGNATURE`.
6. **Signer (DEV)** (`POST /:id/start-dev-signature`) → crée la demande Yousign
   (ordre DEV→ADMIN), renvoie le lien de signature DEV.
7. Webhook Yousign `signer.done` (DEV) → `devSignedAt`, contrat → `INACTIVE`
   (disponible pour l'ADMIN).

## 2. Parcours ADMIN (activation)

Préfixe `/api/my-contract` (ADMIN ; DEV superset). L'ADMIN n'accède qu'à **son**
contrat (résolu côté backend, jamais par id).

| Route | Rôle |
|---|---|
| `GET /` | Mon contrat (ou `null`) |
| `GET /activation` | Contrat + **étape dérivée** + résumé |
| `POST /start-signature` | Lien de signature ADMIN (après signature DEV) |
| `POST /create-launch-checkout` | Checkout frais de lancement |
| `POST /create-subscription-checkout` | Checkout abonnement |
| `POST /activate` | **Activer mon site** (revérifié backend) |
| `POST /cancel` | Résilier |

### Étape dérivée (jamais un index stocké)

`deriveActivationStep` renvoie la 1ʳᵉ étape non satisfaite :

```
SIGNATURE ─▶ LAUNCH_FEE ─▶ SUBSCRIPTION ─▶ ACTIVATION ─▶ DONE
```

- `SIGNATURE` : tant que les deux parties n'ont pas signé (webhook).
- `LAUNCH_FEE` : si frais requis et non payés (sinon sautée). **Paiement Stripe
  réel** (Checkout unique) — détail : [STRIPE_LAUNCH_FEE_FLOW.md](./STRIPE_LAUNCH_FEE_FLOW.md).
- `SUBSCRIPTION` : si abonnement requis et non actif (sinon sautée). **Abonnement
  Stripe réel** (Checkout `mode=subscription`, Price immuable, actif confirmé par
  webhook) — détail : [STRIPE_SUBSCRIPTION_FLOW.md](./STRIPE_SUBSCRIPTION_FLOW.md).
- `ACTIVATION` : tout satisfait → l'ADMIN peut activer (action explicite, jamais
  auto au webhook). Disponibilité du site : [SITE_CONTRACT_ENTITLEMENT.md](./SITE_CONTRACT_ENTITLEMENT.md).

À la reprise (rafraîchissement, retour navigateur), le parcours **reprend à la
première étape obligatoire non validée**, dérivée des états réels (signature
confirmée ? frais payés ? abonnement actif ?).

### Suivi visuel — le MÊME pour le DEV et l'ADMIN

[`ContractProgressTracker`](../manager/src/components/contracts/ContractProgressTracker.tsx)
est utilisé **à l'identique** sur la fiche Contrat DEV et sur la page Contrat
ADMIN. Il affiche six étapes, plus lisibles que les quatre de `ACTIVATION_STEP`
(qui regroupe les deux signatures) :

```
Préparation ─ Signature DEV ─ Signature client ─ Frais ─ Abonnement ─ Activation
   ●───────────────●───────────────◉──────────────○────────○───────────○
```

L'avancement vient de [`deriveContractProgress()`](../manager/src/lib/contractProgress.ts),
qui applique le même principe que `deriveActivationStep` : **rien n'est stocké**,
tout est dérivé des états réels (`status`, `devSigned`, `adminSigned`,
`launchFeeRequired/Satisfied`, `subscriptionRequired/Satisfied`, `activation`,
`yousign.signatureState`, `stripe.*`). Le backend sérialise déjà ces champs
(`activationView`) dans **chaque** payload, quel que soit le rôle : les deux vues
appellent donc la même fonction sur le même contrat — l'identité du rendu est
garantie par construction, pas par convention (et vérifiée par test).

- **Étapes non requises** : affichées « Non requise », exclues du total, jamais
  « courantes ». Une étape non due ne doit pas se lire comme une étape payée.
- **Erreurs** : contextualisées — une signature refusée/expirée est portée sur la
  partie qui n'a pas signé ; paiement échoué ; abonnement en échec.
- **États terminaux** : annulé, échec, **résilié (actif jusqu'à l'échéance)**,
  terminé — affichés à part du chemin nominal.
- **Desktop** : coche sur les étapes franchies, halo sobre sur l'étape courante,
  progression animée de la ligne. **Mobile** : défilement à snap, étape courante
  centrée automatiquement. `prefers-reduced-motion` respecté ; l'état de chaque
  étape est annoncé aux lecteurs d'écran (pas seulement une couleur).

### Activation finale

`POST /activate` **revérifie toutes les conditions côté backend** (jamais sur la
seule foi du front), garantit l'unicité du contrat vivant, passe `ACTIVE`,
enregistre `activatedAt/By`, puis **réconcilie le statut du site** (→ actif).
C'est la **seule** activation ADMIN autorisée.

## 3. Pages de retour (frontend)

`/contrat/retour-signature`, `/contrat/retour-paiement`, `/contrat/retour-abonnement`
ne déclarent **jamais** un succès sur la foi d'un paramètre d'URL : elles
interrogent le backend, affichent un état de vérification, attendent/retentent, puis
redirigent vers la bonne étape. `retour-paiement` suit le statut réel des frais
(`GET /my-contract/launch-fee-status`) et `retour-abonnement` le statut réel de
l'abonnement (`GET /my-contract/subscription-status`) — polling borné 2 s / ~30 s
puis « Vérifier à nouveau » ; `retour-signature` suit `GET /my-contract/activation`.

## 4. Résiliation

`POST /cancel` (ADMIN ou DEV) → Stripe `cancel_at_period_end`, contrat
`CANCEL_AT_PERIOD_END`. Le site **reste actif jusqu'à l'échéance** ; la fin
effective (webhook `customer.subscription.deleted`) → `ENDED` → site suspendu.

Le DEV ne peut pas **supprimer** un contrat actif (résiliation uniquement).
