# Panel Bridge — document d'autorité

> **Statut : ACTIF.** Ce document décrit le runtime réel, vérifié dans le code au
> moment de sa rédaction. Il fait autorité sur le pont SB Auto ↔ Panel.
>
> **RÈGLE DE MAINTENANCE — toute modification du pont met ce document à jour dans
> le même lot.** Le pont est la seule frontière entre deux systèmes qui se
> déploient séparément : une divergence entre le contrat réel et sa description
> ne se voit pas en local, elle se voit en production, chez un projet appairé qui
> ne parle plus la même langue que le Panel. Voir [PROTOCOL.md](PROTOCOL.md#règle-de-maintenance-du-pont).

Sources : `backend/src/services/panelBridge/**`, `backend/src/services/projectBridge/**`,
`backend/src/config/bootstrap.js` (section `PANEL`).

---

## 1. Ce que le pont est, et ce qu'il n'est pas

Le Panel Bridge n'est **pas** un client HTTP vers le Panel. C'est un **appairage
persistant** qui survit aux redémarrages, plus un ordonnanceur qui entretient
cette relation.

La distinction est opérationnelle, pas théorique :

| | Connexion réseau | Appairage |
|---|---|---|
| Vit dans | la requête | la base, chiffré |
| Survit à un restart | non | **oui** |
| Se « rétablit » comment | en réessayant | en **réhydratant** |
| Perdu = | erreur transitoire | le projet n'appartient plus à un Panel |

Un backend qui démarre **sans réseau** est toujours appairé. Confondre les deux
produit le défaut le plus coûteux du système : traiter une indisponibilité
passagère comme un désappairage, et abandonner un travail qui n'avait qu'à
attendre.

## 2. Les deux sens, et pourquoi ils ont deux modules

```
panelBridge/    ce que LE PROJET appelle chez le Panel   (sortant)
projectBridge/  ce que LE PANEL appelle chez le projet   (entrant, bridgeToken)
```

Ne pas les confondre : `panelBridge.routes.js` est piloté par l'opérateur du
projet depuis son Manager ; `projectBridge.routes.js` est authentifié par le
jeton de pont et n'est jamais appelé par un humain.

## 3. Cycle de vie de l'appairage

```
pairWithPanel()          l'opérateur appaire depuis le Manager (DEV)
   ↓
setPairing()             persistance CHIFFRÉE (mongoPairingAdapter)
   ↓
[redémarrage]
   ↓
hydratePairing()         bootstrap, section PANEL — recharge le cache
   ↓
configureBridgeRuntime() le runtime sait à qui il parle
   ↓
onPairingChanged()       les dépendants sont réveillés (voir §7)
```

`hydratePairing()` est appelé dans `bootstrap.js` (section `PANEL`), **avant** la
section `INTEGRATED APIs` — c'est ce qui permet aux vérifications de capacités de
savoir si un Panel existe. L'ordre n'est pas cosmétique : inversé, chaque
démarrage conclurait « aucun Panel » puis découvrirait le contraire trop tard.

`unpairFromPanel()` / `clearPairing()` effacent l'appairage. `rotateBridgeToken()`
renouvelle le jeton sans casser l'appairage.

## 4. Contrat de version

```
CONTRACT_VERSION        1.15.0
en-tête                 x-bridge-contract-version   (requêtes ET réponses)
compatibilité           MAJEURE égale
```

> Cette ligne a valu `1.11.0` puis `1.13.0` pendant que le code avançait —
> `docs-runtime-sync.test.js` le signalait à chaque exécution. C'est exactement
> ce que ce contrôle existe pour attraper : la règle de maintenance du pont dit
> que toute modification met ce document à jour dans le MÊME lot, et des
> mineures s'étaient glissées sans lui.

| Mineure | Ce qu'elle a ajouté |
|---|---|
| 1.14.0 | `LEGAL_DOCUMENT` — un document légal résolu, poussé par le Panel |
| 1.15.0 | un consommateur qui ne sait pas traiter une écriture **retient** son curseur et le **déclare** (`consumption.blocked`), au lieu de la sauter en silence |

`assertContractCompatible()` refuse un interlocuteur incompatible. Une majeure
différente n'est pas une dégradation : c'est un refus net, parce qu'un pont qui
« essaie quand même » corrompt des données des deux côtés.

## 5. Ordonnanceur

`startBridgeScheduler()` (section `BACKGROUND SERVICES`, donc **après** les
reprises structurelles) lance deux minuteurs :

| Cycle | Défaut | Rôle |
|---|---|---|
| `runHeartbeatCycle()` | 60 s | preuve de vie, réaffirmation de l'appairage |
| `runSyncCycle()` | 120 s | tirage des changements Panel + poussée de l'outbox |

`runPushCycle()` vide l'outbox seul ; `runSyncCycle()` l'appelle plutôt que de
dupliquer la poussée. `drainBridgeScheduler()` / `stopBridgeScheduler()` sont
appelés à l'extinction, **avant** la fermeture Mongo (voir
[PROTOCOL.md](PROTOCOL.md#extinction)).

## 6. Outbox durable

Les changements sortants ne sont pas envoyés à chaud : ils sont **persistés**
(`mongoOutboxAdapter`) puis poussés par cycle. Un Panel indisponible ne fait donc
rien perdre — c'est la même doctrine que le retour de livraison e-mail : un
projet éteint rattrape à la reconnexion au lieu de perdre l'événement.

`recordSyncIncident()` conserve les échecs pour diagnostic ; `classifyAck()` et
`classifyRejection()` distinguent `APPLIED` / `DUPLICATE` / `IGNORED` / `REJECTED`
— un doublon n'est pas une erreur, et un refus métier n'est pas une panne réseau.

## 7. Entrant : les types réellement appliqués

`APPLIED_ENTITY_TYPES` (`bridgeContract.js`) — rien d'autre n'est accepté :

| Type | Ce que le projet en fait |
|---|---|
| `DIAGNOSTIC` | sonde, traitée à part (§ `projectBridge.service.js`) |
| `DEV_COMPANY` | identité de l'agence qui opère le projet |
| `INTEGRATED_API_CONFIG` | configuration fournisseur descendante |
| `EMAIL_DELIVERY_EVENT` | `EMAIL_DELIVERED` / `EMAIL_BOUNCED` → `emailDeliveryEvent.applier` |
| `SIGNATURE_EVENT` | faits Yousign projetés par le Panel |
| `PAYMENT_REQUEST` | demande de paiement |
| `PAYMENT_DEFAULT_CAUSE` | cause d'un défaut de paiement |
| `PAYMENT_DEFAULT_INCIDENT` | incident de défaut de paiement |
| `CLIENT_COMPANY` | identité **juridique** du client de ce projet (≥ 1.10.0) |

Un type inconnu est **ignoré proprement**, jamais une erreur : c'est un Panel
plus récent qui parle d'un fait dont ce projet n'a pas encore l'usage. Échouer
bloquerait la file de synchronisation d'un projet plus ancien.

### 7 quater. Une écriture illisible ne doit pas arrêter le rattrapage

Le tirage validait la PAGE entière d'un bloc. Une seule écriture non conforme au
contrat faisait échouer la validation, le tirage sortait **avant de toucher au
curseur**, et le cycle suivant redemandait la même page. Le rattrapage — le seul
mécanisme DURABLE de propagation Panel → projet — s'arrêtait net, et rien ne le
disait : `applied: 0` à chaque cycle, `lastError: null`.

Constaté sur l'environnement TEST déployé : 91 cycles consécutifs sans une seule
application, à cause de trois écritures dont l'`entityId` portait un préfixe
lisible (`panel-template-test-<uuid>`) là où le contrat impose un UUID. Ce qui
arrivait encore passait par la livraison immédiate — un **accélérateur**, jamais
une garantie.

La règle est donc asymétrique, et l'asymétrie est le fond du sujet :

- **Chaque changement est validé séparément.** Un illisible est compté, tracé en
  incident `CHANGE_UNREADABLE`, et laissé derrière : le curseur avance. Ce qui
  est lisible est appliqué.
- **L'enveloppe reste validée strictement.** Curseur, `hasMore`, forme de la
  page : un doute ici ferait perdre ou rejouer des écritures en masse. S'arrêter
  est alors le bon comportement.

Autrement dit : on refuse de perdre la POSITION, on accepte de perdre une
LIGNE — et on le dit.

### 7 quinquies. L'anti-recul, et ce qu'il protège

Une écriture plus ancienne que l'état déjà appliqué est ignorée
(`sourceModifiedAt`, `paymentDefaultIncident.applier.js`). Les égalités sont
appliquées : deux écritures au même horodatage ne sont pas un recul.

Ce que cela empêche concrètement : qu'une projection en retard fasse redescendre
un compteur de tentatives, rouvre un incident clos, ou ressuscite une dette
réglée. Le silence de la projection face à une vieille écriture est un **refus**,
pas une absence — le curseur, lui, est bien passé dessus.

## 7 ter. Sortant : le RÉSEAU que ce projet SERT (contrat 1.9.0)

```text
Heartbeat.runtime.network         additif, optionnel, à CHAQUE battement
  publicBackendUrl                l'API publique — celle que le Panel appelle
  publicSiteUrl                   le site public — celui que le client consulte
  managerUrl                      l'espace de gestion
  declaredAt                      l'horloge de CE projet — informative
```

**L'autorité, et elle seule :**

```text
SystemConfiguration.network.{backendUrl, websiteUrl, managerUrl}
```

C'est la configuration que le déploiement écrit et que le runtime applique :
les adresses auxquelles ce projet **répond**, pas celles qu'on aurait souhaité
qu'il serve. C'est la même source que `PROJECT_PRESENTATION` publie déjà — les
deux canaux disent donc la même chose, lue au même endroit, ce qui est la seule
façon qu'ils ne divergent jamais.

**Jamais** : `APP_URL`, une variable d'ambiance, `localhost` ou la boucle
locale, un domaine historique codé en dur, une recomposition « base + chemin ».
Un champ non configuré est **omis** — « non configuré » et « vide » ne sont pas
la même chose, et le Panel doit pouvoir conserver ce qu'il savait.

**Le défaut que cela ferme.** Le Panel posait `runtime.publicBackendUrl` au
bootstrap et ne la relisait jamais : sa fiche annonçait encore
`api.demo-sbauto.lycarz.com` des semaines après la migration vers
`api.demo-sbauto06.ly-solution.com`. La corriger imposait un **réappairage** —
détruire une relation de confiance pour rafraîchir une donnée d'exploitation.

```text
APPAIRAGE      une relation d'IDENTITÉ et de CONFIANCE
URL PUBLIQUE   un ÉTAT COURANT du projet
```

**Deux adresses, jamais confondues.** `PROJECT_PRESENTATION.network` est
**DÉCLARATIVE** (« je vise ce domaine ») et alimente la DESTINATION côté Panel.
Ce que le battement porte est **OPÉRATIONNEL** (« je réponds ici, maintenant »)
et alimente `runtime.publicBackendUrl`.

En production les deux coïncident, ce qui rend la confusion facile et son effet
invisible — jusqu'à ce qu'elles divergent : port éphémère, recette locale, DNS
pas encore basculé. Faire écrire l'adresse opérationnelle par la projection a
été essayé, puis retiré : le Panel s'est mis à rappeler le domaine déclaré au
lieu du port réel et a conclu que le projet était tombé.

**Pourquoi le battement, et pas seulement la projection.** La projection ne part
qu'au **changement** : un réseau stable n'émet plus rien, et une projection
perdue ou refusée n'est jamais rejouée. Le battement, lui, **répète** — c'est ce
qu'on attend d'une donnée de liveness.

**Pourquoi l'émission est CONDITIONNÉE.** Les schémas des deux côtés sont
`.strict()` et la compatibilité n'est vérifiée que sur la MAJEURE. Envoyer ce
champ à un Panel 1.8 aurait fait refuser le battement **en bloc** pour un champ
inconnu : une instance parfaitement saine rendue muette, et une fiche qui
bascule hors ligne alors que rien n'est tombé.

Ce projet lit donc `x-bridge-contract-version` sur **chaque réponse** du Panel
et ne déclare son réseau qu'à un Panel **≥ 1.9.0**. *Fail closed* : tant
qu'aucune réponse n'a été reçue, rien n'est déclaré — un battement muet est sans
conséquence, un battement refusé ne l'est pas.

C'est aussi ce qui impose l'ordre de livraison : **Panel d'abord, projet
ensuite**.

## 7 ter. Sortant : un INCIDENT TECHNIQUE durable (≥ 1.11.0)

```text
PLATFORM_INCIDENT                 un par palier, entityId dérivé des FAITS
  kind · component · environment
  occurrences · firstSeenAt
  error { code, message }         déjà rendue sûre par ce projet
  eventId                         corrélation avec l'événement de domaine
```

Ce projet envoyait lui-même l'alerte correspondante, avec le modèle
`PLATFORM_INCIDENT_DEV_ALERT`. Elle ne pouvait **structurellement pas** aboutir :
ce modèle est une communication de L.Y Solution vers l'équipe technique — donc de
portée PANEL — et un projet ne peut pas demander une portée PANEL. Chaque
incident finissait en refus silencieux ; aucun n'a jamais été notifié.

Il RAPPORTE désormais des faits. Il ne nomme ni modèle, ni destinataire, ni
sujet : le control plane décide de l'alerte, de qui il prévient et de ce qu'il
écrit.

**Pourquoi une entité et non une capacité.** Une capacité est synchrone : elle
échoue quand le Panel est injoignable. Or l'indisponibilité du Panel est
justement l'une des familles d'incidents qu'on veut remonter — la plus probable.
La file durable rejoue à la reconnexion ; l'`entityId` dérivé des faits fait
converger un rejeu sur un seul rapport.

Voir
[EMAIL_TEMPLATE_AUTHORITY.md](../../Panel/docs/architecture/EMAIL_TEMPLATE_AUTHORITY.md)
§7.

## 7 quater bis. Entrant en LECTURE : la projection des modèles (≥ 1.11.0)

Cinq routes du Panel, toutes en lecture, hors synchronisation d'entités :

```text
GET  /bridge/v1/email-templates                    la projection du projet
GET  /bridge/v1/email-templates/{code}             un modèle résolu
POST /bridge/v1/email-templates/{code}/preview     un rendu (corps ignoré)
GET  /bridge/v1/email-templates/{code}/readiness   partirait-il, et sinon pourquoi
POST /bridge/v1/email-templates/{code}/test-send   un envoi de test, exécuté par le Panel
```

Le contenu **ne se réplique pas, il se consulte** : ce projet ne conserve aucune
copie de sujet ni de HTML. Un cache en ferait une chose capable de diverger,
donc une seconde autorité — celle que le lot 1.11.0 supprime.

La façade autorisée est `services/panelBridge/templateProjectionClient.js`, au
même titre que `bridgeContract.js` et `capabilityClient.js` : un vocabulaire,
sans état, **strictement en lecture**.

## 7 bis. Sortant : ce que ce projet DÉCLARE utiliser

Depuis le contrat **1.8.0**, ce projet pousse une entité de plus :

```text
PROJECT_EMAIL_TEMPLATE_USAGE      une par projet, entityId stable
  templateCodes[]                 ce que ce projet CONSOMME réellement
  revision                        empreinte de la liste
  contractFingerprints{}          ≥ 1.11.0 — l'empreinte du VOCABULAIRE que ce
                                  projet sait servir, par code
  declaredAt · softwareVersion
```

**`contractFingerprints` (≥ 1.11.0).** Le Panel possède le vocabulaire d'un
modèle (quelles variables, lesquelles sont obligatoires, de quel type) ; ce
projet possède la façon de produire les valeurs. Rien ne reliait ces deux
autorités : elles s'accordaient « par chance », et rien ne le vérifiait.

Le coût du silence était précis — ajouter une variable **obligatoire** fait
échouer tous les envois d'un modèle sur tout le parc, au prochain e-mail, des
semaines plus tard. Ce projet renvoie donc l'empreinte que le Panel lui a
SERVIE : le désaccord se constate à la déclaration, avant tout envoi.

Il la **transporte**, il ne la recalcule pas : la recalculer supposerait de
dupliquer la règle de hachage du Panel, donc de pouvoir en diverger.

**Pourquoi une entité de synchronisation et non une capacité.** Une capacité
serait un ORDRE (« provisionne-moi ces dix modèles ») : il faudrait le rejouer à
l'identique après chaque coupure, et rien ne garantirait qu'il ait été reçu. Une
entité est un ÉTAT : elle converge toute seule, hérite du LWW, de l'anti-écho par
`writeId`, de l'idempotence et de la file durable.

La liste est **dérivée du code** (`utils/projectEmailTemplateUsage.js`), jamais
tenue à la main, et ne contient que des modèles de portée `PROJECT` : les
communications de la plateforme n'y figurent pas.

Elle part avec la photographie complète — donc au démarrage **et à chaque
appairage**. C'est ce qui rend un projet dupliqué immédiatement opérationnel :
il déclare, le Panel provisionne, personne n'intervient.

`revision` porte la garantie de silence : identique à celle que le Panel détient,
il ne réécrit rien et ne journalise rien.

## 7 quinquies. Entrant : l’ENTREPRISE CLIENTE (contrat 1.10.0)

```text
CLIENT_COMPANY        une par projet, nominative (audience = ce projet)
  legalName           la raison sociale — ce que porte « Facturer à »
  siren / siret       identification de la personne morale
  vatNumber           TVA intracommunautaire
  registeredOffice    siège social, décomposé
  billingAddress      adresse de facturation EFFECTIVE (siège à défaut)
  contractualSigner   la personne physique qui engage l’entreprise
  readiness           le VERDICT du Panel : peut-on facturer ? signer ?
```

**Ne jamais confondre avec `DEV_COMPANY`.** Ce sont deux personnes morales, et
elles se font face :

| | Qui | Diffusion | Ce qu’elle décide |
|---|---|---|---|
| `DEV_COMPANY` | L.Y Solution — le **prestataire** | tout le parc | pied de page, signataire développeur |
| `CLIENT_COMPANY` | le **client** de ce projet | ce projet SEUL | « Facturer à », signataire client |

Les fondre aurait obligé ce projet à deviner, à la lecture, laquelle des deux il
reçoit — et la page « Mon entreprise » aurait fini par afficher les mentions
légales de son prestataire.

**LECTURE SEULE, sans exception.** Ce projet applique et affiche ; il n’écrit
jamais. Aucune projection sortante, aucun déclencheur, aucun écran. Pouvoir
l’écrire reviendrait à laisser un client choisir la raison sociale sur laquelle
il est facturé et la personne qui l’engage.

**Conséquences exactes de son absence** — ce ne sont pas des couleurs de
bouton, ce sont des refus backend :

```text
aucune entreprise rattachée   → aucun paiement, aucune signature
identité de facturation       → aucun paiement (le Panel refuse la session)
  incomplète
signataire absent             → aucune signature (le Panel refuse la demande)
```

Le refus AUTORITATIF vit côté Panel, au point d’usage. Les gardes de ce projet
(`clientCompany.service.js` → `billingReadiness()` / `signingReadiness()`)
existent pour EXPLIQUER avant de faire cliquer, jamais pour protéger seules.

**Le tombstone est un état, pas une perte.** Le Panel l’émet au détachement ou
au changement de client. L’applicateur vérifie qu’il désigne bien l’entreprise
COURANTE : un changement de rattachement émet la nouvelle identité PUIS le
retrait de l’ancienne, et appliquer le second sans vérifier effacerait le
premier.

## 7 sexies. Le CURSEUR de consommation est DURABLE (contrat 1.10.0)

### La dette que ce lot a fermée

`pullCursor` vivait dans une propriété d’instance du pont. Il ne survivait ni à
un redémarrage, ni à une release, ni à un `pm2 restart` :

```text
consommer les écritures 1 à 100
redémarrer
→ le tirage suivant repartait de ZÉRO
```

Les protections d’idempotence (LWW sur `modifiedAt`, anti-rejeu par `writeId`)
évitaient la corruption. Elles n’évitaient ni le coût, ni le bruit, ni —
surtout — l’impossibilité pour le Panel de savoir ce qu’un projet avait
réellement consommé.

### Ce qui est désormais persisté

`BridgeSyncState` (singleton), écrit par `mongoSyncStateAdapter`, lu par
`consumptionStore` — **même discipline que l’appairage** : lectures synchrones
sur un cache, écritures par un adaptateur INJECTÉ, aucun modèle dans le cœur du
pont.

```text
pullCursor                     la position, opaque, stockée telle quelle
lastCursorAdvanceAt            quand le tirage a réellement PROGRESSÉ
lastSuccessfulApplyAt          la dernière écriture réellement appliquée
consecutivePullFailures        échecs de transport CONSÉCUTIFS
consecutiveUnreadableChanges   écritures ÉCARTÉES consécutives (= PERTE)
recentWriteIds[]               fenêtre BORNÉE d’idempotence intra-page
projectId / generation         à qui, et dans quel monde, ce curseur appartient
```

### Les DEUX seules remises à zéro légitimes

| Cas | Pourquoi c’est correct |
|---|---|
| le `projectId` a changé | un curseur est une position dans un journal FILTRÉ par destinataire ; le garder ferait sauter tout ce qui précède |
| la `generation` a changé | un projet redéployé d’un monde à l’autre parle à un autre Panel, avec un autre journal |

Tout le reste — un Panel redémarré, un projet redéployé dans le même monde, un
curseur ancien — n’est **pas** une raison de repartir de zéro. C’est même le cas
nominal que ce mécanisme existe pour servir.

Un troisième cas déclenche une remise à zéro NOMMÉE : le Panel **refuse** le
curseur (`BRIDGE_INVALID_PAYLOAD`). Sans traitement, ce refus serait définitif —
le curseur invalide est persisté, chaque cycle le renvoie, chaque cycle est
refusé. Le tirage serait mort pour toujours, et la persistance ferait survivre
la panne aux redémarrages. On repart donc de l’origine, et l’incident le dit.

### `appliedWriteIds` et `localWriteIds` — ce qu’ils sont devenus

| Avant | Maintenant | Pourquoi |
|---|---|---|
| `appliedWriteIds` : `Set` sans fin, en mémoire | fenêtre BORNÉE, persistée (`recentWriteIds`) | le curseur durable fait l’essentiel : au-delà de lui, une écriture n’est jamais reservie. Le seul rejeu possible est INTRA-PAGE |
| `localWriteIds` : `Set` sans fin, en mémoire | `Set` BORNÉ, toujours en mémoire | ce n’est pas la protection — le Panel exclut lui-même l’émetteur d’origine (`originProjectId`). Une ceinture n’a pas à survivre à un redémarrage, après lequel plus aucune écriture en vol ne peut revenir |

Aucun des deux n’est un ensemble infini sérialisé : c’était précisément le piège
à éviter en les rendant durables.

### Ce que le battement en DIT au Panel

Tout le reste de `bridgeStats` décrit la file **sortante**. Un projet dont le
TIRAGE est mort a une file sortante parfaitement vide, un battement régulier et
aucune erreur — le Panel ne pouvait donc pas distinguer « rien à recevoir » de
« plus rien n’arrive », et sa fiche restait verte.

`bridgeStats.consumption` porte cette différence : curseur, dates de
progression, compteurs d’échecs consécutifs. Aucune charge utile, aucun secret.

L’émission est **conditionnée** à un Panel ≥ 1.10.0 (`#panelSpeaks(10)`), pour
la même raison que la déclaration de réseau : les schémas sont `.strict()`, et
un champ inconnu ferait refuser le battement en bloc.

**Ordre de livraison imposé : Panel d’abord, projet ensuite.**

### Et SEUL LE TITULAIRE DU BAIL le déclare

`consumptionIsAuthoritative()` — dans `consumptionStore.js` — décide si CE
runtime a le droit de décrire la consommation du projet. La réponse est oui
s’il tient le bail de consommation, ou s’il ne l’a **jamais** réclamé (cas
mono-processus, celui de la quasi-totalité du parc). Sinon, `consumption` est
**absent du battement**, et le Panel lit ce silence comme `UNKNOWN` — un verdict
qui n’ouvre aucune alerte et n’en referme aucune.

#### L’incident qui a créé cette règle

Le Panel a expédié **un courriel par minute pendant une demi-heure** pour
annoncer qu’un projet « consomme à nouveau les écritures ». Il n’était ni tombé
ni réparé trente fois.

Deux runtimes du même projet battaient : le **déployé**, titulaire du bail, qui
consomme réellement ; et un **poste de développement** branché sur la même base,
qui l’avait perdu. Le second publiait pourtant son `consumption` — un curseur
hydraté au démarrage puis **figé**, puisqu’il n’a plus le droit de tirer.

```text
battement du poste local    → curseur figé  → retard de 4 h   → DEGRADED
battement du déployé        → curseur à jour → retard nul     → HEALTHY
battement du poste local    → …                                → DEGRADED
```

Le Panel ouvrait et refermait l’alerte à chaque bascule, et annonçait un
rétablissement à chaque fermeture.

#### Ce que ça implique quand on développe en local

Lancer `npm run dev` sur un projet **déployé** est parfaitement légitime : le
poste sert ses requêtes, il bat, mais il ne consomme pas et **ne décrit plus la
consommation**. La supervision du Panel continue de refléter le seul runtime qui
consomme réellement.

> Le Panel s’en protège aussi de son côté : un retour à la santé doit **tenir**
> `RECOVERY_CONFIRMATION_MS` (10 min) avant d’être annoncé — voir
> `Panel/backend/src/services/supervision/bridgeAlerting.service.js`. Les deux
> gardes sont indépendantes : celle-ci corrige la cause, celle-là immunise le
> parc, y compris les runtimes pas encore redéployés.

**Recette :** `node src/scripts/bridge-consumer-lease.test.js` — section H,
« seul le titulaire décrit sa consommation au Panel ».

## 8. Capacités

`capabilityClient.js` est la **seule porte** vers le Panel pour le métier —
`invokeCapability()` et `capabilitiesAvailable()`. Le test d'architecture
`bridge-conformity` interdit au métier d'atteindre directement l'appairage ou le
transport.

Capacités réellement invoquées par SB Auto aujourd'hui :

```
billing.checkout.retrieve
email.send_template
email.sender.verify
signature.request.open        signature.request.retrieve
signature.request.cancel      signature.signer.retrieve
signature.document.download
dns.zone.resolve              dns.records.read
```

SB Auto envoie une **intention métier bornée**. Il n'existe pas de
`provider.rawRequest` — une capacité générique déplacerait le problème au lieu de
le résoudre, et rendrait l'autorité du Panel purement nominale.

**Fail-closed** : si une capacité est indisponible, l'appel échoue avec un code
explicite. Il n'y a **aucun repli** vers un credential local — voir
[INTEGRATED_API.md](INTEGRATED_API.md).

## 9. Ce que le pont ne fait pas

- Il ne rend pas le projet dépendant du Panel pour **servir** son site.
- Il ne transporte aucun credential fournisseur vers le projet (à l'exception
  documentée de `STRIPE.webhookSecret`, qui ne permet aucun appel).
- Il n'exécute pas de déploiement : le moteur est local, seul le DNS passe par
  des capacités.

## 10. Diagnostic

| Symptôme | Où regarder |
|---|---|
| « aucun Panel appairé » | `describePairing()`, section `PANEL` du démarrage |
| capacité refusée | code d'erreur de `invokeCapability` |
| changements non poussés | outbox + `describeScheduler()` |
| événements non reçus | `APPLIED_ENTITY_TYPES` + incidents de sync |

Procédures complètes : [PROTOCOL.md](PROTOCOL.md#incident--panel).
