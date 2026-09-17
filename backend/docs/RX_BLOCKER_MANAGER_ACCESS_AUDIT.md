# RX-BLOCKER — Audit accès Manager (dev), pages « indisponible » & sidebar mobile

> Branche `phase-0-security-baseline`. Priorité absolue : un `dev` doit tout voir/gérer ; aucune page manager
> ne doit tomber en « indisponible » sans cause identifiée. Méthode : 3 agents (cause d'accès, systèmes
> invitation/reset existants, sidebar mobile) + lecture directe. **Aucun changement de règle métier.**

## 0. Cause racine (confirmée) des pages manager cassées
**Ce n'est PAS un problème de rôle** (les guards React et `requireGestionRole` autorisent bien dev+admin).
**C'est un problème de MODE de session.**

- Plusieurs sous-routeurs `/api/gestion/*` appliquent `requireMode('gestion')` : `clientManagementRouter`
  (Clients), `commissionRouter` (Commissions), `availabilityRouter`, `adminsRouter`, `financeRouter`,
  `learningManagerRouter` (Avis)…
- `middlewares/modeGuard.js` : si `user.currentMode !== 'gestion'` → **`res.redirect('/vitrine.html')` (302)**.
- `POST /auth/login` ne met **jamais** `currentMode='gestion'` ; le défaut du modèle `User` est **`'vitrine'`**.
- Le manager React ne basculait pas le mode après login. → un dev/admin connecté a `currentMode='vitrine'` →
  chaque appel `fetch('/api/gestion/…')` reçoit un **302 → HTML `/vitrine.html`** → `JSON.parse` échoue →
  la page affiche « indisponible ».

**Régression prouvée par test** (`managerModeAccess.test.js`) : en mode `gestion`, `GET /api/gestion/
availability/calendar-events` = **400** (route atteinte) ; après bascule `vitrine` = **302** (bloqué).

| Écran | URL | Endpoint | Avant | Cause | Correction |
|---|---|---|---|---|---|
| System Settings | /manager/dev/system | `/api/gestion/dev/system-configuration` | KO/erreur | mode vitrine → cascade | mode gestion |
| Clients | /manager/clients | `/api/gestion/customers` + clientManagement | 302 → KO | requireMode | mode gestion |
| Avis | /manager/avis | `/api/gestion/learning/reviews` | 302 → KO | requireMode | mode gestion |
| Finance | /manager/finance | `/api/gestion/finance/*` | 302 → KO | requireMode | mode gestion |
| Commissions | /manager/finance/commissions | `/api/gestion/commissions` | 302 → KO | requireMode + strictDev | mode gestion |

## 1. Correction — bascule idempotente en mode gestion (livrée)
- **Backend** : `POST /api/mode/enter-gestion` (idempotent, contrairement à `/toggle`). Réservé admin/dev
  (client → 403, anonyme → 401, admin suspendu → 403 + cookie clear). Ne bascule **jamais** vers vitrine.
  (`routers/modeRouter.js`).
- **Front (manager)** : `ManagerModeGate` monté **sous** `RequireRole(admin+dev)`, **au-dessus** de
  `ManagerLayout` → couvre admin **et** dev (`/dev/*` est imbriqué). Au boot (login / deep-link / refresh),
  si `currentMode !== 'gestion'` → appelle `enterGestionMode()` + `refresh()` avant de rendre. Robuste : ne
  fetch pas si déjà gestion ; attend la résolution de l'auth. `api-client manager/mode.ts`.
- **Aucun changement du login partagé** (vitrine/manager) → aucun risque de régression côté vitrine.

## 2. Règle d'accès (déjà correcte, confirmée + testée)
`dev = accès total ; admin = manager institut ; client = aucun manager.`
- **Front** : `RequireRole allow={['admin','dev']}` (manager) ; `RequireRole allow={['dev']} deniedPath="/"`
  (`/dev/*`). **Back** : `requireGestionRole()` = admin+dev ; `requireStrictDev` = dev-only ; `requireDev` =
  `['dev','admin']`. → dev passe partout, admin refusé sur dev-only, client refusé sur le manager. Régression
  couverte (`managerModeAccess.test.js` + `App.test.tsx` : dev/admin/anonyme, /dev refusé admin).

## 3. Sidebar mobile Manager (livrée)
- **Bug** (`polish.css:441-451`) : en <720px `.bs-sidebar { flex-direction:row; flex-wrap:wrap; width:100% }`
  → la sidebar devenait une **top-bar dégradée** (pas de burger/drawer).
- **Fix** : `ManagerLayout` = burger (`IconButton`, visible <720px) → **drawer slide-in gauche** (overlay +
  Escape + fermeture au clic overlay/lien + verrou de scroll), sidebar desktop conservée. Masquage **scopé**
  à `.bs-sidebar--primary` (managerLayout.css) pour NE PAS masquer la sous-nav dev (`DevLayout` partage
  `.bs-sidebar`). Zones ≥44px, `prefers-reduced-motion`. Tests `managerMobileSidebar.test.tsx` (burger/drawer/
  Escape/zéro table).

## 4. Systèmes invitation / reset / users — AUDIT (implémentation = RX-BLOCKER-2)
> **Décision de périmètre** : la priorité absolue (accès dev/manager) + la sidebar sont livrées et testées ici.
> Le manager d'utilisateurs, l'invitation tokenisée et le reset manager/client (avec routing d'expéditeur) sont
> des **fonctionnalités NEUVES sensibles (sécurité/e-mail)** : audit précis ci-dessous, implémentation cadrée
> pour RX-BLOCKER-2 (pas de code bâclé sur de l'auth). **Rien ne doit être recréé** — tout est réutilisable.

**Existant réutilisable (agent 2)** :
- **Users** : `GET/POST/PUT /api/gestion/users` (`gestionUsersRouter`, requireAuth+requireMode('gestion')+
  requireAdminOrDev). `POST` crée un compte **avec mot de passe** (pas d'invitation). Dev seul peut créer/
  promouvoir dev.
- **Reset mot de passe** : `/auth/password-reset/{request,validate,complete}` + modèle `ResetPasswordToken`
  (sha256, TTL 30 min, single-use). Expéditeur actuel = **commerciale**. Réutilisable pour client ET manager.
- **Expéditeurs** : `resolveSender('support'|'commerciale')` (M1). manager technique → **support** ; institut→
  client → **commerciale**.
- **Mail dispatch** (M2/M3) + templates : `password_reset` existe ; **`manager_invitation` manque**.

**À AJOUTER (minimal, RX-BLOCKER-2)** :
1. Modèle `ManagerInvitationToken` (miroir de `ResetPasswordToken` : sha256, TTL 7 j, single-use, jamais loggé).
2. `POST /api/gestion/users/invite` (crée user `isActive:false` + token + e-mail support) et
   `POST /auth/accept-invitation` (token+password → active). React : `/manager/users`,
   `/manager/invitation/:token`.
3. Reset manager : React `/manager/mot-de-passe-oublie` + `/manager/reinitialiser-mot-de-passe/:token`
   (réutilise `/auth/password-reset/*`) ; **routing expéditeur** support (manager) vs commerciale (client) via
   un contexte `audience` sur le reset. Templates `manager_invitation` + éventuel `manager_password_reset`.
4. Liens **DomainResolver React-aware** (registre `frontendUrl.js` RX-GO) — pas de lien Vanilla.

## 5. Limites (RX-BLOCKER, cette livraison)
- Manager users / invitation / reset manager / routing expéditeur = **non livrés** (cadrés RX-BLOCKER-2).
- `DevLayout` garde sa sous-nav horizontale (tabs) — non concernée par le bug top-bar.
- Validation visuelle finale : `npm run dev` + login dev → `/manager/*` doivent charger (mode gestion auto).
