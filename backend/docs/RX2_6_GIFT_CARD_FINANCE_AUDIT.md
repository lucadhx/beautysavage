# RX2.6 — Gift Card Finance · Audit

> Objectif : la carte cadeau comme **cycle de vie financier complet** (créée → offerte → utilisée →
> débit manuel → solde → transactions → source paiement → acheteur/bénéficiaire → sur place/Stripe →
> QR → remboursements splittés). **Règle produit ferme : aucune mention d'« expiration » dans l'UI**
> (ni « expire », ni « pas d'expiration »). Aucun montant inventé ; jamais le code/secret complet ; QR = token opaque.

Prolonge le mega-audit RX2 (cartes cadeaux) + RX2.2/2.3.

---

## 1. Modèles & sources de vérité (vérifiés)

### `GiftCard`
`code` (jamais affiché en entier), `userId` (**bénéficiaire/propriétaire**), `amount` (initial),
`balance` (solde courant), `reservedAmount` (holds checkout), `status` (`active`/`redeemed`), `saleId`,
`purchasedAt`. **M13** : `creationMode` (`online`/`manual_institute`), `paymentMode` (`stripe`/`on_site`),
`paymentLabel`, `recipientName`, `purchaserName`, `message`, `manualPaymentMethod`, `createdByAdminId`,
`qrTokenHash` (SHA256, jamais en clair), `generatedPdfUrl`, `cardVisualUrl`. Mot de passe (`passwordHash`/
`passwordEncrypted`) **jamais exposé**.

### `GiftCardTransaction` (ledger — colonne vertébrale)
`giftCardId`, `transactionType` (`manual_issued`/`redeem`/`manual_debit`/`credit`), `source`, `actorRole`,
`amount`, **`balanceBefore`/`balanceAfter`**, `saleId`, `note`, `items`, `createdAt`.

### `RefundRequest` (split)
`amount`, `stripeRefundAmount`, `giftCardRefundAmount`, `giftCardRefundStatus`
(`not_applicable`/`pending`/`succeeded`/`failed`/`rollback_needed`), `giftCardRecredited`,
`giftCardRecreditAttempts` (max 5), `creditNotePdfUrl`, `saleId`, `status`.

---

## 2. Circuits (rappel métier)

| Circuit | `creationMode` | `paymentMode` | Preuve | Ledger |
|---|---|---|---|---|
| Achat en ligne | `online` | `stripe` | `saleId` → `Invoice` officielle Stripe | (pas de tx d'émission ; c'est un `Sale`) |
| Création manuelle institut | `manual_institute` | `on_site` | « Paiement sur place », aucun Stripe | `manual_issued` |
| Utilisation | — | — | moyen de paiement (dans `Sale.giftCardUsage`) | `redeem` |
| Débit manuel | — | — | motif obligatoire | `manual_debit` |
| Recrédit remboursement | — | — | `RefundRequest.giftCardRefundAmount` | `credit` |

**Carte cadeau utilisée = moyen de paiement, jamais une remise** : `Sale.totalAmount` reste le prix vendu,
la commission formation est calculée sur ce prix ; la part carte cadeau réduit le reste à payer (part Stripe).

---

## 3. Solde & acteurs

- **Solde** : `balance` (courant), `amount` (initial), `reservedAmount` (holds), disponible = `balance − reservedAmount`.
  Historique via le ledger (`balanceBefore`/`balanceAfter`).
- **Acheteur** : `purchaserName` (manuel) ; sinon (en ligne) `Sale.customer` du `saleId` ; sinon le propriétaire.
- **Bénéficiaire** : `recipientName` (manuel) ; sinon le propriétaire `userId` (résolu via `User`).

## 4. Remboursements splittés (lien carte ↔ refund)

Une carte est concernée par un refund si :
1. elle a été **utilisée** dans le `Sale` remboursé (`Sale.giftCardUsage.giftCardId == card._id`), OU
2. elle a un `credit` (recrédit) portant le `saleId` du refund.
→ `RefundRequest` par `saleId ∈ {ces ventes}` avec `giftCardRefundAmount>0` ou `giftCardRefundStatus≠not_applicable`.
Statuts affichés : `succeeded` / `pending` / `failed` / **`rollback_needed`** (anomalie à traiter) ;
`recovered` heuristique = `giftCardRecredited && giftCardRecreditAttempts>1`. Recovery job existant
(`giftCardRecreditRecoveryService`) conservé — RX2.6 **rend visible**, ne relance rien.

## 5. QR (privacy)

`qr.available = Boolean(qrTokenHash)` ; `maskedToken = '••••'`. **Jamais** le token ni le hash ni le code
complet. Action « Débiter via QR » = lien vers le flux M13 (drawer débit dans Customer360 du propriétaire).
Pas de caméra dans RX2.6 (hors périmètre finance).

## 6. Intégration finance timeline (RX2.2)

Déjà présents : `gift_card_issue` (manual_issued, in), `gift_card_usage` (redeem, **neutral** — déjà dans
`Sale.totalAmount`), `gift_card_manual_debit` (neutral). RX2.6 ajoute :
- `gift_card_refund_recredit` (tx `credit`, **neutral** — pas un revenu neuf) ;
- `gift_card_recredit_failed` (refund `rollback_needed`, **neutral**, badge danger).
Les mouvements carte cadeau portent une action `gift_card_view` → `/finance/cartes-cadeaux/:giftCardId`.
**Anti-double-count** : émission manuelle = encaissement sur place (in) ; achat en ligne = déjà un `Sale` ;
usage/recrédit = neutral. Documenté et testé.

## 7. Endpoints

`GET /api/gestion/finance/gift-cards` (liste + summary) et `GET /api/gestion/finance/gift-cards/:giftCardId`
(détail + lifecycle + transactions + refunds + paymentSource + actors + QR + actions). Admin/dev only.

## 8. Limites V1

- **Aucune expiration** dans l'UI ni les libellés (règle produit).
- `email_sent` non tracé de façon fiable par carte → non émis dans le lifecycle (documenté, pas inventé).
- `qr_generated`/`pdf_generated` datés à `purchasedAt` (pas d'horodatage dédié).
- `recovered` = heuristique (`attempts>1 && recredited`) faute de flag dédié.
- Débit via QR = lien vers Customer360 (le flux M13 y vit) ; pas de caméra ici.
