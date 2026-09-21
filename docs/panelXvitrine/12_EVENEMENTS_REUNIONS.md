# 12 — Événements et réunions

> Prérequis de lecture : [00_ECOSYSTEME.md](00_ECOSYSTEME.md) §5.
> Événements et réunions sont des **données synchronisées** (catégorie 2) :
> ils existent dans le Panel ET dans le projet auquel ils se rattachent, et
> sont modifiables depuis les deux interfaces. Les vues multi-projets (agenda
> global, planning interne, CRM) restent **exclusivement Panel** (catégorie 3).

⚠️ Ne pas confondre avec les **événements de domaine** techniques des projets
(`DomainEvent`, dispatcher, page DEV « Événements système ») : ceux-là sont un
mécanisme interne du backend de chaque projet et sont une donnée locale. Le
présent document parle d'événements **métier internes à notre société**
(suivi de la relation client).

---

## 1. Événements — le journal de bord de la relation client

### Philosophie métier

Tout ce qui se passe avec un client ou sur un projet mérite une trace datée,
typée et retrouvable — aujourd'hui cette mémoire n'existe que dans nos têtes,
nos e-mails et nos agendas.

Le module « Événements » permet d'enregistrer :

- des **événements** (fait notable — **toujours rattaché à un projet** ; ce qui
  concerne un prospect ou un client sans projet relève du CRM interne,
  catégorie 3, hors de ce module),
- des **appels** (téléphoniques),
- des **repas** (d'affaires),
- des **visios**,
- des **interventions** (techniques, sur site ou à distance),
- des **notes** (libres),
- du **suivi** (tâches de relance, points d'attention).

### Cycle de vie

> Les événements peuvent être **planifiés**. Les événements passés doivent être
> **validés**.

```
                 création
                    │
      ┌─────────────┴─────────────┐
      ▼                           ▼
 ┌──────────┐   la date      ┌──────────┐
 │ PLANIFIÉ │───passe───────▶│ À VALIDER│      « il a bien eu lieu ?
 └──────────┘                └────┬─────┘        que s'est-il dit ? »
      │ annulation                │ validation (avec compte rendu)
      ▼                           ▼
 ┌──────────┐                ┌──────────┐
 │ ANNULÉ   │                │ VALIDÉ   │  ← seule forme faisant partie
 └──────────┘                └──────────┘    de l'historique officiel
```

La validation est le cœur de la philosophie : un événement passé non validé est
une **dette de suivi** visible (liste « à valider ») — l'outil pousse à tenir le
journal à jour, sinon il ne vaut rien.

### Rattachement et synchronisation

Un événement est rattaché à un **projet** (donc indirectement à un client) et à
un ou plusieurs **collaborateurs**. Comme toute donnée synchronisée :

- il existe **dans le Panel ET dans le projet** concerné ;
- il est **créable/modifiable/validable depuis les deux interfaces** — le Panel
  (vue de travail quotidienne, tous projets confondus) et l'espace **DEV** du
  Manager du projet (les événements sont notre outil interne : l'ADMIN client
  ne les voit pas) ;
- la synchronisation est automatique et bidirectionnelle
  ([01_PANEL_CONNECTOR.md](01_PANEL_CONNECTOR.md) §3.4).

Il alimente : la chronologie du projet (visible des deux côtés) et — côté
Panel uniquement — l'agenda interne et les statistiques (catégorie 3).

---

## 2. Réunions

### Philosophie

> **Une réunion appartient à un projet** (elle s'y rattache obligatoirement).
> Elle peut être **présentielle** ou **distancielle**.

La réunion est un type d'événement suffisamment structuré pour mériter son
module : participants (collaborateurs + contacts client), date/heure, mode
(présentiel avec lieu / distanciel avec lien), ordre du jour, compte rendu,
décisions.

```
┌─ PANEL ou MANAGER (espace DEV) · Réunions ────────────────────┐
│                                                               │
│  Réunion « Point mensuel »                                    │
│   projet        : Garage Dupont (obligatoire)                 │
│   mode          : (•) présentielle   ( ) distancielle         │
│   lieu / lien   : [ 12 rue X, Nice ]                          │
│   participants  : Luca · M. Dupont                            │
│   ordre du jour : …                                           │
│   état          : planifiée → à valider → validée (CR)        │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

Une réunion suit le même cycle planifié → à valider → validé que les événements
(§1) et les mêmes règles de synchronisation : donnée synchronisée entre le
Panel et le projet de rattachement, mêmes actions des deux côtés.

### Frontière avec le client

- L'ADMIN client ne voit rien de ce module : c'est notre outil interne, logé
  dans l'espace DEV côté Manager.
- Si un jour une réunion doit être visible du client (proposition de créneau,
  compte rendu partagé), ce sera une fonctionnalité NOUVELLE avec sa réponse
  Standalone définie d'abord ([04_STANDALONE.md](04_STANDALONE.md) §3) — rien de
  tel n'est promis ici.

---

## 3. Standalone et revente

- Panel éteint : les événements/réunions du projet restent lisibles et
  éditables dans l'espace DEV de son Manager (donnée synchronisée = copie
  locale pleine et entière). La synchronisation est simplement à l'arrêt.
- Projet revendu : le repreneur hérite du journal d'événements/réunions du
  projet (il peut le purger s'il n'en veut pas) ; les vues multi-projets,
  l'agenda global et le CRM restent chez nous (catégorie 3, jamais transmis).

---

## 4. Résumé

| Question | Réponse |
|---|---|
| Où vivent événements et réunions ? | Dans le Panel ET dans le projet de rattachement (donnée synchronisée). |
| Qui peut les créer/modifier/valider ? | Les deux interfaces — Panel et espace DEV du Manager. |
| Le client les voit-il ? | Non : outil interne, absent de l'espace ADMIN. |
| Quelle est la règle de discipline ? | Planifié → à valider → validé ; le passé non validé est une dette visible. |
| Et les vues globales (agenda, CRM, stats) ? | Exclusivement Panel (catégorie 3). |
| Rapport avec `DomainEvent` des projets ? | Aucun — homonymie à ne pas confondre. |
