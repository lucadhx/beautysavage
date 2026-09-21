# RX-DEPLOYMENT-REAL-TEST-PREPARATION — Préparation de la recette réelle

> **⚠️ RAPPORT HISTORIQUE — NE PAS SUIVRE COMME PROCÉDURE.**
> Ce document décrit un état du système à la date de sa rédaction. Plusieurs
> architectures qu'il mentionne ont été supprimées depuis — notamment la page
> IntegratedAPI du Manager, les credentials Brevo locaux et le webhook Brevo
> local. Autorités actuelles : [ARCHITECTURE.md](ARCHITECTURE.md) ·
> [PROTOCOL.md](PROTOCOL.md) · [INTEGRATED_API.md](INTEGRATED_API.md) ·
> [PANEL_BRIDGE.md](PANEL_BRIDGE.md).


> **NB (2026-07-23)** : le worktree « SB Auto 06 -- deployment-engine » cité dans ce rapport historique a été supprimé — dossier canonique unique : `SB Auto 06`.


Préparer, lancer et vérifier tout ce qui peut l'être automatiquement avant le
**premier déploiement réel** depuis le Manager vers un VPS.

> **VERDICT : ✅ PRÊT POUR TEST RÉEL** (voir §12).

---

## 1. Branche, worktree, commit

| | |
|---|---|
| Branche | `feat/industrial-deployment-engine` |
| Worktree dédié | `SB Auto 06 -- deployment-engine` (isolé du worktree Brevo) |
| Commit de départ | `08b4b4e` (worktree propre au démarrage, en phase avec origin) |
| Worktree Brevo | `feat/brevo` — **non touché** (aucune modification, aucun mélange) |

Aucun fichier d'un autre chantier n'a été introduit. Le worktree principal
(Brevo) n'a jamais été modifié.

---

## 2. Dépendances installées

- **Backend** : `npm install` (209 paquets), dont **`ssh2@1.17.0`**.
- **Manager** : `npm install` (159 paquets).

### Preuve de chargement de `ssh2` au runtime

Chargé via le MÊME chemin que le moteur en production (`import('ssh2')` paresseux
dans `SshTransport`) :

```
SshTransport instanciable, kind = ssh
ssh2 chargé au runtime, Client = function
ssh2 version = 1.17.0
SshTransport exige un mot de passe: true
```

`ssh2` n'était **pas** présent dans le worktree principal (il a été ajouté par ce
chantier) : l'installation du worktree de déploiement était donc indispensable.

---

## 3. Configuration locale

Le `.env` **existant** du projet a été réutilisé (aucun secret inventé), avec
`ENV=TEST` (déjà le cas) pour une recette sûre sur la base `sbauto06_test`.

Variables requises et leur état (valeurs des secrets jamais affichées) :

| Variable | Rôle | État |
|---|---|---|
| `ENV` | environnement applicatif (TEST) | ✅ `TEST` |
| `MONGODB_URI` | connexion MongoDB | ✅ définie, **connexion OK** |
| `DB_TEST` / `DB_PROD` | noms de bases | ✅ `sbauto06_test` / `sbauto06_prod` |
| `JWT_SECRET` | signature des sessions Manager | ✅ définie |
| `INTEGRATED_API_ENCRYPTION_KEY` | coffre secrets intégrations | ✅ présente et valide |
| `PORT` / `PUBLIC_URL` / `CORS_ORIGINS` | réseau | ✅ (recette : ports dédiés, cf. §10) |
| `DEPLOY_WILDCARD_BASES` | bases wildcard gérées | non défini → défaut `demo.ly-solution.com` (correct, cf. §7) |

> Aucune variable obligatoire ne manque. Aucun secret n'a été révélé ni versionné
> (`.env`, `.env.local` restent hors Git).

---

## 4. Audit du parcours réel (données de bout en bout)

Parcours vérifié pour `https://demo-sbauto.ly-solution.com` (19/19 contrôles
runtime, cf. §9) :

```
Formulaire (Manager) ──POST /deployment/targets──▶ DeploymentTarget (Mongo)
   name, url, sshHost?, sshUser=root                host/type/subdomain/cert déduits
        │
        └─ Connexion serveur ──POST /deployment/vps-session──▶ passwordVault (RAM)
                 IP + mot de passe                     sessionId opaque (mdp jamais renvoyé)
        │
   Publier ──POST /deployment/deploy/stream──▶ engine.deploy
                 { targetId, sessionId }              préflight → build → pipeline
                                                       SshTransport(host=sshHost, user=sshUser,
                                                                    password=vault[sessionId])
        │
   Flux NDJSON ◀── évènements {type:'step'|'result'|'error'} en direct
        │
   Historique (DeploymentTarget.history) + écran de succès
```

Chaque maillon a été exercé : formulaire → API → DeploymentTarget → passwordVault
→ (Ssh)Transport → préflight → pipeline → flux NDJSON → historique.

---

## 5. Connexion SSH réelle — preuves (sans identifiant VPS)

La connexion finale exige l'IP + le mot de passe du VPS (fournis par l'utilisateur).
En l'absence de VPS, les propriétés suivantes sont **prouvées par tests** :

- ✅ `SshTransport` réellement instanciable (`kind = 'ssh'`).
- ✅ authentification **par mot de passe** supportée (constructeur exige le mot de passe).
- ✅ `sshHost` provient de la destination ; `sshUser` vaut **`root`** par défaut.
- ✅ le mot de passe vient **exclusivement** du coffre-fort RAM (`passwordVault`).
- ✅ métadonnées de session **sans** le mot de passe (`describeSession`).
- ✅ un échec de connexion (port fermé) produit un **rejet lisible** — le process
  Node **ne plante pas** (test « SshTransport : échec de connexion -> rejet »).
- ✅ un flux NDJSON avec session invalide émet un évènement `error` lisible sans
  crasher le serveur (vérifié en runtime).
- ✅ session **nettoyée** après fermeture / éphémère après usage / `closeAll`.

---

## 6. Prérequis VPS — ce qui doit exister vs ce que le moteur fait

Le préflight (`backend/src/deployment/preflight.js`) vérifie et **bloque** si le
serveur n'est pas prêt (jamais de demi-déploiement). Le Manager affiche des
étapes lisibles ; le détail technique reste dans « Voir les détails ».

### Doit déjà exister sur le VPS (prérequis)

| Prérequis | Contrôle préflight | Bloquant |
|---|---|---|
| **Ubuntu**, accès **root par mot de passe**, **SSH** (port 22) | `ssh` (Connexion & authentification) | oui |
| **Nginx** installé + configuration valide | `nginx`, `nginx-config` (`nginx -t`) | oui |
| **Node.js** | `node` | oui |
| **PM2** | `pm2` | oui |
| **Wildcard `*.ly-solution.com`** (DNS wildcard + **certificat wildcard**) configuré **une seule fois** | `wildcard-cert` (présence du cert) | **oui** (sous-domaine wildcard) |
| **Certbot** (domaine client uniquement) | `certbot` | oui si domaine client |
| **sudo** utilisable (les étapes nginx/certbot/systemctl l'utilisent) | via `permissions` | oui |
| **Permissions** d'écriture sur `/var/www` | `permissions` | oui |
| **Espace disque** ≥ 500 Mo | `disk` | oui |
| **Ports 80 et 443** ouverts au **pare-feu** | (challenge HTTP-01 pour domaine client) | oui |
| **MongoDB** joignable sur le VPS | `mongo` | non (avertissement) |
| **npm** | requis par l'étape d'installation | (implicite) |

> **Sous-domaine wildcard** (`demo-sbauto.ly-solution.com`) : **aucun DNS ni
> certificat par site** — le wildcard est réutilisé. Le préflight vérifie sa
> présence et bloque proprement s'il manque.

> **Git n'est PAS requis** sur le VPS : le moteur **téléverse l'artefact** déjà
> construit (SFTP), il ne clone rien.

### Ce que le moteur installe / configure lui-même

- dossiers du site (`/var/www/<host>/{vitrine,manager,backend,uploads,storage}`) ;
- dépendances backend de production (`npm ci --omit=dev`) ;
- **configuration Nginx** (server_name + proxy) + `nginx -t` + reload ;
- **certificat HTTPS** : wildcard partagé réutilisé (sous-domaine géré) **ou**
  certificat **dédié** émis par Certbot (domaine client) ;
- **process PM2** du backend + `pm2 save` ;
- health check local + public avant de valider.

### Sécurité anti-écrasement

Le préflight **refuse** si l'adresse est déjà servie par une configuration Nginx
**non générée par cet outil** (contrôle `occupied`). Un redéploiement de NOTRE
site (marqueur présent) reste autorisé.

---

## 7. DNS & HTTPS pour `demo-sbauto.ly-solution.com` (wildcard)

**Architecture officielle : un unique wildcard `*.ly-solution.com` configuré UNE
SEULE FOIS** (DNS wildcard + certificat wildcard). `demo-sbauto.ly-solution.com`
— comme tout `<site>.ly-solution.com` à un seul label — est **automatiquement
couvert**. **Aucun enregistrement DNS ni certificat à créer par site.**

Vérifié (tests dédiés `demo-sbauto : …`) :

- ✅ hostname déduit : `demo-sbauto.ly-solution.com` ;
- ✅ **traité en sous-domaine wildcard** de `ly-solution.com`
  (`type = 'subdomain'`, `wildcardBase = 'ly-solution.com'`) ;
- ✅ **aucun contrôle DNS par site** (`requiresDnsCheck = false`) et **aucun
  certificat dédié** (`requiresDedicatedCert = false`) : le certificat
  `*.ly-solution.com` **existant** est réutilisé (`shared = true`) ;
- ✅ Nginx : `server_name demo-sbauto.ly-solution.com;` et cert partagé
  `/etc/letsencrypt/live/ly-solution.com/…` ;
- ✅ le préflight **vérifie la présence** du certificat wildcard sur le VPS et
  **bloque** avec un message clair s'il manque (`wildcard-cert`) ;
- ✅ `*.ly-solution.com` ne couvre qu'**un niveau** : un `a.b.ly-solution.com`
  (multi-label) retombe correctement en domaine client (cert dédié + DNS).

### Enregistrement DNS à créer par l'utilisateur

**Aucun.** Le wildcard `*.ly-solution.com` couvre déjà `demo-sbauto`. Il faut
seulement que le wildcard ait été **configuré une fois** (prérequis
d'infrastructure, cf. §6) :

```
# Configuration UNIQUE, déjà en place (pas par site) :
Type : A       Nom : *.ly-solution.com   Valeur : <IP du VPS>
Certificat :   *.ly-solution.com (Let's Encrypt, challenge DNS-01)
```

---

## 8. Sécurité avant test

- ✅ **Anti-injection shell** : les valeurs interpolées dans des commandes
  distantes sont strictement validées — hostname (caractère par caractère dans
  `url.js`), `dbName`, `remoteRoot`, `sshHost`, `sshUser` (regex Zod), `archive`
  de restauration (chemin `/var/backups/sbauto/*.tar.gz`). **Défense en
  profondeur** au point d'usage via `deployment/safety.js` (backup/restore).
  Tests : « validator : … injection refusé ».
- ✅ **Mot de passe VPS** : jamais en base, jamais dans `.env`, jamais dans les
  logs, jamais dans le flux NDJSON, jamais en localStorage/sessionStorage (RAM
  navigateur uniquement). Vérifié en runtime (flux sans mot de passe) et par tests.
- ✅ **Coffre-fort** nettoyé (fermeture, éphémère, expiration, `closeAll`).
- ✅ **Pas d'exposition de `.env`** ; l'artefact backend est téléversé mais le
  `.env` applicatif distant est écrit sans le mot de passe VPS.
- ✅ **Aucune suppression dangereuse** de dossier distant (le pipeline crée, ne
  `rm -rf` pas la racine ; la restauration cible la base nommée avec `--drop`).
- ✅ **Anti-conflit** : refus si l'adresse est déjà occupée par un autre site.
- ✅ Routes de déploiement **DEV uniquement** (401 sans jeton, vérifié).

---

## 9. Tests exécutés & résultats

| Suite | Résultat |
|---|---|
| Moteur de déploiement (`deployment-engine.test.js`) — URL, vault, **SshTransport**, préflight, **occupied**, nginx, pipeline, backup, façade, **validators anti-injection**, **demo-sbauto** | **72 / 72** ✅ |
| Checklist live & rapport (`deployment-report.test.js`) — redaction anti-fuite, évènements ordonnés, rapport succès/échec/exception, troncature, Manager host, **préflight de 1ʳᵉ classe (PRECHECK ok / SSH KO / DNS KO / timeout)** | **64 / 64** ✅ |
| Intégration Hostinger (`hostinger.test.js`, **mockée**) — zones PSL, client (401/403/404/429/500, retry GET / no-retry PUT, correlation_id), DNS (create/idempotent/conflits/wildcard/dryRun), redaction, **phase DNS moteur (zone détectée, vitrine+Manager créés, SSH KO → aucune mutation, conflit bloquant)** | **51 / 51** ✅ |
| Duplication (`duplication.test.js`) — validation, `.env`, Mongo, copie, phases | **33 / 33** ✅ |
| Suite générale (échantillon auto-portant) : promotion TEST→PROD | **54 / 54** ✅ |
| Suite générale : indépendance ENV/mode | **9 / 9** ✅ |
| **Recette runtime** (API réelle sur :6070) — login DEV, version, création destination, session VPS, **flux NDJSON**, CORS, protection auth | **19 / 19** ✅ |
| Typecheck Manager (`tsc -b --noEmit`) | ✅ |
| Build Manager (`vite build`) | ✅ |
| Chargement runtime `ssh2` + `SshTransport` | ✅ |

> Non exécutées : suites nécessitant des clés sandbox tierces réelles (Stripe,
> Yousign) — hors périmètre de cette recette de déploiement.

---

## 10. Environnement local lancé pour la recette

Un backend tournait déjà sur `:6060` (**votre stack Brevo**, sans les routes de
déploiement). Pour ne PAS le perturber, la recette tourne sur des **ports dédiés** :

| Service | URL | Notes |
|---|---|---|
| **Backend (recette)** | http://localhost:6070 | ENV=TEST, base `sbauto06_test`, routes `/api/deployment/*` |
| **Manager (recette)** | **http://localhost:6071** | `VITE_API_URL=http://localhost:6070` (`.env.local`, hors Git) |

Vérifié en runtime : Manager servi (200, titre « SB Auto — Manager »), backend
prêt, `/api/deployment/version` répond, création de destination OK, flux NDJSON
joignable, CORS 6071→6070 autorisé, aucune erreur runtime dans les logs.

> Compte DEV local : créé par l'amorçage à partir de `FIRST_DEV_EMAIL`, activé
> par son titulaire via le lien reçu (LOT 2C). En recette automatisée, le décor
> est posé par `scripts/helpers/testAccounts.helper.js`.

---

## 11. Parcours utilisateur exact (recette)

> **Aucun enregistrement DNS à créer** :
> - soit `demo-sbauto` est couvert par un **wildcard** déjà en place ;
> - soit l'**intégration Hostinger** est active (DEV → Intégrations API) et le
>   moteur **crée/ajuste automatiquement** les DNS de la vitrine ET du Manager.
>   Voir [`HOSTINGER_INTEGRATION.md`](HOSTINGER_INTEGRATION.md).

0. *(pour l'automatisation DNS)* **DEV → Intégrations API → Hostinger** : coller
   la clé API, **Vérifier** (non destructif), activer le mode.
1. Ouvrir **http://localhost:6071/** et se connecter avec le compte **DEV local**
   (celui de `FIRST_DEV_EMAIL`, une fois son activation consommée).
2. Aller dans **DEV → Déploiement**.
3. **Dupliquer** (facultatif) ou aller directement à **Déployer un site**.
4. **Ajouter une destination** :
   - Nom : `SB Auto 06 — Démo`
   - Adresse du site : `https://demo-sbauto.ly-solution.com`
   - (Options avancées, facultatif) Adresse du serveur = IP du VPS ; utilisateur = `root`.
5. Étape **Serveur** : saisir l'**IP du VPS** et le **mot de passe** (case
   « Conserver jusqu'à la fermeture du Manager » au choix).
6. **Vérifications avant publication** (préflight) : chaque étape s'affiche ; si le
   VPS n'est pas prêt (ex. wildcard absent), le Manager l'indique et bloque.
7. **Publier** : **checklist live** (14 étapes canoniques, loaders réels, vitrine
   + Manager affichés) → **écran de succès** (« Ouvrir le site » / « Ouvrir le
   Manager ») **ou** écran d'erreur métier. Dans **tous les cas**, un **rapport
   technique** est produit, **conservé dans l'historique** et **copiable**
   (« Voir le rapport » / « Copier le rapport »). Voir
   `docs/RX_DEPLOYMENT_LIVE_REPORT.md`.

> Le Manager de la démo sera servi sur `https://manager.demo-sbauto.ly-solution.com`
> (dérivé automatiquement, certificat dédié émis par Certbot).

---

## 12. Risques restants non testables sans VPS + Verdict

Non vérifiables sans un VPS réel (par nature) :

- la **connexion SSH réelle** (dépend de l'IP/mot de passe/pare-feu du VPS) ;
- la **présence effective du certificat wildcard** `*.ly-solution.com` sur le VPS
  (prérequis d'infrastructure — le préflight la vérifie et bloque sinon) ;
- l'application `nginx -t`/reload et le démarrage PM2 **sur la machine cible** ;
- le health check **public HTTPS** de bout en bout.

Ces étapes sont **entièrement testées via `FakeTransport`** (ordre, succès,
échecs, réutilisation du cert wildcard) et le transport réel est prouvé
instanciable et robuste aux échecs. Le premier passage réel reste la seule
validation manquante — elle est précisément l'objet du test utilisateur.

### VERDICT : ✅ PRÊT POUR TEST RÉEL

Tout ce qui pouvait être installé, construit, testé et lancé automatiquement l'a
été. Pour `demo-sbauto.ly-solution.com`, **aucun enregistrement DNS n'est à créer**
(wildcard `*.ly-solution.com` déjà en place). Il ne reste à l'utilisateur qu'à :
saisir l'IP et le mot de passe du VPS, suivre le parcours dans le Manager, et
confirmer que le site s'ouvre.
