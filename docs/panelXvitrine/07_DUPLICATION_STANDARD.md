# 07 — Duplication : locale au projet, jamais faite par le Panel

> **Médias publics (logo, favicon).** Un duplicata hérite de la configuration
> `Company` du projet source. Une URL absolue y pointerait durablement le
> domaine de l'original. Convention et règles de reprise :
> [MEDIAS_PUBLICS.md](MEDIAS_PUBLICS.md).


> Prérequis de lecture : [00_ECOSYSTEME.md](00_ECOSYSTEME.md).
> État actuel détaillé : [13_ETAT_DES_LIEUX.md](13_ETAT_DES_LIEUX.md) §7.

---

## 1. Principe

> **Le moteur de duplication reste propre à chaque projet. Le Panel ne duplique
> JAMAIS un projet.**

Créer un nouveau projet = ouvrir un projet existant (typiquement le modèle le
plus récent) et lancer SA duplication depuis SON Manager. Le Panel, au mieux,
**apprend l'existence** du nouveau projet quand celui-ci s'appaire
([01_PANEL_CONNECTOR.md](01_PANEL_CONNECTOR.md) §3.1) — il n'orchestre pas la
création.

```
      ┌────────────────────┐   duplication    ┌────────────────────┐
      │  PROJET SOURCE     │─────────────────▶│  NOUVEAU PROJET    │
      │  (son moteur, son  │   locale         │  bases initialisées│
      │   Manager DEV)     │                  │  .env réécrit      │
      └────────────────────┘                  └─────────┬──────────┘
                                                        │ appairage (optionnel,
      ┌────────────────────┐                            │ URL pré-remplie)
      │       PANEL        │◀───────────────────────────┘
      │ « tiens, un projet │      bootstrap PanelBridge
      │   de plus »        │
      └────────────────────┘
```

Cette doctrine découle des règles d'or : le Panel ne possède ni le code, ni la
base, ni les secrets d'un projet — il n'a donc **rien de ce qu'il faut** pour le
dupliquer, et c'est voulu. Rappel de la doctrine existante
(`docs/DEPLOYMENT_ENGINE.md`) : **aucun projet maître** — on clone le projet
ouvert, il n'y a pas de « template » synchronisé.

---

## 2. Comportement attendu (= comportement actuel, conservé)

Lors d'une duplication, sont créés **comme aujourd'hui** :

| Élément | Comportement actuel conservé |
|---|---|
| **Git** | le dossier est copié SANS `.git` ; la seule donnée Git est l'URL du dépôt CIBLE (`PROJECT_GITHUB_REPOSITORY_URL`), demandée par l'assistant, validée et écrite dans le `.env` de la copie |
| **Mongo** | les deux bases (TEST + PROD) sont créées et initialisées canoniquement : index Mongoose réels de tous les modèles + singleton `SystemConfiguration` (`initializeDuplicatedProjectDatabases`) |
| **Variables** | le `.env` source est réécrit : `DB_TEST`, `DB_PROD`, `PROJECT_NAME`, `PROJECT_GITHUB_REPOSITORY_URL`, `FIRST_DEV_EMAIL`, `FIRST_DEV_NAME` ; les `SEED_*_PASSWORD` hérités sont **supprimés** ; écriture atomique + vérification post-écriture (LOT 2C) |
| **Secrets** | hérités du `.env` source aujourd'hui (`MONGODB_URI`, `JWT_SECRET`, `INTEGRATED_API_ENCRYPTION_KEY`) — ⚠️ voir la réserve en §5 |
| **Domaines** | rien à la duplication — les domaines naissent au premier déploiement ([08_DEPLOIEMENT_STANDARD.md](08_DEPLOIEMENT_STANDARD.md)) |
| **Compte DEV** | e-mail + mot de passe demandés par l'assistant, consommés par le seed du premier démarrage |

L'assistant du Manager (`DuplicateAssistant`, 5 étapes : Projet → Bases → Compte
→ Résumé → Création) reste l'interface de référence.

---

## 3. La nouvelle question : « URL du Panel »

Une **nouvelle question** apparaît dans l'assistant de duplication :

```
┌─ Assistant de duplication · étape « Projet » (cible) ────────────┐
│                                                                  │
│  Nom du projet            [ Garage Dupont            ]           │
│  Nom du dossier           [ garage-dupont (déduit)   ]           │
│  Dépôt GitHub du projet   [ https://github.com/...   ]           │
│                                                                  │
│  URL du Panel             [ https://panel.ly-solution.com ]      │
│                            ▲ pré-remplie avec celle du projet    │
│                              ACTUEL · modifiable · optionnelle   │
└──────────────────────────────────────────────────────────────────┘
```

Règles :

1. **Par défaut, pré-remplie avec l'URL du Panel du projet actuel** (celle
   connue de son PanelBridge). En pratique, elle sera presque toujours
   identique — tous nos projets pointent vers le même Panel.
2. **Modifiable** : on peut la changer (autre Panel, environnement de test du
   Panel) ou la **vider** (le nouveau projet naît alors en STANDALONE /
   UNCONFIGURED, parfaitement valide).
3. La valeur est écrite dans la configuration de la copie comme **URL candidate**
   du PanelBridge. La duplication n'appaire PAS le nouveau projet : le
   bootstrap (échange de credentials) a lieu au premier démarrage du nouveau
   projet, ou à la demande, depuis SA page « Connexion Panel ». La duplication
   ne copie **jamais** les credentials d'appairage du projet source — chaque
   projet a les siens ([01_PANEL_CONNECTOR.md](01_PANEL_CONNECTOR.md) §3.2).

Mécanique : même patron que `PROJECT_GITHUB_REPOSITORY_URL` aujourd'hui — une
valeur demandée par l'assistant, validée, réécrite dans le `.env`/la config de
la copie avec vérification post-écriture.

---

## 4. Le Panel et la duplication : spectateur informé

Ce que le Panel peut faire autour d'une duplication (rien de plus) :

- **Avant** : rien. Il ne propose pas de bouton « créer un projet » qui
  déclencherait une duplication à distance.
- **Pendant** : rien. La duplication est locale (copie disque + Mongo du
  poste/serveur du DEV).
- **Après** : quand le nouveau projet s'appaire, le Panel l'ajoute à son
  registre de projets et commence à le superviser. Le registre du Panel peut
  noter la filiation (« dupliqué depuis X le … ») si le bootstrap la déclare.

---

## 5. Réserve importante pour la Phase 1 (héritage des secrets)

Constat factuel ([13_ETAT_DES_LIEUX.md](13_ETAT_DES_LIEUX.md) §7 et §9) : la
duplication actuelle **hérite** du `.env` source les secrets `JWT_SECRET`,
`INTEGRATED_API_ENCRYPTION_KEY` et `MONGODB_URI`. Entre nos propres projets,
c'est un choix assumé de simplicité. Mais dans une optique de **revente**, deux
projets partageant un `JWT_SECRET`/une clé de chiffrement posent problème
(un projet vendu emporte des secrets communs).

La doctrine cible est donc : **secrets uniques par projet, générés à la
duplication** (au minimum `JWT_SECRET` et `INTEGRATED_API_ENCRYPTION_KEY`), avec
ré-encryption des credentials copiés le cas échéant. C'est une évolution du
moteur de duplication à traiter en Phase 1
([10_PANEL_ROADMAP.md](10_PANEL_ROADMAP.md)) — documentée ici pour ne pas être
perdue, **rien n'est modifié en Phase 0**.

S'y ajoute une règle de **cession** : les credentials d'IntegratedAPI présents
en base au moment d'une vente appartiennent au vendeur (comptes Stripe/Brevo/
Yousign communs au parc) — ils sont **révoqués et tournés par le vendeur
immédiatement après la vente**, et le repreneur saisit ses propres clés avant
toute mise en production. Checklist complète :
[14_EXTERNAL_DEVELOPER_GUIDE.md](14_EXTERNAL_DEVELOPER_GUIDE.md) §4.4.

---

## 6. Résumé

| Question | Réponse |
|---|---|
| Qui duplique ? | Le projet source, via son propre moteur et son Manager. |
| Le Panel peut-il créer un projet ? | Non. Il apprend son existence à l'appairage. |
| Qu'est-ce qui change dans l'assistant ? | Une question « URL du Panel », pré-remplie avec celle du projet actuel, modifiable, optionnelle. |
| Le nouveau projet est-il appairé d'office ? | Non : URL candidate seulement ; le bootstrap se fait depuis le nouveau projet. |
| Les credentials Panel sont-ils copiés ? | Jamais — un appairage par projet. |
| Git/Mongo/variables/secrets/domaines ? | Comme aujourd'hui (avec la réserve §5 sur l'unicité des secrets, pour Phase 1). |
