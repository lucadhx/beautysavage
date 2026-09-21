# Yousign — Audit Trail (guide LYCARZ, preuve probante)

> READ-ONLY. Source : `developers.yousign.com/docs/audit-trails-new`. ✅ = confirmé.

## Description

✅ L'**Audit Trail** est un enregistrement complet généré **par signataire**, capturant « toutes les informations liées à la request » pendant le processus. Assure stockage sécurisé et traçabilité.

## Concepts & Capacités (✅)

- ✅ **Rétention 10 ans** via archivage légal électronique (partenaire **Arkhineo**).
- ✅ Disponible **une fois le signataire a signé**.
- ✅ Deux modes de récupération :
  - **Par signataire (temps réel)** : webhook `signer.done` → télécharger immédiatement.
  - **Par request (batch)** : webhook `signature_request.done` → récupérer tous les audit trails.
- ✅ Formats :
  - **PDF** : `GET signature_requests/{id}/signers/{signerId}/audit_trails/download`.
  - **JSON** : `GET signature_requests/{id}/signers/{signerId}/audit_trails`.

## Cas d'usage LYCARZ

- À chaque `signer.done`/`signature_request.done`, LYCARZ **télécharge l'audit trail** et le stocke dans le dossier (bibliothèque/dossier véhicule) comme **preuve probante** attachée au `GeneratedDocument`.
- Le **PDF signé final** + l'**audit trail** constituent l'archive légale du document.

## Impact CRM / Documents

- L'audit trail s'attache à la **version signée finale** (CRM doc §28.3, §32.2). Immuable, archive légale.
- ✅ Répond partiellement à la question ouverte « versioning légal des documents » (CRM doc §28.18 QE6) : Yousign fournit l'audit trail + archivage 10 ans.

## Impact Signatures

- ✅ Brique de **valeur probante** confirmée (rétention 10 ans, partenaire d'archivage légal).

## Impact IA

- Action future `getAuditTrail` (lecture). L'IA peut vérifier qu'un document est bien signé + archivé.

## Questions ouvertes

- ❓ L'archivage 10 ans Arkhineo est-il **inclus** ou **option payante** ? → audit billing.
- ❓ LYCARZ doit-il **aussi** archiver le PDF signé de son côté (redondance) pour ne pas dépendre de Yousign ? → recommandation : **oui** (ne pas dépendre du provider pour la vérité, cf. doctrine).
