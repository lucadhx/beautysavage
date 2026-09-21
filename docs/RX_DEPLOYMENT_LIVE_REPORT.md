# RX-DEPLOYMENT-LIVE-REPORT — Checklist live & rapport technique historisé

> **⚠️ RAPPORT HISTORIQUE — NE PAS SUIVRE COMME PROCÉDURE.**
> Ce document décrit un état du système à la date de sa rédaction. Plusieurs
> architectures qu'il mentionne ont été supprimées depuis — notamment la page
> IntegratedAPI du Manager, les credentials Brevo locaux et le webhook Brevo
> local. Autorités actuelles : [ARCHITECTURE.md](ARCHITECTURE.md) ·
> [PROTOCOL.md](PROTOCOL.md) · [INTEGRATED_API.md](INTEGRATED_API.md) ·
> [PANEL_BRIDGE.md](PANEL_BRIDGE.md).


Ajoute au moteur de déploiement : une **checklist vivante** alimentée par le
backend, et un **rapport technique détaillé** produit à CHAQUE exécution (succès
ou échec), **redigé** (aucun secret), **persisté** et **copiable**.

Vitrine et Manager sont traités **ensemble** :
- Vitrine : `demo-sbauto.ly-solution.com`
- Manager (dérivé) : `manager.demo-sbauto.ly-solution.com`

> **RÈGLE OFFICIELLE : toute opération utilisateur (préflight, déploiement,
> rollback…) produit systématiquement un rapport complet, persisté et copiable.**

## 0. Opérations de première classe (`operationType`)

Un run (`DeploymentRun`) porte un `operationType` : `PRECHECK` (préflight),
`DEPLOYMENT`, `ROLLBACK`, `HEALTHCHECK`, `BACKUP`. **Un préflight est simplement
un run `PRECHECK`** : même checklist live, mêmes logs, même rapport persisté, même
historique — il s'arrête juste avant l'upload (`preflightOnly` dans le moteur).

Endpoints en flux (NDJSON), identiques hormis le type :
- `POST /api/deployment/preflight/stream` → run **PRECHECK** ;
- `POST /api/deployment/deploy/stream` → run **DEPLOYMENT**.

Ainsi, **si la connexion SSH échoue au préflight, un rapport est disponible
immédiatement** (« Voir le rapport » / « Copier le rapport » / « Relancer ») et
consultable ensuite dans l'historique (colonne Type : `Préflight` / `Déploiement`).

---

## 0bis. Gestion automatique du DNS (Hostinger)

La checklist et le rapport intègrent une **phase DNS** : quand l'intégration
Hostinger est active (DEV → Intégrations API), le moteur détecte la zone
(Public Suffix List), lit l'existant, crée/ajuste les enregistrements `A` de la
**vitrine ET du Manager** (après la connexion SSH — ordre sûr), et vérifie la
propagation publique. Détails : [`HOSTINGER_INTEGRATION.md`](HOSTINGER_INTEGRATION.md).
Le rapport contient une section **`## Hostinger / DNS provider`** (sans secret).

## 1. Checklist canonique

`backend/src/deployment/steps.js` définit la liste canonique (miroir frontend
`friendly.ts > CHECKLIST_STEPS`). Chaque étape correspond à une action RÉELLE :

`deployment.initialize` → `ssh.connect` → `server.preflight` → `remote.safety` →
`dns.verify` → `artifact.build` → `artifact.upload` → `dependencies.install` →
`nginx.configure` → `https.configure` → `services.start` → `services.verify` →
`runtime.sync` → `public.healthcheck` → `deployment.finalize`

Les identifiants « bruts » du pipeline (upload, dirs, nginx…) sont projetés sur
ces identifiants canoniques via `RAW_TO_CANONICAL`.

États d'une étape : `pending`, `running`, `ok`, `warning`, `error`, `skipped`,
`cancelled`. Une étape `running` affiche un loader animé.

## 2. Évènements live (flux NDJSON)

`POST /api/deployment/deploy/stream` émet une ligne JSON par évènement :

| type | contenu clé |
|------|-------------|
| `deployment.started` | siteUrl, managerUrl, version |
| `step.started` | stepId, label, status=running |
| `step.succeeded` / `step.failed` / `step.warning` / `step.skipped` | stepId, status, durée, messages |
| `deployment.succeeded` / `deployment.failed` | status, finalStepId, errorCode |
| `deployment.report_ready` | deploymentRunId, ok, status, finalStepId |

Chaque évènement porte `sequenceNumber` (strictement croissant), `timestamp`
ISO, `deploymentRunId`. Le frontend reconstruit exactement l'état de la
checklist ; les évènements inconnus sont ignorés sans planter. Le flux se ferme
proprement après `deployment.report_ready`.

## 3. Rapport technique

Produit par `RunRecorder` (`backend/src/deployment/report/`) sous deux formes :
- **structuré** (JSON versionné, `reportVersion` 1.0) pour le stockage/filtrage ;
- **Markdown** généré depuis le structuré (`markdown.js`), lisible sans l'app.

Sections : Résumé · Identification · Contexte local (Node/npm/OS) · DNS · SSH ·
Prérequis serveur · **Pipeline** (par étape : statut, timings, **commandes +
exit code + stdout/stderr**) · Nginx (server_name vitrine + Manager) · HTTPS
(vitrine wildcard réutilisé + Manager dédié) · Services (PM2) · Tests publics ·
État laissé sur le serveur · Avertissements · Diagnostic. Se termine par un bloc
**« Demande d'audit »** directement collable dans Claude Code.

## 3ter. Build local — staging ISOLÉ (`artifact.build`)

`backend/src/deployment/build.js`. Le build **ne s'exécute jamais dans l'arbre de
travail vivant**. Le moteur copie les sources (`vitrine/`, `manager/`, `backend/`)
dans un **staging temporaire** (`os.tmpdir()/sbauto-build-*`) — **sans**
`node_modules`, `dist`, `.git`, ni **secrets** `.env` du backend — puis lance
`npm ci` + `npm run build` **dans le staging**.

**Pourquoi (cause racine d'un échec `BUILD_FAILED` historique)** : `npm ci`
supprime intégralement `node_modules` avant de réinstaller. Exécuté **en place**,
il tente d'`unlink` un fichier **verrouillé par un processus vivant** — sous
Windows, `esbuild.exe` détenu par le **serveur Vite du Manager** (celui-là même
qui sert l'UI d'où l'on clique « Publier ») → `EPERM`. En staging isolé,
l'installation ne touche jamais le `node_modules` de l'app en cours d'exécution :
le build est **reproductible**, **indépendant de l'état préalable de
`node_modules`**, et compatible **Windows** comme **Linux**. Seul le `dist`
(public) est uploadé : **aucun `.env` n'est embarqué** dans l'artefact. Le staging
est **nettoyé** après l'upload (succès) comme après un échec (atomicité : rien
n'est uploadé si le build échoue).

**Observabilité** : chaque sous-commande (`install_site`, `build_site`,
`install_manager`, `build_manager`) est enregistrée dans le rapport
(**commande + cwd + code de sortie + stdout/stderr**, redigés et bornés), au même
titre que les commandes distantes. **Codes d'erreur spécialisés** :
`ARTIFACT_INSTALL_SITE_FAILED`, `ARTIFACT_BUILD_SITE_FAILED`,
`ARTIFACT_INSTALL_MANAGER_FAILED`, `ARTIFACT_BUILD_MANAGER_FAILED`,
`ARTIFACT_BUILD_{SITE,MANAGER}_MISSING`, `ARTIFACT_STAGE_FAILED`,
`ARTIFACT_PATH_INVALID` (package.json / lockfile manquant). Une sortie non nulle
d'un processus enfant attendu n'est **plus** présentée comme « exception non
prévue ».

**Config frontend PRODUCTION (URL du backend)** : les frontends lisent l'URL de
l'API via `import.meta.env.VITE_API_URL` (baked au build). Les overrides DEV
(`.env.local`, `.env.development*`) — qui contiennent des URL locales
(`http://localhost:6070`, ngrok…) — sont **exclus** du staging, et le build écrit
un `.env.production.local` (priorité Vite la plus haute) avec **`VITE_API_URL`
vide → appels RELATIFS**. Sur le VPS, chaque hôte (vitrine ET Manager) sert `/api`
via Nginx qui proxifie vers le backend local : le relatif est donc robuste et
correct pour les deux, sans URL en dur. Sans ce traitement, le bundle déployé
appellerait le poste du développeur (site cassé dans le navigateur). Le rapport
indique le mode d'API retenu dans l'étape « Préparation de la nouvelle version ».

**Prérequis local** : `npm` dans le `PATH`, et des `package-lock.json` cohérents
dans `vitrine/` et `manager/` (`npm ci` les exige). Régression couverte par
`backend/src/scripts/deployment-build.test.js`.

## 3quater. Configuration distante (`.env` du VPS) — le `.env` du projet, VERBATIM

`backend/src/deployment/deployEnv.js`. Le backend déployé exige une config
COMPLÈTE pour démarrer (sinon `process.exit(1)` : `config/env.js`) : `ENV`,
`MONGODB_URI`, base (`DB_TEST`/`DB_PROD`), `JWT_SECRET`,
`INTEGRATED_API_ENCRYPTION_KEY`, + `PORT`/`CORS_ORIGINS`/`PUBLIC_URL`.

**RÈGLE (déploiement != duplication)** : DÉPLOYER embarque le `.env` du projet
**TEL QUEL**. Le fichier `.env` porte déjà les URI et NOMS de base de chaque
environnement (`MONGODB_URI`, `DB_TEST`, `DB_PROD`) et les secrets (`JWT_SECRET`,
`INTEGRATED_API_ENCRYPTION_KEY`) : ces données figurent **verbatim** dans le
`.env` déployé. On n'INVENTE ni base ni secret. Le **renommage** de base n'a lieu
QUE lors d'une **duplication** (`duplication.rewriteEnv`), jamais au déploiement.

Le contrôleur (`deployment.controller.js`) construit le `.env` distant CÔTÉ
SERVEUR via `buildRemoteEnv(target, { env })` — aucun secret ne transite par le
navigateur. Seules les variables **spécifiques à l'hôte** sont écrasées :
- `ENV` : environnement visé par ce déploiement (défaut PROD -> base `DB_PROD`) ;
- `PORT` : `target.backendPort` ;
- `CORS_ORIGINS` : vitrine + Manager en https ;
- `PUBLIC_URL` : URL publique de la vitrine.
Tout le reste est repris **verbatim** (y compris toute clé additionnelle, ex.
`STRIPE_PROVIDER`). Les clés **strictement plan-de-contrôle**
(`DEPLOY_VPS_SESSION_TTL_MS`, `CONFIRM_PROD_PROMOTION`) sont exclues.

Si une variable requise manque dans le `.env` source pour l'`ENV` visé -> échec
**explicite** `DEPLOY_ENV_INCOMPLETE` AVANT tout upload (jamais un backend qui
redémarre en boucle sur le VPS). Le contenu du `.env` distant n'est **jamais**
journalisé (le transport n'enregistre que le CHEMIN écrit) ; les valeurs secrètes
sont en plus enregistrées dans le redacteur. Les intégrations tierces
(Stripe/Yousign/Brevo) ne sont PAS requises au démarrage (chargées à la demande
depuis le magasin chiffré, déchiffré par `INTEGRATED_API_ENCRYPTION_KEY`).

**Prérequis local** : le backend de contrôle doit posséder un `.env` complet
(déjà le cas). Régression : `deployment-env.test.js`.

## 3quinquies. Nginx & HTTPS — activation en DEUX PHASES (résout le chicken-egg)

La config HTTPS complète référence des `ssl_certificate` (`/etc/letsencrypt/live/
<hôte>/…`). Au **premier** déploiement ces fichiers n'existent pas encore : les
appliquer d'emblée ferait échouer `nginx -t` (« cannot load certificate ») et le
challenge ACME HTTP-01 ne serait jamais servi (Nginx ne démarrant pas). Le
pipeline procède donc en deux temps (`nginx.js` + `pipeline.js`) :
1. **PHASE HTTP** (`applyNginxHttpOnly`) : config port 80 seule — sert le site en
   HTTP + le challenge `/.well-known/acme-challenge/` (webroot `/var/www/certbot`).
   Écrase toute config précédente (même invalide). `nginx -t` passe, reload.
2. **certbot** (`ensureCertificate`) : émet/réutilise les certificats (vitrine
   wildcard ou dédiée, Manager toujours dédié) via HTTP-01 — Nginx sert déjà le
   challenge.
3. **PHASE HTTPS** (`applyNginxConfig`) : bascule sur la config HTTPS complète —
   les certificats existent, `nginx -t` passe, reload. HTTPS actif.

**Atomicité** : si une config appliquée est refusée par `nginx -t`, le symlink
`sites-enabled` est **retiré** immédiatement (la config reste dans
`sites-available` pour diagnostic) — un déploiement échoué ne laisse jamais un
Nginx irrecevable pour les AUTRES sites.

**Préflight tolérant** : `server.preflight` vérifie `nginx -t`. Si l'échec vient
**uniquement** de la config de CETTE cible (laissée invalide par un déploiement
interrompu), c'est **non bloquant** (avertissement) — le déploiement la régénère
et l'écrase. Une config **tierce** cassée reste **bloquante** (on ne déploie
jamais sur un Nginx cassé par un site non géré).

## 3sexies. Configuration réseau & médias (P1 — débloque le site déployé)

**Médias en RELATIF (LOT 4).** Les uploads sont désormais stockés en chemin
**relatif** (`/uploads/x.webp`) — plus jamais l'URL absolue `config.publicUrl`
(fallback `localhost:PORT`) qui cassait le site en HTTPS (Mixed Content /
loopback). `backend/src/services/upload.service.js`. Résolution à l'affichage
(`manager|vitrine/src/lib/media.ts`) : sur le site déployé, Nginx proxifie
`/uploads/` en **même origine** ; en dev, le frontend préfixe avec l'URL backend.
Un **garde-fou Mixed-Content** ramène toute ancienne URL `http://localhost/…`
à son chemin relatif sur une page HTTPS (protège l'affichage avant migration).
Migration idempotente `backend/src/scripts/migrate-media-urls.js`
(`--env=TEST|PROD` · dry-run/`--apply`/`--verify`) : convertit les URLs locales
d'upload en relatif, **préserve** les URLs externes.

**Synchronisation réseau (LOT 3) — étape `runtime.sync`.**
`backend/src/deployment/runtimeConfig.js` : après disponibilité du backend et
**avant** les healthchecks publics, écrit `network.{backendUrl,managerUrl,
websiteUrl}` (HTTPS) dans le singleton `SystemConfiguration` de la base de la
**DESTINATION** (jamais la base locale du moteur — résolue depuis le `.env`
distant : `MONGODB_URI` + base selon l'ENV visé). Idempotent, avec **relecture**
de validation. Refuse toute URL `localhost`/`http://` en destination publique.
Codes : `RUNTIME_CONFIG_INVALID`, `RUNTIME_CONFIG_STILL_LOCAL`,
`RUNTIME_CONFIG_READBACK_FAILED`, `RUNTIME_CONFIG_SYNC_FAILED`. Capacité injectée
par le contrôleur ; neutre en test/façade.

**Healthcheck médias (LOT 12).** L'étape `validate` récupère
`https://<hôte>/api/public/bootstrap` et **refuse `Healthy`** si une URL d'upload
locale/non sûre y subsiste (`MEDIA_STILL_LOCAL`). Un site avec des médias cassés
n'est donc plus déclaré « déployé avec succès ».

## 4. Sécurité / redaction

`backend/src/deployment/report/sanitize.js` — redaction centrale :
- par **motif** : JWT, Bearer, identifiants dans une URI (mongodb://user:pass@),
  clés Stripe, affectations `*_SECRET/_KEY/_TOKEN=…`, options `--password …`,
  clés privées PEM ;
- par **valeur exacte** : le mot de passe VPS et les secrets d'environnement
  (`JWT_SECRET`, `MONGODB_URI`, `INTEGRATED_API_ENCRYPTION_KEY`) sont enregistrés
  au runtime et effacés partout.
- clés d'objet sensibles → valeur `[REDACTED_SECRET]`.

Tests dédiés anti-fuite (`deployment-report.test.js`) + vérification runtime : le
mot de passe VPS n'apparaît **jamais** dans le flux ni dans le rapport.

## 5. Persistance, tailles, historique

`DeploymentRun` (collection dédiée) est la **source de vérité** d'une tentative :
statut, étapes, `structuredReport`, `markdownReport`, `errorSummary`, timestamps,
version/commit, hostnames vitrine+Manager, utilisateur.

**Limites (anti-dépassement BSON)** : stdout/stderr tronqués à ~3 000 caractères
(début+fin conservés, marqueur explicite), commande ~600, ≤ 250 commandes, ≤ 100
avertissements, Markdown ≤ 200 000 caractères.

Historique : `GET /api/deployment/runs` (liste) / `GET /api/deployment/runs/:id`
(rapport complet). Le rapport reste disponible après rechargement, reconnexion
et **redémarrage du backend**.

## 6. UX

- **Écran de progression** (`DeployRunning.tsx`) : URLs vitrine + Manager,
  progression radiale, étape courante, checklist canonique avec états/loaders.
- **Écran de succès** : « Ouvrir le site » + « Ouvrir le Manager », infos utiles,
  **« Voir le rapport »**.
- **Écran d'erreur** (`ErrorPanel`) : message métier (cause + solution), jamais de
  stack/commande Linux, **« Voir le rapport »** + « Réessayer ».
- **Rapport** (`ReportModal.tsx`) : synthèse + rapport complet, **« Copier le
  rapport »** (Markdown + repli presse-papiers `execCommand`, confirmation toast).
- **Historique** (`HistoryTimeline.tsx`) : timeline des runs persistés avec
  « Voir le rapport ». Accessibilité : `aria-live`, focus visibles, Échap ferme
  la modale, `prefers-reduced-motion` respecté.

## 6bis. Robustesse du flux côté client

Le lancement d'un flux (préflight/déploiement) est **différé d'un macrotask** puis
annulé au cleanup : sous `React.StrictMode` (dev) l'effet s'exécute deux fois
(setup → cleanup → setup) et le cleanup transitoire annule le premier démarrage,
de sorte qu'**un seul flux** part réellement (un seul déploiement backend). Une
interruption **volontaire** (démontage / abort) n'est **jamais** traitée comme une
panne : le panneau « Serveur injoignable » (OFFLINE) n'apparaît que sur un échec
réseau RÉEL (fetch rejeté hors abort, flux impossible), jamais pendant l'attente
normale de la première réponse (grand loader « Connexion au serveur… »).

## 7. Comportement dégradé / crash

Toute exception, timeout, chute SSH, fermeture NDJSON ou déconnexion client
produit **quand même** un rapport (partiel mais exploitable) : le run est
finalisé avec statut, étape fautive, erreur sérialisée+redigée, timestamps. La
déconnexion du client **n'arrête pas** le déploiement. Au **redémarrage du
backend**, `finalizeOrphanRuns()` marque les runs restés « running » comme
`interrupted` avec un rapport partiel — aucune exécution ne reste indéfiniment en
cours.

## 8. Rollback / état distant

Le rapport indique ce qui a été créé/modifié/démarré sur le VPS et si un rollback
a eu lieu. Le moteur ne prétend jamais un rollback non vérifié (`rollbackPerformed:
false` par défaut).

## 9. Architecture DNS (rappel)

**Aucun enregistrement DNS individuel** : un unique wildcard configuré une fois
dans la zone `ly-solution.com` —
```
A    *    <IP publique du VPS>
```
Le certificat **wildcard** `*.ly-solution.com` couvre la vitrine (un niveau). Le
Manager `manager.<host>` (deux niveaux) reçoit un **certificat dédié** émis par
Certbot (le DNS wildcard résout plusieurs niveaux). Le préflight vérifie la
présence du certificat wildcard et bloque proprement s'il manque.

## 10. Procédure de diagnostic

1. Ouvrir l'historique → « Voir le rapport » de la tentative.
2. Onglet « Rapport complet » → **« Copier le rapport »**.
3. Coller dans Claude Code : le bloc « Demande d'audit » guide l'analyse (cause
   racine, correction minimale, tests de non-régression).
