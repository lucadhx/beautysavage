# RX2.2 — Financial Timeline · Audit

> Objectif : la **colonne vertébrale narrative** de la finance. On lit la timeline et on comprend
> instantanément ce qui s'est passé : paiement reçu → acompte → solde → carte cadeau utilisée →
> remboursement → facture → avoir → commission. Cards/drawers, jamais de table. Mobile = desktop.
> Règle d'or : **aucun montant inventé** — chaque card vient d'un champ réel. **Aucun double-count.**

Prolonge [RX2_FINANCE_AUDIT.md](RX2_FINANCE_AUDIT.md) et RX2.1 (Finance Dashboard, `services/financeService.js`,
`/api/gestion/finance/dashboard`, feature React `features/finance/`).

---

## 1. Mouvements financiers existants & sources de vérité

| Mouvement (`type`) | Source de vérité | `direction` | `amount` (champ réel) | `status` | `occurredAt` | Compté dans summary |
|---|---|---|---|---|---|---|
| `sale` | `Sale` (items non-deposit) | `in` | `totalAmount` | `paid` | `createdAt` | **grossIn** |
| `deposit` | `Sale` lié à un `ServiceBooking` `paymentType=deposit` | `in` | `totalAmount` (= acompte) | `paid` | `createdAt` | **grossIn** |
| `balance_due` | `ServiceBooking` `balanceDueAmount>0` | `neutral` | `balanceDueAmount` | `balance_due` | `createdAt` | **balanceDueAmount** (métrique séparée) |
| `balance_paid` | `ServiceBooking` `balancePaidAt` posé | `in` | `totalPrice − depositAmount` | `paid` | `balancePaidAt` | **grossIn** |
| `refund` | `RefundRequest` | `out` | `amount` | refunded/pending/failed/cancelled | `refundedAt \|\| requestedAt` | **grossOut** |
| `gift_card_issue` | `GiftCardTransaction` `manual_issued` | `in` | `amount` | `paid` | `createdAt` | **grossIn** |
| `gift_card_usage` | `GiftCardTransaction` `redeem` | `neutral` | `amount` | `paid` | `createdAt` | exclu |
| `gift_card_manual_debit` | `GiftCardTransaction` `manual_debit` | `neutral` | `amount` | `paid` | `createdAt` | exclu |
| `commission` | `CommissionPayment` (`netAmountDue>0` ou payée) | `out` | `netAmountDue` | paid/pending/failed | `paidAt \|\| periodEnd` | **grossOut** |
| `invoice` | `Invoice` (`official=true`) | `neutral` | `totalAmount` | paid/pending | `invoiceDate \|\| createdAt` | exclu |

`summary` :
- `grossIn` = Σ `amount` des mouvements `direction=in`
- `grossOut` = Σ `amount` des mouvements `direction=out`
- `netAmount` = `grossIn − grossOut`
- `balanceDueAmount` = Σ `amount` des `type=balance_due`
- `count` = nombre de mouvements ; `refundCount` = nombre de `type=refund`

---

## 2. Règles anti-double-count (testées)

1. **Sale vs Invoice.** Chaque vente a une `Invoice` ; les compter toutes les deux gonflerait le revenu.
   → la facture n'est **pas** une ligne par défaut : elle est un **lien/action** (`invoice_view`) sur la vente.
   Les lignes `invoice` n'apparaissent **que** si l'utilisateur filtre explicitement `type=invoice`,
   et restent `neutral` (exclues de grossIn/grossOut). `netAmount` est invariant à leur présence.
2. **Carte cadeau utilisée = moyen de paiement, pas un revenu neuf.** `Sale.totalAmount` inclut déjà la
   part payée en carte cadeau (`giftCardUsage[].amountUsed`). `gift_card_usage`/`gift_card_manual_debit`
   sont donc `neutral` (affichés mais exclus du gross).
3. **Émission carte cadeau : seulement les cartes manuelles.** Les cartes achetées en ligne sont déjà des
   `Sale` (type `gift-card`) ; on ne crée `gift_card_issue` que pour `manual_issued` (paiement sur place,
   pas de Stripe), sinon double-count avec la vente.
4. **Acompte + solde = montant total, sans double-count.** `deposit` compte `totalAmount` (= acompte payé) ;
   `balance_paid` compte `totalPrice − depositAmount` (le reste encaissé sur place). Σ = `totalPrice`.
   Tant que le solde n'est pas payé, `balance_due` est `neutral` (pas encore encaissé).
5. **Commission = platform billing.** Source = `CommissionPayment` (facturation mensuelle plateforme),
   PAS `CommissionTransaction` (accruals par vente, internes) → évite de mélanger accruals et cash.

---

## 3. Filtres V1

- **period** : `today` | `week` (7 j) | `month` (30 j) | `all` — fenêtre sur `occurredAt`.
- **type** : `all` | `sale` | `deposit` | `balance` (=`balance_due`+`balance_paid`) | `gift_card`
  (=`gift_card_issue`+`gift_card_usage`+`gift_card_manual_debit`) | `refund` | `commission` | `invoice`.
- **status** : `paid` | `pending` | `refunded` | `balance_due` | `failed` | `cancelled`.
- **limit** : défaut 50, max 200. `summary` est calculé sur **tout** l'ensemble filtré (avant `limit`) ;
  `items` est la tranche triée (desc `occurredAt`) limitée.

---

## 4. Actions structurées (préparent RX2.3)

Chaque item porte `actions: [{ kind, enabled, to?, url? }]`. RX2.2 câble uniquement les liens existants ;
les actions profondes restent `enabled:false` ou pointent une route existante.

| kind | enabled V1 | cible |
|---|---|---|
| `customer_view` | si `customer.id` | `/clients/:id` (existe) |
| `invoice_view` | si URL PDF | lien PDF (existe) |
| `refund_process` | si refund pending | `/remboursements` (placeholder → drawer 1-clic RX2.3, route B1 prête) |
| `balance_collect` | si `balance_due` | `/reservations` (placeholder → encaissement RX2.3) |
| `sale_view` / `commission_view` | `false` | (RX2.4+) |

---

## 5. Risques & limites V1 (assumés, documentés)

- **Trésorerie vs valeur de transaction.** `netAmount` est une valeur de **flux de transactions**, pas un
  relevé de trésorerie : une carte cadeau prépayée est comptée à l'émission/achat *et* la vente qui la
  consomme compte son `totalAmount`. Un vrai rapprochement trésorerie viendra en **Phase 9 (Analytics)**.
- **Prestations payées 100 % sur place (réservation manuelle sans Sale ni `balancePaidAt`).** Non
  représentées en V1 (ni `Sale`, ni solde, ni date fiable) → branchées en **RX2.4 (paiements sur place)**.
- **Split prestations/formations au niveau mouvement.** Un `Sale` peut mélanger plusieurs types d'items ;
  le filtre V1 reste au niveau mouvement (`sale`), pas au niveau item. Split fin = ultérieur.
- **Frais Stripe / net Stripe** (`stripeFee`/`stripeNet`) non agrégés ici (vue Paiements RX2.4 / Analytics).
- **Avoirs** : `RefundRequest.creditNotePdfUrl` exposé en lien sur le mouvement `refund` (pas une ligne
  distincte en V1) — la section avoirs dédiée arrive en RX2.9.

---

## 6. Endpoint

`GET /api/gestion/finance/timeline?period=&type=&status=&limit=` — admin/dev (`requireAdminOrDev`),
monté sur `financeRouter` (`/api/gestion/finance`, AVANT les broad-mounts dev-only). Retour
`{ ok, summary, items }`. Backend = autorité ; le front n'effectue **aucun** calcul de montant.
