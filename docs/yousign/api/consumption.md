# API — Consumption (P1, base facturation)

> READ-ONLY. ✅ confirmé (API Reference + guide consumption-new). Production only pour les add-ons.

## Endpoints — ✅ confirmés

- ✅ GET `/consumption/detail` (alias `/consumptions/detail`) — conso détaillée (filtres date ; par source app/api, type, level, workspace).
- ✅ GET `/consumption/addon` (alias `/consumptions/addons`) — add-ons (quota + conso ; **prod only**).
- ✅ GET `/consumptions/export` — export.
- ✅ GET `/consumptions/records/invited_signers` — **records signataires invités** (= unité facturable d'une signature SES/AES).
- ✅ GET `/consumptions/records/electronic_seals` — records seals.
- ✅ GET `/consumptions/records/identifications` — records identifications (QES).
- ⚠️ GET `/consumptions` = **DEPRECATED** → ne pas utiliser.

## Logique de facturation (✅, cf. guide 11)

- SES & AES : facturé au **nombre de signataires invités** par request, **peu importe la complétion**.
- QES : facturé aux **tentatives d'identification**.
- Implication LYCARZ : 1 bon de commande (garage + client) = **2 signataires invités**. ⇒ `invited_signers` records = base de suivi/refacturation.

## Cas d'usage LYCARZ

- Suivi par **workspace** = suivi **par Organization** → imputation/quota par plan (capability, CRM doc §17).
- Action IA future `getConsumption` (panel finance).

## Questions ouvertes

- ❓ Tarif € par unité (non public — devis requis, cf. `YOUSIGN_BILLING_AUDIT.md`).
- 🟡 Le garage (signataire interne récurrent) est-il facturé comme un signataire invité ? (impact ×2 vs ×1 par document).
