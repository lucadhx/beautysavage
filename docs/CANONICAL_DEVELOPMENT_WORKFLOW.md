# Workflow de développement canonique

> **Document contractuel — stockage, persistance, accès :** voir
> [panelXvitrine/DOCUMENT_CONTRACTUEL.md](./panelXvitrine/DOCUMENT_CONTRACTUEL.md).
> Référence unique ; ces règles ne sont recopiées nulle part ailleurs.


> Une seule version fait foi : `feat/unified-production-baseline`.
> Ce document fixe **où** développer, **comment** démarrer, et **quoi** ne plus faire.

## 1. La branche canonique

**`feat/unified-production-baseline`** réunit :
- le **moteur de déploiement** (P1/P2, médias persistants, plan de contrôle,
  domaine API, manifeste de build, garde source dirty) ;
- l'**intégration Brevo/e-mail** (envoi, suivi de livraison, webhooks, contact, UI).

Tout nouveau développement part de cette branche. C'est elle qui **construit** et
**déploie** — le build lit la source du worktree qui l'exécute.

## 2. Branches dépréciées (conservées, non supprimées)

| Branche | État | Raison |
|---|---|---|
| `feat/brevo` | **dépréciée** — fusionnée dans la canonique (merge `b1749d0`) | historique Brevo |
| `feat/industrial-deployment-engine` | **dépréciée** — ancêtre de la canonique | historique moteur |

Ne plus committer dessus. Aucune n'est supprimée (référence + réversibilité).

## 3. Démarrer en local (point d'entrée unique)

Depuis la racine du projet — dossier unique `C:\…\SB Auto 06` :

```bash
npm run dev            # équivaut à : node scripts/dev-canonical.mjs
```

Le `package.json` racine expose aussi `npm run backend` (6070), `npm run manager`
(6071), `npm run vitrine` (6062) et `npm test` (les trois suites). C'est la SEULE
manière officielle de lancer le projet. Depuis le 2026-07-23, il n'existe plus
qu'UN dossier de développement : `SB Auto 06` (l'ex-worktree
« SB Auto 06 -- deployment-engine » a été supprimé après fusion de ses données
runtime ; la branche `feat/brevo` reste archivée dans git, sans dossier).

Il imprime d'abord **racine / branche / commit / dirty / ENV / ports**, avertit si
la branche n'est pas canonique, **détecte les anciens serveurs 6060/6061** et
**refuse de démarrer si un port canonique est déjà occupé**, puis lance :
`backend 6070` · `manager 6071` · `vitrine 6062`. Après démarrage il **contrôle**
`6070/health=200`, `6070/api/version=commit source`, `6071=200`. Un service qui
tombe arrête les autres (pas de version fantôme à moitié à jour).

### Modèle réseau local = même origine (comme en production)

Le Manager (6071) et la vitrine (6062) parlent au backend (6070) en **MÊME
ORIGINE**, via le **proxy Vite** (`/api` et `/uploads` → `http://localhost:6070`).
On **ne définit pas `VITE_API_URL`** en local : l'API est appelée en **relatif**
(`/api`), exactement comme sur le site déployé où Nginx proxifie vers le backend.

Conséquences (et pièges à éviter) :
- **Aucune requête cross-origin** → aucun CORS à gérer côté navigateur.
- Remettre `VITE_API_URL=http://localhost:6070` casserait la page de connexion :
  les appels deviendraient cross-origin depuis `:6071`, bloqués par la liste CORS
  du backend → bootstrap non chargé → **ni logos ni nom d'entreprise**.
- Les médias sont des chemins **relatifs** (`/uploads/x.webp`) résolus en même
  origine. La config réseau `SystemConfiguration.network.backendUrl` doit rester
  **vide en local** (une URL ngrok/absolue périmée y casserait tous les médias).

### 6060 / 6061 sont morts

C'étaient les serveurs de l'ancienne branche `feat/brevo` (pré-convergence, sans
pages Déploiement ni `/api/version`). Plus AUCUN dossier ne peut les servir :
la branche est archivée dans git sans checkout. `dev-canonical.mjs` les signale
par sécurité s'ils tournent encore. Le **seul** Manager canonique est **6071**.

## 4. Vérifier « quelle version tourne »

- **Local (backend)** : `GET http://localhost:6070/api/version` → `{branch, shortCommit, builtAt, isDirty, source}`.
- **Local (Manager)** : page **Système → Déploiements**, bandeau « Version locale ».
- **Déployé** : `GET https://api.<domaine>/api/version` — doit correspondre au
  `commitHash` de la `DeploymentRelease` active.

La source est **toujours** le manifeste réellement servi (`build-manifest.json`),
jamais une constante codée en dur.

## 5. Déployer

1. Committer / pousser sur `feat/unified-production-baseline` (arbre **propre** :
   PROD refuse une source dirty → `DEPLOY_SOURCE_DIRTY`).
2. Manager → **Déploiement** → saisir le mot de passe VPS (jamais stocké, RAM
   uniquement) → **Publier**.
3. Le pipeline construit depuis la source validée, embarque le manifeste, vérifie
   la parité `local == distant == release` (sinon `DEPLOY_ARTIFACT_VERSION_MISMATCH`).

## 6. Après déploiement — recette

- Manifeste local == distant == `DeploymentRelease.commitHash`.
- Fonctionnalités Brevo visibles (pages e-mail, contact).
- Médias 200 depuis les deux origines (code HTTP + MIME).
- `GET https://api.<domaine>/health` → **200** ; `apiReachable = true`.
- Destination **HEALTHY** + **ACTIVE**.

## 7. Règles de sûreté (permanentes)

- Jamais de `reset --hard`, `checkout -f`, `clean -fd`, ni suppression de branche/worktree.
- Jamais de mot de passe VPS stocké ni journalisé.
- Jamais de credential Brevo dans `DeploymentTarget`/`DeploymentRelease`/rapport/log.
- Jamais de `.env` copié dans un bundle frontend.
- `INTEGRATED_API_ENCRYPTION_KEY` préservé à l'identique lors du déploiement.
- Axes **ENV** (TEST/PROD → DB) et **activeMode** (par fournisseur) restent indépendants.
