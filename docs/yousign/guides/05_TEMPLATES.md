# Yousign — Templates (guide LYCARZ)

> READ-ONLY. Source : `developers.yousign.com/docs/template`, `use-templates-to-create-signature-requests`. ✅ = confirmé.

## Description

✅ Un **Template** Yousign est un « blueprint pré-configuré » défini **dans l'application Yousign**, déclenchable par API avec un minimum de code.

## Concepts & Capacités (✅)

- **Documents** : fichiers à signer + attachments.
- **Participants** : signataires récurrents (personnes fixes), **placeholder signers** (rôles dynamiques, ex. « The Employee »), approvers, followers.
- **Fields** : champs pré-positionnés (signature, inputs, checkbox…).
- **Settings** : niveau de signature, relances auto, expiration, emails custom.
- **Placeholders** : rôles génériques remplacés par de vraies personnes à la création via API.

## Limitations

- 🟡 Les templates se définissent **dans l'app Yousign** (pas purement code-first côté LYCARZ).
- ❓ Limites quantitatives (nb templates) non précisées sur la page.

## Cas d'usage LYCARZ — analyse de pertinence

- ⚠️ **Tension avec l'architecture LYCARZ** : LYCARZ a son **propre** système de templates (`DocumentTemplate` HTML, §31.2) et son **Document Field Registry** (§31.5), source de vérité **code-first**. Utiliser les Templates Yousign **dédoublerait** la logique de gabarit et déplacerait une partie de la vérité chez le provider.
- **Recommandation** : LYCARZ génère le **PDF fini** via son propre moteur ; Yousign reçoit ce PDF et n'ajoute que les **fields de signature** par coordonnées (guide 04). On **n'utilise pas** les Templates Yousign pour le contenu — cohérent avec « provider-agnostic » (§27.13) et « pas de vérité métier chez le provider » (cf. doctrine Brevo).
- Les **placeholder signers** restent un concept utile conceptuellement (rôle garage/client) mais réalisable sans Template Yousign.

## Impact CRM / Documents

- Garder `DocumentDefinition`/`DocumentTemplate`/`DocumentFieldRegistry` **dans LYCARZ** (§31). Yousign = exécutant signature, pas moteur documentaire.

## Impact Signatures

- Les positions de champs (templates de placement) peuvent être stockées côté **LYCARZ** (par `DocumentTemplate`) et envoyées en coordonnées API.

## Impact IA

- Si Templates Yousign **non** retenus : pas d'action IA « gérer template Yousign ». La gestion des gabarits reste l'`ADMIN/PANEL AI REFERENCE` LYCARZ (§30.5).

## Questions ouvertes

- ❓ Existe-t-il une API de **création** de template Yousign (pour rester code-first) ou seulement app ? → API Reference. Si app-only, confirme le choix « templates côté LYCARZ ».
