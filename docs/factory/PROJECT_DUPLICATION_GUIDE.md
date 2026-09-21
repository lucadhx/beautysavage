# Fabriquer un projet client — guide officiel

> **Document d'autorité.** Il décrit la procédure complète, de la duplication au
> projet en ligne et pairé. Il est écrit à partir d'une fabrication RÉELLE — le
> premier projet client produit par cette fabrique — et de la correction de tous
> les freins qu'elle a révélés. Chaque avertissement de ce document correspond à
> une panne qui a eu lieu.
>
> **Règle de maintenance :** toute modification du moteur de duplication, du
> moteur de déploiement ou de la chaîne d'appairage met ce document à jour dans
> le MÊME lot. Un guide périmé coûte plus cher qu'un guide absent : on le suit.

**Compagnon opérationnel :** [PROJECT_DUPLICATION_CHECKLIST.md](PROJECT_DUPLICATION_CHECKLIST.md)
— la même procédure en cases à cocher, à garder ouverte pendant la fabrication.

---

## 0. L'ordre, et pourquoi il n'est pas négociable

```
1. PRÉREQUIS       informations client, accès au dépôt
2. DONNÉES         logos, catalogue, coordonnées
3. DUPLIQUER       moteur officiel — bases, copie, identité, propreté
4. CONFIGURER      .env de la copie : Panel, adresse publique
5. DÉCLARER        le projet au Panel, AVEC SON DOMAINE
6. RÉSEAU          les trois URL publiques, AVANT le déploiement
7. DÉMARRER        le projet s'appaire seul
8. IMPORTER        les données du client, une fois
9. DÉPLOYER        DNS, TLS, Nginx, PM2 — automatique
10. ACTIVER        le premier compte DEV
11. RECETTE        la checklist courte, obligatoire
```

Trois dépendances d'ordre, et chacune a coûté une panne :

- **5 avant 9.** Le DNS automatique passe par la capacité `dns.*` du Panel, qui
  n'écrit un enregistrement que pour un nom **appartenant au projet**.
  L'appartenance se lit sur la destination active, créée à la déclaration.
- **6 avant 9.** La destination active est ANNONCÉE PAR LE PROJET d'après sa
  configuration réseau. Un projet démarré en local qui n'annonce que
  `localhost` se voit refuser son propre domaine —
  `CAPABILITY_RESOURCE_NOT_OWNED` — et le DNS redevient manuel. C'est
  exactement ce qui est arrivé au premier projet.
- **7 avant 9.** Le jeton de pont obtenu à l'appairage est ce qui autorise à
  demander la capacité DNS.

---

## 1. Prérequis

### 1.1 Informations à réunir AVANT de commencer

| Information | Exemple | Qui la fournit |
|---|---|---|
| Nom du projet | `Garage Dupont` | vous |
| Slug technique | *dérivé du nom* — `garage-dupont` | le moteur |
| Dépôt GitHub | `https://github.com/compte/garage-dupont.git` | vous, créé à l'avance |
| Base TEST | `garage_dupont_test` | vous |
| Base PROD | `garage_dupont_prod` | vous |
| Domaine du site (TEST) | `demo-garage-dupont.ly-solution.com` | vous |
| Adresse du premier développeur | `dev@agence.fr` | vous — c'est VOUS |
| Adresse du premier administrateur | `contact@garage-dupont.fr` | le client |
| Mot de passe du premier administrateur | *choisi pour ce projet* | vous, remis au client |

Le **slug** n'est pas saisi : le moteur le dérive du nom, et il préfixe les
processus PM2, les dossiers de staging, la racine de sauvegarde
(`/var/backups/<slug>`) et l'identité annoncée à `/api/version`. Un champ de plus
à saisir serait un champ de plus à saisir faux.

### 1.2 Prérequis EXTERNE : le dépôt GitHub

**Le compte Git de la machine qui exécute doit avoir le droit de pousser sur le
dépôt cible.** Ce n'est pas une propriété du produit et la fabrique ne peut rien
y faire : GitHub refuse, et il a raison.

Vérifiez AVANT de commencer :

```bash
git ls-remote https://github.com/compte/garage-dupont.git
```

Une erreur `403 / Permission to … denied to <compte>` signifie que le compte
authentifié sur cette machine n'est pas celui qui possède le dépôt, ou n'y est
pas collaborateur. Réglez-le côté GitHub — ajout en collaborateur, ou
authentification avec le bon compte. **Il n'existe aucun contournement, et il ne
doit pas en exister.**

### 1.3 Prérequis techniques

- MongoDB joignable (`MONGODB_URI` du projet source) ;
- accès SSH au serveur de destination — le mot de passe vit dans le plan de
  contrôle (`Panel/backend/.env`, `VPS_PASS`), **jamais** dans le `.env` d'un
  projet ;
- un Panel joignable et un compte DEV qui peut y déclarer un projet.

### 1.4 Le cluster a une limite, et chaque projet la consomme

> **Vérifiez-le AVANT de dupliquer.** Cette limite a été atteinte en fabriquant
> les fixtures de certification — 501 collections sur 500 — et un projet réel a
> alors échoué à démarrer sur `cannot create a new collection`, pour une raison
> qui n'avait rien à voir avec lui.

Un projet coûte **50 à 70 collections par base exercée** — mesuré sur le parc
réel — soit une centaine à cent cinquante pour une recette **et** une production.
La place, pas le disque, est ce qui borne le parc : les bases de ce cluster
pèsent quelques dizaines de méga-octets, et la limite arrive bien avant.

Ne l'estimez pas de tête : le préflight le mesure.

```bash
# Depuis le dépôt de la fabrique
npm run mongo:capacity --prefix backend
```

Il rend l'occupation base par base, puis :

```
CURRENT_COLLECTIONS                  261
ALLOWANCE (déclarée)                 500
FREE_COLLECTION_SLOTS                239

ESTIMATION (observée sur 3 projet(s) — ce n'est PAS une garantie)
  projet typique : ~55 collections/base → ~110 par projet
  projet mûr     : ~71 collections/base → ~142 par projet
  ESTIMATED_NEW_PROJECT_CAPACITY : 1 à 2 projet(s)
```

**La limite n'est PAS lisible depuis le cluster.** Atlas refuse `hostInfo` et
`getParameter` sur les paliers partagés ; `buildInfo` ne parle que de la taille
d'un document. C'est donc une **vérification opérateur** : lisez ce que votre
offre autorise dans la console Atlas, et déclarez-le une fois pour toutes —

```
MONGO_COLLECTION_ALLOWANCE=500
```

Sans cette déclaration le préflight rend l'occupation et s'arrête là : il ne
suppose aucun plafond. **Ne codez pas `500` en dur ailleurs** — c'est la valeur
d'une offre, pas une loi ; elle changera avant ce guide.

Le coût par projet est une **estimation mesurée sur le parc réel**, pas une
garantie : un projet jeune n'a pas encore créé toutes ses collections, un projet
ancien en porte davantage. La fourchette est là pour être lue en entier.

Le préflight sort en `1` si la marge passe sous le coût d'un projet typique — de
quoi le brancher devant une duplication automatisée.

Si la marge est courte : purgez les bases d'expériences abandonnées **après
avoir vérifié qu'aucun dossier de projet ne les utilise encore**, ou passez sur
un cluster de palier supérieur. Ne supprimez jamais une base au jugé — un projet
local qui ne tourne pas aujourd'hui tournera peut-être demain.

**Les fixtures de certification, elles, ne touchent pas au cluster** : elles
tournent sur une base éphémère en mémoire (voir §14).

---

## 2. Préparer les données du client

Rassemblez, hors du dépôt, dans un dossier de travail :

```
projets/data/<client>/
├── Logo.png            logo principal — voir la note ci-dessous
├── Favicon.png         idéalement carré, fond plein
├── banniere.png        image d'accueil (hero)
└── <fiche client>.pdf  identité, coordonnées, horaires, catalogue, tarifs
```

**Sur les logos.** Un logo exporté « carré » dont le dessin n'occupe que le
centre s'affichera minuscule : l'autorité média respecte le ratio du fichier, et
le header contraint la hauteur. Sur le premier projet, le logo faisait
1 254 × 1 254 pour un dessin de 872 × 284 — 84 % de marge transparente. Détourez
le logo avant import, ou faites-le dans le script d'import.

Ces fichiers **ne rejoignent pas le dépôt** : ils entrent par l'autorité média du
projet (§8).

---

## 3. Dupliquer

### 3.1 La commande officielle

Depuis le **projet source** :

```bash
cd backend
FIRST_ADMIN_PASSWORD='<mot de passe du client>' npm run duplicate -- \
  --name "Garage Dupont" \
  --db-test garage_dupont_test \
  --db-prod garage_dupont_prod \
  --repo https://github.com/compte/garage-dupont.git \
  --dev-email dev@agence.fr --dev-name "Camille Dupont" \
  --admin-email contact@garage-dupont.fr
```

Le mot de passe passe par l'**environnement**, jamais en argument : une ligne de
commande finit dans l'historique du shell et dans la sortie de `ps`.

L'assistant « Dupliquer » du Manager fait exactement la même chose, par le même
moteur. Les deux portes sont équivalentes.

Deux introspections, sans aucune écriture :

```bash
npm run duplicate:phases    # ce qui va se passer, dans l'ordre
npm run duplicate:policy    # ce qui sera copié, vidé, ignoré, régénéré
```

### 3.2 Ce que le moteur fait — et ne fait pas

| Phase | Ce qu'elle fait |
|---|---|
| `mongo` | vérifie la connexion au cluster |
| `databases` | crée TEST et PROD si absentes, puis **relit** pour le prouver |
| `first_admin` | crée le compte ADMIN du client, **bloquant** |
| `copy` | copie le dossier selon le registre d'arborescence |
| `config` | réécrit le `.env` **et toute l'identité** |
| `cleanliness` | **relit la copie** : dossiers vierges, identité reprise |
| `discover` · `dependencies` · `validate` | sous-projets Node, `npm ci`, contrôle |

**Ce qui est régénéré :** `JWT_SECRET`, `INTEGRATED_API_ENCRYPTION_KEY`. Une
copie n'hérite jamais des secrets de sa source — la compromission de l'une ne
compromet pas l'autre.

**Ce qui n'est JAMAIS copié** (`npm run duplicate:policy` fait foi) :

| Verdict | Cible | Pourquoi |
|---|---|---|
| `COPY_EMPTY` | `backend/uploads` | médias du client source |
| `COPY_EMPTY` | `backend/storage` | **documents contractuels signés** |
| `COPY_EMPTY` | `backend/logs` | journaux nommant des destinataires |
| `COPY_EMPTY` | `backend/migration-reports` | données métier et sauvegardes |
| `IGNORE` | `.git`, `.claude`, `.agents`, `.recette` | propre à l'instance ou à la machine |
| `IGNORE` | tout dossier `one-off/` | réparations câblées sur UN projet |
| `REGENERATE` | `node_modules`, `dist`, caches | reconstruit |

> **Ceci est né d'une panne.** `backend/storage` n'était pas dans la liste : la
> première duplication faite depuis un poste ayant réellement exploité la source
> a copié **7 006 documents contractuels signés** — 41 Mo de PDF — dans le
> dossier d'un autre client. Invisible depuis un checkout frais, où ces dossiers
> sont vides. La phase `cleanliness` existe pour que cela ne puisse plus passer
> en silence : elle **fait échouer la duplication**.

**Ce que le moteur réécrit désormais**, en plus du `.env` : `project.profile.js`,
les manifestes des deux moteurs (`supportedProfiles`), le nom de chaque
`package.json` et de son lockfile, le titre d'onglet et les métadonnées
d'identité de chaque `index.html`, la bannière de démarrage DEV.

**Ce qu'il ne réécrit pas, délibérément :** le texte commercial — `meta
description`, `og:description`. C'est du CONTENU, pas de l'identité ; l'inventer
ferait croire qu'un clone sort prêt à publier. Le moteur les **nomme** en fin de
duplication, sous « À PERSONNALISER ».

### 3.3 Si la duplication échoue

| Code | Sens | Geste |
|---|---|---|
| `FIRST_ADMIN_PASSWORD_INVALID` | trop court, ou identifiant historique du parc | choisir un mot de passe propre au projet |
| `FIRST_ADMIN_ALREADY_PRESENT` | la base TEST porte déjà un ADMIN | vérifier le nom de base |
| `DUPLICATION_TREE_NOT_CLEAN` | la copie a hérité de données opérationnelles | ne pas contourner : lire le message, il nomme le dossier |
| `DUPLICATION_IDENTITY_REWRITE_FAILED` | un fichier d'identité n'a pas été repris | la copie porterait l'identité de sa source |

Un échec laisse un dossier incomplet : supprimez-le et recommencez.
**Ne corrigez jamais un clone à la main** — voir §14.

---

## 4. Configurer l'identité de la copie

Presque tout est fait. Il reste ce que le moteur ne peut pas savoir.

Dans `backend/.env` de la copie :

```env
ENV=TEST
PANEL_URL=https://api.panel.ly-solution.com
PANEL_PAIRING_CODE=PAIR-XXXX-XXXX-XXXX      # obtenu au §5, à retirer après
PUBLIC_BACKEND_URL=https://api.demo-garage-dupont.ly-solution.com
```

`PANEL_URL` est l'adresse de l'**API** du Panel — celle que le pont appelle.
Ce n'est pas l'adresse où l'on envoie un navigateur ; le projet apprend cette
seconde adresse à l'appairage (§10.2).

Vérifiez ensuite ce que le moteur a écrit :

```bash
grep -E 'PROJECT_SLUG|PROJECT_ID' backend/src/deployment-engine/config/project.profile.js
grep -m1 '"name"' package.json backend/package.json manager/package.json vitrine/package.json
```

Et ce qu'il vous laisse : les descriptions commerciales listées sous
« À PERSONNALISER » (`vitrine/index.html`, notamment).

---

## 5. Déclarer le projet au Panel

Depuis le Panel, avec un compte DEV : **Projets → Déclarer**.

| Champ | Valeur | Attention |
|---|---|---|
| URL | `https://api.demo-garage-dupont.ly-solution.com` | l'adresse de l'**API** du projet |
| Nom | `Garage Dupont` | |
| Environnement | `TEST` | |

Le Panel rend un **code d'appairage à usage unique**, valable 15 minutes. Copiez-le
dans `PANEL_PAIRING_CODE` (§4).

Si le code expire : **Projets → la fiche → Régénérer le code**.

---

## 6. La configuration réseau — avant tout déploiement

> **C'est l'étape qui a manqué au premier projet, et elle a coûté le DNS
> automatique.** Le Panel n'administre un nom que s'il appartient au projet, et
> l'appartenance se lit sur la destination active — laquelle est annoncée par le
> projet d'après SA configuration réseau. Un projet neuf annonce `localhost`.

Les trois URL suivent la convention de la fabrique :

```
site     https://demo-garage-dupont.ly-solution.com
manager  https://manager.demo-garage-dupont.ly-solution.com
api      https://api.demo-garage-dupont.ly-solution.com
```

Elles s'écrivent par le moteur, jamais à la main — `syncRuntimeNetworkConfiguration`,
la même fonction que le déploiement appelle à l'étape `runtime.network`. Depuis
le Manager, en DEV : **Configuration système → Réseau**.

Après quoi le projet réannonce sa destination, et le Panel reconnaît le domaine.

---

## 7. Démarrer — l'appairage est automatique

```bash
npm run dev          # ou : node backend/src/server.js
```

Au premier démarrage, le projet :

1. crée le compte **DEV**, sans mot de passe, en attente d'activation ;
2. s'appaire au Panel avec le code, et le consomme ;
3. reçoit l'identité de l'entreprise développeuse, le contrat de variables
   e-mail, le secret de vérification de son endpoint Stripe, et la déclaration
   que SIGNATURE / BREVO / HOSTINGER sont administrés par la plateforme ;
4. déclare ses usages e-mail — codes et empreintes — que le Panel réconcilie.

Le code est consommé : **retirez-le du `.env`.**

Vérifiez sur le Panel : `pairing = PAIRED`, `liveness = ONLINE`,
`runtime.environment = TEST`, `contractVersion` égale à celle du Panel.

**Un projet neuf ne peut pas être appairé par un humain**, et c'est voulu : seul
le compte DEV en a le droit, il naît sans mot de passe, et son lien d'activation
part par le Panel — auquel on n'est pas encore relié. D'où l'automatisme.

---

## 8. Importer les données du client — une fois

La doctrine tient en une phrase : **le démarrage n'invente aucun contenu.**
`catalog-no-seed.test.js` l'exige, et compte les documents avant et après un
démarrage réel.

Écrivez une **migration d'import** dans
`backend/src/scripts/migrations/<date>-import-<client>.js`, et donnez-lui deux
commandes :

```bash
npm run import:<client>:dry-run    # simulation, aucune écriture
npm run import:<client>            # écriture
```

Elle doit être :

- **idempotente** — chaque entité retrouvée par sa clé naturelle (slug de
  service, nom de gamme, nom de forfait, auteur + date d'avis) ;
- **non destructive** — elle met à jour, elle n'efface pas ce qu'un
  administrateur aurait ajouté à côté ;
- **jamais branchée au démarrage** — après l'import, **le Manager fait autorité**.

Les cinq natures de données, à ne pas confondre :

| Nature | Qui l'écrit | Rejouée au boot ? |
|---|---|---|
| Amorçage technique | le bootstrap (singletons, index) | oui, idempotent |
| Configuration | le Manager, le Panel | non |
| **Données client** | la migration d'import, puis le Manager | **jamais** |
| Données d'exécution | le runtime | — |
| Fixtures de test | les suites, en base éphémère | — |

**Preuve attendue :** après l'import, un redémarrage ne produit **aucune mutation
client**.

Les médias (logo, favicon, hero) passent par l'**autorité média** —
`importProjectMedia` — jamais par un chemin écrit dans le front. Le descripteur
vit en base, l'adresse est dérivée à la lecture : un changement de domaine ne
casse aucune image.

---

## 9. Déployer TEST

Créez la destination, puis déployez :

```bash
cd backend
node src/scripts/deploy-drive.js --list
node src/scripts/deploy-drive.js --target <id> --preflight
node src/scripts/deploy-drive.js --target <id>
```

`deploy-drive.js` est le pilote officiel : il porte le **client de capacités**
(donc le DNS automatique), la **vérification de port contre la machine réelle**,
et les **capacités média** (reprise et publication). Les trois ont manqué à un
moment de l'histoire de ce moteur, et chaque absence s'affichait en vert.

Le moteur prend en charge DNS, TLS, Nginx, port, PM2, configuration runtime,
site, manager, API. **Aucune intervention SSH manuelle.**

Contrôles au passage :

- `DNS : automatique (capacité Panel)` — si vous lisez `manuel — PANEL_UNAVAILABLE:CAPABILITY_RESOURCE_NOT_OWNED`,
  revenez au §6 : la destination active du projet n'est pas son domaine ;
- `PORT : <n> retenu` — attribué par le registre, jamais choisi ;
- `media.publish` doit annoncer un nombre de médias **publiés**, pas seulement
  transférés.

---

## 10. Le premier compte DEV, et la connexion fédérée

### 10.1 « Activez votre accès »

Le compte DEV naît **sans mot de passe** au premier démarrage (§7) et reçoit un
lien d'activation valable 60 minutes.

Or ce courriel part **par le Panel**. Au premier démarrage d'un projet neuf,
l'appairage n'est pas encore fait : l'envoi échoue, `PROVIDER_NOT_CONFIGURED`.
**C'est normal, et ce n'est plus un problème** : l'obligation d'envoi est
enregistrée, ARMÉE, et part d'elle-même dès que l'appairage s'établit. Le
démarrage l'affiche en `DEFERRED` tant qu'elle est due.

Un redémarrage n'envoie rien « au cas où » : l'obligation n'existe que si l'état
durable la justifie — un compte en attente dont la dernière activation n'est pas
partie. Un lien déjà envoyé n'est jamais renvoyé d'office.

Pour renvoyer un lien à la main :

```bash
curl -X POST -H 'content-type: application/json' \
  -d '{"email":"dev@agence.fr"}' \
  https://api.<domaine>/api/auth/activation/resend
```

La réponse est volontairement générique : ce formulaire ne doit pas devenir un
annuaire des comptes d'administration.

#### Quand le lien n'arrive pas, et qu'il faut entrer maintenant

Sur une **démonstration**, le circuit par courriel est parfois trop lent : la
boîte n'est pas relevée, l'appairage vient d'avoir lieu, et l'on veut montrer le
Manager dans la minute. Or l'écran qui poserait un mot de passe est **derrière
le compte DEV qu'on cherche justement à activer**.

```bash
cd backend
node src/scripts/account-drive.js --list

ACCOUNT_PASSWORD='<mot de passe propre à ce projet>' \
  node src/scripts/account-drive.js --create --email dev@agence.fr --role DEV --name "Prénom Nom"

# Ou, pour débloquer le compte né PENDING_ACTIVATION :
ACCOUNT_PASSWORD='…' node src/scripts/account-drive.js --set-password --email dev@agence.fr
```

Le pilote ouvre la **même porte que l'écran « Comptes »**, avec le même modèle
et les mêmes refus : longueur minimale, secrets universels du parc
(`utils/universalSecrets.js`), mot de passe déduit de l'adresse. Le mot de passe
est lu dans l'**environnement**, jamais en argument — une ligne de commande finit
dans l'historique du shell et dans la sortie de `ps`.

Ce n'est **pas** un contournement de la doctrine du lot 2C : celle-ci interdit
qu'un secret soit écrit sur disque ou transporté par une duplication, pas qu'un
opérateur crée un compte. Le premier compte DEV continue de naître sans mot de
passe, et son lien d'activation reste le chemin normal.

### 10.2 « Se connecter avec L.Y Solution »

Circuit attendu :

```
Manager du projet  →  POST /api/auth/federated/panel/start
                      (le SERVEUR compose l'URL, émet le state)
   ↓
Frontal du Panel   →  /federation/authorize?projectId=…&state=…&returnUrl=…
                      (le Panel authentifie, vérifie l'accès, signe)
   ↓
Manager du projet  →  /connexion/ly-solution/retour#assertion=…
   ↓                  POST /api/auth/federated/panel/callback
Session ouverte    →  30 minutes, revalidée toutes les 5
```

> **Le piège, et il a mordu.** `/federation/authorize` est une page du **frontal**
> du Panel. L'URL était composée contre `PANEL_URL`, qui est son **API**. Chez
> L.Y Solution, l'hôte du frontal proxifie aussi `/api` : les deux valeurs
> marchent pour le pont, une seule marche pour la fédération. Le premier projet
> dupliqué, dont le `.env` portait l'hôte d'API, répondait
> `Route inconnue : GET /federation/authorize`.
>
> Le Panel **déclare** désormais son adresse publique à l'appairage. À défaut
> (Panel ancien), le projet la déduit en retirant le sous-domaine d'API, et le
> **dit dans son journal**. Si rien n'est déductible, il refuse d'ouvrir le
> parcours — `FEDERATION_PANEL_FRONTEND_UNKNOWN` — plutôt que d'envoyer un
> navigateur vers une page absente.

Rien n'est à configurer par projet : `returnUrl` est dérivée de l'origine du
Manager, et le Panel la confronte aux origines qu'il connaît.

---

## 11. Doctrine des environnements

> **CONTROL PLANE ENVIRONMENT IS NOT PROJECT ENVIRONMENT.**
>
> **PROJECT ENVIRONMENT SELECTS PROJECT-SCOPED PROVIDER ENVIRONMENT.**

### 11.1 Deux dimensions indépendantes

```
PANEL_ENV     le monde où tourne le PLAN DE CONTRÔLE
PROJECT_ENV   le monde où tourne le PROJET administré
```

**Un projet en PRODUCTION peut être piloté par un Panel de RECETTE.** C'est
supporté, et ce n'est pas une dégradation : administrer n'est pas agir au nom de.
Battement, supervision, URLs, génération, curseur, déploiement et capacités
fournisseur fonctionnent normalement.

Cela ne signifie **pas** « des fournisseurs de recette » — voir §11.2.

### 11.2 Qui choisit le monde d'un fournisseur

```
providerEnvironment = resolveFrom(PROJECT.environment, PROVIDER.runtimeModel)
```

| Panel | Projet | Stripe / Brevo / OpenSign |
|---|---|---|
| TEST | TEST | **TEST** |
| TEST | PROD | **PROD** |
| PROD | TEST | **TEST** |
| PROD | PROD | **PROD** |

**L'environnement du PROJET décide, jamais celui du Panel.** Ce dernier ne
tranche que pour les capacités que le Panel exerce **pour lui-même**.

Un fournisseur à **compte unique** (`PANEL_GLOBAL`, ex. Hostinger) n'a pas de
monde : la réponse est `null`, dans les quatre cases. On ne lui invente pas un
TEST/PROD pour faire tenir un tableau.

### 11.3 Le projet ne choisit pas son monde

L'environnement d'un projet est **épinglé sur sa fiche Panel** : déclaré par
l'opérateur, ou fixé à l'appairage — le seul instant où le projet prouve son
identité par un code à usage unique — et immuable ensuite.

Un projet enregistré en recette qui annoncerait `PROD` à son battement obtient un
avertissement au journal, et les identifiants de **recette**. Sans cet ancrage,
lever la contrainte d'égalité aurait ouvert un chemin d'élévation : un champ à
changer pour repartir avec les clés du monde réel.

Corollaire pour la fabrique : **choisissez l'environnement au moment de déclarer
le projet dans le Panel.** Une fiche par monde ; une recette et une production
sont deux fiches, avec deux codes et deux jetons — et elles peuvent vivre sur la
même instance de Panel.

### 11.4 La frontière qui subsiste

Le Panel ne **livre pas** ses propres enregistrements métier — entreprise
cliente, mentions légales, contrat, équipe — à un projet d'un autre monde. Ils
sont partitionnés par le monde du Panel, et les livrer poserait les mentions
légales d'une entreprise de recette sur un site en production.

La livraison est refusée en `ENVIRONMENT_MISMATCH`, de classe `SCOPE` : ce n'est
pas un incident, c'est une frontière. Pour synchroniser aussi le métier, la fiche
doit vivre sur le Panel du même monde.

### 11.5 Aucune clé ne descend

Aucune clé fournisseur ne descend jusqu'au projet. Il consomme des **capacités** :
il demande, le Panel exécute avec sa propre clé, et rend un résultat. Le seul
secret qui descend est le secret de **vérification** d'un webhook : il n'ouvre
aucun accès.

Contrôle : dans la base du projet, `integratedapis` ne doit porter **aucun
credential local**.

---

## 12. Recette post-déploiement

La liste courte, et elle est obligatoire. Détail en
[PROJECT_DUPLICATION_CHECKLIST.md](PROJECT_DUPLICATION_CHECKLIST.md).

| # | Contrôle | Attendu |
|---|---|---|
| 1 | site | `200` |
| 2 | manager | `200` |
| 3 | `api/health` | `200`, `env` correct |
| 4 | `api/version` | `project` = **slug du clone** |
| 5 | Panel | `PAIRED` · `ONLINE` · `environment` correct |
| 6 | pont | `contractVersion` identique · outbox 0 · parked 0 · aucun runtime rival |
| 7 | IntegratedAPI | `activeMode` correct, aucun credential local |
| 8 | connexion locale | l'ADMIN entre |
| 9 | **connexion fédérée** | « Se connecter avec L.Y Solution » ouvre une session |
| 10 | activation DEV | lien reçu, mot de passe posé, compte actif |
| 11 | médias | logo, favicon, hero en `200` et `PUBLISHED` |
| 12 | catalogue | services, tarifs, gammes, « sur devis » rendus |
| 13 | isolation base | 0 document de la source |
| 14 | identité | 0 occurrence de la source dans les écrans |
| 15 | dépôt | `HEAD = origin`, arbre propre, aucun secret |

---

## 13. Passer en PROD, plus tard

Ce qui change : `ENV=PROD`, les domaines, une destination PROD, une déclaration
PROD au Panel.

Ce qui **ne se recopie pas** depuis TEST : les documents contractuels, les
transactions, les médias de recette, les journaux, les jetons de pont. La
promotion de données passe par la procédure contrôlée
([TEST_TO_PROD_MIGRATION.md](../TEST_TO_PROD_MIGRATION.md)), qui ne modifie
jamais TEST.

`rlv_detail_prod`-style : la base PROD est créée à la duplication et **reste
vierge** jusqu'à la mise en service.

---

## 14. Ne réparez jamais un clone à la main

**C'est la règle la plus importante de ce document.**

Si un clone a besoin d'une modification de code pour fonctionner, ce n'est pas le
clone qui est en défaut : c'est la fabrique. Un correctif posé dans le clone
répare un projet et laisse les suivants tomber dans le même trou — et le premier
projet client l'a prouvé, avec sept correctifs génériques appliqués dans le clone
avant d'être remontés ici.

La marche à suivre :

1. arrêtez ;
2. corrigez la **fabrique** ;
3. supprimez le clone et recommencez.

C'est le critère de certification : **POST_DUPLICATION_MANUAL_CODE_FIXES = 0**.

### 14.1 Certifier la fabrique — le clone jetable

Après toute modification du moteur, produisez une fixture par la commande
officielle et prouvez qu'elle sort propre. Trois règles :

- **elle ne coûte rien au parc** : elle tourne sur une base éphémère en mémoire,
  jamais sur le cluster de production (voir §1.4) ;
- **elle est rejouable** : elle retire d'abord son propre reliquat côté Panel —
  une certification interrompue laisse une déclaration derrière elle, et la
  suivante échoue en cascade pour une raison qui n'est pas la sienne ;
- **elle se détruit** : dossier, bases, projet Panel. Une fixture qui survit
  devient un projet fantôme que le prochain audit prendra pour un client.

Le contrôle qui commande tous les autres compare le clone à sa source, fichier
à fichier, hors la liste exacte de ce que le moteur réécrit. Tout écart est un
correctif manuel — donc un défaut de la fabrique, pas du clone.

Et si la fixture échoue après que vous ayez corrigé la fabrique : **détruisez-la
et refaites-la**. Une fixture réparée à la main ne certifie rien — elle prouve
seulement que vous savez réparer.

---

## 15. Dépannage — pannes réellement rencontrées

| Symptôme | Cause | Diagnostic | Correction |
|---|---|---|---|
| Le clone porte des PDF du client source | `backend/storage` n'était pas exclu | `find backend/storage -type f \| wc -l` | corrigé : `COPY_EMPTY` + phase `cleanliness` |
| `/api/version` annonce le slug de la source | identité écrite en dur hors du profil | `curl …/api/version` | corrigé : dérivée de `PROJECT_ID` |
| Le moteur se déclare non supporté | `supportedProfiles` non réécrit | `npm run duplicate:phases` | corrigé : réécrit à la duplication |
| La restauration refuse ses propres archives | motif ancré sur `/var/backups/sbauto/` | tenter une restauration | corrigé : ancré sur `BACKUP_ROOT` |
| `DNS : manuel — CAPABILITY_RESOURCE_NOT_OWNED` | destination active = `localhost` | fiche Panel → `descriptor.primaryDomain` | §6, puis redémarrer le projet |
| `media.publish ✓` mais médias `LOCAL_ONLY` | capacités média non injectées par le pilote | `projectmedias.publicationState` | corrigé : câblées dans `deploy-drive.js` |
| Run de recette journalisé `env: PROD` | `createRun` écrivait `'PROD'` en dur | `deploymentruns` → `env` | corrigé : lu sur la destination |
| `Route inconnue : GET /federation/authorize` | adresse d'API prise pour l'adresse humaine | ouvrir l'URL du bouton | corrigé : §10.2 |
| Lien d'activation jamais reçu | envoi impossible avant appairage, sans reprise | `localdevactivations.emailStatus` | corrigé : obligation armée, §10.1 |
| Champ « URL du Panel » pré-rempli d'un domaine mort | repli codé en dur | écran Connexion Panel | corrigé : plus de repli, un exemple |
| `403 Permission to … denied` au push | droits GitHub | `git ls-remote <dépôt>` | **externe** — §1.2 |

---

## 16. Ce que la fabrique garantit, et ce qu'elle ne garantit pas

**Garanti, et vérifié par une garde :**

- aucune donnée opérationnelle de la source dans un clone (`cleanliness`) ;
- aucune identité de la source dans les fichiers d'identité (`config`) ;
- bases distinctes, secrets régénérés, dépôt neuf, `uploads` vide ;
- aucun contenu client injecté au démarrage (`catalog-no-seed`) ;
- aucun secret fournisseur dans un projet (`integrated-api-panel-authority`) ;
- toute suite de test est branchée quelque part (`test-suite-coverage`).

**Non garanti — c'est de la donnée métier, et elle vous appartient :**

- le texte commercial (`meta description`, accroches) ;
- le catalogue, les tarifs, les coordonnées, les horaires ;
- l'entreprise cliente et ses données légales — sans elle, facturation et
  signature restent **bloquées**, et c'est correct ;
- les bannières de service.
