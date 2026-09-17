# FolderProjectContext — Beauty Savage (vision produit globale)

> Pourquoi le produit est structuré ainsi. Complément métier de
> [FolderArchitecture](./FolderArchitecture.md). Mise à jour si une décision produit globale change.

## Vision produit
Beauty Savage est une **plateforme SaaS mono-institut** : un institut de beauté/formation vend en
ligne (prestations, formations présentielles & distancielles, produits, cartes cadeaux) et paie en
retour la **plateforme** (commissions mensuelles, frais de lancement, abonnement de maintenance).
Trois publics, trois expériences distinctes → trois espaces.

## Pourquoi la séparation Vitrine / Manager / Dev
- **Vitrine (public + client)** — `beautysavage.fr` : expérience d'achat premium, orientée
  conversion et confiance (paiement sécurisé, accès formation à vie). Doit être rapide, SEO,
  cacheable, sans surface d'administration.
- **Manager (institut, role admin)** — `manager.beautysavage.fr` : outil de gestion quotidienne de
  la gérante (catalogue, planning, ventes, remboursements, commissions à payer, contrat). Audience
  interne, non indexée, derrière login + contrat actif.
- **Développeur (plateforme, role dev)** — `manager.beautysavage.fr/dev` : supervision technique &
  business plateforme (contrats, commissions reçues, intégrations API/coffre, templates email,
  logs, maintenance). Sur-ensemble du manager (bypass contrat/maintenance/suspension).

Séparer évite le **toggle vitrine/gestion** historique (UX confuse) et isole les surfaces : le
public ne voit jamais l'administration ; le manager ne voit jamais la supervision plateforme.

## Logique métier clé
- **Pricing serveur fait foi** (anti-fraude) : le client ne peut pas imposer un montant.
- **Carte cadeau = moyen de paiement** (jamais une remise) ; capée au solde réel.
- **Promotion = source unique** (`Promotion`) ; le prix vendu = catalogue − promo.
- **Commission** = ce que l'institut doit à la plateforme (calcul unifié + report négatif).
- **Contrat** = condition d'accès du manager (frais de lancement + abonnement) ; activation au 1er login.
- **Acompte V1** : prestation avec acompte en ligne + solde réglé sur place (`pay_on_site`).
- **Factures officielles = Stripe** (client : compte Institut ; commissions : compte Dev).

## Expérience utilisateur cible
- **Client** : parcours fluide catalogue → panier → checkout (Stripe Checkout hébergé) → accès
  immédiat (formation/produit) ou réservation confirmée (prestation). Mes formations à vie, mes
  cartes cadeaux, mes réservations, suivi remboursement.
- **Manager** : onboarding contrat guidé, puis dashboard opérationnel ; gestion sans friction.
- **Dev** : observabilité (logs, webhooks), pilotage contrats/commissions, maintenance.

## Stratégie SaaS
- Mono-tenant aujourd'hui ; l'isolation des comptes Stripe (Institut = encaissement client,
  Dev = facturation plateforme) et la séparation des espaces préparent une éventuelle
  multi-instituts. Le moteur **UnifiedCheckout** (rapports 143/144) centralise tous les paiements
  derrière un pipeline unique → base d'un produit SaaS facturable.

## Décisions produit validées
1. React en **parallèle** du Vanilla (bascule progressive, rollback).
2. Domaine principal = Vitrine + Client ; `manager.` = Manager + Dev.
3. **Stripe Checkout hébergé** remplace Stripe Elements (montant > 0) ; 0 € via finalize-free.
4. **Plus de toggle** vitrine/gestion.
5. Rôles backend `client/admin/dev` **inchangés** ; relabel UI `admin→Manager`, `dev→Développeur`.
6. Documentation obligatoire par scope (cette structure de docs).

→ Détails techniques : [FolderArchitecture](./FolderArchitecture.md).

## MAJ U1 — Stratégie de paiement unifiée
Décision produit confirmée : tous les paiements passeront par un moteur unique (UnifiedCheckout),
Stripe Checkout hébergé pour montant > 0 (sécurité/SCA délégués, mobile-friendly), finalize-free
pour 0 €. U1 pose les fondations backend sans changer les flux existants ; U2 branchera le checkout
client réel. Cf. FolderArchitecture (section UnifiedCheckout) et rapports 143/144/151.

## MAJ U2 — Paiement hébergé activable
Le backend peut désormais router les achats client vers Stripe Checkout hébergé (flag
`CHECKOUT_HOSTED`), tout en gardant Elements en fallback. Décision produit confirmée : la sécurité
(SCA/3DS délégués à Stripe) et le mobile priment ; la carte cadeau reste un moyen de paiement
(jamais un discount), Stripe n'encaisse que le reste dû. La bascule visible côté client se fera avec React (R2).

## MAJ U3 — Paiements plateforme unifiés
Les encaissements de la plateforme (commission mensuelle, frais de lancement, abonnement) peuvent
désormais passer par Stripe Checkout hébergé (flag `PLATFORM_CHECKOUT_HOSTED`), comme les achats
client. Le modèle SaaS (frais + abonnement + commissions) est ainsi entièrement routable par le
moteur UnifiedCheckout, base d'une facturation plateforme cohérente. Anciens flows conservés (fallback).

## MAJ R0 — Fondations React livrées
La décision produit « React en parallèle, bascule progressive » est désormais **amorcée
techniquement** : le squelette des deux espaces (Vitrine public/client, Manager + section Dev)
existe, navigable, avec guards de rôle (relabel UI `admin→Manager`, `dev→Développeur`). Aucune
fonctionnalité métier n'est encore migrée — le Vanilla reste la seule UI de production. R0 valide la
faisabilité (build, tests, proxy same-origin) sans aucun risque sur l'existant. Les vraies pages
arrivent à partir de **R1** (vitrine) puis **R3** (manager), en consommant l'API et le paiement
hébergé déjà prêts côté backend (U2/U3).

## MAJ R1 — Première valeur produit visible
La vitrine React affiche désormais le vrai catalogue (prestations/formations/produits/cartes
cadeaux) en réutilisant l'API publique existante — preuve que la migration progressive fonctionne
sur du contenu réel, sans toucher au backend ni au Vanilla. L'achat reste fermé (R2) : R1 est une
étape « consultation » qui dérisque la suite (typage des payloads, formats prix/médias centralisés,
états de chargement, responsive) avant d'ouvrir la conversion et le paiement hébergé.

## MAJ Theme Foundation — Deux identités visuelles
Décision produit actée techniquement : la **vitrine** (devanture premium, violet/rose, thème piloté
par le backend) et le **panel** Manager/Dev (outil interne sobre, bleu/ardoise) ont des identités
**distinctes**. Les couleurs ne sont plus codées en dur dans les composants : un système de tokens
(`@bs/ui/theme`) centralise tout et permettra au rôle **dev** de configurer chaque thème depuis un
futur « Theme Studio » (plan 161), sans toucher au code. La vitrine reprend le thème backend existant
(`/api/vitrine/theme`) avec fallback ; le panel a son défaut en attendant son endpoint dédié.

## MAJ T1 — Deux thèmes pilotés côté backend
Le backend sait maintenant stocker et servir **deux thèmes distincts** (vitrine et manager). Le panel
Manager n'est plus figé sur un défaut codé en dur : il charge son thème depuis `/api/theme/manager`
(avec repli sur le défaut si rien n'est configuré). Cela rend les deux identités visuelles
**configurables** (le dev pourra les éditer via le futur Theme Studio) tout en garantissant zéro
changement visible tant qu'aucune config manager n'existe. Étape clé avant un Theme Studio Dev
réellement multi-scope.

## MAJ R2A — Vers la conversion (sans encore payer)
L'utilisateur peut désormais composer un panier et choisir un créneau de prestation dans React, puis
préparer sa commande (consentements légaux), **sans paiement**. C'est l'étape qui précède la
conversion : on valide l'expérience d'achat (panier indicatif, calendrier, transparence légale) en
gardant le backend comme seule autorité (prix, disponibilité, verrou de créneau). Le paiement réel
(Stripe Checkout hébergé) est volontairement reporté à **R2B** pour livrer la préparation de façon
sûre et testée d'abord.

## MAJ R2B — La conversion est ouverte (paiement)
React peut désormais déclencher un **paiement réel** : redirection vers la page Stripe hébergée
(montant > 0) ou finalisation directe (0 €), toujours **via le backend** (jamais Stripe.js côté
client). C'est la première fois qu'un achat peut aboutir depuis React. La sécurité prime : aucune
donnée bancaire ne transite par le front, le serveur recalcule tout, et le succès n'est jamais
affirmé tant que le webhook n'a pas confirmé (wording prudent « confirmation en cours »). Le retour
des paiements hébergés atterrit encore sur le Vanilla (URL backend) — bascule complète vers les pages
React en R2C.

## MAJ R2C — Boucle d'achat React complète
Le parcours d'achat peut désormais se dérouler **entièrement dans React** : sélection → panier →
consentements → paiement (hébergé ou gratuit) → **retour sur les pages React** → confirmation. Un
**login client léger** permet de s'authentifier sans quitter le tunnel (panier conservé, reprise du
checkout après connexion). La bascule du retour Stripe vers React est **opt-in** (variable backend
`CHECKOUT_RETURN_BASE_URL`) pour ne jamais casser le Vanilla. C'est le premier parcours de bout en
bout côté React ; l'espace client complet et le manager restent à venir (R3).

## MAJ M1 — Vers une communication structurée par rôle
Le backend pose les bases d'une communication à **identités d'expéditeur** distinctes : **support**
(plateforme/dev → vers l'institut) et **commerciale** (institut/admin → vers le client), le **client**
n'étant jamais une identité configurable mais un destinataire résolu depuis le contexte. Cette
fondation (vérification sender Brevo, domaine DNS, résolution from/to) prépare une future plateforme
de communication unifiée et une UI de gestion côté Manager/Dev — sans encore changer les e-mails
envoyés aujourd'hui (brique additive). Prochaine étape : M2 (moteur d'envoi événementiel) puis l'UI.

## MAJ M2 — Le « qui envoie quoi » devient déclaratif
Au-delà des identités (M1), le backend sait maintenant **router un e-mail par rôle au moment de
l'événement** : une règle déclare, pour chaque event métier, le template et le couple
expéditeur→destinataire (ex. vente → commerciale→client ; commission → support→commerciale). Le
template ne contient jamais d'adresse ; le moteur l'injecte. Pour l'instant c'est en **shadow** (on
n'envoie pas en double : les e-mails directs actuels restent la source), mais la mécanique est prête
et journalisée (idempotente). Cela prépare une plateforme de communication unifiée et une UI de
pilotage côté Manager/Dev (règles + journal d'envois), tout en gardant le comportement de prod
inchangé tant que le flag n'est pas activé.

## Sprint M3A — Notifications ciblées admin/dev (rapports 175-176)

Après les e-mails (M1/M2), on applique le même principe de ciblage aux **notifications internes** :
chacune a maintenant une cible claire — **institut (admin)** ou **plateforme (dev)**. Le panel de la
gérante n'affiche que les notifications métier ; l'espace dev n'affiche que les notifications techniques.
On ne mélange plus les deux mondes, et on ne fuite jamais une alerte dev vers l'admin (ni l'inverse), ni
quoi que ce soit vers le client. M3A est encore **en coulisses** (moteur backend + endpoints filtrés +
migration non destructive des anciennes notifications) ; l'interface React dédiée viendra plus tard.
Objectif : des notifications fiables, pertinentes pour chaque rôle, sans bruit. Suite **M3B** :
enrichir le contexte des événements pour rendre chaque notification plus précise.

## Sprint M3B — Contexte d'événements enrichi (rapports 177-178)

Après le ciblage des notifications (M3A), on enrichit les **événements** eux-mêmes : chaque événement
métier porte désormais un contexte standard (acteurs, IDs liés, variables utiles) réutilisable par les
mails, les notifications, l'audit, et demain l'IA et les automatisations. La règle d'or reste la
protection des données : aucun e-mail ni secret n'est stocké dans le journal d'événements — l'e-mail
est retrouvé à la demande via la base quand un envoi est nécessaire. C'est une fondation invisible
pour l'utilisateur, mais décisive pour une plateforme fiable et traçable. Prochaine étape **M3C** :
activer l'envoi e-mail réel par rôles (sortie du mode shadow) en s'appuyant sur ce contexte.

## Sprint M3C — Premier e-mail réel par rôles (rapports 179-180)

Après avoir préparé le terrain (identités M1, moteur M2, contexte M3B), on bascule **un** e-mail en
production réelle via le moteur par rôles : la **confirmation de remboursement**. Elle est envoyée « de
la commerciale au client » à partir des identités configurées, de façon traçable, et **réversible par
un flag** (retour à l'envoi direct si besoin). On ne migre qu'un flux sûr à la fois, sans jamais
risquer d'envoyer deux fois le même e-mail ni d'en perdre un. Les e-mails comptables et ceux dont
l'événement n'est pas encore aligné restent en attente. C'est une avancée prudente vers une
communication entièrement pilotable. Suite **M3D** : la confirmation de réservation.

## Sprint M3D — Confirmation de réservation par rôles (rapports 181-182)

Deuxième e-mail basculé en envoi réel via le moteur par rôles : la **confirmation de prestation**. On a
d'abord rendu cohérents tous les chemins qui confirment une réservation, pour qu'ils déclenchent la même
confirmation, puis migré l'e-mail (« de la commerciale au client »), avec rollback par flag et
anti-doublon. Un report de créneau envoie une nouvelle confirmation (date modifiée), sans jamais doubler
un e-mail. Les e-mails comptables restent volontairement en attente. C'est la suite logique de la
migration prudente, flux par flux. Suite **M3E**.

## Sprint M3E — Supervision des envois e-mail (rapports 183-184)

Pour migrer la suite des e-mails sereinement, il faut d'abord **voir** ce qui se passe. M3E ajoute une
supervision : journaux des livraisons (moteur par rôles) et des envois, avec statuts, modèles et
erreurs. Le dev voit tout (y compris la plateforme), la gérante voit uniquement l'institut/client —
sans jamais exposer d'adresse e-mail ni de secret. C'est une fondation de diagnostic et de confiance,
en lecture seule pour l'instant ; l'interface de consultation arrivera ensuite.

## Sprint M4 — Communication Center (rapports 185-186)

Après avoir bâti le moteur (identités, envois par rôles, supervision) en coulisses, M4 livre **l'écran**
qui le rend pilotable : un Communication Center dans l'espace Manager. La gérante y gère son identité
d'expéditeur et suit ses e-mails ; le dev supervise l'ensemble et diagnostique. Pensé mobile d'abord,
sans jamais exposer d'adresse client ni de secret. Lecture seule pour l'instant (pas de relance ni
d'édition de templates) — l'objectif est la visibilité et la prise en main. Suite : édition des
modèles et actions de supervision (M5).

## Sprint M5 — Theme Studio (rapports 187-188)

Après le centre de communication (M4), M5 donne au dev un Theme Studio pour gérer les **deux** thèmes
du produit : la vitrine publique et le panel interne (commun admin/dev). Édition visuelle simple,
aperçu en direct, sauvegarde et activation — sans presets ni import/export, et sans toucher au métier.
La distinction vitrine/panel reste nette ; le panel n'a qu'un seul thème pour tout le monde.

## Sprint M6 — Mail Template Studio (rapports 189-190)

Après les identités (M4) et les thèmes (M5), M6 donne au dev l'édition des **modèles d'e-mail** :
contenu, versions, publication/rollback et aperçu sans envoi. Cohérent avec la séparation
construite depuis M1 : les modèles décrivent le message et les variables ; les adresses (qui envoie, à
qui) restent gérées ailleurs, par rôle. Toujours mobile-first, dev-only, sans toucher au moteur
d'envoi ni aux règles. Suite (M7) : rendu serveur fidèle pour l'aperçu, ou migration des e-mails
comptables.

## Sprint M10 — Planning global institut (rapports 197-198)

Décision métier : une seule entité = l'institut, calendrier global (Planity). Nouveau endpoint manager
`GET /api/gestion/calendar/items` + services calendrier (`services/calendar/*`, additif, non destructif :
practitionerId legacy conservé/ignoré). Feature React `apps/manager/src/features/planning/` (vue jour
mobile / semaine desktop, drawer détail + actions annuler/solde, formations présentielles incluses), api-
client `manager/calendar.ts`. Mobile-first, zéro table, Motion Guideline. Limites : report admin sans
endpoint (UI désactivée), cleanup practitionerId reporté.

## Sprint M9 — Notification Center React + UX animée (rapports 195-196)

Centre de notifications dans le panel (admin + dev) : cloche + badge + bandeau « +X » + shake + drawer
responsive (bottom-sheet mobile / panneau desktop), catégorie/priorité/persistant/action, mark-read/
delete, scope admin/dev (backend autorité), polling prudent (~45 s, pas de WebSocket), respect du
reduced-motion. Un seul changement backend : la sérialisation expose les métadonnées M8 (jamais
`variablesSnapshot`). Nouveaux : `@bs/ui` MotionTokens/prefersReducedMotion, api-client
`manager/notifications.ts`, feature `apps/manager/src/features/notifications/`.
**React UX Motion Guideline** (dès M9) : mobile-first, animations sobres, pas de table sur mobile,
feedback immédiat, reduced-motion — à appliquer à toutes les interfaces futures (panel + vitrine).

## Sprint M8 — Le moteur consomme les templates (rapports 193-194)

Le moteur de notifications backend exploite désormais les templates publiés (M7) + catégories. Additif &
non destructif (sans template publié → comportement identique). La cible reste choisie par le moteur, pas
par le template. Côté React : ajout d'un module **types-only** `manager/notifications.ts` (type runtime +
helpers couleur/icône depuis la catégorie). Aucun écran modifié — le centre de notifications reste pour
la suite (M9).

## Sprint M7 — Notification Studio + Catégories (rapports 191-192)

Symétrique du Mail Template Studio (M6), pour les notifications : édition du contenu, des catégories
(vrai modèle métier avec icône/couleur), de la priorité, de la persistance et d'une action métier —
versions/publication/rollback et aperçu sans envoi. Principe d'architecture clé : le template décrit le
message ; c'est le moteur qui décide du destinataire (admin/dev/both). Cohérent avec toute la lignée
communication. Dev-only, mobile-first. Suite (M8) : exploitation runtime + centre de notifications.


## Sprint M11A — Checkout global booking (rapports 199-200)

Le checkout de production est officiellement branche sur le calendrier global de l institut : toute reservation passe par l entite unique, le prestataire n existe plus cote serveur (un ancien identifiant est accepte mais ignore). La disponibilite est calculee globalement. Aucun changement pour le paiement, le remboursement ou le planning. Limites : suppression definitive du champ prestataire reportee a M11B.

Portee transverse (backend + front + Vanilla). Suite M11B : nettoyage definitif du champ prestataire et endpoint de report admin.


## Sprint M11B — Finalisation calendrier global (rapports 201-202)

Le report (decalage) d un creneau est desormais possible directement depuis le planning, pour les admins. La reservation reste la meme (paiement inchange, aucun remboursement declenche), seul l horaire change. Toutes les creations de reservation passent par l institut unique ; le prestataire n existe plus cote serveur (un ancien identifiant est accepte mais ignore). Un script volontaire (jamais automatique) permet de consolider/archiver l heritage. Limites : suppression definitive des champs legacy reportee a une migration ulterieure ; pas de glisser-deposer ni de vue mois.

Portee transverse (backend + manager front). Le checkout (M11A) et le calendrier (M10) restent la source officielle ; M11B ferme la boucle report + cleanup.


## Sprint M12 — Customer 360 (rapports 203-204)

Un ecran unique pour tout savoir et tout faire sur un client (identite, achats, prestations, formations, produits, cartes cadeaux, remboursements, factures, documents, communications, notifications, timeline, finances) sans changer de page. Pense telephone, fluide, organise par cartes, sans tableau. Recherche rapide -> fiche. Limites : telephone/photo non encore stockes ; actions rapides = raccourcis vers les ecrans existants.


## Sprint P1 — Product Polish & UX (rapports 207-208)

Revue UX/UI transversale (aucune fonctionnalité métier). On crée @bs/ui/polish (focus, 44px tactile, anti-overflow, micro-interactions, primitives, presets motion) appliqué globalement + corrections sûres (nav active + sidebar responsive, fausse button vitrine corrigée, modale librairie en bottom-sheet mobile, lien dev manquant ajouté, cache TanStack Query). ProductUXGuideline.md devient la référence officielle avec une directive permanente (mobile-first + cohérence parfaite tel/desktop). Tout vert, zéro régression.
