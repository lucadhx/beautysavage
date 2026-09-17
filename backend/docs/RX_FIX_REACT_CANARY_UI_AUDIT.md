# RX-FIX — Audit UI React Canary (visuel, routing, thème, mobile, console)

> Branche `phase-0-security-baseline`. **Aucune feature métier** ; audit puis correction des bugs visibles
> avant démo React Canary. Staging sélectif. Méthode : lecture directe des sources React + backend (le process
> ayant redémarré en cours, cet audit consolide les constats vérifiés).

## 0. Synthèse
| # | Sujet | Verdict | Action |
|---|---|---|---|
| 1 | **Bootstrap Icons non chargées (React)** | 🔴 **BUG bloquant confirmé** | **CORRIGÉ** (import police dans les 2 apps) |
| 2 | Thème React vitrine/panel | 🟢 OK | — (providers présents) |
| 3 | Header + burger React | 🟢 OK | — (testés) |
| 4 | Parcours réservation (drawer/calendrier) | 🟢 OK | — (AvailabilityCalendar/SlotPicker) |
| 5 | Sidebar manager mobile | 🟢 OK | — (ManagerLayout responsive, P1) |
| 6 | Manager « impossible de charger la librairie » | 🟡 **PAS un bug de rôle** | documenté (état d'erreur normal) |
| 7 | Liens `vitrine.html`/`gestion.html` dans React | 🟢 aucun | — (garde `reactGoNoVanillaLinks`) |
| 8 | Erreurs console | 🟡 warnings React Router (inoffensifs) | à revalider navigateur |

## 1. 🔴 Bootstrap Icons non chargées — bug bloquant (CORRIGÉ)
- **Bug** : toutes les icônes React (`<i className="bi bi-*">`, utilisées **partout** : header, burger, hub client,
  drawers, manager, boutons) s'affichaient en **carrés vides / rien**.
- **Cause** : la police **Bootstrap Icons n'était importée nulle part** dans les apps React. La vitrine Vanilla
  la charge via CDN (`public/*.html` → `cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3`), mais les apps React
  n'importaient que `@bs/ui/tokens.css` + `polish.css` (aucune police d'icônes).
- **Fichiers** : `frontend-react/apps/vitrine/src/main.tsx`, `apps/manager/src/main.tsx` (imports CSS) ;
  `frontend-react/package.json` (dépendance absente).
- **Impact démo** : **majeur** — chaque écran paraît cassé (icônes manquantes) sur vitrine **et** manager.
- **Correction** : ajout de la dépendance `bootstrap-icons@^1.11.3` (même version que le CDN Vanilla, parité) +
  `import 'bootstrap-icons/font/bootstrap-icons.css'` dans les **deux** `main.tsx` (après `polish.css`). Vite
  bundle la police hors-ligne (woff/woff2 émis dans `dist/assets/` — vérifié au build). **Aucun CDN au runtime**
  (fiable en canary/offline).
- **Test** : `apps/vitrine/src/reactFixIcons.test.ts` (garde : les 2 `main.tsx` importent la police + dépendance
  déclarée). Build : `bootstrap-icons-*.woff2` (130 KB) + `.woff` (176 KB) présents dans chaque `dist`.

## 2. Thème React — OK
`VitrineThemeProvider` / `PanelThemeProvider` présents (réécrivent les `--bs-*` par scope, T1). Pas de hex en
dur (gardes `noHardcodedHex`). Aucun bug constaté.

## 3. Header + burger React — OK
`layouts/VitrineHeader.tsx` (RX3) : nav + **burger** mobile + badge panier + lien Mon compte ; couvert par
`layouts/shell.test.tsx` (burger/menu). Aucun bug constaté.

## 4. Réservation (drawer/calendrier) — OK
`features/booking/` (`AvailabilityCalendar`, `SlotPicker`, `SelectedSlotSummary`, `Drawer` @bs/ui). Un seul
pattern calendrier (ProductUXGuideline §11/§15), réutilisé aussi par le report tokenisé (RX4 S3). Aucun bug
constaté.

## 5. Sidebar manager mobile — OK
`ManagerLayout` responsive (sidebar → off-canvas mobile, skip-link, P1). Aucun bug constaté en source.

## 6. Manager « impossible de charger la librairie » — PAS un bug de rôle
- `GiftCardLibraryPage` affiche `<ErrorState title="Impossible de charger la librairie." />` **quand la requête
  `listGiftCardLibrary` (`GET /api/gestion/gift-cards/templates`) échoue** (`status === 'error'`, `retry:false`).
- **Vérification rôle** : le routeur `gestionGiftCardRouter.js` applique `requireDev`, **mais**
  `requireDev = createRoleGuard(['dev','admin'])` → **admin ET dev autorisés**. Le test
  `tests/p1/giftCardTemplateStudio.test.js` (« librairie admin : admin peut lister et activer ») confirme
  `GET /api/gestion/gift-cards/templates` en **admin → 200**. → **Aucun bug de rôle backend ; aucune modif
  guard nécessaire** (ne pas toucher : ce serait un changement de sécurité inutile).
- **Reste** : ce n'est que l'état d'erreur générique si l'endpoint échoue (réseau/serveur). → à **revalider
  sur serveur lancé** (`npm run dev` puis ouvrir `/manager/cartes-cadeaux/templates`). Pas de correction code.

## 7. Liens Vanilla dans le code React — aucun
Aucune référence `vitrine.html`/`gestion.html`/`admin.html` ni préfixe `/app`//`/manager` en dur dans les
sources React (garde `apps/vitrine/src/reactGoNoVanillaLinks.test.ts`, RX-GO). Les liens Vanilla restent dans
les templates/e-mails Vanilla (attendu ; rendus flag-aware côté backend en RX-GO/RX-GO-2).

## 8. Erreurs console — à revalider navigateur
En statique : seuls des **warnings React Router v7 future-flag** (inoffensifs, visibles en test). Aucune erreur
runtime détectable sans navigateur. Recommandé : `npm run dev` → console (F12) vide d'erreurs rouges sur les
parcours clés. **Recommandation (non bloquante)** : envelopper le `Suspense` (code-splitting RX-GO-2) d'un
petit **error boundary** (un chunk lazy qui échoue → message « recharger » plutôt qu'un écran blanc) — candidat
RX-FIX-2.

## 9. Vérifications
Frontend : typecheck OK, **476 tests** verts (+2 garde icônes), lint 0 erreur, build OK (polices émises).
Backend **non modifié** (le « bug » librairie n'en était pas un). Secret scan propre.

## 10. Limites
- Audit statique (source) : les rendus purement visuels/console runtime se valident au navigateur (`npm run dev`).
- Error boundary Suspense = amélioration de robustesse recommandée, non incluse (hors périmètre « bug visible
  confirmé »).
