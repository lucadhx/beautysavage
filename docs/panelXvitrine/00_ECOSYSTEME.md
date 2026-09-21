# 00 — L'écosystème Panel ↔ Projets

> Document fondateur. Tout le reste de la documentation `panelXvitrine/` découle
> de ce document et n'en répète pas les règles.

---

## 1. D'où l'on part, où l'on va

### Aujourd'hui

Nous développons **un projet modèle** : SB Auto 06. C'est un logiciel complet et
autonome composé de trois applications :

```
┌────────────────────────── PROJET (ex. SB Auto 06) ──────────────────────────┐
│                                                                              │
│   ┌─────────────┐        ┌──────────────┐        ┌───────────────┐          │
│   │   VITRINE    │        │   MANAGER    │        │    BACKEND    │          │
│   │ site public  │───────▶│ back-office  │───────▶│ API Express   │          │
│   │ React/Vite   │  /api  │ React/Vite   │  /api  │ + Mongoose    │          │
│   └─────────────┘ public └──────────────┘        └───────┬───────┘          │
│                                                          │                  │
│                                                    ┌─────▼─────┐            │
│                                                    │  MongoDB  │            │
│                                                    │ TEST/PROD │            │
│                                                    │ +control  │            │
│                                                    └───────────┘            │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Demain

Des **dizaines de projets quasiment identiques** (un par client), tous issus de la
duplication du projet modèle, et **un Panel interne** — `panel.ly-solution.com` —
qui administre l'ensemble.

```
                        ┌───────────────────────────┐
                        │           PANEL           │
                        │   panel.ly-solution.com   │
                        │                           │
                        │  second point             │
                        │  d'administration :       │
                        │  projets · contrats       │
                        │  factures · paiements     │
                        │  société développeur      │
                        │  événements · réunions    │
                        │  templates emails         │
                        │  config IntegratedAPI     │
                        │  supervision · support    │
                        │  statistiques             │
                        └──────────┬────────────────┘
                                   │  synchronisation + contrats d'échange stables
              ┌────────────────────┼────────────────────┐
              │                    │                    │
      ┌───────▼───────┐    ┌───────▼───────┐    ┌───────▼───────┐
      │   PROJET A    │    │   PROJET B    │    │   PROJET N    │
      │ backend       │    │ backend       │    │ backend       │
      │ manager       │    │ manager       │    │ manager       │
      │ vitrine       │    │ vitrine       │    │ vitrine       │
      │ Mongo à lui   │    │ Mongo à lui   │    │ Mongo à lui   │
      └───────────────┘    └───────────────┘    └───────────────┘
```

L'objectif est d'**industrialiser complètement** la création et la maintenance des
projets. Le Panel **ne sera jamais vendu**. Les projets, eux, **pourront être
revendus** — et cette possibilité conditionne toute l'architecture.

---

## 2. La philosophie — le point le plus important

> **UN PROJET DOIT TOUJOURS POUVOIR FONCTIONNER SANS LE PANEL.**

Le Panel n'est **jamais obligatoire**. Il n'est pas non plus « propriétaire » de
quoi que ce soit dans un projet :

> **Le Panel est un SECOND POINT D'ADMINISTRATION.**
> Tout ce qui est synchronisé est administrable depuis le Manager ET depuis le
> Panel. Le Panel n'est jamais une prison : le projet peut continuer à vivre
> sans lui.

Il apporte uniquement :

- de la **centralisation** (une seule saisie pour N projets),
- de la **supervision** (état de santé, statistiques),
- de l'**administration** (contrats, factures, événements — depuis un point
  unique, en plus du Manager de chaque projet),
- des **outils internes** (support, réunions, planning).

Le scénario qui dicte tout :

```
   Revente d'un projet
   ───────────────────

   AVANT                          APRÈS
   ┌─────────┐                    ┌─────────┐
   │  PANEL  │                    │  PANEL  │        ┌──────────────┐
   └────┬────┘                    └─────────┘        │ Solution du  │
        │ débranché ──────▶                          │ repreneur    │
   ┌────▼────┐                    ┌─────────┐        └──────┬───────┘
   │ PROJET  │                    │ PROJET  │◀── peut se ───┘
   │         │                    │         │    rebrancher (ou pas)
   └─────────┘                    └─────────┘
                                  fonctionne à 100 %
```

On débranche le Panel → **le projet continue à fonctionner**, avec toutes ses
données (elles existent DANS le projet — voir §5). Le nouveau développeur peut
remplacer totalement notre Panel par sa propre solution, **sans jamais avoir
besoin de modifier tout le logiciel** : il lui suffit d'implémenter (ou
d'ignorer) les deux connecteurs. Le guide qui lui est destiné :
[14_EXTERNAL_DEVELOPER_GUIDE.md](14_EXTERNAL_DEVELOPER_GUIDE.md).

> La spécification technique des deux Bridges est **livrée** (Phase 1) :
> [spec/PanelBridge.openapi.yaml](spec/PanelBridge.openapi.yaml) et
> [spec/ProjectBridge.openapi.yaml](spec/ProjectBridge.openapi.yaml) — routes,
> DTO, codes d'erreur, en-têtes, versionnement. Ces deux fichiers sont LE
> contrat officiel ; les documents 01 et 02 en restent la philosophie.

**Le Panel est donc, du point de vue d'un projet, un connecteur externe** — au
même titre que Stripe, Brevo ou Yousign. Il est traité avec la même discipline :
un point d'entrée unique, un contrat stable, une dégradation propre en cas
d'absence.

---

## 3. Règle d'or : le Panel n'est jamais une exception

C'est la règle qui simplifiera le plus tous les développements futurs :

> **Le Panel est lui-même développé comme un projet standard** : un backend, une
> interface, un moteur de déploiement, ses propres conventions, sa propre
> documentation et son propre pipeline de mise à jour.

Conséquences pratiques :

- Le moteur de **duplication**, le moteur de **déploiement**, la **supervision**
  sont réutilisés entre les projets et le Panel. **Une seule architecture à
  maintenir**, pas deux.
- Le Panel se déploie, se met à jour, se sauvegarde et se diagnostique **de la
  même manière** qu'un projet (voir [08_DEPLOIEMENT_STANDARD.md](08_DEPLOIEMENT_STANDARD.md)).
- Toute amélioration d'outillage faite pour les projets profite au Panel, et
  réciproquement. C'est un investissement rapidement rentabilisé.
- Quand un document parle « d'un projet », le Panel est inclus par défaut, sauf
  mention explicite du contraire.

---

## 4. Les deux modes de fonctionnement

Tout projet est, à chaque instant, dans exactement un de ces deux modes :

| | MODE CONNECTED | MODE STANDALONE |
|---|---|---|
| Panel joignable | oui | non (débranché, revendu, panne, choix) |
| Données synchronisées (§5.2) | synchronisées automatiquement dans les deux sens | présentes localement, éditables localement — la synchronisation est simplement à l'arrêt |
| Fonctionnalités métier | 100 % | **100 % — aucune dégradation métier** |
| Credentials d'IntegratedAPI | saisis une fois (en pratique dans le Panel), synchronisés | configurés localement (comme aujourd'hui) |
| Webhooks | reçus par le Panel puis redistribués — **une fois la migration webhook de CE projet effectuée** ([06](06_WEBHOOK_STANDARD.md) §3) ; sinon réception directe même en CONNECTED | reçus en direct par le projet |
| Revendable | oui (après débranchement) | oui, immédiatement |

Le détail du mode Standalone (détection, bascule, retour) est dans
[04_STANDALONE.md](04_STANDALONE.md).

**Principe de conception associé** : toute fonctionnalité qui s'appuie sur le
Panel doit être conçue avec sa réponse à la question « et si le Panel ne répond
pas ? » AVANT d'être développée. Une fonctionnalité sans réponse Standalone
acceptable n'entre pas dans un projet — elle appartient alors au Panel seul
(catégorie 3, §5.3).

---

## 5. Classification officielle des données — les TROIS catégories

**Toute donnée de l'écosystème appartient à exactement UNE des trois catégories
suivantes.** Cette classification remplace toute notion antérieure de
« propriétaire », « autorité » ou « snapshot » : ces concepts ne sont plus
retenus.

```
┌─────────────────────┬──────────────────────────┬─────────────────────────┐
│   1. LOCALES        │   2. SYNCHRONISÉES       │  3. EXCLUSIVEMENT PANEL │
│                     │                          │                         │
│  n'existent que     │  existent dans le Panel  │  n'existent que dans    │
│  dans le projet     │  ET dans le projet       │  le Panel               │
│                     │                          │                         │
│  le Panel ne les    │  modifiables depuis les  │  le projet n'a pas      │
│  modifie JAMAIS     │  DEUX interfaces ·       │  besoin de les          │
│                     │  synchro automatique     │  connaître              │
│                     │  bidirectionnelle        │                         │
└─────────────────────┴──────────────────────────┴─────────────────────────┘
```

### 5.1 Catégorie 1 — Données locales

Elles n'existent que dans le projet. Le Panel ne les modifie jamais (il peut au
mieux les observer via la supervision).

Exemples : services, prestations, tarifs, horaires, réservations, clients,
avis, FAQ, avant/après, promotions, thème, entreprise cliente, demandes de
contact, comptes locaux, statut du site — tout le métier de la vitrine et du
Manager client. S'y ajoutent les moteurs : duplication, déploiement, moteur
métier (machine à états des contrats, facturation, signatures, emails) et la
base Mongo elle-même.

### 5.2 Catégorie 2 — Données synchronisées

Elles existent **dans le Panel ET dans le projet**. Elles sont modifiables
**depuis les deux interfaces** — le Manager et le Panel permettent exactement
les mêmes actions. La synchronisation est **automatique et bidirectionnelle**
(mécanique : [01_PANEL_CONNECTOR.md](01_PANEL_CONNECTOR.md) §3.4).

| Donnée synchronisée | Détail |
|---|---|
| **Contrats** | création, modification, suspension, résiliation, mensualités, frais de lancement, PDF, téléchargement — les mêmes actions des deux côtés — [11_DONNEES_CENTRALISEES.md](11_DONNEES_CENTRALISEES.md) |
| **Factures** | ajout, suppression, téléchargement — idem |
| **Paiements / mensualités** | idem |
| **Documents contractuels** | idem |
| **Société développeur** | nom, logo, références, signataire |
| **Collaborateurs développeur** | équipe, support |
| **Templates emails** | contenu des templates — [11](11_DONNEES_CENTRALISEES.md) §2-3 |
| **Configuration IntegratedAPI** | configurations TEST/PROD + mode actif — [05_INTEGRATED_API_STANDARD.md](05_INTEGRATED_API_STANDARD.md) |
| **Événements** | rattachés au projet — [12_EVENEMENTS_REUNIONS.md](12_EVENEMENTS_REUNIONS.md) |
| **Réunions** | idem |

**Choix de simplicité assumé** : nous sommes deux développeurs. Nous ne voulons
volontairement PAS complexifier avec : source of truth, propriétaire, verrou,
gouvernance, arbitrage, système distribué. Les deux interfaces écrivent, la
synchronisation propage. Notre **unique** règle en cas d'écritures croisées est
« dernier écrit gagne », précisée une fois pour toutes dans
[11_DONNEES_CENTRALISEES.md](11_DONNEES_CENTRALISEES.md) §1 — et nous refusons
toute gouvernance AU-DELÀ de cette règle. Le jour où cela deviendra nécessaire
(équipe plus grande, écritures concurrentes réelles), nous reverrons cette
décision. Aujourd'hui, la simplicité prime.

### 5.3 Catégorie 3 — Données exclusivement Panel

Elles ne concernent que notre fonctionnement interne. Le projet n'a pas besoin
de les connaître ; elles ne transitent jamais vers lui.

Exemples : la liste des projets (le registre), la supervision globale, les
statistiques globales, le CRM interne, le planning interne, les vues
multi-projets, les utilisateurs du Panel et leur RBAC.

### 5.4 Règles transverses

1. **Classer d'abord.** Toute nouvelle donnée est rangée dans une catégorie
   AVANT d'être développée. Une donnée qui hésite entre 1 et 2 est locale par
   défaut (le Panel pourra toujours l'adopter plus tard) ; une donnée qui
   hésite entre 2 et 3 est exclusivement Panel par défaut (moins de
   synchronisation = moins de complexité).
2. **La catégorie 2 implique le Standalone.** Une donnée synchronisée existe
   pleinement dans le projet : Panel éteint, elle reste lisible ET éditable
   localement. C'est ce qui rend le débranchement indolore.
3. **La catégorie 3 ne crée jamais de dépendance projet.** Si un projet finit
   par avoir besoin d'une donnée de catégorie 3, c'est qu'elle était mal
   classée : elle passe en catégorie 2 par une décision explicite.

---

## 6. Les deux connecteurs — un seul point de contact par sens

```
        PROJET                                          PANEL
┌──────────────────────┐                      ┌──────────────────────┐
│  services métier     │                      │  modules du Panel    │
│  (contrats, emails,  │                      │  (projets, contrats, │
│   webhooks, deploy…) │                      │   factures, events…) │
│          │           │                      │          │           │
│          ▼           │   HTTPS sortant      │          ▼           │
│  ┌───────────────┐   │  ───────────────▶    │  (client interne)    │
│  │ PanelBridge │──┼──────────────────────┼──▶ API du Panel      │
│  └───────────────┘   │                      │                      │
│                      │                      │                      │
│  API du projet ◀─────┼──────────────────────┼── appels du Panel    │
│  ┌────────────────┐  │   ◀───────────────   │  ┌────────────────┐  │
│  │ProjectBridge│  │    HTTPS entrant     │  │ client Projet  │  │
│  └────────────────┘  │                      │  └────────────────┘  │
└──────────────────────┘                      └──────────────────────┘
```

- **PanelBridge** (dans chaque projet) : le SEUL composant du projet qui
  connaît l'URL du Panel, l'authentification, la synchronisation, le heartbeat,
  le bootstrap et les échanges. Aucun composant métier n'appelle directement le
  Panel. → [01_PANEL_CONNECTOR.md](01_PANEL_CONNECTOR.md)
- **ProjectBridge** (exposé par chaque projet) : le SEUL contrat que le Panel
  connaît d'un projet. Le Panel ne connaît jamais Mongo, jamais les modèles,
  jamais les routes internes. Le backend du projet reste libre d'évoluer tant que
  ce contrat est honoré. → [02_PROJECT_CONNECTOR.md](02_PROJECT_CONNECTOR.md)

Cette symétrie est volontaire : **remplacer le Panel = réimplémenter le côté
Panel de ces deux contrats**, rien d'autre.

---

## 7. Glossaire officiel

| Terme | Définition |
|---|---|
| **Projet** | Un logiciel complet livré à un client : backend + Manager + vitrine + sa base Mongo. Ex. SB Auto 06. |
| **Panel** | L'outil interne `panel.ly-solution.com` : second point d'administration de tous les projets. Jamais vendu. Lui-même un projet standard. |
| **Manager** | Le back-office d'UN projet (React), utilisé par le client (ADMIN) et par nous (DEV). |
| **Vitrine** | Le site public d'UN projet. |
| **MODE CONNECTED** | Le projet est relié à un Panel joignable ; la synchronisation tourne. |
| **MODE STANDALONE** | Le projet vit sans Panel — toutes les fonctionnalités restent disponibles, la synchronisation est à l'arrêt. |
| **PanelBridge** | Composant du projet, unique porte de sortie vers le Panel. |
| **ProjectBridge** | Contrat HTTP exposé par le projet, unique porte d'entrée du Panel. |
| **Donnée locale** | Catégorie 1 — n'existe que dans le projet ; le Panel ne la modifie jamais. |
| **Donnée synchronisée** | Catégorie 2 — existe dans le Panel ET le projet, modifiable depuis les deux interfaces, synchronisation automatique bidirectionnelle. |
| **Donnée exclusivement Panel** | Catégorie 3 — interne à notre société ; le projet n'en a pas connaissance. |
| **IntegratedAPI** | Une API tierce intégrée (Stripe, Brevo, Yousign, Hostinger…), avec une configuration TEST et une configuration PROD. |
| **Mode actif** | TEST ou PROD — le mode d'une IntegratedAPI utilisé par un projet. Indépendant de l'`ENV` applicatif. |
| **`ENV` applicatif** | Variable d'environnement `TEST`/`PROD` du backend d'un projet : choisit la base Mongo et les outils de recette. Ne choisit JAMAIS le mode des API externes. |
| **Heartbeat** | Signal périodique projet → Panel prouvant que le projet est vivant. |
| **Bootstrap (connexion)** | Premier échange d'appairage entre un projet et le Panel. |

---

## 8. Ce que cette architecture interdit explicitement

1. ❌ Un service métier d'un projet qui fait un `fetch` vers le Panel
   (→ tout passe par le PanelBridge).
2. ❌ Le Panel qui ouvre une connexion Mongo vers la base d'un projet
   (→ tout passe par le ProjectBridge).
3. ❌ Le Manager qui reçoit, stocke ou interprète un rôle interne du Panel
   (→ uniquement les deux booléens `admin`/`dev`, voir
   [09_AUTHENTIFICATION_PANEL_MANAGER.md](09_AUTHENTIFICATION_PANEL_MANAGER.md)).
4. ❌ Une fonctionnalité métier d'un projet qui cesse de fonctionner quand le
   Panel est injoignable.
5. ❌ Le Panel qui modifie une **donnée locale** (catégorie 1) d'un projet.
6. ❌ Une donnée synchronisée (catégorie 2) qui ne serait éditable QUE depuis le
   Panel, ou QUE depuis le Manager : les deux interfaces offrent les mêmes
   actions.
7. ❌ Deux implémentations parallèles d'un même outil (duplication, déploiement,
   supervision) — une pour les projets, une pour le Panel.
8. ❌ Introduire de la gouvernance de données (source of truth, verrous,
   résolution de conflits, arbitrage) sans décision explicite revenant sur le
   choix de simplicité du §5.2.

---

## 9. Où sont les détails

Chaque sujet a son document de référence — voir l'index dans
[README.md](README.md). L'état exact du code au moment où cette architecture a
été figée est photographié dans [13_ETAT_DES_LIEUX.md](13_ETAT_DES_LIEUX.md).
Un développeur externe qui reprend le projet commence par
[14_EXTERNAL_DEVELOPER_GUIDE.md](14_EXTERNAL_DEVELOPER_GUIDE.md).
