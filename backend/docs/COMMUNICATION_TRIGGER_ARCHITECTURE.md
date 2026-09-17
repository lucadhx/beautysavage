# COMMUNICATION — Architecture des déclencheurs

> Référence de l'architecture d'envoi/déclenchement des communications (e-mails + notifications
> internes) de Beauty Savage. Complète l'audit `docs/COMMUNICATION_CENTER_AUDIT.md`.

## Vue d'ensemble

Beauty Savage est **mono-institut** (aucun scope tenant sur les modèles). Les communications
partent d'un **gateway Brevo unique** (`postToBrevo`), avec des **identités d'expédition en base**
(`CommunicationIdentity` : `support` = plateforme/technique, `commerciale` = institut→client) et un
**registre de règles code-first** (`constants/mailDispatchRules.js`) qui associe un événement à un
template et à un couple `fromRole/toRole`.

## Les chemins d'envoi (état runtime)

```
                         ┌─────────────────────────────────────────────┐
   Action métier ──────► │  A. Envois directs  (mailDomainDispatchers)  │  ACTIF
   (après persistance)   │     send*Email → buildSenderForRole(role) →  │
                         │     loadTemplate → render → postToBrevo      │
                         └─────────────────────────────────────────────┘
                         ┌─────────────────────────────────────────────┐
   Auth ───────────────► │  B. authMailService  (invitation / resets)  │  ACTIF
                         │     resolveSender(fromRole) → postToBrevo    │
                         └─────────────────────────────────────────────┘
                         ┌─────────────────────────────────────────────┐
   emitEvent ──────────► │  C. mailEventSubscriber → dispatchMailForEvent│ NO-OP
   (bus)                 │     gaté par MAIL_ROLE_RESOLVER_ENABLED (OFF) │  (shadow)
                         └─────────────────────────────────────────────┘
                         ┌─────────────────────────────────────────────┐
   gift card / learning ►│  D. dispatchTemplateByRoles (impératif)      │  ACTIF
                         │     via giftCardMailService / learningEvents │
                         └─────────────────────────────────────────────┘
```

- **A** est le chemin réel pour sale, booking, refund, commission, sessions, no-show, site-status.
- **B** couvre l'auth (invitation manager, reset manager/client), routage `fromRole` explicite.
- **C** (moteur événementiel) existe mais est **désactivé par défaut** (`MAIL_ROLE_RESOLVER_ENABLED`
  absent du `.env`). Le subscriber `handleMailEvent` fait un no-op.
- **D** appelle le moteur **impérativement** (hors bus) : cartes cadeaux + learning.

Le **bus d'événements** (`eventBusService.emitEvent` + `constants/eventCatalog.js`) est
**observabilité/audit seulement** : il persiste un `EventLog` (avec redaction PII) et notifie des
subscribers in-process. Il ne déclenche AUCUN envoi par lui-même tant que les flags subscribers
sont OFF (défaut).

## Le registre de déclencheurs (source d'autorité)

`constants/mailDispatchRules.js` — chaque règle :

```js
{
  eventName: 'refund.succeeded',
  templateKey: 'refund_confirmed',   // ciblé par CODE stable, jamais par nom d'affichage
  fromRole: 'commerciale',           // injecté par communicationRoleResolver — jamais par le template
  toRole: 'client',
  contextType: 'refund_request',
  enabled: true,
  directSenderExists: false           // true ⇒ un envoi direct existe déjà → moteur en shadow
}
```

**Le template ne porte JAMAIS d'adresse.** L'expéditeur/destinataire proviennent de la règle,
résolus à l'envoi via `communicationRoleResolver` (identités en base). C'est le
« CommunicationTriggerRegistry » demandé par la mission — **code-first**, pas de moteur no-code.

## Conformité de l'expéditeur (P1-1)

`services/mail/mailSenderResolver.js` expose `buildSenderForRole(role)` : les envois directs
plateforme/technique (**commission**, **incident de site** via `sendStatusMail(..., fromRole:'support')`)
résolvent désormais l'identité **support** ; tous les envois institut→client restent **commerciale**.
`buildSender()` = alias rétro-compatible de `buildSenderForRole('commerciale')`.

## Idempotence

- **Moteur (C/D)** : `MailEventDelivery` (index unique `{eventName,contextType,contextId,templateKey}`),
  + statut `skipped_duplicate_direct_sender` quand `directSenderExists:true`.
- **Stripe** : index partiel unique sur `Sale.stripePaymentIntentId` posé à l'INSERT → un webhook
  dupliqué throw E11000 avant tout effet de bord.
- **Notifications** : `NotificationEventDelivery` (subscriber notif, mode `off` par défaut).
- **Envois directs (A/B)** : pas de clé propre ; s'appuient sur l'idempotence amont (Stripe / flux métier).

## Rendu & sécurité (P0-1)

`services/mail/mailRenderer.js#replaceTemplateVariables(content, values, { html })` :
- Allowlist de variables (`VARIABLE_KEYS`, ~90 clés) ; clés inconnues laissées **littérales** (jamais exécutées).
- `options.html === true` → **échappe** chaque valeur, SAUF les clés « raw » (URLs, couleurs de
  thème, fragment `refundsection`). Le mode texte (défaut) reste non échappé (rétro-compat).
- Templates stockés sanitisés (`sanitizeFullHtml`). Aucun `eval`/`new Function`.

## Alertes techniques (P1-6)

`services/devAlertService.js#notifyDevAlert(type, vars)` — best-effort, ciblage audience `dev`,
branché sur : webhook **définitivement** en échec (`recordWebhookFailure`, `retryable:false`) et
erreurs de rendu/envoi carte cadeau (auparavant silencieuses). Types dev configurés dans
`notificationConfigMigration` (`webhook_failure`, `system_error`).

## Envoi de test (P1-2)

`POST /api/gestion/mails/templates/:functionName/test-send` (dev-only) — rend le template avec des
**données d'exemple** (`buildSampleTemplateData`, aucun vrai token/PII), préfixe `[TEST]`, journalise
`contextType:'test'` + tag `test`, **ne déclenche aucun événement métier** ni transaction.

## Catalogue de variables (P1-3)

`services/mail/mailTemplateVariableCatalog.js` — source d'autorité **backend** (description, exemple,
source, flag `raw`) exposée via `GET /api/gestion/mails/variables`. Remplace à terme le miroir front
`KNOWN_TEMPLATE_VARIABLES`. Fournit aussi `validateTemplateContent` (variables inconnues / accolades
mal fermées) branché en avertissement non bloquant sur la sauvegarde.

## Aperçu = production (LOT 2)

`POST /api/gestion/mails/templates/:functionName/preview` rend avec **le même** renderer que l'envoi
(`replaceTemplateVariables` + `withMailThemeVars` + `buildSampleTemplateData`). Le front
(`previewMailTemplate`) délègue au backend : plus de double moteur de rendu.

## Matrice des déclencheurs (LOT 2)

`GET /api/gestion/mails/triggers` (dev-only) reflète `mailDispatchRules` (événement → catégorie →
template → expéditeur → destinataire → actif → direct → moteur → dernier envoi → statut). Lecture
seule ; page `/dev/communication/triggers`.

## Reset PIN carte cadeau (LOT 2)

`POST /api/gestion/gift-cards/:id/reset-pin` : le PIN étant **hashé (irrécupérable)**, un renvoi
génère un **nouveau** code (ancien invalidé via écrasement du hash), régénère le PDF et renvoie
l'e-mail (event `gift_card.pin_reset_and_resent`). Le PIN n'est jamais renvoyé par l'API.

## Retry / « voir le HTML envoyé » — pourquoi c'est différé

`SendLog` ne stocke qu'un `recipientHash` (SHA-256 irréversible) et **aucun** corps HTML / variables.
Un retry générique ou un « voir le HTML » sont donc **infaisables** sans persister le rendu (compromis
PII refusé par le modèle) ou re-dériver par contexte au cas par cas. Seul le renvoi **carte cadeau**
(reset PIN) est fourni. Voir `COMMUNICATION_CENTER_LOT2_REPORT.md` §2.

## Convergence recommandée (dette)

Deux moteurs concurrents (A/B directs vs C/D moteur) coexistent. Cible : **un chemin unique**. Deux
stratégies (cf. audit §4.3) — (1) honorer `fromRole` dans les directs [FAIT pour support] puis migrer
domaine par domaine vers le moteur en retirant l'envoi direct ; (2) activer le flag et supprimer les
directs shadow. Ne jamais activer les deux simultanément sans retrait (risque de doublon).
