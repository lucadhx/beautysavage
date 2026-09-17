# RX2.4 — Paiements sur place unifiés & encaissement prestations manuelles · Audit

> Objectif : représenter et encaisser de façon **unifiée** tous les paiements sur place — y compris les
> **prestations payées intégralement sur place** via réservation manuelle (le trou documenté en RX2.3).
> Règle d'or : aucun montant inventé ; chaque mouvement vient d'un champ réel.

Prolonge [RX2_3_PAYMENTS_REFUNDS_NET_PROFIT_AUDIT.md](RX2_3_PAYMENTS_REFUNDS_NET_PROFIT_AUDIT.md).

---

## 1. Réalité backend (vérifiée)

### Réservation manuelle — `createManualBookingByAdmin` (serviceBookingController.js)
Crée un `ServiceBooking` **sans Sale, sans Stripe** :
- `paymentMode: 'on_site'`, `source: 'manual_institute'`, `status: 'confirmed'`, `paymentStatus: 'pending'`.
- `paymentType: depositAmount > 0 ? 'deposit' : 'full'`.
- `balanceDueAmount: totalPrice − depositAmount` → pour une prestation **payée entièrement sur place**
  (sans acompte), `balanceDueAmount = totalPrice`, `paymentType = 'full'`.
- `balanceSettlementMode: 'pay_on_site'`, `totalSoldAmount: 0`.

### Encaissement — `markBalancePaidOnSite` (POST /api/gestion/bookings/:id/balance-paid)
**Rejette tout ce qui n'est pas un acompte** :
```js
if (booking.paymentType !== 'deposit') return 409 'Cette réservation n'est pas un acompte.';
```
→ **Une prestation manuelle full on-site (`paymentType:'full'`) ne peut JAMAIS être encaissée.** 🔴 (le trou).

---

## 2. Incohérences identifiées

| # | Constat | Impact |
|---|---|---|
| G1 | `markBalancePaidOnSite` exige `paymentType==='deposit'` | prestation manuelle full on-site non encaissable |
| G2 | Dashboard `pendingBalanceBookings` exige `paymentStatus==='deposit_paid'` | manuelles full (paymentStatus `pending`) **absentes** du « à encaisser » |
| G3 | Timeline `balance` filtre `{$or:[balanceDueAmount>0, balancePaidAt]}` sans settlement/status | inclut des bookings annulés / hors-circuit ; **divergent** du dashboard |
| G4 | Wording « Solde à encaisser/encaissé » pour une prestation payée **100 %** sur place | trompeur (ce n'est pas un *solde*) |

---

## 3. Décisions RX2.4

1. **G1 — Généraliser l'encaissement.** `markBalancePaidOnSite` accepte aussi `paymentType==='full'`
   quand `paymentMode==='on_site'` et `balanceSettlementMode==='pay_on_site'`. Même effet : `balanceDueAmount→0`,
   `paymentStatus='paid'`, `balancePaidAt=now`, `balancePaymentMethod` (RX2.3). **Aucun Stripe.** Rétro-compatible
   (les acomptes online passent toujours).
2. **G2+G3 — Filtre unifié `ONSITE_DUE_BOOKING_FILTER`** partagé par le dashboard ET la timeline :
   ```js
   { balanceDueAmount: { $gt: 0 }, balanceSettlementMode: 'pay_on_site',
     status: { $nin: ['cancelled', 'pending_payment'] } }
   ```
   → inclut acomptes online (confirmés, solde sur place) **et** prestations manuelles full on-site ; exclut
   annulées et online non payées. `paymentStatus` n'est plus un critère (incohérent).
3. **G4 — Wording adaptatif** dans le mapper booking :
   - `paymentType==='full'` (manuelle full on-site) → « Paiement sur place à encaisser » / « Paiement sur place encaissé ».
   - sinon (acompte) → « Solde à encaisser » / « Solde encaissé ».
   - Badges : « Sur place » (paymentMode on_site), « Réservation manuelle » (source manual_institute), « À encaisser ».

---

## 4. Représentation finance (après RX2.4)

| État booking | Mouvement | direction | amount | profit net |
|---|---|---|---|---|
| Manuelle full on-site, non encaissée | `balance_due` « Paiement sur place à encaisser » | neutral | `totalPrice` | not_applicable |
| Manuelle full on-site, encaissée | `balance_paid` « Paiement sur place encaissé » | in | `totalPrice − depositAmount` (= totalPrice) | complete (sur place, 0 frais, 0 commission) |
| Acompte online, solde dû | `balance_due` « Solde à encaisser » | neutral | `balanceDueAmount` | not_applicable |
| Acompte online, solde encaissé | `balance_paid` « Solde encaissé » | in | `totalPrice − depositAmount` | complete |

Le détail mouvement (RX2.3) reste correct : `onSitePaidAmount = totalPrice − depositAmount`, net = ce montant,
statut `complete` (pas de frais Stripe, prestation → 0 commission Dev).

---

## 5. Limites V1 (assumées)

- Acompte **d'une réservation manuelle** : encaissé directement sur place mais non tracé séparément (le booking
  reste `pending` jusqu'à l'encaissement du solde) ; le cas usuel est full on-site (sans acompte).
- Toujours pas de `Sale` pour les bookings manuels (volontaire : ne pollue ni revenus en ligne ni commissions) ;
  la finance les lit via `ServiceBooking` (timeline + dashboard).
- Exports comptables = RX2.9.
