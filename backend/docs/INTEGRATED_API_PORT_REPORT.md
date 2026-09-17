# IntegratedAPI — Rapport de portage (BeautySavage)

> Portage adapté depuis la référence `INTEGRATED_API_REFERENCE_REPORT.md`. Voir l'audit
> comparatif `INTEGRATED_API_BEAUTYSAVAGE_GAP_AUDIT.md` et la recette
> `INTEGRATED_API_AND_COMMUNICATION_QA.md`. Aucun secret exposé (`[REDACTED]`).

## 1. Architecture avant

BeautySavage disposait déjà d'un coffre à secrets solide : `models/IntegratedApi.js`
(1 doc/fournisseur, `credentials[]` chiffrés), `utils/credentialVault.js` (AES-256-GCM,
`CREDENTIAL_VAULT_KEY`), resolver `getCredential(slug,{role,runtime})` fail-loud avec fallback
`.env` opt-in, deux comptes Stripe (`stripe-institut`, `stripe-dev`), Brevo, et un système
d'identités expéditrices **plus riche que la référence** (`CommunicationIdentity` : rôles
commerciale/support, vérification OTP Brevo, DNS). **Manquaient** : la surface de gestion
(routes d'écriture + test de connexion + UI DEV), l'état `verified`, et le vestige `MAIL_FROM`
provoquait des drops silencieux. Trois bugs de parcours (signup incohérent, suppression
notification 404, RefundRecovery en boucle infinie) polluaient l'expérience et les logs.

## 2. Écarts avec la référence

Voir le tableau complet dans `INTEGRATED_API_BEAUTYSAVAGE_GAP_AUDIT.md` §2/§9. Écarts
critiques comblés : absence de test de connexion / `verified` / `verifiedFingerprint`, absence
de routes d'écriture, absence d'UI DEV, signup incohérent, notif 404, RefundRecovery infini.

## 3. Architecture retenue

Ne **pas** re-modéliser : conserver le coffre, le modèle `IntegratedApi`, le resolver, les
deux slugs Stripe et `CommunicationIdentity`. **Ajouter** : état de vérification par runtime,
service de test de connexion, routes DEV + sérialisation masquée, page React de gestion.
**Retirer** : le vestige `MAIL_FROM`. **Corriger** : signup, notifications, RefundRecovery.

## 4. Fournisseurs retenus

| Slug | accountPurpose | runtimeModel | Rôles | Consommateurs |
|---|---|---|---|---|
| `stripe-institut` | customer_payments | dual_environment (TEST/PROD) | secret_key*, webhook_secret*, publishable_key | encaissement clients, checkout, remboursements, factures, webhook `/api/stripe/webhook` |
| `stripe-dev` | platform_billing | dual_environment (TEST/PROD) | secret_key*, webhook_secret*, publishable_key | abonnement SaaS, frais de lancement, commissions, webhook `/api/stripe/dev-webhook` |
| `brevo` | messaging | single | api_key*, webhook_secret | e-mail transactionnel |

Slugs kebab-case **conservés** (pas de renommage `SCREAMING_SNAKE` : migration risquée sur
~15 consommateurs pour un gain cosmétique). Source de vérité : `utils/integratedApiCatalog.js`.

## 5. Modèles

- `IntegratedApi` (+ `verifications[]` : `{runtime, verified, verifiedAt, verifiedFingerprint,
  lastTestedAt, lastTestStatus, lastTestMessage, lastTestDetails}`, helpers
  `getVerification/setVerification/resetVerification`). Additif, rétro-compatible.
- `RefundRequest` (+ `stripeRefundAttempts, lastRefundAttemptAt, nextRefundRetryAt,
  lastRefundErrorCode, refundRetryable, refundFailedFinalAt`). Additif.
- **Expéditeur** : pas de nouveau modèle `EmailConfiguration` — `CommunicationIdentity` (existant)
  reste la source, plus riche (multi-identités commerciale/support, OTP, DNS).

## 6. Migrations

Aucune migration destructive nécessaire (tous les champs sont additifs avec défauts sûrs) :
- `verifications` absent → traité comme non vérifié.
- Champs de reprise refund absents → défauts (`retryable`, 0 tentative).
- Seed dev `seedDevCommunicationIdentity` (dev-only, idempotent, no-op en prod) crée une
  identité `commerciale` vérifiée pour les envois locaux. Le seed coffre existant
  (`seedIntegratedApisFromEnv`) et le CLI de migration restent inchangés.

## 7. Resolver

`getCredential(slug,{role,runtime})` inchangé (canonique : `runtime ?? api.mode`, fail-loud,
fallback `.env` opt-in). Ajouts : `resolveTargetRuntime`, `readSpecificCredential`,
`computeRuntimeFingerprint` (sha256 des `encryptedValue` actifs d'un runtime),
`isProviderVerified` (vérif d'empreinte), `markProviderVerified/Unverified`.

## 8. Stripe

Les 4 `getStripe()` ad-hoc (refundExecutionService, salesController, invoiceController,
stripeInvoiceService) sont consolidés sur l'accesseur canonique `getStripeClient()` (institut).
`getStripeDevClient()` inchangé (plateforme, optionnel). Webhooks per-provider inchangés.

## 9. Brevo

Clé via coffre `getCredential('brevo',{role:'api_key'})`. Transport `postToBrevo` inchangé,
mais log d'absence de clé typé `API_KEY_MISSING`. Test de connexion `GET /v3/account` (header
`api-key`), 401 = « clé invalide OU IP non autorisée ».

## 10. EmailConfiguration

Non réintroduit. Le vestige `MAIL_FROM`/`MAIL_FROM_NAME` est **supprimé** de
`mailSenderResolver` : l'expéditeur vient exclusivement de `CommunicationIdentity`. Ajout de
`resolveSenderStrict` + `SenderNotConfiguredError` pour les envois critiques.
`resolveInstituteEmail` (e-mail de contact institut, concern distinct) garde son fallback
`INVOICE_CONTACT_EMAIL`/`MAIL_FROM` — ce n'est PAS l'expéditeur des e-mails.

## 11. Signup

Compte créé (pending, `emailVerified=false`) → envoi du code → **si succès** : notification
institut `new_client` + 200 ; **si échec** : 202 `ACCOUNT_PENDING_VERIFICATION` (resumable,
`canResend`), **aucune** notification, pas de 500 générique. Reprise = 409
`EMAIL_NOT_VERIFIED_PENDING` (+ endpoint resend existant).

## 12. Notifications

`deleteNotification`/`markAsRead` matchent le `_id` Mongo (envoyé par le front) OU le
`notificationId` métier → fin du 404. Scoping d'audience préservé. Suppression idempotente
(200, `deleted:false` si déjà absente) → la liste se re-synchronise.

## 13. Refund recovery

Cycle borné : `classifyRefundError` (MISSING_CREDENTIAL / TRANSACTION_NOT_FOUND /
PROVIDER_UNAVAILABLE / RATE_LIMITED / INVALID_STATE / UNKNOWN). MISSING_CREDENTIAL → différé
(jamais final) ; terminal → `refundFailedFinalAt` ; retryable → backoff exponentiel, plafond 5
→ final. Sélecteur exclut final + non-dus. **Une** ligne de résumé par cycle
(inspected/recovered/deferred/finalFailed/configurationBlocked/stripeConfigured).

## 14. Sécurité

AES-256-GCM inchangé, `CREDENTIAL_VAULT_KEY` fail-closed au boot. Sérialisation masquée
(`configured`+`maskedValue`, jamais `encryptedValue`). Routes DEV-only (`requireStrictDev`).
Activation PROD gardée (configuré + vérifié + phrase). Secrets jamais loggés/renvoyés/en clair.

## 15. Tests

Backend : `integratedApiManagement` (routes/masque/empreinte/garde PROD/test mocké),
`mailSenderResolverNoMailFrom`, `notificationDeleteById`, `signupVerificationCoherence`,
`refundRecoveryLifecycle` ; `mailServiceCharacterization` mis à jour. Front :
`integratedApi.test.ts` (api-client). Suites de régression `test:communication` (42) et p0
vertes. (Résultats détaillés en fin de mission.)

## 16. Limites restantes

- `projectContext.json` (fichier volumineux généré) non modifié mécaniquement pour éviter toute
  corruption — à régénérer par l'outillage projet.
- Dette **préexistante** (hors périmètre, non introduite ici) : erreurs de typecheck dans
  `features/catalogue/learning/EvaluationEditor.tsx` (Checkbox sans `label`) et
  `features/results/EvaluationResultPage.test.tsx` — `vite build` (esbuild) n'y est pas
  sensible ; à corriger par l'équipe évaluation.
- Test de rendu React de la page de gestion non ajouté (couverture via api-client + build +
  lint) — amélioration possible.
- `runtime`/mode Brevo : `single` (pas de séparation TEST/PROD Brevo) — conforme à l'existant.
