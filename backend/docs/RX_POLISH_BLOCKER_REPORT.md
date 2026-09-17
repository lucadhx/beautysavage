# RX-POLISH-BLOCKER Report

Branche: `phase-0-security-baseline`

Date: `2026-07-08`

Audit source: `docs/RX_POLISH_BLOCKER_AUDIT.md`

## Objectif

Fermer les incoherences UX qui donnaient une impression de produit non fini sur le manager, le planning, les avis et le panel dev, sans regression metier.

## Livre

### 1. Sidebar manager et routes finance

- La navigation manager expose maintenant un vrai groupe `Finance` expansible avec sous-liens visibles:
  `Vue d'ensemble`, `Timeline`, `Ventes`, `Remboursements`, `Commissions`, `Cartes cadeaux`.
- L'etat actif est porte par le sous-lien cible; le parent reste ouvert sans ecraser l'etat enfant.
- Les routes historiques sont alignees sur l'intention produit:
  `/ventes` -> `/finance/timeline?type=sale`
  `/remboursements` -> `/finance/timeline?type=refund`
  `/reservations` -> `/planning`
- Le drawer mobile ferme correctement au clic.

### 2. Planning manager reel

- Le planning manager n'est plus une simple liste: il utilise une vraie grille horaire jour/semaine.
- Les reservations et formations presentiel sont positionnees sur des creneaux horaires.
- Les zones fermees, les creneaux bloques, le jour courant et la disponibilite institut sont visibles dans la meme surface.
- Le detail d'une reservation ouverte depuis le calendrier affiche maintenant:
  `Total`, `Acompte paye`, `Reste a payer`.
- Les montants viennent du backend uniquement.

### 3. Disponibilites hebdomadaires et exceptions

- Le manager peut configurer les horaires hebdomadaires par jour, avec plusieurs plages ou un jour ferme.
- Les exceptions ponctuelles sont gerees via une UI branchee au backend:
  fermeture complete, blocage d'un creneau, reouverture exceptionnelle.
- Le backend reste autoritaire sur les conflits:
  pas d'effacement de reservation existante, pas de reouverture d'un creneau deja reserve.

### 4. Reservation manuelle retiree de l'UX manager

- Le parcours visible de reservation manuelle de prestation a ete retire de l'UI manager et du Customer 360.
- Le backend n'a pas ete supprime; il reste disponible comme capacite hors demo/futur si besoin.

### 5. Avis premium manager + vitrine

- Le modele `Review` supporte maintenant les avis `formation` et `service`.
- La moderation manager gere:
  `publies`, `en attente`, `refuses`, `prestation`, `formation`.
- Un avis manuel peut etre cree sans faux client, avec `displayName`, note, commentaire optionnel et source interne `manual_institute`.
- La vitrine expose aussi les avis publics de prestation avec stats et liste.
- Les avis manuels ne deviennent publics que s'ils sont publies.

### 6. PawRating partout

- Le langage visuel des avis est unifie autour de `PawRating` et `PawInput`.
- Les zones avis manager/vitrine reliees a ce chantier n'affichent plus d'etoiles visibles.

### 7. Dev panel utile

- Les routes dev ciblees n'aboutissent plus a des pages vides `Bientot disponible`.
- `/dev`, `/dev/integrated-api`, `/dev/event-logs`, `/dev/webhook-failures` affichent des surfaces reelles ou des diagnostics utiles.
- Les routes partagees admin/dev conservent leur acces manager, tandis que les diagnostics strictement dev restent proteges.

## Tests ajoutes

### Backend

- `tests/p1/planningAvailabilitySettings.test.js`
- `tests/p1/planningDayExceptions.test.js`
- `tests/p1/reviewManualCreation.test.js`
- `tests/p1/managerDevPanelRoutes.test.js`

### Frontend

- `frontend-react/apps/manager/src/features/planning/managerPlanningCalendar.test.tsx`
- `frontend-react/apps/manager/src/features/planning/managerPlanningAvailability.test.tsx`
- `frontend-react/apps/manager/src/features/planning/bookingDetailAmounts.test.tsx`
- `frontend-react/apps/manager/src/features/devPanel/devPanelNoEmptyComingSoon.test.tsx`
- `frontend-react/apps/vitrine/src/features/account/pawRatingEverywhere.test.tsx`
- Mises a jour des suites `reviews`, `serviceDetail`, `finance`, `layout`, `api-client`.

## Limites restantes

- Certaines pages manager secondaires hors perimetre du blocker peuvent encore utiliser des placeholders explicites si aucun backend utile n'existe encore.
- Le backend de reservation manuelle est conserve mais volontairement retire des parcours manager standards.
- Le rapport de validation finale depend des suites larges executees apres cette livraison.
