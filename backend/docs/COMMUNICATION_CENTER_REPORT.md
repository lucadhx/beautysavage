# COMMUNICATION CENTER — Rapport d'implémentation

> Suite de l'audit `docs/COMMUNICATION_CENTER_AUDIT.md`. Branche `phase-0-security-baseline`.
> Périmètre validé avec le porteur produit (2026-07-22) : **P0 + core P1**, carte cadeau **owner-only**
> conservée, conformité expéditeur par **honneur du `fromRole`** dans les envois directs.

## 1. Architecture — avant / après

**Avant.** Quatre chemins d'envoi concurrents ; le moteur événementiel désactivé (`MAIL_ROLE_RESOLVER_ENABLED`
OFF) → tous les envois directs partaient de `commerciale`, ignorant le `fromRole:'support'` des règles.
Valeurs de variables **non échappées** dans le HTML mail. E-mails destinataires **en clair** dans les
logs. Notif de remboursement réussi mal nommée. 7 événements hors catalogue. Alertes système/dev **inexistantes**
(code mort). Aucun **envoi de test**. Catalogue de variables **hardcodé côté front**.

**Après (ce lot).** Expéditeur conforme (`support` pour commission/incident) via `buildSenderForRole`.
Échappement HTML centralisé (allowlist raw pour URL/thème/fragments). PII masquée dans les logs.
Notif `refund_completed` dédiée. Catalogue d'événements complété. **Alertes Dev** branchées sur les
pannes silencieuses (webhook définitif, rendu/envoi carte cadeau). **Envoi de test** de bout en bout
(backend + bouton éditeur). **Catalogue de variables backend** + validation non bloquante.

## 2. Livré

### P0 — sécurité
- **P0-1 — Échappement HTML des variables.** `replaceTemplateVariables(content, values, { html })`
  échappe les valeurs en mode HTML, sauf allowlist `RAW_HTML_VARIABLE_KEYS` (URLs, couleurs de thème,
  `refundSection`). Mode texte inchangé (rétro-compat). Appliqué aux 3 chemins de rendu
  (`mailDomainDispatchers`, `authMailService`, `mailEventDispatchService`).
- **P0-2 — PII dans les logs.** `maskEmail()` (`j***@domain`) ; débug payload Brevo ne loggue plus le
  destinataire complet ni les variables ; 3 logs `VENTE`/`PASSWORD_RESET`/`EMAIL_CONFIRMATION_CODE`
  et 1 warning `actionUrl` masqués.
- **P0-3 — Carte cadeau bénéficiaire.** Décision produit : **owner-only conservé**, reclassé P2
  (nécessite un champ/flow e-mail bénéficiaire). Documenté, aucun changement de livraison.

### P1 — correctness & tooling
- **P1-1 — Conformité expéditeur.** `buildSenderForRole(role)` ; `sendStatusMail(..., fromRole)` ;
  commission (×3) + site-status (×4) passent `fromRole:'support'`. Client-facing reste `commerciale`.
- **P1-2 — Envoi de test.** `POST /api/gestion/mails/templates/:functionName/test-send` (dev-only) :
  données d'exemple, `[TEST]`, log `contextType:'test'`, **aucun event métier**, aucun token réel.
  Bouton + champ e-mail dans l'éditeur (`MailTemplateEditor`), api-client `testSendMailTemplate`.
- **P1-3 — Catalogue de variables backend + validation.** `mailTemplateVariableCatalog.js`
  (`getMailVariableCatalog`, `buildSampleTemplateData`, `validateTemplateContent`) ;
  `GET /api/gestion/mails/variables` ; avertissements non bloquants à la sauvegarde.
- **P1-6 — Alertes Dev.** `devAlertService.notifyDevAlert` ; types `webhook_failure` / `system_error`
  configurés (audience dev) ; branchés sur `recordWebhookFailure` (permanent) et les catch carte cadeau.
- **P1-8 — Clé de notif remboursement.** `refund_requested` (sur succès) → **`refund_completed`**
  (nouvel event de config, libellé correct).
- **P1-9 — Catalogue d'événements.** 7 codes ajoutés → fin des warnings « UNKNOWN event ».
- **P1-10 — Débit carte cadeau.** La route `manualDebitGiftCardForGestion` (code+mot de passe) envoie
  désormais l'e-mail `gift_card.manual_debited`, comme l'autre route.

## 3. Différé (prochain lot documenté)

| Réf | Item | Raison du report |
|---|---|---|
| P1-4 | Aperçu = moteur prod | L'aperçu reste rendu côté front ; parité back = refonte modérée du endpoint preview |
| P1-5 | Seed dédié templates M7 | E-mails **déjà** matérialisés à la volée depuis `TEMPLATE_FUNCTIONS` ; notifications couvertes par le fallback `NotificationConfig` (seedé + étendu ici). Un seed M7 explicite reste souhaitable mais non bloquant |
| P1-7 | Renvoi manuel carte cadeau + « Renvoyer » logs | **Bloqueur produit** : le PIN est stocké **hashé** (non récupérable) → un renvoi ne peut pas reproduire l'e-mail sans décision « reset PIN ». Le renvoi générique depuis les logs exige de stocker le payload |
| P1-11 | Matrice de déclencheurs (UI) | UI en lecture seule sur `mailDispatchRules` + statut template ; page/route/nav supplémentaires |
| P1-12 | Comms manquantes (paiement échoué, remboursement refusé/échoué, certificat, rappel session) | Chaque comm = nouveau template + **rédaction FR** + wiring + tests ; décisions de contenu/ton produit |

## 4. Tests

Nouveaux :
- `tests/p1/communicationCenterHardening.test.js` — 13 tests (échappement HTML, `maskEmail`, `buildSenderForRole`).
- `tests/p1/communicationTemplateTooling.test.js` — 9 tests (catalogue variables, validation, envoi de test).

Non-régression vérifiée : `authMailSenderRouting`, `communicationIdentityNoMailFrom` verts.
Front : `react:lint` (0 erreur) + `react:build` OK.

Commandes : `npx vitest run tests/p1/communicationCenterHardening.test.js tests/p1/communicationTemplateTooling.test.js`,
`npm run react:lint`, `npm run react:build`, `npm run test:p0`.

## 5. Sécurité / multi-tenant

Mono-institut confirmé (aucun scope tenant). Aucun secret réel dans le source tracké (scan effectué).
SendLog hash le destinataire. Échappement HTML runtime ajouté. Aucun `eval`/`new Function`.

## 6. Fichiers modifiés (périmètre)

Backend : `services/mail/mailRenderer.js`, `mailSenderResolver.js`, `mailDomainDispatchers.js`,
`mailEventDispatchService.js`, `mailTemplateVariableCatalog.js` (nouveau), `authMailService.js`,
`services/devAlertService.js` (nouveau), `webhookFailureService.js`, `controllers/giftCardController.js`,
`controllers/mailTemplateController.js`, `routers/mailTemplateRouter.js`,
`automatisme/notificationConfigMigration.js`, `services/stripe/stripeRefundEventService.js`,
`constants/eventCatalog.js`.
Front : `packages/api-client/src/manager/mailTemplates.ts`, `apps/manager/.../MailTemplateEditor.tsx`,
`.../mailTemplates.css`.
Docs : `COMMUNICATION_CENTER_AUDIT.md`, `COMMUNICATION_CENTER_REPORT.md`, `COMMUNICATION_EVENT_MATRIX.md`,
`COMMUNICATION_TEMPLATE_VARIABLES.md`, `COMMUNICATION_TRIGGER_ARCHITECTURE.md`.
Tests : `tests/p1/communicationCenterHardening.test.js`, `tests/p1/communicationTemplateTooling.test.js`.
