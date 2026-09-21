# Audit & architecture — Plan de contrôle des déploiements (P2)

> LOT P2.0 (audit) + décisions d'architecture. Sourcé `fichier:ligne`, sans
> secret. Complète `docs/INTEGRATED_API_AND_DEPLOYMENT_AUDIT.md` (LOT 0).

## 1. Audit de l'existant (avant P2)

| Élément | Existe | Stockage actuel | Durable | Dépend de l'ENV local | Réutilisable |
|---|---|---|---|---|---|
| DeploymentRun | oui | `deploymentruns` dans la base MÉTIER active (`DeploymentRun.model.js:88`) | oui (mais dans DB_TEST/DB_PROD) | **oui** (connexion par défaut = `config.dbName`) | oui |
| Destination (ancien DeploymentTarget) | oui | `deploymenttargets` base métier (`DeploymentTarget.model.js:87`) | oui | **oui** — captif de l'ENV local | partiellement |
| Release | **non** | — | — | — | — |
| Domaine API | **non** | dérivé nulle part ; seuls site + `manager.<host>` (`hostnames.js`) | — | — | — |
| Santé | partiel | `state` (NEW/DEPLOYING/DEPLOYED/FAILED) mêlé à l'opération | non (pas de `healthStatus`) | oui | non |
| Historique | partiel | `target.history[]` (borné 50) + runs | oui | **oui** | oui |

**Limites identifiées :**
- **Dépendance à l'ENV local** : targets & runs vivent dans la base métier
  sélectionnée par `ENV` (`db.js:21-24`). Un déploiement PROD piloté depuis
  `ENV=TEST` persiste la cible dans **DB_TEST** → invisible depuis un moteur PROD.
- **Aucune release** ni symlink `current` : le pipeline écrase les dossiers vivants
  (`pipeline.js` — cf. LOT 0). Rollback impossible en l'état.
- **Aucun domaine API** dédié ; le backend est proxifié sur les hôtes site/manager.
- **`state` mélange opération et santé.**

## 2. Décision — stockage du plan de contrôle (P2.1)

**Base MongoDB DÉDIÉE, distincte des bases métier, indépendante de l'ENV.**
- Même `MONGODB_URI`, base `config.controlDbName` (`config/env.js`) — défaut dérivé
  du préfixe métier (`sbauto06_prod` → `sbauto06_control`), surchargeable par
  `CONTROL_DB_NAME`.
- Connexion Mongoose **dédiée** `createConnection` mise en cache (`config/controlDb.js`),
  jamais la connexion globale. Fermeture propre (`closeControlConnection`).
- Modèles enregistrés **sur cette connexion** via des fabriques idempotentes
  (`models/controlPlane/*`), injectables en test.
- Code `CONTROL_DB_UNAVAILABLE` si la base de contrôle est injoignable.

Ainsi les destinations et releases ne dépendent **jamais** de l'ENV local du
moteur. **Vérifié** : une destination PROD est créée + listée pendant que
`process.env.ENV='TEST'`, et reste visible après bascule `ENV=PROD`
(`control-plane.test.js` cas 2, 3).

## 3. Modèles

### DeploymentTarget (`models/controlPlane/deploymentTarget.model.js`)
Destination durable. **Deux axes d'état distincts** :
`status` (DRAFT/READY/DEPLOYING/HEALTHY/DEGRADED/FAILED/UPDATING/ROLLING_BACK/
ROLLED_BACK/DISABLED) et `healthStatus` (UNKNOWN/HEALTHY/DEGRADED/UNREACHABLE).
Domaines `siteHostname`/`managerHostname`/`apiHostname` + URLs HTTPS
`siteUrl`/`managerUrl`/`apiUrl`. Références `currentReleaseId`/`previousReleaseId`/
`lastDeploymentRunId`. Soft-delete (`deletedAt`). Index unique partiel
`(projectKey, targetEnvironment, siteHostname)` (hors supprimés).
**Aucun secret** : `server` ne porte que host/port/username, jamais le mot de passe
(RAM seule via passwordVault).

Invariants (validés dans `services/controlPlane/validators.js`) : trois hostnames
**distincts** ; hostnames sans protocole/chemin/port ; URLs **HTTPS** ; **pas de
localhost** ; `backendPort` valide ; create/resolve idempotents.

### DeploymentRelease (`models/controlPlane/deploymentRelease.model.js`)
Version immuable. Statuts PREPARING/UPLOADED/INSTALLED/ACTIVE/INACTIVE/FAILED/
ROLLED_BACK/REMOVED. **Au plus UNE release ACTIVE par destination** (index partiel
unique + désactivation préalable à l'activation). `remotePath` contraint **sous
`remoteRoot`** (anti-traversée, `assertReleasePathUnder`). `previousReleaseId` +
`rollbackOfReleaseId` conservés. `commitHash` provient du **build réel**.

## 4. Autorités (nomenclature)

```
ENV applicatif         ≠  destination de déploiement  ≠  mode actif IntegratedAPI  ≠  release
DeploymentTarget       → domaines & destination
DeploymentRelease      → version déployée (immuable)
DeploymentRun          → exécution + rapport (base métier)
SystemConfiguration(cible) → configuration runtime du site (URLs)  [runtime.sync, P1]
IntegratedAPI(cible)   → modes & credentials des fournisseurs
```

Exemple canonique :
```
Moteur local : ENV=TEST      Destination : PROD      Base distante : DB_PROD
Stripe actif : TEST          Vitrine : https://demo-sbauto.lycarz.com
Manager : https://manager.demo-sbauto.lycarz.com   API : https://api.demo-sbauto.lycarz.com
```

## 5. Services (P2.8)
`services/controlPlane/` : `target.service.js` (createOrResolve, list, get,
markDeploying/Healthy/Failed, recordHealth, softDelete, serialize SANS secret),
`release.service.js` (create, markUploaded/Installed, **activateRelease** atomique
avec compensation, getActive, list), `validators.js`, `errors.js` (taxonomie P2.14).
Aucune dépendance à `process.env.ENV`.

## 6. Migration (P2.4)
`scripts/migrate-deployment-control-plane.js` (dry-run/apply/verify, idempotent,
non destructif). Reconstruit les destinations depuis les anciennes
`deploymenttargets` métier ; ne crée une **release ACTIVE** que si un déploiement a
RÉELLEMENT réussi (sinon destination `READY` sans version — jamais de fausse
release). Signale `CONTROL_PLANE_MIGRATION_INCOMPLETE` (hôte manquant).
**Appliquée** : la destination `demo-sbauto.lycarz.com` (PROD) est enregistrée dans
`sbauto06_control` en `READY` (aucun déploiement legacy n'avait abouti avant P1).

## 7. Reste à faire (P2b — lots non finalisés dans ce commit)
- **P2.5** Domaine API : DNS Hostinger `api.<host>`, bloc Nginx dédié, certificat.
- **P2.6/P2.7** Intégration pipeline : `control_plane.*`, `release.create/activate`,
  `target.mark_*`, `runtime.sync` alimenté par `target.apiUrl` (assertion
  `DEPLOYMENT_TARGET_URL_MISMATCH`).
- **P2.9** Routes `/api/admin/deployments` (DEV) ; update/rollback → `*_NOT_AVAILABLE`.
- **P2.10** Page Manager « Système → Déploiements » (consultation).
- **P2.11** Healthcheck API dédié. **P2.12** Stratégie `/api` (proxy relatif conservé).

Ces lots nécessitent la recette réelle sur le VPS et seront livrés en continuité,
sans casser P1.
