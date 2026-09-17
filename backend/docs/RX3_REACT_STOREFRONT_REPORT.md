# RX3 — React Storefront : rapport (Session 1 — Fondations)

> Mission RX3 « Finalisation complète de la vitrine React ». Branche `phase-0-security-baseline`.
> Travail parallèle, **staging sélectif**, aucun conflit avec RX2.6 (Gift Card Finance Timeline).
> **Décisions de cadrage** (validées avec le porteur) : **front-only** (zéro changement backend, gaps
> documentés), et **fondations d'abord** — cette session livre le socle réutilisable ; l'accueil, les
> fiches, le checkout, les cartes cadeaux et les avis suivront en sessions RX3 ultérieures.

## Résumé

Session 1 = **audit complet** (PARTIE 1) + **socle technique** qui débloque tout le reste :
1. Extraction de **primitives partagées `@bs/ui`** (Drawer, formulaires, Gallery, StickyBar).
2. **Refonte du shell vitrine** (header responsive, menu burger→drawer, badge panier, footer réel + pages légales).
3. **Uniformisation du catalogue** (barre d'outils recherche/tri/filtre partagée, cartes cohérentes).

Tout est vert : **typecheck OK, lint OK (0 erreur), 372 tests front verts, build vitrine + manager OK**.
Backend **non touché** → aucune régression par construction.

## PARTIE 1 — Audit (livré)

`docs/RX3_VITRINE_AUDIT.md` : audit Vanilla ↔ React de l'accueil, du catalogue, des fiches prestation/
formation, du checkout réservation, du checkout cartes cadeaux, des avis et du shell. Verdicts
`conserver / améliorer / supprimer`, carte des endpoints backend (catalogue/booking/checkout/gift-card/
avis), 8 bugs Vanilla concrets à **ne pas** porter, inventaire des patterns React à réutiliser.

Constats structurants confirmés :
- Le storefront doit consommer les **endpoints Stripe legacy** (`create-checkout-session`, `finalize-free`,
  `session-status`). Le moteur *UnifiedCheckout* (U1/U3) est **shadow/feature-gated** → non utilisé.
- Réservation publique = availability publique (`/api/vitrine/availability/{days,slots}`), **jamais**
  `listCalendarItems` (M10, auth). Un seul pattern calendrier.
- `practitionerId` = legacy/ignoré (institut mono-entité) → non porté.

## Livré cette session

### 1. Primitives partagées `@bs/ui` (réutilisables vitrine + manager)
Fichiers : `packages/ui/src/overlay.tsx`, `forms.tsx`, `gallery.tsx` (+ CSS dans `polish.css`), exportés
par le barrel `@bs/ui`.
- **`Drawer`** — bottom-sheet mobile / side-panel desktop, Escape + clic scrim, `role="dialog"`
  `aria-modal`, verrou de scroll, footer d'actions. Extrait du pattern `CustomerDrawer` (customer360) →
  **un seul drawer produit** (ProductUXGuideline §15). `side='right'|'left'`.
- **`StickyBar`** — barre CTA collée (sticky), premium, safe-area, inline sur desktop (`desktopInline`).
- **`FormField` / `TextInput` / `TextArea` / `Select` / `Checkbox`** — dette RC1 « extraire FormField/
  Input/Checkbox ». Label lié, `aria-invalid`/`role="alert"`, hint→error, cibles ≥44px, focus visible.
- **`Gallery`** — image principale + vignettes clavier-accessibles (`aria-current`), dégrade à 0/1 image.
  Remplace le `photos[0]` unique des fiches (branchement fiches = session suivante).

Tests : `packages/ui/src/primitives.test.tsx` (10 cas — Drawer open/close/Escape/scrim, formulaires,
Gallery). Zéro couleur en dur, tokens `--bs-*` uniquement.

### 2. Shell vitrine (PARTIE 9 — socle)
Fichiers : `apps/vitrine/src/layouts/VitrineHeader.tsx`, `VitrineFooter.tsx`, `shell.css`,
`PublicLayout.tsx` (réécrit), `pages/LegalPage.tsx`, routes légales dans `App.tsx`.
- **Header** : marque cliquable, **navigation active** (`NavLink`), **panier avec badge** (compteur
  depuis `CartProvider`), compte/connexion selon session, **menu burger → `Drawer`** sur mobile (fermé
  au changement de route). Desktop = nav inline + libellés ; mobile = burger + icônes. Zéro scroll
  horizontal, cibles ≥44px.
- **Footer réel** (marque / explorer / légal / copyright) remplaçant le placeholder R0.
- **Pages légales routées** : `/mentions-legales`, `/cgv`, `/confidentialite` (liens du footer ne sont
  plus morts). Contenu front structuré ; branchement au contenu éditable (`/api/vitrine/pages/:slug`)
  **différé RX4**.

Tests : `apps/vitrine/src/layouts/shell.test.tsx` (5 cas — nav, badge panier, burger drawer, liens
légaux, route `/cgv`).

### 3. Catalogue uniformisé (PARTIE 3 — socle)
Fichiers : `apps/vitrine/src/features/catalog/catalogueQuery.ts` (pur), `components/CatalogueToolbar.tsx`
(+ CSS), pages `ServicesPage`/`TrainingsPage`/`ProductsPage` réécrites sur le pattern commun.
- **Barre d'outils partagée** : recherche (insensible casse/accents), tri (En vedette / Prix ↑ / Prix ↓ /
  Nouveautés), filtre type (chips) pour les formations (présentiel/en ligne). **Le tri/filtre actif est
  toujours visible** (corrige les « labels vides » de la vitrine Vanilla) + compteur de résultats.
- **Logique pure `applyCatalogueQuery`** (filtre + tri, immuable) → **zéro N+1** : on filtre une liste déjà
  chargée, aucun fetch par carte (contraste avec le N+1 ratings Vanilla).
- Cartes cohérentes (`CatalogueCard`), états loading/erreur/empty (+ « aucun résultat » distinct de
  « catalogue vide »).

Tests : `features/catalog/catalogueQuery.test.ts` (6 cas purs) + `pages/catalogFilters.test.tsx`
(2 cas d'intégration : recherche + filtre type).

## Vérifications

| Étape | Résultat |
|---|---|
| `tsc --noEmit` | ✅ |
| `eslint .` | ✅ 0 erreur (2 warnings pré-existants dans `manager/SystemSettingsPage`, hors périmètre) |
| `vitest run` | ✅ 372 tests / 94 fichiers |
| `vite build` (vitrine + manager) | ✅ |
| Backend | non modifié → aucune régression |

## Limites (assumées, à traiter en RX3 sessions suivantes)
- Fiches prestation/formation, accueil premium, checkout multi-item, achat cartes cadeaux et formulaire
  d'avis **pas encore refondus** (socle posé ; primitives prêtes).
- Pages légales = contenu front (pas encore branché sur contenu éditable panel) → RX4.
- Gaps backend documentés (front-only) : pas d'endpoint « valider gift-card → solde » (validé dans le
  checkout state) ; avis formation-only, sans photos/réponse institut/self-edit/mail-notif.
- Cartes cadeaux non incluses dans la barre d'outils (config unique, pas une liste).

## Prochaine étape recommandée (RX3 — Session 2)
Fiche prestation premium (Gallery + sélection d'options réelle + sticky CTA + avis) **et** fiche formation
premium (session picker présentiel + CTA achat), en s'appuyant sur les primitives extraites cette session ;
puis accueil premium, checkout multi-item, cartes cadeaux, avis. Enfin **RX4 — Finalisation de l'espace
client** (mes réservations / cartes cadeaux / factures, avis dans Customer360, contenu légal éditable).
