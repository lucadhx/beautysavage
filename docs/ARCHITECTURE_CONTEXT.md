# Contexte d'architecture — SB Auto (projet standard)

> Le document d'entrée, côté PROJET. Il décrit le système **tel qu'il est
> implémenté aujourd'hui**. `ARCHITECTURE.md` reste la carte du dépôt ; celui-ci
> répond aux questions qui traversent le Panel, le pont et le déploiement.
>
> Ce projet est le **modèle** dont les autres sont clonés : tout ce qui est
> décrit ici doit rester générique. Aucun `sbauto`, aucun `ly-solution.com`
> dans la logique métier.

---

## 1. Une instance, un environnement, un appairage

```
backend + manager + vitrine
        │
        ├── ENV = TEST  → base DB_TEST  → appairage au Panel TEST
        └── ENV = PROD  → base DB_PROD  → appairage au Panel PROD
```

`BridgePairing` est un **singleton par base**. TEST et PROD utilisant deux
bases distinctes, chaque instance a **son propre jeton** et **son propre
appairage**. Il n'existe jamais un seul jeton pour les deux.

Côté Panel, chacune est une fiche distincte — **dans une instance de Panel
distincte**. Elles ne se croisent jamais et ne sont jamais regroupées à
l'écran.

### La doctrine, vue de ce projet

> **Ici (SB Auto / Manager) :** un projet logiciel peut posséder **N
> destinations** de déploiement — TEST, PROD, et d'autres plus tard. C'est
> interne au projet.
>
> **Là-bas (Panel) :** une fiche représente **exactement une** instance
> appairée. Une fiche appairée possède exactement **un** environnement déclaré
> et **une** destination courante. Le Panel ne regroupe **jamais** TEST et
> PROD dans une même fiche.

Les deux systèmes ne comptent pas la même chose, et c'est normal :

```
ICI (Manager)                        LÀ-BAS (Panel TEST)

Projet SB Auto                       ┌── UNE fiche — projectId · TEST
├── destination TEST  ───────────────┘   1 appairage · 1 destination
├── destination PROD                     1 état métier
└── … d'autres
                                     La destination PROD s'appaire à l'AUTRE
UN projet, N destinations.           Panel, avec son propre code et son jeton.
```

Conséquence pratique pour ce dépôt : **une instance ne pousse jamais que son
propre état**. Ce que TEST projette n'atteint jamais la fiche PROD — pas parce
qu'un filtre l'en empêche, mais parce que l'écriture voyage avec le jeton de
CET appairage, donc sous CE `projectId`. Deux bases, deux jetons, deux
périmètres, et même deux Panels.

**Avant appairage, le Panel ne sait rien de nous** : environnement et
destination y valent `null` et s'affichent « non connu ». Ils lui arrivent au
bootstrap, puis à chaque échange — jamais d'une saisie faite chez lui.

---

## 2. Choisir son Panel

Deux variables, et elles doivent concorder :

```
PANEL_URL = https://panel-test.exemple.com     ← choisit l'INSTANCE
ENV       = TEST                                ← déclare le MONDE
```

Le domaine choisit la machine ; l'environnement prouve qu'on parle du même
monde. Si les deux divergent, le Panel refuse l'appairage avec
`BRIDGE_ENVIRONMENT_MISMATCH` — **sans consommer le code**. On corrige le
`.env` et on rejoue le même code.

Aucune correction automatique n'est faite dans un sens ni dans l'autre.

> Le déploiement embarque le `.env` du projet **verbatim** et ne réécrit que ce
> qui est propre à l'hôte : `ENV`, `PORT`, `CORS_ORIGINS`, `PUBLIC_URL`.
> `PANEL_URL` est donc **le vôtre à maintenir** lors d'une promotion TEST → PROD.

---

## 3. Ce que ce projet annonce au Panel

| Ce qu'il annonce | D'où ça vient | À quoi ça sert |
|---|---|---|
| `projectKey` | slug de `PROJECT_NAME` | clé **technique** de la fiche : anti-collision, rien de plus |
| `projectName` | `PROJECT_NAME` | libellé affiché |
| `environment` | `ENV` | valide l'instance de Panel, et **fait foi** pour l'environnement de la fiche |
| `softwareVersion` | build | supervision |
| `manifest` | registre code-first | capacités, modules, réseau |

`projectKey` étant dérivé de `PROJECT_NAME`, et le `.env` étant embarqué tel
quel, **les deux instances annoncent la même clé**. Ce n'est plus un moyen de
regroupement : le Panel s'en sert uniquement pour **réconcilier** la clé de la
fiche, et refuse de l'adopter si une autre fiche la détient déjà (index
unique). Elle ne détermine ni périmètre métier, ni environnement, ni
destination, ni écran.

Le nom COMMERCIAL, lui, ne passe pas par là : il voyage dans la projection
`PROJECT_PRESENTATION` (`companyName`), poussée à chaque enregistrement — voir
§8ter. Le manifeste n'en est qu'un repli, et le Panel le dit
(`presentationSource`).

---

## 4. Destinations de déploiement

Une instance publie sur des destinations. Une seule est `ACTIVE` par
environnement ; les précédentes deviennent `RETIRED`.

```
ACTIVE ──► DEPROVISIONING ──► EMPTY ──► DELETED
   │             │
   │             └──► DEPROVISION_FAILED ──┐
   │                        ▲              │
   └──► RETIRED ────────────┴──────────────┘
```

### `RETIRED` ne veut pas dire vidé

Une destination remplacée **garde** son PM2, son port, sa configuration Nginx,
son `siteRoot`, ses fichiers et ses médias jusqu'à ce que le retrait ait eu
lieu. C'est exactement celle qu'on veut nettoyer : elle **doit** pouvoir être
inspectée et retirée, et ne **doit pas** être supprimable directement.

### `currentVersion` ne prouve rien sur le serveur

> `currentVersion` décrit une **version applicative connue**. Il ne constitue
> **ni une preuve de présence, ni une preuve d'absence** d'un déploiement
> physique.

Une destination antérieure au registre n'a jamais eu de hash tout en servant
réellement un domaine. En déduire « aucune version déployée » annonçait un
serveur vide devant un serveur plein et masquait le bouton de retrait.

Le droit de retirer vient du **cycle de vie** (`DEPROVISIONABLE`), et il n'en
existe qu'une définition — la sérialisation l'importe au lieu de la recopier.
L'exécution reste protégée par l'inspection du serveur.

→ `backend/src/services/deployment/destinationLifecycle.service.js`

### Ordre du retrait

```
inspection → arrêt PM2 → preuve de libération du port → retrait Nginx
  → quarantaine 410 → suppression des fichiers → dépublication des médias
  → EMPTY → (alors seulement) suppression logique
```

---

## 5. Pipeline de déploiement

```
deployment.initialize · dns · ssh · préflight · build
artifact.upload · dependencies.install
uploads.migrate → media.adopt → nginx · https · services.start · services.verify
media.publish → public.healthcheck → runtime.sync → deployment.finalize
```

Contrainte qui compte :
`uploads.migrate` → `media.adopt` → `media.publish` → `public.healthcheck`.

Le moteur est **partagé avec le Panel** et n'importe aucun modèle métier :
tout ce qui est propre à l'application passe par une **capacité injectée**
(`adoptApplicationMedia`, `publishApplicationMedia`, `runtimeConfigSync`…).
Toute modification du cœur doit respecter `engine-drift`.

---

## 6. Médias : l'autorité, et rien d'autre

```
authority = PANEL | PROJECT
```

| Autorité | Fichier | Adresse |
|---|---|---|
| `PANEL` | sur le Panel | **son URL publiée, telle quelle** |
| `PROJECT` | dans `shared/uploads` de la destination | résolue contre la destination ACTIVE |

Rien ne se déduit d'une clé d'objet, d'un hôte ou d'un type métier. Autorité
inconnue → refus.

Reprise d'un parc historique :

```
fichiers dans shared/uploads (le poste local n'a qu'un .gitkeep)
  → media.adopt, exécuté SUR la destination
  → ProjectMedia LOCAL_ONLY, nom de fichier historique conservé
  → media.publish : empreinte vérifiée sur place, AUCUN transfert
  → PUBLISHED
```

Au retrait : `PUBLISHED → LOCAL_ONLY`.

Le healthcheck teste **l'URL réellement exposée** : une adresse absolue est
sondée sur son propre hôte ; seuls les chemins relatifs sont éprouvés contre
chaque origine servie.

---

## 7. Protection contractuelle — et son état, désormais PROJETÉ

`SiteStatus` reste la **source unique**, et elle vit ici. Ce qui a changé : le
Panel ne vient plus la LIRE, elle lui est POUSSÉE.

### Ce que le Panel faisait avant, et pourquoi c'était un défaut

Il interrogeait ce projet en direct, depuis l'écran, à chaque affichage de sa
carte. Ce n'était ni une commande, ni une projection : un troisième motif, et
le seul du produit. Projet éteint → « état inconnu ». Rien de persisté, rien de
daté. Et une commande du Panel ne pouvait qu'afficher ce qu'elle venait de
demander, au lieu de constater son effet.

### Le déclencheur, et pourquoi il est sur le MODÈLE

```
9 chemins de mutation (Manager, Panel/Bridge, abonnement, réconciliation,
bootstrap, outils de recette…)
        │
        ▼
reconcileSiteStatus()      ← l'entonnoir : les 3 seuls `site.save()` du dépôt
        │                     vivent dans `siteEnforcement.service.js`
        ▼
post('save') → notifyEntitySaved('SITE_STATUS', ['*'])
        ▼
syncTriggers → scheduleProjection('SITE_STATUS')
        ▼
PROJECT_SITE_STATUS → outbox durable → push immédiat → Panel
```

Le hook est posé sur le MODÈLE, pas dans `reconcileSiteStatus` : c'est la règle
du dépôt, et elle couvre TOUS les appelants — présents et futurs — sans qu'aucun
service n'ait à penser au pont.

### Un agrégat À PART, jamais fondu dans le contrat

`PROJECT_SITE_STATUS` publie le **verdict** et sa **cause** :

| Champ | Sens |
|---|---|
| `accessible`, `status` | le verdict, tel que ce projet le rend |
| `suspensionSource` | `NONE` · `TECHNICAL` · `CONTRACT` — la cause, nommée |
| `reason` | le motif, tel que nous le formulons |
| `contractProtectionEnabled` | le **réglage**, vrai même sans effet |
| `technicalSuspension` | la cause technique, publiée à part |

Une suspension **technique** n'est pas un fait contractuel. La transporter sous
`CONTRACT` ferait afficher « problème de contrat » devant une maintenance —
c'est pourquoi les deux agrégats ne fusionnent jamais.

### La table de vérité, inchangée

---

## 7bis. La table de vérité de la protection

`SiteStatus.contractProtectionEnabled` est la **source unique**, et elle vit
ici. Deux points de commande : le Manager, et le Panel via le pont.

| Protection | Contrat | Site |
|---|---|---|
| OFF | aucun | accessible |
| ON | aucun | suspendu `CONTRACT` |
| ON | `ACTIVE` | accessible |
| ON | `CANCEL_AT_PERIOD_END` | accessible |
| ON | terminé | suspendu `CONTRACT` |
| — | — | une suspension `TECHNICAL` est **toujours prioritaire** |

---

## 8. Ce que ce projet envoie au Panel, et quand

| Quoi | Quand |
|---|---|
| **battement** | périodiquement — preuve de vie |
| **photographie complète** | au démarrage (`reconcileAll`), à la reconnexion, à l'appairage |
| **projection ciblée** | à chaque modification métier surveillée |

La photographie est envoyée **à chaque démarrage du backend**, donc après
chaque déploiement. Une écriture sans changement métier ne produit rien : la
file est idempotente.

---

## 8bis. L'entreprise du Panel, et la page « Aide »

> **Le Panel enregistre ; ce projet converge ; « Aide » affiche.** Aucun geste
> n'est demandé de part et d'autre, et aucune requête ne part d'ici vers le
> Panel au moment de l'affichage.

```
Panel · Mon entreprise · [ Enregistrer ]     UN SEUL GESTE
        │  saveCompany = updateCompany + publishConfiguration
        │  → version figée + emitChange(DEV_COMPANY, audience: null)
        ↓
  journal de synchronisation du Panel
        ↓
  ├─► le PANEL LIVRE  ── POST /api/project-bridge/v1/sync/push ──┐
  │      ~35 ms après l'enregistrement, sans qu'on ait rien       │
  │      demandé (chemin NOMINAL depuis le lot L4)                │
  │                                                              ▼
  └─► runSyncCycle → PanelBridge.pullUpdates()   ← 30 s, RÉPARATION seule
        ↓                                          (projet éteint, Panel
        ↓                                           interrompu, réseau coupé)
  applyCompanyChange → applyCompanyProfile
        │   · refuse un environnement qui n'est pas le nôtre
        │   · refuse une version ANTÉRIEURE à celle déjà appliquée
        ↓
  PanelCompanyConfiguration { key: 'SINGLETON' }
        ↓
  GET /api/panel-connection/company  →  Manager · Aide
```

**Côté Panel, il n'y a qu'un bouton.** Ni « publier », ni « rediffuser », ni
« retry », ni « version à envoyer », ni « synchroniser ». `saveCompany` écrit
la fiche ET fige la version ET la diffuse. Le versionnement et l'idempotence
restent entiers — ce sont des mécanismes internes, pas des gestes d'écran.

**Si ce projet est hors ligne**, il garde la dernière valeur connue ; à son
retour, le rattrapage lui apporte **la plus récente**, sans rejouer les
versions intermédiaires et sans second enregistrement côté Panel. Un pull
rejoué deux fois ne duplique rien : le `writeId` est déjà appliqué.

### Livré ou tiré, c'est la même vérité

`POST /api/project-bridge/v1/sync/push` accepte une livraison du Panel ;
`runSyncCycle` va la chercher quand elle n'a pas pu arriver. Les deux chemins
appellent **les mêmes applicateurs** (`acknowledgePanelChanges` →
`applyPanelChange` → `applyCompanyChange`), avec les mêmes gardes :

| Garde | Ce qu'elle refuse |
|---|---|
| `emitter` | une écriture qui ne vient pas du Panel |
| type non livré | `ENTITY_TYPE_UNSUPPORTED` — refus propre, jamais un 500 |
| environnement | une configuration d'un autre monde (`ENVIRONMENT_MISMATCH`) |
| version | une configuration ANTÉRIEURE à celle déjà appliquée |
| `writeId` | une écriture déjà reconnue — livrée puis tirée ne mute qu'une fois |

**Le résultat ne dépend jamais de la façon dont la donnée est arrivée.** C'est
la propriété qui rend la livraison immédiate sûre : elle ne fait qu'avancer
l'horloge, elle ne crée aucun second comportement. Une écriture appliquée par
livraison puis revue au tirage est un non-événement — la garde de version
l'écarte, et il ne reste qu'un seul document.

→ `Panel/tests/panel-company-save-to-help-e2e.test.js`
  (`REAL_PANEL_COMPANY_SAVE_UPDATES_PROJECT_HELP_LIVE`)

### « Live » veut dire : le dernier état convergé

La page **n'interroge jamais le Panel**. Elle lit la copie locale, et c'est
délibéré : les coordonnées de l'agence doivent rester lisibles quand le Panel
est arrêté, en maintenance ou injoignable. Faire dépendre l'affichage d'un
numéro de téléphone de la disponibilité d'une autre machine serait un défaut,
pas une fraîcheur.

### Qui peut la lire

`GET /api/panel-connection/company` demande une **session**, pas le rôle DEV.
La page « Aide » est proposée à tous les rôles ; elle lisait pourtant
`/panel-connection/status`, réservée aux comptes DEV — un client y récoltait un
403 que l'écran traduisait par « ce projet n'est relié à aucun Panel », juste
là où il venait chercher le téléphone de son agence.

Cette route ne sert que la copie d'entreprise : ni URL du Panel, ni appairage,
ni inventaire d'API, ni ordonnanceur.

### Les versions ne sont pas un état métier

`PanelCompanyConfiguration.version` sert à écarter une écriture périmée et à
déclarer notre convergence au Panel (`Identity.appliedConfiguration`). Elle
n'est **pas** un statut de publication : aucun écran n'attend qu'une entreprise
soit « publiée », et le mot a disparu de la page « Aide » avec le geste qu'il
désignait.

### L'isolation TEST / PROD

```
Panel TEST  ↔  ce projet en TEST
Panel PROD  ↔  ce projet en PROD
```

`applyCompanyProfile` refuse une configuration dont l'`environment` diffère du
nôtre — mentions légales, domaines et contacts réels s'afficheraient sinon sur
un site de recette. La garde est locale : on ne s'en remet pas au Panel seul.

→ `backend/src/services/panelConfiguration/panelConfiguration.service.js`
→ `backend/src/controllers/panelBridge.controller.js` (`company`)
→ `manager/src/pages/SupportInfoPage.tsx`

---

## 8ter. Quand ce projet réémet sa photographie

Le Panel n'interroge pas ce projet : il reçoit ce qu'il pousse. La règle est
générique et ne connaît aucun formulaire.

```
mutation métier → post(save) du MODÈLE → notifyEntitySaved(kind, chemins)
   ↓  syncTriggers : un chemin SURVEILLÉ a-t-il bougé ?
scheduleProjection(PROJECT_PRESENTATION | CONTRACT)   (rafales regroupées)
   ↓  outbox DURABLE (writeId déterministe, survit au redémarrage)
push Bridge → le Panel projette
```

| Modèle | Chemins surveillés | Projection |
|---|---|---|
| `Company` | `name`, `tagline`, `logos`, `media` | `PROJECT_PRESENTATION` |
| `SystemConfiguration` | `network` | `PROJECT_PRESENTATION` |
| `Contract` | statut, référence, activation, tarifs, document, signature… | `CONTRACT` |
| `User` (équipe) | par membre | `TEAM_MEMBER` |

**La règle qui évite la prochaine panne : tout champ LU par une projection**
**doit être SURVEILLÉ par son déclencheur.** Un test compare les deux listes.

### Le chemin complet, jusqu'à l'écran d'en face

Il a longtemps été vérifié par morceaux. Il l'est désormais d'un bout à
l'autre, avec deux backends réels et un vrai `Company.save()` :

```
ICI                                        PANEL
Company.name = « SB Auto 07 »
company.save()
  └─ post('save')
     └─ notifyEntitySaved('COMPANY', ['name'])
        └─ syncTriggers  (COMPANY_PATHS)
           └─ scheduleProjection            regroupement 500 ms
              └─ outbox durable
                 └─ runPushCycle
                    └─ flushOutbox ─ HTTP ─►  applyIncoming
                                               └─ PanelProjectPresentation
                                                  (indexée par projectId)
                                               └─ lastBusinessSyncAt
                                               └─ GET /api/projects/:projectId
                                                  └─ l'écran ouvert change
```

Aucun geste humain entre les deux bouts : ni bouton « Synchroniser », ni
rafraîchissement de page, ni réappairage, ni publication manuelle. Du point de
vue de l'utilisateur du Manager, **enregistrer suffit**.

#### `runPushCycle`, et pourquoi ce n'était pas `runSyncCycle`

La poussée immédiate appelait `runSyncCycle()` — le cycle COMPLET
(push + pull), **gardé contre le chevauchement**. Quand le tic périodique
tournait au moment de l'enregistrement — c'est-à-dire pendant tout le temps
d'un aller-retour réseau, à chaque intervalle — la poussée immédiate était
**sautée, en silence**.

Rien n'était perdu : l'outbox est durable, et la modification partait au tic
suivant. Mais « au tic suivant » valait jusqu'à deux minutes, de façon
intermittente. C'est très exactement le symptôme « le Panel reste sur l'ancien
nom » : irreproductible à la demande, donc jamais attrapé.

`runPushCycle` a **sa propre garde** et **mémorise les demandes arrivées en
vol** : la poussée en cours revisite la file avant de se terminer. La file est
donc toujours relue APRÈS la dernière mise en file, quel que soit
l'entrelacement. Elle ne fait que POUSSER — un enregistrement local n'a aucune
raison de déclencher une lecture descendante, et séparer les deux garde chaque
panne dans son couloir.

→ `backend/src/services/panelBridge/bridgeScheduler.js` (`runPushCycle`)
→ `backend/src/scripts/panel-push-liveness.test.js`
  (`IMMEDIATE_PUSH_IS_NEVER_STARVED`)

#### Le harnais câble EXACTEMENT ce que le bootstrap câble

Le harnais de recette du Panel démarre de vraies instances de ce backend
(`Panel/tests/helpers/sbauto-instance.mjs`). Il appelait `flushOutbox()` en
direct, là où la production passait par le cycle gardé : le harnais poussait
**toujours**, la production **parfois**. Le test était vert et le produit
intermittent — la divergence de câblage ÉTAIT le défaut.

Les deux passent désormais par `runPushCycle`. Toute divergence future entre
le harnais et `config/bootstrap.js` doit être traitée comme un défaut, pas
comme une commodité de test.

#### Ce qui manquait encore : le Panel REFUSAIT ce qu'on lui envoyait

`runPushCycle` a bien supprimé l'attente du tic — mesuré : **~550 ms** du
`save()` à la fiche du Panel, y compris sous cycle périodique concurrent. Le
symptôme « le Panel reste sur l'ancien nom » persistait pourtant sur les
instances déployées, pour une raison entièrement différente.

`describeProjectPresentation` publie, à côté des adresses, le **descripteur
complet** des médias :

```js
...(logo ? { logo } : {}),
...(favicon ? { favicon } : {}),
```

Le schéma du Panel est **fermé** et ne connaissait que `logoUrl` /
`faviconUrl`. Toute instance ayant un logo — donc toute production — voyait sa
présentation refusée (`ENTITY_PAYLOAD_INVALID`), l'écriture sortait de la file,
et **rien ne la rejouait jamais**. Une instance de recette, elle, n'a pas de
logo : les tests étaient verts.

| Doctrine média | Règle |
|---|---|
| autorité | `logo` / `favicon` font foi. `logoUrl` / `faviconUrl` sont leur projection **héritée**, gardée pour un Panel antérieur. |
| adresse | publiée **seulement si absolue et joignable** — sinon le champ est omis. C'est déjà ce que font `resolvePublicAssetUrl` et `publishableProjectDescriptor` ; un test le verrouille désormais. |
| contrat | `ProjectPresentationPayload` et `MediaDescriptor` sont écrits dans `docs/panelXvitrine/spec/PanelBridge.openapi.yaml`. **Un payload qui circule s'écrit dans le contrat**, sinon les deux côtés divergent en silence. |

#### Un refus est conservé, classé, publié — et réaffirmé

`acknowledge` traitait un refus comme une réussite : même `acknowledgedAt`, donc
même index TTL. File vide, compteur à zéro, aucune alerte, donnée perdue.

`services/panelBridge/rejectionPolicy.js` classe désormais chaque issue :

| Classe | Exemples | Cadence de réaffirmation |
|---|---|---|
| `TRANSIENT` | Panel injoignable, timeout | 15 s → 1 h (backoff transport) |
| `COMPATIBILITY` | payload/type/contrat refusé | 5 min → 6 h |
| `SECURITY` | environnement, jeton, appairage | 1 h → 24 h |
| `BUSINESS` | refus de fond | 5 min → 6 h |
| `IDEMPOTENT` | `APPLIED`/`DUPLICATE`/`IGNORED` | — (résolu) |

L'entrée d'outbox **est** le dossier d'incident (`failureClass`,
`lastErrorCode`, `firstRejectedAt`, `rejections`) : aucun modèle nouveau. Elle
ne porte `acknowledgedAt` qu'à la RÉSOLUTION — un refus ne s'efface donc jamais
tant qu'il n'est pas réparé.

**La réparation ne demande rien à personne.** `reviveDueRejections()` est
appelée au début de chaque vidange : le cycle périodique retrouve ici son rôle
légitime — réparer, jamais livrer. Le destinataire corrigé applique l'écriture
réaffirmée, et le dossier se ferme. Aucun bouton, aucun réenregistrement.

L'état est publié dans `bridgeStats` du battement (`rejectedCount`,
`oldestRejection`) : le Panel peut enfin distinguer « connectée » de
« convergée ». L'écran DEV « Connexion Panel » le montre aussi, en une ligne, et
seulement s'il y a un refus ouvert.

→ `Panel/tests/project-presentation-media-contract-e2e.test.js`
→ `Panel/tests/payload-drift.check.mjs`

#### Les cadences, et ce qu'elles couvrent

| Boucle | Défaut | Ce qu'elle garantit |
|---|---|---|
| poussée immédiate | à chaque enregistrement | la modification part **tout de suite** |
| heartbeat | `PANEL_HEARTBEAT_INTERVAL_S` = 60 s | le Panel sait que l'instance vit |
| cycle de synchronisation | `PANEL_SYNC_INTERVAL_S` = **30 s** | rattrapage descendant + filet de sécurité montant |

`PANEL_SYNC_INTERVAL_S` valait 120 s. Ce cycle porte le **rattrapage
descendant** — c'est lui, et lui seul, qui va chercher au Panel une
configuration d'entreprise fraîchement enregistrée. À deux minutes, on modifie
« Mon entreprise » dans le Panel, on ouvre la page Aide, et on y lit
l'ancienne valeur. La synchronisation n'était pas cassée : elle était lente au
point de ne plus se voir.

L'ordonnanceur est **toujours configuré**, même quand il ne tourne pas
(`PANEL_SCHEDULER_ENABLED=false`) : les cycles restent déclenchables à la main
depuis le Manager. Couper la cadence ne doit pas couper la commande.

### Ce que le Panel constate, et ce que ce projet affirme

Deux dates, et elles ne doivent jamais fusionner :

| Date | Qui la pose | Ce qu'elle dit |
|---|---|---|
| `sourceModifiedAt` | **ce projet** | quand il affirme avoir modifié. C'est elle qui arbitre le dernier-écrit-gagne. |
| `lastBusinessSyncAt` | **le Panel** | quand il a réellement reçu et appliqué. Son constat. |

```
Projet modifié à      14:31:02
Reçu par le Panel à   14:31:04
```

Le battement de cœur de ce projet n'avance **pas** la seconde : il prouve
qu'on répond, pas qu'on a livré quelque chose. Un projet qui bat depuis trois
jours sans avoir rien projeté a une fiche vivante et une fraîcheur métier
nulle — c'est un état normal, et le Panel l'écrit tel quel.

Aucun service métier n'appelle le pont : les hooks vivent dans les modèles,
la décision dans `syncTriggers`, l'envoi dans l'outbox. Une sauvegarde ne
peut donc pas échouer parce que le Panel est absent — et rien n'est perdu.

---

## 9. Les sources de vérité

| Question | Qui répond | Jamais |
|---|---|---|
| Quel environnement ? | `ENV`, déclaré | un nom de domaine |
| Quel Panel ? | `PANEL_URL` **+ concordance d'`ENV`** | l'URL seule |
| Où sont mes médias ? | la destination ACTIVE | une URL figée en fiche |
| Qui détient ce média ? | `authority` | l'hôte ou la clé d'objet |
| Ce serveur est-il vide ? | l'inspection | l'absence de `currentVersion` |
| Le site est-il suspendu ? | `SiteStatus` | une déduction depuis le contrat |
| Quelle fiche du Panel décrit cette instance ? | le `projectId` de CET appairage | `projectKey`, qui n'est qu'un anti-collision |
| Que voit le Panel de mon état métier ? | ce que **j'ai poussé** (projections) | le manifeste, figé à l'appairage |
| Quand le Panel l'a-t-il reçu ? | `lastBusinessSyncAt`, **son** constat | mon `sourceModifiedAt`, qui n'est que ma parole |

---

## 9bis. La frontière du pont, et le rôle de dépôt maître

### Le pont ne connaît ni le métier ni la configuration

`services/panelBridge/` n'importe que : lui-même, `node:`, `zod`, le logger.
Son répertoire `persistence/` ajoute exactement deux modèles (appairage,
outbox) et la crypto applicative. Rien d'autre — et `bridge-conformity`
échoue si un import s'y ajoute.

**L'environnement y entre par injection.** L'adaptateur d'outbox lisait
`config/env.js` pour semer ses `writeId`. Il reçoit désormais sa génération
du bootstrap :

```js
createMongoOutboxAdapter({ generation: config.env })
```

Et son absence est **fatale**, pas repliée sur une valeur neutre : deux mondes
qui partagent la même graine dérivent le même `writeId` pour des données
différentes, et le Panel répond « doublon » sans rien appliquer. On refuse
d'écrire plutôt que d'écrire faux.

### Le seul transport sortant

`PanelClient.js` est le seul fichier du module autorisé à parler HTTP au
Panel. Une exception hors module, légitime et nommée : la sonde de santé
publique du plan de contrôle (`deploymentControlPlane.controller.js`), qui
interroge les `/health` de **nos propres destinations déployées** — ce n'est
pas du trafic de pont.

### Ce dépôt est le MAÎTRE des contrats et du moteur

| Artefact | Maître | Miroir |
|---|---|---|
| `docs/panelXvitrine/spec/*.openapi.yaml` | **ici** | `Panel/docs/spec/` |
| cœur `deployment-engine` / `duplication-engine` | **ici** | `Panel/backend/src/` |

Un code d'erreur du contrat s'ajoute donc **ici d'abord**, dans le catalogue
fermé de `bridgeErrors.js` ET dans les specs, puis se recopie verbatim côté
Panel. `BRIDGE_ENVIRONMENT_MISMATCH` manquait au catalogue : le Panel le
renvoyait déjà sur le fil, et ce côté-ci ne savait pas le typer.

---

## 10. Diagnostic d'un déploiement

Tout run laisse une trace persistante : `DeploymentAttempt`, journal du
`DeploymentRun` (HTTP, SSH, PM2, sockets, redémarrage attendu, finalisation),
et un rapport copiable.

Invariants :

- un redémarrage attendu **ne clôt pas** le déploiement qu'il traverse ;
- « en ligne » n'est pas « écoute » : on relit les sockets réelles ;
- la finalisation est **écrite avant** d'être vérifiée ;
- un préflight muet ne reste pas en attente indéfiniment.

---

## Médias : la politique d'import, et la limite qui manquait

> **UNE politique par type de média. UN plafond de transport. UNE ligne dans le
> vhost.** Les trois vivaient séparément, et ne se sont jamais rencontrées.

### Le défaut, tel qu'il s'est produit

Remplacer un logo rendait `413 Payload Too Large` sur une instance déployée, et
`MulterError: File too large` sur le Panel. Deux symptômes, **deux causes
différentes** :

| Couche | Limite avant | Qui refusait |
|---|---|---|
| frontend | aucune | — |
| `multer` | 12 Mo, en dur | le Panel (fichier > 12 Mo) |
| **vhost Nginx** | **jamais émis → défaut 1 Mo** | **l'instance déployée** |

`client_max_body_size` n'était écrit nulle part. Nginx appliquait donc 1 Mo,
alors que l'application acceptait 12 Mo : **un écart de 12×**. Un logo de 3 Mo
passait en local et repartait en 413 une fois déployé — et le refus venait du
serveur web, donc sans code métier, sans message utile, sans trace applicative.

### Ce qui décide désormais

```
mediaPolicy.js          par type : octets acceptés, largeur, format de sortie
   │
   ├─► multer            plafond = le maximum de la table
   ├─► validateImage     refus PAR TYPE, sur les octets décodés
   └─► project.profile   HTTP_MAX_BODY_MB → client_max_body_size du vhost
```

`multer` coupe le flux **avant** que le corps ne soit lu : à cet instant, le
type de média est encore inconnu. On laisse donc entrer jusqu'au plafond, puis
on refuse par type — avec la bonne limite dans le message. L'inverse produirait
une coupure muette sur un fichier parfaitement légitime pour son usage.

### Le format se lit dans les octets

`file.mimetype` est **déclaré** par le navigateur d'après l'extension : il ne
mesure rien. Un fichier renommé le franchissait, et `sharp` échouait ensuite en
exception non typée — rendue à l'écran comme une panne. On décode donc
l'en-tête : ce que `sharp` lit est une image, ce qu'il ne lit pas n'en est pas
une. Les **dimensions** sont bornées séparément : une image de 40 Ko peut
déclarer 60 000 px de côté et réclamer des gigaoctets à la décompression.

### Un refus attendu n'est pas une panne

| Code | HTTP | Quand |
|---|---|---|
| `MEDIA_TOO_LARGE` | **413** | au-delà de la limite du type — la limite est dans `details.maxBytes` |
| `MEDIA_TYPE_UNSUPPORTED` | 415 | format d'image non pris en charge |
| `MEDIA_INVALID` | 400 | illisible, vide, corrompu, ou pas une image |
| `MEDIA_DIMENSIONS_EXCEEDED` | 400 | trop de pixels de côté |

Aucun ne s'affiche « Erreur interne ». Un utilisateur ne peut rien faire d'une
panne ; il peut réduire une image — encore faut-il lui dire de combien.

### Remplacer un logo ne le perd jamais

L'ordre est **importer, puis remplacer la référence** — jamais supprimer
d'abord. Un import qui échoue laisse donc le logo en place, ce qui compte
d'autant plus depuis qu'on refuse proprement les fichiers trop gros.

### Enregistré ≠ publié

Un média enregistré sur une instance **sans destination active** reste
parfaitement valide : il est stocké, décrit, daté. Il n'est simplement servi
par aucune adresse publique — et l'écran le dit. Faire dépendre l'enregistrement
d'une publication interdirait de configurer une instance avant sa première mise
en ligne, c'est-à-dire dans l'ordre naturel des choses.

### Le contrôle qui manquait

`MEDIA_UPLOAD_LIMITS_DO_NOT_DIVERGE` compare la politique au profil de
déploiement, **et rend le vhost pour y chercher la directive**. Une constante
bien définie mais jamais écrite dans la configuration est exactement la
situation qu'on répare : il ne suffit pas qu'elle existe, il faut qu'elle
arrive jusqu'à Nginx.

---

## SYNC MÉTIER ≠ LIVE UI — deux mécanismes, deux garanties

> **Le premier fait converger deux systèmes. Le second ne fait que rafraîchir
> une vue locale. Les confondre coûterait la fiabilité du premier.**

### Ce qui manquait, et où

Le protocole descendant fonctionnait déjà : le Panel enregistre, livre (lot L4),
et ce backend persiste en quelques dizaines de millisecondes. Mais un Manager
**déjà ouvert** ne l'apprenait jamais — `useResource` charge une fois, au
montage, et ne revalide pas. La page « Aide » affichait l'ancien numéro de
téléphone jusqu'au rechargement, précisément là où le client vient le chercher.

Le dernier maillon manquait. Il en manquait **un seul**.

```
Panel save
  └─ journal durable ──► push L4 ──► applyCompanyProfile
                                       └─ PanelCompanyConfiguration.save()
                                            └─ notifyResourceChanged('panel-company')
                                                 └─ GET /api/live/events (NDJSON)
                                                      └─ le Manager invalide
                                                           └─ GET /api/panel-connection/company
                                                                └─ l'écran change
```

Mesuré : **60–124 ms** entre la persistance et la valeur relue par le client.

### Ce que le canal transporte, et ce qu'il ne transportera jamais

| | |
|---|---|
| transporte | le **nom** d'une ressource qui a changé |
| ne transporte pas | l'objet métier, un identifiant, un secret |

L'événement est `{ type: 'resource.changed', resource: 'panel-company' }`. Le
navigateur, prévenu, **redemande la donnée à sa propre API** — qui reste
l'unique source de vérité. Faire voyager l'objet dans le flux en ferait une
seconde vérité, affichable sans avoir été demandée, et soumise à des règles
d'autorisation différentes de celles de l'API.

Table **fermée** : `panel-company`, `site-status`, `contract`. Un scope par vue
réellement servie, jamais un type par champ.

### La règle qui gouverne tout le reste

> **FLUX PERDU ≠ DONNÉE PERDUE.**

Le flux tombe, le backend redémarre, personne n'écoute : la donnée est déjà
persistée, et un rechargement la montre. Le canal évite d'avoir à recharger —
il n'en est jamais la condition. C'est pourquoi il peut se permettre d'être
simple, et pourquoi aucun échec de sa part ne remonte vers une écriture métier.

### Émission APRÈS persistance, jamais avant

Notifier avant l'écriture ouvrirait une fenêtre où le navigateur redemande la
donnée et reçoit l'**ancienne** — puis ne redemande plus jamais, puisqu'il a
déjà été prévenu. L'écran resterait périmé sans que rien ne le signale.

Deux points d'émission, tous deux placés après un `save()` réussi :

| Ressource | Point d'émission |
|---|---|
| `panel-company` | `applyCompanyProfile`, après l'écriture de la configuration |
| `site-status` | `reconcileSiteStatus`, après `site.save()` — l'entonnoir des 9 chemins |

### Pourquoi NDJSON, et pas `EventSource`

`EventSource` ne porte pas d'en-tête `Authorization`, et le jeton n'a rien à
faire dans une URL : il finirait dans les journaux d'accès, l'historique du
navigateur et les référents. Ce dépôt possède déjà la bonne primitive — un flux
NDJSON lu par `fetch` + reader, utilisé pour la progression des déploiements.
On la réutilise plutôt que d'introduire un second style de flux, un second
client, et un second endroit où corriger un défaut de reconnexion.

`X-Accel-Buffering: no` accompagne le flux : sans lui, Nginx tamponnerait la
réponse et ne livrerait rien une fois déployé — exactement le genre d'écart
local/production que les limites d'upload viennent de coûter.

### Un seul canal, quel que soit le nombre d'écrans

Le canal vit au niveau du module (`liveInvalidation.ts`), pas dans les pages :
un flux par écran ouvrirait autant de connexions longues que de pages visitées.
Il s'ouvre au **premier abonné** — une application dont aucune page ne consomme
de ressource live n'ouvre aucune connexion — et se reconnecte avec un délai
borné (1 s → 30 s). Un `401` l'arrête : réessayer sur un refus certain n'aurait
aucun sens.

Plusieurs onglets ouvrent chacun leur flux ; tous sont prévenus.

### Trois états, à ne pas confondre avec trois autres

| Le canal UI | Le pont |
|---|---|
| `CONNECTED` / `RECONNECTING` / `DISCONNECTED` | appairé, vivant, fraîcheur métier |

Le premier dit si **cet onglet** sera prévenu. Le second dit si **l'instance**
converge avec le Panel. Un canal coupé n'a aucune conséquence sur la
convergence ; un pont coupé n'empêche pas le canal de fonctionner.

→ `backend/src/services/uiLive/uiLive.service.js`
→ `manager/src/lib/liveInvalidation.ts`
→ `Panel/tests/manager-live-ui-e2e.test.js`

---

## Résiliation immédiate : une exception administrative, pas une doctrine

> **La production n'interdit pas une correction immédiate par un développeur
> autorisé. Mais cette capacité ne change RIEN aux règles de résiliation des
> utilisateurs métier.**

### La garde d'avant, et pourquoi elle était mal posée

```js
// cancelImmediatelyInTest
if (!config.isTest) throw ApiError.forbidden('… réservée à l'environnement TEST.');
```

L'autorisation était adossée à l'**environnement** — une propriété du monde, qui
ne dit rien des droits de celui qui agit. Un contrat créé ou configuré par
erreur en production devait donc attendre son échéance, et la garde empêchait
précisément la personne chargée de le corriger.

### Ce qui la remplace

La condition est devenue une **permission** : `role === DEV`. Ce n'est pas
« en PROD, on autorise » — c'est « un DEV autorisé peut corriger, où qu'il
soit ». La nuance est ce qui empêche l'exception de devenir une porte ouverte.

| Acteur | TEST | PROD |
|---|---|---|
| **DEV** | immédiat ✅ | **immédiat ✅** |
| ADMIN | doctrine inchangée (échéance) | doctrine inchangée (échéance) |
| sans acteur | refus | refus |

Deux verbes distincts, et c'est délibéré :

| Route | Sens |
|---|---|
| `POST /contracts/:id/cancel` | « je résilie ce contrat » — doctrine ordinaire, **intacte** |
| `POST /contracts/:id/cancel-immediately` | « je corrige un contrat qui n'aurait pas dû exister » |

Les fondre ferait dépendre l'effet d'un drapeau, et un drapeau finit toujours
par être envoyé par erreur.

### La garde vit dans le SERVICE

Le routeur est déjà sous `authorize(ROLES.DEV)`, et `cancelContractImmediately`
revérifie. Un contrôle qui ne vivrait que dans la route ne protégerait que ce
qui passe par la route — masquer un bouton ne protège rien.

### Idempotence

Un contrat déjà terminé n'est pas une erreur : c'est l'état voulu. Le service
répond de façon stable (`alreadyEnded: true`) sans seconde annulation Stripe,
sans second événement, sans seconde écriture d'audit, et sans transition d'état
interdite.

### Les conséquences, sans geste supplémentaire

```
cancelContractImmediately
  └─ audit administratif (acteur · environnement · statut précédent · motif)
  └─ performImmediateCancellation
       └─ annulation Stripe (best-effort)
       └─ settleFromSubscription → ENDED
            └─ post('save') Contract → projection CONTRACT → Panel
            └─ reconcileSiteStatus()
                 └─ post('save') SiteStatus → PROJECT_SITE_STATUS → Panel
```

Et les deux cas sont éprouvés, parce qu'un seul ne prouverait rien :

| Protection | Résultat sur la vitrine |
|---|---|
| **ON** | site **suspendu**, `suspensionSource: CONTRACT` |
| **OFF** | site **reste actif** — aucun contrat ne le suspend |
| suspension TECHNIQUE en cours | **reste TECHNICAL**, jamais requalifiée en contractuelle |

### La confirmation, en production

Le bouton n'est rendu qu'aux comptes DEV, et hors recette. La fenêtre nomme
l'effet (« prend fin immédiatement »), l'**environnement** et la **référence du
contrat** : trois informations qui rendent une erreur de cible visible AVANT le
clic. Un bouton rouge seul se clique par réflexe.

→ `backend/src/services/contract.service.js` (`cancelContractImmediately`)
→ `backend/src/scripts/contract-immediate-cancel.test.js`

---

## SYNCHRONISATION PANEL ↔ PROJET — le document canonique

L'architecture complète de la synchronisation vit dans **un seul document**,
identique dans les deux dépôts et vérifié octet pour octet par `spec-drift` :

> **[`docs/SYNCHRONISATION_PANEL_PROJET.md`](SYNCHRONISATION_PANEL_PROJET.md)**

Il couvre la cardinalité (`1 fiche = 1 instance = 1 appairage = 1 destination`),
les deux sens de synchronisation maillon par maillon, la distinction entre
synchronisation MÉTIER et invalidation d'INTERFACE, les trois horodatages qu'on
ne doit jamais confondre (`lastHeartbeatAt`, `lastBusinessSyncAt`,
`sourceModifiedAt`), commande ≠ projection confirmée, connexion ≠ vitrine, les
médias, la classification des incidents, l'ordre d'extinction, et un **playbook
de diagnostic** qui permet de localiser une panne sans deviner.

Ne pas décrire ces mécanismes ailleurs : deux descriptions d'un même système
divergent toujours, et la divergence est invisible — chacun lit la sienne.
