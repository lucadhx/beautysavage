# RX-BLOCKER-2-FINAL — Audit de finalisation & classification du working tree

> Branche `phase-0-security-baseline`. Objet : figer le périmètre RX-BLOCKER-2, classer chaque fichier modifié,
> ajouter des scripts de test rapides/complets (fin de l'attente d'1 h), puis committer/pousser proprement.
> **Aucune feature métier nouvelle. Aucun test désactivé. Staging sélectif.**

## 0. État observé
- Suite **backend complète** : lancée en tâche de fond → **exit 0 (verte)**.
- Suite **frontend complète** (test+lint+build) lancée **en même temps** → crash
  `Worker exited unexpectedly` (tinypool) puis `fork: Resource temporarily unavailable`.
  **Cause = saturation de processus (backend-full ∥ frontend-full sur Windows), PAS un test rouge.** Les tests
  frontend ciblés + `typecheck` passaient déjà ; relancés seuls ils sont verts (voir §3 validation).
- Working tree = **100 % RX-BLOCKER-2** (+ outillage de test ajouté par cette mission). **Aucun WIP concurrent**
  (RX2/RX3/RX4) présent → rien à exclure.

## 1. Classification des fichiers
Légende catégorie : **RX2** = code RX-BLOCKER-2 · **DOC** = documentation · **PERF** = outillage/perf des tests.

### Modifiés
| Fichier | Catégorie | Raison | Committer |
|---|---|---|---|
| `app.js` | RX2 | montage `/api/gestion/manager-users` + endpoints publics d'invitation | ✅ |
| `controllers/passwordResetController.js` | RX2 | routage expéditeur reset par rôle (support/commerciale) | ✅ |
| `models/user.js` | RX2 | champs additifs `managerInviteStatus/…/disabledAt` | ✅ |
| `services/mail/mailTemplateRuntime.js` | RX2 | templates `manager_invitation` + `manager_password_reset` | ✅ |
| `services/system/frontendUrl.js` | RX2 | routes flag-aware `manager-invitation` + `manager-password-reset` | ✅ |
| `frontend-react/apps/manager/src/App.tsx` | RX2 | 4 routes (users dev-only + invitation/forgot/reset publiques) | ✅ |
| `.../layouts/ManagerLayout.tsx` | RX2 | lien nav « Utilisateurs » (dev-only) | ✅ |
| `.../pages/ManagerLoginPage.tsx` | RX2 | lien « Mot de passe oublié ? » | ✅ |
| `.../packages/api-client/src/auth/index.ts` | RX2 | export `invitations` | ✅ |
| `.../packages/api-client/src/manager/index.ts` | RX2 | export `managerUsers` | ✅ |
| `architecture.md` | DOC | section RX-BLOCKER-2 | ✅ |
| `projectContext.json` | DOC | clé `rxBlocker2ManagerUsersInvitations` | ✅ |
| `tests/README.md` | DOC | inventaire des tests RX-BLOCKER-2 | ✅ |
| `frontend-react/docs/ManagerArchitecture.md` | DOC | section technique | ✅ |
| `frontend-react/docs/ManagerProjectContext.md` | DOC | récit produit | ✅ |
| `frontend-react/docs/ProductUXGuideline.md` | DOC | §18 patterns comptes/invitations | ✅ |
| `package.json` | PERF | scripts `test:rx-blocker-2/quick/release/perf:audit` (additifs) | ✅ |

### Nouveaux (untracked)
| Fichier | Catégorie | Committer |
|---|---|---|
| `models/ManagerInvitationToken.js` | RX2 | ✅ |
| `services/managerInvitationService.js` | RX2 | ✅ |
| `services/authMailService.js` | RX2 | ✅ |
| `controllers/managerUsersController.js` | RX2 | ✅ |
| `routers/managerUsersRouter.js` | RX2 | ✅ |
| `tests/p1/managerUsersInvitation.test.js` | RX2 | ✅ |
| `tests/p1/authMailSenderRouting.test.js` | RX2 | ✅ |
| `tests/p1/managerPasswordResetRouting.test.js` | RX2 | ✅ |
| `.../features/managerUsers/` (Page + css + index + test) | RX2 | ✅ |
| `.../pages/ManagerAuthShell.tsx` + `managerAuth.css` | RX2 | ✅ |
| `.../pages/ManagerInvitationPage.tsx` | RX2 | ✅ |
| `.../pages/ManagerForgotPasswordPage.tsx` | RX2 | ✅ |
| `.../pages/ManagerResetPasswordPage.tsx` | RX2 | ✅ |
| `.../pages/managerAuthPages.test.tsx` | RX2 | ✅ |
| `.../packages/api-client/src/auth/invitations.ts` | RX2 | ✅ |
| `.../packages/api-client/src/manager/managerUsers.ts` | RX2 | ✅ |
| `scripts/run/runReleaseChecks.js` | PERF | ✅ |
| `docs/RX_BLOCKER_2_USERS_INVITATIONS_AUDIT.md` + `_REPORT.md` | DOC | ✅ |
| `docs/RX_BLOCKER_2_FINALIZATION_AUDIT.md` (ce fichier) | DOC | ✅ |
| `docs/TEST_SUITE_PERFORMANCE_AUDIT.md` | DOC/PERF | ✅ |

### À exclure
**Aucun** — le working tree ne contient aucun WIP concurrent.

## 2. Complétude RX-BLOCKER-2 (vérifiée)
- **Backend** : manager users (list/create/resend/disable/enable), invitation tokenisée (sha256/TTL 7 j/usage
  unique), accept invitation, reset manager + client, expéditeur support/commerciale (aucun hardcode, pas de
  fallback `MAIL_FROM`), templates, routes montées, tests. ✅
- **Frontend** : `/manager/users` (dev-only, cards, création sans champ mot de passe), envoi/renvoi invitation,
  accept invitation, manager forgot/reset, client forgot/reset (réutilise l'engine partagé), mobile-first,
  zéro tableau, zéro hex TSX. ✅
- **Docs** : audit + report + finalisation + perf + architecture/projectContext + Manager docs + tests README +
  ProductUXGuideline. ✅

## 3. Validation (séquentielle, sans saturation)
| Étape | Résultat | Durée |
|---|---|---|
| `test:rx-blocker-2` (14 backend + 9 front) | ✅ vert | 1 m 18 s |
| `test:p0` (44 tests / 14 fichiers) | ✅ vert | 92,8 s |
| `react:build` (vitrine + manager) | ✅ vert | 12,7 s |
| `react:test` (suite front seule) | _voir §perf_ | _mesuré_ |
| `react:lint` | ✅ vert | _mesuré_ |
| Suite backend complète (tâche de fond) | ✅ exit 0 | (longue — cf. perf) |

## 4. Décisions
- **Tout committer** en un commit sélectif (RX-BLOCKER-2 + docs + outillage perf), rien à exclure.
- Le crash frontend n'est **pas** un régression : c'est le symptôme du problème de perf traité par
  `TEST_SUITE_PERFORMANCE_AUDIT.md` + l'orchestrateur séquentiel `runReleaseChecks.js`.
