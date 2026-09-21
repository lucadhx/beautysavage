# Yousign — Audit billing pour LYCARZ

> READ-ONLY. ⚠️ **Distinction stricte confirmé/inconnu.** La **logique de comptage** est ✅ confirmée (doc consumption). Les **prix €** sont ❓ **NON disponibles dans la doc développeur** (page pricing commerciale / devis requise).

## 1. Logique de consommation (✅ confirmé)

- ✅ **SES & AES** : facturé au **nombre de signataires invités** par request, **peu importe la complétion**.
- ✅ **QES** : facturé aux **tentatives d'identification** (réussies ou échouées).
- ✅ **eSeal** : par document scellé. **Archivage** : par MB cumulés. **Verifications** : si `Verified/Done/Failed`.
- ✅ Suivi : `GET /consumptions/detail` (par workspace/type/level), `GET /consumptions/addons` (prod only).

## 2. Implication majeure pour LYCARZ (✅ déduit du comptage)

> ⚠️ **Un document signé par garage + client = 2 signataires invités = 2 unités de consommation.**

- Le **coût d'un bon de commande signé ≈ 2 × prix unitaire signature**.
- 🟡 **À confirmer** : le **garage** (signataire interne récurrent) est-il facturé comme un signataire ? Si oui → x2 par document ; si le garage est exempté → x1. **Impact financier direct.**

## 3. Prix (❓ INCONNU — ne pas inventer)

> ❌ **Aucun tarif € n'est publié dans la documentation développeur Yousign.** Yousign fonctionne par **plans commerciaux** (Free trial / Pro / Scale + add-ons) avec **devis**. Les prix réels nécessitent : la page pricing publique Yousign **ou** un devis commercial.

**Ce qui est ❓** : prix par signature SES, prix AES, prix QES (par identification), prix archivage/MB, paliers de volume, abonnement de base mensuel, signatures incluses par plan.

## 4. Simulations (modèle paramétrique — €/signature en VARIABLE)

> Comme le prix unitaire est inconnu, voici un **modèle de calcul** à compléter dès que le tarif réel est obtenu. Hypothèse de structure : **2 signataires par document** (garage + client). Soit **P** = prix € par signataire invité.

| Volume documents/mois | Signataires facturés (×2) | Coût mensuel (modèle) |
|---|---|---|
| 100 docs | 200 signatures | **200 × P** |
| 250 docs | 500 signatures | **500 × P** |
| 500 docs | 1 000 signatures | **1 000 × P** |
| 1 000 docs | 2 000 signatures | **2 000 × P** |
| 2 500 docs | 5 000 signatures | **5 000 × P** |

> 🟡 **Si le garage n'est pas facturé** (signataire interne) : diviser par ~2 (1 signataire client facturé/doc).
> Exemples d'ordres de grandeur usuels du marché eSignature FR (🟡 **non confirmé Yousign**, à titre indicatif uniquement, **NE PAS utiliser comme chiffre officiel**) : P se situe souvent entre ~0,5 € et ~2 € par signature selon volume/plan. **À remplacer par le tarif réel.**

## 5. Coût moyen / marginal

- **Coût moyen par signature** = P (à obtenir).
- **Coût moyen par document signé** = 2 × P (ou 1 × P si garage exempté).
- **Coût marginal** : ✅ **linéaire au volume** (facturation par signataire), avec **paliers de plan** ❓ (Pro→Scale) pouvant réduire P à fort volume.

## 6. Risques financiers / blocages SaaS

| Risque | Niveau | Détail |
|---|---|---|
| **Facturation à l'invitation, pas à la complétion** | 🟠 Moyen | Un client qui ne signe jamais est **quand même facturé** → coût sur leads morts. À surveiller. |
| **x2 si garage facturé** | 🟠 Moyen | Double le coût par document. À clarifier d'urgence. |
| **Prix inconnu** | 🔴 Élevé (info) | Impossible de valider le modèle SaaS sans le tarif réel → **obtenir un devis avant décision finale**. |
| **QES coûteux** (par tentative, même échec) | 🟡 Faible (V1 SES) | Ne concerne pas la V1. |
| **Archivage facturé au MB** | 🟡 Faible | PDF auto + audit trail ; volumétrie à estimer. |
| **Refacturation client** | — | LYCARZ peut gater par capability/plan (CRM §17) et suivre par workspace. |

## 7. Recommandations billing

1. **Obtenir un devis Yousign** (Pro + add-ons) avant tout engagement — bloquant.
2. **Clarifier le statut du garage** (facturé ou non).
3. **Modéliser le coût par capability LYCARZ** : inclure la signature dans un plan payant (CRM §17), pas en illimité.
4. **Suivre la conso par workspace** (`/consumptions/detail`) → imputation par organisation.
5. **Plafonner** (quota signatures/mois par plan) pour éviter les dérives sur leads non convertis.

## 8. Questions ouvertes

- ❓ Tarifs € réels (tous niveaux) — **devis requis**.
- 🟡 Garage signataire facturé ?
- ❓ Archivage 10 ans inclus ou add-on ?
- ❓ Signatures incluses par plan + seuils de palier.
