# Product UX Guideline — Beauty Savage (référence officielle)

> Établie au Sprint P1 (Product Polish). **Référence obligatoire** pour tout nouveau développement front.
> Voir aussi la Motion Guideline (M9) et la couche `@bs/ui/polish/`.

## 0. Directive permanente

> **Toute nouvelle interface, composant ou fonctionnalité doit respecter la Product UX Guideline, la Motion
> Guideline et le principe « mobile-first ». Aucune nouvelle page ne peut être validée si elle n'offre pas une
> expérience équivalente sur téléphone et ordinateur, avec une cohérence visuelle et comportementale parfaite
> avec le reste du produit.**

Concrètement, une PR front n'est validable que si : tests + lint + typecheck + build verts ; aucune couleur
hex en dur (tokens `--bs-*`) ; focus visible ; cibles tactiles ≥ 44px ; pas de scroll horizontal en 320px ;
animations dérivées des tokens motion et coupées par `prefers-reduced-motion`.

## 1. Tokens (source unique)
Toujours consommer les variables `--bs-*` (`tokens.css`), jamais de valeurs en dur :
couleurs `--bs-color-*`, espacements `--bs-space-1..4`, `--bs-radius`, `--bs-shadow`, motion
`--bs-motion-fast|normal|slow` + easings, `--bs-z-*`, et (P1) `--bs-tap-target:44px`,
`--bs-motion-shimmer`, `--bs-icon-sm|md|lg`. Le `ThemeProvider` réécrit ces vars à l'exécution (scope
vitrine/panel) → ne jamais court-circuiter.

## 2. Composants — réutiliser avant de créer
Ordre de préférence : `@bs/ui` (`Button`, `Card`, `LoadingState`, `ErrorState`, `EmptyState`,
`SectionHeader`, catalogue…) → `@bs/ui/polish` (`Badge`, `Chip`, `IconButton`, `Skeleton`, `Spinner` +
classes `bs-badge|bs-chip|bs-skeleton|bs-message|bs-icon-btn|bs-device-btn`) → sinon composant feature.
**Ne pas ré-implémenter** un bouton/badge/chip/skeleton localement : utiliser les primitives partagées.

## 3. Accessibilité (non négociable)
- Focus visible (assuré globalement par `polish.css` — ne pas le retirer).
- Cibles tactiles ≥ 44px (`--bs-tap-target`) ; utiliser `IconButton`/`bs-icon-btn` pour les boutons icône.
- Tout bouton icône a un `aria-label` ; icônes décoratives `aria-hidden="true"`.
- `role`/`aria-live` sur les états (status/alert/busy) ; landmarks (`header/main/nav/footer`) ; skip-link.
- Contraste suffisant (tokens), états `:disabled` lisibles.

## 4. Responsive (mobile-first)
- Utilisable au pouce, sans zoom, sans scroll horizontal, sans perte d'info, de 320 à 1024px+.
- Pas de largeur fixe en px qui dépasse 320 ; grilles `1 → 2 → 3` colonnes ; `min-width:0` sur les colonnes
  flex pour éviter l'overflow. `overflow-x: clip` (jamais `hidden` au niveau document → casse `sticky`).
- Layout liste/empilable ; **jamais de `<table>`** (cards/grilles).
- Drawers : bottom-sheet en mobile, slide/centre en desktop.

## 5. Motion (Motion Guideline M9 + presets P1)
- Animations légères (opacity/transform), durées courtes (tokens), easing doux.
- Toujours conditionnées par `prefers-reduced-motion` (reset global déjà en place ; `motionPreset()`/
  `microTransition()` renvoient `''` en reduced-motion).
- Presets disponibles : entrée, sortie, drawer (sheet/slide), dialog, accordion, hover, press, loading
  (skeleton/spinner), success (pop), error (shake), toast, notification, badge.
- Micro-interactions pertinentes (press, copie, succès, publication, rollback, paiement) — **jamais excessif**.

## 6. Formulaires
Labels associés, `required`/optionnel explicites, messages d'erreur via `bs-message--error`, clavier mobile
(`type=email|tel`, `inputMode`, `autoComplete`), formats (téléphone/e-mail/montants/dates) cohérents.

## 7. Textes & icônes
Terminologie/casse/ponctuation cohérentes (Title Case titres & boutons, sentence case messages/vides ;
espace insécable avant `:` en français). Une seule librairie d'icônes (Bootstrap Icons `bi-*`), tailles via
`--bs-icon-*`, alignées et décoratives `aria-hidden`.

## 8. Navigation
État actif toujours visible (`NavLink` + `.bs-nav-link.active`/`[aria-current=page]`) → « vous êtes ici ».
Retour clair, deep-links cohérents, skip-link.

## 9. Performance
Cache TanStack Query raisonnable (retry 1, pas de refetch-on-focus, `staleTime`), lazy/dynamic import pour
les écrans lourds, `memo` ciblé, images dimensionnées. Aucune régression fonctionnelle.

## 10. Checklist de revue (à cocher pour toute nouvelle page/feature)
- [ ] Tokens `--bs-*` only (zéro hex) — `noHardcodedHex.test.ts` présent.
- [ ] Focus visible + cibles ≥ 44px + aria-labels + landmarks.
- [ ] 320/360/390/430/768/1024 : pas de scroll horizontal, utilisable au pouce.
- [ ] Motion via presets/tokens + reduced-motion respecté.
- [ ] Primitives partagées réutilisées (pas de duplication).
- [ ] États loading/empty/error fournis et cohérents.
- [ ] Tests + lint + typecheck + build verts.

## 11. Pattern officiel — `CatalogueModuleStepper` (C1)
Pattern d'édition de toute fiche catalogue (prestation, formation, cartes cadeaux). Modernise le système
Vanilla « onglets/icônes » (cf. rapport 209) en corrigeant son manque #1 : **aucun statut par module**.

**Structure** :
- **Header sticky** (`CatalogueStatusHeader`) : titre + badge de visibilité (brouillon/publié/archivé),
  **barre de progression** (modules complets / total), CTA `Enregistrer` toujours visible, accès au
  **drawer de validation**.
- **Stepper** (`CatalogueModuleStepper`) : modules en **chips horizontales scrollables (mobile)** /
  **rail vertical (desktop, ≥768px)**. Chaque module porte une **icône + point de statut** coloré
  (`complete` vert / `incomplete` orange / `error` rouge / `optional` gris) et un **chevron** sur le module
  actif (`aria-current="step"`).
- **Panneau** : le contenu du module actif (champs `CatField`/`cat-input`).
- **Drawer de validation** (`CatalogueValidationDrawer`) : bottom-sheet mobile / panneau desktop listant
  les **blocants (error)** et **recommandations (warning)**, chaque ligne navigue vers son module.

**Statut par module** : dérivé de fonctions pures (`validation.ts`) — jamais de logique métier dans le JSX.
`publishable = errorCount === 0`. La publication (vitrine active / statut publié) est **bloquée** tant que
des erreurs subsistent (`canSave` le reflète).

**Règles** : tokens `--bs-*` only (préfixe `cat-`), 44px, mobile-first 768px, zéro `<table>`, zéro hex,
`prefers-reduced-motion`, primitives `@bs/ui` réutilisées. Un **seul pattern calendrier** dans le produit :
les sessions présentielles réutilisent les cards/badges du Planning M10 (pas de calendrier divergent).

## 12. Patterns Learning (C2)
- **Lecteur apprenant** (`FormationPlayer`, vitrine) : mobile = vidéo en haut → « J'ai terminé » → leçon
  suivante (auto) → accordion chapitres en dessous ; desktop = navigation gauche (chapitres/leçons) +
  vidéo droite. Objectif **≤ 3 clics** pour ouvrir → lancer → terminer → continuer. Progression dérivée
  serveur (jamais localStorage). Confetti **uniquement** en fin de formation, **coupé en reduced-motion**
  (fallback texte `aria-live`).
- **Vidéo = embed only** (jamais d'upload) : utiliser `LessonEmbed`/`resolveEmbed` (`@bs/ui`) —
  YouTube/Vimeo/Loom/Wistia/iframe, preview immédiate, validation d'URL.
- **Édition pédagogique** (`ChapterEditor`, manager) : accordion de chapitres ; une leçon ouvre un
  **drawer** (réutiliser le pattern drawer C1). Pas d'écran complexe : chapitre → leçon → drawer → preview.
- **Scan QR présence** : `html5-qrcode` (open-source, aucun service externe), import dynamique (n'embarque
  la lib que si le scanner est ouvert), caméra arrière, anti-rebond. Token **opaque** par participant.
- **Pas de nouvelle app cliente** : l'expérience apprenant vit dans l'app **vitrine** authentifiée
  (`features/learning/`), pas dans une `apps/client` (réutiliser plutôt que créer un nouveau pattern).

## 13. Patterns Learning Completion (C3)
- **Scan QR présence** (`QrScanner`) : états explicites (init/scanning/denied/error), **choix caméra** si
  plusieurs, **fallback saisie manuelle toujours disponible**, debounce anti double-scan, vibration mobile,
  bouton recommencer. Le token reste **opaque** et n'est **jamais affiché en clair** après validation (seul
  le nom du participant). Caméra via import dynamique (lazy).
- **Reorder mobile-first** : boutons **monter/descendre** (pas uniquement drag) — zéro dépendance lourde.
  Le drag desktop reste optionnel.
- **Attestation** : bouton « Télécharger l'attestation » visible uniquement à **100%** ; lien direct
  authentifié (cookie same-origin) vers l'endpoint qui stream le PDF. Le PDF V1 est rendu en pdfkit (pas de
  HTML pixel-perfect).
- **Modération avis** : la vitrine n'affiche que les avis **publiés** ; cards (zéro table), filtres par
  statut + compteurs, actions Publier/Masquer/En attente.

## 14. Dette UX systémique à corriger (audit RC1 — rapports 219-220)
Patterns identifiés sur les écrans manager, à corriger en priorité :
- **Jamais d'erreur masquée en vide** : tout écran de liste/donnée DOIT distinguer `error` de `empty`
  (un backend down ne doit jamais afficher « Aucun… »). Brancher `status === 'error'` → `<ErrorState/>`.
- **Confirmation obligatoire sur action destructive** (suppression, annulation-remboursement, maintenance).
- **Feedback de succès** (toast / `aria-live`) sur toute mutation — ne jamais « sembler ne rien faire ».
- **Garde unsaved** dans les éditeurs (draft local) avant navigation.
- **Pas d'enum ingénieur** exposé à l'utilisateur (traduire statuts/types en libellés FR).
- **Pas de champ mort** : tout champ éditable doit être persisté (ex. corrigé : `trailerVideoUrl`).

## 15. Directive permanente — React est le frontend officiel (RX1)
À partir de RX1, **toute nouvelle fonctionnalité se développe exclusivement en React** (Vanilla = compat/
rollback/migration, jamais cible d'évolution). Chaque écran migré DOIT respecter :
- **Mobile-first** : l'expérience téléphone est la référence (utilisable à une main, bottom-sheet, safe-area,
  44px, reachability).
- **Moins de clics** : simplifier chaque parcours (drawer/cards/actions contextuelles plutôt que formulaires).
- **Réutilisation des patterns** : un seul calendrier (M10), un seul drawer, un seul stepper (CatalogueModule
  Stepper), un seul langage visuel (tokens `--bs-*`), états loading/empty/error/success cohérents.
- **Premium** : s'inspirer de Stripe, Linear, Notion, Qonto, Planity — **pas** d'un logiciel de gestion
  traditionnel ; **pas de gros tableaux** (cards/timeline/graphes/badges/résumés).
- **Zéro régression fonctionnelle** : React ne doit jamais offrir moins que Vanilla.
- **Servir** : vitrine sous `/app`, manager sous `/manager` (flag `REACT_OFFICIAL_FRONTEND`, rollback OFF).

## 16. Primitives partagées `@bs/ui` (RX3)

RX3 a promu dans `@bs/ui` des primitives jusque-là dupliquées par feature. **Réutiliser ces primitives
avant d'en recréer** (rappel §2). Import unique depuis `@bs/ui`.

- **`Drawer`** — LE drawer produit (bottom-sheet mobile / side-panel desktop). Escape + clic scrim,
  `role="dialog"` `aria-modal`, verrou de scroll, `footer` d'actions, `side='right'|'left'`. Remplace les
  ré-implémentations locales (`c3-drawer`, `fin-tl-drawer`, etc.) pour toute NOUVELLE UI. Animé via
  `motionPreset('drawer')` (neutralisé en reduced-motion).
- **`StickyBar`** — barre CTA collée (sticky), safe-area ; `desktopInline` pour rester dans le flux d'un
  aside desktop. Pattern « sticky CTA mobile » officiel (fiches, checkout).
- **`FormField` / `TextInput` / `TextArea` / `Select` / `Checkbox`** — formulaires harmonisés (label lié,
  `aria-invalid` + `role="alert"`, hint→error, ≥44px, focus visible). Ne plus utiliser d'`<input>`/
  `<select>` bruts dans les nouveaux écrans.
- **`Gallery`** — image principale + vignettes (clavier, `aria-current`). Remplace le `photos[0]` unique
  des fiches.
- **`Accordion`** (RX3 S2) — accordéon partagé accessible (bouton + region, `aria-expanded/controls`,
  clavier, `motionPreset('accordion')`, mode simple/multiple). LE composant pour FAQ + sections repliables
  (remplace le `<details>` brut). Ne plus réimplémenter d'accordéon local.

**Checkout multi-item (RX3 S3)** — patterns officiels du parcours d'achat :
- Le **panier** porte des lignes typées (`ServiceCartItem` / `FormationCartItem`) ; les prix sont **indicatifs**,
  le backend recalcule tout. Bumper `CART_VERSION` à tout nouveau kind/champ.
- **Légal par item** : `buildLegalRequirements(items)` dérive les cases (CGV + waivers) ; textes de renonciation
  **identiques au backend** (validation par correspondance). Ne jamais reformuler un texte de waiver.
- **Carte cadeau = moyen de paiement** (jamais une remise) : code masqué, solde/utilisé/reste toujours affichés,
  capée au solde réel. Toujours montrer Total / Carte cadeau utilisée / Reste à payer.
- **Disponibilité dynamique** : revalider les créneaux/sessions (endpoints existants), marquer « Non disponible »
  et bloquer le paiement — jamais laisser payer un article indisponible.
- Paiement : **0 €** → `finalize-free` ; **> 0 €** → Stripe hosted (redirect). Aucun Stripe.js React. Résumé
  sticky desktop + `StickyBar` mobile.

## 17. Patterns Espace client / Client Hub (RX4)

L'espace client (`/mon-compte/*`, `apps/vitrine`) doit **raconter la relation** cliente↔institut, pas
ressembler à un back-office. Répondre immédiatement aux 7 questions (prochain RDV, formation, carte cadeau,
facture, remboursement, attestations, notifications). **Cards partout, jamais de tableau, jamais de jargon.**

- **Namespace données `@bs/api-client/client/`** — tout endpoint *client-facing* (`/api/client/*`) vit ici
  (`bookings`, `giftCards`, `sales`, `profile`), séparé du `manager/` (admin). Réutiliser avant d'étendre.
- **`features/account/`** — hooks TanStack partagés (`useMyBookings/GiftCards/Sales`…) : le cache évite les
  refetch entre dashboard et sous-pages. Helpers de sélection/formatage **purs et testés** dans `format.ts`
  (jamais de logique métier dans le JSX).
- **`AccountShell`** — coquille commune des sous-pages : garde d'auth (`loading`/non connecté/contenu) +
  en-tête retour 44px. Toute nouvelle sous-page compte l'utilise (zéro duplication du motif).
- **Dashboard = agrégat, pas menu** — l'accueil montre l'essentiel *résolu* (prochain RDV daté, % formation,
  solde carte) avec CTA contextuel, puis un accès rapide en grille. Le `highlight` accent (dégradé
  `--theme-accent`) est réservé à l'info #1 (prochain RDV).
- **Données sensibles masquées par défaut** — code/mot de passe de carte cadeau **jamais affichés** sans
  révélation explicite (bouton « Afficher le code »). **Aucune notion d'expiration** de carte cadeau
  (règle métier M13/RX2.6).
- **Honnêteté > complétude** — ne jamais inventer une donnée absente du backend. Si un endpoint client
  manque (notifications, liste remboursements, coordonnées institut), réserver l'emplacement (« Bientôt »)
  ou renvoyer vers la source légitime, et **documenter la limite** dans le rapport. `/auth/me` n'expose pas
  le prénom → accueil déduit (session/e-mail), pas de faux nom.
- `practitionerId`/prestataire = legacy institut mono-entité (M10/M11) → **ne pas mettre en avant** en compte.

### 17.1 Parcours d'écriture (RX4 S2)
- **Actions dans un Drawer, jamais de popup native** (`window.confirm`/`alert` interdits). Un parcours
  d'écriture destructif (annulation) se déroule *dans* le drawer détail : `detail → confirmation (conséquences
  + montant estimé) → loading → succès → refresh`. Réutiliser `Drawer` @bs/ui + invalidation TanStack pour le
  refresh (pas de reload manuel). Référence : `BookingDetailDrawer`.
- **Boutons contextuels only** : n'afficher une action que si le backend l'autorise (RDV à venir non annulé →
  `Annuler` ; `saleId` → `Facture`). **Jamais de bouton inactif inutile.**
- **Le serveur calcule, le client affiche** : éligibilité/montant de remboursement viennent de
  `GET …/refund-eligibility` (motifs `retractation`/`institut`/`none`) ; ne jamais recalculer un montant ni
  inventer un statut. Après une action asynchrone (remboursement, avis), message **honnête** sur la suite
  (« suivi par e-mail », « publié après vérification » pour la modération C3).
- **Note interactive** : `PawInput` (@bs/ui) — LE sélecteur de note (avis). Ne pas réimplémenter d'étoiles.
- **Discipline endpoint** : créer un endpoint backend **seulement s'il est indispensable** à un parcours (ex.
  `GET /api/client/profile`, lecture seule). Sinon **réutiliser / adapter / documenter**. Ne jamais créer un
  endpoint qui renverrait toujours vide (ex. notifications client — le moteur ne cible pas l'audience client).
- **`CatalogueToolbar`** (vitrine `features/catalog/`) + logique pure `applyCatalogueQuery` — barre
  recherche/tri/filtre **partagée** entre prestations/formations/produits. Le tri/filtre actif est
  TOUJOURS visible ; filtrage d'une liste déjà chargée (aucun N+1, aucun fetch par carte).

### 17.2 Parcours tokenisés / lien e-mail sans compte (RX4 S3)
- **Layout autonome** : les pages ouvertes depuis un lien e-mail (`/decision`, `/decision/report`,
  `/refund-tracking/:token`) vivent **hors `PublicLayout`** (pas de nav storefront) — colonne unique centrée
  (`TokenFlowLayout`), note de sécurité (lien personnel à usage unique). Pas d'auth (accès par **token
  opaque**) ; le token n'est **jamais journalisé** côté client.
- **Options réelles only** : n'afficher une option de décision que si le backend la déclare (`flow.options.*`).
  **Jamais de bouton fantôme** ; un flux déjà utilisé/expiré → écran dédié **rassurant** (jamais technique).
- **Statuts = vérité serveur** : mapper **uniquement** les statuts réels (remboursement
  `requested|pending|succeeded|failed|canceled` ; split `not_applicable|pending|succeeded|failed|
  rollback_needed`). **Ne jamais inventer** un statut absent. Split Stripe/carte cadeau affiché tel que calculé.
- **Réutiliser le calendrier** : un report de prestation réutilise `AvailabilityCalendar`/`SlotPicker`/
  `SelectedSlotSummary` — **jamais un second calendrier**. Anti-double-booking + texte de renonciation =
  **validés côté serveur** (ne pas dupliquer la logique métier ; afficher proprement un 400/409).
- **Pas de second moteur** : réutiliser `session-cancel-flows` et `refund-tracking` ; ne créer aucun endpoint
  qui duplique un moteur d'annulation/remboursement existant.

## 18. Comptes manager, invitations & reset mot de passe (RX-BLOCKER-2)
- **Le dev ne choisit jamais de mot de passe** : la création d'un compte manager (`/manager/users`, **dev-only**)
  n'a **aucun champ mot de passe** — l'utilisateur le définit via un **lien tokenisé** reçu par e-mail. Le
  drawer l'affiche explicitement (« l'utilisateur recevra un e-mail pour définir son mot de passe »).
- **Cards, jamais de tableau** : la liste des comptes = cards (nom, rôle, statut `Invitation envoyée / Actif /
  Désactivé`), actions inline (renvoyer l'invitation, activer, désactiver). Mobile-first.
- **Pages d'auth autonomes** : invitation (`/manager/invitation/:token`), mot de passe oublié
  (`/manager/mot-de-passe-oublie`), reset (`/manager/reinitialiser-mot-de-passe/:token`) vivent **hors**
  `ManagerLayout` (pas de nav gestion) — coquille `ManagerAuthShell`, colonne centrée, tokens `--bs-*` (zéro hex).
- **Token = accès, jamais affiché** : un token opaque n'est **jamais** rendu à l'écran ni journalisé côté client.
  Un lien invalide/expiré/utilisé → écran **rassurant** dédié (jamais d'erreur technique), avec action de repli
  (redemander un lien / aller à la connexion).
- **Pas de second moteur d'auth/mail** : le reset manager réutilise **exactement** `/auth/password-reset/*`
  (mêmes `validate`/`complete` que le client) ; c'est le **backend** qui route l'expéditeur selon le rôle
  (manager → support, client → commerciale). Le front ne connaît qu'un endpoint.
- **Politique mot de passe partagée** : ≥8 caractères, au moins une lettre et un chiffre — parité stricte avec
  le backend (`passwordError` dans `ManagerAuthShell`).

## 19. Finitions RX-POLISH-BLOCKER
- **Aucune route produit ne doit déboucher sur un faux vide** : un `ComingSoon` n'est acceptable que
  s'il apporte un diagnostic utile, un prochain pas concret, ou s'il redirige vers la vraie surface.
  Une route de navigation existante ne doit jamais finir sur une page vide générique.
- **Un seul langage visuel pour les avis** : `PawRating` / `PawInput` sont les composants officiels.
  Les étoiles visibles (`★`, `☆`, `bi-star*`) sont interdites dans les interfaces avis Beauty Savage.
- **Un seul calendrier produit** : le planning manager doit rester un calendrier horaire réel, avec
  heures visibles, zones fermées grisées, blocages, aujourd'hui, et détail booking. Les réglages
  disponibilités/exceptions doivent alimenter cette même surface, pas un deuxième calendrier divergent.
- **Parcours hors démo invisibles par défaut** : si une capacité backend existe mais n'est pas prête pour
  le produit (ex. réservation manuelle prestation), elle doit être retirée des CTA et raccourcis manager
  standards plutôt que laissée visible mais ambiguë.
- **Montants de booking backend only** : les récapitulatifs `Total / Acompte / Reste` viennent des données
  serveur, jamais d'un recalcul front.
