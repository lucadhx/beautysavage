# VitrineArchitecture — app `vitrine` (public + client)

> Architecture technique de l'app React publique/client (`beautysavage.fr`). Scope à mettre à jour
> à chaque sprint vitrine. Global : [FolderArchitecture](./FolderArchitecture.md). Produit :
> [VitrineProjectContext](./VitrineProjectContext.md).

## React UX Motion Guideline (à partir de M9, rapport 196)
S'applique aussi à la vitrine. Tout nouvel écran : **mobile-first**, animations légères (opacity/transform,
tokens `--bs-motion-*` de `@bs/ui`), micro-interactions utiles, **respect `prefers-reduced-motion`**
(`prefersReducedMotion()`/`motionTransition()`), **pas de table sur mobile** (cartes empilées), feedback
immédiat, skeleton/loading doux, cibles tactiles ≥44px, transitions propres — jamais d'UI figée/brutale.
La vitrine n'a pas de centre de notifications (notifications internes = panel uniquement).

## Routes
### Publiques
| Route | Écran | API |
|---|---|---|
| `/` | Accueil | `/api/vitrine/home-settings`, `/highlights`, `/theme`, `/site-identity` |
| `/prestations` `/prestations/:slug` | Catalogue + détail prestation (calendrier) | `/api/vitrine/services`, `/availability/*` |
| `/formations` `/formations/:id` | Catalogue + détail formation | `/api/vitrine/shop`, `/formations/:id`, `/formations/:id/reviews` |
| `/produits` `/produits/:id` | Catalogue + détail produit | `/api/vitrine/shop`, `/products/:id` |
| `/cartes-cadeaux` | Cartes cadeaux | `/api/vitrine/gift-cards` |
| `/cgv` `/mentions-legales` `/confidentialite` `/a-propos` | Pages éditoriales | `/api/vitrine/pages/:slug`, `/editable-content` |
| `/maintenance` | Écran d'état | `/api/site-status` |

### Client (auth)
| Route | Écran | API |
|---|---|---|
| `/panier` | Panier | `cartService` (local + sync) |
| `/checkout` | Consentements + récap | `/api/vitrine/*`, pricing serveur |
| `/paiement` | Redirection Stripe Checkout / résultat | `/api/stripe/create-checkout-session`, `/payment-result` |
| `/mon-compte` | Profil | `/api/client/profile`, favoris, sales/invoice |
| `/mes-formations` `/mes-formations/:id` | Accès formations + modules | `/api/client/me/formations`, `/formations/:id`, `/modules/:id` |
| `/mes-prestations` | Réservations | `/api/client/me/booking-status`, `/bookings` |
| `/mes-cartes-cadeaux` | Cartes cadeaux | `/api/client/gift-cards` |
| `/favoris` | Favoris | `/api/client/favorites` |
| `/suivi-remboursement/:token` | Suivi (public token) | `/refund-tracking/:token` |

## Checkout (cœur)
- **Panier** : `cartService` (localStorage + sync serveur).
- **Consentements** : CGV + waiver rétractation (distanciel immédiat) + ack prestation datée → bloquants (code `LEGAL_CONSENT_REQUIRED`).
- **Paiement > 0** : `POST /api/stripe/create-checkout-session` → (cible) **Stripe Checkout hébergé** → redirection ; retour `success_url` → `/api/stripe/payment-result`.
- **Paiement 0 €** : `POST /api/client/checkout/finalize-free` (100 % carte cadeau / gratuit), idempotent.
- **Carte cadeau** : appliquée serveur (réservée), capée au solde ; montant à charger = serveur après cartes cadeaux.
- **Pricing serveur fait foi** : ne jamais recalculer côté front ; mismatch → `CHECKOUT_AMOUNT_MISMATCH`.

## Accès formation
- Distanciel : accès immédiat (modules/vidéos/liens) après achat ; à vie. Présentiel : session + participants.
- Endpoints : `/api/client/formations/:id`, `/modules`, `/modules/:id`.

## Composants / stores / guards
- **Composants** (`packages/ui`) : Layout public, Header (panier/favoris/compte), CatalogCard, ServiceCalendar, CartDrawer, ConsentCheckboxes, StatePage (maintenance/contrat/suspension), PriceTag.
- **Stores** : TanStack Query (données serveur) ; `cartStore` (local + sync) ; `sessionStore` (`/auth/me`).
- **Guards** : `RequireAuth` (routes client) ; redirection login si 401.

## Erreurs (mapping code → UX, cf. rapport 135)
- Site : `MAINTENANCE` / `CONTRACT_INACTIVE` / `SITE_SUSPENDED` → **StatePage** plein écran.
- Achat : `LEGAL_CONSENT_REQUIRED` (inline), `CHECKOUT_AMOUNT_MISMATCH` (recalcul transparent), `SESSION_FULL`/`ALREADY_PURCHASED`/`SLOT_*` (toast + CTA adapté), `OFFER_*` (CTA masqué en amont), `PAYMENT_REQUIRED` (→ paiement).
- Pré-désactivation des CTA via `/api/site-status` + flags catalogue `purchasable/bookable` (à exposer, cf. 141).

## Responsive
- Mobile-first ; Stripe Checkout hébergé = paiement mobile natif. Catalogue en grille adaptative ; calendrier prestation tactile.

## MAJ U1 — Checkout via UnifiedCheckout (câblage U2)
Le checkout vitrine consommera le moteur UnifiedCheckout : un appel `createCheckout` côté client →
réponse `{ mode:"hosted", url }` (redirection Stripe Checkout hébergé, remplace Elements) ou
`{ mode:"free", saleId }` (finalize-free, 0 €). Retour via `success_url` → `/api/stripe/payment-result`.
En U1 le moteur est posé côté backend (non câblé) ; le front garde le flux actuel jusqu'à U2. Le
pricing serveur fait toujours foi ; la carte cadeau reste un moyen de paiement capé au solde.

## MAJ U2 — Checkout hébergé (backend prêt)
`POST /api/stripe/create-checkout-session` (flag `CHECKOUT_HOSTED=true`) renvoie `{ mode:'hosted',
url, checkoutId }` → l'app vitrine redirige vers `url` (Stripe Checkout) ; retour via `success_url`.
0 € → `{ mode:'free' }` → `finalize-free`. Le client API (R2) doit gérer ces deux modes + la
redirection. Tant que R2 n'est pas livré, le front Vanilla utilise Elements (flag false).

## MAJ R0 — Squelette app vitrine (exécuté)
L'app `apps/vitrine` est créée (Vite + React Router + TanStack Query + `AuthProvider`). **Routing
placeholder** sous `PublicLayout` (header catalogue/panier/connexion + footer légal) :
`/`, `/prestations`, `/formations`, `/formation/:id`, `/produits`, `/cartes-cadeaux`, `/connexion`,
`/paiement/succes`, `/paiement/annule`, et — sous `RequireAuth(loginPath="/connexion")` —
`/panier`, `/checkout`. Chaque page = composant `Placeholder` (titre + description + lien doc),
**aucun appel métier** (seul `/auth/me` au boot via `AuthProvider`). Les routes/écrans/API réels
décrits ci-dessus seront branchés à partir de **R1** (catalogue) puis **R2** (checkout hébergé).
Test : `apps/vitrine/src/App.test.tsx` (rendu de l'accueil).

## MAJ R1 — Catalogue public réel (exécuté)
Première vraie couche vitrine : pages catalogue branchées sur l'API publique existante (**aucun
changement backend**, cf. rapport 158/159). **Pas de checkout** (R2).

### Proxy (durci)
`@bs/config` expose `PROXY_PATHS = ['/api','/auth','/uploads']` + `buildProxyMap(target)` (testé) ;
`vite.shared.makeApiProxy` le consomme. Les 2 apps proxifient ces 3 chemins → `VITE_PROXY_TARGET`
(défaut `http://localhost:3000`). Same-origin, cookie via `credentials:'include'`. Médias `/uploads/...`
servis tels quels.

### Endpoints catalogue consommés (R1)
- `GET /api/vitrine/services` (liste) + `/services/:slug` (détail, clé **slug**).
- `GET /api/vitrine/shop` → `{formations[], products[]}` (un seul fetch, cache partagé).
- `GET /api/vitrine/formations/:id`, `GET /api/vitrine/products/:id` (détails).
- `GET /api/vitrine/gift-cards` (**config seule** : minAmount/description/image — pas de liste/détail).
- `GET /api/site-status` (bandeau maintenance/suspension, best-effort).

### Client API (`@bs/api-client/catalog`)
`types.ts` (PublicService/Training/Product/GiftCardConfig/SiteStatus/Category/Media), `format.ts`
(`formatPrice` fr-FR, `formatDuration`, `resolveMediaUrl`), `mappers.ts` (mapping tolérant, tout
optionnel sauf id/name ; prix serveur fait foi), clients `services/shop/trainings/products/
giftCards/site`.

### Hooks (`apps/vitrine/src/features/catalog/hooks`)
`usePublicShop` (clé `['catalog','shop']`), `usePublicTrainings`/`usePublicProducts` (mêmes clé +
`select` → 1 fetch partagé), `usePublicServices` (+ `usePublicService(slug)`), détails
`usePublicTraining(id)`/`usePublicProduct(id)`, `usePublicGiftCards`, `useSiteStatus` (retry off).
QueryClient app : `retry:1`, `refetchOnWindowFocus:false`, `staleTime 60s`.

### Composants (`@bs/ui`)
`CatalogueGrid` (1/2/3 colonnes responsive), `CatalogueCard`, `PriceLabel` (présentation pure :
prix courant + barré + badge promo), `MediaImage` (placeholder si pas d'image), `SectionHeader`,
`EmptyState`. `LoadingState`/`ErrorState` réutilisés.

### Pages réelles
`/` (hero + sections prestations/formations/produits + CTA cartes cadeaux, fallback propre si API
vide/erreur), `/prestations` + `/prestations/:slug`, `/formations` + `/formations/:id`, `/produits`
+ `/produits/:id`, `/cartes-cadeaux` (config). Chaque liste gère **loading/error/empty**. CTA détail
= « Voir »/« Détail » ; **aucun bouton d'achat actif** (« Réservation/Achat bientôt disponible »).
`SiteStatusBanner` dans `PublicLayout` (si statut ≠ active). `/connexion`, `/paiement/*`, `/panier`,
`/checkout` restent des placeholders (R2).

### Limites R1
Pas de détail carte cadeau (endpoint config seul) ; pas de catégories publiques (`PublicCategory`
défini mais non peuplé) ; pas de calendrier/réservation prestation (R2) ; pas de checkout/paiement.
Tests : `catalogPages.test.tsx` (loading→cards, empty, error, sections accueil, route détail) +
`App.test.tsx` (hero + bandeau maintenance) + `mappers.test.ts` + `proxy.test.ts`.

## MAJ Theme Foundation — Thème vitrine (exécuté)
La vitrine applique le **thème scope=vitrine** via `VitrineThemeProvider` (dans `main.tsx`, sous
`QueryClientProvider`/`AuthProvider`) :
- `getVitrineTheme()` (`@bs/api-client`, `GET /api/vitrine/theme`) → `PublicVitrineTheme` (neutre).
- `mapVitrineThemeToTokens()` (vitrine) : normalise les hex (`normalizeHex`), dérive `primaryHover`/
  `accent` en `color-mix`, renvoie une surcharge partielle. Couleurs invalides ignorées.
- `ThemeProvider scope="vitrine" theme={…}` applique les CSS vars `--bs-*` sur `<html>`. **Fallback**
  `defaultVitrineTheme` tant que l'API n'a pas répondu / en erreur (best-effort, jamais bloquant).
- Tous les composants catalogue lisent les tokens (`--bs-color-*`, etc.) ; décoratifs (`.bs-hero`,
  `.bs-banner`, `.bs-media__placeholder`) tokenisés via `color-mix`. Aucun hex dans les `.tsx`.
- Tests : `features/theme/theme.test.tsx` (adapter + fallback défaut + couleur backend).

## MAJ T1 — Thème vitrine = scope vitrine
La vitrine reste sur `GET /api/vitrine/theme` (rétro-compat), qui renvoie désormais le thème **scope
vitrine** (les anciens documents sans scope sont traités comme vitrine). Aucun changement côté
vitrine React : même `VitrineThemeProvider`, même fallback. L'adapter `mapVitrineThemeToTokens`
délègue au mapping centralisé `mapBackendThemeToTokens` de `@bs/ui` (partagé avec le manager). Un
endpoint générique `GET /api/theme/vitrine` existe aussi (équivalent).

## MAJ R2A — Panier + préparation checkout (exécuté)
**Panier React local** (`features/cart`) : `CartProvider`/`useCart`, persistance `localStorage`
versionnée (`bs_cart`/`CART_VERSION`, reset si incompatible), `addService`/`removeItem`/`updateItem`/
`clearCart`, `summary` indicatif. `ServiceCartItem` porte `selectedSlot`/`selectedOptions`/`indicativePrice`.

**Réservation prestation** (`features/booking`) : hooks `useServiceAvailableDays`/
`useServiceAvailableSlots` (`/api/vitrine/availability/days|slots`), `AvailabilityCalendar`
(calendrier mensuel, jours dispo cliquables), `SlotPicker` (créneaux : loading/empty/erreur),
`SelectedSlotSummary`, `ServiceBookingPanel` (sur la fiche prestation → ajout panier avec créneau).
**Aucun lock front** ; message « confirmé après paiement/validation ». Slots `start/end` =
`"YYYY-MM-DDTHH:mm"`, jours `"YYYY-MM-DD"`.

**Consentements** (`features/legal`) : `LegalConsentChecklist` (CGV + rétractation + prestation
datée), `buildLegalConsentPayload`. UX ; backend = autorité.

**Pages** : `/panier` (liste + retrait + CTA `/checkout`, vide → EmptyState) et `/checkout` (récap +
consentements + bouton « Préparer le paiement » **désactivé** tant que consentements incomplets →
`buildCheckoutPreparationPayload` affiché en `<details>` debug). **Aucun appel Stripe / create-checkout-session**
en R2A. `/panier` et `/checkout` ne sont plus sous `RequireAuth` (panier local). `CartProvider` monté
dans `main.tsx`. Le payload prépare le `checkoutState.service` + `legal` attendu par le backend (R2B).

## MAJ R2B — Paiement hébergé + finalize-free (exécuté)
`/checkout` est branché au paiement via **`@bs/api-client/checkout`** :
- `buildServiceCheckoutState(line, legal)` → `{item, service{serviceId,practitionerId,slotStart,
  slotEnd}, legal{acceptedCgv,waiverAccepted}, origin}` — **aucun montant** (serveur recalcule).
- `createCheckoutSession({checkoutState})` (`POST /api/stripe/create-checkout-session`, body direct) :
  `hosted` → `window.location.assign(url)` ; `free` → `finalizeFreeCheckout` (idempotencyKey) →
  `navigate('/paiement/succes?free=1&checkoutId=…')` ; `elements` (flag off) → message ; `401` →
  « Connexion requise » + `/connexion` (panier conservé) ; erreur → `ErrorState` (mapping `@bs/config`).
- **Aucun `@stripe/stripe-js`, aucun appel Stripe direct.** Bouton « Payer / Confirmer » désactivé si
  panier vide / consentements incomplets / pas de prestation+créneau / soumission.
- Pages `PaymentSuccessPage` (`/paiement/succes` : `free=1` / `payment_intent_id` →
  `getPaymentResult` ; wording **prudent** si `pending`) et `PaymentCancelPage` (`/paiement/annule` :
  panier conservé). Sorties de `RequireAuth`.
- **Limite** : `success_url`/`cancel_url` hosted = backend (Vanilla) → le retour hosted atterrit sur le
  Vanilla ; les pages React sont prêtes (flow free testé ; hosted dès paramétrage backend = R2C).

## MAJ R2C — Retour Stripe React + login (exécuté)
- **Retour hosted** : si le backend a `CHECKOUT_RETURN_BASE_URL`, Stripe revient sur
  `/paiement/succes?session_id=cs_…` & `/paiement/annule` React (sinon Vanilla).
- **`PaymentSuccessPage`** : `free=1` → confirmé ; `session_id` → `getCheckoutSessionStatus`
  (backend résout `cs_…`→PI) ; `payment_intent_id` → `getPaymentResult`. **`clearCart()` seulement si
  confirmé/free** ; jamais si pending/unknown/failed. Wording prudent (« confirmation en cours »).
- **`PaymentCancelPage`** : panier conservé.
- **`LoginPage` (`/connexion`)** : email/password → `login()` (`@bs/api-client/auth`, cookie HttpOnly)
  → `useAuth().refresh()` → redirect interne validé (`?redirect=` sinon `/checkout` si panier sinon
  `/`). Anti open-redirect (cible interne uniquement). Pas d'inscription/reset/OAuth.
- **`/checkout` 401** → lien `/connexion?redirect=/checkout` (panier conservé) → reprise du paiement
  après login.
- api-client : `getCheckoutSessionStatus`, `login`. Aucun token localStorage ; cookie HttpOnly only.

## Sprint M5 — Theme Studio (impact vitrine, rapports 187-188)

Le thème **Vitrine** est éditable depuis le Theme Studio (app manager, dev-only). Le site public lit
toujours son thème via `GET /api/vitrine/theme` / `getVitrineTheme` → `mapVitrineThemeToTokens` →
`ThemeProvider scope="vitrine"`. M5 (additif) : le pipeline transmet désormais aussi
typography/radius/shadow/spacing (en plus des couleurs) si le thème actif les définit — sinon repli
sur `defaultVitrineTheme`. Aucune rupture : la vitrine Vanilla et React restent compatibles.


## Sprint M11A — Checkout prod branche sur le calendrier global institut (rapports 199-200)

Fermeture de l ecart M10 : le checkout de PRODUCTION cree toute nouvelle ServiceBooking via le chemin GLOBAL institut (`createGlobalServiceBooking`). practitionerId reste legacy nullable, accepte mais IGNORE.
- Backend : `assertGlobalServiceSlotBookable` (globalAvailabilityService) ; finaliseur `processServiceCheckoutStatePurchase` -> createGlobalServiceBooking ; validations pre-paiement (stripeCheckoutService Elements/hosted + unifiedCheckoutValidationService) -> assertGlobalServiceSlotBookable ; route directe `createBooking` neutralisee ; `getAvailableSlots` ignore le practitionerId query.
- Regles paiement/remboursement/commission INCHANGEES ; aucune suppression DB.

**Vitrine (R2A/R2B)** : `@bs/api-client/checkout` — `service.practitionerId` documente LEGACY (ignore serveur), `buildServiceCheckoutState` le transmet en `?? null`. `@bs/api-client/booking/availability.getServiceAvailableSlots(practitionerId?)` tolere mais sans effet. React ne depend plus du prestataire ; aucun nouveau texte prestataire/praticienne. Tests R2A/R2B intacts + 1 test non-dependance.


## Sprint M11B — Finalisation calendrier global institut (rapports 201-202)

Finalisation : endpoint report admin GLOBAL + reschedule remboursement global + neutralisation runtime de practitionerId + script cleanup volontaire + index global. Aucune suppression DB ; paiement/remboursement inchanges.
- **Backend** : POST /api/gestion/bookings/:id/reschedule (rescheduleBookingByAdmin -> rescheduleGlobalServiceBooking, deplacement EN PLACE, validation+slot-lock globaux, audit booking.rescheduled + booking.confirmed). Reschedule remboursement (sessionCancellationFlowService) -> createGlobalServiceBooking. Mount-order corrige (gestionBookingRouter avant broad-mounts dev-only, M3A). scripts/cleanupPractitionerLegacy.js (dry-run/apply/force-prod, consolidation+archivage, index global opt-in). Index ServiceBooking {startAt,status}.

**Vitrine** : aucun impact direct (le report est une action manager). Le checkout reste branche au global (M11A) ; practitionerId legacy ignore.


## Sprint P1 — Product Polish & UX (rapports 207-208)

Vitrine : couche @bs/ui/polish appliquée globalement (focus visible, cibles 44px, anti-overflow, scrollbar, micro-interactions, presets motion). Correction sémantique : GiftCardsPage utilise un vrai <Button disabled> (plus de <span className="bs-btn"> factice). Primitives partagées (Badge/Chip/Skeleton/Spinner) disponibles pour les prochains écrans. QueryClient vitrine déjà optimisé (retry1/staleTime). Aucun changement métier. Réf : docs/ProductUXGuideline.md. Limites : FormField/Input/Checkbox partagés à extraire (login/checkout gardent les inputs natifs).

## C1 — Avis & notation patte de chien
Détail formation : section **avis** (`features/catalog/components/TrainingReviews.tsx`) — stats moyenne +
nombre, tri récent/meilleur, liste. Notation **patte de chien** portée dans `@bs/ui` (`PawRating`, identité
Beauty Savage). api-client `catalog/reviews.ts` (endpoints publics `/api/vitrine/formations/:id/reviews[/stats]`).
Lecture seule (modération admin → C2). Détail : rapport 210.

## C2 — Espace apprenant (Learning)
`features/learning/` + pages `MyFormationsPage` (`/mes-formations`) et `FormationPlayerPage`
(`/mes-formations/:id`). Lecteur mobile-first (vidéo `LessonEmbed` → « J'ai terminé » → leçon suivante ;
desktop nav gauche + vidéo droite), progression serveur, téléchargements, confetti léger à 100% (coupé
reduced-motion). api-client `catalog/learning.ts`. Accès gated serveur (Purchase). Nav « Mes formations ».
Détail : rapport 212.

## C3 — Attestation apprenant
`FormationPlayer` : bouton « Télécharger l'attestation » à 100% (`attestationDownloadUrl`, lien authentifié),
navigation leçon précédente/suivante. L'attestation PDF est générée à la complétion (backend pdfkit). Détail :
rapport 216.

## RX1 — Espace compte + frontend officiel
Vitrine servie officiellement sous `/app` (Vite base `/app/`, flag REACT_OFFICIAL_FRONTEND, rollback OFF).
Nouvel **espace compte client** `/mon-compte` (`pages/MyAccountPage`) : hub cards (profil + Mes formations +
réservations/cartes/factures « bientôt ») + **déconnexion** (signOut) — comble le gap RC1 (#1). Header :
lien « Mon compte » au lieu de l'e-mail. Détail : rapport 222.

## RX3 S3 — Checkout multi-item (front-only)
- `features/cart/` : `FormationCartItem` (présentiel session / distanciel), `addFormation`, `CART_VERSION` 2.
- `features/legal/cartLegalRequirements.ts` (+`waiverConstants.ts`) : moteur légal par item (textes backend exacts).
- `features/checkout/` : `buildCartCheckoutState` (pur), `useCartAvailability`, `useGiftCardApply`, `components.tsx`.
- `pages/CheckoutPage.tsx` : `CartCheckout` (formations + gift cards) | `ServiceCheckout` (prestation single-item S2).
- `@bs/api-client checkout/` : `CartCheckoutState`, `AppliedGiftCard`, `validateGiftCard[Credentials]` ; `catalog/sessions.ts` (S2).
- Backend NON modifié. Payload = `cart:true` accepté par `processCartCheckoutStatePurchase`.

## RX3 S4 — Storefront premium
- `features/home/*` (HomeHero/HomeWhy/HomeReviews/HomeFaq) + `HomePage` refondu ; `features/giftcard/*`
  (GiftCardPurchasePanel/GiftCardPreview) + `GiftCardsPage` (achat complet).
- `@bs/api-client catalog/home.ts` (5 wrappers accueil) ; `PublicGiftCardConfig` +maxAmount/presetAmounts ;
  `checkout` `GiftCardCheckoutState`/`buildGiftCardCheckoutState`.
- `VitrineFooter` : social-links hydratés. Backend minimal : recipient carte cadeau persisté (finalizer).

## RX-POLISH-BLOCKER — Avis prestations et langage Paw

Finition transverse de l'expérience avis côté vitrine.

- **Avis prestations publics** : le détail prestation consomme désormais des endpoints publics dédiés
  (`/api/vitrine/services/:id/reviews` et `/reviews/stats`) via `catalog/reviews.ts`, puis affiche une
  vraie section `ServiceReviews` sur `ServiceDetailPage`.
- **Avis formations + prestations** : la vitrine partage le même langage de notation sur les zones avis
  de formation, prestation et compte client.
- **Paw only** : `PawRating` devient la représentation officielle ; les vues avis ne doivent plus exposer
  d'étoiles visibles.
- **Modération respectée** : seuls les avis publiés remontent publiquement ; un avis manuel institut
  reste interne tant qu'il n'est pas publié.

Tests clés :
`catalog/reviewsApi.test.ts`, `serviceDetail.test.tsx`, `pawRatingEverywhere.test.tsx`.
