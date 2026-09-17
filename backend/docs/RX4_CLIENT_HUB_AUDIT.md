# RX4 — Mega audit de l'espace client Beauty Savage (Client Hub)

> Document de cadrage **PARTIE 1** de la mission RX4 (« Finalisation complète de l'espace client React »).
> Branche : `phase-0-security-baseline`. Travail parallèle, **staging sélectif**, ne pas empiéter sur RX2.x
> Finance ni RX3 Storefront.
>
> **Règle absolue respectée** : cet audit précède toute modification d'interface. Objectif = comprendre ce
> qu'une cliente peut faire aujourd'hui (Vanilla + React), pourquoi, et le refondre en un **hub unique,
> rassurant, premium, lisible sur téléphone** — sans back-office, sans tableau, sans jargon, sans régression.
>
> Méthode : 3 agents d'exploration en parallèle (Vanilla compte, endpoints backend client, plomberie React
> `api-client`/`auth`/`ui`) + lecture directe des contrôleurs backend pour figer les **formes de payload**.
> Références conservées pour traçabilité.

---

## 0. Synthèse exécutive

Une cliente ouvre son compte pour répondre à **7 questions** :

1. Quand est mon prochain rendez-vous ? → **Réservations** (`GET /api/client/bookings`)
2. Où en est ma formation ? → **Learning** (`GET /api/client/learning/formations`)
3. Combien reste-t-il sur ma carte cadeau ? → **Gift cards** (`GET /api/client/gift-cards/my`)
4. Où est ma facture ? → **Ventes/Factures** (`GET /api/client/sales`)
5. Est-ce que mon remboursement est parti ? → **Refund tracking** (token e-mail, ⚠️ pas de liste)
6. Où sont mes attestations ? → **Attestation** (`GET /api/client/learning/formations/:id/attestation`)
7. Ai-je une notification ? → ⚠️ **aucun endpoint client** (M9 est admin/dev only)

### Matrice de maturité

| Domaine | Vanilla | React (avant RX4) | Endpoint client dispo | Verdict RX4 |
|---|---|---|---|---|
| Compte / Dashboard | `myAccountModule` (2 onglets : infos + achats) | Hub RX1 **stub** (3/4 cartes « Bientôt ») | ✅ (agrégat) | **Refondre en vrai dashboard** |
| Rendez-vous (prestations) | `myServicesModule` (cards, annulation, facture) | ❌ inexistant | ✅ `GET /bookings` | **Créer** (lecture + actions S2) |
| Formations | `myFormationsModule` + détail présentiel/distanciel | ✅ `MyFormations` + `FormationPlayer` (distanciel) | ✅ `learning/*` | **Réutiliser** + carte dashboard |
| Cartes cadeaux | `myGiftCardsModule` + détail (transactions) | ❌ inexistant | ✅ `GET /gift-cards/my`, `/:id` | **Créer** (solde, code masqué, transactions) |
| Factures / historique | `myAccountModule` onglet achats + `invoiceModule` | ❌ inexistant | ✅ `GET /sales`, `/sales/:id/invoice` | **Créer** (liste + téléchargement) |
| Remboursements | `refundTrackingModule` (par token) | ❌ inexistant | ⚠️ token only (`/api/refund-tracking/:token`) | **Partiel** (statut via ventes ; pas de liste) |
| Notifications | badges d'acquisition (header/burger) | ❌ inexistant | ❌ **aucun** (`/api/gestion/notifications` admin) | **Bloqué front-only** (limite documentée) |
| Profil | `myAccountModule` (prénom/nom + reset mdp) | ❌ inexistant | ⚠️ `PUT /profile` (**prénom/nom seuls**) | **Créer** (édition minimale + reset mdp) |
| Avis | `myFormationDetailModule` (note formation) | Lecture `TrainingReviews` (anonymisé) | ⚠️ `POST /formations/:id/review` (formation only) | **Différer** (soumission = S2) |
| Documents | dispersés (factures + attestations) | ❌ inexistant | ✅ (agrégat factures + attestations) | **Créer** (hub documents) |
| Aide | ❌ inexistant en compte | ❌ inexistant | ✅ `GET /api/vitrine/site-identity` (public) | **Créer** (contact institut) |
| Favoris | `myFavoritesModule` | ❌ inexistant | ✅ `GET/POST/DELETE /favorites` | Hors périmètre RX4 (storefront) |

**Maturité espace client React ≈ 2/10 avant RX4** (uniquement Learning + hub stub). Le backend client est
**riche** : l'essentiel du hub est réalisable **front-only**. Deux vraies limites backend : **notifications
client** et **liste de remboursements** (le suivi n'existe que par token e-mail).

### Décisions structurantes confirmées par l'audit

1. **`/auth/me` ne renvoie PAS le prénom** (`id, email, role, currentMode, createdAt, isActive,
   mustChangePassword, emailVerified` — `authRouter.js:623`). Il n'existe **aucun `GET` de profil** côté
   client (seul `PUT /api/client/profile` existe, et il n'accepte que `firstName`/`lastName` —
   `clientController.js:158`). ⇒ **Le « Bonjour Julie » se déduit du prénom mis à jour côté client OU, à
   défaut, de la partie locale de l'e-mail.** Documenté comme limite ; un `GET /api/client/profile` est le
   candidat #1 pour une future session backend.
2. **Notifications client = gap backend.** Le centre M9 est monté sous `/api/gestion/notifications`
   (`requireGestionRole`, audience admin/dev). Aucun `/api/client/notifications`. ⇒ Partie 8 **non
   réalisable front-only** ; on documente et on réserve un emplacement UI (carte dashboard « à venir »).
3. **Remboursements : pas de liste client.** Le suivi passe par `GET /api/refund-tracking/:token` (sans
   auth, token e-mail privé). ⇒ Partie 7 s'appuie sur ce qui est **déductible des ventes** (montants, avoir)
   ; pas d'invention de données.
4. **Un seul pattern par domaine** : réutiliser `@bs/ui` (Card, Drawer, StickyBar, FormField, Badge,
   Skeleton, PawRating…) et TanStack Query. Zéro tableau, zéro scroll horizontal, cibles ≥ 44 px
   (ProductUXGuideline §0/§3/§4/§15).

---

## 1. VANILLA — ce qu'une cliente peut faire aujourd'hui

Source : `backend/public/js/modules/*`. Entrée : `vitrine.js` (`?page={slug}` → module → `renderPage`).
Routes protégées (login requis) : `panier`, `myfavorites`, `myaccount`, `myformations`, `my-gift-cards`,
`myservices`.

### 1.1 Mon compte — `myAccountModule.js`
- **Onglet Informations** : édition prénom / nom (`PUT /api/client/profile`), demande de reset mot de passe
  (`POST /auth/password-reset/request`), déconnexion (`POST /auth/logout`).
- **Onglet Mes achats** : cartes d'achats (produit / formation / carte cadeau) depuis `GET /api/client/sales`
  ; modale détail (articles, cartes cadeaux utilisées, texte de renonciation, lien facture).
- UX : 2 onglets à indicateur glissant, cards, modale animée, toasts, loader « pattes ».

### 1.2 Mes réservations — `myServicesModule.js`
- Cards de prestations : nom, date (« Mercredi 15 janvier 2026 »), plage horaire, prestataire, prix, acompte
  + reste à payer, statut de paiement, statut (Confirmée / Passée / Annulée / Terminée).
- Actions : **annuler** (modale d'éligibilité au remboursement : droit de rétractation vs politique institut
  vs renonciation signée vs délai dépassé), **télécharger la facture**, vérifier l'éligibilité.
- Endpoints : `GET /api/client/bookings`, `POST /bookings/:id/cancel`, `GET /bookings/:id/refund-eligibility`,
  `GET /bookings/:id/invoice`.
- UX : **déjà en cards** (pas de tableau), badges de statut, icônes par champ.

### 1.3 Mes formations — `myFormationsModule.js` (+ détails)
- Liste : cover, type (Présentielle / Distancielle), nom, prix, aperçu, **% de progression** (distanciel),
  badges (annulée/supprimée).
- Détail **distanciel** : modules → onglets (description / vidéos / fichiers), progression (localStorage),
  vidéos embarquées, fichiers téléchargeables, complétion par module.
- Détail **présentiel** : session (date/heure/lieu), participants, formatrice, éligibilité remboursement,
  compte à rebours d'annulation.
- Actions : accéder, **changer de session**, **annuler** (éligibilité), **laisser un avis** (note 1–5 +
  commentaire), naviguer entre modules, télécharger fichiers.
- Endpoints : `GET /api/client/me/formations`, `/formations/:id/modules`, `/formations/:id/session`,
  `/formations/:id/participants`, `PUT /formations/:id/change-session`, `POST /formations/:id/cancel`,
  `POST /formations/:id/review`.

### 1.4 Mes cartes cadeaux — `myGiftCardsModule.js` (+ détail)
- Liste : code, montant initial, **solde restant**, statut, date d'achat, mot de passe éventuel.
- Détail : solde vs initial, statut, historique des transactions (montant, solde avant/après, date, acteur).
- Actions : voir le détail, copier le code, utiliser au checkout.
- Endpoints : `GET /api/client/gift-cards/my`, `GET /gift-cards/:id`, `POST /gift-cards/validate[-credentials]`.

### 1.5 Factures — `invoiceModule.js`
- Polling de génération (10 s, max 5) puis bouton de téléchargement PDF. Endpoint : `GET /api/invoice/:token`.

### 1.6 Remboursements — `refundTrackingModule.js`
- Carte de statut (pending / processing / completed / failed), montant, méthode, ETA, carte cadeau si avoir.
- Endpoint : `GET /api/refund-tracking/:token` (token e-mail, **pas de liste**).

### 1.7 Flux d'annulation de session — `sessionCanceledDecisionModule.js`
- Arbre de décision (remboursement / avoir carte cadeau / report). Endpoints
  `/api/client/session-cancel-flows/:flowId/*` (**sans auth**, sécurisé par token de flow).

### 1.8 Favoris — `myFavoritesModule.js`
- Grille d'items favoris, ajout panier / achat. Endpoints `GET/POST/DELETE /api/client/favorites`.
  **Hors périmètre RX4** (relève du storefront RX3).

### 1.9 Patterns UX Vanilla à conserver
Cards partout (jamais de tableau côté client), badges de statut colorés, modales/bottom-sheets, empty states
illustrés avec CTA, loader « pattes », badges d'acquisition (formations/cartes non lues). **Bonnes intuitions
à porter** : tout est déjà pensé mobile-first et sans tableau.

---

## 2. BACKEND — endpoints client réutilisables (autorité)

> Tous sous `requireAuth()` sauf mention contraire. Formes de payload figées par lecture directe des
> contrôleurs (référence = source de vérité pour l'`api-client`).

### 2.1 Auth & session
- `GET /auth/me` → `{ ok, user:{ id, email, role, currentMode?, createdAt?, isActive?, mustChangePassword?,
  emailVerified? } }` (`authRouter.js:623`). **Pas de prénom.**
- `POST /auth/login`, `POST /auth/logout`, `POST /auth/password-reset/{request,validate,complete}`.

### 2.2 Profil — `clientController.js:158`
- `PUT /api/client/profile` body `{ firstName?, lastName? }` → `{ ok, user:{ firstName, lastName, email } }`.
  **Seuls prénom/nom** sont acceptés (pas de téléphone/adresse/consentements, contrairement à ce que
  suggèrent d'autres écrans). Pas de `GET`.
- Mot de passe : **pas** de `POST /api/client/.../password` → passer par le flux reset (`/auth/password-reset/*`).

### 2.3 Réservations (prestations) — `serviceBookingController.js`
- `GET /api/client/bookings` → `{ ok, bookings:[ serializeBooking ] }` avec, par booking (`:69`) :
  `id, bookingId, serviceId, serviceName, practitionerId, practitionerName, practitionerPhoto, startAt,
  endAt, totalPrice, depositAmount, paymentType, paymentStatus, status, cancelledAt, cancelledBy,
  selectedOptions[], saleId, cancellationPolicySnapshot, createdAt`.
- `GET /bookings/:id/refund-eligibility`, `GET /bookings/:id/invoice`, `GET /bookings/:id/status`,
  `POST /bookings/:id/cancel`, `POST /bookings/:id/confirm-payment`.
- `GET /api/client/me/booking-status` → `{ ok, bookingSuspended }`.
- ⚠️ `practitionerId`/`practitionerName` sont **legacy** (institut mono-entité M10/M11). Ne pas mettre en
  avant le « prestataire » ; l'entité est l'institut.

### 2.4 Formations & Learning
- `GET /api/client/me/formations` (legacy, présentiel+distanciel).
- `GET /api/client/learning/formations` → `{ ok, formations:[ MyLearningFormation ] }` (déjà typé
  `catalog/learning.ts` : `formationId, name, coverImage, type, progressPct, startedAt, completedAt,
  lastLessonId`). **Réutilisé tel quel.**
- `GET /learning/formations/:id`, `POST /learning/lessons/:id/complete`,
  `GET /learning/sessions/:id/attendance-token`,
  `GET /learning/formations/:id/attestation` (PDF, cookie same-origin — `attestationDownloadUrl`).

### 2.5 Cartes cadeaux — `giftCardController.js`
- `GET /api/client/gift-cards/my` → `{ ok, cards:[ buildGiftCardPayload ] }` (`:218`) :
  `id, code, amount, balance, availableBalance, reservedAmount, status, purchasedAt, createdAt, saleId,
  hasPassword, password`.
- `GET /gift-cards/:id` → `{ ok, card, transactions:[ buildGiftCardTransactionPayload ] }` (`:251`) :
  transaction = `id, amount, balanceBefore, balanceAfter, saleId, createdAt, transactionType, note, items[],
  usedByYou, usedByLabel`.
- ⚠️ `code`/`password` renvoyés en clair → **masquer à l'affichage** (RX2.6 : QR/code masqués, révélation
  explicite). **Aucune notion d'expiration** ne doit apparaître (règle métier M13/RX2.6).

### 2.6 Ventes / Factures — `clientController.js:1132`
- `GET /api/client/sales` → `{ ok, sales:[ ... ] }` : `id, createdAt, date_achat, date_formation,
  totalAmount, itemCount, items[{ type, name, price }], giftCardUsage[{ amountUsed }], accepted_cgv,
  renonciation_text, consumerWaiverAcceptedText, invoice:{ id, number, date, stripeInvoicePdfUrl,
  downloadUrl } | null }`.
- `GET /api/client/sales/:saleId/invoice` (téléchargement authentifié cookie).

### 2.7 Remboursements
- ⚠️ **Pas de** `GET /api/client/refunds`. Seulement `GET /api/refund-tracking/:token` (sans auth). Le hub
  n'affiche donc que ce qui est déductible des ventes (avoirs, montants) + un lien « suivi par e-mail ».

### 2.8 Notifications
- ❌ **Aucun endpoint client.** `/api/gestion/notifications` = admin/dev (`requireGestionRole`). Partie 8
  réservée (UI présente mais désactivée) tant qu'un `/api/client/notifications` n'existe pas.

### 2.9 Public (réutilisable en compte)
- `GET /api/vitrine/site-identity` (nom, contact, adresse, réseaux), `GET /api/site-status`,
  `GET /api/vitrine/theme`. Servent la section **Aide** et la réassurance.

---

## 3. REACT — plomberie existante (réutiliser, ne pas recréer)

### 3.1 `@bs/api-client` (client-facing)
- `auth` : `login`, `getSession` (`/auth/me`), `logout`.
- `catalog/learning.ts` : `listMyLearningFormations`, `getMyLearningFormation`, `completeLesson`,
  `getMyAttendanceToken`, `attestationDownloadUrl`. **Base de la carte formation du dashboard.**
- `catalog/reviews.ts` : lecture avis (anonymisée). Pas de soumission client.
- `booking/`, `checkout/` : préparation + paiement (storefront).
- **Manque (à créer, namespace `client/`)** : `bookings`, `giftCards` (client), `sales`/factures, `profile`.

### 3.2 `@bs/auth`
- `useAuth()` → `{ user, status, refresh, signOut }`. `AuthUser` sans prénom (cf. décision §0.1).
- `signOut()` → `POST /auth/logout` puis `status='anonymous'`.

### 3.3 `@bs/ui` (primitives prêtes — ProductUXGuideline §16)
- Structure : `Card`, `AppShell`, `SectionHeader`, `Drawer`, `StickyBar`, `Accordion`.
- Contenu : `CatalogueCard`, `MediaImage`, `PriceLabel`, `PawRating`, `Gallery`, `LessonEmbed`.
- États : `LoadingState`, `ErrorState`, `EmptyState`, `Skeleton`, `Spinner`.
- Statut/action : `Badge` (`BadgeTone`), `Chip`, `IconButton`, `Button`.
- Formulaires : `FormField`, `TextInput`, `TextArea`, `Select`, `Checkbox`.
- Motion : `MotionTokens`, `prefersReducedMotion`, `motionTransition`.

### 3.4 Écrans client React existants
- `MyAccountPage` (hub stub — **à refondre en dashboard**), `MyFormationsPage` + `FormationPlayerPage`
  (**production-ready, référence UX** : cards, progress, confetti, attestation), `LoginPage`,
  `PaymentSuccess/Cancel`, `TrainingReviews`.

---

## 4. Plan RX4 (séquencé, front-only, additif)

**Session 1 (ce livrable)** — fondation + hero du hub :
1. `api-client/src/client/` : `bookings.ts`, `giftCards.ts`, `sales.ts`, `profile.ts`, `types.ts`, `index.ts`.
2. `apps/vitrine/src/features/account/` : hooks TanStack + helpers purs (sélection prochain RDV, formatage,
   masquage de code) + `account.css`.
3. **Partie 2 — Dashboard** : refonte `MyAccountPage` en hub agrégé (bonjour → prochain RDV → formation en
   cours → carte cadeau → actions rapides → historique récent → aide).
4. **Sous-pages lecture** (réutilisent les mêmes hooks) : Mes rendez-vous (P3), Mes cartes cadeaux (P5),
   Mes factures/documents (P6/P11), Mon profil (P9), Aide (P12).
5. Routes `/mon-compte/*` + navigation compte.
6. Tests (api-client + helpers purs + rendu dashboard), typecheck, lint, build.

**Sessions suivantes** (write-flows & gaps) :
- P3+ : annulation booking + éligibilité remboursement + report (flux `session-cancel-flows`).
- P4 : détail formation présentiel (session, participants, changement de session).
- P10 : soumission d'avis (`POST /formations/:id/review`).
- P7 : suivi remboursement enrichi (si endpoint liste ajouté côté backend).
- **P8 Notifications** : nécessite un endpoint backend `/api/client/notifications` (hors front-only).
- Profil enrichi (téléphone/adresse/consentements) : nécessite extension de `PUT /api/client/profile` +
  un `GET`.

---

## 5. Limites connues (à répéter dans le rapport)
- **Prénom** non exposé par `/auth/me` → greeting déduit (prénom édité en session, sinon partie locale
  e-mail). Pas de `GET /api/client/profile`.
- **Notifications client** : aucun endpoint → Partie 8 non livrée (emplacement réservé).
- **Remboursements** : pas de liste client → suivi par token e-mail uniquement ; le hub montre l'état
  déductible des ventes.
- **Profil** : `PUT /api/client/profile` limité à prénom/nom → adresse/téléphone/consentements non éditables
  front-only.
- **Avis** : lecture anonymisée + `POST` review formation only → soumission différée (S2).
- **`practitionerId`** legacy/ignoré (institut mono-entité) → non mis en avant.
