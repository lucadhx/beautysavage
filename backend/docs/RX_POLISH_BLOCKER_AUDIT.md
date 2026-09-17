# RX POLISH BLOCKER Audit

Branche: `phase-0-security-baseline`

Objectif: corriger les incohérences UX visibles dans le manager, le planning, les avis et le panel dev sans régression.

## 0. Synthèse

Les problèmes bloquants étaient concentrés sur cinq axes:

1. la navigation manager mélangeait pages parents et sous-pages finance;
2. le planning n'était pas un vrai calendrier horaire et n'exposait pas les réglages de disponibilité;
3. la réservation manuelle de prestation restait visible alors qu'elle devait sortir du périmètre démo;
4. les avis étaient limités aux formations, avec un rendu hétérogène et une modération incomplète;
5. plusieurs routes dev affichaient encore des écrans "Bientôt disponible" sans diagnostic utile.

## 1. Manager Sidebar

Écran
Sidebar manager desktop et drawer mobile.

Problème
Finance semblait active même quand l'utilisateur ciblait Ventes ou Remboursements. La structure parent/enfant n'était pas visible.

Cause
Navigation plate dans `ManagerLayout.tsx` avec redirections historiques `/ventes` et `/remboursements` vers des pages finance sans synchronisation d'état précis.

Correction UX
Introduire un groupe Finance expansible avec sous-liens visibles:
Vue d'ensemble, Timeline, Ventes, Remboursements, Commissions, Cartes cadeaux.

Correction technique
Remplacer les liens plats par un groupe contrôlé par l'état local, avec activation enfant basée sur `pathname + search`.

Tests
Actif sur `/finance`, `/finance/timeline?type=sale`, `/finance/timeline?type=refund`, `/finance/commissions` et fermeture du drawer mobile au clic.

## 2. Routes Finance

Écran
Redirections `/ventes`, `/remboursements`, `/reservations`.

Problème
Les routes historiques menaient vers des destinations trop générales, ce qui brouillait l'intention utilisateur.

Cause
`/ventes` redirigeait vers `/finance/timeline` sans filtre et `/remboursements` vers `/finance`.

Correction UX
Faire correspondre chaque entrée historique à la vue cible exacte.

Correction technique
Rediriger vers `/finance/timeline?type=sale`, `/finance/timeline?type=refund` et `/planning`.

Tests
Tests de navigation finance et de sidebar groupée.

## 3. Pages Vente / Commissions / Remboursements / Timeline

Écran
Dashboard finance, timeline financière, commissions.

Problème
La timeline ne lisait pas ses filtres depuis l'URL, donc les sous-liens finance ne pouvaient pas refléter un état actif fiable.

Cause
`FinanceTimelinePage.tsx` stockait `period` et `type` uniquement en état local.

Correction UX
Rendre la timeline adressable et partageable par URL.

Correction technique
Lire et écrire `period` et `type` via `useSearchParams`, puis aligner les cartes d'action finance sur ces URLs.

Tests
Initialisation depuis `?type=sale`, refetch sur changement de période/type, navigation depuis le dashboard.

## 4. Planning Actuel

Écran
Page planning manager.

Problème
Le planning affichait des cartes jour/semaine mais pas un vrai calendrier horaire avec heures, zones fermées et créneaux bloqués.

Cause
`PlanningPage.tsx` reposait sur `MobileDayAgenda` et `WeekView` en mode liste.

Correction UX
Basculer vers une grille horaire jour/semaine avec repères d'heures, événements positionnés, zones fermées grisées, créneaux bloqués visibles et légende.

Correction technique
Construire une time-grid front basée sur les items du calendrier global et sur les disponibilités hebdomadaires/exceptions chargées via API manager.

Tests
Vue jour, vue semaine, zones grisées, zone bloquée, ouverture du drawer détail.

## 5. Disponibilité Prestations

Écran
Paramètres planning / disponibilités et exceptions.

Problème
Aucune UI manager reliée au planning hebdomadaire et aux exceptions journalières.

Cause
Le backend `availabilityController.js` existait mais n'était pas branché côté React manager.

Correction UX
Ajouter un panneau de disponibilité dans le planning pour éditer les horaires par jour et les exceptions ponctuelles.

Correction technique
Créer un client API manager pour:
`GET /schedule/me`, `PUT /schedule/:practitionerId`, `GET /exceptions/:practitionerId`, `POST/PUT/DELETE /exceptions`.

Tests
Sauvegarde du planning hebdomadaire, création d'exception, conflits visibles, lecture du calendrier institut.

## 6. Réservation Manuelle

Écran
Customer 360 et raccourcis manager.

Problème
Le parcours "Réserver une prestation" restait visible alors qu'il devait sortir du périmètre manager démo.

Cause
Quick action Customer 360 et drawer `ManualBookingDrawer`.

Correction UX
Supprimer tout bouton visible et tout raccourci manager vers cette action.

Correction technique
Retirer l'entrée quick action, le type de drawer associé et le montage du drawer côté page.

Tests
Absence du bouton "Réserver" dans Customer 360.

## 7. Page Avis Manager

Écran
`ReviewModerationPage`.

Problème
La modération est limitée aux statuts et aux formations, sans filtre par type ni création manuelle.

Cause
Modèle `Review` couplé à `formationId`, page manager simple, pas de formulaire de création.

Correction UX
Refondre en page premium avec filtres par statut et type, puis création manuelle contrôlée.

Correction technique
Étendre le modèle review pour gérer `service | formation`, auteur manuel, métadonnées internes et création manager.

Tests
Filtrage par type/statut, création manuelle, modération.

## 8. Avis Vitrine

Écran
Fiche formation, fiche prestation, compte client.

Problème
Les avis publics existent pour les formations mais pas pour les prestations. Le rendu reste hétérogène.

Cause
Routes publiques formation seulement et `Review` lié à `formationId`.

Correction UX
Afficher les avis sur les prestations et homogénéiser les composants de notation.

Correction technique
Ajouter des endpoints publics service reviews, des stats, la création/modération associée, puis réutiliser les composants vitrine existants.

Tests
Stats et liste d'avis sur prestation, aucun rendu d'étoile dans les zones avis.

## 9. Dev Panel

Écran
`/dev`, `/dev/contrats`, `/dev/commissions`, `/dev/integrated-api`, `/dev/event-logs`, `/dev/webhook-failures`.

Problème
Plusieurs routes dev renvoyaient encore vers des "Bientôt disponible" vides.

Cause
Pages non branchées malgré des endpoints diagnostics déjà disponibles (`/api/gestion/dev/events`, `/webhook-failures`, `/send-logs`, `/commissions/*`).

Correction UX
Remplacer tout écran vide par une vraie page, une redirection utile ou un diagnostic contextualisé.

Correction technique
Créer des vues read-only pour événements, webhooks, API intégrée et réglages commissions si le backend existe; sinon rediriger vers la meilleure surface réelle.

Tests
Absence d'écran ComingSoon vide sur les routes dev ciblées.

## 10. Tous les "Bientôt disponible"

Écran
Routes manager/dev non branchées.

Problème
Le produit donne une impression inachevée quand une route existe sans contenu exploitable.

Cause
Placeholders laissés comme destination finale au lieu de relais temporaires.

Correction UX
Un placeholder n'est acceptable que s'il explique clairement l'état réel, la donnée disponible et l'action suivante.

Correction technique
Auditer chaque route et choisir une stratégie:
page réelle, redirection, ou diagnostic utile.

Tests
Parcours dev/manager sans page vide bloquante.

## 11. Statut de mise en œuvre à ce stade

Déjà engagé:

- sidebar finance groupée avec état actif précis;
- redirections finance historiques corrigées;
- retrait du bouton de réservation manuelle côté manager;
- timeline finance pilotée par URL;
- planning manager converti en grille horaire avec panneau de disponibilités/exceptions;
- validation backend des conflits planning sur horaires et exceptions.

Restant majeur:

- refonte complète des avis manager/vitrine;
- PawRating partout;
- correction des routes dev encore vides;
- rapport final et mises à jour documentaires transverses.
