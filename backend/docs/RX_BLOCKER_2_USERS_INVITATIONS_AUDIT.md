# RX-BLOCKER-2 — Audit : comptes manager, invitations & routage reset mot de passe

> Branche `phase-0-security-baseline`. Suite directe de l'audit §4 de `RX_BLOCKER_MANAGER_ACCESS_AUDIT.md`.
> Objet : construire un vrai système de comptes manager par **invitation tokenisée** + **reset mot de passe
> routé par rôle**, en **réutilisant les moteurs existants** (aucun second moteur d'auth/mail). Auth & mail =
> sensibles → Brevo mocké, tokens opaques hashés à usage unique, aucun mot de passe généré côté dev.

## 0. Contraintes de sécurité (invariants respectés)
- Tokens **opaques** (`crypto.randomBytes(32).hex`), stockés **hashés** (sha256), **usage unique** (flip
  atomique `used:true`), **expirables** (index TTL), **jamais loggés en clair**, **jamais renvoyés** par l'API.
- **Aucun mot de passe généré côté dev** : le dev crée l'utilisateur, l'utilisateur choisit son mot de passe
  via le lien tokenisé (invitation) ou le reset.
- **Rôles** : `dev` gère admin+dev ; `admin` ne peut **pas** créer de dev ; `client` n'accède **jamais** au
  manager. V1 : `/manager/users` = **dev-only** (évite toute escalade de privilège).
- **Routage expéditeur** (aucun sender hardcodé) : invitation & reset **manager → `support`** ; reset
  **client → `commerciale`**. Si `CommunicationIdentity` manquante → erreur contrôlée (envoi = `false`), **pas
  de fallback `MAIL_FROM`**.
- **Liens React flag-aware** via le registre `services/system/frontendUrl.js` (RX-GO). Mobile-first, zéro
  tableau, zéro hex en TSX.

## 1. Existant réutilisé (rien recréé)
| Brique | Source | Réutilisation RX-BLOCKER-2 |
|---|---|---|
| Reset token | `models/ResetPasswordToken.js` + `services/passwordResetService.js` (sha256/TTL/single-use) | `ManagerInvitationToken` **calqué** dessus ; reset manager = **mêmes** `/auth/password-reset/*` |
| Reset endpoints | `controllers/passwordResetController.js` (`request/validate/complete`) | inchangés sauf **routage expéditeur par rôle** dans `request` |
| Expéditeurs | `services/communicationRoleResolver.js` `resolveSender('support'|'commerciale')` (M1) | routage support/commerciale, **throw si non configuré** |
| Templates mail | `services/mail/mailTemplateRuntime.js` (code-defined) | +`manager_invitation`, +`manager_password_reset` |
| Gateway mail | `services/mail/mailBrevoGateway.js` `postToBrevo` | payload d'auth (best-effort, mockable) |
| Liens front | `services/system/frontendUrl.js` `resolveFrontendUrl` | +`manager-invitation`, +`manager-password-reset` |
| Hash pwd | `utils/password.js` `hashPassword` (argon2id + pepper/salt) | placeholder aléatoire à la création, vrai hash à l'acceptation |
| Mode gestion | `POST /api/mode/enter-gestion` + `requireStrictDev` (RX-BLOCKER) | garde du routeur manager-users |

## 2. Ajouts (minimal, additif)
1. **`models/ManagerInvitationToken.js`** — miroir de `ResetPasswordToken` : `tokenHash` (unique), `expiresAt`
   (TTL 7 j), `used/usedAt`, `userId`, `createdBy`. Collection dédiée.
2. **`services/managerInvitationService.js`** — `createManagerInvitationToken` (invalide les invitations
   pendantes, renvoie le token **brut une seule fois**), `loadInvitationToken`, `evaluateInvitationToken`
   (`invalid|used|expired|valid`), `markInvitationTokenUsed` (atomique).
3. **`services/authMailService.js`** — un seul point d'envoi des mails d'auth : `sendManagerInvitationEmail`
   (support), `sendManagerPasswordResetEmail` (support), `sendClientPasswordResetEmail` (commerciale). Résout
   l'expéditeur par rôle en `try/catch` → renvoie `false` si identité absente (**pas de fallback**).
4. **`models/user.js`** (additif) — `managerInviteStatus` (`invited|active|disabled`), `managerInviteSentAt`,
   `managerActivatedAt`, `disabledAt`. Aucune colonne existante modifiée.
5. **`controllers/managerUsersController.js` + `routers/managerUsersRouter.js`** — `GET/POST
   /api/gestion/manager-users`, `POST .../:id/send-invitation|disable|enable` (garde `requireAuth` +
   `requireMode('gestion')` + `requireStrictDev`) ; public `GET/POST /auth/manager-invitations/:token[/accept]`.
6. **Routage reset** — `passwordResetController.requestResetToken` choisit le sender selon le rôle de la cible
   (`admin/dev → manager (support)`, sinon `client (commerciale)`). Réponse **200 neutre** (anti-énumération).
7. **Front React** (manager) — `/users` (dev-only), `/invitation/:token`, `/mot-de-passe-oublie`,
   `/reinitialiser-mot-de-passe/:token` ; api-client `manager/managerUsers.ts` + `auth/invitations.ts`.

## 3. Surface de risque & mitigations
- **Escalade de privilège** : `/manager/users` dev-only (front `RequireRole allow={['dev']}` + back
  `requireStrictDev`) → un admin ne peut ni voir ni créer de comptes. Auto-désactivation bloquée (403).
- **Énumération de comptes** : `request` renvoie toujours 200 ; `getManagerInvitation` ne renvoie que
  `{email, firstName, role}` **après** validation du token (jamais le token, jamais le hash).
- **Rejeu de token** : invitation & reset = usage unique (flip atomique) → seconde acceptation = `400 used`.
- **Fuite de secret** : le token brut n'existe qu'en mémoire au moment de l'envoi ; la DB ne stocke que le
  sha256 ; aucun `console.log` de token. Tests le prouvent (`tokenHash !== rawToken`).
- **Mail réel en test** : impossible — `authMailService`/`postToBrevo`/`resolveSender` mockés dans chaque suite.

## 4. Tests (auth = obligatoire)
Backend : `managerUsersInvitation` (accès dev/admin/client, création sans mot de passe, token hashé, accept→
login→usage unique, mots de passe faibles/mismatch/invalides), `authMailSenderRouting` (support vs commerciale
+ liens), `managerPasswordResetRouting` (routage par rôle bout-en-bout + anti-énumération). Front :
`managerUsers` (cards/zéro table/aucun champ password), `managerAuthPages` (invitation/forgot/reset : états
valide/faible/expiré/invalide).

## 5. Limites (V1)
- `/manager/users` volontairement **dev-only** (l'admin « voit » via l'audit mais ne gère pas — durci pour V1).
- Pas de renvoi de token par l'API : un dev qui perd le lien **renvoie** l'invitation (nouveau token).
- Liens e-mail repointés React uniquement quand `REACT_OFFICIAL_FRONTEND=ON` (registre `frontendUrl.js`).
