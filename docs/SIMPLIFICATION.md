# Ce que ce projet RETIRE au moteur — et pourquoi

> Toutes les duplications précédentes ont ajouté au moteur : un module de
> chronométrage, des jauges de kart, des configurations de piste. Celle-ci est
> la première à **soustraire**. C'est un geste plus risqué que d'ajouter, et
> cette page dit ce qui a été retiré, ce qui a été gardé, et ce qui a été
> reconstruit à la place.

---

## 1. La règle qui a décidé

**Un référentiel qui ne peut rien contenir sur ce site n'est pas « vide » : il
est faux.**

Un écran de Manager qui ouvre un formulaire dont personne ne remplira jamais un
champ apprend à son propriétaire qu'une partie de son espace ne le concerne pas
— après quoi il cesse de lire le menu, y compris les entrées qui, elles, le
concernent. Une route d'API qui répond `200 []` pour l'éternité est une surface
à maintenir, à tester et à sécuriser pour rien. Et un modèle mongoose inutilisé
finit par être réutilisé de travers, parce qu'il est là.

Le moteur d'origine sert un circuit de karting : il vend des forfaits tarifés par
gamme et par machine, il expose une flotte, des tracés, des avis, des questions
fréquentes et des bandeaux promotionnels programmés. L.Y Solution ne vend rien de
tel : elle expose une **méthode**, en quatre chapitres, et son plan de site
refuse explicitement toute page tarifs et toute section « nos réalisations ».

---

## 2. Ce qui a été retiré

### Les neuf référentiels de contenu

| modèle | ce qu'il portait | pourquoi il part |
|---|---|---|
| `Service` | catégories, forfaits, options, grilles | aucune offre listée, aucun prix public |
| `PricingRange` | gammes de prix (adulte / ado / enfant) | idem |
| `Kart` | flotte, cylindrées, jauges, âge minimum | rien à exposer |
| `Circuit` | tracés, cotes, plans, records | rien à exposer |
| `Review` | avis clients, notes, photos jointes | le plan de site refuse la preuve par le volume |
| `Faq` | questions fréquentes | quatre chapitres répondent mieux qu'une liste |
| `BeforeAfter` | comparateur avant/après | outil de detailing automobile, hérité de deux moteurs en arrière |
| `PromotionBanner` | bandeaux programmés, compte à rebours | une maison de conception ne fait pas de promotion datée |
| `LiveTiming` | raccordement Apex Timing | propre au karting |

Avec eux sont partis : neuf contrôleurs, neuf jeux de routes, quatre
validateurs, deux services de catalogue, le sélecteur de bannière active, onze
écrans de Manager, huit pages ou composants de vitrine, et huit suites de tests.

### Trois traitements, et pas seulement des écrans

**Les horaires d'ouverture** (`Company.businessHours`, `timezone`,
`utils/openingStatus.js`, le badge « ouvert / fermé »). Une maison de conception
n'a pas de guichet : elle n'ouvre pas à 9 h et ne ferme pas le dimanche. Un bloc
d'horaires y aurait annoncé une disponibilité qu'on ne tient pas, et le
« fermé » du samedi aurait suggéré, à tort, qu'on ne répond pas.

**La carte Google Maps** de la page de contact. Le site ne reçoit personne dans
une boutique ; la carte n'aurait servi qu'à faire partir l'adresse IP de chaque
visiteur chez un tiers pour désigner un lieu où personne ne vient. C'est ce qui
permet à la politique de confidentialité de ce site d'affirmer, sans réserve,
qu'aucune carte n'est chargée — et `vitrine-responsive.test.js` refuse
désormais toute `<iframe>` sur cette page.

**Le compteur « X+ clients satisfaits »** reste dans le modèle mais vaut zéro,
et zéro n'affiche rien. C'est la même preuve par le volume que la section
« réalisations », sous une autre forme.

---

## 3. Ce qui les remplace : `Chapter`

Un seul modèle, parce que les quatre chapitres du plan de site ont exactement la
même forme :

```
kicker      « 02 / Conception »          le filet au-dessus du titre
title       « Conception »
lead        le chapô, deux lignes
layout      PILLARS · STEPS · SPLIT      comment les volets se peignent
items[]     icône, libellé, titre, texte jusqu'à douze volets
statement   libellé + phrase             « Nous ne choisissons pas un design… »
```

### `layout` est une DONNÉE, pas une convention de nommage

Les mêmes volets rendus en piliers, en étapes numérotées ou en deux espaces
opposés ne disent pas la même chose : les piliers se lisent dans n'importe quel
ordre, les étapes ont un avant et un après, les deux espaces s'opposent.

La tentation évidente aurait été de choisir le rendu d'après le NOMBRE de
volets. C'est exactement ce qu'il ne faut pas faire : un chapitre aurait basculé
d'un rendu à l'autre le jour où quelqu'un ajoute un volet, sans l'avoir demandé
et sans comprendre pourquoi.

### Ce que `Chapter` n'est pas

Ce n'est pas une page éditoriale. `SitePage` existe toujours, avec ses blocs
libres, et sert ce qui se rédige au fil de l'eau. Un chapitre est l'inverse :
une structure **fermée**, dessinée une fois, dont seul le texte change — c'est
ce qui permet à la vitrine de lui donner une mise en scène propre au lieu d'un
rendu de blocs générique.

---

## 4. Ce qui a été gardé, et ne devait pas bouger

Tout le socle de la fabrique : contrats, facturation, signature, e-mails,
événements métier, moteur de déploiement, moteur de duplication, pont Panel,
autorité média, plan de contrôle, comptes et rôles.

Rien n'y a été touché — sauf trois registres qui NOMMAIENT le métier et
devaient donc suivre :

| registre | avant | après |
|---|---|---|
| `MEDIA_TYPES` / `MEDIA_POLICIES` | `kart-image`, `circuit-layout`, `service-image`, `review-avatar`, `before-after-*`, `banner` | `chapter-image`, et le socle commun |
| `CHAMPS_METIER` (adoption média) | `services`, `reviews`, `beforeafters` | `chapters` |
| `MEDIA_CATALOG` (coordonnées) | téléphone, WhatsApp, e-mail, Instagram, Facebook, TikTok, Snapchat, Google Maps, adresse | e-mail, téléphone, WhatsApp, LinkedIn, Instagram, adresse |

Le registre d'icônes a été **remplacé**, pas complété : `KARTING_ICONS`
proposait des compteurs, des drapeaux à damier et des podiums. Une icône de
trophée offerte sur un volet « Conception » est une invitation à écrire la
mauvaise page. `SITE_ICONS` propose identité, direction, grille, architecture,
processus, livraison.

---

## 5. Le formulaire de contact a changé de nature

Le plan de site est explicite : « Entreprise, activité, projet, coordonnées — le
strict nécessaire », et « Présenter mon projet » plutôt que « Demander un
devis ».

| avant | après |
|---|---|
| motifs `INFORMATION` · `QUOTE` · `WEBSITE_ISSUE` · `SERVICE_QUESTION` · `OTHER` | `NEW_PRESENCE` · `REDESIGN` · `EVOLUTION` · `OTHER` |
| nom, e-mail, téléphone, motif, message | **+ entreprise (obligatoire)**, **+ activité (facultative)** |
| « Réponse sous 24 h ouvrées » | rien — voir plus bas |

**L'entreprise est un CHAMP, pas une ligne du message.** Écrite dans le texte
libre, elle aurait été noyée et impossible à lire d'un coup d'œil dans une
liste ; c'est pourtant la première chose qu'on veut savoir d'une demande. Elle
indexe aussi la recherche du Manager : c'est par elle qu'on retrouve une demande
six semaines plus tard.

**Aucun délai de réponse n'est annoncé.** « Réponse sous 24 h ouvrées » est le
langage d'un service client, et c'est un engagement qu'une maison à capacité
volontairement limitée ne tiendra pas toujours. Une promesse chiffrée non tenue
coûte plus cher que pas de promesse du tout. Ce que la page dit à la place — « ce
qui se passe ensuite », trois lignes — engage sur la MANIÈRE, pas sur l'horloge.

Les deux nouveaux champs sont servis au gabarit d'e-mail sous
`{{contact.company}}` et `{{contact.activity}}`, en **variables facultatives** :
un gabarit qui ne les cite pas les ignore, sans erreur. Le contrat de variables
est publié par le Panel ; les servir coûte deux champs et n'exige aucune
nouvelle version du projet le jour où le gabarit les affichera.

---

## 6. Ce que les tests garantissent encore

Les huit suites propres au catalogue ont été retirées de la chaîne
(`test-suite-coverage.test.js` vérifie qu'aucune suite n'est orpheline et
qu'aucune entrée de la chaîne ne pointe vers un fichier absent). Quatre autres
ont été **portées** plutôt que supprimées :

| suite | ce qu'elle garde |
|---|---|
| `smoke-test.js` | le cycle complet d'un chapitre : création, slug dérivé puis FIGÉ, refus d'un `layout` inconnu, réordonnancement, bootstrap public |
| `remote-legacy-media-adoption.test.js` | l'adoption des médias historiques, sur `chapters` |
| `full-deployment-cross-authority-media.test.js` | les adresses média dérivées de la destination, sur `chapters` |
| `cross-authority-media.test.js` | chaque écran d'import DÉCLARE ce que l'image représente |

`vitrine-responsive.test.js` a été réécrite : ses sections « carrousel » et
« avant/après » visaient des composants qui n'existent plus. Ce qui les remplace
garde ce que ce site a de plus risqué — **le mouvement** :

- la scène 3D et les surfaces inclinables respectent `prefers-reduced-motion` ;
- elles ne s'activent pas au tactile, où il n'y a pas de survol ;
- le suivi du pointeur passe par `requestAnimationFrame` et écrit des variables
  CSS, jamais un état React par pixel ;
- `HeroBanner`, partagé avec le Manager, n'importe rien en `@/…` et n'emploie
  aucun nom de couleur Tailwind — les deux règles qui font qu'un composant peut
  vivre dans les deux applications.

---

## 7. Ce qu'il reste à faire, et qui n'est pas un oubli

- **Les coordonnées** ne sont pas saisies : le plan de site n'en publie aucune.
  Manager › Coordonnées.
- **L'identité juridique** (SIREN, forme, adresse) se saisit dans le Panel,
  fiche « Clients ». Sans elle, les mentions légales affichent les rubriques
  disponibles et taisent les autres — proprement, sans « undefined ».
- **Le code d'appairage** doit être collé dans `backend/.env` après déclaration
  du projet au Panel.
