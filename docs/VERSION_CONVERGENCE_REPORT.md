# Rapport de convergence des versions (LOT 1–8)

> Réunion de **Brevo** (`feat/brevo`) et du **moteur de déploiement**
> (`feat/industrial-deployment-engine`) dans une seule version canonique.
> Aucune fonctionnalité perdue. Aucune opération destructive.

## LOT 1 — Branche canonique

`feat/unified-production-baseline` créée depuis `feat/industrial-deployment-engine`
(c3f468e), la branche qui **construit ET déploie** — donc l'ancêtre qui minimise le
risque côté pipeline. On y fusionne ensuite Brevo.

## LOT 2/3 — Fusion (les DEUX côtés conservés)

Fusion `feat/brevo` → commit de merge **`b1749d0`** (parents `c3f468e` + `e1aa233`).
9 conflits, tous **additifs** — jamais `-X ours`/`-X theirs` global. Résolutions :

| Fichier | Résolution |
|---|---|
| `backend/package.json` | Union des scripts `test:*` (déploiement **+** brevo) ; nouvelle chaîne `test` exécutant **tous** les tests des deux mondes ; ajout `test:source-manifest`. Deps = union (`ssh2`, `tldts` + base). |
| `backend/src/routes/index.js` | Auto-fusion : routes e-mail/brevo **+** `deploymentControlPlaneRoutes` **+** nouvelle route publique `/version`. |
| `backend/src/services/providerConnectionTest.service.js` | `TESTERS` fusionné : `{ STRIPE, YOUSIGN, HOSTINGER, BREVO }` — testeurs des deux branches conservés. |
| `backend/src/utils/integratedApiCatalog.js` | Union des entrées catalogue (Hostinger côté moteur + Brevo actif). |
| `backend/.env.example` | Union des clés documentées. |
| `manager/src/config/nav.ts` | Structure de nav Brevo (groupes obligatoires) adoptée ; items **Déploiement** ré-ajoutés dans un groupe dédié ; `GROUP_ORDER.dev` = Configuration, Supervision, **Déploiement**, Administration. |
| `manager/src/lib/api.ts` | Union des méthodes (`email`/`brevo` **+** `deployment`/`controlPlane`) ; ajout `getVersion` + `controlPlane`. |
| `manager/src/types/index.ts` | `}` de fermeture partagé désambiguïsé (ControlRelease fermé avant le bloc Brevo) ; ajout de l'interface `VersionInfo`. |
| `manager/src/App.tsx` | Union des routes (pages e-mail **+** pages déploiement). |

**Axes préservés** : ENV (TEST/PROD → DB) et `activeMode` par fournisseur restent
**indépendants**. Chiffrement AES-256-GCM et `INTEGRATED_API_ENCRYPTION_KEY`
inchangés. Aucun credential Brevo n'entre dans `DeploymentTarget`/`DeploymentRelease`/rapport.

## LOT 4 — Source de build explicite & garde « dirty »

`build.js` : `getGitSourceInfo(root)` renvoie `{isGit, commitHash, shortCommit, branch, isDirty}`.
`buildArtifact` accepte `requireCleanSource` ; **PROD refuse par défaut** une source
sale → `DEPLOY_SOURCE_DIRTY`. `DeploymentEngine` passe
`requireCleanSource: options.requireCleanSource ?? (env === 'PROD')`.

## LOT 5 — Manifeste de build (provenance réelle)

Généré depuis la source **réellement construite** :
`{project, commitHash, shortCommit, branch, isDirty, builtAt, managerArtifactHash, vitrineArtifactHash, backendSourceHash}`.
Écrit dans `build-manifest.json` (backend) + `version.json` (dists). Aucun secret.
**Route publique** `GET /api/version`. Vérif de parité à l'étape `dirs` :
`remoteCommit !== artifact.manifest.commitHash` → `DEPLOY_ARTIFACT_VERSION_MISMATCH`
(bloque la finalisation).

## LOT 6 — Version visible dans le Manager

Page **Déploiements** : bandeau « Version locale » (branche, commit court, dirty,
date de build, source) alimenté par `api.getVersion()` → **le manifeste réellement
servi**, jamais une constante codée en dur. Repli Git local si pas de manifeste (dev).

## LOT 8 — Healthcheck API 404 corrigé

Route canonique = **`/health`** (pas `/api/health`). Corrigé dans
`deployment/health.js` (`https://<apiHost>/health`), `deploymentControlPlane.controller.js`
(`${t.apiUrl}/health`) et le lien UI. `apiReachable`/`healthStatus` fiabilisés.

## Validation (avant recette)

- **Manager** : `tsc -b` → **0 erreur**.
- **Backend** : `deploy-source-manifest` **9/9**, `deployment-engine` **99/99**,
  `control-plane` **29/29**, `runtime-config` **23/23**, `deployment-build` **44/44**.
- Suites Brevo/e-mail conservées et vertes (voir `test` fusionné).

## Recette VPS (LOT 13 — action utilisateur)

Le mot de passe VPS n'est **jamais** stocké (RAM uniquement, saisi via le Manager) :
je ne peux pas déclencher le redéploiement réel. Après publication, vérifier :
manifeste local == distant == `DeploymentRelease.commitHash` ; Brevo visible ;
médias 200 ; `GET https://api.<domaine>/health` → 200 ; `apiReachable=true` ;
HEALTHY + ACTIVE.
