# Audit — IntegratedAPI & Moteur de déploiement industriel

> **NB (2026-07-23)** : le worktree « SB Auto 06 -- deployment-engine » cité dans ce rapport historique a été supprimé — dossier canonique unique : `SB Auto 06`.


> **LOT 0 — Audit de l'existant.** Document canonique. Aucune modification
> structurelle n'est faite avant cet audit. Toutes les affirmations sont
> sourcées `fichier:ligne` (worktree `SB Auto 06 -- deployment-engine`, branche
> `feat/industrial-deployment-engine`). Aucune valeur secrète n'y figure.

---

## 0. Nomenclature stricte (à employer partout)

Deux axes **indépendants** qu'il ne faut jamais confondre :

| Terme | Signification | Valeurs | Détermine |
|---|---|---|---|
| **ENV** / environnement applicatif | Environnement d'exécution du backend | `TEST` \| `PROD` | La **base** (DB_TEST/DB_PROD), les données métier, les URLs publiques, la destination de déploiement |
| **activeMode** / mode actif d'une intégration | Mode courant d'UNE API intégrée | `TEST` \| `PROD` (Yousign: idem, libellés SANDBOX/PROD possibles à l'affichage) | Les **credentials** utilisés par cette intégration |
| **credential mode** | Jeu de credentials d'un fournisseur pour un mode donné | par mode | — |
| **deployment target** | Destination distante (VPS + domaines) | — | — |
| **release** | Version distante immuable installée | — | — |

**Règle d'or (déjà respectée dans le code, à préserver) :** `activeMode` n'est
**jamais** dérivé de `ENV`. Résolution runtime :
`ENV → base active → configuration IntegratedAPI stockée dans cette base → activeMode du fournisseur → credentials de ce mode`.

Les 4 cas sont supportés aujourd'hui et **doivent le rester** :

| ENV appli | Base | Stripe actif | Paiements | Cas |
|---|---|---|---|---|
| TEST | DB_TEST | TEST | faux | développement |
| TEST | DB_TEST | PROD | réels | test technique contrôlé |
| PROD | DB_PROD | TEST | faux | **démonstration publique** |
| PROD | DB_PROD | PROD | réels | production réelle |

---

## LOT 0.1 — Environnements & bases

- `ENV = process.env.ENV`, lu **une seule fois au chargement** ; fail-closed si absent/invalide (`process.exit(1)`). `backend/src/config/env.js:21-29`.
- `MONGODB_URI` = **un seul cluster** ; seul le **nom** de base change : `dbName = isProd ? DB_PROD : DB_TEST`. `env.js:32-33`.
- Connexion via la connexion mongoose **globale** : `mongoose.connect(mongoUri, { dbName })`. `backend/src/config/db.js:21-24`. Tous les modèles tapent dans cette unique base.
- Sélection **au démarrage uniquement** (aucune relecture runtime hors tests).
- Seeds/migrations tournent contre la base connectée (bootstrap via modèles mongoose). `backend/src/config/bootstrap.js:266-332`, ordre `connectDatabase → bootstrap → finalizeOrphanRuns` (`backend/src/server.js:9-14`).
- Moteur de déploiement : `buildRemoteEnv(target,{env})` reprend le `.env` **verbatim** et n'écrase que l'hôte (`ENV`, `PORT`, `CORS_ORIGINS`, `PUBLIC_URL`). `backend/src/deployment/deployEnv.js:74-118`. Le backend **déployé** choisit sa base via `ENV=PROD → DB_PROD` à son propre démarrage.

### DETTE CRITIQUE — persistance des destinations liée à l'ENV LOCAL

`DeploymentTarget` et `DeploymentRun` sont écrits dans la **base active du backend de contrôle**, pas dans une base neutre ni dans celle de la destination :
`DeploymentTarget.model.js:87` / `DeploymentRun.model.js:88` (connexion par défaut) ; services `deploymentTarget.service.js`, `deploymentRun.service.js` opèrent sur `config.dbName`.

Conséquence : **un déploiement PROD lancé depuis un backend de contrôle en `ENV=TEST` persiste la cible/les runs dans `DB_TEST`.** Un backend de contrôle démarré en `ENV=PROD` (branché sur `DB_PROD`) ne verrait **aucune** de ces destinations. La visibilité dépend entièrement de l'ENV local. De plus le champ `env` du run est **codé en dur à `'PROD'`** (`deploymentRun.service.js:29`), ce qui divergera de la base réelle de stockage. → **LOT 5**.

### Matrice environnements

| Élément | Dépend de ENV local | Dépend de la destination | Stockage |
|---|---|---|---|
| Données métier | **oui** (config.dbName) | non | Base active : DB_TEST/DB_PROD |
| IntegratedAPI (stockage) | **oui** (base active) | non | `integratedapis` dans la base active |
| IntegratedAPI (choix du mode) | **non** (suit `activeMode`) | non | champ `activeMode` du doc |
| SystemConfiguration (réseau) | **oui** | non | `systemconfigurations` (singleton) |
| DeploymentRun | **oui** (base de contrôle) | non (env figé 'PROD') | `deploymentruns` base de contrôle |
| **DeploymentTarget** | **oui** (base de contrôle) | non | `deploymenttargets` base de contrôle |
| Historique (runs + target.history[]) | **oui** | non | base de contrôle |

---

## LOT 0.2 / 0.5 / 0.6 — IntegratedAPI (Stripe / Yousign / Brevo / Hostinger)

**Le système à DEUX AXES est déjà correctement implémenté.** À **préserver**, pas à réécrire.

- Modèle : un doc par fournisseur, `activeMode` (défaut `TEST`), `modes.TEST`/`modes.PROD` avec `credentials` (Map chiffrée), `baseUrl` éditable, `configured` (dérivé), `verified` (par mode), `lastTest*`. `backend/src/models/IntegratedApi.model.js:18-79`. Docblock : « le driver consomme TOUJOURS le mode actif … JAMAIS l'ENV » (`:8-11`).
- Chiffrement : AES-256-GCM, clé `INTEGRATED_API_ENCRYPTION_KEY` = **64 hex** ; sentinelle `__UNFILLED__` (préfixe) ; format `iv.tag.ciphertext`. `backend/src/utils/integratedApiCrypto.js:18-142`.
- Catalogue : `STRIPE`, `YOUSIGN`, `BREVO(active:false)`, `HOSTINGER` ; modes `TEST/PROD` ; garde de préfixe par mode (`sk_test_`/`sk_live_`) ; `webhookSecret` **sans** préfixe par mode. `backend/src/utils/integratedApiCatalog.js:16-137`.
- Bootstrap : `validateEncryptionKeyAtBoot` (PROD fail-closed), `migrateIntegratedApiModes` (idempotent `environments→modes`), `seedIntegratedApis` (credentials vides, **Brevo non seedé**). `backend/src/config/integratedApiBootstrap.js:14-97`.
- Service (autorité de consommation) : `getActiveMode`, `getCredential`/`tryGetCredential` résolvent `mode ?? doc.activeMode` — **jamais** `config.env`. **Aucun cache** : `IntegratedApi.findOne` à chaque appel. `backend/src/services/integratedApi.service.js:47-227`.
- Contrôleur/routes : **DEV uniquement** (`authorize(ROLES.DEV)`), secrets masqués (maskedValue via lastFour), endpoint bascule `POST /:provider/active-mode` avec garde forte pour → PROD (enabled + verified + confirmVerb). `integratedApi.controller.js:32-341`, `integratedApi.routes.js:12-19`.
- Webhooks : montés avant `express.json()` (raw body), secret résolu **par mode** ; un évènement vérifié contre le mode **non actif** est acquitté (2xx) mais **non traité**. `webhook.routes.js:12-15`, `stripe.service.js:167-208`, `contractWebhook.service.js:283-298`.

### Tableau par fournisseur

| | STRIPE | YOUSIGN | BREVO | HOSTINGER |
|---|---|---|---|---|
| `active` (catalogue) | true | true | **false** | true |
| Modes | TEST/PROD | TEST/PROD | TEST/PROD | TEST/PROD |
| Credentials requis | `secretKey`,`webhookSecret` | `apiKey`,`webhookSecret` | `apiKey` | `apiToken` |
| Résolution runtime | `getActiveMode`/`getCredential('STRIPE')` | `getCredential('YOUSIGN')`+baseUrl | — (aucun driver) | test-only |
| Lit `process.env.*` pour les creds ? | **Non** (`STRIPE_PROVIDER` = stub/real seulement) | **Non** (`SIGNATURE_PROVIDER`) | n/a | **Non** |
| Webhook secret | `modes.<mode>.credentials.webhookSecret` | idem | — (pas de handler) | — |
| Dépendance ENV | **indépendant** | **indépendant** | indépendant (inutilisé) | indépendant |
| Manque / risque | vérif HMAC maison (pas `constructEvent`) ; version API épinglée `2025-02-24.acacia` doit coller au dashboard | secret webhook requis catalogue | `active:false`, non seedé, pas de driver | pas de consommateur runtime d'activeMode |

**Réponses aux 4 questions critiques :**
1. `activeMode` **indépendant** de ENV (champ Mongo, défaut TEST ; jamais dérivé de `config.env`).
2. **ENV=PROD + Stripe TEST : supporté**. Trace : appel Stripe → `getCredential('STRIPE','secretKey')` → `resolvedMode = mode ?? doc.activeMode = 'TEST'` → clé `sk_test_`. `config.env` ne sert qu'au bandeau `crossModeRisk`.
3. **Bascule instantanée sans redémarrage** : `setActiveMode` persiste en base ; consommateurs relisent le doc à chaque appel (pas de cache d'activeMode) ; le client Stripe est caché par `secretKey|baseUrl` → nouvelle instance auto au changement de mode.
4. **Évènements Stripe consommés** (`contractWebhook.service.js:141-202`) : `checkout.session.completed|async_payment_succeeded|async_payment_failed|expired`, `payment_intent.succeeded|payment_failed`, `charge.refunded`, `invoice.finalized|paid|payment_failed`, `customer.subscription.created|updated|deleted`.

**Brevo :** déclaré au catalogue mais `active:false`, **aucun service runtime** (`grep brevo` → catalogue + sanitize + tests seulement). → convergence LOT 11.

---

## LOT 0.3 / 0.4 — Configuration réseau & médias (`http://localhost:6060`)

### Modèle réseau
`SystemConfiguration` (singleton) avec `network.{backendUrl,managerUrl,websiteUrl}`. `backend/src/models/SystemConfiguration.model.js:9-26`. **Défauts = localhost/ports dev** : `http://localhost:6060/6061/6062`. `backend/src/utils/constants.js:41-45`. Seedé via `getSingleton` (`bootstrap.js:289`). CORS dynamique alimenté par `managerUrl`/`websiteUrl` (`corsOrigins.js:25-37`) — `backendUrl` **non** utilisé pour CORS.

### CAUSE RACINE des médias `localhost:6060`
**Des URLs ABSOLUES sont figées dans les documents Mongo au moment de l'upload.**
- Site d'écriture exact : `backend/src/services/upload.service.js:26` (images) et `:43` (favicons) : `url: \`${config.publicUrl}/uploads/${unique}\``.
- `config.publicUrl = (process.env.PUBLIC_URL || \`http://localhost:${PORT||4000}\`)`. `backend/src/config/env.js:81`. En dev (`PORT=6060`, sans `PUBLIC_URL`), chaque asset est persisté en `http://localhost:6060/uploads/...`.
- Le backend **ne transforme rien** à la sortie (pas de sérialiseur) : la valeur absolue stockée est renvoyée telle quelle.
- Le résolveur frontend **laisse passer** les URLs absolues sans les toucher : `manager/src/lib/media.ts:13` (et `vitrine/src/lib/media.ts:15`) — early-return si `^https?://`. Seul un chemin **relatif** `/uploads/...` serait préfixé par le `backendUrl` du NetworkConfig.

Classification : **(iii) URLs absolues bakées dans les documents** (via le fallback env `PUBLIC_URL`/localhost au moment de l'upload). Le défaut `SystemConfiguration.backendUrl` localhost est un **faux coupable** pour les images (il ne sert qu'au préfixage des chemins relatifs, contourné puisque les valeurs sont absolues).

### Chaîne d'un média cassé (logo header)
1. Mongo `Company.logos.header = "http://localhost:6060/uploads/favicon-9.png"` (écrit `upload.service.js:26`).
2. Réponse API : champ renvoyé verbatim (pas de sérialiseur).
3. React : `resolveMediaUrl(company.logos.header, backendUrl)` (`manager/src/components/layout/AppLayout.tsx:16`, `Sidebar.tsx:17`, `LoginPage.tsx:98`…).
4. Résolveur : `media.ts:13` voit `^https?://` → renvoie inchangé (backendUrl ignoré).
5. Navigateur : requête `http://localhost:6060/...` depuis le poste du visiteur → Mixed Content / loopback bloqué.

### Nginx / 502 / 401
- Le proxy `/uploads/` **existe** et est correct (`nginx.js:66` → backend PM2). Donc un chemin **relatif** passerait par nginx → confirme que le bug est l'URL absolue bakée, pas un proxy manquant.
- 401/CORS login : l'API réellement appelée par le Manager est le build-time `VITE_API_URL` (corrigé récemment en relatif) ; un `managerUrl` absent des origines CORS (singleton) reste une cause plausible de 401/CORS.
- 502 : backend PM2 down / mauvais port — pas lié au chemin média.

### Remédiation existante (à réutiliser, PAS de search-replace global)
`backend/src/scripts/lib/promotion-core.js:94` + `scanRiskyUrls`/`collectUploadRefs` (testés `promote.test.js:142-148`) détectent déjà les `http://localhost:6060/uploads/...`/ngrok et les réécrivent vers le `PUBLIC_URL` réel. → base de la migration **LOT 4**.

---

## LOT 0.4 — Moteur de déploiement : état & cycle de vie

- `DeploymentRun` : `operationType` enum `PRECHECK|DEPLOYMENT|ROLLBACK|HEALTHCHECK|BACKUP` mais **seuls PRECHECK/DEPLOYMENT sont produits** ; `releaseId` déclaré mais **jamais écrit**. `DeploymentRun.model.js:42,80`. `finalizeOrphanRuns` évite les runs « running » éternels (`deploymentRun.service.js:132-148`).
- `DeploymentTarget` : `state NEW|DEPLOYING|DEPLOYED|FAILED`, `currentVersion`, `history[]` (borné 50). **Manquent** : `targetEnvironment`, `apiHostname/apiUrl`, `currentReleaseId/previousReleaseId`, `healthStatus`, `serverIdentifier`. `DeploymentTarget.model.js`.
- **`DeploymentRelease` : ABSENT** (aucun modèle, aucune référence).
- **Pipeline sans releases ni symlink `current`** : upload direct dans les répertoires **vivants** (`/var/www/<host>/{vitrine,manager,backend}`), écrasement en place. `pipeline.js:60-107`. Le **seul** switch atomique est le symlink de conf **nginx** (`nginx.js:193-208`), pas le code. → **rollback impossible** en l'état.
- Engine : `deploy`, `deployWithReport`, `duplicate`, `backup`, `restore`, `listBackups`. **Pas de `update()` ni `rollback()`**. `backup` = mongodump + uploads + conf → tar ; `restore` = **données seulement** (pas le code/conf). `DeploymentEngine.js`, `backup.js:34-100`.
- PM2 : 1 process `sbauto-<host>` par port. Nginx : conf par hôte, deux phases HTTP→HTTPS. Certbot : wildcard réutilisé (vitrine sous-domaine) + cert dédié (Manager).

### Capacités actuelles

| Capacité | État | Preuve |
|---|---|---|
| Premier déploiement | **EXISTE** | `deployWithReport`→`runPipeline` |
| Redéploiement | **EXISTE** | même chemin, écrasement en place |
| Mise à jour zéro-downtime | **PARTIEL** | PM2 reload OK, mais upload écrase les statiques sans switch atomique |
| Rollback | **ABSENT** | pas de `rollback()`, pas de release retenue, `rollbackPerformed:false` |
| Restore | **PARTIEL** | données Mongo+uploads seulement |
| Suppression/désactivation cible | **PARTIEL** | hard delete only (ne stoppe pas PM2/nginx) |
| Suivi d'état | **EXISTE** | target.state + run.status + orphan finalize |
| Healthcheck | **PARTIEL** | dans le pipeline ; pas d'endpoint autonome, pas de `healthStatus` persisté |
| Versions/releases | **ABSENT** | `currentVersion` string seulement |
| Historique des releases | **PARTIEL** | log d'**attempts**, pas de releases activables |
| Activation atomique | **PARTIEL** | seulement le symlink de conf nginx |

**UI Manager actuelle** : landing / duplicate / deploy(assistant preflight→running→success/error) / targets grid / history. **Absent** : page **détail** d'une cible, distinction update vs first-deploy, **rollback**, liste/activation de **releases**, dashboard santé, décommission.

**Conclusion structurelle :** pour un gestionnaire industriel (update/rollback/releases/historique), il faut un **refactor releases + symlink `current`** : déployer dans `releases/<id>/`, repointer atomiquement `current` (racines nginx + cwd PM2 sur `current`), conserver N releases, ajouter `DeploymentRelease` + `currentReleaseId/previousReleaseId` sur la cible.

---

## 1. Causes racines (synthèse)

| # | Cause racine | Fichier:ligne | Lot correctif |
|---|---|---|---|
| C1 | **Médias localhost** : URL absolue bakée à l'upload via `config.publicUrl` (fallback `localhost:PORT`) | `upload.service.js:26,43` ; `env.js:81` | **LOT 4** (relatif + migration) |
| C2 | **Config réseau non synchronisée** après déploiement : la base cible garde les URLs localhost par défaut | `constants.js:41-45` ; `SystemConfiguration.model.js` | **LOT 3** |
| C3 | **Destinations captives de l'ENV local** : targets/runs dans la base de contrôle (DB_TEST) | `DeploymentTarget.model.js:87` ; `DeploymentRun.model.js:88` | **LOT 5** |
| C4 | **Pas de releases/rollback** : écrasement en place, aucun symlink `current` | `pipeline.js:60-107` | **LOT 6/8/9** |
| C5 | **Pas de gestionnaire de déploiements complet** (détail, update, rollback, releases) | UI `pages/dev/deployment/*` | **LOT 7** |
| C6 | **Webhooks Stripe non automatisés** pour une destination publique | `stripe.service.js`, catalogue | **LOT 10** |

**Non-problème confirmé** : le système IntegratedAPI à deux axes fonctionne déjà (ENV=PROD+Stripe TEST OK, bascule instantanée). **LOT 1 = consolidation + UX + codes d'erreur, pas une réécriture.**

---

## 2. Architecture retenue (compatible, minimale)

- **Axe A (ENV)** conservé `TEST/PROD` (pas de renommage).
- **Axe B (activeMode)** conservé par intégration ; jamais dérivé de ENV.
- **Resolver IntegratedAPI** : consolider une autorité `resolveIntegratedApi(provider)` retournant `{provider, runtimeEnvironment, activeMode, credentials, verified, source}` au-dessus de l'existant (`getActiveMode`/`getCredential`), **sans** casser l'API service actuelle. Codes explicites `INTEGRATED_API_*`.
- **Médias** : stocker `/uploads/...` **relatif** ; résoudre à la sortie/au frontend via NetworkConfig + nginx ; migration idempotente dry-run/apply/verify des docs existants (réutiliser `promotion-core`).
- **Config réseau** : service `syncRuntimeNetworkConfiguration()` idempotent, exécuté **sur la base de la destination** (via un appel authentifié à l'API déployée, pas la base locale du moteur), écrivant `backendUrl/managerUrl/siteUrl` HTTPS ; validation post-sync (refus localhost/http en destination publique). Étape pipeline `runtime_configuration.sync`.
- **DeploymentTarget** : rendre les destinations **indépendantes de l'ENV local** (base de contrôle dédiée ou clé de projet) ; ajouter `targetEnvironment`, `apiHostname/apiUrl`, `currentReleaseId/previousReleaseId`, `healthStatus`.
- **DeploymentRelease** + refactor **releases/symlink `current`** pour update atomique + rollback.
- **Stripe** : `syncStripeWebhookForTarget()` idempotent, endpoint `https://api.<domaine>/api/webhooks/stripe` selon l'**activeMode réel dans la base cible** (jamais dérivé de PROD).

---

## 3. Plan de migration

1. **Médias** : script `migrate-media-urls` (dry-run → apply → verify) sur DB_TEST puis DB_PROD ; convertit `http://localhost:6060/uploads/x` → `/uploads/x` ; **préserve** les URLs externes légitimes ; idempotent. Base : `promotion-core.scanRiskyUrls/collectUploadRefs`.
2. **Upload** : `upload.service.js` stocke désormais le chemin **relatif** ; plus de dépendance à `config.publicUrl` pour la persistance.
3. **Config réseau** : `syncRuntimeNetworkConfiguration` au déploiement (pas de seed destructif).
4. **DeploymentTarget/Release** : migration additive (nouveaux champs nullable) ; backfill `targetEnvironment` depuis l'historique.

---

## 4. Décisions retenues

1. **Ne pas réécrire IntegratedAPI.** Consolider un resolver au-dessus de l'existant. Préserver la bascule instantanée et `ENV=PROD + Stripe TEST`.
2. **Médias : stocker relatif + migrer.** Résolution via NetworkConfig/nginx.
3. **Config réseau : synchronisée sur la base de la DESTINATION**, jamais l'ENV local du moteur ; validation anti-localhost avant `deployment.finalize`.
4. **Introduire releases + symlink `current`** pour permettre update atomique et rollback (refactor du pipeline d'upload).
5. **Rendre les destinations indépendantes de l'ENV local** (impératif : une cible PROD déployée depuis ENV=TEST reste visible).
6. **Stripe webhook automatisé** par destination selon l'activeMode de la base cible ; secret CLI local jamais réutilisé comme secret de destination publique.
7. **Brevo** : convergence documentée (`docs/BREVO_DEPLOYMENT_CONVERGENCE.md`) avant toute intégration ; pas de merge destructif.

---

## 5. Ordre d'exécution proposé (lots)

| Priorité | Lots | Justification |
|---|---|---|
| **P1 — débloque le site déjà en ligne** | LOT 3 (sync config réseau) + LOT 4 (médias relatifs + migration) + LOT 12 (healthcheck médias) | Corrige le Mixed Content / loopback qui casse le Manager déployé |
| **P2 — cohérence du plan de contrôle** | LOT 5 (DeploymentTarget indépendant de l'ENV) + LOT 2 (domaine api.) + LOT 3 (finalisation) | Rend les destinations fiables et complètes |
| **P3 — industrialisation** | LOT 6 (releases) + LOT 8 (update atomique) + LOT 9 (rollback) + LOT 7 (UI gestionnaire) | Update/rollback/historique |
| **P4 — intégrations** | LOT 1 (resolver + UX) + LOT 10 (Stripe webhook auto) + LOT 11 (Brevo convergence) | Automatisation intégrations |
| **Transverse** | LOT 13 (sécurité) + LOT 14 (tests) + doc | À chaque lot |

Chaque lot : audit ciblé → correction minimale compatible → tests de non-régression (exécutants réseau/système **injectés**, aucun appel Stripe réel, mocks déterministes) → doc → commit.
