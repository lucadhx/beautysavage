# API — Webhooks (P1, le mieux confirmé)

> READ-ONLY. ✅ confirmé sur `use-webhooks-in-your-app` + `failure-and-retry-policy` + `webhooks`.

## Endpoints — ✅ confirmés (API Reference)

- ✅ GET `/webhooks` — lister les subscriptions
- ✅ POST `/webhooks/subscriptions` — **créer** une subscription
- ✅ GET `/webhooks/{webhookId}` — récupérer
- ✅ PATCH `/webhooks/{webhookId}` — mettre à jour
- ✅ DELETE `/webhooks/{webhookId}` — supprimer

**Events confirmés (catalogue exhaustif)** — cf. `YOUSIGN_API_REFERENCE_INDEX.md` §9. Pivots V1 : `signature_request.done`, `signer.done`, `signer.link_opened`, `signature_request.declined/expired/canceled`. (À noter : `signature_request.paused` / `.resumed` existent aussi.)

## Sécurité (✅, prêt à implémenter)

- ✅ Header signature : **`x-yousign-signature-256`** = `sha256=` + HMAC-SHA256(raw body, secret).
- ✅ Headers : `x-yousign-retry`, `x-yousign-issued-at`, `Content-Type: application/json`.
- ✅ HTTPS obligatoire, pas de cert auto-signé, pas d'IP privée.
- ✅ IP allowlist : `57.130.41.144/28`, `51.38.96.112/28`, `5.39.7.128/28`, `52.143.162.31`, `51.103.81.166`.

## Payload (✅)

`{ event_id, event_name, event_time, subscription_id, subscription_description, sandbox, data }`.

## Retry (✅)

- Jusqu'à **8 retries** (backoff 2min→2j). Succès = **2xx/3xx**. Timeout 1ʳᵉ tentative **1 s**, retries **10 s**. Dédup via `event_id`.

## Cas d'usage LYCARZ

- ✅ **Réutiliser le pattern Stripe/Multi-Diffusion** : route raw-body avant `express.json()`, vérif HMAC, `WebhookEvent` dédoublonnage, ACK <1 s + traitement async (queue).
- Events pivots : `signature_request.done`, `signer.done`, `*.declined/expired/canceled`.

## Compatibilité IA

- Les webhooks alimentent la timeline → `checkSignatureStatus` sans polling.

## Questions ouvertes

- ✅ **Résolu** : création subscription = `POST /webhooks/subscriptions`.
- ❓ Rotation du secret webhook (procédure) → Phase 2.
- ⚠️ Le timeout 1 s première tentative est strict → ACK immédiat obligatoire (traitement async).
