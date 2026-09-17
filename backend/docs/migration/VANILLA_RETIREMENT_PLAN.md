# Plan de retrait Vanilla (RX1 → …)

> React devient le frontend **officiel** (servi sous `/app` vitrine + `/manager` manager, bascule par le
> flag `REACT_OFFICIAL_FRONTEND`, rollback garanti). Vanilla passe en **dépréciation** :
> **compatibilité / rollback / migration** uniquement. **Aucune nouvelle fonctionnalité en Vanilla.**
>
> **Règle d'or** : **ne supprimer AUCUN code Vanilla** tant que (a) l'équivalent React est ✅ complet,
> (b) le flag est ON en prod depuis ≥ 1 cycle stable, (c) aucun rollback n'a été nécessaire. Ce document
> ne fait que **préparer** le retrait — il ne supprime rien.

## Statuts
- **Compat** : Vanilla reste servi en parallèle (React partiel ou absent) — ne pas toucher.
- **Rollback** : React ✅ mais on garde Vanilla comme filet (flag OFF = retour Vanilla).
- **Supprimable (futur)** : React ✅ + stable en prod + 0 rollback → candidat suppression (date cible).
- **Conserver** : infrastructure non-UI (webhooks, pages d'erreur, e-mails) — pas concerné par la bascule.

## Frontends — points d'entrée
| Entrée Vanilla | React officiel | Statut | Date cible |
|---|---|---|---|
| `/` → `/vitrine.html` | `/app` (flag ON) | Rollback | après flag ON stable |
| `/gestion.html` | `/manager` (flag ON) | Rollback | après flag ON stable |
| `/admin-login.html` | login manager React (à finaliser) | Compat | TBD |
| `/login.html`, `/reset-password*.html` | auth React (à finaliser) | Compat | TBD |
| `/maintenance.html` | (page d'erreur infra) | Conserver | — |

## Modules Vanilla (public/js/modules) — par domaine
| Module(s) Vanilla | Équivalent React | Statut | Note |
|---|---|---|---|
| shopModule, servicesModule, serviceDetailModule, itemDetailModule | catalog (vitrine) | Rollback | React ✅ (avis paw) ; achat formation/produit à finaliser |
| giftCardPurchaseModule | `/cartes-cadeaux` | **Compat** | achat React désactivé (« bientôt ») |
| cartModule, checkoutModule, paymentSimulationModule | cart/checkout (vitrine) | **Compat** | panier React service-only ; checkout flag-dépendant |
| myFormationsModule, myFormationDetailModule | `/mes-formations` + player | **Rollback** | React **meilleur** (player, attestation, confetti) |
| distancielModulesModule, myFormationModuleDetailModule | learning React | **Supprimable (futur)** | déjà `@deprecated C3`, 0 import |
| presentielSessionsModule | learning/présence | Rollback | React ✅ |
| myAccountModule, myFavoritesModule, my-gift-cards | (Account hub RX1 + à finaliser) | **Compat** | RX1 pose `/mon-compte` (hub + logout) ; favoris/cartes à migrer |
| myServicesModule (réservations client) | — | **Compat** | écran React absent (back existant) |
| serviceManagerModule, formationManagerModule | catalogue Studio (manager) | Rollback | React ✅ et **supérieur** (ModuleStepper) |
| planningModule | `/planning` (M10) | Rollback | React ✅ |
| clientManagerModule (+ avis) | Customer360 + `/avis` | Rollback | React ✅ |
| giftCardsModule (manager) | librairie templates | Rollback | React ✅ |
| salesModule, commissionModule, commissionPaymentModule, refund | **Finance React (à construire)** | **Compat** | écrans React = Placeholders → P0 (cf. rapport 222 §Finance) |
| contractModule | dev/contrats | **Compat** | Placeholder React |
| settings/home/legal/userManager | paramètres/admin React | **Compat** | Placeholders React |
| mailTemplateEditorModule | Mail Studio (dev) | Rollback | React ✅ |
| communication (dev) | `/dev/communication` | Rollback | React ✅ |
| modals/utilities/toast/ui | @bs/ui (React) | Compat | primitives partagées côté React |

## Endpoints / backend
- **Aucun retrait backend** : les endpoints `/api/*` et `/auth/*` servent **les deux** frontends.
- `POST /api/client/mock-pay` (dev-only) : déjà gardé `requireNonProductionMockPayment` — **Supprimable (futur)**.
- CRUD Formation legacy `businessController` (`/api/gestion/business/formations`, 0 caller) — **Supprimable (futur)**.

## Procédure de bascule (progressive, sans casse)
1. **Build** React avec base `/app/` + `/manager/` (`npm run build` dans frontend-react).
2. **Déploiement** : Express sert `frontend-react/apps/*/dist` (déjà câblé). Flag **OFF** par défaut →
   Vanilla reste maître, React accessible en opt-in (`/app`, `/manager`).
3. **Recette** par domaine ✅ (catalogue, planning, customer360, learning, studios) directement sur `/app`
   et `/manager`.
4. **Flag ON** quand **auth + espace compte client + finance** sont ✅ React (cf. rapport 222). Les entrées
   Vanilla redirigent alors vers React.
5. **Rollback** à tout moment : flag **OFF** → retour Vanilla immédiat, sans redéploiement.
6. **Retrait Vanilla** : seulement après une période stable flag ON sans rollback, module par module, en
   commençant par les `@deprecated` (distanciel) et la finance migrée.

## Hôtes (production cible)
La cible documentée (architecture cible React) est **host-based** : vitrine sur l'apex, manager/dev sur
sous-domaine. RX1 implémente le **path-based** (`/app`, `/manager`) sur une seule origine Express (simple,
rollback-friendly). En production, un reverse-proxy peut mapper les hôtes vers ces chemins (ou définir
`VITE_BASE=/` + un build par hôte). Décision d'infra → hors périmètre RX1.

## Mise à jour RX-GO (readiness de bascule)
> Cf. `docs/RX_GO_REACT_READINESS_AUDIT.md` + `RX_GO_REACT_READINESS_REPORT.md`. **Aucun fichier Vanilla
> supprimé** (rollback préservé).

**Verdict : 🟡 GO avec limitations** (bascule sûre & réversible ; gaps d'écrans à finir avant ON définitif).

| Module Vanilla | Statut | React équivalent | Dépréciable ? | Rollback ? | Blocage restant |
|---|---|---|---|---|---|
| home / shop / item-detail | ✅ migré | `/`, `/prestations`, `/formations`, `/produits`, `/cartes-cadeaux` | oui (après ON stable) | flag OFF | — |
| checkout / payment | ✅ migré | `/panier`,`/checkout`,`/paiement/*` | oui | flag OFF | Stripe returns désormais flag-aware |
| myaccount / rendez-vous / factures / documents / profil | ✅ migré | `/mon-compte/*` (RX4) | oui | flag OFF | — |
| myformations | ✅ migré | `/mes-formations` (C2) | oui | flag OFF | — |
| session-cancel-decision / refund-tracking | ✅ migré | `/decision*`, `/refund-tracking/:token` (RX4 S3) | oui | flag OFF | liens e-mail flag-aware (RX-GO) |
| signup / verify-email | 🔴 absent React | — | **non** | flag OFF | créer écrans React (RX-GO-2) |
| reset-password | 🔴 absent React | — (Vanilla `/reset-password`, non basculé) | non | flag OFF | créer écran React (RX-GO-2) |
| invoice (page par token) | 🔴 absent React | téléchargement via API | non | flag OFF | garder Vanilla ou page React |
| myfavorites | 🔴 absent React | — | non | flag OFF | hors périmètre client hub |
| gestion.html (manager) | 🟡 partiel | `/manager/*` (écrans clés) | non | flag OFF | placeholders ventes/remb./paramètres |

**Chantier RX-GO livré** : URLs générées backend (e-mails décision + suivi remboursement, retours Stripe
hébergés) rendues **flag-aware** via `services/system/frontendUrl.js` → OFF = Vanilla inchangé, ON = `/app`.
Prérequis avant retrait Vanilla d'un module : période stable flag ON + écrans 🔴 comblés.
