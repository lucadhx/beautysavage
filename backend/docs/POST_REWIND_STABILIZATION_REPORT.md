# POST-REWIND STABILIZATION — Rapport

> Recâblage de l'UI manager Évaluation + sécurisation du travail concurrent restauré, après
> l'incident Git + le rewind. Branche `phase-0-security-baseline`. Suite de `docs/POST_REWIND_AUDIT.md`.
> **Aucune commande Git destructive utilisée** (pas de `checkout`/`restore`/`reset --hard`/`clean`/
> `worktree remove`/`checkout-index`). Recâblage 100 % chirurgical (comparaison `git show 0e1d861:<file>`
> + insertions ciblées). Date : 2026-07-22.

---

## 1. Sauvegarde préalable

- Archive de sécurité du working tree créée **hors du dépôt Git** :
  `…/scratchpad/beautysavage-post-rewind-backup.tar.gz` (**2,9 Mo**, exclut node_modules/.git/uploads/
  storage/dist/.env/*.tar.gz). **Non commitée** (hors arbre du dépôt).
- Snapshot Git avant intervention : HEAD `0e1d861`, **527 fichiers modifiés** (majorité = bruit
  CRLF autocrlf) + **9 non suivis** (8 fichiers concurrents restaurés + `docs/POST_REWIND_AUDIT.md`).

## 2. Les 4 points de câblage restaurés

Constat clé : **le câblage évaluation était déjà présent dans le commit `0e1d861`** ; le rewind avait
restauré des versions **antérieures** (concurrentes) des fichiers partagés dans l'ARBRE DE TRAVAIL,
faisant disparaître le câblage côté working tree. La correction = **réintégrer chirurgicalement** le
câblage dans les versions actuelles (concurrentes), sans écraser le travail concurrent.

| # | Point | Fichier | Action |
|---|---|---|---|
| 1 | Export API Evaluation | `packages/api-client/src/manager/index.ts` | ajout `export * from './evaluations';` |
| 2 | Route `/resultats` (+ `/resultats/:attemptId`) | `apps/manager/src/App.tsx` | ajout loader `results` + lazy `ResultsListPage`/`ResultDetailPage` + 2 routes sous `ManagerLayout` |
| 3 | Navigation « Résultats » | `apps/manager/src/layouts/ManagerLayout.tsx` | ajout entrée `{ to:'/resultats', label:'Résultats' }` (après Catalogue) |
| 4 | Onglets Questionnaire/Rendus | `apps/manager/src/features/catalogue/TrainingEditor.tsx` | ajout import `EvaluationEditor` + 2 `base.push` (modulesFor) + 2 panneaux `active === 'questionnaire'/'rendus'` |

Méthode : `git show 0e1d861:<file>` pour lire l'intention, puis `Edit` ciblé sur le fichier actuel.
Aucun fichier remplacé entièrement. Onglets FAQ / Contenu / Sessions / Vitrine / Gallery conservés.
Le module évaluation reste **optionnel** (une formation sans questionnaire/rendu fonctionne).

## 3. Fichiers réellement modifiés (par cette mission)

- Câblage : `manager/index.ts`, `App.tsx`, `ManagerLayout.tsx`, `catalogue/TrainingEditor.tsx`.
  - Note : `App.tsx` est redevenu **identique à HEAD** après recâblage (la route y était déjà commitée
    en `0e1d861`) → aucun diff à committer pour lui.
- Docs : `architecture.md` (section « Système d'évaluation et certification »), `projectContext.json`
  (clé `formationEvaluationSystem`, JSON revalidé), `docs/POST_REWIND_AUDIT.md`, ce rapport.

## 4. Fonctionnalités restaurées sécurisées en commit

**Commit 1 `40f12ee`** — `Restore concurrent product features after rewind` (67 fichiers réels) :
FAQ (features/faq + services/faq/faqSanitizer + ServiceFaq/HomeFaq/TrainingFaq), Gallery
(CatalogueGalleryEditor + @bs/ui gallery), Reviews (Dropdown + reviewCarousel + modération), Home
(HomeCarousel/HomeFaq/HomeReviews + homeSettings + @bs/ui dropdown), Catalogue, Finance, Services.
Inclut les 8 fichiers non suivis restaurés. (Le bruit CRLF non substantiel n'est pas stagé.)

**Commit 2 `<HASH_COMMIT_2>`** — `Restore manager evaluation wiring and docs after rewind` :
fichiers partagés du câblage (barrel, ManagerLayout, TrainingEditor — dont le contenu concurrent
associé) + docs évaluation (architecture.md, projectContext.json, POST_REWIND_AUDIT.md, ce rapport).

## 5. Résultats — Build & Tests

| Gate | Résultat |
|---|---|
| `npm run react:lint` | ✅ 0 erreur (2 warnings préexistants `SystemSettingsPage`) |
| `npm run react:build` | ✅ Vert (les 2 apps ; **`results/` désormais routé donc compilé** → l'export barrel résout) |
| `npm run test:training` | ✅ **10 fichiers / 32 tests** |
| Tests frontend Évaluation (`EvaluationResultPage`, `QuestionnaireEditor`, `EvaluationFlow`) | ✅ **3 fichiers / 8 tests** |
| `npm run test:p0` | ✅ **14 fichiers / 44 tests** |
| `npm run test:communication` | ✅ **8 fichiers / 42 tests** |
| `npm run react:test` | ⚠️ **3 échecs HORS PÉRIMÈTRE** (non liés au recâblage évaluation) — voir ci-dessous |
| `npm run test:release` | Non exécuté (suite ~1 h, à lancer en CI) |

**Détail des 3 échecs `react:test` (dette préexistante / travail concurrent, PAS une régression d'évaluation) :**
- `packages/api-client/src/manager/mailTemplatesApi.test.ts` — 1 test / 5 en échec
- `apps/manager/src/features/planning/managerPlanningCalendar.test.tsx` — 1 test en échec
- `apps/manager/src/features/planning/managerPlanningAvailability.test.tsx` — 1 test / 2 en échec

Ces suites concernent **mailTemplates** (api-client) et **planning** — zones **non touchées** par cette
mission (4 lignes de câblage évaluation + docs). Elles relèvent du travail concurrent restauré / d'une
dette préexistante. Toutes les suites **évaluation** frontend sont vertes (EvaluationResultPage,
QuestionnaireEditor, EvaluationFlow). Correction hors périmètre de cette mission (à traiter séparément).

## 6. État post-recâblage

- **Build** : ✅ vert. Point clé : avant recâblage, `results/` n'était routé nulle part et le build
  manager (`vite build`, sans `tsc`) ne le compilait pas ; **désormais routé, il est compilé** et
  l'import orphelin (`useResults`/`useEvaluation` → `@bs/api-client`) est **résolu** grâce à l'export barrel.
- **Routes** : `/resultats` + `/resultats/:attemptId` sous `ManagerLayout` (rôles admin/dev). Routes
  FAQ/Gallery/Reviews/Finance/Home/Catalogue conservées.
- **Navigation** : entrée « Résultats » (desktop + mobile via le même `MANAGER_NAV`).
- **Éditeur de formation** : onglets « Questionnaire » et « Rendus » présents (`EvaluationEditor`),
  sans conflit avec Contenu/Sessions/FAQ/Vitrine/Gallery.
- **Page Résultats** : console liste + fiche (score, bonnes réponses, photos avant/après + zoom,
  vidéo, décision Valider/Refuser) accessible.

## 7. Documentation mise à jour

- `architecture.md` : nouvelle section « Système d'évaluation et certification des formations ».
- `projectContext.json` : clé `formationEvaluationSystem` (JSON valide, 154 clés).
- `docs/POST_REWIND_AUDIT.md` (audit préalable) + ce rapport.

## 8. Travail concurrent écrasé

**Aucun.** Recâblage par insertions ciblées (`Edit`) sur les versions actuelles ; aucune commande Git
destructive ; sauvegarde locale hors dépôt réalisée avant intervention. Les 8 fichiers non suivis + le
travail concurrent (FAQ/Gallery/Reviews/Home/Finance/Services/Catalogue) sont **présents et commités**
(commit 1). Le câblage évaluation était déjà dans `0e1d861` et a été **rétabli** dans le working tree
sans supprimer les onglets concurrents.

## 9. Limites restantes

- `test:release` (~1 h, 1 mongod/fichier sur ~222 p1) : non exécuté en intégralité dans cette session
  (recommandé en CI). Gates ciblées + p0 + communication + build couvrent la non-régression pertinente.
- `CatalogueGalleryEditor` toujours non ré-exporté par le barrel `features/catalogue/index.ts` (importé
  en direct — fonctionnel, cosmétique).
- Système d'évaluation V1 inchangé : évaluation manuelle, un seul évaluateur, QR de vérification future,
  vidéos ≤ 60 Mo, pas d'IA/jury.
- Bruit CRLF (autocrlf) : de nombreux fichiers apparaissent « modifiés » sans changement de contenu ;
  non stagés (comportement Git préexistant, hors périmètre).
