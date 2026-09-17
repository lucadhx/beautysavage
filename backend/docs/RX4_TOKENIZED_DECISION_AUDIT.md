# RX4 — Audit des parcours tokenisés (décision post-annulation & suivi remboursement) — Session 3

> Cadrage **PARTIE 1** de RX4 S3. Branche `phase-0-security-baseline`, travail parallèle, **staging
> sélectif**, ne pas empiéter sur RX2.x / RX3. Suite de S1 (dashboard) & S2 (écriture connectée).
>
> **Règle absolue respectée** : audit avant toute UI. On **réutilise** `sessionCancellationFlowService` et le
> suivi remboursement par token ; **aucun second moteur** d'annulation ni de remboursement ; token opaque ;
> pas d'auth sur les routes tokenisées ; on n'affiche que les options réellement disponibles. Méthode : 3
> agents (décision flow backend, refund tracking backend, pièces React réutilisables).

---

## 0. Synthèse — tout existe déjà côté backend → S3 = FRONT-ONLY

| Brique | Endpoint (existant, sans auth, token) | Verdict |
|---|---|---|
| Flux de décision post-annulation | `GET /api/client/session-cancel-flows/:flowId?token=` | ✅ réutiliser |
| Reporter (formation) | `POST …/:flowId/reschedule` | ✅ |
| Reporter (prestation) | `POST …/:flowId/service-reschedule` | ✅ |
| Demander un remboursement | `POST …/:flowId/refund` (`confirmationKeyword:'annulation'`) | ✅ |
| Carte cadeau / avoir (formation supprimée) | `POST …/:flowId/gift-card` | ✅ (formation_deleted only) |
| Confirmer présence (session modifiée) | `POST …/:flowId/confirm` | ✅ (session_updated only) |
| Suivi remboursement | `GET /api/refund-tracking/:token` | ✅ réutiliser |
| Disponibilités report prestation | `GET /api/vitrine/availability/{days,slots}` (public) | ✅ réutiliser |

**Décision : AUCUN endpoint backend ajouté.** Les endpoints suggérés par le brief (`/api/client/
decision-flows/:token`, `/api/client/refunds/:token/tracking`) **dupliqueraient** l'existant → non créés
(règle « ne pas dupliquer », « ne pas créer un second moteur »). S3 ne touche pas le backend.

## 1. Flux de décision — token model & payload

- **Sécurité token** (`models/SessionCancellationFlow.js`) : `tokenHash` = **SHA-256** (jamais en clair en
  DB), unique index ; TTL **7 jours** (`SESSION_CANCELLATION_TOKEN_TTL_DAYS`) ; **usage unique** (`usedAt` +
  `decision !== 'pending'`) ; token **jamais loggé** en clair. Auto-remboursement après expiration.
- **Résolution** : nécessite **flowId (path) + token (query `?token=`)** — pas de résolution par token seul.
  Le lien e-mail porte les deux (cf. §4).
- **GET payload** : `flow.{flowId, flowType, decision, tokenExpiresAt, autoRefundAt, autoRefundDays, reason,
  options{canConfirm, canReschedule, canGiftCard, canRefund, serviceRescheduleAvailable}}` +
  - **formation** : `formation{id,name,coverImage,refundDays}`, `canceledSession{startDate,durationDays,
    schedule[]}`, `availableSessions[]` (sessions futures, **embarquées** — pas d'appel dispo séparé),
    `legal{cgvText, presentielWaiverBetween7And14, presentielWaiverWithin7, refundDays}`.
  - **service** : `service{id,name,slug,duration,…}`, `serviceSnapshot{cancellationDays,…}`,
    `bookingSnapshot{startAt,endAt,totalPrice,selectedOptions}`, `refundAmount`, `serviceAvailable`.
- **flowType** : `session_cancelled | session_updated | formation_deleted | service_booking_cancelled`.
- **Erreurs token** : 400 `FLOW_ID_REQUIRED` · 404 `FLOW_NOT_FOUND` · 409 `FLOW_TOKEN_REQUIRED` · 403
  `FLOW_TOKEN_INVALID` · 409 `FLOW_TOKEN_EXPIRED` · 409 `FLOW_ALREADY_USED` → écrans dédiés (invalide/expiré).

### 1.1 Décisions (POST)
- **/reschedule** (formation) : `{token, chosenSessionId, acceptedCgv:true, renunciationText}`. Anti-double-
  booking = incrément atomique `reservedCount < maxClients`. `renunciationText` doit **matcher exactement** le
  texte attendu (fenêtre rétractation) → **logique backend autoritaire**, on envoie le texte de `flow.legal`
  applicable et on gère un 400 proprement.
- **/service-reschedule** (prestation) : `{token, chosenSlotStart, chosenSlotEnd}`. Dispo choisie via
  `availability/{days,slots}` (serviceId du flow). Anti-double-booking via `createGlobalServiceBooking` (slot-
  locks globaux) → **409 `SLOT_UNAVAILABLE`** géré (re-choisir). `practitionerId` legacy/ignoré (M11A).
- **/refund** : `{token, confirmationKeyword:'annulation'}` → crée/relie `RefundRequest` + exécution.
- **/gift-card** : `{token}` (formation_deleted) → crée une carte cadeau de compensation.
- **/confirm** : `{token}` (session_updated) → conserve la session modifiée.

## 2. Suivi remboursement — statuts RÉELS (ne rien inventer)

- `GET /api/refund-tracking/:token` (sans auth ; token **path**). Token = 32 octets aléatoires (opaque),
  **stocké en clair** mais TTL **30 j**, **jamais loggé** (test P0 `security.logging.test.js`).
- **Statuts refund (réels)** : `requested | pending | succeeded | failed | canceled`. ⚠️ Les statuts
  `approved/refused/processing/rollback_needed/recovered` du brief **n'existent PAS** comme statut refund :
  `rollback_needed` est un **sous-statut carte cadeau** (`giftCardRefundStatus`). On **mappe uniquement le
  set réel**.
- **Split** : `isSplitRefund`, `stripeRefundAmount`/`stripeRefundStatus` (`not_applicable|pending|succeeded|
  failed`), `giftCardRefundAmount`/`giftCardRefundStatus` (`… |rollback_needed`), `giftCard{code, balance,
  recipientName}` (si recredit réussi), `giftCardRecredited`, `refundedAt`, `estimatedDelay`, `itemTitle`,
  `itemDate`. **PII minimale** (pas d'e-mail/adresse ; mot de passe carte JAMAIS exposé — seul le code).
- Exemple split : « Remboursement 60 € · 40 € recrédités carte cadeau · 20 € via Stripe ».

## 3. Carte cadeau / avoir
- **Carte cadeau de compensation** : supportée **uniquement** pour `flowType=formation_deleted` (option
  `canGiftCard`). Affichée seulement si le backend la déclare disponible.
- **Recredit carte cadeau** (part d'un split remboursement) : surfacé dans le suivi (`giftCard`).
- Pas de système d'« avoir » distinct à créer en S3 (le credit note Stripe existe côté compta, non exposé client).

## 4. Liens e-mail (Partie 9) — DOCUMENTÉ, non modifié
- Décision : `resolveVitrineBaseUrl()/vitrine.html?page=session-cancel-decision&flowId=…&token=…`
  (`buildSessionCancellationActionUrl`).
- Remboursement : `…/vitrine.html?page=refund-tracking&token=…`.
- Ce sont des **chemins Vanilla** servis aujourd'hui (flag `REACT_OFFICIAL_FRONTEND` OFF = Vanilla par défaut).
  **Ne pas repointer les templates vers les routes React tant que le flag est OFF** (les liens 404eraient). →
  Les routes React S3 acceptent **les mêmes paramètres** (`flowId`+`token` / `token`) pour un repointage
  trivial (une ligne) le jour où React est servi. **Aucun template modifié en S3** (évite de casser le live +
  n'empiète pas). Base URL via `DomainResolver`/`SystemConfiguration` (déjà administrable, S1).

## 5. React — pièces réutilisées
- `PublicLayout` public (fonctionne anonyme) mais assume la nav storefront → les pages tokenisées utilisent un
  **layout autonome minimal** (`TokenFlowLayout` : marque + colonne unique) hors `PublicLayout`.
- Report prestation : réutilise `AvailabilityCalendar`/`SlotPicker`/`SelectedSlotSummary`/`useServiceAvailable*`
  (jamais de nouveau calendrier). Report formation : cards `availableSessions` embarquées.
- `@bs/ui` : Card/Button/Badge/Drawer/StickyBar/EmptyState/ErrorState/LoadingState/Skeleton/SectionHeader.
  Référence état-par-URL : `PaymentSuccessPage`. Tests : `renderWithProviders`/`stubFetch`.

## 6. Parcours UX cible (mobile, sans compte)
```
ouvrir le lien → comprendre sa situation → choisir (reporter / rembourser / carte cadeau / contacter)
→ [report] date → créneau → récap → confirmer → succès   |   [refund] confirmer → succès + suivi e-mail
```
Colonne unique, cards, CTA sticky, timeline pour le suivi, note de sécurité, états invalide/expiré rassurants,
aucun tableau, aucun jargon, aucun bouton fantôme (options pilotées par `flow.options.*`).

## 7. Routes React (décidées)
- `/decision` — DecisionFlowPage (query `?flowId=&token=`, car le backend exige flowId).
- `/decision/report` — DecisionReportPage (query `?flowId=&token=`).
- `/refund-tracking/:token` — RefundTrackingPage (token en **path**, aligné backend).
> Déviation assumée vs brief (`/decision/:token`) : le backend **exige flowId** → token+flowId en query. Le
> refund tracking respecte `/:token`.

## 8. Limites & risques
- **Report formation** : `renunciationText` matché exactement côté backend → on envoie le texte `flow.legal`
  applicable ; en cas de mismatch (fenêtre limite) le 400 est affiché proprement (backend autoritaire).
- **Report prestation** : pas de liste dispo côté flow → réutilise l'availability publique (serviceId du flow).
- **Liens e-mail** : repointage vers React différé au passage du flag (documenté).
- **Statuts refund** : set réel uniquement (pas d'invention).
- **Auto-refund** après 7 j d'inaction (backend) : la page l'explique (« sans réponse, remboursement auto »).

## 9. Plan S3 (front-only)
api-client `client/tokenizedFlows.ts` → `features/tokenizedFlows/` (layout + pages + composants) → routes →
tests front (api + 3 pages) → docs + commit sélectif. **Zéro backend, zéro nouveau mail.**
