# Dupliquer le template pour une nouvelle entreprise

> **Documents contractuels :** ils vivent dans le stockage partagé du projet
> et ne sont JAMAIS copiés vers un duplicata — voir
> [panelXvitrine/DOCUMENT_CONTRACTUEL.md](./panelXvitrine/DOCUMENT_CONTRACTUEL.md).


Le projet est conçu pour être **cloné et remis en service** en quelques minutes, sans toucher au code.

## 1. Nouvelle base de données

Utilisez un seul cluster MongoDB (ex. Atlas) ; **seul le nom de la base change** entre test et production. Renseignez le `.env` du backend :

```env
ENV=TEST
MONGODB_URI=mongodb+srv://user:pass@cluster.xxxxx.mongodb.net
DB_TEST=entreprise_test
DB_PROD=entreprise_prod
JWT_SECRET=<chaîne longue et aléatoire>
CORS_ORIGINS=https://manager.domaine.com,https://domaine.com
PUBLIC_URL=https://api.domaine.com
```

Au premier lancement, la configuration par défaut et le **premier compte
développeur local** sont créés automatiquement (amorçage idempotent : une
deuxième initialisation ne crée jamais un second compte DEV).

> **Duplication via l'assistant du Manager** : l'assistant demande l'**adresse**
> et le **nom** du premier développeur local — jamais un mot de passe. L'adresse
> est écrite dans le `.env` de la copie (`FIRST_DEV_EMAIL`) ; au premier
> lancement, le projet crée le compte **sans mot de passe** et lui envoie un
> **lien d'activation à usage unique** (valable 60 minutes). Le développeur
> choisit son secret sur `/activer-mon-compte`, et le lien meurt.
>
> Aucun mot de passe n'est donc écrit sur disque, transmis, ni partagé entre
> projets. Le moteur **efface** au passage les `SEED_DEV_PASSWORD` /
> `SEED_ADMIN_PASSWORD` hérités d'une source antérieure au lot 2C.
>
> Si l'e-mail ne peut pas partir (plateforme indisponible, URL du manager non
> configurée), le compte reste **en attente d'activation** et le lien est
> renvoyable — il n'existe aucun mot de passe de repli.
>
> **Le premier administrateur suit un autre chemin, et volontairement.**
> L'assistant demande son adresse ET son mot de passe (avec confirmation) : le
> compte est créé pendant la duplication, directement dans la base TEST de la
> copie, et il est **actif immédiatement**. C'est le compte que vous remettez au
> client à la livraison — un lien d'activation envoyé à une boîte pas encore
> relevée produirait un projet livré sans accès.
>
> Le mot de passe est propre à cette duplication : les identifiants historiques
> du parc sont refusés, et il n'est écrit nulle part ailleurs que haché en base
> — ni dans le `.env`, ni dans les journaux, ni dans le rapport.
>
> L'étape « Premier administrateur créé » est **bloquante** : la duplication
> échoue si le compte ne peut pas être créé.

## 2. Personnalisation (100 % via le manager, sans code)

1. Connexion avec le compte ADMIN du projet (créé par le développeur depuis
   **Comptes**, ou amorcé via `FIRST_ADMIN_EMAIL` et son lien d'activation).
2. **Entreprise** : nom, slogan, texte d'introduction, **logo header**, **favicon** et **image d'accueil (hero)**.
3. **Coordonnées & horaires** : activez et renseignez les médias utiles (téléphone, WhatsApp, Instagram, adresse, Google Maps…) et les **horaires d'ouverture + fuseau horaire** (le statut « ouvert/fermé » du site en découle).
4. **Services** : créez les services, puis dans chaque catégorie (description + galerie) : des **packs** (prestations incluses, options, badge, tarifs), des **prestations complémentaires** et des **suppléments** (« à partir de » ou « sur devis »).
5. **Avis** : ajoutez les avis clients (date éditable, **photos jointes** optionnelles affichées en carrousel sur la vitrine) et réglez le compteur **« X+ clients satisfaits »** (preview en direct).
6. **Avant / Après** : ajoutez vos réalisations (deux photos mêmes dimensions), réorganisez par glisser-déposer, activez/masquez.
7. **FAQ** : créez/ordonnez les questions fréquentes (glisser-déposer).
8. **Bannières promo** : programmez une bannière (dates de début/fin, priorité, couleurs, CTA, compte à rebours). Une seule s'affiche à la fois (priorité la plus haute).
9. **Thème du site** : choisissez la palette (4 couleurs, aperçu en direct) — toute la vitrine s'y adapte. Défaut : sombre noir / bleu / blanc.
10. En tant que **DEV** (le compte activé depuis le lien reçu par e-mail) : entreprise/équipe développeur, comptes, thème du manager, suspension du site, et **Configuration système › Réseau** (URL publiques backend/manager/vitrine — voir §3).

## 2 bis. Initialiser PROD à partir de TEST (données réelles)

Si vous avez saisi les vraies données dans `DB_TEST` et souhaitez initialiser
`DB_PROD` avec une **copie fidèle** (sans repartir de zéro ni retaper le contenu),
utilisez la procédure de promotion contrôlée — voir
[docs/TEST_TO_PROD_MIGRATION.md](TEST_TO_PROD_MIGRATION.md) :

```bash
cd backend
npm run db:promote:audit             # lecture seule
npm run db:promote:dry-run           # simulation
npm run db:promote -- --reset-prod   # migration réelle (TEST reste intacte)
npm run db:verify-prod               # parité TEST/PROD
```

TEST n'est jamais modifiée. Les URL `localhost`/`ngrok` copiées et les fichiers
`uploads/` sont recensés dans les rapports pour correction/déploiement.

## 3. Mise en production

- Basculez `ENV=PROD` dans le `.env` du backend.
- Buildez les fronts (`npm run build`) et servez `manager/dist` et `vitrine/dist`.
- Chaque front a son propre `.env` avec l'URL **initiale** de l'API :

  ```env
  # manager/.env et vitrine/.env
  VITE_API_URL=https://api.domaine.com
  ```

- Faites pointer :
  - `domaine.com` → vitrine
  - `manager.domaine.com` → manager
  - `api.domaine.com` → backend (avec `/uploads` accessible)
- En **DEV**, renseignez **Configuration système › Réseau** (les 3 URL publiques). Elles
  alimentent les liens applicatifs (« Voir la vitrine »), l'URL canonique et la
  résolution des médias, et sont ajoutées dynamiquement aux origines CORS autorisées
  (`CORS_ORIGINS` du `.env` reste la liste de secours). Le bouton **Tester** vérifie la
  joignabilité des URL (protégé contre le SSRF). En PROD, seules des URL http/https
  publiques sont acceptées — `localhost` et les IP privées sont refusées.

Aucune autre modification n'est nécessaire : tout le contenu et l'apparence sont pilotés depuis le manager.

## 4. Tester sur mobile / à distance avec ngrok

Pour tester la vitrine ou le manager sur un téléphone (ou partager un aperçu),
exposez chaque service local via [ngrok](https://ngrok.com) :

```bash
ngrok http 6070   # backend  → https://xxxx-backend.ngrok-free.app
ngrok http 6071   # manager  → https://xxxx-manager.ngrok-free.app
ngrok http 6062   # vitrine  → https://xxxx-vitrine.ngrok-free.app
```

Étapes :

1. Lancez les 3 apps en local (`npm run dev` dans chaque dossier).
2. Ouvrez 3 tunnels ngrok (un par port) et notez les URL `https://…ngrok-free.app`.
3. Dans `manager/.env` et `vitrine/.env`, mettez `VITE_API_URL` = l'URL ngrok du
   **backend**, puis relancez les fronts (Vite lit `.env` au démarrage).
4. Connectez-vous au manager (via son URL ngrok) en **DEV**, ouvrez **Configuration
   système › Réseau** et renseignez les 3 URL ngrok (backend/manager/vitrine).
   Enregistrez : les origines CORS sont rafraîchies à chaud, les liens applicatifs
   et médias pointent alors vers les tunnels.
5. Ouvrez l'URL ngrok de la vitrine sur le téléphone.

> Les URL ngrok gratuites changent à chaque redémarrage : il faut alors les
> remettre à jour dans les `.env` **et** dans Configuration système › Réseau.

---

## L'ordre de fabrication d'un projet neuf

```
1. DUPLIQUER    ce moteur
2. CONFIGURER   .env : identité, bases, PANEL_URL + PANEL_PAIRING_CODE
3. DÉCLARER     le projet au Panel, AVEC SON DOMAINE
4. DÉMARRER     le projet s'appaire seul au premier boot
5. DÉPLOYER     DNS, TLS, Nginx, PM2 — automatique
```

**Déclarer et appairer AVANT de déployer.** Le DNS automatique passe par la
capacité `dns.*` du Panel, qui n'écrit un enregistrement que pour un nom
appartenant au projet — appartenance qui se lit sur la destination active, créée
à la déclaration. Et la capacité exige le jeton de pont obtenu à l'appairage.
Dans l'autre ordre, il faut créer les enregistrements DNS à la main.

Le compte DEV — seul habilité à appairer — naît sans mot de passe et s'active
par courriel, lequel passe par le Panel : un projet neuf ne peut donc PAS être
appairé par un humain. Il n'a pas à l'être, `PANEL_PAIRING_CODE` suffit.

Détail complet : `Panel/docs/architecture/40_PROJECT_FACTORY.md`.

## Ce qu'une copie n'hérite JAMAIS de sa source

| ce qui est régénéré / réécrit | pourquoi |
|---|---|
| `JWT_SECRET`, `INTEGRATED_API_ENCRYPTION_KEY` | un secret partagé rendrait les sessions interchangeables entre projets, et la compromission de l'un compromettrait tous les autres |
| `DB_TEST`, `DB_PROD` | une copie qui écrirait dans la base de sa source détruirait les données d'un client en croyant démarrer |
| `PROJECT_GITHUB_REPOSITORY_URL` | une copie ne pousse jamais dans le dépôt de sa source |
| `FIRST_DEV_EMAIL` / `FIRST_DEV_NAME` | une copie n'hérite pas de l'administrateur de sa source ; le compte naît **sans mot de passe**, activé par lien |
| `SEED_DEV_PASSWORD`, `SEED_ADMIN_PASSWORD` | **supprimées**, pas réécrites : un secret oublié dans un fichier ressemble à une consigne, et quelqu'un finira par le remettre en service |
| **`PROJECT_SLUG` et `PROJECT_ID`** (`backend/src/deployment-engine/config/project.profile.js`) | voir ci-dessous |

### Les médias du client ne traversent pas une duplication

`backend/uploads` porte les logos, les photos de véhicules, les documents — les
données d'un **client**. Le dossier doit exister dans la copie (le runtime y
écrit dès le premier envoi), son contenu ne doit jamais y arriver.

Il est ignoré par git, donc vide dans tout clone frais du dépôt : le défaut ne
se voyait que sur un poste où le projet source avait **réellement servi**. Une
duplication faite là aurait recopié les photos d'un garage chez un autre.

`COPY_EMPTY_ONLY` recrée donc la structure sans le contenu. Un clone est un
**logiciel** neuf, pas une copie de la société source.

### L'identité technique — le trou trouvé à la certification factory

`project.profile.js` est le seul fichier du moteur de déploiement qui connaisse
le projet : son **slug** (préfixe des processus PM2, des dossiers de staging et
de l'arborescence `/var/backups/<slug>`) et son **identifiant de build**, celui
que `/api/version` publie.

La duplication réécrivait le `.env` et **oubliait ce fichier**. Toute copie
repartait donc en `sbauto` / `sbauto06` : dix projets clients auraient tous
annoncé `sbauto06`, et déposé leurs sauvegardes dans le même répertoire. Rien
n'aurait cassé — et c'est le pire des cas : chaque copie aurait menti sur son
identité, en silence, dès le premier clone.

L'identité est **dérivée du nom du projet**, pas demandée : un champ de plus à
saisir est un champ de plus à saisir faux, et deux projets finiraient par
partager un slug par distraction. Le nom est déjà saisi, déjà validé, et déjà
unique par construction — le dossier cible ne doit pas exister.

La réécriture a lieu dans la phase `config`, au même moment que le `.env` :
c'est la même question — « qui est ce projet ? ». Elle est **vérifiée après
écriture**, sur le fichier réellement écrit, et un profil illisible fait
**échouer** la duplication. Un remplacement silencieusement raté serait pire que
pas de remplacement du tout.

## Duplication Phase Registry

> **Ne jamais ajouter une phase directement dans `DuplicateAssistant.tsx` ou
> `friendly.ts`.** Une phase ajoutée là ne serait jamais émise par le moteur :
> elle resterait éternellement « en attente » sur une duplication réussie. Une
> garde d'architecture (`engine-governance.test.js`) le vérifie et échoue.

### Où une phase est définie

Un seul fichier :

```
backend/src/duplication-engine/config/duplication.phases.js
```

Il porte, pour chaque phase : `id`, `order`, `label`, `icon`, `group`,
`dynamic`, `required`, `blocking`. Tout le reste en dérive — l'ordre, les
libellés, la checklist live du Manager, la validation du flux NDJSON, la
checklist du rapport final et les gardes d'architecture.

### Comment l'émettre

Le moteur n'appelle plus `onPhase` directement. Il passe par le traceur, qui
refuse au point d'émission une phase hors registre, un statut hors vocabulaire
ou une transition impossible :

```js
tracker.phase('ma_phase', 'running');
// … le travail …
tracker.phase('ma_phase', 'ok');       // ou 'error'
tracker.skip('ma_phase', 'rien à faire ici');
```

États possibles, et rien d'autre :

```
pending → running → ok
                  → error
pending → skipped
```

`skipped` n'est **pas** `ok` : une phase qui n'avait rien à faire n'a rien
réussi.

### Comment elle apparaît dans l'interface

Automatiquement. Le Manager demande le contrat
(`GET /deployment/duplication/phases`), et `duplicationChecklist.ts` le croise
avec les événements reçus. Une ligne n'existe que si le contrat la déclare ; un
état n'existe que si un événement l'a dit.

### Required / optional

`required: true` signifie qu'une duplication **ne peut pas être déclarée
réussie** sans cette phase : à la fin du pipeline, une phase requise restée en
attente ou en cours fait échouer la duplication (`DUPLICATION_PHASE_MISSING`).
C'est ce qui rend impossible d'afficher une checklist complète sur un travail
partiellement fait.

### Cibles dynamiques

`dynamic: true` déclare une **famille** : la phase a lieu une fois par cible
découverte à l'exécution (un sous-projet Node, par exemple). Le registre déclare
la famille, le runtime produit les instances :

```js
tracker.phase('dependencies', 'running', { target: 'backend' });
```

La clé d'instance est `famille:cible` (`dependencies:backend`). Le séparateur
est `:` et non `.`, parce qu'une cible est un chemin où le point est légitime.

**Ne jamais écrire les cibles en dur.** L'ancienne liste du Manager déclarait
`backend`, `manager`, `vitrine` comme si leur existence était garantie : un
projet sans vitrine affichait une ligne bloquée sur une duplication parfaitement
réussie.

### Ordre canonique observé

```
10  mongo         Vérification MongoDB
20  databases     Préparation des bases
30  first_admin   Premier administrateur créé      (bloquante)
40  copy          Copie des fichiers
50  config        Configuration du projet
60  discover      Détection des sous-projets
70  dependencies  Installation des dépendances     (dynamique)
80  validate      Validation                       (dynamique)
90  done          Projet prêt
```
