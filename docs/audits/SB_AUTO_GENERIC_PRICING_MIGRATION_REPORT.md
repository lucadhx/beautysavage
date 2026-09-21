# Catalogue générique SB Auto — migration, référentiel de gammes et suppression des seeds

**Environnement de recette** : TEST · base `sbauto06_test` · `https://demo-sbauto06.ly-solution.com`
**Commits** : `556472c`, `53f27c0`, `52a2adb`, `195c8b9`
**Branche** : `feat/unified-production-baseline`

---

## 1 · Ce que ce lot devait rendre possible

Une seule question, et elle décide de tout le reste :

> Peut-on dupliquer SB Auto pour un autre centre de lavage — ou pour un
> chantier naval — et construire l'intégralité de son catalogue depuis la base
> et le Manager, avec ses propres gammes de prix, **sans toucher une ligne de
> code générique** ?

Avant ce lot, non. Trois raisons, toutes structurelles.

**Les gabarits tarifaires n'existaient pas.** Ils vivaient dans une chaîne
libre, recopiée dans chaque forfait : `pack.pricing.complements[].label`.
Renommer « SUV » en « SUV / 4x4 » demandait de rouvrir tous les forfaits un par
un, et rien ne garantissait qu'on les avait tous. Deux orthographes du même
gabarit coexistaient sans que personne puisse le voir.

**« Prix fixe » et « sur devis » s'excluaient.** Un seul champ `mode` portait
les deux, si bien que « à partir de 700 €, sur devis » — un cas courant dès
qu'une prestation dépend de l'état du bien — était inexprimable. Pire : le mode
`FIXED` s'affichait « dès » dans la vitrine, donc un prix réellement ferme
n'existait pas non plus.

**Le contenu du client était dans le code.** Le démarrage réinjectait des avis
nominatifs, une FAQ automobile et des extras (« Traitement cuir », « Lavage
moto », « Véhicule très sale ») dans toute base qui n'en avait pas. Un projet
neuf naissait donc avec le métier de quelqu'un d'autre.

---

## 2 · Le référentiel de gammes de prix

### 2.1 Une gamme est une identité, jamais un montant

`PricingRange` porte un nom et un ordre. Rien d'autre.

C'est la règle qui fait tout tenir. « Berline » est une identité ; les 90 € du
forfait Confort et les 650 € du forfait Céramique appartiennent à ces forfaits,
pas à la gamme. Ranger un prix dans le référentiel obligerait à créer une gamme
« Berline » par grille tarifaire — et l'on aurait reconstruit exactement la
duplication qu'on vient de retirer.

Le montant vit donc dans `pack.pricing.entries[].amount`, qui référence la gamme
par son **identifiant**. Un renommage se répercute partout à la lecture, sans
migration et sans risque d'oublier une grille.

### 2.2 Aucune taxonomie automobile dans le code

Il n'y a pas d'énumération `CITADINE | BERLINE | SUV | SUPERCAR`. Le référentiel
est une collection éditable, et c'est délibéré : le prochain client créera
« Châssis court / Châssis long », « Petit / Grand volume » ou « Avion / Bateau »
sans qu'une ligne applicative change. Un enum ici ferait de chaque nouveau
métier une livraison.

Un contrôle automatisé le verrouille (`catalog-generic-pricing.test.js` § 12) :
il balaie tout le runtime à la recherche de `\b(CITADINE|BERLINE|SUPERCAR|
MONOSPACE|UTILITAIRE)\b` hors commentaires. Les suites de recette utilisent
elles-mêmes des gammes non automobiles — « Châssis court », « Voilier » — pour
qu'un enum caché se trahisse.

### 2.3 Unicité tranchée par index, pas par vérification

Deux gammes ne portent pas le même nom, et la question se règle à l'écriture :

```js
pricingRangeSchema.index({ name: 1 }, { unique: true, collation: { locale: 'fr', strength: 1 } });
```

Une vérification préalable laisserait passer deux créations simultanées : toutes
deux trouveraient le nom libre. La collation insensible à la casse et aux
accents traite « berline », « Berline » et « BERLINE » comme le même gabarit —
deux gammes qui ne se distinguent que par une majuscule sont un piège, pas une
fonctionnalité.

Éprouvé sur l'environnement déployé :

```text
create         201 Recette éphémère
doublon accent 409 PRICING_RANGE_NAME_TAKEN
doublon casse  409 PRICING_RANGE_NAME_TAKEN
```

### 2.4 Une gamme utilisée ne se supprime pas — refus BACKEND

Le compteur `usageCount` est **calculé à chaque lecture**, jamais stocké : une
agrégation `$unwind` sur `categories.packs.pricing.entries`. Un compteur tenu à
jour serait faux dès qu'un forfait serait modifié ailleurs, et un compteur faux
autorise une suppression qui casse des grilles.

La suppression compte, supprime, **recompte**, et restaure le document —
identifiant compris — si un usage est apparu entre-temps. Ce n'est pas une
transaction, et le code ne prétend pas le contraire : c'est une fenêtre réduite
à sa plus petite taille utile, sans course évidente.

Interdits explicites, et aucun n'est implémenté nulle part : suppression en
cascade, mise à `null` automatique des tarifs, suppression silencieuse,
référence cassée.

Recette sur le déploiement :

```text
la suppression est refusee (409)
le refus dit combien de tarifs — La gamme « Châssis court » est utilisée
                                 par 1 tarif et ne peut pas être supprimée.
la gamme est toujours la
```

---

## 3 · Deux axes tarifaires indépendants

| Champ | Valeurs | Ce qu'il dit |
|---|---|---|
| `kind` | `FIXED` · `FROM` · `NONE` | la nature du montant |
| `quoteRequired` | booléen | faut-il un devis |

Les quatre combinaisons rendent quatre affichages, et le troisième est celui que
l'ancien modèle ne savait pas exprimer :

| kind | devis | Ce que le client voit |
|---|---|---|
| `FIXED` | non | `49 €` |
| `FROM` | non | `À partir de 49 €` |
| `FROM` | **oui** | `À partir de 700 €` **et** `Sur devis` |
| `NONE` | oui | `Sur devis` |

Les combinaisons impossibles sont refusées côté serveur, avec un code stable :
`PRICING_AMOUNT_REQUIRED` (un « à partir de » sans aucun montant),
`PRICING_AMOUNT_FORBIDDEN` (une grille renseignée qui ne sera jamais affichée),
`PRICING_NONE_WITHOUT_QUOTE` (ni tarif, ni moyen d'en obtenir un),
`PRICING_RANGE_DUPLICATED`, `PRICING_AMOUNT_INVALID`, `PRICING_KIND_UNKNOWN`.

### 3.1 Le prix d'appel est calculé, jamais dupliqué

Le montant mis en avant est **le plus petit montant public**, résolu à la
lecture. Il n'existe plus de `basePrice` à tenir cohérent avec une grille : le
champ qui pouvait mentir a disparu.

---

## 4 · Une seule implémentation de la règle

`backend/src/services/catalog/pricingResolver.js` est la référence unique. La
projection de lecture (`catalogProjection.js`) l'applique et attache à chaque
forfait une `pricingView` et une `includedView`. **Le Manager et la vitrine ne
décident de rien ; ils rendent.**

C'est la correction d'un défaut réel et observable : l'ancien éditeur du Manager
affichait un « delta » vert ou rouge par rapport au tarif de base, une lecture
que la vitrine n'a jamais rendue. Deux écrans du même produit racontaient deux
tarifications. Le résumé de la liste des services écrivait `dès {basePrice}` en
dur — le même préfixe recopié une seconde fois, et un forfait à prix ferme s'y
annonçait « dès 49 € ».

Ce que le serveur sert aujourd'hui, pour un forfait réel du catalogue client :

```json
{"kind":"FROM","quoteRequired":false,"display":"FROM","amount":49,
 "entries":[{"id":"6a88…98e","pricingRangeId":null,"amount":49,"order":0,
             "pricingRangeName":null}],
 "hasGrid":false}
```

---

## 5 · Prestations incluses typées

`includes: [String]` devient `IncludedItem { type: TEXT | PACK_REF, text, packId, order }`.

**Seul l'identifiant est stocké.** Renommer un forfait cible se voit partout, à
la lecture, sans migration.

**Supprimer un forfait référencé est un DROIT.** La ligne disparaît, sans 500,
sans `undefined`, sans `ObjectId` à l'écran, sans ligne vide. Deux mécanismes,
et ils ne font pas la même chose :

- la **lecture** filtre les références dont la cible n'existe plus — c'est la
  garantie, et elle tient même face à une suppression faite hors du produit
  (restauration, script) ;
- l'**écriture** nettoie la charge utile — c'est de l'hygiène : une ligne
  pendante conservée en base réapparaîtrait dans l'éditeur du Manager, qui édite
  la donnée brute.

**Les cycles sont refusés avant écriture**, sur le graphe projeté — celui qui
existerait si l'on enregistrait. `A→A`, `A→B→A`, `A→B→C→A`. Valider l'état
enregistré validerait le passé et laisserait passer précisément la modification
qu'on refuse.

La vitrine distingue les deux natures par une icône : une coche pour une
prestation, un pictogramme « couches » pour un forfait inclus. Un forfait inclus
dans un autre n'est pas une ligne de plus : c'est une offre entière reprise
telle quelle, et elle en vaut cinq. **Il n'est pas déplié récursivement.**

---

## 6 · Ce que la migration a fait, et ce qu'elle s'est interdit

### 6.1 Inventaire logique avant / après

| | Avant | Après (forme double) | Après `--drop-legacy` |
|---|---|---|---|
| services | 1 | 1 | 1 |
| catégories | 2 | 2 | 2 |
| forfaits | 6 | 6 | 6 |
| **montants** | **6** (somme 374) | 12 (somme 748) | **6** (somme 374) |
| forfaits en forme héritée | 6 | 6 | **0** |
| forfaits en forme nouvelle | 0 | 6 | 6 |
| **lignes incluses** | **19** | 38 | **19** |
| types de lignes | `{TEXT: 19}` | `{TEXT: 38}` | `{TEXT: 19}` |

La colonne du milieu est la phase additive : les deux formes coexistent, et
c'est ce qui rend la fenêtre d'incompatibilité nulle (§ 9). La colonne de droite
est l'état final : **même nombre de montants, même somme, même nombre de lignes
qu'avant**. Rien n'a été perdu, rien n'a été doublé.

### 6.2 Aucune fusion arbitraire

Le catalogue client ne portait **aucun** libellé de complément — zéro gamme à
créer. La correspondance libellé → gamme existe et est éprouvée par les tests,
mais elle ne s'est appliquée à aucune donnée réelle.

La règle qu'elle applique reste écrite : deux chaînes différentes ne sont jamais
normalisées l'une vers l'autre. « SUV », « SUV / 4x4 » et « Sportive-SUV »
restent trois gammes distinctes. Décider qu'elles sont la même chose est une
décision commerciale, et elle appartient à l'opérateur.

### 6.3 Aucune inférence de référence

`PACK_REF` n'est **jamais** déduit d'une correspondance de nom. Le catalogue
client contient les lignes « Pack simple », « Pack Confort », « Pack Classique »
et « Pack Eclat », et il existe des forfaits portant exactement ces noms. Toutes
ces lignes sont restées `TEXT`, comme le montre la lecture de l'API déployée :

```text
Pack Confort   | includedView(3) | types ["TEXT"]  → « Pack simple », …
Pack Detailling| includedView(3) | types ["TEXT"]  → « Pack Confort », …
Pack Gold      | includedView(2) | types ["TEXT"]  → « Pack Eclat », …
```

L'opérateur les convertira s'il le souhaite ; le code ne le fait pas à sa place.

### 6.4 Sémantique préservée

`FIXED` s'affichait « dès » dans la vitrine. Le traduire vers le nouveau `FIXED`
— un prix ferme — aurait changé l'affichage de tous les forfaits existants :
« dès 49 € » serait devenu « 49 € », c'est-à-dire un engagement commercial que
personne n'a pris. L'intention métier n'est pas connaissable depuis la donnée.
On a donc préservé le **rendu** : `FIXED` → `FROM`. 6 forfaits concernés.

### 6.5 Idempotence prouvée sur la base réelle

Deuxième passage sur `sbauto06_test`, après application :

```text
tarifs écrits       : 0 sur 0 forfait(s)
FIXED → FROM        : 0
chaînes lues        : 0
```

Inventaire identique au bit près. L'idempotence est mesurée sur la **valeur**,
pas sur un drapeau : la cible est calculée et l'écriture n'a lieu que si elle
diffère — une forme qui reste juste quels que soient les défauts du schéma et
l'ordre des passages.

---

## 7 · Suppression des seeds — inventaire d'abord, code ensuite

L'ordre a été respecté strictement : **inspecter la base réelle, compter,
vérifier, et seulement ensuite retirer le code.**

| Donnée | En base | Origine | Décision |
|---|---|---|---|
| Avis | 30 | **0 sur 20** correspondent aux noms du seed | données client — intactes |
| FAQ | 5 | issues du seed, déjà persistées | conservées en base, seed retiré |
| Extras (compl./suppl.) | 4 + 5 | idem | conservés en base, seed retiré |

Les trois gardes de seed ne se rouvraient donc plus : elles ne se déclenchent
que sur une collection vide. Le retrait était sans effet sur les données — c'est
ce que l'inventaire a établi **avant** la première suppression de ligne.

Retirés du runtime : `REVIEW_SEED` (20 avis nominatifs), `FAQ_SEED`,
`EXTRA_COMPLEMENTARY`, `EXTRA_SUPPLEMENTS`, `seedCategoryExtras()`, et le script
`verify-extras.js` qui n'exerçait que le seed.

Vérification finale (LOT 19) :

```console
$ grep -RniE "EXTRA_COMPLEMENTARY|EXTRA_SUPPLEMENTS|REVIEW_SEED|FAQ_SEED|\
Traitement cuir|Lavage moto|Véhicule très sale" backend/src
backend/src/scripts/catalog-no-seed.test.js:8,146,153,154,155
```

Cinq occurrences, toutes dans le **contrôle qui interdit leur retour**.

**Après redémarrage du runtime déployé** : 0 mutation du catalogue, 30 avis
(inchangé), 5 FAQ (inchangé), 0 extra ajouté, 0 gamme créée. Un projet neuf
démarre à zéro de tout.

---

## 8 · Le Manager

### 8.1 Page « Gammes de prix »

Créer, renommer, réordonner par glisser-déposer, supprimer si inutilisée. Le
compteur affiche le **nombre réel de tarifs** utilisant la gamme, servi par le
backend à chaque lecture.

Quand la gamme est utilisée, la corbeille devient un **cadenas** désactivé qui
porte le motif dans son `title` et son `aria-label` :

> Impossible de supprimer : 12 tarifs utilisent cette gamme

Un bouton désactivé sans motif est une impasse : l'opérateur clique, rien ne se
passe, il recommence. Le refus reste évidemment backend ; l'écran ne protège
rien, il évite un aller-retour inutile.

La modale de renommage annonce que le geste est sans danger lorsque la gamme est
utilisée — un opérateur qui voit « 12 tarifs » à côté d'un champ de nom hésite
légitimement.

### 8.2 Éditeur de forfait

Un contrôle segmenté à trois positions (Prix fixe / À partir de / Pas de prix
public) **et** un interrupteur « Sur devis » séparé. Les lignes de tarif portent
chacune un sélecteur de gamme alimenté par le référentiel, avec une option
`— Sans gamme —` : la majorité des forfaits n'ont qu'un prix, et exiger une
gamme obligerait à inventer un « Standard » vide puis à l'afficher au client.

Un aperçu écrit ce que le site montrera. Il **applique** la règle du backend, il
ne la recalcule pas pour décider.

La checklist propose « Ajouter une prestation » et « Ajouter un pack ». Le
second bouton n'apparaît que s'il existe un autre forfait à inclure, et le
forfait courant ne se propose jamais à lui-même.

### 8.3 Recette sur le Manager déployé

```text
1 · LA PAGE GAMMES EXISTE ET SE CHARGE            4/4
2 · CRÉER, RENOMMER, COMPTER, RÉORDONNER          3/3
3 · L'ÉDITEUR PROPOSE LE RÉFÉRENTIEL              6/6
    le sélecteur lit le référentiel — ["— Sans gamme —","Petit volume","Grand volume"]
4 · NETTOYAGE                                     2/2
RECETTE MANAGER : OK
```

---

## 9 · Déploiement — fenêtre d'incompatibilité nulle

L'ordre n'est pas interchangeable, et il a été suivi :

1. **migration additive** — les champs hérités restent servis à côté des
   nouveaux. Le runtime ancien, encore en service à ce moment, continue de lire
   `basePrice` et `includes` sans rien voir changer ;
2. **déploiement du backend, du Manager et de la vitrine** — le nouveau code lit
   les deux formes ;
3. **retrait des champs hérités** — un geste séparé, demandé une fois la
   nouvelle forme constatée en service. C'est le seul geste de cette migration
   qui ne se rejoue pas à l'envers.

Preuve de l'étape 1, lue sur l'API pendant la phase double :

```json
"pricing":{"mode":"FIXED","basePrice":49,"complements":[],
           "entries":[{"amount":49,…}],"kind":"FROM","quoteRequired":false}
"includes":["Nettoyage intérieur","Aspiration habitacle",…]
```

Après l'étape 3, la même lecture ne porte plus qu'une forme :

```json
"pricing":{"entries":[{"pricingRangeId":null,"amount":49,"order":0,…}],
           "kind":"FROM","quoteRequired":false}
```

`mode`, `basePrice`, `complements` et `includes` ont disparu. **Un seul modèle
de vérité, pas de double modèle permanent.**

Déploiements effectués par le pipeline existant, `tools/deployDirect.js
--environment TEST` — aucun mécanisme alternatif. Trois exécutions, 51
évènements chacune, 0 en échec.

---

## 10 · Non-régression de la vitrine

Recette automatisée sur `https://demo-sbauto06.ly-solution.com/services/lavage`,
aux six largeurs demandées (390 / 430 / 768 / 1024 / 1280 / 1680 px) :

| Contrôle | 390 | 430 | 768 | 1024 | 1280 | 1680 |
|---|---|---|---|---|---|---|
| page rendue, non vide | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| aucun `undefined` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| aucun `NaN` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| aucun ObjectId visible | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| aucun `[object Object]` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| prix rendus (14 montants) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| aucun `+0 €` parasite | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| aucun débordement horizontal | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| aucune erreur console | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Les montants rendus — `49 € 89 € 119 € 29 € 39 € 49 €` et les options — sont
exactement ceux d'avant la migration, dans la présentation d'avant (« À partir
de 49 € »).

### 10.1 La carte n'a plus de hauteur figée

`h-[27rem]` devient `h-full min-h-[27rem]`. Le rail alignait déjà les cartes
(`items-stretch`) : la hauteur imposée ne servait pas à les égaliser, elle
servait à les **borner**. Une grille tarifaire dépliée aurait dû se loger dans
une hauteur décidée à l'avance — la liste des prestations incluses se serait
rétrécie sous les pieds du visiteur au moment même où il clique.

### 10.2 Le dépliage « Voir les tarifs »

Un vrai `<button>` : focus, espace, entrée, `aria-expanded`, `aria-controls`. La
hauteur s'anime de `0fr` à `1fr` par `grid-template-rows` — le panneau prend
exactement sa place quel qu'en soit le contenu, sans hauteur fixe qui
tronquerait à six gammes ou laisserait un vide à une seule.

**Aucun accordéon n'apparaît quand un forfait n'a qu'un tarif sans gamme** :
répéter le prix déjà affiché est un clic pour rien. `hasGrid: false` sur les six
forfaits du catalogue client, vérifié sur l'API déployée.

---

## 11 · Recette métier sur l'environnement déployé

Menée sur des données **créées pour elle** — un service « entretien de bateaux »,
trois gammes non automobiles — puis intégralement retirées. Le catalogue client
est relu avant et après pour le prouver.

```text
1 · REFERENTIEL DE GAMMES                                    4/4
2 · UN CATALOGUE ENTIEREMENT NON AUTOMOBILE                  1/1
3 · LES QUATRE CAS D'AFFICHAGE                               6/6
      « à partir de 700 € » — le plus petit montant, pas un basePrice
      ET « sur devis » en même temps
      avec une grille dépliable
      gammes résolues — Châssis court|Châssis long|Voilier
      un prix FERME s'affiche sans « à partir de »
      un tarif unique sans gamme n'ouvre aucun accordéon
4 · LE COMPTEUR D'USAGE EST REEL                             1/1
5 · UNE GAMME UTILISEE NE SE SUPPRIME PAS                    3/3
6 · RENOMMER SE VOIT PARTOUT, SANS MIGRATION                 1/1
7 · LES COMBINAISONS IMPOSSIBLES SONT REFUSEES               2/2
8 · UN PACK INCLUS DISPARU NE CASSE RIEN                     4/4
9 · NETTOYAGE                                                6/6
      le catalogue client est EXACTEMENT celui d'avant la recette
RECETTE METIER : OK
```

---

## 12 · Un défaut trouvé par la recette, et corrigé

**Supprimer un forfait cité par un autre était refusé.** La référence devenue
pendante était comptée comme « forfait référencé inexistant » et l'écriture
rejetée en 400. L'opérateur devait retrouver, sur tout le catalogue, qui citait
son forfait avant d'avoir le droit de le supprimer — sur cinquante packs, une
chasse au trésor.

C'est exactement l'exigence que le lot posait, et la première recette l'a
trouvée en échec. La correction distingue les deux causes opposées d'une
référence pendante :

- la cible **existait** et cette écriture la retire → c'est la suppression
  demandée, la ligne s'efface, l'écriture passe ;
- la cible **n'a jamais existé** → identifiant inventé, refus maintenu.

Le contrôleur lit l'état d'avant l'écriture et le passe à la validation. Un test
de non-régression verrouille les deux sens (`catalog-generic-pricing.test.js`
§ 8).

---

## 13 · Un second défaut, trouvé par la suite complète

**L'API refusait une charge utile héritée à l'écriture.** `POST /api/services`
avec `{ mode: 'FIXED', basePrice: 60, complements: [...] }` — la forme que toute
intégration antérieure envoie — repartait en 400 : sans `entries`, un prix « à
partir de » n'a aucun montant.

Le catalogue lisait donc l'héritage sans broncher et refusait qu'on le lui
écrive : deux réponses opposées à la même donnée, selon le sens de la flèche.

La charge utile est désormais **traduite au seuil de l'écriture**, avec
exactement la correspondance de la migration. Assouplir la validation aurait
laissé entrer en base des documents à l'ancienne forme **après** la migration —
c'est-à-dire rouvrir pour toujours le double modèle qu'on venait de refermer,
puisque plus aucune migration ne repasserait.

---

## 14 · Tests

### 14.1 Nouvelles suites

| Suite | Contrôles | Ce qu'elle verrouille |
|---|---|---|
| `catalog-generic-pricing.test.js` | **82** | référentiel, deux axes, composition, cycles, migration, compatibilité de lecture, absence de taxonomie automobile |
| `catalog-no-seed.test.js` | **16** | une base vide reste vide au démarrage ; une base remplie est identique **bit pour bit** ; aucun contenu client dans le runtime |

Toutes deux enregistrées dans la chaîne `npm test`.

### 14.2 Chaîne complète du backend

`npm test` — **exit 0**, toutes suites vertes, dont `smoke-test.js` à
**108 réussis / 0 échoué** après correction du § 13.

### 14.3 Recettes de bout en bout

| Recette | Cible | Résultat |
|---|---|---|
| métier (API) | TEST déployé | **OK** — 28 contrôles |
| vitrine (navigateur) | TEST déployé, 6 largeurs | **OK** — 54 contrôles |
| Manager (navigateur) | TEST déployé | **OK** — 15 contrôles |

### 14.4 Builds

`tsc --noEmit` vitrine ✓ · `tsc --noEmit` manager ✓ · `vite build` vitrine ✓ ·
`vite build` manager ✓.

### 14.5 Non-régression OpenSign / signature

Aucun fichier du domaine signature n'a été touché par ce lot (`git status`
vide sur `opensign`). Vérifié par exécution :
`contract-billing-signature` 30/30 · `contract-lifecycle` 48/48.

---

## 15 · Nettoyage

Toutes les données créées pour les recettes ont été retirées, et l'état
d'origine reconstitué :

- service « Recette — entretien de bateaux » : supprimé (204) ;
- gammes « Châssis court », « Châssis long », « Voilier », « Petit volume »,
  « Grand volume », « Recette éphémère », « Recette seconde » : supprimées ;
- référentiel final : **0 gamme** — exactement l'état d'avant ;
- catalogue client : empreinte d'identifiants identique avant/après.

Une première recette a laissé deux artefacts derrière elle (un service et deux
gammes) parce qu'une écriture refusée avait rendu `undefined` la variable que le
nettoyage utilisait. Les artefacts ont été retirés dans la minute, et le script
a été corrigé pour que l'identifiant de nettoyage ne dépende jamais d'une
réponse ultérieure.

---

## 16 · Ce qui n'a pas été fait, et pourquoi

**R.L.V Detail n'a été semé nulle part.** Interdit par le lot, et aucun code ne
sème plus quoi que ce soit.

**Le refus de suppression d'une gamme utilisée n'a pas été éprouvé en HTTP sur
le catalogue client.** Le faire aurait exigé d'attacher une gamme à un tarif
réel du client — une modification de donnée métier faite uniquement pour tester,
que le lot interdit. Le comportement est éprouvé deux fois : par les suites en
base mémoire, et sur l'environnement déployé avec un catalogue créé pour la
recette (§ 11.5).

**Les lignes « Pack simple », « Pack Confort », etc. n'ont pas été converties en
`PACK_REF`.** Le lot l'interdit explicitement : déduire une référence d'une
correspondance de nom est une décision commerciale. Les convertir est un geste
d'un clic dans l'éditeur, et il appartient à l'opérateur.

---

## 17 · Risques résiduels

**1. Le repli de la vitrine sans `pricingView` n'affiche aucun prix.**
`PackCard` retombe sur `display: 'NONE'` si la vue est absente. En exploitation
elle est toujours servie, et l'ordre de déploiement (backend avant vitrine)
garantit qu'elle l'est. Une vitrine déployée seule, contre un backend antérieur,
afficherait des cartes sans prix. Implémenter un repli lisant les champs
hérités reconstruirait la règle une seconde fois — exactement ce que le § 4
existe pour empêcher.

**2. La protection de suppression d'une gamme n'est pas transactionnelle.**
Compter → supprimer → recompter → restaurer réduit la fenêtre sans la fermer.
Une transaction MongoDB la fermerait ; elle exigerait un jeu de réplique, ce que
la configuration actuelle n'impose pas.

**3. Le catalogue client n'exerce aucune gamme.** Les six forfaits portent un
tarif unique sans gamme. Les grilles, l'accordéon et le compteur d'usage sont
donc éprouvés par les recettes, pas par l'usage quotidien — ils le seront au
premier client qui en créera.

---

## 18 · Les deux questions du lot

> **Peut-on désormais dupliquer SB Auto pour un nouveau centre de lavage et
> construire tout son catalogue depuis la base et le Manager, avec ses propres
> gammes de prix, sans toucher au code générique ?**

**OUI.** La recette § 11 l'a fait sur l'environnement déployé, avec un métier
volontairement non automobile : trois gammes créées depuis l'API (« Châssis
court », « Châssis long », « Voilier »), un service et deux forfaits construits
de bout en bout, les quatre cas d'affichage vérifiés, la composition et les
cycles éprouvés — sans qu'une ligne de code applicative soit modifiée. Un projet
neuf démarre par ailleurs avec 0 avis, 0 FAQ, 0 extra et 0 gamme.

> **La version déployée de SB Auto utilise-t-elle le nouveau modèle sans perte
> de données ni régression visible ?**

**OUI.** Le déploiement TEST sert la nouvelle forme exclusivement — les champs
hérités ont été retirés, une seule vérité subsiste. L'inventaire logique
avant/après est identique : 6 montants, somme 374, 19 lignes incluses. La
vitrine rend les mêmes prix, dans la même présentation, aux six largeurs
contrôlées, sans `undefined`, sans `NaN`, sans identifiant visible, sans
débordement et sans erreur de console.

---

## Verdict

PASS
