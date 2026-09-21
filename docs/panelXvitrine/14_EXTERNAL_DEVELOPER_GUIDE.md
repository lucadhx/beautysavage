# 14 — Guide du développeur externe

> **Logo et favicon d'un projet.** Le Panel ne stocke aucun média : il affiche
> l'URL absolue publiée par le projet dans son manifeste. Format accepté et
> résolution : [MEDIAS_PUBLICS.md](MEDIAS_PUBLICS.md).


> **Ce document est écrit pour vous : le développeur qui récupère ce projet et
> qui ne connaît rien à L.Y Solution** (la société qui l'a développé). Il est
> autoporteur : vous pouvez comprendre le projet et travailler sans lire le
> reste de la documentation — les liens ne sont là que pour approfondir.

---

## 1. Ce que vous recevez

Vous recevez un **logiciel complet et autonome** : le site web d'une entreprise
(par exemple un garage automobile) avec son back-office et son API. Trois
applications dans un seul dépôt :

```
racine du dépôt
├── backend/    API REST — Node.js ≥ 20 (ESM), Express, MongoDB (Mongoose)
├── manager/    back-office — React + TypeScript + Vite (deux espaces : client et technique)
├── vitrine/    site public — React + TypeScript + Vite
├── scripts/    orchestrateur de développement
└── docs/       documentation (dont ce dossier)
```

### Démarrer en local

```bash
# 1. prérequis : Node ≥ 20, un MongoDB accessible
# 2. copier backend/.env.example vers backend/.env et remplir
#    (chaque variable y est commentée ; les indispensables :
#     ENV=TEST, MONGODB_URI, DB_TEST, DB_PROD, JWT_SECRET,
#     INTEGRATED_API_ENCRYPTION_KEY)
# 3. à la RACINE du dépôt :
npm run dev
# backend → http://localhost:6070   (santé : /health, version : /api/version)
# manager → http://localhost:6071
# vitrine → http://localhost:6062
```

En environnement `ENV=TEST`, des comptes de démonstration sont créés au premier
démarrage (voir `README.md` racine et `backend/.env.example`) : un compte
**ADMIN** (le client final) et un compte **DEV** (le technicien — vous). La page
de connexion du Manager propose en TEST une « connexion rapide » sans mot de
passe. En `ENV=PROD`, rien de tout cela n'existe : mots de passe forts exigés.

### Les deux niveaux d'utilisateur du Manager

- **ADMIN** — votre client : il gère le contenu de son site (services, tarifs,
  avis, promotions, entreprise, thème), lit ses demandes de contact, consulte
  son contrat et ses factures.
- **DEV** — vous : tout ce que fait l'ADMIN, plus un espace technique
  (intégrations API, templates d'e-mails, déploiement, duplication,
  supervision, contrats côté gestion). `DEV` passe toutes les autorisations.

### La suite de tests

```bash
npm test          # à la racine : chaîne complète backend + manager + vitrine
```

Elle tourne **entièrement hors ligne** (fournisseurs externes simulés par des
stubs) — c'est votre filet de sécurité pour toute modification.

---

## 2. La chose la plus importante à comprendre : le « Panel »

L.Y Solution développait, en parallèle de ce projet, un outil interne appelé
**le Panel** : un tableau de bord pour administrer d'un seul endroit des
dizaines de projets comme celui-ci (mêmes contrats, mêmes clés d'API, mêmes
informations de société, saisis une fois pour tout le parc).

Ce qu'il faut retenir :

> **Le projet a été conçu pour fonctionner à 100 % SANS ce Panel.**
> Le Panel n'est qu'un *second point d'administration*, optionnel et
> débranchable. Tout ce qu'il permet de faire, le Manager local le permet
> aussi. Vous pouvez l'ignorer, le retirer, ou brancher votre propre système
> équivalent — le logiciel ne s'en aperçoit pas.

### État au moment de la cession (à vérifier, voir §4)

À la date de rédaction de ce guide (2026-07-26), **le Panel n'existe pas encore
dans le code** : ce dépôt ne contient AUCUNE dépendance vers lui. Les documents
00 à 12 de ce dossier décrivent une architecture **cible**. Si vous récupérez le
projet plus tard, la §4 vous dit comment vérifier ce qui a été branché et
comment le débrancher.

---

## 3. Classification : de quoi dépend quoi ?

Toute donnée du projet appartient à une de ces trois familles :

| Famille | Contenu | Ce que ça change pour vous |
|---|---|---|
| **Données locales** | tout le métier : services, tarifs, avis, FAQ, promotions, thème, entreprise cliente, demandes de contact, comptes, contrats et leur moteur (signature, paiement), e-mails, médias… et les moteurs de duplication/déploiement | 100 % à vous, dans VOTRE base Mongo. Aucune dépendance extérieure à L.Y Solution. |
| **Données synchronisées** (seulement si un Panel est branché) | contrats, factures, paiements, informations « société développeur », templates d'e-mails, configuration des API tierces, événements/réunions internes | La copie complète est DANS le projet, lisible et éditable localement. Un Panel branché ne fait que synchroniser ces données avec sa propre copie. Sans Panel : rien à faire, tout marche. |
| **Données exclusivement Panel** | registre des projets de L.Y Solution, statistiques de leur parc, leur CRM interne | Ne vous concernent pas et ne sont pas dans le projet. Vous ne les recevez pas, il ne vous manque rien. |

Les seules dépendances **réelles** du projet sont les services tiers classiques,
sous VOS propres comptes :

| Service | Rôle | Obligatoire ? |
|---|---|---|
| **MongoDB** | base de données | oui |
| **Stripe** | paiements (frais de lancement + abonnement du client) | pour la facturation |
| **Brevo** | envoi d'e-mails transactionnels | pour les e-mails |
| **Yousign** | signature électronique des contrats | non — un contrat peut être marqué « sans signature » |
| **Hostinger** | automatisation DNS au déploiement | non — DNS configurable à la main |
| **un VPS Linux** | hébergement (Nginx + PM2 + Let's Encrypt) | pour la mise en ligne |

Les clés de ces services se saisissent dans le Manager (espace DEV →
Intégrations API), sont chiffrées en base (AES-256-GCM), testables en un clic,
avec un mode TEST et un mode PROD par service. **Aucune clé n'est dans le
code.**

---

## 4. Retirer le Panel (ou vérifier qu'il n'y en a pas)

### 4.1 Vérifier

Le projet ne peut parler au Panel que par UN composant : le **PanelBridge**
(backend). Et le Panel ne peut parler au projet que par UNE surface : le
**ProjectBridge** (un groupe de routes dédié du backend). C'est une règle
d'architecture stricte — aucun autre fichier n'a le droit de connaître le Panel.

Pour savoir si un Panel est branché :

1. cherchez un dossier `PanelBridge` dans `backend/src/services/` — s'il
   n'existe pas, il n'y a rien à débrancher, vous avez terminé ;
2. s'il existe : ouvrez le Manager → espace DEV → page « Connexion Panel ».
   Elle affiche l'état (connecté / autonome) et le bouton de débranchement.

### 4.2 Débrancher

Le débranchement est une action prévue, pas un bricolage :

1. Manager → « Connexion Panel » → **Débrancher** (cela efface les identifiants
   d'appairage et arrête la synchronisation ; toutes les données synchronisées
   sont déjà dans votre base — vous ne perdez rien) ;
2. le projet ré-enregistre alors ses **webhooks locaux** chez Stripe/Brevo/
   Yousign (automatique — le projet a toujours su recevoir ses webhooks en
   direct, le Panel ne faisait que les relayer) ;
3. c'est tout. Le projet est autonome.

En dernier recours (Panel mort, page inaccessible) : supprimer la configuration
d'appairage suffit — le projet traite « pas de Panel configuré » comme un état
normal de première classe, pas comme une erreur.

### 4.3 Ce que le Panel n'a JAMAIS eu

Pour votre tranquillité : le Panel de L.Y Solution n'a jamais eu d'accès à
votre base MongoDB, jamais le mot de passe de votre VPS, jamais la main sur
votre code. Il parlait à une API authentifiée et révocable. Révoquer
l'appairage clôt le sujet.

### 4.4 Checklist de cession (à dérouler avec le vendeur)

Un projet vivant, c'est un dépôt Git **plus** une base de données, un serveur
et des comptes de services tiers. Voici l'ordre de reprise complet :

1. **Débranchement du Panel** (§4.2) + révocation de l'appairage côté vendeur.
2. **Bases MongoDB** : le vendeur vous livre un dump des bases `DB_TEST`,
   `DB_PROD` **et** de la base de contrôle `*_control` (destinations de
   déploiement) — ou vous transfère l'accès au serveur Mongo. Restaurez sur
   VOTRE serveur, mettez à jour `MONGODB_URI`.
3. **Rotation des secrets d'instance** : régénérez `JWT_SECRET` (déconnecte
   toutes les sessions) et, si vous changez `INTEGRATED_API_ENCRYPTION_KEY`,
   re-saisissez les credentials d'API (ils sont chiffrés avec cette clé —
   sans elle, ils sont illisibles, ce qui est acceptable puisque l'étape 4 les
   remplace de toute façon).
4. **Clés d'API tierces** : ⚠️ les clés Stripe/Brevo/Yousign/Hostinger en base
   à la cession appartiennent au **vendeur** (souvent communes à son parc de
   projets). Considérez-les comme mortes : le vendeur les révoque après la
   vente ; vous saisissez VOS clés (Manager → espace DEV → Intégrations API),
   vous testez chaque mode, puis vous relancez la synchronisation des webhooks
   (boutons « Synchroniser » de la même page) pour qu'ils pointent sur vos
   comptes.
5. **Comptes du Manager** : changez les mots de passe DEV et ADMIN (ou
   recréez les comptes), vérifiez la liste dans espace DEV → Comptes.
6. **VPS et DNS** : transfert du serveur (ou redéploiement sur le vôtre via la
   page Déploiement) et des zones DNS ; adaptez `DEPLOY_WILDCARD_BASES`.
7. **Données internes du vendeur** (si présentes) : les événements/réunions de
   suivi client livrés avec la base sont à vous — purgez-les si vous n'en
   voulez pas.
8. **Références L.Y Solution** : déroulez le tableau du §5.

---

## 5. Nettoyer les références à L.Y Solution

Éléments à passer en revue pour une reprise « propre » (aucun n'est bloquant) :

| Élément | Où | Quoi faire |
|---|---|---|
| Informations « société développeur » (nom, logo, slogan, contacts, signataire) | Manager → espace DEV → « Entreprise développeur » et « Équipe développeur » | remplacer par VOS informations — elles s'affichent sur la page Support du client et en pied de vitrine |
| Adresse e-mail d'expéditeur/support | Manager → espace DEV → Intégrations API (section E-mail) | mettre VOTRE adresse (sous votre compte Brevo) |
| Base wildcard de déploiement `ly-solution.com` | variable `DEPLOY_WILDCARD_BASES` (`backend/.env`) | mettre votre propre domaine wildcard, ou déployer sur des domaines dédiés |
| Étiquette des webhooks gérés `SB_AUTO_06_MANAGED_…` et `metadata.managedBy` | `backend/src/services/webhooks/managedWebhookRegistry.js` | cosmétique : c'est le nom que le projet donne à SES webhooks chez les fournisseurs ; renommez-le si vous rebaptisez le produit (l'ancien libellé est reconnu et migré automatiquement) |
| URL du dépôt Git | `PROJECT_GITHUB_REPOSITORY_URL` (`backend/.env`) | pointer votre propre dépôt |
| URL du Panel (si présente) | page « Connexion Panel » / configuration | vider ou remplacer (§6) |
| Nom du projet | `PROJECT_NAME` (`backend/.env`) | renommer — ⚠️ variable écrite par l'assistant de duplication mais absente de `backend/.env.example` à ce jour (constat #11 de [13](13_ETAT_DES_LIEUX.md) §9) |

Le nom d'expéditeur des e-mails est dérivé automatiquement du nom de
l'entreprise **cliente** (+ suffixe « (Site) ») — rien à changer là.

---

## 6. Brancher VOTRE propre système d'administration

Vous n'êtes pas obligé de rester sans outil central : l'architecture prévoit
explicitement le remplacement du Panel par autre chose.

Deux contrats, documentés dans ce dossier, définissent TOUTE la frontière :

```
   VOTRE système central                     le projet
┌──────────────────────────┐      ┌────────────────────────────────┐
│                          │      │  PanelBridge                │
│  implémente le côté      │◀─────│  (le projet vous appelle :     │
│  « Panel » des deux      │      │   heartbeat, modifications,    │
│  contrats :              │      │   rattrapage)                  │
│                          │      │                                │
│  · reçoit heartbeats     │─────▶│  ProjectBridge              │
│  · échange les données   │      │  (vous appelez le projet :     │
│    synchronisées         │      │   supervision, modifications,  │
│  · déclenche des actions │      │   actions du catalogue)        │
│    du catalogue          │      │                                │
└──────────────────────────┘      └────────────────────────────────┘
```

- **[01_PANEL_CONNECTOR.md](01_PANEL_CONNECTOR.md)** : ce que le projet enverra
  à votre système et comment il s'appaire.
- **[02_PROJECT_CONNECTOR.md](02_PROJECT_CONNECTOR.md)** : ce que votre système
  peut demander au projet (catalogue fermé : lire l'état, échanger les données
  synchronisées, déclencher des actions exécutées par le moteur local — jamais
  d'accès base, jamais de code distant).

> La spécification technique complète existe et fait foi :
> **[spec/PanelBridge.openapi.yaml](spec/PanelBridge.openapi.yaml)** (l'API que
> votre système central doit exposer aux projets) et
> **[spec/ProjectBridge.openapi.yaml](spec/ProjectBridge.openapi.yaml)** (la
> surface que chaque projet vous expose, déjà implémentée sous
> `/api/project-bridge/v1`). Routes, schémas, codes d'erreur `BRIDGE_*`,
> en-têtes et versionnement y sont intégralement décrits ; les règles de
> synchronisation sont dans [11_DONNEES_CENTRALISEES.md](11_DONNEES_CENTRALISEES.md)
> §1.1. Implémenter le côté serveur de `PanelBridge.openapi.yaml` suffit pour
> que tout projet vienne s'appairer à VOTRE système.

Règles à respecter (elles vous protègent) :

1. votre système ne touche **jamais** la base Mongo du projet en direct ;
2. il ne modifie que des **données synchronisées** — le contenu du site du
   client ne se pilote pas à distance ;
3. le projet doit rester 100 % fonctionnel quand votre système est éteint.

Alternative parfaitement valable : **ne rien brancher du tout**. Le Manager
suffit à opérer un projet unique.

---

## 7. Dupliquer, déployer, mettre à jour

Ces moteurs sont **embarqués dans le projet** (pas dans le Panel) — vous les
possédez :

- **Duplication** (Manager → espace DEV → Déploiement → Dupliquer) : crée un
  nouveau projet complet à partir de celui-ci — copie du code (sans `.git`),
  création et initialisation des bases Mongo, réécriture du `.env`, compte DEV
  initial. Assistant en 5 étapes. Détails :
  [07_DUPLICATION_STANDARD.md](07_DUPLICATION_STANDARD.md) et
  `docs/DUPLICATION.md`.
  ⚠️ Au moment de la rédaction, la duplication recopie `JWT_SECRET` et
  `INTEGRATED_API_ENCRYPTION_KEY` du projet source : si vous dupliquez,
  régénérez ces secrets dans la copie.
- **Déploiement** (Manager → espace DEV → Déploiement) : pipeline complet vers
  un VPS (préflight de sécurité, build, upload, Nginx, certificats Let's
  Encrypt, PM2, healthchecks, rapport détaillé, backups/restauration). Le mot
  de passe du VPS n'est jamais stocké (RAM uniquement, le temps de la session).
  Trois hôtes par site : `monsite.fr`, `manager.monsite.fr`, `api.monsite.fr`.
  Détails : [08_DEPLOIEMENT_STANDARD.md](08_DEPLOIEMENT_STANDARD.md),
  `docs/DEPLOYMENT_ENGINE.md`, `docs/VPS_DEPLOYMENT_GUIDE.md`.
- **TEST/PROD** : la variable `ENV` choisit la base de données et les outils de
  recette ; le mode TEST/PROD de chaque API tierce se règle indépendamment dans
  le Manager. Ne confondez pas les deux — le projet est construit autour de
  cette séparation (`docs/TEST_TO_PROD_MIGRATION.md` pour promouvoir des
  données de TEST vers PROD).

---

## 8. Ce que vous pouvez supprimer / conserver

| Élément | Verdict |
|---|---|
| `docs/panelXvitrine/` (ce dossier) | conservez au moins CE guide et 01/02 si vous comptez brancher votre système ; le reste décrit la vision de L.Y Solution — supprimable |
| Le PanelBridge / la page « Connexion Panel » (s'ils existent dans votre version) | débranchez (§4) puis conservez (inertes) ou supprimez le module — aucune autre partie du code n'en dépend, c'est garanti par l'architecture |
| Moteurs de duplication/déploiement | **conservez-les** : c'est une grande partie de la valeur du produit |
| Intégrations Stripe/Brevo/Yousign/Hostinger | conservez ; remplacez simplement les clés par les vôtres (chaque intégration a un stub de test et peut être désactivée) |
| Données de démonstration / comptes seedés | régénérez les mots de passe ; en PROD ils ne sont jamais créés avec des valeurs par défaut |
| L'historique `docs/` général (70+ documents) | conservez : c'est la documentation technique réelle du produit (contrats, e-mails, webhooks, déploiement…), indépendante du Panel |

---

## 9. Où chercher quand vous vous posez une question

| Question | Réponse |
|---|---|
| Comment tout démarrer ? | `README.md` racine + `docs/CANONICAL_DEVELOPMENT_WORKFLOW.md` |
| Quelles variables d'environnement existent ? | `backend/.env.example` (toutes commentées) |
| Comment marche l'API ? | `docs/API.md`, `docs/ARCHITECTURE.md` |
| Contrats, signature, paiement ? | `docs/CONTRACTS.md`, `docs/STRIPE_INTEGRATION.md`, `docs/SIGNATURE.md` |
| E-mails ? | `docs/EMAIL_TEMPLATES.md`, `docs/EMAIL_CONFIGURATION.md`, `docs/BREVO_MODULE.md` |
| Webhooks ? | `docs/WEBHOOKS.md`, `docs/GENERIC_WEBHOOK_PROVIDER_ARCHITECTURE.md` |
| Déployer sur un serveur ? | `docs/VPS_DEPLOYMENT_GUIDE.md`, `docs/DEPLOYMENT_ENGINE.md` |
| L'état exact du code à la cession de ce dossier ? | [13_ETAT_DES_LIEUX.md](13_ETAT_DES_LIEUX.md) (y compris la liste honnête des points faibles connus, §9) |

**Le principe directeur, si vous ne retenez qu'une phrase : ce projet ne
dépend de L.Y Solution pour rien — ni pour fonctionner, ni pour être déployé,
ni pour évoluer. Tout ce dont il a besoin est dans ce dépôt, votre base Mongo,
et vos propres comptes de services tiers.**
