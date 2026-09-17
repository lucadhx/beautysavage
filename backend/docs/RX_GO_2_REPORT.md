# RX-GO-2 — Rapport go-live & nouvelle matrice GO/NO-GO

> Branche `phase-0-security-baseline`. Cadrage : [`RX_GO_2_AUTH_AUDIT.md`](RX_GO_2_AUTH_AUDIT.md). Suite de
> [`RX_GO_REACT_READINESS_REPORT.md`](RX_GO_REACT_READINESS_REPORT.md). **Aucun métier nouveau ; endpoints
> réutilisés ; flag OFF = rollback total.**

## Résultat
**🟡 GO avec limitations → 🟢 GO Canary.** Les blocants d'écrans identifiés par RX-GO (signup / verify-email /
reset-password / facture publique / placeholders manager) sont **comblés**. React est désormais autonome sur
tous les parcours visibles ; les liens e-mail concernés sont flag-aware.

## Livré

### Auth React autonome (réutilise les endpoints existants)
- **api-client** `auth/`: `signup`, `verifyEmail`, `resendVerification`, `validateResetToken`,
  `completePasswordReset` (reset request réutilise l'existant).
- **Pages** (`features/auth/` + pages) : `SignupPage`, `VerifyEmailPage` (code 6 chiffres + resend 30 s),
  `ForgotPasswordPage` (succès neutre), `ResetPasswordPage` (valide token → form → succès), **`LoginPage`
  refondue** (afficher/masquer mdp, liens inscription/oubli, prise en charge 403 `EMAIL_NOT_VERIFIED`).
  Routes : `/inscription`, `/verify-email`, `/mot-de-passe-oublie`, `/reinitialiser-mot-de-passe`.
  Validation pure `8+/lettre/chiffre`, mobile-first, zéro popup, drawers/skeletons/erreurs claires.

### Facture publique React
- `InvoicePublicPage` (`/invoice/:token`, layout autonome) : polling 10 s × 5, états loading/pending/ready/
  timeout/invalide, **champs réels only** (titre/montant/date) + téléchargement/impression PDF.
- api-client `catalog/invoicePublic.ts` (`getPublicInvoice`, `publicInvoiceDownloadUrl`).

### Manager — plus aucun écran vide
- `ManagerHome` (hub, remplace le placeholder dashboard), `ManagerLoginPage` (vraie connexion), `ComingSoon`
  (message + liens). Redirections des routes subsumées (ventes→finance/timeline, remboursements→finance,
  commissions→finance/commissions, reservations→planning, dev/send-logs→dev/communication/send-logs).

### Code-splitting (perf)
- `<Suspense>` + `React.lazy` sur les page leaves des **deux apps** (layouts/accueil/login eager).
- **Bundle** : avant = manager `main` ~495 KB (alerte > 500 KB) / vitrine ~361 KB ; après = **~12 chunks
  7–50 KB** + vendor (~374 KB partagé react/query), **plus aucun chunk > 500 KB** (alerte disparue). Chargement
  à la demande par section.

### Liens e-mail flag-aware (RX-GO-2)
`frontendUrl.js` (registre RX-GO) : + `invoice` (`/app/invoice/:token`) + `password-reset`
(`/app/reinitialiser-mot-de-passe`). Rewire `buildInvoiceDownloadUrl` + `buildPasswordResetLink`. **OFF = Vanilla
inchangé.**

## Vérifications
- **Frontend** : typecheck OK · **474 tests** (120 fichiers ; +auth/invoice/manager) · lint 0 erreur (2 warnings
  pré-existants) · build OK (chunks < 500 KB).
- **Backend** : `frontendUrl` + `mailDomainDispatchers` (2 liens flag-aware) ; suite complète re-vérifiée ;
  tests `reactGoEmailLinks` étendus (invoice + reset OFF/ON) et `reactGoFrontendServing` (deep-links auth/invoice).
- **Secret scan** : aucun secret.

## Nouvelle matrice GO/NO-GO
| Catégorie | RX-GO | RX-GO-2 |
|---|---|---|
| Vitrine / Checkout / Client Hub / Tokenized | 🟢 | 🟢 |
| **Auth (signup/verify/forgot/reset/login)** | 🔴 | **🟢** |
| **Facture publique** | 🔴 | **🟢** |
| **Manager (placeholders)** | 🟡 | **🟢** (plus d'écran vide ; ComingSoon documenté) |
| Emails / QR / Stripe returns | 🟢 | 🟢 (+ invoice/reset flag-aware) |
| **Performance (bundle)** | 🟡 | **🟢** (code-splitting, chunks < 500 KB) |
| SEO/SPA | 🟡 | 🟡 (SPA sans SSR — acceptable vitrine) |
| Rollback | 🟢 | 🟢 (flag OFF instantané) |

### Reste avant un ON *définitif* (non bloquant Canary)
- Écrans dev « ComingSoon » (contrats/integrated-api/event-logs/webhook-failures) : à implémenter selon besoin.
- SSR/SEO vitrine (si SEO critique) — hors périmètre.

## Recommandations avant `REACT_OFFICIAL_FRONTEND=ON` (Canary)
1. `cd frontend-react && npm run build` (vérifier `apps/*/dist`).
2. Domaines HTTPS (SystemConfiguration : `vitrineUrl`/`panelUrl`).
3. **Canary** flag ON trafic réduit ; surveiller 503 (build), erreurs console, retours Stripe, liens e-mail.
4. Rollback = flag OFF (sans reboot).
5. Compléter les « ComingSoon » dev au fil de l'eau (n'impacte pas les parcours clients).

## Limites
- Facture publique = résumé + PDF (endpoint ne renvoie pas les lignes/TVA).
- Docs partagées (`architecture.md`, `Vitrine/ManagerArchitecture`, `tests/README`, `ProductUXGuideline`) **non
  modifiées** ici (workstream RX3 concurrent) → contenu RX-GO-2 consigné dans ce rapport + l'audit ; réconcilier
  côté RX3.

Prochaine = **RX-GO-3** (implémenter les écrans dev restants + SSR/SEO éventuel) puis activation Canary.
