# Documentation Panel × Projets — Phases 0 / 0.5

> **Statut : RÉFÉRENCE OFFICIELLE de l'écosystème Panel ↔ Projets.**
> Phase 0 rédigée le 2026-07-26, Phase 0.5 (corrections + audit de
> revendabilité) le même jour, sur la branche `feat/unified-production-baseline`.
> Ces phases sont exclusivement documentaires : aucun code, aucune API, aucune
> base de données n'a été modifié. Ces documents figent l'architecture cible
> AVANT le développement du Panel (`panel.ly-solution.com`).

## Comment lire cette documentation

Commencer par **[00_ECOSYSTEME.md](00_ECOSYSTEME.md)** : il pose la vision, le
vocabulaire et les règles d'or. Tous les autres documents en découlent et ne les
répètent pas — ils y font référence.

**Vous êtes un développeur externe qui reprend le projet ?** Commencez par
**[14_EXTERNAL_DEVELOPER_GUIDE.md](14_EXTERNAL_DEVELOPER_GUIDE.md)** : il est
autoporteur et écrit pour vous.

| Document | Sujet |
|---|---|
| [00_ECOSYSTEME.md](00_ECOSYSTEME.md) | Vision globale, philosophie, règles d'or, **classification officielle des données (3 catégories)**, glossaire |
| [01_PANEL_CONNECTOR.md](01_PANEL_CONNECTOR.md) | Le connecteur côté projet : seul composant qui connaît le Panel |
| [02_PROJECT_CONNECTOR.md](02_PROJECT_CONNECTOR.md) | Le contrat côté projet exposé au Panel : le Panel ne connaît jamais Mongo |
| [03_MANAGER_STANDARD.md](03_MANAGER_STANDARD.md) | Le Manager : pages techniques locales, domaines synchronisés (aucune page supprimée) |
| [04_STANDALONE.md](04_STANDALONE.md) | Le mode autonome : un projet fonctionne toujours sans le Panel |
| [05_INTEGRATED_API_STANDARD.md](05_INTEGRATED_API_STANDARD.md) | IntegratedAPI : configurations synchronisées (Stripe, Brevo, Yousign…), modes TEST/PROD, mode actif par projet |
| [06_WEBHOOK_STANDARD.md](06_WEBHOOK_STANDARD.md) | Centralisation progressive des webhooks + repli local Standalone |
| [07_DUPLICATION_STANDARD.md](07_DUPLICATION_STANDARD.md) | La duplication reste locale ; nouvelle question « URL du Panel » |
| [08_DEPLOIEMENT_STANDARD.md](08_DEPLOIEMENT_STANDARD.md) | Le déploiement reste local ; le Panel se déploie comme un projet |
| [09_AUTHENTIFICATION_PANEL_MANAGER.md](09_AUTHENTIFICATION_PANEL_MANAGER.md) | Auth : rôles internes au Panel, contrat `admin`/`dev` immuable vers le Manager |
| [10_PANEL_ROADMAP.md](10_PANEL_ROADMAP.md) | Feuille de route du Panel, phases, prérequis |
| [11_DONNEES_CENTRALISEES.md](11_DONNEES_CENTRALISEES.md) | Données synchronisées : contrats, factures, paiements, société développeur, Brevo (adresse + templates) |
| [12_EVENEMENTS_REUNIONS.md](12_EVENEMENTS_REUNIONS.md) | Événements et réunions : données synchronisées ; vues globales exclusivement Panel |
| [13_ETAT_DES_LIEUX.md](13_ETAT_DES_LIEUX.md) | Photographie factuelle de l'existant (SB Auto 06) + incohérences détectées |
| [14_EXTERNAL_DEVELOPER_GUIDE.md](14_EXTERNAL_DEVELOPER_GUIDE.md) | **Guide autoporteur du développeur externe** : reprendre le projet, retirer le Panel, brancher son propre système |
| [15_BRIDGE_EXPOSURE.md](15_BRIDGE_EXPOSURE.md) | Ce que le projet expose au Panel : quoi, pourquoi, comment, garanties (Phase 2A) |
| [PHASE_2_PREPARATION.md](PHASE_2_PREPARATION.md) | État après les Phases 1 et 2A : terminé / reste à faire / à développer dans le Panel / invariants intouchables |
| [spec/PanelBridge.openapi.yaml](spec/PanelBridge.openapi.yaml) | **Contrat officiel v1.1.0** — API que tout Panel doit exposer (sens projet → Panel) |
| [spec/ProjectBridge.openapi.yaml](spec/ProjectBridge.openapi.yaml) | **Contrat officiel v1.1.0** — surface `/api/project-bridge/v1` exposée par chaque projet (sens Panel → projet) |

## Les six règles d'or (résumé)

1. **Un projet fonctionne TOUJOURS sans le Panel.** Le Panel est un connecteur
   externe débranchable, jamais une dépendance vitale.
2. **Le Panel n'est pas un propriétaire : c'est un SECOND point
   d'administration.** Tout ce qui est synchronisé est administrable depuis le
   Manager ET depuis le Panel, avec exactement les mêmes actions. Le Panel
   n'est jamais une prison.
3. **Toute donnée appartient à UNE des trois catégories** : locale (le Panel ne
   la modifie jamais), synchronisée (existe des deux côtés, modifiable des deux
   côtés, synchronisation automatique bidirectionnelle), exclusivement Panel
   (le projet n'en a pas connaissance). Pas de source of truth, pas de verrous,
   pas de gouvernance : la simplicité prime — décision assumée, révisable
   explicitement.
4. **Le Panel n'est jamais une exception.** Il est lui-même développé comme un
   projet standard (backend + interface + moteur de déploiement) : mêmes
   conventions, même documentation, même pipeline de mise à jour.
5. **Un seul point de contact dans chaque sens.** Projet → Panel : le
   `PanelBridge`. Panel → Projet : le `ProjectBridge` (le Panel ne
   connaît jamais Mongo). Aucun autre composant ne traverse la frontière.
6. **Le Manager ne connaît jamais les rôles internes du Panel.** Il ne reçoit
   que deux autorisations booléennes (`admin`, `dev`) — ce contrat ne changera
   jamais.

## Vocabulaire officiel (Phase 1)

Depuis la Phase 1, les deux composants de frontière s'appellent officiellement
**PanelBridge** et **ProjectBridge** (anciennement « PanelConnector » /
« ProjectConnector » — le terme *Connector* est abandonné). Les noms de
fichiers historiques `01_PANEL_CONNECTOR.md` / `02_PROJECT_CONNECTOR.md` sont
conservés pour la stabilité des liens. La spécification technique officielle
(contrats OpenAPI) vit dans [spec/](spec/).

## Emplacement

Ces fichiers vivent temporairement dans `docs/panelXvitrine/`. Ils seront déplacés
plus tard vers leur emplacement définitif ; les liens internes sont relatifs et
survivront au déplacement du dossier entier.
