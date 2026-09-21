# L6.3 FINAL — LA FERMETURE

> Après L6.3C, le projet n'appelait plus Stripe. Il pouvait encore le
> **redevenir** : une clé saisissable, une route qui l'accepte, un diagnostic
> qui la lit — il ne manquait qu'un appelant.
>
> Ce lot ferme cette possibilité.

---

## L6.3 FINAL STATUS

**PASS**

---

## BASELINES / COMMITS

| Dépôt | HEAD avant | HEAD après | Arbre après |
|---|---|---|---|
| SB Auto 06 | `b42b437` | *(voir livraison)* | L10.6 seul, non stagé |
| Panel | `7e82465` | **inchangé** | L10.6 seul, non stagé |

Les deux HEAD correspondaient exactement aux baselines annoncées. **Le Panel
n'a reçu aucune modification** : ce lot est entièrement côté projet, ce qui est
cohérent avec son objet — c'est la surface locale qu'on ferme.

---

## LOCAL STRIPE SURFACE BEFORE → AFTER

| Surface | Avant | Après | Action |
|---|---|---|---|
| `STRIPE_SDK_RUNTIME_IMPORTS` | 0 | **0** | maintenu |
| `LOCAL_STRIPE_BUSINESS_CALLS` | 0 | **0** | maintenu |
| `LOCAL_STRIPE_PROVIDER_METHODS` | 0 | **0** | maintenu |
| `LOCAL_STRIPE_FALLBACKS` | 0 | **0** | maintenu |
| `LOCAL_STRIPE_API_ENDPOINT_REFERENCES` | 1 | **0** | `STRIPE_BASE_URL` supprimée |
| `LOCAL_STRIPE_CALL_SECRET_READS` | 1 | **0** | diagnostic migré |
| `LOCAL_STRIPE_CALL_SECRET_WRITES` | possible | **0** | `authority: PANEL` |
| `LOCAL_STRIPE_CREDENTIAL_FIELDS` | 2 | **0** | catalogue vidé |
| `LOCAL_STRIPE_CREDENTIAL_UI_INPUTS` | 1 | **0** | plus aucun champ rendu |
| — `whsec_` de vérification | 1 lecteur | **1 lecteur** | légitime, confiné |

Recalculés sur HEAD réel, pas repris du rapport précédent.

---

## DIAGNOSTIC / READINESS

### Ancien chemin

```
POST /api/integrated-apis/STRIPE/modes/TEST/test
  └→ providerConnectionTest.testStripe(doc, mode)
        ├─ readStoredCredential(doc, mode, 'secretKey')     ← DERNIÈRE LECTURE
        └─ GET https://api.stripe.com/v1/account            ← DERNIER APPEL
```

Il éprouvait une clé dont **plus aucun paiement ne dépendait**. Un opérateur
lisait « Connexion Stripe réussie » et en concluait que les encaissements
fonctionnaient — alors que la seule chose prouvée était qu'une clé oubliée en
base répondait encore.

### Nouveau chemin

```
POST /api/integrated-apis/STRIPE/modes/TEST/test
  └→ providerConnectionTest.testStripe()
        └→ diagnoseStripeAvailability({ invoke })
              └→ capability  billing.checkout.retrieve
                    → pont → passerelle → octroi → coffre du Panel → Stripe
```

Il éprouve la chaîne **réelle**, celle qu'emprunte un vrai paiement.

**La sonde.** La capacité est invoquée avec un identifiant de session
volontairement inexistant (`cs_diagnostic_control_plane_probe`). Ce n'est pas un
détour : c'est ce qui rend le diagnostic **sans effet** — rien n'est créé, aucun
paiement déclenché. Et une session introuvable produit un refus **différent**
d'un compte injoignable, ce qui est précisément la distinction cherchée :

- `CAPABILITY_RESOURCE_NOT_OWNED` → **DISPONIBLE.** Pour formuler ce refus, le
  Panel a authentifié le projet, résolu son monde, vérifié l'octroi, chargé son
  credential et consulté son registre. Tout ce qui bloque un vrai paiement a
  déjà été franchi.
- `resource_missing` chez le fournisseur → **DISPONIBLE.** Il a répondu.
- tout le reste → l'état correspondant, par une **table**, jamais une devinette.

### États rendus

Le vocabulaire est celui du parc — le même que le diagnostic DNS de L9.2 — pour
qu'un opérateur qui a appris à lire l'un puisse lire l'autre :

```
OK · PANEL_NOT_PAIRED · PANEL_UNREACHABLE · CAPABILITY_MISSING
CAPABILITY_NOT_GRANTED · PANEL_CREDENTIAL_MISSING
PROVIDER_UNAVAILABLE · PROVIDER_TIMEOUT
```

Chaque message dit **qui doit agir** — « la plateforme n'a pas de clé » et « ce
projet n'a pas le droit » envoient deux personnes différentes vers deux écrans
différents.

### Readiness

`getProviderReadiness('STRIPE')` répondait sur deux faits locaux : une clé
est-elle enregistrée, et quelqu'un a-t-il cliqué « Tester » ? Leur combinaison
produisait les deux pires réponses possibles :

```
clé locale présente + plateforme en panne   →  « prêt »      (faux)
aucune clé locale  + plateforme parfaite    →  « pas prêt »  (faux)
```

Le second était le plus coûteux : il envoyait un opérateur coller une clé dans
le projet — refaire exactement ce que la centralisation venait de défaire.

Elle délègue désormais au Control Plane pour tout fournisseur `authority: PANEL`
(`panelAuthorityReadiness.js`). Le document local n'est **pas** consulté, pas
même « pour compléter » : le lire d'abord rouvrirait la porte au premier
refactor.

**Classification des portes, comme demandé :**

| Porte | Verdict |
|---|---|
| `assertProviderReady('STRIPE')` avant paiement/portail | **bloquante** — un parcours exige réellement la capacité |
| `configured` / `verified` locaux pour Stripe | **supprimés comme autorité** — ils ne représentent plus rien |
| `activeMode` / `legacyModeMismatch` Stripe | **neutralisés** (`null` / `false`) — le monde est celui du Panel |

### Preuve qu'aucun secret local n'est lu

`LOCAL_STRIPE_CALL_SECRET_READS = 0`, vérifié par recherche statique **et** par
la suite dédiée. Et la réponse du diagnostic est inspectée : aucune clé, aucun
fragment, aucun en-tête `Authorization`, aucun `whsec_`.

Le test **pose délibérément une clé héritée en base**, marque le mode
« vérifié », et vérifie que la préparation reste `ok: false` avec le motif
`PANEL_NOT_PAIRED`. C'est le contrôle qui compte : la présence d'une clé ne
prouve plus rien.

---

## CREDENTIAL CUTOVER

### API

`authority: 'PANEL'` sur Stripe au catalogue. La primitive existait déjà —
`isPanelAuthority` + `assertLocalCredentialsAllowed`, construites pour Hostinger
en L9.2 — donc **aucune exception éparpillée** : une déclaration, et l'API
refuse.

Éprouvé sur la **vraie route HTTP**, requêtes forgées comprises :

| Requête | Résultat |
|---|---|
| `PUT …/STRIPE/modes/TEST` `{secretKey}` | **400** |
| `PUT …/STRIPE/modes/PROD` `{secretKey}` | **400** |
| `PUT …/STRIPE/modes/TEST` `{webhookSecret}` | **400** |
| `PUT …/STRIPE/modes/TEST` `{baseUrl}` | **400** |
| `PUT …/STRIPE/modes/TEST` `{enabled}` | **400** |
| `DELETE …/STRIPE/modes/TEST` | **400** |
| `PUT …/YOUSIGN/modes/TEST` `{apiKey}` | **200** — la garde ne déborde pas |

Et rien n'a atteint la base : aucune valeur forgée n'y figure.

### Catalogue

```js
STRIPE: { authority: 'PANEL', fields: [] }
```

`secretKey` était le dernier champ saisissable. Tant qu'il figurait là, un
opérateur pouvait reposer une clé en base — et il ne manquait plus qu'un
appelant.

`STRIPE_BASE_URL` a été retirée aussi. Purement déclarative depuis L6.3C, c'est
exactement le genre de constante qu'un futur helper reprendrait « puisqu'elle
est là ». `hasBaseUrl('STRIPE')` rend désormais `false` : une base URL éditable
n'a de sens que pour un fournisseur que ce projet appelle.

### UI

Le Manager rend les champs déclarés par le catalogue : celui-ci étant vide,
aucun formulaire n'apparaît, aucun bouton « Configurer », aucune suppression.
Stripe **reste visible** — le retirer ferait croire qu'il n'existe plus, et l'on
chercherait longtemps qui encaisse.

La note affichée a été **corrigée**, car elle était devenue fausse : elle disait
« ne la supprimez pas, elle sert encore au webhook et au test de connexion ». Le
Panel provisionne l'endpoint depuis L6.3A, et le test interroge la plateforme
depuis ce lot. Une note qui défend la conservation d'un secret que plus rien ne
lit est pire qu'une absence de note.

Un contrôle statique vérifie qu'**aucun écran** du Manager ne nomme `secretKey`
ni `publishableKey` — un futur formulaire codé en dur contournerait le
catalogue.

### Donnée historique — **OPTION B**

Les credentials Stripe chiffrés déjà en base sont **conservés et marqués morts**.

Les cinq questions de la phase 6 :

1. **Où ?** `IntegratedApi{provider:'STRIPE'}.modes.{TEST,PROD}.credentials.secretKey`.
2. **Combien de lecteurs runtime ?** **Zéro**, prouvé statiquement.
3. **Une migration en dépend-elle ?** Non — aucune migration du parc ne lit ce
   champ.
4. **Sa suppression casserait-elle un rollback ?** Pas un rollback logiciel.
   Elle empêcherait seulement un retour **volontaire** à l'ancienne
   architecture, ce qui est l'objectif — mais ce n'est pas une raison de le
   faire dans le même lot que la fermeture.
5. **Convention du parc ?** Oui : Hostinger (L9.2) a laissé sa donnée en place
   en la déclarant morte, sans lot de purge depuis.

Le choix suit donc la convention **et** la prudence : les quatre conditions de
l'option B sont remplies — aucun runtime ne la lit, aucune API ne peut la
modifier, aucune UI ne l'expose, elle est explicitement morte. Purger une donnée
chiffrée pour obtenir un compteur esthétique aurait été le contraire d'une
fermeture prudente.

**Lot de purge nommé : `L6.4 — PURGE DES CREDENTIALS FOURNISSEUR MORTS`**, à
traiter avec Hostinger, avec migration dédiée, comptage avant/après et preuve de
`READERS = 0` au moment de la purge.

---

## WEBHOOK VERIFICATION SECRET

Le `whsec_` reste, et il reste **légitime** :

> Il ne permet **aucun appel**. Il sert uniquement à constater qu'un message
> reçu vient bien de Stripe. Le détenir n'autorise rien — cela permet seulement
> de ne pas être trompé.

Il demeure nécessaire parce que Stripe écrit **directement** au projet : le
Panel ne relaie pas les événements métier, et l'endpoint du projet est porteur
(établi en L6.3A).

**Preuves de confinement :**

| Contrôle | Résultat |
|---|---|
| absent du catalogue — personne ne le saisit | ✔ |
| écrit par `panelWebhookProvisioning`, depuis le canal étroit L6.3A | ✔ |
| lu uniquement par `stripe.service.js`, pour vérifier une signature | ✔ |
| ce fichier n'appelle jamais Stripe (`api.stripe.com`, `new Stripe`) | ✔ |
| le rapatriement refuse une valeur qui n'est pas un `whsec_` | ✔ |
| `assertNoProviderSecrets` **non modifiée** — aucune exception large | ✔ |
| `verificationOnly` de L6.3A reste le seul canal permis | ✔ |

Les quatre tests demandés sont couverts par la suite L6.3A
(`stripe-webhook-provisioning-e2e`, 61/0) : `whsec_` accepté par le canal dédié,
`sk_` sous le nom `webhookSecret` refusé **par sa forme**, `whsec_` dans un
résultat de capacité ordinaire refusé, et aucun secret d'appel stocké
localement.

---

## PROJECT WITHOUT LOCAL STRIPE KEY

C'est désormais le **seul** état possible : un projet ne peut plus obtenir de
clé Stripe locale, l'API la refusant.

| Geste | Sans clé locale |
|---|---|
| payer des frais | **oui** — `billing.checkout.create` |
| payer un abonnement | **oui** — + `customer.ensure`, `price.ensure` |
| ouvrir le portail | **oui** — `billing.portal.create` |
| voir ses factures | **oui** — `billing.invoice.list` / `.retrieve` |
| recevoir les webhooks | **oui** — endpoint provisionné par le Panel, vérifié par `whsec_` |
| rembourser | **oui** — `billing.refund`, depuis le Panel |
| résilier | **oui** — `billing.subscription.cancel_*` |
| réconcilier par la session | **oui** — `billing.checkout.retrieve` |
| **être invité à saisir une clé** | **jamais** — aucun champ n'existe |

Les suites de bout en bout `payments-flow` (67/0), `subscription-flow` (77/0),
`billing-flow` (46/0), `billing-portal` (33/0) et `contract-lifecycle` (46/0)
tournent désormais **sans qu'aucune clé d'appel ne soit posée** : leur amorçage
ne pose plus que le `whsec_`, par le chemin exact qu'emprunte le Panel.

C'est une preuve plus forte qu'un scénario dédié : ce ne sont pas des tests
écrits pour l'occasion, ce sont les parcours métier existants, qui ont cessé
d'avoir besoin de la clé.

---

## PANEL FAILURE

`fail-closed`, sans plan B :

| Situation | Comportement |
|---|---|
| Panel non appairé | `PANEL_NOT_PAIRED` — refus explicite |
| Panel injoignable | `PANEL_UNREACHABLE` |
| capacité absente / non accordée | `CAPABILITY_MISSING` / `CAPABILITY_NOT_GRANTED` |
| credential Panel absent | `PANEL_CREDENTIAL_MISSING` |
| fournisseur muet | `PROVIDER_TIMEOUT` — état indéterminé, aucune reprise |

Dans tous les cas : **aucun appel Stripe local** (il n'y a plus de quoi en
faire), **aucune lecture du credential legacy** (aucun lecteur n'existe),
**aucun fallback** (`LOCAL_STRIPE_FALLBACKS = 0`, vérifié dans le corps des
`catch` de sept services), et **aucun message n'invite à configurer une clé
dans SB Auto** — les messages désignent tous la plateforme.

La panne est visible, jamais masquée par un retour à l'ancienne architecture.

---

## REGRESSION MATRIX

| Lot / suite | Résultat |
|---|---|
| **`stripe-final-control-plane-cutover`** (nouvelle) | **49 / 0** |
| `stripe-local-surface` (étendue) | **71 / 0** |
| L6.2B/C/D/E/F/G — six E2E Stripe du Panel | verts |
| L6.3A `stripe-webhook-provisioning-e2e` | **61 / 0** |
| L6.3B `stripe-local-surface-e2e` | **45 / 0** |
| L10.3 · L10.4 · L10.5 — revenus, remboursements, prestations | verts |
| `integrated-api` (recentrée) | **75 / 0** |
| `integrated-api-environment-routing` | **42 / 0** |
| `bridge-conformity` | **101 / 0** |
| `payments-flow` · `subscription-flow` · `billing-flow` · `billing-portal` | 67/0 · 77/0 · 46/0 · 33/0 |
| **SB Auto — `npm test`** | **1 rouge, préexistant** |
| **Panel — `run-all.js`** | **107 / 109** — 2 rouges préexistants |
| Panel frontend · Manager · vitrine — `tsc` + build | OK · OK · OK |

**Les rouges étrangers, prouvés :**

- SB Auto, `contract-operations` — « aucun champ du document n'est lu sans être
  surveillé (**taxRate**) ». `git log -S taxRate` désigne `7c394c5` (L10.5).
  Le fichier fautif (`projectSync.service.js`) et le test ne sont pas dans mon
  diff. **Rouge présent au commit de baseline.**
- Panel, `brevo-send-template-foundation` (×5) et `architecture` (×1) — tous deux
  sur `panelEmailTemplateRegistry.js`, modifié par L10.5 au commit `db283f1`.
  **Je n'ai fait aucune modification au Panel dans ce lot** — l'arbre Panel ne
  contient que L10.6.

Aucun n'a été réparé.

---

## PARALLEL WORK ISOLATION

**L10.6 (Payment Default + Grace + Conditional Suspension) est actif dans les
deux dépôts**, non committé.

Classification, vérifiée fichier par fichier sur le vocabulaire annoncé
(`paymentDefault`, `PAYMENT_DEFAULT`, `graceDays`, `nextPaymentAttemptAt`,
`attemptCount`, `GRACE_EXPIRED`, `suspensionRequestedAt`, `SiteStatus`,
`invoice.payment_failed`) : **zéro `UNKNOWN`**.

| Dépôt | Fichiers L10.6 |
|---|---|
| Panel | `bridge/bridgeContract.js`, `PanelSupervision.model.js`, `revenueProjection.service.js`, `recurringCostScheduler.js`, les deux specs, `tests/bridge-conformity.test.js`, `PanelPaymentDefault.model.js`, `finance/paymentDefaults/` |
| SB Auto | `config/bootstrap.js`, `SiteStatus.model.js`, `panelBridge/bridgeContract.js`, `siteEnforcement.service.js`, les deux specs, `billing/paymentDefaultCause.applier.js` |

**Fichiers partagés : aucun.** Mon diff et le leur sont disjoints, dans les deux
dépôts. Aucun staging par hunk n'a donc été nécessaire — c'est le second lot
consécutif sans collision.

`git add -A`, `git add .`, stash, reset et checkout globaux n'ont jamais été
employés. Aucun test rouge de L10.6 n'a été réparé ni stagé.

---

## RESIDUALS

1. **Les credentials Stripe chiffrés en base** — morts, illisibles par le
   runtime, immodifiables par l'API, invisibles dans l'UI. Purge en **L6.4**,
   avec Hostinger.

2. **Le paquet `stripe` reste dans `package.json`.** Plus aucun fichier ne
   l'importe — le retirer est désormais sans risque, et c'est un geste à faire.
   Il n'a pas été fait ici pour ne pas mêler une modification de dépendances à
   une fermeture de surface : un `npm ci` cassé sur ce lot aurait masqué tout le
   reste. À faire en L6.4.

3. **Le scénario perdu de L6.3C reste perdu** — un paiement de frais *sans
   session* dont l'événement Stripe se perdrait définitivement ne se réconcilie
   plus seul. Ce lot ne l'aggrave ni ne le répare.

4. **`assertProviderReady('STRIPE')` fait désormais un appel réseau.** La porte
   était une lecture en base ; c'est maintenant un aller-retour vers le Panel,
   sur quatre points d'entrée (`contract.admin.controller`). C'est correct — la
   disponibilité ne se lit nulle part ailleurs — mais cela déplace une latence
   sur des chemins utilisateur. Un cache court serait légitime ; il n'a pas été
   ajouté ici parce qu'un cache sur une porte de sécurité mérite son propre lot
   et ses propres tests d'expiration.

5. **Le vocabulaire `configured` / `verified`** survit dans la forme rendue par
   la readiness, mais il a changé de sujet : il décrit la plateforme, plus le
   projet. Les renommer aurait touché des écrans hors périmètre.

---

## FINAL VERDICT

STRIPE FINAL CONTROL PLANE CUTOVER: PASS

STRIPE PROJECT-SIDE CONTROL PLANE MIGRATION: COMPLETE
