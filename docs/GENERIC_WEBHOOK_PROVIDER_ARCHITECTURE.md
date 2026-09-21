# Architecture générique des webhooks d'intégration

> Chantier 2026-07-25, branche `feat/unified-production-baseline`.
> Objectif : le bootstrap et le moteur de déploiement ne connaissent AUCUN
> fournisseur. Ils ne connaissent qu'un registre d'intégrations.

## 1. Vue d'ensemble

```
bootstrap / déploiement / Manager
        │        (ne citent JAMAIS un provider)
        ▼
webhookOrchestrator.service          ← ensureAllWebhooks(mode)
        │                              ensureProviderWebhooks(provider, mode)
        ▼                              describeAllManagedWebhooks(mode)
integrationWebhookProviders          ← registre des drivers (contrat commun)
   `-- STRIPE   (moteur générique — /v1/webhook_endpoints, HMAC whsec_)

   BREVO et YOUSIGN ont quitté ce registre : leurs webhooks sont provisionnés ET
   reçus par le Panel, qui projette les faits par le pont. Un provisionneur local
   supposerait une clé locale — exactement ce que la centralisation supprime — et
   ferait courir deux administrateurs sur le même endpoint distant.
        │
        ├── remoteWebhookSyncEngine  ← MOTEUR générique (Stripe/Yousign, futurs)
        │      identification par DESCRIPTION, création auto, update, dédup sûr,
        │      capture du secret à la création, recréation si secret perdu
        ├── remoteWebhookAdapters    ← adaptateurs fetch par fournisseur
        ▼
managedWebhookRegistry               ← specs (routes, événements, secretReference)
   buildWebhookUrl()                 ← SEUL fabricant d'URL de webhook
   expectedWebhookUrl()              ← resolvePublicBackendUrl(mode) + build
        │
        ▼
networkConfig.service                ← resolvePublicBackendUrl(mode)
   (ngrok détecté en dev TEST · Config Système écrite par le déploiement en PROD)
```

## 1bis. Capacités & uniformité

Chaque driver expose `capabilities()` :
`{ createWebhook, updateWebhook, deleteWebhook, listWebhooks, repairWebhook,
testWebhook }`. Les trois APIs offrent le CRUD complet ; AUCUNE n'offre
d'événement de test officiel → `testWebhook: 'diagnostic'` partout. Le Manager
pilote ses boutons sur ces capacités — jamais un `if provider === …`.

| Action | Cycle |
|---|---|
| **Synchroniser** | lister distant → identifier NOTRE webhook (id persisté, sinon description canonique `SB_AUTO_06_MANAGED_<P>_<C>_<MODE>`) → dédoublonner (seulement les nôtres) → créer si absent (secret capturé et chiffré) → mettre à jour si divergent (URL/événements/description/désactivé) → persister id+état |
| **Réparer** | Synchroniser + recréation si le secret local manque + constat de joignabilité (sonde `…/health`) |
| **Tester** | diagnostic SANS effet distant : conformité distante + secret présent + joignabilité |

Particularités par fournisseur (limitations officielles) :
- **Stripe** : le `whsec_` n'est renvoyé qu'à la création (jamais relisible) ;
  `api_version` épinglée à la création. Gestion distante COMPLÈTE en TEST comme
  en PROD : dès qu'un backend public est résolu (tunnel ngrok en dev, domaine
  déployé en PROD), l'endpoint est créé/aligné automatiquement et le `whsec_`
  du mode est capturé puis chiffré. La SEULE raison de ne pas synchroniser est
  l'absence d'URL publique (`URL_NOT_PUBLIC`). Le mode « Stripe CLI »
  (`stripe listen`, skip `STRIPE_CLI_LOCAL`, secret local collé dans le
  Manager) est SUPPRIMÉ — Stripe CLI n'est plus une dépendance du projet, et
  un ancien secret CLI ne prend jamais priorité : la première synchronisation
  le remplace par le secret du webhook distant. Si le secret local manque
  alors que l'endpoint distant existe, l'endpoint géré est recréé (nouveau
  secret capturé), l'ancien supprimé — jamais d'état « configuré » sans secret.
  Le changement de tunnel ngrok met à jour le MÊME endpoint (id conservé,
  secret conservé), sans doublon.
- **Yousign** : `secret_key` renvoyée à la création ; TEST ⇔ `sandbox:true`.
  **Limitation officielle VÉRIFIÉE en recette réelle** (réponse API du
  2026-07-25) : « This operation is not available in Sandbox. You can create
  Webhook Subscriptions for Sandbox environment only from the application » —
  avec une clé sandbox, le webhook TEST se crée dans l'app Yousign (l'URL
  calculée est affichée par le Manager, à copier) ; la gestion automatique
  s'applique en PROD (clé production, plans Plus/Pro/Scale). L'échec est
  rapporté en warning propre, jamais bloquant.
- **Brevo** : événements en deux vocabulaires (config/payload) normalisés par
  registre ; pas de secret imposé par l'API (Bearer généré par nous).
- TEST et PROD Stripe/Yousign partagent la MÊME URL locale (`/api/webhooks/stripe`,
  `/api/webhooks/yousign`) : l'aiguillage est cryptographique (`verify*AnyMode`),
  l'identité distante est la DESCRIPTION — jamais l'URL.

## 2. Le contrat `IntegrationWebhookProvider`

Chaque driver expose :

| Méthode | Rôle |
|---|---|
| `providerCode()` | `'BREVO'`, `'STRIPE'`, … |
| `supportsWebhooks()` | gère-t-il ses webhooks À DISTANCE ? |
| `capabilities()` | create/update/delete/list/repair/test — pilote l'UI |
| `listManagedWebhooks(mode)` | `ManagedWebhookDescriptor[]` (0, 1 ou plusieurs) |
| `ensureWebhooks(mode)` | réconciliation idempotente de TOUS ses webhooks |
| `repairWebhooks(mode)` | sync + recréation secret + constat de joignabilité |
| `getWebhookHealth(mode)` | joignabilité seule |
| `testWebhooks(mode)` | diagnostic complet sans effet distant |

Un provider peut avoir **zéro, un ou plusieurs webhooks** sans que le moteur
change : il agrège des rapports, jamais des détails.

### `ManagedWebhookDescriptor`

`{ provider, category, mode, expectedUrl, expectedEvents, secretReference,
remoteWebhookId, remoteStatus, lastSyncStatus, lastSyncError, lastSyncAt,
lastReceivedEventAt, lastReceivedEventType, publicBackendUrl, publicUrlSource,
webhookReady, supportsRemoteSync }` — jamais un secret, seulement sa référence
(nom du credential chiffré dans `IntegratedApi.modes[mode].credentials`).

## 3. Cycle de vie

- **Bootstrap** (`config/bootstrap.js`) : `ensureAllWebhooks(config.isProd ?
  'PROD' : 'TEST')` — timeouté (20 s), best-effort, aucun provider cité. En dev,
  une **veille ngrok** (60 s, `unref`) relance `ensureAllWebhooks('TEST')` quand
  l'URL publique du tunnel change. PROD n'est jamais touché depuis un poste dev.
- **Déploiement** : le moteur n'a AUCUNE notion de webhook (vérifié par test).
  Il écrit `SystemConfiguration.network.backendUrl = https://api.<domaine>`
  (étape `runtime_config`) puis redémarre PM2 → le bootstrap du backend déployé
  fait la réconciliation PROD. Un échec produit un warning, jamais un
  déploiement raté.
- **Manager** (`/dev/managed-webhooks/*`) : vue générique « Webhooks des
  intégrations » (composant `ProviderWebhooksCard`) — par provider : nombre de
  webhooks, état, dernier sync, dernier événement, actions Synchroniser /
  Réparer / Tester. URLs en lecture seule.

## 4. Ajouter un nouveau provider

1. Déclarer ses webhooks dans `managedWebhookRegistry.js` (`MANAGED_WEBHOOKS`) :
   catégorie(s), `routeSegments`, `expectedEvents`, `secretReference`.
2. Écrire un ADAPTATEUR distant minimal (list/create/update/remove) dans
   `remoteWebhookAdapters.js`, puis composer le driver via
   `createRemoteWebhookManager(...)` + `engineProvider(...)` dans
   `integrationWebhookProviders.js` — la politique (identification, dédup,
   secrets, états) est fournie par le moteur, pas réécrite.
3. L'ajouter au tableau `PROVIDERS`.

C'est tout : bootstrap, déploiement, orchestrateur, routes et carte Manager le
prennent en charge sans modification.

## 5. Sécurité

- Aucun secret dans les descripteurs, rapports, logs ou réponses HTTP.
- Routes Manager : DEV uniquement (`authenticate` + `authorize(DEV)`).
- La réception des webhooks reste inchangée (Bearer par mode pour Brevo, HMAC
  pour Stripe/Yousign, idempotence, 401 neutres).

## 6. Tests

`backend/src/scripts/webhook-orchestrator.test.js` (35 ✓) et
`webhook-providers-uniformity.test.js` (48 ✓ — création auto, idempotence,
changement d'URL→même id, dédup sûr, secret capturé/recréé, sync TEST jamais
sautée (variable legacy `STRIPE_CLI_ENABLED` ignorée), migration de l'ancien
secret Stripe CLI (remplacé à la première synchro), isolation TEST/PROD
stricte, repli de chemin Yousign, uniformité du contrat), câblés dans `npm test` : contrat sur providers factices (0/1/plusieurs webhooks, désactivé,
erreur isolée, ordre, résumé), registre réel, descripteurs réels (DB mémoire),
**généricité vérifiée par analyse de source** (bootstrap sans
`ensureBrevoTransactionalWebhook`, moteur de déploiement sans aucune mention
de provider), `buildWebhookUrl` multi-providers. Non-régression : suites Brevo
existantes inchangées.
