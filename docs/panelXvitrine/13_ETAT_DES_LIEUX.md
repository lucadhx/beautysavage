# 13 — État des lieux : photographie factuelle de SB Auto 06

> Photographie prise le **2026-07-26**, branche `feat/unified-production-baseline`,
> HEAD `8e03c38`. C'est la base factuelle sur laquelle l'architecture
> Panel ↔ Projets a été figée. Les chemins cités sont vérifiables dans le dépôt.

---

## 1. Vue d'ensemble

Monorepo à trois applications + un orchestrateur de dev :

| Dossier | Rôle | Stack |
|---|---|---|
| `backend/` | API REST | Node ≥20 ESM, Express 4, Mongoose 8, JWT+bcrypt, Zod, Stripe SDK, ssh2 |
| `manager/` | back-office (ADMIN + DEV) | React 18, TypeScript, Vite, Tailwind, React Router |
| `vitrine/` | site public | React 18, TypeScript, Vite (sous-ensemble du kit manager) |
| `scripts/dev-canonical.mjs` | démarrage dev unique (`npm run dev` racine) | backend 6070 · manager 6071 · vitrine 6062 |

MongoDB en « dual-DB + plan de contrôle » (`backend/src/config/env.js`) :
`ENV` (`TEST`|`PROD`, **fail-closed** : le backend refuse de démarrer sinon)
choisit `DB_TEST`/`DB_PROD` ; une **troisième base** `*_control`
(`backend/src/config/controlDb.js`) porte le plan de contrôle des déploiements,
indépendante de `ENV`.

La vitrine consomme 4 endpoints publics seulement (`/api/public/bootstrap` — un
appel fournit tout le site —, `/network-configuration`, `/services/:slug`,
`POST /contact`). Le Manager consomme ~35 routeurs sous `/api`, gating
déclaratif par rôle.

## 2. Ce qui existe déjà et sert de socle au futur Panel

Points forts directement réutilisables par l'architecture cible :

- **Patron « driver + stub »** partout : `stripe.provider/stripe.stub`,
  `yousign.provider/yousign.stub`, `SshTransport/FakeTransport` → modèle du
  futur PanelBridge ([01_PANEL_CONNECTOR.md](01_PANEL_CONNECTOR.md)).
- **Version et santé exposées** : `/health`, `/api/version` (manifeste de
  build), comparaison artefact/manifeste au déploiement → socle du heartbeat et
  de la supervision.
- **Idempotence généralisée** : `WebhookEvent` (index unique
  `provider+externalEventId`), `idempotencyKey` des événements de domaine →
  socle de la redistribution de webhooks et de l'outbox.
- **Chiffrement local des secrets** : AES-256-GCM
  (`backend/src/utils/integratedApiCrypto.js`, clé
  `INTEGRATED_API_ENCRYPTION_KEY`, fail-closed en PROD) → socle du stockage des
  credentials distribués et de l'appairage.
- **Masquage systématique** : `maskSensitiveText`/`maskDeep`
  (`webhookRunReport.service.js`), `createRedactor` (rapports de déploiement) →
  standard à généraliser au Panel.
- **Tests de conformité** : `env-mode-independence.test.js`,
  `webhook-providers-uniformity.test.js`, `runtime-canonical.test.js` → patron
  des futurs tests « standalone » et « connecteur unique ».

## 3. Authentification et rôles (état)

- Deux rôles exactement : `ROLES = { DEV, ADMIN }`
  (`backend/src/utils/constants.js`). **DEV est superset** : `authorize()` le
  laisse toujours passer (`backend/src/middlewares/auth.middleware.js`).
- JWT HS256 local (`JWT_SECRET`, 7 j par défaut), utilisateur rechargé en base à
  chaque requête (révocation immédiate). Pas de session serveur, pas de refresh
  token ; token en `localStorage`.
- Comptes d'amorçage seedés (`backend/src/config/bootstrap.js`) :
  DEV `dev@mail.com` / ADMIN `admin@mail.com` (mots de passe de démo en TEST,
  aléatoires ou `SEED_*` en PROD). Dev-login sans mot de passe **uniquement**
  si `config.isTest`.
- Front : `RequireAuth`/`RequireDev` (`manager/src/components/RouteGuards.tsx`),
  navigation à deux espaces (`section: 'manager'|'dev'` dans
  `manager/src/config/nav.ts`).

## 4. Manager (état) — 13 pages DEV, 16+ pages ADMIN

Espace DEV (masqué aux ADMIN) : Configuration système, Intégrations API,
Templates e-mail, Livraisons e-mail, Événements système, Déploiement,
Déploiements (destinations), Comptes, Équipe développeur, Entreprise
développeur, Contrats, Thème manager, Couleurs des rôles.

Espace Manager (client) : Dashboard, Demandes de contact, Services, Tarifs,
Avis, Avant/Après, FAQ, Promotions, Entreprise, Contacts (coordonnées +
horaires), Thème, Statut, Mon contrat, Factures, Profil, Support.

La cartographie « reste / migre » est dans
[03_MANAGER_STANDARD.md](03_MANAGER_STANDARD.md).

## 5. IntegratedAPI et webhooks (état)

### 5.1 Le réglage TEST/PROD à deux étages

- `ENV` applicatif (env var) ≠ `IntegratedApi.activeMode` (base, par provider).
  Documenté dans `backend/.env.example` et `integratedApiCatalog.js`, verrouillé
  par `env-mode-independence.test.js`.
- 4 providers au catalogue : STRIPE, BREVO, YOUSIGN, HOSTINGER — chacun avec
  `modes.TEST`/`modes.PROD`, credentials chiffrés (`lastFour` seul en clair),
  `configured`/`verified`/`verifiedFingerprint`, tests de connexion réels,
  bascule PROD gardée par confirmation exacte (« ACTIVER STRIPE PROD »),
  validation de préfixe de clé par mode (`sk_live_` refusée en TEST).
- Aucune clé d'API tierce en variable d'environnement. Secrets jamais renvoyés
  au front (masqués).
- Lecture unique : `integratedApi.service.js > getCredential()` — jamais
  `config.env`, aucun fallback entre modes.

### 5.2 E-mail / Brevo

- Expéditeur par mode : `EmailConfiguration.modes.<mode>.sender.{email,name}`
  (singleton local). L'adresse expéditrice est aussi « l'adresse support
  affichée ». Preuve par envoi test (statuts séparés livraison / webhook /
  tracking — le webhook ne bloque plus un envoi).
- 5 templates code-first (`emailTemplateRegistry.js`) + surcharges base +
  éditeur DEV : `PASSWORD_RESET_REQUEST`, `CONTACT_ADMIN_NOTIFICATION`,
  `CONTRACT_CANCELLATION_ADMIN_CONFIRMATION`,
  `CONTRACT_CANCELLATION_DEV_NOTIFICATION`, `EMAIL_SENDER_VERIFICATION_TEST`.
- Destinataires de contact : liste métier
  (`Company.contactNotificationRecipients`) → fallback comptes ADMIN (jamais
  DEV, jamais l'adresse support).

### 5.3 Société développeur (état)

Singletons/collections LOCAUX par projet : `DevCompany` (nom, logo, slogan,
références, signataire), `TeamMember` (équipe). Affichés page Support + vitrine.
C'est la donnée destinée à devenir synchronisée
([11_DONNEES_CENTRALISEES.md](11_DONNEES_CENTRALISEES.md) §3).

### 5.4 Webhooks (état — moteur déjà « industriel »)

- Réception : `/api/webhooks/stripe`, `/yousign`, `/brevo/transactional/:mode`
  (corps brut monté avant `express.json()`), signature HMAC (Stripe/Yousign) ou
  Bearer (Brevo), vérification « any-mode » (mode actif puis l'autre), 400/2xx/5xx
  selon le cas, idempotence par journal.
- Enregistrement distant AUTOMATIQUE : registre code-first
  (`managedWebhookRegistry.js`), identité par description canonique
  `SB_AUTO_06_MANAGED_<PROVIDER>_<CATEGORY>_<MODE>`, moteur de sync
  (`remoteWebhookSyncEngine.js` : dédoublonnage sûr, recréation si secret
  perdu, `whsec_` capturé à la création et chiffré), plus aucune URL ni secret
  saisi à la main (Stripe CLI supprimé).
- URL publique : `resolvePublicBackendUrl(mode)` — PROD : Config Système (écrite
  au déploiement) ; TEST : tunnel ngrok auto-détecté (veille 60 s).
- Diagnostic : rapports persistés par action
  (`webhookRunReport.service.js` → `IntegratedApi.modes[mode].webhook.lastRunReport`),
  16 diagnostics catalogués avec correction suggérée, bouton « Copier le
  rapport », secrets masqués.

## 6. Contrats / paiements / factures (état)

- Machine à états 9 statuts (`contractConstants.js`,
  `contractStateMachine.js`) ; étape d'activation **dérivée**, jamais stockée.
- Signature Yousign (ordre DEV puis CLIENT, zones par coordonnées, fallback
  Trial documenté) ; `signatureRequirement REQUIRED|NOT_REQUIRED` (parcours sans
  signature possible).
- Stripe : frais de lancement (Checkout) + abonnement `MONTH|YEAR` (annuel
  facturé en une fois) ; version d'API épinglée `2025-02-24.acacia` ;
  métadonnées `contractId`/`providerMode`/`applicationEnvironment` posées sur
  les objets Stripe (audit).
- `Payment` = journal append-only ; `Invoice` = miroir des factures Stripe
  (« la source juridique est Stripe ») — un vrai atout pour la future
  synchronisation : la donnée financière de référence est déjà externe aux deux
  interfaces.
- Enforcement : invariant « aucun contrat actif ⇒ site suspendu »
  (`siteEnforcement.service.js`), retours vérifiés côté backend.
- Résiliation : PROD `cancel_at_period_end` ; **ENV=TEST → immédiate**
  (`cancelImmediatelyInTest`, garde fail-closed, même chemin canonique
  `settleFromSubscription` que le webhook).
- `Contract.environment` est FIGÉ à la création (une base PROD promue depuis
  TEST porte des contrats `environment: 'TEST'`) — piège documenté dans
  `meta.routes.js`.

## 7. Duplication (état)

`backend/src/deployment/duplication.js` — séquence : test Mongo → création +
initialisation canonique des 2 bases (index Mongoose réels + singleton
`SystemConfiguration`) → copie disque (denylist : `node_modules`, `.git`,
`dist`, `coverage`, `.turbo`, `.next`, `migration-reports` ; refus si la cible
existe) → réécriture `.env` atomique + vérification (`DB_TEST`, `DB_PROD`,
`PROJECT_NAME`, `PROJECT_GITHUB_REPOSITORY_URL`, `SEED_DEV_EMAIL`,
`FIRST_DEV_EMAIL`, `FIRST_DEV_NAME`) → amorçage d'un premier développeur local
sans mot de passe, activé par lien à usage unique (LOT 2C).

- **Aucune opération Git** : `.git` exclu ; seule l'URL du dépôt cible est
  demandée (validée par `githubRepositoryUrl.js`).
- **Secrets hérités du source** : `MONGODB_URI`, `JWT_SECRET`,
  `INTEGRATED_API_ENCRYPTION_KEY` recopiés tels quels (→ réserve
  [07_DUPLICATION_STANDARD.md](07_DUPLICATION_STANDARD.md) §5).
- Assistant Manager 5 étapes (Projet → Bases → Compte → Résumé → Création),
  flux NDJSON en direct.

## 8. Déploiement (état)

- Moteur UI-agnostic `backend/src/deployment/` : façade `DeploymentEngine`,
  préflight bloquant, pipeline unique (build local staging → upload → nginx →
  certbot → pm2 → health → runtime_config → validate), 20 étapes canoniques,
  transports injectables, rapports sanitisés, backups restaurables.
- DNS : wildcard `ly-solution.com` (aucun enregistrement par site) ou domaine
  client (cert dédié) ; provider Hostinger automatique, mutations DNS seulement
  APRÈS validation SSH ; 3 hostnames par destination (site, `manager.`, `api.`).
- `.env` distant : embarqué verbatim, surcharges limitées (`ENV`, `PORT`,
  `CORS_ORIGINS`, `PUBLIC_URL`), échec avant upload si clés vitales manquantes.
- Mot de passe VPS : coffre RAM à TTL (`passwordVault.js`), jamais persisté.
- Plan de contrôle (base `*_control`) : destinations + releases,
  `update`/`rollback` **préparés mais non implémentés** (P3) ; le pipeline
  actuel écrase les dossiers (filet `.prev`), pas encore de `releases/<id>/`.
- UI : assistant premium (`DeployAssistant`, préflight vécu, NDJSON live,
  écran de succès) ; PROD jamais déployé automatiquement.

## 9. Incohérences et points d'attention détectés (Phase 0)

Constats factuels relevés pendant l'exploration — **rien n'a été modifié** ;
chaque point est un candidat pour la préparation de la Phase 1
([10_PANEL_ROADMAP.md](10_PANEL_ROADMAP.md) §5).

| # | Constat | Impact |
|---|---|---|
| 1 | **`developer.supportEmail` sans résolveur** : variable REQUISE du template `CONTRACT_CANCELLATION_ADMIN_CONFIRMATION`, mais aucun résolveur runtime ni champ `supportEmail` dans `DevCompany.model.js` (seul `sampleVariables` la fournit). | Le template de résiliation risque d'échouer/rendre à vide en réel. À résoudre — et c'est précisément la donnée qui deviendra synchronisée (§4 de [11](11_DONNEES_CENTRALISEES.md)). |
| 2 | **Docs périmées** : `docs/WEBHOOKS.md` §5 décrit encore la saisie manuelle des URLs/`whsec_` (révolu depuis les webhooks auto-gérés) ; `STRIPE_CLI_DEV_SETUP_REPORT.md` et `STRIPE_CLI_REPAIR_REPORT.md` (racine) décrivent le Stripe CLI supprimé. | Risque de confusion pour un nouveau développeur. Mettre à jour/archiver. |
| 3 | **Secrets partagés à la duplication** : `JWT_SECRET`, `INTEGRATED_API_ENCRYPTION_KEY`, `MONGODB_URI` hérités du projet source. | Incompatible à terme avec la revente. Doctrine cible : secrets uniques générés ([07](07_DUPLICATION_STANDARD.md) §5). |
| 4 | **`webhookSecretPrevious` hors catalogue** : écrit par la rotation Brevo et lu par l'auth webhook, mais absent d'`integratedApiCatalog.js` → invisible pour `fieldKeys()`/`getProviderConfiguration()`. | Angle mort mineur ; à régulariser avant de faire du catalogue le contrat Panel. |
| 5 | **Verrous de sync webhook in-process** (Map de promesses) — documenté comme insuffisant en multi-processus. | Sans conséquence aujourd'hui (mono-process PM2) ; à garder en tête si le Panel orchestre des syncs concurrents. |
| 6 | **Deux registres `DeploymentTarget`** homonymes : base métier (`models/DeploymentTarget.model.js`) et plan de contrôle (`models/controlPlane/deploymentTarget.model.js`), alimentés en parallèle (best-effort). | Redondance transitoire assumée (P2) ; la supervision Panel devra choisir sa source (le plan de contrôle est la bonne). |
| 7 | **`Contract.environment` figé** ≠ `config.env` après promotion TEST→PROD. | Piège connu et documenté ; la synchronisation des contrats devra transporter cette notion telle quelle, sans la réinterpréter. |
| 8 | **Rate-limit inactif hors PROD** (`middlewares/rateLimit.js`). | Choix assumé (recette) ; à réévaluer pour la surface ProjectBridge. |
| 9 | **P3 non implémenté** : `update`/`rollback` du plan de contrôle répondent une erreur métier ; pas de layout `releases/` + symlink. | Le « pipeline de mise à jour » promis par la règle d'or n°2 (Panel déployé comme un projet) dépend de ce lot. |
| 10 | **Nom d'expéditeur libre** : `sender.name` est saisi librement par mode ; la règle cible « `Company.name` + " (Site)" » ([11](11_DONNEES_CENTRALISEES.md) §4) n'est pas encore une règle du code. | À implémenter au moment de la mise sous synchronisation Brevo. |
| 11 | **`PROJECT_NAME` absent de `backend/.env.example`** : la duplication écrit cette variable dans le `.env` de la copie (`duplication.js`), mais l'exemple commenté ne la mentionne pas — un repreneur qui construit son `.env` depuis l'exemple ignore son existence. | Ajouter la ligne commentée dans `.env.example` (lot A2). |

## 10. Documentation existante à connaître

`docs/` contient 74 documents + 3 sous-dossiers (Brevo, hostinger, yousign).
Références pivots : `docs/ARCHITECTURE.md`, `docs/API.md`,
`docs/DEPLOYMENT_ENGINE.md` (chantier RX-INDUSTRIAL-DEPLOYMENT),
`docs/INTEGRATED_API.md`, `docs/GENERIC_WEBHOOK_PROVIDER_ARCHITECTURE.md`,
`docs/CONTRACTS.md`, `docs/DUPLICATION.md`, `docs/TEST_TO_PROD_MIGRATION.md`,
`docs/CANONICAL_DEVELOPMENT_WORKFLOW.md`. Le présent dossier (`docs/panelXvitrine/`)
est le premier à traiter la relation Panel ↔ Projets de façon transverse.
