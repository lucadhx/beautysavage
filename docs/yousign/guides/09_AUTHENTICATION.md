# Yousign — Authentication & Signature Levels (guide LYCARZ)

> READ-ONLY. Source : `api-keys`, `set-the-signature-level`, `setup-signature-security`, `choose-the-signature-request-authentication-mode`. ✅ = confirmé.

## Description — deux notions distinctes

1. **Authentification API** (LYCARZ ↔ Yousign) : clés API.
2. **Niveau de signature + authentification signataire** (eIDAS) : SES/AES/QES + OTP.

## API Authentication (✅)

- ✅ Header : `Authorization: Bearer {apiKey}`.
- ✅ Clé **liée à un environnement** (prod **ou** sandbox, jamais les deux).
- ✅ **Scope** : organisation (accès global) ou workspace (accès restreint ; ressources org comme Webhooks restent accessibles).
- ✅ **Permissions** : full-access (CRUD) ou read-only.
- ✅ **Max 200 clés actives** par organisation (extensible plan Scale).
- ✅ Gestion : stocker en secrets manager, jamais en source ; révoquer si exposée ; rotation périodique. Members ne créent pas de clé ; Admins créent des clés workspace ; Owners créent tout.
- ✅ Clé workspace = **read-only** sur User/Workspace.

## Signature Levels (✅, eIDAS)

| Niveau | `signature_level` | Exigences | Interfaces |
|---|---|---|---|
| **SES** (Simple) | `electronic_signature` | OTP email/SMS **optionnel** | liens, iFrame, custom ✅ |
| **AES** (Advanced) | `advanced_electronic_signature` | **Vérif identité + OTP SMS obligatoires**, activation par support | iFrame/custom **interdits** |
| **QES** (Qualified) | `qualified_electronic_signature` | Vérif identité + **vidéo** (par humain) + OTP ; signers **ordonnés, même niveau** | iFrame/custom **interdits** |

✅ Niveau **par signataire** ; mixables sauf QES (uniformité).
✅ **Authentication mode** (SES) : OTP email / OTP SMS / no-otp ; custom OTP SMS possible.

## Cas d'usage LYCARZ

- **V1 = SES** (vente automobile B2B/B2C courante) : OTP **optionnel** → parcours fluide, pas de vérification d'identité lourde. Suffisant juridiquement pour bon de commande/mandat dans la grande majorité des cas.
- **AES/QES = V2+** : seulement si un type de document l'exige légalement (rare en vente auto courante). Implique le bloc « Identity Verification » (P3) + surcoût billing (QES = par tentative d'identification).

## Impact CRM / Signatures

- ✅ Le niveau de signature devient un attribut du `DocumentDefinition` LYCARZ (snapshot §32.2). V1 : `electronic_signature` par défaut.

## Impact IntegratedApi

- ✅ La clé API Bearer **liée à un environnement** s'intègre **parfaitement** dans `IntegratedApi` : token `role: "api_key"`, `runtime: test|prod`. ⚠️ **Différence avec Brevo** (clé unique) : Yousign **a des clés distinctes sandbox/prod** → `runtimeModel: "dual_environment"` comme **Stripe** (cf. audit technique).

## Impact IA

- L'agent n'accède jamais à la clé API ; il appelle le Service Layer LYCARZ qui détient les credentials (`IntegratedApi`).

## Questions ouvertes

- ❓ Valeur juridique exacte SES en France pour bon de commande véhicule → **avis juridique** requis (pas un fait API).
- ❓ Coût AES/QES vs SES → audit billing.
