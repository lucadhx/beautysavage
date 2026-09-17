# RX-RUN-2 — Rapport « une seule commande »

> Cadrage : [`RX_RUN_2_ONE_COMMAND_AUDIT.md`](RX_RUN_2_ONE_COMMAND_AUDIT.md). Aucune feature, aucune refonte.
> Le `.env` n'est jamais modifié ; le flag React est injecté par les scripts.

## En une phrase
```bash
# Pour travailler :
npm run dev
# Pour déployer :
npm install && npm run build && npm start
```
Dans les deux cas, **React est officiel (ON) automatiquement**, sans toucher au `.env`.

## Commande officielle
`npm run dev` :
1. Préflight env (obligatoires + format vault) — échec = message clair.
2. Build React si `dist` absent (Option A : Express sert `/app` `/manager`).
3. Affiche les URLs : `/app`, `/manager`, `/api/site-status`.
4. Lance le backend en watch (`nodemon`) avec `REACT_OFFICIAL_FRONTEND` injecté = ON.

## Scripts créés / modifiés
- **Créés** `scripts/run/` : `lib.js` (helpers purs : `reactFlagFor`, `envWithReactFlag`, `launchUrls`,
  `banner`), `preflight.js` (env + builds, réutilise l'évaluateur RX-RUN), `build.js`, `dev.js`, `start.js`.
- **Modifié** `package.json` : set officiel `dev`, `dev:vanilla`, `dev:vite`, `build`, `start`,
  `start:vanilla`, `check`, `verify` (+ `predev`=clean-port). **Supprimés** : `canary:build/up`, `vanilla:up`,
  `check:launch[:canary]`, `verify:parcours` (fusionnés) et **`scripts/launchCanary.js`/`launchVanilla.js`**
  (remplacés par `run/start.js --vanilla`).
- **Conservés internes** : `checkLaunchReadiness.js` (→ `check`), `verifyParcours.js` (→ `verify`).

## Comportements
| Scénario | Commande | Effet |
|---|---|---|
| Développement | `npm run dev` | backend nodemon + React ON + URLs ; build auto si absent |
| Dev rollback | `npm run dev:vanilla` | idem, React OFF |
| Hot reload React | `npm run dev:vite` | Vite dev vitrine (optionnel) |
| Build | `npm run build` | build vitrine + manager (préflight env) |
| Déploiement | `npm start` | boot mono-process, React ON (dist requis) |
| Rollback prod | `npm run start:vanilla` | boot mono-process, React OFF |
| Préflight | `npm run check` | env/vault/builds (offline) |
| Vérif | `npm run verify [url]` | smoke HTTP (serveur lancé) |

## Déploiement sans changement manuel
`npm install` → `npm run build` → `npm start`. Si l'hébergeur impose `npm start`, celui-ci **est** le mode
React officiel. Aucun `.env` à modifier, aucun flag à basculer, aucune commande spéciale à retenir. Rollback =
`npm run start:vanilla` (ou repasser le flag OFF).

## Vérifications
- **Tests** : `tests/p1/rxRunOneCommandScripts.test.js` (9) + `rxRunLaunchReadiness.test.js` (5) = **14 verts**
  (injection flag ON/OFF, env non muté, URLs, `build` inclut React, aucun script n'écrit le `.env`, anciennes
  commandes supprimées). Suite backend complète relancée (scripts non importés par l'app → sans impact runtime).
- **`node --check`** OK sur les 5 scripts `run/` ; `npm run check` exécuté (« Prêt à lancer »).
- **Secret scan** : aucun secret réel.
- **Non exécuté en CI** : `dev`/`start` (bootent l'app réelle + build) — validés par tests unitaires + revue.

## Limites
- `dev` sert les builds (Option A) : hot reload React = `dev:vite`.
- `architecture.md`/`projectContext.json` non modifiés (concurrent RX3) → à réconcilier ; `RX_RUN_LAUNCH_GUIDE.md`
  et `tests/README.md` mis à jour.
- `prestart`/`predev` appellent `clean-port` (libère le port avant boot) — sans effet en conteneur à port dédié.
