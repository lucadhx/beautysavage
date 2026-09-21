# Yousign — Signers (guide LYCARZ)

> READ-ONLY. Source : `developers.yousign.com/docs/signer-1`, `configure-recipient-ordering`, `set-the-signature-level`, `choose-the-signature-request-authentication-mode`. ✅ = confirmé.

## Description

✅ Un **Signer** est « la personne qui va effectuer l'action de signer une Signature Request ». Plusieurs signers par request ; la request atteint `done` seulement quand **tous** ont signé.

## Concepts

✅ **3 sources de signataires** : créé directement (first name, last name, email, phone) ; sélectionné depuis des **Contacts** sauvegardés ; utilisateur existant du compte Yousign.
✅ **Ajout** : à la création de la request **ou ensuite tant que `draft`**.
✅ **9 statuts signer** : `initiated`, `notified`, `verified`, `consent_given`, `processing`, `declined`, `signed`, `aborted`, `error`.

## Fonctionnalités

- ✅ **Lien unique** par signataire (« Each Signer can sign through a unique link »).
- ✅ **Visibilité documents** restreignable par signataire (plans **Pro/Scale**).
- ✅ **Ordre de signature** : séquentiel ou simultané (guide 07).
- ✅ **Personnalisation email** par signataire (sujet/corps).
- ✅ **Audit trail individuel** récupérable en PDF (guide 12).

## Capacités

- ✅ **Niveau de signature par signataire** : propriété `signature_level` ∈ `electronic_signature` (SES), `advanced_electronic_signature` (AES), `qualified_electronic_signature` (QES). Niveaux mixables dans une request **sauf QES** (uniformité requise).
- ✅ **Mode d'authentification** : OTP email / OTP SMS / no-otp (selon niveau). SES = OTP optionnel ; AES = OTP SMS + vérif identité obligatoire ; QES = vérif vidéo + OTP.

## Limitations

- ✅ **QES** impose des signers **ordonnés** et de **même niveau**.
- ✅ AES/QES **désactivent** les interfaces custom / iframe.
- ✅ Sandbox trial : **max 5 signers** (vs 100 en prod).

## Cas d'usage LYCARZ

- **Bon de commande** : 2 signers — `garage` (vendeur) + `client`. Niveau **SES** suffit pour la V1 (vente automobile courante).
- Le **garage** peut être un utilisateur Yousign du compte ; le **client** est créé à la volée (nom/email/téléphone depuis le dossier).
- Email/téléphone du client viennent du **Lead** (CRM) ; pré-remplissage automatique.

## Impact CRM

- `requiredSigners` LYCARZ (§32.1 : `garage`, `client`) **mappe 1:1** sur les Signers Yousign.
- Les coordonnées signataires proviennent du Lead/dossier ; LYCARZ reste source de vérité (Yousign ne stocke pas le CRM).

## Impact Documents

- La visibilité par document (Pro/Scale) permettrait de n'exposer au client que le document à signer, pas les pièces internes. 🟡 à valider selon plan.

## Impact Signatures

- ✅ **V1 = SES, 2 signataires, sans ordre** : directement réalisable (`signature_level=electronic_signature`, `ordered_signers=false`).
- AES/QES = **V2+** (nécessitent vérification d'identité, cf. guide 09 + impact billing QES).

## Impact IA

- Actions futures : `addSigner`, `getSigners`, `getSignerStatus`, `getSignerAuditTrail`. Mappables sur le Service Layer.
- Statuts signer normalisables vers les statuts LYCARZ (`waiting_*`, `client_signed`, `declined`…).

## Questions ouvertes

- ❓ Champs obligatoires exacts d'un signer SES (phone requis si OTP SMS ? email seul si no-otp ?) → API Reference.
- ❓ Gestion du **garage comme signataire récurrent** (Contact sauvegardé vs user Yousign) → choix d'intégration.
- ❓ Que se passe-t-il si un signataire `declined` : la request entière passe `declined` ? (probable, à confirmer).
