# RX3 Session 2 — Audit des fiches produit premium (Prestations & Formations)

> PARTIE 1 de RX3 Session 2. Branche `phase-0-security-baseline`, travail parallèle, staging sélectif,
> aucun empiètement RX2.x Finance. **Front-only** (règle héritée de Session 1) : les endpoints publics
> existants peuvent être consommés (y compris ceux non encore câblés en React) ; **aucun** changement backend.
>
> Question directrice de chaque décision : *une cliente qui découvre Beauty Savage comprend-elle en < 5 s ce
> qu'elle peut acheter et comment le réserver ?* Si non → simplifier avant d'ajouter.

## 0. Synthèse & contraintes backend (vérifiées)

| Donnée | Disponible ? | Conséquence fiche |
|---|---|---|
| Prestation : `photos[]` | ✅ | **Galerie** (Gallery RX3) |
| Prestation : `options[] {id,name,description,price?}` | ✅ **prix seul** | Sélection options = **impact prix** ; **PAS d'impact durée** (backend ne le fournit pas) → ne rien inventer |
| Prestation : `duration`, `effectivePrice`, `paymentType`, `capacity`, `isBookable` | ✅ | Hero, badges, FAQ dérivée de données réelles |
| Prestation : disponibilité `/availability/{days,slots}` | ✅ | Réservation (réutiliser `AvailabilityCalendar`/`SlotPicker`) |
| **Prestation : avis** | ❌ **inexistant** (avis = formation only) | **PAS de section avis sur les prestations** — documenter la limite |
| Formation : `photos[]`, `coverImage`, `trailerVideoUrl`, `editorialHtml`, `salesCount`, `type` | ✅ | Hero, galerie/vidéo, contenu, trust « N inscrits » |
| Formation : `options[]` (présentiel) | ✅ prix | Options présentées (prix) |
| Formation **sessions** présentiel `/formations/:id/sessions` | ✅ backend **mais AUCUN wrapper api-client** | **Ajouter un wrapper front-only** mappant SEULEMENT les champs sûrs |
| Formation : **modules/chapitres** (distanciel) publics | ❌ (auth client only) | **Ne pas fabriquer** de liste de modules ; contenu = `editorialHtml`/vidéo |
| Formation **achat** (checkout React) | ❌ **NON câblé** (cart/checkout = service-only) | **Pas de bouton d'achat fictif** ; présentation + sessions + avis ; wiring achat = prochaine session |
| Avis formation `/formations/:id/reviews[/stats]` | ✅ | Réutiliser `TrainingReviews` |

⚠️ **Privacy** : le payload sessions backend inclut un objet `qr { token, payload, … }` (orienté admin) même
sur la route vitrine. Le wrapper front **ne mappera JAMAIS** `qr`/`instructorName` — uniquement date/durée/
places/disponibilité.

## 1. Prestation — Vanilla vs React

### Vanilla (`serviceDetailModule.js`, 398 l.)
Galerie (thumb→principale), « À propos », **options/suppléments** (prix), politique d'annulation ; aside
sticky H1 + prix + badge paiement + **CTA « Réserver »** + praticiennes. Réservation via modale calendrier.
Défauts (audit Session 1) : CTA désactivé par défaut pour les connectés (🔴), section praticiennes +
`practitionerId` = code mort, galerie sans swipe, erreur générique.

### React actuel (`ServiceDetailPage.tsx`)
Une `Card` : `photos[0]` (pas de galerie), name/durée/prix/desc, puis `ServiceBookingPanel` (calendrier +
slot + « ajouter au panier », **`selectedOptions: []` hardcodé** → options non implémentées). Pas de sticky
CTA, pas de déroulement, pas de FAQ, pas de similaires.

### Verdict prestation
| Élément | Verdict |
|---|---|
| Galerie | **AMÉLIORER** — `Gallery` RX3 (swipe mobile, thumbs desktop) |
| Aside sticky prix + CTA | **AMÉLIORER** — card sticky desktop / `StickyBar` mobile, ≤2 clics |
| Options | **AMÉLIORER** — sélection réelle (checkbox + prix), feed `selectedOptions` + prix indicatif |
| Réservation | **CONSERVER** — réutiliser `AvailabilityCalendar`/`SlotPicker` dans un **Drawer** |
| Déroulement | **AJOUTER** — « Comment se déroule votre rendez-vous » (étapes génériques, honnêtes) |
| FAQ | **AJOUTER** — `Accordion`, dérivée de **données réelles** (paiement, durée, confirmation) |
| Avis | **SUPPRIMER de la cible** — inexistant backend, ne pas afficher |
| Praticiennes / `practitionerId` | **SUPPRIMER** — code mort (institut mono-entité) |
| Prestations similaires | **AJOUTER** — cards catalogue (scroll horizontal mobile / grille desktop) |

## 2. Formation — Vanilla vs React

### Vanilla (`itemDetailModule.js`, 1208 l.)
Hero (prix, PawRating cliquable, sessions présentiel + auto-sélection, **CTA panier + achat**, trust) →
description → avis → galerie/vidéo. Défauts : dead code, mojibake, note/blocage affichés 3×, description
courte+complète redondantes, `editorialHtml` sans sanitize.

### React actuel (`TrainingDetailPage.tsx`)
`Card` : cover, name, type, prix, `editorialHtml` (dangerouslySetInnerHTML), `TrainingReviews`. **Pas de
session picker présentiel, pas de CTA achat, pas de vidéo, pas de similaires.**

### Verdict formation
| Élément | Verdict |
|---|---|
| Hero (titre/prix/badges type+inscrits/CTA) | **AMÉLIORER** |
| Galerie + vidéo trailer | **AMÉLIORER** — `Gallery` + `LessonEmbed` |
| Sessions présentiel | **AJOUTER** — wrapper api-client front-only + cards (date, durée, places restantes, dispo) |
| Contenu / « ce que vous apprendrez » | **AMÉLIORER** — `editorialHtml` sanitizé sous un titre clair ; **pas** de liste d'objectifs inventée |
| Modules distanciel | **DIFFÉRER** — non exposés public ; ne pas fabriquer |
| Avis | **CONSERVER** — `TrainingReviews` (déjà OK) |
| **Achat** | **DIFFÉRER (documenté)** — checkout React service-only ; CTA honnête, pas de faux bouton ; wiring = prochaine session |
| Formations similaires | **AJOUTER** — cards catalogue |

## 3. Composants réutilisés (aucune recréation)
- `@bs/ui` RX3 S1 : `Gallery`, `Drawer`, `StickyBar`, `FormField`/`Checkbox`, `CatalogueCard`, `PawRating`,
  `Badge`, `Chip`, `LessonEmbed`, `Card`, états, `motionPreset`.
- **Nouveau (extrait cette session)** : `Accordion` (`@bs/ui`) — remplace le `<details>` brut du Player,
  sert FAQ + sections repliables.
- Réservation prestation : `AvailabilityCalendar` + `SlotPicker` + `SelectedSlotSummary` + hooks
  `useServiceAvailableDays/Slots` (inchangés), présentés dans un `Drawer`.
- Avis : `TrainingReviews` (inchangé).
- Catalogue similaires : `usePublicServices` / `usePublicTrainings` + `CatalogueCard`.

## 4. Limites assumées (à traiter en sessions suivantes)
1. **Achat formation non câblé** en React (cart/checkout service-only) → **prochaine session prioritaire**.
2. **Avis prestation** : pas de backend → absents (ne pas fabriquer).
3. **Modules distanciel** non exposés public → contenu = éditorial/vidéo, pas de liste de modules.
4. **Options** : impact prix uniquement (pas de durée) — présenté tel quel.
5. Déroulement + FAQ : contenu générique/dérivé de données réelles, non éditable au panel (→ RX4 contenu éditable).

## 5. Ordre d'exécution
1. `Accordion` `@bs/ui` (+ CSS + test). 2. Wrapper api-client `getFormationSessions` (safe fields).
3. Fiche prestation premium (gallery + sticky CTA + options + booking drawer + déroulement + FAQ + similaires).
4. Fiche formation premium (hero + sessions + contenu + avis + similaires). 5. Tests/build/lint/typecheck.
6. Docs + commit.
