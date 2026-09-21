# Rapport — Unification des runtimes & vitrine garantie au commit publié

> Chantier du 2026-07-23 sur `feat/unified-production-baseline`.
> **Post-scriptum (même jour)** : le worktree « SB Auto 06 -- deployment-engine »
> mentionné ci-dessous a été SUPPRIMÉ ; le dossier canonique unique est désormais
> `SB Auto 06` (branche `feat/unified-production-baseline` réattachée, médias
> runtime fusionnés). Les mentions ci-dessous sont l'état historique du chantier.
> Commits : `852e560` (vitrine), `2e9f3e6` (runtime), `f3deb6a` (déploiement) —
> côté worktree déprécié `feat/brevo` : `cf30437` (archive), `f094db4` (verrou).

---

## Rapport 1 — Architecture finale des ports

Il n'existe plus qu'UN runtime officiel, lancé depuis la racine du worktree
canonique (`SB Auto 06 -- deployment-engine`) :

| Commande (racine)   | Service | Port | Détail |
|---------------------|---------|------|--------|
| `npm run dev`       | les 3   | 6070 · 6071 · 6062 | `scripts/dev-canonical.mjs` : bannière branche/commit, refus si port occupé, détection 6060/6061, healthchecks post-démarrage |
| `npm run backend`   | backend | 6070 | `PORT` du `.env` (désormais 6070) |
| `npm run manager`   | manager | 6071 | Vite `--port 6071`, proxy `/api`+`/uploads` → 6070 |
| `npm run vitrine`   | vitrine | 6062 | Vite `--port 6062`, proxy → 6070 |
| `npm test`          | —       | —    | backend + manager + vitrine |

Modèle réseau : **même origine** (proxy Vite). `VITE_API_URL` ne doit pas être
défini en local ; les `.env.example` des fronts le laissent commenté.
Les ports **6060/6061 sont morts** : plus aucun chemin de lancement n'y mène.

## Rapport 2 — Pourquoi 6061 existait encore

Le manager 6061 n'était pas un « vieux script » de la branche canonique : c'était
**un second worktree complet** — `SB Auto 06` (branche `feat/brevo`), avec son
propre `manager/vite.config.ts` (`port: 6061`, proxy → 6060) et son
`backend/.env` (`PORT=6060`). Les deux worktrees coexistaient sur le disque ;
selon le dossier ouvert dans l'éditeur/terminal, `npm run dev` tombait sur l'un
ou l'autre. Aggravant : les DEUX vitrines partageaient le port 6062 — la
première démarrée gagnait, d'où des vitrines « fantômes » d'une autre branche.

## Rapport 3 — Pourquoi `npm run dev` ne démarrait plus le 6071

Trois causes cumulées, toutes factuelles :

1. **Aucun `package.json` racine** n'existait : `npm run dev` à la racine
   échouait, et chacun le lançait depuis un sous-dossier (`manager/`,
   `backend/`…) — le résultat dépendait du dossier ET du worktree courant.
2. Le terminal/éditeur était ouvert dans l'**ancien worktree** (`SB Auto 06`,
   `feat/brevo`) : `npm run dev` y démarrait mécaniquement le manager 6061.
3. Le seul lanceur canonique (`node scripts/dev-canonical.mjs`) n'était **pas un
   script npm** : rien n'empêchait de l'oublier.

## Rapport 4 — Correction effectuée (runtime)

- `package.json` **racine** créé : `npm run dev` = `scripts/dev-canonical.mjs`
  (seule voie officielle), + `backend`/`manager`/`vitrine`/`test`/`build`.
- Alignement 6070/6071/6062 partout : `backend/.env` et `.env.example`
  (`PORT=6070`, `CORS_ORIGINS=6071,6062`, `PUBLIC_URL=6070`),
  `NETWORK_DEFAULTS` (`constants.js`), README, docs vivantes (API, webhooks,
  Stripe CLI, duplication, workflow canonique).
- **Ancien worktree verrouillé** : sur `feat/brevo`, tout le travail non commité
  a d'abord été archivé (`cf30437` — rien n'est perdu), puis les scripts
  `dev`/`dev:app`/`start`/`preview` des trois apps ont été remplacés par
  `DEPRECATED.cjs` (message explicite + `exit 1`, vérifié). Un nouveau
  développeur **ne peut plus** démarrer un serveur 6060/6061.

## Rapport 5 — Cause exacte de la « vitrine obsolète »

Le pipeline n'a **pas trahi** : la divergence apparaissait **à la toute première
étape (Source Git)**, plus deux aggravants côté cache :

1. **Cause racine** : la refonte vitrine (ServicesShowcase, Navbar, pages…)
   datée du 20/07 était restée **non commitée** dans l'ancien worktree
   `feat/brevo`. La fusion canonique du 22/07 n'a embarqué que le commité. La
   PROD servait donc fidèlement un commit qui ne contenait pas la refonte — le
   manager, lui, paraissait « à jour » car ses évolutions étaient commitées, et
   `/api/version` (manifeste backend) confirmait à tort la fraîcheur.
2. **Aggravant cache** (corrigé au commit `fed74e8`, effectif au prochain
   déploiement) : `index.html` était servi **sans `Cache-Control`** → cache
   heuristique navigateur → ancien index → anciens assets.
3. **Aggravant purge** : l'upload SFTP écrasait fichier par fichier **sans
   jamais supprimer** ; les vieux `/assets/*.js` (servis `immutable` 1 an)
   restaient en ligne et maintenaient un vieil index en vie.

## Rapport 6 — Correction (vitrine au commit publié)

- Refonte vitrine **portée et commitée** sur la canonique (`852e560`) ; build
  Vite + `tsc -b` + 68 tests vitrine verts.
- **Publication atomique** (`f3deb6a`) : dist vitrine/manager uploadés vers
  `<root>.next` puis basculés par `mv` (ancien conservé en `.prev`) → purge des
  assets périmés, plus de mélange index/assets entre versions.
- **Garde d'artefact durcie**, AVANT le finalize (étape `validate`) :
  - `sha256(index.html servi) == sha256(index.html construit)` ;
  - JS d'entrée référencé + `sha256` identiques ;
  - **`/version.json` servie == commit du manifeste construit** (absente ou
    divergente ⇒ échec) ;
  - divergence ⇒ **`WEBSITE_ARTIFACT_MISMATCH`** (déploiement en échec) ;
  - empreinte manquante en PROD ⇒ **`WEBSITE_FINGERPRINT_MISSING`**
    (fail-closed : plus de contrôle « skipped » silencieux).
- Cache (LOT 6, audité) : `index.html`/`version.json`/`build-manifest.json` en
  `no-cache`, assets `immutable 1y`, **aucun service worker** dans la vitrine,
  pas de CDN. La correction est applicative (headers + purge) — pas de CTRL+F5
  demandé à l'utilisateur.

## Rapport 7 — Tests ajoutés

- **`runtime-canonical.test.js`** (27 checks, câblé dans `npm test` backend) :
  `npm run dev` racine → dev-canonical ; `manager`/`vitrine` → 6071/6062 ;
  vite.configs → proxy 6070 sans trace de 6060/6061 ; `.env.example` en régime
  6070 ; `VITE_API_URL` non actif ; `NETWORK_DEFAULTS` canoniques ; README sain.
- **`deployment-engine.test.js`** étendu (105 ✓) : upload vers `.next`, bascule
  `mv` atomique, purge `.prev`, `version.json` comparée au manifeste, artefact
  servi == construit.
- **`website-artifact.test.js`** étendu (19 ✓) : `version.json` identique → ok ;
  divergente → mismatch ; absente → mismatch.
- Suites `deployment-report` (64 ✓), `deployment-session` (12 ✓),
  `runtime-config` (23 ✓), `duplication` (33 ✓), manager (9 suites ✓),
  vitrine (68 ✓ + `tsc -b`).

## Rapport 8 — Validation finale

- Ancien worktree : `npm run dev` (manager) **refuse** avec le message de
  dépréciation (vérifié en conditions réelles).
- Worktree canonique : arbre **propre**, 3 commits ; `npm run dev` racine expose
  la seule voie officielle ; suite de tests complète exécutée (résultat en fin
  de session).
- Au prochain déploiement : Manager, Vitrine et API portent le **même commit**
  (manifeste embarqué), et le moteur **échoue** si le site servi ne correspond
  pas bit pour bit au build — il n'existe plus de « déploiement réussi » avec
  une vitrine restée en arrière.
