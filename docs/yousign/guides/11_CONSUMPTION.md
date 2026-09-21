# Yousign — Consumption (guide LYCARZ, base facturation)

> READ-ONLY. Source : `developers.yousign.com/docs/consumption-new`. ✅ = confirmé.

## Description

✅ La consommation API v3 est mesurée par produit. Pour la signature, l'unité facturable est **le signataire invité**.

## Concepts & Capacités (✅, critique pour le billing)

- ✅ **eSignature SES & AES** : facturé au **nombre de signataires invités** par request, **indépendamment de la complétion** (« counted when the request is sent, regardless of whether they complete »).
- ✅ **QES** : facturé aux **tentatives d'identification** (réussies **ou** échouées) ; double vérif (doc+vidéo) et réutilisation d'identité comptent ; mais si le signataire s'arrête **avant** de soumettre face+ID → non facturé.
- ✅ **eSeal** : par **document scellé**.
- ✅ **Archivage** : par **MB cumulés** archivés.
- ✅ **Verifications** : facturé si statut `Verified`/`Done`/`Failed` (sauf Company Verification : échecs non facturés).

## API de récupération (✅)

- ✅ `GET /consumptions/detail` (filtres date) → conso par source (app/api), type, level, workspace.
- ✅ `GET /consumptions/addons` → add-ons actifs avec quota + conso (production only ; **indisponible en sandbox**).

## Cas d'usage LYCARZ — implication majeure

- ⚠️ **Règle clé** : un **bon de commande** signé par **garage + client** = **2 signataires invités** = **2 unités de consommation**, même si l'un ne signe pas.
- ⇒ Le **coût d'un document signé V1 ≈ coût de 2 signatures** (à confirmer avec la grille tarifaire, cf. audit billing).
- Si le garage est un **utilisateur Yousign récurrent**, vérifier s'il compte comme signataire facturé (probablement oui — « invited signer »). 🟡 à confirmer.

## Impact CRM / Billing

- LYCARZ peut **suivre sa conso** via `GET /consumptions/detail` (par workspace = par organisation) → **refacturation / quota par plan** LYCARZ possible (capability, CRM doc §17).
- Permet d'imputer le coût signature **par organisation** (workspace).

## Impact IA

- Action future `getConsumption` (Panel/finance) → pilotage des coûts signature par org.

## Questions ouvertes

- ❓ Le **garage signataire** est-il facturé comme un signataire externe ? (impact x2 vs x1 par document).
- ❓ Grille tarifaire exacte (€/signature, paliers) **non disponible dans la doc développeur** → nécessite la page pricing commerciale / devis (audit billing : marqué ❓).
