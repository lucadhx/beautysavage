# Yousign — Signature Requests (guide LYCARZ)

> READ-ONLY. Source : `developers.yousign.com/docs/signature-request-2`, `create-your-first-signature-request`, `introduction-new`. Faits ✅ = confirmés sur page officielle.

## Description

✅ Une **Signature Request** représente « le processus d'inviter des signataires à signer un document ». C'est l'objet **pivot** de l'API Yousign v3 (REST, JSON). Tout part d'une Signature Request : on lui attache des documents, des signataires (signers), des champs (fields), puis on l'**active**.

## Concepts

✅ **Cycle de création en 2 temps** :
1. **Création en `draft`** (POST) — la request existe mais n'est pas envoyée.
2. **Activation** (action dédiée `/activate`) — passe de `draft` à `ongoing` (ou `approval` si des approvers).

✅ **Statuts (10)** : `draft`, `approval`, `ongoing`, `done`, `rejected`/`declined`, `expired`, `deleted`, `canceled`. Notes : `approval`/`ongoing` ne peuvent pas être supprimées sans changer d'abord de statut ; `expired` est réactivable ; `canceled` est définitif.

✅ **Expiration** : par défaut **6 mois** à partir de l'activation ; **maximum 1 an**.

✅ **Propriétés clés** : `status`, `delivery_mode` (`email` = Yousign notifie / `none` = vous gérez), `workspace` (confidentialité), `email_notification` (personnalisation expéditeur : nom org / workspace / custom), `custom_recipient_order`.

## Fonctionnalités

- ✅ Attachement de documents (draft uniquement), signataires, champs.
- ✅ Ordonnancement des destinataires (cf. guide 02 + recipient ordering).
- ✅ Notification par email gérée par Yousign **ou** désactivée (`delivery_mode=none`).
- ✅ Audit trail généré à la complétion (guide 12).

## Capacités

- ✅ Mode **API-driven** complet : créer → attacher docs → placer fields → ajouter signers → activer → suivre via webhooks → récupérer PDF signé + audit trail.
- ✅ Réactivation d'une request `expired`.

## Limitations

- ✅ Documents attachables **uniquement en `draft`**.
- ✅ Expiration plafonnée à **1 an**.
- ✅ Une request avec Smart Anchors **ne peut plus être éditée via l'application** après création API.
- ❓ Liste exhaustive des champs de l'objet : non fournie sur la page overview (à confirmer via API Reference, Phase 2).

## Cas d'usage LYCARZ

- **Bon de commande** : 1 Signature Request par `GeneratedDocument` (dossier véhicule), signataires = garage + client.
- **Mandat / contrat de réservation / fiche de reprise** : idem, 1 request par document métier.
- LYCARZ crée la request, attache le **PDF généré** (DMS §31), place les **fields** (signature garage, signature client, read-only data), puis **active**.

## Impact CRM

- La Signature Request est rattachée à une **Vehicle Opportunity** (dossier véhicule), via un `GeneratedDocument` + `DocumentVersion` précis (CRM doc §30.1, §32.2).
- Corrélation recommandée via **Custom Properties** ou **Metadata** Yousign (stocker `signatureRequestId` ↔ `documentVersionId` LYCARZ). À confirmer (guide custom-properties).

## Impact Documents

- 1 Signature Request ↔ 1 **version précise** d'un document (CRM doc §28.7 : « une signature appartient à une version précise »). Cohérent : Yousign fige le PDF envoyé.
- Le **snapshot de configuration de signature** LYCARZ (§32.2) capture le `signatureRequestId` + provider + signataires au moment de la génération.

## Impact Signatures

- ✅ Le modèle Yousign (request → signers → fields → activate) **mappe directement** sur le `SigningFlow` LYCARZ (§27.8) et le `Signature System V1` (§32).
- ✅ **V1 sans `signatureOrder`** réalisable : laisser `ordered_signers=false` (parallèle) — confirmé possible (guide 07 recipient ordering).

## Impact IA

- Actions atomiques futures mappables : `createSignatureRequest`, `activateSignatureRequest`, `checkSignatureStatus`, `cancelSignatureRequest`, `downloadSignedDocument` (CRM doc §28.16, §31.11). Toutes via le Service Layer LYCARZ, jamais l'agent directement sur Yousign.

## Questions ouvertes

- ❓ Schéma exact du body de création (champs obligatoires/optionnels) → API Reference Phase 2.
- ❓ Peut-on activer puis ajouter un signataire ? (la doc dit signers ajoutables « en draft » — à confirmer pour ongoing).
- ❓ Idempotence de la création (header d'idempotence ?) → à vérifier (guide limits/API).
