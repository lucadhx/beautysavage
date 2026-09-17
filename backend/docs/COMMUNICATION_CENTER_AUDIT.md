# COMMUNICATION CENTER — Audit exhaustif

> Mission `COMMUNICATION-CENTER-AUDIT` — branche `phase-0-security-baseline`.
> Audit **code-first** de tout le système de communication (e-mails, notifications internes,
> déclencheurs, templates, éditeur, variables, identités, logs, idempotence, sécurité).
> Toutes les affirmations sont ancrées sur des `fichier:ligne` réels (relevé par 6 agents
> d'exploration en lecture seule + 3 sous-agents de couverture métier). **Aucun fichier n'a été
> modifié pendant la phase d'audit.**

---

## 0. Résumé exécutif

Beauty Savage possède déjà une **infrastructure de communication riche et globalement propre** :
un gateway Brevo unique (`postToBrevo`), un modèle d'identités d'expédition (`CommunicationIdentity`),
un registre de règles de dispatch par rôles (`mailDispatchRules`), un ledger d'idempotence
(`MailEventDelivery`), un ledger d'observabilité (`SendLog`), trois studios de templates versionnés
(mail / notification / carte cadeau), et une UI manager/dev (identités + supervision).

**Mais il n'existe PAS un moteur unique.** La réalité runtime est un empilement de **quatre chemins
d'envoi concurrents**, le moteur événementiel « cible » étant **désactivé par défaut** :

| Chemin | Statut runtime | Qui l'emprunte |
|---|---|---|
| **A.** Envois directs `send*Email` (`mailDomainDispatchers.js`) | **ACTIF** (chemin réel aujourd'hui) | sale, booking, refund, commission, sessions, no-show, site status |
| **B.** Auth dédié (`authMailService.js`) | **ACTIF** | invitation manager, reset manager, reset client |
| **C.** Moteur par rôles via event bus (`mailEventSubscriber` → `dispatchMailForEvent`) | **NO-OP** (`MAIL_ROLE_RESOLVER_ENABLED` absent du `.env` → `false`) | rien en pratique (shadow) |
| **D.** Moteur par rôles appelé **impérativement** (`dispatchMailForEvent` direct) | **ACTIF** | gift cards (`giftCardMailService`), learning (`learningEventsService`) |

Le **bus d'événements** (`eventCatalog` + `emitEvent`) est explicitement **observabilité/audit
seulement** (« no side effects, no automatic triggers » — `constants/eventCatalog.js:2-4`). Les
émissions `emit*Event` sont donc **audit-only** tant que les flags subscribers sont OFF (ce qui est
le cas par défaut). Idem côté notifications internes : `EVENT_NOTIFICATION_SUBSCRIBER_MODE` absent →
`off`, donc seules les appels **directs** `triggerNotification` déclenchent quelque chose.

### Les 5 constats structurants

1. **Deux moteurs concurrents durables.** Le moteur par rôles (C/D) coexiste avec les envois directs
   (A/B) ; plusieurs règles sont en `directSenderExists:true` (shadow permanent). C'est exactement la
   dette « ne pas maintenir deux moteurs concurrents durablement » (§23 de la mission). Comme le flag
   est OFF, le `fromRole` déclaré dans les règles **n'est pas honoré** : tous les envois directs
   utilisent `buildSender()` = **commerciale**, y compris ceux censés partir de **support**.

2. **Couverture métier très partielle.** Sur ~90 moments métier recensés, une grosse moitié
   n'envoie **rien** : toute l'auth cliente hors reset (compte créé, e-mail vérifié, désactivation),
   la quasi-totalité du cycle de vie carte cadeau (usage, remboursement, envoi bénéficiaire, renvoi),
   **tous les avis** (0 comm), **toutes les alertes système/dev** (0 comm — code mort), plusieurs
   étapes de remboursement/paiement (échec paiement, refus/échec remboursement, commission payée).

3. **Éditeur HTML embryonnaire + pas d'envoi de test.** L'éditeur mail = 2 `<textarea>` bruts
   (HTML + texte), sans coloration ni lint. **Aucun envoi de test** n'existe (le seul « simulate-sale »
   envoie un **vrai** e-mail à un vrai client). Aperçu OK (iframe sandbox front). Catalogue de
   variables = miroir **hardcodé côté front**, non piloté par le backend.

4. **Sécurité correcte mais 3 angles à durcir.** (a) Les valeurs de variables runtime ne sont
   **pas HTML-échappées** à l'interpolation mail (surface d'injection, surtout sur les notices
   admin qui embarquent `{{customerName}}`/`{{clientEmail}}`). (b) **E-mails destinataires en clair
   dans les logs serveur** (3 sites). (c) Pas de secret réel dans le source tracké (vérifié).

5. **Pas de retry, idempotence solide côté event, absente côté direct.** `postToBrevo` = 1 seul
   `fetch`, `attempts:1`, aucun backoff. L'idempotence existe via `MailEventDelivery`
   (index unique) **mais uniquement pour le chemin moteur** ; les envois directs (A/B) n'ont pas de
   clé d'idempotence propre (ils s'appuient sur l'idempotence Stripe en amont). Aucune action
   « Renvoyer » n'existe.

**Verdict global :** socle solide, **non unifié**, **sous-couvert**, **non pilotable sans code**.
La cible (registre unique + éditeur + preview + test-send + logs + matrice) est atteignable
**sans réécriture** : il faut surtout (1) unifier le routage sender, (2) combler les triggers
manquants prioritaires, (3) finir l'UI (test-send, matrice, variables backend), (4) durcir sécu/logs.

---

## 1. Infrastructure d'envoi

### 1.1 Gateway & façade

| Fichier | Fonction | Rôle |
|---|---|---|
| `services/mail/mailBrevoGateway.js` | `postToBrevo(payload, context)` | **LE send canonique.** Crée un SendLog `queued`, récupère la clé Brevo via `getCredential('brevo',{role:'api_key'})`, POST `https://api.brevo.com/v3/smtp/email`, marque `sent`/`failed`. Ne throw jamais. |
| `services/mailService.js` | façade | Ré-exporte `postToBrevo`, `loadTemplate/saveTemplate`, tous les `send*Email`. API publique historique (cible des mocks). |
| `services/mail/mailDispatcher.js` | seam | Ré-export structurel des `send*Email`. |
| `services/mail/mailDomainDispatchers.js` | ~30 `send*Email` (2135 l.) | **Chemin A** — envois directs par domaine. |
| `services/authMailService.js` | `sendAuthMail`, `sendManager*`, `sendClientPasswordResetEmail` | **Chemin B** — auth, routage explicite `fromRole`. |
| `services/mail/mailEventDispatchService.js` | `dispatchMailForEvent`, `dispatchTemplateByRoles`, `recordDelivery` | **Chemins C/D** — moteur par rôles + ledger idempotent. |

Pas de nodemailer / SMTP / SibApiV3Sdk dans le chemin d'envoi. 100 % HTTP Brevo via `fetch`.
PDF via `pdfkit`. Le SDK-like `communicationBrevoSenderAdapter.js` sert **uniquement à la
vérification des senders**, pas à l'envoi.

### 1.2 Identités & résolution de rôles

- `models/CommunicationIdentity.js` — rôles `['support','commerciale']` (`client` jamais configurable).
  `ROLE_SCOPE = {support:'platform', commerciale:'institute'}`. Index partiel unique : **au plus une
  identité active par (role, scope)**. Aucun secret stocké.
- `services/communicationRoleResolver.js` — `resolveSender(role)`, `resolveRecipient(role, ctx)`
  (client = `ctx.client.email`), `resolveMailEnvelope({fromRole, toRole, context})`. **Aucun fallback
  hardcodé** ; throw `CommunicationIdentityError` si absent.
- `services/mail/mailSenderResolver.js` — `buildSender()` : source = identité **commerciale** ;
  fallback `MAIL_FROM`/`MAIL_FROM_NAME` **uniquement hors production**. En prod, identité absente →
  `null` → **e-mail silencieusement ignoré**.

### 1.3 Modèles de logs

- `models/SendLog.js` (`send_logs`) — observabilité par message : `channel`, `provider('brevo')`,
  `templateKey`, `recipientHash` (SHA-256, **jamais l'e-mail**), `status`
  `['queued','sent','delivered','opened','bounced','failed']`, `providerMessageId` (corrélation
  webhook), `subject`, `contextType/contextId`, `errorCode`, `errorMessageSafe`, timestamps.
  Écrit par `services/sendLogService.js`. Webhook Brevo : `controllers/brevoWebhookController.js` →
  `applyBrevoEvent`.
- `models/MailEventDelivery.js` (`mail_event_deliveries`) — **ledger d'idempotence du moteur** :
  `eventName`, `templateKey`, `fromRole`, `toRole`, `contextType/contextId`, `status`
  (`shadow|skipped_duplicate_direct_sender|skipped_rule_disabled|skipped_template_missing|identity_missing|client_missing|sent|failed`),
  `sendLogId`, `detailSafe`. **Index unique** `{eventName,contextType,contextId,templateKey}`.

### 1.4 Pièces jointes

Format Brevo : `payload.attachment = [{name, content(base64)}]`. Support attaché dans
`dispatchTemplateByRoles` (`mailEventDispatchService.js`).

| Chemin | Fichier | Détail |
|---|---|---|
| Carte cadeau en ligne | `controllers/giftCardController.js:276-283` | `gift_card.online_created`, PDF base64 best-effort |
| Carte cadeau manuelle | `controllers/giftCardController.js:1368-1375` | `gift_card.manual_created`, PDF best-effort |
| Rendu PDF carte cadeau | `services/giftCard/giftCardRenderService.js` | `renderGiftCardPdf` (pdfkit) / `renderGiftCardPreview` (base64) |

À noter : la **facture de commission** envoie une **URL de téléchargement, pas une pièce jointe**
(et n'a **aucun appelant** — cf. §3). Les **attestations/certificats** sont **téléchargés**
(`Content-Disposition`), **jamais envoyés en pièce jointe**.

### 1.5 Idempotence & retry

- Idempotence : **ledger `MailEventDelivery`** (index unique) + shadow `skipped_duplicate_direct_sender`
  quand `directSenderExists:true`. **Ne couvre que les chemins moteur (C/D).**
- Idempotence Stripe : index partiel unique sur `Sale.stripePaymentIntentId` posé à l'INSERT →
  un webhook dupliqué throw E11000 **avant** tout effet de bord. Solide.
- **Retry : inexistant.** `postToBrevo` = 1 `fetch`, sur échec → SendLog `failed`, `false`.
  `attempts:1` (commenté « pas de retry tracké », `mailSupervisionMapper.js:76`). Aucun backoff,
  aucune ré-émission, **aucun bouton « Renvoyer »**.

---

## 2. Identités d'expédition — Matrice de conformité

| Communication | Expéditeur attendu | Expéditeur réel (code) | Conforme |
|---|---|---|---|
| Invitation manager | support | `support` (`authMailService.js:72`) | ✅ |
| Reset manager | support | `support` (`authMailService.js:87`, routé `passwordResetController.js:45`) | ✅ |
| Reset client | commerciale | `commerciale` (`authMailService.js:99`, routé `:47`) | ✅ |
| Confirmation réservation | commerciale | `commerciale` (`buildSender()`, `mailDomainDispatchers.js:1413`) | ✅ |
| Paiement / vente | commerciale | `commerciale` (`buildSender()`, `:117`) | ✅ |
| Carte cadeau | commerciale | `commerciale` (règles + `giftCardMailService`) | ✅ |
| Formation (started/completed/…) | commerciale | `commerciale` (règles) | ✅ |
| **Commission (available/reminder)** | **support** (règle le déclare) | **commerciale** (`buildSender()`, direct shadow) | ❌ |
| **Incident technique (site_suspended/maintenance)** | **support** | **commerciale** (`buildSender()`, `:701`) | ❌ |

**Cause racine unique** des deux ❌ : les envois directs (chemin A) sont câblés sur `buildSender()`
(= commerciale) et **ignorent le `fromRole:'support'`** déclaré dans `mailDispatchRules.js` ; le
moteur qui honorerait `support` reste en shadow (flag OFF). → **P1**.

---

## 3. Inventaire des événements métier — Matrice de couverture

Légende : **✅E** = e-mail envoyé · **✅N** = notification interne · **❌** = rien ·
« event-only » = `emit*Event` audit-only (subscriber OFF → aucun envoi).

### 3.1 Auth client
| Événement | Couverture | Où / notes |
|---|---|---|
| Compte créé | ✅N seulement | `authRouter.js:319` `triggerNotification('new_client')` (admin). **Pas d'e-mail de bienvenue.** |
| E-mail de vérification (code) | ✅E | template `email_confirmation_code` (envoi direct) |
| E-mail vérifié (confirmation) | ❌ | aucun e-mail « adresse confirmée » |
| Mot de passe oublié | ✅E | `sendClientPasswordResetEmail` (commerciale) |
| Mot de passe modifié | ❌ | aucune confirmation |
| Compte désactivé / réactivé | ❌ | aucun e-mail |
| Modification sensible profil | ❌ | aucun e-mail |

### 3.2 Auth manager
| Événement | Couverture | Où / notes |
|---|---|---|
| Invitation créée | ✅E | `managerUsersController.js:60` (support, tokenisé, 7j) |
| Invitation renvoyée | ✅E | même fonction (renvoi = ré-appel) |
| Invitation expirée / acceptée | ❌ | aucun e-mail dédié |
| Reset manager | ✅E | support |
| Mot de passe modifié / rôle modifié | ❌ | aucun e-mail |

### 3.3 Réservations (prestations)
| Événement | Couverture | Où / notes |
|---|---|---|
| Réservation confirmée | ✅E + ✅N | `runPostSaleSideEffects` + `booking_confirmed` ; notif `booking_created` |
| Acompte / paiement total | ✅E (dans la confirmation) | montants dans `booking_confirmed` (pas d'e-mail dédié acompte) |
| Paiement sur place attendu | ❌ | pas de comm dédiée |
| Réservation déplacée (report) | ✅E + ✅N | `sendSessionRescheduledEmail` ; notif `booking_rescheduled_client` |
| Annulée par client | ✅E + ✅N | `sendBookingCancelledEmail` + notif |
| Annulée par institut | ✅E (client + admins) | `sendBookingCancelled*` |
| Rappel avant RDV | ✅E | `bookingRemindersJob` (horaire, `ServiceSettings.reminders`) |
| No-show | ✅N | `no_show_recorded` (admin) |
| Solde restant dû / encaissé sur place | ❌ | event-only `booking.balance_paid_on_site` (hors catalogue) |
| RDV terminé | ❌ | aucune comm |

### 3.4 Remboursements / paiements / finance
| Événement | Couverture | Où / notes |
|---|---|---|
| Paiement réussi (vente) | ✅E + ✅N | `sendSaleEmail` + `new_sale` |
| **Paiement échoué** | ❌ | `handlePaymentFailedEvent` libère juste les holds |
| Paiement expiré | ❌ | cleanup only |
| Remboursement demandé (flow institut) | ✅E | `sendRefundRequestedEmail` |
| Remboursement demandé (admin) | ❌ | audit + provision commission only |
| Remboursement auto-initié | ✅E | `sendRefundAutoInitiatedEmail` |
| Remboursement réussi | ✅E + ✅N | `sendRefundConfirmedEmail` ; **notif mal nommée `refund_requested`** |
| **Remboursement refusé** | ❌ | aucune comm |
| **Remboursement échoué (Stripe)** | ❌ | note « intervention requise » interne, aucune comm |
| Facture disponible | ✅E (indirect) | lien dans l'e-mail de vente ; pas d'e-mail « facture prête » |
| Avoir (credit note) | ❌ | PDF Stripe créé, aucun envoi |
| **Commission disponible / rappel / dernier jour** | ✅E | `commissionReminderJob` → admins |
| Commission payée | ❌ | event-only `commission.paid` |
| Facture de commission | ❌ | générée, `sendCommissionInvoiceEmail` **sans appelant** (code mort) |

### 3.5 Formations
| Événement | Couverture | Où / notes |
|---|---|---|
| Achat confirmé | ✅E + ✅N | e-mail **générique « vente »** (pas formation-spécifique) + `formation_*_purchased` |
| Session créée / disponible | ❌ | CRUD pur |
| Session modifiée | ✅E | `sendSessionUpdatedChoiceEmail` (clients réservés) — **pas de notif admin** |
| Session annulée | ✅E + ✅N | `sendSessionCancelledChoiceEmail` + `formation_session_cancelled` |
| **Rappel avant session** | ❌ | **aucun job de rappel session** (le job ne couvre que les prestations) |
| Présence validée | ✅E + ✅N | `presence.confirmed` (chemin D direct) |
| Progression démarrée / terminée | ✅E + ✅N | `formation.started` / `formation.completed` (chemin D) |
| **Certificat disponible** | ❌ | juste une ligne dans l'e-mail de complétion ; pas d'e-mail dédié |
| Demande d'avis | ❌ | inexistant |
| Remboursement / participation annulée | ✅E + ✅N | client + admins |

### 3.6 Cartes cadeaux
| Événement | Couverture | Où / notes |
|---|---|---|
| Créée manuellement | ✅E (+PDF) | `gift_card.manual_created` (chemin D) → **owner** |
| Achetée en ligne / paiement confirmé | ✅E (+PDF) | `gift_card.online_created` → **owner/acheteur** (1 seul e-mail) |
| PDF généré | ❌ | pas de comm dédiée (PDF attaché à l'e-mail create) |
| **Envoyée au bénéficiaire** | ❌ | **l'e-mail part toujours à l'owner** ; `recipientName` = variable seulement |
| Utilisation partielle / totale | ❌ | writes DB only |
| Débit manuel | ✅E (1 route) / ❌ (autre) | `manualDebitGiftCardById` envoie ; `manualDebitGiftCardForGestion` **n'envoie pas** |
| Remboursement partiel / total | ❌ | event-only `gift_card.recredited` |
| Erreur génération PDF / envoi | ❌ | `console.error` only |
| **Renvoi manuel** | ❌ | **aucune fonction de renvoi** |

### 3.7 Avis
| Événement | Couverture |
|---|---|
| Demande d'avis / avis reçu / publié / refusé / masqué / manuel | **❌ (tous)** — 0 communication end-to-end (confirmé par `docs/RX3_VITRINE_AUDIT.md:205`) |

### 3.8 Système / alertes dev
| Événement | Couverture |
|---|---|
| Erreur webhook / webhook définitivement échoué / erreur Brevo / erreur Stripe / erreur PDF / erreur template / config manquante / IntegratedAPI déconnectée / clé invalide / incident dev | **❌ (tous)** — seuls des `WebhookFailureLog`/`console.error` sont écrits. Les types (`system_error`, `webhook_failure`, `job_failed`…) existent dans la table d'audience dev mais ne sont **jamais** déclenchés hors tests. `collectAdminAndDevEmails` = **code mort** (0 appelant). |

### 3.9 Événements émis hors catalogue (warning « UNKNOWN event »)
7 codes émis mais absents de `eventCatalog.js` : `commission.adjusted`, `commission.reversal_required`,
`commission.cancelled`, `booking.balance_paid_on_site`, `booking.rescheduled`,
`gift_card.recredit_failed`, `gift_card.recredit_recovered`. → **P1** (bruit de log + contrat cassé).

---

## 4. Système de déclencheurs

### 4.1 Mécanismes réels
- **Bus in-process** `services/eventBusService.js` : `emitEvent` persiste toujours un `EventLog`
  (redaction PII), puis notifie les subscribers. **Observabilité/audit seulement** par design.
- **Émetteurs SAFE** `services/businessEventService.js` : `emit{Sale,Booking,Refund,GiftCard,Commission,FormationSession}Event`.
- **Notifications internes** `services/notificationService.js:52` `triggerNotification` (jamais d'e-mail) ;
  runtime M8 via `NotificationTemplate` publiés + fallback `NotificationConfig`, gaté
  `NOTIFICATION_TEMPLATE_RUNTIME_ENABLED` (défaut ON). Audience via `notificationTargetService`.
- **Subscribers** :
  - `subscribers/mailEventSubscriber.js` → `dispatchMailForEvent` — **no-op si `MAIL_ROLE_RESOLVER_ENABLED≠true`** (défaut).
  - `subscribers/notificationEventSubscriber.js` → `Notification` — modes `off|shadow|active` via
    `EVENT_NOTIFICATION_SUBSCRIBER_MODE` (défaut **off**), idempotent via `NotificationEventDelivery`.
- **Stripe** `services/stripe/stripeWebhookService.js` : signature vérifiée sur raw body ;
  `payment_intent.succeeded` = **unique déclencheur de création de vente** ; idempotence par index
  unique + pré-check ; retry borné (3) puis `WebhookFailureLog` + 500 (Stripe retente).
- **Schedulers** (`setInterval`, `app.js:623-633`) : rappels prestation, rappels commission, recovery
  refund/gift-card, cleanups. **Pas de rappel session formation.**

### 4.2 Problèmes identifiés
- **Deux moteurs concurrents** (directs A/B vs moteur C/D). Flag OFF → `fromRole` ignoré.
- **Double-run risqué** : `triggerNotification` directs + subscriber notif `active` → doublons
  (documenté `projectContext.json:824`). Ne jamais activer les deux simultanément sans retirer les directs.
- **Envois directs depuis contrôleurs** (bookings, sessions, gift cards) vs couche service — hétérogène.
- **Envois fire-and-forget** (`void`), best-effort : un échec e-mail ne bloque pas le métier (correct)
  mais **n'est ni retenté ni ré-émissable**.
- **Ordre d'envoi** : correct (après persistance). Rappels : e-mail envoyé **avant** le marqueur
  `remindersSent` → un crash entre les deux peut re-notifier (mitigé par la fenêtre horaire).

### 4.3 Architecture cible retenue
Ne PAS construire un moteur no-code générique. **Renforcer le registre code-first existant**
(`mailDispatchRules` = le CommunicationTriggerRegistry) et **converger vers un chemin unique** :

```
Action métier réussie (après persistance)
        ↓
Événement métier explicite (businessEventService)
        ↓
Registre de déclencheurs code-first (mailDispatchRules)  ← source d'autorité unique fromRole/toRole/template
        ↓
Résolution template (loadTemplate) + destinataires/expéditeur (communicationRoleResolver)
        ↓
Rendu HTML (mailRenderer, valeurs échappées) + pièces jointes
        ↓
postToBrevo (SendLog) + MailEventDelivery (idempotence)
```

Convergence recommandée : **honorer `fromRole` dans les envois directs** (résoudre l'identité par
rôle au lieu de `buildSender()` fixe) OU basculer progressivement chaque domaine sur le moteur en
retirant l'envoi direct (pas les deux). Décision produit à cadrer (cf. §Recommandations).

---

## 5. Registre canonique des templates

Trois sous-systèmes, tous versionnés (draft/published/archived + index partiel unique « un publié par
clé »), tous à **code stable** (jamais résolus par nom d'affichage) :

| Sous-système | Modèle | Clé stable | Studio (RBAC) | Seed |
|---|---|---|---|---|
| Mail (M6) | `EmailTemplate` | `functionName` | `/api/gestion/mails` **dev-only** | **Aucun fichier** — matérialisation lazy depuis `TEMPLATE_FUNCTIONS` (`mailTemplateRuntime.js`, ~50 défauts) |
| Notification (M7/M8) | `NotificationTemplate` (+`NotificationCategory`) | `templateKey` | `/api/gestion/dev/notification-templates` **dev-only** | **Aucun** (créés via studio) |
| Carte cadeau (M13) | `GiftCardTemplate` | `slug` | `/api/gestion/dev/gift-card-templates` **dev** ; lib admin `requireDev` | **1 seed** idempotent : slug `classique` |

- **Résolution mail** : `loadTemplate(functionName)` → doc publié, sinon `ensureTemplate` matérialise
  le défaut hardcodé (idempotent). Code inconnu → `null` → pas d'envoi.
- **Résolution carte cadeau** : par **le template actif unique** (`{active:true}`), seed garantit « jamais zéro ».
- **HTML métier hardcodé** : **aucun dans les contrôleurs**. Les défauts mail vivent en dur dans
  `TEMPLATE_FUNCTIONS` (fragments inline-stylés) mais restent éditables ensuite. Card par défaut en dur
  dans le seed (template DB éditable, pas un bypass).

**Écarts registre :**
- **Pas de seed e-mail/notification** → une install neuve dépend de la matérialisation lazy (OK pour
  mail) mais **notifications = zéro template** tant que rien n'est créé (fallback `NotificationConfig`). → **P1**.
- Studios **silotés** (3 surfaces) — pas de bibliothèque unifiée. → **P1/P2**.
- Pas de champ `senderIdentity` sur `EmailTemplate` (le rôle vient du registre — cohérent).

---

## 6. Éditeur HTML, variables, aperçu, envoi de test

| Capacité | État | Détail |
|---|---|---|
| Éditeur HTML | **Partiel** | 2 `<textarea>` bruts (`TemplateHtmlEditor` + texte), pas de coloration/lint/formatage |
| Aperçu desktop/mobile | ✅ | `TemplatePreviewPane` iframe `sandbox=""` + toggle appareil, rendu front avec mock vars |
| Panneau variables | **Partiel** | `TemplateVariablesPanel` (copie, warning inconnues, catalogue) mais catalogue = **miroir hardcodé front** (`KNOWN_TEMPLATE_VARIABLES`), pas backend |
| **Envoi de test** | **❌ ABSENT** | aucun bouton, aucun endpoint. Seul `POST /mails/simulate-sale` existe → envoie un **vrai** e-mail vente à un **vrai** client |
| Matrice déclencheurs | **Partiel/read-only** | `TemplateRoleBindingCard` (5 clés statiques). Pas de grille agrégée, pas de wiring |
| Garde « modifications non enregistrées » | à vérifier | non confirmé côté éditeur mail |

Preview ≠ prod : la preview mail est **rendue côté front** (`previewMailTemplate`), alors que la prod
rend côté back (`replaceTemplateVariables`). Divergence possible (allowlist, échappement). → à unifier (P1/P2).

Primitives `@bs/ui` réutilisables pour l'éditeur/test-send : `FormField`, `TextInput`, `TextArea`,
`Select`, `Drawer`, `StickyBar`, `Button`, `Badge`.

---

## 7. Sécurité HTML & multi-tenant

- **Interpolation** : `replaceTemplateVariables` — allowlist `VARIABLE_KEYS` (~90 clés), clés inconnues
  laissées littérales, **pas d'`eval`/`new Function`**, pas de traversal.
- **Sanitisation template** : `sanitizeFullHtml` (strip `<script>/<style>/iframe/…`, `on*=`,
  `javascript:`) à la sauvegarde ET au seed. Basée regex (pas DOM).
- **⚠️ Valeurs runtime non échappées** : `{{customerName}}`, `{{clientEmail}}`, etc. injectées **brutes**
  dans le HTML. Surface d'injection, notamment `booking_cancelled_notify_admin` (admin-facing). → **P1**.
  (Le renderer carte cadeau, lui, **échappe** ; les notifications strippent le HTML.)
- **Secrets/tokens** : SendLog hash le destinataire ; clé Brevo jamais loggée ; tokens reset/invitation
  jamais loggés. **Mais** e-mails destinataires en **clair** dans `console.log`
  (`mailDomainDispatchers.js:196, 569, 643`). → **P1** (PII en logs).
- **Multi-tenant** : **mono-institut confirmé** — aucun champ `institutId/orgId/tenantId` sur aucun
  modèle. Templates/logs/identités globaux. Le `scope` d'identité = palier de rôle, pas un tenant.
  → Les exigences §22 (isolation tenant) sont **sans objet** ici ; à documenter comme tel.
- **Secret scan** : `git grep -nE "sk_live_|sk_test_|xkeysib-|whsec_|mongodb+srv://.*:.*@"` →
  **aucun secret réel tracké** (placeholders `.env.example`, fixtures fake de test, docs). ✅

---

## 8. Logs, retry, idempotence (synthèse)

- **Logs UI existants** : deliveries (`MailEventDelivery`) + send-logs (`SendLog`) supervisés
  admin/dev (stats + filtres) ; `EventLogsPage` + `WebhookFailuresPage`. **Manque** : statut agrégé
  par template, action « Renvoyer », vue unifiée. Statuts riches déjà présents dans les modèles.
- **Retry** : **absent** (à définir : rejouer un `failed` de façon idempotente et tracée). → **P1**.
- **Idempotence** : forte côté moteur (index unique `MailEventDelivery`) + Stripe ; **absente côté
  directs** (s'appuie sur l'idempotence amont). Clés conceptuelles à généraliser :
  `booking.confirmed:{bookingId}`, `gift_card.online_created:{giftCardId}`,
  `refund.succeeded:{refundId}`, `manager.invitation:{invitationId}:{version}`.

---

## 9. Rapport d'écarts (classification)

### A — Opérationnel (centralisé, testé, utilisable)
- Gateway Brevo unique + SendLog + webhook status.
- Identités d'expédition (modèle + service + vérif Brevo + UI admin/dev).
- Idempotence moteur (`MailEventDelivery`) + idempotence Stripe.
- Versioning des 3 studios (draft/publish/rollback réversible).
- Routage auth (invitation/reset) conforme, sans fallback prod, sans token loggé.
- Résolution d'URL centralisée (DomainResolver + frontendUrl flag-aware ; audience correcte).
- Seed carte cadeau idempotent non destructif.

### B — Partiellement opérationnel (manque template/trigger/log/test/UI/identité/erreur)
- Moteur par rôles **désactivé** (flag OFF) → `fromRole` non honoré (commission/incident ❌).
- Éditeur mail (textarea brut), **pas d'envoi de test**, catalogue variables front-only.
- Studios silotés, pas de matrice déclencheurs, pas de vue unifiée « Communication Center ».
- Pas de seed e-mail/notification (matérialisation lazy pour mail ; notifications à nu).
- Preview front ≠ rendu prod.
- Rappels : prestations OK, **session formation absente**.

### C — Absent (événement métier sans communication)
- Auth client : bienvenue, e-mail vérifié, mdp modifié, désactivation/réactivation.
- Bookings : paiement sur place attendu, solde encaissé, RDV terminé.
- Finance : **paiement échoué**, **remboursement refusé**, **remboursement échoué**, commission payée, avoir.
- Formations : rappel session, **certificat disponible**, demande d'avis.
- Cartes cadeaux : **envoi bénéficiaire distinct**, usage partiel/total, remboursement, **renvoi manuel**, erreurs.
- **Avis : 0 comm** (toutes étapes).
- **Alertes système/dev : 0 comm** (code mort `collectAdminAndDevEmails`).

### D — Dette dangereuse
- **Deux moteurs concurrents** durables (A/B vs C/D) — risque de doublon si flags activés sans retrait des directs.
- **Notif `refund.succeeded` réutilise la clé `refund_requested`** (nommage trompeur, mais fire).
- **Valeurs runtime non échappées** dans le HTML mail (injection, admin-facing).
- **E-mails en clair dans les logs** (PII).
- **7 events hors catalogue** (warning UNKNOWN, contrat cassé).
- `sendPasswordResetEmail` legacy (commerciale pour tout rôle) exporté mais superseded — incohérence latente.
- `manualDebitGiftCardForGestion` n'envoie **aucun** e-mail alors que l'autre route de débit le fait — incohérence.
- Échecs d'envoi carte cadeau / erreurs PDF **silencieux** (aucune alerte, aucun renvoi).

---

## 10. Priorisation

> **État d'implémentation (2026-07-22)** — voir `docs/COMMUNICATION_CENTER_REPORT.md`.
> **Livré** : P0-1, P0-2, P1-1, P1-2, P1-3, P1-6, P1-8, P1-9, P1-10 (+ tests, lint, build).
> **Différé (documenté)** : P0-3 (owner-only, reclassé P2), P1-4, P1-5, P1-7, P1-11, P1-12.


### P0 (à corriger immédiatement) — sécurité / mauvais destinataire / doublon / parcours critique
- **P0-1** — **Valeurs runtime non échappées** dans le HTML mail → échapper à l'interpolation
  (préserver les variables volontairement HTML comme `actionUrl`/liens via une allowlist « raw »).
  *(Sécurité — injection HTML dans e-mails, surtout notices admin.)*
- **P0-2** — **PII en clair dans les logs** (`mailDomainDispatchers.js:196,569,643`) → masquer/hasher.
- **P0-3** — **Carte cadeau : envoi au bénéficiaire.** Aujourd'hui l'e-mail (+ PDF) part **toujours à
  l'owner**, jamais au destinataire réel saisi.
  **Décision produit (2026-07-22) : owner-only conservé pour ce lot** (l'envoi bénéficiaire nécessite
  d'abord un champ/flow e-mail bénéficiaire). **Reclassé P2** — documenté, pas de changement de
  livraison dans ce lot.

> Note : les « mauvais expéditeur » (commission/incident en commerciale au lieu de support) sont réels
> mais **cosmétiques** (l'e-mail arrive au bon destinataire) → classés **P1**, pas P0.

### P1 — logs/trigger/variables/preview/test-send/seed/erreurs silencieuses/sender
- **P1-1** — Unifier le **routage sender** : honorer `fromRole` (commission/incident → support).
- **P1-2** — **Envoi de test** (backend endpoint dev + bouton UI) : template courant, données d'exemple,
  `[TEST]` dans l'objet, log `type:test`, **aucun** event métier, **aucun** token réel.
- **P1-3** — **Catalogue de variables backend** (source d'autorité) + validation à la sauvegarde
  (variables inconnues / mal fermées / obligatoires manquantes).
- **P1-4** — **Preview = moteur prod** (rendre côté back via le même `replaceTemplateVariables`).
- **P1-5** — **Seed e-mail + notification** idempotent non destructif (templates essentiels §16).
- **P1-6** — **Alertes dev** minimales : brancher `triggerNotification` (dev) sur webhook définitivement
  échoué / erreur envoi Brevo / erreur PDF carte cadeau (retirer le code mort ou le câbler).
- **P1-7** — **Renvoi manuel** carte cadeau + action « Renvoyer » sur logs éligibles (idempotent, tracé).
- **P1-8** — Corriger la **clé de notif** `refund_requested` → `refund_completed` sur le succès.
- **P1-9** — **Catalogue events** : ajouter les 7 codes manquants (ou cesser de les émettre).
- **P1-10** — Uniformiser `manualDebitGiftCardForGestion` (envoyer comme l'autre route).
- **P1-11** — **Matrice déclencheurs** read-only dans l'UI (event → template → expéditeur → destinataire → actif).
- **P1-12** — Comms manquantes prioritaires : **paiement échoué**, **remboursement refusé/échoué**,
  **certificat disponible**, **rappel session formation**.

### P2 (documentés — refonte trop risquée pour ce lot)
- Éditeur HTML riche (coloration/lint) sans dépendance lourde.
- Bibliothèque de templates unifiée (fusion des 3 silos).
- Convergence complète vers un moteur unique (retrait progressif des directs).
- Comms « nice-to-have » : bienvenue, mdp modifié, avis (demande + modération), RDV terminé, avoir.

---

## 11. Fichiers clés (pour relecture)

Bus/registres : `services/eventBusService.js`, `constants/eventCatalog.js`, `constants/mailDispatchRules.js`,
`services/businessEventService.js`.
Envoi : `services/mail/mailBrevoGateway.js`, `services/sendLogService.js`, `models/SendLog.js`,
`models/MailEventDelivery.js`, `services/mail/mailEventDispatchService.js`,
`services/mail/mailDomainDispatchers.js`, `services/authMailService.js`.
Identités/URL : `models/CommunicationIdentity.js`, `services/communicationRoleResolver.js`,
`services/mail/mailSenderResolver.js`, `services/system/domainResolver.js`, `services/system/frontendUrl.js`.
Templates : `models/EmailTemplate.js`, `services/mail/mailTemplateRuntime.js`, `services/mail/mailRenderer.js`,
`models/NotificationTemplate.js`, `models/GiftCardTemplate.js`, `services/giftCard/giftCardMailService.js`.
UI : `frontend-react/apps/manager/src/features/{communication,mailTemplates,notificationTemplates,notifications}`.

---

*Fin de l'audit — Phase 1. La phase de correction (P0/P1) est cadrée au §10 ; voir le rapport
`docs/COMMUNICATION_CENTER_REPORT.md` (à produire) pour l'avant/après d'implémentation.*
