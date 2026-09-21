# Yousign — Signing Experience & Recipient Ordering (guide LYCARZ)

> READ-ONLY. Source : `customize-the-signature-experience`, `configure-recipient-ordering`, `manage-signature-link-delivery`, `using-iframe`. ✅ = confirmé.

## Description

✅ Quatre modes d'expérience de signature : **Custom Experience** (logo/couleurs + redirect), **Signature Portal** (hub multi-docs par email), **iFrame** (signature intégrée dans votre app), **Custom Flow** (UI 100 % maison).

## Concepts — Recipient ordering (✅, décisif pour V1)

- ✅ **Standard** (`custom_recipient_order = false`, défaut) : tous les approvers avant les signers ; `ordered_signers` / `ordered_approvers` (true = séquentiel, false = **simultané/parallèle**).
- ✅ **Custom** (`custom_recipient_order = true`) : séquence complète libre, approvers/signers interleavés ; `insert_after_id`, `group_with_id`.
- ✅ **Défaut** : ordre de création ; `insert_after_id=null` place au début.

## Capacités — delivery (✅)

- ✅ `delivery_mode` : `email` (Yousign envoie les liens) ou `none` (LYCARZ gère l'envoi).
- ✅ Lien unique par signataire, **valide 48 h par défaut** (ajustable 1-72 h sur demande).

## Limitations (✅)

- ✅ **AES/QES interdisent** iFrame et UI custom (signature simple SES seulement pour l'embarqué).
- ✅ iFrame a des **limitations** + **security settings** dédiés.

## Cas d'usage LYCARZ

- **V1 — signature SES, sans ordre** : `ordered_signers = false` ⇒ garage et client signent **en parallèle**, dans n'importe quel ordre. ✅ **Confirme la décision LYCARZ « V1 sans signatureOrder »** (CRM doc §32.1).
- **Delivery** : 🟡 deux options — (A) `delivery_mode=email` (Yousign envoie) ; (B) `delivery_mode=none` + LYCARZ envoie via **Brevo** (cohérent « module Email transversal », CDC Communication §3.0). **Recommandation : option B** pour garder l'identité d'envoi LYCARZ/garage et un seul canal email.
- **Retour post-signature** : `redirect-a-signer-at-the-end-of-the-signing-flow` → ramener le client dans LYCARZ.

## Impact CRM / Signatures

- ✅ Le mode **parallèle** mappe exactement le `DocumentSigningFlow` « parallèle » (§27.9) retenu V1.
- L'**iFrame** (V2) permettrait de signer **sans quitter LYCARZ** (cohérent « le vendeur ne quitte jamais LYCARZ »), mais **SES uniquement**.

## Impact IA

- `sendSignatureRequest`, `getSignatureLink` mappables. L'IA ne gère pas l'UI de signature (humain).

## Questions ouvertes

- ❓ Si `delivery_mode=none`, comment LYCARZ obtient-il les **liens de signature** par signataire (champ dans la réponse / endpoint) ? → API Reference (critique pour l'option B).
- ❓ iFrame : contraintes CSP / domaines autorisés (security settings) → guide iframe-security.

> ### ✅ MISE À JOUR 2026-06-27 (API Reference live)
> - **CONFIRMÉ / question résolue** : LYCARZ obtient les liens par signataire via le champ **`signature_link`** (objet **Signer**) — exposé dans la **réponse d'`activate`** et via **`GET /signature_requests/{id}/signers/{signerId}`**, **après activation**. Lien **unique par signataire**, **48 h** par défaut (`signature_link_expiration_date`), régénérable en **re-fetchant** le signer. **⇒ Option B (Mode B, envoi via Brevo) VIABLE dès la V1.** Détail : `api/signers.md` + `YOUSIGN_DELIVERY_AND_SIGNING_LINKS.md`.
> - iFrame CSP/domaines : **toujours non documenté ici** (V2, hors périmètre V1 SES email/none).
