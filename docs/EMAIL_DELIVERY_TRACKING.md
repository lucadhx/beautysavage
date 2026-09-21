# Suivi réel des livraisons (webhooks transactionnels Brevo)

> **⚠️ PARTIELLEMENT OBSOLÈTE.**
>
> Le vocabulaire d'événements et les transitions de livraison décrits ici restent
> exacts. Le **transport** ne l'est plus : ces événements n'arrivent plus par un
> webhook Brevo local — ils arrivent au Panel, qui les reprojette par le pont
> sous deux verbes (`EMAIL_DELIVERED` / `EMAIL_BOUNCED`).
>
> Voir [INTEGRATED_API.md](INTEGRATED_API.md#brevo--e-mail) et
> [PANEL_BRIDGE.md](PANEL_BRIDGE.md).


Ce que Brevo nous apprend APRÈS l'acceptation d'un envoi : délivré, différé,
rebondi, bloqué, signalé, désinscrit — et l'engagement (ouvert, cliqué).

Voir aussi : [EMAIL_DELIVERY.md](EMAIL_DELIVERY.md) (l'envoi et le `SENT`),
[BREVO_WEBHOOKS.md](BREVO_WEBHOOKS.md) (événements & endpoint),
[BREVO_WEBHOOK_SECURITY.md](BREVO_WEBHOOK_SECURITY.md) (authentification Bearer).

> **Périmètre livré (Lot 7).** Moteur de suivi (normalisation, journal idempotent,
> rapprochement, machine d'état, réconciliation, endpoint Bearer), **synchronisation
> distante** du webhook chez Brevo (création/adoption/mise à jour/détection de
> suppression via `/v3/webhooks`), **rotation du secret** (double clé), **API DEV de
> consultation** et **écrans Manager** (livraisons + configuration webhook). Reste
> hors périmètre : la **recette réelle de bout en bout** (cf.
> [BREVO_WEBHOOK_REAL_TEST_CHECKLIST.md](BREVO_WEBHOOK_REAL_TEST_CHECKLIST.md)) et le
> webhook **batché** (volontairement exclu).

---

## 1. `SENT` ≠ `DELIVERED` — la raison d'être du lot

`SENT` = Brevo a **accepté** l'envoi et renvoyé un `messageId`. C'est tout ce que
le code d'envoi peut constater. Il ne dit **rien** de la boîte du destinataire.

Seul un **webhook `delivered`** permet d'écrire `DELIVERED`. Cette règle est
absolue : **aucun** chemin n'écrit `DELIVERED` sans événement fournisseur (le
`setDeliveredAt` de la machine d'état n'est posé que sur un événement `delivered`).

---

## 2. La chaîne

```
Brevo
  └─ POST /api/webhooks/brevo/transactional/:mode   (test|prod, Bearer)
      └─ vérification Bearer (avant tout traitement métier)
          └─ ingestBrevoWebhookEvent({ mode, payload })
              ├─ 1. normalisation      (deux espaces de noms → type canonique)
              ├─ 2. persistance idempotente  (BrevoWebhookEvent, clé composée)
              ├─ 3. rapprochement      (provider+mode+messageId → EmailDelivery)
              ├─ 4. machine d'état     (applyBrevoEventToDelivery, déterministe)
              └─ 5. timeline           (EmailDeliveryEvent, une par transition)
```

Le `mode` vient **toujours de la route**, jamais d'un champ du payload.

---

## 3. Deux espaces de noms, un seul sens

Brevo emploie **deux vocabulaires** pour le même événement — les confondre est la
première source de bugs :

| Événement | Config-time (souscription `POST /v3/webhooks`) | Payload-time (corps reçu) |
|---|---|---|
| Rebond temporaire | `softBounce` | `soft_bounce` |
| Rebond définitif | `hardBounce` | `hard_bounce` |
| Adresse invalide | `invalid` | `invalid_email` |
| Ouverture unique | `uniqueOpened` | `unique_opened` |
| Ouverture proxy | *(n/a)* | `proxy_open`, `unique_proxy_open` |

[`brevoTransactionalEventRegistry.js`](../backend/src/utils/brevoTransactionalEventRegistry.js)
normalise **les deux** vers un type canonique (`NORMALIZED_EVENT`). La clé de
comparaison est mise en minuscule et débarrassée des `-`/`_` : elle absorbe les
deux espaces de noms et la casse, **sans** accepter n'importe quelle chaîne (seule
une clé listée est reconnue ; sinon `known:false`).

Mapping : `request→ACCEPTED`, `sent→SENT`, `delivered→DELIVERED`,
`deferred→DEFERRED`, `soft*→SOFT_BOUNCE`, `hard*→HARD_BOUNCE`, `blocked→BLOCKED`,
`spam→SPAM`, `invalid*→INVALID`, `error→ERROR`, `unsubscribed→UNSUBSCRIBED`,
`opened→OPENED`, `unique*opened→UNIQUE_OPENED`, `proxy*→PROXY_OPEN`, `click→CLICKED`.

---

## 4. Idempotence — Brevo n'a pas d'id d'événement

Le champ `id` du payload est l'id **du webhook**, pas de l'événement. Aucun
identifiant unique par événement n'existe. La clé d'idempotence est donc
**composée** ([`brevoWebhookIngest.service.js`](../backend/src/services/brevo/brevoWebhookIngest.service.js)) :

```
mode | messageId | eventNormalisé | occurredAt(ms) | recipientHash
```

- **Jamais l'adresse en clair** : le destinataire n'entre que **haché** (`keyHash`).
- Index **unique** sur `idempotencyKey` → le même webhook rejoué dix fois crée
  **une** ligne, produit **une** transition, renvoie un succès sans re-timeline ni
  compteur gonflé. Persistance par `create` + capture du `11000` (doublon).

---

## 5. Rapprochement — par messageId, jamais par e-mail

Clé de rapprochement : **`(provider, providerMode, providerMessageId)`**. Un
événement d'un mode ne rapproche **jamais** une livraison de l'autre mode (TEST et
PROD = deux comptes Brevo distincts).

Le `messageId` renvoyé par `/smtp/email` peut être stocké avec chevrons
(`<…@…>`) tandis que le webhook envoie parfois la forme nue. On **normalise des
deux côtés** (chevrons + espaces retirés) et on interroge les variantes. **Aucune**
autre heuristique : pas de rapprochement par e-mail (deux envois vers la même
adresse seraient confondus).

Sans livraison correspondante → événement **`UNMATCHED`** (jamais de fausse
livraison créée), réconciliable plus tard.

---

## 6. Machine d'état — déterministe, sûre au désordre

[`brevoDeliveryTransitions.js`](../backend/src/services/email/brevoDeliveryTransitions.js)
est une fonction **pure** (testable sans base). Deux invariants :

1. **Aucune régression au désordre.** Les statuts sont ordonnés par **précédence** ;
   un événement n'écrase que s'il est *strictement plus avancé*. `DELIVERED` puis un
   `request` retardé **reste** `DELIVERED`.
2. **Les négatifs terminaux ne sont pas écrasés** par un événement tardif moins
   informatif (`HARD_BOUNCED` puis `delivered` tardif reste `HARD_BOUNCED`, et ne
   pose pas `deliveredAt`).

Précédence : `PENDING(0) < SENDING/FAILED(1) < SENT(2) < DEFERRED(3) <
SOFT_BOUNCED(4) < DELIVERED(5) < UNSUBSCRIBED(6) < SPAM(7) <
{BLOCKED, INVALID, HARD_BOUNCED, ERROR, BOUNCED}(8)`.

Transitions validées : `SENT→DELIVERED`, `SENT→DEFERRED`, `DEFERRED→DELIVERED`,
`DEFERRED→SOFT_BOUNCED`, `SOFT_BOUNCED→DELIVERED`, `SENT→HARD_BOUNCED`,
`SENT→BLOCKED`, `SENT→INVALID`, `DELIVERED→SPAM`, `DELIVERED→UNSUBSCRIBED`.

**L'engagement (`OPENED`/`CLICKED`/proxy) ne change JAMAIS le statut** : historisé à
part dans `engagement { openCount, clickCount, first/last… }`.

### Soft bounce vs hard bounce

- **Soft bounce** : échec *potentiellement temporaire* (boîte pleine, serveur
  indisponible, report). Statut `SOFT_BOUNCED`. Peut redevenir `DELIVERED`.
- **Hard bounce** : échec *permanent* (adresse inexistante, domaine invalide).
  Statut `HARD_BOUNCED`, terminal.

Aucun **renvoi automatique** n'est déclenché par un bounce dans ce lot. Le retry
interne de `EventActionExecution` concerne l'appel *initial* vers Brevo, pas une
relance métier après rebond. Un `deferred` **ne** repasse **pas** l'exécution en
retry : l'appel a déjà été accepté, on attend les webhooks suivants.

### `EventActionExecution` reste `SUCCEEDED`

Une exécution `SUCCEEDED` (l'action d'envoi a été acceptée) n'est **jamais**
retransformée en `FAILED` par un webhook. Réussite de l'action, état de livraison
et engagement du destinataire sont **trois choses distinctes**.

---

## 7. Confidentialité & fiabilité du tracking

- **Ouvertures/clics ≠ preuve de lecture.** Blocage d'images, préchargement, proxy
  de confidentialité (Apple MPP → `proxy_open`), inspection de sécurité des liens :
  l'UI dira « **ouverture détectée** », jamais « le destinataire a lu ».
- **URL cliquée** : on ne garde que le **domaine** (`linkDomain`), jamais les
  paramètres (souvent des tokens).
- **`rawPayloadSafe`** ne conserve que des champs curés (`event`, `reason`,
  `bounceType`, `errorCode`, `tag`, `templateId`, `linkDomain`). Jamais : sujet
  rendu, HTML, variables, en-têtes, cookies, tokens, adresse en clair.

---

## 8. Réconciliation

[`reconcileUnmatchedBrevoWebhookEvents({ limit })`](../backend/src/services/brevo/brevoWebhookIngest.service.js)
retente le rapprochement des événements `UNMATCHED`/`FAILED` (cas : webhook reçu
avant que la livraison soit visible, ou incident temporaire). Idempotente (index
unique de timeline), **bornée**, paginée. CLI : `npm run brevo:webhooks:reconcile`
(option `-- --limit=500`). Aucun intervalle invisible.

---

## 9. Fichiers

| Fichier | Rôle |
|---|---|
| [`utils/brevoTransactionalEventRegistry.js`](../backend/src/utils/brevoTransactionalEventRegistry.js) | Normalisation des deux espaces de noms |
| [`services/email/brevoDeliveryTransitions.js`](../backend/src/services/email/brevoDeliveryTransitions.js) | Machine d'état pure |
| [`services/brevo/brevoWebhookIngest.service.js`](../backend/src/services/brevo/brevoWebhookIngest.service.js) | Ingestion idempotente + réconciliation |
| [`services/brevo/brevoWebhookAuth.service.js`](../backend/src/services/brevo/brevoWebhookAuth.service.js) | Vérification Bearer |
| [`models/BrevoWebhookEvent.model.js`](../backend/src/models/BrevoWebhookEvent.model.js) | Journal fournisseur |
| [`models/EmailDeliveryEvent.model.js`](../backend/src/models/EmailDeliveryEvent.model.js) | Timeline d'une livraison |
| [`controllers/webhook.controller.js`](../backend/src/controllers/webhook.controller.js) | Endpoint `brevoTransactionalWebhook` |

**Tests** : `npm run test:brevo-webhook` (67 assertions, aucun réseau).

---

## 10. Configuration distante, API DEV, écrans Manager

- **Synchronisation distante** — [`brevoWebhookConfig.service.js`](../backend/src/services/brevo/brevoWebhookConfig.service.js) :
  URL canonique dérivée de la **SEULE source de vérité** — « Configuration Système →
  Réseau » (`SystemConfiguration.network.backendUrl`, via
  [`networkConfig.service.js`](../backend/src/services/networkConfig.service.js)),
  la même que le test réseau. **Aucun repli** sur `PUBLIC_URL`/localhost : URL absente
  ou non-HTTPS publique → **erreur explicite**, jamais de webhook créé avec localhost.
  Chemin `/api/webhooks/brevo/transactional/:mode`,
  liste distante, identification (id → URL → description **unique**), création,
  **adoption** d'un webhook créé hors Manager, mise à jour sur divergence, détection
  de suppression externe, jamais de doublon, erreur claire sur **limite Brevo**.
  Diagnostic non destructif (aucun faux événement). Description stable
  `SBauto06 transactional delivery tracking - {MODE}`.
- **Rotation du secret** — maj distante d'abord, **double clé** avec fenêtre de
  transition (l'ancien secret reste accepté ~15 min via `verifyBrevoWebhookBearer`).
- **API DEV** — `GET /api/dev/email-deliveries` (+`/:id`, +`/:id/events`),
  `GET /api/dev/brevo-webhook-events` (+`/:id`),
  `GET|POST /api/dev/brevo-webhook-config/:mode` (`sync`/`diagnose`/`rotate-secret`/`disable`).
- **Écrans Manager** — page `/dev/livraisons-email` (liste/détail/timeline) et
  section « Webhook transactionnel » dans la carte Brevo de `/dev/integrations`.

> **Aucun webhook transactionnel Brevo réel n'a été validé de bout en bout pendant
> ce lot** : la recette (URL publique + vrai compte Brevo) reste à exécuter.
