# RX4 — Rapport parcours tokenisés (Session 3)

> Branche `phase-0-security-baseline`. Travail parallèle, **staging sélectif**. Cadrage :
> [`RX4_TOKENIZED_DECISION_AUDIT.md`](RX4_TOKENIZED_DECISION_AUDIT.md). Suite de S1 (dashboard) & S2 (écriture
> connectée). **Front-only : aucun fichier backend modifié.**

## Objectif
Rendre accessibles **sans compte connecté**, depuis un lien e-mail sécurisé, les parcours post-annulation :
comprendre sa situation → choisir (reporter / rembourser / carte cadeau / confirmer) → terminer en quelques
secondes ; et **suivre son remboursement**. UX premium, mobile-first, colonne unique, cards, timeline, aucun
tableau, aucun jargon, aucun bouton fantôme.

## Décision d'architecture : ZÉRO backend
L'audit confirme que **tout existe déjà** : `GET /api/client/session-cancel-flows/:flowId?token=` +
`POST …/{confirm,refund,gift-card,reschedule,service-reschedule}`, et `GET /api/refund-tracking/:token`
(tous sans auth, token opaque). Les endpoints suggérés par le brief (`/api/client/decision-flows/*`,
`/api/client/refunds/:token/tracking`) **dupliqueraient** ces moteurs → **non créés** (règles « réutiliser »,
« pas de second moteur »). **Aucune route/handler/mail backend ajouté ni modifié.**

## Livré (front-only)

### api-client `client/tokenizedFlows.ts`
`getDecisionFlow(flowId, token)` (normalise + détecte `kind: formation|service`), `confirmDecision`,
`requestDecisionRefund` (mot-clé `annulation`), `requestDecisionGiftCard`, `rescheduleFormationDecision`,
`rescheduleServiceDecision`, `getRefundTracking(token)`. Types : `DecisionFlow/DecisionOptions/
DecisionFormationSession`, `RefundTracking/RefundStatus/RefundSplitStatus/RefundSplitPart`.

### `features/tokenizedFlows/`
`TokenFlowLayout` (layout autonome, hors storefront), `DecisionSecurityNote`, `TokenErrorState`
(invalide/expiré/erreur — rassurant), `DecisionHeroCard`, hooks TanStack, `format.ts` (mapping statuts,
options réelles, `pickRenunciationText`), `tokenizedFlows.css`.

### Pages & routes
| Route | Page | Rôle |
|---|---|---|
| `/decision?flowId=&token=` | `DecisionFlowPage` | Situation + options RÉELLES (`flow.options`) ; refund/gift-card/confirm en confirmation→succès ; reporter → report |
| `/decision/report?flowId=&token=` | `DecisionReportPage` | **Prestation** : réutilise `AvailabilityCalendar`/`SlotPicker`/`SelectedSlotSummary` ; **Formation** : sessions embarquées + consentement |
| `/refund-tracking/:token` | `RefundTrackingPage` | Montant, statut réel, **split Stripe/carte cadeau**, timeline, carte cadeau (code/solde) |

Routes déclarées **hors `PublicLayout`** (layout autonome email-landing).

## Split refund
Répartition affichée telle que le backend la calcule : `stripeRefundAmount/Status` +
`giftCardRefundAmount/Status` (+ `giftCard{code,balance}` si recredit réussi). Ex. « 60 € · 40 € carte cadeau
· 20 € Stripe ». **Statuts réels uniquement** : refund `requested|pending|succeeded|failed|canceled` ; split
`not_applicable|pending|succeeded|failed|rollback_needed`. **Aucun statut inventé** (les
`approved/refused/processing/recovered` du brief n'existent pas → non mappés).

## Carte cadeau / avoir
Option `Recevoir une carte cadeau` affichée **uniquement** si `flow.options.canGiftCard`
(`flowType=formation_deleted`). Le recredit carte cadeau d'un split remboursement est surfacé dans le suivi.
Pas de système d'« avoir » distinct créé (non requis).

## Sécurité token (vérifié à l'audit, inchangé)
- Décision : `tokenHash` **SHA-256** en DB (jamais en clair), TTL **7 j**, **usage unique**, jamais loggé,
  résolu par **flowId + token**. Suivi remboursement : token 32 octets opaque, TTL **30 j**, jamais loggé
  (test P0 `security.logging.test.js`). PII minimale (jamais e-mail/adresse ; mot de passe carte JAMAIS
  exposé — seul le code recrédité). **Routes sans auth** (accès par token, conforme au design).
- Front : token transmis en query (décision) / path (suivi) ; jamais journalisé côté client.

## Liens e-mail (Partie 9) — documenté, non modifié
Les mails pointent vers les pages **Vanilla** servies (`?page=session-cancel-decision&flowId=&token=` /
`?page=refund-tracking&token=`). `REACT_OFFICIAL_FRONTEND` étant **OFF** (Vanilla par défaut), **repointer les
templates vers les routes React 404erait** → **non modifié en S3** (n'empiète pas, ne casse pas le live). Les
routes React acceptent **les mêmes paramètres** → alignement trivial (une ligne dans
`buildSessionCancellationActionUrl` / URL suivi) quand React sera servi (base URL déjà administrable via
`DomainResolver`/`SystemConfiguration`). **Aucun mail direct hors moteur.**

## Vérifications
- **Frontend** : typecheck OK · **443 tests** (110 fichiers ; +16 S3 : `tokenizedFlowsApi` 7,
  `decisionFlowPage` 4, `decisionReportPage` 2, `refundTrackingPage` 3) · lint 0 erreur · build OK.
- **Backend** : **non modifié** → aucun test backend requis (Partie 11).
- **Secret scan** (Partie 14) : aucun secret (`sk_live_/sk_test_/xkeysib-/whsec_/mongodb+srv://…`).

## Limites & risques
- **Report formation** : `renunciationText` matché **exactement** côté backend ; le front envoie le texte
  `flow.legal` applicable (heuristique proximité/`refundDays`) et affiche proprement un 400 en cas de
  mismatch (backend autoritaire — logique non dupliquée).
- **Liens e-mail** : repointage React différé au passage du flag (documenté).
- **Décision `/decision`** : token+flowId en **query** (le backend exige flowId) — déviation assumée vs
  `/decision/:token`. Suivi remboursement respecte `/:token`.

## Prochaine mission recommandée — RX4 S4
1. **Aligner les liens e-mail** vers les routes React (au passage `REACT_OFFICIAL_FRONTEND` ON) :
   `buildSessionCancellationActionUrl` → `/decision?flowId=&token=`, URL suivi → `/refund-tracking/:token`
   (+ tests backend de format d'URL).
2. **Notifications client** (chantier backend M8 : émettre en audience client) → centre notifs React.
3. **Profil enrichi** (téléphone/adresse/consentements → extension `User` + `PUT`).
