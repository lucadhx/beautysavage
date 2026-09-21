> **RAPPORT HISTORIQUE — architecture supprimée.**
>
> Le parcours décrit ici passait par une route de webhook LOCALE et un client
> de signature embarqué dans ce projet. Ni l'un ni l'autre n'existe plus : les
> faits de signature arrivent par le pont, depuis la plateforme.
>
> Le parcours courant est décrit dans **[SIGNATURE.md](SIGNATURE.md)**.

# Parcours de signature Yousign

Parcours de signature **complet** DEV → ADMIN, avec récupération automatique du
PDF signé. **Stripe/facturation/activation ne sont PAS branchés ici** (lots
ultérieurs). Toute la couche Yousign passe par IntegratedAPI (mode actif + base
URL configurable, jamais d'URL codée en dur).

## 1. Architecture (couches)

```
Contrôleurs (contract.dev / contract.admin / webhook)   ← ne touchent jamais l'API Yousign
        │
services/contract.service.js       (orchestration métier : validate, startDevSignature, restart…)
services/yousign/yousign.service.js (orchestration Yousign : createContractSignatureRequest, verify…)
services/yousign/yousign.provider.js (client HTTP Yousign v3 — mode actif + baseUrl configurable)
services/yousign/yousignCoordinates.js (MAPPER ratios → pixels)
services/yousign/yousign.stub.js    (provider SIMULÉ pour les tests)
```

Provider sélectionné par `SIGNATURE_PROVIDER` (`stub` en test). Clé API + base URL
résolues via `getCredential('YOUSIGN','apiKey')` / `getProviderBaseUrl('YOUSIGN')`
(mode **actif**, cf. [INTEGRATED_API.md](./INTEGRATED_API.md)).

## 2. Flux nominal

```
DEV: créer → upload PDF → configurer zones → VALIDER (verrou + snapshot signataires)
     (upload Yousign : multipart nature=signable_document — cf. YOUSIGN_REAL_SANDBOX_FIX_REPORT.md)
   → POST /contracts/:id/start-dev-signature
        └─ crée la Signature Request Yousign avec le PDF VERROUILLÉ
        └─ ordre imposé : DEVELOPER (1er) puis CLIENT
        └─ mappe chaque zone → champ Yousign
        └─ active la demande, renvoie le lien de signature DEV
DEV signe dans Yousign → webhook signer.done(DEV) → contrat INACTIVE (dispo ADMIN)
ADMIN: /my-contract → « Voir et signer » (lien Yousign)
ADMIN signe → webhook signer.done(ADMIN)
Les deux ont signé → webhook signature_request.done
        └─ statut Yousign = DONE, PDF signé téléchargé et stocké (signed.pdf)
```

Le contrat n'est **jamais** considéré signé sur la foi d'une redirection
navigateur : seule la confirmation **webhook** (ou la synchronisation) fait foi.

## 3. Machine à états (signature)

- **Statut contrat** : `DRAFT → PENDING_DEV_SIGNATURE → INACTIVE` (après signature
  DEV) ; `FULLY_SIGNED` reste `INACTIVE` (pas d'activation sans Stripe). En cas
  d'échec : `→ FAILED` (récupérable).
- **État de signature DÉRIVÉ** (`yousign.signatureState`, exposé au frontend) :
  `NONE → REQUESTED → DEV_SIGNED → FULLY_SIGNED`, ou `DECLINED` / `EXPIRED` /
  `CANCELED`. Calculé depuis `yousign.*` — jamais stocké arbitrairement.

## 4. Mapping des coordonnées

Interne (ratios 0..1 par page) → Yousign (pixels). Centralisé et **testé** :
[yousignCoordinates.js](../backend/src/services/yousign/yousignCoordinates.js)
(`mapZoneToField`). ⚠️ L'origine (haut/bas-gauche) et la base d'indexation des
pages ne sont pas documentées par Yousign → **paramétrable** et **à valider en
sandbox** (voir [YOUSIGN_INTEGRATION.md](./YOUSIGN_INTEGRATION.md) §3). Bornes de
taille d'un champ signature respectées (85–2000 × 37–1000 px).

## 5. Signataires

Deux parties : **Entreprise développeur** (`DEVELOPER`) et **Entreprise cliente**
(`CLIENT`). Infos issues de `DevCompany` et `Company`, **figées en snapshot** à la
validation (`signatureConfiguration.signers`) : le contrat historique ne change
jamais si l'entreprise est renommée ensuite.

## 6. Webhooks

`POST /api/webhooks/yousign` — corps **brut**, signature `x-yousign-signature-256`
(HMAC-SHA256, secret du **mode actif** Yousign), **idempotent** (table
`WebhookEvent`, unique `provider+externalEventId`). Voir [WEBHOOKS.md](./WEBHOOKS.md).

| Événement | Effet |
|---|---|
| `signer.done` (DEV) | `devSignedAt` + contrat `INACTIVE` |
| `signer.done` (ADMIN) | `adminSignedAt` |
| `signature_request.done` | statut `DONE`, **PDF signé récupéré** (une fois) |
| `signature_request.declined/expired/canceled` | contrat `FAILED` (état cohérent) |

Un événement authentique mais sans contrat rattachable → **2xx** (ignoré). Une
signature invalide → **400**. Rejeu d'un événement → `{duplicate:true}`.

## 7. Timeline

`GET /api/contracts/:id/timeline` (DEV) et `/api/my-contract/timeline` (ADMIN).
Journal d'audit ordonné et libellé (jamais de secret) : *Contrat créé →
Configuration validée → Signature lancée → Signé (technique) → Signé (client) →
Contrat signé → PDF signé récupéré*. Affiché dans le Manager (DEV & ADMIN).

## 8. Synchronisation (filet de sécurité)

Les webhooks peuvent être retardés/perdus. La synchronisation relit Yousign et
corrige les états (statut, signatures, PDF signé, échec) :

- **CLI** : `npm run contracts:sync` (contrats non terminés avec une demande).
- **Endpoint DEV** : `POST /api/contracts/:id/sync`.

Idempotente ; utilise le **mode actif** Yousign ; ne touche ni Stripe ni le site.

## 9. PDF signé

À `signature_request.done`, le PDF signé est **téléchargé automatiquement** et
stocké **séparément** (`signed.pdf`) : l'**original** (`original.pdf`) n'est
**jamais** écrasé. Checksum sha256 conservé. Téléchargement contrôlé :

- `GET /api/contracts/:id/documents/original`
- `GET /api/contracts/:id/documents/signed`

DEV : tous les contrats. ADMIN : uniquement son contrat. Streaming authentifié,
anti path-traversal (voir [CONTRACTS.md](./CONTRACTS.md) §5).

## 10. Gestion des erreurs

| Cas | État résultant |
|---|---|
| Signature refusée / expirée / annulée | contrat `FAILED` (relançable) |
| API indisponible / rate limit / timeout | pas de changement d'état ; retry via sync |
| Document/demande introuvable au download | PDF récupéré plus tard par la sync |
| Email invalide / déjà signé | erreur Yousign remontée à la création (typée) |

**Relance** : `POST /api/contracts/:id/restart-signature` (contrat `FAILED` →
`PENDING_DEV_SIGNATURE`, bloc Yousign réinitialisé ; le DEV relance une nouvelle
demande). La configuration reste verrouillée.

## 11. Sandbox vs Production

- Le **mode Yousign actif** (TEST=sandbox / PROD=prod) est indépendant de `ENV`
  (cf. IntegratedAPI). La base URL est configurable par mode.
- Test réel **sandbox** : `npm run yousign:test` — connexion → création demande →
  document → signataire → champ → statut → **suppression**. Refuse si le mode
  actif n'est pas TEST (**ne touche jamais la production**), n'affiche aucun secret.
- Passage en production : configurer le mode PROD (clé + secret webhook + base
  URL), le tester, puis l'activer (bascule gardée + confirmation).

## 12. Tests

`npm run test:yousign` (mapper, coordonnées, HMAC, orchestration stub) +
`npm run test:yousign-flow` (parcours complet HTTP + webhooks : signatures,
done, PDF signé, timeline, sync, refus→FAILED→relance, double webhook, webhook
invalide, 401/403/404). Aucun appel réseau réel (provider simulé).

## 13. Endpoints (récapitulatif)

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/api/contracts/:id/validate` | Valider + verrouiller |
| POST | `/api/contracts/:id/start-dev-signature` | Créer la demande, lien DEV |
| POST | `/api/contracts/:id/restart-signature` | Relancer une signature en échec |
| GET | `/api/contracts/:id/timeline` | Timeline (DEV) |
| POST | `/api/contracts/:id/sync` | Synchroniser Yousign (DEV) |
| GET | `/api/contracts/:id/documents/original\|signed` | Télécharger (DEV/ADMIN) |
| GET | `/api/my-contract` · `/my-contract/timeline` | Contrat + timeline (ADMIN) |
| POST | `/api/my-contract/start-signature` | Lien de signature ADMIN |
| POST | `/api/webhooks/yousign` | Webhook signé + idempotent |
