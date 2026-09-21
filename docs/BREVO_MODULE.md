# Module e-mail (Brevo)

> Document de référence. Il explique **comment le module fonctionne et pourquoi
> il est conçu ainsi**. Il ne recopie pas le code : le code est l'autorité sur le
> « comment exactement », ce document l'est sur le « pourquoi ».
>
> Il sert aussi de **modèle** pour les intégrations à venir (Stripe, Yousign,
> Ubiflow, CarVertical…) — voir la dernière section.

---

## 1. L'idée directrice

Une seule question compte : **« les e-mails de ce site arrivent-ils à
destination ? »**

Tout le module découle d'une observation qui a coûté cher :

> `POST /v3/smtp/email` répond `201` avec un `messageId`. Cela prouve que le
> fournisseur a **accepté la requête**. Rien de plus. Le message peut être rejeté
> trente secondes plus tard — expéditeur non autorisé, adresse inexistante,
> domaine non authentifié — et l'application n'en saura jamais rien.

Afficher « Fonctionnel » sur la foi d'un `201` était donc un **mensonge**. Le
module entier est construit pour ne plus jamais le dire.

Deux conséquences structurantes :

1. **Acceptation ≠ livraison.** Deux statuts distincts, jamais confondus.
2. **Sans moyen de constater l'issue, on n'envoie pas.** Voir §5.

---

## 2. Architecture

```
                    ┌─────────────────────────────┐
   Manager (UI)     │  Carte « Configuration »    │  utilisateur
                    │  Diagnostic                 │  développeur
                    └──────────────┬──────────────┘
                                   │ HTTP
        ┌──────────────────────────┴──────────────────────────┐
        │                      BACKEND                        │
        │                                                     │
        │  emailConfiguration.service  ──┐                    │
        │  (e-mail de test)              │                    │
        │                                ├──► brevoEmail      │
        │  emailDelivery.service    ─────┘    .service        │
        │  (tous les envois métier)           [GARDE-FOU]     │
        │                                          │          │
        │                                          ▼          │
        │                                    POST /smtp/email │
        └─────────────────────────────────────────────────────┘
                                   ▲
                                   │ webhook (issue réelle)
                    ┌──────────────┴──────────────┐
                    │  brevoWebhookIngest.service │
                    │  → EmailDelivery mise à jour│
                    └─────────────────────────────┘
```

### Le point le plus important : un seul entonnoir

`sendTransactionalEmail` (`services/brevo/brevoEmail.service.js`) est le **seul**
endroit du projet qui appelle l'API d'envoi. Deux services l'utilisent :

| Chemin | Fichier | Couvre |
|---|---|---|
| E-mail de test | `emailConfiguration.service.js` | le bouton « Tester la configuration » |
| Envois métier | `email/emailDelivery.service.js` | contact, contrats, relances, notifications, et tout ce qui viendra |

C'est ce qui rend le garde-fou (§5) **structurellement incontournable** : un
nouveau chemin d'envoi ne peut pas, par construction, l'oublier. Deux tests
statiques verrouillent l'invariant (`backend/src/scripts/brevo-operational.test.js`).

---

## 3. Le pipeline de livraison

`EmailDelivery` est la **source de vérité unique** d'un envoi. Une ligne par
e-mail, du début à la fin.

```
PENDING ──► SENDING ──► SENT ─────────────► DELIVERED     (webhook)
   │           │          │
   │           │          ├──────────────► DEFERRED       (webhook)
   │           │          └──────────────► HARD_BOUNCED,  (webhook)
   │           │                           SPAM, INVALID…
   │           └──► FAILED                 (l'envoi a été TENTÉ et a échoué)
   └──────────────► PRECONDITION_FAILED    (rien n'a été tenté — voir §6)
```

### Trois échecs qu'il ne faut jamais confondre

| Statut | Signifie | Oriente vers |
|---|---|---|
| `FAILED` | l'envoi a été **tenté** et a échoué | le fournisseur, le réseau, l'adresse |
| `PRECONDITION_FAILED` | **rien n'a été tenté** : une précondition manquait | notre configuration |
| `BLOCKED` | le **fournisseur** a rejeté le destinataire | le destinataire |

Les mélanger enverrait enquêter du mauvais côté, et gonflerait les statistiques
d'échec fournisseur d'incidents purement internes.

### Ce que seul un webhook peut écrire

`DELIVERED`, `DEFERRED`, `SOFT_BOUNCED`, `HARD_BOUNCED`, `INVALID`, `SPAM`,
`ERROR`, `UNSUBSCRIBED`, `BLOCKED`. Le code d'envoi n'écrit jamais ces statuts :
il n'a aucun moyen de les constater. L'invariant est énoncé dans la
documentation de `DELIVERY_STATUS` (`utils/emailTemplateConstants.js`) — il n'est
pas verrouillé par un test, c'est une dette assumée (voir `BREVO_FINAL_REPORT.md`).

### Preuves de remise, par ordre de confiance

| # | Événement | Ce qu'il prouve |
|---|---|---|
| 1 | `delivered` | **preuve canonique de remise.** La seule qui autorise « Livré ». |
| 2 | `request` / `sent` (accepté) | le fournisseur a pris la demande en charge. Ne dit **rien** de la réception. |
| 3 | `deferred` | la remise est retardée. État transitoire, en attente de verdict. |
| 4 | `opened` / `unique_opened` / `click` | **signal d'engagement.** Peut venir d'un humain **ou d'un traitement automatique**. Ne confirme jamais la remise. |
| 5 | `hard_bounce` / `blocked` / `invalid` / `error` | preuve d'échec ou de refus. |

**Une ouverture ne prouve pas une remise.** On a cru le contraire, brièvement, sur
le raisonnement « on ne charge pas le pixel de suivi d'un message non remis ». Ce
raisonnement est faux : proxy d'images, scanner antispam, antivirus,
préchargement et inspection de sécurité chargent les ressources de suivi sans
qu'aucun message n'atteigne jamais une boîte de réception.

> **Le cas qui a tranché.** Un message a produit `sent → unique_opened →
> deferred`. Le suivi l'a affiché « Livré ». Vérification directe de la boîte du
> destinataire : absent de la réception, absent des indésirables, absent de la
> recherche globale. Il n'était jamais arrivé.

Afficher « Livré » pour un message absent est le pire défaut possible de ce
module : il **ferme** la question au lieu de la poser. Un « en attente » honnête
vaut mieux qu'un « livré » faux.

**Un cas qui surprend, et qui reste correct :** `spam` et `unsubscribed` arrivent
*après* une remise. Leur précédence est supérieure à `delivered`, et l'écran les
nomme « Livré, puis signalé ». On ne fabrique pas de confirmation à partir d'eux —
on constate seulement qu'un signalement suppose que le message a été vu.

### Ordre des événements

Les webhooks arrivent parfois en désordre, ou en retard. Une **machine de
précédence** (`services/email/brevoDeliveryTransitions.js`) interdit les
régressions : un `delivered` tardif n'écrase pas un `hard_bounce` déjà appliqué.

---

## 4. Le suivi (webhook)

### Corrélation

La clé est `(provider, providerMode, providerMessageId)`.

**Piège majeur, résolu** : l'API d'envoi renvoie le `messageId` **avec** des
chevrons RFC (`<abc@brevo>`), les webhooks l'envoient **sans**. Un helper
canonique unique — `utils/providerMessageId.js` — normalise à l'écriture et
produit les deux variantes à la lecture. Aucune variante locale de ce traitement
n'est tolérée : c'est exactement ce qui avait provoqué des livraisons
éternellement « acceptées ».

### Événements souscrits

Deux comportements du fournisseur ont été **établis empiriquement**, contre sa
documentation, et sont consignés dans `utils/brevoTransactionalEventRegistry.js` :

- il **replie `sent` sur `request`** (souscrire `sent` produisait une divergence
  perpétuelle, donc une boucle « Désynchronisé » impossible à résoudre) ;
- il **accepte et conserve `error`**, bien que ce type soit absent de sa liste
  documentée côté configuration.

> ⚠️ Ne pas « corriger » ces choix sur la foi de la documentation. Ils sont le
> résultat d'un diagnostic par élimination, tracé dans `docs/EMAIL_FORENSIC_AUDIT.md`.

### Authentification & idempotence

Jeton `Bearer` (le fournisseur ne documente aucun HMAC), avec fenêtre de
rotation. Chaque événement porte une clé d'idempotence ; la timeline
`EmailDeliveryEvent` est écrite **avant** la mutation de la livraison, ce qui
rend un rejeu inoffensif.

---

## 5. La règle opérationnelle : pas de suivi, pas d'envoi

**Décision produit :** le module n'est pas utilisable sans suivi opérationnel.

Sans webhook joignable, chaque envoi resterait indéfiniment « accepté » et un
expéditeur refusé passerait pour un succès. Le blocage échange un **défaut
silencieux** contre une **panne visible et réparable**.

### Une seule fonction

`services/email/brevoOperational.service.js` :

- `getBrevoOperationalReadiness(mode, { probe })` → `{ ready, state, blockers[] }`

C'est la SEULE fonction appelée en production. `assertBrevoOperational` existe à
côté d'elle et lève une `ApiError` 409, mais **aucun appelant ne l'emprunte** :
voir « Dettes restantes » dans `BREVO_FINAL_REPORT.md`.

Elle vérifie : fournisseur activé, mode résolu, clé présente, expéditeur
configuré, webhook enregistré et actif, URL distante conforme, secret présent,
aucune divergence, **et joignabilité prouvée récemment**.

> Ce module lit les **modèles** directement, jamais `emailConfiguration.service` :
> cela créerait le cycle `brevoEmail → brevoOperational → emailConfiguration → brevoEmail`.

### Joignabilité : une preuve qui expire

Un webhook *enregistré* n'est pas un webhook *joignable*.

| Mode | Validité | Pourquoi |
|---|---|---|
| TEST | 10 min | tunnel de développement volatil, disparaît à la fermeture du terminal |
| PROD | 60 min | URL stable, inutile de sonder agressivement |

Deux sources de preuve :

1. **Un webhook reçu** — la meilleure : le fournisseur a atteint l'URL.
2. **Une sonde** `GET …/transactional/:mode/health` → `{ ok: true }`. Publique,
   anonyme, sans effet de bord, 5 s de délai.

La sonde existe pour briser un **blocage circulaire** : sans elle, « pas de
webhook récent donc pas d'envoi, pas d'envoi donc pas de webhook ». Elle n'est
tentée que si la preuve a expiré, et un délai de garde de 60 s empêche qu'une
rafale d'envois pendant une panne déclenche une sonde par e-mail.

---

## 6. `PRECONDITION_FAILED` et la reprise

Quand le garde-fou refuse :

- **aucun appel** au fournisseur (le contrôle précède la construction de la requête) ;
- **aucune livraison « acceptée »** fabriquée, aucun `messageId` inventé ;
- la livraison porte `PRECONDITION_FAILED` + `failureCode = BREVO_NOT_OPERATIONAL` ;
- l'erreur est **retryable**.

### Comment la reprise se produit

Elle n'est **pas** un balayage périodique des livraisons. C'est le **dispatcher
d'événements** qui rejoue l'action, parce que l'erreur est marquée retryable.

Conséquence à connaître : la reprise **en place** (sans doubler la ligne) dépend
de la présence d'un `actionExecutionId`, qui porte l'idempotence. Les envois
**automatiques** en ont un — donc ils sont repris en place. Un envoi **manuel**
n'en a pas, et créera légitimement une nouvelle ligne.

---

## 7. Diagnostic

Outil **de développeur**, séparé de la configuration qui est l'outil de
l'utilisateur. Un utilisateur ne devrait quasiment jamais avoir à l'ouvrir.

- `npm run email:diagnostic` (ou `:live` pour un envoi réel) et un bouton dans le Manager.
- Il lit l'état réel (configuration, webhook distant, livraisons, événements reçus),
  applique un **processus par élimination**, et rend **un seul verdict** — la cause
  racine, choisie par priorité, pas une liste de symptômes.
- Un rapport horodaté est écrit côté serveur.

**Invariant** : le verdict `HEALTHY` est impossible tant que le module n'est pas
réellement autorisé à envoyer. Le diagnostic interroge la même fonction que le
garde-fou — ce qu'il affirme est donc exactement ce que le système appliquera.

En production, il n'a aucun impact : il observe (`probe: false`), il ne répare pas.

---

## 8. Le vocabulaire affiché

`manager/src/lib/emailStates.ts` définit **un seul** jeu de mots pour tout le
module, et trois traductions vers lui (configuration, test, livraison).

> Avant, chaque écran traduisait dans son coin : un même fait s'appelait
> « Accepté » ici, « Accepté par Brevo » là, et `SENT` ailleurs. Un utilisateur
> qui voit trois mots pour une réalité en conclut qu'il y a trois réalités.

Les états visibles, au complet : **Configuration requise · À tester ·
Préparation… · En attente de confirmation · Livré · Livraison différée · Échec de
livraison · Envoi suspendu · Suivi indisponible**.

Trois règles non négociables :

1. **Aucun code technique affiché.** Un statut inconnu retombe sur « État
   inconnu », jamais sur la constante du serveur. Un code brut n'informe
   personne : il avoue que le produit n'a pas su traduire ce qu'il a compris.
2. **Aucun nom de fournisseur** dans le vocabulaire d'état — sauf là où l'action
   de l'utilisateur se passe littéralement chez lui (autoriser une adresse).
3. **Chaque message porte un geste.** Un constat sans action est un cul-de-sac.
   Un test le vérifie sur l'ensemble de la table des erreurs.

Le vert est réservé à un fait **constaté** (livré). Un envoi accepté mais non
confirmé reste bleu : la couleur ne doit pas promettre ce que le produit ne sait
pas encore.

---

## 9. Ce que le module ne fait volontairement PAS

Ces absences sont des **décisions**, pas des oublis. Les « rétablir » serait une
régression :

- pas de reproduction de l'interface du fournisseur dans le Manager ;
- pas d'OTP, pas de vérification d'expéditeur, pas de DKIM/DMARC/DNS ;
- pas de `GET /senders`, pas de `GET /domains`, pas de miroir de l'état distant ;
- pas de templates hébergés chez le fournisseur — les nôtres vivent dans le dépôt,
  sous contrôle de version et de validation ;
- pas de statut déduit côté client : le backend est l'autorité, l'UI projette.

---

## 10. Ajouter un nouveau fournisseur demain

L'ordre compte : chaque étape rend la suivante vérifiable.

1. **Credentials par mode.** Ajouter le fournisseur au catalogue `IntegratedApi`
   (deux jeux TEST/PROD chiffrés, `activeMode` choisi par un DEV et indépendant de
   l'environnement applicatif).

2. **Un driver, un seul.** Couche transport pure : pas de règle métier, pas
   d'accès aux modèles. Il traduit les erreurs du fournisseur en codes stables et
   décide surtout **si l'on peut réessayer** — une clé refusée rejouée quatre fois
   ne fait que remplir le journal ; une limite de débit non rejouée perd une
   opération légitime.

3. **Un seul entonnoir.** Tous les chemins passent par une fonction unique. C'est
   ce qui permet à un garde-fou d'être incontournable. Verrouillez-le par un test
   statique : « aucun autre fichier n'appelle cet endpoint ».

4. **Une entité de suivi.** L'équivalent d'`EmailDelivery` : source de vérité
   unique, avec la distinction *accepté / constaté*. Ne jamais écrire un statut
   qu'on n'a pas les moyens d'observer.

5. **La corrélation d'abord.** Choisir la clé, et écrire **un helper canonique
   unique** de normalisation, utilisé à l'écriture ET à la lecture. Les variantes
   locales du même traitement sont la première cause de suivi cassé.

6. **La règle opérationnelle.** Si l'issue d'une opération n'est constatable que
   par rappel du fournisseur, alors ce rappel est une **précondition**. Une
   fonction unique, appelée depuis l'entonnoir, avec une preuve de joignabilité
   qui **expire**.

7. **Le vocabulaire ensuite.** Étendre `emailStates` (ou son équivalent) plutôt
   que d'inventer des libellés par écran.

8. **Le diagnostic en dernier.** Il n'a de valeur que s'il interroge les mêmes
   fonctions que la production. Un diagnostic qui redémontre les règles dans son
   coin finit par dire autre chose que le système.

---

## 11. Où regarder

| Sujet | Fichier |
|---|---|
| Règle opérationnelle | `backend/src/services/email/brevoOperational.service.js` |
| Driver (entonnoir + garde-fou) | `backend/src/services/brevo/brevoEmail.service.js` |
| Envois métier | `backend/src/services/email/emailDelivery.service.js` |
| E-mail de test | `backend/src/services/emailConfiguration.service.js` |
| Réception webhook | `backend/src/services/brevo/brevoWebhookIngest.service.js` |
| Précédence des statuts | `backend/src/services/email/brevoDeliveryTransitions.js` |
| Corrélation | `backend/src/utils/providerMessageId.js` |
| Événements souscrits | `backend/src/utils/brevoTransactionalEventRegistry.js` |
| Diagnostic | `backend/src/services/email/emailDiagnostics.service.js` |
| Vocabulaire affiché | `manager/src/lib/emailStates.ts` |
| Logique de la carte | `manager/src/lib/emailConfiguration.ts` |

**Historique des décisions** — à lire avant de remettre en cause un choix :
`docs/EMAIL_FORENSIC_AUDIT.md` (enquête sur le suivi cassé) et
`docs/Brevo/RX-HARDENING_WEBHOOK_OBLIGATOIRE.md` (webhook obligatoire).
