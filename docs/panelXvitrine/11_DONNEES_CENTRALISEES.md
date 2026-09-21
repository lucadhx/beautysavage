# 11 — Données synchronisées : contrats, factures, société développeur, Brevo

> Prérequis de lecture : [00_ECOSYSTEME.md](00_ECOSYSTEME.md) §5 (classification
> en trois catégories) et [04_STANDALONE.md](04_STANDALONE.md).
> Ce document détaille les principales **données synchronisées** (catégorie 2) :
> elles existent dans le Panel ET dans le projet, et sont modifiables depuis les
> deux interfaces. *(Le nom de fichier historique `11_DONNEES_CENTRALISEES.md`
> est conservé pour la stabilité des liens.)*

---

## 1. Le modèle unique : la donnée synchronisée

Toutes les données de ce document obéissent au même schéma :

```
        PANEL (interface 2)                    PROJET (interface 1)
┌─────────────────────────────┐   synchro   ┌─────────────────────────────┐
│  la donnée, éditable        │◀───────────▶│  la donnée, éditable        │
│  (mêmes actions que le      │  AUTOMATIQUE│  (mêmes actions que le      │
│   Manager)                  │  BIDIRECT.  │   Panel)                    │
└─────────────────────────────┘             └─────────────────────────────┘

  Panel éteint / débranché  →  le projet garde sa copie, éditable :
                               rien ne change pour lui (Standalone).
```

Règles communes :

1. **Les deux interfaces permettent exactement les mêmes actions.** Ni le
   Manager ni le Panel n'est « en lecture seule » sur une donnée synchronisée.
2. **La synchronisation est automatique et bidirectionnelle** — portée par le
   PanelBridge ([01](01_PANEL_CONNECTOR.md) §3.4) et le ProjectBridge
   ([02](02_PROJECT_CONNECTOR.md)).
3. **Pas de gouvernance** : pas de source of truth, pas de propriétaire, pas de
   verrou, pas d'arbitrage. Deux développeurs, des écritures rares : la
   simplicité prime. La seule règle est celle du §1.1 ci-dessous. Si un jour
   des écritures concurrentes réelles posent problème, la décision sera revue
   explicitement ([00](00_ECOSYSTEME.md) §5.2 et §8, interdit n°8).
4. **Standalone garanti par construction** : la donnée vit dans le projet ;
   sans Panel, elle reste lisible et éditable — la synchronisation est
   simplement à l'arrêt.

### 1.1 Les règles minimales de synchronisation (l'intégralité de la mécanique)

Cinq règles, et rien d'autre — c'est volontairement l'intégralité de la
« gestion de conflits » de l'écosystème :

1. **Dernier écrit gagne (LWW)**, à la granularité du **document entier**
   (un contrat, une facture, un template…). L'horodatage de référence est celui
   posé par **le côté qui émet la modification**, au moment de l'écriture ; en
   cas d'égalité stricte, la version du Panel est retenue (départage
   arbitraire mais déterministe). Les horloges des machines sont supposées
   raisonnablement synchronisées (NTP) — une dérive de quelques secondes peut
   inverser un vainqueur : c'est accepté, cohérent avec des écritures rares
   faites par deux personnes.
2. **Identité stable** : toute donnée synchronisée porte un identifiant unique
   (UUID) généré par **le côté qui la crée**. Pas de collision possible entre
   une création Panel et une création Manager simultanées : ce sont deux
   documents distincts, les humains fusionnent s'il y a doublon métier.
3. **Les suppressions sont des écritures** : supprimer produit une pierre
   tombale horodatée (tombstone), synchronisée comme le reste et conservée un
   temps raisonnable. Au rattrapage, un projet resté éteint distingue ainsi
   « donnée supprimée » de « donnée jamais reçue ».
4. **Anti-écho** : chaque propagation transporte l'identifiant de l'écriture
   d'origine ; une modification n'est jamais renvoyée à son émetteur, et une
   donnée commune à N projets ([§3](#3-société-développeur-collaborateurs-support))
   redescend vers tous les projets SAUF celui d'où elle vient.
5. **Idempotence** : rejouer une propagation est un non-événement (clé
   d'idempotence par écriture — [02](02_PROJECT_CONNECTOR.md) §3).

Ces règles sont un engagement d'architecture (les Bridges les implémentent
telles quelles — spécification dans [spec/](spec/)), pas une figure de style.

---

## 2. Contrats, factures, paiements, documents contractuels

### Le principe

> **Le contrat est une donnée synchronisée.** Il existe dans le Panel ET dans le
> projet. Il est modifiable depuis le Panel ET depuis le Manager.
> **Même principe pour : factures, paiements, mensualités, documents
> contractuels.**

Les deux interfaces permettent exactement les mêmes actions :

| Action | Depuis le Manager | Depuis le Panel |
|---|---|---|
| Création d'un contrat | ✔ | ✔ |
| Modification | ✔ | ✔ |
| Suspension | ✔ | ✔ |
| Résiliation | ✔ | ✔ |
| Changement des mensualités | ✔ | ✔ |
| Changement des frais de lancement | ✔ | ✔ |
| Remplacement du PDF | ✔ | ✔ |
| Téléchargement du contrat | ✔ | ✔ |
| Ajout d'une facture | ✔ | ✔ |
| Suppression d'une facture | ✔ | ✔ |
| Téléchargement d'une facture | ✔ | ✔ |

### Comment ça s'articule avec le moteur actuel

Le **moteur** des contrats reste une donnée locale (catégorie 1) : machine à
états, intégration Yousign, checkouts Stripe, enforcement « pas de contrat
actif ⇒ site suspendu » — tout cela vit et reste dans le backend du projet
([13_ETAT_DES_LIEUX.md](13_ETAT_DES_LIEUX.md) §6). Ce qui est synchronisé,
c'est **la donnée** (le contrat, ses montants, son statut, ses factures, ses
paiements, ses PDF).

Concrètement, une action lancée depuis le Panel (ex. résilier) est **exécutée
par le backend du projet** — via le catalogue d'actions du ProjectBridge —
exactement comme si elle avait été cliquée dans le Manager : mêmes gardes, même
machine à états, mêmes webhooks Stripe. Le Panel n'implémente PAS un second
moteur de contrats ; il offre une seconde interface au moteur du projet, et la
donnée résultante se synchronise dans les deux sens.

```
  clic « Résilier » dans le PANEL          clic « Résilier » dans le MANAGER
              │                                         │
              ▼                                         ▼
   ProjectBridge (action)                    API locale du Manager
              └────────────────┬────────────────────────┘
                               ▼
                UN SEUL moteur : le backend du projet
              (machine à états, Stripe, Yousign, enforcement)
                               │
                               ▼
              donnée mise à jour → synchronisée vers le Panel
```

Avantage : un projet revendu emporte un moteur de contrats complet et
fonctionnel (c'est déjà le cas de SB Auto 06 aujourd'hui), et le Panel n'a
aucune logique métier à ré-implémenter.

### Vue parc

Le Panel agrège les contrats/factures/paiements de TOUS les projets (échéances,
encours, relances, statistiques) — cette **vue multi-projets** est une donnée de
catégorie 3, construite à partir des données synchronisées.

---

## 3. Société développeur, collaborateurs, support

### Aujourd'hui

Chaque projet possède ses informations développeur dans SA base : singleton
`DevCompany` (nom, logo, slogan, références de contact typées, signataire des
contrats) et collection `TeamMember` (équipe), édités via les pages DEV
« Entreprise développeur » / « Équipe développeur », affichés au client sur la
page « Support » du Manager et au pied de la vitrine.

Avec N projets : N copies à maintenir à la main.

### Demain

Ces informations deviennent des **données synchronisées** : saisies une fois
(en pratique dans le Panel, puisqu'elles sont communes à tous les projets),
elles se propagent automatiquement à chaque projet — et restent éditables
depuis chaque Manager, la modification remontant et se redistribuant.

```
   PANEL                                   PROJETS A, B, … N
┌─────────────────────────┐  synchro    ┌──────────────────────────────┐
│ Société développeur     │◀──────────▶ │ DevCompany / TeamMember      │
│  nom, logo, slogan      │ bidirect.   │ (modèles locaux actuels,     │
│  références contact     │             │  pages DEV actuelles)        │
│  signataire contrats    │             │ affichés : page Support,     │
│ Collaborateurs, support │             │ pied de vitrine, e-mails     │
└─────────────────────────┘             └──────────────────────────────┘
```

Cas particulier à connaître : cette donnée est synchronisée **entre N+1
points** (le Panel et tous les projets). Une modification faite dans le Manager
du projet A se propage donc, via le Panel, aux projets B…N. C'est voulu : c'est
LA même société développeur partout.

**Même principe pour** : les collaborateurs développeur, le support et
l'adresse e-mail support (§4).

En Standalone, le projet garde et édite sa copie locale — c'est exactement le
fonctionnement actuel de SB Auto 06, qui ne change pas.

---

## 4. Brevo : adresse support, nom d'expéditeur, templates

### Philosophie

> **L'adresse support est définie une seule fois** (donnée synchronisée, saisie
> en pratique dans le Panel). **Les templates sont définis une seule fois.**
> **Le projet ne choisit jamais l'adresse support** — au sens où personne ne la
> choisit projet par projet : c'est UNE valeur commune, synchronisée partout.

| Élément | Catégorie | Règle |
|---|---|---|
| **Adresse expéditrice / support** | synchronisée | une seule adresse (par mode d'IntegratedAPI Brevo), commune à TOUS les projets ; modifiable depuis le Panel ou un Manager, propagée partout |
| **Nom de l'expéditeur** | dérivé automatiquement | **`<Nom entreprise cliente>` + « (Site) »** — ex. « SB Auto 06 (Site) » ; le nom vient du `Company.name` (donnée locale) du projet, le suffixe est imposé ; personne ne le choisit |
| **Templates d'e-mails** | synchronisée (contenu) | définis et édités une seule fois, synchronisés vers les projets ; éditables aussi depuis un Manager (la modification se propage) |
| **Envoi effectif** | locale | le backend du projet envoie (driver Brevo local, credentials synchronisés — [05](05_INTEGRATED_API_STANDARD.md)) ; livraisons et tracking journalisés localement |

```
   PANEL                                        PROJET « Garage Dupont »
┌──────────────────────────────┐             ┌────────────────────────────────┐
│ adresse support (par mode)   │             │ envoi d'un e-mail :            │
│   support@ly-solution.com    │◀── synchro ▶│  From: « Garage Dupont (Site) »│
│ templates (5+, une source)   │             │        <support@ly-solution…>  │
│                              │             │  corps: template synchronisé   │
│                              │             │  variables: données DU projet  │
└──────────────────────────────┘             └────────────────────────────────┘
```

### Justification

- Une seule adresse à vérifier/authentifier chez Brevo (SPF/DKIM), une seule
  réputation d'expéditeur à protéger.
- Une correction de template (typo, mention légale) se fait une fois et se
  propage partout.
- Le client, lui, voit toujours SON nom commercial comme expéditeur — la règle
  du suffixe « (Site) » rend l'origine transparente sans sacrifier la marque.

### Répartition du contrat des templates

Le standard reste celui du registre actuel : le **code du projet** définit le
contrat — identifiants, variables autorisées, types, valeurs d'exemple,
résolveurs (donnée locale, versionnée avec le code) — et le **contenu** (sujet,
HTML, activation) est la donnée synchronisée. Un template synchronisé qui
référence une variable inconnue du projet est rejeté à la validation, comme
aujourd'hui (`validateTemplateRegistry`).

⚠️ Point à corriger avant la synchronisation : la variable
`developer.supportEmail` est requise par un template actuel sans résolveur
runtime identifié — voir [13_ETAT_DES_LIEUX.md](13_ETAT_DES_LIEUX.md) §9.

### Standalone

Sans Panel : l'expéditeur et les templates restent configurables localement
(mécanisme actuel conservé, il devient simplement l'unique interface). Un
projet revendu choisit alors librement SA propre adresse support.

---

## 5. Résumé par donnée

| Donnée | Catégorie | Éditable depuis | Standalone |
|---|---|---|---|
| Contrats | synchronisée | Manager + Panel (mêmes actions) | moteur + données 100 % locaux |
| Factures / paiements / mensualités | synchronisée | Manager + Panel | idem |
| Documents contractuels (PDF) | synchronisée | Manager + Panel | stockage local actuel (`storage/contracts/`) |
| Société développeur | synchronisée (commune aux N projets) | Manager + Panel | copie locale éditable |
| Collaborateurs / support | synchronisée (commune) | Manager + Panel | idem |
| Adresse support / expéditeur | synchronisée (commune) | Manager + Panel | configuration locale |
| Nom d'expéditeur | règle automatique | personne (dérivé de `Company.name` + « (Site) ») | idem (règle conservée) |
| Templates e-mails (contenu) | synchronisée | Manager + Panel | édition locale |
| Contrat de variables des templates | locale (code) | le dépôt du projet | idem |
