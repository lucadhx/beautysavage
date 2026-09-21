# Dispatcher d'événements — exécution, retry, verrous, reprise

> Comment les actions d'un événement sont réellement exécutées. Voir
> [DOMAIN_EVENTS.md](DOMAIN_EVENTS.md) (registre, émission) et
> [EVENT_ACTION_EXECUTIONS.md](EVENT_ACTION_EXECUTIONS.md) (journal).

---

## 1. ⚠️ Mode d'exécution : worker EMBARQUÉ, mono-processus

**Il n'y a pas de worker externe.** Aucune file, aucun cron, aucun scheduler — le
dépôt n'en a jamais eu (la réconciliation est un script lancé à la main), et ce lot
n'en introduit pas.

```
emit()  ──► événement PERSISTÉ
        └─► dispatch immédiat, EN LIGNE, dans le processus API
              └─► matérialise les actions, les exécute, calcule le statut global

processPendingEventActions()  ──► rattrapage
        ├─ appelé au DÉMARRAGE (bootstrap) — reprise après crash
        └─ disponible en script : npm run events:process
```

### Limites, assumées

| Situation | Conséquence réelle |
|---|---|
| Le processus meurt **pendant** un handler | L'exécution reste `PROCESSING` jusqu'à **expiration de son verrou (60 s)**. Le passage suivant la reprend. Rien n'est perdu, rien n'est instantané. |
| Un échec **retryable** attend son backoff | **Aucune minuterie interne** ne le réveille : il repart au prochain démarrage ou au prochain `npm run events:process`. En ajouter une ferait tourner du travail de fond invisible dans chaque instance. |
| PM2 en mode **cluster** | Plusieurs instances traiteraient la même file. C'est **sûr** (verrou atomique + index unique), mais le déploiement documenté est `fork` (une instance). |
| Aucun passage n'est déclenché | Les actions en attente **restent en attente**. C'est visible dans `/dev/evenements`. |

> **Ces limites sont RÉELLES depuis le lot contact** : `notify-admins-contact-submitted`
> est activée et envoie de vrais e-mails. Un Brevo indisponible produit un
> `FAILED` retryable qui attendra le prochain démarrage ou le prochain
> `npm run events:process` — **aucune minuterie ne le réveillera**. C'est le
> compromis assumé du worker embarqué.

## 2. Cycle d'une action

```
matérialisation ──► PENDING ──claim──► PROCESSING ──┬──► SUCCEEDED
   (idempotente)      │                            ├──► SKIPPED
                      │                            ├──► FAILED ──(backoff)──► PENDING…
                      │                            └──► DEAD_LETTER
                      └── action désactivée ──► SKIPPED (jamais exécutée)
```

## 3. Matérialisation idempotente

Le dispatcher crée les exécutions manquantes ; **l'index unique
`(eventId, actionId, recipientKey)` tranche** et les doublons (`11000`) sont ignorés.

Re-dispatcher un événement n'ajoute donc **jamais rien** — c'est ce qui rend la
reprise et le rejeu sûrs par construction, sans vérification applicative (qui
perdrait la course).

Une action **désactivée** produit une exécution `SKIPPED`, pas un trou : le journal
montre qu'on a **délibérément** rien fait. Son handler n'est **jamais appelé**
(testé).

## 4. Prise atomique (le verrou)

```js
findOneAndUpdate(
  { _id, status: {$in: [PENDING, FAILED]}, availableAt: {$lte: now},
    $or: [{lockExpiresAt: null}, {lockExpiresAt: {$lte: now}}] },
  { $set: { status: PROCESSING, lockId: <uuid>, lockExpiresAt: now + 60s },
    $inc: { attempts: 1 } }
)
```

**Condition et écriture dans la MÊME opération** : deux processus concurrents ne
peuvent pas gagner ensemble — MongoDB sérialise l'écriture sur le document. Testé
avec deux prises simultanées : **une seule** obtient le verrou.

Une exécution `PROCESSING` n'est **pas directement prenable**, même verrou expiré :
seul `processPendingEventActions` la récupère (en la repassant d'abord `FAILED`).
C'est ce qui empêche deux passages de se marcher dessus sur un travail en vol.

### Finalisation gardée

L'écriture du résultat est filtrée sur `lockId`. Un processus lent, dont le verrou
a expiré et dont le travail a été **repris par un autre**, ne peut pas écraser le
résultat du nouveau propriétaire avec le sien, périmé. Sans cette garde, un job
zombie corromprait le journal.

## 5. Retry

Politique **par type d'action**, dans le code (`RETRY_POLICY`) — aucun réglage en
base.

| Action | Tentatives | Backoff |
|---|---|---|
| `NO_OP` | 1 | — |
| `SEND_EMAIL` | 4 | +30 s, +2 min, +10 min |
| défaut | 3 | +30 s, +2 min |

**Déterministe** : le délai ne dépend que du numéro de tentative, jamais d'un aléa
— deux workers calculent la même chose. **Plafonné** au dernier palier : jamais de
croissance infinie, jamais de boucle sans fin.

### Retryable vs non retryable

- **retryable** (`ActionHandlerError(code, msg, true)`, ou toute erreur inattendue) →
  `FAILED` + nouvelle tentative planifiée ;
- **non retryable** (`retryable: false`) → **`DEAD_LETTER` immédiat**. Réessayer 4
  fois un handler inexistant ou une configuration manquante ne ferait que remplir le
  journal.

Tentatives épuisées → `DEAD_LETTER`.

## 6. Statut global de l'événement

**Dérivé** des exécutions, jamais écrit à la main :

| Situation | Statut |
|---|---|
| Aucune action | `DISPATCHED` — rien à faire **est** un succès |
| Tout `SUCCEEDED` / `SKIPPED` | `DISPATCHED` |
| Il reste du travail (`PENDING`, `PROCESSING`, `FAILED`) | `DISPATCHING` |
| Au moins un succès **et** au moins un `DEAD_LETTER` | `PARTIAL_FAILURE` |
| Tout terminal en échec | `FAILED` |

> **Jamais `FAILED` sur un échec retryable** : une tentative est encore prévue,
> conclure serait mentir. L'événement reste `DISPATCHING` (testé).

## 7. Reprise après crash

`processPendingEventActions()` :

1. cherche les exécutions éligibles **et** les `PROCESSING` au verrou expiré ;
2. repasse ces dernières en `FAILED` (travail abandonné) — sans toucher à
   `attempts`, que la prise incrémentera ;
3. les prend atomiquement et les exécute ;
4. recalcule le statut global des événements touchés.

Un verrou **vivant** n'est jamais volé (testé).

Appelée : au démarrage (`bootstrap`), par `npm run events:process`, et par les
tests. Utilisable telle quelle depuis un worker externe le jour venu.

## 8. Retry manuel

`POST /api/dev/domain-events/:eventId/retry` — remet en `PENDING` **uniquement** les
exécutions `FAILED` / `DEAD_LETTER`, remet `attempts` à zéro (c'est une décision
humaine explicite, pas une tentative automatique de plus) et re-dispatche.

**Un succès n'est JAMAIS rejoué** : le rejouer enverrait deux fois le même e-mail.
Le backend le refuse, et l'interface ne propose même pas le bouton.

## 9. Handlers

| Type | État |
|---|---|
| `NO_OP` | implémenté (brique de test / trace) |
| `SEND_EMAIL` | **implémenté** — [`services/email/sendEmailHandler.js`](../backend/src/services/email/sendEmailHandler.js) |

`SEND_EMAIL` n'écrit `SUCCEEDED` **qu'après** réponse de Brevo : il n'existe aucun
chemin par lequel une exécution réussit sans qu'un `providerMessageId` existe.

`registerHandler(actionType, handler)` reste le point d'entrée : le module e-mail
**s'enregistre lui-même** au bootstrap (`initEmailModule()`), plutôt que d'être
importé par ce registre. Ce sens de dépendance est ce qui garde le dispatcher
réutilisable et testable **sans base ni Brevo**.

Le handler de repli (`ACTION_HANDLER_NOT_IMPLEMENTED`) subsiste pour le cas où le
module e-mail n'aurait pas été enregistré (test isolé, script hors bootstrap) : il
échoue alors franchement, plutôt que de laisser croire qu'un e-mail est parti.

> **Ordre au bootstrap** : `initEmailModule()` est appelé **avant**
> `processPendingEventActions()`. Une exécution `SEND_EMAIL` reprise au démarrage
> tomberait sinon sur le handler de repli et partirait en `DEAD_LETTER` pour rien.

### Destinataires

`registerRecipientKeyResolver(resolver)` — même mécanisme, pour la même raison :
importer `emailRecipientResolvers` ici ferait entrer le métier dans ce registre.

Le défaut reste `[_single]` (ce qui convient à `NO_OP`). Le module e-mail
enregistre le sien : **une clé par destinataire résolu**, et donc **une exécution
par destinataire**.

Zéro destinataire produit tout de même **une** exécution — et depuis le lot
contact, elle **échoue** (`EMAIL_RECIPIENTS_NOT_FOUND`, non retryable) plutôt
qu'elle n'est `SKIPPED`. Sans exécution, l'événement serait `DISPATCHED` — « tout
va bien » — alors que personne n'a été prévenu ; avec un `SKIPPED`, il le serait
aussi. Seul un échec dit la vérité.

**Les e-mails de contact partent réellement.** Les actions de résiliation restent
`enabled: false` (lot résiliation).

## 10. Tests

`npm run test:events` (210 assertions) couvre : matérialisation idempotente, index
unique structurel, succès, retryable, non retryable, backoff déterministe et
plafonné, dead letter, succès partiel, statut global (dont « jamais FAILED trop
tôt »), deux workers concurrents, verrou vivant vs expiré, finalisation avec un
mauvais verrou, reprise d'une exécution orpheline, retry manuel, refus de rejouer un
succès.
