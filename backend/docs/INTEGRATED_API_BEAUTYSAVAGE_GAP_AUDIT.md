# IntegratedAPI — Audit comparatif BeautySavage ↔ Référence

> **Nature** : audit **read-only** (Phase 1). Aucun fichier applicatif modifié ; seuls
> des documents `docs/` sont créés. Aucun secret n'est affiché — tout est `[REDACTED]`.
> **Référence** : `INTEGRATED_API_REFERENCE_REPORT.md` (projet SB Auto, branche `feat/brevo`).
> **Cible** : BeautySavage (`backend/`, branche `phase-0-security-baseline`, HEAD `c45c2b8`).
> **Date** : 2026-07-22.

---

## 0. Constat majeur (à lire en premier)

Contrairement à ce que suggère le brief (« restaurer une architecture cohérente »),
**BeautySavage possède déjà ~80 % de l'architecture de la référence**, et sur plusieurs
axes elle est **plus riche** que la référence :

| Brique | Référence | BeautySavage | Verdict |
|---|---|---|---|
| Coffre chiffré AES-256-GCM | `integratedApiCrypto.js` | `utils/credentialVault.js` | ✅ **présent, équivalent** |
| Clé maître dédiée | `INTEGRATED_API_ENCRYPTION_KEY` | `CREDENTIAL_VAULT_KEY` | ✅ présent (fail-closed uniforme) |
| Un doc par fournisseur | `IntegratedApi` | `models/IntegratedApi.js` | ✅ présent |
| Modes TEST/PROD + activeMode | `modes.TEST/PROD` + `activeMode` | `runtimeModel` + `mode` + `credentials[].runtime` | ✅ présent (forme différente) |
| Resolver fail-loud, no-fallback | `getCredential(p, field, {mode})` | `getCredential(slug, {role, runtime})` | ✅ présent |
| Deux comptes Stripe | ❌ (un seul `STRIPE`) | `stripe-institut` + `stripe-dev` | ✅ **BS plus riche** |
| Identité expéditrice séparée | `EmailConfiguration` (nom+adresse) | `CommunicationIdentity` (OTP-vérifiée, rôles commerciale/support, DNS) | ✅ **BS plus riche** |
| Masquage `lastFour` | ✅ | ✅ (`lastFourChars`) | ✅ présent (non exposé en UI) |
| **UI DEV de gestion** (configurer/tester/activer/supprimer) | ✅ `/dev/integrations` | ❌ **read-only diagnostics only** | 🔴 **ABSENT** |
| **Routes backend d'écriture** credentials | ✅ `/api/integrated-apis` | ❌ **aucune** (CLI/.env seulement) | 🔴 **ABSENT** |
| **Test de connexion + `verified` + fingerprint** | ✅ | ❌ **aucun** | 🔴 **ABSENT** |
| `MAIL_FROM` comme dépendance | ❌ (n'existe pas) | ⚠️ **vestige** dev-only dans `mailSenderResolver` | 🟠 à retirer |

**Conclusion** : la mission n'est **pas** un portage from-scratch. C'est (1) **construire la
surface de gestion manquante** (routes + test de connexion + UI DEV), (2) **retirer le
vestige `MAIL_FROM`**, et (3) **corriger 3 bugs de parcours** (signup incohérent, suppression
notification 404, RefundRecovery en boucle infinie). Les incidents du brief ne viennent pas
d'une architecture cassée mais de **credentials jamais chargés dans le coffre** (Stripe/Brevo)
et d'une **identité expéditrice non configurée**.

---

## 1. Inventaire BeautySavage

### 1.1 Coffre / IntegratedAPI

| Zone | Fichier | Rôle actuel | Statut |
|---|---|---|---|
| Modèle | `models/IntegratedApi.js` | 1 doc/fournisseur ; `slug`, `provider`, `accountPurpose`, `runtimeModel`, `mode`, `credentials[]` | OK |
| Crypto | `utils/credentialVault.js` | AES-256-GCM `iv.tag.ct`, clé `CREDENTIAL_VAULT_KEY` (64 hex), fail-closed boot | OK |
| Resolver | `services/integratedApiCredentialService.js` | `getCredential/getCredentials/setIntegratedApiMode`, erreurs typées, fallback `.env` opt-in | OK (pas de route) |
| Seed | `seeders/seedIntegratedApisFromEnv.js` | pré-seed idempotent depuis `.env` au boot (hors test) | OK |
| Migration | `scripts/migrateEnvCredentialsToIntegratedApi.js` | CLI dry-run/`--apply` | OK |
| Rotation | `scripts/rotateCredentialVaultKey.js` | re-chiffrement OLD→NEW | OK |
| Diagnostic (RO) | `frontend-react/apps/manager/src/features/devPanel/pages.tsx:331` `IntegratedApiDiagnosticsPage` | affiche pubkey tronquée + checkouts | RO seulement |
| Tests | `tests/p1/{credentialVault,credentialVaultRotation,integratedApiCredentials,integratedApiSeed,integratedApiAccountPurpose,integratedApiEnvFallbackPolicy,stripeCredentialMigration,stripeWebhookCredentialVault,envDecommissionRuntime}.test.js` | couvrent crypto/resolver/seed | OK |

**Aucune route HTTP d'écriture** : `setIntegratedApiMode` est exporté mais **non monté**. Les
credentials n'entrent que par `.env → seeder` ou CLI.

### 1.2 Stripe

| Domaine | Slug | Accès |
|---|---|---|
| Paiements clients, checkout, webhooks, **remboursements**, ventes, factures, frais Stripe | `stripe-institut` (`customer_payments`) | `services/stripe/stripeConfigService.js:13` `getStripeClient()` **fail-loud** + 4 copies ad-hoc (`refundExecutionService.js:19`, `salesController.js:32`, `invoiceController.js:9`, `stripeInvoiceService.js:10`) |
| Abonnement SaaS institut, frais de lancement, commissions plateforme, SetupIntents | `stripe-dev` (`platform_billing`) | `services/stripe/dev/stripeDevConfigService.js:19` `getStripeDevClient()` **retourne `null`** si absent (avale l'erreur) |

Webhooks séparés : `/api/stripe/webhook` (institut, secret via `stripe-institut`), `/api/stripe/dev-webhook` (plateforme, secret via `stripe-dev`), montés avant `express.json()`.

### 1.3 E-mail / Brevo

| Zone | Fichier | Rôle |
|---|---|---|
| Transport | `services/mail/mailBrevoGateway.js:9` `postToBrevo` | clé via `getCredential('brevo',{role:'api_key'})` (throw avalé→`''`), POST `/v3/smtp/email`, **ne throw jamais** |
| Résolution expéditeur | `services/mail/mailSenderResolver.js:13` `buildSenderForRole` | `resolveSender(role)` → `CommunicationIdentity` active+verified ; **fallback `.env MAIL_FROM` si `NODE_ENV!=='production'`** ; sinon `null` |
| Dispatchers legacy (Path A) | `services/mail/mailDomainDispatchers.js` | 12 sites loggant `MAIL_FROM inutilisable` sur sender `null` |
| Moteur par rôles (Path B) | `services/mail/mailEventDispatchService.js`, `authMailService.js` | `resolveSender` → statut `identity_missing`, ne log pas `MAIL_FROM` |
| Identité expéditrice | `models/CommunicationIdentity` + `services/communicationIdentityService.js` | rôles `commerciale`/`support`, OTP Brevo, DNS ; UI `IdentityManager.tsx` |

**Pas de modèle `EmailConfiguration`** (0 occurrence). L'équivalent = `CommunicationIdentity`.

### 1.4 Signup / Notifications

| Zone | Fichier |
|---|---|
| Signup | `routers/authRouter.js:249` (`POST /signup`), helper `issueAndSendVerificationCode:165` |
| Notification institut | `services/notificationService.js:52` `triggerNotification`, event `new_client` |
| Suppression notif | `controllers/notificationController.js:151/178`, `routers/notificationRouter.js:27` |
| Modèle notif | `models/Notification.js` (`notificationId` = `NOTIF-XXXX` unique ; `_id` distinct) |
| API front notif | `frontend-react/packages/api-client/src/manager/notifications.ts:171`, hook `useNotifications.ts` |

### 1.5 Remboursements / Jobs

| Zone | Fichier |
|---|---|
| Job recovery | `automatisme/refundRecoveryJob.js` (boot + 1 h), `services/refundRecoveryService.js` |
| Exécution refund | `services/refundExecutionService.js:169` `triggerRefundExecution` |
| Job annulation session | `automatisme/sessionCancellationAutoRefundJob.js` (boot + 02:00) |
| Modèle | `models/RefundRequest.js` (compteur `giftCardRecreditAttempts` seulement pour recredit carte cadeau) |

---

## 2. Comparaison structurelle

| Domaine | Référence | BeautySavage | Écart | Gravité |
|---|---|---|---|---|
| Modèle IntegratedApi | `modes.{TEST,PROD}.credentials` Map | `credentials[]` array + `runtime` par credential + `mode` provider | forme différente, **fonctionnellement équivalent** | secondaire |
| Fournisseurs | 1 STRIPE + BREVO + YOUSIGN | `stripe-institut` + `stripe-dev` + `brevo` (pas de Yousign) | BS a 2 Stripe (légitime) | secondaire |
| Modes TEST/PROD | `modes.TEST` / `modes.PROD` | `runtimeModel single\|dual_environment` + `credentials[].runtime test\|prod` | équivalent ; `single` = pas de séparation | secondaire |
| activeMode | `activeMode` (stocké) | `mode` (stocké, test\|prod) | équivalent | secondaire |
| Resolver | `mode ?? activeMode`, no-fallback | `runtime ?? api.mode`, fallback `.env` **opt-in** | équivalent (+ fallback gaté) | secondaire |
| Chiffrement | AES-256-GCM, clé hex64 | idem, `CREDENTIAL_VAULT_KEY` | aucun | — |
| Masquage | `configured`+`maskedValue` | `lastFourChars` (non sérialisé au front) | **pas de sérialisation masquée exposée** | important |
| verified | par mode + empreinte sha256 | **absent** | 🔴 | **critique** |
| verifiedFingerprint | présent | **absent** | 🔴 | **critique** |
| Test fournisseur | `GET /v1/account`, `/account`, `/users` | **absent** (pas de test de connexion) | 🔴 | **critique** |
| UI DEV | page data-driven configure/test/activer | **read-only diagnostics** | 🔴 | **critique** |
| Brevo API key | IntegratedAPI | vault `brevo/api_key` | aucun | — |
| Sender email | `EmailConfiguration` par mode | `CommunicationIdentity` (plus riche) + **vestige `MAIL_FROM`** | vestige à retirer | important |
| Stripe | 1 provider, client caché | 2 providers, **4 accès `getStripe()` dupliqués** | duplication | important |
| Webhooks | signature custom par mode + garde cross-mode | `constructEvent` standard par provider | pas de garde cross-mode (mono-mode de fait) | secondaire |
| Seeds | idempotent, credentials vides | idempotent **depuis `.env`** | dépend de `.env` (S1C : `.env` vidé → rien seedé) | important |
| Erreurs | typées, `code` unifié | typées (`CredentialNotFoundError` etc.) mais **discardées par le pipeline refund** | classification perdue en aval | important |
| Tests | suite dédiée | couvre coffre/resolver ; **rien sur routes/test-connexion/UI** (inexistants) | à créer | important |

---

## 3. Slugs Stripe réels

BeautySavage utilise **deux slugs légitimes et distincts** (confirmé par `accountPurpose`) :

- **`stripe-institut`** (`customer_payments`) — l'institut **encaisse** ses clients :
  paiements, réservations, formations, boutique, cartes cadeaux, **remboursements**, ventes,
  factures, Checkout Sessions, webhook `/api/stripe/webhook`.
- **`stripe-dev`** (`platform_billing`) — l'institut **paie la plateforme** :
  abonnement SaaS récurrent, frais de lancement (one-off), commissions, SetupIntents,
  webhook `/api/stripe/dev-webhook`.

**Décision : conserver les deux.** Les responsabilités, comptes Stripe propriétaires et
webhooks diffèrent réellement → fusionner serait une régression. La convention actuelle
(kebab-case) est **cohérente** ; renommer en `STRIPE_INSTITUTE`/`STRIPE_PLATFORM` imposerait
une migration risquée sur ~15 consommateurs pour un gain purement cosmétique → **non retenu**
(voir Phase 2 pour arbitrage utilisateur).

**Dette** : 4 copies ad-hoc de `getStripe()` (institut) → à consolider sur `getStripeClient()`.

---

## 4. `runtime=null`

- **Classe** : `CredentialNotFoundError` (`integratedApiCredentialService.js:19-21`).
- **Message** : `` `[credentialService] no active credential: ${slug}/${role} (runtime=${runtime ?? 'null'})` ``.
- **Signature resolver** : `getCredential(slug, { role='default', runtime=null } = {})`.
- **Valeurs `runtime`** : `'test' | 'prod' | null`. Pour `runtimeModel='single'` → doit être `null`
  (sinon `RuntimeMismatchError`). Pour `dual_environment` → `runtime || api.mode`.
- **Origine du `null`** : les 4 `getStripe()` appellent `getCredential('stripe-institut',{role:'secret_key'})`
  **sans** `runtime` → le message imprime l'argument brut `null`. Ce n'est **pas** couplé à `NODE_ENV`.
- **Cause exacte du `no active credential`** : le doc `stripe-institut` **n'a aucun credential actif
  `secret_key`** (le `.env` a été vidé — S1C — et rien n'a été migré dans le coffre, `ALLOW_ENV_CREDENTIAL_FALLBACK≠true`).
- **Comparaison référence** : identique dans l'esprit (`resolvedMode = mode ?? activeMode`). Le
  concept `runtime` **est déjà** l'équivalent de `opts.mode`.

**Décision** : `runtime` **conservé** (déjà canonique). Le `(runtime=null)` du log n'est pas un
bug de conception mais l'affichage de l'argument omis ; le vrai problème est l'**absence de
credential seedé**, résolue par la surface de gestion + un seed de coffre. Améliorer le message
d'erreur pour afficher le **runtime effectif résolu** (`api.mode`) plutôt que l'argument brut.

---

## 5. `MAIL_FROM`

`MAIL_FROM`/`MAIL_FROM_NAME` **n'existent que** comme fallback **dev-only** dans
`mailSenderResolver.js:27-33` (`NODE_ENV!=='production'`). Source réelle de l'expéditeur =
`CommunicationIdentity` (active+verified, rôle `commerciale`/`support`).

### Matrice e-mail (26 types — extrait des plus critiques)

| Email | Service | Credential | Sender | Échec bloquant | Traçage |
|---|---|---|---|---|---|
| **Code de vérification (signup)** | `sendEmailConfirmationCodeEmail` (Path A) | `brevo/api_key` | `buildSender()` (commerciale) | **OUI → HTTP 500** | log `MAIL_FROM inutilisable` + throw `VERIFICATION_EMAIL_SEND_FAILED` |
| **Renvoi du code** | idem | idem | idem | **OUI → 500** | idem |
| Reset mdp client/manager | `authMailService` (Path B) | `brevo/api_key` | `resolveSender` | non (anti-énumération) | swallowed, succès générique |
| Confirmation vente + facture | `sendSaleEmail` (Path A) | `brevo/api_key` | `buildSender()` | non (`void`) | swallowed (`return;`) |
| Réservation confirmée/annulée/rappel | Path A | `brevo/api_key` | `buildSender()` | non | swallowed (`return false`) |
| Remboursement (demandé/confirmé/refusé/échoué) | Path A | `brevo/api_key` | `buildSender()` | non | swallowed |
| Carte cadeau (créée/débitée, PJ PDF) | `sendGiftCardEventMail` (Path B) | `brevo/api_key` | `resolveSender` | non | `{mail:'identity_missing'\|'failed'}` |
| Diplôme / certificat éval (PJ PDF) | `dispatchTemplateByRoles` (Path B) | `brevo/api_key` | `resolveSender` | non | `{mail:'failed'}` |
| Attestation formation | `sendCertificateAvailableEmail` (Path A) | `brevo/api_key` | `buildSender()` | non (`void`) | swallowed |
| Avis | triggers Path B | `brevo/api_key` | `resolveSender` | non | statut |
| Envoi de test (Communication Center) | `testSendTemplate` inline | `brevo/api_key` | `buildSender()` | non (409 si null) | HTTP 409 `Aucune identité d'expédition` |

**Constat** : `MAIL_FROM inutilisable` = **sender-identity non configurée** (pas de `commerciale`
verified, et pas de `MAIL_FROM` en dev). 25/26 e-mails l'avalent silencieusement ; **seul le code
de vérification** en fait un 500 bloquant.

**Décision** : retirer la dépendance fonctionnelle `MAIL_FROM` (le sender vient de
`CommunicationIdentity`). Politique d'échec explicite : `SENDER_NOT_CONFIGURED` / `API_KEY_MISSING`
au lieu du log opaque + drop silencieux (voir Phase 2 §5). Stratégie dev à arbitrer (§Phase 2).

---

## 6. Bug d'inscription (`POST /auth/signup`)

Ordre réel (`authRouter.js:249-343`) :
1. validation → 2. doublon (`User.findOne`) → 3. hash → 4. **`User.create` (committé, `emailVerified:false`)** →
5. **`void triggerNotification('new_client')` (fire-and-forget, AVANT l'e-mail)** →
6. `issueAndSendVerificationCode` : génère + **stocke OTP** (`findByIdAndUpdate`) → **envoie e-mail** →
7. si `!emailSent` → throw `VERIFICATION_EMAIL_SEND_FAILED` → **HTTP 500**.

- **Aucune transaction Mongo.** Rien n'est rollback.
- Après le 500 : **User persiste** (`emailVerified:false`), **OTP persiste** (écrit avant l'envoi),
  **notification institut déjà créée**.
- 2e tentative → **409 `EMAIL_NOT_VERIFIED_PENDING`** (parcours de reprise via `/auth/resend-verification`).
- **Incohérence** : la notification « Nouveau client inscrit » est créée **avant** l'e-mail et
  survit à l'échec ; le client voit « inscription échouée » alors que compte + OTP + notif existent.

**Contrat attendu** (Phase 2 §H) : compte créé (pending) ; notification **après** succès e-mail ;
réponse cohérente non-500 permettant « Renvoyer le code ».

---

## 7. Notifications (`DELETE …/:id` → 404)

- Front : `deleteNotification(scope,id)` (`notifications.ts:171`) où `id = notification.id = n._id.toString()`
  (sérialisé `notificationController.js:63`).
- Back : `router.delete('/:notificationId', deleteNotification)` → `Notification.deleteOne({ notificationId, ...accessFilter })`
  (`notificationController.js:155`).
- **Cause racine** : mismatch de champ. Le param d'URL (nommé `notificationId`) reçoit le **`_id` Mongo**,
  mais la requête filtre sur le champ métier `notificationId` (`NOTIF-XXXX`). `_id` ≠ `NOTIF-…` →
  `deletedCount=0` → **404**.
- **Même bug** pour mark-as-read (`markAsReadCore` filtre `{notificationId}`).
- Front : sur 404, `onSuccess` (invalidate) ne s'exécute pas → liste non rafraîchie, compteur figé.

**Décision** (Phase 2 §I) : faire correspondre le backend sur `_id` (accepter le `id` sérialisé),
couvrir **delete + read**, statut `204` sur succès, idempotence, resync front.

---

## 8. Remboursements / jobs

- `refundRecoveryService.js:14` sélectionne **tous** les `RefundRequest` en `requested|pending`,
  **sans** filtre attempts/backoff/terminal. Boucle boot + 1 h → réessais **infinis**.
- `refundExecutionService.js` lève 2 erreurs terminales retraitées en boucle :
  `no active credential` (credential manquant) et `Remboursement Stripe impossible: transaction introuvable`
  (`:291`, `sale.stripePaymentIntentId` vide).
- `models/RefundRequest.js` : **aucun** `attemptCount`/`nextRetryAt`/`failedFinalAt`/`lastErrorCode`/`retryable`
  côté Stripe (existe seulement `giftCardRecreditAttempts` pour le recredit carte cadeau — **template**).
- Erreurs typées **discardées** (`recoverRefundRequest` renvoie `error` opaque) → aucune classification.

**Décision** (Phase 2 §J) : classification (`MISSING_CREDENTIAL`/`TRANSACTION_NOT_FOUND`/`PROVIDER_UNAVAILABLE`/
`RATE_LIMITED`/`INVALID_STATE`/`UNKNOWN`), état terminal `failedFinalAt`, `attemptCount`+`nextRetryAt`,
skip si Stripe non configuré, **résumé au boot** au lieu de N stacks.

---

## 9. Classement des écarts

| Écart | Gravité |
|---|---|
| Pas de test de connexion + `verified` + `verifiedFingerprint` | **critique** |
| Pas de routes backend d'écriture des credentials | **critique** |
| Pas d'UI DEV configurer/tester/activer/supprimer + mode TEST/PROD | **critique** |
| Signup incohérent (notif avant e-mail, 500 générique, pas de rollback) | **critique** |
| Suppression/lecture notification 404 (mismatch `_id`/`notificationId`) | **critique** |
| RefundRecovery boucle infinie (pas de terminal/backoff/classif) | **critique** |
| Vestige `MAIL_FROM` + drop silencieux au lieu d'erreur typée | important |
| Sérialisation masquée non exposée au front (`lastFourChars`) | important |
| 4 `getStripe()` dupliqués (institut) | important |
| Seed dépend de `.env` (vidé S1C) → coffre vide | important |
| Classification d'erreurs perdue dans le pipeline refund | important |
| Pas de garde cross-mode webhook | secondaire |
| Slugs kebab vs convention `SCREAMING_SNAKE` de la réf | cosmétique |

---

## 10. Architecture cible retenue → voir `INTEGRATED_API_PORT_REPORT.md` (Phase 2+)

Résumé des décisions (détail Phase 2) :
1. **Conserver** le coffre + modèle `IntegratedApi` existants ; **ne pas** re-modéliser.
2. **Conserver 2 slugs Stripe** `stripe-institut`/`stripe-dev` (pas de renommage).
3. **Ajouter** au modèle : `verified`, `verifiedAt`, `verifiedFingerprint`, `lastTest*` par credential-set.
4. **Créer** un service de test de connexion (Stripe `/v1/account`, Brevo `/v3/account`).
5. **Créer** des routes DEV `/api/gestion/dev/integrated-api/*` (list/detail/update/delete/test/set-mode) + sérialisation masquée.
6. **Créer** une page DEV React (cartes fournisseurs, TEST/PROD, configurer/tester/activer/supprimer).
7. **Sender** : rester sur `CommunicationIdentity` ; **retirer** le vestige `MAIL_FROM` ; erreurs `SENDER_NOT_CONFIGURED`/`API_KEY_MISSING`.
8. **Signup** : réordonner (notif après e-mail) + réponse cohérente resumable.
9. **Notifications** : matcher sur `_id` (delete+read), `204`, resync front.
10. **RefundRecovery** : état terminal + classification + backoff + skip-si-non-configuré + résumé boot.
