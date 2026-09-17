# RX-RUN-2 — Audit « une seule commande » (parité dev/deploy)

> Branche `phase-0-security-baseline`. **Aucune feature, aucune refonte** : scripts + config + docs + tests.
> Objectif : `npm run dev` = mode officiel (React ON, backend + React prêts) ; `npm install && npm run build
> && npm start` = déploiement (React ON) ; **sans jamais modifier le `.env`**. Cf.
> [`RX_RUN_LAUNCH_AUDIT.md`](RX_RUN_LAUNCH_AUDIT.md) (RX-RUN).

## 1. État AVANT (scripts RX-RUN)
Trop de commandes à retenir : `canary:build`, `check:launch`, `check:launch:canary`, `canary:up`,
`vanilla:up`, `verify:parcours`. Le développeur devait enchaîner build + check + up manuellement, et `npm
start` restait `nodemon app.js` (**Vanilla par défaut**, pas React) → divergence dev/déploiement.

| Élément | Constat | Décision RX-RUN-2 |
|---|---|---|
| `canary:build` | = `react:build` (redondant) | **fusionné** dans `dev`/`build` (build auto) |
| `check:launch` / `:canary` | verbeux | **renommé** `check` (interne conservé : `checkLaunchReadiness.js`) |
| `verify:parcours` | verbeux | **renommé** `verify` (script conservé : `verifyParcours.js`) |
| `canary:up` / `vanilla:up` | 2 lanceurs séparés | **fusionnés** : `start`/`start:vanilla` (+ `dev`/`dev:vanilla`) |
| `scripts/launchCanary.js` / `launchVanilla.js` | doublon avec le nouveau boot | **supprimés** (remplacés par `scripts/run/start.js --vanilla`) |
| `npm start` = `nodemon app.js` | Vanilla + watch (pas un boot deploy) | **`node scripts/run/start.js`** (React ON, mono-process) |
| lecture `REACT_OFFICIAL_FRONTEND` | dynamique (RX1) | inchangé — le flag est **injecté par le script**, pas par le `.env` |
| Express `/app` `/manager` | SPA servies (RX1) | inchangé — Option A (Express sert les builds) |

## 2. Décision officielle
- **`npm run dev`** = LA commande de développement : préflight env → build React si absent → URLs → `nodemon`
  backend **React ON**. Le flag n'est plus une étape mentale.
- **Déploiement** = `npm install && npm run build && npm start` → **React ON automatiquement** (aucun `.env`,
  aucun flag manuel).
- **Rollback** explicite : `npm run dev:vanilla` (local) / `npm run start:vanilla` (prod).
- **Hot reload React** (optionnel) : `npm run dev:vite` (Vite dev vitrine).

## 3. Choix dev server — Option A (parité déploiement)
`npm run dev` **build** React puis Express sert `/app` `/manager` — **même comportement qu'en prod** (pas de
proxy Vite/dev différent, moins de surprises). Vite dev conservé en option (`dev:vite`) pour le hot reload
React. Build auto seulement si `dist` absent (redémarrages rapides ; rebuild manuel via `npm run build`).

## 4. Set de commandes officiel (final)
| Commande | Rôle | Flag React |
|---|---|---|
| `npm run dev` | Développement (backend nodemon + React servi) | **ON** (injecté) |
| `npm run dev:vanilla` | Dev en rollback Vanilla | OFF (injecté) |
| `npm run dev:vite` | Hot reload React (Vite vitrine) | — |
| `npm run build` | Build des SPA React (dev + deploy) | — |
| `npm start` | Boot déploiement (mono-process) | **ON** (injecté) |
| `npm run start:vanilla` | Rollback prod | OFF (injecté) |
| `npm run check` | Préflight OFFLINE (env, vault, builds) | — |
| `npm run verify` | Smoke HTTP (serveur lancé) | — |
Internes conservés : `clean-port`, `react:build/test/lint`, `react:dev:*`, `test*`, `audit:*`.

## 5. Contraintes scripts (`scripts/run/`)
Lisibles ; **jamais de secret loggé** ; échec = message clair + exit≠0 ; **ne modifient jamais le `.env`**
(injection via `process.env`/spawn) ; **aucune mutation DB** (les seeds restent au boot / scripts `seed*`) ;
cross-platform (Windows + macOS/Linux via `spawn(..., { shell:true })`). `cross-env` & `nodemon` déjà présents.

## 6. Préflight `dev` (léger, pas de test long)
Vérifie env obligatoires (`MONGODB_URI`/`SESSION_SECRET`/`PWD_PEPPER`/`CREDENTIAL_VAULT_KEY`) + format vault ;
build React auto si `dist` absent ; `frontend-react` présent (implicite via le build). Pas de suite de tests à
chaque `dev`.

## 7. Limites
- `dev` (Option A) sert les **builds** : pour le hot reload React, utiliser `dev:vite`.
- Docs partagées (`architecture.md`, `projectContext.json`) non modifiées ici (territoire concurrent RX3) →
  contenu consigné dans ce doc + le rapport ; `RX_RUN_LAUNCH_GUIDE.md` et `tests/README.md` mis à jour.
