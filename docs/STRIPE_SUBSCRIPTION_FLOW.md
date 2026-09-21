# Abonnement Stripe — activation, résiliation, fin de contrat

Abonnement **mensuel récurrent** via Stripe Checkout (`mode: subscription`), puis
activation finale du site, résiliation en fin de période et suspension automatique
à la fin effective. Toute la couche Stripe passe par IntegratedAPI (mode actif +
base URL configurable). Ce lot ne branche NI Brevo, NI les pages de factures, NI
les relances email, NI une politique d'impayé configurable avancée.

Parcours cible :

```
Contrat signé (2 parties)
→ frais de lancement payés OU non requis
→ « Activer l'abonnement » → Stripe Checkout (subscription)
→ abonnement confirmé ACTIF par WEBHOOK (jamais par redirection)
→ récapitulatif → « Activer mon site » (action ADMIN explicite)
→ contrat ACTIVE → site actif

Puis : « Résilier » → cancel_at_period_end → contrat CANCEL_AT_PERIOD_END
→ site actif jusqu'à currentPeriodEnd → fin réelle (Stripe) → contrat ENDED
→ site suspendu automatiquement.
```

## 1. Conditions d'accès (contrôle backend)

`subscriptionPayableIssues` ([subscription.service.js](../backend/src/services/subscription.service.js)) —
l'abonnement ne peut être souscrit que si : contrat **entièrement signé** ; **frais
de lancement payés** (s'ils sont requis) ; abonnement **configuré et > 0** ; pas
déjà **actif** ; **Stripe actif configuré + vérifié** (`assertProviderReady`).

Erreur structurée : `{ success:false, code:"SUBSCRIPTION_NOT_PAYABLE", details:{ missing:[...] } }`
(codes : `CONTRACT_NOT_FULLY_SIGNED`, `LAUNCH_FEE_NOT_PAID`,
`SUBSCRIPTION_NOT_CONFIGURED`, `SUBSCRIPTION_ALREADY_ACTIVE`). Si l'abonnement n'est
pas requis, l'étape est **NOT_REQUIRED** (automatiquement validée).

## 2. Modèle & statuts (projection)

`contract.stripe.subscription` (projection lisible ; source de vérité = Stripe) :
`status`, `subscriptionId`, `customerId`, `productId`, `priceId`,
`priceContractVersion`, `latestInvoiceId`, `currentPeriodStart/End`,
`cancelAtPeriodEnd`, `cancelledAt`, `endedAt`, `lastError { code, message, at }`.

Statuts (`SUBSCRIPTION_STATUS`) : `NOT_REQUIRED · PENDING · CHECKOUT_CREATED ·
INCOMPLETE · TRIALING · ACTIVE · PAST_DUE · UNPAID · PAUSED · CANCEL_AT_PERIOD_END ·
CANCELLED · ENDED · FAILED`. Statuts **conférant l'accès** (entitlement) : `ACTIVE`,
`TRIALING`, `CANCEL_AT_PERIOD_END`. Terminaux : `CANCELLED`, `ENDED`, `FAILED`.

Le **journal financier** des paiements de cycle reste le modèle `Payment`
(type `SUBSCRIPTION`, une ligne par `invoice`) — pas de modèle séparé.

## 3. Product / Price Stripe — IMMUABLES par version

Stratégie : pour chaque **version de contrat**, un `Product` + un `Price` Stripe
**immuables** sont créés (idempotents via clé `product|price-<id>-v<version>-<mode>`)
avec metadata `contractId`, `contractReference`, `providerMode`,
`applicationEnvironment`, `contractVersion`. Le Price d'un contrat verrouillé **n'est
jamais modifié** ; un changement de montant (nouvelle version) crée un **nouveau
Price**. Le montant verrouillé du contrat fait foi.

## 4. TVA

Stripe Tax **n'est pas activé** en V1 : le `Price` Stripe est créé directement au
**montant TTC contractuel** (`unit_amount`). Le détail **HT / TVA / TTC** reste
porté par le contrat (et les futurs snapshots de facture). Aucune gestion fiscale
automatique Stripe n'est prétendue.

## 5. Mapping des statuts (centralisé, testé)

`mapSubscriptionStatus(stripeStatus, { cancelAtPeriodEnd })`
([stripe.service.js](../backend/src/services/stripe/stripe.service.js)) :
`trialing→TRIALING` · `active→ACTIVE` (ou `CANCEL_AT_PERIOD_END` si résilié) ·
`past_due→PAST_DUE` · `unpaid→UNPAID` · `paused→PAUSED` · `incomplete→INCOMPLETE` ·
`incomplete_expired→FAILED` · `canceled→ENDED`. Aucun mapping dispersé dans les
contrôleurs.

## 6. Création du Checkout

`POST /api/my-contract/create-subscription-checkout` (ADMIN). Backend : gate →
`assertProviderReady('STRIPE')` → `beginActivation` (INACTIVE→ACTIVATION_IN_PROGRESS)
→ Customer (créé/réutilisé) → Product + Price immuables → Checkout Session
`mode: subscription` avec `line_items: [{ price, quantity: 1 }]`, metadata
(`contractId`, `paymentType=SUBSCRIPTION`, `providerMode`, `applicationEnvironment`,
`contractVersion`) sur session + subscription, clé d'idempotence
`checkout-sub-<id>-v<version>-<mode>`. Statut projeté `CHECKOUT_CREATED`. Renvoie
uniquement l'URL. Réutilisation d'une session ouverte (anti double-clic).

## 7. URLs de retour & page Manager

URLs construites **côté backend** depuis `SystemConfiguration.network.managerUrl` :
`…/contrat/retour-abonnement?status=success&session_id={CHECKOUT_SESSION_ID}`.
La page [ContractReturnPage](../manager/src/pages/ContractReturnPage.tsx) **n'affirme
jamais** l'abonnement sur la foi de l'URL : elle interroge
`GET /my-contract/subscription-status`, polle (2 s / ~30 s) puis « Vérifier à
nouveau ». États : actif, en cours de confirmation, incomplet, échoué, interrompu.

`GET /api/my-contract/subscription-status` → `{ status, currentPeriodStart/End,
cancelAtPeriodEnd, lastError, amount { excludingTax, tax, includingTax, currency,
interval } }` (aucun secret).

## 8. Activation finale (action ADMIN explicite)

Le site **ne s'active jamais** automatiquement au webhook. Quand tout est satisfait
(signé + frais OK + abonnement entitlé), l'ADMIN voit « Activer mon site ».
`POST /api/my-contract/activate` **revérifie toutes les conditions** backend
(`canActivate`), garantit l'**unicité** du contrat vivant, passe `ACTIVE`,
enregistre `activatedAt/By`, journalise, puis **réconcilie le site**. Un double clic
ne duplique rien (le contrat n'est plus activable). L'entitlement contractuel et la
suspension technique se composent (voir [SITE_CONTRACT_ENTITLEMENT.md](./SITE_CONTRACT_ENTITLEMENT.md)).

## 9. Webhooks Stripe

| Événement | Effet |
|---|---|
| `checkout.session.completed` (subscription) | récupère le **statut réel** de la Subscription (jamais actif d'office) |
| `customer.subscription.created/updated` | projection (statut, période, `cancel_at_period_end`, `latest_invoice`) |
| `customer.subscription.deleted` | fin effective → abonnement `ENDED`, contrat `ENDED`, **site suspendu** |
| `invoice.paid` | Payment de cycle + `SUBSCRIPTION_PAYMENT_SUCCEEDED` (+ récupération PAST_DUE→ACTIVE) |
| `invoice.payment_failed` | abonnement `PAST_DUE`, alerte, **site maintenu actif** |

Idempotents (`WebhookEvent`, unique `provider+event_id`) ; secret par **mode actif**
(repli contrôlé, acquitté-mais-ignoré si mode ≠ actif) ; événement authentique sans
contrat → **2xx** ; signature invalide → **400**.

## 10. Politique impayé (V1)

`invoice.payment_failed` → abonnement `PAST_DUE`, **le site reste actif** tant que
Stripe considère l'abonnement récupérable (Stripe gère ses propres relances — aucun
délai de grâce maison). La **suspension** ne survient qu'à la **fin effective**
(`unpaid`/`canceled`/`deleted` — statut terminal confirmé). `CONTRACT_PAYMENT_GRACE_DAYS`
n'est pas utilisé.

## 11. Résiliation & fin effective

**Deux portes, un seul état.** Le client peut résilier depuis le Manager *ou*
depuis le portail Stripe. Les deux convergent vers exactement le même contrat —
il n'existe pas de chemin « portail » à part.

- **Manager** — **ADMIN** : `POST /api/my-contract/cancel`, **DEV** :
  `POST /api/contracts/:id/cancel`. Appelle Stripe `cancel_at_period_end=true`,
  passe le contrat `CANCEL_AT_PERIOD_END`, **garde le site actif** jusqu'à
  `currentPeriodEnd`, journalise. Confirmation explicite (modal).
- **Portail Stripe** — le client clique « Annuler l'abonnement ». Aucun appel ne
  nous parvient : c'est `customer.subscription.updated` qui porte le fait, et
  `settleFromSubscription` fait converger le contrat. **Le navigateur n'est
  jamais l'autorité** : fermer l'onglet avant le retour ne change rien.
- **Fin effective** (`customer.subscription.deleted`) : abonnement `ENDED`,
  `endedAt`, contrat `ENDED`, entitlement retiré, **site suspendu
  automatiquement**, timeline + audit. Le webhook fait foi, avec la
  réconciliation en filet de sécurité.

### `cancel_at_period_end = true` **≠** contrat terminé

C'est la distinction qui porte tout le parcours, et elle a longtemps manqué :

| Stripe | Abonnement | Contrat | Site |
|---|---|---|---|
| `active`, `cancel_at_period_end: false` | `ACTIVE` | `ACTIVE` | servi |
| `active`, `cancel_at_period_end: true` | `CANCEL_AT_PERIOD_END` | **`CANCEL_AT_PERIOD_END`** | **servi** |
| `active`, retour à `false` | `ACTIVE` | **`ACTIVE`** | servi |
| `canceled` / `deleted` | `ENDED` | `ENDED` | **suspendu** |

`CANCEL_AT_PERIOD_END` figure dans `LIVE_CONTRACT_STATUSES` et dans
`SUBSCRIPTION_ENTITLED_STATUSES` : **la période est payée, elle est servie
jusqu'à son terme.** Seul `ENDED` retire l'entitlement.

**Le défaut corrigé** : le contrat restait `ACTIVE` quand Stripe avait planifié
l'arrêt. Le Manager affichait « Actif », et personne — client comme exploitant —
ne pouvait le savoir avant l'échéance. `reconciliation.service.js` signalait
pourtant l'écart sous le nom `CANCELLATION_REQUESTED_NOT_REFLECTED`, sans que
rien ne le corrige. La convergence vit désormais dans `settleFromSubscription`,
à la source.

### Annuler une résiliation programmée

Le portail permet de revenir en arrière. `cancel_at_period_end` repasse à
`false`, l'abonnement redevient `ACTIVE`, et le contrat **reprend** (`ACTIVE`) —
la transition `CANCEL_AT_PERIOD_END → ACTIVE` est déclarée pour cela. Deux
lignes distinctes au journal : `CANCELLATION_REQUESTED` puis
`CANCELLATION_REVOKED`. Le dossier doit pouvoir raconter qu'un client a résilié
**puis s'est ravisé** ; une seule ligne laisserait croire que la première n'a
jamais eu lieu.

### Ordre des événements

La convergence ne suit que les observations **retenues** par
`projectSubscription`, qui compare l'instant de PRODUCTION chez le fournisseur
(`evt.created`), jamais l'ordre de réception. Un `updated(cancel=true)` produit
avant un `updated(cancel=false)` mais livré après ne reprogramme donc rien — et
aucun événement ne réactive un contrat `ENDED`, qui est terminal.

### Un impayé n'est pas une résiliation

`past_due`, `unpaid`, `incomplete`, `paused` décrivent un **paiement** en
difficulté, pas une volonté de partir. Ils ne déclenchent aucune transition de
résiliation : leur parcours reste celui des impayés (incident, délai de grâce,
suspension, régularisation) — voir §10.

## 11 bis. Le portail client Stripe — self-service FINANCIER

Le portail est ouvert par le Panel (`billing.portal.create`), qui **désigne
explicitement sa propre configuration**. Il ne laisse jamais Stripe retomber sur
celle du compte — celle-ci autorisait l'édition de `name, email, address, phone`,
c'est-à-dire l'identité juridique que le Panel détient.

| Le portail PEUT | Le portail NE PEUT PAS |
|---|---|
| changer / ajouter un moyen de paiement | modifier la raison sociale, l'adresse, l'e-mail, le téléphone |
| consulter et télécharger les factures | modifier un numéro de TVA / Tax ID |
| payer une facture impayée | changer de Price, de plan, de quantité, de périodicité |
| résilier, **à l'échéance** | appliquer un code promo |

**Autorités** — aucune double autorité silencieuse :

```
PanelClientCompany   identité juridique (raison sociale, SIREN, TVA, adresses,
                     e-mail de facturation, signataire)   ──▶  Stripe Customer
Stripe PaymentMethod moyen de paiement (autorité technique)
Stripe Subscription  état réel de la souscription
Contract SB Auto     état contractuel, convergent avec Stripe
```

La flèche ne s'inverse jamais : `customer.updated` n'est **pas souscrit**, et
aucun chemin de réception Stripe n'atteint la fiche cliente. Un contrôle
d'architecture le vérifie côté Panel.

## 11 ter. Reprise après incident — une ligne qui existe n'est pas un travail fait

### Le défaut, et il ne se voyait nulle part

`WebhookEvent` servait de verrou par son index unique : la ligne était écrite en
`PENDING` **avant** le traitement, et le refus `E11000` d'un rejeu valait
« doublon ».

```
webhook  →  ligne PENDING écrite  →  CRASH du process
         →  Stripe rejoue         →  E11000  →  « doublon », HTTP 200
         →  l'effet métier n'existera JAMAIS
```

La protection contre le rejeu était parfaite ; le rattrapage après incident
était nul. Un `customer.subscription.deleted` perdu ainsi laisse un contrat
`ACTIVE` sur un abonnement qui n'existe plus, et **un site servi qui ne devrait
plus l'être** — sans que rien ne le signale.

    L'EXISTENCE D'UNE LIGNE N'EST PAS LA PREUVE D'UN TRAITEMENT.

### La machine d'état

```
           ┌──────────── réclamation atomique ────────────┐
           ▼                                              │
PENDING ──────────▶ PROCESSING (sous bail) ──────▶ PROCESSED    terminal
(hérité)                   │              ──────▶ IGNORED      terminal
                           │              ──────▶ FAILED       reprenable
                           │              ──────▶ DEAD_LETTER  terminal, supervisé
                           │
                           └── bail EXPIRÉ ──▶ reprenable
```

Une ligne **naît `PROCESSING`** : il n'existe aucune fenêtre où elle existe sans
bail. `PENDING` ne subsiste que pour les documents antérieurs à ce lot, et pour
ceux que le balayage d'amorçage remet en file.

| état | un rejeu fait quoi ? |
|---|---|
| `PROCESSED` | rien — **le seul doublon terminal** |
| `IGNORED` | rien — il n'y avait rien à faire (mode inactif, hors périmètre) |
| `DEAD_LETTER` | rien — on a renoncé, et on l'a dit |
| `PROCESSING`, bail **valide** | rien — un autre processus travaille |
| `PROCESSING`, bail **expiré** | **reprend** |
| `PENDING` ancien | **reprend** |
| `FAILED` reprenable | **reprend** |

### Le bail

```
leaseOwner          hôte:pid:NONCE-DE-DÉMARRAGE
processingStartedAt depuis quand
leaseExpiresAt      au-delà, le travail est réputé ABANDONNÉ
processingAttempts  nombre de RÉCLAMATIONS, jamais de livraisons
lastError           code · retryable · instant
```

Le **nonce de démarrage** est ce qui distingue un processus de son propre
fantôme : un processus redémarré peut réutiliser un pid sur le même hôte.

**Aucun verrou mémoire** : la réclamation est une écriture conditionnelle en
base (`findOneAndUpdate` filtré sur l'état), sûre entre processus. Un `Set` de
clés en cours n'aurait protégé qu'à l'intérieur d'un processus tout en donnant
l'illusion d'une garantie.

La conclusion est gardée par `leaseOwner` : un traitement qui a dépassé son bail
et dont l'événement a été repris ailleurs **n'écrit rien**.

### Les seuils

| réglage | défaut | variable |
|---|---|---|
| durée du bail | 120 s | `WEBHOOK_LEASE_TTL_MS` |
| âge d'un `PENDING` réputé abandonné | 120 s | `WEBHOOK_STALE_PENDING_MS` |
| tentatives avant `DEAD_LETTER` | 5 | `WEBHOOK_MAX_ATTEMPTS` |

Un `invoice.paid` légitime enchaîne la résolution du contrat, la projection de
l'abonnement, l'archivage de la facture et la réconciliation du statut du site :
quelques écritures Mongo et, au plus, un aller-retour de capacité vers le Panel
(mesuré entre 150 et 250 ms). 120 s est donc deux ordres de grandeur au-dessus
du pire cas observé, et bien en dessous du premier rejeu utile de Stripe.

### Reprenable ou terminal

Une seule question : **une nouvelle tentative a-t-elle une chance de donner un
résultat différent ?**

| REPRENABLE | TERMINAL |
|---|---|
| panne de base, Panel injoignable | corps illisible, signature refusée |
| délai dépassé, redémarrage | contrat introuvable, ressource non possédée |
| **erreur inconnue** (défaut) | schéma incompatible |

Le défaut est « reprenable », délibérément : se tromper vers la reprise coûte
quelques tentatives et finit en `DEAD_LETTER` supervisé ; se tromper vers le
terminal perd un fait contractuel en silence.

### La reprise au démarrage — et ce qu'elle ne prétend pas faire

Deux filets :

1. **le rejeu de Stripe** — un processus tué n'a répondu à personne, Stripe voit
   un échec et rejoue. C'est le filet principal, il est gratuit, il apporte le
   corps de l'événement, et il couvre le cas nominal du crash ;
2. **le balayage d'amorçage** (`runStructuralRecovery`, étape 6) — pour les
   événements que Stripe ne rejouera pas.

Le balayage **ne rejoue pas l'événement lui-même**, et c'est honnête : il n'en a
pas le corps — `WebhookEvent` ne conserve que le type et l'identifiant — et les
clés Stripe appartiennent au Panel, pas au projet. Fabriquer ici un chemin
d'appel vers Stripe donnerait au projet une autorité que toute l'architecture
lui refuse.

Il fait donc ce qu'il peut faire :

- il **remet en file** les événements abandonnés (bail retiré, `PENDING`,
  compteur de tentatives conservé) pour que le prochain rejeu les applique au
  lieu d'être éconduit ;
- il déclenche **une fois** la réconciliation, qui relit l'état réel chez le
  fournisseur et fait converger les contrats — c'est le filet déjà écrit pour
  cela, et il rattrape précisément le `subscription.deleted` dont le corps est
  perdu ;
- il **abandonne explicitement** ceux qui ont épuisé leurs tentatives, plutôt
  que de les laisser tourner en boucle à chaque démarrage.

**Avant tout worker.** Les services de fond lisent l'état contractuel :
l'ordonnanceur du pont le projette vers le Panel, la veille des impayés décide
de fermer un site. Les laisser partir avant cette reprise leur ferait propager,
puis agir sur, un état que l'amorçage doit encore réparer. C'est aussi pourquoi
la reprise périodique des actions d'événements a quitté la phase 1 pour la
phase 2.

La réconciliation **signale et fait converger l'état** ; elle n'est pas une
seconde machine d'application. Le `WebhookEvent` reste l'unité de travail.

### La barrière finale reste l'idempotence métier

Le bail réduit les retraitements ; il ne les supprime pas. Une reprise rejoue
par construction ce qui a peut-être déjà été appliqué. La dernière ligne de
défense n'est donc pas l'ordonnancement, mais les identités contraintes en base
— paiement, facture, transition de contrat — qui refusent le second exemplaire.

### Ce que l'audit d'idempotence a trouvé au passage

L'audit demandé par le lot — « un retraitement crée-t-il une seconde
transaction ? » — a répondu non : `markInvoicePaid` cherche le paiement par
`externalInvoiceId` avant de le créer. Mais il a montré deux trous voisins, et
tous deux avaient déjà produit un fait faux en base.

**1. Zéro est un montant, pas une absence.**

```js
amountIncludingTax: invoice.amount_paid || invoice.total || sub.amountIncludingTax
```

Les deux premiers termes sont **faux** quand la facture vaut zéro — période
d'essai, coupon à 100 %, avoir de proratisation. Le repli s'appliquait, et le
paiement était enregistré **au prix du contrat**. Mesuré en base :

```
Stripe   in_1U7KPu…   amount_paid = 0
SB Auto  paiement     1 007,86 € TTC · PAID
```

De l'argent jamais encaissé, inscrit au dossier d'un client. C'est la doctrine
financière prise en défaut dans un coin : **le montant vient du fournisseur**,
jamais d'une formule tarifaire ni d'un instantané contractuel. `??` distingue
désormais « absent » de « zéro », le dernier repli est `0`, et la ventilation
HT/TVA n'est reprise du contrat que si le montant encaissé est bien celui du
contrat — sinon les trois lignes ne s'additionneraient pas.

**2. Une facture qui nomme un autre abonnement n'est pas à nous.**

`resolveContractForInvoice` retombait sur le CLIENT quand aucun contrat ne
portait l'abonnement nommé. Ce repli existe pour les factures qui ne nomment
**aucun** abonnement — une prestation ponctuelle dont le lien n'est pas encore
écrit. Appliqué ici, il désignait le seul contrat du client : c'est ainsi qu'un
abonnement de recette, créé sur le même client Stripe, a fait naître un
paiement fantôme sur le contrat de démonstration. Deux abonnements chez un même
client suffisent — rien d'exotique.

La facture est désormais **non attribuée**, et le refus est journalisé.

### La supervision

Un abandon silencieux serait le même défaut sous un autre nom. `DEAD_LETTER`
s'accompagne d'un journal `error` nommant l'événement, son type, son compte de
tentatives et sa cause. Ni corps, ni secret.

## 11 quater. Ce que le Panel garantit jusqu'à l'ACCUSÉ du projet

### Deux accusés, et ils ne disent pas la même chose

```
Stripe  ──webhook──▶  Panel   ──200──▶  Stripe      « je prends la responsabilité »
                        │
                        ▼
                 fait canonique durable (journal ordonné)
                        │
                        ▼
Panel   ──livraison──▶  CE PROJET  ──curseur──▶  Panel   « je l'ai appliqué »
```

**Le 200 rendu à Stripe ne signifie pas que ce projet a appliqué quoi que ce
soit.** Il signifie que le Panel a pris le fait en charge. Entre les deux, le
Panel reste responsable : projet éteint, réseau coupé, redémarrage — l'écriture
est au journal et y reste.

### Le curseur est notre accusé, et il ne ment plus

Ce projet tire les écritures du journal du Panel par pages, applique, et
persiste sa position. Il la déclare au Panel à chaque battement ; le Panel en
déduit son retard.

Le curseur était écrit **à la fin de chaque page, quoi qu'il arrive**. Une
écriture dont l'applicateur échouait était comptée `skipped`, un incident était
journalisé, et le curseur passait par-dessus : l'écriture ne serait jamais
relivrée, et le Panel — qui lit ce curseur — voyait un retard nul.

Désormais :

| situation | curseur |
|---|---|
| écriture appliquée | avance |
| écriture déjà appliquée (fenêtre d'idempotence) | avance |
| aucun applicateur pour ce type | avance |
| **application en échec** | **RETENU** — la page est retirée au cycle suivant |
| écriture garée (plafond atteint) | avance, et le renoncement est déclaré |

### La lettre morte — renoncer sans perdre en silence

Une écriture qu'aucune tentative ne passera bloquerait le flux à vie, et tout ce
qui la suit avec elle. Après `BRIDGE_MAX_APPLY_ATTEMPTS` (5 par défaut), elle
est **garée** : type, identifiant, `writeId`, motif, tentatives, date —
**jamais la charge utile**. Le curseur repart.

Le compteur d'échecs est **durable**. En mémoire, il se remettrait à zéro à
chaque redémarrage : une écriture toxique n'atteindrait jamais le plafond et
bloquerait la synchronisation à vie.

Une écriture **illisible** (non conforme au contrat de pont) est garée
immédiatement : aucune tentative ne la rendra conforme.

Une écriture garée est passée SOUS le curseur — le calcul de retard du Panel ne
la verra plus jamais. Le battement déclare donc son compte
(`consumption.parkedChanges`, contrat 1.12.0), et le Panel en fait un signal de
supervision : seuil **1**, parce qu'un renoncement n'a aucun état normal.

### Le bail de consommation — un seul consommateur à la fois

Le curseur dit **jusqu'où** ce projet a appliqué. Il ne dit pas **qui**
consomme, et cette question n'était pas posée : « mono-consommateur par
construction » décrivait la configuration, pas le code. Le magasin de
consommation est un cache mémoire par processus, sauvegardé en écrasant le
document entier — deux runtimes sur la même base, et le dernier qui écrit gagne.

```
réclamation atomique  →  1 consumer actif  →  pull / apply / curseur
                                           →  renouvellement pendant le travail
                                           →  release, ou EXPIRATION
```

| | rôle |
|---|---|
| `leaseOwner` | qui a le droit de consommer maintenant |
| `pullCursor` | jusqu'où le projet a réellement appliqué — l'accusé |

Les deux vivent dans le même document et **ne se touchent jamais** : rendre le
bail n'efface pas le curseur.

**Toute écriture d'état est conditionnée à la possession, en base** — curseur,
compteurs d'échec, lettres mortes. C'est le cas du propriétaire **périmé** qui
l'impose : A ralentit, son bail expire, B reprend, et A finit sans savoir qu'il
a perdu. S'il pouvait écrire, il effacerait le travail de B et acquitterait des
écritures que personne n'a appliquées.

La condition s'applique dès qu'un runtime a **tenté** une réclamation — gagnée
ou perdue. Le perdant n'a pas de bail ; si seuls les titulaires étaient
conditionnés, il écrirait sans condition. Un runtime qui n'a jamais réclamé
écrit librement, et le comportement mono-processus reste intact.

Réglages : `BRIDGE_CONSUMER_LEASE_TTL_MS` (45 s), renouvellement au tiers.
L'arrêt propre rend le bail ; la **sûreté**, elle, repose sur l'expiration —
un `kill -9` ne rend rien.

### Rejouer une écriture garée

Une écriture garée y restait pour toujours. Le Panel peut désormais la
**republier** : il relit le fait canonique dans son journal et le réémet sous
une nouvelle séquence et un nouveau `writeId`.

Ce projet le consomme par le **pipeline normal** — même tirage, mêmes
applicateurs, même idempotence. Il ne sait pas qu'il s'agit d'un rejeu, et c'est
voulu : un chemin spécial ne prouverait rien.

Quand l'écriture s'applique enfin, ce projet **résout lui-même** la lettre morte
correspondante, par identité métier `(entityType, entityId)` — « ce qui était
bloqué sur cette entité est passé ». Elle passe en `RESOLVED`, datée, nommant la
republication qui l'a débloquée, et **ne disparaît pas** : seules les `PARKED`
comptent dans `parkedChanges`.

`GET /api/project-bridge/v1/dead-letters` (contrat 1.13.0) publie la liste au
Panel — lecture seule, sans charge utile. Le battement ne porte qu'un compte :
de quoi alerter, jamais de quoi agir.

#### Le cycle de vie du rejeu ne concerne PAS ce projet

Un rejeu naît `REPUBLISHED`, passe `ACKNOWLEDGED` quand le curseur déclaré au
battement dépasse sa nouvelle séquence, et `STALLED` s'il n'est jamais consommé.
Ces trois états vivent **entièrement côté Panel** : ce projet ne les connaît pas,
ne les reçoit pas, et le contrat de pont — `.strict()` des deux côtés — n'en
porte rien. Il reste à **1.13.0**.

Ce qui est demandé à ce projet est exactement ce qu'il faisait déjà : tirer,
appliquer, avancer son curseur, résoudre la lettre morte par identité métier.
**Le curseur qu'il déclare EST l'accusé de réception** — c'est de lui que le
Panel déduit qu'un rejeu est arrivé, sans jamais lui demander de le dire.

Corollaire à ne pas perdre de vue : un projet ÉTEINT ne déclare plus rien. Le
Panel ne peut donc pas apprendre de lui que son rejeu n'arrive pas — l'absence
ne voyage sur aucun canal. C'est pourquoi le constat d'enlisement y est un
veilleur autonome, et non une conséquence du battement.

### Ce projet ne détient aucune clé Stripe

Ni identifiant, ni autorité fournisseur, ni droit de relire Stripe. Il reçoit un
**fait canonique métier**, jamais la charge utile brute d'un webhook. C'est
pourquoi la reprise d'un événement abandonné appartient au Panel : c'est lui qui
détient la clé, et lui seul qui peut relire l'événement à la source.

### Livraison d'événement ≠ synchronisation complète

Les deux existent et se complètent :

- **la livraison d'un fait** est précise et durable — elle porte un événement
  daté, qui a eu lieu ;
- **la synchronisation** reconstruit l'état courant — elle répare une
  projection, elle ne raconte pas l'histoire.

Une synchronisation complète peut réparer un état ; elle n'est jamais la
justification pour perdre un événement. Et un événement perdu ne doit jamais
exiger une synchronisation manuelle.

## 12. Réconciliation

Voir [SUBSCRIPTION_RECONCILIATION.md](./SUBSCRIPTION_RECONCILIATION.md) :
`npm run subscriptions:sync`, `POST /api/contracts/:id/sync-subscription` (DEV),
`npm run contracts:verify-entitlements`.

## 13. Sécurité

Aucun montant ni URL de retour du frontend ; aucune clé Stripe exposée ; aucune
donnée bancaire stockée ; aucune confiance dans la redirection ; webhook signé ;
idempotence ; rôles (ADMIN = son contrat, DEV = global) ; erreurs Stripe
normalisées ; logs sans payload sensible.

## 14. Tests

`npm run test:subscriptions` ([subscription-flow.test.js](../backend/src/scripts/subscription-flow.test.js),
56 assertions, provider simulé, **aucun appel réel**) : gate, checkout
(Product/Price/metadata/idempotence/double clic), webhooks (statuts, invoice, fin
effective), activation explicite, unicité, suspension technique indépendante,
résiliation ADMIN/DEV, réconciliation idempotente, entitlements.

[webhook-crash-recovery.test.js](../backend/src/scripts/webhook-crash-recovery.test.js)
— la reprise après incident, sur une **vraie base** (Mongo en mémoire) et de
vraies écritures concurrentes : une recette qui simulerait la base ne prouverait
rien du seul point qui compte, à savoir que la réclamation est atomique.
Couvre : événement neuf, doublon terminal, `PENDING` ancien repris, bail valide
respecté, bail expiré repris, crash **avant** l'effet, crash **après** l'effet,
panne reprenable, erreur terminale, événement toxique jusqu'au plafond, huit
processus concurrents (1 seul claim), balayage d'amorçage.

Sandbox TEST réel : `npm run stripe:test:subscription -- <contractId>` (refuse hors
mode TEST, contrat de test, aucun paiement réel, aucun secret affiché).

## 15. Endpoints (récapitulatif)

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/api/my-contract/create-subscription-checkout` | ADMIN — créer/réutiliser la souscription |
| GET | `/api/my-contract/subscription-status` | ADMIN — statut abonnement (sans secret) |
| POST | `/api/my-contract/activate` | ADMIN — activation finale du site |
| POST | `/api/my-contract/cancel` · `/api/contracts/:id/cancel` | ADMIN / DEV — résiliation fin de période |
| POST | `/api/contracts/:id/sync-subscription` | DEV — réconciliation abonnement + site |
| POST | `/api/webhooks/stripe` | Webhook signé + idempotent |

## 16. Limites & recette Yousign réelle

Les clés Yousign Sandbox réelles ne sont pas encore renseignées : toute la couche
Yousign passe par le provider et les **mocks** en test. **Une recette Sandbox
Yousign complète reste OBLIGATOIRE avant commercialisation** — elle n'est pas
validée ici. Non implémentés (lots ultérieurs) : Brevo, pages de factures, relances
email, politique d'impayé configurable avancée.
