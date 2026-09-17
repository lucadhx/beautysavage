# Rapport — Livraison PDF carte cadeau depuis le template actif (GC-TPL-AUDIT)

Branche `phase-0-security-baseline`. Correction dans le même sprint que l'audit
(`GIFT_CARD_TEMPLATE_DELIVERY_AUDIT.md`).

## Résumé

Le pipeline officiel est désormais **garanti pour les deux flux** (manuel M13 + achat en ligne Stripe) :

```
GiftCard → template ACTIF (resolver, seed si absent) → renderGiftCardHtml → PDF (pdfkit) → pièce jointe Brevo
```

Avant : l'achat en ligne Stripe **n'envoyait aucune carte PDF** (infra `gift_card.online_created`
présente mais jamais déclenchée) ; le rendu retombait sur un template `{}` vide si aucun actif.
Après : les deux flux résolvent le template actif (seed idempotent au besoin), figent
`activeTemplateId`, génèrent un QR réel + le PDF, et envoient le mail commerciale→client avec la carte
en pièce jointe. Best-effort côté paiement (ne casse jamais l'achat Stripe).

## Changements

### Nouveaux services
- **`services/giftCard/giftCardTemplateSeedService.js`** — `ensureDefaultGiftCardTemplate()`.
  Idempotent, non destructif : (1) actif existant → no-op ; (2) publiés/visibles sans actif → active le
  meilleur candidat (système par défaut → `classique` → plus ancien) ; (3) rien d'activable → crée
  « BeautySavage Classic » publié+visible+actif. Ne désactive jamais un actif existant.
- **`services/giftCard/giftCardTemplateResolver.js`** — point d'entrée unique du rendu :
  `getActiveGiftCardTemplate()`, `getActiveGiftCardTemplateOrSeed()`, `assertActiveGiftCardTemplate()`
  (erreur contrôlée `GIFT_CARD_TEMPLATE_UNAVAILABLE` si seed impossible).

### Branchements
- `services/giftCard/giftCardRenderService.js` → `generateGiftCardAssets` utilise
  `getActiveGiftCardTemplateOrSeed()` (fin du fallback `{}`).
- `controllers/giftCardController.js` :
  - flux manuel (`createManualGiftCard`) → `getActiveGiftCardTemplateOrSeed()` ;
  - flux online (`createGiftCardForPurchase`) → résolution template actif, `activeTemplateId` figé,
    rotation QR réelle, `generateGiftCardAssets`, `sendGiftCardEventMail('gift_card.online_created')`
    avec PDF joint (helper `deliverOnlineGiftCardEmail`, best-effort).
- `seeders/seedGiftCardTemplates.js` → délègue à `ensureDefaultGiftCardTemplate` (boot `app.js` inchangé).

## Réponses de contrôle

| Point | État |
| --- | --- |
| Template seedé | **Oui** — BeautySavage Classic (`classique`), système par défaut. |
| Template actif garanti | **Oui** — resolver + seed idempotent, jamais zéro actif. |
| Sélection admin | **Oui** — `activateGiftCardTemplate` (1 seul actif), `templateId` explicite honoré au manuel. |
| Flux manuel | Template actif (ou explicite) → PDF joint, « Paiement sur place », transaction `manual_issued` inchangée. |
| Flux online Stripe | Template actif figé → QR réel + PDF → mail `gift_card.online_created` (commerciale→client). |
| Pipeline PDF | GiftCard → template actif → HTML → PDF pdfkit → pièce jointe. |
| Pièce jointe Brevo | PDF base64 passé via `dispatchTemplateByRoles(attachments)`. |
| QR réel vs preview | Réel (token opaque, jamais en clair) dans le PDF final ; factice en preview studio. |
| Secrets en logs | Aucun code/pin/token en log ; event `online_created` sans secret. |

## Tests

- `tests/p1/giftCardTemplateActiveSeed.test.js` — seed/ensure, activation candidat, idempotence, resolver.
- `tests/p1/giftCardTemplateDeliveryPipeline.test.js` — HTML+PDF depuis template actif, variables, QR réel/factice.
- `tests/p1/giftCardOnlinePurchaseTemplate.test.js` — achat online fige le template, QR/PDF, event sans secret.
- `tests/p1/giftCardManualTemplateSelection.test.js` — manuel : actif par défaut, `templateId` explicite, non publié 404.
- `tests/p1/giftCardTemplateNoHardcodedPdf.test.js` — rendu = template actif (marqueur unique), jamais générique.

Brevo non configuré en environnement de test → **aucun mail réel** (le moteur renvoie `identity_missing`).

## Limites restantes

- **PDF non pixel-perfect** : `pdfkit` dessine une carte structurée pilotée par les **variables** du
  template actif (couleurs de marque + textes + QR), pas un rendu HTML/CSS arbitraire. Le rendu
  pixel-perfect HTML→PDF (headless browser) reste différé (piste C4). Le HTML autonome est, lui, fidèle
  au template.
- **paymentLabel online** : laissé vide (pas de mention « Paiement sur place », réservée au manuel).
- **Idempotence mail online** sous retry webhook Stripe : même exposition que le flux manuel (best-effort,
  pas de ledger dédié ajouté ici).

## Procédure de test

```bash
cd backend
npx vitest run tests/p1/giftCardTemplateActiveSeed.test.js \
  tests/p1/giftCardTemplateDeliveryPipeline.test.js \
  tests/p1/giftCardOnlinePurchaseTemplate.test.js \
  tests/p1/giftCardManualTemplateSelection.test.js \
  tests/p1/giftCardTemplateNoHardcodedPdf.test.js
npm run test:p1
npm run test:p0 && npm run test:integration
npm run audit:business-scenarios && npm run audit:commissions
```
