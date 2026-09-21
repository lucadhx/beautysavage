# Événements métier — registre, émission, sécurité

> Infrastructure code-first d'émission d'événements. Voir aussi
> [EVENT_DISPATCHER.md](EVENT_DISPATCHER.md) (exécution) et
> [EVENT_ACTION_EXECUTIONS.md](EVENT_ACTION_EXECUTIONS.md) (journal des actions).

---

## 1. Doctrine

Un **événement est un FAIT** : « ceci s'est produit ». Une **action est une
CONSÉQUENCE** : « voilà ce qu'on en fait ». Les deux sont séparés, et c'est cette
séparation qui permet qu'un échec d'envoi d'e-mail **ne remette jamais en cause**
la résiliation qui l'a déclenché.

Tout est **code-first** :

- aucun type d'événement en base ;
- aucune règle métier en base ;
- aucun DSL, aucun moteur de règles éditable ;
- aucune création depuis le Manager.

La base ne stocke que **des faits** (`DomainEvent`) et **l'état de leur
traitement** (`EventActionExecution`).

## 2. Registre canonique

`backend/src/utils/domainEventRegistry.js` — **source de vérité unique**. Un type
absent du registre n'existe pas : `emit()` le refuse.

```js
'email.test.succeeded': {
  type, description, entityTypes: ['EmailConfiguration'],
  payloadSchema: z.object({...}).strict(),
  retentionClass: 'AUDIT',
}
```

### Types déclarés

| Type | Émis ? | Actions | Rétention |
|---|---|---|---|
| `email.sender.updated` | ✅ | — | AUDIT |
| `email.test.succeeded` | ✅ | — | AUDIT |
| `email.test.failed` | ✅ | — | AUDIT |
| `contract.cancel_requested` | ✅ | — | AUDIT |
| `contact.submitted` | ✅ | 1, **ACTIVÉE** | OPERATIONAL |
| `contract.cancel_at_period_end` | ⏸️ *(lot résiliation)* | 2, **désactivées** | AUDIT |
| `contract.ended` | — | — | AUDIT |

**Réservés** (déclarés, jamais émis) : `contract.created`, `contract.dev_signed`,
`contract.client_signed`, `contract.fully_signed`, `launch_fee.paid`,
`subscription.activated`, `site.activated`, `site.suspended`. Les déclarer
maintenant fige le vocabulaire et évite qu'un lot ultérieur invente un type
divergent.

## 3. Émission

```js
await emit({ type, entityType, entityId, actor, payloadSafe, idempotencyKey });
await emitSafe({...});        // n'échoue JAMAIS vers l'appelant
await emitAndDispatch({...}); // + déclenche le dispatch
```

Trois gardes, dans cet ordre :

1. **type** connu du registre, et `entityType` autorisé pour ce type ;
2. **confidentialité/structure** (`assertSafePayload`) — s'applique à tout payload ;
3. **schéma** du registre (zod strict).

La garde de confidentialité passe **avant** le schéma : un secret ne doit pas
pouvoir être accepté « seulement » parce qu'un schéma est trop permissif.

## 4. ⚠️ Atomicité : best-effort, PAS transactionnelle

**C'est le point à connaître avant tout le reste.**

Ce dépôt n'utilise **aucune transaction MongoDB**, et n'en a pas la garantie :
[VPS_DEPLOYMENT_GUIDE.md](VPS_DEPLOYMENT_GUIDE.md) autorise explicitement un
`mongod` **standalone** local (`MONGODB_URI=mongodb://127.0.0.1:27017`), qui ne les
supporte pas — et la suite de tests tourne sur un `MongoMemoryServer` standalone.
Envelopper l'émission dans une transaction **échouerait** dans des déploiements
légitimes.

**Stratégie retenue** : l'événement est émis **APRÈS** la réussite de l'opération
métier, en best-effort. Conséquences, assumées :

| | Comportement |
|---|---|
| Crash entre l'écriture métier et l'émission | **L'événement est perdu.** Il n'est pas rejoué — rien ne le reconstruit. C'est un trou de **trace**, pas une incohérence métier. |
| Événement sans opération métier | **Impossible** — l'émission vient après. |
| Journal indisponible | L'opération métier **aboutit quand même** (`emitSafe` avale l'erreur et la journalise). Un test coupe le journal et vérifie qu'une résiliation aboutit. |

**Nous ne prétendons pas à une atomicité qui n'existe pas.** Le jour où les
transactions seront garanties partout (Atlas / replica set), le point d'insertion
est `domainEvent.service.js` : passer une `session` à `DomainEvent.create()` et à
l'écriture métier.

## 5. Idempotence

`idempotencyKey` est **optionnelle** et protégée par un **index unique partiel**
(l'idiome du dépôt, cf. `Payment.stripe.checkoutSessionId`). Rejouer la même clé
renvoie l'événement existant au lieu d'en créer un second.

Utile pour : webhooks répétés, retries réseau, jobs rejoués, double clic DEV,
reprise après crash.

> **Ne jamais utiliser `type + entityId` seul comme clé** : un même type peut
> légitimement se reproduire sur une même entité (deux demandes de code
> successives sont deux faits distincts). La clé doit inclure ce qui rend
> l'occurrence unique — typiquement un horodatage de transition.

Exemples réels :
```
sender-verified:TEST:<empreinte-adresse>:2026-07-17T10:00:00.000Z
domain-authenticated:TEST:lysolution.fr:2026-07-17T10:05:00.000Z
contract-cancel-requested:<contractId>:2026-07-17T10:10:00.000Z
```

> L'adresse est **empreintée**, jamais en clair : une clé d'idempotence est
> persistée, elle ne doit pas devenir une réserve d'adresses. Masquer ne
> conviendrait pas — `s***@x.fr` vaut pour `support@x.fr` **et** `sam@x.fr`, ce qui
> dédupliquerait deux faits distincts.

## 6. Sécurité des payloads

`backend/src/utils/eventPayloadSafety.js`. Un payload est **persisté et relu**
(routes DEV, Manager) : c'est un vecteur de fuite.

**On REFUSE, on ne filtre pas en silence.** Un filtrage muet laisserait croire la
donnée transmise et masquerait une erreur d'appel.

### Clés interdites (liste centrale, testée)

`apikey`, `secret`, `password`, `passwd`, `token`, `otp`, `authorization`,
`cookie`, `html`, `rawpayload`, `credential`, `privatekey`, `accesskey`,
`sessionid`, `bearer`.

Comparaison sur la clé **normalisée** (minuscules, séparateurs retirés) et par
**sous-chaîne** : `api_key`, `API-KEY`, `apiKey` sont identiques, et
`stripeSecretKey` est refusée parce qu'elle contient `secret`. À **toute
profondeur**, tableaux compris.

### Bornes

| Limite | Valeur |
|---|---|
| Profondeur | 5 |
| Taille sérialisée | 8 192 octets |
| Nœuds | 200 |

### Types refusés

Objet non littéral (Error, Map, ObjectId, instance de classe), fonction, `NaN`,
`Infinity`, `undefined`. **On ne sérialise jamais un objet d'erreur** (il
embarquerait une stack) ni un objet fournisseur brut (il embarquerait n'importe
quoi).

### Masquage

`maskEmail('support@lysolution.fr')` → `s***@lysolution.fr`. Le domaine reste
lisible (il porte l'information de délivrabilité), la boîte non. À utiliser dès que
l'adresse complète n'est pas indispensable.

## 7. Événements Brevo : TRANSITIONS, pas lectures

« Vérifier l'authentification » est un bouton qu'un DEV peut cliquer dix fois.
Sans précaution, chaque clic produirait un `pending_dns` de plus, et chaque
synchronisation d'un domaine déjà authentifié un `authenticated` de plus — le
journal deviendrait **un compteur de clics au lieu d'une histoire**.

**Double garde** :
1. comparaison d'état avant/après — aucun événement si rien n'a changé ;
2. clé d'idempotence stable sur les transitions clés.

Testé : relectures répétées d'un état inchangé → **aucun événement supplémentaire**.

### Ce qui est tracé, ce qui ne l'est jamais

| Tracé | Jamais tracé |
|---|---|
| mode (TEST/PROD), provider | clé API |
| adresse **masquée** | adresse complète |
| domaine | code OTP |
| **clés** des enregistrements DNS | **valeurs** DKIM / brevo_code |
| code d'erreur stable + message borné | payload Brevo brut, objet d'erreur |

Un test vérifie qu'aucune adresse complète, aucun OTP et aucune clé n'apparaît nulle
part dans le journal — **payloads et champs techniques compris**.

## 8. Rétention

| Classe | Contenu | Durée **recommandée** |
|---|---|---|
| `AUDIT` | conformité, sécurité | ~3 ans (1095 j) |
| `OPERATIONAL` | exploitation, diagnostic | ~12 mois (365 j) |
| `TRANSIENT` | bruit technique | ~30 jours |

Chaque événement porte sa classe. **Aucun index TTL n'est posé** : un TTL aveugle
supprimerait des traces d'audit nécessaires. La purge sera un **script explicite,
par classe** — trivial à ajouter, jamais implicite. Les durées ci-dessus sont des
recommandations, pas encore appliquées.

## 9. Routes DEV (lecture seule)

```
GET  /api/dev/domain-events            ?type&entityType&entityId&dispatchStatus&from&to&limit&cursor
GET  /api/dev/domain-events/registry   introspection du code-first
GET  /api/dev/domain-events/:eventId
GET  /api/dev/domain-events/:eventId/actions
POST /api/dev/domain-events/:eventId/retry
```

DEV uniquement (ADMIN → **403**). **Aucune route de création** — un fait ne se
fabrique pas depuis une interface. **Aucune route d'édition** — ni le type ni le
payload d'un fait ne se réécrivent. Le retry ne rejoue que les échecs.

`type` est contraint au registre et les schémas sont **stricts** : un paramètre
inconnu est rejeté (seule barrière contre l'injection d'un opérateur Mongo dans la
query). `lockId` n'est jamais exposé.

## 10. Interface

**Manager → DEV → Événements système** (`/dev/evenements`). Liste filtrable,
détail (payload sûr, actions, tentatives, prochaine tentative, dernière erreur),
retry sur échec. Voir [EVENT_ACTION_EXECUTIONS.md](EVENT_ACTION_EXECUTIONS.md).

## 11. `SEND_EMAIL` — implémenté, mais rien n'est activé

**Le handler est réel depuis le lot templates/e-mail.** Il vit dans
[`services/email/sendEmailHandler.js`](../backend/src/services/email/sendEmailHandler.js)
et **s'enregistre lui-même** au bootstrap (`registerHandler` +
`registerRecipientKeyResolver`) : le dispatcher ne connaît toujours pas l'e-mail.
Voir [EMAIL_DELIVERY.md](EMAIL_DELIVERY.md).

Ce qui a changé pour le dispatcher :

| Avant | Maintenant |
|---|---|
| `resolveRecipientKeys` renvoyait toujours `_single` | Une action `SEND_EMAIL` renvoie **une clé par destinataire résolu** (empreinte `keyHash`) — le multi-destinataire est en service |
| Le handler échouait `ACTION_HANDLER_NOT_IMPLEMENTED` | Il envoie réellement, et n'écrit `SUCCEEDED` **qu'après** réponse de Brevo (`providerMessageId` à l'appui) |

### État des actions

| Action | Activée ? | Manque |
|---|---|---|
| `notify-admins-contact-submitted` | ✅ **oui** (lot contact) | — |
| `notify-admins-cancellation` | ❌ | résolveur de variables — *lot résiliation* |
| `notify-devs-cancellation` | ❌ | idem |

**Les e-mails de contact partent réellement** vers les administrateurs. Voir
[CONTACT_EMAIL_NOTIFICATION.md](CONTACT_EMAIL_NOTIFICATION.md).

**Les actions de résiliation restent `enabled: false`** : il leur manque leur
résolveur de variables. Si l'une était activée par mégarde, l'exécution partirait
en `DEAD_LETTER` avec `UNKNOWN_RESOLVER` — un refus franc, **jamais un e-mail aux
variables vides**. C'est le filet de sécurité, et il est testé.

Pour activer une action : enregistrer un `registerVariableResolver` pour son
template, puis passer `enabled: true`. Voir [EMAIL_TEMPLATES.md §7](EMAIL_TEMPLATES.md).

### Zéro destinataire ⇒ ÉCHEC

Depuis le lot contact, une action `SEND_EMAIL` activée dont le résolveur ne
renvoie **aucun** destinataire échoue en `EMAIL_RECIPIENTS_NOT_FOUND` (non
retryable, `DEAD_LETTER`) — elle n'est plus `SKIPPED`.

Une action activée dont personne ne reçoit le résultat est un **problème**, pas une
décision : `SKIPPED` rendait l'événement `DISPATCHED` — « tout va bien » — alors
que la notification n'avait pas eu lieu.

## 12. Tests

`npm run test:events` — **210 assertions**. Registre, sécurité des payloads,
émission, idempotence (dont 3 émissions concurrentes → 1 seul événement),
matérialisation, dispatch, retry, backoff, dead letter, succès partiel, statut
global, concurrence, verrous, reprise après crash, audit Brevo, déduplication,
résiliation, HTTP DEV.

Côté Manager : `domainEvents.test.mjs` — **75 assertions** (module pur ; le dépôt
n'a pas d'infrastructure de test DOM).
