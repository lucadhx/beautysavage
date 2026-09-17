# COMMUNICATION CENTER — LOT 2 (rapport de finalisation)

> Suite de `COMMUNICATION_CENTER_REPORT.md` (lot 1, commit 27a0f66). Branche `phase-0-security-baseline`.
> Objectif : rendre le Communication Center **fonctionnellement prêt pour une première production**.
> Le registre code-first (`constants/mailDispatchRules.js`) reste la source d'autorité — pas de moteur no-code.

## 1. Livré (tous testés)

### §2 — Aperçu = production
- Nouveau endpoint `POST /api/gestion/mails/templates/:functionName/preview` (dev-only) :
  rend avec **exactement** le renderer de production (`replaceTemplateVariables` + `withMailThemeVars`
  + données d'exemple du catalogue). L'aperçu HTML est **identique** à l'e-mail envoyé à Brevo.
- Front : `previewMailTemplate` délègue désormais au backend (fin du double moteur de rendu) ;
  aperçu debouncé (400 ms) dans l'éditeur. Tests : `communicationPreviewParity` (échappement,
  brouillon, variables inconnues).

### §5 / P1-12 — Communications manquantes
- Nouvelles fonctions d'envoi (commerciale → client) + templates seedés (lazy) :
  `payment_failed`, `refund_refused`, `refund_failed`, `training_certificate_available`.
- Câblage : `handlePaymentFailedEvent` (Stripe), `salesController.updateRefundStatus`
  (failed/canceled), `stripeRefundEventService` (branche failed), `learningController.completeLesson`
  (attestation générée). Tous **best-effort** (ne bloquent jamais le flux métier).
- Helper partagé `resolveRefundRecipientContext` (refundExecutionService) pour refused/failed.
- Tests : `communicationNewComms` (4 mails, destinataire/expéditeur/variables).

### §5 — Rappel de session de formation (scheduler dédié)
- Nouveau `automatisme/formationSessionRemindersJob.js` (horaire, distinct du job prestations),
  réutilise `ServiceSettings.reminders`. Participants via `Purchase{sessionId,itemType:formation}` → `User`.
- Champ ajouté `FormationSession.remindersSent[]` (anti-doublon, clé `${h}h`). Câblé dans `app.js`.
- Tests : `communicationSchedulerReminder` (envoi + anti-doublon).

### §4 — Reset PIN + renvoi carte cadeau
- Endpoint `POST /api/gestion/gift-cards/:id/reset-pin` (dev/admin). Workflow : nouveau PIN
  (`assignGiftCardPassword` → ancien hash/chiffré **écrasés = invalidés**), QR pivoté,
  `pinVersion++` + `pinResetAt`, **PDF régénéré**, e-mail renvoyé (event
  `gift_card.pin_reset_and_resent` + template `gift_card_pin_reset`), transaction `pin_reset` journalisée.
- **Sécurité** : le nouveau PIN n'est **jamais** renvoyé par l'API (uniquement e-mail/PDF), jamais loggué.
  Confirmation obligatoire côté UI + anti-double-clic (bouton désactivé pendant l'envoi).
- Front : `GiftCardResendControl` (dialogue de confirmation) dans la fiche finance carte cadeau.
- Tests : `giftCardPinResetResend` (hash change, pinVersion, tx, PIN absent de la réponse) +
  `giftCardResendDialog` (confirmation → succès).

### §11 — Notifications avis
- Événements config ajoutés (audience admin) : `review_received`, `review_published`,
  `review_rejected`, `review_manual` (+ mapping `notificationTargetService`).
- Câblage : `clientController.postFormationReview` (received), `reviewModerationController.moderateReview`
  (published/rejected), `createManualReview` (manual). Tests : `reviewNotifications`.

### §3 — Matrice des déclencheurs (lecture seule)
- Endpoint `GET /api/gestion/mails/triggers` : reflète `mailDispatchRules` enrichi (template publié,
  dernier envoi via SendLog). Page `/dev/communication/triggers` (onglet dédié), filtre par catégorie.
- Tests : `communicationTriggerMatrix` (backend) + `communicationTriggerMatrixPage` (front).

### §12 — Seed des templates système
- Templates ajoutés à `TEMPLATE_FUNCTIONS` (matérialisation lazy idempotente, non destructive) :
  `welcome`, `email_verified`, `password_changed`, `review_request`, + les 5 ci-dessus.
- Correctif latent : variables `recipientName`, `pin`, `message`, `balance`, `lessonName`… étaient
  **absentes de l'allowlist** → rendues littérales dans les corps mail carte cadeau / leçon. Ajoutées
  à `VARIABLE_KEYS` + catalogue.

## 2. Différé (documenté, avec justification)

| Réf | Item | Raison |
|---|---|---|
| §10 | **Retry manuel générique** + §9 « voir le HTML envoyé » | **Infaisable en l'état** : `SendLog` ne stocke qu'un `recipientHash` (SHA-256 **irréversible**) et **aucun HTML/payload/variables**. Un retry générique ne peut ni retrouver l'adresse ni reconstruire le message. Un renvoi **spécifique carte cadeau** existe (reset PIN, §4). Un retry générique exigerait de persister le rendu (compromis PII que le modèle évite délibérément) ou de re-dériver par `contextType/contextId` au cas par cas. |
| §6 | Éditeur HTML : coloration/numéros de ligne/recherche/pliage | Amélioration UX (l'éditeur reste 2 `<textarea>` + aperçu prod). Sans dépendance lourde, à faire dans un lot UI dédié. |
| §7 | Aperçu dark / desktop-mobile enrichi | L'aperçu prod (iframe + toggle appareil) existe ; le mode dark est cosmétique. |
| §8 | Insertion variable au curseur | Le panneau variables existe (copie). L'insertion au curseur est une amélioration UX. |
| §11 | `review_request` (e-mail automatique) | Le **template** est seedé ; le déclencheur automatique (timing après formation) est une décision produit (quand solliciter l'avis). |

## 3. Tests exécutés

- `npm run test:communication` → **8 fichiers / 42 tests verts** (communicationCenterHardening,
  communicationTemplateTooling, communicationPreviewParity, communicationTriggerMatrix,
  communicationNewComms, communicationSchedulerReminder, giftCardPinResetResend, reviewNotifications).
- Front (ciblé) : `communicationTriggerMatrixPage` + `giftCardResendDialog` → 4 verts.
- `npm run react:lint` (0 erreur) + `npm run react:build` OK.
- `npm run test:p0` → voir section validation (exécuté avant commit).

## 4. Sécurité

- PIN carte cadeau : jamais renvoyé par l'API après génération, jamais loggué, ancien hash invalidé.
- Aucun secret/PIN/token en clair dans le source (scan effectué).
- Rendu HTML : échappement des valeurs (lot 1) appliqué aussi à l'aperçu (parité).

## 5. Limites restantes

Retry générique + « voir HTML » infaisables sans changement de schéma/PII (documenté). Éditeur HTML
riche + insertion-au-curseur + aperçu dark = lot UX ultérieur. `review_request` automatique = décision
produit de timing. Le moteur événementiel reste **désactivé par défaut** (`MAIL_ROLE_RESOLVER_ENABLED`) —
les nouveaux envois sont des **envois directs** (cohérents avec l'architecture actuelle).
