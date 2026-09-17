# ManagerArchitecture — app `manager` (institut + dev)

> Architecture technique de l'app React manager (`manager.beautysavage.fr`) incluant la section
> `/dev`. Scope à mettre à jour à chaque sprint manager/dev. Global :
> [FolderArchitecture](./FolderArchitecture.md). Produit : [ManagerProjectContext](./ManagerProjectContext.md).

## Accès & guards
- App protégée : `RequireRole(['admin','dev'])` au niveau racine.
- Section `/dev/*` : `RequireRole(['dev'])`.
- Onboarding : si login admin renvoie `{ blocked, reason:'no_contract'|'pending' }` → flux activation contrat avant accès dashboard.
- Le backend reste l'autorité (401/403 ; `requireGestionRole`, `requireStrictDev`, `requireContractForAdmin`).

## Routes Manager (role admin)
| Route | Écran | API |
|---|---|---|
| `/login` | Login manager | `POST /auth/login` |
| `/onboarding` | Activation contrat (règlement) | `/api/contract/*` (create-launch-intent, create-monthly-setup, verify-*, activate) + Stripe |
| `/` | Dashboard | `/api/gestion/sales/stats`, `/api/commissions/*` |
| `/planning` | Planning sessions/créneaux | `/api/gestion/sessions`, `/availability`, `/bookings` |
| `/reservations` | Réservations prestations | `/api/gestion/bookings*` |
| `/prestations` | Prestations + praticiennes | `/api/gestion/services`, `/practitioners` |
| `/formations` | Formations + sessions + modules | `/api/gestion/formations`, `/sessions` |
| `/produits` | Produits | `/api/gestion/business/products` |
| `/cartes-cadeaux` | Cartes cadeaux | `/api/gestion/gift-cards` |
| `/ventes` | Ventes | `/api/gestion/sales`, invoice |
| `/remboursements` | Remboursements | `/api/gestion/refunds` |
| `/commissions` | **Commissions à payer** | `/api/commissions/*` (create-intent, check-status) |
| `/mon-contrat` | Vue contrat | `/api/contract/active`, `/current` |
| `/parametres` | Identité, thème, pages légales, statut site | `/api/gestion/site-identity`, `/themes`, `/pages-gestion`, `/promotions` |

## Routes Dev (role dev)
| Route | Écran | API |
|---|---|---|
| `/dev/contrats` | Contrats (CRUD, activation, annulation) | `/api/contract` POST/DELETE/activate-free/cancel-immediate |
| `/dev/commissions` | Commissions reçues + config | `/api/gestion/commissions/*` |
| `/dev/integrations` | IntegratedAPI / coffre credentials | routers credential/integrated |
| `/dev/emails` | Email Template Studio | `/api/gestion/mails/*` |
| `/dev/logs/sendlog` | SendLog | `/api/gestion/dev/send-logs` |
| `/dev/logs/events` | EventLog | `/api/gestion/dev/*` |
| `/dev/logs/webhooks` | WebhookFailureLog | `/api/gestion/dev/*` |
| `/dev/maintenance` | Statut site / maintenance | `/api/gestion/site-status/*` |

## Onboarding contrat (flux)
1. Login admin → `{ blocked, reason }` si contrat non actif.
2. Écran règlement (équivalent de l'admin-login Vanilla 8 slides) : présentation → PDF + acceptation → **frais de lancement** (Stripe) → **abonnement mensuel** (Stripe) → activation.
3. Tant que contrat ≠ active : accès manager bloqué (`contractGuard` 503). `dev` bypass.
4. Cible UnifiedCheckout : `launch_fee` + `subscription` deviennent des "kinds" (rapport 144).

## Composants / stores / guards
- **Composants** (`packages/ui`) : ManagerLayout (nav latérale par catégories/rôle), DataTable (tri + pagination), CrudForm, Calendar (planning), StatCards, ContractWizard, RoleGate.
- **Stores** : TanStack Query (toutes les listes/CRUD) ; `sessionStore` (role) ; pas d'état global lourd.
- **Guards** : `RequireRole(['admin','dev'])` (manager), `RequireRole(['dev'])` (`/dev`), `RequireActiveContract` (admin).

## Pagination & listes
- Listes potentiellement longues (ventes, send-logs, event-logs, webhook-failures, clients, paiements commission) : pagination `?page=&limit=` → `{items,total,page,limit}` (à harmoniser backend, cf. rapport 141). DataTable consomme ce contrat.

## Erreurs
- `FORBIDDEN_GESTION_ROLE` (403) → écran refus. `SUSPENDED_ADMIN_LOGOUT` → logout + message. `CONTRACT_INACTIVE` → onboarding/attente. Dictionnaire code→UX partagé (`packages/config`).

## API utilisées (résumé)
`/auth/*`, `/api/gestion/**` (sauf dev-only pour admin), `/api/contract/*`, `/api/commissions/*`,
`/api/gestion/dev/*` (dev), `/api/gestion/mails/*` (dev), `/api/gestion/site-status/*` (dev).

## MAJ U3 — Onboarding contrat & commissions via Checkout hébergé (backend prêt)
Avec `PLATFORM_CHECKOUT_HOSTED=true` : `POST /api/contract/create-launch-intent` et
`/create-monthly-setup`, et `POST /api/commissions/payments/:id/create-intent` renvoient
`{ mode:'hosted', url }` → l'app Manager (R3) redirige vers Stripe Checkout (Dev) au lieu d'Elements.
- launch fee / commission : mode payment ; abonnement : mode setup (collecte du moyen de paiement).
- Finalisation : webhooks Dev existants (`payment_intent.succeeded`, `setup_intent.succeeded`) ;
  `checkout.session.completed` réconcilie l'UnifiedCheckout. Flag off → Elements (fallback) inchangé.

## MAJ R0 — Squelette app manager (exécuté)
L'app `apps/manager` est créée. **Guards de rôle** (cf. rapport 147) :
- `/login` public (placeholder login manager).
- Tout le reste sous `RequireRole(['admin','dev'], loginPath="/login")` + `ManagerLayout` (nav
  latérale filtrée par rôle ; le lien « Développeur » n'apparaît que pour `dev`) :
  `/` (dashboard), `/onboarding/contrat`, `/planning`, `/reservations`, `/prestations`,
  `/formations`, `/produits`, `/cartes-cadeaux`, `/ventes`, `/remboursements`, `/commissions`,
  `/parametres`.
- Section **`/dev/*`** sous un second guard `RequireRole(['dev'], deniedPath="/")` + `DevLayout` :
  `/dev`, `/dev/contrats`, `/dev/commissions`, `/dev/integrated-api`, `/dev/email-templates`,
  `/dev/send-logs`, `/dev/event-logs`, `/dev/webhook-failures`. Un admin qui tente `/dev` est
  renvoyé au dashboard.
Chaque page = `Placeholder`, **aucun appel métier** (boot `/auth/me` seul). Tests :
`apps/manager/src/App.test.tsx` (anonyme→login, admin→dashboard, dev→`/dev`, admin bloqué sur
`/dev`). L'autorité reste le backend (401/403) ; les guards React sont UX. Les vraies pages arrivent
en **R3**.

## MAJ Theme Foundation — Thème panel (exécuté)
Le manager applique le **thème scope=panel** via `ThemeProvider scope="panel"` (dans `main.tsx`),
utilisant `defaultPanelTheme` (`@bs/ui`) — palette **bleu/ardoise distincte** de la vitrine
(violet/rose). Les CSS vars `--bs-*` sont appliquées sur `<html>` ; les composants lisent ces tokens
(aucun hex en dur). **Aucun endpoint backend** de thème panel pour l'instant → le défaut fait foi ;
le **Theme Studio Dev** (plan rapport 161 : `GET/PUT /api/gestion/dev/themes/:scope`, **dev only**,
preview live + validation + versioning) permettra de le configurer. Test :
`apps/manager/src/theme.test.tsx` (dashboard rendu + thème panel appliqué, distinct vitrine).

## MAJ T1 — Thème panel branché au backend (scope manager)
Le manager ne dépend plus uniquement du défaut local : `PanelThemeProvider`
(`apps/manager/src/features/theme/`) charge **`GET /api/theme/manager`** via
`getThemeByScope('manager')` (`@bs/api-client`), mappe par `mapBackendThemeToTokens` (`@bs/ui`), et
applique `ThemeProvider scope="panel"`. **Fallback systématique** sur `defaultPanelTheme` si
`theme:null` (aucune config manager) ou erreur réseau — jamais bloquant, aucune couleur visible
changée sans config. Backend : modèle `Theme.scope` (vitrine|manager), 1 actif/scope (index unique
partiel), CRUD dev `/api/gestion/themes` scope-aware (activation par scope), migration
`scripts/migrateThemesToScopes.js`. Le **Theme Studio Dev** (plan 161) éditera ce scope manager.
Tests : `features/theme/themeMultiScope.test.tsx` (fallback null/erreur + couleur backend).

## MAJ M1 — Identités de communication (backend prêt pour le Manager)
Le backend expose désormais des endpoints gestion pour les **expéditeurs de communication** que le
Manager/Dev React consommera (UI non créée en M1) :
- **Dev** (`requireStrictDev`) : `/api/gestion/dev/communication-identities` — gère l'identité
  **support** (scope platform) : `GET /`, `POST /support`, `POST /:id/request-verification|
  confirm-verification|set-active|refresh`.
- **Admin/Dev** (`requireAdminOrDev`) : `/api/gestion/communication-identities` — gère l'identité
  **commerciale** (scope institute) ; un admin **ne peut pas** gérer une identité support (403).
- Chaque identité : `email`, `displayName`, `status` (unverified/verification_pending/verified/
  disabled), `active`, vérification sender **Brevo** (Brevo envoie l'OTP), domaine DNS
  (`domainAuthenticated`/`dnsRecords`). Payload **sans secret**.
- Une future page Manager « Identités de communication » (dev: support, admin: commerciale) +
  écran de vérification sender/DNS s'appuiera sur ces endpoints. **client** n'est jamais configurable.

## MAJ M2 — Moteur d'envoi par rôles (backend prêt, UI future)
Un **Mail Event Dispatch Engine** backend route les e-mails par rôle au moment de l'événement (rapports
173/174) — pas d'UI en M2, mais une future page Manager/Dev s'y appuiera :
- **Règles** `constants/mailDispatchRules.js` : `event → templateKey → fromRole/toRole` (ex.
  `sale.finalized`→`vente` commerciale→client ; `commission.available`→`commission_available`
  support→commerciale). Le template ne porte aucune adresse.
- **Ledger** `MailEventDelivery` : journal idempotent des dispatchs (statuts shadow/skipped_*/sent/
  failed) — base d'un futur écran « Journal des communications » côté Dev.
- Flag `MAIL_ROLE_RESOLVER_ENABLED` (défaut off) ; en shadow tant qu'un envoi direct existe (anti-doublon).
- La future UI Dev pourra : visualiser/éditer les règles, voir le journal `MailEventDelivery`, et —
  avec les identités M1 — piloter entièrement « qui envoie quoi à qui ». **client** reste non configurable.

## Sprint M3A — Notification Target Engine admin/dev (backend, rapports 175-176)

Les notifications in-app ont désormais une **cible métier** `targetRole ∈ {admin, dev}` (audience/panel),
côté backend. L'app React manager consommera deux flux distincts :

- **Audience admin** — `GET /api/gestion/notifications` (+ `PATCH /:id/read`, `/read-all`, `DELETE /:id`).
  Renvoie l'audience admin (`targetRole != 'dev'`, legacy-safe). Accessible admin ET dev.
- **Audience dev** — `GET /api/gestion/dev/notifications` (+ mêmes actions sous `/api/gestion/dev/notifications`).
  **Strictement dev** (`requireStrictDev`) : un admin reçoit 403. À brancher dans la section `/dev`.

Réponse `GET` : `{ ok, notifications: [{ id, notificationId, title, message, category, targetRole,
link, linkLabel, eventType, isRead, createdAt }], unreadCount }`. Le champ `variables` n'est jamais
sérialisé (pas de fuite de payload). **Aucune UI React livrée en M3A** (hors périmètre) — la section
Notifications du Manager devra séparer visuellement Admin vs Dev. Mapping type→audience et règles :
voir `Rapports/version 1/176_rapport_m3a_notification_target_engine.md`. Suite : **M3B** (enrichissement
du contexte event).

## Sprint M3B — Event Context Enrichment (backend, rapports 177-178)

Les événements métier portent désormais un **contexte standard** (`payloadSafe.context` :
`related` IDs + `actors` + `variables` + `privacy`). Côté Manager/Dev, cela fiabilise les écrans
d'audit/journal d'events à venir (`/api/gestion/dev/events`) : chaque event expose ses IDs liés
(saleId, bookingId, refundId, commissionPaymentId, clientId…) et des variables safe (amount,
clientName, bookingDate…). **Aucun e-mail** n'est stocké (résolu via DB par `mailEventContextResolver`).
Les notifications gagnent `eventId/eventName/contextType/contextId` (corrélation event→notif, exposés
par `GET /api/gestion/notifications`). `targetRole` (M3A) inchangé. **Aucune UI React livrée.**
Détails : `Rapports/version 1/178_rapport_m3b_event_context_enrichment.md`. Suite : **M3C** (M2 en envoi réel).

## Sprint M3C — Activation e-mail événementiel : refund.succeeded (backend, rapports 179-180)

1er e-mail réellement migré du système direct vers le moteur événementiel M2 :
**refund.succeeded** (remboursement confirmé) part désormais via `commerciale→client` quand
`MAIL_ROLE_RESOLVER_ENABLED=true` (sinon e-mail direct legacy — rollback). Côté Manager/Dev, le
journal `MailEventDelivery` montre le statut réel (`sent`/`identity_missing`/`client_missing`) et le
journal `SendLog` les tags `from:commerciale`/`to:client`/`role-engine`. Les autres flux
(`booking.confirmed`, `sale.finalized`, `commission.*`) **restent en shadow**. Anti-doublon garanti
(une seule voie active selon le flag + ledger idempotent). **Aucune UI React.** Détails :
`Rapports/version 1/180_rapport_m3c_mail_event_activation.md`. Suite : **M3D** (aligner+migrer booking.confirmed).

## Sprint M3D — Activation booking.confirmed (backend, rapports 181-182)

2e flux migré vers le moteur événementiel M2 : **booking.confirmed** (confirmation prestation). L'event
est désormais émis par TOUS les chemins (checkout + report de créneau) ; quand
`MAIL_ROLE_RESOLVER_ENABLED=true`, l'e-mail part via `commerciale→client` (sinon e-mail direct legacy
au report — rollback). Journaux internes : `MailEventDelivery` (statut `sent`/`identity_missing`/
`client_missing`), `SendLog` (tags `from:commerciale`/`to:client`/`role-engine`). Idempotence par
`booking._id` : un report crée un nouveau booking → nouvelle confirmation ; replay → 1 e-mail. À noter :
au checkout flag true, le client reçoit l'e-mail « vente » (shadow) **et** la confirmation prestation
(engine) — deux e-mails distincts. **Aucune UI React.** Détails : `Rapports/version 1/182_rapport_m3d_booking_confirmed_activation.md`. Suite : **M3E**.

## Sprint M3E — Supervision mail (backend + api-client, rapports 183-184)

Couche de **supervision lecture seule** du moteur mail M2, prête à être consommée par un futur écran
Manager/Dev. Endpoints **admin** : `GET /api/gestion/mail-deliveries[/:id|/stats]` et
`GET /api/gestion/send-logs[/stats]` (roleView=admin → institut/client uniquement ; la plateforme
— commission, comptes, site — est masquée). Endpoints **dev** (`requireStrictDev`) : équivalents sous
`/api/gestion/dev/...` (vue complète safe). Filtres : status, eventName, templateKey, fromRole, toRole,
contextType, contextId, dateFrom, dateTo, limit (max 100). Stats : byStatus/byTemplate/byEvent,
shadow/active, failuresLast24h. **Privacy** : jamais d'e-mail (recipientHash seul), jamais de secret.
Client API : `@bs/api-client` → `manager/mailSupervision.ts` (`listMailDeliveries`, `getMailDeliveryDetail`,
`getMailDeliveryStats`, `listSendLogs`, `getSendLogStats` + types). **Aucun écran livré** (M3F).
Détails : `Rapports/version 1/184_rapport_m3e_mail_supervision.md`.

## Sprint M4 — Communication Center React (rapports 185-186)

Écran **Communication Center** dans l'app Manager (mobile-first), séparé admin/dev. **Aucun backend
modifié** — branché sur les endpoints M1 (identités) + M3E (supervision).

### Routes
- Admin (RequireRole admin|dev) : `/communication` (dashboard), `/communication/identite-commerciale`,
  `/communication/mails`.
- Dev (RequireRole dev) : `/dev/communication`, `/dev/communication/identite-support`,
  `/dev/communication/mail-deliveries`, `/dev/communication/send-logs`.

### Feature `apps/manager/src/features/communication/`
Layouts (`AdminCommunicationLayout`/`DevCommunicationLayout`), `IdentityManager` (react-query :
create/request-verification/confirm-OTP/set-active/refresh), `VerificationPanel`, `IdentityForm`,
`DnsStatusPanel`, `MailDeliveriesView`/`SendLogsView`, `MailFilterBar`/`MobileFilterDrawer`,
`MailStatsCards`, listes en cards, `StatusBadge`/`RoleBadge`. Styles `communication.css` (tokens
`--bs-*`, aucun hex dans les .tsx).

### API client (`@bs/api-client/manager`)
`communicationIdentities.ts` (admin→commerciale, dev→support ; OTP jamais stocké) ;
`mailSupervision.ts` étendu d'un paramètre `scope: 'admin'|'dev'` (base `/api/gestion` vs
`/api/gestion/dev` ; le `/dev/send-logs` legacy `{logs}` est normalisé).

### Mobile-first & privacy
Cards (jamais de table), filtres en drawer sur mobile, cibles tactiles ≥ 44px, états
loading/error/empty. Jamais d'e-mail client (recipientHash) ni de secret ; e-mail des identités
configurées affiché (adresse d'expéditeur). Admin bloqué hors `/dev/*`. Détails : rapport 186.
Suite : **M5** (Template Studio ou actions de supervision).

## Sprint M5 — Theme Studio React (rapports 187-188)

Theme Studio **dev-only** dans l'app manager : gère **2 thèmes** — Vitrine (site public) et **Panel**
(commun Manager/Admin **et** Dev). Vocabulaire UI = « Panel » ; mapping api-client `panel ↔ backend
scope 'manager'`, `vitrine ↔ 'vitrine'`.

### Routes (sous /dev, RequireRole dev)
`/dev/theme-studio` (dashboard 2 thèmes), `/dev/theme-studio/vitrine`, `/dev/theme-studio/panel`.

### Feature `apps/manager/src/features/themeStudio/`
`ThemeStudioLayout`, `ThemeStudioDashboard`, `ThemeEditor` (vitrine/panel), `ThemeForm` + champs
(`ColorField`/`TypographyField`/`RadiusField`/`ShadowField`/`SpacingField`/`LogoSloganFields`),
`ThemePreview` (aperçu live local par CSS vars inline, sans sauvegarde), `ThemeStatusCard`,
`ThemeActions`, `MobileThemeToolbar`. `themeDraft.ts` (logique + hex hors .tsx). CSS `themeStudio.css`
(tokens `--bs-*`, aucun hex dans les .tsx).

### API client (`@bs/api-client/manager/themeStudio`)
`listThemes`, `getActiveTheme`, `createTheme`, `updateTheme`, `activateTheme` + `toBackendScope`/
`toUiScope`. CRUD `/api/gestion/themes` (dev-only) ; actif `/api/theme/:scope`.

### Backend (additif)
`themeController` create/update acceptent désormais typography/radius/shadow/spacing (compat Vanilla,
`scope='manager'` conservé). Champs éditables : colors+accent, typo, radius, shadow, spacing ; logo/
slogan = vitrine. Couleurs sémantiques = défauts. Mobile-first, dev-only. Suite : **M6**.

## Sprint M6 — Mail Template Studio React (rapports 189-190)

Studio de templates e-mail **dev-only** (app manager). **Backend inchangé** (endpoints versioning M5A
existants ; aperçu rendu côté front).

### Routes (sous /dev, RequireRole dev)
`/dev/email-templates` (liste), `/dev/email-templates/:templateKey` (éditeur),
`/dev/email-templates/:templateKey/versions`.

### Feature `apps/manager/src/features/mailTemplates/`
`MailTemplateStudioLayout`, dashboard + `MailTemplateList` (filtres), `MailTemplateEditor`
(subject/html/text, draft→publish, rollback), `TemplatePreviewPane` (iframe `sandbox`, toggle
mobile/desktop, **aucun envoi**), `TemplateVariablesPanel` (utilisées + inconnues + catalogue),
`TemplateRoleBindingCard` (fromRole/toRole/event/mode, **jamais d'e-mail**), badges. CSS
`mailTemplates.css` (tokens `--bs-*`).

### API client (`@bs/api-client/manager/mailTemplates`)
`listMailTemplates/getMailTemplate/listMailTemplateVersions/createMailTemplateDraft/
publishMailTemplateDraft/archiveMailTemplateDraft/rollbackMailTemplate/previewMailTemplate` (front) +
`getTemplateRoleBinding` (miroir safe de mailDispatchRules — rôles uniquement). Endpoints
`/api/gestion/mails`.

### Séparation templates vs identités
Les templates ne contiennent **aucune adresse** ; expéditeur/destinataire sont des **rôles** résolus à
l'envoi. Les adresses sont gérées dans le **Communication Center** (M4). Mobile-first, dev-only.
Suite : **M7**.

## Sprint M10 — Planning global institut (rapports 197-198)

Décision métier : une seule entité = l'institut (plus de multi-prestataires ; `practitionerId` legacy
nullable déprécié, ignoré à la réservation). **Backend** : `GET /api/gestion/calendar/items` (admin/dev)
via `services/calendar/globalCalendarService.js` (`listGlobalCalendarItems` lit TOUT) +
`globalAvailabilityService.js` (`getGlobalAvailableSlots`/`createGlobalServiceBooking` sans practitionerId)
+ `instituteCalendarContext.js`. Flux checkout/refund inchangés.

**api-client** `@bs/api-client/manager/calendar.ts` : `listCalendarItems`, `getBookingDetail`,
`cancelBooking`, `markBalancePaid`, `rescheduleBooking` (lève — `RESCHEDULE_SUPPORTED=false`). Types
`CalendarItem/CalendarItemType/CalendarItemStatus/CalendarFilters`.

**Feature** `apps/manager/src/features/planning/` : `PlanningPage` (jour mobile par défaut / semaine
desktop, nav, filtres, drawer + actions), `usePlanning` (TanStack Query), composants `PlanningCalendar/
DayColumn/WeekView/MobileDayAgenda/CalendarItemCard/FormationSessionCard/CalendarItemDetailDrawer/
CalendarFiltersDrawer/BookingActionsPanel/BalanceDueBadge/PaymentStatusBadge/RefundStatusBadge`. CSS `pl-`
tokens `--bs-*`, aucun hex .tsx, zéro `<table>`, drawer bottom-sheet mobile / panel desktop, Motion
Guideline + reduced-motion. Routes `/planning` + `/planning/:date`. Actions = endpoints booking existants ;
report admin désactivé (pas d'endpoint). Suite : **M11**.

## Sprint M9 — Notification Center React + UX Motion (rapports 195-196)

Centre de notifications dans l'app manager (admin + dev). **Backend** : un seul changement — la
sérialisation `notificationController.listNotificationsCore` expose les métadonnées M8
(`categorySnapshot/priority/persistent/action/templateKey/templateVersion/categoryId/targetType/
expiresAt`) ; **`variablesSnapshot` jamais exposé**. Endpoints inchangés (admin `/api/gestion/notifications`,
dev `/api/gestion/dev/notifications`).

**api-client** `@bs/api-client/manager/notifications.ts` : `listNotifications(scope,filters?)`,
`getNotificationStats(scope)` (dérivé front), `markNotificationRead`, `markAllNotificationsRead`,
`deleteNotification`, `resolveNotificationAction` (action métier → route panel ; sinon `available:false`).
Pas d'`archive` (endpoint inexistant). Pas d'endpoint stats backend.

**@bs/ui** : `MotionTokens`, `prefersReducedMotion()`, `motionTransition()` + tokens CSS `--bs-motion-*`
+ media `prefers-reduced-motion: reduce` global.

**Feature** `apps/manager/src/features/notifications/` : `useNotifications(scope)` (TanStack Query,
polling 45 s + focus, mutations), `NotificationBell` (cloche+badge+shake+bandeau+drawer), et composants
`NotificationDrawer/List/Card/DetailPanel/FilterBar/CategoryChip/PriorityBadge/PersistentBadge/
ActionButton/EmptyState/Badge/PulseBanner/MotionProvider`. CSS `notificationCenter.css` (préfixe `nc-`,
tokens `--bs-*`, aucun hex .tsx ; couleur catégorie = donnée inline). Drawer = bottom-sheet mobile / panel
latéral desktop (`@media min-width:768px`).

**Layouts** : `ManagerLayout` header → `NotificationBell scope="admin"` ; `DevLayout` → `scope="dev"`
(monté uniquement pour dev). `App.test.tsx`/`theme.test.tsx` enveloppés d'un `QueryClientProvider`.

**React UX Motion Guideline** (à partir de M9) : mobile-first, animations légères (opacity/transform),
durées courtes (`--bs-motion-*`), micro-interactions utiles, pas de table sur mobile, feedback immédiat,
skeleton doux, cibles ≥44px, respect `prefers-reduced-motion`. À appliquer à tous les écrans suivants.

## Sprint M8 — NotificationEngine branché sur les templates (rapports 193-194)

Le moteur backend (`triggerNotification`) consomme les `NotificationTemplate` publiés (M7) +
`NotificationCategory`. **Additif & non destructif** : sans template publié → legacy identique. Le
template ne choisit jamais la cible (`targetRole` reste M3A). Flag `NOTIFICATION_TEMPLATE_RUNTIME_ENABLED`
(défaut ON ; rollback instantané). Côté React : `@bs/api-client/manager` ajoute un module **types-only**
`notifications.ts` (`RuntimeNotification`, `NotificationCategorySnapshot`, helpers
`notificationDisplayColor`/`Icon` — source = snapshot de catégorie, défaut `bi-bell`). **Aucun écran
modifié** (centre de notifications non refait → M9).

## Sprint M7 — Notification Studio React + Categories (rapports 191-192)

Studio de notifications **dev-only** (app manager) : templates (contenu) + catégories (modèle métier).
**Le template ne connaît PAS le scope** (admin/dev/both) — le moteur (`triggerNotification`, M3A) le
choisit. **Backend additif** (nouveaux modèles/services/routers, rien de cassé).

### Modèles (backend)
- `NotificationCategory` : name/slug/icon/color/description/sortOrder/active (source unique des
  couleurs du centre — aucune couleur dans le template).
- `NotificationTemplate` : templateKey/title/body/categoryId/variables[]/priority/persistent/action +
  versioning (draft/published/archived, 1 publié par clé). **Jamais** targetRole/scope/email.

### Routes (sous /dev, RequireRole dev)
`/dev/notification-templates[/:templateKey[/versions]]`, `/dev/notification-categories`.

### API client (`@bs/api-client/manager`)
`notificationCategories.ts` (CRUD) + `notificationTemplates.ts` (list/get/versions/create/createDraft/
publish/archive/rollback + previewNotificationTemplate front + NOTIFICATION_PRIORITIES/ACTIONS/
KNOWN_VARIABLES). Endpoints `/api/gestion/dev/notification-templates` et `…/notification-categories`.

### Feature `apps/manager/src/features/notificationTemplates/`
Studio (éditeur title/body + catégorie/priorité/persistent/action + variables + preview toast/centre,
sans envoi), categories studio (CRUD + aperçu), versions (publish/rollback/archive). CSS
`notificationStudio.css` (tokens `--bs-*`, aucun hex .tsx ; couleur catégorie = donnée inline).

### Priorité / persistent / action
priority low/normal/high/critical (prépare tri/push/badges) ; persistent (reste jusqu'au traitement) ;
action **métier** (jamais une URL). Notification Center : préparé (Notification.category → slug →
icône/couleur/badge). Suite : **M8** (câblage moteur + refonte centre).


## Sprint M11A — Checkout prod branche sur le calendrier global institut (rapports 199-200)

Fermeture de l ecart M10 : le checkout de PRODUCTION cree toute nouvelle ServiceBooking via le chemin GLOBAL institut (`createGlobalServiceBooking`). practitionerId reste legacy nullable, accepte mais IGNORE.
- Backend : `assertGlobalServiceSlotBookable` (globalAvailabilityService) ; finaliseur `processServiceCheckoutStatePurchase` -> createGlobalServiceBooking ; validations pre-paiement (stripeCheckoutService Elements/hosted + unifiedCheckoutValidationService) -> assertGlobalServiceSlotBookable ; route directe `createBooking` neutralisee ; `getAvailableSlots` ignore le practitionerId query.
- Regles paiement/remboursement/commission INCHANGEES ; aucune suppression DB.

**Manager** : le planning M10 (GET /api/gestion/calendar/items) recoit desormais les bookings crees par le checkout prod (chemin global) sans changement. practitionerId = institut.


## Sprint M11B — Finalisation calendrier global institut (rapports 201-202)

Finalisation : endpoint report admin GLOBAL + reschedule remboursement global + neutralisation runtime de practitionerId + script cleanup volontaire + index global. Aucune suppression DB ; paiement/remboursement inchanges.
- **Backend** : POST /api/gestion/bookings/:id/reschedule (rescheduleBookingByAdmin -> rescheduleGlobalServiceBooking, deplacement EN PLACE, validation+slot-lock globaux, audit booking.rescheduled + booking.confirmed). Reschedule remboursement (sessionCancellationFlowService) -> createGlobalServiceBooking. Mount-order corrige (gestionBookingRouter avant broad-mounts dev-only, M3A). scripts/cleanupPractitionerLegacy.js (dry-run/apply/force-prod, consolidation+archivage, index global opt-in). Index ServiceBooking {startAt,status}.

**Manager (planning)** : RESCHEDULE_SUPPORTED=true ; rescheduleBooking(id,{newStartAt,newEndAt,reason}) -> POST reschedule. usePlanning.reschedule (invalide au succes). RescheduleForm mobile-first (date+heure+motif, duree preservee, etats loading/error/success), BookingActionsPanel active si actionLinks.reschedule, PlanningPage onReschedule -> refetch+close. CSS pl-reschedule/pl-field tokens --bs-*. Aucun texte prestataire/praticienne. Pas de drag-to-reschedule.


## Sprint M12 — Customer 360 (Client Hub) (rapports 203-204)

**Manager** : feature apps/manager/src/features/customer360/ — pages ClientsListPage (/clients : recherche nom/e-mail + cartes resume) et Customer360Page (/clients/:id). Composants CustomerHeader/HeroCard/SummaryCards/FinancialCard/Timeline/TimelineCard/{Booking,Sale,Formation,Product,GiftCard,Refund,Documents,Communications,Notification}Section/QuickActions/CustomerDrawer/MobileBottomActions/CustomerSkeleton/CustomerEmptyState/CustomerTabs/Accordion/ClientSearchCard. Hooks useCustomer360/useCustomerSearch (TanStack Query), api-client manager/customer360.ts. CSS c3- tokens --bs-* (aucun hex .tsx), Motion Guideline + prefers-reduced-motion, cibles >=44px, zero table, drawer bottom-sheet. UX : Hero -> KPIs -> Quick Actions -> onglets (Activite=timeline / Details=accordions / Finances) -> barre d actions sticky mobile. Nav Clients. Backend agregation admin/dev (services/customer360/ + GET /api/gestion/customers[/:id/360]).


## Sprint M13 — Gift Card 360 + Manual Booking + Template Studio (rapports 205-206)

**Manager** : Customer 360 enrichi de 4 drawers (apps/manager/src/features/customer360/) — CreateGiftCardDrawer (POST /api/gestion/gift-cards/manual : recipientName/amount/manualPaymentMethod/note/message/template ; retour code+mot de passe+"Paiement sur place"+liens carte), ManualGiftCardDebitDrawer (lookup code OU QR colle -> solde -> montant+motif -> preview puis debit), ManualBookingDrawer (service->date->slot->hold 5 min->confirmation paiement sur place ; release au cancel), CustomerNoteDrawer (GET/POST /api/gestion/customers/:id/notes). QuickActions/MobileBottomActions : Reserver / Creer carte cadeau / Ajouter note / Appeler client (tel:) / Achats remboursables (ancre section). Pas de raccourci e-mail, pas de "derniere reservation".
**Librairie admin** (/cartes-cadeaux/templates, admin+dev) : cartes templates visibles + preview (iframe srcDoc), badge "Actif", "Choisir ce template" -> modal confirmation -> POST /templates/:id/activate. Admin ne peut PAS editer le HTML ; impossible de tomber a zero actif.
**Gift Card Template Studio (dev-only, /dev/gift-card-templates)** : feature apps/manager/src/features/giftCardTemplates/ — editeur HTML/CSS + preview live (POST /preview -> iframe sandbox, QR factice), toggle mobile/desktop, versions + draft/publish/rollback. Aucun envoi reel.
**api-client** : packages/api-client/src/manager/ giftCards.ts, giftCardTemplates.ts, giftCardLibrary.ts, manualBooking.ts, customerNotes.ts. CSS prefixes dedies, tokens --bs-* (zero hex), Motion Guideline + reduced-motion, cibles >=44px, mobile-first, zero table.


## Sprint P1 — Product Polish & UX (rapports 207-208)

Manager : adoption de la couche @bs/ui/polish (focus visible global, micro-interactions, primitives, presets motion). Corrections ciblées : ManagerLayout/DevLayout en NavLink + .bs-nav-link.active (état « vous êtes ici »), sidebar responsive (.bs-sidebar-layout/.bs-sidebar : colonne desktop → rangée wrap mobile, suppression minWidth:180), skip-link, ajout du lien dev « Modèles carte cadeau » (M13 manquant) ; cibles tactiles 44px (pl-viewbtn/pl-filter/pl-iconbtn, nc-iconbtn) ; modale giftCardLibrary en bottom-sheet ≤640px ; défauts de cache TanStack Query (retry1/no-refetch-focus/staleTime). Aucun changement métier. Réf : docs/ProductUXGuideline.md.

## C1 — Catalogue Studio (`features/catalogue/`)
Module Catalogue manager : routes `/catalogue` (dashboard) · `/catalogue/prestations[/new|/:id]` ·
`/catalogue/formations[/new|/:id]` · `/catalogue/cartes-cadeaux` · `/catalogue/produits` (placeholder
désactivé). Nav « Catalogue ». Pattern **CatalogueModuleStepper** (ProductUXGuideline §11) : header sticky
(statut/visibilité/progression/CTA), stepper modules (chips mobile / rail desktop, **statut par module** +
chevron actif), drawer de validation (blocages cliquables). Éditeurs `ServiceEditor`, `TrainingEditor`
(type-aware présentiel/distanciel), `GiftCardCatalogueEditor`, `TrainingSessionEditor` (réutilise le
calendrier M10 + QR présence). Hooks `useCatalogue.ts` (TanStack). Logique de blocage pure `validation.ts`.
api-client `manager/catalogue.ts`. CSS `cat-` (tokens `--bs-*`, 44px, 768px, zéro table/hex). Produits non
développés. Détail : rapport 210.

## C2 — Learning Studio + Présence
Éditeur distanciel C1 enrichi d'un module **Contenu** (`features/catalogue/learning/ChapterEditor.tsx` :
accordion chapitres → leçons, `LessonDrawer` avec `LessonEmbed` preview + `ResourceList`). api-client
`manager/learning.ts`. Présence : `features/learning/SessionPresencePage.tsx` (route
`/catalogue/formations/:id/sessions/:sessionId/presence`, lien depuis la carte session) + `QrScanner`
(html5-qrcode, import dynamique). Customer360 `FormationSection` enrichie (progression/présence). Détail :
rapport 212.

## S1 — Paramètres Système (dev)
Feature dev-only `features/systemSettings/SystemSettingsPage.tsx` (route `/dev/system`, nav
« Paramètres Système »). Source unique de la config métier : sections 🌐 Domaines, 🏢 Institut,
🌍 Localisation, 💰 Fiscalité, 🔧 Système, ⚠️ Maintenance. Domaines = validation live des URLs
(`validateDomainUrl` : HTTPS hors localhost/dev, sans slash final), copie d'URL, repli affiché.
Mobile-first (cibles 44px). api-client `manager/systemConfiguration.ts` (GET/PUT
`/api/gestion/dev/system-configuration`). Backend : `SystemConfiguration` (singleton) + `DomainResolver`
(toutes les URLs générées en découlent). Détail : rapports 213/214.

## C3 — Attestations, QR prod, reorder, modération avis
QR scanner durci (`features/learning/QrScanner.tsx` : caméra multi, permission UX, fallback saisie manuelle,
debounce, vibration). Présence filtrée (présent/absent/en attente). Reorder chapitres/leçons (boutons
monter/descendre dans `ChapterEditor`). Modération avis : `features/reviews/ReviewModerationPage` (route
`/avis`, nav « Avis »), api-client `manager/learning.ts` (listReviewsForModeration/moderateReview).
Customer360 `FormationSection` → lien attestation (`managerAttestationUrl`) si formation terminée. Détail :
rapport 216.

## RX1 — Frontend officiel
Manager servi officiellement sous `/manager` (Vite base `/manager/`, BrowserRouter basename, flag
REACT_OFFICIAL_FRONTEND avec rollback). Serving : `services/system/reactFrontend.js` (Express). Migration
restante (RX2) : finance premium (ventes/commissions/remboursements en cards/timeline/drawer, sans tableaux),
réservations, paramètres, dev tools. Détail : rapport 222 + `docs/migration/VANILLA_RETIREMENT_PLAN.md`.


## RX2 — Espace Finance (`features/finance/`)
Feature finance React (préfixe `fin-*` / `fin-tl-*`, tokens `--bs-*`, zéro hex, mobile-first, ≥44px).
- **RX2.1 Finance Dashboard** (`/finance`, nav « Finance ») : `FinanceDashboardPage` (héros revenu signé,
  chips ventilation, cartes d'action navigables), `useFinanceDashboard`. api-client `manager/finance.ts`
  (`getFinanceDashboard`, `updateRefundStatus`).
- **RX2.2 Financial Timeline** (`/finance/timeline`, lien depuis le dashboard) : `FinanceTimelinePage`
  (résumé sticky `FinanceTimelineSummary`, chips période/type, cards `FinanceTimelineCard`, drawer
  `FinanceMovementDrawer`), `useFinanceTimeline`, api-client `getFinanceTimeline` + types
  (`FinanceTimelineItem`/`…Summary`/`…Filters`/`FinanceMovementType`/`FinanceMovementStatus`). Backend autorité
  (aucun calcul de montant côté front). Détail : `docs/RX2_2_FINANCIAL_TIMELINE_REPORT.md`.


## RX2.3 — Détail mouvement, remboursement 1-clic, profit net (`features/finance/`)
`FinanceMovementDrawer` (movementDrawer.tsx, préfixe `fin-md-*`) charge le détail via
`useFinanceMovementDetail` (`GET /api/gestion/finance/movement-detail`) : **Détail du paiement**
(`FinancePaymentBreakdownCard`) + **Profit net estimé** (`FinanceNetProfitCard`, gère « Données partielles »
si frais Stripe en attente) + **Documents liés** + footer sticky. Actions interactives : `RefundProcessPanel`
(accepter/refuser via `useProcessRefund` → route B1) et `BalanceCollectPanel` (CB/espèces/autre via
`useMarkBalancePaid` → balance-paid M11). api-client : `getFinanceMovementDetail`, `processRefundStatus`,
`markBookingBalancePaid` + types (`FinanceMovementDetail`/`FinancePaymentBreakdown`/`NetProfitStatus`/
`StripeFeesStatus`). Backend autorité (aucun calcul de montant front). Détail : `docs/RX2_3_PAYMENTS_REFUNDS_NET_PROFIT_REPORT.md`.


## RX2.4 — Paiements sur place unifiés (`features/finance/`)
Les prestations payées 100 % sur place (réservation manuelle) apparaissent dans la timeline (« Paiement sur
place à encaisser / encaissé ») et le dashboard (« À encaisser sur place »), avec un encaissement en un geste
depuis le drawer (`BalanceCollectPanel` : wording adaptatif full vs solde, moyen CB/espèces/autre via
`useMarkBalancePaid` → `markBalancePaidOnSite` généralisé). Backend = filtre unifié ONSITE_DUE partagé
timeline+dashboard. Détail : `docs/RX2_4_ONSITE_PAYMENTS_REPORT.md`.


## RX2.5 — Commissions premium (`features/finance/`)
`CommissionOverviewPage` (`/finance/commissions`, nav « Commissions ») : `CommissionCurrentCard` (« Commission
ce mois · à payer avant le … · Voir détail · Payer »), `CommissionSettingsPreview`, `CommissionHistoryList`.
`CommissionDetailPage` (`/finance/commissions/:year/:month`) : `CommissionBreakdownCard` (carry-over visible),
`CommissionPaymentStatusCard` (échéance/grace/statut via `CommissionLateStatusBadge`), `CommissionInvoiceCard`,
`CommissionPaymentAction` (paiement Stripe Dev hébergé U3 : redirection si `url`, « Aucune commission à payer »
si settledZero). api-client `manager/commissionFinance.ts` (getCommissionOverview/History/Detail +
createCommissionPaymentIntent/checkCommissionPaymentStatus). Préfixe `fin-comm-*`, tokens --bs-*, zéro hex.
Backend autorité (aucun calcul front). Détail : `docs/RX2_5_COMMISSION_PREMIUM_REPORT.md`.


## RX2.6 — Gift Card Finance (`features/finance/`)
`FinanceGiftCardsPage` (`/finance/cartes-cadeaux`, lien dashboard) : résumé sticky (solde actif/émis/utilisé/
cartes), filtres circuit+statut, liste en cards (code masqué, badges Active/Épuisée + Stripe/Paiement sur
place). `GiftCardFinanceDetailPage` (`/finance/cartes-cadeaux/:giftCardId`) : solde, acheteur/bénéficiaire
(liens Customer360), source paiement, QR masqué, cycle de vie (GiftCardLifecycleTimeline), remboursements
splittés (parts Stripe/carte cadeau + anomalies rollback), transactions, actions. api-client
listFinanceGiftCards/getFinanceGiftCardDetail. Préfixe fin-gc-*, tokens --bs-*, zéro hex. AUCUNE mention
d'expiration. Backend autorité (code/token jamais complets). Détail : `docs/RX2_6_GIFT_CARD_FINANCE_REPORT.md`.


## RX-BLOCKER-2 — Comptes manager, invitations & reset (`features/managerUsers/` + `pages/Manager*`)
`ManagerUsersPage` (`/manager/users`, **dev-only** : `RequireRole allow={['dev']}` sous `ManagerLayout`) : liste
en cards + badges statut, `CreateDrawer` (prénom/nom/e-mail/rôle, **aucun champ mot de passe**), actions
renvoyer/activer/désactiver via TanStack mutations (`queryKey ['manager-users']`). api-client
`manager/managerUsers.ts` (list/create/resend/disable/enable → `/api/gestion/manager-users*`).
Pages d'auth **publiques** (hors `RequireRole`/`ManagerLayout`, coquille `ManagerAuthShell`) :
`ManagerInvitationPage` (`/invitation/:token` → `auth/invitations.ts` get/accept), `ManagerForgotPasswordPage`
(`/mot-de-passe-oublie` → `requestPasswordReset`), `ManagerResetPasswordPage`
(`/reinitialiser-mot-de-passe/:token` → `validateResetToken`+`completePasswordReset`, **mêmes** endpoints que le
client). Le backend route l'expéditeur par rôle (manager→support, client→commerciale). Politique mot de passe
partagée (`passwordError`), tokens `--bs-*`, zéro hex, mobile-first. Token jamais affiché/loggé. Liens e-mail
flag-aware (`services/system/frontendUrl.js`). Détail : `docs/RX_BLOCKER_2_USERS_INVITATIONS_REPORT.md`.

## RX-POLISH-BLOCKER — Manager UX, planning, avis et dev panel

Livraison transverse de finition produit sur l'app manager, sans suppression de backend métier.

- **Navigation / finance** : `ManagerLayout` expose un vrai groupe `Finance` expansible avec sous-liens
  visibles et état actif enfant précis. Les routes historiques `/ventes` et `/remboursements` redirigent
  vers la timeline finance filtrée (`?type=sale|refund`) ; `/reservations` renvoie vers `/planning`.
- **Planning réel** : `features/planning/` utilise une grille horaire jour/semaine branchée au calendrier
  global institut. Les réservations et sessions présentielles sont positionnées sur la journée, avec zones
  fermées grisées, créneaux bloqués et repères horaires.
- **Disponibilités / exceptions** : `packages/api-client/src/manager/availability.ts` et l'UI planning
  branchent les horaires hebdomadaires + exceptions ponctuelles (fermeture, blocage de créneau,
  ouverture exceptionnelle). Le backend reste autoritaire sur les conflits.
- **Détail booking** : le drawer de réservation affiche `Total`, `Acompte payé`, `Reste à payer` à partir
  des montants backend uniquement.
- **Réservation manuelle** : le parcours visible de réservation manuelle de prestation est retiré de l'UX
  manager / Customer 360 ; le backend reste conservé hors démo.
- **Avis premium** : `features/reviews/ReviewModerationPage` modère désormais les avis `formation` et
  `service`, filtre par statut/type, et permet la création d'avis manuel sans faux client via
  `sourceType='manual_institute'`.
- **Langage de notation** : les avis manager utilisent `PawRating` / `PawInput`, sans étoiles visibles.
- **Dev panel utile** : les routes `/dev`, `/dev/integrated-api`, `/dev/event-logs`, `/dev/webhook-failures`
  affichent des vues réelles ou des diagnostics utiles au lieu d'un `ComingSoon` vide.

Tests clés :
`managerPlanningCalendar.test.tsx`, `managerPlanningAvailability.test.tsx`,
`bookingDetailAmounts.test.tsx`, `reviews.test.tsx`, `devPanelNoEmptyComingSoon.test.tsx`,
`managerDevPanelRoutes.test.js`, `planningAvailabilitySettings.test.js`, `planningDayExceptions.test.js`,
`reviewManualCreation.test.js`.
