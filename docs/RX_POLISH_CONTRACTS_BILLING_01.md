# RX-POLISH-CONTRACTS-BILLING-01 — rapport

Correction des défauts UX et des incohérences du module Contrats / Facturation.
Aucun nouveau système métier : corrections, cohérence, tests.

## 1. Le bug des deux « Frais de lancement »

### Ce n'était pas un problème d'affichage

La seconde facture était **réellement stockée** avec `type: LAUNCH_FEE`. La base
le disait déjà — et personne ne lisait la preuve :

```
ZOHWSRQN-0001  type=LAUNCH_FEE  billingReason=manual              ← juste
ZOHWSRQN-0002  type=LAUNCH_FEE  billingReason=subscription_create ← faux
```

`snapshot.billingReason` était capturé depuis le début… et **jamais relu par
quoi que ce soit**.

### Cause racine

`invoiceType()` typait une facture par `stripeInvoice.subscription`. Deux causes
se cumulent :

1. **Aucune metadata.** Les frais de lancement posent `paymentType` via
   `invoice_creation.invoice_data.metadata`. L'abonnement, lui, pose ses metadata
   sur la **Subscription** (`subscription_data.metadata`) — Stripe **ne les
   recopie pas** sur les factures générées. Les deux premiers tests de
   `invoiceType` échouaient donc systématiquement.
2. **Le champ avait disparu.** `invoice.subscription` (racine) a été **retiré**
   en API **`2025-03-31.basil`**, déplacé sous
   `invoice.parent.subscription_details.subscription`. Le SDK est épinglé sur
   `2025-02-24.acacia` pour les appels **sortants**, mais un webhook arrive dans
   la version **du compte** : les deux avaient divergé.

Résultat : la fonction tombait sur son défaut, `LAUNCH_FEE`.

### La conséquence grave (au-delà du libellé)

`handleInvoiceEvent` utilise **la même fonction** pour décider si une facture
concerne l'abonnement :

```js
const isSubscription = billingSvc.invoiceType(obj) === PAYMENT_TYPE.SUBSCRIPTION;
if (contract && isSubscription) {
  if (type === 'invoice.paid') await subscriptionSvc.markInvoicePaid(...);
  else if (type === 'invoice.payment_failed') await subscriptionSvc.markInvoiceFailed(...);
}
```

Typée `LAUNCH_FEE`, une facture de cycle ne déclenchait donc **plus rien** :

- aucun `Payment` de cycle enregistré ;
- `latestInvoiceId` et `currentPeriodEnd` figés ;
- un impayé ne passait plus en `PAST_DUE`, et un contrat `PAST_DUE` ne pouvait
  plus redevenir `ACTIVE` — **relance d'impayé silencieusement morte**.

La base le montrait : **2 factures payées, 1 seul paiement au journal**.

### Pourquoi les tests ne l'ont pas vu

Ils ne construisaient que la forme **héritée** :

```js
data: { object: { id: 'in_sub_1', …, subscription: subId } }   // acacia
```

Le champ présent, le typage tombait juste. La suite était verte pendant que la
sandbox stockait deux « Frais de lancement ».

### Correction

`billing_reason` d'abord — champ **racine**, **stable dans toutes les versions**,
et déjà désigné comme la référence par `STRIPE_BILLING.md` §1 :

```js
if (reason.startsWith('subscription')) return SUBSCRIPTION;   // *_create, *_cycle, *_update…
// manual | quote_accept | upcoming… → LAUNCH_FEE
```

- `invoiceSubscriptionId()` accepte les **deux** formes (acacia + basil) et sert
  aussi à `resolveContractForInvoice`, qui souffrait du même angle mort.
- **`STRIPE_API_VERSION` épinglée explicitement** : une montée de version devient
  une décision testable, plus une dérive silencieuse. *À aligner avec la version
  de l'endpoint webhook dans le dashboard Stripe.*

**Vérifié sur la base réelle** — les lignes existantes se réparent d'elles-mêmes
à la synchronisation (l'upsert réécrit `type`) :

```
ZOHWSRQN-0001  type=LAUNCH_FEE    billingReason=manual              ✓
ZOHWSRQN-0002  type=SUBSCRIPTION  billingReason=subscription_create ✓
```

## 2. Factures — UX

| Point | Avant | Après |
|---|---|---|
| Icônes | aucune | 🚀 frais · 🔁 abonnement · 🛠 ajout manuel · 📄 autre (Lucide + pastille) |
| Nom | « Frais de lancement » ×2 | dérivé du vrai type Stripe |
| Télécharger | lien texte discret | **CTA** couleur du thème (rendu en `<a>` : nouvel onglet / clic milieu conservés) |
| Voir | icône + texte | **œil seul**, infobulle « Voir la facture Stripe » |
| Statuts | `PAID`, `OPEN`, `VOID`… | Payée · Ouverte · Annulée · Brouillon · Impayée |
| HT / TVA | seulement sur la ligne Paiement | sur la ligne de facture |

**Prochaine facture** — carte informative tant que l'abonnement court (date,
montant HT, « Non encore générée »), sans bouton : Stripe ne l'a pas émise, il
n'y a rien à ouvrir. Elle **disparaît dès qu'une résiliation est programmée** —
annoncer une facture qui n'arrivera jamais serait un mensonge.

**Ajout manuel (DEV)** — « Ajouter une facture Stripe » : coller un lien
(hébergé ou dashboard) ou un identifiant `in_…`. Tout est **dérivé de Stripe** ;
seul champ saisi : un nom libre. Une URL hébergée **ne contient pas**
l'identifiant : elle est retrouvée par recherche bornée parmi les clients connus,
et à défaut le message demande l'identifiant plutôt que d'échouer sans dire quoi
faire. Idempotent (201 à la création, 200 si déjà connue) ; `label` et
`addedManually` survivent aux synchronisations.

## 3. Audit « Paiements » (demandé)

**Verdict : renommée + filtrée, pas supprimée.**

Ce qu'un `Payment` a de plus qu'une `Invoice` est **masqué à l'ADMIN** :
`serializePayment` retire le mode Stripe, les identifiants, `attempt`,
`lastError`, `cancelledAt`. Restait le type/date/montants/statut — et **un
paiement abouti a toujours sa facture**, donc la ligne faisait doublon.

Mais la section n'est pas inutile pour autant : **une tentative
échouée/annulée/expirée ne génère AUCUNE facture**. C'est la seule trace de
« j'ai essayé de payer et ça n'a pas marché ». La supprimer aurait fait perdre
cette information.

D'où : section **« Tentatives de paiement »**, explicitée (« elles ne génèrent
aucune facture »), limitée aux tentatives **non abouties** ; remboursements dans
leur propre bloc ; et le détail **HT · TVA**, qui n'existait que là, remonté sur
la ligne de facture. Le journal complet reste côté DEV, sur la fiche contrat.

## 4. Contrat

« Télécharger » était un lien texte au milieu de vrais boutons (« Payer »,
« Activer ») → **bouton primaire**, ADMIN et DEV. « Original » reste secondaire :
le PDF signé est le document qui compte.

## 5. Outils de recette — ENV=TEST uniquement

- **« Résilier immédiatement »** — termine le contrat comme si l'échéance venait
  d'arriver. Passe par `settleFromSubscription`, le **même chemin que le webhook
  Stripe de fin d'abonnement** : statuts, timeline, factures et suspension du
  site suivent exactement la production. L'abonnement est aussi coupé **chez
  Stripe** — sinon la réconciliation le ressusciterait et contredirait l'écran.
- **« Réinitialiser la recette »** — retour à « aucun contrat » : annulation des
  demandes Yousign et des abonnements Stripe **avant** la purge (sinon la sandbox
  accumule des orphelins), suppression contrats/paiements/factures/timeline **via
  les services**, levée de la suspension **technique**, réalignement du statut du
  site.

**Le garde-fou est dans le service** (`assertTestEnvironment` → 403), pas dans
l'interface : masquer un bouton n'empêche personne d'appeler l'API. Un test sous
`ENV=PROD` impose le refus **et** vérifie qu'aucune purge n'a eu lieu.

L'UI se fie à l'**ENV applicatif** (`/api/meta`), **jamais** à
`Contract.environment` : ce champ est figé à la création, et une base PROD
promue depuis TEST porte des contrats `TEST` — s'y fier afficherait des outils de
recette **en production**.

## 6. Suspension (analyse demandée)

Le comportement observé était **correct** : une suspension **technique** posée par
un DEV est indépendante du contrat, donc l'activation ne la lève pas — c'est
voulu ([SITE_CONTRACT_ENTITLEMENT.md](./SITE_CONTRACT_ENTITLEMENT.md)). Aucun
changement de règle. Seule la **recette** était pénible : c'est ce que
« Réinitialiser la recette » traite, en levant explicitement la suspension
technique.

## 7. Tests

| Suite | Avant | Après |
|---|---|---|
| `npm run test:billing` | 26 | **46** |
| `npm run test:subscriptions` | 56 | **73** |
| `npm run test:env-independence` | 4 | **9** |
| Backend complet | 710 | **752** |
| Manager | 111 | **136** |

Ajouté : les 9 valeurs de `billing_reason` ; les **deux** formes d'API (acacia +
basil) ; le bout en bout basil → facture typée `SUBSCRIPTION` **et** paiement de
cycle enregistré ; le refus des outils de recette en PROD (+ non-destruction) ;
fin immédiate (statuts, timeline, coupure Stripe, refus hors contrat actif) ;
purge, suspension levée, idempotence ; identité des factures et prochaine facture.

## 8. Validation

- Backend `npm test` — **exit 0**, 752 vérifications, 0 échec.
- Manager `npm test` — **exit 0**, 136 vérifications, 0 échec.
- Manager `tsc -b --noEmit` — **exit 0**. `npm run build` — **succès**.

## 9. Points laissés à la main de l'équipe

- **Endpoint webhook Stripe** : aligner sa version d'API sur `STRIPE_API_VERSION`
  dans le dashboard. Le code accepte désormais les deux formes, mais l'épinglage
  des deux côtés supprime la classe de bug entière.
- **Paiement de cycle historique manquant** : le paiement jamais enregistré (à
  cause du bug) n'est pas rétro-créé — `markInvoicePaid` n'est déclenché que par
  webhook. Les **prochains** cycles sont corrects. Un `Réinitialiser la recette`
  repart de toute façon d'une base propre.
