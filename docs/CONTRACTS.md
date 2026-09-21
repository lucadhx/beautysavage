# Contrats — modèle métier & machine à états

> **Document contractuel — stockage, persistance, accès :** voir
> [panelXvitrine/DOCUMENT_CONTRACTUEL.md](./panelXvitrine/DOCUMENT_CONTRACTUEL.md).
> Référence unique ; ces règles ne sont recopiées nulle part ailleurs.


Le contrat **pilote l'activation commerciale du site**. Invariant central :
**aucun contrat actif ⇒ site suspendu** (quand l'enforcement est activé — voir
[CONTRACT_ENFORCEMENT_ROLLOUT.md](./CONTRACT_ENFORCEMENT_ROLLOUT.md)).

## 1. Machine à états

[services/contractStateMachine.js](../backend/src/services/contractStateMachine.js).
Transitions **autorisées uniquement** (`assertTransition`) — jamais de statut
arbitraire.

```
DRAFT ─▶ PENDING_DEV_SIGNATURE ─▶ INACTIVE ─▶ ACTIVATION_IN_PROGRESS ─▶ ACTIVE
  │              │                    │                 │                 │
  ▼              ▼                    ▼                 ▼                 ▼
CANCELLED     CANCELLED/FAILED     CANCELLED         CANCELLED     CANCEL_AT_PERIOD_END ─▶ ENDED
```

| Statut | Sens |
|---|---|
| `DRAFT` | PDF + zones + tarifs modifiables |
| `PENDING_DEV_SIGNATURE` | validé/verrouillé, en attente de signature DEV |
| `INACTIVE` | DEV signé, disponible pour l'ADMIN, **site non actif** |
| `ACTIVATION_IN_PROGRESS` | parcours ADMIN en cours (paiements) |
| `ACTIVE` | signé + payé + abonné : **site actif** |
| `CANCEL_AT_PERIOD_END` | résilié, **actif jusqu'à l'échéance** |
| `ENDED` | fin effective → site suspendu |
| `CANCELLED` | annulé avant activation |
| `FAILED` | échec bloquant (récupérable → INACTIVE) |

**L'étape d'activation n'est jamais un index stocké** : elle est dérivée des
états réels (`deriveActivationStep`) → un webhook manqué ne désynchronise rien.

> **Prérequis intégrations — au POINT D'USAGE.** La création d'un BROUILLON de
> contrat ne nécessite PAS Stripe/Yousign (aucun appel externe) : on peut donc
> construire tout le contrat (PDF, zones, montants) sans les brancher. La
> disponibilité d'un fournisseur (mode actif configuré + vérifié) est exigée
> seulement quand on l'utilise : **Yousign** au lancement de la signature,
> **Stripe** au Checkout. L'ADMIN peut suivre un contrat en préparation en
> lecture seule même avant tout branchement.

## 2. Modèles

> `name` naît **vide** : un contrat n'est pas pré-rempli. Il reste obligatoire
> avant validation, mais c'est le **parcours guidé** qui l'exige (étape `NAME`),
> pas le backend — `validateContract` ne l'a jamais réclamé. Le nom auto
> `Contrat <référence>` a été retiré : il forçait le DEV à effacer un texte qu'il
> n'avait pas écrit, et couplait le front au backend sur ce littéral pour
> détecter « pas encore nommé ». Voir
> [RX_CONTRACT_UX_POLISH_03.md](./RX_CONTRACT_UX_POLISH_03.md).

- [Contract](../backend/src/models/Contract.model.js) — `name` + `reference`,
  document/PDF, config de signature (`version`, `locked`, `signers[]` vue éditeur,
  `zones[]`, **historique `versions[]`** : chaque sauvegarde crée une version, le
  contrat garde la dernière), **`signersSnapshot`** (identité figée des deux
  parties — [CONTRACT_SIGNERS.md](./CONTRACT_SIGNERS.md)), `pricing` (frais +
  abonnement), blocs `yousign` / `stripe`, `activation`, `environment`. Éditeur de
  zones : [CONTRACT_EDITOR.md](./CONTRACT_EDITOR.md). Parcours de signature : [SIGNATURE.md](./SIGNATURE.md).
- [Company](../backend/src/models/Company.model.js) `.signer` /
  [DevCompany](../backend/src/models/DevCompany.model.js) `.signer` — le
  **signataire contractuel** de chaque partie (prénom, nom, fonction, email), ou
  `null` s'il n'est pas configuré. Donnée métier explicite : ni un compte
  utilisateur, ni le contact public `media[key='email']`.
  Voir [CONTRACT_SIGNERS.md](./CONTRACT_SIGNERS.md).
- [Payment](../backend/src/models/Payment.model.js) — **journal financier** (montants
  en centimes, jamais de suppression physique) : mode Stripe, bloc `stripe`, clé
  d'idempotence, statuts PENDING/PROCESSING/PAID/FAILED/CANCELLED/EXPIRED/REFUNDED.
  `contract.stripe.launchFee` en est la **projection** lisible. Frais de lancement
  (Checkout unique) : [SIGNATURE](./SIGNATURE.md) pour la
  signature, [STRIPE_LAUNCH_FEE_FLOW](./STRIPE_LAUNCH_FEE_FLOW.md) pour le paiement,
  [STRIPE_SUBSCRIPTION_FLOW](./STRIPE_SUBSCRIPTION_FLOW.md) pour l'abonnement +
  activation + résiliation (projection `contract.stripe.subscription`, Price immuable).
- [Invoice](../backend/src/models/Invoice.model.js) — miroir des factures Stripe
  (numéro, liens hébergés + PDF, snapshot). Unique par `externalInvoiceId`.
  Historique + backfill : [STRIPE_BILLING.md](./STRIPE_BILLING.md).
- [WebhookEvent](../backend/src/models/WebhookEvent.model.js) — idempotence
  (unique `provider+externalEventId`).
- [ContractAuditLog](../backend/src/models/ContractAuditLog.model.js) —
  métadonnées sûres (jamais de secret/PDF/webhook brut).

## 3. Montants & TVA

Tout en **centimes entiers** ([utils/money.js](../backend/src/utils/money.js)) —
jamais de flottant. Le Manager saisit des **euros HT** ; le backend convertit
(`eurosToCents`) et calcule HT/TVA/TTC de manière déterministe (`computePricing`).
Taux de TVA **configurable par contrat** (défaut 20 %).

Exemple : 990 € HT, TVA 20 % → HT 99000, TVA 19800, TTC 118800 (centimes).

## 4. Unicité & suppression

- **Un seul** contrat `ACTIVE` ou `CANCEL_AT_PERIOD_END` à la fois (vérifié à
  l'activation).
- **Suppression physique** : uniquement un `DRAFT` jamais signé et sans
  transaction. Sinon → **archivage** (soft-delete `archived`).
- Jamais de suppression physique d'un contrat signé/payé/actif, d'un paiement,
  d'une facture ou d'une trace webhook.

## 5. Documents PDF

Pipeline dédié ([services/contractDocument.service.js](../backend/src/services/contractDocument.service.js),
**jamais Sharp**) : validation (magic `%PDF`, pdf-lib, refus des PDF chiffrés,
≤ 20 Mo, ≤ 40 pages), stockage **privé** (`storage/contracts/<id>/`, noms UUID),
`original` et `signed` **séparés** (le signé n'écrase jamais l'original),
checksum sha256, streaming authentifié anti path-traversal.

Endpoints : `GET /api/contracts/:id/documents/original|signed` (DEV toujours ;
ADMIN uniquement son contrat).

## 6. Endpoints (résumé)

DEV — préfixe `/api/contracts` : `GET /`, `POST /`, `GET /:id`,
`PUT /:id/draft`, `DELETE /:id`, `POST /:id/document`,
`PUT /:id/signature-configuration`, `POST /:id/validate`,
`POST /:id/start-dev-signature`, `POST /:id/cancel`, `POST /:id/reconcile`.

ADMIN — préfixe `/api/my-contract` : voir
[CONTRACT_ACTIVATION_FLOW.md](./CONTRACT_ACTIVATION_FLOW.md).

`POST /:id/validate` exige un signataire complet (prénom, nom, email) sur
**chacune** des deux fiches Entreprise, et fige leur identité dans
`signersSnapshot` — [CONTRACT_SIGNERS.md](./CONTRACT_SIGNERS.md).

## 7. Outils de recette (ENV=TEST uniquement)

Deux raccourcis évitent d'attendre une échéance réelle pendant une recette :
**« Résilier immédiatement »** (termine le contrat via le même chemin que le
webhook de fin d'abonnement) et **« Réinitialiser la recette »** (retour à
« aucun contrat » : purge via les services, annulation des demandes Yousign et
abonnements Stripe, levée de la suspension **technique**).

Le refus hors TEST est imposé **par le service** (`assertTestEnvironment` →
403), pas par l'interface : masquer un bouton n'empêche pas un appel d'API.
Détail : [RX_POLISH_CONTRACTS_BILLING_01.md](./RX_POLISH_CONTRACTS_BILLING_01.md).

## 8. Parcours d'activation (UX)

L'étape courante est **dérivée** par le backend (`deriveActivationStep`) ; le
manager ne stocke aucun index. Chaque étape est un **écran** (illustration,
titre, explication, montants, action), pas un bouton qui change de libellé :
[RX_CONTRACT_UX_POLISH_03.md](./RX_CONTRACT_UX_POLISH_03.md).

- **Le DEV est partie au contrat**, pas un administrateur : après validation il
  voit le même parcours que le client — « Signer », puis « Vous avez signé, le
  client poursuit ». Le technique reste sous « Voir les détails ».
- **Retour automatique** : les pages de retour Stripe/Yousign vérifient auprès du
  backend (un paramètre d'URL ne prouve rien), puis rendent la main à `/contrat`
  en annonçant l'étape franchie. `/contrat` sonde tant qu'une confirmation est
  attendue — aucun rafraîchissement manuel.
- **Retour de signature** : `redirect_urls` (documenté, au niveau du signataire)
  ramène chaque partie chez elle. **Facultatif** : sans `managerUrl` configurée,
  le champ est omis et le comportement d'origine s'applique. Un abonnement
  Yousign **en Trial** les refuse : ce refus précis déclenche une reprise sans
  redirections plutôt que de bloquer le contrat — le retour est un confort, la
  signature est le métier. `yousign.autoReturn` dit ce qui a été accepté, et
  l'écran ne promet le retour que s'il aura lieu. Aucune configuration :
  [YOUSIGN_TRIAL_REDIRECT_FALLBACK.md](./YOUSIGN_TRIAL_REDIRECT_FALLBACK.md).

## 9. Tests

`npm run test:contracts` (44) + `npm run test:lifecycle` (45 end-to-end)
+ `npm run test:signers` (64 — signataires, snapshot, immuabilité, migration)
+ `npm run test:yousign` (121 — dont le multipart d'upload et le payload
`addSigner` réellement construits, et le repli Trial sur refus des redirections).

Côté manager, `npm test` couvre les modules purs : suivi d'avancement
(`deriveContractProgress`), préparation guidée (`deriveContractSetup`),
franchissement d'étape (`journey`) et opérations sur les zones de signature.
