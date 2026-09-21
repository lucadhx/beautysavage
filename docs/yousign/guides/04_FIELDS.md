# Yousign — Fields (guide LYCARZ)

> READ-ONLY. Source : `developers.yousign.com/docs/fields`, `field-creation-with-api-endpoints`, `fields-creation-with-smart-anchors`, `read-only-text`. ✅ = confirmé.

## Description

✅ Les **Fields** sont des éléments dynamiques placés sur un document pour capturer l'input d'un signataire ou afficher du contenu dynamique. Chaque field est lié à **un signataire** et **un document**.

## Concepts — 8 types de champs (✅)

| Type | Rôle |
|---|---|
| **Signature** | Capture la signature (le plus courant). |
| Signature Date | Date de signature. |
| Mention | Texte non éditable. |
| Initials | Initiales sur toutes les pages. |
| Text | Saisie libre du signataire. |
| **Read-Only Text** | Information non éditable affichée. |
| Checkbox | Sélection binaire. |
| Radio Group | Choix unique. |

## Capacités — placement (✅)

- **Smart Anchors** : motifs texte intégrés au document (Word/Google Docs) ; Yousign détecte et remplace par des fields.
- **API Endpoints** : positionnement exact par **coordonnées** (page, x, y) via endpoint dédié.

## Limitations

✅ **500 fields** max par request (hors Initials). ❓ La page ne précise pas quels fields sont obligatoires ni les limites de coordonnées.

## Cas d'usage LYCARZ

- **Signature garage** + **Signature client** : 2 champs `Signature`.
- **Read-Only Text** : **clé pour LYCARZ** — injecter les données du dossier déjà rendues dans le PDF (prix, VIN, nom client). Mais : comme LYCARZ génère **déjà** le PDF avec ces données (DMS §31 + Field Registry), les `read-only` Yousign sont **redondants** → on les utilise peu ; le contenu vient du PDF généré.
- **Checkbox** : acceptation de CGV éventuelle.

## Impact CRM / Documents

- **Décision recommandée** : LYCARZ rend tout le contenu via son **Document Field Registry** (§31.5) dans le PDF ; Yousign n'ajoute que les **champs interactifs** (signatures, éventuelles cases). On évite de dupliquer la logique de variables côté Yousign.

## Impact Signatures

- Le placement par **coordonnées API** est le plus déterministe pour un PDF généré (positions connues). Les Smart Anchors nécessitent d'insérer des marqueurs dans le rendu.

## Impact IA

- Action future `placeSignatureFields` (mappée sur des positions définies par template LYCARZ). Configurable côté Panel (DocumentTemplate).

## Questions ouvertes

- ❓ Coordonnées : repère (origine coin haut/bas ?), unité (points PDF ?) → API Reference Phase 2.
- ❓ Champs obligatoires minimaux pour valider une signature (au moins 1 Signature par signer ?).

> ### ✅ MISE À JOUR 2026-06-27 (API Reference live — `docs/fields-creation-with-smart-anchors`, `docs/fields`, `docs/limits-new`)
> **Smart Anchors — syntaxe CONFIRMÉE** (était « ❓ NON DOCUMENTÉE »). Ce sont des **placeholders texte** insérés dans le document, parsés par Yousign à l'**activation**.
> - **Syntaxe** : `{{signer_index|field_type|width|height|…}}`. Exemples documentés :
>   - Signature : `{{s1|signature|85|37}}` → forme complète `{{signer_index|signature|width|height|layout|date_time_format|show_timezone|show_signer_email}}`.
>   - Texte : `{{signer_index|text|max_length|width|height|question|instruction|optional|name}}`.
>   - Types possibles : signature, text, checkbox (et autres champs).
> - **Lien signataire** : par l'**index** `s1`, `s2`… (1ᵉʳ, 2ᵉ signer). Une ancre référençant un signer inexistant **échoue silencieusement**.
> - **Activation** : à l'upload du document, mettre **`parse_anchors: true`** ; la réponse renvoie **`total_anchors`** (nombre d'ancres détectées).
> - **Format/PDF — CONFIRMÉ** : documents signables = **PDF, DOCX** ; DOCX/PNG/JPEG sont **convertis en PDF à l'upload** (seul le PDF est stocké). **Donc PDF supporté**, et les ancres sont scannées sur le PDF.
> - **Contraintes** : ≤ **50 Mo**, ≤ **150 pages**, **ancre sur une seule ligne**, police recommandée **Arial 10-14 px**, **couleur = fond** pour masquer l'ancre.
> - **Unité coordonnées** : `width`/`height` en **pixels** (signature min 85×37 px, max 2000×1000 px) ⇒ **unité = px CONFIRMÉE**.
> - **TOUJOURS NON DOCUMENTÉ** : **origine** du repère coordonnées (coin haut/bas), comportement avec **ancres dupliquées**, **remplacement** de document après parsing, et **détection sur PDF généré depuis HTML** (techniquement attendue si l'ancre est du **vrai texte sélectionnable** — à valider en sandbox).
