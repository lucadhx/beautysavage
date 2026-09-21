# Journal des exécutions d'actions

> Le journal qui rend le système observable et rejouable. Voir
> [DOMAIN_EVENTS.md](DOMAIN_EVENTS.md) et [EVENT_DISPATCHER.md](EVENT_DISPATCHER.md).

---

## 1. Une exécution = un événement × une action × un destinataire

```
EventActionExecution {
  eventId, eventType
  actionId, actionType
  templateId?, recipientResolver?, recipientKey
  status, attempts, maxAttempts
  availableAt, processingStartedAt?, processedAt?
  lockId?, lockExpiresAt?
  providerMessageId?
  lastErrorSafe { code, message, retryable }
}
```

### L'index unique est le cœur du système

```js
{ eventId: 1, actionId: 1, recipientKey: 1 }  // unique
```

Il rend **physiquement impossible** de créer deux fois la même exécution — donc
d'envoyer deux fois le même e-mail au même destinataire. Même si le dispatcher est
relancé, même en concurrence, même après un crash.

> On **ne s'en remet pas** à une vérification applicative (« est-ce que ça existe
> déjà ? ») : elle perdrait la course entre deux processus. C'est la base qui
> tranche.

### Une exécution PAR destinataire

Sans cela, un succès sur l'un **masquerait** un échec sur l'autre, et un retry
global **renverrait à tout le monde** — y compris à ceux qui avaient déjà reçu.

`recipientKey` = `_single` pour une action **sans destinataire** (`NO_OP`).

Depuis le lot templates/e-mail, une action `SEND_EMAIL` porte l'**empreinte**
(`keyHash`) de chaque destinataire résolu — jamais l'adresse en clair : une clé est
persistée, elle ne doit pas devenir une réserve d'adresses. Le multi-destinataire
est donc en service, **sans qu'aucun changement de modèle ni d'index n'ait été
nécessaire**.

Zéro destinataire produit tout de même **une** exécution `SKIPPED` : sans elle,
l'événement serait `DISPATCHED` — « tout va bien » — alors que personne n'a été
prévenu. Voir [EMAIL_DELIVERY.md](EMAIL_DELIVERY.md).

## 2. Statuts

| Statut | Sens | Terminal ? |
|---|---|---|
| `PENDING` | en attente de prise | non |
| `PROCESSING` | prise, en cours (verrou détenu) | non |
| `SUCCEEDED` | réussie | **oui** |
| `FAILED` | échec **retryable** — nouvelle tentative planifiée | non |
| `SKIPPED` | volontairement non exécutée (action désactivée, retirée du registre) | **oui** |
| `DEAD_LETTER` | échec **terminal** : non retryable, ou tentatives épuisées | **oui** |
| `OBSOLETE` | l'envoi n'avait plus lieu d'être au moment de partir | **oui** |

> `FAILED` ≠ abandonné. Une tentative est encore prévue (`availableAt`) — l'écran
> l'annonce explicitement (« Échec — nouvelle tentative prévue »), pour qu'on ne
> croie pas à une perte.

> `OBSOLETE` n'est pas `SUCCEEDED`. On n'a rien envoyé, et on ne prétend pas
> l'avoir fait. Ce n'est pas non plus `SKIPPED` : l'action était bien voulue au
> moment où elle a été décidée — c'est le monde qui a changé entre-temps.

### `OBSOLETE` — le message devenu faux pendant qu'il attendait

Un événement est un FAIT : il s'est produit, il ne se rétracte pas. Une action
est une CONSÉQUENCE, et une conséquence peut cesser d'être justifiée entre le
moment où on la décide et celui où on l'exécute.

Le cas qui a motivé ce statut : une relance d'impayé est créée, le premier envoi
échoue parce que le fournisseur est momentanément injoignable, une nouvelle
tentative est programmée. Entre les deux, le client paie. Sans garde, le worker
se réveille et écrit « nous n'avons toujours pas reçu votre règlement » à
quelqu'un qui vient de régler.

Ce n'est pas un défaut d'idempotence — l'envoi n'a jamais eu lieu.

La condition métier est donc revalidée JUSTE AVANT l'envoi, par une garde
déclarée par le domaine (`services/events/actionRelevance.js`), consultée par le
répartiteur. Trois règles la gouvernent :

- **Un type sans garde est toujours pertinent.** L'absence de règle n'est pas
  une raison de ne pas envoyer.
- **Une garde qui lève est ignorée.** Douter n'est pas savoir : bloquer un envoi
  sur une exception ferait taire des relances légitimes au premier hoquet de la
  base. Le doute profite à l'envoi, et l'erreur est journalisée.
- **Introuvable n'est pas réglé.** Un incident qu'on ne retrouve pas ne prouve
  pas que la dette est éteinte ; l'envoi est maintenu.

La garde vit dans le DOMAINE, jamais dans le handler d'envoi : celui-ci sait
composer un message et doit continuer de ne rien savoir des impayés, des
contrats et des paiements.

## 2 bis. Qui regarde l'heure

Toute la mécanique de reprise — `attempts`, `availableAt`, backoff borné, verrou
atomique, classification retryable / terminal — existait avant
`eventActionScheduler.js`. Il manquait la seule chose qui la rende vivante :
quelqu'un pour regarder l'heure.

`processPendingEventActions()` n'était appelée qu'au DÉMARRAGE du processus, et
par le script d'exploitation `events:process`. Un fournisseur injoignable trois
minutes suffisait donc à différer une relance jusqu'au prochain déploiement —
pour un message dont l'intérêt est précisément d'arriver AVANT l'échéance de
suspension.

Le planificateur bat à 30 s, la maille du plus petit palier de backoff. Il ne
sait ni prendre, ni exécuter, ni réessayer : il appelle la fonction existante.
Un second moteur aurait divergé du premier au premier correctif.

Deux cycles ne se chevauchent jamais, et aucun cycle ne démarre pendant la
vidange : empiler des cycles sur une base lente est exactement la façon dont une
lenteur devient une panne.

## 3. Ce qui est journalisé, et ce qui ne l'est jamais

| Journalisé | Jamais |
|---|---|
| code d'erreur **stable** | objet d'erreur, stack trace |
| message **borné** (300 car.) | payload fournisseur brut |
| `providerMessageId` | secret, clé API, OTP |
| tentatives, dates, verrou | HTML d'e-mail complet |

`lockId` existe en base mais **n'est jamais exposé par l'API** : c'est un jeton de
contrôle interne.

## 4. Interface

**Manager → DEV → Événements système** (`/dev/evenements`), DEV uniquement.

**Liste** : date, type, entité, acteur, statut global, résumé des actions
(`2 actions · 1 ok · 1 en échec`).

**Détail** : payload sûr formaté, puis par action — statut, type, tentatives
(`2/4`), template, résolveur de destinataires, identifiant fournisseur, **prochaine
tentative**, dernière erreur sûre.

**Retry** : proposé **uniquement** sur `FAILED` / `PARTIAL_FAILURE`. Jamais sur un
succès.

### Détails d'affichage qui comptent

- « **Aucune action** » se lit comme un état **normal** — les événements d'audit
  n'en ont pas — et non comme un manque.
- Un **type inconnu garde sa clé technique** (`contract.foo`) : ça se cherche,
  « Événement » non.
- La **prochaine tentative** ne s'affiche que si elle est dans le futur. Une
  échéance passée signifie « au prochain passage », pas une date trompeuse.
- `payloadRows` écarte les clés sensibles : **seconde barrière** (le backend les
  refuse déjà à l'émission), au cas où l'une passerait.

## 5. État actuel

**Aucune action n'est activée.** Les actions déclarées (`contact.submitted`,
`contract.cancel_at_period_end`) sont `enabled: false` et produisent des exécutions
`SKIPPED` — la trace montre qu'on a délibérément rien fait, en attendant le lot
e-mail.

En pratique, aujourd'hui, tous les événements émis sont des **traces d'audit sans
action** : ils passent directement en `DISPATCHED`. **Aucun e-mail métier n'est
envoyé.**

## 6. Tests

Couverts par `npm run test:events` (210 assertions) : matérialisation idempotente,
rejet du doublon par la base, exécution par destinataire, action désactivée →
`SKIPPED` sans appel du handler, succès partiel (un succès ne masque pas un échec),
tentatives/backoff, dead letter, verrous, reprise, retry manuel.

Côté Manager : `domainEvents.test.mjs` (75 assertions) — libellés, badges, résumé,
autorisation du retry, prochaine tentative, masquage, filtres, pagination.
