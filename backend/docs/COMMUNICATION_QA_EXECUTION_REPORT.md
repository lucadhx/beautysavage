# Recette Communications — Rapport d'exécution

> Exécution de la recette des parcours communication après le portage IntegratedAPI.
> Preuves = tests automatisés reproductibles (backend Vitest). Les vérifications nécessitant
> une clé Brevo réelle + une boîte mail réelle sont signalées « manuel restant » (non
> exécutables en environnement headless, sans secret).

| Parcours | Résultat | Preuve (test automatisé) | Anomalie |
|---|---|---|---|
| Brevo — configurer/tester/masquer/verified | ✅ | `tests/p1/integratedApiManagement.test.js` (test de connexion Brevo 401 mocké → verified=false ; valeurs masquées ; empreinte) | — |
| Stripe — configurer TEST/PROD, préfixes, verified, activation gardée | ✅ | `tests/p1/integratedApiManagement.test.js` (préfixe sk_live_ refusé en TEST ; test mocké → verified ; changement de clé invalide verified ; PROD MODE_NOT_VERIFIED/CONFIRMATION_REQUIRED) | — |
| Expéditeur = CommunicationIdentity, plus de MAIL_FROM | ✅ | `tests/p1/mailSenderResolverNoMailFrom.test.js` (sans identité → buildSender null ; resolveSenderStrict → SENDER_NOT_CONFIGURED ; seed dev → expéditeur DB) | — |
| Clé Brevo absente → erreur typée | ✅ | `tests/p1/mailServiceCharacterization.test.js` (SendLog errorCode `API_KEY_MISSING`) | — |
| Signup — envoi OK → 200 + compte pending + notif au bon moment | ✅ | `tests/p1/signupVerificationCoherence.test.js` (200, emailVerified=false, `triggerNotification('new_client')` appelé) ; `tests/integration/auth.test.js` | — |
| Signup — envoi KO → 202 ACCOUNT_PENDING_VERIFICATION, aucune fausse notif, resumable | ✅ | `tests/p1/signupVerificationCoherence.test.js` (202, canResend, emailSent:false, notif NON appelée ; 2e tentative → 409 EMAIL_NOT_VERIFIED_PENDING) | — |
| Notifications — suppression/lecture par `_id` (front) et `notificationId` ; idempotent ; audience | ✅ | `tests/p1/notificationDeleteById.test.js` (delete par _id → 200 deleted:true ; double → 200 deleted:false ; scoping ; mark-read par _id) ; `tests/p1/notificationTargetRoutes.test.js` | — |
| RefundRecovery — credential absent → différé (jamais final) | ✅ | `tests/p1/refundRecoveryLifecycle.test.js` (MISSING_CREDENTIAL → configurationBlocked, refundFailedFinalAt null, non re-inspecté au cycle suivant) | — |
| RefundRecovery — transaction introuvable → terminal, non retraité | ✅ | `tests/p1/refundRecoveryLifecycle.test.js` (TRANSACTION_NOT_FOUND → refundFailedFinalAt, exclu au cycle suivant) | — |
| RefundRecovery — erreur temporaire → backoff, plafond → abandon ; résumé | ✅ | `tests/p1/refundRecoveryLifecycle.test.js` (classifyRefundError ; plafond 5 → final) + `tests/p1/refund.recovery.test.js` (recovery job) | — |
| Suite Communication (durcissement, templates, triggers, reminders, avis, gift-card PIN) | ✅ | `npm run test:communication` — 8 fichiers / 42 tests verts | — |

## Logs résiduels — vérification

Après le portage, ces chaînes ne sont plus produites dans les chemins concernés :

- `MAIL_FROM inutilisable` → remplacé par `SENDER_NOT_CONFIGURED` (typé) ;
- `email ignore` (drop silencieux) → `API_KEY_MISSING` / message explicite ;
- `no active credential ... (runtime=null)` en boucle refund → classé `MISSING_CREDENTIAL`,
  différé, résumé en une ligne (`[RefundRecovery] startup: inspected=… configurationBlocked=…`).

Une erreur de credential volontairement provoquée est désormais typée, associée au bon
provider/mode, sans secret (`CredentialNotFoundError` / `SenderNotConfiguredError`).

## Manuel restant (non exécutable headless, sans secret réel)

1. Saisie d'une **clé Brevo réelle** dans l'UI DEV `/dev/integrated-api` → « Tester » →
   attendu « Clé Brevo valide » (compte/plan affichés). Ici prouvé avec réponses mockées ;
   la seule vérification restante est l'appel réseau réel vers `GET /v3/account`.
2. **Livraison réelle** d'un e-mail (code de vérification) via une identité `commerciale`
   vérifiée par OTP Brevo + réception dans une boîte mail. Le rendu/déclenchement est prouvé ;
   la remise effective dépend de l'acceptation Brevo (webhook).
3. Saisie d'une **clé Stripe réelle** + webhook signé de bout en bout (paiement test).

Ces trois points nécessitent des credentials réels et un environnement connecté ; ils sont
décrits pas-à-pas dans `docs/INTEGRATED_API_AND_COMMUNICATION_QA.md`.
