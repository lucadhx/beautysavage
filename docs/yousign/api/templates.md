# API — Templates (P2, préparation)

> READ-ONLY. ✅ confirmé / 🟡 / ❓ Phase 2.

## Endpoints — ✅ confirmés (API Reference)

- ✅ GET `/templates` — **lister** les templates (créés dans l'app Yousign).
- ❌ **Aucun POST/PATCH/DELETE template** dans l'API : les templates sont **créés uniquement dans l'application** Yousign, pas par API.

## Concepts (✅)

- Templates définis **dans l'app Yousign** (documents, participants, fields, settings) ; placeholder signers.

## Cas d'usage LYCARZ — recommandation

- ⚠️ **Non retenu pour le contenu** : LYCARZ garde son moteur documentaire (DMS §31). Templates Yousign = redondants avec `DocumentTemplate`/Field Registry LYCARZ. Provider-agnostic préservé.

## Compatibilité IA

- N/A si non retenu (gabarits = `ADMIN/PANEL AI REFERENCE` LYCARZ).

## Questions ouvertes

- ✅ **Résolu** : pas d'API de création de template (seul `GET /templates`). App-only ⇒ **confirme définitivement** le choix LYCARZ « templates et Field Registry côté LYCARZ » (DMS §31), code-first préservé.
