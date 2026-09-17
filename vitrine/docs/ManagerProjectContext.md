# ManagerProjectContext — vision produit Manager + Dev

> Pourquoi chaque module existe, côté institut (admin) et plateforme (dev). Complément de
> [ManagerArchitecture](./ManagerArchitecture.md). Global : [FolderProjectContext](./FolderProjectContext.md).

## Vision
Le manager est le **poste de pilotage de l'institut** ; l'espace dev est la **tour de contrôle de
la plateforme**. Deux rôles, deux responsabilités, une même app (séparée par guard de rôle) pour
simplifier l'auth et le déploiement.

## Rôle de l'institut (Manager — role admin)
La gérante gère son activité au quotidien : catalogue (prestations/formations/produits/cartes
cadeaux), planning et réservations, ventes et remboursements, et **paie ses commissions** à la
plateforme. Elle ne voit pas la supervision technique.
- **Activation contrat** : condition d'entrée. Au 1er login, onboarding guidé (règlement des frais
  de lancement + souscription mensuelle) ; tant que non actif, accès bloqué. Modèle économique de la plateforme.
- **Gestion quotidienne** : planning anti-chevauchement, réservations (annulation/no-show),
  CRUD catalogue, suivi des ventes, traitement des remboursements.
- **Commissions à payer** : la gérante règle mensuellement ce qu'elle doit (calcul serveur unifié,
  report négatif) via Stripe (compte Dev) → facture officielle.

## Rôle du développeur (Dev — role dev)
Supervise la plateforme et la relation contractuelle ; sur-ensemble du manager (bypass
contrat/maintenance/suspension).
- **Contrats** : création/activation/annulation des contrats institut (frais + abonnement).
- **Commissions reçues** : configuration du barème + suivi des encaissements plateforme.
- **IntegratedAPI / coffre** : credentials Stripe (Institut + Dev) et Brevo, jamais exposés.
- **Email Template Studio** : édition versionnée des emails transactionnels (published-only en prod).
- **Observabilité** : SendLog (envois email), EventLog (événements métier), WebhookFailureLog
  (pannes webhook), pour diagnostiquer sans accéder aux données sensibles.
- **Maintenance** : bascule maintenance/suspension du site.

## Intérêt métier par module
- **Dashboard** : santé de l'activité (ventes, commissions dues) en un coup d'œil.
- **Planning / réservations** : cœur opérationnel d'un institut (prestations datées, capacité).
- **Catalogue (CRUD)** : autonomie de la gérante sur son offre (prix, promos, options, sessions).
- **Ventes / remboursements** : traçabilité financière + service client (remboursements cadrés).
- **Commissions à payer** : modèle de revenu plateforme ; règlement fluide = rétention SaaS.
- **Mon contrat** : transparence sur les engagements.
- **Paramètres** : identité de marque, thème, pages légales, statut site → personnalisation.
- **Dev / contrats & commissions reçues** : pilotage du business plateforme.
- **Dev / intégrations & logs** : fiabilité, sécurité, support technique.

## Activation contrat & paiement commissions (logique SaaS)
- Le **contrat** rend l'institut payant et débloque le manager ; sans lui, pas d'accès.
- Les **commissions** récurrentes financent la plateforme ; calcul serveur faisant foi, facturé via Stripe Dev.
- Ensemble : frais de lancement (one-shot) + abonnement (récurrent) + commissions (variable) = le revenu plateforme. Le moteur **UnifiedCheckout** (rapports 143/144) unifiera ces encaissements.

## Supervision technique (dev)
- Tout est observable (logs) et configurable (intégrations, templates, maintenance) sans toucher au
  code → exploitation autonome de la plateforme. Les secrets restent dans le coffre (jamais en clair).

→ Détails techniques : [ManagerArchitecture](./ManagerArchitecture.md).

## MAJ U3 — Activation contrat & paiement commissions hébergés
L'onboarding (frais de lancement + souscription mensuelle) et le règlement mensuel des commissions
pourront s'effectuer sur des pages Stripe hébergées (flag `PLATFORM_CHECKOUT_HOSTED`), offrant à la
gérante une expérience de paiement sécurisée et cohérente avec la vitrine. Le modèle économique
plateforme (frais + abonnement + commissions) est unifié derrière UnifiedCheckout. Fallback Elements conservé.

## MAJ R0 — Espaces Manager & Dev esquissés
Les deux audiences internes (gérante = Manager, plateforme = Développeur) ont désormais leur
coquille navigable, avec la séparation des droits matérialisée : un admin voit le manager mais pas
la section Dev, un dev voit les deux. Le relabel UI (`admin→Manager`, `dev→Développeur`) est en
place sans toucher aux rôles backend. Aucun module réel n'est branché — R0 valide l'architecture des
espaces et des guards. L'onboarding contrat, le dashboard et les outils Dev décrits ci-dessus seront
implémentés en **R3**, en consommant les endpoints et le paiement plateforme hébergé déjà prêts (U3).

## MAJ Theme Foundation — Un panel à l'identité propre
Le panel Manager/Dev adopte une **identité visuelle distincte** de la vitrine (palette bleu/ardoise
sobre, orientée outil de travail), conformément à la décision produit. Les couleurs sont centralisées
en tokens (aucun hex en dur), et le rôle **dev** pourra à terme configurer ce thème panel (et celui
de la vitrine) depuis un Theme Studio dédié — pour l'instant un thème par défaut s'applique, sans
dépendance backend. Cela prépare une cohérence visuelle maîtrisée avant l'arrivée des vrais modules
manager (R3).

## MAJ T1 — Le panel a son propre thème (configurable)
L'identité du panel Manager/Dev devient **configurable côté backend** (scope `manager`), séparée de
la vitrine. Tant qu'aucun thème manager n'est défini, le panel garde son défaut sobre (bleu/ardoise) —
donc aucune surprise visuelle. Le dev pourra activer/éditer un thème manager dédié (via le futur
Theme Studio), faisant évoluer l'outil interne indépendamment de la devanture publique.

## MAJ M1 — Qui envoie quoi à qui
Le Manager/Dev pourra bientôt configurer les **expéditeurs** des communications : le **développeur**
gère l'adresse **support** (plateforme → institut), la **gérante** (admin) gère l'adresse
**commerciale** (institut → client). Le **client** n'est jamais une adresse à configurer : c'est un
destinataire résolu automatiquement depuis le dossier métier. Cette séparation (avec vérification de
l'expéditeur chez Brevo et authentification du domaine) garantit des e-mails fiables et une frontière
de responsabilité claire dev/admin. M1 pose le backend ; l'écran de gestion arrive ensuite.

## MAJ M2 — Des règles d'envoi, pas des adresses dans les templates
Le système sait désormais, pour chaque événement métier (vente, réservation, remboursement,
commission), **quel expéditeur** et **quel destinataire** utiliser — sans jamais coder l'adresse dans
le template. La gérante/le dev pourront, à terme, consulter ces règles et le **journal des envois**
depuis le Manager, et comprendre exactement quel e-mail part de quel rôle vers quel rôle. En M2 c'est
encore en coulisses (mode shadow, aucun changement visible pour les clients) ; l'objectif est une
communication fiable, traçable et pilotable côté interne.

## Sprint M3A — Notifications ciblées admin/dev (rapports 175-176)

Une notification interne n'est plus « globale sans destinataire » : elle vise soit l'**institut**
(admin → panel Manager), soit la **plateforme** (dev → espace Dev). Concrètement, la gérante ne verra
que ses notifications métier (ventes, réservations, no-show, remboursements, formations), et le dev ne
verra que les notifications techniques (échecs webhook/contrat/job, erreurs système, vérification
d'identité e-mail…). Cela évite que des alertes techniques polluent le panel de la gérante, et que des
alertes métier noient l'espace dev. Côté produit M3A pose uniquement le **moteur de ciblage backend** et
deux endpoints filtrés ; l'écran React (séparation visuelle Admin/Dev) viendra ensuite. Compatibilité
totale : aucune notification existante n'est perdue (anciennes notifs traitées comme audience admin).
Prochaine étape **M3B** : enrichir le contexte des événements pour des notifications plus parlantes.

## Sprint M3B — Contexte d'événements enrichi (rapports 177-178)

Chaque événement métier (vente, réservation, remboursement, commission, carte cadeau) transporte
maintenant un **contexte clair et réutilisable** : qui (acteurs), quoi (IDs liés), combien/quand
(variables). C'est la matière première d'une future expérience Manager/Dev plus riche : journaux
d'audit lisibles, notifications corrélées à leur événement d'origine, et plus tard des automatisations
et de l'IA — sans jamais exposer d'e-mail ou de secret (les e-mails sont retrouvés à la demande via la
base, jamais stockés). M3B reste **en coulisses** (backend) ; rien ne change pour le client. Étape
suivante **M3C** : activer l'envoi e-mail réel par rôles en s'appuyant sur ce contexte.

## Sprint M3C — Premier e-mail piloté par rôles (rapports 179-180)

Le moteur de communication par rôles (M1/M2) passe pour la première fois en **envoi réel**, sur un
flux sûr : l'e-mail de **confirmation de remboursement**. Il part maintenant « de la commerciale vers
le client » via les identités configurées, plutôt que d'une adresse codée en dur — visible et traçable
dans les journaux internes. Le changement est **réversible par un simple flag** : si on le désactive,
l'ancien e-mail direct reprend la main. Les flux comptables/sensibles et les e-mails dont l'événement
n'est pas encore aligné restent volontairement en attente. Objectif : fiabiliser pas à pas la
communication, sans risque de doublon ni de perte d'e-mail. Suite **M3D** : préparer puis migrer la
confirmation de réservation.

## Sprint M3D — Confirmation prestation pilotée par rôles (rapports 181-182)

Après le remboursement (M3C), c'est au tour de la **confirmation de réservation prestation** de passer
au moteur par rôles. On a d'abord **aligné** l'événement : tout chemin qui confirme une prestation
(achat OU report de créneau) émet le même événement, donc déclenche la même confirmation. L'e-mail part
« de la commerciale au client », de façon traçable, et reste **réversible par un flag**. Un report de
créneau envoie logiquement une nouvelle confirmation (la date a changé), sans jamais dupliquer un e-mail
déjà envoyé. Les flux comptables (vente, commissions) restent en attente. Suite **M3E** : décider de la
suite (vente, ou écran de supervision des envois).

## Sprint M3E — Supervision des envois (rapports 183-184)

Avant d'élargir la migration des e-mails, on se dote d'une **visibilité** : la gérante (admin) et le
dev peuvent consulter le journal des envois (statuts, modèle, de qui à qui, erreurs éventuelles) — la
gérante uniquement pour ses communications institut/client, le dev pour l'ensemble (y compris la
plateforme/technique). Aucune adresse e-mail ni secret n'est exposé (on ne montre qu'une empreinte
anonymisée). C'est une base de diagnostic : comprendre ce qui part, ce qui est inhibé (shadow) et ce
qui échoue, pour activer la suite en confiance. L'écran dédié viendra ensuite (M3F) ; ici on prépare le
backend et le client d'API.

## Sprint M4 — Communication Center (rapports 185-186)

Première vraie interface du centre de communication, accessible à la gérante (admin) et au dev, avec
des périmètres distincts. La **gérante** configure son identité « commerciale » (adresse d'expéditeur),
lance la vérification Brevo (saisie d'un code), suit l'authentification DNS de son domaine, et consulte
le **journal de ses e-mails** institut/client (statuts, filtres). Le **dev** dispose en plus de
l'identité « support », de la supervision complète (livraisons + envois) et du diagnostic technique.
Tout est **mobile-first** (cartes, filtres en tiroir, boutons larges) et **sans donnée sensible**
(aucune adresse client, aucun secret). En lecture seule pour les journaux : pas encore de relance
d'envoi ni d'édition de templates (M5). C'est la mise en main concrète de toute la mécanique
construite en M1→M3E.

## Sprint M5 — Theme Studio (rapports 187-188)

Le dev peut désormais personnaliser l'apparence depuis le panel, via un Theme Studio simple : **deux
thèmes seulement**, le thème **Vitrine** (ce que voient les clients) et le thème **Panel** (l'interface
de gestion, identique pour l'admin et le dev). On édite couleurs, police, arrondis, ombres et
espacements, avec un **aperçu en direct** (pas besoin de sauvegarder pour voir le rendu), puis on
**sauvegarde** et on **active**. C'est volontairement minimal (pas de presets ni d'import/export), et
réservé au dev. Objectif : reprendre la main sur l'identité visuelle sans toucher au code, en gardant
la vitrine et le panel bien distincts. Suite : édition des modèles d'e-mail (M6).

## Sprint M6 — Mail Template Studio (rapports 189-190)

Le dev peut désormais éditer les **modèles d'e-mail** depuis le panel : objet, contenu HTML et version
texte, avec **aperçu en direct** (mobile/desktop, sans aucun envoi), gestion des **versions**
(brouillon → publication → restauration/rollback) et un panneau de **variables** (celles utilisées,
celles disponibles, et une alerte si une variable inconnue est employée). Les **rôles** d'expéditeur et
de destinataire sont affichés (commerciale/support/client) mais **jamais d'adresse e-mail** : les
adresses se gèrent dans le Communication Center. C'est volontairement simple (pas d'éditeur
drag-and-drop, pas d'envoi de test réel) et réservé au dev. Suite : preview serveur fidèle ou migration
des e-mails comptables (M7).

## Sprint M10 — Planning global institut (rapports 197-198)

**Décision métier ferme** : une seule entité = l'institut. Plus de prestataires multiples. Le planning
devient un **calendrier global** (type Planity) : vue **jour** sur mobile, **semaine** sur ordinateur,
navigation jour/semaine, filtres par type. Il regroupe **réservations**, **formations présentielles** et
**créneaux bloqués**. Au clic, un drawer affiche le détail + le **paiement** (total, payé en ligne,
acompte, **solde à payer sur place**) + les actions : **annuler** (déclenche le remboursement éligible),
**marquer le solde payé sur place**. Le **report** de créneau est préparé mais désactivé (pas d'endpoint
admin). La réservation ne nécessite plus de prestataire côté serveur (un `practitionerId` ancien est
accepté mais ignoré). Mobile-first, animé (Motion Guideline), zéro tableau.

## Sprint M9 — Notification Center React + UX animée (rapports 195-196)

Le panel a enfin un **vrai centre de notifications** : une **cloche** dans le header (admin) et dans
l'espace dev (scope dev), avec **compteur rouge**, **bandeau « +X notifications »** qui se déroule quand
de nouvelles non-lues arrivent, **léger shake** de la cloche, et un **drawer** (bottom-sheet sur mobile,
panneau latéral sur ordinateur). Chaque notification montre sa **catégorie** (icône/couleur), sa
**priorité**, son caractère **persistant** et une **action métier** (ouvre la bonne page si elle existe,
sinon « Bientôt disponible »). On peut marquer lue / tout marquer lu / supprimer. L'isolation admin/dev
est garantie côté serveur. Rafraîchissement **prudent** (toutes les ~45 s + au retour sur l'onglet), pas
de WebSocket. Tout respecte **`prefers-reduced-motion`** et est **mobile-first**.

**React UX Motion Guideline (à partir de M9)** : toutes les nouvelles interfaces (panel ET vitrine)
doivent être mobile-first, animées avec sobriété (opacity/transform, durées courtes), avec des
micro-interactions utiles, sans table sur mobile, avec feedback immédiat et respect du reduced-motion.

## Sprint M8 — Le moteur consomme les templates (rapports 193-194)

Le moteur d'envoi des notifications utilise désormais **réellement** les templates publiés dans le
studio M7 (contenu, catégorie, priorité, persistance, action) ainsi que les catégories (icône/couleur).
Tant qu'un type d'événement n'a pas de template publié, le comportement reste **identique** à avant
(aucune régression). Le template **ne décide toujours jamais** qui reçoit la notification : c'est le
moteur qui choisit (admin/dev). Côté React, seul un **type** partagé est ajouté (`RuntimeNotification`,
helpers couleur/icône depuis la catégorie) pour préparer la refonte du centre — **aucun écran modifié**.
Un interrupteur de sécurité permet de revenir à l'ancien comportement instantanément. Suite (M9) :
refonte du centre de notifications.

## Sprint M7 — Notification Studio + Catégories (rapports 191-192)

Le dev dispose désormais d'un vrai studio de **notifications**, à l'image de celui des e-mails : il
édite le **contenu** des notifications (titre, message), leur **catégorie**, leur **priorité**, leur
caractère **persistant** et une **action métier** (ce qu'on ouvre au clic) — avec versions, publication
et rollback, et un **aperçu** (toast et centre de notifications) sans rien envoyer. Nouveauté clé : les
**catégories** deviennent un vrai référentiel (nom, icône, couleur), source unique des couleurs du
centre. Le template **ne décide jamais** qui reçoit la notification (admin/dev/both) : c'est le moteur
qui choisit, à l'envoi. Dev-only, mobile-first. Suite (M8) : brancher le moteur sur ces templates et
moderniser le centre de notifications.


## Sprint M11A — Checkout global booking (rapports 199-200)

Le checkout de production est officiellement branche sur le calendrier global de l institut : toute reservation passe par l entite unique, le prestataire n existe plus cote serveur (un ancien identifiant est accepte mais ignore). La disponibilite est calculee globalement. Aucun changement pour le paiement, le remboursement ou le planning. Limites : suppression definitive du champ prestataire reportee a M11B.

Pour le manager : le planning affiche les nouvelles reservations issues du checkout, toutes rattachees a l institut (entite unique). Rien a configurer.


## Sprint M11B — Finalisation calendrier global (rapports 201-202)

Le report (decalage) d un creneau est desormais possible directement depuis le planning, pour les admins. La reservation reste la meme (paiement inchange, aucun remboursement declenche), seul l horaire change. Toutes les creations de reservation passent par l institut unique ; le prestataire n existe plus cote serveur (un ancien identifiant est accepte mais ignore). Un script volontaire (jamais automatique) permet de consolider/archiver l heritage. Limites : suppression definitive des champs legacy reportee a une migration ulterieure ; pas de glisser-deposer ni de vue mois.

Pour le manager : depuis le drawer de detail d une reservation, un bouton « Reporter le creneau » ouvre un mini-formulaire (date + heure + motif) ; au succes le planning se rafraichit. Mobile-first, anime, sans tableau.


## Sprint M12 — Customer 360 (rapports 203-204)

Pour le personnel : on ouvre un client et on voit tout (resume + KPIs + timeline historique + sections repliables + carte financiere) et on declenche les actions courantes. Mobile-first, anime, cards, sans tableau. La recherche (nom/e-mail) ouvre la fiche. Confidentialite : reserve admin/dev ; aucune donnee technique sensible exposee.


## Sprint M13 — Gift Card 360 + Manual Booking + Template Studio (rapports 205-206)

Depuis la fiche client, le personnel peut : creer une carte cadeau payee sur place (codes + QR + carte PDF envoyee par mail), debiter une carte a la main (par code ou QR colle, avec motif et apercu du solde), prendre une reservation au comptoir (paiement sur place, creneau verrouille 5 min pendant la saisie), et ajouter une note interne. Cote dev : un Studio de templates de carte cadeau (HTML/CSS + preview live, versions) ; cote admin : une librairie pour choisir le template actif (sans editer le HTML, toujours un actif). Mobile-first, anime, sans tableau.


## Sprint P1 — Product Polish & UX (rapports 207-208)

Le manager gagne en cohérence et confort mobile : navigation avec état actif et barre latérale qui se réorganise au pouce, boutons icône agrandis (44px), modale de confirmation accolée en bas sur téléphone, focus clavier visible partout, animations homogènes. Aucune fonctionnalité métier modifiée.


## RX2 — Finance Experience (RX2.0–2.2)

Le manager dispose d'un espace finance qui se lit comme Stripe/Qonto. **Tableau de bord** (`/finance`) :
on ouvre, on comprend — revenu du jour, ventilation (prestations/formations/cartes cadeaux), et ce qu'il
reste à faire (soldes à encaisser, remboursements à traiter, factures impayées). **Timeline financière**
(`/finance/timeline`) : une seule liste ordonnée de tous les mouvements (paiement, acompte, solde, carte
cadeau, remboursement, commission, facture), avec un résumé net en haut et un volet de détail au tap.
Cards et volets, jamais de tableau, aussi agréable sur téléphone que sur ordinateur.


## RX2.3 — Actions financières & profit net

En tapant un mouvement de la timeline, on ouvre un volet qui raconte tout : combien a été payé (en ligne,
par carte cadeau, sur place), les frais Stripe, la commission plateforme (formations uniquement), les
remboursements, et surtout le **profit net estimé**. Si un frais Stripe n'est pas encore connu, on affiche
« Données partielles » plutôt qu'un chiffre inventé. Depuis ce volet, on traite un remboursement en un geste
(accepter/refuser + motif) et on encaisse un solde sur place (CB, espèces, autre). Simple, mobile, sans tableau.


## RX2.4 — Paiements sur place unifiés

Quand une prestation est réservée et payée directement à l'institut (sans paiement en ligne), elle apparaît
maintenant clairement dans la finance : « Paiement sur place à encaisser », puis « encaissé » une fois réglé.
On encaisse en un geste depuis le volet (CB, espèces, autre). Le tableau de bord et la timeline comptent
exactement la même chose : ce qu'il reste à encaisser sur place, sans rien oublier.


## RX2.5 — Commissions premium

Les commissions plateforme deviennent lisibles et modernes : une card « Commission ce mois » avec le montant,
l'échéance et un bouton « Payer » (paiement Stripe Dev hébergé), un détail clair du calcul (formations vendues,
remboursements déduits, report du mois précédent, à payer), un statut de retard explicite (à payer, délai de
grâce, en retard…) et un historique en cards. Si rien n'est dû : « Aucune commission à payer ce mois-ci ».
Cards et timeline, jamais de tableau, mobile-first.


## RX2.6 — Cartes cadeaux, cycle de vie financier

Chaque carte cadeau se lit comme une histoire : créée (en ligne ou payée sur place), offerte, utilisée comme
moyen de paiement, débitée à la main, avec son solde actuel bien visible, ses transactions, son acheteur et son
bénéficiaire, sa source de paiement (Stripe ou sur place), son QR (masqué, jamais le code complet) et ses
remboursements détaillés (part Stripe, part recréditée sur la carte, anomalies à traiter). Cards et timeline,
jamais de tableau, mobile-first.


## RX-BLOCKER-2 — Comptes manager & invitations

Le développeur crée les comptes de gestion (admin/dev) depuis « Utilisateurs » (`/manager/users`, dev-only)
sans jamais taper de mot de passe : chaque nouvel utilisateur reçoit un e-mail (envoyé par le **support**) avec
un lien personnel pour définir lui-même son mot de passe et activer son compte. La liste se lit en cards (nom,
rôle, statut : invitation envoyée / actif / désactivé) avec des actions simples (renvoyer l'invitation, activer,
désactiver). Un manager qui a oublié son mot de passe passe par « Mot de passe oublié ? » depuis l'écran de
connexion (lien envoyé par le support) ; un client passe par le même mécanisme côté vitrine (lien envoyé par la
commerciale). Les liens sont à usage unique, expirables, et un lien périmé affiche un écran rassurant avec la
possibilité d'en redemander un. Pages d'auth en colonne centrée, mobile-first, jamais de tableau.
