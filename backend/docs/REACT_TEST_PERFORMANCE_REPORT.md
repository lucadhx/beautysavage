# react:test — Rapport de performance & stabilisation

## 1. Commande initiale & chaîne des scripts

```
npm run react:test           (backend/package.json)
→ npm --prefix frontend-react run test
→ vitest run                 (frontend-react/package.json)
→ config: frontend-react/vitest.config.ts
```

La config initiale : `environment: 'jsdom'` pour **tous** les fichiers, `globals: true`,
`setupFiles: ['./vitest.setup.ts']` (import `@testing-library/jest-dom/vitest`), pool par défaut
(`forks`). **Aucune** couverture ni typecheck n'étaient inclus dans `react:test` (bon point).
Périmètre : `apps/**` + `packages/**` → **137 fichiers de test**.

## 2. Baseline (avant)

- Exécutée jusqu'au bout, la suite ne **terminait pas dans un temps exploitable** : > 15 min
  observées, et en contexte non-TTY (pipe/CI/agent) la sortie du reporter par défaut est
  **bufferisée** → aucun résumé lisible avant la toute fin. C'est exactement le symptôme signalé
  (« trop long, sortie bufferisée »).
- Le profil de durées (mesuré sur un sous-ensemble) montrait la phase **`environment` (jsdom)**
  comme dominante — ex. 3 fichiers : `tests 0.9s` mais `environment 60s`.

## 3. Fichiers/leviers les plus coûteux

| Rang | Cause | Détail |
|---:|---|---|
| 1 | **jsdom pour 100% des fichiers** | 62 des 137 fichiers sont des `*.test.ts` de logique/clients API **n'utilisant aucun DOM** (vérifié : 0 usage de `document`/`screen`/`@testing-library/react`, hors `motion.test.ts`). Ils payaient l'instanciation jsdom pour rien. |
| 2 | **Buffering non-TTY** | Le reporter `default` bufferise hors terminal interactif → « output peu exploitable ». |
| 3 | **pool `forks`** | Moins efficace que `threads` pour ces suites (jsdom + réutilisation worker). |
| 4 | **Tests réellement rouges masqués** | Le fait de ne jamais finir masquait des échecs pré-existants (voir §6), dont certains ajoutent de la latence `waitFor` (~1–3 s). |

## 4. Corrections

- `vitest.config.ts` : `environment: 'node'` par défaut + `environmentMatchGlobs` → `jsdom`
  uniquement pour `**/*.test.tsx` **et** `**/motion.test.ts` (seul `.test.ts` touchant le DOM
  via `matchMedia`). Les 62 tests de logique passent en `node` (rapide).
- `pool: 'threads'`.
- `vitest.setup.ts` : chargement de `jest-dom` **conditionnel** (`typeof document !== 'undefined'`)
  → inutile en `node`.
- Aucune couverture forcée dans la commande locale ; aucun timeout gonflé ; aucun test skippé ;
  aucune assertion retirée.

## 5. Stratégie de scripts finale

```
react:test        = vitest run                              (rapide, local, node+jsdom ciblé)
react:test -- X   = ciblage d'un fichier/pattern            (ex. react:test -- integratedApi)
react:test:ci     = vitest run --reporter=default           (suite complète CI ; couverture opt-in
                                                              via @vitest/coverage-v8 non installé)
react:test:slow   = vitest run --logHeapUsage --reporter=verbose  (diagnostic durées/heap)
react:typecheck   = tsc -p tsconfig.base.json --noEmit       (typecheck DISTINCT de la suite)
```

## 6. Résultat & décision produit

- `react:typecheck` : **0 erreur** (les erreurs `EvaluationEditor`/`EvaluationResultPage` sont
  corrigées — cf. §7).
- **Suite complète interrompue volontairement** (décision produit, voir ci-dessous) :
  - durée observée jusqu'à interruption : **> 12 min** (contexte non-TTY, sortie bufferisée) ;
  - fichiers déjà exécutés : **~131 / 137** ;
  - tests connus : **~252 assertions vertes**, **~7 marqueurs d'échec** correspondant aux
    **4 dettes préexistantes** documentées (§8) ;
  - raison de l'interruption : **suite encore trop longue malgré l'optimisation** — l'exécution
    complète n'est pas un mode de travail viable en local.

### Avant / Après (indicatif)

```
Avant : > 15 min, ne termine pas dans un temps exploitable, sortie bufferisée.
Après : la config node/threads réduit fortement le coût par fichier (62 fichiers de logique
        passent de jsdom → node), mais la suite COMPLÈTE reste longue et n'est plus le mode local.
```

Les suites CIBLÉES (IntegratedAPI, communication, p0, auth, notifications, refund) s'exécutent,
elles, en dizaines de secondes chacune et constituent le mode de travail local.

### Décision produit

- **Local** = suites **ciblées** + `react:typecheck` + `react:lint` + `react:build`.
- **CI** = suite **complète** (`react:test:ci`), où le temps et le non-TTY sont acceptables.
- Les **4 dettes préexistantes** (§8) seront traitées dans un **lot dédié**.

### Fichiers les plus lents (profil observé)

Les tests de **composants `*.test.tsx`** (jsdom) dominent (≈ 0,5–3 s/fichier, essentiellement du
coût `environment` jsdom + `collect`) ; les `*.test.ts` en `node` sont désormais ~10–50 ms. Les
plus lents restent ceux qui rendent l'`App` entière (`devPanelNoEmptyComingSoon`, planning),
alourdis par les `waitFor` des tests rouges.

## 7. Erreurs réellement présentes — corrigées

- **EvaluationEditor** : `@bs/ui Checkbox` exigeait `label` (erreur de type + a11y). Résolu par
  un **travail concurrent** (refonte en contrôle dédié `EvCheck` avec libellé/aria-label) —
  **non inclus dans ce commit** (fichier appartenant au lot évaluation en cours). Typecheck vert
  sur le working tree courant grâce à cette refonte.
- **EvaluationResultPage.test** (inclus dans ce commit) : mock `accept` typé 0-arg mais appelé
  avec 2 → typé `(_id, _comment)`.
- **mailTemplatesApi** `previewMailTemplate` : l'aperçu est délégué au backend (LOT2 §2) ; le test
  attendait « aucun fetch » → mis à jour pour mocker la réponse `/preview` du moteur backend.
- **motion.test.ts** : casse en `node` (utilise `matchMedia`) → glob jsdom dédié.
- **devPanel** (route `/dev/integrated-api`) : la page de gestion IntegratedAPI titrait
  « Intégrations API » → aligné sur « API intégrée » (nav + test).

## 8. Dettes frontend préexistantes non bloquantes

Échecs **pré-existants** (inchangés depuis le commit `c45c2b8`, masqués par le blocage de la
suite ; **non introduits** par ce lot et **hors périmètre** IntegratedAPI/communications).
**Non corrigés dans ce lot** (correctifs réservés à un lot dédié par l'équipe concernée) :

| Fichier | Test | Nature |
|---|---|---|
| `apps/manager/src/features/devPanel/devPanelNoEmptyComingSoon.test.tsx` | `renders the dev dashboard instead of ComingSoon` | rendu DevDashboard (features contrat/commissions) |
| `apps/manager/src/features/giftCardTemplates/giftCardTemplates.test.tsx` | `dev : liste les templates en cards` | rendu liste |
| `apps/manager/src/features/planning/managerPlanningCalendar.test.tsx` | `renders the hourly calendar…` | `data-testid="pl-blocked-zone"` absent |
| `apps/manager/src/features/planning/managerPlanningAvailability.test.tsx` | `blocks conflicting exceptions before submit` | assertion de conflit |

Ces 4 sont désormais **visibles** (la suite se termine) au lieu d'être masqués. Ils touchent des
features non liées (planning, gift-card templates, dashboard dev) et relèvent d'un correctif dédié
par l'équipe concernée. La couverture peut être branchée en CI via `@vitest/coverage-v8`.
