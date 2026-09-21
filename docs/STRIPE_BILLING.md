# Facturation Stripe — historique & PDF

Ce lot **reflète** les factures générées par **Stripe** (paiements, abonnements,
factures hébergées + PDF) et en expose l'historique dans le Manager. Ce n'est **PAS**
de la facturation électronique : la **source juridique reste Stripe**, on conserve un
miroir interne (numéro, montants, statut, dates) et surtout les **liens hébergés**
(hosted invoice + PDF). Aucune facture n'est fabriquée par SB Auto.

## 0. À QUI la facture est adressée, et pour COMBIEN HT

Deux choses ont changé, et elles sont indépendantes.

### Le client Stripe porte une IDENTITÉ JURIDIQUE

Une facture réellement émise portait :

```text
Facturer à : CTR-2026-0002
```

— le **numéro de contrat** en guise de raison sociale, sans adresse, sans
SIREN, sans ventilation de TVA. La cause n'était pas un défaut d'affichage :
aucune personne morale acheteuse n'existait dans le système.

Le `Customer` Stripe est désormais construit depuis l'entreprise cliente
publiée par le Panel :

| Champ Stripe | Source |
|---|---|
| `name` | `legalName` — la raison sociale, **jamais** le numéro de contrat |
| `email` | `billingEmail` |
| `address` | l'adresse de facturation effective (le siège à défaut) |
| `tax_ids` | la TVA intracommunautaire, quand elle est connue |
| `metadata` | projet, entreprise cliente, SIREN, contrat |

Le **contrat** reste présent — en `description`, en champ personnalisé de la
facture et en métadonnée. C'est une **référence commerciale**, la clé qui
relie la facture à l'engagement. Ce n'est pas un nom de client, et il ne
s'affiche plus comme tel.

**Sans identité de facturation exploitable, aucune session n'est ouverte.**
Le refus tombe côté Panel, avant tout contact avec Stripe — voir
[CLIENT_COMPANY.md](./CLIENT_COMPANY.md) § 5.

### Les montants voyagent VENTILÉS

Ce projet calculait déjà HT / TVA / TTC pour l'afficher au client, mais ne
**publiait** que le TTC. Le Panel ne connaissait donc qu'un montant, et une
facture sans taxe déclarée est une facture muette sur la TVA.

La ventilation traverse désormais le pont (contrat ≥ 1.10.0) :

```text
amountExcludingTax   le HT, en centimes
taxRate              le taux appliqué
taxAmount            la TVA, en centimes
amount               le TTC, inchangé
```

Chez Stripe, le prix porte le **HT** avec `tax_behavior: 'exclusive'`, et un
`TaxRate` explicite est attaché. Stripe recompose donc HT + TVA = TTC, et la
facture PDF affiche les trois lignes.

**Aucun montant économique n'a changé.** Le TTC facturé est celui qui l'était
déjà ; ce qui change est ce que la facture en **dit**. La cohérence
`HT + TVA = TTC` **et** `TVA = arrondi(HT × taux)` est vérifiée avant l'envoi :
une ventilation incohérente est un **refus**, jamais un recalcul silencieux.
Une ventilation **absente** est un autre refus, avec un autre motif — les
confondre enverrait corriger un chiffre là où il faut en publier un.

Le taux n'est **jamais** une constante de ce projet : il vient du contrat, qui
le tient de la configuration fiscale du Panel.

## 1. D'où viennent les factures

- **Abonnement** : Stripe émet **automatiquement** une facture par cycle mensuel
  (`billing_reason = subscription_create | subscription_cycle`).
- **Frais de lancement** (paiement unique `mode: payment`) : Stripe **ne crée pas**
  de facture par défaut. On active donc **`invoice_creation`** sur la Checkout
  Session (avec `invoice_data.metadata` recopiant `contractId`/`paymentType`), ce qui
  génère une vraie facture Stripe **avec hosted invoice + PDF** pour le paiement
  unique. Voir [stripe.service.js](../backend/src/services/stripe/stripe.service.js).

## 2. Miroir interne & résolution du contrat

[billing.service.js](../backend/src/services/billing.service.js) — `upsertInvoiceFromStripe`
(idempotent, unique par `externalInvoiceId`) stocke : `number`, `type`
(`LAUNCH_FEE | SUBSCRIPTION`), montants **en centimes** (HT/TVA/TTC), `status`
(mappé), `invoiceDate`/`dueDate`/`paidAt`, `hostedInvoiceUrl`, `invoicePdfUrl`,
snapshot sûr. Jamais de suppression physique.

Les factures d'abonnement **n'héritent PAS** des metadata de l'abonnement : le
contrat est donc résolu **dans l'ordre** `metadata.contractId` → **abonnement**
(`invoiceSubscriptionId`) → **client** (`stripe.customerId`). Une facture sans
contrat rattachable est **quand même reflétée** (contractId null) et peut être
rattachée plus tard par la synchronisation.

Statuts (`mapInvoiceStatus`) : `paid→PAID`, `open→OPEN`, `draft→DRAFT`,
`uncollectible→UNCOLLECTIBLE`, `void→VOID`.

### Type d'une facture — `billing_reason` fait autorité

`invoiceType()` décide dans cet ordre :

1. `metadata.paymentType` (posée par `invoice_creation` sur les frais de lancement) ;
2. **`billing_reason`** — `subscription*` → `SUBSCRIPTION`, sinon `LAUNCH_FEE` ;
3. repli : présence d'un abonnement (`invoiceSubscriptionId`).

> ⚠️ **Ne jamais typer par `stripeInvoice.subscription`.** Deux pièges se
> cumulent : une facture d'abonnement n'a aucune metadata (elles restent sur
> l'abonnement), et le champ racine `subscription` a été **retiré** de l'objet
> Invoice en API `2025-03-31.basil` (déplacé sous
> `parent.subscription_details.subscription`). Une facture de cycle était donc
> typée `LAUNCH_FEE` par défaut — deux factures « Frais de lancement » à
> l'écran, et surtout **plus aucun paiement de cycle enregistré** ni passage en
> `PAST_DUE`, car `handleInvoiceEvent` s'appuie sur le même type.
> Incident et correction : [RX_POLISH_CONTRACTS_BILLING_01.md](./RX_POLISH_CONTRACTS_BILLING_01.md).

`invoiceSubscriptionId()` accepte les **deux** formes d'API (racine et
`parent.subscription_details`). La version d'API est **épinglée** explicitement
(`STRIPE_API_VERSION`, [stripe.provider.js](../backend/src/services/stripe/stripe.provider.js)) :
sans cela, le SDK appelle dans sa version compilée pendant que les webhooks
arrivent dans celle du compte — les deux peuvent diverger sans qu'aucune ligne de
code ne change. **Aligner l'endpoint webhook du dashboard Stripe sur cette même
version.**

### Rattachement manuel (DEV)

`POST /api/invoices/attach` — le DEV colle un lien Stripe (facture hébergée ou
dashboard) ou un identifiant `in_…`. La facture est **lue** chez Stripe puis
reflétée : montants, statut, dates, numéro, PDF, lien hébergé et contrat en sont
**dérivés**. Seul champ saisi : `label` (nom libre). Rien n'est créé chez Stripe.
`label` et `addedManually` survivent aux synchronisations ultérieures.

## 3. Webhooks traités

| Événement | Effet |
|---|---|
| `invoice.finalized` | miroir de la facture (numéro + PDF dès l'émission) |
| `invoice.paid` | miroir `PAID` ; si abonnement → paiement de cycle + éventuelle sortie de `PAST_DUE` |
| `invoice.payment_failed` | miroir + (abonnement) `PAST_DUE`, **site maintenu actif** (cf. [STRIPE_SUBSCRIPTION_FLOW.md](./STRIPE_SUBSCRIPTION_FLOW.md) §impayé) |

Idempotents (`WebhookEvent`), secret par **mode actif**. Un événement sans contrat
répond **2xx** (facture reflétée sans rattachement).

## 4. Historique dans le Manager

Page **Factures** ([FacturesPage](../manager/src/pages/FacturesPage.tsx)) : par
contrat, l'**historique des paiements** (`Payment` : frais + cycles) et l'**historique
des factures Stripe** (numéro, type, statut, montant TTC, **« Voir »** = hosted
invoice, **« PDF »** = téléchargement du PDF Stripe). ADMIN = ses contrats ; DEV =
vue globale + bouton **« Synchroniser »** (backfill par contrat).

## 5. Endpoints & réconciliation

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/my-invoices` | ADMIN — historique de ses contrats (paiements + factures) |
| GET | `/api/invoices` | DEV — vue globale |
| GET | `/api/invoices/:id` | Détail (DEV global ; ADMIN son contrat) |
| POST | `/api/contracts/:id/sync-invoices` | DEV — backfill des factures Stripe du contrat |

Backfill : `npm run invoices:sync` (tous les contrats ayant un Customer) — liste les
factures Stripe (`invoices.list`) et met à jour le miroir. **Idempotent**, ne crée
aucune facture côté Stripe, rapport **sans secret**. La réconciliation globale
(`/contracts/:id/sync`, `subscriptions:sync`) rafraîchit aussi les factures.

## 6. Sécurité & limites

Aucun secret exposé ; les liens PDF/hosted sont ceux **hébergés par Stripe** (pas de
donnée bancaire stockée) ; contrôle des rôles ; montants en centimes. **Hors
périmètre** : facturation électronique / conformité, génération de PDF maison, avoirs,
relances email (Brevo), Stripe Tax. La TVA reste **portée par le contrat** (le `Price`
est au montant TTC — cf. [STRIPE_SUBSCRIPTION_FLOW.md](./STRIPE_SUBSCRIPTION_FLOW.md) §4).

## 7. Tests

`npm run test:billing` ([billing-flow.test.js](../backend/src/scripts/billing-flow.test.js),
26 assertions, provider simulé) : facture des frais via `invoice_creation`, factures
de cycle résolues par abonnement/client, liens hosted/PDF, idempotence, impayé,
backfill, contrôle d'accès, facture orpheline.
