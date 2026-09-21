# Configuration e-mail

## La seule question

> **Les e-mails partent-ils correctement depuis ce site ?**

Tout ce module existe pour y répondre. Rien d'autre.

La réponse ne vient pas d'un état recopié depuis Brevo (expéditeur vérifié,
domaine authentifié, DKIM, DMARC) mais d'un **envoi réel constaté**. Un miroir
d'état peut être périmé, indisponible ou faux ; un e-mail que Brevo a accepté ne
l'est pas.

## Ce que le Manager gère

Trois choses, et c'est tout :

| Champ | Rôle |
| --- | --- |
| Nom d'expéditeur | Le « From Name » des e-mails du site |
| Adresse email support | Le « From » et l'adresse de contact affichée |
| Envoyer un email de test | La preuve de fonctionnement |

Statut affiché, en quatre mots au plus :

| Statut | Signification |
| --- | --- |
| **Non configuré** | Nom, adresse ou clé API manquants |
| **À tester** | Configuration enregistrée — test requis |
| **Fonctionnel** | Dernier envoi de test accepté par Brevo |
| **Erreur d'envoi** | Dernier envoi de test refusé |

Un commerçant doit pouvoir comprendre et tester sa configuration en moins d'une
minute, sans jamais rencontrer les mots OTP, DKIM ou DMARC.

## Ce que le Manager NE gère PAS

Ni création d'expéditeur chez Brevo, ni code de vérification, ni lecture de
`/senders`, ni domaine, ni DKIM, ni DMARC, ni records DNS, ni statut distant, ni
synchronisation. **Le Manager ne reproduit pas Brevo.**

Cette configuration technique s'administre là où elle vit :

- **Expéditeur validé** → tableau de bord Brevo (*Senders*)
- **Domaine authentifié, DKIM, DMARC** → tableau de bord Brevo + fournisseur DNS
- **Webhook transactionnel** → voir [BREVO_WEBHOOKS.md](BREVO_WEBHOOKS.md)

Une checklist d'installation et un lien vers Brevo sont repliés dans un bloc DEV
de la carte, sous *Configuration technique Brevo*.

## Modèle de données

`EmailConfiguration` est un singleton. **Tout est par mode.**

```js
{
  modes: {
    TEST: {
      sender: { email: '', name: '' },
      test: {
        status: 'NOT_TESTED' | 'SUCCESS' | 'FAILED',
        lastTestedAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastMessageIdSafe: '',
        lastErrorSafe: { code: '', message: '' },
      },
    },
    PROD: { /* idem */ },
  },
}
```

**Pourquoi par mode.** La clé API Brevo appartient à UN compte. TEST et PROD
portent deux clés, donc potentiellement deux comptes, deux expéditeurs autorisés,
deux quotas. Un test réussi en TEST ne prouve **rien** en PROD. Partager
l'identité afficherait « Fonctionnel » après une bascule où aucun envoi n'est
possible.

**Historique borné.** Deux dates (dernier succès, dernier échec) et une cause.
Pas de journal d'essais qui grossit sans fin : personne ne remonte le vingtième
test raté, et le dernier de chaque issue suffit à savoir si la configuration
marchait avant de casser.

Le statut global n'est **jamais stocké** : il est dérivé de la configuration
locale, de la présence de la clé du mode et du dernier test. Le persister
créerait une quatrième vérité à tenir synchronisée avec les trois autres.

## API

Routes DEV uniquement (`authorize(ROLES.DEV)`). **Aucune ne reçoit de `mode`** :
le backend écrit toujours dans le mode Brevo actif, ce qui rend impossible
d'enregistrer en PROD depuis un écran affichant TEST.

| Route | Effet |
| --- | --- |
| `GET /api/email-configuration` | Projection canonique des deux modes |
| `PUT /api/email-configuration/sender` | Enregistrement **strictement local** |
| `POST /api/email-configuration/test-send` | Envoi transactionnel **réel** |

### `PUT /sender`

Corps strict : `{ email, name }`. Trim, adresse en minuscules.

L'enregistrement **n'appelle jamais Brevo** — ni `/senders`, ni `/domains`, ni
OTP. Il réussit sans clé API et même si le compte Brevo est injoignable. C'est
l'invariant qui rend la carte utilisable : la configuration ne peut pas être
prise en otage par les capacités du compte.

Changer l'**adresse** réinitialise le dernier test du mode (la preuve portait sur
l'ancienne boîte). Changer le seul **nom** ne réinitialise rien : Brevo accepte
ou refuse une adresse, pas un nom d'affichage.

### `POST /test-send`

Corps : `{ recipient? }`. Sans destinataire, l'e-mail part vers l'adresse support
configurée — le commerçant n'a donc rien à saisir pour tester.

Un seul appel : `POST /v3/smtp/email`. Aucune consultation préalable de
`/senders` ou `/domains` — on ne demande pas à Brevo s'il accepterait, on lui
demande d'envoyer.

**Un refus de Brevo répond 200**, avec `test.status = FAILED` et l'erreur
normalisée. C'est un *résultat*, pas une panne. Seules les fautes d'usage
(identité manquante, destinataire invalide) sont des 400, parce qu'elles se
corrigent dans le formulaire.

### Erreurs — une cause et un geste

Le Manager s'appuie sur le **code**, jamais sur le texte de Brevo (ni stable, ni
traduit, ni présentable).

| Code | Message affiché |
| --- | --- |
| `API_KEY_MISSING` | Aucune clé API Brevo n'est configurée. |
| `API_KEY_INVALID` | La clé API Brevo est invalide. |
| `SENDER_REFUSED` | L'adresse email utilisée comme expéditeur n'a pas encore été autorisée dans votre compte Brevo. Connectez-vous à votre tableau de bord Brevo, ajoutez cette adresse dans les Expéditeurs, validez-la, puis relancez un email de test. |
| `RECIPIENT_INVALID` | L'adresse destinataire est invalide. |
| `NETWORK_ERROR` | Impossible de contacter Brevo. |
| `SERVICE_UNAVAILABLE` | Le service d'envoi est momentanément indisponible. |

Le commerçant ne voit **jamais** : un code (`SENDER_REFUSED`, `invalid_parameter`),
un statut HTTP, un message brut Brevo, un payload fournisseur, une stack, l'IP du
serveur. Un code affiché tel quel n'est pas une information — c'est l'aveu que le
produit n'a pas su traduire ce qu'il a compris. Un code inconnu retombe donc sur
une phrase neutre, jamais sur le code lui-même.

**Où vit la copie.** Le backend est l'autorité sur le CODE et persiste un message
sûr pour l'audit ; les phrases affichées vivent dans le Manager
(`lib/emailConfiguration.ts`, `TEST_ERROR_META`). La copie produit se retouche
bien plus souvent que le code métier, et la changer côté serveur ne réécrirait
pas les traces déjà en base.

La classification raisonne sur le **statut HTTP**, jamais sur le texte. Le
destinataire étant validé localement en amont, un 400 ne peut porter que sur
l'expéditeur — cas fréquent d'une adresse non autorisée dans le dashboard Brevo.
401/403 désignent la clé. 402, 429 et 5xx signifient « Brevo a répondu qu'il ne
peut pas » (`SERVICE_UNAVAILABLE`) ; une absence totale de réponse signifie
« nous n'avons pas pu le joindre » (`NETWORK_ERROR`) — la panne est peut-être de
notre côté, et confondre les deux enverrait la chercher au mauvais endroit.

### Ouvrir Brevo

`SENDER_REFUSED` est le seul échec réparable par un geste dans Brevo. Dans ce cas
**et pour un utilisateur DEV uniquement**, un bouton *Ouvrir Brevo* mène à
`https://app.brevo.com` — l'accueil, jamais une page profonde (leurs URLs
internes bougent).

## Envoi de test et webhook

L'envoi de test n'a **aucune** dépendance au webhook : un seul appel
`POST /v3/smtp/email`. Un tunnel ngrok arrêté ou une URL publique absente
n'empêchent jamais de tester — confondre « je ne saurai pas si le message a été
remis » avec « je ne peux pas envoyer » rendrait le module inutilisable en
développement local.

Côté **DEV uniquement**, la carte affiche alors une note discrète : « Les statuts
de livraison ne pourront pas être synchronisés tant qu'une URL publique n'est pas
configurée. » Informatif, jamais bloquant. Aucune alerte côté commerçant.

### ACCEPTED ne reste jamais bloqué

Le statut du test évolue `ACCEPTED` → `DELIVERED`/`REJECTED` **par webhook**. Si
la confirmation n'arrive pas (webhook absent, cassé, ou Brevo qui ne rappelle
pas), le Manager ne prétend plus indéfiniment que « Brevo traite le message » :
au-delà de `DELIVERY_CONFIRMATION_TIMEOUT_MS` (5 min) en ACCEPTED, il affiche
**Suivi indisponible** (webhook absent) ou **Le suivi Brevo ne fonctionne pas**
(webhook actif mais rien reçu), avec « La confirmation de livraison n'a pas été
reçue. » Une horloge locale ne tourne que pendant l'attente et s'arrête dès
l'issue connue (`trackingStalled`, `lib/emailConfiguration.ts`).

### Comparaison des événements du webhook (anti-boucle)

> **⚠️ SECTION SUPPRIMÉE — le sous-système décrit ici n'existe plus.**
>
> Ce passage racontait le diagnostic et l'ingestion du webhook Brevo **local**
> (`brevoWebhookConfig.service.js`, `brevoWebhookIngest.service.js`), retirés
> avec le reste du stack. Les e-mails partent du compte Brevo **du Panel**, et
> les événements de livraison suivent le COMPTE : ils arrivent au Panel, qui les
> reprojette par le pont (`EMAIL_DELIVERED` / `EMAIL_BOUNCED`).
>
> Il n'y a donc plus de souscription à comparer, ni d'endpoint local à
> diagnostiquer. Voir [INTEGRATED_API.md](INTEGRATED_API.md#brevo--e-mail) et
> [PROTOCOL.md](PROTOCOL.md#incident--e-mail).

## Le test est entièrement manuel

Il n'y a **aucun** test automatique après enregistrement (un déclenchement
implicite envoyait un e-mail vers une adresse que l'utilisateur ne maîtrisait
pas). `Enregistrer` ne fait qu'enregistrer. Le seul déclencheur d'envoi est le
bouton **« Envoyer un email de test »**, qui ouvre une modale « Adresse de
réception » (préremplie : dernier destinataire → DEV connecté → adresse support,
toujours modifiable), avec la note « Cette adresse recevra uniquement l'email de
test. Elle ne modifie pas les notifications du site. »

## Anti-spam du bouton de test

Chaque clic envoie un vrai e-mail et consomme du quota Brevo. Trois gardes :

- le bouton est désactivé pendant l'appel (`loading`) ;
- un **verrou par `ref`** ferme la fenêtre où deux clics dans la même frame
  passeraient tous deux la garde — `pending` n'est vrai qu'au rendu suivant ;
- un limiteur backend (10 / 15 min / IP), inactif en `ENV=TEST`.

## Readiness et chaîne d'envoi

`EmailReadinessService` reste le point de passage obligé de tout envoi. Il ne
bloque plus que sur ce qui est **certain** : fournisseur absent ou désactivé,
aucun mode actif, clé manquante ou jamais testée, **aucune adresse expéditrice**,
template absent/désactivé/invalide, destinataire manquant ou invalide.

Deux blocages ont disparu :

- `EMAIL_SENDER_NOT_VERIFIED` — cet état s'administre chez Brevo et pouvait
  changer sans que nous le sachions. Le recopier revenait à refuser des envois
  légitimes sur la foi d'un miroir périmé ; sur les comptes où l'API de gestion
  des expéditeurs est indisponible, ce miroir ne pouvait même pas être
  rafraîchi. C'est désormais Brevo qui tranche, au moment de l'envoi.
- Les avertissements de domaine — `warnings` reste dans le contrat de retour
  (stabilité) mais n'est plus alimenté.

Corollaire : un test en échec ne barre **pas** la route aux notifications. La
configuration a pu être corrigée chez Brevo depuis, et priver le commerçant de
ses demandes de contact sur la foi d'un vieil échec serait le pire des deux
mondes. Voir [EMAIL_DELIVERY.md](EMAIL_DELIVERY.md).

## Événements

Trois faits, pas un de plus :

| Type | Rétention |
| --- | --- |
| `email.sender.updated` | AUDIT |
| `email.test.succeeded` | AUDIT |
| `email.test.failed` | AUDIT |

Adresses toujours masquées (`s***@domaine.fr`). Aucune clé, aucun texte
fournisseur. Voir [DOMAIN_EVENTS.md](DOMAIN_EVENTS.md).

## Migration

`migrateEmailConfigurationToSimpleModel()` s'exécute au bootstrap, **avant** tout
chargement du singleton.

Elle reprend l'ancien document (`sender` et `domain` à la racine) vers
`modes.{TEST,PROD}`, recopie l'identité partagée à l'identique dans les deux
modes — les deux l'utilisaient réellement — et `$unset` tout le reste
(vérification, OTP, domaine, DKIM, DNS).

**Driver natif, pas Mongoose.** Le schéma ne déclare plus `sender` : une
hydratation Mongoose l'ignorerait purement et simplement, et l'adresse serait
perdue au premier `save()`. Le driver natif évite en prime tout cast sur les
anciens `lastErrorSafe` (string côté expéditeur, objet côté domaine).

Idempotente : un mode déjà migré n'est jamais réécrit, une saisie postérieure
n'est jamais écrasée, et rejouer la migration ne fait rien.

## Tests

```bash
npm --prefix backend run test:email-config   # 150 assertions
npm --prefix manager test                    # dont emailConfiguration.test.mjs
```

Ce que le test backend prouve, et qui est le cœur du lot : l'enregistrement
n'émet **aucun** appel réseau, le verdict vient d'un envoi réel, un refus devient
un statut et une erreur sûre, TEST et PROD sont étanches, et un ancien document
migre sans rien perdre. Le fournisseur simulé n'expose que `/smtp/email` : toute
tentative vers `/senders` ou `/domains` produirait un 404 que les assertions
« aucun appel » détectent.
