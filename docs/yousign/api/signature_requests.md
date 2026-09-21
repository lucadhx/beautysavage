# API — Signature Requests (préparation, P1)

> READ-ONLY. ✅ confirmé / 🟡 probable / ❓ à confirmer Phase 2 (API Reference live + Postman).

## Endpoint(s) — ✅ confirmés (API Reference)

- ✅ GET `/signature_requests` — lister
- ✅ POST `/signature_requests` — **initier** (draft)
- ✅ GET `/signature_requests/{id}` — récupérer
- ✅ PATCH `/signature_requests/{id}` — mettre à jour
- ✅ DELETE `/signature_requests/{id}` — supprimer
- ✅ POST `/signature_requests/{id}/activate` — **activer** (draft → ongoing)
- ✅ POST `/signature_requests/{id}/cancel` — annuler
- ✅ POST `/signature_requests/{id}/reactivate` — réactiver une request expirée

## Description

Objet pivot. Cycle : create draft → attach documents/signers/fields → activate → suivre via webhooks → done.

## Request Body (🟡 partiel)

Champs confirmés/évoqués (✅ partiels) : `name` 🟡, `delivery_mode` (`email`|`none`) ✅, `workspace` (workspaceId) ✅, `email_notification` ✅, `custom_recipient_order` ✅, `ordered_signers`/`ordered_approvers` ✅, `expiration_date` 🟡 (≤1 an). **Liste complète ❓.**

## Response (❓)

Structure exacte ❓ — au minimum `id`, `status`. À confirmer Phase 2.

> ### ✅ MISE À JOUR 2026-06-27 (API Reference live — `reference/post-signature_requests-1`, `.../activate-1`, `docs/notification-managed-by-yourself-1`)
> - **Body — précisions CONFIRMÉES** : `name` (requis, 1-128), `delivery_mode` (**requis**, `email|none`), `ordered_signers`, `ordered_approvers`, `custom_recipient_order`, `expiration_date` (`yyyy-mm-dd`, ≤ 1 an, pas dans le passé), `reminder_settings`, `timezone`, `external_id`, `custom_experience_id`, `audit_trail_locale`, `archiving`. `documents[]` (UUID, **≤ 5 à la création directe** — distinct de la limite globale **50 docs/request**), `signers[]` (seulement si documents ajoutés en même temps).
> - **Réponse `activate` — CONFIRMÉE** : contient le tableau **`signers`** avec, par signataire, **`signature_link`** + **`signature_link_expiration_date`** (signers **non ordonnés** = tous les liens d'un coup ; ordonnés = 1ᵉʳ seulement, suite via webhook `signer.notified`). **⇒ résout QDS6.** Détail : `api/signers.md` (MàJ 2026-06-27).
> - **Sous-ressources confirmées** (navbar API Reference) : **Approver**, **Follower**, **Metadata** (GET/POST/PUT/DELETE), **Signer Document Request**, en plus de Signer/Document/Field. Cf. `YOUSIGN_API_REFERENCE_INDEX.md`.

## Erreurs / Idempotence

- ✅ Pages d'erreurs : `/reference/errors-1`, `/reference/list-of-errors` (catalogue d'erreurs à extraire Phase 2).
- ❓ Header d'idempotence : non confirmé (à vérifier — important pour éviter les doublons de signature côté retries d'agent).

## Pagination / Filtres

- ✅ Cursor `after`, `limit≤100` sur les listes ; filtres `❓` (cf. `/docs/filters`).

## Limites

- ✅ Expiration ≤1 an ; 50 docs / 100 signers / 500 fields (guide 13).

## Webhooks associés (✅)

`signature_request.activated/done/declined/rejected/expired/canceled/deleted/reactivated/...`

## Cas d'usage LYCARZ

- 1 request par `GeneratedDocument` (dossier véhicule), `delivery_mode=none` (envoi via Brevo), `ordered_signers=false` (V1 parallèle), `workspace` = org.

## Compatibilité IA

- `createSignatureRequest`, `activateSignatureRequest`, `checkSignatureStatus`, `cancelSignatureRequest` (Service Layer LYCARZ).
