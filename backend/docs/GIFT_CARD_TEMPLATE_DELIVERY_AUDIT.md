# Audit — Livraison PDF carte cadeau depuis le template actif

Mission **GC-TPL-AUDIT** — branche `phase-0-security-baseline`.
Objectif : garantir que **toute** carte cadeau (manuelle M13 + achat en ligne Stripe) génère son PDF
depuis le **template actif** configuré côté admin/dev, joint au mail Brevo.

Flux attendu obligatoire :

```
Template actif → Render HTML → PDF → Pièce jointe Brevo
```

## Périmètre audité

| Élément | Fichier |
| --- | --- |
| Modèle template | `models/GiftCardTemplate.js` |
| Seed template | `seeders/seedGiftCardTemplates.js` + boot `app.js:593` |
| Studio (versioning/activate) | `services/giftCard/giftCardTemplateService.js`, `controllers/giftCardTemplateController.js`, `routers/giftCardTemplateStudioRouter.js` |
| Librairie admin | `getActiveGiftCardTemplate` / `activateGiftCardTemplate` |
| Rendu HTML+PDF | `services/giftCard/giftCardRenderService.js` |
| QR opaque | `services/giftCard/giftCardQrService.js` |
| Mail carte cadeau | `services/giftCard/giftCardMailService.js`, `constants/mailDispatchRules.js`, `constants/eventCatalog.js` |
| Création manuelle M13 | `controllers/giftCardController.js#createManualGiftCard` |
| Achat en ligne | `controllers/giftCardController.js#createGiftCardForPurchase`, `services/checkout/checkoutFinalizationService.js`, `controllers/giftCardController.js#purchaseGiftCard` |
| Tests M13 | `tests/p1/giftCardManualFlows.test.js`, `giftCardTemplateStudio.test.js`, `giftCardPurchaseRecipient.test.js` |

## Réponses aux questions de l'audit

| # | Question | Réponse (AVANT correction) |
| --- | --- | --- |
| 1 | Existe-t-il déjà un template seedé ? | **Oui.** `seeders/seedGiftCardTemplates.js` crée « Carte cadeau — Classique » (slug `classique`), appelé au boot (`app.js:593`). |
| 2 | Est-il automatiquement actif ? | **Oui au boot** (le seed l'active si aucun actif). **Mais pas garanti hors boot** : en test le seed est gaté (boot off), et si aucun template n'est actif le rendu retombe sur `{}`. |
| 3 | L'admin peut-il sélectionner un template actif ? | **Oui.** `activateGiftCardTemplate` (librairie admin) garantit « exactement un actif », index unique partiel `uniq_active_gift_card_template`. |
| 4 | Le flux manuel utilise-t-il le template actif ? | **Oui** (template explicite `templateId` sinon `getActiveGiftCardTemplate`), PDF joint au mail `gift_card.manual_created`. ⚠️ fallback `{}` si aucun actif. |
| 5 | Le flux achat Stripe utilise-t-il le template actif ? | **❌ NON.** `createGiftCardForPurchase` **ne résout aucun template, ne génère aucun PDF, n'envoie aucun mail.** Il persiste seulement l'enregistrement carte. |
| 6 | Le mail contient-il bien la carte PDF générée ? | **Manuel : oui.** **Online : NON — aucun mail n'est envoyé.** |
| 7 | Existe-t-il un fallback codé en dur ? | **Partiel.** Le PDF est dessiné par `pdfkit` (mise en page structurée codée en dur), **piloté par les variables du template** mais **pas** par son HTML/CSS (limite pixel-perfect documentée, cf. C4). Le HTML autonome, lui, vient bien du template. Le vrai risque « hardcodé » est le fallback `{}` quand aucun template actif. |
| 8 | Existe-t-il un cas où aucune carte PDF n'est jointe ? | **Oui.** Tout achat en ligne Stripe : le client ne reçoit jamais la carte PDF. |
| 9 | Existe-t-il un cas où un template non actif est utilisé ? | Manuel : uniquement si l'admin passe explicitement un `templateId` publié (comportement voulu). Sinon non. |
| 10 | Existe-t-il un cas où zéro template actif est possible ? | **Oui**, transitoirement : en environnement où le seed boot n'a pas tourné (tests, migration, DB restaurée), ou si un opérateur archive/désactive hors chemin standard. Le rendu retombe alors sur `{}` sans erreur contrôlée. |

## Constats (defects)

- **D1 — CRITIQUE : l'achat en ligne Stripe n'envoie pas la carte PDF.**
  `createGiftCardForPurchase` (`giftCardController.js:181`) crée la carte et s'arrête. Aucun appel à
  `generateGiftCardAssets`, aucun `sendGiftCardEventMail('gift_card.online_created')`, aucun QR, aucun
  `activeTemplateId`. Pourtant l'event `gift_card.online_created`, la règle `mailDispatchRules` et le
  templateKey `gift_card_online_created` **existent déjà** (infra morte). Le flux
  `checkoutFinalizationService.js:673` hérite du même manque.

- **D2 — Fallback template vide.** `generateGiftCardAssets` (`giftCardRenderService.js:207`) et le flux
  manuel (`giftCardController.js:1232`) appellent `getActiveGiftCardTemplate()` qui peut renvoyer `null` ;
  le rendu HTML utilise alors `{}` (document vide) au lieu de garantir/seed un template actif.

- **D3 — Pas de resolver « ensure ».** Aucune fonction ne garantit « template actif ou seed » au point de
  rendu. La garantie « jamais zéro actif » ne repose que sur le seed boot.

## Décisions de correction (même sprint)

1. **`services/giftCard/giftCardTemplateSeedService.js`** — `ensureDefaultGiftCardTemplate()` idempotent,
   non destructif : active le meilleur candidat visible/publié sinon crée « BeautySavage Classic » actif.
   Le seeder existant délègue à cette fonction (rétro-compat totale, boot inchangé).
2. **`services/giftCard/giftCardTemplateResolver.js`** — `getActiveGiftCardTemplate`,
   `getActiveGiftCardTemplateOrSeed`, `assertActiveGiftCardTemplate`. Point d'entrée unique du rendu.
3. **Rendu + flux manuel** branchés sur `getActiveGiftCardTemplateOrSeed` → plus de fallback `{}`.
4. **Flux achat en ligne** (`createGiftCardForPurchase`) : résolution template actif, `activeTemplateId`
   persisté, rotation QR réelle, `generateGiftCardAssets` (HTML+PDF), mail `gift_card.online_created`
   avec PDF joint — **best-effort** (n'interrompt jamais le paiement).

## Limites conservées (hors scope, documentées)

- **PDF ≠ pixel-perfect du HTML.** `pdfkit` ne rend pas de HTML/CSS arbitraire ; le PDF reste une carte
  structurée pilotée par les variables du template actif. Le rendu pixel-perfect HTML→PDF (headless
  browser) reste différé (C4). Le HTML autonome, lui, est fidèle au template.
- **QR** : token opaque réel dans le PDF final ; QR **factice** en preview studio. Aucun secret
  (code/pin/token) en logs.
- **RX3 S4** (achat carte cadeau online React) tourne en parallèle : correction backend uniquement,
  additive, sans toucher aux fichiers React RX3 (staging sélectif strict).
