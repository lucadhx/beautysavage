# API — Signers (P1, préparation)

> READ-ONLY. ✅ confirmé / 🟡 probable / ❓ Phase 2.

## Endpoints — ✅ confirmés (API Reference)

- ✅ GET `/signature_requests/{id}/signers` — lister
- ✅ POST `/signature_requests/{id}/signers` — créer un signataire
- ✅ GET `/signers/{signerId}` — récupérer
- ✅ PATCH `/signature_requests/{id}/signers/{signerId}` — mettre à jour
- ✅ DELETE `/signature_requests/{id}/signers/{signerId}` — supprimer
- ✅ POST `.../signers/{signerId}/send_otp` — envoyer un OTP
- ✅ POST `.../signers/{signerId}/sign` — **signer par API** (server-to-server)
- ✅ POST `.../signers/{signerId}/send_reminder` — relance manuelle
- ✅ POST `.../signers/{signerId}/identity_verification` — pré-vérif identité (AES)
- ✅ POST `.../signers/{signerId}/unblock_identification` — débloquer après mismatch
- ✅ GET `.../signers/{signerId}/verified_identity_proof/download` — preuve d'identité (PDF)
- ✅ GET `.../signers/{signerId}/audit_trails[/download]` — audit trail

## Request Body (🟡)

`info` : first_name, last_name, email, phone 🟡 ; `signature_level` (`electronic_signature`/`advanced_electronic_signature`/`qualified_electronic_signature`) ✅ ; `signature_authentication_mode` (otp email/sms/no-otp) ✅ ; visibilité documents (Pro/Scale) ✅. **Champs requis exacts ❓.**

## Statuts (✅)

`initiated, notified, verified, consent_given, processing, declined, signed, aborted, error`.

## Webhooks associés (✅)

`signer.notified/link_opened/done/declined/error/...`

## Cas d'usage LYCARZ

- 2 signers : garage + client, `signature_level=electronic_signature`, coordonnées issues du Lead.

## Compatibilité IA

- `addSigner`, `getSigners`, `getSignerStatus`, `getSignerAuditTrail`.

## Questions ouvertes

- ❓ phone obligatoire si OTP SMS ; comportement request si un signer `declined`.

> ### ✅ MISE À JOUR 2026-06-27 (API Reference live — `reference/get-signers-signersid-1`, `docs/manage-signature-link-delivery`)
> **Réponse Get a Signer — champ `signature_link` CONFIRMÉ** (résout QDS6).
> - L'objet **Signer** renvoie **`signature_link`** (URL de signature individuelle, ex. `https://yousign.app/signatures/…`) **et `signature_link_expiration_date`**.
> - **Disponible après `activate`** (avant = `null`). **Unique par signataire.** Validité **48 h** par défaut (1-72 h via support). **Régénération** : re-`GET` le signer après expiration.
> - Exposé en **`delivery_mode=none` ET `email`** ; essentiel pour `none` (envoi via Brevo).
> - Également présent dans la **réponse d'`activate`** (signers non ordonnés). Pour signers **ordonnés** → webhook **`signer.notified`** puis `GET signer`.
> - Pour les **Approvers**, le champ équivalent est **`approval_link`** (cf. `reference/get-signature_requests-signaturerequestid-approvers-approverid-1`).
> - **Champs signataire confirmés** (extrait) : `id`, `status`, `signature_link`, `signature_link_expiration_date`, `info{first_name,last_name,email,phone_number,locale}`, `signature_level`, `signature_authentication_mode`.
> - **TOUJOURS NON DOCUMENTÉ** : effet précis d'un `declined` sur la request globale ; champ `phone` obligatoire si OTP SMS.
