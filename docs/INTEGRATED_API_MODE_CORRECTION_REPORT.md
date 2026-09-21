# Rapport — Correction du mode IntegratedAPI (mode fournisseur ≠ ENV)

## 1. Cause de la mauvaise conception initiale
La 1ʳᵉ implémentation liait le **mode des API externes** à l'**environnement
applicatif** : le résolveur `getCredential` lisait `config.env` pour choisir le
jeu de credentials (`environments[config.env]`). Confusion entre deux concepts
distincts : `ENV` = environnement de l'app + base MongoDB, vs. **mode fournisseur**
= sandbox/prod d'un tiers. Conséquence : impossible d'avoir une app `ENV=PROD`
utilisant Stripe **test**, ni `ENV=TEST` utilisant Stripe **prod**.

## 2. Ancien comportement
`ENV=TEST` → clés TEST imposées ; `ENV=PROD` → clés PROD imposées. Yousign base
URL et secret webhook choisis par `config.env`. Aucun choix indépendant possible.

## 3. Nouveau comportement
Chaque intégration porte un **`activeMode` (TEST|PROD)** choisi par un DEV,
**indépendant de `ENV`**. Le choix des credentials se fait via `activeMode` (ou un
mode explicite pour un test), **jamais** via `config.env`/`ENV`/`NODE_ENV`/`DB_*`.
Aucun fallback entre modes. Les **4 combinaisons** ENV×mode sont possibles ; la
seule sensible (`ENV=TEST` + fournisseur `PROD`) est alertée et confirmée.

## 4. Migration des credentials existants
`migrateIntegratedApiModes()` (boot, idempotente) : `$rename environments→modes`
au niveau du driver natif (**aucun déchiffrement/réchiffrement, aucune perte**) +
`activeMode='TEST'` par défaut. Vérifié en réel : la config **Stripe TEST**
existante (secretKey, publishableKey, webhookSecret) est **intégralement
conservée** et déchiffrable après migration.

## 5. Structure finale
`IntegratedApi { provider, enabled, activeMode, modes: { TEST, PROD } }` ; chaque
mode : `{ credentials(chiffrés), configured, verified, lastTested* }`. Champs
`modeUpdatedBy/At`. (Détail : `docs/INTEGRATED_API.md`.)

## 6. Indépendance ENV ↔ activeMode
Prouvée par tests automatisés dans les DEUX sens :
- `ENV=TEST` : `activeMode=PROD` → `getCredential` renvoie la clé **PROD** (pas ENV).
- `ENV=PROD` : `activeMode=TEST` → `getCredential` renvoie la clé **TEST** (pas ENV).
Confirmé **en réel** : app `ENV=PROD` (base `sbauto06_prod`), Stripe `activeMode=TEST`
→ appel Stripe avec la clé **TEST** → **HTTP 200**.

## 7. Sécurité du basculement PROD
`POST /:provider/active-mode` : vers PROD exige **fournisseur activé + mode
configuré + vérifié (test réussi) + confirmation exacte** (`ACTIVER STRIPE PROD`).
Vérifié côté serveur (pas de confiance à la seule modale). Un **test n'active
jamais** le mode. Toute modification de credential remet `verified=false`.
Validation de préfixe **par mode** : `sk_live_` en TEST / `sk_test_` en PROD →
rejet 400. Frontend : bannière de **risque croisé** (app TEST + fournisseur PROD)
+ modale de confirmation avec saisie du verbe.

## 8. Résolution des credentials
Resolver unique `integratedApi.service.js` : `getCredential` /
`getProviderConfiguration` / `getProviderReadiness`. Tous les drivers (Stripe,
Yousign), tests de connexion, webhooks et prérequis contrat passent par lui.
Aucun accès dispersé `environments[config.env]`.

## 9. Comportement des webhooks
Vérification par **mode** : secret du mode actif d'abord, repli sur l'autre mode
(événement retardé après bascule) → **acquitté 2xx mais NON traité**. Événement
authentique **sans contrat rattachable** → **2xx** (ignoré proprement). Signature
invalide → **400**. Métadonnées Stripe : `providerMode`, `applicationEnvironment`,
`contractId`.

## 10. Installation Stripe Skills
- Commande : `npx skills add https://docs.stripe.com`.
- Résultat : **4 skills installés** (`stripe-best-practices`, `stripe-directory`,
  `stripe-projects`, `upgrade-stripe`).
- Emplacement : `.agents/skills/` (contenu) + `.claude/skills/` (symlinks) +
  `skills-lock.json`.
- Fichiers versionnés : **aucun** — `.agents/`, `.claude/`, `skills-lock.json` sont
  **git-ignorés** (tooling agent local, symlinks machine-spécifiques). Aucun
  secret présent dans les skills.

## 11. Test réel de la connexion Stripe TEST
Lecture masquée de la config : `secretKey (••••), publishableKey (••••),
webhookSecret (••••)` — **3 credentials présents**, `activeMode=TEST`. Appel
officiel **`GET https://api.stripe.com/v1/account` → HTTP 200** (compte
`acct_1Tt9…`), clé secrète `sk_test_…` valide. `verified` passe à `true` après un
test réussi via l'endpoint `/modes/TEST/test`. Aucune clé complète affichée.

## 12. Test réel du webhook + statut HTTP
`stripe listen --forward-to http://localhost:6060/api/webhooks/stripe` (secret
local correspondant au `webhook_secret` Stripe **TEST** du Manager), puis
`stripe trigger checkout.session.completed` :
- backend → **HTTP 200** (précédemment 500) sur chaque `POST /api/webhooks/stripe`.
- Événement synthétique (sans `contractId` SB Auto) → **acquitté 2xx** sans
  corruption (ignoré proprement). Événements testés :
  `checkout.session.completed` (+ objets de fixture associés).

## 13. Tests automatisés
Suite complète **verte** : migration 54, **integrated-api 51**,
**env-independence 4**, contracts 38, yousign 34, stripe 29, contract-lifecycle
42, stripe-cli 35, smoke 102 → **389 assertions, 0 échec**. Couvre : matrice
ENV×mode, migration idempotente sans perte, préfixe par mode, bascule gardée
(non configuré/non vérifié/confirmation), prérequis contrat sur mode actif
vérifié, webhooks par mode.

## 14. Builds & typechecks
Manager : `tsc -b --noEmit` **OK**, `vite build` **OK**. Backend : ESM, aucun
build (tests au vert).

## 15. Sécurité
Aucun secret exposé (masquage `••••XXXX`), aucun secret commité (grep OK — seules
occurrences = fixtures de test fictives), aucun secret dans ce rapport
(`sk_/pk_/whsec_` en `[…]`/`••••`), aucun token Stripe CLI versionné.

## 16. Fichiers créés / modifiés (principaux)
- **Backend créés** : `env-mode-independence.test.js`.
- **Backend modifiés** : `utils/integratedApiCatalog.js`, `models/IntegratedApi.model.js`,
  `services/integratedApi.service.js`, `services/providerConnectionTest.service.js`,
  `config/integratedApiBootstrap.js`, `config/bootstrap.js`,
  `controllers/integratedApi.controller.js`, `routes/integratedApi.routes.js`,
  `validators/integratedApi.validator.js`, `services/stripe/stripe.service.js`,
  `services/yousign/yousign.provider.js`, `services/yousign/yousign.service.js`,
  `controllers/webhook.controller.js`, `services/contractWebhook.service.js`,
  `services/contract.service.js`, `scripts/sandbox-check.js`,
  `scripts/integrated-api.test.js`, `scripts/stripe.test.js`,
  `scripts/contract-lifecycle.test.js`, `package.json`.
- **Frontend modifiés** : `types/index.ts`, `lib/api.ts`, `pages/dev/DevIntegrationsPage.tsx`.
- **Docs** : `INTEGRATED_API.md` (réécrit), `STRIPE_INTEGRATION.md`,
  `YOUSIGN_INTEGRATION.md`, `WEBHOOKS.md`, `CONTRACT_ACTIVATION_FLOW.md`,
  `ARCHITECTURE.md`, `STRIPE_LOCAL_WEBHOOK_DEVELOPMENT.md`, `README.md`,
  `.env.example`, ce rapport. `.gitignore` (skills).

## 17. Commits (atomiques)
1. `refactor(integrated-api): decouple provider mode from app environment`
2. `feat(integrated-api): per-mode config API + guarded active-mode switching`
3. `fix(stripe,yousign,webhooks,contracts): resolve secrets from active mode not ENV`
4. `test(integrated-api): cover ENV×mode matrix, migration and guarded switching`
5. `feat(manager): independent TEST and PROD API controls with mode switching`
6. `docs(integrated-api): document independent external API modes`

Poussés sur `origin/main`. Hash final : fourni dans le compte rendu de la session.
