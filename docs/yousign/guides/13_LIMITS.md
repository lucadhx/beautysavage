# Yousign — Limits (guide LYCARZ)

> READ-ONLY. Source : `developers.yousign.com/docs/limits-new`, `environments-new`, `pagination-1`. ✅ = confirmé.

## Limites par Signature Request (✅)

| Élément | Limite |
|---|---|
| Documents | **50** max |
| Taille document | **50 MB** |
| Signers | **100** (5 en sandbox trial) |
| Approvers | **10** (5 sandbox) |
| Followers | **100** (5 sandbox) |
| Fields | **500** (hors Initials) |
| Labels | **50** |
| Signer Document Requests | **10** à **25 MB** chacun |
| Smart Anchors | document **≤150 pages** |

## Liens & validité (✅)

- ✅ Lien de signature **48 h** par défaut (ajustable **1-72 h** sur demande).

## Rate limits (✅ sandbox, ❓ prod)

- ✅ **Sandbox** : **30 requêtes/minute, 200/heure**.
- ✅ Sandbox **interdit** : tests E2E automatisés, requêtes batch volumineuses, load testing.
- ❓ **Production** : la page Limits renvoie à une page rate limits dédiée sans chiffres précis dans l'extrait → **à confirmer Phase 2** (impact dimensionnement).

## Pagination (✅)

- ✅ **Cursor-based** : `after` (curseur), `limit` (défaut **100**, max **100**). Réponse `{ data[], meta: { next_cursor } }`.

## Cas d'usage LYCARZ

- Limites **largement suffisantes** pour la vente auto : 1 document, 2 signataires par bon de commande. Aucun risque d'atteindre 50 docs / 100 signers.
- La pagination cursor impacte la récupération de listes (requests par workspace) → implémenter le suivi de `next_cursor`.

## Impact CRM / Technique

- Rate limit sandbox (30/min) **suffisant pour le dev**, mais **insuffisant pour des tests de charge** (interdits en sandbox). Tests volumétriques = prod uniquement.
- Le timeout webhook 1 s (guide 06) + ces limites imposent un traitement **asynchrone** côté LYCARZ.

## Impact IA

- L'agent doit respecter les rate limits (backoff). Le Service Layer LYCARZ encapsule retry/throttle (pattern `AdPublicationJob`).

## Questions ouvertes

- ❓ **Rate limit production exact** (req/s) — chiffre manquant, critique pour dimensionner.
- ❓ Réconcilier Smart Anchors « <50 pages » (guide document) vs « ≤150 pages » (limits).
