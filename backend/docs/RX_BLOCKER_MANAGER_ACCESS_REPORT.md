# RX-BLOCKER — Rapport : accès Manager dev débloqué + sidebar mobile

> Cadrage : [`RX_BLOCKER_MANAGER_ACCESS_AUDIT.md`](RX_BLOCKER_MANAGER_ACCESS_AUDIT.md). Aucun changement de
> règle métier. Priorité absolue traitée : **un dev voit/gère tout le manager**.

## Ce qui rendait le manager inutilisable (résolu)
`POST /auth/login` ne mettait pas `currentMode='gestion'` (défaut `'vitrine'`). Les routes `/api/gestion/*`
gardées par `requireMode('gestion')` **redirigent (302 → /vitrine.html)** hors gestion → les `fetch` React
recevaient du HTML → « indisponible » sur Clients, Avis, Finance, Commissions, System Settings.

## Corrections livrées
1. **`POST /api/mode/enter-gestion`** (backend, `modeRouter.js`) — bascule **idempotente** en gestion.
   admin/dev → 200 ; client → 403 ; anonyme → 401 ; admin suspendu → 403. Ne repasse jamais en vitrine.
2. **`ManagerModeGate`** (manager React) — monté sous `RequireRole(admin+dev)`, au-dessus de `ManagerLayout`
   (couvre admin + `/dev/*`). Au boot (login/deep-link/refresh) : si `currentMode !== 'gestion'` → `enter-gestion`
   + `refresh()` avant rendu. Idempotent, attend l'auth. `api-client manager/mode.ts`.
3. **Règle d'accès** confirmée + testée : dev = tout ; admin = manager (dev-only refusé) ; client = aucun.
   (guards React + `requireGestionRole`/`requireStrictDev` backend — **inchangés**, déjà corrects).
4. **Sidebar mobile** (`ManagerLayout` + `managerLayout.css`) — burger → drawer slide-in gauche (overlay +
   Escape + fermeture clic/lien + verrou scroll), sidebar desktop conservée. Masquage **scopé**
   `.bs-sidebar--primary` (ne casse pas la sous-nav `DevLayout`). ≥44px, reduced-motion, zéro table.

## Tests
- **Backend** : `tests/p1/managerModeAccess.test.js` (6) — enter-gestion dev/admin 200, client 403, anonyme 401,
  idempotent, **régression d'accès** (gestion→atteint / vitrine→302).
- **Frontend** : `managerModeGate.test.tsx` (2 : vitrine→enter-gestion→rendu ; gestion→rendu sans fetch) +
  `managerMobileSidebar.test.tsx` (3 : burger, drawer open/close, Escape, zéro table). `App.test.tsx` MAJ
  (fixtures `currentMode:'gestion'`).
- Suites : front **+11** verts ; backend relancé ; typecheck/lint/build OK ; secret scan clean.

## Non livré (cadré RX-BLOCKER-2, cf. audit §4)
Manager d'utilisateurs `/manager/users`, invitation tokenisée (`ManagerInvitationToken` + `/users/invite` +
`/accept-invitation` + page accept), reset **manager** React + **routing d'expéditeur** support (manager) vs
commerciale (client), templates `manager_invitation`. Systèmes existants (users CRUD, password-reset,
CommunicationIdentity support/commerciale, mail dispatch) **réutilisables** — audit complet fourni. Reporté
volontairement (fonctionnalités d'auth/e-mail sensibles → implémentation soignée + tests, pas de code bâclé).

## Validation manuelle recommandée
`npm run dev` → login **dev** → `/manager`, `/manager/clients`, `/manager/avis`, `/manager/finance`,
`/manager/finance/commissions`, `/manager/dev/system` doivent **charger** (mode gestion posé automatiquement) ;
mobile 320/390/430 → burger + drawer, pas de top-bar, pas de scroll horizontal.

## Prochaine = RX-BLOCKER-2
Users + invitation + reset manager/client + routing expéditeur (support/commerciale) + templates, en réutilisant
l'existant (audit §4). Puis validation Canary complète.
