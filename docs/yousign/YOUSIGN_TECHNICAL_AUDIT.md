# Yousign — Audit technique pour LYCARZ

> READ-ONLY. ✅ confirmé / 🟡 probable / ❓ inconnu. Sources : guides 06, 09, 10, 13 + pages environments/api-keys/pagination/retry.

## 1. API

- ✅ **REST/JSON, API v3**. Méthodes GET/POST/PATCH/PUT/DELETE.
- ✅ Base URLs : prod `https://api.yousign.app/v3`, sandbox `https://api-sandbox.yousign.app/v3`.
- ✅ Pagination **cursor** (`after`, `limit≤100`, `meta.next_cursor`).
- ❓ Idempotence (header dédié ?) — **à confirmer** (critique pour éviter doubles signatures).

## 2. Authentification

- ✅ `Authorization: Bearer {apiKey}`.
- ✅ Clé **liée à un environnement** (prod **ou** sandbox).
- ✅ Scope **organisation** ou **workspace** ; permissions full/read-only ; max 200 clés/org.

## 3. Environnements

- ✅ **Sandbox** : signatures **non contraignantes légalement**, documents **watermarkés**, vérifs simulées ; **30 req/min, 200/h** ; interdit E2E auto/batch/load.
- ✅ **Production** : nécessite abonnement actif + contact commercial.
- ✅ **Isolation** stricte des ressources entre env ; sauf « Common Domain » (API Keys, Users, Webhooks) partagés mais write restreint en sandbox trial.

## 4. Webhooks (✅, prêt)

- ✅ HMAC SHA-256 `x-yousign-signature-256` (préfixe `sha256=`, raw body).
- ✅ 8 retries (2min→2j), succès 2xx/3xx, timeout 1s/10s, dédup `event_id`, IP allowlist.
- ✅ **Pattern Stripe/Multi-Diffusion réutilisable** (raw-body avant `express.json()`, `WebhookEvent`).

## 5. Rate limits / résilience

- ✅ Sandbox 30/min. ❓ **Prod : chiffre exact manquant** (page dédiée non extraite). À confirmer Phase 2.
- ✅ Timeout webhook 1 s première tentative → **ACK immédiat + traitement async obligatoire**.
- 🟡 Disponibilité : « plusieurs millions de signatures/mois » traités (introduction) → plateforme à l'échelle ; SLA exact ❓.

## 6. Multi-tenant

- ✅ **Workspaces** = isolation par organisation (conçu ISV). Clé scopable workspace.
- **Recommandation** : 1 compte Yousign LYCARZ + 1 workspace par `Organization` + clé **org-level** (workspace par appel).

## 7. Intégration dans `IntegratedApi` LYCARZ

> Audit du modèle réel `models/IntegratedApi.js` (déjà fait pour Brevo) : tokens AES-GCM par `(role, runtime)`, `runtimeModel: single|dual_environment`, `mode: test|prod`, `getApiCredentials(slug,{role,runtime})`, fallback env.

### Recommandation Yousign

| Paramètre IntegratedApi | Valeur Yousign | Justification |
|---|---|---|
| `slug` | `"yousign"` | |
| `runtimeModel` | **`dual_environment`** | ✅ Yousign a des **clés distinctes sandbox/prod** (≠ Brevo clé unique) → **comme Stripe**. |
| Tokens | `api_key` (runtime test) + `api_key` (runtime prod) + `webhook_secret` (×2) | Bearer + HMAC. |
| `mode` | `test`|`prod` | Bascule via panel (comme Stripe). |
| `scope` | `platform` | 1 compte LYCARZ ; workspace par appel. |
| `baseUrl` | sélectionné par runtime | sandbox vs prod URLs. |
| Boot | `initYousignFromIntegratedApi()` (pattern `stripe.service.js`) + fallback `YOUSIGN_API_KEY` | identique Stripe Wave 5.2. |

## 8. Comparaison Stripe / Brevo / CarVertical → modèle cohérent

| Critère | Stripe | Brevo | CarVertical 🟡 | **Yousign** |
|---|---|---|---|---|
| Clés test/prod séparées | ✅ oui | ❌ non (1 clé) | 🟡 | ✅ **oui** |
| `runtimeModel` reco | `dual_environment` | `single` | 🟡 | **`dual_environment`** |
| Auth | Bearer | `api-key` header | 🟡 | **Bearer** |
| Webhooks HMAC | ✅ | ✅ | — | ✅ |
| Sandbox dédié | ✅ | partiel | 🟡 | ✅ (URL distincte) |
| Multi-tenant | compte unique | senders/sub-accounts | 🟡 | **workspaces** |

> **Conclusion** : Yousign suit le **modèle Stripe** (clés env-bound, dual_environment, Bearer, webhooks HMAC, sandbox URL distincte). **Le plus cohérent = répliquer exactement le pattern `stripe.service.js`** dans `IntegratedApi`. C'est l'intégration la plus simple des trois (Stripe-like, déjà éprouvé).

## 9. Mise à jour — endpoints confirmés (API Reference complète)

Le PDF d'API Reference complet a confirmé l'**intégralité des paths/méthodes** (cf. `api/YOUSIGN_API_REFERENCE_INDEX.md`). Points techniques résolus :

- ✅ **Provisioning workspace par API** : `POST /workspaces` existe → onboarding d'une Organization LYCARZ automatisable.
- ✅ **Cycle request** : `POST /signature_requests` → `/activate` → `/cancel` → `/reactivate` confirmés.
- ✅ **Signature serveur** : `POST .../signers/{id}/sign` (signer par API) + `/send_otp` confirmés.
- ✅ **Webhooks** : `POST /webhooks/subscriptions` + catalogue d'events exhaustif (incl. `signature_request.paused/resumed`).
- ✅ **Téléchargement PDF signé** : `GET .../documents/{id}/download`.
- ✅ **Corrélation métier** : `Metadata` + `Custom Property` + `Label` sur la request → stocker la clé du dossier LYCARZ.
- ✅ **Templates** : `GET /templates` **seul** (pas de création API) → confirme « moteur documentaire côté LYCARZ ».

## 10. Questions ouvertes techniques (restantes)

- ❓ Rate limit **production** exact (req/s) — page `/reference/rate-limits` à extraire Phase 2.
- ❓ **Idempotence** (header) sur `POST /signature_requests` — non documenté dans l'index ; à confirmer (critique pour retries d'agent).
- ❓ Récupération du **lien de signature** par signataire en `delivery_mode=none` — champ exact de la réponse à confirmer (body non extrait).
- ❓ Rotation du **secret webhook**.
- ❓ SLA / disponibilité contractuelle (relève du devis).
