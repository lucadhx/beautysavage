# Yousign — Webhooks (guide LYCARZ)

> READ-ONLY. Source : `developers.yousign.com/docs/webhooks`, `use-webhooks-in-your-app`, `failure-and-retry-policy`, `subscription`. ✅ = confirmé.

## Description

✅ Yousign envoie une requête **HTTP POST** vers votre endpoint quand un événement survient. Subscriptions configurées par : événements à écouter, **environnement** (sandbox/prod), URL cible.

## Concepts — événements (✅)

- **Signature Request** (~10) : `activated`, `approved`, `canceled`, `declined`, `deleted`, `done`, `expired`, `permanently_deleted`, `reactivated`, `reminder_executed`, `automatic_reminder_executed`, `rejected`.
- **Signer** (~11) : `declined`, `done`, `error`, `identification_blocked`, `identification_failed`, `identification_expired`, `identification_succeeded`, `identity_saved`, `link_opened`, `notified`, `sender_contacted`, `notification_delivery_failed`.
- **Approver** (4) : `approved`, `notified`, `rejected`, `notification_delivery_failed`.
- Autres : contact, document verification, electronic seals, user, workflow sessions, applicants.

## Capacités — sécurité (✅, critique)

✅ **Headers** : `x-yousign-signature-256` (**HMAC SHA-256** du corps brut), `x-yousign-retry`, `x-yousign-issued-at`, `Content-Type: application/json` (case-insensitive).
✅ **Vérification** : récupérer le secret webhook (app Yousign) → HMAC SHA-256 du **corps brut** → préfixer `sha256=` → comparer à `x-yousign-signature-256`. **Hasher le payload brut, pas parsé.**
✅ **Payload** : `event_id`, `event_name`, `event_time`, `subscription_id`, `subscription_description`, `sandbox`, `data`.
✅ **Sécurité réseau** : HTTPS obligatoire, certs auto-signés interdits, **IP allowlist** : `57.130.41.144/28`, `51.38.96.112/28`, `5.39.7.128/28`, `52.143.162.31`, `51.103.81.166`.

## Limitations — retry (✅)

✅ Jusqu'à **8 retries** (`auto_retry` activé) ; backoff : 2 min, 6 min, 30 min, 1 h, 5 h, 18 h, 1 j, 2 j. Si `auto_retry` off : 1 seul retry si timeout initial.
✅ **Succès** = réponse **2xx/3xx**. **Timeout** : 1ʳᵉ tentative **1 s**, retries **10 s**. >2 redirections = échec.
✅ **Déduplication** via `event_id`. Traiter **asynchrone** après ACK rapide (<1 s).

## Cas d'usage LYCARZ

- Webhooks pivots V1 : `signature_request.done` (document signé → MAJ statut LYCARZ), `signer.done` (récupérer audit trail individuel), `signature_request.declined`/`expired`/`canceled`.
- Mapping vers événements LYCARZ : `document.signed_by_client`, `document.completed`, `document.refused`, `document.expired` (CRM doc §8.2).

## Impact CRM / Signatures

- ✅ **Pattern identique à Stripe/Multi-Diffusion** : route raw-body **avant** `express.json()`, vérif HMAC, dédoublonnage via `WebhookEvent` (modèle LYCARZ existant). **Réutilisable tel quel.**
- ✅ Cohérent avec `ISignatureProvider.parseWebhook` (CRM doc §9.6).

## Impact IA

- Les webhooks alimentent la **timeline** (`LeadEvent`) et permettent à l'IA de `checkSignatureStatus` sans polling.

## Questions ouvertes

- ❓ Le timeout 1 s sur la 1ʳᵉ tentative est **serré** → impose un ACK immédiat + traitement asynchrone (queue). À cadrer dans l'archi LYCARZ (déjà compatible : pattern `AdPublicationJob`).
- ❓ Rotation du secret webhook → procédure à confirmer.
