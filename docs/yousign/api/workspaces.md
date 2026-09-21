# API — Workspaces (P1, multi-tenant)

> READ-ONLY. ✅ confirmé / 🟡 / ❓ Phase 2.

## Endpoints — ✅ confirmés (API Reference)

- ✅ GET `/workspaces` — lister
- ✅ POST `/workspaces` — **créer un workspace** (provisioning par API)
- ✅ GET `/workspaces/default` — workspace par défaut
- ✅ POST `/workspaces/{id}` (markAsDefault) — marquer par défaut
- ✅ GET/PATCH/DELETE `/workspaces/{id}` — gérer
- ✅ PUT `/workspaces/{id}/users` — associer un user
- ✅ DELETE `/workspaces/{id}/users/{userId}` — retirer un user

## Concepts (✅)

- Isolation par workspace ; clé API scopable workspace ; workspace par défaut.

## Cas d'usage LYCARZ

- 1 workspace par `Organization` LYCARZ (multi-tenant ISV). `workspaceId` stocké côté LYCARZ.

## Compatibilité IA

- `getWorkspace` (lecture) ; provisioning workspace à la création d'org (si API dispo, ❓).

## Questions ouvertes

- ✅ **Résolu** : `POST /workspaces` existe → **provisioning d'un workspace par Organization LYCARZ piloté par API** (onboarding self-service possible).
- ❓ Limite du nombre de workspaces par compte → Phase 2 / devis.
