# RX3 — Mega audit UX de la vitrine Beauty Savage

> Document de cadrage **PARTIE 1** de la mission RX3 (« Finalisation complète de la vitrine React »).
> Branche : `phase-0-security-baseline`. Travail parallèle, **staging sélectif**, ne pas empiéter sur RX2.6.
>
> **Règle absolue respectée** : cet audit précède toute modification d'interface. Objectif = reprendre
> les bonnes intuitions métier de la vitrine Vanilla, comprendre *pourquoi* elles existent, les améliorer,
> supprimer les défauts, homogénéiser l'expérience — sans régression.
>
> Méthode : 5 agents d'exploration en parallèle (Vanilla vitrine, React vitrine, endpoints backend
> catalogue+booking, endpoints backend checkout+gift-card+avis, patterns React validés). Références
> `fichier:ligne` conservées pour traçabilité.

---

## 0. Synthèse exécutive

| Domaine | Vanilla | React (actuel) | Verdict RX3 |
|---|---|---|---|
| Accueil | Riche (hero, boosts, prestations phares, collections, éditorial) | Partiel (hero + 3 previews, gift-card = teaser) | **Refondre** en reprenant la structure Vanilla, en plus premium/rapide |
| Catalogue prestations | Liste sans filtre | Liste FULL générique, sans filtre/recherche/tri | Uniformiser + filtres |
| Catalogue shop (formations/produits/cartes) | Shop unifié outillé (recherche/filtre/tri/favoris) | 3 pages séparées, sans outillage | Uniformiser (mêmes cards, mêmes filtres) |
| Fiche prestation | Galerie + options + aside sticky + réservation modale | Partiel : 1 photo, **options non implémentées**, pas d'avis | Premium : galerie, options, avis, sticky CTA |
| Fiche formation | Hero + sessions + avis + CTA panier/achat | Partiel : pas de session picker, **pas de CTA achat** | Premium : sessions présentiel, achat, sticky CTA |
| Panier | Multi-kind, scope user, snapshot serveur | **Service-only**, local | Étendre multi-kind |
| Checkout | Monolithe 2926 l., 4 modes, waiver dynamique | Fonctionnel **services only**, hosted Stripe | Multi-item, gift-card, feedback |
| Cartes cadeaux (achat) | Flux complet (montant, token, paiement) | **STUB** (bouton désactivé) | Implémenter le flux complet |
| Avis | Lecture PawRating + tri + pagination | `TrainingReviews` FULL (formations only) | Finaliser (soumission, unifier source) |
| Espace compte | mes services / cartes / factures | Hub RX1, **3/4 cartes = « Bientôt »** | Cf. RX4 (hors RX3, à documenter) |
| Shell (header/footer/nav) | Nav pilotée base, badges, guard | **Nav brute**, pas de burger, pas de badge panier, footer placeholder | Refondre le shell |

**Maturité vitrine React ≈ 5/10.** Zones production-ready à conserver comme références UX :
`FormationPlayer`, `MyFormations`, `PaymentSuccess`, `TrainingReviews`, hub `MyAccount`, calendrier de réservation (`booking/`).

**Décisions structurantes confirmées par l'audit backend :**
1. Le storefront consomme les **endpoints legacy Stripe** (`/api/stripe/create-checkout-session`, `finalize-free`, `session-status`). Le moteur *UnifiedCheckout* (U1/U3) est **shadow/feature-gated** (`CHECKOUT_HOSTED` off) — **ne pas s'appuyer dessus**.
2. La réservation publique utilise l'availability publique (`/api/vitrine/availability/{days,slots}`), **PAS** `listCalendarItems` (M10, auth-only). Un seul pattern calendrier dans le produit (ProductUXGuideline §11/§15).
3. `practitionerId` est **legacy/ignoré** partout (institut mono-entité M10/M11) → ne pas le porter.

---

## 1. ACCUEIL

### 1.1 Structure Vanilla (`homeModule.js`, 870 l.)
Ordre des blocs : **Hero** (bannière + nom institut + slogan + CTA « Découvrir les formations », `:382`) → **Carrousel « Articles du moment »** (boosts, max 3, auto-rotate 4.5 s, badge promo + prix + PawRating, `:399`) → **« Nos prestations phares »** (services boostés, grille + CTA, `:285`) → **Carrousel « Nos collections »** (3 tuiles : présentiel / distanciel / cartes cadeaux, `:449`) → **Bloc éditorial** storytelling HTML (`:508`).

Chargement = 6 fetches parallèles `Promise.allSettled` (`:119`) : home-settings, site-identity, highlights, shop, gift-cards, services boostés.

### 1.2 Pourquoi (intuition métier à préserver)
Entonnoir classique : **accroche émotionnelle → offres à forte marge (boosts/promos) → navigation par catégorie → réassurance/SEO**. Les 3 tuiles « collections » = raccourci mono-clic vers le catalogue filtré. PawRating = preuve sociale + identité de marque.

### 1.3 Défauts
- 🔴 **Bug** : carte « prestation phare » → `service-detail` avec `{ slug }` en option top-level (`:787`) alors que `serviceDetailModule.js:232` lit `query.serviceSlug`/`.id` → **« Prestation introuvable »**. (Ne pas reproduire côté React.)
- **Double loader artificiel** : loader pattes home (1000 ms) empilé sur loader global `vitrine.js` (1000 ms) → ~2 s à froid.
- **N+1 ratings** : 1 fetch stats par formation boostée (`:565`).
- Collections **hardcodées** (`:353`) alors que tout le reste est piloté base.
- Section boosts vide sans état d'erreur distinct (`allSettled` → `[]` silencieux).

### 1.4 État React (`HomePage.tsx`)
PARTIEL : hero `bs-hero` + 2 CTA + 3 previews (prestations/formations/produits via `usePublicShop`+`usePublicServices`). Gift cards = **teaser une ligne** (`:96`). Manque : testimonials/avis, bloc institut/about, carrousel promo, visuel cartes cadeaux, horaires/contact, trust signals. Empty states = `<p>` inline.

### 1.5 Verdict
| Bloc | Verdict |
|---|---|
| Hero + CTA | **CONSERVER** (relooker premium) |
| Carrousel boosts « Articles du moment » | **CONSERVER** (batcher les ratings) |
| Prestations phares | **AMÉLIORER** (grille cohérente catalogue) |
| Collections 3 tuiles | **AMÉLIORER** (rendre éditable, sortir du hardcode) |
| Teaser avis / testimonials | **AJOUTER** (preuve sociale home) |
| Bloc éditorial | **CONSERVER** |
| Loaders artificiels | **SUPPRIMER** (skeletons instantanés) |

---

## 2. CATALOGUE

### 2.1 Prestations (`servicesModule.js` Vanilla / `ServicesPage.tsx` React)
- **Vanilla** : header + 3 skeletons + grille de cartes (image/badge promo/titre/description/durée+prix/bouton). Carte entière `role=button` **+** `<button>` imbriqué = **double cible / ARIA invalide**. Aucun filtre. Endpoint `GET /api/vitrine/services`.
- **React** : liste FULL générique, états Loading/Error/Empty corrects, badge promo, `formatDuration`. **Aucun filtre/recherche/tri.**

### 2.2 Shop unifié (`shopModule.js` Vanilla / `TrainingsPage`+`ProductsPage`+`GiftCardsPage` React)
- **Vanilla** : toolbar (recherche debounce 180 ms + dropdown Filtre + dropdown Tri) + grille. **Carte cadeau injectée en tête** (`:771`). Favoris (auth). Fusion `[giftCard, ...formations, ...products]`. Endpoint `GET /api/vitrine/shop` (`{formations, products}`).
  - 🔴 **N+1 ratings** (`hydrateFormationRatings :106`).
  - **Labels filtre/tri = coquilles vides** (`updateFilterLabel`/`updateSortLabel` `:679`) → filtre actif jamais visible.
  - Sous-filtre présentiel/distanciel **câblé mais jamais exposé** en UI (`:410`).
- **React** : 3 pages séparées (Trainings/Products/GiftCards), même pattern card, **aucun outillage**. `usePublicShop` partage un seul fetch `/shop` (bien). GiftCardsPage = **STUB** (bouton désactivé).

### 2.3 Verdict catalogue
- **Uniformiser** prestations + formations + produits + cartes cadeaux : **mêmes `CatalogueCard`, même grille, mêmes filtres/tri/recherche**, PawRating cohérent. Aucune page « isolée » (ProductUXGuideline §15).
- **AMÉLIORER** : afficher le filtre/tri actif, exposer le sous-type présentiel/distanciel, batcher les ratings.
- **SUPPRIMER** : la double cible carte+bouton (une seule cible cliquable), les coquilles vides `updateFilterLabel/Sort`.
- **Endpoints** : catalogue déjà couvert (services, shop, gift-cards config, détails, reviews stats/list). Pas d'endpoint liste produits dédié (via `/shop`). **Distanciel : pas d'endpoint sessions** (normal). **Modules distanciels** non exposés public (auth client only).

---

## 3. FICHE PRESTATION

### 3.1 Vanilla (`serviceDetailModule.js`, 398 l.)
Colonne principale : **galerie** (thumbnail → image principale, `:139`), « À propos », **options/suppléments** (`:158`), politique d'annulation. Aside sticky : H1 + description courte, meta (durée/capacité), prix, badge paiement (gratuit/acompte/complet), **CTA « Réserver ce soin »**, section praticiennes « Avec ».
Réservation → `createBookingModal` (calendrier plein écran) → créneau → récap → `checkout`.

Défauts : 🔴 **CTA désactivé par défaut pour les connectés** (`:315`, logique inversée vs conversion) ; **section praticiennes + `practitionerId`** = code mort (institut mono-prestataire) ; galerie sans lightbox ; erreur générique.

### 3.2 React (`ServiceDetailPage.tsx` + `ServiceBookingPanel.tsx`)
PARTIEL : `Card` unique, **une seule photo** (`photos?.[0]`, pas de galerie), name/durée/prix/descriptions, puis `ServiceBookingPanel`. **`selectedOptions: []` hardcodé** (`ServiceBookingPanel.tsx:31`) → **options non implémentées**. Pas d'avis (seules les formations en ont), pas de FAQ, pas de prestations similaires, **pas de sticky CTA mobile**.

Le panel booking (`AvailabilityCalendar` + `SlotPicker` + `SelectedSlotSummary`) est FULL pour « jour → créneau → panier » via `getServiceAvailableDays/Slots`.

### 3.3 Verdict
- **AMÉLIORER** : galerie (main + thumbs, façon Vanilla), **implémenter la sélection d'options** (feed `selectedOptions`), **avis prestation** (⚠️ gap backend, cf. §7), prestations similaires, **sticky CTA « Réserver » mobile**.
- **CONSERVER** : aside sticky prix+CTA, réservation via calendrier public existant, badge paiement, politique d'annulation.
- **SUPPRIMER** : section praticiennes + `practitionerId` (code mort), CTA désactivé-par-défaut.

---

## 4. FICHE FORMATION (`itemDetailModule.js`, 1208 l.)

### 4.1 Vanilla
Hero 2 colonnes (image+zoom | kicker, titre, bandeau blocage, prix, **PawRating cliquable → scroll avis**, description courte tronquée 200c, **sessions présentiel + auto-sélection 1er créneau** `:990`, **CTA panier + achat immédiat + badge « déjà inscrit »**, favori, notice annulation, options, trust « N inscrits ») → description complète → résultat paiement (retour Stripe inline) → **avis clients** → galerie → vidéo.

Intuitions à préserver : hero above-the-fold (prix/note/CTA), rating cliquable → avis, trust signals, **double CTA** (panier vs achat impulsif), sessions inline, auto-sélection créneau (achat 1-clic), résultat paiement inline.

Défauts : dead code massif (`buildStarIcons`, `buildPriceMarkup`, `renderRatingSummary`), **mojibake** (fichier non-UTF8), note affichée 3×, blocage 3×, **description courte tronquée PUIS complète juste en dessous** (redondance), `editorialHtml` **injecté sans sanitize** (`:490`), pas de toast succès add-to-cart.

### 4.2 React (`TrainingDetailPage.tsx`)
PARTIEL→FULL sur la présentation : cover, name, type, prix, `editorialHtml` (`dangerouslySetInnerHTML`), **`TrainingReviews`** (seule page avec avis). **MANQUE** : **session/date picker présentiel**, **CTA achat/panier** (acheter une formation depuis la vitrine n'est **pas câblé** — seuls les services atteignent le checkout), curriculum/chapitres preview, formations similaires, sticky CTA.

### 4.3 Verdict
- **AMÉLIORER** : **session picker présentiel** (réutiliser les cards/badges Planning M10, pas un nouveau calendrier), **CTA achat** (présentiel = session obligatoire ; distanciel = add-to-cart), curriculum preview, avis (déjà FULL), attestation (déjà gérée côté player), sticky CTA.
- **CONSERVER** : hero, prix, PawRating cliquable, trust, résultat paiement inline, galerie/vidéo (`LessonEmbed`).
- **SUPPRIMER** : dead code, redondance description courte+complète, sanitize l'HTML éditorial.

---

## 5. PARCOURS RÉSERVATION / CHECKOUT

### 5.1 Backend (confirmé)
- **Availability publique** : `GET /api/vitrine/availability/days?serviceId&month&year` → `["YYYY-MM-DD"]` ; `GET /api/vitrine/availability/slots?serviceId&date` → `[{start,end,...}]`. Recompute complet (schedule + exceptions + bookings + formations + lunch) à chaque appel.
- **Création booking client** : `POST /api/client/bookings` (auth) → `createGlobalServiceBooking` (M11A) → `assertGlobalServiceSlotBookable`. Anti-double-booking par `BookingSlotLock` (index unique `(practitionerId, slotStartAt)`, 1 lock/minute, E11000 → `SLOT_UNAVAILABLE`).
- **Checkout / paiement (live path legacy)** :
  - `GET /api/stripe/config` (public) — clé publishable.
  - `POST /api/stripe/create-checkout-session` (auth) → `{mode:'hosted', url}` | `{mode:'free'}` | `{mode:'elements'}` (elements = flag off, non utilisé React).
  - `POST /api/client/checkout/finalize-free` (auth) — commande 0 € (100 % gift card / gratuit).
  - `GET /api/stripe/session-status?session_id=cs_…` — résout `cs_`→`payment_intent`, ownership via `StripeCheckoutIntent.userId`, ne fait jamais confiance au `redirect_status`.
  - Return URLs construites **serveur** depuis `CHECKOUT_RETURN_BASE_URL` (jamais client). Si défini → pages React `/paiement/succes` + `/paiement/annule` ; sinon fallback Vanilla.
- 🔴 **GAP** : **pas de mécanisme de hold créneau public** — deux clients peuvent choisir le même créneau, le 1er gagne, le 2e reçoit `SLOT_UNAVAILABLE`. (Le hold 5 min existe **admin only**.) → prévoir gestion d'erreur claire côté React (revalider créneau avant paiement).

### 5.2 Vanilla checkout (`checkoutModule.js`, 2926 l.)
Monolithe, 4 modes routés par URL (`cart=true` / `serviceSlug` / single-item). **Pas de wizard** : longue page à scroll, « étapes » = modales + sections empilées. Blocs communs : focus produit → résumé financier → cartes cadeaux (modale 3 sous-étapes : code → mot de passe → montant+preview) → session/créneau → options → **bloc légal (CGV + waiver rétractation dynamique)** → payer.

Paiement : montant > 0 → `createCheckoutStateToken` (sessionStorage TTL 15 min) → `payment?checkoutToken=` ; montant = 0 → free checkout. `paymentResultModule` **polle** `/api/stripe/payment-result` 2 s × 11 (~22 s).

**À préserver absolument (extraire en fonctions pures testables)** :
1. **Calcul waiver / rétractation dynamique** (distanciel toujours legal ; présentiel <7j / 7-14j ; institut) — exigence légale.
2. **Token checkout** (state serialisé, prix/waivers non manipulables, backend autorité).
3. **Free checkout** séparé (gift card 100 %).
4. **Acompte + reste à régler sur place** (prestations).
5. **Statut « déjà inscrit »** + **check suspension compte**.
6. **Panier scopé user + snapshot serveur**.

Défauts : 🔴 modale carte cadeau **réimplémentée ×3**, résumé financier ×3, bloc légal ×3 ; **mot de passe carte cadeau stocké en clair** dans le state ; loaders artificiels ; **polling 22 s** + `status:'failed'` affiché comme « en attente » (incohérent) ; dead code (`finalizePurchase`, `CHECKOUT_RESULT_KEY`, « Paiement simulé - Stripe à venir »).

### 5.3 React checkout (`CheckoutPage.tsx`)
Meilleure page technique : `createCheckoutSession` → hosted (redirect) / free (`finalizeFreeCheckout`) / elements (**non supporté → message d'erreur**). Gère 401 → `login_required`, `resolveErrorUx`, `LegalConsentChecklist`. **Limites** : paie **la première ligne service datée uniquement** (`toServiceLine`) — **pas de multi-item, pas de produits/formations/cartes cadeaux, pas de Elements**.

### 5.4 Verdict parcours
- **Objectif : le moins de clics possible.** Réutiliser : calendrier public existant (`booking/`), `LegalConsentChecklist`, `CartProvider`, hosted checkout, `PaymentSuccess`/`Cancel`.
- **AMÉLIORER** : checkout **multi-item** + multi-kind (produits/formations/cartes cadeaux), **feedback paiement clair** (échec ≠ « en attente »), revalidation créneau (gap hold public), résumé financier premium (langage finance RX2 : hero + breakdown card, no tables).
- **CONSERVER / porter** : waiver dynamique, token TTL, free checkout, acompte+reste, déjà-inscrit, suspension, confettis succès.
- **SUPPRIMER** : loaders artificiels, `practitionerId`, textes morts, mot-de-passe gift-card en clair dans le state (revoir le flux).

---

## 6. CARTES CADEAUX (checkout)

### 6.1 Backend redemption (confirmé — `services/checkout/checkoutGiftCardService.js`)
- **Paiement intégral gift card** : ✅ (100 % → `finalize-free`, `requireZeroRemaining` serveur, pas de Stripe).
- **Paiement partiel** (gift card + reste Stripe) : ✅ (`computeServerGiftCardCoverage`, `amountToPay = max(0, payBase − coverage)` ; gift card = **moyen de paiement**, pas une remise ; base commission inchangée = `soldAmount`).
- **Plusieurs cartes** dans une commande : ✅ (dédup par id/code, itération séquentielle jusqu'à `remaining <= 0`).
- **Solde** : `computeAvailableGiftCardBalance = card.balance − réservations autres PI` ; débit atomique `debitGiftCardBalanceAtomic` (guard `balance >= amount`) + compensation `recreditGiftCardBalanceAtomic`. Carte `active → redeemed` à solde 0. Stocké : `Sale.giftCardUsage[]={giftCardId, code, amountUsed}` + `GiftCardTransaction` immuable.
- 🔴 **GAP** : **aucun endpoint autonome « valider un code + retourner le solde »** avant le checkout. Le solde n'est calculé que **dans** l'appel checkout (phase plan). Pas de PATCH pour modifier les cartes en cours de checkout (il faut recommencer). → soit soumettre via le checkout state (comme Vanilla), soit **ajouter un endpoint** de validation.

### 6.2 Achat vitrine Vanilla (`giftCardPurchaseModule.js`, 478 l.)
Hero premium → config montant (stepper ±10 + saisie + correction douce au blur < min) → CTA → `checkoutState` synthétique `type:'gift-card'` → token → `payment`. **Checkout direct, pas de panier.**
- 🔴 **Aucun champ destinataire/message dans l'UI** : `recipientName/recipientEmail/message` initialisés `''` mais **jamais collectés** → « offrir » sans envoi. **Gap produit + champs morts.**
- 🔴 `giftCardModal.formatPrice` renvoie du **mojibake** au lieu de `€`.

### 6.3 React
`GiftCardsPage.tsx` = **STUB** (config + bouton désactivé). Flux d'achat **entièrement manquant**. `CartProvider` n'expose que `addService`.

### 6.4 Verdict
- **Implémenter** l'achat carte cadeau React (montant preset/libre + min, **champ destinataire/message + aperçu**, checkout token → paiement, PDF/QR côté compte).
- **Dans le checkout** : afficher **toujours** solde utilisé / reste / nouveau solde (« jamais de surprise »). Supporter intégral + partiel + multi-cartes (déjà permis par le moteur).
- **Décision à trancher** : ajouter un endpoint « valider code → solde » (meilleure UX, feedback avant paiement) **ou** documenter la limite (validation dans le checkout uniquement). **Recommandation : ajouter l'endpoint** (petit, additif, sans toucher le moteur de débit).

---

## 7. AVIS

### 7.1 Backend (confirmé — `models/Review.js`, `clientController.js`, `vitrineShopController.js`)
- **Modèle** : `userId`, `formationId` (**requis** → avis **formations only**), `rating` 1-5, `comment`, `status` `pending|published|rejected` **défaut `published`**, `moderatedAt/By`. Index unique `(userId, formationId)` (1 avis/user/formation).
- **Soumission client** : ✅ `POST /api/client/formations/:id/review` (auth). Éligibilité = **avoir acheté** (`loadFormationPurchase` → 403 sinon) — **pas** la complétion (diverge de la doc C3). Doublon → 409. Créé **directement `published`** (pas de pré-modération).
- **Lecture publique** : ✅ `GET /api/vitrine/formations/:id/reviews/stats` (avg + count) et `.../reviews?page&sort=recent|best` (pageSize 5, expose `{rating, comment, createdAt}` — pas de nom, pas de photo).
- **Modération** : ✅ `GET`/`PATCH /api/gestion/learning/reviews[/:id]` (**dev-only** : `requireAuth + requireMode('gestion') + requireDev`).
- 🔴 **GAPS** : **pas de photos**, **pas de réponse institut** (aucun champ modèle ni endpoint), **pas d'édition avant modération** (2e POST = 409), **pas d'avis prestation/produit**, avis **auto-publiés**, **aucun mail/notification** sur soumission/modération, **avis non agrégés dans Customer360**.

### 7.2 Vanilla / React
- **Vanilla** : lecture PawRating + tri (Récents / Mieux notés) + pagination + états loading/empty/error + **anonymisation « Prénom N. »**. Soumission ailleurs (`myFormationDetailModule.js`). Faiblesse : stats et liste = **2 sources** (risque incohérence), note arrondie entière pour pattes vs `4.3/5` affiché. `buildStarIcons` = **dead code** (le vrai rating = PawRating).
- **React** : `TrainingReviews.tsx` FULL (PawRating, recent/best, paginé, read-only). Pas de formulaire de soumission côté vitrine.

### 7.3 Verdict
- **Finaliser** : formulaire de soumission mobile-first (note PawRating + commentaire), **réservé aux acheteurs** (gate backend existant), invalidation cache stats+liste après envoi. Édition avant modération = **seulement si logique existe** → **n'existe pas** (409), donc **documenter la limite** (ou l'ajouter en option future, hors périmètre par défaut).
- **Photos** : seulement si le backend le permet → **ne le permet pas** → ne pas promettre de photos (documenter).
- **Réponse institut** : **n'existe pas** (modèle + endpoint) → afficher si un jour disponible ; documenter le gap.
- **AMÉLIORER** : unifier source stats+liste (cohérence), PawRating partagé (+ demi-patte), badge/date, anonymisation conservée.

---

## 8. SHELL — HEADER / FOOTER / NAV

### 8.1 Vanilla (`vitrine.js`, ~1700 l.)
Nav **pilotée base** (`/api/vitrine/menu`, placement header/burger éditable), icônes header fixes (favoris/panier **avec badge count**/compte), burger (badges « Payant »/« Connecté »/acquisition), guard maintenance global, theme/identity dynamiques (white-label).
Défauts : **loader global artificiel 1000 ms** à chaque nav, **logs debug + monkey-patch `window.location`** en prod, footer nav/légal **hardcodés**, boot séquentiel, monolithe.

### 8.2 React (`PublicLayout.tsx`)
🔴 **Le plus gros gap du shell** : `<nav>` brut en `style` inline, **pas d'état actif**, **pas de burger/drawer mobile**, **pas de badge panier**, pas de logo image (`<strong>Beauty Savage</strong>`). Footer = **placeholder littéral** ; **routes légales inexistantes** (`/cgv`, `/mentions-legales`, `/confidentialite`). `polish.css` fournit le style active-nav (utilisé par le manager, **pas** la vitrine).

### 8.3 Verdict
- **Refondre le shell** : header responsive (logo, `NavLink` actif `aria-current`, **burger → drawer mobile**, **badge panier**), footer réel + **routes légales**.
- **CONSERVER** : nav pilotée base, guard maintenance, theme dynamique, auth-required slugs.
- **SUPPRIMER** (ne pas porter) : loaders artificiels, logs debug, monkey-patch location, footer hardcodé.

---

## 9. Patterns React à RÉUTILISER (ne pas réinventer)

### 9.1 `@bs/ui` (barrel unique `@bs/ui`)
- **components.tsx** : `Button` (primary/secondary), `Card`, `LoadingState`, `ErrorState`, `AppShell`.
- **polish/components.tsx** : `Badge` (tones), `Chip` (44px, `aria-pressed`), `IconButton` (label requis, 44px), `Skeleton`, `Spinner`.
- **catalog.tsx** : `SectionHeader`, `EmptyState`, `MediaImage` (ratio), `PriceLabel` (promo barré), `CatalogueGrid` (1→2→3), `CatalogueCard`, **`PawRating`** (identité de marque, pattes).
- **embed.tsx** : `LessonEmbed`, `resolveEmbed`, `isValidEmbed`.
- **theme/** : `ThemeProvider`, `defaultVitrineTheme`, `--bs-*` runtime (jamais de hex en dur).
- **motion** : `MotionTokens`, `prefersReducedMotion()`, `motionPreset(name)` (`entrance/exit/drawer/dialog/accordion/success/error/toast…`), `microTransition`, tous no-op si reduced-motion.
- ⚠️ **Pas de `Drawer`/`Stepper`/`FormField`/`Input`/`Checkbox`/`Tabs`/`Gallery`/`Carousel`/`Toast` partagés.** Ils existent en **feature-local manager** (customer360 `.c3-drawer`, finance `.fin-*`, catalogue `CatalogueModuleStepper`). → **candidats extraction `@bs/ui`** pour RX3.

### 9.2 ProductUXGuideline (référence permanente)
§0 mobile-first + parité tel/desktop ; §1 tokens `--bs-*` (`--bs-tap-target:44px`) ; §2 reuse before create ; §3 a11y (focus, 44px, aria) ; §4 responsive 320→1024 **jamais `<table>`**, drawers = bottom-sheet mobile / slide desktop ; §5 motion gated ; §8 NavLink actif ; §9 TanStack (retry 1, staleTime, lazy) ; §11 `CatalogueModuleStepper` + **un seul pattern calendrier (Planning M10)** ; §14 dette UX (erreur≠vide, confirm destructif, feedback succès, unsaved guard, enums FR) ; §15 React officiel, premium **no big tables**, zéro régression.

### 9.3 Features manager de référence
- **Planning M10** (`features/planning/`) : `MobileDayAgenda` (mobile), `WeekView`/`DayColumn` (desktop), badges paiement. → langage visuel des créneaux (mais data = availability publique).
- **Customer360** (`features/customer360/`) : cards + accordion + timeline **no tables** ; **`CustomerDrawer`** (bottom-sheet/side-panel, Escape) = **meilleur candidat à extraire**.
- **Finance RX2** (`features/finance/`) : hero big-number + timeline + breakdown card + drawer footer actions = langage « premium, no tables » pour résumés (panier, confirmation, reçu).
- **Catalogue Studio** : `CatalogueModuleStepper` + `CatalogueValidationDrawer` = modèle multi-étapes (checkout guidé).

### 9.4 api-client / config / auth
- `apiFetch` unique (`credentials:'include'`, cookie HttpOnly, `ApiError`). Pas de client public/auth séparé.
- Catalogue : `getPublicServices`, `getPublicServiceBySlug`, `getPublicShop`, `getPublicTrainings/Products/…ById`, `getPublicGiftCardConfig`, `getTrainingReviewStats/Reviews`.
- Booking : `getServiceAvailableDays/Slots`, `buildCheckoutPreparationPayload`, `isLegalConsentComplete`.
- Checkout : `createCheckoutSession`, `finalizeFreeCheckout`, `getCheckoutSessionStatus`, `getPaymentResult`. **React ne fait aucun Stripe.js direct** (hosted redirect only).
- `resolveErrorUx(code)` → mapping UX officiel (MAINTENANCE, LEGAL_CONSENT_REQUIRED, CHECKOUT_AMOUNT_MISMATCH, SESSION_FULL, ALREADY_PURCHASED…). **Réutiliser, ne pas réinventer.**
- `@bs/auth` : `AuthProvider`/`useAuth` (`{user, status, refresh, signOut}`), `login()` (cookie HttpOnly serveur), guards `RequireAuth`/`RequireRole`.

---

## 10. Bugs concrets relevés (ne PAS porter en React)
1. Home → prestation phare : slug mal passé → « introuvable » (`homeModule:787`).
2. `giftCardModal.formatPrice` → mojibake au lieu de `€`.
3. Achat carte cadeau : champs destinataire/message jamais collectés (champs morts).
4. Polling paiement : `failed` affiché comme « en attente ».
5. Fiche prestation : CTA « Réserver » désactivé par défaut pour les connectés.
6. Shop : labels filtre/tri vides, sous-type câblé mais non exposé.
7. Services : double cible carte+bouton (ARIA invalide).
8. Mojibake systémique (fichiers non-UTF8) dans plusieurs modules.

---

## 11. Gaps backend à décider pour RX3
| Gap | Impact | Recommandation |
|---|---|---|
| Pas de hold créneau **public** | Race condition checkout prestation | Revalider créneau avant paiement + gérer `SLOT_UNAVAILABLE` proprement (pas de nouveau backend requis) |
| Pas d'endpoint « valider gift card → solde » | Pas de feedback solde avant checkout | **Ajouter** endpoint additif léger (ne touche pas le moteur de débit) |
| Avis : formation-only, pas photos, pas réponse institut, pas self-edit, auto-publié, pas de mail/notif | Fonctionnalité avis incomplète | **Documenter les limites** ; n'ajouter que le formulaire de soumission (endpoint existe). Réponse institut/photos = hors périmètre (à noter pour RX4+) |
| UnifiedCheckout U1/U3 = shadow | — | Ne pas s'appuyer dessus ; rester sur legacy Stripe |
| Avis absents de Customer360 | Vue client incomplète | Noter pour RX4 (espace client) |

---

## 12. Ordre d'exécution recommandé (PARTIES 2→12)
1. **Shell** (header responsive + burger drawer + badge panier + footer + routes légales) — débloque tout le reste.
2. **Extraction primitives `@bs/ui`** : `Drawer`/bottom-sheet (depuis `CustomerDrawer`), `FormField`/`Input`/`Checkbox`, `Tabs`, `Gallery`, `StickyCTA`. Sans ça, tout le reste duplique.
3. **Catalogue uniformisé** (filtres/tri/recherche partagés, cards cohérentes, batch ratings).
4. **Accueil** premium (structure Vanilla, moins de texte, meilleure hiérarchie).
5. **Fiche prestation** premium (galerie + options + avis + sticky CTA).
6. **Fiche formation** premium (session picker + achat + curriculum + sticky CTA).
7. **Panier multi-kind** + **checkout multi-item** (waiver dynamique porté, feedback paiement).
8. **Cartes cadeaux** (achat + destinataire + solde dans checkout).
9. **Avis** (formulaire soumission acheteur, unifier source).
10. **Responsive** (320→1440, zéro scroll horizontal, drawer/bottom-sheet, 44px).
11. **Tests** (backend sans régression, front nouveaux tests, build/lint/typecheck).
12. **Docs + commit** (`docs/RX3_REACT_STOREFRONT_REPORT.md`, architecture, ProductUXGuideline) + staging sélectif.

**Prochaine mission après RX3 : RX4 — Finalisation de l'espace client** (mes réservations / cartes cadeaux / factures, avis dans Customer360, réponse institut).
