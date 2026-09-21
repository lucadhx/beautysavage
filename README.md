# L.Y Solution — vitrine, manager et API

Le site **officiel de L.Y Solution**, né par duplication du moteur certifié —
celui-là même qui sert les projets clients de la fabrique. Voir
[docs/PROJECT.md](docs/PROJECT.md) pour la fiche d’identité, les bases, les
destinations et le dépôt, et [docs/SIMPLIFICATION.md](docs/SIMPLIFICATION.md)
pour ce qui a été RETIRÉ du moteur karting et pourquoi.

C’est le seul projet du parc où l’éditeur, le concepteur et l’exploitant sont la
même entreprise. Trois applications dans un monorepo :

```
/
├── backend/    → API Node.js + Express + MongoDB (Mongoose)
├── vitrine/    → Site vitrine public (React + Vite + TS)
└── manager/    → Back-office d'administration (React + Vite + TS)
```

## Stack technique

| Domaine        | Techno                                              |
| -------------- | --------------------------------------------------- |
| Frontend       | React, TypeScript, Vite                             |
| UI             | TailwindCSS, shadcn/ui, Lucide, Framer Motion       |
| Formulaires    | React Hook Form + Zod                               |
| Drag & Drop    | dnd-kit                                             |
| Notifications  | Sonner                                              |
| Backend        | Node.js, Express, Mongoose                          |
| Auth           | JWT (rôles DEV / ADMIN)                             |
| Upload / Images| Multer + Sharp — **une seule autorité média**, balayage des orphelins |

## Modules

**Entreprise** (identité, logos, principes), **Chapitres** (le récit du site),
**Pages éditoriales** à blocs, **Demandes de projet**, **Thème dynamique**,
**Statut / suspension**. Plus le socle commun à tout le parc : contrat,
facturation, déploiement, pont Panel.

Le moteur d’origine portait NEUF référentiels de contenu — forfaits, gammes de
prix, flotte, tracés, avis, questions fréquentes, avant/après, bannières
promotionnelles, chronométrage. Ce projet en porte **DEUX**, et c’est le cœur de
la duplication :

| moteur karting | ici |
| --- | --- |
| `Service` · `PricingRange` · `Kart` · `Circuit` · `Review` · `Faq` · `BeforeAfter` · `PromotionBanner` · `LiveTiming` | `Chapter` |
| `SitePage` | `SitePage` |

**Un chapitre** — Conception, Architecture, L’Expérience L.Y — porte un
sur-titre, un titre, un chapô, jusqu’à douze volets et une phrase de clôture.
Son champ `layout` (`PILLARS` · `STEPS` · `SPLIT`) décide de la mise en scène :
les mêmes volets rendus en piliers, en étapes numérotées ou en deux espaces
opposés ne racontent pas la même chose. Voir
[`backend/src/models/Chapter.model.js`](backend/src/models/Chapter.model.js).

**Ce que le site n’a pas, et n’aura pas** : pas de page tarifs, pas de
catalogue, pas de section « nos réalisations », pas d’avis clients, pas de
bannière promotionnelle, pas d’horaires d’ouverture, pas de carte intégrée. Ce
sont des décisions du plan de site, pas des modules restés à faire.

## Environnements

Le backend gère **deux bases MongoDB** via une seule variable `ENV`.

```env
ENV=TEST                       # TEST ou PROD
MONGODB_URI=mongodb+srv://...  # un seul cluster, partagé
DB_TEST=test_base              # nom de base en TEST
DB_PROD=prod_base              # nom de base en PROD
JWT_SECRET=...
```

- `ENV=TEST` → toute l'application utilise la base `DB_TEST`
- `ENV=PROD` → toute l'application utilise la base `DB_PROD`

Le cluster MongoDB est le même : **seul le nom de la base change** entre les deux environnements.

## Premier accès d'administration

Le projet **ne crée aucun compte avec un mot de passe par défaut**. Au premier
lancement sur une base vierge, il lit `FIRST_DEV_EMAIL` dans le `.env` (écrite
par l'assistant de duplication), crée UN compte DEV **sans mot de passe** et lui
envoie un **lien d'activation à usage unique** : le développeur choisit
lui-même son secret sur `/activer-mon-compte`.

| Variable            | Rôle                                                      |
| ------------------- | --------------------------------------------------------- |
| `FIRST_DEV_EMAIL`   | destinataire du lien d'activation — **obligatoire**        |
| `FIRST_DEV_NAME`    | nom affiché (facultatif)                                   |
| `FIRST_ADMIN_EMAIL` | même mécanisme pour le compte ADMIN du client (facultatif) |

Sans `FIRST_DEV_EMAIL`, **aucun compte n'est créé** et le démarrage le signale
(`FIRST_DEV_REQUIRED`). C'est volontaire : un projet sans administrateur se
répare en une minute, un projet dont l'administrateur a une adresse publique et
un mot de passe connu ne se répare qu'après l'incident.

Le **premier administrateur**, lui, est créé pendant la duplication : l'assistant
demande son adresse et son mot de passe, et le compte est `ACTIVE` immédiatement.
Il est destiné au client, à qui l'exploitant remet ses identifiants à la
livraison. Le mot de passe est propre à chaque duplication — les secrets
historiques du parc (`123admin`, `123dev`…) sont refusés — et n'est écrit nulle
part ailleurs que haché en base.

Amorçage **idempotent** : une deuxième initialisation ne crée jamais un second
compte DEV ou ADMIN, ne modifie jamais un compte existant, et ne réinitialise
jamais un mot de passe. Un redéploiement ne peut donc pas reprendre un compte.

Deux familles de développeurs coexistent sur un projet : le **DEV local**
(ci-dessus, autonome, fonctionne sans Panel) et le **DEV L.Y Solution**
(fédéré, sans mot de passe local — voir
[docs/auth/SECURE_LOCAL_DEV_BOOTSTRAP_IMPLEMENTATION.md](docs/auth/SECURE_LOCAL_DEV_BOOTSTRAP_IMPLEMENTATION.md)).

## Déploiement : les étapes sont définies à UN seul endroit

La checklist live du déploiement, celle du préflight, leur ordre, leurs libellés
et le rapport final dérivent tous d'un unique registre :
`backend/src/deployment-engine/steps.js`.

Ajouter une étape = **une** modification, dans ce fichier. Voir
[docs/DEPLOYMENT_ENGINE.md § Deployment Phase Registry](docs/DEPLOYMENT_ENGINE.md#deployment-phase-registry).

## Duplication : les phases sont définies à UN seul endroit

La checklist en direct de l'assistant de duplication, l'ordre des étapes, leurs
libellés et le rapport final dérivent tous d'un unique registre :
`backend/src/duplication-engine/config/duplication.phases.js`.

Ajouter une phase = **une** modification, dans ce fichier. Elle apparaît alors
automatiquement dans l'interface. Voir
[docs/DUPLICATION.md § Duplication Phase Registry](docs/DUPLICATION.md#duplication-phase-registry).

## Démarrage rapide — UNE SEULE commande officielle

```bash
# Première fois : installer les dépendances des trois apps
cd backend && cp .env.example .env && npm install && cd ..
cd manager && npm install && cd ..
cd vitrine && npm install && cd ..

# Démarrage DEV canonique (backend 6100 + manager 6101 + vitrine 6102)
npm run dev
```

`npm run dev` (à la racine) exécute `scripts/dev-canonical.mjs` : il affiche
branche/commit, refuse de démarrer si un port canonique est occupé, détecte les
anciens serveurs 6060/6061 (ex-branche `feat/brevo`, dépréciée) et vérifie après
démarrage que `/health` et `/api/version` répondent avec le bon commit.

Ports canoniques (les SEULS valides) :

| Service | Port | Lancement individuel |
| ------- | ---- | -------------------- |
| Backend | 6100 | `npm run backend`    |
| Manager | 6101 | `npm run manager`    |
| Vitrine | 6102 | `npm run vitrine`    |

> ⚠️ Les ports 6060/6061 sont MORTS (ancienne branche `feat/brevo`, archivée).
> Plus aucun dossier ne les sert. Si un serveur y répond encore, arrêtez-le.

> Le backend nécessite une connexion MongoDB (`MONGODB_URI` + `DB_TEST` / `DB_PROD`).
> Les comptes de test sont créés automatiquement au premier démarrage.

## Configuration système (DEV)

Les URL publiques des trois apps (backend / manager / vitrine) se règlent depuis le
manager en **DEV** : *Configuration système › Réseau*. Elles alimentent les liens
applicatifs (« Voir la vitrine »), l'URL canonique et la résolution des médias, et
sont ajoutées dynamiquement aux origines CORS autorisées (`CORS_ORIGINS` du `.env`
restant la liste de secours). Un bouton **Tester** vérifie la joignabilité des URL
(protégé contre le SSRF). L'URL **initiale** de l'API reste `VITE_API_URL` (fichier
`.env` de chaque front) — indispensable pour joindre le backend au démarrage.

## Tester sur mobile avec ngrok

Pour tester la vitrine/le manager sur un téléphone, exposez chaque service local via
[ngrok](https://ngrok.com) :

```bash
ngrok http 6100   # backend
ngrok http 6101   # manager
ngrok http 6102   # vitrine
```

1. Lancez les 3 apps en local (`npm run dev`).
2. Ouvrez 3 tunnels ngrok, notez les URL `https://…ngrok-free.app`.
3. Mettez `VITE_API_URL` (dans `manager/.env` et `vitrine/.env`) = l'URL ngrok du
   **backend**, puis relancez les fronts.
4. En DEV, dans *Configuration système › Réseau*, renseignez les 3 URL ngrok et
   enregistrez (CORS rafraîchi à chaud).
5. Ouvrez l'URL ngrok de la vitrine sur le téléphone.

> Les URL ngrok gratuites changent à chaque redémarrage — pensez à les remettre à
> jour dans les `.env` et dans Configuration système. Détails : [docs/DUPLICATION.md](docs/DUPLICATION.md).

## Promotion des données TEST → PROD

Les vraies données vivent dans `DB_TEST`. Avant un déploiement, on initialise
`DB_PROD` avec une **copie fidèle et contrôlée** de TEST (mêmes `_id`, relations,
timestamps, mots de passe hashés, singletons) — **sans jamais modifier TEST** :

```bash
cd backend
npm run db:promote:audit      # lecture seule (compare TEST/PROD)
npm run db:promote:dry-run    # simulation (aucune écriture)
npm run db:promote -- --reset-prod   # migration réelle (confirmation requise)
npm run db:verify-prod        # parité TEST/PROD (lecture seule)
```

Procédure complète, sécurité, uploads, rollback : [docs/TEST_TO_PROD_MIGRATION.md](docs/TEST_TO_PROD_MIGRATION.md).

## Documentation

**Commencer ici : [docs/README.md](docs/README.md)** — il distingue les documents
d'autorité des rapports historiques, et dit lesquels décrivent le runtime actuel.

Autorités :

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — architecture, invariants, frontières, cycle de démarrage
- [docs/PROTOCOL.md](docs/PROTOCOL.md) — exploitation et incidents (runbook)
- [docs/PANEL_BRIDGE.md](docs/PANEL_BRIDGE.md) — pont projet ↔ Panel, capacités, appairage
- [docs/INTEGRATED_API.md](docs/INTEGRATED_API.md) — fournisseurs et autorité plateforme
- [docs/API.md](docs/API.md) — référence des endpoints
- [docs/CONTACT_FORM.md](docs/CONTACT_FORM.md) — formulaire de contact public : route, validation, anti-abus, idempotence
- [docs/CONTACT_SUBMISSIONS.md](docs/CONTACT_SUBMISSIONS.md) — demandes de contact : modèle, statuts, API Manager, rétention
- [docs/CONTACT_EMAIL_NOTIFICATION.md](docs/CONTACT_EMAIL_NOTIFICATION.md) — notification des administrateurs (événement, action, résolveurs)
- [docs/CONTACT_REAL_TEST_CHECKLIST.md](docs/CONTACT_REAL_TEST_CHECKLIST.md) — recette manuelle du formulaire
- [docs/EMAIL_TEMPLATES.md](docs/EMAIL_TEMPLATES.md) — templates e-mail : registre code-first, variables, versions
- [docs/EMAIL_TEMPLATE_EDITOR.md](docs/EMAIL_TEMPLATE_EDITOR.md) — éditeur HTML du Manager (aperçu live, guide) — ⚠️ **l'onglet Guide doit rester à jour**
- [docs/EMAIL_RENDERING_SECURITY.md](docs/EMAIL_RENDERING_SECURITY.md) — moteur de rendu, échappement, validation HTML
- [docs/EMAIL_DELIVERY.md](docs/EMAIL_DELIVERY.md) — readiness, provider Brevo, journal, idempotence (`SENT` ≠ `DELIVERED`)
- [docs/EMAIL_TEMPLATE_REAL_TEST_CHECKLIST.md](docs/EMAIL_TEMPLATE_REAL_TEST_CHECKLIST.md) — recette manuelle (envoi réel)
- [docs/SIMPLIFICATION.md](docs/SIMPLIFICATION.md) — **ce que ce projet retire au moteur karting, et pourquoi**
- [docs/DUPLICATION.md](docs/DUPLICATION.md) — dupliquer le template pour une nouvelle entreprise
- [docs/TEST_TO_PROD_MIGRATION.md](docs/TEST_TO_PROD_MIGRATION.md) — promotion des données TEST → PROD
- [docs/PRODUCTION_AUDIT.md](docs/PRODUCTION_AUDIT.md) — audit de préparation à la production (scores, correctifs, recommandations)
- [docs/VPS_DEPLOYMENT_GUIDE.md](docs/VPS_DEPLOYMENT_GUIDE.md) — déploiement VPS pas-à-pas (Nginx, PM2, HTTPS, sauvegardes, rollback)
- [docs/RAPPORT.md](docs/RAPPORT.md) — rapport final (fonctionnalités, choix, améliorations)
- [docs/RX_UX_POLISH_MANAGER_02.md](docs/RX_UX_POLISH_MANAGER_02.md) — pattern d'édition flottant, FAB du configurateur de signature, durées, toggle
- [docs/RX_CONTRACT_UX_POLISH_03.md](docs/RX_CONTRACT_UX_POLISH_03.md) — parcours d'activation en écrans guidés, vue DEV, viewer multipage, retour automatique Stripe/Yousign
- [docs/YOUSIGN_TRIAL_REDIRECT_FALLBACK.md](docs/YOUSIGN_TRIAL_REDIRECT_FALLBACK.md) — repli quand l'abonnement Yousign Trial refuse les redirections

## Intégrations, contrats & facturation

Un système sécurisé pilote les API tierces et l'activation commerciale du site :

- **IntegratedAPI** — les quatre fournisseurs (Stripe, Brevo, Yousign,
  Hostinger) sont **administrés par le Panel L.Y Solution**. Ce projet ne détient
  ni ne saisit aucun credential fournisseur : il invoque des capacités bornées
  par le Panel Bridge. Il n'existe plus de page « Intégrations API » dans le
  Manager. Voir [docs/INTEGRATED_API.md](docs/INTEGRATED_API.md) et
  [docs/PANEL_BRIDGE.md](docs/PANEL_BRIDGE.md).
- **Contrats** — machine à états, PDF + éditeur de zones de signature (viewer
  multipage), montants en centimes : [docs/CONTRACTS.md](docs/CONTRACTS.md).
  Le client (et le DEV) suivent un **parcours guidé** : chaque étape est un écran
  — signature, frais, abonnement, mise en ligne — avec retour automatique après
  Stripe/Yousign, sans rafraîchissement manuel :
  [docs/RX_CONTRACT_UX_POLISH_03.md](docs/RX_CONTRACT_UX_POLISH_03.md).
- **Signataires** — configuration par entreprise (prénom, nom, fonction, email),
  snapshot figé à la validation, jamais rétroactif :
  [docs/CONTRACT_SIGNERS.md](docs/CONTRACT_SIGNERS.md).
- **Yousign** (signature) : [docs/YOUSIGN_INTEGRATION.md](docs/YOUSIGN_INTEGRATION.md).
  Correction de l'upload + recette sandbox réelle :
  [docs/YOUSIGN_REAL_SANDBOX_FIX_REPORT.md](docs/YOUSIGN_REAL_SANDBOX_FIX_REPORT.md).
  Parcours de signature complet (DEV→ADMIN, PDF signé auto, timeline, sync) :
  [docs/YOUSIGN_SIGNATURE_FLOW.md](docs/YOUSIGN_SIGNATURE_FLOW.md).
  **Abonnement Trial** : Yousign y refuse les redirections de fin de signature —
  le parcours repart sans, plutôt que d'échouer, sans aucun réglage :
  [docs/YOUSIGN_TRIAL_REDIRECT_FALLBACK.md](docs/YOUSIGN_TRIAL_REDIRECT_FALLBACK.md).
- **Stripe** (Checkout + abonnements) : [docs/STRIPE_INTEGRATION.md](docs/STRIPE_INTEGRATION.md).
  Frais de lancement (paiement unique, webhook, réconciliation, idempotence) :
  [docs/STRIPE_LAUNCH_FEE_FLOW.md](docs/STRIPE_LAUNCH_FEE_FLOW.md). Abonnement
  mensuel + activation + résiliation + fin de contrat :
  [docs/STRIPE_SUBSCRIPTION_FLOW.md](docs/STRIPE_SUBSCRIPTION_FLOW.md). Facturation
  Stripe (historique paiements/abonnements, hosted invoice + PDF, backfill,
  typage par `billing_reason`, rattachement manuel) :
  [docs/STRIPE_BILLING.md](docs/STRIPE_BILLING.md). Correctifs UX & incident du
  typage des factures : [docs/RX_POLISH_CONTRACTS_BILLING_01.md](docs/RX_POLISH_CONTRACTS_BILLING_01.md). Disponibilité du site
  (suspension technique vs contractuelle) :
  [docs/SITE_CONTRACT_ENTITLEMENT.md](docs/SITE_CONTRACT_ENTITLEMENT.md).
- **Webhooks** (idempotents, signés) : [docs/WEBHOOKS.md](docs/WEBHOOKS.md).
- **Parcours d'activation** : [docs/CONTRACT_ACTIVATION_FLOW.md](docs/CONTRACT_ACTIVATION_FLOW.md).
- **Enforcement** (« aucun contrat actif = site suspendu ») :
  [docs/CONTRACT_ENFORCEMENT_ROLLOUT.md](docs/CONTRACT_ENFORCEMENT_ROLLOUT.md).

Nécessite `INTEGRATED_API_ENCRYPTION_KEY` dans le `.env` (voir `.env.example`).

**Webhooks Stripe en local** : aucun outil supplémentaire — exposez le backend
avec `ngrok http 6100` et lancez `npm run dev` (racine). Le backend détecte le
tunnel, calcule `https://<tunnel>/api/webhooks/stripe` et crée/aligne
l'endpoint Stripe TEST distant tout seul ; le secret `whsec_` est capturé à la
création puis stocké chiffré (jamais saisi, jamais affiché). Stripe CLI
(`stripe listen`) n'est plus utilisé par le projet. Doctrine :
[docs/GENERIC_WEBHOOK_PROVIDER_ARCHITECTURE.md](docs/GENERIC_WEBHOOK_PROVIDER_ARCHITECTURE.md).

## Vérification

Le backend dispose de plusieurs runners de test end-to-end (MongoDB in-memory) :

```bash
cd backend
npm test          # suite complète (voir docs/PROTOCOL.md pour les limites actuelles)
                  # + signataires + Stripe + frais + abonnement + factures
                  # + cycle de vie + smoke (752 assertions)
npm run test:integrated-api   # coffre-fort, résolveur env-aware, API DEV (53)
npm run test:contracts        # machine à états, montants, PDF, idempotence (38)
npm run test:yousign          # coordonnées, HMAC, ordre signataires, multipart upload (79)
npm run test:signers          # signataires : gating, snapshot figé, immuabilité, migration (64)
npm run test:stripe           # checkout, idempotence, webhook, statuts (29)
npm run test:payments         # frais de lancement : gate, webhooks, réconciliation (69)
npm run test:billing          # miroir des factures, typage billing_reason, backfill (46)
npm run test:subscriptions    # abonnement + activation + résiliation + outils recette (73)
npm run test:lifecycle        # cycle complet DEV→ADMIN + webhooks + enforcement (45)
npm run contracts:reconcile   # réconciliation (filet de sécurité webhooks)
npm run integrated-api:test:stripe   # vérification sandbox (clés TEST, lecture seule)
npm run integrated-api:test:yousign
```

```bash
cd manager
npm test          # modules purs : avancement + zones + facturation (136)
```
