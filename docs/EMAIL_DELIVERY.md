# Livraison des e-mails

Readiness, provider Brevo, journal des envois, idempotence, handler `SEND_EMAIL`.

Voir aussi : [EMAIL_TEMPLATES.md](EMAIL_TEMPLATES.md),
[EMAIL_CONFIGURATION.md](EMAIL_CONFIGURATION.md) (expéditeur, domaine),
[DOMAIN_EVENTS.md](DOMAIN_EVENTS.md) (événements et actions).

---

## 1. La chaîne

```
Événement métier
  └─ DomainEventDispatcher
      └─ EventActionExecution (une PAR destinataire)
          └─ sendEmailHandler
              ├─ emailRecipientResolvers   → qui reçoit
              ├─ emailVariableResolvers    → quelles valeurs
              └─ EmailDeliveryService.sendTemplate()
                  ├─ 1. idempotence        (actionExecutionId)
                  ├─ 2. EmailReadinessService   ← POINT DE PASSAGE OBLIGÉ
                  ├─ 3. EmailTemplateRenderer
                  ├─ 4. EmailDelivery (PENDING → SENDING)
                  ├─ 5. BrevoEmailProvider  → POST /v3/smtp/email
                  └─ 6. EmailDelivery (SENT + messageId)
```

**Aucune route, aucun handler, aucun script n'appelle `BrevoEmailProvider`
directement.** Cette unicité est ce qui rend vérifiable qu'un expéditeur non
vérifié ne peut pas produire un envoi par un chemin qu'on aurait oublié de
protéger.

---

## 2. `SENT` ≠ `DELIVERED`

**La distinction la plus importante de ce module.**

| Statut | Signifie | Qui l'écrit |
|---|---|---|
| `PENDING` | livraison créée, pas encore tentée | `EmailDeliveryService` |
| `SENDING` | appel fournisseur en cours (fenêtre de crash) | `EmailDeliveryService` |
| **`SENT`** | **Brevo a ACCEPTÉ et renvoyé un `messageId`** | `EmailDeliveryService` |
| `FAILED` | échec (voir `lastErrorSafe.retryable`) | `EmailDeliveryService` |
| `BLOCKED` | refusé avant tout appel (readiness) | `EmailDeliveryService` |
| **`DELIVERED`** | **le serveur du destinataire a accepté** | **webhook uniquement** |
| `BOUNCED` | rebond confirmé | **webhook uniquement** |

`SENT` est **tout ce que notre code peut constater**. Il ne dit rien de la boîte
du destinataire : un e-mail accepté par Brevo peut rebondir trente secondes plus
tard, être classé en spam, ou être refusé par le serveur d'en face.

> **Aucun code n'écrit `DELIVERED` ou `BOUNCED` à ce jour.** Ces statuts existent
> dans le modèle pour que le lot webhooks n'ait pas à migrer quoi que ce soit
> (§7). Tant qu'ils ne sont pas branchés, **aucun écran n'affirme qu'un e-mail a
> été reçu.**

**Formulation imposée** côté Manager après un envoi de test :

> L'email a été accepté par Brevo pour envoi.

Et non « Envoyé » ni « Délivré ». Côté liste : « Accepté par Brevo », avec un ton
**neutre** — un badge vert laisserait croire au succès complet.

---

## 3. `EmailReadinessService`

[`emailReadiness.service.js`](../backend/src/services/email/emailReadiness.service.js)

```json
{ "ready": false, "blockers": [{ "code": "…", "message": "…" }], "warnings": [], "context": {} }
```

### BLOQUANT vs AVERTISSEMENT

**La distinction est le cœur de ce service, et la confondre coûte cher dans les
deux sens** : bloquer sur un avertissement rend le produit inutilisable, avertir
sur un blocage produit un échec incompréhensible.

| Bloquant | Quand |
|---|---|
| `PROVIDER_NOT_CONFIGURED` | Brevo absent, désactivé, ou aucun mode actif |
| `PROVIDER_KEY_MISSING` | pas de clé pour le mode actif |
| `PROVIDER_NOT_VERIFIED` | clé présente, **test de connexion jamais réussi** |
| `SENDER_NOT_CONFIGURED` | aucune adresse expéditrice |
| `TEMPLATE_NOT_FOUND` / `TEMPLATE_DISABLED` / `TEMPLATE_INVALID` | template |
| `RECIPIENT_INVALID` / `NO_RECIPIENT` | destinataire |

> **CE PROJET DÉCLARE LES MODÈLES QU'IL UTILISE.**
>
> Le contenu ne vit plus ici : il vit au Panel, en portée `PROJECT/<ce projet>`.
> Et ce n'est pas le Panel qui décide lesquels — c'est ce projet, qui les
> DÉCLARE au démarrage et à chaque appairage, via l'entité de synchronisation
> `PROJECT_EMAIL_TEMPLATE_USAGE`.
>
> La liste est **dérivée**, jamais tenue à la main
> (`utils/projectEmailTemplateUsage.js`) : les modèles des actions d'événement
> ACTIVES, plus les appelants directs de `sendTemplate()` recensés nommément.
> Une action désactivée n'est pas un consommateur, et son modèle n'est donc pas
> demandé. Les modèles de portée `PANEL` — `PLATFORM_INCIDENT_DEV_ALERT` — n'y
> figurent jamais : ils appartiennent à L.Y Solution.
>
> Deux refus, deux causes distinctes, deux corrections différentes :
>
> | Code | Ce qu'il dit | Où l'on corrige |
> |---|---|---|
> | `EMAIL_TEMPLATE_NOT_CONFIGURED` | le Panel n'a aucune instance pour ce projet | côté **Panel** : réconciliation ou migration |
> | `EMAIL_TEMPLATE_NOT_DECLARED_BY_PROJECT` | ce projet affirme ne plus utiliser ce modèle | côté **projet** : un chemin métier appelle un modèle qu'il ne déclare plus |
>
> Conséquence pratique : **adopter un modèle existant ne demande aucun
> redéploiement du Panel**. Brancher le consommateur, déployer le projet, c'est
> tout. Seul un `templateCode` NOUVEAU exige un déploiement du Panel — voir
> `Panel/docs/PROTOCOL.md` § « NOUVEAU MODÈLE D'E-MAIL ».

`readiness` ne produit plus AUCUN avertissement : depuis que le suivi de
livraison est obligatoire, un envoi est soit possible, soit refusé — il n'y a
plus d'entre-deux « ça part quand même, mais mal ».

> **Trois codes ont disparu** : `EMAIL_SENDER_NOT_VERIFIED`,
> `DOMAIN_NOT_AUTHENTICATED` et `DOMAIN_PUBLIC_NOT_AUTHENTICABLE`. Ils
> reproduisaient dans le Manager un état (expéditeur vérifié, domaine
> authentifié, DKIM) qui s'administre chez le fournisseur, et dont le commerçant
> ne fait rien. La seule question retenue est « les e-mails arrivent-ils ? », à
> laquelle un envoi réel répond mieux qu'un état recopié. Un test verrouille leur
> absence (`manager/src/lib/emailTemplates.test.mjs`).

## Le contrôle qui compte : le suivi de livraison

`readiness` vérifie la CONFIGURATION. Un second contrôle, distinct et
incontournable, vérifie que l'issue de l'envoi sera CONSTATABLE : sans webhook
joignable, l'envoi est refusé avant tout appel au fournisseur, et la livraison
porte `PRECONDITION_FAILED` (jamais `FAILED` : rien n'a été tenté). La reprise
est automatique.

Cette règle, le pipeline complet et le vocabulaire d'états sont décrits dans
**[BREVO_MODULE.md](BREVO_MODULE.md)**, document de référence du module.

---

## 4. `BrevoEmailProvider`

[`brevo/brevoEmail.service.js`](../backend/src/services/brevo/brevoEmail.service.js)

Troisième driver de la famille (`brevoSenders`, `brevoDomains`, celui-ci), **même
patron** : `getCredential('BREVO', 'apiKey', { mode })` +
`getProviderBaseUrl('BREVO', { mode })` du mode IntegratedAPI actif. Ce n'est
**pas un second provider Brevo** — c'est une autre famille d'endpoints du même
provider, résolue par le même chemin de credentials.

### `POST /v3/smtp/email`

```json
{
  "sender": { "name": "SB Auto", "email": "support@exemple.fr" },
  "to": [{ "email": "…", "name": "…" }],
  "subject": "…",
  "htmlContent": "…"
}
```

→ `201 { "messageId": "<…@brevo>" }`

> **NOS templates, jamais ceux de Brevo.** On n'envoie **pas** `templateId` :
> utiliser les templates hébergés chez Brevo mettrait le contenu hors de notre
> dépôt, hors de nos versions, hors de notre validation — et le rendrait éditable
> depuis leur interface, sans trace chez nous.

### Classification des erreurs — la décision qui compte

| HTTP | Code | Retryable | Pourquoi |
|---|---|---|---|
| 401 | `PROVIDER_ERROR` | **non** | clé invalide ou IP non autorisée : une configuration à corriger, pas un aléa |
| 400 | `PROVIDER_ERROR` | **non** | requête fautive : la rejouer à l'identique produirait le même refus |
| 402 | `PROVIDER_ERROR` | **non** | crédits épuisés — aucun backoff de dix minutes ne recharge un compte. Le DEAD_LETTER rend le problème visible tout de suite |
| 429 | `RATE_LIMITED` | **oui** | le cas que le backoff sait résoudre |
| 5xx | `PROVIDER_ERROR` | **oui** | panne de leur côté |
| réseau / timeout | `NETWORK_ERROR` | **oui** | l'e-mail est peut-être déjà parti — c'est l'idempotence qui protège du doublon, pas le refus de réessayer |
| 2xx sans `messageId` | `PROVIDER_ERROR` | **non** | anormal ; rejouer risquerait un doublon si l'envoi est en réalité parti |

**La décision est prise ici, une seule fois**, et seulement transportée ensuite :
deux endroits qui classent les erreurs finiraient par se contredire.

### Ce qui ne sort jamais

La clé API n'est ni journalisée ni renvoyée. Le HTML complet non plus. La trace
est volontairement pauvre : mode, adresse **masquée**, taille du contenu.

---

## 5. Journal — `EmailDelivery`

[`EmailDelivery.model.js`](../backend/src/models/EmailDelivery.model.js)

### Ce qui n'est PAS stocké, et pourquoi

Ce journal sert à **diagnostiquer**, pas à relire des e-mails. Trois décisions de
minimisation :

#### a. Le HTML final n'est JAMAIS persisté

Un e-mail rendu contient tout ce que le métier y a mis : nom, adresse, téléphone,
message libre d'un visiteur, montants. Le stocker créerait une copie durable de
données personnelles dans une collection technique — **celle à laquelle personne
ne pense lors d'une demande d'effacement**. Et il est reconstructible :
`templateId` + `templateVersion` donnent le contenu exact.

#### b. Le sujet est stocké NON RENDU — décision documentée

```
stocké  : « Nouvelle demande de contact — {{contact.name}} »
envoyé  : « Nouvelle demande de contact — Jean Dupont »
```

Le sujet **rendu** est une donnée personnelle (il porte souvent un nom, parfois un
montant). Le sujet **non rendu** n'en est pas une, et il répond pourtant à la
seule question qu'on se pose ici : *« quel e-mail est parti ? »*.

> Un **hash** aurait répondu « lequel » sans dire « quoi » — illisible pour un
> humain qui débogue, et sans bénéfice supplémentaire puisque le motif ne révèle
> rien. Le motif est le bon niveau de minimisation.

#### c. Les adresses sont masquées

`recipientEmailMasked` / `sender.emailMasked` → `j***@exemple.fr`. Le domaine
reste lisible — c'est lui qui porte l'information de délivrabilité (« tous les
envois vers @orange.fr rebondissent »). La boîte, non.

L'identité n'est pas perdue : `recipientKey` est une empreinte stable
(`keyHash`), suffisante pour dédupliquer et corréler **sans conserver l'adresse**.

### Champs

| Champ | Note |
|---|---|
| `deliveryId` | identifiant public, non devinable |
| `eventId` | `null` pour un envoi de test |
| `actionExecutionId` | **porte l'idempotence** — `null` pour un test |
| `templateId` + `templateVersion` | sans la version, le contenu envoyé est irretrouvable |
| `providerMode` | TEST et PROD = deux comptes Brevo possibles ; sans cette trace, un envoi introuvable chez Brevo resterait inexplicable |
| `subjectSnapshot` | sujet **non rendu** |
| `providerMessageId` | notre seule poignée vers leur tableau de bord |
| `sentAt` / `deliveredAt` | `deliveredAt` : **webhook uniquement** |

---

## 6. Idempotence

### L'index

```js
emailDeliverySchema.index(
  { actionExecutionId: 1 },
  { unique: true, partialFilterExpression: { actionExecutionId: { $type: 'string' } } }
);
```

**Partiel, et non `sparse`** : `sparse` ignore les documents dont le champ est
*absent*, mais pas ceux où il vaut `null`. Or le schéma pose `default: null` —
tous les envois de test porteraient `null` et le second violerait un index sparse
unique. `$type: 'string'` ne contraint que les vraies exécutions, et laisse les
tests libres. **Testé dans les deux sens.**

### Les trois situations

| État trouvé | Traitement |
|---|---|
| **`SENT`** | on renvoie le résultat existant, **aucun appel Brevo**. Garantie forte : retry du dispatcher, reprise au démarrage, deux workers — aucun ne renverra cet e-mail. |
| **`SENDING`** | **fenêtre de crash** — voir ci-dessous |
| `FAILED` / `BLOCKED` | on réessaie sur la **même** livraison, `attempts++`. Une ligne par destinataire, pas une par tentative. |

### La fenêtre de crash — un arbitrage explicite

Le processus est mort entre l'appel à Brevo et l'écriture du résultat. **On ne
peut pas savoir si l'e-mail est parti** : Brevo n'expose aucune clé d'idempotence
sur `/smtp/email` (contrairement à Stripe), et rien ne permet de rejouer la
question.

**Décision : on ne renvoie PAS automatiquement.** La livraison passe en `FAILED`,
non retryable, code `SEND_INTERRUPTED` → `DEAD_LETTER` côté dispatcher → **visible**.
Un humain tranche (le retry manuel de la route DEV remet l'exécution en attente).

**Pourquoi ce sens-là.** Les deux erreurs ne se valent pas :

- un **doublon** est irréversible et arrive chez un client ;
- une **notification manquante** est réparable d'un clic, et elle est **signalée**.

La consigne « aucun double envoi » impose ce choix. Le jour où Brevo exposera une
clé d'idempotence, ce compromis disparaîtra.

---

## 7. Webhooks — le suivi réel (Lot 7, backend)

Le modèle était **prêt à les recevoir** : `DELIVERED`, `BOUNCED` existaient déjà,
`deliveredAt` aussi, et l'index sur `providerMessageId` servait de point d'ancrage.
Aucune migration n'a été nécessaire — seulement des **ajouts** : statuts fins
(`DEFERRED`, `SOFT_BOUNCED`, `HARD_BOUNCED`, `INVALID`, `SPAM`, `ERROR`,
`UNSUBSCRIBED`), sous-objet `engagement`, `lastEventType`/`lastEventAt`, et un index
composé `(provider, providerMode, providerMessageId)`.

Le **moteur de suivi** est décrit dans son propre document :
[EMAIL_DELIVERY_TRACKING.md](EMAIL_DELIVERY_TRACKING.md) (normalisation, journal
`BrevoWebhookEvent`, rapprochement, machine d'état `applyBrevoEventToDelivery`,
timeline `EmailDeliveryEvent`, réconciliation, endpoint sécurisé Bearer).

> **Règle à ne jamais enfreindre** : `DELIVERED` n'est **jamais** écrit sans
> événement fournisseur `delivered`. Le webhook en est le **seul** émetteur.

> **Non encore livré** (déclaré) : synchronisation distante du webhook chez Brevo,
> rotation du secret, API DEV de consultation, écrans Manager. La **recette réelle**
> n'a **pas** été exécutée — cf.
> [BREVO_WEBHOOK_REAL_TEST_CHECKLIST.md](BREVO_WEBHOOK_REAL_TEST_CHECKLIST.md).

---

## 8. Handler `SEND_EMAIL`

[`sendEmailHandler.js`](../backend/src/services/email/sendEmailHandler.js)

**Il s'enregistre, il n'est pas importé** : `registerHandler(SEND_EMAIL, …)` +
`registerRecipientKeyResolver(…)` au bootstrap. Le dispatcher ne connaît pas
l'e-mail — c'est le métier qui vient se déclarer. Importer les résolveurs dans le
registre y ferait entrer le métier et créerait le cycle que ce mécanisme existe
pour éviter.

> **Ordre au bootstrap** : `initEmailModule()` est appelé **avant**
> `processPendingEventActions()`. L'ordre n'est pas cosmétique — une exécution
> `SEND_EMAIL` reprise au démarrage tomberait sur le handler de repli et partirait
> en `DEAD_LETTER` pour rien.

| Cas | Résultat |
|---|---|
| Envoi accepté | `SUCCEEDED` + `providerMessageId` |
| Déjà envoyé (rejeu) | `SUCCEEDED`, aucun appel Brevo |
| **Zéro destinataire** | **`DEAD_LETTER`** (`EMAIL_RECIPIENTS_NOT_FOUND`, non retryable). Une exécution est matérialisée puis échoue : une action **activée** dont personne ne reçoit le résultat est un problème, pas une décision. Un `SKIPPED` rendrait l'événement `DISPATCHED` — « tout va bien » — alors que **personne n'a été prévenu**. Non retryable : aucun backoff ne crée un compte |
| Destinataire disparu | `SKIPPED` (message distinct : un compte supprimé n'est pas « aucun destinataire ») |
| Pas de résolveur de variables | `DEAD_LETTER` immédiat, non retryable |
| 429 / 5xx / réseau | `FAILED` → backoff (30 s, 2 min, 10 min ; 4 tentatives) |
| 401 / 400 / 402 | `DEAD_LETTER` immédiat |

**`SUCCEEDED` n'est écrit qu'après réponse de Brevo.** Il n'existe aucun chemin par
lequel une exécution passe `SUCCEEDED` sans qu'un `messageId` existe. C'est
l'invariant qui rend le journal crédible.

> **Premier usage réel** : `contact.submitted` → `CONTACT_ADMIN_NOTIFICATION` est
> activé depuis le lot contact. C'est le premier e-mail métier que ce dispositif
> envoie pour de bon. Voir [CONTACT_EMAIL_NOTIFICATION.md](CONTACT_EMAIL_NOTIFICATION.md).

---

## 9. Fichiers et tests

| Fichier | Rôle |
|---|---|
| [`services/email/emailReadiness.service.js`](../backend/src/services/email/emailReadiness.service.js) | Point de passage obligé |
| [`services/brevo/brevoEmail.service.js`](../backend/src/services/brevo/brevoEmail.service.js) | Transport `/v3/smtp/email` |
| [`services/email/emailDelivery.service.js`](../backend/src/services/email/emailDelivery.service.js) | Orchestration + journal |
| [`services/email/sendEmailHandler.js`](../backend/src/services/email/sendEmailHandler.js) | Handler + résolveur de clés |
| [`services/email/emailModule.js`](../backend/src/services/email/emailModule.js) | Branchement au bootstrap |
| [`models/EmailDelivery.model.js`](../backend/src/models/EmailDelivery.model.js) | Journal |

**Tests** : [`email-delivery.test.js`](../backend/src/scripts/email-delivery.test.js)
(`npm run test:email-delivery` — 206 assertions, provider simulé, **aucun e-mail
réel**).
