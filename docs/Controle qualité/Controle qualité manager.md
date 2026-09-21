# CONTRÔLE QUALITÉ — MANAGER

## 1. Objet du document

Ce document définit les exigences minimales obligatoires de qualité applicables
au **Manager** de tous les projets L.Y Solution.

Il est le pendant du *Contrôle qualité — Vitrine*, et il ne le remplace pas :
les deux s'appliquent à un même projet, chacun à son espace.

- La **Vitrine** est lue par un visiteur qui ne connaît pas l'entreprise. Elle
  doit convaincre.
- Le **Manager** est utilisé par le propriétaire du site, souvent seul, souvent
  pressé, parfois depuis un téléphone. Il doit **tenir**.

Un Manager n'a pas de visiteur à séduire : il a un utilisateur à ne pas
trahir. Les défauts qui comptent ici ne sont donc pas les mêmes.

Le Manager est réussi lorsque son utilisateur peut :

1. comprendre ce que chaque écran pilote ;
2. savoir ce qu'il a le droit de saisir **avant** de le saisir ;
3. constater sans ambiguïté que son travail est enregistré ;
4. comprendre un refus, et savoir quoi en faire ;
5. ne jamais perdre son travail par accident ;
6. faire tout cela depuis un téléphone.

Il est volontairement universel : aucun de ses articles ne dépend d'un métier,
d'un client, d'un écran ou d'un référentiel particulier.

---

## 2. Règle fondamentale — l'interface ne promet que ce que le serveur tient

C'est la règle dont découle la moitié de ce document.

Une interface d'administration a deux façons de mentir, et les deux sont
graves :

- elle **laisse composer** un état que le serveur refusera ensuite ;
- elle **annonce comme fait** ce que le serveur n'a pas encore confirmé.

Dans les deux cas, l'utilisateur apprend à ne plus croire son écran. Une fois
cette confiance perdue, plus aucune amélioration ergonomique ne la rachète : il
rechargera la page pour vérifier, à chaque enregistrement, pour toujours.

Le contrat est donc simple :

> Le **serveur** décide. L'**interface** empêche de construire ce qui sera
> refusé, et n'affirme rien avant d'avoir été confirmée.

---

## 3. Les invariants métier ont une source unique

### 3.1 Une règle, un fichier

Toute contrainte qu'un utilisateur peut atteindre — nombre maximal d'éléments
d'une liste, longueur d'un champ, bornes d'un nombre, valeurs autorisées d'une
énumération — doit être **déclarée à un seul endroit**, et lue par tous ceux qui
en dépendent :

- le validateur du serveur, qui **refuse** ;
- les graines, migrations et jeux de démonstration, qui **écrivent** ;
- l'interface, qui **empêche de composer** l'état fautif ;
- les tests, qui **figent** la règle.

Une valeur recopiée dans un second fichier n'est pas une duplication anodine :
c'est une divergence à retardement. Les deux copies coïncident le jour où on
les écrit, et rien ne signale le jour où l'une des deux bouge.

### 3.2 Le miroir client est vérifié, pas espéré

Lorsque l'interface ne peut pas importer la déclaration du serveur — deux
applications, deux constructions —, elle en tient un **miroir**, et ce miroir
est contrôlé par un test qui lit la source d'origine et compare valeur par
valeur.

Un miroir sans test n'est pas un miroir : c'est une copie qui se périmera.

Le test doit vérifier **trois** choses, pas une :

- les valeurs communes sont identiques ;
- aucune déclaration du serveur ne manque au miroir ;
- aucune entrée du miroir n'est inconnue du serveur.

### 3.3 Les nombres viennent du rendu, pas du goût

Une cardinalité n'est presque jamais une préférence : c'est la conséquence
d'une mise en page. Une grille de quatre colonnes autorise quatre éléments ; un
composant qui coupe à trois en autorise trois.

Ces nombres doivent donc être **justifiés par ce que le rendu sait afficher**,
et le lien mérite d'être vérifié : si l'affichage change et que la limite ne
suit pas, la règle redevient fausse en silence.

---

## 4. Les graines respectent les invariants de production

Une graine, une migration de contenu, un jeu de démonstration : tout ce qui
écrit des données sans passer par un formulaire doit **passer les validateurs
de production**.

Un projet livré avec des données que sa propre application refuse est cassé
avant le premier clic. L'utilisateur ouvre un écran déjà invalide, modifie une
ligne sans rapport, enregistre, et se fait refuser pour une donnée qu'il n'a
jamais saisie — et parfois qu'il ne peut pas retirer, parce que l'interface a
elle aussi cru à une autre limite.

**Exigence** : une recette rejoue les graines à travers les validateurs réels
et échoue si l'une d'elles est refusée.

**Exigence complémentaire** : la graine doit tenir **avec de la marge** sous les
limites. Une graine qui frôle le plafond signale une limite mal posée, qu'une
phrase de plus fera basculer.

---

## 5. Toute écriture est validée côté serveur

Aucune route d'écriture ne doit être servie sans validation, quelle que soit
son ancienneté et quelle que soit la qualité de l'écran qui l'appelle.

L'argument « seul notre écran appelle cette route » ne tient pas :

- un onglet resté ouvert envoie l'ancienne forme du document ;
- un script d'administration, une migration ou une recette écrit directement ;
- un défaut de l'écran devient un défaut de la base.

Une limite qui n'existe que dans une propriété de composant n'existe pas.

### 5.1 Un refus, jamais un écrêtage silencieux

Lorsqu'un rendu tronque (« n'affiche que les quatre premiers »), le serveur
doit **refuser** au-delà.

Sans refus, l'utilisateur publie un élément qui ne s'affiche nulle part et rien
ne le lui dit. Une coupe silencieuse est pire qu'un refus : le refus s'explique,
la disparition ne se remarque pas.

### 5.2 Le contournement de l'interface est testé

Les recettes doivent contenir au moins un cas où la requête est envoyée
**sans passer par l'écran**, aux bornes exactes :

- la valeur limite passe ;
- la valeur limite + 1 est refusée ;
- ce qui a été accepté est **relu à l'identique**, sans coupe ni normalisation
  surprise ;
- un refus **n'écrit rien** : l'état antérieur est intact.

---

## 6. Langue — le Manager est en français, sans exception

### 6.1 Toutes les surfaces

Interface, libellés, aides, états vides, chargements, confirmations, toasts,
erreurs de formulaire, erreurs réseau, erreurs d'authentification, statuts
métier, noms accessibles, infobulles.

### 6.2 Les bibliothèques parlent anglais par défaut

C'est la première source réelle d'anglais dans un produit francophone, et elle
est invisible à la relecture : personne n'a écrit ces phrases.

Une contrainte de validation sans message rédigé rend le message **de la
bibliothèque** :

> `String must contain at most 40 character(s)`
> `Array must contain at most 3 element(s)`
> `Path \`value\` is required.`

**Exigence** : chaque moteur de validation utilisé côté serveur reçoit une
**carte de messages en français**, installée globalement, une fois par
processus. Rédiger les messages un par un ne suffit pas : il en manquera
toujours un, et ce sera celui qu'un utilisateur atteindra.

Deux pièges à connaître :

- certaines bibliothèques **figent** leur message au moment où le schéma est
  défini, pas au moment du refus. Une carte installée trop tard ne change rien
  aux modèles déjà chargés : l'installation doit donc aussi **réparer** ce qui
  est déjà compilé, sinon elle dépend d'un ordre d'import que personne ne
  documentera ;
- la réparation ne doit toucher **que** les phrases par défaut. Un message
  rédigé volontairement dans un modèle doit rester intact.

### 6.3 Les énumérations techniques ne s'affichent pas brutes

`CONNECTED`, `DEGRADED`, `PENDING_ACTIVATION` sont des identifiants de code.

Ils se traduisent — et un état inconnu de la table de traduction s'affiche
**tel quel**, jamais ramené de force à un libellé faux.

---

## 7. Les erreurs affichées sont écrites pour un humain

### 7.1 Le message du serveur reste prioritaire

Il en sait davantage que le client : il connaît l'entité, la règle, le motif.
Le retraduire côté interface créerait deux vérités.

### 7.2 Mais il doit ressembler à une phrase adressée à quelqu'un

Le motif `toast.error(error.message)` n'est pas fautif en soi ; il l'est parce
que rien ne garantit que la phrase reçue ait été **écrite pour être lue**.
Trois sources en fabriquent sans que personne les ait rédigées :

- les bibliothèques de validation ;
- les passerelles en panne, qui répondent du HTML ;
- les exceptions non prévues, dont le message est un détail d'implémentation.

**Exigence** : une fonction unique décide de ce qui s'affiche. Elle conserve le
message du serveur lorsqu'il est rédigé, et le remplace par une phrase déduite
du **statut HTTP** lorsqu'il ne l'est pas — le détail technique partant dans le
journal.

Elle ne masque **jamais** une erreur métier : « Impossible de supprimer cet
élément : il est utilisé par deux contrats » est exactement ce que l'utilisateur
doit lire.

### 7.3 Ne jamais exposer un détail interne

Aucune trace de pile, aucun JSON brut, aucun chemin de fichier, aucun nom de
classe d'erreur, aucun identifiant technique non nommé.

Les détails restent disponibles pour les journaux, l'observabilité et le
diagnostic développeur.

### 7.4 Distinguer les pannes qui se ressemblent

« Le serveur n'a pas répondu », « le serveur a répondu par une erreur », « la
session a expiré », « la limite de tentatives est atteinte » sont **quatre**
situations différentes. Les fondre dans un même message envoie l'utilisateur
réparer ce qui n'est pas cassé.

---

## 8. Formulaires — la contrainte se voit avant la soumission

### 8.1 Règle générale

Pour tout champ dont le système connaît la contrainte, l'interface doit
**communiquer cette contrainte avant** que l'utilisateur ne la franchisse, et
autant que possible l'empêcher de la franchir.

Selon le champ :

- longueur maximale appliquée à la saisie ;
- compteur (`37 / 40`) lorsque la limite est serrée ;
- bornes minimales et maximales des nombres ;
- format attendu, montré par l'exemple plutôt que décrit ;
- champs obligatoires clairement identifiés ;
- types, tailles et nombre de fichiers acceptés, **avant** la sélection ;
- validation en ligne quand elle évite un aller-retour ;
- désactivation d'une action devenue impossible.

### 8.2 Ne pas transformer un formulaire en tableau de bord

Un compteur permanent sur vingt champs détourne l'attention de ce qu'il y a à
écrire. Le compteur n'apparaît qu'à l'approche de la limite.

L'information doit être **discrète, cohérente et constante** d'un écran à
l'autre.

### 8.3 Un champ qui cesse d'accepter des lettres doit s'expliquer

Bloquer la saisie sans rien dire se lit comme un clavier cassé. La limite
appliquée s'accompagne toujours de sa lecture.

### 8.4 Le libellé doit être RELIÉ au champ

Un libellé posé à côté d'un champ est un libellé pour l'œil seulement.

Deux formes très ordinaires cassent ce lien sans que rien ne se voie :

- le champ est **enveloppé** (conteneur positionné pour poser une icône) : le
  libellé désigne alors le conteneur ;
- le composant de champ reçoit **plusieurs enfants** : l'injection automatique
  d'identifiant ne s'applique plus du tout.

Le résultat est identique et silencieux : un lecteur d'écran annonce « zone
d'édition » sans dire laquelle. **Exigence** : le composant de champ doit offrir
un moyen **explicite** de désigner le champ, et les écrans concernés l'utilisent.

---

## 9. Collections limitées

Lorsqu'une liste a un maximum :

- l'interface **empêche** d'en composer un de plus ;
- le bouton d'ajout **reste visible et désactivé**, et **porte sa raison** ;
- le serveur refuse au-delà.

Un bouton qui **disparaît** ne dit rien : l'utilisateur cherche ce qu'il a
cassé, ou conclut qu'il n'a pas le droit.

Lorsqu'une liste a un minimum, la suppression du dernier élément est refusée
avec la même clarté.

### 9.1 L'identité d'une ligne n'est pas son rang

Une liste dont les éléments se réordonnent, s'insèrent ou se suppriment doit
donner à chaque ligne une **identité stable**, indépendante de sa position et
de son contenu.

Sans cela, l'interface réconcilie par position, et le défaut est déroutant
plutôt que visible :

- le focus reste sur la ligne d'avant, qui contient désormais un autre texte ;
- la position du curseur est perdue à chaque déplacement ;
- supprimer une ligne du milieu fait « remonter » la suivante dans le champ que
  l'on regardait, ce qui se lit comme une suppression ratée.

La valeur saisie ne peut pas servir d'identité : elle est vide à la création et
change à chaque frappe.

---

## 10. Feedback des mutations

Toute action qui écrit doit avoir un retour **explicite** :

- un état « en cours » visible ;
- une confirmation **après** la réponse du serveur, jamais avant ;
- un échec qui **rend la main** : le travail reste à l'écran, l'action reste
  rejouable.

Interdits :

- un clic sans aucun retour ;
- une confirmation de succès affichée avant la réponse ;
- un chargement qui ne se termine jamais ;
- une action déclenchable une seconde fois pendant qu'elle s'exécute.

### 10.1 Prévenir la double soumission

Le bouton qui déclenche l'écriture est désactivé pendant celle-ci. C'est la
protection la plus simple et la plus efficace contre les doublons — et elle ne
dispense pas de l'idempotence côté serveur là où un doublon coûte cher.

### 10.2 L'état d'enregistrement doit être lisible sans chercher

Sur un écran d'édition long, l'utilisateur doit pouvoir répondre à « mon travail
est-il enregistré ? » **sans remonter le formulaire**. Un indicateur persistant
(reposé / modifié / en cours / enregistré) répond mieux qu'un message fugace.

---

## 11. Données non enregistrées

Une surface d'édition doit protéger le travail en cours contre la perte
accidentelle : rechargement, fermeture d'onglet, retour arrière.

**Exigence de conception** : cette protection se pose **là où l'état
« modifié » est connu** — c'est-à-dire dans le mécanisme d'enregistrement
partagé, pas dans chaque écran.

Posée écran par écran, elle sera oubliée : c'est ce qui arrive, et le symptôme
est qu'un seul écran sur huit la porte.

Lorsqu'une fermeture est déclenchée volontairement (fermer une fenêtre modale
d'édition), l'abandon se **confirme**, en nommant ce qui sera perdu.

---

## 12. États vides, de chargement et d'erreur

Toute donnée distante possède quatre états : **chargement**, **chargée**,
**vide**, **erreur**. Aucun ne se déduit d'un autre.

### 12.1 L'état vide est utile

Il dit ce qui manque, éventuellement pourquoi, et quelle action effectuer. Un
grand espace blanc n'est pas un état vide.

### 12.2 L'état vide ne ment pas

Un état vide qui décrit un comportement de repli **doit décrire le comportement
réel**. Une phrase héritée d'une version précédente (« la page affichera alors
ceux qu'elle déduit… ») devient une fausse promesse dès que le repli a été
retiré — et elle est d'autant plus nuisible qu'elle rassure.

### 12.3 Rien de technique n'atteint l'écran

Aucun écran blanc, aucun `undefined`, `null`, `NaN`, `[object Object]`, aucune
trace de pile, aucun JSON brut, aucun chargement sans fin.

**Exigence de recette** : ces marqueurs se cherchent automatiquement dans le
**texte rendu** de chaque écran, pas à l'œil.

---

## 13. Actions destructrices

Toute suppression, désactivation, résiliation, réinitialisation, révocation ou
dissociation doit :

- demander confirmation ;
- **nommer ce qui sera perdu**, et ce qui ne le sera pas ;
- dire si le geste est **réversible**, et à quel prix ;
- être libellée par son verbe réel, jamais par « Confirmer » seul.

Un geste qui coupe un raccordement, une intégration ou un accès est destructeur
même s'il n'efface aucune donnée : il faut le traiter comme tel.

Une suppression refusée pour raison métier s'explique :

> **Impossible de supprimer cet élément : il est utilisé par deux contrats.**

---

## 14. Responsive — exigence absolue

Un Manager n'est pas terminé s'il n'est pas utilisable sur un téléphone. Le
propriétaire d'un site consulte ses demandes, publie une page ou vérifie une
facture depuis son mobile — c'est le cas d'usage courant, pas l'exception.

Contrôle minimal sur : mobile étroit, mobile standard, tablette, ordinateur
portable, grand écran.

### 14.1 Aucun débordement horizontal

Une barre de défilement horizontale sur un écran d'administration est un
défaut, jamais une adaptation.

Quatre causes couvrent la quasi-totalité des cas, et aucune ne se voit à la
relecture du code :

1. **Les éléments d'une grille refusent de rétrécir.** Ils valent
   `min-width: auto` par défaut : un enfant portant un ratio d'image, un tableau
   ou un texte insécable impose sa largeur minimale à toute la colonne.
2. **Les listes déroulantes prennent la largeur de leur plus longue option.**
   Un filtre à intitulés longs pousse la page hors de l'écran.
3. **Les chaînes insécables** — URL, identifiants, jetons — ne se coupent nulle
   part si on ne le leur autorise pas.
4. **Les rangées d'actions ne se replient pas.** Un en-tête portant trois
   commandes suffit à déborder sur un écran étroit.

**Exigence** : la recette de débordement doit **nommer l'élément coupable**. Un
constat global (« la page déborde de trente pixels ») ne se corrige pas.

Elle doit aussi **ignorer ce qui est masqué** par un conteneur : un décor posé
en absolu dans une carte à débordement masqué sort de sa boîte sans faire
défiler quoi que ce soit. Une recette qui le signale apprend à ses lecteurs à
ignorer ses verdicts.

### 14.2 Les rangées denses se replient

Une ligne de liste qui empile poignée, vignette, titre, pastille, interrupteur
et boutons ne tient pas sur un écran étroit. Les commandes passent à la ligne ;
elles ne s'écrasent pas.

Un bouton comprimé à seize pixels de large n'est pas « petit » : il est
inutilisable.

### 14.3 Les tableaux complexes ont une vraie stratégie mobile

Cartes, priorisation de colonnes, défilement horizontal **délimité et assumé**,
menu d'actions : le choix dépend du contenu. Ce qui est interdit, c'est
l'absence de choix.

Aucune action essentielle ne doit devenir inaccessible.

### 14.4 Un seul propriétaire du défilement

Le document possède le défilement vertical. Tout conteneur défilant
supplémentaire est **local, volontaire et contenu**.

Un geste tactile doit produire une réponse : aucun geste absorbé, aucun
défilement imbriqué subi, aucune barre fixe qui masque une commande.

### 14.5 Les fenêtres modales tiennent dans l'écran visible

Hauteur plafonnée à la **hauteur visible** (et non à la hauteur théorique de la
fenêtre), en-tête et actions toujours atteignables, corps défilant à
l'intérieur.

Une modale dont le bouton de fermeture sort de l'écran est un piège.

---

## 15. Accessibilité — les fondamentaux, tenus

- navigation clavier possible sur les parcours essentiels ;
- focus visible ;
- fenêtres modales : piège à focus, fermeture au clavier, **restitution du
  focus** au déclencheur ;
- champs étiquetés, et le libellé **relié** au champ (voir §8.4) ;
- **tout bouton porte un nom accessible** — c'est la règle la plus violée, et
  les récidivistes sont toujours les mêmes : la poignée de réordonnancement,
  l'interrupteur de publication, l'icône seule d'une ligne de liste ;
- un nom accessible **désigne sa ligne** : quatre boutons « Modifier » dans une
  liste ne disent rien ; « Modifier « Conception » » dit tout ;
- cibles tactiles suffisantes pour les **commandes** (bouton, interrupteur, lien
  dessiné en bouton). Un lien à l'intérieur d'une phrase reste du texte ;
- contraste suffisant, y compris pour les états désactivés ;
- aucune information portée uniquement par la couleur ;
- annonces d'état (`aria-live`) pour ce qui change sans action de l'utilisateur.

### 15.1 Un lien n'enveloppe pas un bouton

L'imbrication d'éléments interactifs est interdite par la spécification : deux
cibles se superposent, la boîte calculée n'est pas celle qu'on voit, et le
comportement au clavier dépend du moteur.

Un design system doit offrir de quoi **styler un lien en bouton**, et les écrans
doivent l'utiliser.

### 15.2 Une valeur absente n'est pas une valeur vide

Un champ à format contraint (couleur, date, nombre) refuse une chaîne vide : le
navigateur émet un avertissement à chaque rendu, puis affiche une valeur par
défaut **sans le dire**.

La valeur de repli est fournie explicitement, et l'interface annonce que la
valeur reste **à définir** plutôt que d'afficher une valeur qui n'est pas
enregistrée.

---

## 16. Cohérence des actions

Une même opération conserve, dans tout le Manager :

- le même vocabulaire ;
- la même icône ;
- la même hiérarchie visuelle ;
- le même comportement ;
- la même logique de confirmation.

Pas de « Save » ici, « Enregistrer » là et « Valider » ailleurs pour le même
geste. Le vocabulaire d'un Manager français est : **Ajouter, Modifier,
Enregistrer, Annuler, Supprimer, Dupliquer, Publier, Dépublier, Télécharger,
Envoyer, Signer, Payer, Rembourser, Réessayer**.

---

## 17. Aucune information fausse dans l'interface

Un Manager dupliqué depuis un autre projet hérite des **textes** de sa source :
exemples de saisie, aides, états vides, simulations, libellés de menu.

Ces textes deviennent **faux** dès que le métier change, et ils sont d'autant
plus nuisibles qu'ils ont l'air d'être documentés : un exemple qui décrit un
autre métier apprend à l'utilisateur que l'aide de cet écran ne le concerne pas
— après quoi il ne la lit plus nulle part.

**Exigence de duplication** : passer en revue, écran par écran, tous les
exemples de saisie, aides, états vides et simulations, et vérifier qu'ils
parlent du métier du projet.

Interdiction complémentaire : ne jamais présenter comme existante une
fonctionnalité retirée, ni comme automatique un repli supprimé.

---

## 18. Authentification et session

- connexion, déconnexion, expiration, reprise après expiration ;
- accès direct à une route protégée : redirection propre, sans perte de
  destination lorsque c'est possible ;
- identifiants invalides : message **identique** que le compte existe ou non ;
- panne réseau **distinguée** d'un refus ;
- un refus émis par un **système tiers** ne doit jamais être interprété comme
  l'expiration de la session locale — une faute de frappe dans un code
  d'appairage ne déconnecte personne ;
- les routes d'authentification ne sont pas mises en cache ;
- l'état de session est **cloisonné par projet** : plusieurs Managers servis sur
  une même origine ne doivent jamais partager un jeton ni un cache d'identité.

### 18.1 Rate limiting

La protection contre le forçage est **serveur**, jamais un délai d'interface.

Elle doit :

- être **persistante** (un redémarrage ne remet pas les compteurs à zéro) ;
- compter **par adresse ET par identité soumise** — chacun seul est
  contournable, de façon symétrique ;
- rester active dans **tous les environnements**, y compris de test déployé ;
- répondre un statut **distinct d'un refus d'identifiants**, avec un délai
  annoncé ;
- **n'apprendre rien** sur le compte : ni son existence, ni le nombre d'essais
  restants ;
- s'ouvrir d'elle-même par fenêtre glissante — jamais de verrouillage définitif,
  qui transformerait une nuisance en déni de service ;
- ne pas dégrader l'usage normal.

Les routes qui **déclenchent un envoi d'e-mail** vers une adresse fournie par
l'appelant sont limitées plus sévèrement que la connexion : le risque n'est pas
seulement d'ouvrir une session, c'est d'inonder une boîte tierce.

---

## 19. Raccordement au Panel

Lorsque l'architecture du projet prévoit un raccordement au Panel L.Y Solution,
le Manager doit représenter clairement :

- **non raccordé** — et dire que le projet fonctionne alors de façon autonome ;
- **raccordement en cours** ;
- **raccordé**, avec ce que cela recouvre ;
- **erreur**, avec un motif compréhensible ;
- **raccordement expiré ou invalide**, lorsque cet état existe.

Exigences :

- aucun secret n'est exposé dans l'interface, ni dans son état, ni dans ses
  journaux ;
- un code à usage unique est **effacé du champ** après emploi : le laisser
  laisse croire qu'on peut réessayer avec ;
- l'état du **transport** et l'état de la **livraison** sont deux choses : un
  raccordement peut être « connecté » alors que toutes les écritures métier sont
  refusées. Le second état doit être visible quand il est mauvais, et **absent**
  quand tout va bien — un projet sain ne gagne pas un champ de plus ;
- la dissociation est une action destructrice (§13) : elle se confirme, en
  nommant ce qui s'arrête et ce qu'il faudra pour revenir.

---

## 20. Contrats et signature

Le circuit contractuel doit être **complet**, pas réduit à un bouton.

Selon ce que l'architecture prévoit réellement, contrôler : création,
données injectées, visualisation, version, envoi, destinataire, statut,
signature, retour du prestataire de signature, rafraîchissement du statut,
document signé, téléchargement, erreurs, nouvelle tentative, historique.

Exigences transverses :

- les statuts sont **français** et décrivent la situation du point de vue de
  l'utilisateur ;
- ils correspondent aux **capacités réelles** du prestataire : ne jamais
  inventer un état métier qui n'existe pas ;
- le statut affiché **survit à un rechargement** — il vient du serveur, pas d'un
  état local ;
- l'attente est nommée : « en attente de signature » n'est pas une erreur, et ne
  doit pas s'afficher comme telle.

---

## 21. Paiements

- montant, devise et objet affichés avant l'engagement ;
- initiation, redirection, retour ;
- **le retour du navigateur ne prouve rien.** Lorsque l'architecture possède une
  confirmation serveur, c'est elle qui fait foi. L'écran de retour interroge le
  serveur et **attend** avant de conclure ;
- l'attente est bornée, et sa fin dit quoi faire — jamais un chargement sans
  fin ;
- « en cours de confirmation » est un état affichable, distinct du succès et de
  l'échec ;
- échec, abandon et nouvelle tentative sont trois parcours distincts ;
- idempotence : rejouer ne débite pas deux fois ;
- l'utilisateur peut fermer la page sans casser le parcours — le statut se
  mettra à jour de lui-même.

---

## 22. Factures

Le Manager doit permettre de comprendre, sans interprétation :

numéro · date · client · montant HT · TVA · montant TTC · statut · paiement
associé · date de paiement · téléchargement · avoirs et remboursements lorsque
le modèle les prévoit.

Exigences :

- les statuts sont français et **cohérents** avec ceux du contrat et du
  paiement ;
- les montants sont formatés selon la locale, avec leur devise ;
- une facture rattachée manuellement est **identifiée comme telle** ;
- ces écrans sont soumis aux mêmes règles de responsive que le reste : un
  tableau de facturation est le premier à déborder.

---

## 23. Cohérence métier de bout en bout

**Contrat → Signature → Paiement → Facturation → Suivi**

Le parcours doit être **relié**, pas juxtaposé. Quatre écrans corrects mais
indépendants forment un produit incohérent.

Contrôles :

- les statuts affichés correspondent à l'état réel du serveur ;
- une étape franchie se reflète dans les écrans voisins ;
- un rechargement ne fait disparaître aucun état ;
- une étape impossible est **expliquée**, pas seulement désactivée.

---

## 24. Manager → Vitrine

C'est le parcours le plus critique du produit : ce que le client modifie doit
apparaître sur son site.

Le contrôle porte sur la **chaîne entière**, pas sur un maillon :

1. la donnée est validée ;
2. elle est enregistrée ;
3. elle est correctement persistée ;
4. elle est correctement renvoyée par l'API ;
5. elle est correctement rendue par la Vitrine ;
6. elle reste correcte après rechargement **et après redémarrage**.

Valider l'API seule, ou le formulaire seul, ne prouve rien : les défauts vivent
aux jointures.

### 24.1 Les limites du Manager suivent le rendu de la Vitrine

Si la Vitrine coupe, tronque ou dessine un nombre fixe d'éléments, le Manager
et le serveur doivent connaître ce nombre (§3.3). Une évolution du rendu qui ne
remonte pas jusqu'aux limites recrée le défaut d'origine.

### 24.2 Une grille doit accepter tous les comptes autorisés

Si le Manager autorise de un à quatre éléments, la Vitrine doit rendre
correctement un, deux, trois **et** quatre. Une grille figée au maximum laisse
un trou visible dès qu'il en manque un — et un trou dans une bande à filet ne se
lit pas comme un espace, mais comme un élément qui n'a pas chargé.

---

## 25. Sécurité de base

Sans prétendre à un test d'intrusion, contrôler :

- routes protégées côté **serveur**, pas seulement masquées côté interface ;
- autorisations vérifiées par rôle sur chaque écriture sensible ;
- validation serveur systématique (§5) ;
- rate limiting sur les surfaces sensibles (§18.1) ;
- **aucun secret dans le frontend**, ni dans le code, ni dans l'état, ni dans le
  stockage local ;
- cookies et sessions correctement configurés ;
- protection contre l'injection de contenu dans tout ce qui est rendu en HTML ;
- uploads : type, taille et nombre contrôlés **côté serveur** ;
- messages d'erreur qui ne divulguent pas la structure interne ;
- journaux sans données personnelles inutiles ni secrets ;
- endpoints d'administration hors de portée des rôles non autorisés.

---

## 26. Uploads

### 26.1 La saisie

- extensions et types réellement acceptés, **annoncés avant** la sélection ;
- taille maximale annoncée, et vérifiée côté serveur ;
- nombre maximal appliqué comme toute collection limitée (§9) ;
- prévisualisation lorsque c'est utile ;
- progression lorsque l'attente est perceptible ;
- erreur explicite, et **rejouable** ;
- suppression et remplacement possibles, et cohérents entre eux : retirer un
  média retire **à la fois** son chemin et son descripteur.

### 26.2 Un fichier importé doit CIRCULER — dans les deux sens

C'est l'exigence la plus coûteuse à ignorer, parce qu'elle ne se voit **jamais**
sur la machine où l'on travaille.

Un Manager s'utilise depuis deux endroits, et les deux comptent :

- **en local**, pendant la conception, la reprise d'un projet ou une correction
  urgente ;
- **en ligne**, par le client, tous les jours.

Or une base de données se promeut, se copie et se partage — **les octets d'un
fichier, non**. Un média importé d'un côté n'existe, physiquement, que de ce
côté-là. La fiche, elle, voyage : elle arrive de l'autre côté en désignant un
fichier que personne n'a. On obtient alors le pire des états — une référence
parfaitement valide vers une image qui n'existe pas.

> **Règle.** Pour **tout** fichier importé, la synchronisation
> **localhost → public** et **public → localhost** doit être opérationnelle.
> Un média importé en local doit pouvoir atteindre le site déployé ; un média
> importé en ligne doit pouvoir être repris en local. Aucune des deux
> directions n'est facultative, et aucune ne se déduit de l'autre.

Les deux sens ne sont **pas** symétriques, et c'est précisément là que le défaut
se loge :

| | localhost → public | public → localhost |
|---|---|---|
| Déclencheur | le déploiement | une reprise explicite |
| Qui possède les octets | le poste | la destination |
| Ce qui manque en face | le fichier | le fichier **et** souvent le descripteur |
| Risque si absent | image jamais servie en ligne | image invisible en local, écrasée au déploiement suivant |

**Exigences des deux côtés :**

- **le transfert est constaté, jamais supposé.** Publier sur la foi de l'appel
  qu'on vient de faire prouve qu'une fonction a été appelée, pas qu'un fichier
  est arrivé. L'empreinte se **relit sur la cible, après transfert**, et se
  compare à celle mesurée à l'import — taille comprise ;
- **rien n'est écrasé.** Un contenu déjà présent sous la même adresse mais
  d'empreinte différente signifie qu'une hypothèse est fausse quelque part :
  on le **signale** et on laisse les deux en place. Corriger d'office effacerait
  la trace du problème ;
- **la reprise s'exécute là où sont les octets.** Une reprise lancée depuis le
  poste inventorie le dossier du poste : sur un parc dont les fichiers vivent
  en ligne, elle conclut qu'il n'y a rien à reprendre — et le conclut
  **calmement**, ce qui est le pire des verdicts ;
- **la reprise simule avant d'écrire**, ne renomme rien, ne supprime rien, est
  rejouable, et **refuse d'arbitrer** un conflit : deux descripteurs pour une
  même fiche se tranchent par un humain ;
- **l'opération est idempotente.** Relancée, elle ne retransfère que ce qui
  manque réellement.

### 26.3 L'état d'un média dit où il se trouve, et il ne ment pas

Un média porte un état de publication, et cet état est une **constatation**, pas
une intention :

- **présent localement seulement** — importé, jamais constaté ailleurs ;
- **publié sur telle destination** — constaté par empreinte sur cet hôte précis.

Deux règles en découlent :

- l'état **retombe** dès que la destination change ou disparaît. Un média resté
  « publié » avec, pour hôte, un serveur dont on vient d'effacer les fichiers
  affirme une présence qui n'existe plus — et toute décision prise ensuite
  repose sur une affirmation fausse ;
- l'hôte est **nommé**. « Publié » sans dire où ne permet ni de republier
  ailleurs, ni de savoir ce qu'un retrait vient d'invalider.

### 26.4 Un média absent se voit, et se dit

- **aucune adresse n'est fabriquée.** Un descripteur qui ne résout pas — autre
  environnement, média retiré, autorité inconnue — ne doit **pas** retomber sur
  l'ancienne chaîne d'URL : ce serait publier exactement l'adresse que la
  résolution vient d'écarter. Il rend « rien », et l'écran traite ce « rien »
  comme un état (§12) ;
- **les médias référencés mais introuvables sont listés** par la reprise et par
  la publication, avec leur adresse. « 12 médias traités » ne vaut rien si trois
  fiches pointent dans le vide ;
- **un rapprochement ne se fait jamais par nom de fichier.** Entre deux projets
  voisins, c'est la façon la plus sûre de mélanger leurs images. L'identité d'un
  média est son **contenu** et sa **portée de projet**, jamais son nom.

### 26.5 Ce que la recette doit prouver

- un fichier importé **en local** arrive sur la destination au déploiement, et
  y est **constaté** ;
- un fichier importé **en ligne** est repris en local sans être renommé ni
  perdu ;
- le cycle complet tient : présent localement → publié → retrait → de nouveau
  présent localement seulement ;
- un redéploiement **ailleurs** republie contre le nouveau domaine **sans
  qu'aucune fiche n'ait été réécrite** ;
- rejouer chaque opération ne produit aucun second exemplaire ;
- une empreinte divergente est **signalée**, jamais résolue en silence.

---

## 27. Erreurs silencieuses

À traquer activement :

- erreurs et avertissements de console — y compris les avertissements sur les
  identités de liste, qui signalent le défaut décrit en §9.1 ;
- requêtes 4xx/5xx inattendues ;
- promesses rejetées non traitées ;
- blocs d'interception **vides** : une interception silencieuse doit être
  **motivée par écrit**, sans quoi elle est une panne masquée ;
- valeurs de repli qui cachent un défaut au lieu de le signaler ;
- composants remontés inutilement ;
- requêtes concurrentes dont la plus lente écrase la plus récente ;
- doubles requêtes au montage.

**Exigence de recette** : la console est **lue automatiquement** sur chaque
écran, et le bruit connu (ressources absentes des bouchons) est écarté
nommément — jamais en abaissant le seuil de toute la recette.

---

## 28. Contrats entre le client et le serveur

Chercher activement les divergences entre types du client, modèles du serveur,
schémas, validateurs, réponses d'API, graines, bouchons et tests.

Particulièrement : limites, énumérations, champs requis, valeurs nulles
autorisées, longueurs, formats, statuts.

Une même notion ne doit pas posséder cinq définitions contradictoires.

### 28.1 Un canal doit avoir un émetteur ET un récepteur

Un canal d'invalidation, un événement, une notification : les trois se
vérifient **des deux côtés**.

Un scope émis que personne n'écoute n'échoue jamais — c'est un fil branché sur
rien, indiscernable d'un fil qui marche. Et l'inverse est pire : un écran
abonné à un nom que plus personne n'émet se croit vivant et affiche
indéfiniment une donnée périmée.

Le piège le plus subtil vient de l'**authentification** : un canal réservé aux
sessions authentifiées ne peut pas servir une surface publique. Une notification
destinée à un visiteur anonyme part alors dans le vide, alors que le code — et
son commentaire — affirment qu'elle rafraîchit sa page.

**Exigence** : un test énumère les scopes déclarés et vérifie que chacun a un
producteur **et** un consommateur atteignable. Une exception se **déclare
nommément**, avec sa raison et la condition de sa levée — jamais en laissant le
test rouge.

### 28.2 Les bouchons de recette suivent les types

Un bouchon dont la forme diffère du type réel produit **deux fausses
informations** : il signale des pannes qui n'existent pas, et il masque celles
qui existent. Un bouchon se dérive des types du client, jamais de l'idée qu'on
s'en fait.

---

## 29. Les outils de recette vieillissent avec le produit

C'est une exigence à part entière, parce que son oubli annule toutes les autres.

Un outil de recette référence des choses qui bougent : des routes, des clés de
stockage, des sélecteurs, des jeux de données, des noms de classe. Quand l'une
d'elles change, l'outil ne devient pas « moins précis » : il devient **muet ou
mort**, et son silence se lit comme une absence de défaut.

Trois formes constatées :

- **l'outil plante** — il pointe une route ou un fichier retirés, et il emporte
  avec lui toutes les recettes enchaînées derrière ;
- **l'outil s'authentifie mal** — il pose une clé de session obsolète, atterrit
  sur l'écran de connexion, et éprouve un formulaire de login en croyant
  éprouver l'application ;
- **l'outil se tait** — son déclencheur ne correspond plus, le bloc de contrôle
  est entièrement conditionnel, et cinq assertions disparaissent du rapport
  **sans un mot** pendant que le verdict reste « conforme ».

Exigences :

- **une étape sautée est un échec, ou au minimum une ligne du rapport.** Un
  contrôle qui s'évapore quand il ne trouve plus sa cible ne protège plus rien ;
- une recette qui dépend d'un fichier **optionnel** teste sa présence, annonce
  que la règle est sans objet, et ne la déclare **jamais** verte sans l'avoir
  contrôlée ;
- un outil ne recopie pas une identité de projet : il la **dérive** de la même
  autorité que la construction ;
- une recette ne doit **jamais importer un script de migration** : le code de
  plus haut niveau d'un script s'exécute à l'import, et une migration qui se
  connecte puis se déconnecte fait tomber la base sous les assertions
  suivantes — ce qui se lit comme une panne du serveur.

---

### 29.1 Une recette est HERMÉTIQUE — elle ne dépend pas de la machine

C'est la cause la plus fréquente de rouge non reproductible, et la plus
coûteuse : elle échoue **chez le développeur** et passe **partout ailleurs**.
Le rouge n'apprend donc rien, il devient du bruit, et on finit par le regarder
sans le lire — ce qui coûte ensuite les vrais défauts cachés derrière.

Le mécanisme est toujours le même : la recette monte l'amorçage réel de
l'application, et **celui-ci lit la configuration de la machine**. Un poste de
développement qui déclare une adresse de premier compte fait donc créer un
compte que la recette n'a pas demandé — et tout ce qui compte s'en trouve
décalé :

- une garde « au plus un compte par rôle » refuse ensuite le compte que la
  recette voulait créer, et la suite s'effondre sur une valeur absente ;
- un résolveur de destinataires en trouve un de plus, et le nombre
  d'exécutions matérialisées change ;
- un travail de reprise supplémentaire est armé au démarrage, et les compteurs
  d'invariants ne tombent plus juste ;
- un décompte de comptes codé en dur devient faux.

**Exigences** :

- une recette **neutralise** les variables d'environnement qui font naître des
  données, plutôt que d'espérer qu'elles soient absentes ;
- elle les **vide** au lieu de les supprimer lorsqu'un chargeur de
  configuration remplit ce qui manque — sans quoi elles reviennent du fichier
  au premier import ;
- elle pose **elle-même** les comptes et documents qu'elle éprouve ;
- elle vérifie que son décor s'est **réellement** posé, et le dit clairement
  s'il a échoué. Une valeur absente doit produire « le compte de recette n'a
  pas pu être créé », pas une lecture de propriété sur une valeur nulle.

### 29.2 Une assertion ne sur-spécifie pas

« Il y a exactement deux comptes » n'est pas ce que la recette veut prouver :
elle veut prouver qu'un développeur **obtient la liste** et qu'elle **contient**
les comptes attendus. Le nombre exact appartient à la machine.

Une assertion qui encode plus que son intention casse au premier ajout
légitime — et sa correction ressemble alors à un relâchement, ce qu'elle n'est
pas.

### 29.3 Un registre explicite se paie en fixtures

Ajouter une entité à un registre contrôlé — liste de singletons, catalogue de
ressources, table de promotion — **impose** de la semer dans tous les décors
qui contrôlent ce registre. Le registre est explicite précisément pour être
sûr ; le prix de cette sûreté est que son évolution est un geste **complet**,
pas une ligne.

### 29.4 Une valeur épinglée dans plusieurs recettes se met à jour ensemble

Une version de contrat, un identifiant de schéma, un numéro de protocole
épinglés « à dessein » — pour qu'une évolution soit un geste et non un effet de
bord — se désynchronisent dès qu'ils vivent dans plus d'un fichier, et c'est
toujours celui dont le nom n'a aucun rapport qui est oublié.

L'épingle se garde, mais chaque occurrence **nomme les autres**.

## 30. Tests

### 30.1 Ce qui doit être figé

- les invariants métier : maxima, longueurs, bornes, énumérations ;
- la **parité** entre le serveur et son miroir client (§3.2) ;
- la conformité des graines (§4) ;
- le refus serveur **hors interface**, aux bornes exactes (§5.2) ;
- la traduction des refus, y compris ceux que personne n'a rédigés (§6.2) ;
- la normalisation des messages d'erreur, **dans les deux sens** : ce qui doit
  être remplacé, et ce qui doit être conservé (§7.2) ;
- l'authentification et sa limitation de tentatives ;
- le raccordement au Panel ;
- les statuts et leur persistance ;
- le circuit contractuel, la signature, les paiements, les factures ;
- les cas d'erreur, pas seulement les cas passants.

### 30.2 Ce qui doit être éprouvé dans un navigateur

Certaines exigences ne se vérifient pas par lecture du code :

- débordement horizontal, avec **nom de l'élément coupable** ;
- écrans vides, chargements figés, fuites techniques dans le texte rendu ;
- noms accessibles et étiquetage des champs ;
- tailles des cibles ;
- console propre ;
- gestes tactiles, gel de la page derrière une modale, restitution du
  défilement.

Ces recettes passent sur **tous les écrans** et à **plusieurs largeurs**. Elles
n'ont pas besoin d'un serveur réel : des bouchons **conformes aux types**
(§28.2) et des jeux de données choisis pour mettre la mise en page en défaut
valent mieux qu'une base de production.

### 30.3 Une suite ne se répare pas en la modifiant

Un test rouge se corrige par sa **cause**. Modifier une assertion pour retrouver
du vert n'est acceptable que lorsque l'assertion elle-même est fausse — et cela
se justifie par écrit, dans le test.

### 30.4 Une suite branchée nulle part ne garde rien

Écrire une recette est un geste ; la **brancher** dans la chaîne exécutée en est
un autre, et c'est le second qui protège. Une garde hors chaîne ne proteste
jamais, et sa dérive vers le rouge est indolore.

### 30.5 Les échecs préexistants sont nommés

Un rouge connu et **déclaré** est une dette ; un rouge inconnu est une panne.
Une livraison distingue explicitement les deux, et ne présente jamais un échec
antérieur comme un effet de son propre travail — ni l'inverse.

---

## 31. Recette réelle

Avant de considérer un lot terminé :

1. lancer le projet et parcourir **réellement** les écrans modifiés ;
2. inspecter la console du navigateur et les requêtes réseau ;
3. inspecter les journaux serveur ;
4. éprouver les formulaires avec des valeurs **valides et invalides**, et aux
   bornes ;
5. éprouver au moins un parcours **complet**, du formulaire jusqu'au rendu final
   après rechargement ;
6. contrôler le responsive dans un navigateur, pas par déduction.

---

## 32. Checklist de validation obligatoire

Avant toute livraison ou redéploiement significatif, Claude Code doit pouvoir
valider :

**Langue et messages**

- [ ] Toutes les interfaces utilisateur sont en français.
- [ ] Aucun message de bibliothèque de validation n'apparaît en anglais.
- [ ] Aucun message backend brut, technique ou anglais n'est exposé.
- [ ] Les erreurs métier sont conservées telles quelles, et non génériques.
- [ ] Aucune énumération technique n'est affichée brute.
- [ ] Les pannes de nature différente ont des messages différents.

**Invariants et validation**

- [ ] Chaque limite métier est déclarée à un seul endroit.
- [ ] Le miroir client est vérifié par un test de parité.
- [ ] Frontend, backend et graines partagent les mêmes invariants.
- [ ] Les graines passent les validateurs de production, avec de la marge.
- [ ] Chaque route d'écriture est validée côté serveur.
- [ ] Le contournement de l'interface est testé aux bornes exactes.
- [ ] Un refus n'écrit rien ; ce qui passe est relu à l'identique.
- [ ] Aucun écrêtage silencieux : ce que le rendu coupe, le serveur le refuse.

**Formulaires**

- [ ] Les contraintes connues sont communiquées avant la soumission.
- [ ] Les longueurs maximales sont appliquées à la saisie.
- [ ] Les compteurs apparaissent là où la limite est serrée.
- [ ] Les champs obligatoires sont identifiables.
- [ ] Chaque champ est étiqueté, et le libellé est **relié** au champ.
- [ ] Les formulaires ont été testés avec valeurs valides et invalides.

**Collections**

- [ ] Le bouton d'ajout reste visible, désactivé, et porte sa raison.
- [ ] L'identité des lignes réordonnables est stable.

**Mutations et états**

- [ ] Les mutations possèdent des états chargement / succès / erreur.
- [ ] Aucun succès n'est annoncé avant la réponse du serveur.
- [ ] Les actions ne peuvent pas être déclenchées deux fois.
- [ ] L'état d'enregistrement est lisible sans remonter le formulaire.
- [ ] Les données non enregistrées sont protégées, au niveau du mécanisme
      partagé.
- [ ] Les états vides sont traités, utiles, et ne décrivent pas un repli
      supprimé.
- [ ] Aucun `undefined`, `null`, `NaN`, `[object Object]` ni trace de pile dans
      le texte rendu.

**Actions destructrices**

- [ ] Toute action destructrice se confirme et nomme ses conséquences.
- [ ] La réversibilité est annoncée.
- [ ] Les refus métier sont expliqués.

**Responsive**

- [ ] Aucun débordement horizontal, sur tous les écrans et toutes les largeurs.
- [ ] La recette de débordement nomme l'élément coupable.
- [ ] Le Manager est exploitable sur mobile étroit.
- [ ] Les rangées denses se replient au lieu de s'écraser.
- [ ] Les tableaux complexes possèdent une UX mobile adaptée.
- [ ] Les modales sont utilisables sur petit viewport.
- [ ] Un seul propriétaire du défilement ; aucun geste absorbé.

**Accessibilité**

- [ ] Tous les boutons portent un nom accessible.
- [ ] Les noms accessibles désignent leur ligne dans une liste.
- [ ] Les cibles des commandes sont suffisantes.
- [ ] Les parcours clavier essentiels fonctionnent.
- [ ] Les modales piègent puis restituent le focus.
- [ ] Aucun élément interactif n'en enveloppe un autre.
- [ ] Aucune valeur absente n'est passée à un champ à format contraint.

**Authentification et sécurité**

- [ ] L'authentification est protégée et ses messages n'énumèrent rien.
- [ ] Le login possède un rate limiting serveur, persistant, à deux seaux.
- [ ] Un refus tiers ne déconnecte pas la session locale.
- [ ] L'état de session est cloisonné par projet.
- [ ] Les routes sensibles sont protégées côté serveur.
- [ ] Aucun secret n'est exposé au client.
- [ ] Les uploads sont contrôlés côté serveur.
- [ ] La synchronisation des médias localhost → public est opérationnelle.
- [ ] La synchronisation des médias public → localhost est opérationnelle.
- [ ] Chaque transfert est constaté par empreinte sur la cible, jamais supposé.
- [ ] Aucun fichier distant n'est écrasé ; une empreinte divergente est signalée.
- [ ] L'état de publication nomme son hôte et retombe au retrait.
- [ ] Les médias référencés mais introuvables sont listés, pas ignorés.

**Panel**

- [ ] Le raccordement au Panel est cohérent, et ses états sont lisibles.
- [ ] Transport et livraison sont distingués.
- [ ] Aucun secret n'apparaît, et le code à usage unique est effacé après usage.
- [ ] La dissociation est confirmée et ses conséquences nommées.

**Métier**

- [ ] Le parcours contractuel fonctionne.
- [ ] Le circuit de signature fonctionne, et ses statuts sont synchronisés.
- [ ] Le paiement est confirmé côté serveur, jamais par une redirection.
- [ ] L'idempotence des paiements est assurée.
- [ ] Le suivi des factures est cohérent avec le contrat et le paiement.
- [ ] Les statuts métier survivent au rechargement.

**Manager → Vitrine**

- [ ] Les données sont réellement persistées, renvoyées et rendues.
- [ ] Elles survivent à un rechargement et à un redémarrage.
- [ ] Les limites du Manager correspondent à ce que la Vitrine sait rendre.
- [ ] La Vitrine rend correctement **tous** les comptes autorisés.

**Cohérence et contenu**

- [ ] Le vocabulaire des actions est uniforme.
- [ ] Aucun exemple, aide, état vide ou simulation ne décrit un autre métier.
- [ ] Aucune fonctionnalité retirée n'est présentée comme existante.

**Tests et recette**

- [ ] Les tests de non-régression sont verts.
- [ ] Les recettes navigateur passent sur tous les écrans et toutes les
      largeurs.
- [ ] Aucune étape de recette n'est sautée en silence.
- [ ] Les outils de recette référencent des routes, clés et sélecteurs actuels.
- [ ] Les recettes sont hermétiques : aucune ne dépend du `.env` de la machine.
- [ ] Les recettes vérifient que leur décor s'est réellement posé.
- [ ] Aucune assertion ne sur-spécifie (compter plutôt que nommer).
- [ ] Toute entrée ajoutée à un registre contrôlé est semée dans les décors.
- [ ] Les valeurs épinglées dans plusieurs recettes ont été mises à jour ensemble.
- [ ] Les bouchons sont conformes aux types réels.
- [ ] Chaque canal d'invalidation a un émetteur ET un consommateur atteignable.
- [ ] Toute suite est branchée dans la chaîne exécutée.
- [ ] Les échecs préexistants sont nommés et distingués des régressions.
- [ ] Les erreurs de console inattendues ont été éliminées.
- [ ] Une recette réelle a été effectuée dans un navigateur.

---

## 33. Règle de validation Claude Code

Claude Code doit utiliser ce document comme **référentiel permanent** de
contrôle qualité du Manager.

Lorsqu'une tâche demande de créer, modifier, refondre ou déployer une partie
d'un Manager, il doit :

1. prendre connaissance de ce document ;
2. identifier les critères concernés par la modification ;
3. préserver les critères déjà respectés ;
4. corriger toute régression introduite par son travail ;
5. contrôler les impacts desktop **et** mobile ;
6. contrôler les impacts sur la validation, la langue et l'accessibilité ;
7. contrôler la cohérence entre le serveur, l'interface et les graines ;
8. contrôler les impacts sur la chaîne Manager → Vitrine ;
9. tester réellement les fonctionnalités modifiées, dans un navigateur lorsque
   le défaut ne se voit qu'à l'écran ;
10. effectuer une recette finale avant de considérer la tâche terminée.

Une demande ponctuelle ne doit jamais être interprétée comme l'autorisation de
dégrader un autre critère de ce référentiel.

**Règle d'enrichissement** : tout problème **générique** découvert pendant un
travail sur un Manager entraîne deux actions — corriger le problème dans le
projet, et ajouter la règle correspondante à ce document. Un référentiel qui
n'apprend rien de la réalité du produit cesse d'être lu.

---

## 34. Principe final

Un Manager L.Y Solution réussi doit réunir simultanément :

**Clarté + Français + Validation partagée + Feedback + Responsive +
Accessibilité + Sécurité + Cohérence métier + Persistance + Tests.**

L'esthétique compte, mais elle ne rachète rien ici : un Manager élégant qui
laisse composer un état que le serveur refusera, qui annonce un succès qu'il n'a
pas constaté, qui perd un brouillon sans avertir, qui déborde sur un téléphone
ou qui répond en anglais **ne passe pas le contrôle qualité Manager**.

Le critère ultime tient en une phrase :

> Après un mois d'usage quotidien, l'utilisateur doit encore **croire son
> écran** — et ne plus avoir besoin de recharger la page pour vérifier.
