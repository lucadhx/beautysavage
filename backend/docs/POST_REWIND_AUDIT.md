# POST-REWIND AUDIT — État des lieux complet

> Audit **lecture seule** du dépôt après l'incident Git (worktree) + le « Rewind code to here ».
> Aucune modification de code, aucun commit, aucun push. Constats factuels ancrés sur le code actuel
> (branche `phase-0-security-baseline`, HEAD `0e1d861`).
> Date de l'audit : 2026-07-22.

---

## 0. Résumé exécutif

**Le rewind a été un succès quasi total.** Tout le travail concurrent qu'on croyait perdu (FAQ,
Gallery, Home, Reviews, Finance, Services, Catalogue) est **présent et fonctionnel** dans l'arbre de
travail. Le système d'évaluation/certification des formations (commité en `0e1d861`) est **présent**.
Le build passe (`react:build` ✅), les tests sont cohérents (240 backend + 136 frontend, aucun import
cassé au sens statique), `test:training` = **32/32** ✅.

**Un seul écart réel, non critique et facile à corriger :** le **câblage manager de l'évaluation**
(route `/resultats`, entrée de menu « Résultats », onglets Questionnaire/Rendus dans l'éditeur de
formation, export du barrel api-client) existe dans le **commit HEAD `0e1d861`** mais a été **revenu à
une version antérieure dans l'ARBRE DE TRAVAIL** par le rewind. Les fichiers de fonctionnalité
(`results/`, `EvaluationEditor.tsx`, `evaluation.ts`) sont **tous présents** — il s'agit d'un **re-câblage**
(≈30 min), **pas** d'une réimplémentation.

**Point de vigilance :** ~60 fichiers de travail concurrent + 8 fichiers non suivis sont restaurés
mais **non commités**. Tant qu'ils ne sont pas commités, un nouvel incident les remettrait en danger.

| Verdict global | État |
|---|---|
| Build (`react:build`) | ✅ Vert (les 2 apps) |
| Backend | ✅ Intact |
| Communication Center (Lots 1 & 2) | ✅ Présent, aucune régression |
| Évaluation/Certification (backend + comms + client) | ✅ Présent & câblé |
| Évaluation — UI **manager** | ⚠️ Fichiers présents mais **non câblés** dans l'arbre de travail (câblage en HEAD) |
| FAQ / Gallery / Reviews / Home / Catalogue / Finance / Services | ✅ Complètes |
| Tests (cohérence) | ✅ 240 backend + 136 frontend, sans import cassé |
| Docs `architecture.md` / `projectContext.json` | ⚠️ Stale vis-à-vis de l'évaluation (0 mention) |
| Travail concurrent restauré | ⚠️ Présent mais **non commité** |

---

## 1. État global du projet

- **Git** : branche `phase-0-security-baseline`, HEAD = `0e1d861` (« Implement complete training
  evaluation and certification system »). Historique récent : `96f62a7` (comm lot 2), `27a0f66` (comm
  lot 1), `6ad951c`, `0459cab`, `0a81182`.
- **Arbre de travail** : 60 fichiers avec un vrai diff de contenu vs HEAD (le travail concurrent
  restauré) + **8 fichiers non suivis** restaurés :
  `frontend-react/apps/manager/src/features/catalogue/CatalogueGalleryEditor.tsx`,
  `.../features/faq/`, `.../features/reviews/Dropdown.tsx`,
  `apps/vitrine/src/features/trainingDetail/TrainingFaq.tsx`,
  `packages/api-client/src/manager/homeSettings.ts`, `packages/ui/src/dropdown.tsx`,
  `packages/ui/src/reviewCarousel.tsx`, `services/faq/`.
- **Inventaire backend** : 71 modèles · 55 contrôleurs · 62 routers · 45 services (top) + 13 dossiers
  services · 14 jobs `automatisme/` · 64 montages `/api` dans `app.js`.
- **Inventaire frontend** : apps `manager` + `vitrine`, packages `@bs/ui`, `@bs/api-client`, `@bs/auth`,
  `@bs/config`. Features manager : catalogue, communication, customer360, devPanel, **faq**, finance,
  giftCardLibrary, giftCardTemplates, learning, mailTemplates, managerUsers, notificationTemplates,
  notifications, planning, **results**, **reviews**, systemSettings, theme, themeStudio. Features
  vitrine : account, auth, booking, cart, catalog, checkout, **evaluation**, giftcard, home, learning,
  legal, serviceDetail, theme, tokenizedFlows, trainingDetail.
- **Tests** : `tests/p0` (14) · `tests/p1` (222) · `tests/integration` (2) · `tests/audit` (2) ·
  helpers `tests/setup`. Frontend : 136 fichiers `*.test.ts(x)`.
- **Docs** : 52 fichiers dans `docs/`.

---

## 2. Fonctionnalités restaurées par le rewind

Toutes vérifiées présentes ET câblées (fichiers sur disque + imports/exports/routes).

| Zone | État | Preuve synthétique |
|---|---|---|
| **FAQ** | ✅ Complète | `features/faq/` (routé `App.tsx`), `ServiceFaq`/`HomeFaq`/`TrainingFaq`, `services/faq/faqSanitizer.js` (4 contrôleurs), champs `faq` sur Formation/Service/HomePageSettings |
| **Gallery** | ✅ Complète | `catalogue/CatalogueGalleryEditor.tsx` (importé par Service/Training Editor), `@bs/ui gallery.tsx`, stockage `photos[]` sur Formation/Service |
| **Reviews** | ✅ Complète | manager `reviews/` (+ `Dropdown.tsx`), vitrine `ServiceReviews`/`TrainingReviews`/`HomeReviews`, `@bs/ui reviewCarousel.tsx`, `reviewModerationController`, `models/Review.js`, `services/reviews/` |
| **Home** | ✅ Complète | `home/` (HomeCarousel/HomeFaq/HomeHero/HomeReviews/HomeWhy), `@bs/ui dropdown.tsx`, `HomePageSettings`, `homeSettingsController/Router` (monté `/api/gestion/home-settings`), `manager/homeSettings.ts` (exporté) |
| **Catalogue** | ✅ Complète | `catalogue/` (TrainingEditor, ServiceEditor, learning/…), `formationRouter`/`formationGestionController`, `models/Formation.js`/`Service.js`, `manager/catalogue.ts` |
| **Finance** | ✅ Complète | `finance/` (~35 fichiers), `services/finance/*`, `financeController/Router`, commissions, gift-card finance |
| **Boutique / Services** | ✅ Complète | vitrine `serviceDetail/` complet, `ServicesPage`/`ServiceDetailPage`, `serviceController`/`vitrineShopController` |

**Aucune régression** détectée sur ces zones.

---

## 3. Fonctionnalités encore « perdues » / non recâblées

**Rien n'est définitivement perdu.** Le seul écart est un **re-câblage manager** de l'évaluation, dont
le code source complet existe (dans HEAD `0e1d861` + fichiers de feature présents). Classement :

### Critique — Câblage UI manager de l'évaluation (présent en HEAD, absent de l'arbre de travail)
Le rewind a restauré des versions **antérieures** de 4 fichiers partagés, supprimant le câblage
évaluation que j'avais ajouté (le câblage reste dans le commit HEAD `0e1d861`). Divergence exacte
(HEAD → arbre de travail) :

| Fichier | HEAD `0e1d861` | Arbre de travail |
|---|---|---|
| `packages/api-client/src/manager/index.ts` | `export * from './evaluations'` | **absent** → symboles `@bs/api-client` orphelins |
| `apps/manager/src/App.tsx` | route `/resultats` + import `features/results` | **absent** |
| `apps/manager/src/layouts/ManagerLayout.tsx` | entrée nav « Résultats » | **absent** |
| `apps/manager/src/features/catalogue/TrainingEditor.tsx` | onglets Questionnaire/Rendus + `EvaluationEditor` | **absent** |

Conséquence : dans l'arbre de travail actuel, la **console Résultats** et les **onglets d'édition**
sont **injoignables** ; l'api-client manager évaluation est **orphelin** (`useResults.ts`/`useEvaluation.ts`
importent des symboles non ré-exportés). Le build passe malgré tout car `manager/build = vite build`
(sans `tsc`) et `results/` n'est routé nulle part → non compilé.

**Aucun fichier de fonctionnalité manquant** : `results/{pages,useResults,index,css}.tsx`,
`catalogue/learning/{EvaluationEditor,useEvaluation,evaluation.css}`, `manager/evaluations.ts`,
`catalog/evaluation.ts` sont **tous présents** sur disque.

### Importante — Travail concurrent non commité
Les 60 fichiers modifiés + 8 non suivis (FAQ/Gallery/etc.) sont **restaurés mais pas commités**. Tant
qu'ils restent dans l'arbre de travail seulement, ils sont exposés à un nouvel incident.

### Secondaire
- `features/catalogue/index.ts` ne ré-exporte pas `CatalogueGalleryEditor` (importé en direct par les
  éditeurs — fonctionne, cosmétique).
- Commentaire d'en-tête obsolète dans `packages/api-client/src/manager/mailTemplates.ts:3` (« aucun
  endpoint backend ») alors que `previewMailTemplate` délègue correctement au backend (fonctionnel).

---

## 4. Build

`npm run react:build` → **✅ SUCCÈS** (les 2 apps : `✓ built` vitrine + manager, EXIT=0).

- Aucun import cassé bloquant le build.
- Point de subtilité : le build manager est `vite build` **sans `tsc`**. Les fichiers non atteints par
  le graphe d'entrée (ex. `features/results/`, non routé dans l'arbre de travail) ne sont **pas
  typés/compilés**. C'est pourquoi l'import orphelin de `useResults.ts` (`@bs/api-client` sans
  `evaluations`) **ne casse pas** le build actuel — il casserait dès que la console Résultats serait
  recâblée sans corriger le barrel.

**Recommandation build** : lors du recâblage manager, ajouter d'abord `export * from './evaluations'`
au barrel manager, sinon le build cassera dès que `App.tsx` importera `features/results`.

---

## 5. Système Communication

**✅ Présent intégralement — aucune régression.** Vérifié pièce par pièce (Lots 1 `27a0f66` + 2 `96f62a7`) :

| Élément | État |
|---|---|
| Échappement HTML variables (`mailRenderer` `escapeHtml`/`RAW_HTML_VARIABLE_KEYS`/`maskEmail`) | ✅ |
| Routage expéditeur par rôle (`buildSenderForRole`, `fromRole:'support'` commission/incident) | ✅ |
| Envoi de test + catalogue variables backend (`/variables`, `/test-send`) | ✅ |
| Alertes Dev (`devAlertService.notifyDevAlert`, câblé webhook + gift card) | ✅ |
| `refund_completed` (config + `stripeRefundEventService`) | ✅ |
| Catalogue events +7 codes + parité débit carte cadeau | ✅ |
| Aperçu = production (`previewTemplate` + front délègue au backend) | ✅ |
| Matrice déclencheurs (`getTriggerMatrix` + page `/dev/communication/triggers` + onglet) | ✅ |
| Reset PIN + renvoi carte cadeau (`resetGiftCardPinAndResend`, `pinVersion`, `pin_reset`) | ✅ |
| Nouvelles comms (payment_failed/refund_refused/refund_failed/certificate) + scheduler rappel session | ✅ |
| Notifications avis (`review_received/published/rejected/manual`) | ✅ |
| 12 templates mail ajoutés (dont `evaluation_accepted`/`evaluation_refused`) | ✅ |
| Docs `COMMUNICATION_*` (6 fichiers) | ✅ |

---

## 6. Système Questionnaire / Évaluation

**Backend + comms + parcours client : ✅ complets & câblés. UI manager : ⚠️ construite mais non câblée
(arbre de travail).** `test:training` = **10 fichiers / 32 tests ✅**.

| Concept | Verdict | Note |
|---|---|---|
| EvaluationDefinition | Présent | modèle agrégat + service |
| Questionnaire / Sections / Questions | Présent | end-to-end (backend + client) |
| Quiz mono/multi · Vrai/Faux | Présent | scoring `evaluationScoringService` |
| Rendus · Avant/Après · Vidéos | Présent | schéma + validation + upload multer (60 Mo) |
| Attempts · Decisions · Certificates | Présent | cycle de vie + historique immuable |
| PDF · QR | Présent | pdfkit + qrcode (token opaque) |
| Notifications · Emails | Présent | config + targetService + templates + envoi rôle (PDF en PJ) |
| **Parcours client** | **Présent** | `EvaluationFlow` câblé dans `Player.tsx:151` ; barrel catalog exporte `evaluation` ; routes backend montées |
| **Résultats institut** | **Partiel** | fichiers présents mais **non câblés** : pas de route `/resultats`, pas de nav, barrel manager omet `./evaluations` (import orphelin `useResults.ts`) |
| Historique | Présent | décisions immuables + `evaluationHistory.test.js` ; le client voit ses décisions |

Détail des 4 gaps de câblage : voir §3 « Critique ».

---

## 7. État des tests

- **Backend** : 240 fichiers (`p0` 14, `p1` 222, `integration` 2, `audit` 2). **Cohérents** : spot-check
  de 5 suites clés (communicationTemplateTooling, evaluationDecision, reviewNotifications,
  evaluationAttempt, certificateGeneration) → **aucun import de symbole disparu**. Scripts
  `test:communication` (8 suites) et `test:training` (10 suites) mappent tous des fichiers réels de
  `tests/p1`. `scripts/run/runReleaseChecks.js` présent (backe `test:quick`/`release`/`rx-blocker-2`).
- **Exécutions confirmées cet audit** : `react:build` ✅ · `test:training` 32/32 ✅.
- **Frontend** : 136 fichiers (`manager` 57, `vitrine` 35, `api-client` 33, `ui` 7, `auth`/`config` 1).
  Les tests évaluation frontend (`EvaluationResultPage`, `QuestionnaireEditor`, `EvaluationFlow`)
  **mockent `@bs/api-client`** → ils passent indépendamment du gap de barrel manager (mais ne
  couvrent donc pas la régression de câblage réel).
- **Non relancé** : suite `p1` complète (~lente, 1 mongod/fichier) et `react:test` complet — non
  nécessaires pour l'audit (cohérence statique validée).

---

## 8. État de la documentation

- **`docs/`** : 52 fichiers. Communication (6 `COMMUNICATION_*`), Training (`TRAINING_EVALUATION_SYSTEM.md`,
  `TRAINING_CERTIFICATION.md`), séries RX2/RX3/RX4/RX_BLOCKER/RX_GO (audit+report), gift-card,
  `docs/migration/VANILLA_RETIREMENT_PLAN.md`.
- **Docs centrales** : `architecture.md` (~385 Ko, dernière section datée S1B 2026-06-30) et
  `projectContext.json` (~574 Ko, dates ≤ 2026-07-08). **Pas de README racine** (seul `tests/README.md`).
- **Incohérence / staleness** :
  - ⚠️ **STALE pour l'évaluation** : `architecture.md` **0** mention « evaluation »/« questionnaire »,
    `projectContext.json` **0** — alors que le sous-système existe (5 services, 4 modèles, ~12 suites
    p1, front). Documenté **uniquement** dans `docs/TRAINING_*.md`.
  - ✅ **À jour pour communication/notifications/triggers/finance** (occurrences nombreuses, cohérentes).

---

## 9. Comparaison avec les développements attendus

| Fonctionnalité | État | Commentaire |
|---|---|---|
| Communication Center | **Complète** | Lots 1 & 2 intégralement présents |
| FAQ | **Complète** | restaurée + câblée |
| Gallery | **Complète** | restaurée + câblée |
| Reviews | **Complète** | restaurée + câblée (+ modération + notifs) |
| Home | **Complète** | restaurée + câblée |
| Questionnaire de formation | **Complète (backend/client) · Partielle (UI manager non câblée)** | éditeur présent mais onglets non montés |
| Rendus | **Complète (backend/client) · Partielle (UI manager)** | idem |
| Diplômes | **Complète** | PDF + QR + envoi ; téléchargement client + institut |
| Résultats institut | **Partielle (régression de câblage)** | pages présentes, route/nav/barrel manquants (arbre de travail) |
| Notifications | **Complète** | comm + évaluation |
| Catalogue | **Complète** | — |
| Finance | **Complète** | — |

---

## 10. Dette restante (faits uniquement)

| Fonctionnalité | État | Priorité | Estimation |
|---|---|---|---|
| Recâbler l'UI manager évaluation (barrel `export evaluations`, route `/resultats`, nav « Résultats », onglets Questionnaire/Rendus dans `TrainingEditor`) | Régression de câblage (code en HEAD `0e1d861`) | **Critique** | ~30 min (re-merge des 4 points, pas de réimplémentation) |
| Commiter le travail concurrent restauré (60 fichiers + 8 non suivis : FAQ/Gallery/Home/Reviews/etc.) | Présent mais non commité (à risque) | **Importante** | ~30 min (staging + build + commit) |
| Mettre à jour `architecture.md` + `projectContext.json` pour le système évaluation/certification | Doc stale | Secondaire | ~1–2 h |
| Ré-exporter `CatalogueGalleryEditor` dans `features/catalogue/index.ts` (cohérence barrel) | Cosmétique | Secondaire | trivial |
| Corriger le commentaire d'en-tête obsolète `manager/mailTemplates.ts:3` | Cosmétique | Secondaire | trivial |

---

## 11. Recommandations pour reprendre sans refaire du travail restauré

1. **NE PAS réimplémenter** l'évaluation, la FAQ, la Gallery, les Reviews, Home, Finance, le Catalogue
   ni la Communication : tout est présent. La seule action code sur l'évaluation est un **recâblage**.

2. **Sécuriser d'abord le travail concurrent** (priorité) : commiter (staging sélectif) les 60 fichiers
   modifiés + 8 non suivis restaurés, après un `react:build` de contrôle, pour ne plus dépendre de
   l'arbre de travail seul. C'est le vrai risque résiduel après un rewind.

3. **Recâbler l'UI manager évaluation** en **fusionnant** (pas en écrasant) le câblage depuis le commit
   HEAD `0e1d861` dans les versions **actuelles** (concurrentes) des 4 fichiers :
   - `git show 0e1d861:frontend-react/apps/manager/src/App.tsx` → réappliquer l'import `results` + les
     routes `/resultats` et `/resultats/:attemptId` sur l'App.tsx actuel ;
   - idem pour l'entrée nav « Résultats » (`ManagerLayout.tsx`), les onglets Questionnaire/Rendus
     (`TrainingEditor.tsx`), et **surtout** `export * from './evaluations'` dans le barrel manager
     (`packages/api-client/src/manager/index.ts`) — à faire **en premier** pour éviter un build cassé.
   - ⚠️ Ne pas `git checkout 0e1d861 -- <fichier>` (écraserait le travail concurrent) : re-merger à la main.

4. **Vérifier après recâblage** : `npm run react:build` puis `npm run react:test` (les tests évaluation
   frontend existent) — et idéalement router `results/` pour que `vite`/`tsc` compile le module et
   révèle tout import résiduel.

5. **Mettre à jour les docs centrales** (`architecture.md`, `projectContext.json`) pour intégrer le
   système évaluation/certification (aujourd'hui documenté seulement dans `docs/TRAINING_*.md`).

6. **Post-mortem incident** : la cause racine documentée est un `git worktree remove --force` sur un
   worktree jetable dont `node_modules` était symlinké vers le dépôt principal, suivi d'un
   `git checkout-index -a -f`. Règles : ne jamais symlinker `node_modules` vers le repo principal dans
   un worktree jetable ; ne jamais `checkout-index -a -f` (écrase les modifs non stagées) ; committer
   fréquemment le travail concurrent.

---

## Annexe — Commandes de vérification exécutées (lecture seule)

- `git log --oneline` · `git status` · `git diff --ignore-all-space HEAD --name-only` · `git show HEAD:<file>`
- `npm run react:build` → ✅ · `npm run test:training` → ✅ 32/32
- Inventaires `ls`/`grep` backend + frontend (modèles, routers, services, tests, docs).

*Fin de l'audit. Aucune modification de code effectuée ; seul ce fichier a été créé.*
