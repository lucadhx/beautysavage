# 10 — Roadmap du Panel

> Prérequis de lecture : tous les documents 00 → 09 (cette roadmap les
> ordonnance, elle ne les répète pas).
> Les numéros de phases sont indicatifs ; les DÉPENDANCES, elles, sont fermes.

---

## 0. Principes d'ordonnancement

1. **Standalone d'abord** ([04_STANDALONE.md](04_STANDALONE.md) §3) : chaque lot
   définit son comportement sans Panel avant son comportement avec.
2. **Le Panel naît comme un projet** ([00_ECOSYSTEME.md](00_ECOSYSTEME.md) §3) :
   sa première version est un squelette de projet standard (backend + interface
   + moteur de déploiement), pas une application ad hoc.
3. **Aucun lot ne casse SB Auto 06** : le projet modèle reste livrable à tout
   moment ; les fonctionnalités Panel s'ajoutent en mode CONNECTED sans retirer
   le chemin local.
4. **Les contrats avant les fonctionnalités** : PanelBridge et
   ProjectBridge sont spécifiés et testés (stubs) avant le premier module
   métier du Panel.

```
 Phase 0        Phase 1              Phase 2               Phase 3            Phase 4+
 (faite)   ┌───────────────┐   ┌────────────────┐   ┌────────────────┐   ┌──────────────┐
 DOCS ────▶│ assainissement│──▶│ squelette Panel│──▶│synchronisations│──▶│ RBAC complet │
           │ + spéc. des   │   │ + appairage +  │   │ successives    │   │ webhooks     │
           │ 2 connecteurs │   │ supervision    │   │ (API, dev-co,  │   │ centralisés  │
           └───────────────┘   │ lecture seule  │   │ Brevo, accès)  │   │ contrats     │
                               └────────────────┘   └────────────────┘   └──────────────┘
```

---

## 1. Phase 0 — Documentation (le présent dossier) ✅

Figer l'architecture : philosophie, classification des données, deux connecteurs,
standards par domaine, état des lieux factuel. **Aucun code modifié.**

---

## 2. Phase 1 — Assainissement + spécification des contrats

Objectif : préparer le terrain SANS construire le Panel.

### 2.1 Assainissement (issu de [13_ETAT_DES_LIEUX.md](13_ETAT_DES_LIEUX.md) §9)

| Lot | Contenu |
|---|---|
| A1 | Résoudre `developer.supportEmail` (champ + résolveur, ou retrait du template) — constat #1 |
| A2 | Mettre à jour `docs/WEBHOOKS.md` §5, archiver les `STRIPE_CLI_*.md` racine, compléter `backend/.env.example` (`PROJECT_NAME`) — #2, #11 |
| A3 | **Secrets uniques à la duplication** (`JWT_SECRET`, `INTEGRATED_API_ENCRYPTION_KEY` générés ; stratégie de ré-encryption) — #3, condition de revendabilité |
| A4 | Régulariser `webhookSecretPrevious` dans le catalogue — #4 |
| A5 | Choisir le registre de référence des destinations de déploiement (plan de contrôle) et le devenir du registre métier redondant — #6 |

### 2.2 Spécification des connecteurs

- Spéc technique du **PanelBridge** (méthodes, états, stockage des
  credentials, outbox) et du **ProjectBridge** (endpoints, DTO, auth,
  idempotence, versionnement) — les documents 01/02 fixent la philosophie, la
  Phase 1 fixe les schémas. Livrable concret : un **squelette OpenAPI**
  (bootstrap, heartbeat, push/pull de synchronisation, catalogue d'actions,
  format du jeton d'accès `{admin, dev}`) implémentant les règles de
  synchronisation de [11](11_DONNEES_CENTRALISEES.md) §1.1. C'est LA condition
  pour que la promesse « remplacer le Panel = implémenter deux contrats »
  ([14](14_EXTERNAL_DEVELOPER_GUIDE.md) §6) devienne actionnable.
- **Stubs des deux côtés** + tests de conformité (« aucun fetch Panel hors
  connecteur », « la suite métier tourne sans Panel »).
- Choix de la stratégie de partage du moteur de déploiement (duplication
  synchronisée vs module versionné) — [08_DEPLOIEMENT_STANDARD.md](08_DEPLOIEMENT_STANDARD.md) §2.

**Sortie de phase** : SB Auto 06 inchangé fonctionnellement, contrats gelés,
dette bloquante purgée.

---

## 3. Phase 2 — Squelette du Panel + appairage + supervision lecture seule

| Lot | Contenu | Dépend de |
|---|---|---|
| B1 | **Squelette du Panel comme projet standard** : duplication du socle (backend + interface + moteur de déploiement), dépouillé du métier vitrine ; le Panel se déploie lui-même dès son premier jour | Phase 1 (A3, partage moteur) |
| B2 | **Registre des projets + bootstrap d'appairage** (PanelBridge v1 dans les projets : UNCONFIGURED → CONNECTED, page Manager « Connexion Panel ») | spéc. connecteurs |
| B3 | **Heartbeat + supervision lecture seule** : versions, santé, dernier déploiement remonté — première valeur visible du Panel | B2 |
| B4 | **Question « URL du Panel » dans la duplication** ([07_DUPLICATION_STANDARD.md](07_DUPLICATION_STANDARD.md) §3) | B2 |
| B5 | Utilisateurs du Panel v1 (rôles simples ADMIN/DEV internes) | B1 |

**Sortie de phase** : le Panel existe, se déploie comme un projet, voit le parc.
Aucun domaine n'est encore synchronisé.

---

## 4. Phase 3 — Mises sous synchronisation successives (un domaine = un lot)

Chaque lot rend un domaine **synchronisé** (catégorie 2 : donnée présente et
éditable des deux côtés, synchronisation bidirectionnelle automatique). Ordre
recommandé, du moins risqué au plus structurant :

| Lot | Domaine | Références |
|---|---|---|
| C1 | **Société développeur + collaborateurs + support** (synchronisation bidirectionnelle, commune aux N projets ; les pages locales restent pleinement éditables) | [11](11_DONNEES_CENTRALISEES.md) §3 |
| C2 | **Brevo : adresse support + règle du nom d'expéditeur `Company.name` + « (Site) »** | [11](11_DONNEES_CENTRALISEES.md) §4, constat #10 |
| C3 | **Templates e-mails** (contenu synchronisé ; contrat de variables dans le code du projet) | [11](11_DONNEES_CENTRALISEES.md) §4 |
| C4 | **IntegratedAPI : configurations synchronisées** (saisie unique en pratique dans le Panel, copie locale chiffrée par projet, indisponibilité des configs invalides, mode actif par projet basculable des deux côtés à résultat identique) | [05](05_INTEGRATED_API_STANDARD.md) |
| C5 | **Accès Manager émis par le Panel** (`{admin, dev}`) — les comptes locaux restent | [09](09_AUTHENTIFICATION_PANEL_MANAGER.md) |

Chaque lot Cx inclut obligatoirement : son chemin Standalone vérifié
(débrancher → tout fonctionne), sa recette réelle, sa documentation.

---

## 5. Phase 4+ — Les chantiers longs

| Lot | Domaine | Références / prérequis |
|---|---|---|
| D1 | **Webhooks centralisés** (réception Panel + redistribution, fournisseur par fournisseur, projet par projet ; réactivation locale au débranchement) | [06](06_WEBHOOK_STANDARD.md) ; C4 (le Panel détient les clés nécessaires à l'enregistrement) |
| D2 | **Contrats / factures / paiements** : d'abord agrégation lecture (le Panel lit via ProjectBridge), puis synchronisation bidirectionnelle complète + actions du catalogue (mêmes actions des deux côtés, moteur unique côté projet) — le plus gros chantier métier | [11](11_DONNEES_CENTRALISEES.md) §2 |
| D3 | **Événements + réunions** (données synchronisées : module Panel + vue espace DEV du Manager) — le côté Panel peut démarrer dès la Phase 2 ; la synchronisation vers les projets dépend des connecteurs | [12](12_EVENEMENTS_REUNIONS.md) |
| D4 | **RBAC complet du Panel** (le contrat `{admin, dev}` ne bouge pas) | [09](09_AUTHENTIFICATION_PANEL_MANAGER.md) ; C5 |
| D5 | **Statistiques / support outillé** | supervision B3 mûre |
| D6 | **Update/rollback atomiques** (P3 du plan de contrôle : `releases/<id>/` + symlink) — conditionne la « mise à jour du parc » confortable | constat #9 |

---

## 6. Ce que cette roadmap interdit

- ❌ Commencer un module métier du Panel avant que les deux connecteurs soient
  spécifiés et stubbés (Phase 1).
- ❌ Mettre un domaine sous synchronisation sans son chemin Standalone vérifié
  dans le MÊME lot.
- ❌ Retirer une page ou du code local au motif que le Panel couvre le domaine —
  interdit sans condition ([00_ECOSYSTEME.md](00_ECOSYSTEME.md) §8 interdit
  n°6, [03_MANAGER_STANDARD.md](03_MANAGER_STANDARD.md) §5).
- ❌ Donner au Panel un pouvoir que ce dossier ne lui donne pas (déployer un
  projet, dupliquer un projet, toucher Mongo, exécuter du code distant).
