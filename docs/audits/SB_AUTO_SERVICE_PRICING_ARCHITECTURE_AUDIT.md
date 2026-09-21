# AUDIT — ARCHITECTURE SERVICES / TARIFS SB AUTO

**Objet** : déterminer si le modèle métier « services / catégories / packs / tarifs » de SB Auto
constitue une base suffisamment générique pour représenter le catalogue d'un autre centre de
detailing (cas d'étude : **R.L.V Detail**), et pour industrialiser les prochains sites L.Y Solution.

**Nature** : audit **strictement lecture seule**. Aucun code, aucun schéma, aucune donnée,
aucune configuration n'a été modifié. Le seul fichier produit est le présent rapport.

**Date** : 2026-08-21

---

## 1. Executive summary

### Ce qui existe réellement

Un modèle unique, `Service` ([Service.model.js](../../backend/src/models/Service.model.js)),
document MongoDB imbriqué sur 4 niveaux :

```
Service  →  Category  →  Pack  →  pricing { basePrice, complements[] }
                      →  complementaryServices[]
                      →  supplements[]
```

Il n'existe **aucune autre entité** de catalogue dans le dépôt : pas de modèle `Pack`, pas de
modèle `VehicleCategory`, pas de modèle `Option`, pas de table de prix. Tout est sous-document
du même document `Service`, et la totalité du catalogue d'un client tient dans la collection
`services` de sa base MongoDB projet.

### Ce que ce modèle fait bien

1. **Le prix par gabarit de véhicule est natif** — et c'est son point le plus fort.
   `pricing.complements[]` = `{ label, price }` avec des prix **absolus** (le manager affiche le
   delta par rapport au prix de base à titre purement indicatif,
   [PrestationEditor.tsx:256](../../manager/src/components/services/PrestationEditor.tsx#L256)).
   Les 4 lignes tarifaires Citadine / Berline / Sportive-SUV / Supercar de R.L.V passent
   directement, sans détournement.
2. **La hiérarchie éditoriale est saine** : un service = une page publique avec son slug, ses
   catégories en onglets, ses packs en carrousel. Elle supporte un catalogue large.
3. **Le « sur devis » existe** au niveau pack et au niveau prestation complémentaire / supplément.

### Ce qui bloque

| # | Manque structurel | Conséquence pour R.L.V |
|---|---|---|
| 1 | **Aucun référentiel de gabarits.** `complements[].label` est une chaîne libre, ressaisie dans **chaque pack**. | 4 libellés × N packs à retaper et à maintenir. Renommer « Sportive / SUV » = éditer tous les packs un par un. |
| 2 | **Aucune composition de forfaits.** `includes` est un `[String]`. | « R.L.V. + comprend tout le forfait Simply One » → duplication des 5 lignes, ou une ligne de texte qui ment silencieusement le jour où Simply One change. |
| 3 | **Une option n'existe que dans un pack, et n'a pas de mode tarifaire.** `optionSchema.price` est `required`. | Les 3 protections céramiques ne peuvent pas être partagées entre plusieurs forfaits ni proposées sur devis. Une option sans prix public s'affiche « **+0 €** ». |
| 4 | **Aucun prix calculé.** Rien n'additionne base + option, nulle part. | « Stage 1 (catégorie) + céramique » n'est jamais un montant : c'est une addition laissée au visiteur. |
| 5 | **La sémantique tarifaire est binaire** — `PRICING_MODES = { FIXED, QUOTE }` ([constants.js:22](../../backend/src/utils/constants.js#L22)). | Impossible de distinguer un prix **ferme** d'un prix **à partir de** ; impossible d'avoir « à partir de 700 € **et** sur devis » ; aucune unité (€/jour), aucune mention TTC/HT. |
| 6 | **Aucun champ pour durabilité, zones traitées, exclusions, conditions.** `duration` est en **minutes de prestation**, pas une durabilité produit. | « 5 ans, carrosserie + jantes + vitres », « hors produits de lustrage » → texte libre uniquement. |
| 7 | **Le Manager n'expose ni réordonnancement ni publication** des éléments de catalogue, alors que les champs `order` / `published` existent en base. | Le client ne peut ni classer ses forfaits, ni désactiver une prestation saisonnière : il doit la **supprimer**. |
| 8 | **Des données SB Auto sont codées en dur dans le backend** et semées au démarrage de tout projet dupliqué ([bootstrap.js:238-312](../../backend/src/config/bootstrap.js#L238)). | Chaque nouveau client naît avec « Traitement cuir 45 € », « Lavage moto 40 € », 20 faux avis nominatifs et une FAQ qui parle de « citadine, berline, SUV, monospace ». |

### Réponses aux deux questions finales (détaillées en §23)

> **« Si demain nous signons R.L.V Detail, pouvons-nous représenter proprement et administrer
> depuis notre Manager l'intégralité de son catalogue actuel, sans duplication artificielle, sans
> données métier perdues et sans logique spécifique R.L.V ? »**

**NON.**

Nous pouvons produire un site **présentable** — la majorité du catalogue s'affiche — mais pas sans
duplication (contenu de Simply One recopié dans R.L.V. +, céramiques recopiées dans chaque pack où
elles s'appliquent) et pas sans perte (durabilité, zones traitées, unité €/jour, exclusions,
« à partir de » vs prix ferme, suppléments sans prix public). Trois besoins sont **non
représentables du tout** : le prix final calculé, le prix « à partir de » cumulé au « sur devis »,
et l'option partagée entre forfaits.

> **« L'architecture actuelle constitue-t-elle une fondation suffisamment générique pour
> industrialiser, ou devons-nous faire évoluer le modèle avant de multiplier les projets ? »**

**Le squelette est le bon ; il faut faire évoluer 4 abstractions avant de multiplier.**
Ce n'est pas une réécriture : l'arbre `Service > Category > Pack` est correct et doit rester.
Les évolutions P0 (§18) sont contenues et additives.

**Classement : C — trop spécifique à SB Auto ; le modèle est extensible mais certaines
abstractions importantes doivent évoluer.** Justification complète en §17.

---

## 2. Scope et méthodologie

### Périmètre lu

| Zone | Chemin |
|---|---|
| Modèle de données | `backend/src/models/Service.model.js`, `mediaDescriptor.schema.js`, `Review.model.js`, `PromotionBanner.model.js` |
| Constantes / enums | `backend/src/utils/constants.js` |
| API | `backend/src/controllers/service.controller.js`, `public.controller.js`, `backend/src/routes/service.routes.js`, `public.routes.js`, `meta.routes.js` |
| Validation | `backend/src/validators/common.validator.js` |
| Amorçage / seeds / migrations | `backend/src/config/bootstrap.js` |
| Manager | `manager/src/pages/ServicesPage.tsx`, `PricingPage.tsx`, `manager/src/components/services/PrestationEditor.tsx`, `GalleryManager.tsx`, `manager/src/types/index.ts`, `manager/src/lib/api.ts`, `manager/src/lib/utils.ts` |
| Vitrine | `vitrine/src/pages/ServicePage.tsx`, `HomePage.tsx`, `vitrine/src/components/ServicesShowcase.tsx`, `Coverflow.tsx`, `vitrine/src/types.ts`, `vitrine/src/lib/utils.ts`, `api.ts` |
| Tests / recettes | `backend/src/scripts/smoke-test.js`, `booking-url.test.js`, `verify-extras.js` |
| Documentation | `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/DUPLICATION.md` |
| Panel | `Panel/backend/src/models/`, `SB Auto 06/backend/src/services/projectBridge/`, `panelBridge/` |
| Autres projets du parc | `Kwash/`, `KwashDuplicationRecipe/`, `DuplicationFinalRecipe/` (comparaison du modèle) |

### Méthode

1. Relevé de l'état Git **avant** toute lecture (§3).
2. Lecture du schéma Mongoose comme **source de vérité de la sémantique** — les noms de fichiers et
   de champs ont été traités comme indicatifs, jamais comme preuve.
3. Confrontation systématique : *ce que le schéma permet* ≠ *ce que l'API valide* ≠ *ce que le
   Manager expose* ≠ *ce que la vitrine rend*. Les quatre divergent, et les divergences sont
   documentées (§7, §8).
4. Recherche exhaustive des termes `service`, `categor*`, `pack`, `forfait`, `prestation`,
   `option`, `extra`, `supplement`, `price`, `pricing`, `vehicleType`, `gabarit`, `tarif`,
   `devis`, `quote`, `TTC`, `citadine|berline|SUV|supercar` dans `backend/src`, `manager/src`,
   `vitrine/src`, `docs`, et dans le Panel.
5. Distinction stricte, dans la matrice §12, entre **donnée structurée** et **donnée seulement
   représentable en texte libre** (exigence §18 de la commande).

### Ce que l'audit n'a pas fait

Aucune exécution de serveur, aucune connexion base, aucun test lancé, aucune installation.
Les comportements décrits sont déduits du code lu, et chaque déduction est accompagnée de sa preuve.

---

## 3. État Git avant audit

Le répertoire de travail racine `L.Y Solution/` **n'est pas un dépôt Git** (`fatal: not a git
repository`). Deux dépôts distincts le sont : `SB Auto 06/` et `Panel/`.

### Dépôt `SB Auto 06`

| | |
|---|---|
| Branche | `feat/unified-production-baseline` |
| Commit | `a7e3c9c8caefb841f356de91c6932606088ae50f` |
| Message | `feat(contrats): archiver la preuve d'audit à côté du contrat signé (LOT 6)` |
| Auteur / date | Luca — Thu Aug 20 19:30:45 2026 +0200 |
| Index (staged) | vide |

Worktree **déjà modifié avant l'audit** — 14 fichiers modifiés, 1 non suivi
(200 insertions, 44 suppressions) :

```
 M backend/src/models/Contract.model.js
 M backend/src/scripts/contract-signature-requirement.test.js
 M backend/src/scripts/sync.js
 M backend/src/services/contractTestTools.service.js
 M backend/src/services/projectBridge/projectManifest.js
 M backend/src/services/projectBridge/projectSync.service.js
 M backend/src/services/projectBridge/syncTriggers.js
 M backend/src/services/reconciliation.service.js
 M backend/src/services/signature/signatureCoordinates.js
 M backend/src/utils/integratedApiCatalog.js
 M manager/package.json
 M manager/src/lib/api.ts
 M manager/src/pages/MyContractPage.tsx
 M manager/src/pages/dev/DevContractsPage.tsx
?? manager/src/lib/signatureUx.test.mjs
```

### Dépôt `Panel`

| | |
|---|---|
| Branche | `feat/generic-deployment-engine` |
| Commit | `cd37a29c8eaa659779c20ee3e058edac71675ea6` |
| Message | `feat(signature): servir la preuve d'audit comme une pièce à part (LOT 6)` |

Worktree **déjà modifié avant l'audit** — 11 fichiers modifiés/supprimés, 7 non suivis :

```
 M backend/src/services/capabilities/capabilityGateway.service.js
 M backend/src/services/capabilities/providerAdapters.js
 M backend/src/services/integratedApi/providerRegistry.js
 M backend/src/services/integratedApi/providerValidation.js
 D backend/src/services/integratedApi/yousign/yousignAdapters.js
 D backend/src/services/integratedApi/yousign/yousignTransport.js
 M backend/src/services/webhooks/webhookRegistry.js
 M tests/integrated-api-control-plane.test.js
 M tests/integrated-api-encryption.test.js
 M tests/integrated-api-provider-registry.test.js
 M tests/opensign-capability-adapter.test.js
?? backend/src/scripts/migrations/2026-08-21-retire-yousign-credentials.js
?? backend/src/services/integratedApi/signature/retiredSignatureProvider.js
?? tests/signature-provider-retirement.test.js
?? tools/opensign/inventaireCredentials.mjs
?? tools/opensign/inventaireLiens.mjs
?? tools/opensign/inventaireYousign.mjs
?? tools/opensign/peekYousignRecords.mjs
```

**Ces modifications sont le chantier Yousign → OpenSign en cours. Elles préexistent à l'audit et
n'ont pas été touchées.** Aucun fichier de ces deux listes n'appartient au domaine catalogue/tarifs :
les deux chantiers ne se recoupent pas.

---

## 4. Architecture actuelle

### 4.1 Topologie applicative

Trois applications par projet client, une base MongoDB par projet :

```
vitrine/   (React + Vite, public)      ──GET /api/public/bootstrap──┐
manager/   (React + Vite, client)      ──CRUD /api/services─────────┤
                                                                    ├──> backend/ (Express + Mongoose)
Panel/     (central L.Y Solution)      ──contrats, déploiement,     │        └── MongoDB projet
                                          facturation, médias───────┘             collection `services`
```

### 4.2 Le catalogue est **entièrement local au projet**

Recherche menée dans `Panel/backend/src/models/` : **aucun modèle de catalogue**. Les 39 modèles
du Panel couvrent projets, déploiements, contrats, facturation, e-mails, médias, API intégrées —
jamais services ni tarifs. De même, `backend/src/services/projectBridge/projectManifest.js` et
`projectSync.service.js` ne mentionnent ni `Service`, ni catalogue, ni tarif.

**Conséquence** : le catalogue n'est ni publié vers le Panel, ni piloté par lui, ni sauvegardé
par lui. C'est une donnée purement projet. Ce n'est pas un défaut en soi, mais cela signifie
qu'aucune capitalisation inter-clients (référentiel de gabarits partagé, bibliothèque de
prestations types) n'existe aujourd'hui.

### 4.3 Le modèle est **déjà le gabarit d'industrialisation**

`Service.model.js` est **identique octet pour octet** dans les quatre projets du parc :

```
SB Auto 06/backend/src/models/Service.model.js
Kwash/backend/src/models/Service.model.js                     → diff vide
KwashDuplicationRecipe/backend/src/models/Service.model.js
DuplicationFinalRecipe/backend/src/models/Service.model.js
```

C'est la preuve la plus directe que la question posée est la bonne : ce fichier **est** le modèle
que tout nouveau centre de lavage héritera. Ses limites ne sont pas des limites de SB Auto, ce
sont des limites de la gamme.

---

## 5. Modèles backend

Fichier unique : [`backend/src/models/Service.model.js`](../../backend/src/models/Service.model.js) (154 lignes).

### 5.1 `serviceSchema` — modèle racine (l. 130-148)

| Champ | Type | Contraintes | Rôle réel |
|---|---|---|---|
| `title` | String | **required** | Titre de la page publique |
| `slug` | String | **required**, **unique** (crée l'index) | Clé d'URL, **généré côté serveur** (jamais saisi) |
| `description` | String | défaut `''` | Chapô de la bannière, texte brut, mono-bloc |
| `bannerImage` | String | défaut `''` | Chemin de stockage — **repli** |
| `bannerImageMedia` | `mediaDescriptorSchema` | défaut `null` | **Source de vérité du média**, l'URL est dérivée à la lecture |
| `categories` | `[categorySchema]` | défaut `[]` | Les onglets de la page |
| `order` | Number | défaut `0` | Ordre d'affichage |
| `published` | Boolean | défaut `true` | Visibilité publique |
| `createdAt`/`updatedAt` | Date | `timestamps: true` | |

Index : `{ published: 1, order: 1 }` (l. 151) — sert la requête vitrine.

### 5.2 `categorySchema` — sous-document (l. 117-128)

| Champ | Type | Contraintes | Rôle réel |
|---|---|---|---|
| `title` | String | **required** | Libellé de l'onglet |
| `description` | String | `''` | Texte sous le titre de l'onglet |
| `gallery` | `[galleryImageSchema]` | max 50, **validé dans le contrôleur** et non dans le schéma | Photos de la catégorie |
| `packs` | `[packSchema]` | `[]` | Forfaits |
| `complementaryServices` | `[pricedItemSchema]` | `[]` | Prestations à l'unité |
| `supplements` | `[pricedItemSchema]` | `[]` | Suppléments |
| `order` | Number | `0` | |

**Aucun champ d'activation.** Une catégorie ne peut être ni dépubliée ni masquée : elle existe ou
elle est supprimée.

> **Sémantique réelle à retenir** : `Category` n'est **pas** une catégorie de véhicule ni une
> famille métier au sens taxonomique. C'est un **onglet de présentation** à l'intérieur d'une page
> service (« Intérieur », « Extérieur & carrosserie », « Moto » — cf. `verify-extras.js:19-23`).
> Le nom prête à confusion : il n'y a rien dans le dépôt qui porte la notion de « catégorie de
> véhicule » comme entité.

### 5.3 `packSchema` — le forfait commercial (l. 57-86)

| Champ | Type | Contraintes | Observation |
|---|---|---|---|
| `name` | String | **required** | |
| `shortDescription` | String | `''` | Une seule zone de texte libre par pack |
| `includes` | **`[String]`** | `[]` | **Le contenu du forfait est une liste de chaînes.** Aucune entité, aucune référence, aucune réutilisation possible. |
| `options` | `[optionSchema]` | `[]` | Options payantes propres au pack |
| `badge` | `badgeSchema` | | `{ enabled, label, color }` — **présentation mêlée au métier** (§15) |
| `pricing` | `pricingSchema` | | `{ mode, basePrice, complements[] }` |
| `duration` | Number \| null | `min: 0`, défaut **`null`** | **En MINUTES**, durée de la prestation. Le `null` par défaut est délibéré (commentaire l. 65-67) pour distinguer « non renseignée » de « zéro ». |
| `bookingUrl` | String \| null | HTTPS validé (`utils/bookingUrl`) | Lien de **réservation externe**, pas un devis |
| `order` | Number | `0` | |

**Aucun champ d'activation**, aucune image propre, aucune référence à un autre pack.

### 5.4 `pricingSchema` (l. 42-53) et `complementSchema` (l. 14-21)

```js
pricing = {
  mode:      'FIXED' | 'QUOTE',      // enum PRICING_MODES — deux valeurs, pas trois
  basePrice: Number (>= 0, def. 0),
  complements: [ { label: String (required), price: Number (required, >= 0), order } ]
}
```

**Point capital — la sémantique de `complements` est un prix ABSOLU, pas un delta.**
Preuve : le manager calcule `const delta = c.price - p.pricing.basePrice`
([PrestationEditor.tsx:256](../../manager/src/components/services/PrestationEditor.tsx#L256)) et
affiche cet écart comme simple indication verte/rouge ; la vitrine, elle, affiche `c.price` tel
quel dans une pastille `{label} {prix}`
([ServicePage.tsx:336-345](../../vitrine/src/pages/ServicePage.tsx#L336)).

C'est donc bien une **grille tarifaire par gabarit** : `label` = le gabarit, `price` = le prix
pour ce gabarit. Le champ commentaire du schéma le confirme : `// ex: "SUV"`, `// ex: 80` (l. 16-17).

**Limite structurelle** : ce couple `(label, price)` vit **dans le pack**. Il n'y a pas de
référentiel de gabarits au niveau service, ni au niveau site. Les libellés sont ressaisis
intégralement dans chaque pack.

### 5.5 `optionSchema` (l. 23-31)

```js
option = { name: String (required), price: Number (required, >= 0), description: String, order }
```

**Trois manques décisifs pour le cas céramique** :
- pas de `mode` → **une option ne peut pas être « sur devis »** ; l'absence de prix se saisit `0`
  et s'affiche « **+0 €** » ([ServicePage.tsx:306-308](../../vitrine/src/pages/ServicePage.tsx#L306)) ;
- pas de `duration`, pas de durabilité, pas de zones ;
- pas d'identité partageable : l'option est un sous-document du pack, donc **recopiée** dans chaque
  pack qui la propose.

### 5.6 `pricedItemSchema` (l. 90-115) — prestations complémentaires **et** suppléments

```js
pricedItem = { name (required), description, mode: 'FIXED'|'QUOTE', price, duration, bookingUrl, order }
```

**Les deux listes `complementaryServices` et `supplements` partagent EXACTEMENT le même schéma.**
La distinction n'est donc pas métier, elle est **présentationnelle** :

- `complementaryServices` → liste aérée avec durée et bouton Réserver
  ([ServicePage.tsx:441-470](../../vitrine/src/pages/ServicePage.tsx#L441)) ;
- `supplements` → pastilles compactes, **durée et lien de réservation volontairement non rendus**
  ([ServicePage.tsx:473-490](../../vitrine/src/pages/ServicePage.tsx#L473), et le commentaire
  explicite dans [ServicesPage.tsx](../../manager/src/pages/ServicesPage.tsx) au-dessus de
  `withDuration`).

Le manager confirme : `withDuration={isComplementary}` — même éditeur, même type, rendu différent.

### 5.7 `PRICING_MODES` ([constants.js:22-25](../../backend/src/utils/constants.js#L22))

```js
export const PRICING_MODES = Object.freeze({
  FIXED: 'FIXED', // prix fixe
  QUOTE: 'QUOTE', // sur devis
});
```

**Deux valeurs. C'est toute la sémantique tarifaire du produit.** Exposé aux frontends via
`GET /meta` ([meta.routes.js:21](../../backend/src/routes/meta.routes.js#L21)).

### 5.8 Modèles connexes

- **`Review.model.js:21-26`** — une note peut référencer `{ serviceId, categoryId, prestationId, label }`
  (ObjectId nus, **sans `ref`**, donc sans intégrité référentielle). Supprimer un pack laisse des
  avis pointant dans le vide. Couplage faible mais réel.
- **`PromotionBanner.model.js`** — aucune relation au catalogue. Les promotions sont des bandeaux
  éditoriaux (texte, couleurs, dates, compte à rebours) : **aucune remise, aucun prix barré, aucun
  lien à un pack**. Il n'existe donc aujourd'hui aucun mécanisme de promotion tarifaire.

---

## 6. API / controllers / services

### 6.1 Endpoints

| Méthode | Route | Auth | Contrôleur |
|---|---|---|---|
| GET | `/api/services` | authentifié | `service.controller.list` — **renvoie tout, publiés ou non** |
| GET | `/api/services/:id` | authentifié | `getOne` |
| POST | `/api/services` | **ADMIN** | `create` — slug auto |
| PUT | `/api/services/:id` | **ADMIN** | `update` — **remplacement du document entier** |
| PATCH | `/api/services/reorder` | **ADMIN** | `reorder` — **jamais appelé par le Manager** (§7.4) |
| DELETE | `/api/services/:id` | **ADMIN** | `remove` |
| GET | `/api/public/bootstrap` | **public** | `public.controller.bootstrap` — `Service.find({ published: true }).sort({ order, createdAt })` (l. 142) |
| GET | `/api/public/services/:slug` | **public** | `getServiceBySlug` — `findOne({ slug, published: true })` (l. 184) |
| GET | `/api/meta` | — | expose `pricingModes` |

Sources : [service.routes.js](../../backend/src/routes/service.routes.js),
[public.routes.js](../../backend/src/routes/public.routes.js),
[public.controller.js:141-186](../../backend/src/controllers/public.controller.js#L141).

### 6.2 Validation — quasi inexistante côté API

```js
export const serviceSchema = {
  body: z.object({ title: z.string().min(1, 'Titre requis') }).passthrough(), // deep structure validated by Mongoose
};
```
[common.validator.js:58-64](../../backend/src/validators/common.validator.js#L58)

**Seul `title` est validé par Zod.** Toute la structure imbriquée — packs, tarifs, options,
modes — n'est contrôlée que par Mongoose (types, `required`, `min: 0`, enum sur `mode`, validateur
HTTPS sur `bookingUrl`).

Conséquences observables :
- aucune règle métier n'est vérifiée : un pack `FIXED` avec `basePrice: 0` et zéro complément est
  accepté et s'affichera « **dès 0 €** » ;
- aucun contrôle d'unicité des `label` de complément dans un pack : deux « SUV » cohabitent ;
- aucune limite de cardinalité (packs, catégories, options) sauf la galerie.

### 6.3 Seule limite quantitative du domaine

```js
function validateGalleries(categories = []) {
  for (const cat of categories) {
    if ((cat.gallery?.length || 0) > MAX_GALLERY_IMAGES) throw ApiError.badRequest(...);
  }
}
```
[service.controller.js:19-28](../../backend/src/controllers/service.controller.js#L19) —
`MAX_GALLERY_IMAGES = 50`. Rien d'autre n'est plafonné.

### 6.4 Écriture : remplacement intégral, dernier écrivain gagnant

`update` fait `Service.findByIdAndUpdate(id, data, { new: true, runValidators: true })`
([service.controller.js:55](../../backend/src/controllers/service.controller.js#L55)) et le Manager
envoie **toujours le document complet**, même pour modifier un seul prix
([ServicesPage.tsx](../../manager/src/pages/ServicesPage.tsx), fonction `saveEdit` : chaque branche
reconstruit `updated = { ...service, categories: cats }` puis appelle `api.updateService`).

Deux administrateurs éditant deux packs différents en parallèle : le second écrase le premier,
silencieusement. Risque réel dès qu'un client a plusieurs comptes ADMIN.

### 6.5 Aucun service applicatif de tarification

Recherche `basePrice` sur tout le dépôt : 14 occurrences, **toutes** en lecture/écriture d'un champ
de formulaire ou d'affichage. **Aucun calcul, aucun total, aucun moteur de prix nulle part**, ni
backend ni frontend.

### 6.6 Amorçage : du catalogue SB Auto codé en dur dans le backend

[bootstrap.js:238-254](../../backend/src/config/bootstrap.js#L238) :

```js
const EXTRA_COMPLEMENTARY = [
  { name: 'Traitement cuir', mode: 'FIXED', price: 45, keywords: ['cuir', 'interieur', 'siege'] },
  { name: 'Lavage moto',     mode: 'FIXED', price: 40, keywords: ['moto', 'exterieur'] },
  { name: 'Lustrage phares', mode: 'FIXED', price: 60, ... },
  { name: 'Polish carrosserie', mode: 'QUOTE', price: 0, ... },
  ... 8 entrées
];
const EXTRA_SUPPLEMENTS = [
  { name: "Poils d'animaux", mode: 'FIXED', price: 10, ... },
  { name: 'Véhicule très sale', mode: 'FIXED', price: 10, keywords: [] },
  ... 5 entrées
];
```

`seedCategoryExtras()` ([bootstrap.js:268-312](../../backend/src/config/bootstrap.js#L268)) répartit
ces 13 entrées dans les catégories existantes **par correspondance de mots-clés sur le titre**,
au démarrage, si aucune catégorie ne porte encore d'extras. Appelé depuis la séquence d'amorçage
(l. 812).

S'y ajoutent `REVIEW_SEED` (20 avis nominatifs fictifs, l. 155-176) et `FAQ_SEED` (5 questions dont
une qui affirme *« Nos tarifs s'adaptent au gabarit du véhicule (citadine, berline, SUV,
monospace) »*, l. 204-227).

**Tout nouveau projet dupliqué démarre donc avec le catalogue d'extras, les avis et la FAQ de
SB Auto.** C'est un obstacle direct à l'industrialisation, et c'est de la donnée client dans du
code applicatif.

### 6.7 Dette de vocabulaire assumée

`migratePrestationsToPacks()` ([bootstrap.js:319-338](../../backend/src/config/bootstrap.js#L319))
renomme `categories[].prestations` → `categories[].packs` via le driver natif. Le mot
« prestation » a donc déjà changé de sens une fois dans l'histoire du projet ; il désigne
aujourd'hui, selon l'endroit : le pack (type TS `Prestation`), une ligne de `includes`, ou un
`pricedItem`. Voir §11.

---

## 7. Manager — ce qui est réellement administrable

Écran : [`manager/src/pages/ServicesPage.tsx`](../../manager/src/pages/ServicesPage.tsx) (arbre
service › catégorie › pack + modales) et
[`PrestationEditor.tsx`](../../manager/src/components/services/PrestationEditor.tsx) (éditeur de pack).
Écran secondaire : [`PricingPage.tsx`](../../manager/src/pages/PricingPage.tsx) (**lecture seule**).

### 7.1 Matrice « possible par le modèle » vs « réellement administrable »

| Capacité | Modèle | Manager | Preuve |
|---|:---:|:---:|---|
| Créer / modifier / supprimer un **service** | ✅ | ✅ | `ServiceModal`, `saveEdit`, `confirmDelete` |
| Titre, description, bannière du service | ✅ | ✅ | `ServiceModal` |
| **Publier / dépublier un service** | ✅ `published` | ❌ | `published` n'apparaît dans le Manager **que** dans la fabrique `newService()` (`: true`). Aucun interrupteur nulle part. |
| **Réordonner les services** | ✅ `order` + endpoint | ❌ | `api.reorderServices` existe ([api.ts:829](../../manager/src/lib/api.ts#L829)) mais **n'est appelé nulle part**. Comparer avec `FaqPage.tsx:38-40` et `BeforeAfterPage.tsx:49-51` qui, eux, utilisent dnd-kit + `arrayMove`. |
| Créer / modifier / supprimer une **catégorie** | ✅ | ✅ | `CategoryModal` |
| **Réordonner les catégories** | ✅ `order` | ❌ | `order` = index de création (`newCategory(service.categories.length)`) |
| Activer / désactiver une catégorie | ❌ | ❌ | Champ inexistant |
| Galerie de catégorie (ajout, ordre, max 50) | ✅ | ✅ | `GalleryManager` (dnd-kit) |
| Créer / modifier / supprimer un **pack** | ✅ | ✅ | `PackModal` + `PrestationEditor` |
| **Réordonner les packs** | ✅ `order` | ❌ | `newPack(c.packs.length)` |
| Activer / désactiver un pack | ❌ | ❌ | |
| Prestations incluses (lignes de texte) | ✅ | ✅ | `addInclude` / `setInclude` / `removeInclude` |
| **Réordonner les lignes incluses** | — | ❌ | Tableau ordonné, mais aucun déplacement dans l'UI |
| Options du pack (nom, prix, description) | ✅ | ✅ | `addOption` / `setOption` |
| **Option « sur devis »** | ❌ | ❌ | `optionSchema` n'a pas de `mode` |
| Badge (activation, libellé, couleur) | ✅ | ✅ | Color picker inclus |
| Mode tarifaire du pack (`FIXED` / `QUOTE`) | ✅ | ✅ | `SegmentedControl` « Prix fixe » / « Sur devis » |
| Prix de base | ✅ | ✅ | |
| **Tarifs par gabarit** (label + prix) | ✅ | ✅ | « Tarifs complémentaires », avec affichage du delta |
| Durée du pack (minutes) | ✅ | ✅ | `DurationField` |
| Lien de réservation externe | ✅ | ✅ | `BookingUrlField`, HTTPS validé |
| Prestations complémentaires (CRUD) | ✅ | ✅ | `PricedListModal` + `PricedItemList` |
| Suppléments (CRUD) | ✅ | ✅ | idem, `withDuration=false` |
| Durée d'une prestation complémentaire | ✅ | ✅ | |
| **Durée d'un supplément** | ✅ (schéma) | ❌ | `withDuration={isComplementary}` — le champ existe en base, l'UI le masque |
| **Lien de réservation d'un supplément** | ✅ (schéma) | ❌ | même garde |
| Description d'un item tarifé | ✅ | ⚠️ | Champ `<Input>` **mono-ligne**, pas un `Textarea` |
| Vue d'ensemble des tarifs | — | ⚠️ | `PricingPage` **lecture seule**, et n'affiche **que les packs** — ni complémentaires, ni suppléments |

### 7.2 Trois écarts modèle/Manager qui comptent

1. **`published` inaccessible** — le modèle sait dépublier, le client ne le peut pas. Pour retirer
   un service du site, il doit le **supprimer** (et perdre son contenu). Le filtre
   `{ published: true }` du bootstrap public n'a donc, en pratique, aucun pilote.
2. **`order` inaccessible partout** — quatre niveaux portent un champ `order`, la vitrine trie
   scrupuleusement dessus (`ServicePage.tsx:62,65,66,68,70,254,255`), et **rien** ne permet de le
   changer. L'ordre du catalogue = l'ordre de création. Pour un catalogue commercial où le forfait
   d'appel doit venir en premier, c'est une limite fonctionnelle nette.
3. **Le tri est déjà implémenté ailleurs** dans le même Manager (FAQ, avant/après, galerie), avec
   dnd-kit. L'écart n'est donc pas technique, il est simplement non fait sur les services.

---

## 8. Site vitrine

### 8.1 Composants et flux

| Élément | Fichier | Endpoint |
|---|---|---|
| Contexte de données | `vitrine/src/context/SiteDataContext` | `GET /api/public/bootstrap` (tout le contenu public, une seule fois) |
| Accueil — bandeau services | [`ServicesShowcase.tsx`](../../vitrine/src/components/ServicesShowcase.tsx) | (depuis le bootstrap) |
| Page service | [`ServicePage.tsx`](../../vitrine/src/pages/ServicePage.tsx) | bootstrap, sinon repli `GET /api/public/services/:slug` (l. 31-36) |
| Carrousel de packs | `Coverflow.tsx` | — |

### 8.2 Structure de rendu de `ServicePage`

```
bannière (bannerImage + title + description)
└── onglets = categories triées par order          (CategoryTabs, l. 207-251)
    └── « N pack(s) » + titre + description de la catégorie + bouton galerie
        ├── Coverflow(packs)                        → PackCard
        ├── « Prestations complémentaires »         → ComplementaryList
        └── « Suppléments »                         → SupplementsList
CTA fixe : « Une question sur ce service ? … Contactez-nous pour un devis personnalisé » → /contact
```

### 8.3 Hypothèses réellement codées dans les composants

| Hypothèse recherchée | Verdict | Preuve |
|---|---|---|
| Exactement 3 packs | **Non** — pas de plafond | `Coverflow` rend `items.map`, largeur de carte fixe + défilement |
| Exactement N catégories | **Non** | Onglets à défilement horizontal, `overflow-x-auto` (l. 223) |
| Chaque prestation a forcément un prix | **Non** | `mode === 'QUOTE'` géré pour packs (l. 318) et items (l. 398) |
| Prix forcément entier | **Non** | `formatPrice` gère les décimales (`value % 1 === 0 ? 0 : 2`) |
| **Tous les prix sont « par véhicule »** | **OUI, implicite** | Aucune unité nulle part ; `formatPrice` retourne un montant nu |
| **Tous les véhicules partagent les mêmes gabarits** | **Non — pire : chaque pack a les siens** | Les `complements` sont locaux au pack, sans référentiel |
| Chaque pack est indépendant | **OUI, structurel** | `includes: [String]`, aucune référence inter-packs |
| Aucun supplément | **Non** | `options[]` + `supplements[]` existent |
| **Aucun prix calculé** | **OUI** | Aucune addition nulle part |
| **Aucun « à partir de »** | **Inverse : il est OBLIGATOIRE** | voir §8.4 |
| Aucune prestation sur devis | **Non** | `QUOTE` géré |

### 8.4 Le défaut d'affichage le plus structurant : « dès » est **codé en dur**

Pack en mode `FIXED` :
```tsx
<span className="text-xs text-muted-foreground">dès</span>
<span className="text-3xl font-extrabold">{formatPrice(p.pricing.basePrice)}</span>
```
[ServicePage.tsx:329-330](../../vitrine/src/pages/ServicePage.tsx#L329)

Item tarifé en mode `FIXED` :
```tsx
<span className="text-muted-foreground">À partir de </span>
<span className="font-bold">{formatPrice(item.price)}</span>
```
[ServicePage.tsx:406-408](../../vitrine/src/pages/ServicePage.tsx#L406)

Et le Manager **nomme le mode lui-même** « À partir de » :
```tsx
options={[{ value: 'FIXED', label: 'À partir de' }, { value: 'QUOTE', label: 'Sur devis' }]}
```
[ServicesPage.tsx:583-584](../../manager/src/pages/ServicesPage.tsx#L583)

**Conséquence exacte** : `FIXED` ne veut pas dire « prix fixe » à l'affichage, il veut dire
« à partir de ». **Il est donc impossible d'annoncer un prix ferme.** Le forfait Simply One à
80 € TTC pour une citadine — un prix ferme dans le catalogue R.L.V — s'affichera « **dès 80 €** ».
Inversement, la cryogénie « à partir de 700 € » sera correcte, mais **par accident**, et sans
qu'aucune donnée ne distingue les deux cas.

### 8.5 Autres dépendances au métier SB Auto

- **Copie automobile en dur** : `HomePage.tsx:134` — *« Du lavage express au detailing complet,
  découvrez nos services pensés pour sublimer votre véhicule »* ; `ServicesShowcase.tsx:93` —
  « Découvrir la prestation » ; `ServicePage.tsx:95` — « Les prestations de ce service seront
  bientôt disponibles » ; `ServicePage.tsx:288` — repli « Prestation complète et soignée. ».
  Aucune n'est administrable. Une section « Nettoyage avions / bateaux » héritera de la promesse
  « sublimer votre véhicule ».
- **Devise et locale figées** : `Intl.NumberFormat('fr-FR', { currency: 'EUR' })`, dupliqué à
  l'identique dans [vitrine/src/lib/utils.ts:8](../../vitrine/src/lib/utils.ts#L8) et
  [manager/src/lib/utils.ts:8](../../manager/src/lib/utils.ts#L8) (les deux applications ne
  partagent aucun paquet — la duplication est documentée dans le commentaire de `hasDuration`).
- **Carte de pack à hauteur fixe** `h-[27rem]` avec défilement interne
  ([ServicePage.tsx:258](../../vitrine/src/pages/ServicePage.tsx#L258)) : les 9 lignes incluses du
  Detailing Stage 1 défileront dans la carte.
- **CTA de devis non contextuel** : le seul bouton devis est un lien statique vers `/contact`
  (l. 189). Le formulaire de contact possède bien un motif `QUOTE`
  (`CONTACT_REASON_VALUES`, `contact.validator.js:105`), mais **rien ne transporte l'identité du
  service ou du pack** — aucun préremplissage, aucun paramètre d'URL lu par `ContactForm.tsx`.
  Le champ `bookingUrl` est un lien de **réservation externe** (SumUp, Calendly), pas un devis.

---

## 9. Source de vérité des données

| Donnée | Source de vérité | Détail |
|---|---|---|
| Services | **MongoDB projet**, collection `services` | Modèle `Service` |
| Catégories (onglets) | MongoDB — sous-document de `Service` | Pas d'existence propre |
| Packs | MongoDB — sous-document de `Category` | Pas d'existence propre |
| Prix de base | MongoDB — `pack.pricing.basePrice` | `Number` nu |
| « Types de véhicules » / gabarits | **MongoDB — `pack.pricing.complements[].label`** | ⚠️ **Chaîne libre, dupliquée dans chaque pack. Aucun référentiel.** |
| Options d'un pack | MongoDB — `pack.options[]` | Sous-document du pack, non partageable |
| Extras (complémentaires / suppléments) | MongoDB — `category.complementaryServices[]` / `.supplements[]` | ⚠️ **Valeurs initiales codées en dur** dans `bootstrap.js:238-254` |
| Ordre d'affichage | MongoDB — champs `order` | ⚠️ **Écrit uniquement par la fabrique du Manager** (index de création). Non éditable. |
| Visibilité | MongoDB — `Service.published` | ⚠️ **Aucune UI**. Rien aux niveaux inférieurs. |
| Description / contenu marketing | MongoDB — `description`, `shortDescription`, `includes[]` | Texte brut, non structuré, pas de HTML/Markdown |
| Modes de tarification (référentiel) | **Code** — `backend/src/utils/constants.js` | Exposé via `GET /meta` |
| Limite galerie (50) | **Code** — `constants.js` | Vérifié dans le contrôleur |
| Devise, locale, format de prix | **Code frontend, dupliqué** | `vitrine/src/lib/utils.ts` + `manager/src/lib/utils.ts` |
| Libellés « dès », « À partir de », « Sur devis » | **Code frontend en dur** | Non administrables |
| Avis & FAQ initiaux | **Code** — `bootstrap.js` | Contenu SB Auto |
| Panel | **Aucune** donnée de catalogue | Ni source, ni copie, ni sauvegarde |

**Read-model intermédiaire** : le seul est `projectServicesMedia()` /
`projectServiceMedia()` ([public.controller.js:161-186](../../backend/src/controllers/public.controller.js#L161))
qui **résout les URLs de médias à la lecture** — jamais des prix ni de la structure métier. Aucune
projection, aucun cache, aucune dénormalisation tarifaire.

**Duplication frontend/backend** : les types TypeScript sont recopiés à l'identique dans
`vitrine/src/types.ts` (l. 46-113) et `manager/src/types/index.ts` (l. ~360-435). Toute évolution
du schéma se répercute manuellement dans trois fichiers.

---

## 10. Diagramme du modèle actuel

Le diagramme suivant décrit le code réellement lu — pas un modèle idéalisé.

```text
┌──────────────────────────────────────────────────────────────────┐
│ Service                          (collection MongoDB `services`) │
│  title · slug(unique) · description · bannerImage(+Media)        │
│  order · published · timestamps                                  │
└───────────────┬──────────────────────────────────────────────────┘
                │ 1:N  (tableau imbriqué — PAS de collection)
                ▼
┌──────────────────────────────────────────────────────────────────┐
│ Category   « onglet de la page », PAS une catégorie de véhicule  │
│  title · description · gallery[≤50] · order                      │
│  (aucun champ de publication)                                    │
└───┬───────────────────────┬──────────────────────┬───────────────┘
    │ 1:N                   │ 1:N                  │ 1:N
    ▼                       ▼                      ▼
┌──────────────────┐  ┌───────────────────┐  ┌───────────────────┐
│ Pack             │  │ complementary     │  │ supplements[]     │
│  name            │  │ Services[]        │  │                   │
│  shortDescription│  │                   │  │  ← MÊME SCHÉMA →  │
│  includes[String]│  │  PricedItem       │  │  PricedItem       │
│  order · duration│  │   name            │  │   name            │
│  bookingUrl      │  │   description     │  │   description     │
│                  │  │   mode FIXED|QUOTE│  │   mode FIXED|QUOTE│
│  ┌─────────────┐ │  │   price · duration│  │   price · duration│
│  │ badge       │ │  │   bookingUrl      │  │   bookingUrl      │
│  │ enabled     │ │  │   order           │  │   order           │
│  │ label,color │ │  └───────────────────┘  └───────────────────┘
│  └─────────────┘ │   rendu : liste + durée   rendu : pastilles
│                  │                            (durée MASQUÉE)
│  ┌─────────────┐ │
│  │ options[]   │ │  name · price(REQUIS) · description · order
│  └─────────────┘ │  ✗ pas de mode  ✗ pas de durée  ✗ non partageable
│                  │
│  ┌─────────────────────────────────────────┐
│  │ pricing                                 │
│  │  mode : FIXED | QUOTE       (2 valeurs) │
│  │  basePrice : Number                     │
│  │  complements[] : { label, price, order }│  ← LA grille par gabarit
│  └─────────────────────────────────────────┘     (prix ABSOLUS,
└──────────────────┘                                labels LIBRES,
                                                    LOCAUX au pack)

ABSENTS DU MODÈLE :
  ✗ VehicleCategory (entité)      ✗ Prestation élémentaire (entité)
  ✗ Composition Pack → Pack       ✗ Option partagée entre packs
  ✗ Règle tarifaire / total       ✗ Unité de facturation
  ✗ Durabilité / zones traitées   ✗ Conditions / exclusions / fiscalité
  ✗ Publication sous le Service   ✗ Toute relation avec le Panel
```

---

## 11. Taxonomie métier actuelle

### 11.1 Ce que le vocabulaire du code recouvre réellement

| Concept métier attendu | Existe ? | Porté par | Sémantique réelle |
|---|:---:|---|---|
| **Famille métier** (Lavage, Detailing, Sinistre…) | ~ | `Service` | En réalité une **page publique** avec slug, bannière, SEO. Fait aussi office de famille par convention. |
| **Service** au sens commercial | ✗ | — | Le mot désigne la page, pas une offre. |
| **Forfait commercial** | ✅ | `Pack` | Correct. Type TS nommé `Prestation` (héritage). |
| **Prestation élémentaire** (« nettoyage vitres ») | ✗ | `pack.includes[i]` — **une `String`** | Aucune identité, aucune réutilisation, aucun prix propre. |
| **Prestation complémentaire** (vendue à l'unité) | ✅ | `category.complementaryServices[]` | Correct — mais rattachée à une **catégorie**, jamais à un pack. |
| **Option d'un forfait** | ⚠️ | `pack.options[]` | Existe, mais enfermée dans un pack, sans mode tarifaire. |
| **Supplément** | ⚠️ | `category.supplements[]` | **Schéma identique** aux complémentaires ; la différence est un style d'affichage. |
| **Variante d'une prestation** (châssis court/long) | ✗ | détourné en `complements[]` | Se mélange aux gabarits dans le même champ. |
| **Catégorie de véhicule / gabarit** | ✗ | `complements[].label` (String) | Pas une entité. Pas de référentiel. Locale au pack. |
| **Règle tarifaire** | ✗ | — | Il n'y a que des valeurs, jamais de règle. |
| **Onglet de présentation** | ✅ | `Category` | Le nom `Category` désigne **cela**, et non une taxonomie. |

### 11.2 Les trois collisions de vocabulaire à connaître

1. **`Category`** = onglet de page, **pas** catégorie de véhicule ni famille métier.
2. **`Prestation`** (type TypeScript) = **pack**, tandis que « prestation » dans l'UI Manager
   (« Prestations incluses », « Prestations complémentaires ») désigne deux autres choses.
   La migration `prestations → packs` ([bootstrap.js:319](../../backend/src/config/bootstrap.js#L319))
   témoigne du glissement.
3. **`complements`** (dans `pricing`) = **grille de prix par gabarit**, sans rapport avec
   **`complementaryServices`** = prestations vendues à l'unité. Deux mots quasi identiques pour
   deux notions sans lien.

Ces collisions ne sont pas cosmétiques : elles expliquent pourquoi le modèle *paraît* couvrir
plus de besoins qu'il n'en couvre réellement.

---

## 12. Matrice de compatibilité R.L.V Detail

Niveaux : `NATIF` · `POSSIBLE MAIS DÉTOURNÉ` · `PARTIEL` · `NON SUPPORTÉ`.
Colonne **Donnée** : `structurée` = champ typé et exploitable ; `texte libre` = seulement
descriptible en prose (au sens de l'exigence §18 : ce n'est **pas** du support structurel).

| # | Besoin R.L.V Detail | Support actuel | Niveau | Donnée | Preuve code | Limitation |
|---|---|---|---|---|---|---|
| 1 | Catégorie de service | `Service.categories[]` | **NATIF** | structurée | `Service.model.js:117-128` | C'est un onglet, pas une taxonomie ; pas d'activation |
| 2 | Forfait | `Category.packs[]` | **NATIF** | structurée | `Service.model.js:57-86` | — |
| 3 | Forfait avec liste de prestations | `pack.includes` | **PARTIEL** | **texte libre** | `Service.model.js:61` — `[String]` | Chaque ligne est une chaîne : ni réutilisable, ni tarifable, ni référençable |
| 4 | Gabarits Citadine / Berline / Sportive-SUV / Supercar | `complements[].label` | **POSSIBLE MAIS DÉTOURNÉ** | structurée mais **locale** | `Service.model.js:14-21` | Libellés libres ressaisis **dans chaque pack** ; aucun référentiel ; aucune cohérence garantie |
| 5 | Prix différent par gabarit | `complements[].price` (absolu) | **NATIF** | structurée | `PrestationEditor.tsx:255-294` ; `ServicePage.tsx:336-345` | Le gabarit du `basePrice` n'a **pas de libellé** (voir §13.1) |
| 6 | **Forfait reprenant le contenu d'un autre** (R.L.V. + ⊃ Simply One) | — | **NON SUPPORTÉ** | — | `Service.model.js:61` | Aucune référence pack→pack. Duplication des lignes, ou lien purement textuel |
| 7 | Prestation complémentaire | `category.complementaryServices[]` | **NATIF** | structurée | `Service.model.js:123` | Rattachée à la catégorie, jamais à un pack |
| 8 | Supplément fixe | `category.supplements[]` | **NATIF** | structurée | `Service.model.js:124` | Schéma identique aux complémentaires ; durée et lien masqués à l'affichage |
| 9 | Supplément dépendant d'un forfait | `pack.options[]` | **PARTIEL** | structurée | `Service.model.js:23-31` | Pas de `mode` (donc jamais « sur devis »), pas de durée, non partageable |
| 10 | **Tarif final = base + supplément** | — | **NON SUPPORTÉ** | — | aucune occurrence de calcul sur `basePrice` dans tout le dépôt | L'option s'affiche « +250 € » ; l'addition est laissée au visiteur, et n'est jamais faite **par gabarit** |
| 11 | Prix « à partir de » | `FIXED` rendu « dès » / « À partir de » | **PARTIEL — imposé** | **non distinguable** | `ServicePage.tsx:329,407` ; `ServicesPage.tsx:583` | Le « à partir de » est **le seul rendu possible** : impossible d'afficher un prix ferme |
| 12 | Prestation uniquement sur devis | `mode: 'QUOTE'` | **NATIF** (pack, complémentaire, supplément) / **NON SUPPORTÉ** (option) | structurée | `constants.js:22-25` ; `Service.model.js:94` | Une option sans prix affiche « **+0 €** » |
| 13 | **Prix ET sur devis** (« à partir de 700 € — sur devis ») | — | **NON SUPPORTÉ** | — | `PrestationEditor.tsx:302-305` : *« le tarif de base reste enregistré mais non affiché »* | Les deux modes sont **exclusifs** : choisir `QUOTE` masque le montant |
| 14 | Service sans prix public | `QUOTE` | **PARTIEL** | structurée | idem | Aucun CTA devis attaché à l'élément (§8.5) |
| 15 | **Unité € / jour** | — | **NON SUPPORTÉ** | **texte libre** | `formatPrice` (`utils.ts:8`) rend un montant nu | Aucun champ d'unité ; « /jour » ne peut aller que dans une description |
| 16 | Prestation avion | modélisable en `Service`/`Pack` | **PARTIEL** | structurée + **copie inadaptée** | `HomePage.tsx:134`, `ServicesShowcase.tsx:93` | La vitrine promet en dur de « sublimer votre véhicule » ; la FAQ semée parle de gabarits automobiles |
| 17 | Prestation bateau | idem | **PARTIEL** | idem | idem | idem |
| 18 | Critères châssis court / châssis long | `complements[].label` | **POSSIBLE MAIS DÉTOURNÉ** | structurée | `Service.model.js:16` | Un seul et même champ sert les gabarits véhicule **et** les critères ad hoc : aucune distinction possible |
| 19 | **Durabilité 1 / 2 / 5 ans** | — | **NON SUPPORTÉ** | **texte libre** | `pack.duration` = **minutes** (`Service.model.js:65-68`) ; `option` n'a aucune durée | La seule durée du modèle est celle de la prestation, pas celle du produit |
| 20 | **Zones traitées** (carrosserie / vitres / jantes) | — | **NON SUPPORTÉ** | **texte libre** | aucun champ liste hors `includes[String]` | |
| 21 | Notes commerciales | `shortDescription`, `description` | **PARTIEL** | **texte libre** | `Service.model.js:60,93` ; UI : `<Input>` mono-ligne pour les items (`ServicesPage.tsx` `PricedItemList`) | Une seule zone par objet, non formatée |
| 22 | **Conditions** | — | **NON SUPPORTÉ** | **texte libre** | aucun champ | |
| 23 | **Exclusions** (« hors produits de lustrage ») | — | **NON SUPPORTÉ** | **texte libre** | aucun champ | |
| 24 | **Mention TTC** | — | **NON SUPPORTÉ** | — | `TTC`/`TVA` n'existent que dans le domaine contrat L.Y↔client (`PriceRecap.tsx`, `subscriptionPricing.ts`), **jamais** dans le catalogue | Aucun régime fiscal, aucun suffixe, aucun réglage site |
| 25 | Tarif variable selon l'état du véhicule | `supplements` (« Véhicule très sale ») | **POSSIBLE MAIS DÉTOURNÉ** | structurée | `bootstrap.js:250` | C'est une ligne à plat, pas une règle : aucun lien avec un pack, aucun conditionnement |
| 26 | CTA « Demander un devis » | CTA global statique | **PARTIEL** | — | `ServicePage.tsx:183-195` ; `ContactForm.tsx` ne lit aucun paramètre | Pas de CTA par élément ; `bookingUrl` = réservation, pas devis |
| 27 | Service autonome | `Service` / `Pack` / `PricedItem` | **NATIF** | structurée | — | — |
| 28 | Prestation rattachée à un forfait | `pack.options[]` | **NATIF** (avec les limites #9) | structurée | — | — |
| 29 | **Option rattachée à plusieurs forfaits** | — | **NON SUPPORTÉ** | — | `options` est un sous-document du pack | Duplication obligatoire, dérive garantie |
| 30 | Ordre d'affichage | champs `order` partout | **PARTIEL** | structurée | `api.ts:829` (endpoint) **jamais appelé** ; aucun dnd dans `ServicesPage.tsx` | Ordre = ordre de création, non modifiable par le client |
| 31 | Activation / désactivation | `Service.published` seulement | **PARTIEL → NON SUPPORTÉ en pratique** | structurée | aucune UI (`grep published manager/src` → fabrique uniquement) | Rien sous le service ; pour masquer, il faut supprimer |
| 32 | **Gestion complète depuis le Manager** | — | **PARTIEL** | — | §7.1 | Publication, ordre, options sur devis, durée des suppléments : inaccessibles |

### Synthèse de la matrice

| Niveau | Nombre |
|---|---|
| **NATIF** | 8 |
| **POSSIBLE MAIS DÉTOURNÉ** | 4 |
| **PARTIEL** | 11 |
| **NON SUPPORTÉ** | 9 |

Sur les 32 besoins, **9 exigeraient du texte libre en guise de modèle** (#3, #15, #19, #20, #21,
#22, #23 + partiellement #16/#17) — c'est précisément ce que la commande refuse de compter comme
du support (§18).

---

## 13. Simulation complète de R.L.V dans le modèle actuel

Encodage conceptuel, avec les **vrais champs** du schéma. Aucune écriture n'a été faite.

### Structure d'accueil retenue

```text
Service #1  title: "Nettoyage & Detailing"          slug: nettoyage-detailing  published: true
   Category "Forfaits"          → packs: Simply One, R.L.V. +, Detailing Stage 1
   Category "Protections céramiques" → packs QUOTE + complementaryServices
Service #2  title: "Cryogénie"
   Category "Nettoyage cryogénique"  → pack Cryogénie (2 variantes) + supplément anti-corrosion
Service #3  title: "Aéronautique & Nautisme"
   Category "Avions & bateaux"       → pack QUOTE
Service #4  title: "Prestations à la demande"
   Category "À la carte"             → complementaryServices (PPF, déstickage, ozone, céramiques…)
```

---

### 13.1 Forfait **Simply One**

```yaml
Service("Nettoyage & Detailing").categories[0]="Forfaits".packs[0]:
  name: "Simply One"
  shortDescription: ""                       # rien à y mettre… ou tout, cf. plus bas
  includes:
    - "Nettoyage à la main carrosserie / jantes"
    - "Aspiration moquette et tapis"
    - "Nettoyage vitres"
    - "Nettoyage plastiques habitacle"
    - "Brillant pneu"
  options: []
  badge: { enabled: false, label: "", color: "#111827" }
  duration: null
  bookingUrl: null
  order: 0
  pricing:
    mode: FIXED
    basePrice: 80                            # = le prix Citadine, mais SANS LIBELLÉ
    complements:
      - { label: "Citadine",       price: 80,  order: 0 }   # ← DÉTOURNEMENT : recopie du basePrice
      - { label: "Berline",        price: 90,  order: 1 }
      - { label: "Sportive / SUV", price: 100, order: 2 }
      - { label: "Supercar",       price: 110, order: 3 }
```

**Rendu vitrine obtenu** : « **dès 80 €** » + 4 pastilles `Citadine 80 € · Berline 90 € ·
Sportive / SUV 100 € · Supercar 110 €`.

| Écart | Statut |
|---|---|
| Le gabarit associé à `basePrice` n'a pas de libellé | **DÉTOURNEMENT** — il faut recréer « Citadine 80 € » en complément, donc **stocker 80 € deux fois**. Sans ce doublon, le visiteur ne sait pas à quoi correspond le prix mis en avant. |
| Prix ferme annoncé « dès » | **INFORMATION PERDUE** — le catalogue R.L.V donne un prix ferme par gabarit |
| Mention TTC | **INFORMATION PERDUE** |
| Les 4 libellés de gabarit | **DUPLICATION** — à ressaisir dans chacun des packs suivants |

---

### 13.2 Forfait **R.L.V. +**

```yaml
  packs[1]:
    name: "R.L.V. +"
    includes:
      # ── OPTION A : recopie intégrale ──
      - "Nettoyage à la main carrosserie / jantes"     # ⧉ copie de Simply One
      - "Aspiration moquette et tapis"                 # ⧉
      - "Nettoyage vitres"                             # ⧉
      - "Nettoyage plastiques habitacle"               # ⧉
      - "Brillant pneu"                                # ⧉
      - "Nettoyage des sièges injecteur / extracteur"
      - "Désinfection habitacle à l'ozone"
      - "Cire rapide Gyeon Q2M Quick Detailer"
      # ── OPTION B : ligne textuelle ──
      # - "Tout le forfait Simply One"   ← lien non vérifiable, casse en silence
    pricing:
      mode: FIXED
      basePrice: 190
      complements:
        - { label: "Citadine",       price: 190, order: 0 }   # ⧉ libellés reressaisis
        - { label: "Berline",        price: 210, order: 1 }
        - { label: "Sportive / SUV", price: 240, order: 2 }
        - { label: "Supercar",       price: 260, order: 3 }
```

> ### `IMPOSSIBLE SANS DÉTOURNEMENT`
> **« Ce forfait comprend un autre forfait + des prestations supplémentaires » n'existe pas dans
> le modèle.** `includes` est un `[String]` ([Service.model.js:61](../../backend/src/models/Service.model.js#L61)).
>
> - **Option A** (recopie) : une modification de Simply One doit être répercutée à la main dans
>   R.L.V. + — et dans tout autre forfait qui l'inclura. Dérive garantie.
> - **Option B** (ligne de texte) : le lien n'est qu'un mot. Renommer « Simply One » ne met rien à
>   jour, et le visiteur ne voit plus le détail de ce qu'il achète.
>
> `INFORMATION PERDUE` : la **relation d'inclusion** elle-même.

---

### 13.3 **Detailing Stage 1**

```yaml
Service("Nettoyage & Detailing").categories[0]="Forfaits".packs[2]:
  name: "Detailing Stage 1"
  shortDescription: "Correction en une phase — élimination de 50 à 80 % des rayures.
                     Protection Gyeon Q2 Wax ou Q2 Can Coat, durabilité ~1 an."   # ← fourre-tout
  includes:
    - "Prélavage"
    - "Lavage à la main"
    - "Décontamination carrosserie"
    - "Masquage du véhicule"
    - "Correction en une phase"
    - "Lustreuse roto-orbitale"
    - "Polish all-in-one"
    - "Élimination de 50 à 80 % des rayures"        # ⚠ un RÉSULTAT dans une liste de tâches
    - "Pose cire Gyeon Q2 Wax ou Q2 Can Coat"       # ⚠ une VARIANTE PRODUIT dans une liste
  duration: null       # la durée du chantier n'est pas au catalogue ; le champ ne sert pas ici
  pricing:
    mode: FIXED
    basePrice: 500
    complements:
      - { label: "Citadine",       price: 500,  order: 0 }
      - { label: "Berline",        price: 650,  order: 1 }
      - { label: "Sportive / SUV", price: 800,  order: 2 }
      - { label: "Supercar",       price: 1200, order: 3 }
```

| Donnée demandée | Statut |
|---|---|
| Contenu du forfait | ✅ structuré (mais en chaînes) |
| Caractéristiques (roto-orbitale, polish AIO) | ⚠️ mélangées aux tâches dans `includes` |
| Bénéfices / résultat annoncé (« 50 à 80 % ») | **`INFORMATION PERDUE`** — aucun champ ; noyé dans `includes` ou `shortDescription` |
| Informations marketing | ⚠️ une seule zone `shortDescription` |
| Durée | ⚠️ le champ existe mais en **minutes** ; la durée d'un Stage 1 n'est pas dans le catalogue R.L.V |
| **Durabilité ~1 an** | **`INFORMATION PERDUE`** — `duration` = minutes de prestation, pas durabilité produit |
| **Variantes produit (Q2 Wax *ou* Q2 Can Coat)** | **`INFORMATION PERDUE`** — aucune notion de variante ; une chaîne « ou » |

---

### 13.4 Protections céramiques — **le cas décisif**

Besoin exprimé : `prix final = prix Stage 1 (selon gabarit) + supplément céramique`.

#### Encodage A — options du pack Stage 1 *(le plus proche de l'intention)*

```yaml
  packs[2].options:
    - { name: "Céramique One",
        price: 250, order: 0,
        description: "Durée 1 an — carrosserie" }                       # texte libre
    - { name: "Céramique Passion",
        price: 350, order: 1,
        description: "Durée 2 ans — carrosserie + vitres" }             # texte libre
    - { name: "Céramique Detailing One",
        price: 450, order: 2,
        description: "Durée 5 ans — carrosserie + jantes + vitres" }    # texte libre
```

**Rendu vitrine** : dans l'encadré « Options » de la carte Stage 1, trois lignes
`Céramique One … +250 €`.

| Point | Statut |
|---|---|
| Supplément **fixe** | ✅ **NATIF** |
| **Dépendance à un forfait donné** | ✅ **NATIF** — l'option vit dans le pack Stage 1 |
| **Prix final calculé** | **`NON SUPPORTÉ`** — rien n'additionne. Un client Supercar lit « dès 500 € », des pastilles jusqu'à 1 200 €, et « +450 € » : **il n'existe aucun endroit du produit où « 1 650 € » est écrit ou calculable** |
| **Durées 1 / 2 / 5 ans** | **`INFORMATION PERDUE`** — texte libre dans `description` (champ `<Input>` mono-ligne côté Manager) |
| **Zones traitées** | **`INFORMATION PERDUE`** — texte libre |
| Protection **sur devis** (cas des céramiques cuir / alcantara / tissu, sans prix public) | **`IMPOSSIBLE SANS DÉTOURNEMENT`** — `optionSchema` n'a pas de `mode` et `price` est `required` → `price: 0` → la vitrine affiche « **+0 €** » |
| Les céramiques doivent aussi être proposées **hors Stage 1** (elles figurent aux « prestations à la demande ») | **DUPLICATION** — il faut les recréer en `complementaryServices` : deux jeux de données à maintenir |
| Céramique après **2 ou 3 phases de correction** (80-100 % des rayures) | **`INFORMATION PERDUE`** — ce niveau de correction n'existe pas comme forfait tarifé ; il faudrait un pack `QUOTE` supplémentaire, et les mêmes options y seraient **recopiées une troisième fois** |

#### Encodage B — packs dédiés *(explicitement refusé par la commande)*

Créer « Céramique One Citadine », « Céramique One Berline »… **n'est pas nécessaire** : le modèle
sait déjà porter un prix par gabarit. **Ce détournement-là n'est donc pas requis** — et c'est un
vrai point positif de l'architecture.

Mais si l'on voulait publier le **prix final** (Stage 1 + céramique) plutôt qu'une addition à la
charge du visiteur, il faudrait un pack par couple (base × protection) — voir §15.

---

### 13.5 **Cryogénie**

```yaml
Service("Cryogénie").categories[0]="Nettoyage cryogénique":
  packs[0]:
    name: "Nettoyage cryogénique"
    shortDescription: "Sur devis."                        # ← la seule place pour « sur devis »
    includes: []
    pricing:
      mode: FIXED                                          # forcé : QUOTE masquerait le montant
      basePrice: 700
      complements:
        - { label: "Châssis court / 3 portes",              price: 700,  order: 0 }
        - { label: "Châssis long / 5 portes ou pick-up",    price: 1000, order: 1 }
    options:
      - { name: "Traitement châssis anti-corrosion", price: 0, description: "En supplément — sur devis" }
```

**Rendu obtenu** : « dès 700 € » + deux pastilles + une option « **+0 €** ».

| Point | Statut |
|---|---|
| Prix « à partir de » | ✅ **par accident** — `FIXED` est toujours rendu « dès » |
| Variantes d'une même prestation | ✅ via `complements` |
| Critères **non-gabarit** (châssis court/long) | **DÉTOURNEMENT** — le champ `label` est le même que celui des gabarits véhicule ; rien ne distingue « Supercar » de « Châssis long ». Le jour où une prestation croise les deux axes, le modèle ne peut plus. |
| **« à partir de 700 € » ET « sur devis »** | **`IMPOSSIBLE SANS DÉTOURNEMENT`** — modes exclusifs. Le « sur devis » finit dans `shortDescription`. |
| **Supplément anti-corrosion sans prix** | **`IMPOSSIBLE SANS DÉTOURNEMENT`** — affiche « +0 € ». Contournement : le sortir en `supplements[]` de la catégorie en `mode: QUOTE`, mais il **perd alors son rattachement** à la cryogénie et devient un supplément de toute la catégorie. |

---

### 13.6 **Avions / bateaux**

Énoncé : *« Nettoyage avions / bateaux sur devis, à partir de 300 € par jour, hors produits de
nettoyage ou lustrage. »*

```yaml
Service("Aéronautique & Nautisme").categories[0]="Avions & bateaux":
  packs[0]:
    name: "Nettoyage avions / bateaux"
    shortDescription: "Sur devis — à partir de 300 € par jour, hors produits de nettoyage
                       ou de lustrage."                    # ← TOUT le métier est ici, en prose
    pricing: { mode: QUOTE, basePrice: 0, complements: [] }
```

| Donnée | Statut |
|---|---|
| Prestation hors automobile | ✅ modélisable… |
| …mais présentation | ⚠️ la page d'accueil promet en dur de « **sublimer votre véhicule** » (`HomePage.tsx:134`) |
| **Unité tarifaire « par jour »** | **`NON SUPPORTÉ`** → `INFORMATION PERDUE` (texte libre) |
| **Montant 300 €** | **`INFORMATION PERDUE`** — en mode `QUOTE`, le montant est **enregistré mais non affiché** (`PrestationEditor.tsx:302-305`). Il ne peut donc vivre que dans la prose. |
| « À partir de » + devis obligatoire | **`IMPOSSIBLE SANS DÉTOURNEMENT`** (modes exclusifs) |
| **Exclusions** (« hors produits ») | **`NON SUPPORTÉ`** → texte libre |
| CTA devis | ⚠️ CTA générique de bas de page uniquement |

---

### 13.7 **PPF et prestations à la demande**

```yaml
Service("Prestations à la demande").categories[0]="À la carte".complementaryServices:
  - { name: "Protection par film PPF",           mode: QUOTE, price: 0, description: "", order: 0 }
  - { name: "Déstickage publicitaire",           mode: QUOTE, price: 0, order: 1 }
  - { name: "Traitement habitacle à l'ozone",    mode: QUOTE, price: 0, order: 2 }
  - { name: "Protection céramique vitres",       mode: QUOTE, price: 0, order: 3 }   # ⧉ doublon 13.4
  - { name: "Protection céramique jantes",       mode: QUOTE, price: 0, order: 4 }   # ⧉
  - { name: "Protection céramique cuir",         mode: QUOTE, price: 0, order: 5 }
  - { name: "Protection céramique alcantara",    mode: QUOTE, price: 0, order: 6 }
  - { name: "Protection céramique tissu",        mode: QUOTE, price: 0, order: 7 }
  - { name: "Protection céramique automobile",   mode: QUOTE, price: 0, order: 8 }   # ⧉
  - { name: "Protection céramique avion",        mode: QUOTE, price: 0, order: 9 }
  - { name: "Protection céramique bateau",       mode: QUOTE, price: 0, order: 10 }
```

| Point | Statut |
|---|---|
| Prestation sans prix + « Sur devis » | ✅ **NATIF** |
| Description | ✅ (mais `<Input>` mono-ligne côté Manager) |
| Rattachement à une catégorie | ✅ |
| **Rattachement optionnel à un forfait** | ✗ un `complementaryService` ne peut **jamais** être une option d'un pack ; ce sont deux schémas distincts et deux emplacements distincts |
| **CTA « Demander un devis »** | **`NON SUPPORTÉ`** au niveau de l'élément — un seul CTA statique en bas de page |
| Doublon avec les options céramiques du Stage 1 | **DUPLICATION** structurelle |

---

### 13.8 Les autres familles annoncées (§8 de la commande)

Après incendie / inondation / sinistre, agrément assurance, retour leasing, préparation VO/VN,
sortie de grange, nettoyage sièges tissu / alcantara / cuir, ozone, déstickage.

Toutes sont modélisables — **en tant que packs `QUOTE` ou prestations complémentaires**. Mais :

- rien ne distingue une **famille métier** (« Après-sinistre ») d'un **onglet de présentation** :
  les deux sont un `Category` ;
- l'agrément assurance, la conformité leasing, le caractère « expertise » sont
  **`NON SUPPORTÉ`** → texte libre ;
- « nettoyage sièges tissu / alcantara / cuir » sont trois prestations élémentaires que le modèle
  ne sait exprimer que comme trois `complementaryServices` **ou** trois chaînes dans `includes`,
  jamais comme une même prestation déclinée.

---

### 13.9 Bilan de la simulation

| Symbole | Occurrences dans la simulation |
|---|---|
| `IMPOSSIBLE SANS DÉTOURNEMENT` | 5 — inclusion de forfait, option sur devis (×2), « prix + devis » (×2) |
| `INFORMATION PERDUE` | 11 — TTC, prix ferme, durabilité, zones, variantes produit, résultat annoncé, unité €/jour, montant en mode devis, exclusions, relation d'inclusion, prix final |
| `DUPLICATION` imposée | 4 — libellés de gabarit (× packs), contenu Simply One, céramiques (options ↔ à la carte), prix Citadine (basePrice + complément) |

---

## 14. Limitations / détournements nécessaires — récapitulatif

| # | Limitation | Détournement obligatoire | Coût |
|---|---|---|---|
| L1 | Pas de référentiel de gabarits | Ressaisir 4 libellés dans chaque pack | Erreurs de frappe, incohérences d'affichage, renommage impossible à l'échelle |
| L2 | `basePrice` sans libellé | Créer un complément qui recopie le prix de base | Un prix stocké deux fois : deux endroits à corriger |
| L3 | Pas de composition de forfaits | Recopier les lignes, ou écrire un lien textuel | Dérive silencieuse du contenu |
| L4 | Option sans `mode` | `price: 0` → « +0 € », ou sortir l'option en supplément de catégorie | Affichage faux, ou perte du rattachement |
| L5 | Option non partageable | Recopier dans chaque pack | N copies pour une remise à jour |
| L6 | `FIXED` = « à partir de » en dur | Aucun | Impossible d'annoncer un prix ferme |
| L7 | `QUOTE` masque le montant | Écrire le montant dans la description | Le prix devient de la prose : non triable, non formatable, non exploitable |
| L8 | Pas d'unité | « / jour » dans la description | idem |
| L9 | Pas de durabilité / zones / exclusions / conditions / TTC | Tout en description | idem — et c'est exactement ce que §18 refuse |
| L10 | Pas de total | Aucun | Le visiteur additionne, ou on crée des packs combinés (§15) |
| L11 | Pas d'ordre éditable | Créer les objets dans le bon ordre… et ne jamais se tromper | Réorganiser = tout recréer |
| L12 | Pas de dépublication | Supprimer | Perte de contenu ; toute saisonnalité impose une resaisie |
| L13 | Écriture par document entier | Aucun | Écrasement silencieux entre deux ADMIN |
| L14 | Copie vitrine automobile en dur | Aucun | Incohérent pour avions / bateaux / après-sinistre |
| L15 | Seeds SB Auto au démarrage | Nettoyer à la main le catalogue d'un nouveau client | Manuel, oubliable, répété à chaque projet |

---

## 15. Risques de duplication et explosion combinatoire

### 15.1 Explosion combinatoire — chiffrée

**Le modèle évite la pire des explosions.** Le prix par gabarit étant natif, il **ne faut PAS**
créer « Céramique One Citadine », « Céramique One Berline »… Ce détournement, explicitement rejeté
par la commande (§4), n'est **pas** imposé par l'architecture. C'est le point fort du modèle.

**Mais une explosion apparaît dès qu'on veut publier un prix final.** Pour afficher
« Stage 1 + Céramique Passion, Berline = 1 000 € » — c'est-à-dire pour que le catalogue porte le
prix que le client paiera —, il faut un pack par combinaison :

| Scénario | Packs nécessaires | Copies du contenu Stage 1 |
|---|---|---|
| Aujourd'hui (options non additionnées) | 1 | 1 |
| Prix final publié, 1 stage × 3 protections | **4** (1 nu + 3 combinés) | **4** |
| 3 stages de detailing × 3 protections | **12** | **12** |
| … et si un jour un 5ᵉ gabarit apparaît | 12 packs × 5 lignes = **60 saisies tarifaires**, et 12 packs à rouvrir | |

Chaque pack combiné duplique les **9 lignes `includes`** du Stage 1 → jusqu'à **108 chaînes** à
maintenir de façon cohérente pour 12 packs. Une correction de libellé devient une opération à
douze endroits.

### 15.2 Duplication — quatre foyers identifiés

1. **Contenu de forfait** — Simply One ⊂ R.L.V. +. Modifier une ligne dans Simply One n'a **aucun**
   effet sur R.L.V. +. Réponse directe à la question posée : **oui, la modification doit être
   répétée à la main**.
2. **Libellés de gabarit** — 4 libellés × nombre de packs. Chez R.L.V : 3 packs de forfaits →
   12 saisies pour 4 notions.
3. **Options céramiques** — présentes comme options du Stage 1 **et** comme prestations à la
   demande : deux jeux de prix pour les mêmes produits.
4. **Types TypeScript** — `Prestation`, `PricedItem`, `Category`, `Service` recopiés dans
   `vitrine/src/types.ts` et `manager/src/types/index.ts` ; `formatPrice` recopié dans deux
   `lib/utils.ts`. Duplication de code, pas de donnée, mais même effet : trois fichiers à modifier
   pour un champ.

### 15.3 Couplage présentation / métier

| Élément | Où | Verdict |
|---|---|---|
| `badge { enabled, label, color }` | **dans `packSchema`**, à côté de `pricing` | **Couplage confirmé.** Une couleur hexadécimale (`#111827`) et un libellé marketing (« La plus choisie ») siègent dans l'entité tarifaire. Pas de `popular` / `featured` / `bestSeller` — c'est un badge libre, donc plus souple qu'un booléen figé, mais le style vit dans le modèle métier. |
| Distinction `complementaryServices` / `supplements` | schéma **identique**, rendus différents | **Couplage confirmé** — une décision de mise en page (liste vs pastilles) est encodée comme deux champs de données. Le client choisit une **apparence** en croyant choisir une **nature**. |
| `bookingUrl` | dans le pack et l'item | Acceptable (donnée métier), mais son rendu (« Réserver ») est en dur |
| Durée des suppléments | stockée, **jamais affichée** | Donnée fantôme : saisissable par API, invisible partout |
| « dès » / « À partir de » | code vitrine | **Couplage confirmé** — une règle commerciale (le prix est-il ferme ?) est décidée par le CSS |

### 15.4 Rigidité des catégories de véhicule — réponse directe

> *Peut-on avoir Citadine/Berline/SUV/Supercar chez un client, Petit/Grand/Utilitaire chez un
> autre, et châssis court/long pour une prestation spécifique ?*

**Oui, techniquement — et c'est un vrai atout.** `complements[].label` est une chaîne libre : chaque
client, chaque pack, met ce qu'il veut.

**Mais le prix de cette souplesse est l'absence totale de garantie** :
- rien n'impose la cohérence entre deux packs du même client (« SUV » ici, « Sportive / SUV » là) ;
- rien ne distingue un **axe** tarifaire d'un autre : gabarit véhicule et type de châssis
  partagent le même champ, donc **on ne peut pas croiser deux axes** (ex. gabarit × état du
  véhicule) ;
- renommer un gabarit est une opération manuelle sur N packs ;
- aucune vue « ma grille tarifaire » n'existe : `PricingPage` liste les packs, pas les gabarits.

C'est de la **souplesse par absence de modèle**, pas de la généricité par abstraction.

### 15.5 Le prix est-il trop simpliste ?

Oui, mesurablement. Aujourd'hui :

```
prix = Number  +  mode ∈ { FIXED, QUOTE }
```

Le catalogue R.L.V, à lui seul, exige au minimum :

| Sémantique | Besoin R.L.V | Aujourd'hui |
|---|---|---|
| `FIXED` (ferme) | Simply One 80 €, R.L.V. + 190 €, Stage 1 500 € | ✗ rendu « dès » |
| `FROM` (à partir de) | Cryogénie 700 €, avion/bateau 300 € | ~ confondu avec `FIXED` |
| `QUOTE` (sur devis) | PPF, céramiques cuir/tissu, sinistres | ✅ |
| `FROM + QUOTE` | « à partir de 700 € — sur devis » | ✗ |
| `PER_UNIT` | 300 € **par jour** | ✗ |
| `SUPPLEMENT` (delta assumé) | +250 / +350 / +450 € | ~ via `options`, sans mode, sans total |

**5 sémantiques sur 6 sont manquantes ou confondues.** Ce n'est pas une sur-analyse : ces cinq cas
figurent tous dans un **seul** catalogue client réel.

---

## 16. Analyse de généricité multi-clients

### 16.1 Ce qui se généralise sans effort

- L'arbre `Service > Category > Pack` est le bon squelette pour un site de lavage/detailing : il
  correspond à la façon dont ces catalogues se présentent réellement.
- Le prix par gabarit est **la** bonne abstraction pour ce métier, et il est déjà là.
- `QUOTE` existe : la moitié des catalogues de detailing s'en servent en permanence.
- Le stockage document (tout le catalogue dans un `Service`) rend le modèle facile à dupliquer, à
  sauvegarder et à éditer d'un bloc.
- L'ensemble médias / galerie / bannière est déjà générique (descripteur + résolution à la lecture).

### 16.2 Ce qui ne se généralise pas

| Frein | Portée |
|---|---|
| Sémantique tarifaire à 2 valeurs | **Tout client** ayant des « à partir de », des unités ou des devis chiffrés — c'est-à-dire la majorité |
| Pas de composition de forfaits | **Tout client** ayant une gamme en escalier (Basic / Plus / Premium) — c'est le schéma commercial dominant du secteur |
| Options non partagées, sans devis | **Tout client** vendant des protections (céramique, PPF) sur plusieurs gammes |
| Gabarits sans référentiel | **Tout client** ayant plus de deux packs |
| Ordre et publication non administrables | **Tout client**, tout le temps — c'est une attente de base d'un back-office |
| Copie vitrine automobile en dur | Tout client sortant du champ « véhicule » (bateau, moto, poids lourd, aviation) |
| Seeds SB Auto dans `bootstrap.js` | **Tout nouveau projet**, dès le premier démarrage |
| Devise/locale figées `fr-FR`/`EUR` | Tout client hors zone euro (Suisse, Maghreb, DOM avec particularités) |
| Aucune notion TTC/HT au catalogue | Tout client B2B (flottes, concessions, loueurs) |

### 16.3 Le test décisif

Le fichier `Service.model.js` est **identique dans les 4 projets du parc**. Ce n'est donc pas
« le modèle de SB Auto qu'on pourrait réutiliser » : c'est **déjà** le modèle de la gamme. Chaque
limitation listée ci-dessus est donc **déjà** payée quatre fois, et le sera à chaque nouveau
client.

---

## 17. Classement A / B / C / D

### **C — Trop spécifique à SB Auto : le modèle est extensible, mais certaines abstractions importantes doivent évoluer.**

**Pourquoi pas A** — R.L.V ne peut pas être représenté sans contournement : 5 détournements
obligatoires et 11 informations métier perdues (§13.9). L'inclusion de forfait, l'option sur devis
et le couple « à partir de + devis » sont hors modèle.

**Pourquoi pas B** — les manques ne sont pas périphériques. Un « cœur sain » supposerait que
seules des commodités manquent. Ici, ce sont **la sémantique du prix**, **la composition de
l'offre** et **la réutilisation des prestations** — les trois notions centrales d'un catalogue de
services. S'y ajoute le fait que le Manager, qui est le produit vendu au client, n'expose ni
l'ordre ni la publication.

**Pourquoi pas D** — il n'y a rien à repenser. La hiérarchie est juste, le prix par gabarit est
déjà la bonne abstraction (et évite l'explosion combinatoire redoutée), le stockage est adapté,
le Manager est structurellement en place. Les évolutions nécessaires sont **additives** : nouveaux
champs, nouvel enum, une relation, deux écrans. Aucune migration destructrice n'est requise ; les
données existantes de SB Auto restent lisibles sous des valeurs par défaut.

**En clair** : le modèle actuel couvre **environ 60 %** du catalogue R.L.V de façon structurée,
**25 %** de façon dégradée (texte libre ou détournement), et **15 %** pas du tout. Le seuil de
« 90 % avec quelques extensions simples » évoqué en §20 de la commande **n'est pas atteint**, mais
il est **atteignable** avec les six chantiers P0 ci-dessous.

---

## 18. Recommandations

> **Aucune implémentation n'a été faite.** Ces recommandations sont des directions, pas des specs.

### P0 — Bloquant avant industrialisation

#### P0-1 · Élargir la sémantique tarifaire

- **Problème** : `PRICING_MODES = { FIXED, QUOTE }` ; `FIXED` est rendu « dès » en dur, `QUOTE`
  masque le montant.
- **Conséquence** : impossible d'annoncer un prix ferme ; impossible d'annoncer « à partir de X —
  sur devis » ; le mode réel de l'offre est décidé par du CSS.
- **Direction** : séparer deux axes indépendants — la **nature du montant**
  (`FIXED` / `FROM` / `NONE`) et l'**obligation de devis** (booléen). Un « à partir de 700 € sur
  devis » devient alors exprimable sans détournement, et « prix ferme » redevient possible. Retirer
  les libellés « dès » / « À partir de » du JSX au profit d'une dérivation depuis la donnée.
- **Impact** : `constants.js`, `Service.model.js` (pricing + pricedItem), 3 fichiers de types,
  `PrestationEditor`, `PricedItemList`, `ServicePage`. Migration : les documents existants
  deviennent `FROM` (comportement actuel), à confirmer client par client.
- **Données concernées** : tous les `pricing.mode` et `pricedItem.mode`.

#### P0-2 · Un référentiel de gabarits par service (ou par site)

- **Problème** : `complements[].label` est une chaîne libre, ressaisie dans chaque pack.
- **Conséquence** : duplication (4 × N), incohérences d'affichage, renommage impossible, pas de
  vue « grille tarifaire », impossibilité de croiser deux axes tarifaires.
- **Direction** : déclarer une **liste ordonnée de gabarits** au niveau `Service` (ou site), et
  faire porter au pack uniquement `{ gabaritRef, price }`. Ajouter la notion d'**axe** pour
  distinguer « gabarit véhicule » de critères ad hoc (châssis court/long) sans les mélanger.
- **Impact** : `Service.model.js`, contrôleur (intégrité référentielle), `PrestationEditor`
  (sélection au lieu de saisie), `PricingPage` (vraie grille), `ServicePage` (inchangé ou presque).
- **Données concernées** : `pricing.complements[]` de tous les packs existants (migration
  mécanique : dédupliquer les labels observés en référentiel).

#### P0-3 · Composition de forfaits

- **Problème** : `includes: [String]` — aucune relation pack → pack.
- **Conséquence** : « R.L.V. + comprend Simply One » est soit une duplication, soit un mot.
  Toute gamme en escalier (le schéma commercial dominant du secteur) est ingérable.
- **Direction** : permettre à un pack de **référencer** un ou plusieurs autres packs comme socle,
  et de n'énumérer que son delta. La vitrine compose la liste affichée à la lecture.
- **Impact** : `Service.model.js`, garde anti-cycle côté contrôleur, `PrestationEditor` (sélecteur),
  `ServicePage` (aplatissement à l'affichage).
- **Données concernées** : `packs[].includes` (aucune migration : le champ reste, la référence
  s'ajoute).

#### P0-4 · Un élément tarifé réutilisable, rattachable à plusieurs forfaits

- **Problème** : `options[]` est un sous-document du pack, sans `mode`, non partageable ;
  `complementaryServices` / `supplements` sont deux listes au schéma identique, distinguées par leur
  rendu.
- **Conséquence** : les 3 céramiques sont saisies deux fois (options du Stage 1 + à la carte) ;
  une option sans prix affiche « +0 € » ; le client choisit une apparence en croyant choisir une
  nature.
- **Direction** : **un seul** type d'élément tarifé, défini une fois au niveau service, **référencé**
  par les packs auxquels il s'applique, portant le même jeu de modes tarifaires que P0-1. La
  distinction liste/pastilles redevient un **choix de présentation**, pas un champ de données.
- **Impact** : `Service.model.js` (fusion de `optionSchema` et `pricedItemSchema`),
  `ServicesPage`/`PrestationEditor` (un éditeur au lieu de trois), `ServicePage`.
- **Données concernées** : `packs[].options[]`, `categories[].complementaryServices[]`,
  `categories[].supplements[]`.

#### P0-5 · Rendre administrables l'ordre et la publication

- **Problème** : `order` existe à 4 niveaux et n'est **jamais** modifiable ; `published` existe et
  n'a **aucune** interface ; `api.reorderServices` est écrit mais jamais appelé.
- **Conséquence** : l'ordre du catalogue est l'ordre de saisie ; masquer une offre impose de la
  supprimer. Pour un produit vendu comme « le client gère son site », c'est un défaut de promesse.
- **Direction** : réutiliser le glisser-déposer **déjà en place** dans ce Manager
  (`FaqPage`, `BeforeAfterPage`, `GalleryManager` : dnd-kit + `arrayMove`), et ajouter un
  interrupteur de publication — au niveau service d'abord, puis catégorie / pack / élément (le
  champ manque à ces niveaux).
- **Impact** : `ServicesPage.tsx` principalement ; ajout d'un booléen aux sous-schémas.
- **Données concernées** : `order` (toutes), `published` (service), nouveaux booléens ailleurs.

#### P0-6 · Sortir les données SB Auto du code d'amorçage

- **Problème** : `EXTRA_COMPLEMENTARY`, `EXTRA_SUPPLEMENTS`, `REVIEW_SEED`, `FAQ_SEED` sont
  codés en dur dans `bootstrap.js` et semés au démarrage de **tout** projet.
- **Conséquence** : chaque nouveau client naît avec les prestations, les prix, les 20 faux avis
  nominatifs et la FAQ automobile de SB Auto. C'est du contenu client dans du code applicatif, et
  un nettoyage manuel obligatoire à chaque duplication.
- **Direction** : externaliser en jeu de démarrage **optionnel et choisi** (fichier de données,
  paramètre de duplication, ou import depuis le Manager), et ne rien semer par défaut.
- **Impact** : `bootstrap.js`, procédure de duplication (`docs/DUPLICATION.md`), `verify-extras.js`.
- **Données concernées** : les 13 extras, 20 avis, 5 FAQ de tout projet déjà démarré.

---

### P1 — Fortement recommandé

| # | Problème | Conséquence | Direction | Impact |
|---|---|---|---|---|
| P1-1 | Aucune **unité de facturation** | « 300 € par jour » n'est que du texte | Champ d'unité (`par véhicule` / `par jour` / `par m²` / libre) rendu en suffixe | Modèle + `formatPrice` + 2 éditeurs |
| P1-2 | Aucune **durabilité** ni **zones traitées** | Le cœur de l'argumentaire céramique est en prose | `durability { value, unit }` et `zones[]` sur l'élément tarifé | Modèle + éditeur + affichage |
| P1-3 | **CTA devis non contextuel** | Un visiteur intéressé par le PPF atterrit sur un formulaire vierge | Lien contact préremplis (service / pack / élément), le motif `QUOTE` existe déjà côté validateur | Vitrine + `ContactForm` |
| P1-4 | **Exclusions / conditions / fiscalité** | « hors produits », « TTC » non exprimables | Champ de notes structuré (liste) + réglage TTC/HT au niveau site | Modèle + affichage |
| P1-5 | Description d'élément en `<Input>` mono-ligne | Aucune mise en forme possible là où le métier en a besoin | `Textarea`, à l'image de `shortDescription` | `ServicesPage.tsx` |
| P1-6 | **Écriture par document entier** | Écrasement silencieux entre deux ADMIN | Écritures ciblées ou contrôle de version optimiste | Contrôleur + `api.ts` + `saveEdit` |
| P1-7 | **Copie vitrine automobile en dur** | Incohérente hors automobile | Rendre administrables les 4-5 phrases concernées, ou les neutraliser | Vitrine + modèle de contenu |
| P1-8 | **Devise / locale figées**, `formatPrice` dupliqué | Aucun client hors zone euro | Paramètre site, une seule implémentation partagée | 2 `lib/utils.ts` |
| P1-9 | **Validation API quasi absente** (`passthrough`) | Aucune règle métier garantie ; « dès 0 € » est acceptable | Valider la structure tarifaire au niveau API | `common.validator.js` |
| P1-10 | `PricingPage` incomplète (packs seuls, lecture seule) | Le client n'a pas de vue tarifaire réelle | Étendre aux éléments tarifés, aligner sur le référentiel P0-2 | `PricingPage.tsx` |

---

### P2 — Confort / évolution future

| # | Sujet | Note |
|---|---|---|
| P2-1 | **Prix final calculé** (base + option, par gabarit) | Résout le besoin céramique de bout en bout. Dépend de P0-1/P0-2/P0-4. Question produit : afficher un total ou assumer l'addition ? |
| P2-2 | **Variantes de produit** (Q2 Wax *ou* Q2 Can Coat) | Aujourd'hui une chaîne avec « ou » |
| P2-3 | **Règles tarifaires conditionnelles** (état du véhicule, urgence) | Aujourd'hui des suppléments à plat |
| P2-4 | **Bibliothèque de prestations inter-clients** | Un catalogue type de detailing, réutilisable à chaque nouveau projet |
| P2-5 | **Découplage présentation / métier** | Sortir `badge` du schéma tarifaire ; faire de liste/pastilles un rendu, pas un champ |
| P2-6 | **Intégrité référentielle** des avis (`Review.prestation`) | ObjectId sans `ref` : supprimer un pack laisse des avis orphelins |
| P2-7 | **Médias par pack / par élément** | Aujourd'hui la galerie est au niveau catégorie uniquement |
| P2-8 | **Résultat annoncé / bénéfices** en champ dédié | « 50 à 80 % des rayures » est un argument, pas une tâche |

---

## 19. Architecture cible minimale suggérée — conceptuelle uniquement

Objectif : **le minimum d'abstraction métier propre**, pas un ERP. Six notions, contre quatre
aujourd'hui.

```text
Site / Service
 ├── PricingAxis[]          ⟵ NOUVEAU, minimal — le référentiel manquant
 │     name: "Gabarit véhicule" | "Type de châssis"
 │     values[]: { key, label, order }          ex. citadine, berline, sportive-suv, supercar
 │
 └── Category               (inchangé — onglet de présentation, + publication)
      ├── Pack
      │    ├── includes[]              (inchangé — texte)
      │    ├── includesPacks[] ⟵ NOUVEAU  référence(s) vers d'autres packs (socle)
      │    ├── prices[]      ⟵ ÉVOLUÉ    { axisValueRef, amount }  (au lieu de label libre)
      │    ├── priceMeta     ⟵ ÉVOLUÉ    { kind: FIXED|FROM|NONE, quoteRequired: bool,
      │    │                               unit: PER_JOB|PER_DAY|…, taxMode: TTC|HT }
      │    ├── offerRefs[]   ⟵ NOUVEAU   références vers des PricedOffer
      │    ├── badge, duration, bookingUrl, order, enabled
      │
      └── PricedOffer[]     ⟵ FUSION de options / complementaryServices / supplements
           name, description
           priceMeta (même sémantique que ci-dessus)
           prices[] (facultatif — un supplément peut lui aussi varier par gabarit)
           durability { value, unit }        ⟵ « 5 ans »
           zones[]                            ⟵ carrosserie / vitres / jantes
           notes { conditions[], exclusions[] }
           display: LIST | CHIP               ⟵ la présentation redevient un choix d'affichage
           enabled, order
```

**Ce que cette cible change pour R.L.V**, point par point :

| Besoin | Aujourd'hui | Avec la cible |
|---|---|---|
| Simply One, prix ferme par gabarit | « dès 80 € » + doublon du prix de base | `priceMeta.kind = FIXED`, 4 prix référencés à l'axe |
| R.L.V. + ⊃ Simply One | duplication | `includesPacks: [SimplyOne]` |
| Céramiques sur Stage 1 **et** à la carte | 2 saisies | 1 `PricedOffer`, référencée par `offerRefs` |
| Céramique sans prix public | « +0 € » | `priceMeta.kind = NONE, quoteRequired = true` |
| Durée 5 ans, zones | prose | `durability`, `zones[]` |
| Cryogénie « dès 700 € — sur devis » | impossible | `kind = FROM, quoteRequired = true` |
| Avion 300 €/jour | prose | `kind = FROM, unit = PER_DAY` |
| Châssis court/long | mêlé aux gabarits | second `PricingAxis` |
| Exclusions | prose | `notes.exclusions[]` |
| TTC | absent | `priceMeta.taxMode` |
| Ordre / activation | non administrables | `order` + `enabled` exposés |

**Ce qui ne change pas** : la hiérarchie `Service > Category > Pack`, le stockage document, les
routes, le modèle média, le Manager en arbre. **Aucune migration destructrice** : les valeurs
actuelles se projettent sur des défauts (`kind = FROM` reproduit le comportement d'aujourd'hui),
et les labels observés se dédupliquent mécaniquement en axe.

**Coût conceptuel** : +2 notions (`PricingAxis`, `PricedOffer` unifiée), 1 relation
(`includesPacks`), 1 enrichissement (`priceMeta`). C'est le plancher pour couvrir R.L.V sans
détournement — pas un cran de plus.

---

## 20. Conclusion

L'architecture services/tarifs de SB Auto n'est ni un mauvais modèle ni un modèle générique : c'est
un modèle **correctement dessiné pour un catalogue simple**, qui a déjà été promu au rang de gabarit
de la gamme (fichier identique dans les 4 projets) sans avoir été confronté à un second catalogue
réel.

Sa hiérarchie est juste. Son prix par gabarit est la bonne abstraction du métier, et il évite
précisément l'explosion combinatoire redoutée : **il ne faut pas créer « Céramique One Citadine »**.
Ce point mérite d'être souligné, car c'était le risque principal envisagé.

En revanche, trois notions centrales manquent — **la composition de l'offre**, **la réutilisation
d'une prestation** et **la sémantique du prix** — et une quatrième, **le référentiel de gabarits**,
n'existe que comme chaîne de caractères recopiée. À cela s'ajoutent deux défauts de produit
(l'ordre et la publication ne sont pas administrables) et un défaut d'industrialisation (le
catalogue de SB Auto est semé dans chaque nouveau projet).

Le confronter à R.L.V produit un résultat net : **8 besoins natifs, 4 détournables, 11 partiels,
9 non supportés**, dont 9 ne pourraient être « couverts » qu'en écrivant du métier dans des champs
de description — ce que la commande refuse à juste titre de compter comme du support.

La bonne nouvelle est que le correctif est **additif et borné** : six chantiers P0, deux nouvelles
notions, aucune réécriture, aucune migration destructrice. Les faire **avant** de multiplier les
projets coûte une fois ; les faire après coûtera autant de fois qu'il y aura de clients — le modèle
étant déjà dupliqué à l'identique quatre fois, la facture court déjà.

---

## 21. Réponses explicites aux deux questions

### Question 1

> « Si demain nous signons R.L.V Detail, pouvons-nous représenter proprement et administrer depuis
> notre Manager l'intégralité de son catalogue actuel avec l'architecture SB Auto existante, sans
> duplication artificielle, sans données métier perdues et sans logique spécifique R.L.V ? »

# **NON**

La question pose trois conditions ; **les trois échouent**.

**1 — Duplication artificielle : inévitable.**
- Le contenu de Simply One doit être recopié dans R.L.V. + (`includes: [String]`, aucune relation
  pack → pack).
- Les 4 libellés de gabarit doivent être ressaisis dans chaque pack (aucun référentiel).
- Le prix « Citadine » doit être stocké deux fois (`basePrice` + complément homonyme) pour être
  lisible.
- Les 3 protections céramiques doivent exister deux fois : options du Stage 1, et prestations à la
  demande.

**2 — Données métier perdues : onze, dont trois centrales.**
Durabilité (1/2/5 ans), zones traitées (carrosserie/vitres/jantes), unité « par jour », montant en
mode devis (« à partir de 300 € »), exclusions (« hors produits »), mention TTC, résultat annoncé
(« 50 à 80 % des rayures »), variantes produit (« Q2 Wax **ou** Q2 Can Coat »), distinction prix
ferme / prix à partir de, relation d'inclusion entre forfaits, prix final. Toutes ne peuvent aller
que dans un champ de description — ce qui, au sens de la commande, **n'est pas du support**.

**3 — Trois besoins purement et simplement hors modèle.**
- **Le prix final calculé.** L'exigence explicite du professionnel — « ajouter le tarif de la
  céramique au tarif du Detailing Stage 1 correspondant à la catégorie de véhicule » — n'a **aucun**
  support : rien n'additionne quoi que ce soit dans tout le dépôt. Le visiteur lit « dès 500 € » et
  « +450 € » et fait le calcul lui-même, sans savoir quel gabarit s'applique au montant affiché.
- **Le « à partir de X € — sur devis »** (cryogénie, avions/bateaux) : les deux modes sont
  exclusifs, choisir `QUOTE` **masque** le montant.
- **Le supplément sans prix public rattaché à une prestation** (anti-corrosion, céramiques
  cuir/alcantara/tissu) : `optionSchema.price` est obligatoire → affichage « **+0 €** ».

**4 — Et l'administration côté Manager est incomplète, indépendamment du modèle.**
Le client R.L.V ne pourrait ni ordonner ses forfaits (Simply One avant R.L.V. +), ni dépublier une
prestation saisonnière, ni saisir une option sur devis.

**Ce qui EST possible aujourd'hui**, pour être juste : produire un site R.L.V **présentable et
globalement exact**. Les forfaits, les 4 grilles tarifaires par gabarit, les prestations à la
demande sur devis et les suppléments s'affichent correctement. Le catalogue serait **lisible** —
mais **dégradé**, **dupliqué** et **non maintenable dans la durée**. C'est la différence entre
« ça passe pour la mise en ligne » et « c'est modélisé ».

---

### Question 2

> « L'architecture actuelle constitue-t-elle une fondation suffisamment générique pour
> industrialiser les prochains sites de lavage automobile, ou devons-nous faire évoluer le modèle
> avant de multiplier les projets ? »

**Fondation : oui. En l'état : non. Il faut faire évoluer le modèle avant de multiplier.**

La fondation est bonne et doit être conservée : hiérarchie `Service > Category > Pack`, prix par
gabarit, stockage document, Manager en arbre, chaîne média. Rien de tout cela n'est à refaire.

Mais quatre abstractions manquantes ne sont pas des cas R.L.V : ce sont des motifs **standard** du
métier. Les gammes en escalier (Basic/Plus/Premium), les protections vendues sur plusieurs gammes,
les « à partir de », les prestations sur devis se retrouveront chez **presque tous** les centres.
Et deux défauts sont indépendants du métier : un back-office sans ordre ni publication, et un
amorçage qui injecte le catalogue de SB Auto dans chaque nouveau projet.

Le modèle étant **déjà identique dans les 4 projets du parc**, chaque limitation est déjà payée
quatre fois. Le bon moment pour les six chantiers P0 est **maintenant** — avant le cinquième
client, pas après le dixième.

**Recommandation opérationnelle** : traiter P0-1 (sémantique tarifaire), P0-2 (référentiel de
gabarits), P0-3 (composition), P0-4 (élément tarifé unifié), P0-5 (ordre & publication),
P0-6 (dé-seeding) comme un lot unique et additif, avec valeurs par défaut préservant le
comportement actuel de SB Auto. Après ce lot, R.L.V est représentable sans détournement et sans
perte, et la réponse à la question 1 devient **OUI**.

---

## 22. État Git après audit

> ⚠️ **Avertissement de lecture** : l'état Git a bougé pendant l'audit, **mais pas du fait de
> l'audit**. Le chantier Yousign → OpenSign a progressé en parallèle dans les deux dépôts pendant
> la rédaction de ce rapport. Le détail ci-dessous distingue explicitement ce qui vient de l'audit
> de ce qui vient de l'autre session.

### `SB Auto 06`

| | Avant audit | Après audit |
|---|---|---|
| Branche | `feat/unified-production-baseline` | `feat/unified-production-baseline` — **inchangée** |
| Commit | `a7e3c9c8caefb841f356de91c6932606088ae50f` | **`71025aaa459e975ec86fb9c741f9d795944f5bad`** — avancé |

**Le commit a avancé d'un cran, du fait de l'autre session :**

```
71025aa | 2026-08-21 10:35:35 | feat(signature): finir la neutralisation des écrans et du pont (LOTS 7-8)
a7e3c9c | 2026-08-20 19:30:45 | feat(contrats): archiver la preuve d'audit à côté du contrat signé (LOT 6)
```

Ce commit `71025aa` a été créé à **10:35:35**, soit **avant** la création du dossier `docs/audits/`
(**10:37**) et l'écriture du rapport (**10:43**). Il embarque les 14 fichiers qui étaient modifiés
au moment du relevé §3 — d'où leur disparition de `git status`.

État du worktree à l'issue de l'audit :

```
 M docs/API.md                                       ┐
 M docs/ARCHITECTURE.md                              │
 M docs/CONTRACTS.md                                 │
 M docs/CONTRACT_ENFORCEMENT_ROLLOUT.md              │
 M docs/CONTRACT_SIGNERS.md                          │
 M docs/RAPPORT.md                                   │ chantier Yousign → OpenSign
 M docs/WEBHOOKS.md                                  ├ (autre session, PAS l'audit)
 M docs/YOUSIGN_INTEGRATION.md                       │
 M docs/YOUSIGN_REAL_SANDBOX_FIX_REPORT.md           │
 M docs/YOUSIGN_SIGNATURE_FLOW.md                    │
 M docs/YOUSIGN_TRIAL_REDIRECT_FALLBACK.md           │
 M docs/panelXvitrine/14_EXTERNAL_DEVELOPER_GUIDE.md │
 M manager/src/lib/subscriptionPricing.test.mjs      │
?? docs/SIGNATURE.md                                 ┘
?? docs/audits/                                      ← LE SEUL ARTEFACT DE CET AUDIT
```

`docs/audits/` ne contient qu'un fichier : `SB_AUTO_SERVICE_PRICING_ARCHITECTURE_AUDIT.md`
(le présent rapport). Index (`git diff --cached`) : **vide**.

### `Panel`

| | Avant audit | Après audit |
|---|---|---|
| Branche | `feat/generic-deployment-engine` | `feat/generic-deployment-engine` — **inchangée** |
| Commit | `cd37a29c8eaa659779c20ee3e058edac71675ea6` | **`a8311ff054014d6dcb39b208455158dd6878880e`** — avancé |

Worktree après audit : `README.md` et `docs/integrated-api/OPENSIGN_MIGRATION_CAMPAIGN.md`
modifiés — **entièrement l'autre session**. Le Panel n'a été que **lu** pendant cet audit ; aucun
de ses fichiers n'a été touché.

### Attribution — ce que l'audit a réellement produit

| Changement | Origine |
|---|---|
| `docs/audits/` (dossier) | **Cet audit** |
| `docs/audits/SB_AUTO_SERVICE_PRICING_ARCHITECTURE_AUDIT.md` | **Cet audit** |
| Commit `71025aa` (SB Auto) et son contenu | Autre session — chantier OpenSign |
| Commit `a8311ff` (Panel) et son contenu | Autre session — chantier OpenSign |
| 13 fichiers `docs/*` + `subscriptionPricing.test.mjs` modifiés | Autre session — chantier OpenSign |
| `docs/SIGNATURE.md` (nouveau) | Autre session — chantier OpenSign |

Aucune commande d'écriture Git n'a été exécutée par cet audit : ni `commit`, ni `add`, ni `stash`,
ni `reset`, ni `checkout`. **Rien n'a été restauré**, précisément parce qu'aucune des modifications
constatées ne provient de l'audit : y toucher aurait détruit le travail en cours de l'autre session.

### Validité des preuves du rapport

Le commit intervenu pendant l'audit ne touche **aucun** des fichiers du domaine catalogue/tarifs
cités en preuve (`Service.model.js`, `constants.js`, `service.controller.js`,
`common.validator.js`, `bootstrap.js`, `ServicesPage.tsx`, `PrestationEditor.tsx`,
`PricingPage.tsx`, `ServicePage.tsx`, `HomePage.tsx`, les fichiers de types). **Les numéros de
ligne et les extraits cités restent exacts.**
