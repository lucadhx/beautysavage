# RX4 — Audit des parcours d'écriture du Client Hub (Session 2)

> Cadrage **PARTIE 1** de RX4 Session 2 (« Écriture & Parcours Client »). Branche
> `phase-0-security-baseline`, travail parallèle, **staging sélectif**, ne pas empiéter sur RX2.x / RX3.
>
> **Règle absolue respectée** : audit avant toute UI. Le backend reste l'autorité — on ne recrée aucune
> logique métier (éligibilité remboursement, exécution refund, modération avis, disponibilités). Méthode :
> 3 agents (backend annulation/report/refund, backend avis/profil/notifications, UX write Vanilla) + lecture
> directe des contrôleurs. Références `fichier:ligne`.

---

## 0. Synthèse — quels parcours d'écriture sont réalisables front-only ?

| Parcours | Endpoint client | Verdict S2 |
|---|---|---|
| **Annuler une réservation** | `POST /api/client/bookings/:bookingId/cancel` + `GET …/refund-eligibility` | ✅ **BRANCHER** (centre de S2) |
| **Reporter une réservation active** | ❌ aucun endpoint direct (report = flux email tokenisé post-annulation) | ⚠️ **DOCUMENTER** (pas de bouton factice) |
| **Laisser un avis (formation)** | `POST /api/client/formations/:id/review` | ✅ **BRANCHER** (formations possédées) |
| **Avis prestation / produit** | ❌ inexistant (Review = `formationId` uniquement) | ⚠️ documenter |
| **Lire le statut de son avis** | ❌ aucun endpoint | ⚠️ après envoi : « en cours de publication » |
| **Suivi remboursement** | ❌ pas de liste ; `GET /api/refund-tracking/:token` (email) | ⚠️ confirmation post-annulation, suivi par e-mail |
| **Profil (lecture)** | ❌ pas de `GET /api/client/profile` | ➕ **AJOUT MINIMAL** (indispensable, cf. §4) |
| **Profil (écriture)** | `PUT /api/client/profile` (prénom/nom seuls) | ✅ existant (champs limités) |
| **Notifications client** | ❌ aucun ; modèle cible admin/dev only | ⛔ **NE PAS CRÉER** (serait toujours vide, cf. §5) |

**Un seul endpoint backend ajouté en S2** : `GET /api/client/profile` (lecture seule, 3 champs). Tout le reste
réutilise l'existant.

---

## 1. Annulation de réservation (prestation) — RÉUTILISER

### 1.1 Éligibilité — `GET /api/client/bookings/:bookingId/refund-eligibility`
`serviceBookingController.js:468` → `getServiceRefundEligibility` (`services/refundService.js:331`).
Réponse : `{ ok, eligibleRefund:bool, reason:'retractation'|'institut'|'none', waiverSigned:bool,
refundAmount:number, daysBeforeService:int, cancellationDays:int }`.
- `retractation` : achat < 14 j **et** renonciation non signée → remboursable.
- `institut` : `daysBeforeService > cancellationDays` (politique institut, ex. 7 j) → remboursable.
- `none` : ni l'un ni l'autre.

### 1.2 Annulation — `POST /api/client/bookings/:bookingId/cancel` (body vide)
`serviceBookingController.js:334`. Règles : 404 si non possédée ; 400 si déjà annulée ; **409 si prestation
passée** (`startAt <= now`). Effet : passe `status='cancelled'`/`cancelledBy='client'`, **libère les locks de
créneau**, **crée un `RefundRequest` + déclenche l'exécution** si éligible (`createRefundRequestOnce` +
`triggerRefundExecution`, Stripe/GC), envoie e-mail client + admin, `triggerNotification` (audience **admin**).
Réponse : `{ ok, eligibleRefund, reason, refundAmount }`.
→ **Le hub gère tout le parcours front-only** : éligibilité → conséquences → confirmation → loading → succès
→ refresh. Pas de popup native → **Drawer**. Le remboursement est déclenché côté serveur ; le suivi arrive par
e-mail (pas de statut inventé).

### 1.3 UX Vanilla à reprendre (`myServicesModule.js`)
Modale : résumé booking → éligibilité (montant + raison verte/rouge) → « Confirmer l'annulation » → toast +
reload. On **améliore** : drawer premium (détail complet + actions contextuelles), conséquences explicites,
état de succès rassurant (« remboursement lancé, suivi par e-mail »).

## 2. Report / reschedule — DOCUMENTER (pas d'endpoint hub)

- **Aucun** `POST /api/client/bookings/:id/reschedule`. Le report existe uniquement :
  1. côté **manager** (`POST /api/gestion/bookings/:id/reschedule`, M11B, admin only) ;
  2. côté client via le **flux tokenisé post-annulation** `POST /api/client/session-cancel-flows/:flowId/
     service-reschedule` (auth = **token e-mail**, pas de session ; `sessionCancellationFlowService.js:1117` :
     crée une nouvelle `ServiceBooking` gratuite au même `saleId`, valide la dispo via slot-locks globaux).
- Ce flux est une **landing page e-mail** (équivalent Vanilla `sessionCanceledDecisionModule.js`), **pas** une
  action initiable depuis le hub. → **S2 ne pose pas de bouton « Reporter » factice.** Réutiliser les
  disponibilités publiques (`GET /api/vitrine/availability/{days,slots}`) reste la brique si l'on construit un
  jour la landing (candidat **RX4 S3**). `practitionerId` legacy/ignoré (M11A).

## 3. Remboursement — DOCUMENTER (token e-mail)

Pas de `GET /api/client/refunds`. Suivi = `GET /api/refund-tracking/:token` (sans auth, lien e-mail —
`refundTrackingModule.js`). → Le hub **confirme** la demande à l'annulation (montant estimé) et **renvoie vers
l'e-mail** pour le suivi détaillé (Stripe / carte cadeau / timeline). **Aucun statut inventé.**

## 4. Profil — AJOUT MINIMAL `GET /api/client/profile`

- Écriture : `PUT /api/client/profile` accepte **uniquement `firstName`/`lastName`** (`clientController.js:158`).
- Le modèle `User` (`models/user.js`) n'a **pas** de `phone`/`address`/`billingAddress`/consentements/`photo` —
  ces champs **n'existent pas**. Donc la Partie 8 « téléphone/adresse/consentements » est **hors schéma** : on
  n'affiche que prénom/nom/e-mail (honnêteté).
- **Aucun `GET`** aujourd'hui : l'accueil « Bonjour {prénom} » repose sur un hack localStorage (S1). Ajouter un
  **`GET /api/client/profile`** minimal, **lecture seule**, renvoyant `{ ok, user:{ firstName, lastName, email } }`
  (exactement ce que renvoie déjà `PUT`) est **indispensable** pour : (1) un accueil fiable, (2) préremplir le
  formulaire profil. Zéro logique métier, zéro donnée sensible, pas de « fourre-tout ». → **SEUL endpoint ajouté.**

## 5. Notifications — NE PAS CRÉER (serait vide)

- Aucun endpoint client. Le modèle `Notification.targetRole` = enum **`['admin','dev']`** ;
  `notificationTargetService.js` : « JAMAIS de cible 'client' » ; `canReadNotification` rejette tout rôle ≠
  admin/dev. Le moteur (M8) n'émet **aucune** notification d'audience client.
- → Un `GET /api/client/notifications` renverrait **toujours vide / 403**. Le créer serait un endpoint « au cas
  où ». **Décision : ne pas créer.** L'emplacement « Bientôt » du dashboard reste. Prérequis futur : faire
  émettre au moteur des notifications d'audience client (chantier backend M8, hors S2).

## 6. Avis — RÉUTILISER (formations)

- `POST /api/client/formations/:id/review` (`clientController.js:710`) : body `{ rating:1..5, comment? }`.
  Gating : **formation possédée** (`loadFormationPurchase`) + **un seul avis/user** (index unique
  `(formationId,userId)` — 409 si doublon). Réponse `{ ok:true }` (minimal).
- Modèle `Review` : `status` enum `pending|published|rejected`, **défaut `published`** (modération C3).
  **Pas d'endpoint de lecture** de son propre avis / statut. Aucun avis prestation/produit (schéma
  `formationId` only).
- → **Parcours réel** depuis « Mes formations » (formation terminée) : note (PawRating interactif) + commentaire
  + prévisualisation + envoi. Après envoi : « Merci, votre avis sera publié » (honnête sur la modération). Gérer
  le 409 « déjà envoyé » proprement. Reprend l'intuition Vanilla (`myFormationDetailModule.js` : FAB « Noter »,
  désactivé si `hasReview`, présentiel = seulement après la session).

## 7. Formations & Documents (P6/P10) — DÉJÀ COUVERT (S1)
Player distanciel (C2) + attestations (C3) + Mes documents (S1) opérationnels. S2 ne recrée pas le player ;
ajoute seulement l'accès « avis » sur les formations terminées.

---

## 8. Plan S2 (front-only + 1 endpoint minimal)
1. **Backend** : `GET /api/client/profile` (lecture seule) + test `clientProfile.test.js`.
2. **api-client** : `client/bookings` (+`getBookingRefundEligibility`,`cancelBooking`), `client/reviews`
   (`submitFormationReview`), `client/profile` (+`getMyProfile`).
3. **features/account** : hooks `useBookingRefundEligibility`, `useCancelBooking`, `useSubmitReview`,
   `useMyProfile` ; greeting sur profil réel.
4. **Écrans** : Mes rendez-vous **interactifs** + **drawer détail** + parcours **annulation** ; **avis** sur
   formations terminées ; profil sur données réelles.
5. Tests (front + backend), typecheck/lint/build, secret scan, docs, commit sélectif.

## 9. Limites explicitement documentées
- **Report** hub : impossible (endpoint tokenisé e-mail only) → candidat S3 (landing decision-flow).
- **Notifications** client : vides par conception → non créées.
- **Remboursement** : pas de liste ; suivi e-mail (token) → confirmation post-annulation seulement.
- **Profil** : prénom/nom/e-mail seuls (schéma) ; pas de téléphone/adresse/consentements.
- **Avis** : formations only, un par user, statut de modération non lisible côté client.
