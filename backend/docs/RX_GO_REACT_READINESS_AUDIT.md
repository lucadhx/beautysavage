# RX-GO — Audit de bascule React (matrice Vanilla ↔ React)

> **PARTIE 1** de la mission RX-GO (« Peut-on activer `REACT_OFFICIAL_FRONTEND=ON` sans casser les parcours
> existants ? »). Branche `phase-0-security-baseline`, travail parallèle, staging sélectif. **Pas de nouvelle
> feature ; corrections petites & ciblées uniquement.** Méthode : 3 agents (serving + routes Vanilla, routes
> React + scan liens Vanilla, builders d'URL e-mail/QR/Stripe).

Légende : ✅ React prêt · 🟡 React partiel · 🔴 React absent · ⚠️ React prêt mais **lien encore Vanilla**.

## 0. Synthèse
- **Serving/redirect** (`services/system/reactFrontend.js`, `app.js`) : **production-ready**. Flag lu
  dynamiquement (défaut OFF=rollback), `/`→`/app/` ou `/vitrine.html`, `/vitrine.html`→`/app/`,
  `/gestion.html`→`/manager/` (ON) ; `/api` `/auth` `/uploads` **jamais shadowés** (montés avant) ; 503 si
  build absent (jamais 404/500) ; basename = `import.meta.env.BASE_URL` (Vite base `/app/` `/manager/`).
- **Code React** : **propre** — scan agent = **aucun** lien `vitrine.html`/`gestion.html`/`admin.html`, aucun
  préfixe `/app`//`/manager` en dur, navigation sûre (`window.location.assign` = **uniquement** Stripe externe ;
  `tel:` ; `<a>` externes PDF avec `rel=noopener`). Guards `RequireRole` corrects, deep-link/refresh OK.
- **Vrai verrou de bascule** = **URLs générées côté backend** (e-mails / retours Stripe) encore **Vanilla-only**.
  → C'est le seul chantier correctif de RX-GO (helper flag-aware + rewire, cf. §5).
- **Gaps fonctionnels** : quelques écrans Vanilla sans équivalent React (inscription, vérif e-mail,
  facture-par-token, achat carte cadeau [RX3 en cours]) → 🟡/🔴 documentés, non bloquants si Vanilla reste
  joignable (login/reset/signup ne sont pas basculés par le flag).

## 1. Vitrine publique
| Fonction | Route Vanilla | Route React | Statut | Action |
|---|---|---|---|---|
| Accueil | `?page=accueil` / `/vitrine.html` | `/` | ✅ | — |
| Catalogue prestations | `?page=shop` | `/prestations` | ✅ | — |
| Fiche prestation | `?page=item-detail` | `/prestations/:slug` | ✅ | — |
| Catalogue formations | `?page=shop` | `/formations` | ✅ | — |
| Fiche formation | `?page=item-detail` | `/formations/:id` | ✅ | — |
| Produits | `?page=shop` | `/produits`, `/produits/:id` | ✅ | — |
| Cartes cadeaux (catalogue) | `?page=shop` | `/cartes-cadeaux` | ✅ | — |
| Avis (lecture) | intégré fiches | `TrainingReviews` (fiches) | ✅ | — |
| Pages légales | `?page=mentions-legales/cgv/politique-confidentialite` | `/mentions-legales`,`/cgv`,`/confidentialite` | ✅ | — |
| 404 | fallback | `*` Placeholder | ✅ | — |

## 2. Checkout
| Fonction | Route Vanilla | Route React | Statut | Action |
|---|---|---|---|---|
| Panier | `?page=checkout`/`panier` | `/panier` | ✅ | — |
| Checkout | `?page=checkout` | `/checkout` | ✅ | — |
| Paiement succès | `?slug=payment` | `/paiement/succes` | ⚠️ | **Stripe success_url Vanilla** → flag-aware (§5) |
| Paiement annulé | `?slug=checkout` | `/paiement/annule` | ⚠️ | **Stripe cancel_url Vanilla** → flag-aware (§5) |
| Achat formation | `?page=item-detail` | fiche formation (RX3) | ✅ | — |
| Achat carte cadeau | `?page=gift-card` | `/cartes-cadeaux` (RX3 S4 en cours) | 🟡 | suivre RX3 |
| Application carte cadeau | checkout | checkout (RX3) | ✅ | — |
| Paiement 0 € (finalize-free) | API | API (`/api/client/checkout/finalize-free`) | ✅ | — |
| Redirection Stripe hosted | success/cancel Vanilla ou env | env (R2C) OU flag React (§5) | ⚠️ | flag-aware (§5) |

## 3. Espace client
| Fonction | Route Vanilla | Route React | Statut | Action |
|---|---|---|---|---|
| Connexion | `/login`, `?page=…` | `/connexion` | ✅ | login Vanilla non basculé (OK) |
| Inscription | `?page=signup` | — | 🔴 | pas d'écran React signup → gap documenté |
| Mot de passe oublié | `/reset-password` | — | 🔴 | reset Vanilla non basculé (OK, joignable) |
| Mon compte (dashboard) | `?page=myaccount` | `/mon-compte` | ✅ | RX4 S1 |
| Rendez-vous | `?page=…` | `/mon-compte/rendez-vous` | ✅ | RX4 S1/S2 |
| Formations | `?page=myformations` | `/mes-formations` | ✅ | C2 |
| Cartes cadeaux | `?page=my-gift-cards` | `/mon-compte/cartes-cadeaux` | ✅ | RX4 S1 |
| Factures | `?page=invoice` | `/mon-compte/factures` | ✅ | RX4 S1 |
| Documents | dispersé | `/mon-compte/documents` | ✅ | RX4 S1 |
| Profil | `?page=myaccount` | `/mon-compte/profil` | ✅ | RX4 S2 (GET profil) |
| Avis (soumission) | fiche formation | `ReviewDrawer` (formations terminées) | ✅ | RX4 S2 |
| Logout | header | `signOut()` | ✅ | — |
| Favoris | `?page=myfavorites` | — | 🔴 | hors périmètre RX4 (storefront) |

## 4. Parcours tokenisés (lien e-mail, sans compte)
| Fonction | Route Vanilla | Route React | Statut | Action |
|---|---|---|---|---|
| Décision post-annulation | `?page=session-cancel-decision&flowId=&token=` | `/decision?flowId=&token=` | ⚠️ | **lien e-mail Vanilla** → flag-aware (§5) |
| Report par lien | idem (sous-flux) | `/decision/report` | ✅ | RX4 S3 |
| Suivi remboursement | `?page=refund-tracking&token=` | `/refund-tracking/:token` | ⚠️ | **lien e-mail Vanilla** (4 sites) → flag-aware (§5) |
| Carte cadeau / avoir (recredit) | flux décision | option `canGiftCard` + suivi split | ✅ | RX4 S3 |

## 5. VERROU — URLs générées backend (le seul chantier correctif)
Inventaire (agent 3) des liens **non flag-aware** ayant un équivalent React :
| Site | Fichier | Cible actuelle | Correction |
|---|---|---|---|
| Décision | `sessionCancellationFlowService.buildSessionCancellationActionUrl` | `vitrine.html?page=session-cancel-decision&…` | `resolveFrontendUrl('session-cancel-decision', …)` |
| Suivi remb. (client) | `mailDomainDispatchers.js:1607` | `vitrine.html?page=refund-tracking&token=` | `resolveFrontendUrl('refund-tracking', {token})` |
| Suivi remb. (admin notif) | `mailDomainDispatchers.js:1799` | idem | idem |
| Suivi remb. (event) | `mailEventVariableBuilder.js` | idem | idem |
| Suivi remb. (exécution) | `refundExecutionService.js` | idem | idem |
| Stripe success/cancel | `stripeCheckoutService.buildHostedReturnUrls` | `vitrine.html?slug=payment/checkout` | branche flag → `/app/paiement/…` |

**Solution** : nouveau module central `services/system/frontendUrl.js` → `resolveFrontendUrl(routeKey, params)`
(registre par route : builder Vanilla vs React selon `isReactOfficialFrontend()`). **Flag OFF = URLs Vanilla
IDENTIQUES au legacy** (zéro régression prod). Stripe traité en place (préserve le placeholder Stripe
`{CHECKOUT_SESSION_ID}`, priorité env `CHECKOUT_RETURN_BASE_URL` conservée).

**Laissés Vanilla (aucun équivalent React → ne pas inventer)** : `reset-password?token=`, `vitrine.html?slug=invoice&token=`
(page facture Vanilla ; le téléchargement réel passe par l'API), retour Stripe Elements (`?slug=payment`, mode
gated `CHECKOUT_HOSTED`), Stripe **Dev** → `/gestion.html` (plateforme = manager Vanilla).

## 6. QR codes — SAINS (aucune action)
`giftCardQrService` : QR encode un **token opaque** (`BSGC.v1.<token>`, hash persisté), **jamais** d'URL/secret.
Présence formation : token opaque scanné. Attestation : PDF streamé, pas d'URL en QR. → **Rien à corriger**.

## 7. Manager
Routes React complètes (agent 2) : `/` dashboard, `/planning`, `/clients` + `/clients/:id` (Customer360),
`/catalogue/*` (prestations/formations/sessions présence/cartes/produits), `/cartes-cadeaux/templates`,
`/avis`, `/finance/*` (timeline/commissions/cartes), `/communication/*`, `/dev/*` (system, email/notif/gift-card
templates, theme studio, communication dev…). Guards `RequireRole` (admin+dev ; dev-only `deniedPath="/"`).
Statut : ✅ pour les écrans livrés ; quelques `Placeholder` (ventes/remboursements/paramètres/dev logs) = 🟡
(n'empêchent pas la bascule ; Vanilla reste rollback). Login manager = placeholder `/login` 🟡.

## 8. Assets & build (Partie 9)
Vite base `/app/` (vitrine) & `/manager/` (manager) ; sorties `frontend-react/apps/*/dist` ; assets
`/app/assets/*` `/manager/assets/*` (static, cache long) ; index `no-store`. Build vitrine ~505 KB / manager
~375 KB (gzip ~110/~134 KB) — **quick win connu (non bloquant)** : pas de code-splitting (RC1) → chunk > 500 KB
warning. Différé (perf, pas un blocage de bascule).

## 9. Tests de bascule (ajoutés)
Backend : `reactGoFrontendServing` (/auth,/uploads non shadowés, deep-links /app+/manager SPA, no-store),
`reactGoEmailLinks` (flag OFF=Vanilla / ON=React), `reactGoStripeReturns` (env>flag>Vanilla, placeholder
préservé). Front : `reactGoNoVanillaLinks` (scan src → zéro lien Vanilla, zéro basename en dur). Existant
réutilisé : `rx1ReactFrontend` (redirects flag, /api non shadowé, SPA 200/503).

## 10. Limites
- Repointage e-mail vers React = **actif seulement flag ON** (OFF = Vanilla, aucun risque prod).
- Écrans React absents : signup, vérif e-mail, favoris, page facture-par-token publique → **compléter avant ON
  définitif** (sinon des liens/parcours mèneraient à du Vanilla, ce qui reste fonctionnel via rollback).
- Manager : placeholders résiduels → finir avant ON manager.
- Perf : code-splitting différé.
Voir Go/No-Go et recommandations dans `RX_GO_REACT_READINESS_REPORT.md`.
