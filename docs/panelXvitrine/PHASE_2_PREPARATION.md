# Préparation de la Phase 2 — état après les Phases 1 et 2A

> Rédigé à la clôture de la **Phase 1 — Fondation des connecteurs** (2026-07-26,
> branche `feat/unified-production-baseline`), mis à jour à la clôture de la
> **Phase 2A — Adaptation du projet au futur Panel** (2026-07-27). Ce document
> dit précisément : ce qui est terminé, ce qui reste à faire côté projet, ce
> qui sera développé dans le Panel, et ce qui ne devra JAMAIS être modifié.

---

## 1. Ce qui est TERMINÉ (Phase 1)

À la fin de cette phase, la promesse est tenue : **« le projet est prêt à être
connecté à n'importe quel Panel »** — la frontière est spécifiée, implémentée,
testée et verrouillée.

| Livrable | Où |
|---|---|
| **Vocabulaire officiel Bridge** (le terme *Connector* est abandonné) | toute la doc `panelXvitrine/` |
| **Contrats OpenAPI v1.0.0** — LE contrat officiel des deux sens : routes, DTO, erreurs `BRIDGE_*`, en-têtes, versionnement | [spec/PanelBridge.openapi.yaml](spec/PanelBridge.openapi.yaml), [spec/ProjectBridge.openapi.yaml](spec/ProjectBridge.openapi.yaml) |
| **Contrat exécutable** — miroir code des specs : schémas zod stricts, codes d'erreur, routes, exemples canoniques, version | `backend/src/services/panelBridge/bridgeContract.js` |
| **PanelBridge** (façade sortante) — états UNCONFIGURED/CONNECTED/DEGRADED, appairage/désappairage idempotents, heartbeat best-effort, outbox avec reprise après erreur, pull anti-écho/idempotent, handlers par `entityType` | `backend/src/services/panelBridge/PanelBridge.js` |
| **Transport** — interface `PanelClient` + client HTTP réel (seul fichier du projet qui parlera réseau au Panel) | `backend/src/services/panelBridge/PanelClient.js` |
| **Stub de Panel** (LOT 5) — Panel simulé en mémoire qui VALIDE chaque DTO, idempotence, pull paginé, pannes simulables | `backend/src/services/panelBridge/panelStub.js` |
| **État d'appairage partagé** — un seul secret pour les deux sens, vérification en temps constant, jamais exposé | `backend/src/services/panelBridge/pairingStore.js` |
| **ProjectBridge** (surface entrante) — montée sous `/api/project-bridge/v1` : ping public, identité/santé réelles, accusés idempotents (`DIAGNOSTIC` appliqué, types réservés REJECTED propres), catalogue d'opérations VIDE, unpair | `backend/src/services/projectBridge/`, `routes/projectBridge.routes.js`, `controllers/projectBridge.controller.js`, `middlewares/projectBridgeAuth.middleware.js` |
| **Tests (173 ✓, intégrés à `npm test`)** — cycle de vie complet contre le stub (50), surface HTTP réelle (38), conformité spec↔code + exclusivité des imports (85) | `backend/src/scripts/{panel-bridge,project-bridge,bridge-conformity}.test.js` |
| **Identité de projet** — `PROJECT_NAME` exposé via `config.projectName` + documenté dans `.env.example` (solde le constat #11) | `backend/src/config/env.js`, `backend/.env.example` |

Ce qui est volontairement **minimal** (signatures figées, implémentation à
compléter) : outbox et curseur de pull **en mémoire**, journal local des
écritures vide, catalogue d'opérations vide, aucun handler métier enregistré.

---

## 1bis. Ce que la Phase 2A a AJOUTÉ (2026-07-27)

Le projet est désormais prêt pour un **Panel réel** — plus aucune hypothèse
« Panel fictif » dans le code ; le stub ne sert qu'aux tests.

| Livrable | Où |
|---|---|
| **Appairage PERSISTÉ CHIFFRÉ** — un redémarrage ne casse jamais l'appairage : modèle singleton `BridgePairing` (AES-256-GCM via `INTEGRATED_API_ENCRYPTION_KEY`), adaptateur injecté dans `pairingStore` (lectures synchrones sur cache RAM, écritures persistées), hydratation au bootstrap | `backend/src/models/BridgePairing.model.js`, `backend/src/services/panelBridge/persistence/mongoPairingAdapter.js` |
| **Rotation du bridgeToken** — `rotateBridgeToken()` avec fenêtre de transition persistée (l'ancien token reste accepté jusqu'à expiration), exposée non sensiblement (`rotationWindowOpen`) | `backend/src/services/panelBridge/pairingStore.js` |
| **Contrats v1.1.0 (additif)** — manifeste officiel : `GET /manifest` côté ProjectBridge + `BootstrapRequest.manifest` optionnel ; schéma `ProjectManifest` identique dans les deux specs | [spec/](spec/), `bridgeContract.js` |
| **Manifeste jamais déduit** — registre DÉCLARATIF (modules + features AVAILABLE/RESERVED) + partie sync DÉRIVÉE du code, validé avant d'être servi | `backend/src/services/projectBridge/projectManifest.js`, `projectBridge.service.js > buildProjectManifest()` |
| **Runtime applicatif** — instance unique du pont sur client HTTP RÉEL par défaut, providers injectés au bootstrap, `pairWithPanel()`/`unpairFromPanel()`, signe de vie au démarrage (heartbeat + flush d'outbox, timeouté, jamais bloquant) | `backend/src/services/panelBridge/bridgeRuntime.js`, `backend/src/config/bootstrap.js` |
| **Tests** — persistance/rotation/redémarrage simulé (31 ✓), manifeste servi et conforme, runtime (60 ✓ panel-bridge, 49 ✓ project-bridge), conformité étendue (91 ✓ : exception étroite `persistence/`, cœur du pont sans modèle ni crypto) | `backend/src/scripts/bridge-persistence.test.js` + suites existantes |
| **Documentation d'exposition** — ce que le projet expose au Panel, pourquoi, comment, avec quelles garanties | [15_BRIDGE_EXPOSURE.md](15_BRIDGE_EXPOSURE.md) |

---

## 2. Ce qui RESTE À FAIRE côté projet

Par ordre de dépendance :

1. **Persistance restante du pont** (l'appairage est fait — Phase 2A) :
   - outbox persistée + curseur de pull persistant ;
   - **journal local des écritures** (alimente `GET /sync/pull` côté
     ProjectBridge, aujourd'hui vide) avec tombstones conservés N jours.
2. **Heartbeat périodique** : le signe de vie au démarrage existe
   (`startupBridgeHello`, Phase 2A) ; reste la veille périodique best-effort
   (même discipline que la veille ngrok : intervalle `unref()`, jamais
   bloquant).
3. **Page Manager « Connexion Panel »** (espace DEV) : état du pont, appairage
   (saisie URL + code → `pairWithPanel`), bouton « Débrancher »
   (`unpairFromPanel`), dernier sync, taille d'outbox —
   [03_MANAGER_STANDARD.md](03_MANAGER_STANDARD.md) §2. Le backend est prêt.
4. **Duplication : question « URL du Panel »** pré-remplie, modifiable,
   optionnelle — [07_DUPLICATION_STANDARD.md](07_DUPLICATION_STANDARD.md) §3.
5. **Assainissement restant** ([10_PANEL_ROADMAP.md](10_PANEL_ROADMAP.md) §2.1) :
   A1 (`developer.supportEmail` sans résolveur), A2 (docs webhooks périmées +
   `STRIPE_CLI_*.md`), **A3 (secrets uniques à la duplication — condition de
   revendabilité)**, A4 (`webhookSecretPrevious` au catalogue), A5 (registre de
   référence des destinations).

## 3. Ce qui sera développé DANS le Panel

Le Panel n'existe pas encore — c'est voulu. Quand il naîtra (Phase 2 de la
roadmap, lots B1-B5) :

- **squelette de projet standard** (backend + interface + moteur de déploiement
  partagé — règle d'or n°4, [00_ECOSYSTEME.md](00_ECOSYSTEME.md) §3) ;
- **implémentation SERVEUR de [spec/PanelBridge.openapi.yaml](spec/PanelBridge.openapi.yaml)**
  (bootstrap, heartbeats, sync push/pull) — le stub actuel en est la maquette
  comportementale : mêmes validations, mêmes accusés, mêmes erreurs ;
- **registre des projets** + codes d'appairage à usage unique (catégorie 3) ;
- **supervision lecture seule** (heartbeats, versions, santé) ;
- utilisateurs du Panel v1 (ADMIN/DEV internes — le RBAC complet attend D4).

Rien de tout cela ne modifie les projets : c'est tout l'intérêt des contrats.

## 4. Ce qui ne devra JAMAIS être modifié

Invariants verrouillés (par la doc, et pour la plupart par
`bridge-conformity.test.js`) :

1. **Le contrat OpenAPI v1** n'évolue que par ajouts (mineures). Un breaking
   change = nouvelle majeure + période de double-service — à éviter par
   conception, presque toujours possible.
2. **Les 5 règles de synchronisation** ([11_DONNEES_CENTRALISEES.md](11_DONNEES_CENTRALISEES.md)
   §1.1) : LWW document, UUID par le créateur, tombstones, anti-écho,
   idempotence — et RIEN au-delà (pas de gouvernance).
3. **Exclusivité des ponts** : aucun composant métier n'importe les modules de
   pont ; le module `panelBridge` n'importe rien du métier ; seul
   `PanelClient.js` transporte ; les deux ponts s'ignorent mutuellement.
4. **Le Manager ne reçoit que `{admin, dev}`** — jamais un rôle du Panel
   ([09_AUTHENTIFICATION_PANEL_MANAGER.md](09_AUTHENTIFICATION_PANEL_MANAGER.md)).
5. **Catalogue fermé** côté ProjectBridge : le Panel n'invoque que ce que le
   projet déclare ; jamais de requête libre, jamais d'écriture sur une donnée
   locale (catégorie 1), jamais Mongo.
6. **Un seul secret d'appairage** pour les deux sens ; le révoquer ferme tout ;
   il n'est jamais journalisé ni exposé par une API.
7. **Standalone d'abord** : UNCONFIGURED est un état normal de première
   classe ; toute fonctionnalité CONNECTED garde son chemin local
   ([04_STANDALONE.md](04_STANDALONE.md)).
8. **Le Panel ne duplique ni ne déploie jamais un projet** ([07](07_DUPLICATION_STANDARD.md)/[08](08_DEPLOIEMENT_STANDARD.md)).
