# RX3 Session 3 — Audit checkout multi-item

> PARTIE 1. Branche `phase-0-security-baseline`, travail parallèle, staging sélectif. Ne pas empiéter sur
> RX2.x Finance ni RX4 Client Hub. **Décision de cadrage (validée) : FRONT-ONLY** — on consomme ce que le
> backend supporte déjà, **zéro modification du cœur checkout/légal/anti-double-booking** (protège Stripe /
> UnifiedCheckout / Gift Card M13 / RX2.6). Tranche cohérente testée + commit.
>
> Méthode : 3 audits parallèles (backend finalizer, payload Vanilla, état React). Le backend reste
> autorité pricing / disponibilité / légal. Carte cadeau = moyen de paiement, jamais remise.

## 0. Conclusion pivot

**Ce que le backend finalise DÉJÀ (aucun changement) :**
- Panier `checkoutState.cart === true` avec `items[]` de kind **`formation`** (présentiel + session /
  distanciel + waiver) **et `product`** — `processCartCheckoutStatePurchase`
  (`services/checkout/checkoutFinalizationService.js:47-378`).
- **Cartes cadeaux en paiement** : `appliedGiftCards[]` (`giftCardId?`, `code?`, `amount`, `password?`),
  **plein / partiel / multiple**, **capé au solde réel** (`checkoutGiftCardService.js:67-243`,
  `computeAvailableGiftCardBalance`).
- **Consentements légaux** re-dérivés serveur (`services/legalConsentService.js`) : distanciel → waiver
  accès immédiat obligatoire ; présentiel daté-proche → waiver ; prestation datée → ack.
- **finalize-free (0 €)** `POST /api/client/checkout/finalize-free` (`requireZeroRemaining` anti-bypass) ;
  **Stripe hosted (> 0 €)** `POST /api/stripe/create-checkout-session` (retour via `CHECKOUT_RETURN_BASE_URL`
  → `/paiement/succes|annule`).
- **Anti-double-booking** : présentiel = `FormationSession.findOneAndUpdate({reservedCount:{$lt:maxClients}})`
  atomique (`SESSION_FULL`) ; prestation single-item = `createGlobalServiceBooking` (lock institut).

**Ce que le backend NE finalise PAS sans modifier le cœur (3-5 fichiers) :**
- **Prestation (service) comme LIGNE de panier** — la boucle cart n'a pas de branche `service` (seul le
  chemin single-item `service{slotStart,slotEnd}` existe).
- **Achat carte cadeau comme LIGNE de panier** — supporté uniquement en single-item (`item.type:'gift-card'`).

→ Conséquence cadrage FRONT-ONLY : **le panier multi-item cible formations (+produits)** ; la **prestation
reste sur son parcours single-item** (S2, fonctionnel) ; l'**achat carte cadeau** (single-item) et la
**prestation-en-panier** sont **différés** (nécessitent le cœur backend).

## 1. Payload backend (à répliquer fidèlement)

Panier (`cart:true`) — `checkoutFinalizationService.js:47`, pricing `checkoutPricingService.js:197`,
validation catalogue `stripeCheckoutService.js:247` :
```jsonc
{
  "cart": true,
  "items": [ { "type": "formation"|"product", "id": "<id>", "sessionId": "<id>|null",
               "selectedOptions": [ { "optionId": "<id>" } ] } ],
  "consumerWaivers": [ { "type": "legal"|"institut", "text": "<texte>", "accepted": true,
                         "formationIds": ["<id>"] } ],
  "refundPolicySnapshots": { "<formationId>": { "refundDays": 14, "daysBeforeFormation": 10,
                             "waiverType": "legal"|"institut"|null, "waiverText": "…", "acceptedAt": "<iso>" } },
  "appliedGiftCards": [ { "giftCardId": "<id>", "code": "ABCD", "password": "<pwd?>", "amount": 50 } ],
  "totals": { "subtotal": 180, "giftCardUsed": 50, "remainingToPay": 130 },
  "legal": { "acceptedCgv": true },
  "paymentProvider": "stripe",
  "origin": { "source": "react_storefront" }
}
```
Endpoints : `POST /api/stripe/create-checkout-session` body `{ checkoutState }` (>0 €) ;
`POST /api/client/checkout/finalize-free` body `{ checkoutState, idempotencyKey }` (0 €).
Gift card apply : `POST /api/client/gift-cards/validate` (code → carte+solde),
`POST /api/client/gift-cards/validate-credentials` (code+password), `GET /api/client/gift-cards/my`.

Single-item service (inchangé, S2) : `{ item:{type:'service'}, service:{serviceId,slotStart,slotEnd,
selectedOptions}, legal:{acceptedCgv,waiverAccepted?,waiverText?}, appliedGiftCards[] }`.

## 2. État React (point de départ)
- **Cart** (`features/cart/`) : `ServiceCartItem` seul concret ; `CartProvider.addService` seule méthode ;
  `CartItemKind` = service|formation|product|gift_card (déclaré, pas implémenté). `CART_VERSION=1`
  (bumper à l'ajout de nouveaux kinds).
- **Checkout api-client** (`checkout/`) : `ServiceCheckoutState` (single service) ; `createCheckoutSession`
  (hosted/free/elements), `finalizeFreeCheckout`, `getCheckoutSessionStatus`. Pas de type cart.
- **CheckoutPage** : `toServiceLine` paie **la 1ʳᵉ prestation datée**, ignore le reste ; hosted/free/401 ;
  pas de multi-item/formation/gift-card.
- **Legal** (`features/legal/`) : `LegalConsentChecklist` (CGV + rétractation + service daté), **global**
  (pas par item).
- **GiftCardsPage** : achat NON câblé (bouton désactivé).
- **PaymentSuccess/Cancel** : lisent le statut Stripe, `clearCart` sur `confirmed`. Kind-agnostiques.

## 3. Collision RX4 (NE PAS toucher)
Owned RX4 : `features/account/*`, `packages/api-client/src/client/*`, `pages/My*Page.tsx`,
`AccountHelpPage`, `myAccount.test.tsx`. **Partagés (édition prudente)** : `App.tsx` (routes account) —
je ne touche pas ce bloc ; `packages/api-client/src/index.ts` (barrel). Sûrs à posséder : `features/cart/*`,
`features/legal/*`, `checkout/*`, `booking/*`, `pages/{Cart,Checkout,PaymentSuccess,PaymentCancel,GiftCards}`,
`features/serviceDetail/`, `features/trainingDetail/`.

## 4. Cas à bloquer (règles front)
- Prestation sans créneau → pas d'ajout (déjà : S2 booking drawer exige un slot).
- Formation présentielle sans session → pas d'ajout au panier.
- Formation distancielle → ajout OK, **checkout exige le waiver accès immédiat**.
- Item indisponible (session complète / plus visible) → marqué « Non disponible », retirable, **bloque le
  paiement**.
- Carte cadeau : capée au solde ; invalide/inactive → erreur claire ; jamais une remise.
- Montant 0 € (carte couvre tout) → `finalize-free` ; > 0 € → Stripe hosted.
- **Panier mixte prestation + formation** : non finalisable en une session Stripe (2 finalizers backend
  distincts) → UX honnête : réglés séparément (prestation = parcours single-item S2).

## 5. Périmètre livré cette session (front-only)
1. **Cart multi-item** : `FormationCartItem` (présentiel session / distanciel lifetime+waiver), `addFormation`,
   `CART_VERSION` bump. 2. **Achat formation** depuis la fiche (présentiel : session obligatoire ; distanciel).
3. **Moteur légal** `buildLegalRequirements(items)` (par item). 4. **Gift card apply** au checkout
   (validate/credentials, masqué, solde, multiple, retrait). 5. **Checkout multi-item premium** (cart
   checkoutState formations + gift cards, hosted/free) + composants. 6. **Disponibilité dynamique**
   `useCartAvailability` (re-check sessions). 7. **Succès/annulation** premium.

## 6. Différé (documenté)
- **Achat carte cadeau** (Part 9) : single-item, supporté backend, mais UX dédiée → prochaine tranche.
- **Prestation-en-panier** & **carte-cadeau-purchase-en-panier** : nécessitent le cœur backend
  (pricing/validation/finalization/légal/anti-double-booking) → hors front-only.
- **Produits** : pas de page d'achat produit en React → non ajoutables (kind supporté au checkout si présent).
- Pas d'endpoint « solde carte cadeau » autonome hors validate ; pas de Stripe Elements React (hosted only).
