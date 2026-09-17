# FolderArchitecture — Beauty Savage React (global)

> Architecture globale du frontend React **parallèle** au Vanilla existant. Source de vérité
> technique inter-apps. Mise à jour OBLIGATOIRE à chaque sprint qui touche l'architecture globale.
> Liens : [Vitrine](./VitrineArchitecture.md) · [Manager](./ManagerArchitecture.md) ·
> [Contexte produit global](./FolderProjectContext.md).

## Vue d'ensemble
```
beautysavage.fr          → app React "vitrine" (public + client)
manager.beautysavage.fr  → app React "manager" (role admin) + section /dev (role dev)
backend Express (Node)   → API JSON + webhooks Stripe/Brevo (INCHANGÉ), /api proxifié par app
Vanilla (backend/public) → reste actif jusqu'à bascule (rollback)
```

## Monorepo `frontend-react/`
```
frontend-react/
  apps/
    vitrine/      # SPA publique + client (beautysavage.fr)
    manager/      # SPA manager + /dev (manager.beautysavage.fr)
  packages/
    api-client/   # client HTTP typé (fetch credentials:'include'), mapping codes erreur, hooks TanStack Query
    ui/           # design system (tokens depuis /api/vitrine/theme), composants partagés
    auth/         # session (/auth/me), guards RequireAuth / RequireRole, login
    config/       # env, constantes, dictionnaire codes erreur → UX
  docs/           # cette documentation (Folder*, Vitrine*, Manager*)
```

## Stack
- **Vite + React + TypeScript** (typage des payloads/erreurs/montants/statuts).
- **React Router** (routes réelles ; fin du routing `?slug=`/`?module=`).
- **TanStack Query** (cache/refetch/états serveur ; pas de Redux).
- **Zod** (validation des payloads API aux frontières — optionnel mais recommandé).
- CSS : **à décider** (CSS Modules vs Tailwind) — voir `packages/ui`. Le thème vient de `/api/vitrine/theme` (CSS custom properties), à conserver dynamique.
- **Playwright** (E2E) — plus tard (cf. rapport 140).

## Backend / API
- API JSON existante, **inchangée** (cf. rapport 139). Enveloppe `{ ok, ...data }` / `{ ok:false, error, code }`.
- Auth : cookie `beautysavage_session` (HttpOnly, signé, SameSite=Lax, Secure prod). `credentials:'include'` obligatoire.
- **Prérequis backend** : cookie élargi à `Domain=.beautysavage.fr` (partage session vitrine ↔ manager). CORS uniquement si API sur origine dédiée (évité par proxy `/api`).
- Paiement : **Stripe Checkout hébergé** (montant > 0) via le moteur **UnifiedCheckout** (rapports 143/144) ; **finalize-free** (0 €).

## Auth & routing
- Boot : `GET /auth/me` → `{ role, mustChangePassword }`. Guards React = UX ; le backend (401/403) reste l'autorité.
- `vitrine` : routes publiques + routes client (auth). `manager` : routes admin (RequireRole admin/dev) + `/dev` (RequireRole dev).
- Le toggle vitrine/gestion est **supprimé** (séparation par domaine, pas par mode).

## Conventions
- TypeScript strict ; payloads API typés dans `packages/api-client`.
- Erreurs : ne jamais se fier au texte `error` ; mapper le `code` via le dictionnaire (`packages/config`).
- Montants : formatage front (Intl `fr-FR`) ; le **serveur fait foi** (ne jamais recalculer un total à charger).
- Dates : ISO en transport, affichage `fr-FR`.
- Pas de secret côté front (clé Stripe publique via `/api/stripe/config`).

## Stratégie de migration (résumé)
- React construit en parallèle ; Vanilla conservé. Bascule **manager d'abord** (audience interne) puis **apex** (public). Rollback DNS/proxy/feature-flag. **Zéro changement d'endpoint.** Détails : rapports 137, 146, 149.

## Règle de documentation
Chaque sprint React met à jour la doc du scope touché (Vitrine* ou Manager*) **et** ce fichier +
[FolderProjectContext](./FolderProjectContext.md) si l'architecture globale change.

## MAJ U1 — Fondations UnifiedCheckout (backend)
Le moteur backend `UnifiedCheckout` (kinds institut: service/formation/product/gift_card/cart) est
livré en parallèle (rapport 151) : `models/UnifiedCheckout.js` + `services/checkout/unified/*`,
snapshots serveur (pricing/tax/legal), idempotence par clé, finaliseur qui DÉLÈGUE aux finaliseurs
existants. NON câblé aux endpoints live en U1. U2 = câblage + Stripe Checkout hébergé (redirection
`url`, webhook `checkout.session.completed`). Le client React (`packages/api-client`) consommera un
point d'entrée unique de paiement.

## MAJ U2 — UnifiedCheckout câblé + Stripe Checkout hébergé
Feature flag backend `CHECKOUT_HOSTED` (défaut false). `false` → Stripe Elements inchangé ;
`true` → `create-checkout-session` crée un UnifiedCheckout et renvoie `{ mode:'hosted', url }`
(redirection Stripe Checkout) ou `{ mode:'free', checkoutId }` (0 € → finalize-free). Webhook
`checkout.session.completed` → finalisation idempotente (délègue à `processCheckoutStatePurchase`).
Côté React : `packages/api-client` gère la réponse `mode:'hosted'` (redirection vers `url`) /
`mode:'free'` ; la bascule UI (consommer `url`) est le chantier R2.

## MAJ U3 — UnifiedCheckout plateforme (Stripe Dev)
Kinds plateforme ajoutés : `commission`, `launch_fee`, `subscription` (provider `stripe_dev`), flag
`PLATFORM_CHECKOUT_HOSTED` (défaut false). true → Stripe Checkout hébergé (mode payment commission/
launch, mode setup abonnement) ; finalisation par les webhooks Dev EXISTANTS. Indépendant du flag
institut `CHECKOUT_HOSTED`. Côté React : le Manager (R3) consomme `create-intent`/`create-launch-intent`/
`create-monthly-setup` → `{ mode:'hosted', url }` (redirection) ou ancien `clientSecret` (flag off).

## MAJ R0 — Infrastructure React posée (exécutée)
Le monorepo `frontend-react/` est **opérationnel** (npm workspaces) : apps `vitrine` + `manager`,
packages `config`/`api-client`/`auth`/`ui`. Stack figée : **Vite 5 + React 18 + TS strict + React
Router 6 + TanStack Query 5** ; tests **Vitest + Testing Library (jsdom)** ; lint **ESLint 9** (flat).
CSS = **tokens CSS variables** dans `@bs/ui` (pas de Tailwind). Alias `@bs/*` → `packages/*/src`
(pas d'étape de build des packages : source TS importée directement).
- **Proxy dev** : Vite proxifie `/api`, `/auth` (⚠️ l'auth est hors `/api`, montée sur `/auth` dans
  `app.js`) et `/uploads` vers `VITE_PROXY_TARGET` (défaut `http://localhost:3000`) → same-origin,
  pas de CORS, cookie `beautysavage_session` via `credentials:'include'`.
- **api-client** : `apiFetch`/`apiGet`/`apiPost`, `ApiError`, types (`Role`, `AuthUser`,
  `MoneyAmount`, `DateIso`, `ApiResult`), `getSession()` (GET `/auth/me`) + `logout()`.
- **auth** : `AuthProvider` (boot `/auth/me`, `loader` injectable pour tests), `useAuth`,
  `RequireAuth`, `RequireRole` ; relabel UI `admin→Manager`, `dev→Développeur` (rôles backend
  inchangés).
- **Validation** : `react:build` (2 apps), `react:test` (12 tests verts), `react:lint`,
  `typecheck` — tous verts. Suite backend inchangée (aucun fichier backend métier touché ; seuls des
  scripts `react:*` ajoutés au `package.json` racine).
- **Limite R0** : aucune vraie page métier (placeholders) ; seul `/auth/me` est appelé (boot).
  Prochaine phase **R1** = première vraie page vitrine. Cf. rapport 157.

## MAJ R1 — Catalogue vitrine public (exécuté)
Première consommation réelle de l'API publique (rapports 158/159). **Zéro changement backend.**
- **Proxy durci** : `PROXY_PATHS`/`buildProxyMap` dans `@bs/config` (source unique testée) ;
  `vite.shared.makeApiProxy` le réutilise pour les 2 apps (`/api`,`/auth`,`/uploads`).
- **`@bs/api-client/catalog`** : types publics (Service/Training/Product/GiftCardConfig/SiteStatus),
  format (prix fr-FR + médias `/uploads`), mappers tolérants, clients `services/shop/trainings/
  products/giftCards/site`. Le serveur fait foi sur les prix (jamais recalculés).
- **`@bs/ui`** : composants catalogue (`CatalogueGrid` responsive 1/2/3 col, `CatalogueCard`,
  `PriceLabel`, `MediaImage`, `SectionHeader`, `EmptyState`) — présentation pure (pas de dépendance
  data, props préformatées).
- **Vitrine** : pages réelles accueil + 4 catalogues (+ détails formations/produits/prestations),
  hooks TanStack Query (cache `/shop` partagé), états loading/error/empty, `SiteStatusBanner`.
- **Limite** : pas de checkout/paiement (R2) ; carte cadeau = config seule ; manager/dev intacts.
  26 tests frontend verts ; backend inchangé.

## MAJ Theme Foundation — Système de thème React (exécuté)
Fondation de thème **deux scopes** (`vitrine` / `panel`), couleurs **jamais en dur** dans les
composants (rapports 160/161/162). **Zéro changement backend** ; Vanilla intact.
- **`@bs/ui/theme`** : `ThemeTokens` (colors étendus + radius/shadow/font/spacing), `defaultVitrineTheme`
  (violet/rose, aligné Vanilla), `defaultPanelTheme` (bleu/ardoise, **distinct**), `themeToCssVars`
  (tokens → `--bs-*`), `applyThemeVars`, `mergeTheme`, `normalizeHex`, `ThemeProvider scope`,
  `useThemeTokens`.
- **CSS variables** : les composants `@bs/ui` lisent EXCLUSIVEMENT `--bs-color-*` / `--bs-radius` /
  `--bs-shadow` / `--bs-font-sans` / `--bs-space-*`. `tokens.css :root` = fallback ; le `ThemeProvider`
  réécrit ces vars sur `<html>` selon le scope.
- **Vitrine** : `VitrineThemeProvider` charge `/api/vitrine/theme` (best-effort, TanStack Query) →
  mappe vers une surcharge partielle (hex normalisés) → `ThemeProvider scope="vitrine"` ; fallback
  défaut si l'API échoue (jamais bloquant).
- **Manager** : `ThemeProvider scope="panel"` + `defaultPanelTheme` (pas d'endpoint → Theme Studio Dev
  futur, plan 161 : `/api/gestion/dev/themes/:scope`, dev-only).
- **Règle** : tout sprint React qui touche l'UI lit les tokens (`--bs-*`), jamais de hex en dur.

## MAJ T1 — Thème backend multi-scope (exécuté)
Le backend gère désormais deux scopes de thème (`vitrine` / `manager`) — rapports 163/164. **Aucune
régression** (endpoints/payload/couleurs inchangés sans config). 
- `models/Theme.js` : `+scope enum['vitrine','manager'] default vitrine` (legacy sans scope = vitrine)
  + champs additifs optionnels (typography/radius/shadow/spacing/metadata) + index unique partiel
  `theme_active_per_scope` (1 actif/scope).
- Endpoints : `GET /api/vitrine/theme` **conservé** (vitrine) ; **`GET /api/theme/:scope`** public
  (vitrine|manager, `theme:null` si aucun actif) ; CRUD dev `/api/gestion/themes` accepte `scope`,
  activation **par scope**.
- Migration `scripts/migrateThemesToScopes.js` (dry-run/`--apply`, idempotente).
- React : `@bs/api-client` `getThemeByScope(scope)` ; `@bs/ui` `mapBackendThemeToTokens` (mapping
  neutre réutilisé vitrine + manager). Manager : `PanelThemeProvider` charge `/api/theme/manager`
  (fallback `defaultPanelTheme`). Vitrine inchangée.

## MAJ R2A — Préparation checkout (panier, créneau, consentements)
Couche de **préparation** du checkout, **sans paiement** (rapports 165/166). Aucun appel Stripe /
create-checkout-session ; aucun changement backend.
- **`@bs/api-client/booking/`** : `availability` (jours/créneaux), `legalConsents`
  (`isLegalConsentComplete`), `checkoutPreparation` (`buildCheckoutPreparationPayload` — **pur**),
  types (AvailabilitySlot, SelectedServiceSlot, LegalConsentState, CheckoutLine, CheckoutPreparationPayload).
- **Vitrine** : `features/cart` (`CartProvider`/`useCart`, localStorage versionné, indicatif),
  `features/booking` (`AvailabilityCalendar`/`SlotPicker`/`ServiceBookingPanel`), `features/legal`
  (`LegalConsentChecklist`). Pages réelles `/panier` + `/checkout` (préparation, payload en debug).
- **Règle confirmée** : le backend fait foi (prix/dispo/lock) ; le front prépare seulement. Pas de
  lock de créneau côté front. Composants 100 % tokens `--bs-*` (aucun hex). 54 tests frontend verts.
- Prochaine : **R2B** (paiement Stripe Checkout hébergé).

## MAJ R2B — Paiement Stripe Checkout hébergé + finalize-free
Le checkout React appelle le **backend** pour payer (rapports 167/168). **Aucun Stripe.js / aucun
appel Stripe direct ; aucun changement backend.**
- **`@bs/api-client/checkout/`** : `createCheckoutSession({checkoutState})` (`/api/stripe/create-checkout-session`,
  body direct), `finalizeFreeCheckout` (`/api/client/checkout/finalize-free`), `getPaymentResult`
  (`/api/stripe/payment-result`), `buildServiceCheckoutState` (sans montant), `buildIdempotencyKey`.
- **`/checkout`** : bouton « Payer / Confirmer » → `hosted` (`window.location.assign(url)`) / `free`
  (finalize-free → `/paiement/succes`) / `elements` (flag off → message) / `401` (connexion requise,
  panier conservé) / erreur (ErrorState + mapping `@bs/config`).
- **`/paiement/succes`** (free / payment_intent_id → payment-result ; wording **prudent** si pending)
  et **`/paiement/annule`** (panier conservé).
- **Limite** : `success_url`/`cancel_url` hosted = backend (Vanilla) → flow free 100 % React ; hosted
  prêt côté React dès paramétrage backend (R2C). 71 tests frontend verts. Backend = source de vérité.

## MAJ R2C — Retour Stripe React + login client (exécuté)
La boucle paiement React est fermée (rapports 169/170). Backend touché **uniquement** sur les URLs de
retour + lecture session-status (aucun pricing/finalizer/consentement).
- **Backend** : `CHECKOUT_RETURN_BASE_URL` (env, fallback Vanilla, http(s) only → pas d'open redirect)
  → `success_url={base}/paiement/succes?session_id={CHECKOUT_SESSION_ID}&checkoutId=…`,
  `cancel_url={base}/paiement/annule`. `session-status` résout désormais les ids `cs_…` (Checkout
  Session → PaymentIntent).
- **api-client** : `getCheckoutSessionStatus(sessionId)` (mapping succeeded/pending/failed/unknown),
  `auth/login(email,password)` (cookie HttpOnly ; getSession/logout existants).
- **Vitrine** : `/paiement/succes` (free / session_id / payment_intent_id ; **panier vidé seulement si
  confirmé** ; wording prudent si pending), `/paiement/annule` (panier conservé), `/connexion`
  (`LoginPage` léger → `refresh()` + redirect interne validé). `/checkout` 401 →
  `/connexion?redirect=/checkout` (panier conservé). 91 tests frontend / 411 backend verts.
- **Limite** : retour React effectif si `CHECKOUT_RETURN_BASE_URL` défini (sinon Vanilla). Pas
  d'inscription/reset/OAuth.

## MAJ M1 — Identités de communication (backend, brique additive)
Fondation backend `CommunicationIdentity` (rapports 171/172) — **aucune UI React encore**, aucun
envoi migré, mailService/SendLog/webhook **non touchés**.
- Modèle `CommunicationIdentity` : rôles **support** (scope platform, dev) / **commerciale** (scope
  institute, admin) ; **client** jamais une identité (résolu depuis le contexte). status/active,
  vérification sender Brevo, domaine DNS (`domainAuthenticated`/`dnsRecords`). 1 actif par role/scope.
- Services : `communicationIdentityService` (create/verify/setActive/assertReady),
  `communicationBrevoSenderAdapter` (mockable), `communicationRoleResolver` (resolveSender/Recipient/
  MailEnvelope — **non câblé** aux envois, M2).
- Endpoints gestion : `/api/gestion/dev/communication-identities` (dev, support) +
  `/api/gestion/communication-identities` (admin/dev, commerciale). Aucun secret exposé.
- **Côté React (futur)** : le Manager/Dev consommera ces endpoints (UI de gestion des expéditeurs) —
  pas en M1. Le client React continue d'utiliser l'API existante ; rien ne change pour la vitrine.

## MAJ M2 — Moteur d'envoi e-mail par rôles (backend, brique additive)
Le backend possède désormais un **Mail Event Dispatch Engine** (rapports 173/174) : event métier →
règle (`constants/mailDispatchRules.js`) → fromRole/toRole → resolver M1 → template → gateway →
SendLog, **idempotent** (`models/MailEventDelivery.js`). Flag `MAIL_ROLE_RESOLVER_ENABLED=false` (défaut
→ no-op) ; les envois directs existants sont **conservés** (moteur en **shadow** pour éviter les
doublons). SendLog/EventLog **inchangés** (rôles tracés via `metadata.tags`). **Aucune UI React** — un
futur écran Manager/Dev affichera les règles + le journal `MailEventDelivery`. Rien ne change pour la
vitrine/client React.

## Sprint M3A — Notification Target Engine admin/dev (backend, rapports 175-176)

Même principe que M2 (mail dispatch) appliqué aux **notifications in-app** : `Notification.targetRole`
devient une **cible métier** `admin|dev` (enum, default admin, indexé) — l'audience/panel. `targetType`
(all/role/user) reste la granularité de livraison. Service `services/notificationTargetService.js`
(resolve/normalize/assert) + mapping type→audience. `triggerNotification(type, vars, options?)` persiste
toujours `targetRole` (3e arg optionnel, anciens appelants intacts). Deux endpoints filtrés :
`/api/gestion/notifications` (admin, legacy-safe `{$ne:'dev'}`) et `/api/gestion/dev/notifications`
(dev-only `requireStrictDev`). Backfill `scripts/backfillNotificationTargetRole.js` (dry-run/--apply,
non destructif). **Aucune UI React** en M3A. Règles mail M2 inchangées. Rien ne change pour la
vitrine/client. Suite : **M3B** (enrichissement contexte event).

## Sprint M3B — Event Context Enrichment (backend, rapports 177-178)

Les events deviennent une **source de contexte standard** : `constants/eventContextSchema.js`
(`{contextType, contextId, related{IDs}, actors, variables, privacy}`),
`services/eventContextBuilderService.js` (builders + `sanitizeEventContext`),
`services/businessEventService.js` (chaque emitter attache `payloadSafe.context`, additif),
`services/mail/mailEventContextResolver.js` (retrouve client/commerciale/support via IDs DB — jamais
d'e-mail stocké ; pont vers M2, sans activer d'envoi). Notifications : `Notification` gagne
`eventId/eventName/contextType/contextId` (SAFE). **PII** : e-mail jamais persisté, `clientName`
toléré + flaggé, secrets/tokens interdits (sanitize + redaction EventLog). EventLog non cassé.
**Aucune UI React.** Rien ne change pour la vitrine/client. Suite : **M3C** (M2 shadow→réel).

## Sprint M3C — Activation e-mail événementiel (backend, rapports 179-180)

1er flux migré du direct vers le moteur M2 : **refund.succeeded**. Règle `mailDispatchRules`
(`directSenderExists:false, enabled:true, mode:'active'`) ; `mailEventVariableBuilder.js` reconstruit
les variables (parité via `buildCommonMailVars`, variante `refund_confirmed_service`) ;
`dispatchMailForEvent(..., {context, templateKeyOverride})` ; `mailEventSubscriber` résout
client+variables pour les règles actives ; `refundExecutionService` gate l'e-mail direct derrière
`!isMailRoleResolverEnabled()` (event toujours émis). Rollback = flag `MAIL_ROLE_RESOLVER_ENABLED=false`.
Anti-doublon via ledger `MailEventDelivery`. Autres flux restent shadow. **Aucune UI React.** Rien ne
change pour la vitrine/client. Suite : **M3D** (booking.confirmed).

## Sprint M3D — Activation booking.confirmed (backend, rapports 181-182)

2e flux migré : **booking.confirmed**. Alignement : le report de créneau
(`sessionCancellationFlowService`) émet désormais l'event (le checkout l'émettait déjà) ; l'e-mail
direct legacy y est gaté par `!isMailRoleResolverEnabled()`. Règle `mailDispatchRules` active ;
`mailEventVariableBuilder.buildBookingConfirmedVariables` complété (parité legacy). Idempotence =
`booking._id` + templateKey (report = nouveau booking = nouvelle confirmation ; replay = 1 e-mail).
Rollback = flag false. **Aucune UI React.** Rien ne change pour la vitrine/client. Suite : **M3E**.

## Sprint M3E — Supervision mail (backend + api-client, rapports 183-184)

Supervision lecture seule du moteur mail M2 : `services/mail/mailSupervisionService.js` +
`mailSupervisionMapper.js` (DTO safe), `controllers/mailSupervisionController.js`, routeurs dev
(`requireStrictDev`) et admin (roleView=admin). Endpoints `mail-deliveries` + `send-logs` (liste,
détail, stats). Privacy stricte (recipientHash, jamais d'e-mail/secret) ; cloisonnement admin (pas de
plateforme). Client React `@bs/api-client/manager/mailSupervision` (types + fonctions, **aucun écran**).
Rien ne change pour la vitrine/client ni pour les envois. Suite : **M3F**.

## Sprint M4 — Communication Center React (rapports 185-186)

App **manager** : feature `features/communication/` (Communication Center mobile-first) + api-client
`@bs/api-client/manager/communicationIdentities` et `mailSupervision` (paramètre `scope` admin/dev).
Routes admin `/communication/*` et dev `/dev/communication/*` (guards `RequireRole`). Styles via
tokens `--bs-*` (aucun hex dans les .tsx, vérifié par test). **Aucun backend modifié** (branché sur
M1 identités + M3E supervision). Privacy : recipientHash, jamais d'e-mail/secret. Rien ne change pour
la vitrine. Suite : **M5**.

## Sprint M5 — Theme Studio React (rapports 187-188)

2 thèmes : **vitrine** + **panel** (panel = Manager/Admin + Dev ; mapping UI panel ↔ backend
`manager`). Feature dev-only `apps/manager/src/features/themeStudio/` (éditeur + aperçu live local).
api-client `@bs/api-client/manager/themeStudio`. Backend `themeController` étendu (additif :
typography/radius/shadow/spacing ; `scope='manager'` conservé, `/api/vitrine/theme` intact). `@bs/ui`
`mapBackendThemeToTokens` + `PublicVitrineTheme`/`mapVitrineTheme` transmettent les nouveaux tokens.
Aucun hex dans les .tsx (tokens `--bs-*`). Suite : **M6**.

## Sprint M6 — Mail Template Studio React (rapports 189-190)

Feature dev-only `apps/manager/src/features/mailTemplates/` + api-client
`@bs/api-client/manager/mailTemplates`. Routes `/dev/email-templates[/:templateKey[/versions]]`.
Versioning via endpoints existants (`/api/gestion/mails`, dev-only) : draft/publish/archive/rollback.
Aperçu **front** (iframe sandbox, mobile/desktop, aucun envoi). Templates = **rôles** (from/to),
**aucune adresse** (identités → Communication Center M4). **Backend inchangé.** Tokens `--bs-*` (aucun
hex .tsx). Suite : **M7**.

## Sprint M10 — Planning global institut (rapports 197-198)

Décision : entité unique institut (practitionerId legacy déprécié). Backend additif : `services/calendar/`
(instituteCalendarContext, globalCalendarService, globalAvailabilityService) + `GET /api/gestion/calendar/
items` (admin/dev, monté avant les dev-only broad-mount). api-client `manager/calendar.ts`. Feature
`apps/manager/src/features/planning/` (PlanningPage jour mobile/semaine desktop + usePlanning TanStack
Query + composants cards/drawer/badges/views ; CSS `pl-`, aucun hex .tsx, zéro table, Motion Guideline).
Actions = endpoints booking existants ; report admin sans endpoint (UI désactivée). Suite : **M11**.

## Sprint M9 — Notification Center React + UX Motion (rapports 195-196)

Centre de notifications (app manager, admin + dev). Backend : unique changement = enrichissement de la
sérialisation `notificationController` (categorySnapshot/priority/persistent/action/templateKey/…, jamais
`variablesSnapshot`) ; endpoints inchangés. `@bs/ui` : MotionTokens + `prefersReducedMotion`/
`motionTransition` + tokens `--bs-motion-*` + media reduced-motion. api-client
`manager/notifications.ts` (list/stats(dérivé)/markRead/markAll/delete/resolveNotificationAction). Feature
`apps/manager/src/features/notifications/` (useNotifications TanStack Query polling 45 s ; Bell+Badge+
PulseBanner+Drawer+List+Card+DetailPanel+FilterBar+chips/badges+ActionButton+EmptyState+MotionProvider ;
CSS `nc-`, aucun hex .tsx). Bell admin dans ManagerLayout, bell dev dans DevLayout. **React UX Motion
Guideline** (dès M9) : mobile-first, animations légères, pas de table mobile, reduced-motion, ≥44px.
Suite : **M10**.

## Sprint M8 — NotificationEngine branché sur les templates (rapports 193-194)

Backend additif : `services/notificationTemplateRuntimeService.js` (render/snapshot/sanitize/buildPayload)
+ `services/notificationService.js` (template-first → fallback legacy, flag `NOTIFICATION_TEMPLATE_RUNTIME_ENABLED`,
défaut ON) + `models/Notification.js` enrichi (templateKey/categoryId/categorySnapshot/priority/persistent/
action/templateRuntimeStatus/variablesSnapshot ; l'enum legacy `category` jamais alimentée par un slug) +
subscriber (passe `templateKey`). Le moteur garde le choix de la cible (M3A). Frontend : `@bs/api-client/
manager/notifications.ts` (types-only : `RuntimeNotification` + helpers couleur/icône). Aucun écran modifié.
Suite : **M9** (refonte centre de notifications).

## Sprint M7 — Notification Studio React + Categories (rapports 191-192)

Backend additif : `models/NotificationCategory.js` + `models/NotificationTemplate.js` (versioning),
services + controllers + routers dev-only (`/api/gestion/dev/notification-categories` et
`…/notification-templates`), seed migration. Le template = contenu pur (categoryId/variables/priority/
persistent/action) **sans scope/targetRole** ; le moteur choisit le scope. Frontend : api-client
`@bs/api-client/manager/notification*` + feature dev-only `apps/manager/src/features/notificationTemplates/`
(studio + catégories, preview front toast/centre, mobile-first, tokens `--bs-*`). Notification existant
inchangé. Suite : **M8** (câblage moteur + centre).


## Sprint M11A — Checkout prod branche sur le calendrier global institut (rapports 199-200)

Fermeture de l ecart M10 : le checkout de PRODUCTION cree toute nouvelle ServiceBooking via le chemin GLOBAL institut (`createGlobalServiceBooking`). practitionerId reste legacy nullable, accepte mais IGNORE.
- Backend : `assertGlobalServiceSlotBookable` (globalAvailabilityService) ; finaliseur `processServiceCheckoutStatePurchase` -> createGlobalServiceBooking ; validations pre-paiement (stripeCheckoutService Elements/hosted + unifiedCheckoutValidationService) -> assertGlobalServiceSlotBookable ; route directe `createBooking` neutralisee ; `getAvailableSlots` ignore le practitionerId query.
- Regles paiement/remboursement/commission INCHANGEES ; aucune suppression DB.

**Front** : api-client checkout/booking annotes legacy (practitionerId ignore) ; Vanilla checkoutModule.js encore emetteur mais ignore. Tests +4 backend (tests/p1/checkoutGlobalBooking*, globalBooking*) ; React +1 (checkout.test.ts non-dependance). Prochaine : M11B.


## Sprint M11B — Finalisation calendrier global institut (rapports 201-202)

Finalisation : endpoint report admin GLOBAL + reschedule remboursement global + neutralisation runtime de practitionerId + script cleanup volontaire + index global. Aucune suppression DB ; paiement/remboursement inchanges.
- **Backend** : POST /api/gestion/bookings/:id/reschedule (rescheduleBookingByAdmin -> rescheduleGlobalServiceBooking, deplacement EN PLACE, validation+slot-lock globaux, audit booking.rescheduled + booking.confirmed). Reschedule remboursement (sessionCancellationFlowService) -> createGlobalServiceBooking. Mount-order corrige (gestionBookingRouter avant broad-mounts dev-only, M3A). scripts/cleanupPractitionerLegacy.js (dry-run/apply/force-prod, consolidation+archivage, index global opt-in). Index ServiceBooking {startAt,status}.

**Front** : api-client manager/calendar rescheduleBooking reel (POST reschedule) + RESCHEDULE_SUPPORTED=true ; feature planning RescheduleForm. Tests +5 backend / +2 front. Prochaine : migration drop legacy, drag-to-reschedule.


## Sprint M12 — Customer 360 (Client Hub) (rapports 203-204)

Fiche client agregee, point d entree du travail quotidien. Backend services/customer360/ (service+mapper+timelineBuilder) + endpoints GET /api/gestion/customers[?search=] et /:id/360 (admin/dev, monte avant broad-mounts dev-only). Front feature apps/manager/src/features/customer360/ (pages /clients + /clients/:id), api-client manager/customer360.ts. Mobile-first, cards, zero table, Motion Guideline + reduced-motion, drawer, TanStack Query. Tests +5 backend / +3 front. Limites : phone/photo absents (null), Quick Actions = liens.


## Sprint M13 — Gift Card 360 + Manual Booking + Template Studio (rapports 205-206)

Cartes cadeaux manuelles (paiement sur place, QR token opaque, debit manuel), Gift Card Template Studio (dev) + librairie admin (1 actif jamais zero), reservation manuelle prestation + verrous temporaires (TTL), notes client. Backend additif : models GiftCard enrichi / GiftCardTemplate / CustomerNote / BookingSlotLock (hold TTL) ; services/giftCard/ (qr, template, render pdfkit, mail) ; endpoints /api/gestion/gift-cards (manual, lookup, lookup-qr, manual-debit, templates) + /api/gestion/dev/gift-card-templates + /api/gestion/bookings/manual|hold. Front feature apps/manager/src/features/{customer360 drawers, giftCardTemplates, giftCardLibrary} + api-client manager/{giftCards,giftCardTemplates,giftCardLibrary,manualBooking,customerNotes}. Mobile-first, tokens --bs-*, zero hex. Tests +4 backend + front. Limites : PDF pdfkit structure (pas de rendu pixel HTML), storage non servi publiquement (PJ base64), emission manuelle sans Sale (volontaire), scan QR = payload colle.


## Sprint P1 — Product Polish & UX (rapports 207-208)

Couche transversale @bs/ui/polish (polish.css global + polish/{motion,components}). Focus visible uniforme, cibles tactiles 44px (--bs-tap-target), overflow-x:clip (préserve sticky), scrollbar fine, micro-interactions, skip-link, nav active, primitives harmonisées opt-in (Badge/Chip/IconButton/Skeleton/Spinner + classes bs-*), presets de motion (entrée/sortie/sheet/slide/dialog/accordion/pop/shake/toast). Importé dans apps/*/src/main.tsx après tokens.css. Référence officielle : docs/ProductUXGuideline.md (+ directive permanente). Tests +17 (polish.test.tsx, polishCss.test.ts) → react 237 verts, lint/typecheck/build OK. Aucun changement métier. Limites : fragmentation CSS résiduelle (11 préfixes, migration incrémentale via les primitives), FormField/Input/Checkbox partagés à venir.
