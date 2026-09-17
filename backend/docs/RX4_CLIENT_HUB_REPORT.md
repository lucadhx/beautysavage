# RX4 — Rapport Client Hub (Session 1 : fondation + dashboard)

> Branche `phase-0-security-baseline`. Travail parallèle, **front-only**, staging sélectif. Aucune régression
> backend (aucun fichier `controllers/`, `routers/`, `models/`, `services/` modifié — seul `docs/` ajouté).
> Cadrage : [`RX4_CLIENT_HUB_AUDIT.md`](RX4_CLIENT_HUB_AUDIT.md).

## Objectif de la session
Transformer l'espace client React d'un **hub stub** (3/4 cartes « Bientôt ») en un **dashboard premium
agrégé** répondant immédiatement aux 7 questions d'une cliente, + livrer les sous-pages lecture entièrement
supportées par le backend client. Fin de session : une cliente peut consulter rendez-vous, formations, cartes
cadeaux, factures, documents et profil sans passer par le compte Vanilla.

## Livré

### Fondation `@bs/api-client` — namespace `client/`
- `client/types.ts` — `ClientBooking`, `ClientGiftCard(+Transaction/Detail)`, `ClientSale(+Invoice)`,
  `ClientProfile` (formes alignées sur les contrôleurs backend).
- `client/bookings.ts` — `listMyBookings`, `bookingInvoiceUrl`.
- `client/giftCards.ts` — `listMyGiftCards`, `getMyGiftCard` (code/mot de passe masqués côté UI).
- `client/sales.ts` — `listMySales` (normalise `date_achat`→`dateAchat`, `giftCardUsage`→`giftCardTotal`),
  `saleInvoiceUrl`.
- `client/profile.ts` — `updateMyProfile` (PUT prénom/nom), `requestPasswordReset`.
- Export ajouté au barrel racine `index.ts` (`export * from './client'`).

### Feature `apps/vitrine/src/features/account/`
- `format.ts` — helpers **purs testables** : `pickNextBooking`, `isUpcomingBooking`, `bookingBalanceDue`,
  `bookingStatusLabel/Tone`, `maskGiftCardCode`, `totalGiftCardBalance`, `greetingName`, formatage date/heure fr-FR.
- `hooks.ts` — TanStack Query (`useMyBookings/GiftCards/GiftCard/Sales`, `useUpdateProfile`) + persistance
  locale du prénom édité (`readStoredFirstName`, cf. limite §0.1 de l'audit).
- `AccountShell.tsx` / `AccountPageHeader.tsx` — coquille commune (garde d'auth + en-tête retour 44px).
- `account.css` — styles hub (tokens `--bs-*` only, mobile-first, 44px, zéro table, reduced-motion).

### Écrans
| Partie | Écran | Route | Données |
|---|---|---|---|
| P2 | **Dashboard** (refonte `MyAccountPage`) | `/mon-compte` | Bonjour → prochain RDV → formation en cours → solde carte cadeau → accès rapide → historique récent → aide |
| P3 | Mes rendez-vous | `/mon-compte/rendez-vous` | Réservations en cards (à venir / passés), statut, reste à payer, facture |
| P5 | Mes cartes cadeaux | `/mon-compte/cartes-cadeaux` | Tuiles solde + drawer (code masqué/révélable, transactions), **aucune expiration** |
| P6 | Mes factures | `/mon-compte/factures` | Historique d'achats + téléchargement facture |
| P11 | Mes documents | `/mon-compte/documents` | Agrégat factures + attestations (formations terminées) |
| P9 | Mon profil | `/mon-compte/profil` | Édition prénom/nom + demande reset mot de passe |
| P12 | Aide | `/mon-compte/aide` | FAQ (accordéon) + accès utiles |

Réutilisations : `@bs/ui` (Card, Drawer, Badge, Skeleton, EmptyState/ErrorState, FormField/TextInput,
Accordion, Button), `features/learning` (formation en cours, attestations), `catalog/format` (`formatPrice`).

## Vérifications
- **Typecheck** : OK (`tsc -p tsconfig.base.json --noEmit`).
- **Tests** : **398 passés / 99 fichiers** (dont +25 RX4 : `client/clientApi.test.ts` 8, `format.test.ts` 9,
  `myAccount.test.tsx` dashboard 3 réécrit, + couverture existante intacte).
- **Lint** : 0 erreur (2 warnings pré-existants hors périmètre : `manager/systemSettings`).
- **Build** : vitrine + manager OK.
- **Backend** : non touché → aucune régression (front-only).

## Limites connues (honnêteté)
- **Prénom d'accueil** : `/auth/me` ne l'expose pas et il n'existe pas de `GET /api/client/profile`. Le
  « Bonjour » utilise le prénom édité en session (localStorage) sinon la partie locale de l'e-mail. → Candidat
  backend : `GET /api/client/profile`.
- **Notifications (P8)** : aucun endpoint client (`/api/gestion/notifications` = admin/dev). Emplacement
  réservé dans l'accès rapide (« Bientôt »), non cliquable. → Nécessite `/api/client/notifications`.
- **Remboursements (P7)** : pas de liste client (suivi par token e-mail uniquement). Le hub renvoie l'état
  déductible des ventes ; aucune donnée inventée.
- **Profil (P9)** : `PUT /api/client/profile` limité à prénom/nom → adresse/téléphone/consentements non
  éditables front-only.
- **Avis (P10)** : lecture anonymisée + `POST` review formation only → soumission différée.
- **Aide (P12)** : coordonnées institut (tél/adresse/horaires) non exposées par un endpoint public → FAQ +
  renvoi mentions légales, pas de bouton « appeler/itinéraire » inventé. → Candidat backend : institut public.
- **Actions d'écriture** (annulation booking, report, changement de session) : différées (flux
  `session-cancel-flows`), Session 2.

## Prochaine session (RX4 S2)
Flux d'écriture (annulation/report booking + éligibilité remboursement), détail formation présentiel,
soumission d'avis, et — si extension backend — notifications client + `GET` profil enrichi.
