# Yousign — Documents (guide LYCARZ)

> READ-ONLY. Source : `developers.yousign.com/docs/document-1`, `limits-new`. ✅ = confirmé.

## Description

✅ Un **Document** est un fichier attaché à une Signature Request, de nature **signable**, **attachment** (consultable non signé) ou **sealed** (cachet réutilisé).

## Concepts & Capacités

✅ **Formats acceptés** :
- Signables : **PDF ou DOCX**.
- Attachments : PDF, DOCX, JPEG, JPG, PNG.
- DOCX/PNG/JPEG sont **auto-convertis en PDF** à l'upload.

✅ **PDF signable** : version **1.6+**, doit autoriser modifications + remplissage de formulaire, non protégé par mot de passe (lors d'un remplacement).
✅ **Upload** : `multipart/form-data` (POST), **Base64 non accepté**, request en `draft`. Le document reçoit un `documentId`.

## Limitations

✅ Taille max **50 MB** par document. ✅ **50 documents** max par request. ✅ Smart Anchors limités à **<50 pages** (et ≤150 pages selon limits — à réconcilier, cf. guide 13). ✅ Un document déjà signé ne peut pas contenir de champs non-signature.

## Cas d'usage LYCARZ

- Le **PDF généré par le DMS** (§31.3 `GeneratedDocument` / §31.4 `DocumentVersion`) est uploadé comme document **signable**.
- Pièces du dossier (carte grise reprise, etc.) → **attachments** si à joindre à la signature.

## Impact CRM / Documents

- ✅ LYCARZ génère ses PDF (moteur documentaire §31, Field Registry) ; Yousign **reçoit un PDF fini**. Pas besoin des Templates Yousign pour le contenu (LYCARZ garde la maîtrise du rendu).
- Le PDF envoyé correspond à **une version précise** (§28.7). Yousign le fige.

## Impact Signatures

- Le placement des champs se fait soit par **coordonnées API** (guide 04), soit par **Smart Anchors** (texte ancré dans le PDF généré). LYCARZ pourrait insérer des ancres lors de la génération (Field Registry).

## Impact IA

- Action future `uploadDocumentToSignature` (à partir d'un `DocumentVersion`). Lecture-seule du PDF signé via `downloadSignedDocument`.

## Questions ouvertes

- ❓ Limite Smart Anchors : `<50 pages` (doc) vs `150 pages` (limits) — à clarifier en Phase 2.
- ❓ Le PDF généré LYCARZ respecte-t-il PDF 1.6+ form-fillable ? → à tester (dépend du moteur de rendu).
