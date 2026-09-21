# 04 — Mode STANDALONE : le projet vit sans le Panel

> Prérequis de lecture : [00_ECOSYSTEME.md](00_ECOSYSTEME.md) §2, §4 et §5.

---

## 1. Définition

Un projet est en **MODE STANDALONE** quand il fonctionne sans Panel — que ce soit
parce qu'il n'a jamais été appairé, parce que le Panel est en panne (DEGRADED
prolongé), ou parce qu'il a été **débranché volontairement** (revente,
remplacement par la solution d'un repreneur).

La promesse, non négociable :

> **En Standalone, TOUTES les fonctionnalités du projet continuent de
> fonctionner. Le logiciel reste revendable en l'état.**

Standalone n'est pas un « mode dégradé caché » : c'est l'état de référence.
**C'est l'état actuel de SB Auto 06** — le projet modèle est aujourd'hui 100 %
Standalone, et il doit le rester à chaque étape de la construction du Panel.

La classification des données ([00_ECOSYSTEME.md](00_ECOSYSTEME.md) §5) rend ce
mode presque trivial :

- les **données locales** (catégorie 1) ne dépendent de rien ;
- les **données synchronisées** (catégorie 2) existent pleinement dans le
  projet, lisibles ET éditables — sans Panel, la synchronisation est simplement
  à l'arrêt ;
- les **données exclusivement Panel** (catégorie 3) ne concernent pas le
  projet : leur absence ne lui enlève rien.

---

## 2. Ce que Standalone signifie, domaine par domaine

| Domaine | MODE CONNECTED | MODE STANDALONE |
|---|---|---|
| **IntegratedAPI (configurations + mode)** | donnée synchronisée : saisie une fois (en pratique dans le Panel), copie locale chiffrée | le Manager est l'unique interface : clés saisies/testées localement, comme aujourd'hui (`DevIntegrationsPage`) — [05](05_INTEGRATED_API_STANDARD.md) §7 |
| **Webhooks** | reçus par le Panel, redistribués au projet | le projet **réactive ses webhooks locaux** : réception directe Stripe/Brevo/Yousign, exactement le mécanisme actuel (`managedWebhookRegistry`, sync distant automatique) — [06](06_WEBHOOK_STANDARD.md) §5 |
| **Société développeur / collaborateurs / support** | donnée synchronisée (commune aux N projets) | copie locale, éditable dans les pages actuelles (`DevCompanyPage`/`DevTeamPage`) — plus rien ne se propage, c'est tout |
| **Templates emails** | contenu synchronisé | registre code-first local + édition locale (mécanisme actuel) |
| **Contrats / factures / paiements** | données synchronisées, mêmes actions Manager/Panel | le moteur local actuel (machine à états, Stripe, Yousign) et TOUTES les données restent dans le projet — [11](11_DONNEES_CENTRALISEES.md) §2 |
| **Événements / réunions du projet** | données synchronisées (espace DEV) | copie locale lisible/éditable ; les vues multi-projets (catégorie 3) restent au Panel, sans impact |
| **Duplication / déploiement** | locaux dans les deux modes | identique — [07](07_DUPLICATION_STANDARD.md) / [08](08_DEPLOIEMENT_STANDARD.md) |
| **Supervision** | agrégée par le Panel | pages locales du Manager (santé, versions, rapports) |
| **Auth du Manager** | comptes locaux + accès émis par le Panel | comptes locaux ADMIN/DEV, comme aujourd'hui — [09](09_AUTHENTIFICATION_PANEL_MANAGER.md) §5 |

Lecture du tableau : la colonne Standalone décrit **ce qui existe déjà** dans SB
Auto 06. La construction du Panel consiste à ajouter la colonne CONNECTED **sans
jamais retirer** la colonne Standalone.

---

## 3. La règle de conception « Standalone d'abord »

Pour chaque fonctionnalité touchant au Panel, l'ordre de conception est :

```
1. Quel est le comportement Standalone ?        (souvent : « ce qui existe déjà »)
2. Qu'apporte le mode CONNECTED par-dessus ?    (synchronisation, centralisation)
3. Comment bascule-t-on de l'un à l'autre ?     (dans les deux sens, proprement)
```

Une fonctionnalité qui n'a pas de réponse acceptable au point 1 n'appartient pas
au projet : elle est **exclusivement Panel** (catégorie 3 — ex. vues
multi-projets, CRM, statistiques globales).

### Corollaires

- **Pas de suppression de code local** lors d'une mise sous synchronisation :
  les pages et services locaux restent l'interface n°1 ; le Panel s'ajoute.
- **Pas de donnée « uniquement dans le Panel »** si le projet en a besoin pour
  fonctionner : une telle donnée est de catégorie 2, donc présente localement.
- **Pas d'appel synchrone bloquant au Panel** dans un chemin utilisateur.

---

## 4. Les transitions

### 4.1 CONNECTED → STANDALONE (débranchement)

Deux variantes :

- **Subie** (panne, réseau) : automatique via les états du PanelBridge
  (CONNECTED → DEGRADED). Rien ne change pour l'utilisateur : les données
  locales restent lisibles et éditables ; les modifications s'accumulent dans
  l'outbox et repartiront au rétablissement.
- **Volontaire** (revente, remplacement) : action explicite « Débrancher le
  Panel » sur la page Connexion Panel du Manager, + révocation côté Panel.
  Effets — volontairement minces, car les données sont déjà locales :
  1. la synchronisation s'arrête définitivement ; l'outbox est purgée ;
  2. les credentials d'appairage sont effacés (état UNCONFIGURED) ;
  3. les webhooks locaux sont réactivés
     ([06_WEBHOOK_STANDARD.md](06_WEBHOOK_STANDARD.md) §5).

Le débranchement est une opération **finie, documentée et testable** — pas un
état de fait accidentel. Aucune donnée n'est perdue : tout ce qui était
synchronisé est déjà dans la base du projet.

### 4.2 STANDALONE → CONNECTED (appairage / ré-appairage)

Bootstrap via la page Connexion Panel
([01_PANEL_CONNECTOR.md](01_PANEL_CONNECTOR.md) §3.1). Au (ré)appairage, les
deux côtés échangent leurs données synchronisées et repartent, en appliquant
les cinq règles minimales de synchronisation
([11_DONNEES_CENTRALISEES.md](11_DONNEES_CENTRALISEES.md) §1.1) : dernier écrit
gagne, tombstones pour les suppressions, identités UUID, anti-écho,
idempotence. Rien au-delà ; si ce comportement devient un jour insuffisant, la
décision sera revue explicitement.

---

## 5. Vérifiabilité

Le mode Standalone doit être **prouvé en continu**, pas présumé :

- La suite de tests des projets tourne **sans Panel** (comme aujourd'hui —
  c'est déjà le cas par construction). Elle doit le rester : aucun test métier
  ne doit exiger un Panel joignable.
- À terme (Phase 1+), un test de conformité « standalone » vérifiera qu'aucun
  module métier n'importe le PanelBridge directement et qu'aucune URL de
  Panel n'apparaît hors de celui-ci — sur le modèle des tests de conformité
  existants (`webhook-providers-uniformity.test.js`, `env-mode-independence.test.js`).
- Chaque lot de synchronisation (voir [10_PANEL_ROADMAP.md](10_PANEL_ROADMAP.md))
  inclut un scénario de recette « débrancher puis tout utiliser ».
