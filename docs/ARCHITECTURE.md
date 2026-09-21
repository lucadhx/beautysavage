# Architecture — SB Auto

> **Statut : ACTIF.** Document d'autorité pour l'architecture. Exploitation :
> [PROTOCOL.md](PROTOCOL.md). Pont : [PANEL_BRIDGE.md](PANEL_BRIDGE.md).
> Fournisseurs : [INTEGRATED_API.md](INTEGRATED_API.md). Index : [README.md](README.md).


Monorepo composé de trois applications indépendantes mais complémentaires.

```
/
├── backend/        API REST (Express + Mongoose)
├── manager/        Back-office React (administration)
├── vitrine/        Site public React (premium)
└── docs/           Documentation
```

## 0. Vue d'ensemble — qui possède quoi

```
                    PANEL L.Y SOLUTION
                           |  configuration / autorité
                           |  credentials fournisseur
                           |  webhooks fournisseur
                           v
                  Panel Bridge / capacités bornées
                           |
                           v
                    SB AUTO BACKEND
                    |-- métier + données projet
                    |-- API Manager
                    |-- moteur de déploiement
                    |-- configuration e-mail MÉTIER
                    `-- invocation de capacités
                           |
                           v
                     SB AUTO MANAGER
```

Fournisseurs :

```
PANEL L.Y SOLUTION          SB AUTO
  |-- Stripe                  `-- aucune administration locale
  |-- Brevo                       de credential fournisseur
  |-- Yousign
  `-- Hostinger
```

Détail et exception nommée (`STRIPE.webhookSecret`) : [INTEGRATED_API.md](INTEGRATED_API.md).

## 0.1 Frontières

| Frontière | Ce qui la traverse | Ce qui ne la traverse jamais |
|---|---|---|
| SB Auto ↔ Panel | intentions métier bornées (capacités) | credentials fournisseur, requêtes brutes |
| Backend ↔ Manager | contrats d'API | l'état métier de référence (il vit côté backend) |
| Démarrage ↔ services de fond | la frontière `STRUCTURAL_RECOVERY_COMPLETE` | un worker qui observerait un état non réparé |
| Exécution ↔ observation d'un déploiement | un instantané de run | la propriété du travail (elle reste au backend) |
| Config fournisseur ↔ config métier | rien : ce sont deux domaines | une clé fournisseur dans un écran métier |

## 0.2 Interdits

Invariants qu'une évolution ne doit pas casser. Chacun est verrouillé par au
moins un test d'architecture.

```
Aucun credential fournisseur administrable dans le Manager SB Auto
Aucun appel direct vers un fournisseur sous autorité Panel
Aucun repli sur un credential local quand une capacité échoue
Aucun service de fond démarré avant les reprises structurelles
Aucune « API PRÊTE » avant que les invariants passent
Aucun déploiement possédé par l'observateur HTTP ou par la page React
Aucun état métier de déploiement accumulé uniquement dans React
Aucune déconnexion d'observateur interprétée comme une annulation
```

## 0.3 Cycle de vie du démarrage

Ordre réel des sections, vocabulaire du code :

```
Port HTTP ouvert — /healthz et /readyz répondent, routes métier en 503 SERVICE_STARTING
   |
CORE                    Mongo, clé de chiffrement, comptes, singletons, module e-mail,
                        migrations, catalogue IntegratedAPI, purge des credentials morts
   |
PANEL                   hydratePairing() — l'appairage persistant est rechargé
                        hydrateConsumption() — le CURSEUR de consommation est rechargé
   |
INTEGRATED APIs         classification par fournisseur (aucune credential locale attendue)
   |
REPRISES                reprises structurelles ET métier, AVANT tout worker
   |
STRUCTURAL INVARIANTS   frontière STRUCTURAL_RECOVERY_COMPLETE
   |
BACKGROUND SERVICES     ordonnanceur du pont, heartbeat, sync, tunnel, réconciliation
   |
SERVICE INVARIANTS      un seul écouteur, aucun service en double, tout est enregistré
                        pour l'extinction
   |
INVARIANTS              blockingErrors = 0
   |
API PRÊTE
```

Verdicts d'un contrôle : `OK` · `NOT_REQUIRED` · `DEGRADED` · `FAILED`.
États IntegratedAPI : `DISABLED` · `NOT_REQUIRED` · `DEFERRED` · `READY` ·
`RECONCILING` · `READY_RECONCILED` · `DEGRADED_RETRYING` · `FAILED_BLOCKING`.
Disponibilité : `STARTING` → `READY` → `DRAINING`.

**Pourquoi le port s'ouvre en premier** : pour qu'un démarrage soit *observable*
(`/readyz`) sans être *exploitable*. Les routes métier refusent explicitement
pendant `STARTING` plutôt que de servir sur un état à moitié réparé.

**L'invariant majeur** : aucun service de fond ne peut observer un état que le
démarrage doit encore réparer. Les reprises (destinations de déploiement,
registre de ports, médias, marqueur de redémarrage, runs orphelins et leur
finalisation) passent donc *avant* `BACKGROUND SERVICES`.

**`DEFERRED`** : un travail dû mais en attente d'une dépendance explicite reste
**armé**. Le défaut historique — réconciliation Stripe sautée faute d'appairage,
puis jamais reprise — n'existe plus.

**Pourquoi le curseur se réhydrate ici** : dans `PANEL`, juste après
l'appairage, parce qu'un curseur n'a de sens que rapporté au projet et à la
génération auxquels il appartient — et avant `BACKGROUND SERVICES`, parce que
l'ordonnanceur du pont tirerait sinon depuis l'origine du journal au premier
cycle. Le contrôle s'appelle « Curseur de consommation ».

Procédures : [PROTOCOL.md](PROTOCOL.md).

## 1. Backend

Architecture en couches, **aucune logique métier dans les routes**.

```
backend/src/
├── config/         env (dual-DB), db (connexion), bootstrap (seeds + migrations idempotents)
├── models/         Schémas Mongoose (User, Company, Service, Review, Faq,
│                   BeforeAfter, PromotionBanner, SystemConfiguration, Theme,
│                   ManagerTheme, SiteStatus, DevCompany, TeamMember)
├── services/       Logique métier (auth, upload, storage — balayage anti-orphelins)
├── controllers/    Orchestration requête/réponse (fins, sans logique lourde)
├── middlewares/    auth (JWT + rôles), validate (Zod), upload (Multer), error
├── validators/     Schémas Zod par ressource
├── routes/         Déclaration des endpoints + garde de rôle
├── utils/          ApiError, asyncHandler, apiResponse, crudFactory,
│                   singletonFactory, slug, logger, constants
└── scripts/        seed.js, smoke-test.js (102 assertions), verify-extras.js,
    │               promote.test.js (52 assertions), cleanup-uploads.js (GC médias),
    │               promote-test-to-prod.js, verify-test-prod-parity.js
    └── lib/         promotion-core.js (moteur TEST→PROD), promotion-report.js
```

Au démarrage, `bootstrap.js` (idempotent) : crée les comptes DEV/ADMIN et les
singletons ; migre `prestations` → `packs` ; initialise `signer` à `null` sur les
fiches Entreprise antérieures aux signataires contractuels
([CONTRACT_SIGNERS.md](./CONTRACT_SIGNERS.md)). **En TEST uniquement**, il seed 20 avis
+ 5 FAQ (si vides) et répartit les prestations complémentaires & suppléments dans
les catégories. **En PROD, aucun seed de démonstration n'est injecté** (garde
`!config.isProd`) : PROD est alimentée exclusivement par la promotion contrôlée
TEST→PROD (voir [TEST_TO_PROD_MIGRATION.md](TEST_TO_PROD_MIGRATION.md)).

### Système d'environnement (dual-DB)

Une seule variable `ENV` pilote toute l'application. Le cluster MongoDB est le
même (`MONGODB_URI`), **seul le nom de la base change** :

```
ENV=TEST  →  MONGODB_URI + dbName = DB_TEST
ENV=PROD  →  MONGODB_URI + dbName = DB_PROD
```

Résolu **une seule fois** dans [`config/env.js`](../backend/src/config/env.js) ; la
connexion passe `dbName` à Mongoose. Aucun autre changement n'est nécessaire pour
basculer d'environnement.

### Authentification & rôles

- JWT (`Authorization: Bearer <token>`), mots de passe hachés (bcrypt).
- Deux rôles : **DEV** (superset — accès total) et **ADMIN**.
- `authorize(...roles)` : DEV passe toujours ; sinon le rôle doit être autorisé.
- Comptes créés automatiquement au premier lancement (bootstrap idempotent).

### Facteurs de qualité

- `crudFactory` / `singletonFactory` : zéro duplication pour les ressources standard.
- Enveloppe de réponse cohérente `{ success, data }` / `{ success, message, details }`.
- Gestion d'erreurs centralisée (Zod, Mongoose, cast, duplication clé, 500).
- Upload : Multer (mémoire) → Sharp (redimensionnement + WebP / favicon PNG).
- Cycle de vie des médias : balayage anti-orphelins référence-compté (`storage.service.js`)
  déclenché après toute mutation ; aucun fichier upload ne s'accumule (voir « Cycle de
  vie des médias »).

## 2. Manager (back-office)

```
manager/src/
├── lib/            api (client typé), utils, contractProgress + signatureZones
│                   + signer + saveState + duration
│                   (modules PURS, testés par `npm test`)
├── types/          Types partagés (miroir des modèles backend)
├── context/        Auth, ManagerTheme (live), SiteStatus (bannière)
├── hooks/          useResource (fetch), useAction (mutation + toast),
│                   useFloatingSave (référence + cycle d'enregistrement)
├── components/
│   ├── ui/         Kit shadcn-like (Button, Input, Card, Dialog, Switch,
│   │               FieldGroup, SegmentedControl, FloatingSaveWidget + Fab…)
│   ├── layout/     Sidebar, AppLayout, SuspensionBanner, PageHeader
│   ├── fields/     ImageUpload, ColorField, DurationField
│   └── services/   GalleryManager (dnd-kit), PrestationEditor (éditeur de pack)
│                   (Services = arbre service > catégorie > pack + modales ;
│                    prestations complémentaires & suppléments gérés dans la catégorie)
├── config/         nav (menu + gating rôle), constants
└── pages/          Une page par entrée de menu (+ pages DEV)
```

- Thème du manager piloté par variables CSS `--m-*` (modifiable par DEV, en direct).
- Routing protégé : `RequireAuth` + `RequireDev`. Le menu filtre déjà par rôle.
- Toutes les pages animées (Framer Motion), toasts (Sonner), responsive (drawer mobile).
- `@media (prefers-reduced-motion)` global dans `index.css` : les composants
  framer-motion honorent `useReducedMotion()`, mais les transitions CSS ne passent
  pas par lui. Les états restent atteints, l'interpolation est supprimée.

### Pattern d'édition — `FloatingSaveWidget`

Les pages d'édition n'utilisent **pas** react-hook-form : la ressource chargée par
`useResource` **est** le brouillon (`data` / `setData`), sans copie de référence.
`useFloatingSave` tient cette référence et pilote un bouton flottant toujours
visible, aux 4 états uniformes (`idle` / `dirty` / `saving` / `saved`).

- Pleine page (Entreprise, Contacts, Thèmes, Entreprise dév.) + configurateur de
  signature. Les écrans à modale gardent leur pied de page.
- Invariant testé exhaustivement : « ✓ Enregistré » ne peut pas s'afficher sur un
  formulaire modifié (`dirty` prime sur `saved`).
- `onSave` **doit propager ses erreurs** (le toast vient de `useAction`) et
  renvoyer ce qu'affiche l'écran après coup — c'est la nouvelle référence.

Détail complet : [RX_UX_POLISH_MANAGER_02.md](RX_UX_POLISH_MANAGER_02.md).

## 3. Vitrine (site public)

```
vitrine/src/
├── lib/            api (public), utils (formatage, liens médias)
├── context/        SiteData (bootstrap + application thème/favicon/titre)
├── components/     ui, Navbar (+ drawer mobile animé), Footer, Loader, Coverflow,
│                   ServicesCarousel, ReviewsCarousel, Lightbox, GoogleLogo, MediaIcon,
│                   BeforeAfterSlider, OpeningHours, PromoBanner, PromoBannerView, Countdown
└── pages/          Home, Service, AvantApres, Contact, Suspended, NotFound
```

- Un seul appel `GET /api/public/bootstrap` fournit tout le contenu (company, thème, services, avis, FAQ…).
- `Coverflow` : carrousel 3D « coverflow » réutilisable (services, avis, prestations).
- Page service : catégories en **onglets** (flèche accent) pilotant un **carrousel de prestations**.
- **Thème = palette réduite de 4 couleurs** (fond, texte, principale, accent). Toutes les
  autres nuances (secondaire, atténué, bordures) sont **dérivées via `color-mix` en CSS** —
  aucune couleur codée en dur. Défaut : thème sombre noir / bleu / blanc.
- Si le site est suspendu, le bootstrap renvoie `suspended: true` → page unique.

## Modules Avant/Après · Horaires · Bannières promo

**Avant / Après** — modèle `BeforeAfter` (titre, description, `imageBefore`,
`imageAfter`, `order`, `active`). CRUD ADMIN via `crudFactory` (+reorder) ; le
bootstrap public n'expose que les actifs triés. Slider partagé `BeforeAfterSlider`
(souris/tactile/clavier, `clip-path`) réutilisé à l'identique manager ↔ vitrine.

**Horaires** — sous-documents `Company.businessHours` : 7 jours (**ids stables**
`monday`…`sunday`), `isOpen` + plusieurs créneaux `HH:MM`. `Company.timezone`
(défaut `Europe/Paris`). Validation Zod (format, fin>début, chevauchements, fuseau
IANA). Statut « ouvert/fermé » calculé **dans le fuseau** par
`utils/openingStatus.js` (backend) et reproduit à l'identique côté vitrine
(`lib/openingStatus.ts`, rafraîchi toutes les 30 s).

**Bannières promo** — modèle `PromotionBanner` (textes, CTA, couleurs,
`startAt`/`endAt`, timer optionnel `timerTarget`, `active`, `priority`). Statuts
**dérivés** (disabled/scheduled/active/expired) et **sélection unique testée**
(`utils/bannerSelection.js`) : priorité la plus haute, puis `startAt` le plus
ancien. Le bootstrap public ne renvoie **que** `activePromotionBanner` (ou `null`).
Limites de caractères partagées (`PROMO_LIMITS` : 60 / 90 / 24). Côté vitrine, la
bannière est fixe sous le header (hauteur → `--promo-h` qui décale navbar/contenu),
avec compte à rebours (date absolue) et fermeture en `sessionStorage`.

## Configuration système — section `network` (DEV)

Singleton `SystemConfiguration` (extensible ; V1 = section `network` uniquement)
stockant les **origines publiques** `backendUrl` / `managerUrl` / `websiteUrl`
(+ `updatedBy`). **Aucun secret en base.**

- **Le paradoxe du bootstrap** : un front ne peut pas « découvrir » l'URL du
  backend depuis le backend qu'il ne connaît pas encore. `VITE_API_URL` fournit
  donc l'URL **initiale** (relative `/api` en dev → proxy Vite). Une fois l'API
  jointe, les valeurs du singleton servent aux **liens applicatifs** (« Voir la
  vitrine »), à l'**URL canonique** et à la **résolution des médias**. La base API
  n'est **pas** basculée dynamiquement en V1 (prévisibilité > magie).
- **Normalisation** (`utils/normalizeAppUrl.js`) : origines http/https uniquement,
  sans chemin/query/identifiants, slash final retiré.
- **Test de joignabilité SSRF-safe** (`utils/urlProbe.js`) : DNS + refus des IP
  loopback/privées/link-local/metadata, timeout 5 s, HEAD→GET sans corps, aucune
  redirection suivie. `localhost` autorisé en **TEST**, refusé en **PROD**.
- **CORS dynamique** (`config/corsOrigins.js`) : origines `.env` (secours) ∪
  `managerUrl`/`websiteUrl` configurées ; cache mémoire rafraîchi au bootstrap et
  après chaque sauvegarde — aucune requête Mongo par requête HTTP. Jamais `*` avec
  credentials. Changer `VITE_API_URL`/`PUBLIC_URL` (env) nécessite un redémarrage ;
  changer les origines CORS configurées est pris en compte à chaud.
- **Médias** : les uploads sont stockés en URL **absolue** (via `PUBLIC_URL`).
  `resolveMediaUrl()` (helper unique par front) les renvoie tels quels et préfixe
  tout chemin relatif avec `backendUrl` — pas de migration des données existantes.

## Promotion des données TEST → PROD

Moteur dédié ([`scripts/lib/promotion-core.js`](../backend/src/scripts/lib/promotion-core.js))
**indépendant de `ENV`** : deux clients MongoDB **distincts** (source `DB_TEST` en
lecture seule, destination `DB_PROD`). Il découvre automatiquement les collections
(hors `system.*` et parasites `TEST`/`PROD`), copie fidèlement les documents (types
BSON préservés : `_id`, `Date`, `Decimal128`, `Buffer`) et recrée les index
(unique/TTL). Empreintes **SHA-256 déterministes** (EJSON canonique trié par `_id`)
pour prouver la **parité** PROD↔TEST et que **TEST reste inchangée**. Contrôles
d'intégrité (singletons uniques, comptes, références), scans d'URLs `localhost`/
`ngrok`, de secrets (chemin de champ seulement) et d'uploads (manifest). Modes
`--audit` / `--dry-run` / `--apply` (+ `--reset-prod`), confirmation explicite,
sauvegarde PROD, rapports JSON+MD sans secret. Détails :
[TEST_TO_PROD_MIGRATION.md](TEST_TO_PROD_MIGRATION.md).

## Cycle de vie des médias (uploads)

Les fichiers uploadés vivent sur le disque dans `backend/uploads/`, servis en
lecture seule sous `/uploads/`, et sont référencés par leur **URL** dans les
documents (logos, bannières d'accueil/service, galeries, avant/après, **photo +
images jointes des avis**, etc.). Un remplacement ou une suppression laissait
auparavant le fichier physique orphelin → croissance illimitée du stockage.

**Contrainte structurelle** : `uploads/` est un dossier **unique et partagé**
entre TEST et PROD (même disque, même cluster ; seul le nom de base change).
PROD ayant été initialisée par copie de TEST, les deux bases peuvent référencer
le **même fichier**. Une suppression « à la mutation » casserait donc l'autre base.

**Solution** ([`services/storage.service.js`](../backend/src/services/storage.service.js)) :
balayage anti-orphelins **référence-compté avec période de grâce**.
- Un fichier n'est supprimé que s'il n'est référencé par **aucun document de
  `DB_TEST` ∪ `DB_PROD`** ET plus vieux que la grâce (1 h — protège les uploads
  en cours d'édition, l'`ImageUpload` du manager envoyant le fichier avant
  l'enregistrement du document).
- **Automatique** : un middleware global (`app.js`) programme un balayage
  **débattu (15 s) et fire-and-forget** après toute mutation HTTP réussie (non-GET,
  2xx). Aucun câblage par contrôleur, aucun risque de casser l'autre base.
- **Manuel** : `npm run uploads:cleanup` (dry-run) / `uploads:cleanup:apply`
  (`--grace=<min>`, défaut 0) via [`scripts/cleanup-uploads.js`](../backend/src/scripts/cleanup-uploads.js).

## Flux de données

```
Vitrine  ──GET /api/public/bootstrap──▶  Backend ──▶ MongoDB (TEST|PROD selon ENV)
Manager  ──JWT──▶ /api/(company|services|reviews|theme|…) ──▶ MongoDB
Upload   ──multipart──▶ Multer ──▶ Sharp ──▶ /uploads/*.webp ──▶ URL stockée en base
Mutation ──2xx──▶ balayage anti-orphelins débattu ──▶ suppression fichiers non référencés
```

## Couche déploiement — le travail appartient au backend

> Moteur : [DEPLOYMENT_ENGINE.md](DEPLOYMENT_ENGINE.md). Incidents :
> [PROTOCOL.md](PROTOCOL.md#incident--déploiement).

**Un déploiement appartient au backend, jamais à la connexion HTTP qui l'a lancé
ni à la page React qui l'affiche.** C'est l'invariant dont découle tout le reste.

```
POST /deployment/.../deploy   (flux NDJSON)
   |
   +--> run.created           le frontend apprend le runId…
   |                          …puis DÉTACHE le POST (abort)
   v
DeploymentRun persisté        ← la progression de RÉFÉRENCE
   ^
   |  GET /deployment/runs/:id/observe   (lecture seule, reconnectable)
   |
DeploymentFollowUp            vue métier UNIQUE
```

Découverte au montage : `GET /deployment/runs/active` rend `active` (un run en
cours) **et** `latest` (le dernier terminé). Un run achevé pendant une absence
reste donc lisible au retour — la seconde valeur existe précisément pour ça.

Le frontend peut quitter la page, revenir, recharger, fermer l'onglet, en ouvrir
un second : il retrouve le **même** `runId`, et le moteur n'est jamais relancé.
Ces invariants sont prouvés dans un Chromium réel
(`manager/scripts/recette-deploiement-live.mjs`).

**Aucun état métier n'est accumulé dans React.** Lancement, reprise,
rechargement et multi-onglets empruntent le même chemin : un observateur, un
`DeploymentRunSnapshot`, une vue.

### Redémarrage du backend pendant un déploiement

Deux choses distinctes, souvent confondues :

| | Ce qui se passe |
|---|---|
| **Reprise d'observation** | le frontend se rebranche sur le run |
| **Reprise d'exécution** | *n'existe pas* |

Un run interrompu par un redémarrage n'est pas relancé : `recoverOrphanRuns()`
le **finalise**, et l'interface retrouve un résultat persistant. Le dire
franchement vaut mieux qu'une reprise imaginaire.

Pendant l'indisponibilité, l'observateur reconnaît une coupure transitoire,
affiche « Redémarrage du serveur… », recule de façon **bornée**, redemande l'état
du run, puis reprend. Si le service ne revient pas, il le dit — un spinner
éternel laisserait croire à un travail suivi alors que plus personne ne répond.

## Couche intégrations & contrats

> **Les routes `/api/integrated-apis` n'existent plus.** Les quatre fournisseurs
> sont administrés par le Panel L.Y Solution : voir [INTEGRATED_API.md](INTEGRATED_API.md).
> Le projet conserve son catalogue (identité, autorité, classification au
> démarrage) et invoque des capacités bornées.

```
Panel L.Y Solution ──▶ credentials + configuration fournisseur
                          │
                          ▼  capacités bornées (Panel Bridge)
Contrats ─▶ contract.service ─▶ Yousign (signature) / Stripe (paiement)
   │             │ machine à états (DRAFT…ACTIVE…ENDED)
   │             ▼
   │        contractDocument (PDF privé : original|signed, pdf-lib)
   ▼
Webhooks (raw body, HMAC, idempotents) ─▶ contractWebhook.service ─▶ état contrat
                                                                       │
Enforcement : site accessible = !suspensionTechnique && contrat honoré ◀┘
Réconciliation (CLI/endpoint) = filet de sécurité si webhook perdu
```

Couches : `models/` (registre + contrat + payment/invoice/webhookEvent/audit),
`services/` (crypto, résolveur, state machine, providers Stripe/Yousign, webhooks,
enforcement, réconciliation), `controllers/` fins, `routes/` (DEV/ADMIN/webhooks).

## L'entreprise CLIENTE vient du Panel — et sans elle, rien ne part

> **Ce projet ne sait pas à qui il facture ; il l'apprend.** L'identité
> juridique du client — raison sociale, SIREN, adresse de facturation,
> signataire contractuel — est tenue dans le Panel et publiée ici par la
> projection `CLIENT_COMPANY` (contrat ≥ 1.10.0), **nominativement**.
>
> Elle était auparavant introuvable : le système connaissait un projet, un
> contrat et une fiche d'affichage `Company`, dont aucun n'est un acheteur.
> Une facture réellement émise portait « Facturer à : CTR-2026-0002 » — un
> numéro de contrat en guise de personne morale.
>
> **Lecture seule, sans exception.** Aucune route d'écriture, aucune
> projection sortante, aucun formulaire. Pouvoir l'écrire reviendrait à
> laisser un client choisir la raison sociale sur laquelle il est facturé et
> la personne qui l'engage.
>
> **Absente, tout s'arrête** — et ce n'est pas une couleur de bouton :
>
> ```text
> aucune entreprise rattachée   → aucun paiement, aucune signature
> facturation incomplète        → aucun paiement
> signataire absent             → aucune signature
> ```
>
> Le refus **autoritatif** vit côté Panel, au point d'usage de la capacité :
> il tombe avant tout contact fournisseur. Les gardes locales
> (`billingReadiness()` / `signingReadiness()`) existent pour EXPLIQUER avant
> de faire cliquer — jamais pour protéger seules.
>
> Le message affiché ne dit **jamais** « configurez-le ici » : le lecteur n'a
> pas ce pouvoir. Il renvoie vers `contacts.publicContactEmail`, publié par le
> Panel.
>
> Ne pas confondre avec `DEV_COMPANY` : l'une est le prestataire, diffusée à
> tout le parc ; l'autre est le client de CE projet, et de lui seul.
>
> Voir [CLIENT_COMPANY.md](CLIENT_COMPANY.md).

## Le pont RETIENT ce qu'il a consommé

> **Le curseur de tirage est persisté** (`BridgeSyncState`), pas gardé dans une
> propriété d'instance. Il ne survivait auparavant ni à un redémarrage, ni à
> une release : chaque relance repartait de l'origine du journal.
>
> L'idempotence (LWW sur `modifiedAt`, anti-rejeu par `writeId`) évitait la
> corruption. Elle n'évitait ni le coût, ni le bruit, ni — surtout —
> l'impossibilité pour le Panel de savoir ce que ce projet avait réellement
> consommé.
>
> **Deux remises à zéro légitimes, et deux seulement** : le `projectId` a
> changé, ou la `generation` a changé. Dans les deux cas le journal d'en face
> n'est plus le même. Un Panel redémarré, un projet redéployé dans le même
> monde, un curseur ancien ne sont **pas** des raisons de repartir de zéro :
> c'est le cas nominal que ce mécanisme sert.
>
> Un troisième cas déclenche une remise à zéro **nommée** : le Panel refuse le
> curseur (`BRIDGE_INVALID_PAYLOAD`). Sans traitement, ce refus serait
> définitif — le curseur invalide est persisté, chaque cycle le renvoie, chaque
> cycle est refusé — et la persistance ferait survivre la panne aux
> redémarrages.
>
> **Aucun ensemble infini n'est sérialisé** : la fenêtre d'idempotence
> intra-page est BORNÉE, et le garde-fou anti-écho local reste en mémoire —
> après un redémarrage, plus aucune écriture en vol ne peut revenir.
>
> Le battement en **rend compte** au Panel (`bridgeStats.consumption`), pour
> qu'un tirage mort cesse d'être invisible derrière une file sortante vide.
>
> Voir [PANEL_BRIDGE.md](PANEL_BRIDGE.md) § 7 sexies.

## Signature : l'identité du prestataire vient du Panel

> **Le signataire qui engage l'entreprise développeur est publié par le Panel**,
> une fois, pour tout le parc — jamais configuré projet par projet, jamais
> dérivé d'un compte utilisateur.
>
> Un compte Panel porte `email`, `role`, `enabled`, `displayName`. Une demande
> Yousign exige `firstName`, `lastName`, `email`. Dériver l'un de l'autre
> reviendrait à fabriquer une identité civile sur un acte juridique.
>
> Absente, la validation **refuse** (`PLATFORM_SIGNER_NOT_CONFIGURED`) sans
> appeler le fournisseur. Présente, elle est **figée** dans le contrat au moment
> de la validation : l'historique ne bouge plus.
>
> Voir `docs/PROTOCOL.md` § *Signataire de l'entreprise développeur*.
>
> **Depuis le chantier « entreprise cliente », la partie CLIENT suit la même
> règle** : son signataire vient de `PanelClientCompany.contractualSigner`, et
> non plus de `Company.signer` éditée ici. Le champ local survit, inerte : le
> contrôleur le retire silencieusement des écritures, et plus rien ne le lit.
> Voir [CONTRACT_SIGNERS.md](CONTRACT_SIGNERS.md).

## Le contact public du prestataire vient du Panel, comme un CHAMP

> **L'adresse que le pied d'un e-mail client invite à écrire est publiée par le
> Panel** (`contacts.publicContactEmail`), au même titre que le nom, le logo et
> le signataire. Ce projet la lit ; il ne la calcule pas.
>
> Elle était auparavant déduite de l'ordre de `references[]` — la liste de liens
> de l'agence. Le contact de tous les clients dépendait donc d'un tri fait pour
> des raisons d'affichage, et aucun écran ne l'annonçait.
>
> Elle n'est ni l'expéditeur du parc — un `From` peut être une boîte technique
> que personne ne relève —, ni `contacts.supportEmail`, qui est l'adresse
> transmise à Let's Encrypt.
>
> Absente, `billingVariableResolver` **refuse** l'envoi plutôt que d'inventer un
> repli. Un Panel antérieur au champ (valeur `undefined`) conserve l'ancienne
> déduction, le temps de sa mise à niveau.
>
> Voir `docs/PROTOCOL.md` § *`developer.supportEmail`*.

## Un refus ATTENDU n’est pas une panne

> **Les codes `CAPABILITY_*` n’étaient dans aucune table de statut.** Ils
> retombaient donc sur `500`, et le gestionnaire d’erreurs masquait au passage
> leur message — un 500 non intentionnel ne doit rien divulguer.
>
> Concrètement : un client dont l’entreprise est incomplète cliquait « Payer »
> et lisait « Erreur serveur ». Le Panel avait pourtant répondu un 409
> parfaitement motivé ; il était perdu à la traversée.
>
> ```text
> 409  l’état courant interdit l’action — dossier incomplet, acte en vol
> 403  la ressource n’appartient pas à ce projet
> 422  charge utile valide en JSON, invalide au contrat du Panel
> 503  fournisseur ou plan de contrôle indisponible — réessayable
> 502  le Panel ne sert pas cette capacité — versions désaccordées
> 500  bogue interne, et rien d’autre
> ```
>
> Les gardes LOCALES suivent la même règle : « aucune entreprise cliente »
> répond **409**, plus 400. La requête est bien formée — c’est la situation
> qui interdit, et un 400 enverrait le client chercher une faute chez lui.
>
> Le corps porte `code` (la nature) **et** `reason` (le motif), remonté à la
> racine. Il était enfoui dans `details.panelDetails.reason`, où aucun écran
> n’allait le chercher.

## Un refus de fournisseur se NOMME, il ne se relaie pas

> **Le Panel ne transmet jamais la phrase d'un fournisseur ; il en rend un motif
> stable.** Une phrase n'est pas contractuelle, peut être reformulée sans
> préavis, et peut porter une valeur qui n'a rien à faire chez un projet.
>
> Mais un refus sans motif ne vaut pas mieux. `signature.request.open` rendait
> « Entrée refusée par « signature.request.open ». » quand Yousign refusait sans
> nommer de champ — ce qui arrive dès que la cause est une **règle de compte** et
> non une donnée. Le message envoyait alors chercher un défaut de payload
> inexistant.
>
> Le Panel RECONNAÎT donc les refus qu'il sait nommer et émet `reason`. Le projet
> le traduit en message d'action. Ni relais aveugle, ni silence.
>
> La liste des motifs s'allonge par l'expérience : un refus qu'on a su
> diagnostiquer une fois ne doit plus jamais coûter une enquête.

## Le payload d'une capacité se valide contre le schéma de l'AUTRE dépôt

> **Un producteur de payload doit être pur et testable, et sa cible doit être le
> schéma réel — pas une copie.**
>
> Le payload de `signature.request.open` était construit dans le corps de
> l'invocation : il n'était éprouvable qu'en appelant réellement le Panel,
> c'est-à-dire jamais dans une suite. Une divergence ne se serait découverte
> qu'en production.
>
> `buildSignatureOpenPayload()` est désormais pure ; la suite de parité importe
> `capabilityRegistry.js` du dépôt voisin et y valide le payload. Deux schémas
> écrits à la main dériveraient en silence — exactement le défaut surveillé.
>
> Dépôt voisin absent → contrôle **NON VÉRIFIÉ**, jamais « vert ».

## Assets `immutable` : l'URL porte la release

> **Un asset servi `immutable` doit changer d'URL quand sa représentation de
> release change — pas seulement quand ses octets changent.**
>
> L'empreinte Vite porte le CONTENU. Elle ne suffit pas : un type MIME corrigé
> côté serveur laisse l'URL identique, et un navigateur ayant mis en cache la
> mauvaise réponse sous `immutable, max-age=1an` ne la redemande jamais.
>
> L'URL du worker PDF porte donc `?build=<révision>`, injectée au build par le
> moteur de déploiement depuis l'horodatage de l'artefact. Stable par release,
> différente à la suivante.
>
> Voir `docs/PROTOCOL.md` § *Cache `immutable`*.

## Médias et documents : une seule autorité, jamais deux disques

> **Le backend DÉPLOYÉ du projet est l'autorité de ses médias ET de ses
> documents de contrat.** Toute autre instance — un poste de développement, par
> exemple — est un CLIENT : elle relaie en portant le jeton de l'appelant, et
> ne stocke rien.
>
> ```text
> Manager local    → backend local (relais)  ─┐
> Manager déployé  → backend canonique       ─┼→ un SEUL stockage
> Vitrine          → backend canonique       ─┘
> ```
>
> Il n'y a qu'un dossier : rien n'est copié dans les deux sens, et un document
> supprimé l'est là où il vit réellement — donc partout, au même instant.
>
> Les PDF de contrat suivaient auparavant une autre voie : ils s'écrivaient sur
> le disque de l'instance qui recevait l'import. Un contrat déposé en local
> n'existait que là, et l'éditeur de zones du Manager déployé ouvrait un
> document introuvable. Ils empruntent désormais `projectMediaAuthority`,
> exactement comme les images.
>
> **Aucun repli local si l'autorité est injoignable** : l'opération échoue et le
> dit. Un repli recréerait les deux vérités que cette règle supprime.
>
> Voir `docs/PROTOCOL.md` § *PDF de contrat*.

## Réseau public : ce projet DÉCLARE, le Panel REFLÈTE

> **L'autorité de l'adresse publique est ce projet, et le Panel n'en fige plus
> aucune.** `SystemConfiguration.network` est la seule source ; elle voyage par
> deux canaux du pont (contrat **1.9.0**) :
>
> ```text
> Heartbeat.runtime.network      à chaque BEAT   OPÉRATIONNEL — « je réponds ICI »
> PROJECT_PRESENTATION.network   au CHANGEMENT   DÉCLARATIF — « je vise CE domaine »
> ```
>
> Les deux ne se confondent pas : le premier alimente l'adresse opérationnelle
> du Panel, le second sa DESTINATION. Ils coïncident en production et divergent
> dès qu'un port éphémère ou un DNS en cours de bascule s'en mêle.
>
> L'invariant : **l'appairage est une relation d'identité ; l'URL publique est
> un état courant.** Le second n'est jamais figé par le premier. Le Panel
> conservait auparavant l'adresse posée au bootstrap — sa fiche annonçait
> encore `api.demo-sbauto.lycarz.com` longtemps après la migration — et seul un
> **réappairage** pouvait la corriger.
>
> Ni `APP_URL`, ni `localhost`, ni domaine historique : voir
> `services/projectBridge/runtimeNetworkAuthority.js` et `docs/PANEL_BRIDGE.md` §7 ter.

## Couche e-mail & événements métier

> **Le contenu des e-mails n'est plus ici, et l'usage n'est plus décidé
> ailleurs.** Le Panel détient les modèles (contrat de variables, texte,
> versions) ; ce projet détient la liste de ceux qu'il CONSOMME, la dérive de
> son propre code (`utils/projectEmailTemplateUsage.js`) et la DÉCLARE au Panel
> par le pont (`PROJECT_EMAIL_TEMPLATE_USAGE`, contrat 1.8.0).
>
> Conséquence : brancher un consommateur sur un modèle existant ne demande que
> le déploiement de CE projet. Voir `Panel/docs/PROTOCOL.md`.


```
Manager DEV ─▶ /api/email-configuration ─▶ EmailConfiguration (singleton)
                    │                          état PAR MODE Brevo (TEST/PROD =
                    │                          deux comptes = deux vérifications)
                    ▼
              services/brevo/ ─▶ senders (OTP natif) / domains (DKIM + code Brevo)
                    │  autorité = Brevo, jamais notre optimisme
                    ▼
Vitrine ─▶ POST /api/public/contact ─▶ ContactSubmission (seule copie du message)
              │  honeypot · délai · débit         │   PERSISTÉE D'ABORD
              │  rejet = réponse NEUTRE           │   ni IP, ni cookie, ni UA complet
              ▼                                   ▼
Opération métier réussie ─▶ emitSafe() ─▶ DomainEvent (FAIT, immuable)
   (contact, résiliation…)      │            registre code-first, payload sûr
                                │            e-mail MASQUÉ · message ABSENT
                                ▼
                        DomainEventDispatcher
                                │  matérialise (index unique = anti-doublon)
                                │  verrou atomique · retry plafonné · dead letter
                                ▼
                        EventActionExecution (une PAR destinataire)
                                │
                                └─▶ handlers : NO_OP · SEND_EMAIL
                                                   │  (s'enregistre au bootstrap)
                                                   ▼
                                    EmailReadinessService  ← passage OBLIGÉ
                                                   │  (expéditeur vérifié ? mode ?)
                                                   ▼
                                    EmailTemplateRenderer  (échappé, 1 seule passe)
                                                   │
                                                   ▼
                                    BrevoEmailProvider ─▶ POST /v3/smtp/email
                                                   │
                                                   ▼
                                    EmailDelivery (journal : SENT ≠ DELIVERED)

Manager DEV ─▶ /api/dev/email-templates ─▶ EmailTemplate + EmailTemplateVersion
                    │                        IDs et variables = CODE, contenu = base
                    └─▶ aperçu : iframe sandbox, données fictives, aucun envoi
```

Six règles structurantes :

1. **Un événement est un FAIT, une action une CONSÉQUENCE.** Un échec d'action ne
   remet jamais en cause l'opération métier — testé en coupant le journal pendant
   une résiliation.
2. **L'émission est best-effort, pas transactionnelle.** Le dépôt n'utilise aucune
   transaction et n'en a pas la garantie (mongod standalone autorisé en prod, tests
   sur MongoMemoryServer standalone). L'événement vient **après** la réussite
   métier : un crash perd la trace, jamais l'inverse.
3. **Le worker est embarqué, mono-processus.** Dispatch immédiat + reprise au
   démarrage + script `events:process`. Pas de file, pas de cron.
4. **Les templates sont code-first.** Identifiants et variables dans le code,
   contenu en base. Le Manager édite du contenu, il ne décide pas de ce qui existe
   — un identifiant créé depuis le web produirait un template que personne
   n'appelle, une variable inventée un trou à l'exécution.
5. **Le template ne connaît jamais le destinataire.** Il est résolu à l'exécution :
   sinon une adresse serait modifiable par quiconque édite un template, et figée
   dans du contenu alors qu'elle doit être recalculée à chaque envoi.
6. **`SENT` n'est pas `DELIVERED`.** `SENT` = Brevo a accepté ; seul un webhook
   pourra dire « reçu ». Aucun écran n'affirme une réception que rien ne prouve.
7. **La demande d'abord, la notification ensuite.** Une demande de contact
   enregistrée n'est **jamais** annulée par un échec de notification : le visiteur
   a écrit, perdre son message parce que Brevo répond 500 serait absurde — il n'en
   saurait rien, et personne n'aurait rien. L'échec est visible dans le Manager.
8. **Une donnée personnelle a UN domicile.** Le message d'un visiteur n'existe que
   dans `ContactSubmission` : ni dans l'événement, ni dans le journal d'envoi.
   C'est là qu'on pense à le chercher le jour d'une demande d'effacement.

> ⚠️ **Règle de développement** — toute modification du système d'édition de
> templates e-mail **doit maintenir l'onglet Guide à jour dans le même lot**
> (`manager/src/components/dev/EmailTemplateGuide.tsx`). C'est la seule
> documentation que lira le DEV qui édite un template à 23 h : périmée, elle est
> pire qu'absente — elle fait perdre du temps *et* donne une fausse assurance.
> Voir [EMAIL_TEMPLATE_EDITOR.md](EMAIL_TEMPLATE_EDITOR.md).

Détails : [CONTACT_FORM.md](CONTACT_FORM.md) ·
[CONTACT_SUBMISSIONS.md](CONTACT_SUBMISSIONS.md) ·
[CONTACT_EMAIL_NOTIFICATION.md](CONTACT_EMAIL_NOTIFICATION.md) ·
[EMAIL_TEMPLATES.md](EMAIL_TEMPLATES.md) ·
[EMAIL_RENDERING_SECURITY.md](EMAIL_RENDERING_SECURITY.md) ·
[EMAIL_DELIVERY.md](EMAIL_DELIVERY.md) ·
[EMAIL_TEMPLATE_EDITOR.md](EMAIL_TEMPLATE_EDITOR.md) ·
[DOMAIN_EVENTS.md](DOMAIN_EVENTS.md) ·
[EVENT_DISPATCHER.md](EVENT_DISPATCHER.md) ·
[EVENT_ACTION_EXECUTIONS.md](EVENT_ACTION_EXECUTIONS.md) ·
[EMAIL_CONFIGURATION.md](EMAIL_CONFIGURATION.md)
Secrets : jamais en clair en base, jamais au frontend, jamais en log.

### Parcours d'activation côté manager

L'étape courante est **dérivée** par le backend (`deriveActivationStep`) et
sérialisée sur le contrat (`contract.step`) : le manager n'en stocke aucun index.
Il la traduit en ÉCRAN (illustration, titre, montants, action) —
`components/contracts/journey/`. Le DEV et le client partagent le même
`ContractProgressTracker` et le même calcul : deux rôles, une seule vérité.

```
Stripe / Yousign ─▶ /contrat/retour-* ─▶ vérification serveur (polling borné)
                                            │ un paramètre d'URL ne prouve rien
                                            ▼
                        navigate('/contrat', { state: { celebrate } })
                                            │ le rechargement a perdu l'étape
                                            ▼            précédente : on la relaie
                        ✓ animation ─▶ écran suivant
```

`lib/journey.ts` (pur, testé) décide de ce qui est « franchi » : jamais au
premier rendu, jamais sur un recul. `/contrat` sonde tant qu'une confirmation est
attendue, uniquement onglet visible. Le retour de signature repose sur
`redirect_urls` (par signataire, **facultatif** : omis sans `managerUrl`).
Détail : [RX_CONTRACT_UX_POLISH_03.md](RX_CONTRACT_UX_POLISH_03.md).

Le parcours de signature Yousign de bout en bout (DEV→ADMIN, mapper de
coordonnées testé, PDF signé récupéré automatiquement, timeline, synchronisation)
est décrit dans [SIGNATURE.md](SIGNATURE.md). Le paiement
unique des **frais de lancement** (Stripe Checkout, journal `Payment` + projection
contrat, webhooks asynchrones, idempotence, réconciliation) est décrit dans
[STRIPE_LAUNCH_FEE_FLOW.md](STRIPE_LAUNCH_FEE_FLOW.md). L'**abonnement mensuel**
(Product/Price immuables, activation finale explicite, résiliation en fin de période,
fin effective → suspension automatique, réconciliation) est décrit dans
[STRIPE_SUBSCRIPTION_FLOW.md](STRIPE_SUBSCRIPTION_FLOW.md) ; la disponibilité du site
(entitlement technique vs contractuel) dans
[SITE_CONTRACT_ENTITLEMENT.md](SITE_CONTRACT_ENTITLEMENT.md).

---

## Cycle de vie d'un impayé — trois états, jamais confondus

> **`PAYMENT STATE`, `CONTRACTUAL ENFORCEMENT STATE` et `SITE AVAILABILITY
> STATE` sont trois choses distinctes.** Les confondre est l'erreur la plus
> coûteuse de ce domaine : elle produit soit un site fermé pour une dette que
> personne n'a décidé de sanctionner, soit une dette invisible parce que le site
> répond encore.

| État | Où il vit | Qui en est l'autorité |
|---|---|---|
| **PAYMENT** — la dette existe-t-elle ? | `PanelPaymentDefault` (Panel), projeté en `PaymentDefaultIncident` | le prestataire de paiement, constaté par le Panel |
| **CONTRACTUAL ENFORCEMENT** — a-t-on le droit de fermer ? | `Contract.paymentGraceDays` + `SiteStatus.contractProtectionEnabled` | le contrat |
| **SITE AVAILABILITY** — le site répond-il ? | `SiteStatus.status`, dérivé de `causes` | ce projet, et lui seul |

### La machine à états

```text
                      ┌──────────────────────────────────────────┐
                      │                  PAID                    │
                      └───────────────────┬──────────────────────┘
                                          │ invoice.payment_failed
                                          ▼
                      ┌──────────────────────────────────────────┐
   retry refusé ─────▶│              OPEN  (impayé ouvert)       │
   (attemptCount+1)   │  échéance FIGÉE au 1er refus, jamais     │
        │             │  recalculée · site TOUJOURS accessible   │
        │             └───────┬──────────────────────┬───────────┘
        │                     │                      │
        │    grâce = null     │  grâce = N jours     │ invoice.paid
        │    (non configurée) │  et échéance atteinte│
        ▼                     ▼                      ▼
  ┌───────────────┐   ┌──────────────────┐   ┌──────────────────┐
  │  reste OPEN   │   │  GRACE_EXPIRED   │   │    RESOLVED      │
  │  indéfiniment │   │ suspension       │   │ cause retirée    │
  │  AUCUNE       │   │ DEMANDÉE au      │   │ site rouvert SI  │
  │  suspension   │   │ projet           │   │ aucune AUTRE     │
  │  automatique  │   └────────┬─────────┘   │ cause            │
  └───────────────┘            │             └──────────────────┘
                               ▼                      ▲
                     ┌──────────────────┐             │
                     │ SITE SUSPENDED   │─────────────┘
                     │ source =         │  invoice.paid
                     │ PAYMENT_DEFAULT  │  (même APRÈS fermeture)
                     └──────────────────┘
```

### Ce que chaque état déclenche

| Transition | Événement métier | Message | Destinataire |
|---|---|---|---|
| `— → OPEN` | `contract.payment.overdue` | `CONTRACT_PAYMENT_OVERDUE_ADMIN` | admins projet |
| `OPEN → OPEN` (**compteur +1**) | `contract.payment.retry_failed` | `CONTRACT_PAYMENT_RETRY_FAILED_ADMIN` | admins projet |
| `→ GRACE_EXPIRED` | `contract.payment.overdue_critical` | `CONTRACT_PAYMENT_OVERDUE_CRITICAL_ADMIN` | admins projet |
| suspension confirmée | *(Panel)* | `SITE_SUSPENDED_PAYMENT_DEFAULT_CLIENT` / `_TEAM` | client + équipe Panel |
| `→ RESOLVED` | `contract.payment.recovered` | `CONTRACT_PAYMENT_RECOVERED_ADMIN` | admins projet |
| encaissement projeté | *(Panel)* | `PAYMENT_CONFIRMED_ADMIN` + `PROJECT_PAYMENT_CONFIRMED_SUPER_ADMIN` | admins projet + SUPER_ADMIN Panel |

### La relance, et pourquoi elle ne se répète pas à tort

Une relance part à **chaque tentative réellement nouvelle**, jamais à chaque
livraison. Le discriminant est `attemptCount` — le compteur du prestataire,
recopié et jamais calculé :

- huit relivraisons du même webhook portent huit fois le même compteur → **un**
  message ;
- un refus logique n'incrémente le compteur qu'une fois : seul
  `invoice.payment_failed` ouvre un incident côté Panel,
  `payment_intent.payment_failed` étant explicitement non routable ;
- le compteur figure dans la clé d'idempotence
  (`payment-retry-failed:<incident>:<n>`), donc deux appliqueurs concurrents et
  un rejeu de journal complet retombent sur la même clé.

**Ce qui ne relance pas** : un compteur qui recule (rattrapage), une tentative
après l'expiration (l'alerte critique a déjà parlé), une tentative tardive sur un
impayé déjà réglé.

### Grâce NON CONFIGURÉE (`null`) — non automatisé, pas permissif

`paymentGraceDays === null` signifie « aucune politique n'a été écrite ». Le
Panel ouvre l'incident, le suit, l'affiche, relance le client — et **ne fixe
aucune échéance**. `expireDueGracePeriods` exclut explicitement les incidents
sans échéance (`graceDeadlineAt: { $ne: null, $lte: now }`) : sans ce `$ne`,
`null` précédant les dates en BSON, un contrat sans politique verrait son site
fermé au premier prélèvement refusé.

La fermeture reste une décision humaine tant que personne n'a écrit de règle.
`0` est une décision opposée : **aucune clémence**, échéance au premier refus.
Les deux traversent le pont sans jamais être confondus.

### Protection contractuelle DÉSACTIVÉE — sans effet sur la finance

`SiteStatus.contractProtectionEnabled` ne gouverne **qu'une seule chose** :
l'absence de contrat servable est-elle une cause de suspension ?

```js
const contractHonoured = protectionEnabled ? Boolean(serveable) : true;
const accessible = !technicalActive && contractHonoured && !paymentDefaultActive;
```

Désactivée, elle ne touche ni l'enregistrement de l'impayé, ni la convergence du
prestataire, ni les transactions, ni l'archivage des factures, ni les e-mails
financiers. Un impayé ferme toujours le site par sa PROPRE cause
(`paymentDefault`), qui est indépendante.

### La cause de fermeture est connue — et c'est ce qui rend la réouverture sûre

`SiteStatus.causes = { technical, contract, paymentDefault }`. Rien n'écrit
jamais `status = ACTIVE` directement : la réouverture est le RETRAIT d'une cause,
suivi du recalcul de la conjonction. Un site fermé pour maintenance **ET** pour
impayé reste fermé quand la facture est réglée.

Aucun minuteur en mémoire, aucune date recalculée au redémarrage : l'échéance
vit en base et l'ordonnanceur la relit.
