# Audit de convergence des versions (LOT 0)

> **NB (2026-07-23)** : le worktree « SB Auto 06 -- deployment-engine » cité dans ce rapport historique a été supprimé — dossier canonique unique : `SB Auto 06`.


> Audit factuel AVANT toute fusion. Aucune opération destructive. Sourcé Git.

## 0.1 Inventaire Git

**Worktrees** (`git worktree list`) :

| Worktree | Branche | HEAD | Dirty | Rôle |
|---|---|---|---|---|
| `SB Auto 06` (principal) | `feat/brevo` | `e1aa233` | non | **Intégration Brevo/e-mail** (module e-mail, contact, UI Manager) |
| `SB Auto 06 -- deployment-engine` | `feat/industrial-deployment-engine` | `c3f468e` | non | **Moteur de déploiement** (P1/P2, médias, plan de contrôle) — sert 6070/6071 ET le build |

**Branches** : `feat/brevo` (e1aa233), `feat/industrial-deployment-engine` (c3f468e), `main` (d2724bc). Toutes poussées sur `origin`.

## 0.2 Code exécuté localement

- **Backend 6070** et **Manager 6071** : lancés depuis le worktree
  `SB Auto 06 -- deployment-engine` (tâches de fond démarrées dans ce dossier).
- **Build du déploiement** : `build.js` calcule `PROJECT_ROOT` en **module-relatif**
  (`__dirname/../../..`) → **le même worktree** `deployment-engine`.

**Conclusion sans ambiguïté :** `localhost:6071` **=** le build **=** le déploiement
**=** worktree `deployment-engine`, branche `feat/industrial-deployment-engine`,
commit `c3f468e`. Il n'y a PAS un worktree pour développer et un autre pour publier.

## 0.3 La vraie dérive : Brevo absent du moteur

Le problème n'est donc pas « deux sources pour le même rôle », mais que la branche
déployée **`feat/industrial-deployment-engine` NE CONTIENT PAS l'intégration
Brevo** — celle-ci vit sur `feat/brevo`. Le produit déployé est donc partiel.

- `merge-base(feat/brevo, feat/industrial-deployment-engine)` = **`d2724bc`** (main) :
  les deux branches ont **divergé depuis main** et évolué indépendamment.
- **85 commits** sur `feat/brevo` absents du moteur (module e-mail/Brevo/contact).
- **25 commits** sur le moteur absents de `feat/brevo` (P1/P2, médias, plan de contrôle).
- **Aucune** n'est un sur-ensemble de l'autre → une **fusion** est nécessaire.

**Surface de conflit** : seulement **9 fichiers modifiés des deux côtés** — tous
**additifs** (chaque branche ajoute au même fichier) : `backend/.env.example`,
`backend/package.json`, `backend/src/routes/index.js`,
`backend/src/services/providerConnectionTest.service.js`,
`backend/src/utils/integratedApiCatalog.js`, `manager/src/App.tsx`,
`manager/src/config/nav.ts`, `manager/src/lib/api.ts`, `manager/src/types/index.ts`.
Dépendances : le moteur ajoute `ssh2` + `tldts` ; Brevo n'ajoute aucune dépendance.

## 0.5 Matrice de fonctionnalités

| Fonctionnalité | 6071 (= deploy-engine) | Branche Brevo | À conserver |
|---|---|---|---|
| IntegratedAPI | oui (Brevo `active:false`) | oui (Brevo `active:true` + service) | **Brevo actif** |
| Brevo TEST/PROD | non | **oui** (resolver, credentials chiffrés, verified/mode) | Brevo |
| E-mails (envoi, suivi livraison, webhooks) | non | **oui** | Brevo |
| Contrats / Yousign / Stripe | oui (base commune) | oui (base commune) | inchangé (identique) |
| Médias (relatif + shared/uploads) | **oui** | non | deploy-engine |
| Déploiement (P1/P2) | **oui** | non | deploy-engine |
| Plan de contrôle | **oui** | non | deploy-engine |
| Domaine API | **oui** | non | deploy-engine |
| Manager UI | déploiement | e-mail/contact | **les deux** (nav fusionnée) |
| Vitrine | commune | commune | inchangé |

**Décision** : brancher `feat/unified-production-baseline` sur `feat/industrial-deployment-engine`
(c3f468e, la branche qui construit et déploie) puis **fusionner `feat/brevo`**, en
conservant les DEUX ensembles de fonctionnalités. Voir
`docs/VERSION_CONVERGENCE_REPORT.md`.
