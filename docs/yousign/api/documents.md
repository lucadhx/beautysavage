# API — Documents (P1, préparation)

> READ-ONLY. ✅ confirmé / 🟡 / ❓ Phase 2.

## Endpoints — ✅ confirmés (API Reference)

- ✅ GET `/signature_requests/{id}/documents` — lister
- ✅ POST `/signature_requests/{id}/documents` — **ajouter** (multipart/form-data, draft only) → `documentId`
- ✅ GET `.../documents/download` — télécharger tous les documents
- ✅ GET `.../documents/{documentId}` — récupérer
- ✅ GET `.../documents/{documentId}/download` — **télécharger** (PDF signé final)
- ✅ PATCH `.../documents/{documentId}` — mettre à jour
- ✅ DELETE `.../documents/{documentId}` — supprimer
- ✅ POST `.../documents/{documentId}/replace` — **remplacer** un document
- ⚠️ `POST /documents` (upload hors request) = **DEPRECATED** → ne pas utiliser.

## Request Body (✅ partiel)

- ✅ `multipart/form-data`, **Base64 refusé** ; nature **`signable_document`|`attachment`** ; PDF 1.6+ form-fillable pour signable.
  ⚠️ **`signable` n'existe pas** — voir le correctif 2026-07-16 en bas de page.

## Limites (✅)

- 50 MB/doc, 50 docs/request, Smart Anchors ≤150 pages (vs <50, ❓ à réconcilier).

## Webhooks associés

- Indirects (via signature_request).

## Cas d'usage LYCARZ

- Upload du PDF `DocumentVersion` (DMS §31) comme signable ; pièces dossier en attachment.

## Compatibilité IA

- `uploadDocumentToSignature`, `downloadSignedDocument`.

## Questions ouvertes

- ✅ **Résolu** : download du PDF signé final = `GET .../documents/{documentId}/download`.
- 🟡 Format exact de la réponse d'upload (champs du `documentId`) → Phase 2.

> ### ✅ MISE À JOUR 2026-06-27 (API Reference live — `docs/document-1`, `docs/limits-new`, `docs/fields-creation-with-smart-anchors`)
> - **Formats signables CONFIRMÉS** : **PDF** et **DOCX** ; les **DOCX/PNG/JPEG sont convertis en PDF à l'upload** (seul le PDF est stocké côté Yousign). Documents déjà signés = **PDF 1.6+** ; pièces jointes = tout PDF.
> - **`parse_anchors` CONFIRMÉ** : à l'ajout d'un document (`POST .../documents`), `parse_anchors: true` active la détection des **Smart Anchors** ; la réponse renvoie **`total_anchors`** (nb d'ancres détectées ; sur document `sealed`, seules les ancres Signature sont comptées).
> - **`nature`** : ~~`signable | attachment | sealed` (confirmé)~~ — **FAUX, corrigé le 2026-07-16** (voir ci-dessous). Limites : **50 docs/request**, **50 Mo/doc**, Smart Anchors ≤ **150 pages**.
> - **Replace** : `POST .../documents/{id}/replace` confirmé (effet sur les ancres/fields après remplacement = **NON DOCUMENTÉ**).

> ### ❌➜✅ CORRECTIF 2026-07-16 (vérifié en sandbox RÉELLE, pas sur doc)
> La mise à jour du 2026-06-27 affirmait `nature: signable | attachment | sealed`
> « (confirmé) ». **C'était faux, et le code l'a suivi** : `nature: 'signable'`
> provoquait un `400` à chaque upload en sandbox.
>
> **Valeurs réelles** (API Reference « Add a Document to a Signature Request »,
> et appel sandbox à l'appui) : **`signable_document`** | **`attachment`**.
> Il n'existe **ni `signable`, ni `sealed`** sur ce multipart (les *Electronic
> Seal Documents* passent par le corps `application/json`, pas par `nature`).
>
> Réponse littérale de la sandbox à `nature=signable`, le 2026-07-16 :
> ```json
> {"type":"parameters_not_valid",
>  "detail":"You have some invalid params in your payload.",
>  "invalid_params":[{"name":"nature",
>    "reason":"Value must be in [\"attachment\", \"signable_document\"]."}]}
> ```
> Le même appel avec `nature=signable_document` renvoie **201** et le document.
>
> **Leçon** : « confirmé » dans un audit interne ne vaut pas un appel réel. Le
> champ est désormais figé dans `DOCUMENT_NATURE` (yousign.provider.js) et
> couvert par un test. Détail complet : [YOUSIGN_REAL_SANDBOX_FIX_REPORT.md](../../YOUSIGN_REAL_SANDBOX_FIX_REPORT.md).
