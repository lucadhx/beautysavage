# RX-HARDENING — Le webhook Brevo devient obligatoire avant tout envoi

> **Décision produit** : Brevo n'est pas utilisable sans webhook opérationnel.

## 1. Pourquoi

`POST /v3/smtp/email` renvoyant `201 + messageId` ne prouve **qu'une seule
chose** : Brevo a accepté la requête. La remise réelle n'est constatable que par
un webhook `delivered`.

Sans webhook joignable, chaque envoi produisait donc une livraison éternellement
« Accepté » — et un expéditeur **refusé** par Brevo s'affichait comme un succès.
Envoyer sans suivi n'est pas « envoyer avec moins d'information » : c'est
**affirmer un résultat qu'on ne peut pas constater**.

Le blocage échange un défaut silencieux contre une panne visible et réparable.

## 2. Audit des chemins d'envoi

`sendTransactionalEmail` (driver `services/brevo/brevoEmail.service.js`) est
l'**unique entonnoir**. Deux importateurs en production :

| Chemin | Fichier | Couvre |
|---|---|---|
| E-mail de test | `services/emailConfiguration.service.js` | bouton « Envoyer un test » |
| Envois métier | `services/email/emailDelivery.service.js` | contact, contrats, relances, notifications admin, événements futurs |

Aucun autre fichier n'atteint `/smtp/email`. Le garde-fou est donc placé **dans
le driver**, ce qui le rend structurellement incontournable : un futur chemin
d'envoi ne peut pas, par construction, l'oublier. Deux tests statiques
verrouillent cet invariant (§6 de `brevo-operational.test.js`).

## 3. La règle, en un seul endroit

`services/email/brevoOperational.service.js`

- `getBrevoOperationalReadiness(mode, { probe })` → `{ ready, state, blockers[], webhook }`
- `assertBrevoOperational(mode)` → lève `ApiError` **409** `BREVO_TRACKING_REQUIRED`
  ⚠️ *Constat de clôture : cette porte n'a jamais été empruntée en production. Voir `BREVO_FINAL_REPORT.md`.*

Contrôles : fournisseur activé, mode résolu, clé API présente, expéditeur
configuré, webhook enregistré et actif, URL distante = URL attendue, secret
Bearer présent, aucune divergence connue, **joignabilité prouvée et non expirée**.

Ce module lit les **modèles** directement — passer par
`emailConfiguration.service` créerait le cycle
`brevoEmail → brevoOperational → emailConfiguration → brevoEmail`.

## 4. Joignabilité : une preuve qui expire

Un webhook *enregistré* n'est pas un webhook *joignable*. La preuve est bornée :

| Mode | TTL | Raison |
|---|---|---|
| TEST | 10 min | tunnel ngrok volatil, disparaît à la fermeture du terminal |
| PROD | 60 min | URL stable, inutile de sonder agressivement |

Deux sources de preuve :

1. **Un webhook reçu** (`markWebhookReceived`) — la meilleure qui soit : Brevo a
   effectivement atteint l'URL.
2. **Une sonde** `GET …/transactional/:mode/health` → `{ ok: true }`, publique,
   anonyme, sans effet de bord, 5 s de délai. Elle existe pour briser le blocage
   circulaire (« pas de webhook récent donc pas d'envoi, pas d'envoi donc pas de
   webhook »).

La sonde n'est tentée que si la preuve a expiré, et un **cooldown de 60 s**
empêche qu'une rafale d'envois pendant une panne déclenche une sonde par e-mail.

## 5. Ce qui se passe quand c'est bloqué

- **Aucun appel** à Brevo (le contrôle précède la construction de la requête).
- **Aucune livraison « acceptée »** fabriquée ; aucun `messageId` inventé.
- Erreur métier unique — ⚠️ *en pratique c'est `BREVO_NOT_OPERATIONAL` qui circule,
  porté par l'erreur du driver ; le 409 décrit ici n'est produit par aucune route.
  Voir `BREVO_FINAL_REPORT.md`.*
- Marquée **retryable** : la reprise est automatique dès la joignabilité revenue,
  sans redémarrage ni intervention.
- Rien d'interne n'est exposé : ni URL, ni secret, ni statut HTTP fournisseur.

### Statut de livraison dédié

Une tentative refusée écrit `PRECONDITION_FAILED` avec le `failureCode`
`BREVO_NOT_OPERATIONAL` — **jamais** `FAILED`.

| Statut | Signifie | Oriente vers |
|---|---|---|
| `FAILED` | l'envoi a été **tenté** et a échoué | fournisseur, réseau, adresse |
| `PRECONDITION_FAILED` | **rien n'a été tenté** : précondition absente | notre configuration |
| `BLOCKED` | événement webhook `blocked` : destinataire bloqué **chez Brevo** | le destinataire |

Confondre les trois enverrait enquêter du mauvais côté, et gonflerait les
statistiques d'échec fournisseur d'incidents purement internes. `BLOCKED` n'a
pas été réutilisé pour cette raison : il appartient déjà au fournisseur et
compte comme un rejet de livraison.

Le statut est **non terminal** et de précédence faible : la reprise l'écrase.
Avec un `actionExecutionId` (cas du dispatcher, donc de tous les envois
automatiques), la livraison bloquée est reprise **en place**, pas doublée.

### Deux codes, deux niveaux

| Code | Niveau | Rôle |
|---|---|---|
| `BREVO_TRACKING_REQUIRED` | HTTP 409 | ⚠️ défini mais **jamais produit** en production |
| `BREVO_NOT_OPERATIONAL` | livraison | `failureCode` d'un **état persisté** |

## 6. Manager

Quatre états : `READY` / `CONFIGURATION_REQUIRED` / `REPAIR_REQUIRED` /
`WEBHOOK_UNAVAILABLE`. Le bouton « Envoyer un test » se désactive **avant** le
clic, le bandeau dit la cause et le POURQUOI, et propose l'action
(« Configurer » / « Réparer le suivi de livraison »). Après réparation, la carte
se relit seule — aucun rechargement manuel demandé.

L'état est calculé côté backend avec `probe: false` : un affichage ne doit pas
déclencher d'appel réseau sortant.

## 7. Diagnostic

Nouveau contrôle `operational` et verdict `SENDING_BLOCKED`, placé **en dernier**
dans l'ordre de priorité : « les envois sont bloqués » est une *conséquence*, et
quand une cause précise existe c'est elle qu'il faut rapporter. Son vrai rôle est
de garantir que **`HEALTHY` est impossible tant que Brevo n'est pas réellement
autorisé à envoyer**.

## 8. Renversement assumé

La section de test « L'envoi de test ne dépend PAS du webhook » affirmait
exactement l'inverse et a été **retournée**, pas supprimée : le fichier documente
la bascule et sa raison.

## 9. Résultat

Backend `npm test` : **toutes suites vertes**, dont 49 assertions dédiées
(`brevo-operational.test.js`). Manager : 14 suites vertes (162 sur
`emailConfiguration`), `tsc` propre, build OK.
