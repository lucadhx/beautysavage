# Cahier des charges — refonte BeautySavage

> Version : 1.0 · 17 septembre 2026  
> Destinataire : équipe de développement chargée de refaire l'application.  
> Périmètre : vitrine e-commerce, espace client et manager d'un institut. Le panel, le contrat et l'abonnement de l'éditeur existent déjà : ils ne font pas partie de cette refonte, sauf les branchements explicitement indiqués.

## 1. Vision et principes non négociables

BeautySavage est un site vitrine transactionnel avec un espace client et un manager d'institut. Il vend des formations à distance et en présentiel, des prestations réservables, des cartes cadeaux et, si le catalogue l'active, des produits. Le manager permet à l'institut de gérer le catalogue, son agenda global, ses clients, ses ventes, ses validations pédagogiques, ses communications et ses réglages techniques.

La réécriture doit reprendre toutes les capacités fonctionnelles décrites ci-dessous, mais l'interface doit être plus lisible, élégante, mobile-first et accessible. Une opération sensible doit toujours être expliquée avant confirmation ; les formulaires longs sont découpés en onglets avec sauvegarde visible, messages d'erreur actionnables et prévention de la perte de modifications.

Principes d'architecture :

- Le serveur est l'autorité : prix, promotion, disponibilité, montant d'acompte, solde, droit applicable, commission et droits d'accès sont recalculés côté API. Aucun montant ou statut venant du navigateur n'est fiable.
- Chaque vente, consentement, prix, promotion, règle de remboursement, taux de commission et données fiscales sont figés dans un *snapshot* immuable. Une modification ultérieure du catalogue ne réécrit jamais l'historique.
- Paiement client et paiement de commission sont exclusivement réalisés par **Stripe Checkout hébergé**. Il n'y a pas de formulaire carte bancaire ni de Stripe Elements intégré.
- Toute finalisation déclenchée par Stripe est idempotente : même événement, retour de page ou polling ne crée ni double vente, ni double réservation, ni double accès, ni double remboursement.
- Les dates sont stockées en UTC, affichées dans le fuseau de l'institut, et toutes les comparaisons utilisent le même fuseau métier. Les montants sont stockés en centimes entiers (ou type décimal exact), jamais en flottants JavaScript.
- L'application est au niveau de l'**institut** : un seul agenda global, sans échelle « prestataire ». Une ressource interne technique unique peut exister pour assurer les contraintes de réservation, mais elle ne doit pas apparaître dans le parcours client.
- Les suppressions d'objets ayant eu des ventes, réservations ou tentatives doivent être des archivages/soft deletes. Les références et documents historiques restent consultables.

## 2. Acteurs et parcours attendus

| Acteur | Droits principaux |
| --- | --- |
| Visiteur | Parcourir vitrines, catalogue, FAQ, avis publiés, carte cadeau ; créer un compte ; ajouter au panier. |
| Client connecté | Acheter, gérer son profil, ses achats, factures, formations, rendez-vous, demandes de remboursement, cartes cadeaux, avis et documents. |
| Institut / manager | Gérer le catalogue, planning, clients, ventes, remboursements, cartes cadeaux, validations de formations, avis et communications. |
| Développeur / plateforme | Gérer les paramètres techniques de l'instance, clés plateforme, contrat, taux de commission et supervision. Il ne doit jamais confondre ses clés avec celles de l'institut. |

### Vitrine et navigation

La page d'accueil doit être très élégante : identité de marque, hero clair, sections éditables (mise en avant formations/prestations, galerie, promesse, FAQ, avis), appels à l'action sans surcharge et rendu parfait sur mobile. Les évaluations sont affichées avec l'icône « patte de chien » pour chaque niveau de note, partout où une note est rendue.

La barre de navigation de la vitrine ouvre une sidebar contenant les pages configurées : accueil, formations, prestations, boutique le cas échéant, cartes cadeaux, pages légales et pages éditoriales. La topbar comprend panier et profil. Le bouton profil ouvre un menu avec au minimum « Mon espace client » et « Mes formations » ; « Mes formations » mène directement à la liste des formations achetées, puis au lecteur de la formation choisie. Les liens doivent respecter l'état connecté/non connecté et être utilisables au clavier.

### Tunnel d'achat commun

1. Le client sélectionne des articles. Une formation présentielle impose une session active ayant encore de la capacité ; une formation distancielle peut être ajoutée sans session. Une prestation reste une réservation avec créneau.
2. Le panier affiche chaque ligne, option, promotion, carte cadeau utilisée, total, reste à payer et les consentements requis par ligne. Une carte cadeau est un **moyen de paiement**, jamais une remise.
3. À l'initialisation du checkout, l'API recharge les objets, revalide prix/promotion/capacité/règles légales, réserve temporairement les ressources nécessaires puis crée une Checkout Session Stripe côté compte institut.
4. Le navigateur est redirigé vers Stripe Checkout. Il revient sur une page succès/annulation avec `session_id` ; l'interface interroge l'API à intervalle borné pour afficher le résultat sans attendre inutilement le webhook.
5. Le webhook Stripe, dont la signature est vérifiée sur le corps brut, est la source de confirmation indispensable. Il appelle le même finaliseur transactionnel que la page de retour ; les deux chemins sont idempotents et journalisés. En cas d'échec/expiration, les réservations temporaires sont libérées automatiquement.
6. Après confirmation seulement : création de vente et facture, débit définitif des cartes cadeaux, accès formation, confirmation de réservation et courriels. La page succès vide uniquement les éléments effectivement finalisés.

Les achats groupés doivent rester possibles lorsque les règles le permettent, mais le moteur légal travaille **par article** : une renonciation de contenu numérique ne couvre pas une prestation ni une autre formation. Si le panier mélange des flux techniquement incompatibles, l'UI le rend explicite et l'API peut proposer des checkouts séparés ; elle ne doit jamais dégrader silencieusement une ligne.

## 3. Manager — formations

### 3.1 Règles de cycle de vie

Une formation a un nom unique, un statut `brouillon`, `publiée` ou `désactivée`, un type `distanciel` ou `présentiel`, un prix, une description éditoriale, une couverture, une galerie, une FAQ, une bande-annonce et des options vendables. Une formation ne peut être visible ou achetable que si son statut et les prérequis de son type sont cohérents.

Le type est choisi à la création. Après la première vente, réservation de session ou progression client, il est verrouillé définitivement : changer de type modifierait les droits d'accès, sessions, règles de remboursement et rapports. Avant toute activité, le changement requiert une confirmation expliquant que les modules distanciels ou sessions présentielles incompatibles seront archivés/supprimés. Dans le doute, créer une nouvelle formation et archiver l'ancienne.

La suppression d'une formation vendue devient un archivage : plus de nouveaux achats, mais conservation des accès, ventes, factures, avis et dossiers d'évaluation. La désactivation bloque les nouveaux achats sans effacer l'historique.

### 3.2 Onglet « Informations »

Contenu : nom, description longue via éditeur éditorial sécurisé avec aperçu, prix TTC, image de couverture (formats et poids contrôlés), galerie, bande-annonce (titre + URL intégrable validée), groupe WhatsApp optionnel (titre + URL), type, statut, FAQ répétable (question/réponse), et aperçu de la fiche vitrine.

Pour le présentiel, afficher aussi durée en jours, formalités (documents, horaires, prérequis) et politique d'annulation spécifique. Pour le distanciel, afficher le mode de délivrance : `manuel` ou `accès immédiat`; l'accès immédiat n'est publiable que si le contenu/lecteur est réellement disponible. Afficher clairement qu'un accès à vie n'est pas synonyme d'une renonciation juridique sans consentement conforme au checkout.

Validations : nom requis, prix positif ou gratuit explicitement assumé, HTML assaini, URLs autorisées, média contrôlé, statut publié interdit si une condition de vente est absente. Chaque sauvegarde donne un retour visible et conserve le brouillon en cas d'erreur réseau.

### 3.3 Onglet « Modules pédagogiques » — distanciel uniquement

Cet onglet est masqué pour le présentiel. Il liste les modules dans leur ordre et propose création, édition, archivage et réordonnancement explicite avec enregistrer/annuler. Un module comprend : titre, description éditoriale, vidéos, fichiers annexes et ordre.

Dans l'éditeur de module, trois sous-onglets sont requis :

- **Informations** : titre et description éditoriale avec aperçu.
- **Vidéos** : plusieurs vidéos, chacune avec titre, URL/iframe validée, description éditoriale et ordre. Le lecteur est intégré ; le client ne doit pas être envoyé vers un lien brut sans nécessité.
- **Fichiers** : ajout multiple, nom lisible, taille/type contrôlés, téléchargement protégé par l'achat, suppression/renommage/réordonnancement.

Le lecteur client affiche progression par module et élément, ressources et statut de complétion. L'accès est vérifié sur chaque API/média ; ne pas se contenter de cacher un lien. Les fichiers et vidéos supprimés après vente doivent être versionnés ou remplacés avec avertissement afin de ne pas casser les achats existants.

### 3.4 Onglet « Planning sessions » — présentiel uniquement

Cet onglet est masqué pour le distanciel. Il comporte trois sous-onglets.

- **Calendrier global** : mois/semaine, dates libres et occupées, clic sur une date libre pour créer une session, clic sur une session pour ouvrir sa fiche. Les conflits avec prestation, autre formation, blocage manuel ou indisponibilité globale sont affichés avant validation.
- **Sessions planifiées** : liste filtrable et fiche de session : date de début, durée héritée de la formation (figée dans la session), horaires pour chaque jour, capacité, inscrits, places restantes, présence, rappel envoyés, statut et actions déplacer/annuler. La capacité ne peut pas être abaissée sous le nombre d'inscrits.
- **Sessions annulées** : historique non effaçable avec motif, date, participants, choix proposé (remboursement/replanification/avoir selon politique) et statut de résolution.

Une session porte une capacité maximale, un compteur de réservations maintenu atomiquement, une grille `jour N / début / fin`, un statut actif ou annulé et un motif d'annulation. L'API effectue le test de chevauchement dans une transaction ; elle ne se fie jamais au seul calendrier affiché. Une session pleine ou annulée ne peut être achetée. Les rappels envoyés sont tracés par clé afin d'éviter les doublons.

### 3.5 Onglet « Promotion »

Configurer une remise fixe ou en pourcentage, date de début facultative, date de fin facultative et activation. Afficher prix catalogue, montant de réduction et prix final. Interdire les valeurs négatives, les pourcentages > 100, une remise supérieure au prix et une période inversée. La règle appliquée et ses montants sont figés sur chaque ligne de vente ; une promotion ne rétroagit jamais.

### 3.6 Onglet « Boost »

Permettre de mettre en avant au maximum trois formations avec un ordre déterministe. Afficher les emplacements occupés, le rang, le rendu vitrine et empêcher les doublons. Si un placement est retiré, le catalogue reste triable de manière stable.

### 3.7 Onglet « Options »

Options répétables : nom, description, image facultative, supplément, délai/condition éventuelle, actif/inactif. Une option achetée est copiée dans la vente avec son libellé et son prix. Une option déjà vendue peut être désactivée mais son historique ne doit pas être supprimé.

### 3.8 Évaluation finale et validation de formation

Chaque formation peut avoir une définition d'évaluation optionnelle et versionnée. Le manager doit y accéder depuis la formation (onglet ou action « Évaluation finale ») et l'éditer dans une interface claire :

- état actif/inactif ; une définition inactive est ignorée par le client ;
- sections ordonnées avec titre et description ;
- dans chaque section, questions ordonnées de type vrai/faux ou quiz à réponse unique/multiple, libellé, caractère obligatoire, réponses et marqueur de correction ;
- livrables ordonnés, obligatoires ou facultatifs : `photo avant/après` (deux images) et `vidéo` (avec durée maximale configurée) ;
- aperçu client sans bonne réponse, version courante et avertissement lors d'une modification impactant les nouveaux passages.

Une soumission est autorisée seulement après achat admissible, complétion du parcours exigé et fourniture de toutes les réponses/fichiers obligatoires. Les formats MIME, poids, durée, antivirus/scan et autorisation d'accès aux fichiers sont contrôlés côté serveur. Les bonnes réponses et le score ne sont jamais envoyés au client.

Créer la page manager **« Validation formations »**. Elle contient une liste filtrable (client, formation, session, date, statut, tentative), puis une fiche : score calculé côté institut, réponses et corrections, pièces avant/après avec zoom, vidéo, historique des décisions et éventuel diplôme. L'institut peut valider ou refuser. Le refus impose un commentaire envoyé au client ; le client peut alors recommencer autant de fois que nécessaire. Il ne peut y avoir qu'**une soumission en attente** par client et formation : pas de double clic, pas de seconde tentative tant qu'une décision n'a pas été prise. Les tentatives/décisions sont conservées pour audit ; les fichiers personnels peuvent être purgés selon une politique de conservation documentée. Une validation génère le diplôme/certificat de façon idempotente et notifie le client.

## 4. Manager — prestations

Le manager des prestations garde trois vues principales : prestations, paramètres de réservation, et éventuellement praticiennes internes pour la compatibilité — sans jamais montrer une sélection de praticienne si l'institut veut un agenda global.

L'éditeur d'une prestation est une modale ou page plein écran responsive à cinq onglets. Les changements doivent être sauvegardables sans changer d'onglet ; la version mobile les affiche en navigation horizontale ou en étapes accessibles.

### 4.1 Onglet « Général »

Champs : nom requis, description courte (pour les cartes/lists), description complète, durée en minutes par pas de 5/15 minutes, capacité et état de validation. La durée inclut uniquement la prestation ; le temps de battement est géré séparément. Nom et slug sont uniques, sans collision. La capacité doit être cohérente avec le modèle retenu : en V1, un créneau est exclusif à l'institut, donc capacité 1 ; si une capacité > 1 est autorisée ultérieurement, le modèle doit gérer des places atomiques et non simplement tolérer plusieurs réservations identiques.

### 4.2 Onglet « Tarifs et paiement »

Champs : prix, type de paiement `complet`, `acompte`, `gratuit`; pour un acompte, type `pourcentage` ou `montant fixe`, valeur et mode de règlement du solde. Le mode V1 est « solde à payer sur place » ; il doit afficher dans le manager et calendrier : total vendu, acompte payé, solde dû, solde encaissé, date et moyen de règlement (carte, espèces, autre).

Inclure délai minimum de réservation et délai maximum d'annulation/annulation sans frais, par prestation avec valeur par défaut issue des paramètres généraux. Le montant à rembourser n'est pas déduit par une simple règle front : la politique doit exprimer pour chaque fenêtre (avant/après délai, institut annule, no-show) le pourcentage ou montant remboursé et doit être figée à la réservation. Les montants d'acompte sont bornés (0–100 % ou 0–prix), et un acompte est bloqué si le circuit du solde n'est pas paramétré.

### 4.3 Onglet « Options »

Créer, modifier, activer/désactiver des options : nom, description, prix additionnel, état actif. Les options sélectionnées sont incluses dans le total, dans la durée si la future règle le prévoit, la réservation et la facture. Les options inactives restent dans les ventes existantes mais ne sont plus proposées.

### 4.4 Onglet « Photos »

Galerie d'images avec aperçu, ordre, suppression et dépôt. Les médias sont redimensionnés/optimisés, soumis à limite de taille et nettoyés si un téléchargement échoue. Une prestation doit pouvoir être créée sans photo, mais l'éditeur signale l'impact vitrine.

### 4.5 Onglet « Avancé »

Champs : temps de battement après la prestation, promotion (fixe/pourcentage/dates), boost vitrine (rang), active/inactive et réservable/non réservable. Séparer clairement « visible » de « achetable ». L'arrêt de réservation doit préserver les rendez-vous futurs. Ajouter une FAQ si elle est affichée sur la fiche vitrine.

### 4.6 Paramètres de réservation des prestations

Écran de paramètres institut : rappels multiples activables (J-X ou H-X, un nombre illimité, dédoublonné), choix client d'une praticienne si cette option est activée, politique de no-show (actif, seuil de suspensions), horaire de base, exceptions/fermetures et blocs manuels. Les rappels propres à une prestation peuvent compléter ou remplacer la règle globale selon une priorité affichée explicitement.

## 5. Calendrier global et réservations

Le calendrier manager doit reprendre les fonctions utiles d'un planning type Planity : vue jour/semaine/mois, créneaux de base récurrents, exceptions, indisponibilités, blocage manuel avec motif, rendez-vous, sessions de formation et détails en panneau latéral. Il est **global institut** : pas de colonnes prestataires et pas de double système concurrent.

Fonctions :

- Configuration d'horaires hebdomadaires, pas de créneau, pauses, jours fermés et périodes exceptionnelles.
- Génération des créneaux disponibles à partir des horaires, durée prestation + options pertinentes + temps de battement, seuil de réservation anticipée, blocs et événements existants.
- Affichage distinct prestation / formation présentielle / bloc manuel ; filtre, recherche, navigation et légende accessibles.
- Création manuelle d'une réservation ou d'un bloc par l'institut ; la réservation manuelle indique paiement sur place, note, client, total et statut.
- Fiche de rendez-vous : client, prestations/options, début/fin, statut, total, payé, acompte, solde, moyen de paiement du solde, facture, annulation/remboursement, no-show et historique.
- Déplacement/annulation avec contrôle de conflit, notification et décision de remboursement documentée. Une annulation institut propose systématiquement remboursement intégral, avoir ou report, selon le choix explicite et légalement applicable.

Contrainte anti-concurrence : l'API crée un verrou de créneau avec expiration et, juste avant la finalisation Stripe, revalide le créneau dans une transaction/base de données. Un index ou exclusion de chevauchement protège aussi contre deux requêtes simultanées. Une réservation `pending_payment` bloque temporairement le créneau ; elle est libérée à expiration/échec. Le créneau est confirmé uniquement après paiement réussi ou création manuelle validée. Toute modification recalculera début/fin et conflits côté serveur.

## 6. Rétractation, annulation et remboursement

Cette section est un cadrage produit et technique ; les CGV, qualifications exactes des offres et textes doivent être validés par un juriste avant mise en production. Le droit de rétractation à distance est en principe de 14 jours. Les règles générales et les exclusions, dont le contenu numérique commencé avant la fin du délai, sont notamment décrites par le Code de la consommation, article L221-28, et les informations officielles de la DGCCRF : [Légifrance](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044563170/2026-05-04), [economie.gouv.fr](https://www.economie.gouv.fr/particuliers/mes-droits-conso/bien-consommer/vente-distance-tout-savoir-sur-droit-de-retractation).

### 6.1 Paramètres généraux légaux et commerciaux

Créer un écran « Paramètres généraux > Ventes, annulations et rétractation » administré par l'institut (avec valeurs réglementaires protégées/validées par plateforme) :

- délai légal de rétractation, initialisé à 14 jours et configurable pour anticiper une évolution de loi ;
- version des CGV, politique de confidentialité, politique de remboursement et formulaire de rétractation ;
- délai maximum d'annulation avant une prestation/session et règle par défaut de remboursement (pourcentage/montant) ;
- règles de remboursement de l'institut en cas d'annulation par elle, report, force majeure et no-show ;
- textes de consentement versionnés, langues si nécessaire, et destinataire de la demande de rétractation.

Les paramètres nouveaux ne s'appliquent qu'aux nouveaux achats ; chaque achat conserve la version complète retenue, les cases cochées, date/heure, identifiant utilisateur et éléments de preuve techniques raisonnables (IP minimisée selon RGPD, user-agent, version).

### 6.2 Checkout et consentements par article

Avant le bouton Stripe, afficher les CGV et le prix total de manière non ambiguë. Le bouton final doit exprimer une obligation de paiement. Les cases facultatives ne peuvent être précochées.

Pour une formation distancielle livrée immédiatement comme contenu numérique : imposer deux manifestations distinctes et traçables avant paiement : demande expresse de début immédiat de l'exécution, puis reconnaissance de la perte du droit de rétractation. Après paiement, envoyer la confirmation durable de cet accord avec le contrat/CGV et l'accès. Sans toutes ces étapes, ne pas priver le client de son droit ; proposer au besoin un accès différé jusqu'à la fin du délai. Une formation à délivrance manuelle ne doit pas afficher une fausse renonciation « accès immédiat ».

Pour une prestation ou une formation datée dans la fenêtre de rétractation : ne pas prétendre automatiquement que toute date fixe exclut le droit. Le moteur doit qualifier l'offre et le texte de consentement validé juridiquement. Si le client demande l'exécution avant le délai, recueillir son accord explicite et afficher les conséquences. La politique commerciale de remboursement (par exemple annulation gratuite jusqu'à J-7) peut être plus généreuse que le droit légal, jamais moins protectrice.

Dans un panier multi-article, l'interface liste le ou les consentements requis avec l'article concerné. L'API refuse l'initialisation si la liste de consentements ne correspond pas exactement aux articles recalculés. Les demandes de rétractation et remboursement sont traitées par ligne et allocation de paiement : Stripe remboursé à hauteur de ce qu'il a encaissé, cartes cadeaux recréditées à hauteur de ce qu'elles ont financé, jamais au-delà du total acquitté.

### 6.3 Workflow de remboursement

Depuis l'espace client, le client voit ses demandes, le statut, la politique figée, un formulaire et un lien de suivi. Depuis le manager, l'institut voit les demandes, l'éligibilité calculée, la vente, les paiements, la justification et les actions accepter/refuser/annuler/reprendre.

Une demande a un identifiant, un statut (`demandée`, `acceptée`, `en cours`, `remboursée`, `refusée`, `échouée`, `annulée`), une seule demande active par ligne, et un journal d'actions. Le remboursement Stripe utilise une clé d'idempotence ; le recrédit de carte cadeau est atomique, doté d'un ledger et de reprises contrôlées. Générer l'avoir/credit note, mettre à jour vente, réservation et commission, informer le client et conserver la traçabilité. Un échec technique déclenche une alerte manager/dev et ne doit jamais être présenté comme remboursé.

## 7. Paiements, clés et configuration technique

### 7.1 Deux périmètres Stripe strictement séparés

1. **Stripe Institut — paiements clients** : clés Stripe de l'institut, utilisées exclusivement pour ses ventes, remboursements et checkout client.
2. **Stripe Plateforme/Développeur — facturation de commission** : clés déjà consommées depuis le panel du développeur, utilisées exclusivement pour que l'institut règle les commissions mensuelles. Elles ne doivent jamais servir à encaisser ses clients.

La page manager **« Configuration technique »** (réservée au bon rôle) comporte simplement : URL manager, URL vitrine, URL API, mode test/production, statut de connexion, date du dernier test et actions de test. Elle alimente la construction fiable des URLs de retour et webhooks ; l'API valide les origines/URLs et ne laisse pas une saisie libre créer une redirection ouverte.

La page **« Clés API »** affiche deux cartes claires :

- *Paiements clients — Stripe Institut* : clé publique, clé secrète, secret webhook, mode, état de vérification et bouton « Tester la connexion ».
- *E-mails institut — Brevo* : clé API, adresse expéditrice saisie par l'institut, nom expéditeur affiché dynamiquement depuis l'identité/boutique, statut de vérification et bouton de test.

Les secrets sont chiffrés au repos, masqués après sauvegarde, jamais rendus à l'UI, aux logs ni aux exports. Une modification invalide le statut vérifié. Ne pas enregistrer le secret du webhook côté navigateur.

### 7.2 Webhooks et réconciliation Stripe

Lorsqu'une intégration est enregistrée/testée, l'API crée ou met à jour automatiquement les endpoints webhook Stripe et Brevo à partir de la configuration technique, enregistre leur identifiant et le secret de signature de manière chiffrée. Elle s'abonne au minimum aux événements Stripe nécessaires à Checkout/paiement/remboursement et assure leur déduplication par identifiant d'événement. Toute erreur d'enregistrement est visible avec diagnostic non sensible et mécanisme de réessai.

La page succès déclenche une lecture de statut/polling borné pour donner un retour rapide, mais ne remplace jamais le webhook. L'implémentation suit le modèle Stripe : webhook pour la fiabilité, retour avec `Checkout Session ID` pour l'immédiateté, finaliseur unique et idempotent. Référence : [Stripe — fulfillment Checkout](https://docs.stripe.com/checkout/fulfillment?locale=en-GB).

## 8. Communications : événements et modèles d'e-mails

Créer un centre de communication dans les pages développeur/manager appropriées. Son modèle est : **un événement métier produit un contexte de variables ; un template HTML déclare les variables ; une règle associe événement, template, expéditeur et destinataires ; un envoi trace son résultat**.

### 8.1 Éditeur de templates

Page développeur « Templates e-mail » : liste, recherche, catégories, création, clonage, version, activation et archivage. Un template a un nom, une description, du HTML assaini, une version, une liste de variables documentées et une prévisualisation live avec jeu de données. L'éditeur affiche une palette cliquable de variables `{{variable}}`, interdit ou neutralise scripts/URLs dangereuses, propose un envoi test et montre les erreurs de variable manquante avant publication.

Les versions utilisées dans un envoi restent identifiables. Ne pas modifier l'historique d'un e-mail déjà émis. Les logs d'envoi contiennent événement, destinataire masqué si nécessaire, template/version, date, résultat fournisseur, tentative et erreur sûre ; jamais de clé API ou de données bancaires.

### 8.2 Événements minimaux à livrer

| Domaine | Événements et variables principales |
| --- | --- |
| Compte | inscription, vérification e-mail, mot de passe oublié/modifié, invitation manager. Variables : `{{clientFirstName}}`, `{{actionUrl}}`, `{{expiresAt}}`. |
| Vente | paiement réussi/échoué, facture disponible, panier abandonné si activé. Variables : `{{saleId}}`, `{{itemsHtml}}`, `{{totalAmount}}`, `{{invoiceUrl}}`, `{{paymentStatus}}`. |
| Prestation | réservation confirmée/déplacée/annulée, rappel J-X/H-X, no-show, solde encaissé. Variables : `{{serviceName}}`, `{{appointmentStart}}`, `{{appointmentEnd}}`, `{{amountPaid}}`, `{{balanceDue}}`, `{{calendarUrl}}`. |
| Formation présentielle | achat, inscription/session modifiée ou annulée, rappels configurables J-X, présence. Variables : `{{formationTitle}}`, `{{sessionDates}}`, `{{formalities}}`, `{{location}}`, `{{cancellationUrl}}`. |
| Formation distancielle | achat, accès livré, progression/fin, évaluation soumise/acceptée/refusée, diplôme disponible. Variables : `{{formationTitle}}`, `{{accessUrl}}`, `{{comment}}`, `{{certificateUrl}}`. |
| Remboursement | demandé, accepté, refusé, en cours, réussi, échoué. Variables : `{{refundId}}`, `{{refundAmount}}`, `{{refundMethod}}`, `{{trackingUrl}}`, `{{reason}}`. |
| Carte cadeau | achat/émission, PDF prêt, usage partiel/total, recrédit, reset PIN. Variables : `{{giftCardCodeMasked}}`, `{{recipientName}}`, `{{amount}}`, `{{balance}}`, `{{giftCardPdfUrl}}`. |
| Avis | demande, avis reçu, publié, refusé. Variables : `{{reviewUrl}}`, `{{targetName}}`, `{{rating}}`, `{{moderationComment}}`. |
| Commission | commission disponible, rappel, retard, payée. Variables : `{{periodLabel}}`, `{{amountDue}}`, `{{dueAt}}`, `{{commissionCheckoutUrl}}`, `{{invoiceUrl}}`. |

Les rappels doivent être configurables en nombre illimité par prestation et formation/session (J-X, et H-X pour une prestation). Le scheduler est idempotent : une clé `(événement, entité, échéance, template version)` empêche les doublons. Les envois de vente/réservation et les alertes internes doivent être déclenchés après la transaction métier, jamais avant la confirmation réelle.

## 9. Clients, ventes, factures et avis

### 9.1 Page « Clients »

Créer une page clients avec recherche, filtres, pagination et fiche 360°. La fiche affiche identité/contact, consentements marketing le cas échéant, notes internes séparées des données visibles client, historique de ventes/factures, formations et progression, rendez-vous/no-shows, cartes cadeaux, remboursements, avis et journal de communication. Les droits limitent l'accès au personnel autorisé et les actions sensibles sont auditables.

### 9.2 Page « Ventes »

Lister toutes les ventes et permettre filtres par période, client, catégorie, statut paiement, remboursement et promotion. Le détail de vente montre : lignes et options, prix catalogue, promotion (type, valeur, période et montant), cartes cadeaux utilisées, montant Stripe, total, facture, consentements/snapshots, remboursements, coût Stripe, net Stripe et commission développeur. Distinguer clairement **commission Stripe** (coût du paiement client) et **commission développeur** (due par l'institut sur les formations distancielles). Les exports doivent exclure secrets et respecter les autorisations.

La facture client et les éventuels avoirs restent accessibles depuis l'espace client, les ventes et le système natif de factures. Les montants fiscaux sont figés au paiement ; toute configuration fiscale future doit être versionnée.

### 9.3 Avis

Un client ne peut déposer qu'un avis par cible achetée/terminée selon la règle produit : une prestation après le rendez-vous terminé, une formation après l'étape définie. L'API vérifie l'achat et cible la bonne prestation ou formation. L'avis contient note 1–5, commentaire, nom d'affichage et statut `en attente`, `publié` ou `refusé`; les avis ajoutés manuellement sont identifiés comme tels. Unicité client+cible, modération, motif interne, publication/masquage, traçabilité et notifications manager sont requis. La vitrine n'affiche que les avis publiés et la note est rendue en pattes de chien.

## 10. Commissions plateforme

Le contrat natif déjà développé reste la source de la relation commerciale. Ajouter, dans sa configuration côté développeur, une étape **« Commission formations distancielles »** : type `pourcentage` ou `montant fixe`, valeur, activation, date d'effet et version. Le taux effectivement applicable est copié dans chaque vente éligible. Les prestations, cartes cadeaux et formations présentielles ne génèrent aucune commission développeur, sauf extension contractuelle future explicite.

Le calcul mensuel est fiable et auditable : commission brute des ventes distancielles encaissées, moins déduction proportionnelle des remboursements, plus/minus report négatif du mois précédent, égal net à payer (jamais négatif). Un mois est verrouillé par une clé unique année/mois ; un recalcul n'écrase pas un paiement réussi et garde son snapshot détaillé.

Créer une page manager **« Commissions »** : carte du mois terminé, montant, échéance, statut (`à venir`, `à payer`, `relance`, `en retard`, `payée`, `soldée à 0 €`), historique et détail mensuel. La fiche montre ventes source, taux, remboursements, reports, net dû, facture et journal. Le bouton « Payer » crée une Checkout Session Stripe **Plateforme/Développeur** et redirige vers Stripe hébergé. Son retour/webhook met à jour le mois une seule fois, puis crée/transmet la facture dans la page native de factures et remonte la transaction au panel développeur déjà branché. Aucun paiement de commission ne doit consommer la clé Stripe de l'institut.

## 11. Cartes cadeaux

### 11.1 Pages et parcours

Vitrine : page carte cadeau avec description, image, montants suggérés, minimum, maximum optionnel, montant libre validé, nom acheteur, nom bénéficiaire, e-mail bénéficiaire facultatif, message et aperçu. L'achat passe par Stripe Checkout hébergé. Après webhook, une carte est émise une seule fois, son visuel/PDF est généré et elle est envoyée à l'acheteur (et au bénéficiaire si l'institut active cette option, sans exposer le code dans des logs).

Espace client : « Mes cartes cadeaux » affiche cartes possédées, code masqué, solde, statut, achats/transactions, PDF téléchargeable et action de protection/reset PIN si disponible. Le code/PIN n'est jamais retourné en clair après création ; seul un nouveau PIN est émis puis l'ancien invalide.

Manager : configuration (minimum, maximum, montants prédéfinis, description, image), liste/recherche, détail/ledger, émission manuelle paiement sur place, débit manuel encadré, recrédit/remboursement et envoi du PDF. Chaque opération a acteur, date, montant avant/après, source et motif.

### 11.2 Rendu PDF imposé

Retirer la personnalisation de templates de cartes cadeaux. L'institut fournit un **PDF maître** validé. Le système renseigne automatiquement les zones prévues (montant, code/QR, bénéficiaire, acheteur, message, date/validité le cas échéant) dans ce PDF ou son image de fond, puis génère le PDF final. Un écran de configuration permet de téléverser et prévisualiser le PDF, puis de placer/tester les champs ; il ne s'agit pas d'un studio de templates HTML libre. À l'émission, le fond et la configuration de champs sont figés avec la carte pour que les anciens PDF restent reproductibles.

### 11.3 Sécurité et règles de valeur

Code aléatoire à forte entropie, QR à jeton opaque haché côté serveur, PIN haché, rate limiting des vérifications, anti-énumération, code masqué dans l'UI et aucun secret dans les événements/logs. Une carte possède solde, montant réservé pendant paiement, statut et ledger append-only. Débit et recrédit sont atomiques et idempotents ; un solde ne peut jamais devenir négatif ni être débité deux fois sous concurrence. La carte est un paiement partiel possible, plusieurs cartes peuvent compléter une commande si la politique l'autorise. Lors d'un remboursement, recréditer seulement la fraction réellement financée par la carte, jamais un montant arbitraire.

## 12. Qualité, sécurité, conformité et recette

### 12.1 Exigences UX/UI

- Responsive prioritaire : toutes les grilles deviennent cartes/listes et les actions critiques restent atteignables à une main sur mobile.
- Accessibilité : labels explicites, navigation clavier, focus visible, contrastes, alternatives d'images, erreurs associées aux champs, touch targets ≥ 44 px.
- États complets : chargement, vide, erreur, succès, action désactivée expliquée, confirmation avant annulation/suppression/remboursement.
- Dates, devises et fuseau affichés de façon cohérente ; la page de vente et le calendrier ne masquent jamais un montant restant ou une réservation provisoire.

### 12.2 Sécurité et exploitation

- Authentification sécurisée, contrôle de rôle par API, contrôle de propriété client sur toute ressource, limitation de débit et journal d'audit des actions manager.
- Validation/sanitation serveur de tous les champs et HTML ; protections XSS, CSRF selon mécanisme d'authentification, SSRF sur URLs externes, validation de MIME/poids des uploads et contrôle d'accès signé aux fichiers privés.
- Chiffrement des secrets, rotation possible, logs structurés sans données sensibles, sauvegardes et procédure de restauration.
- Webhooks Stripe/Brevo authentifiés, reçus rapidement, dédoublonnés, avec journal d'échec et mécanisme de reprise. Une panne Brevo ne doit pas annuler une vente ; elle crée une notification de supervision.
- Conformité RGPD : minimisation, registre des finalités, consentements distincts marketing, export/suppression selon obligations de conservation, politique de rétention pour médias d'évaluation et notes internes.

### 12.3 Critères de recette bloquants

1. Deux clients ne peuvent ni confirmer le même créneau prestation, ni dépasser la capacité d'une même session lors de paiements concurrents.
2. Rejouer webhook, retour Stripe et polling ne crée qu'une vente, une réservation, un accès, une facture et un débit carte cadeau.
3. Une formation vendue ne peut plus changer de type ; elle peut seulement être archivée sans couper les droits existants.
4. Les règles de rétractation/renonciation sont affichées par ligne, enregistrées en snapshot et les accès immédiats sont bloqués sans consentements requis.
5. Le client ne voit ni score ni correction de questionnaire ; le manager les voit et une seule soumission est en attente par formation/client.
6. Un remboursement partiel tient compte de Stripe et carte cadeau, produit l'avoir et ajuste la commission sans sur-remboursement.
7. Une commission ne porte que sur les ventes distancielles éligibles, gère les remboursements/reports et se paie avec les clés plateforme séparées.
8. Les clés de l'institut sont masquées, testables et distinctes des clés du développeur ; les webhooks sont configurés automatiquement à partir des URLs techniques.
9. Les cartes cadeaux ne peuvent être ni devinées, ni débitées deux fois, ni recréditées au-delà de leur usage.
10. Les e-mails sont envoyés à partir d'événements réels, avec variables contrôlées, aperçu, journal et anti-doublon.

## 13. Éléments explicitement hors périmètre

Ne pas refaire le système de contrat, d'abonnement/subscription ou le panel développeur natif déjà fourni. La refonte doit seulement ajouter la configuration de commission au contrat et transmettre les factures/transactions de commission aux mécanismes natifs existants. Toute évolution juridique des textes, qualification de l'offre ou politique commerciale doit être validée avant mise en production ; l'interface configurable n'est pas un avis juridique.
