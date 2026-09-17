# RX-BLOCKER-2 — Rapport : comptes manager, invitations & routage reset mot de passe

> Branche `phase-0-security-baseline`. Livré : gestion des comptes manager par **invitation tokenisée**, page
> `/manager/users` (dev-only), acceptation d'invitation, reset mot de passe **manager** et **client** avec
> **routage d'expéditeur par rôle** (support / commerciale). Réutilise intégralement les moteurs existants
> (aucun second moteur d'auth/mail). Voir `RX_BLOCKER_2_USERS_INVITATIONS_AUDIT.md` pour le cadrage.

## 1. Backend livré
- **Modèle** `models/ManagerInvitationToken.js` — sha256, TTL 7 j (index), usage unique, `createdBy`.
- **Service** `services/managerInvitationService.js` — création (invalide les invitations pendantes de
  l'utilisateur), chargement, évaluation (`invalid|used|expired|valid`), consommation atomique.
- **Service mail d'auth** `services/authMailService.js` — point unique d'envoi : invitation manager →
  **support**, reset manager → **support**, reset client → **commerciale**. Expéditeur résolu par rôle ;
  **aucun fallback `MAIL_FROM`** (identité absente → envoi `false`, jamais de mail dégradé).
- **Templates** `services/mail/mailTemplateRuntime.js` — `manager_invitation`, `manager_password_reset`
  (code-defined, variables `{{firstName}}`/`{{link}}`/`{{roleLabel}}`).
- **User** (additif) — `managerInviteStatus` / `managerInviteSentAt` / `managerActivatedAt` / `disabledAt`.
- **Controller/Router** `controllers/managerUsersController.js` + `routers/managerUsersRouter.js` —
  `GET/POST /api/gestion/manager-users`, `POST .../:id/send-invitation|disable|enable`
  (`requireAuth`+`requireMode('gestion')`+`requireStrictDev`). Public :
  `GET /auth/manager-invitations/:token` (infos sûres) + `POST .../accept` (choix du mot de passe → activation).
- **Routage reset** — `passwordResetController.requestResetToken` : `admin/dev → sendManagerPasswordResetEmail`
  (support), sinon `sendClientPasswordResetEmail` (commerciale). Réponse **200 neutre** (anti-énumération).
- **Liens flag-aware** — `services/system/frontendUrl.js` : routes `manager-invitation` + `manager-password-reset`.
- **`app.js`** — montage `manager-users` (après les routeurs dev) + endpoints publics d'invitation.

## 2. Front React livré (manager, mobile-first, zéro table, zéro hex TSX)
- **api-client** — `packages/api-client/src/manager/managerUsers.ts` (list/create/resend/disable/enable),
  `packages/api-client/src/auth/invitations.ts` (get/accept). Exports ajoutés aux barrels.
- **`/manager/users`** (dev-only, lazy) — `features/managerUsers/ManagerUsersPage.tsx` : liste en **cards** +
  badges de statut, drawer de création (prénom/nom/e-mail/rôle) **sans champ mot de passe** (« l'utilisateur
  recevra un e-mail pour définir son mot de passe »), actions renvoyer l'invitation / activer / désactiver.
- **`/manager/invitation/:token`** (public) — `pages/ManagerInvitationPage.tsx` : états invalide/expiré/utilisé,
  affiche e-mail + rôle, choix du mot de passe (politique ≥8 + lettre + chiffre), active → lien connexion.
- **`/manager/mot-de-passe-oublie`** + **`/manager/reinitialiser-mot-de-passe/:token`** (public) —
  `ManagerForgotPasswordPage.tsx` (message neutre) + `ManagerResetPasswordPage.tsx` (validate → complete),
  coquille commune `ManagerAuthShell` (colonne centrée, tokens `--bs-*`).
- **Câblage** — 4 routes dans `App.tsx` (public hors `RequireRole` ; `/users` sous `RequireRole allow={['dev']}`),
  lien nav **« Utilisateurs »** (dev-only) dans `ManagerLayout`, lien **« Mot de passe oublié ? »** sur
  `ManagerLoginPage`.

## 3. Sécurité (invariants vérifiés)
| Invariant | Preuve |
|---|---|
| Tokens opaques, hashés, jamais renvoyés | `tokenHash !== rawToken` en DB (`managerUsersInvitation`) ; API ne renvoie que `{email,firstName,role}` |
| Usage unique | 2ᵉ accept = `400 used` ; 2ᵉ complete = `400` (tests) |
| Aucun mot de passe généré côté dev | création → hash **placeholder aléatoire** + `isActive:false` ; vrai hash à l'acceptation |
| dev gère admin+dev, admin ne crée pas de dev, client exclu | `requireStrictDev` + front dev-only ; tests dev 200 / admin 403 / client 403 |
| Routage expéditeur, aucun hardcode | `authMailSenderRouting` (support/commerciale) + `managerPasswordResetRouting` (bout-en-bout) |
| Aucun mail réel en test | Brevo/`resolveSender`/`authMailService` mockés partout |
| Liens React flag-aware | `frontendUrl.js` (registre RX-GO) |

## 4. Tests
- **Backend** (`tests/p1/`) : `managerUsersInvitation` (5), `authMailSenderRouting` (4),
  `managerPasswordResetRouting` (5) — accès, création sans mot de passe, token hashé/usage unique,
  accept→login, routage expéditeur par rôle, anti-énumération, reset manager bout-en-bout.
- **Frontend** : `features/managerUsers/managerUsers.test.tsx` (3 : cards/zéro table, création sans champ
  password, renvoi invitation), `pages/managerAuthPages.test.tsx` (6 : invitation valide/faible/expiré, forgot
  neutre + endpoint partagé, reset valide/invalide).
- **Suites complètes** : backend `<N>` verts ; frontend `<N>` verts + lint + build OK ; typecheck OK. _(chiffres
  renseignés à la clôture)_

## 5. Limites / suites
- `/manager/users` **dev-only** en V1 (pas de vue admin en lecture seule — durcissement volontaire).
- Renvoi d'invitation = nouveau token (aucune ré-exposition du token précédent).
- Repointage des liens e-mail vers React uniquement sous `REACT_OFFICIAL_FRONTEND=ON`.
