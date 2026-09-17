# RX3 Session 4 — Audit storefront premium (Accueil + Carte cadeau + Avis + Footer)

> PARTIE 1. Branche `phase-0-security-baseline`, travail parallèle, staging sélectif. Ne pas empiéter sur
> RX2.x Finance ni RX4 Client Hub. 3 audits parallèles (accueil, achat carte cadeau, avis/footer/collision RX4).

## 0. Décisions de cadrage

- **Accueil** : buildable **front-only** en ajoutant 5 wrappers api-client (home-settings, site-identity,
  services/boosted, social-links + gift-cards déjà wrappé). Endpoints publics existants.
- **Achat carte cadeau** : le backend accepte déjà un checkoutState single-item `item.type:'gift-card'`,
  mais **ignore/ne persiste PAS** `recipientName`/`message` sur le chemin Stripe (seul le flux manuel les
  persiste). → **Décision validée : modification backend MINIMALE** (persister les champs déjà présents sur
  le modèle) pour que le bénéficiaire soit RÉEL (pas de champ mort). **Pas d'e-mail bénéficiaire** (non
  modélisé). + test backend.
- **Avis** : la **soumission** est possédée par **RX4** (`ReviewDrawer`, account/mes-formations, `PawInput`).
  Le storefront affiche les avis **PUBLIÉS en lecture seule** (`TrainingReviews` existant). **Ne pas dupliquer.**
- **Avis en home** : **aucun endpoint agrégé** cross-formations. Stopgap **front-only** : afficher les avis
  d'une formation vedette (masqué si aucun avis). Documenté.
- **Footer** : aucune adresse/téléphone/newsletter publics → reste statique + liens légaux + **hydratation
  des réseaux sociaux** (`/api/vitrine/social-links`).

## 1. Accueil — Vanilla vs React

### Vanilla (`homeModule.js`)
Ordre : Hero (bannière CMS + slogan + CTA) → carrousel boosts « Articles du moment » (autoplay 4,5 s) →
prestations phares (services boostés) → collections (3 tuiles, **covers aléatoires** 🔴) → hook éditorial.
6 fetches parallèles + N fetches ratings (waterfall). Défauts : **loader artificiel 1 s**, covers `Math.random`,
section prestations disparaît si rien boosté, trou mort (section supprimée). Intuitions à préserver :
**merchandising boosté** (levier promo institut), promotions partout, avis réels, hero CMS-éditable, carte
cadeau first-class, chargement tolérant.

### React actuel (`HomePage.tsx`)
Très mince : hero **statique** (`<h1>Beauty Savage</h1>`), 3 previews (services/formations/produits), teaser
carte cadeau = 1 ligne. **2 endpoints** (`/shop`, `/services`). Manque : hero CMS, merchandising boosté,
gift-card visuel, avis, « pourquoi », FAQ, CTA final, animations.

### Verdict → refonte premium (conserver merchandising, supprimer loaders/covers aléatoires, ajouter avis/FAQ/CTA).

## 2. Carte cadeau — contrat backend (vérifié)
- **checkoutState single-item** : `{ item:{ type:'gift-card', id:'gift-card', name, amount, recipientName?, message? }, items:[item], legal:{acceptedCgv:true}, appliedGiftCards:[], totals, paymentProvider:'stripe', origin }`.
- `POST /api/stripe/create-checkout-session` **accepte** ce state (id sentinelle exempté, `amount >= minAmount`).
- **finalize-free / 0 €** : NON (min > 0 → toujours Stripe hosted).
- **Carte créée UNIQUEMENT à la finalisation** (`createGiftCardForPurchase`), jamais avant paiement.
- **Config** `GET /api/vitrine/gift-cards` : `{ minAmount, maxAmount(0=illimité), presetAmounts[], description, image }`.
  ⚠️ le mapper React **droppait** `maxAmount`/`presetAmounts` → **corrigé** (front-only).
- **Templates** : aucun endpoint public → aperçu = **cosmétique front** (`config.image` seul asset public).
- 🔴 **recipientName/message NON persistés** sur le chemin Stripe → **corrigé** (backend minimal, cf. §0).

## 3. Avis — état
- **Lecture publiée** : `TrainingReviews` (PawRating, tri, pagination) + `getTrainingReviews[Stats]` — EXISTE.
- **Soumission** : `POST /api/client/formations/:id/review` (auth, **purchase-gated**, 1/user, 409 doublon).
  UI = **RX4 `ReviewDrawer`** (`features/account/`, `PawInput`). **Le storefront ne recrée AUCUN formulaire.**
- **Home** : pas d'agrégat → featured-formation stopgap.

## 4. Footer — données publiques
`site-identity` (siteName/logo), `social-links` (liens actifs). **PAS** d'adresse/téléphone/e-mail/newsletter
publics (`getInstituteInfo` dev/manager only). → footer statique + légal + social hydraté. Rien d'inventé.

## 5. Collision RX4 (NE PAS toucher)
`features/account/*` (AccountShell, ReviewDrawer, BookingDetailDrawer, hooks, format), `pages/My*Page`,
`AccountHelpPage`, `packages/api-client/src/client/*`, `PawInput`/Paw dans `packages/ui/src/catalog.tsx`,
backend `clientRouter.js`/`clientController.js` (review submit + profile). Partagés (additif only) :
`App.tsx`, `packages/*/src/index.ts`. **Sûr à posséder** : `HomePage`, `GiftCardsPage`, `features/home/*`
(greenfield), `features/giftcard/*` (greenfield), `VitrineFooter`.

## 6. Périmètre livré + limites
Livré : accueil premium (front-only, 5 wrappers), achat carte cadeau (backend minimal recipient + api-client
purchase state + page), footer social, avis home (stopgap featured-formation). Limites : pas d'agrégat avis
(endpoint futur), pas d'e-mail bénéficiaire (non modélisé), templates carte cadeau non publics (aperçu
cosmétique), soumission d'avis = RX4, produits non achetables (RX3 S3), OpenGraph/SEO technique hors périmètre.

## 7. Backend touché
OUI, **minimal** : `createGiftCardForPurchase` + branche finalizer gift-card lisent/persistent
`recipientName`+`message` (champs déjà sur le modèle, bornés). Aucun nouveau moteur, aucune logique métier.
Test `tests/p1/giftCardPurchaseRecipient.test.js`.
