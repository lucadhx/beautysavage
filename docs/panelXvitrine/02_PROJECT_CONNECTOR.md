# 02 — ProjectBridge : le contrat stable exposé par chaque projet

> **Manifeste — `presentation.logoUrl` / `.faviconUrl`.** Ces champs portent
> TOUJOURS une URL absolue joignable, résolue par le projet contre son propre
> domaine backend : [MEDIAS_PUBLICS.md](MEDIAS_PUBLICS.md).


> Prérequis de lecture : [00_ECOSYSTEME.md](00_ECOSYSTEME.md) et
> [01_PANEL_CONNECTOR.md](01_PANEL_CONNECTOR.md) (principe inverse).
> Composant **futur** — ce document en fige le contrat et la philosophie.

---

## 1. Le principe inverse

Le PanelBridge règle le sens projet → Panel. Le **ProjectBridge** règle le
sens Panel → projet, avec une règle tout aussi absolue :

> **Le Panel ne doit JAMAIS connaître Mongo.**
> Ni l'URI, ni les noms de bases, ni les modèles, ni la forme des documents.

Le Panel communique uniquement avec un **ProjectBridge** exposé par chaque
projet : une petite surface HTTP au contrat **stable et versionné**. Derrière ce
contrat, le backend du projet reste **totalement libre d'évoluer** — renommer des
modèles, changer de structure, migrer des collections — sans jamais casser le
Panel.

```
        PANEL                                    PROJET
┌───────────────────┐              ┌───────────────────────────────────┐
│                   │              │      ┌───────────────────────┐    │
│  module Projets   │   HTTPS      │      │   ProjectBridge    │    │
│  module Contrats  │─────────────▶│      │  (contrat versionné)  │    │
│  supervision      │              │      └──────────┬────────────┘    │
│                   │              │                 │ appels internes │
│   ❌ jamais de    │              │      ┌──────────▼────────────┐    │
│   connexion Mongo │              │      │  services métier      │    │
│   vers un projet  │              │      │  du projet            │    │
│                   │              │      └──────────┬────────────┘    │
└───────────────────┘              │      ┌──────────▼────────────┐    │
                                   │      │  Mongo DU projet      │    │
                                   │      └───────────────────────┘    │
                                   └───────────────────────────────────┘
```

### Pourquoi

- **Symétrie de la revente** : le repreneur voit exactement ce que notre Panel
  voyait — un contrat documenté, rien de plus. Il peut brancher sa propre
  solution dessus.
- **Découplage des rythmes** : les dizaines de projets n'auront PAS tous la même
  version du backend au même moment. Un contrat stable versionné absorbe cette
  dérive ; un accès direct aux données ne l'absorberait jamais.
- **Sécurité** : la surface offerte au Panel est un catalogue fermé
  d'opérations, authentifié, journalisé — pas un accès de niveau base de
  données.

---

## 2. Nature du contrat

### 2.1 Forme

- Une surface HTTP dédiée du backend du projet (par ex. sous un préfixe réservé,
  à définir en Phase 1 — vraisemblablement `/api/panel/*`), servie par le
  backend existant.
- Authentifiée par les credentials d'appairage délivrés au bootstrap
  ([01_PANEL_CONNECTOR.md](01_PANEL_CONNECTOR.md) §3.1) — jamais par un compte
  utilisateur DEV/ADMIN du Manager.
- **Versionnée** : chaque réponse porte la version du contrat. Évolutions
  additives = version mineure ; rupture = version majeure, avec période de
  double-service. Le contrat est fait pour ne JAMAIS avoir besoin d'une version
  majeure, ou presque.

### 2.2 Contenu (catalogue fermé, par grandes familles)

| Famille | Exemples d'opérations | Nature |
|---|---|---|
| **Identité & santé** | qui es-tu, quelle version, es-tu en bonne santé | lecture (le backend expose déjà `/health` et `/api/version` — le ProjectBridge les englobera dans sa surface authentifiée) |
| **Supervision** | état résumé, compteurs, dernier déploiement | lecture |
| **Synchronisation** | livrer une modification d'une **donnée synchronisée** (contrat, facture, société développeur, template, événement, réunion…) faite côté Panel ; lire l'état local de ces mêmes données | écriture idempotente, limitée à la catégorie 2 |
| **Actions du catalogue** | déclencher côté projet une action offerte par le Manager (ex. résilier un contrat, changer le mode actif d'une IntegratedAPI) — exécutée par le moteur local, mêmes gardes | action — [11](11_DONNEES_CENTRALISEES.md) §2, [05](05_INTEGRATED_API_STANDARD.md) §5 |
| **Webhooks** | livrer un événement webhook redistribué | écriture idempotente — [06_WEBHOOK_STANDARD.md](06_WEBHOOK_STANDARD.md) |
| **Accès Manager** | émettre une autorisation d'accès `admin`/`dev` | [09_AUTHENTIFICATION_PANEL_MANAGER.md](09_AUTHENTIFICATION_PANEL_MANAGER.md) |

Ce tableau est une carte, pas une spécification : le détail de chaque famille vit
dans son document dédié, et la spécification technique (schémas, codes d'erreur)
sera écrite en Phase 1.

### 2.3 Ce que le contrat interdit

1. ❌ Toute opération « requête libre » (pas de query générique, pas de filtre
   arbitraire sur des collections).
2. ❌ Toute écriture sur une **donnée locale** (catégorie 1 — contenu vitrine,
   comptes locaux, thème, moteurs…) : le Panel ne modifie que des données
   synchronisées, et il ne « télécommande » pas le métier — les actions du
   catalogue sont exécutées par le moteur local du projet, avec ses gardes.
3. ❌ Toute réponse exposant la forme interne des documents Mongo. Les réponses
   sont des DTO du contrat, pas des documents sérialisés.
4. ❌ Tout secret en clair dans une réponse (mêmes règles de masquage que le
   reste du projet).

---

## 3. Idempotence et tolérance aux pannes

- Toute écriture entrante (modification synchronisée, webhook redistribué)
  porte une **clé d'idempotence** ; la relivraison est un non-événement. Le projet applique déjà
  ce patron partout (`WebhookEvent` avec index unique `provider+externalEventId`,
  `idempotencyKey` des événements de domaine) — le ProjectBridge le
  généralise.
- Le Panel **réessaie** ; le projet ne suppose jamais « au plus une fois ».
- Un projet éteint au moment d'une livraison la recevra au retry suivant ou la
  tirera via son PanelBridge au réveil : les deux chemins convergent vers le
  même état (livraison poussée et sync tirée sont réconciliées par les mêmes
  clés d'idempotence).

---

## 4. Relation avec le PanelBridge

Les deux connecteurs sont les deux faces d'une même frontière :

| | PanelBridge | ProjectBridge |
|---|---|---|
| Vit dans | le projet | le projet |
| Sens | projet → Panel (sortant) | Panel → projet (entrant) |
| Initiative | le projet appelle | le Panel appelle |
| Connaît | l'URL et l'auth du Panel | rien du Panel (il vérifie juste l'auth) |
| Usage typique | pousser les modifications locales (outbox), tirer le rattrapage, heartbeat | livraison temps réel des modifications côté Panel, actions du catalogue, supervision à la demande |

**Règle de robustesse** : quand une donnée peut transiter par les deux chemins,
le chemin **tiré** (PanelBridge) sert de rattrapage systématique ; le chemin
**poussé** (ProjectBridge) n'est qu'une optimisation de latence. Ainsi, un
projet dont l'URL publique change, ou qui reste longtemps éteint, se
resynchronise toujours tout seul — les clés d'idempotence font converger les
deux chemins vers le même état.

---

## 5. Standalone et revente

- En **MODE STANDALONE**, le ProjectBridge est simplement **inactif** : la
  surface refuse toute requête (credentials révoqués/absents). Rien d'autre ne
  change dans le projet.
- À la **revente**, le repreneur dispose de ce document + de la spécification
  Phase 1 du contrat. Il peut :
  1. ignorer le ProjectBridge (projet 100 % autonome), ou
  2. implémenter SON panel en parlant le même contrat.

C'est la concrétisation de la promesse du
[00_ECOSYSTEME.md](00_ECOSYSTEME.md) §2 : « le nouveau développeur ne doit jamais
avoir besoin de modifier tout le logiciel ».

---

## 6. Résumé

| Question | Réponse |
|---|---|
| Le Panel peut-il lire la base d'un projet ? | Jamais. Il parle au ProjectBridge. |
| Le Panel peut-il modifier le métier d'un projet ? | Non. Catalogue fermé : modifications de données synchronisées, événements, actions définies. |
| Que se passe-t-il si le backend du projet évolue ? | Rien pour le Panel, tant que le contrat versionné est honoré. |
| Comment le Panel sait-il qu'un projet va bien ? | Heartbeat (tiré par le projet) + endpoints santé du ProjectBridge. |
| Et en Standalone ? | La surface est inactive ; le projet vit sa vie. |
