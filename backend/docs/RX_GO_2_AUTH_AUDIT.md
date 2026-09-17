# RX-GO-2 — Audit go-live (auth React, facture publique, placeholders, perf)

> **PARTIE 1** de RX-GO-2 (« GO avec limitations → GO Canary », sans nouveau métier). Branche
> `phase-0-security-baseline`, travail parallèle, staging sélectif. Méthode : 3 agents (contrats auth,
> facture publique, placeholders + code-splitting). Le backend reste l'autorité ; on réutilise les endpoints.

## 0. Synthèse — les 🔴 de RX-GO à combler
RX-GO avait listé comme blocants d'un ON *définitif* : écrans React **signup / verify-email / reset-password**,
**page facture publique par token**, et **placeholders manager**. RX-GO-2 les adresse **front-only + réutilisation
d'endpoints** (+ 2 liens e-mail rendus flag-aware, aucun nouveau backend).

## 1. Auth — endpoints existants (réutilisés, aucun métier nouveau)
| Endpoint | Body | Réponse clé | Notes |
|---|---|---|---|
| `POST /auth/signup` | `{email,password,passwordConfirm}` | `{ok,email,expiresAt,resendAfterSeconds}` | pol. mdp 8+/lettre/chiffre ; 409 `EMAIL_NOT_VERIFIED_PENDING` ; envoie code |
| `POST /auth/verify-email` | `{email,code}` (6 chiffres) | `{ok,role,currentMode}` + **cookie** | code TTL 10 min, max 5 essais |
| `POST /auth/resend-verification` | `{email}` | `{ok,resendAfterSeconds}` | cooldown 30 s ; 429 `retryAfterSeconds` |
| `POST /auth/login` | `{email,password}` | cookie ; 403 `EMAIL_NOT_VERIFIED` | e-mail non vérifié bloqué |
| `POST /auth/password-reset/request` | `{email}` | `{ok,message}` (toujours succès) | anti-énumération |
| `POST /auth/password-reset/validate` | `{token}` | `{ok,expiresAt}` / 400 invalid/used/expired | TTL 30 min |
| `POST /auth/password-reset/complete` | `{token,password}` | `{ok}` | min 8 ; invalide les sessions |

**React avant RX-GO-2** : seulement `LoginPage` (basique). **Manquait** : api-client (signup/verify/resend/
validate/complete) + 4 pages. **Livré** : cf. rapport.

## 2. Facture publique — endpoint existant `GET /api/invoice/:token`
Réponse **résumé uniquement** : `{ ready, invoiceUrl, formationTitle, amount, date }` — **PAS** de lignes/TVA/
institut/client (le détail est dans le PDF). Token opaque 48-hex, **sans TTL**, public (URL-secret). Polling
Vanilla : 10 s × 5. → La page React n'affiche **que ces champs réels** + téléchargement (aucune invention).
Lien e-mail Vanilla `vitrine.html?slug=invoice&token=` → **rendu flag-aware** (React `/app/invoice/:token`).

## 3. Placeholders manager (13 recensés) — décision
| Route | Décision RX-GO-2 |
|---|---|
| `/` (dashboard) | **Hub réel** `ManagerHome` (cards vers sections) — titre « Tableau de bord » conservé |
| `/login` | **Vraie page** `ManagerLoginPage` (login réel, refuse rôle client) |
| `/reservations` | **Redirect** → `/planning` |
| `/ventes` | **Redirect** → `/finance/timeline` |
| `/remboursements` | **Redirect** → `/finance` |
| `/commissions` | **Redirect** → `/finance/commissions` |
| `/parametres` | **ComingSoon** + lien `/dev/system` |
| `/onboarding/contrat` | **ComingSoon** + lien finance |
| `/dev` (index) | **ComingSoon** hub (liens system/theme/mail/communication) |
| `/dev/contrats`,`/dev/commissions`,`/dev/integrated-api` | **ComingSoon** + liens utiles |
| `/dev/send-logs` | **Redirect** → `/dev/communication/send-logs` (implémentée) |
| `/dev/event-logs`,`/dev/webhook-failures` | **ComingSoon** + liens |
| `*` (404) | conservé |
Objectif atteint : **aucun écran vide** (redirect ou message utile partout).

## 4. Code-splitting — état & cible
**Avant** : aucun `React.lazy`, aucun `<Suspense>`. Manager `main` ~**495 KB** (> seuil 500 KB alerte), vitrine
~361 KB. **Après** : `<Suspense fallback={<LoadingState/>}>` autour des `Routes` (2 apps) ; **page leaves lazy**
(layouts/shell/accueil/login restent eager). Résultat build : **~12 chunks** (7–50 KB) + vendor ; **plus aucun
chunk > 500 KB** (alerte disparue). Fallback = `LoadingState` (@bs/ui).

## 5. Liens e-mail rendus flag-aware (RX-GO-2)
Réutilise le registre `services/system/frontendUrl.js` (RX-GO) : ajout `invoice` (`/app/invoice/:token`) et
`password-reset` (`/app/reinitialiser-mot-de-passe`). Rewire `buildInvoiceDownloadUrl` + `buildPasswordResetLink`.
**Flag OFF = URLs Vanilla inchangées** (zéro régression). Le code de vérification signup n'a pas de lien (code
6 chiffres) → rien à aligner.

## 6. Limites (documentées, cf. rapport)
- Facture publique = résumé + PDF (pas de lignes/TVA en HTML : indisponibles côté endpoint).
- Reset : politique complexité appliquée côté client (backend reset = min 8) ; le serveur reste l'autorité.
- Placeholders « ComingSoon » = écrans non encore implémentés (dev/contrats, integrated-api, event-logs,
  webhook-failures) → hors périmètre go-live, mais **plus jamais vides**.
- Repointage e-mail React = actif **seulement flag ON** (OFF = Vanilla).
