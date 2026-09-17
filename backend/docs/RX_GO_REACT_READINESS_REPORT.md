# RX-GO — Rapport de bascule React & Go/No-Go

> Branche `phase-0-security-baseline`. Cadrage : [`RX_GO_REACT_READINESS_AUDIT.md`](RX_GO_REACT_READINESS_AUDIT.md).
> **Aucune nouvelle feature.** Corrections petites, ciblées, réversibles (flag OFF = rollback total).

## Réponse à la question
> **Peut-on activer `REACT_OFFICIAL_FRONTEND=ON` sans casser les parcours existants ?**

**🟡 GO avec limitations** — la bascule est **techniquement sûre et réversible** (serving/redirect/shadow/
rollback OK, code React propre). RX-GO a levé le principal verrou (**URLs e-mail/Stripe désormais flag-aware**).
Restent des **gaps fonctionnels d'écrans** (signup, vérif e-mail, favoris, page facture publique, placeholders
manager) à compléter avant un **ON définitif**. En attendant, **ON reste possible en canary** car tout
parcours non migré retombe proprement (rollback flag) et aucun `/api`/`/auth`/`/uploads` n'est shadowé.

## Corrections livrées (petites & ciblées)
1. **Module central flag-aware** `services/system/frontendUrl.js` : `resolveFrontendUrl(routeKey, params)` —
   registre par route (Vanilla vs `/app` React) piloté par `isReactOfficialFrontend()`. **Flag OFF = URLs
   Vanilla identiques au legacy.**
2. **Rewire e-mails** (5 sites) vers le builder : décision post-annulation (`buildSessionCancellationActionUrl`)
   + suivi remboursement (4 sites : `mailDomainDispatchers` ×2, `mailEventVariableBuilder`, `refundExecutionService`).
3. **Stripe hosted returns** (`buildHostedReturnUrls`) : priorité **env `CHECKOUT_RETURN_BASE_URL` > flag React
   (`/app/paiement/*`) > Vanilla**. Placeholder Stripe `{CHECKOUT_SESSION_ID}` préservé (jamais encodé).
4. **Aucun** lien Vanilla à corriger côté React (audit = code déjà propre) → verrouillé par test.

## Vérification flag ON locale
`REACT_OFFICIAL_FRONTEND=true` (test supertest) : `/`→`/app/`, `/vitrine.html`→`/app/`, `/gestion.html`→
`/manager/` ; `/api` `/auth` `/uploads` **non shadowés** ; deep-links `/app/*` & `/manager/*` servis en SPA
(200 build présent / 503 sinon) ; index `no-store`. Builds présents en local → 200 observés.

## Go / No-Go par catégorie
| Catégorie | Statut | Note |
|---|---|---|
| Vitrine (catalogue/fiches/légal) | 🟢 GO | routes complètes |
| Checkout | 🟢 GO | Stripe returns flag-aware ; achat carte cadeau = RX3 en cours |
| Client Hub | 🟢 GO | RX4 S1/S2 (dashboard, RDV, cartes, factures, docs, profil, avis) |
| Parcours tokenisés | 🟢 GO | RX4 S3 + liens e-mail flag-aware |
| Manager | 🟡 GO-limité | écrans clés livrés ; placeholders ventes/remb./paramètres/dev-logs |
| Dev | 🟡 GO-limité | studios livrés ; quelques placeholders |
| Finance | 🟢 GO | RX2 complet |
| Learning | 🟢 GO | C2/C3 (player, présence, attestation) |
| Gift Cards | 🟡 GO-limité | achat carte cadeau React = RX3 S4 en cours |
| Emails | 🟢 GO | flag-aware (décision + suivi remboursement) |
| QR | 🟢 GO | tokens opaques, aucune URL Vanilla |
| Stripe returns | 🟢 GO | flag-aware (env > flag > Vanilla) |
| Auth | 🟢 GO | guards corrects, deep-link/refresh OK, redirect sûr |
| Performance | 🟡 GO-limité | pas de code-splitting (chunk > 500 KB) — non bloquant |
| SEO/SPA | 🟡 GO-limité | SPA sans SSR (fallback index) — acceptable vitrine |
| Rollback | 🟢 GO | flag OFF = Vanilla instantané, sans reboot |

### 🔴 NO-GO (à traiter avant ON DÉFINITIF)
| Point | Impact | Correction estimée | Sprint |
|---|---|---|---|
| **Signup React absent** | inscription mène au Vanilla | page `/inscription` + `POST /auth/signup` (existe) | RX-GO-2 |
| **Vérif e-mail React absente** | lien vérif → Vanilla | page `/verify-email` (endpoint existe) | RX-GO-2 |
| **Reset mot de passe React absent** | reset → Vanilla (joignable) | page `/reset-password` React | RX-GO-2 |
| **Page facture publique par token** | lien e-mail facture → Vanilla | garder Vanilla ou page React (ou API direct) | RX-GO-2 |
| **Placeholders manager** | écrans incomplets | finir ventes/remb./paramètres | RX2/M-suite |

## Recommandations — ordre avant `REACT_OFFICIAL_FRONTEND=ON` (prod)
1. **Pré-vol** : `cd frontend-react && npm run build` ; vérifier `apps/*/dist/index.html` + `dist/assets/*` ;
   suites vertes.
2. **Config domaines** (panel Dev / SystemConfiguration) : `vitrineUrl`/`panelUrl` HTTPS corrects (DomainResolver).
   Option : `CHECKOUT_RETURN_BASE_URL` si front séparé.
3. **Compléter les 🔴** (signup / vérif e-mail / reset / facture publique) — sinon ces parcours restent Vanilla
   (fonctionnels via rollback mais incohérents visuellement).
4. **Canary** : flag ON sur trafic réduit ; surveiller 503 (build manquant) + erreurs console React + retours
   Stripe. Rollback immédiat = flag OFF (aucun reboot).
5. **Emails** : les liens deviennent React **dès que flag ON** (les e-mails déjà envoyés en Vanilla pointent
   encore Vanilla — la redirection `/vitrine.html`→`/app/` perd les query params ; acceptable en transition,
   les nouveaux e-mails sont corrects).

## Limites
- Ne modifie **pas** le défaut prod (flag reste OFF).
- Ne supprime **aucun** fichier Vanilla (rollback préservé — cf. `docs/migration/VANILLA_RETIREMENT_PLAN.md`).
- Docs partagées (`architecture.md`, `VitrineArchitecture/ProjectContext`, `tests/README`) **non modifiées** ici
  car en cours d'édition par le workstream RX3 concurrent (staging sélectif) → à réconcilier côté RX3.

## Prochaine mission recommandée — RX-GO-2
Écrans auth React manquants (signup / verify-email / reset-password) + page facture publique ; finir
placeholders manager ; code-splitting (perf) ; puis activer le flag en canary.
