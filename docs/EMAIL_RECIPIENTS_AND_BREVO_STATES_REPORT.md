# Rapport — Destinataires de contact & états du canal e-mail Brevo

> **⚠️ RAPPORT HISTORIQUE — NE PAS SUIVRE COMME PROCÉDURE.**
> Ce document décrit un état du système à la date de sa rédaction. Plusieurs
> architectures qu'il mentionne ont été supprimées depuis — notamment la page
> IntegratedAPI du Manager, les credentials Brevo locaux et le webhook Brevo
> local. Autorités actuelles : [ARCHITECTURE.md](ARCHITECTURE.md) ·
> [PROTOCOL.md](PROTOCOL.md) · [INTEGRATED_API.md](INTEGRATED_API.md) ·
> [PANEL_BRIDGE.md](PANEL_BRIDGE.md).


> Chantier du 2026-07-24 sur `feat/unified-production-baseline`
> (commits `c605eb1` destinataires, `bf49b3a` états séparés + webhooks).

## 1. Cause exacte de `EMAIL_RECIPIENTS_NOT_FOUND` (LOT 1)

Le resolver `CONTACT_NOTIFICATION_RECIPIENTS` ne consultait **jamais** la table
`User`. Sa chaîne réelle était : (1) `Company.contactNotificationRecipients`,
(2) à défaut **l'adresse support** (expéditeur du mode Brevo actif), (3) rien.
En PROD, la liste métier était `[]` **et** l'adresse support du mode actif
vide → 0 destinataire → `sendEmailHandler` lève `EMAIL_RECIPIENTS_NOT_FOUND`
(non-retryable) → exécution `DEAD_LETTER`, événement `FAILED`. La demande de
contact, elle, est bien enregistrée (invariant respecté).

Le commentaire du registre d'actions (« …Plus les comptes ADMIN ») **mentait** :
aucun code n'ajoutait les ADMIN, et un test l'actait même explicitement.
L'existence des comptes `dev@mail.com` (DEV) et `luca.duhoux@gmail.com` (ADMIN)
n'avait donc **aucun effet**. (NB : le modèle `User` n'a pas de notion
actif/inactif — un compte existe ou n'existe pas ; `activeUserFilter()` reste le
point d'extension unique.)

## 2. Correction destinataires (LOT 2)

Nouvel ordre de résolution — `resolveContactRecipients()`,
`backend/src/services/email/emailRecipientResolvers.js` :

1. `Company.contactNotificationRecipients` valides, normalisés, dédupliqués ;
2. à défaut, **comptes ADMIN** à adresse valide — **jamais les DEV**, jamais
   l'adresse support (s'auto-notifier masquait l'absence de destinataire réel) ;
3. à défaut, `EMAIL_RECIPIENTS_NOT_FOUND` (inchangé, explicite).

La provenance (`CONFIGURED | ADMIN_FALLBACK | NONE`) est exposée par
`GET/PUT /api/company/contact-notification-recipients` (`effective`) et affichée
dans l'éditeur du Manager (page Demandes de contact) : « comptes ADMIN (par
défaut) » avec les adresses, ou alerte rouge « personne ne sera prévenu ».
L'éditeur offrait déjà ajout/suppression/validation/dédup/max 5/sauvegarde.

**Rejeu** : l'action morte se rejoue depuis le Manager DEV → `/dev/evenements` →
« Relancer les actions en échec » (remet `DEAD_LETTER` à `PENDING` et rejoue le
resolver à l'exécution).

## 3. Cause exacte du panneau « E-mails temporairement désactivés » (LOT 3)

Il n'existe **aucun** circuit breaker ni état « désactivé » persisté : le
panneau projetait `operational.ready === false`, recalculé à chaque lecture.
Aucun échec d'envoi, de test ou de clé n'écrit cet état. En PROD, la cause est
**structurelle** au mode PROD après la copie TEST→PROD : webhook PROD jamais
enregistré (`modes.PROD.webhook` aux défauts `NOT_CONFIGURED`) et/ou clé API
PROD absente — d'où `CONFIGURATION_REQUIRED` → panneau jaune. « Dernier
événement reçu : — » était informatif (jamais bloquant pour la carte) mais
partageait le même panneau, d'où la confusion.

## 4. Modèle d'état séparé (LOT 4)

`getBrevoOperationalReadiness` expose désormais trois lectures indépendantes :

| Lecture | Valeurs | Rôle |
|---|---|---|
| `deliveryServiceStatus` | `operational` / `degraded` / `disabled` | le CANAL D'ENVOI |
| `webhookConfigurationStatus` | `installed` / `missing` / `mismatched` / `unreachable` | l'INSTALLATION du suivi |
| `trackingActivity` | `lastEventAt`, `lastEventType`, `neverReceived` | l'ACTIVITÉ (jamais un critère de santé) |

**Règle produit** : le webhook **ne bloque plus un envoi**. Seuls les obstacles
d'envoi (fournisseur désactivé, clé absente, expéditeur manquant) bloquent —
code `EMAIL_DELIVERY_BLOCKED` (`canSend=false`). Un suivi absent/cassé
**dégrade** (livraisons « Accepté » sans preuve de remise), il ne désactive pas.

UI Manager (`EmailConfigurationSection`) :
- panneau **canal d'envoi** : vert si l'envoi est possible ; jaune « Rétablir le
  service » **avec causes et date** uniquement si l'envoi est réellement bloqué ;
- panneau **suivi** distinct : vert « Suivi de livraison installé » +
  « Aucun événement reçu pour le moment » (ou dernier événement/date) ; jaune
  « Configurer le suivi » / « Réparer le suivi » / « Suivi injoignable » sinon ;
- le bouton « Tester la configuration » n'est plus désactivé par un suivi absent.

## 5. Architecture TEST / PROD (LOT 5)

Déjà par-mode dans `IntegratedApi.modes.{TEST,PROD}` : `apiKey`, `webhookId`,
`webhookUrl`, `webhookSecret` (chiffré AES-256-GCM), `subscribedEvents`,
`lastReceivedAt` (+ nouveau `lastReceivedType`), statut, santé. URL canonique
dérivée de `SystemConfiguration.network.backendUrl` :
`…/api/webhooks/brevo/transactional/{test|prod}` ; **localhost refusé**
(`isReadyUrl`). `syncWebhook(mode)` est strictement scoped au mode : activer ou
changer `activeMode` ne touche jamais le webhook de l'autre mode.

## 6. Réconciliation idempotente (LOT 6)

`syncWebhook(mode)` (existant) : upsert idempotent — identification par
webhookId → URL exacte → description stable (`SBauto06 transactional delivery
tracking - {mode}`), conflit si plusieurs candidats, création si absent, PUT si
divergence (comparaison normalisée des événements), jamais de doublon
(sérialisé par mode), `batched:false`, secrets jamais loggés. Événements
souscrits (valeurs exactes API Brevo) : `request, delivered, deferred,
softBounce, hardBounce, blocked, spam, invalid, error, unsubscribed, opened,
uniqueOpened, click`.

Nouvelle façade **`ensureBrevoTransactionalWebhook(mode)`** : réconciliation
NON intrusive — skip silencieux si configuration incomplète (`BREVO_DISABLED`,
`API_KEY_MISSING`, `URL_NOT_PUBLIC`), résultat structuré au lieu d'exception en
cas d'échec distant.

## 7. Déploiement (LOT 7)

Au démarrage du backend **en PROD uniquement** (chaque déploiement redémarre
PM2) : `ensureBrevoTransactionalWebhook('PROD')` — sur le VPS, bonne base, URL
publique réelle, **sans ngrok**, **sans toucher TEST**, **jamais bloquant** :
compte non configuré → info « réconciliation sautée » ; échec réel → warning
explicite dans les logs. (`backend/src/config/bootstrap.js`.)

## 8. Sécurité du webhook (LOT 8 — vérifiée, déjà en place)

Bearer obligatoire (401 sans/mauvais token, trace `lastAuthRejectedAt`), secret
par mode (jamais exposé, rotation avec fenêtre de 15 min), réponse 2xx rapide
après persistance, idempotence par `idempotencyKey` (doublons Brevo absorbés),
retries Brevo gérés (5xx → reprise), `batched:false` (un objet par appel, un
tableau toléré par prudence), logs sans adresse en clair (hash). Couverture :
`brevo-webhook.test.js` — 147 ✓.

## 9. Tests (LOT 9)

| Suite | Résultat |
|---|---|
| `contact.test.js` (destinataires : configurés, fallback ADMIN, DEV exclu, invalides, dédup, aucun, endpoint + effective, E2E contact→Brevo) | 267 ✓ |
| `brevo-operational.test.js` (canal operational/degraded/disabled, envoi sans suivi, blocage clé/expéditeur, reprise, restore, décomposition, `ensure…` idempotent ×13 sections) | 114 ✓ |
| `email-configuration.test.js` (l'envoi ne dépend plus du webhook) | 238 ✓ |
| `email-delivery.test.js` | 204 ✓ |
| `brevo-webhook.test.js` (sécurité/ingestion/isolation TEST-PROD) | 147 ✓ |
| Manager (13 suites, dont `emailConfiguration`) | 0 échec |
| Chaîne backend complète (~38 suites) | 0 échec |

## 10. Recette PROD (procédure restante — actions Manager/utilisateur)

1. **Déployer** ce commit (Manager → Déploiement). Au démarrage PROD, la
   réconciliation du webhook PROD s'exécute ; si la clé API Brevo PROD n'est pas
   encore saisie, le log dira « réconciliation sautée (API_KEY_MISSING) ».
2. Manager PROD (DEV) → Intégrations API → Brevo : saisir/valider la **clé API
   PROD** et l'**expéditeur PROD** si absents ; le panneau canal doit être vert.
   Panneau suivi : « Configurer le suivi » → un clic installe le webhook
   `https://api.demo-sbauto.lycarz.com/api/webhooks/brevo/transactional/prod`.
3. Page Demandes de contact → « Destinataires des nouvelles demandes » :
   ajouter `luca.duhoux@gmail.com` (sinon fallback ADMIN affiché).
4. Soumettre une demande depuis la vitrine → vérifier : demande visible,
   action `SEND_EMAIL` réussie (`/dev/evenements`), e-mail reçu, messageId
   persisté, événements `request` puis `delivered` reçus (panneau suivi :
   « Dernier événement : … »), carte verte.
5. L'ancienne action morte peut être rejouée : `/dev/evenements` → événement
   `contact.submitted` en échec → « Relancer les actions en échec ».
