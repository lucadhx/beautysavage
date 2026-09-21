# API — Fields (P1, préparation)

> READ-ONLY. ✅ confirmé / 🟡 / ❓ Phase 2.

## Endpoints — ✅ confirmés (API Reference)

- ✅ GET `.../documents/{documentId}/fields` — lister les champs
- ✅ POST `.../documents/{documentId}/fields` — **créer un champ** (coordonnées)
- ✅ DELETE `.../documents/{documentId}/fields/{fieldId}` — supprimer
- ✅ UPDATE/PATCH `.../documents/{documentId}/fields/{fieldId}` — mettre à jour
- ✅ POST `/signature_requests/{id}/documents/{id}/fields/{id}/answer` — répondre à un champ (texte/checkbox/radio)

## Types (✅)

`signature, signature_date, mention, initials, text, read_only_text, checkbox, radio_group` (8).

## Request Body (🟡)

- Coordonnées : `page`, `x`, `y`, `width`, `height` 🟡 ; `signer_id`, `document_id` ✅ (chaque field lié à 1 signer + 1 doc) ; repère/unité ❓.

## Limites (✅)

- 500 fields/request (hors Initials).

## Cas d'usage LYCARZ

- 2 champs `signature` (garage, client) positionnés par coordonnées définies dans le `DocumentTemplate` LYCARZ. Contenu data = rendu dans le PDF (Field Registry), pas via read_only Yousign.

## Compatibilité IA

- `placeSignatureFields` (positions depuis template LYCARZ).

## Questions ouvertes

- ❓ Système de coordonnées (origine, unité) ; champs minimaux requis.

> ### ✅ MISE À JOUR 2026-06-27 (API Reference live — `docs/fields`, `docs/signature-field`, `docs/fields-creation-with-smart-anchors`)
> - **8 types de fields CONFIRMÉS** : `signature`, `signature_date`, `mention`, `initials`, `text`, `read_only_text`, `checkbox`, `radio_group`.
> - **Coordonnées** : `page`, `x`, `y`, `width`, `height`, `signer_id`. **Unité = pixels CONFIRMÉE** (signature `width` 85→2000 px, `height` 37→1000 px). **Origine du repère (haut/bas) TOUJOURS NON DOCUMENTÉE** → à valider sandbox **si** la voie coordonnées est utilisée.
> - **Voie alternative — Smart Anchors (CONFIRMÉE)** : placement **sans coordonnées** via ancre texte `{{signer_index|type|width|height|…}}` (ex. `{{s1|signature|85|37}}`), `parse_anchors:true` à l'upload, `total_anchors` en réponse, scan à l'activation. PDF/DOCX supportés (tout converti en PDF). Contraintes : ≤150 pages, ancre 1 ligne, police Arial 10-14 px, couleur=fond. Détail : `guides/04_FIELDS.md` (MàJ 2026-06-27) + `YOUSIGN_SMART_ANCHORS.md`.
> - **Implication LYCARZ** : les **Smart Anchors évitent l'incertitude sur l'origine des coordonnées** → voie recommandée pour les PDF générés (le bloc Signature LYCARZ devient une ancre texte). Coordonnées = repli pour manipulation visuelle / PDF externe.
