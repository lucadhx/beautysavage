# L6.4 — PURGE DES CREDENTIALS FOURNISSEUR MORTES

> **⚠️ RAPPORT HISTORIQUE — NE PAS SUIVRE COMME PROCÉDURE.**
> Ce document décrit un état du système à la date de sa rédaction. Plusieurs
> architectures qu'il mentionne ont été supprimées depuis — notamment la page
> IntegratedAPI du Manager, les credentials Brevo locaux et le webhook Brevo
> local. Autorités actuelles : [ARCHITECTURE.md](ARCHITECTURE.md) ·
> [PROTOCOL.md](PROTOCOL.md) · [INTEGRATED_API.md](INTEGRATED_API.md) ·
> [PANEL_BRIDGE.md](PANEL_BRIDGE.md).


> **Le « au cas où » a été supprimé.** Les clés Stripe et Hostinger que le projet
> ne lisait plus, ne pouvait plus écrire et n'affichait plus, dormaient encore
> chiffrées en base. Elles n'y sont plus — dans les deux mondes.
>
> **Et le secret qui compte a survécu.** Le `whsec_` de vérification Stripe est
> intact, valeur comprise, et un événement signé passe toujours.

**DEAD PROVIDER CREDENTIALS PURGE: PASS**

---

## Matrice d'isolation

| Dépôt | HEAD au départ | Rebasé sur | HEAD après | Arbre final |
|---|---|---|---|---|
| SB Auto 06 | `c0dc457` | **`ea99818` (L10.6A)** | *(voir livraison)* | propre |
| Panel | `7e82465` | `2d0d32e` (L10.6A) | **inchangé** | propre |

**L10.6A a COMMITTÉ pendant ce lot**, dans les deux dépôts. Conformément à la
règle d'isolation, leurs commits sont devenus la nouvelle baseline : ils n'ont
été ni réécrits, ni amendés, ni rebasés. Mon travail se pose au-dessus.

Vérification après coup : mon diff par rapport à **leur** commit ne contient que
mes fichiers, et aucun des leurs.

**Aucune modification du Panel** : ce lot ne touche que les données et le code
du projet.

| Classification | Fichiers |
|---|---|
| `L6_4` | ceux du commit (voir livraison) |
| `PARALLEL_KNOWN` | Panel : `bridge/bridgeContract.js`, `PanelProjectProjection.model.js`, `PanelSupervision.model.js`, `revenueProjection.service.js`, `recurringCostScheduler.js`, `sync/projectors.js`, les 2 specs, `tests/bridge-conformity.test.js`, `PanelPaymentDefault.model.js`, `finance/paymentDefaults/`, `finance-payment-default-confirmation.test.js` — SB Auto : `config/bootstrap.js`, `SiteStatus.model.js`, `panelBridge/bridgeContract.js`, `projectSync.service.js`, `siteEnforcement.service.js`, les 2 specs, `site-status-payment-default.test.js`, `billing/paymentDefaultCause.applier.js` |
| `UNKNOWN` | **aucun** |

Chaque fichier a été classé en comptant le vocabulaire annoncé de L10.6A
(`paymentDefault`, `graceDays`, `GRACE_EXPIRED`, `SiteStatus`, …) dans son diff.
**Aucun fichier partagé** : mon diff et le leur sont disjoints, donc aucun
staging par hunk n'a été nécessaire.

---

## 1. Quelles credentials existaient encore ?

Inventaire construit sur le **code** (tous les lecteurs runtime) puis confronté
aux **documents réels** des deux bases.

| Provider | Credential | Lecteurs runtime | Écriture API | UI | Autorité | Classification |
|---|---|---|---|---|---|---|
| STRIPE | `secretKey` | **0** | refusée (L6.3 FINAL) | aucune | PANEL | `PANEL_AUTHORITY_DEAD_LOCAL` |
| STRIPE | `publishableKey` | **0** | refusée | aucune | PANEL | `LEGACY_UNUSED` |
| STRIPE | `webhookSecret` | **1** — `stripe.service.js:212` | provisionnement Panel | aucune | PANEL | `VERIFICATION_ONLY` |
| HOSTINGER | `apiToken` | **0** | refusée (L9.2) | aucune | PANEL | `PANEL_AUTHORITY_DEAD_LOCAL` |
| BREVO | `apiKey` | **4** | ouverte | oui | PROJECT | `ACTIVE_RUNTIME` |
| BREVO | `webhookSecret` | **1** | ouverte | oui | PROJECT | `ACTIVE_RUNTIME` |
| BREVO | `webhookSecretPrevious` | **1** | rotation | non | PROJECT | `ACTIVE_RUNTIME` |
| YOUSIGN | `apiKey` | **2** | ouverte | oui | PROJECT | `ACTIVE_RUNTIME` |
| YOUSIGN | `webhookSecret` | **1** | ouverte | oui | PROJECT | `ACTIVE_RUNTIME` |

**Sur les providers cités dans la mission** — Ubiflow, AssuCarteGrise,
CarVertical, Car Studio AI : **ils n'existent pas dans ce dépôt.** Zéro fichier
les mentionnant, zéro entrée au catalogue, zéro document en base. Je les signale
plutôt que d'inventer un audit pour eux ; s'ils vivent ailleurs, ils relèvent
d'un autre périmètre.

Le catalogue ne déclare que **quatre** providers, et les deux bases n'en
contiennent que ces quatre-là — aucun orphelin, aucun provider retiré du
catalogue mais resté en base.

---

## 2. Lesquelles étaient réellement mortes ?

Trois rôles, sur deux providers. Chacun est passé par les sept preuves
cumulatives exigées :

| Preuve | STRIPE.secretKey | STRIPE.publishableKey | HOSTINGER.apiToken |
|---|---|---|---|
| aucun lecteur runtime | ✔ | ✔ | ✔ |
| aucun appel fournisseur dépendant | ✔ (L6.3C) | ✔ | ✔ (L9.2) |
| aucune route d'écriture autorisée | ✔ (`authority: PANEL`) | ✔ | ✔ |
| aucune UI | ✔ | ✔ (retirée en L6.3) | ✔ |
| aucun scheduler/bootstrap/diagnostic | ✔ (diagnostic migré en L6.3 FINAL) | ✔ | ✔ |
| aucune vérification webhook dépendante | ✔ | ✔ | ✔ (aucun webhook Hostinger) |
| aucune migration/recovery | ✔ | ✔ | ✔ |

---

## 3–4. Lesquelles ont été conservées, et pourquoi ?

**`STRIPE.webhookSecret`** — c'est le cas qui justifie tout le soin de ce lot.

Il serait facile de le classer mort : « le projet n'appelle plus Stripe ». Ce
serait confondre deux choses différentes. Un `whsec_` ne permet **aucun appel** ;
il permet de constater qu'un message reçu vient bien de Stripe. Le supprimer
n'aurait cassé aucun paiement — il aurait rendu le projet **sourd** aux
paiements, ce qui est une panne silencieuse sur le chemin de l'argent.

**BREVO et YOUSIGN** — intégralement conservés. Le projet appelle encore ces
deux fournisseurs et vérifie leurs webhooks. `webhookSecretPrevious` mérite une
mention : c'est la fenêtre de rotation de Brevo, et les événements déjà en vol
portent encore l'ancien jeton. Le supprimer les ferait tous rejeter pendant la
rotation — une donnée qui *paraît* périmée et ne l'est pas.

---

## 5. Combien de documents TEST/PROD ont été modifiés ?

| Base | Documents analysés | Documents modifiés | Champs retirés | Secrets actifs épargnés | Inconnus |
|---|---|---|---|---|---|
| `sbauto06_test` | 4 | **2** | **3** | 5 | 0 |
| `sbauto06_prod` | 4 | **1** | **2** | 4 | 0 |

Détail : base TEST — `STRIPE.secretKey`, `STRIPE.publishableKey`,
`HOSTINGER.apiToken`. Base PROD — `STRIPE.secretKey`, `STRIPE.publishableKey`.

**Les deux purges ont été réellement exécutées**, dans l'ordre imposé :
dry-run TEST → inspection → apply TEST → apply TEST (idempotence) → validations
→ dry-run PROD → inspection → apply PROD → apply PROD → validations.

Le dry-run a annoncé **exactement** les mêmes documents et champs que l'apply,
par construction : la sélection vit dans une fonction **pure** (`planForDocument`)
que les deux chemins appellent. Deux sélections qui pourraient diverger
rendraient le dry-run mensonger.

---

## 6. La migration est-elle idempotente ?

**Oui, vérifié sur les deux bases réelles :**

```
APPLY #2 TEST  →  documentsUpdated = 0   fieldsRemoved = 0
APPLY #2 PROD  →  documentsUpdated = 0   fieldsRemoved = 0
```

Et sur base éphémère dans la suite dédiée.

Elle procède par `$unset` **ciblé**, jamais par remplacement de document : un
remplacement écraserait ce qu'un autre processus vient d'écrire — le
provisionnement de webhook, par exemple, qui pose un `whsec_` sans prévenir.
L'objet `credentials` parent n'est pas supprimé même devenu vide : il porte la
forme du document.

---

## 7–8. Reste-t-il un lecteur de secret local Stripe / Hostinger ?

**Non, pour les clés d'appel.** Assertions **nominatives**, par provider et par
rôle :

```
STRIPE.secretKey       : 0 lecteur
STRIPE.publishableKey  : 0 lecteur
HOSTINGER.apiToken     : 0 lecteur
STRIPE.webhookSecret   : >= 1 lecteur   ← invariant INVERSE
BREVO.apiKey           : >= 1 lecteur
YOUSIGN.apiKey         : >= 1 lecteur
```

L'invariant inverse mérite d'être souligné : il **rougit si le secret de
vérification perd son dernier lecteur**. Un compteur « zéro secret » se serait
satisfait d'un projet rendu sourd.

---

## 9. Le webhook secret Stripe a-t-il survécu ?

**Oui — par son nom, par sa valeur, et par sa fonction.**

- son nom subsiste dans les deux bases ;
- sa **valeur déchiffrée est identique** à celle d'avant la purge (vérifié dans
  la suite : un `$unset` mal ciblé l'aurait réécrit sans qu'aucun nom ne change) ;
- et surtout, la suite fait passer un **événement réellement signé** par le vrai
  vérificateur du projet après la purge : accepté. Une signature étrangère :
  refusée.

Sur les bases réelles, les secrets survivants sont tous déchiffrables.

---

## 10. Quels autres providers gardent légitimement leurs credentials ?

**BREVO** et **YOUSIGN**, intégralement — autorité `PROJECT`, appels réels,
webhooks vérifiés localement. Aucun champ retiré, aucun champ touché.

La suite le vérifie explicitement, y compris la fenêtre de rotation Brevo : une
purge qui aurait « nettoyé » un peu trop large aurait rougi.

---

## 11. Reste-t-il un champ mort dans un modèle ?

**Non, et il n'y avait rien à faire.** Le modèle `IntegratedApi` stocke les
credentials dans une `Map` générique (`credentials: { type: Map, of:
credentialSchema }`) : aucun nom de champ n'est déclaré au schéma. Supprimer la
donnée suffit donc — il n'existe pas de « champ mort dans un schéma
inscriptible » pour Stripe ou Hostinger.

Le catalogue, lui, déclare déjà `fields: []` pour les deux (L9.2 et L6.3 FINAL),
et un invariant vérifie que tout provider `authority: PANEL` en déclare zéro.

---

## 12. Reste-t-il une dépendance morte ?

**Non. `DEAD PACKAGE REMOVED : stripe@^17.7.0`.**

Les trois compteurs étaient à zéro — `RUNTIME_IMPORTS`, `TEST_IMPORTS`,
`SCRIPT_IMPORTS` — les seules occurrences restantes étant des **commentaires**
qui racontent sa disparition. Le paquet a été retiré et le lockfile régénéré ;
un invariant vérifie qu'il ne revient ni au `package.json`, ni comme import.

Aucun paquet Hostinger maison n'existe : le projet n'a jamais eu de SDK dédié.

`DEAD PACKAGE RETAINED` : aucun.

---

## 13–14. Peut-on encore réintroduire une clé locale ?

**Par l'API : non.** `authority: PANEL` fait refuser toute écriture à la porte —
éprouvé sur la vraie route HTTP en L6.3 FINAL (cinq écritures forgées + une
suppression, toutes refusées), et l'invariant reste vert ici.

**Par l'UI : non.** Le catalogue ne déclare aucun champ, donc l'écran n'en rend
aucun ; et un contrôle statique vérifie qu'aucun fichier du Manager ne nomme
`secretKey` ou `publishableKey` — un futur formulaire codé en dur contournerait
le catalogue.

**Par écriture directe en base** : oui, comme toujours — mais la donnée serait
morte à la seconde même, sans lecteur, et la purge la reprendrait au passage
suivant.

---

## 15. Quelles suites ont été rejouées ?

| Suite | Résultat |
|---|---|
| **`dead-provider-credentials-purge`** (nouvelle) | **61 / 0** |
| `stripe-final-control-plane-cutover` | 49 / 0 |
| `stripe-local-surface` | 71 / 0 |
| `integrated-api` · `integrated-api-environment-routing` | 75 / 0 · 42 / 0 |
| `payments-flow` · `subscription-flow` · `billing-flow` · `billing-portal` | verts |
| `hostinger` · `bridge-conformity` · webhook Stripe | verts |
| **SB Auto — `npm test`** | **1 rouge, préexistant** |
| **Panel — `run-all.js`** | **107 / 109** — 2 rouges préexistants |
| Panel frontend · Manager · vitrine — `tsc` + build | OK · OK · OK |

**Rouges étrangers, non réparés :**

- SB Auto `contract-operations` — `taxRate`, tracé à `7c394c5` (L10.5) ;
- Panel `brevo-send-template-foundation` (×5) et `architecture` (×1) —
  `panelEmailTemplateRegistry.js`, tracé à `db283f1` (L10.5). Le Panel n'a reçu
  **aucune** modification de ma part dans ce lot.

---

## 16. Quelles réserves restent ?

1. **La purge a été exécutée sur les bases de ce poste** (`sbauto06_test`,
   `sbauto06_prod`), pas sur d'éventuelles autres instances déployées. Toute
   instance supplémentaire devra rejouer la migration — elle est idempotente et
   livrée avec le code, mais elle ne s'exécute pas seule.

2. **`webhookSecretPrevious` n'existe pas pour Stripe.** Le projet ne détient
   qu'un secret de vérification à la fois. Si le Panel devait un jour tourner ce
   secret pendant que des événements sont en vol, une courte fenêtre de rejets
   existerait. C'était déjà vrai avant ce lot ; il ne l'aggrave pas, mais la
   purge rend le point plus visible puisqu'il ne reste que ce champ.

3. **Le champ `enabled` et `activeMode` de Stripe survivent** en base. Ils ne
   sont pas des credentials et ne portent aucun secret ; `activeMode` n'est plus
   une autorité depuis L6.3 FINAL (la readiness le rend `null`). Les retirer
   demanderait de toucher au modèle partagé par les quatre providers — hors
   périmètre, et sans gain de sécurité.

4. **Aucune sauvegarde préalable n'a été prise par ce lot.** La suppression est
   irréversible sur ces deux bases. C'était l'objet du lot, et les preuves
   négatives ont été faites avant — mais cela mérite d'être écrit noir sur blanc.

5. **Ubiflow, AssuCarteGrise, CarVertical, Car Studio AI n'ont pas été audités**
   parce qu'ils n'existent pas ici. Si la mission les cite, ils vivent
   probablement dans un autre dépôt ou dans un projet à venir.

---

## Compteurs finaux

```
DEAD_PROVIDER_CREDENTIALS                  = 0   (les deux bases)
STRIPE_LOCAL_CALL_CREDENTIALS              = 0
HOSTINGER_LOCAL_CALL_CREDENTIALS           = 0
PANEL_AUTHORITY_LOCAL_CALL_SECRET_FIELDS   = 0
PANEL_AUTHORITY_LOCAL_CALL_SECRET_WRITES   = 0
LOCAL_STRIPE_CREDENTIAL_UI_INPUTS          = 0
UNKNOWN_SECRET_READERS                     = 0

STRIPE_WEBHOOK_VERIFICATION_SECRET_READERS = 1   ← doit rester >= 1
BREVO / YOUSIGN credentials                = intacts
DEAD PACKAGE REMOVED                       : stripe@^17.7.0
```

---

**DEAD PROVIDER CREDENTIALS PURGE: PASS**
