# RX4 — Rapport Client Hub Session 2 (Écriture & Parcours Client)

> Branche `phase-0-security-baseline`. Travail parallèle, staging sélectif. Cadrage :
> [`RX4_CLIENT_HUB_WRITE_AUDIT.md`](RX4_CLIENT_HUB_WRITE_AUDIT.md). Suite de la Session 1
> ([`RX4_CLIENT_HUB_REPORT.md`](RX4_CLIENT_HUB_REPORT.md)).

## Objectif
Rendre le Client Hub **actif** : la cliente peut désormais agir (annuler un rendez-vous avec remboursement
estimé, laisser un avis, gérer son profil sur données réelles), sans jargon, peu de clics, mobile-first,
**jamais de popup native** (drawers). Le backend reste l'autorité ; on ne recrée aucune logique métier.

## Endpoint backend ajouté (le strict minimum)
**`GET /api/client/profile`** (`clientController.js` `getProfile` + `clientRouter.js`) — lecture seule,
renvoie `{ ok, user:{ firstName, lastName, email } }` (miroir de ce que renvoie déjà `PUT`). Justification :
`/auth/me` n'expose pas le prénom et aucun `GET` profil n'existait → l'accueil reposait sur un hack
localStorage (S1). Zéro logique métier, zéro donnée sensible. Test : `tests/p1/clientProfile.test.js` (3 cas).
**Aucun autre endpoint créé** (cf. décisions ci-dessous).

## Parcours livrés

### Mes rendez-vous interactifs + drawer détail (P2/P3)
- Chaque card ouvre un **`BookingDetailDrawer`** premium (date, heure, durée, options, total, acompte, reste à
  régler, statut, facture). Réutilise `Drawer` @bs/ui.
- **Annulation intégrée au drawer** (jamais de popup native) : `Annuler` → conséquences + **remboursement
  estimé** (`GET …/refund-eligibility`, motifs `retractation`/`institut`/`none`) → `Confirmer l'annulation` →
  loading → **succès** (« remboursement lancé, suivi par e-mail » ou « aucun remboursement ») → **refresh
  automatique** (invalidation TanStack). Backend : `POST …/cancel` crée le `RefundRequest` + déclenche
  l'exécution + e-mails côté serveur.
- Boutons **contextuels uniquement** : `Facture` si `saleId`, `Annuler` si RDV à venir non annulé. Aucun bouton
  inactif inutile.

### Avis formation (P7)
- **`ReviewDrawer`** sur les formations **terminées** (« Mes formations ») : note (**`PawInput`**, nouvelle
  primitive interactive @bs/ui) + commentaire → **prévisualisation** (`PawRating`) → envoi → confirmation
  honnête (« publié après vérification » — modération C3). Gère le **409** (« déjà laissé un avis »).
  Backend : `POST /api/client/formations/:id/review` (formations only).

### Profil sur données réelles (P8)
- « Mon profil » préremplit désormais via `GET /api/client/profile` (fin du hack localStorage) ; l'accueil du
  dashboard utilise le vrai prénom. Édition prénom/nom (PUT) + reset mot de passe (flux e-mail).

### Documents / remboursement (P5/P10)
- Documents (factures + attestations) : livrés en S1, inchangés. Remboursement : **confirmation post-annulation
  + suivi par e-mail** (pas de liste client — cf. limites). Aucun statut inventé.

## Primitive partagée ajoutée
`PawInput` (`@bs/ui`, `catalog.tsx` + `tokens.css`) — sélecteur de note interactif (1..5 pattes, clavier,
`role=radiogroup`, ≥44px). Réutilise le glyphe `Paw` existant (zéro duplication).

## Décisions « ne pas créer » (discipline endpoint)
- **Report d'un RDV actif** : aucun endpoint client direct ; le report n'existe que via le **flux tokenisé
  post-annulation** (`session-cancel-flows`, landing e-mail) ou côté manager. → **Aucun bouton « Reporter »
  factice.** Candidat RX4 S3 (landing decision-flow, réutilisant `availability/{days,slots}`).
- **Notifications client** : le modèle `Notification` cible **admin/dev uniquement** (`targetRole` enum, moteur
  M8 n'émet rien pour les clients). Un `GET /api/client/notifications` serait **toujours vide/403**. → **Non
  créé** (respecte « jamais d'endpoint au cas où »). Prérequis : émettre des notifications d'audience client
  (chantier backend).

## Vérifications
- **Frontend** : typecheck OK · **411 tests** (99→102 fichiers ; +13 S2) · lint 0 erreur (2 warnings
  pré-existants) · build vitrine+manager OK.
- **Backend** : `GET /api/client/profile` testé (3 cas) ; suite complète relancée (aucune régression — additif :
  1 route GET + 1 handler lecture seule).
- **Secret scan** : aucun secret/token/donnée sensible ajouté (code/mot de passe carte cadeau masqués côté UI).

## Limites (honnêteté)
- Report hub impossible (endpoint tokenisé e-mail only) → S3.
- Notifications client vides par conception → non livrées.
- Remboursement : pas de liste ; suivi e-mail (token) → confirmation post-annulation seulement.
- Profil : prénom/nom/e-mail (schéma `User` sans téléphone/adresse/consentements).
- Avis : formations only, un par user, statut de modération non lisible côté client.

## Prochaine session recommandée — RX4 S3
1. **Landing decision-flow** (report/refund/gift-card post-annulation) en React : consommer les
   `session-cancel-flows/:flowId` tokenisés (email) + `availability/{days,slots}` → vrai report client.
2. **Suivi remboursement** React sur `GET /api/refund-tracking/:token` (page dédiée, states Stripe/GC/timeline).
3. Selon décision backend : **notifications client** (faire émettre le moteur en audience client) + profil
   enrichi (téléphone/adresse/consentements → extension `User` + `PUT`).
