# Yousign — Audit AI Ready pour LYCARZ

> READ-ONLY. Cohérent avec **AI Ready Foundation** (CRM doc §30.4 : Capabilities First, API First, Agent Ready, Audit Trail, Permissions) et les catalogues `ADMIN/PANEL AI REFERENCE` (§30.5). ✅ confirmé / 🟡 / ❓.

## Principe

> L'agent IA **n'appelle jamais Yousign directement**. Il appelle des **actions atomiques du Service Layer LYCARZ** qui, elles, parlent à Yousign via `IntegratedApi`. Toute action est tracée (`ActivityLog` + `AIRunLog`, `actorType="ai_agent"`, `traceId`) et soumise aux permissions (`checkOrgPermission`). C'est la même doctrine que pour Brevo.

## 1. Actions IA exploitables — côté ADMIN (génération & suivi signature)

| Action atomique LYCARZ | Yousign sous-jacent | Statut |
|---|---|---|
| `createSignatureRequest(documentVersionId)` | ✅ POST /signature_requests (draft) | confirmé concept |
| `attachDocumentToSignature` | 🟡 POST documents (multipart) | probable |
| `placeSignatureFields` | 🟡 POST fields (coords) | probable |
| `addSigner(garage, client)` | 🟡 POST signers | probable |
| `activateSignatureRequest` | ✅ activate | confirmé concept |
| `sendSignatureRequest` (via Brevo) | `delivery_mode=none` + module Email | ✅ |
| `checkSignatureStatus` | webhooks + GET request | ✅ |
| `getSigners` / `getSignerStatus` | 🟡 GET signers | probable |
| `downloadSignedDocument` | 🟡 GET document download | probable |
| `getAuditTrail` | ✅ GET audit_trails[/download] | confirmé |
| `cancelSignatureRequest` | 🟡 cancel | probable |
| `remindSigner` | 🟡 reminder (ou via Brevo) | probable |
| `getConsumption` | ✅ GET /consumptions/detail | confirmé |

## 2. Actions IA exploitables — côté PANEL (configuration)

| Action | Périmètre | Note |
|---|---|---|
| `getWorkspace` / provisioning workspace | multi-tenant | ❓ création par API à confirmer |
| Config niveau de signature par DocumentDefinition | `signature_level` | dans LYCARZ (snapshot §32.2), pas Yousign |
| Templates de placement de champs | `DocumentTemplate` LYCARZ | côté LYCARZ (pas Templates Yousign) |
| Suivi consommation par org | `/consumptions/detail` | reporting finance |

> ⚠️ La **configuration documentaire** (DocumentDefinition, Field Registry, templates) reste **côté LYCARZ** (`PANEL AI REFERENCE`, §30.5.4). Yousign ne configure que l'**exécution de signature**.

## 3. Statuts normalisés (contrat IA)

Les statuts Yousign (request : draft/ongoing/done/declined/expired/canceled ; signer : initiated…signed/declined/error) sont **normalisés** vers le contrat LYCARZ (§28.16 / CDC Communication §11.2) :

```txt
signature_required · signature_pending · signature_completed
signature_declined · signature_expired · signature_canceled
provider_error · permission_denied · blocked_missing_data
```

## 4. Conformité AI Ready Foundation (§30.4)

| Principe | Respect | Comment |
|---|---|---|
| **Capabilities First** | ✅ | Chaque capacité signature documentée (ce dossier + `ADMIN AI REFERENCE`). |
| **API First** | ✅ | Yousign 100 % API REST ; LYCARZ l'expose via Service Layer. |
| **Agent Ready** | ✅ | Une seule implémentation (Service Layer) pour humain ET agent. |
| **Audit Trail** | ✅✅ | Double : `ActivityLog`/`AIRunLog` LYCARZ + audit trail probant Yousign (10 ans). |
| **Permissions** | ✅ | L'agent passe par `checkOrgPermission` ; jamais d'accès direct à la clé API. |

## 5. Ce qui permettra à l'IA de fonctionner (synthèse)

✅ Yousign expose **tout en API** → un futur agent LYCARZ pourra : créer une demande, suivre, récupérer statuts/signataires/PDF signé, annuler, relancer, lire la consommation. La **gestion des templates/champs/registry reste côté LYCARZ** (Yousign ne porte pas ces concepts métier).

## 6. Endpoints confirmés pour les actions IA (API Reference)

Toutes les actions atomiques ciblées **mappent sur des endpoints confirmés** :

| Action IA | Endpoint Yousign ✅ |
|---|---|
| `createSignatureRequest` | POST `/signature_requests` |
| `attachDocument` | POST `.../documents` |
| `placeSignatureFields` | POST `.../documents/{id}/fields` |
| `addSigner` | POST `.../signers` |
| `activateSignatureRequest` | POST `.../activate` |
| `sendSignatureRequest` | (Brevo) + `delivery_mode` ; OTP via `.../send_otp` |
| `checkSignatureStatus` | webhooks + GET `.../signature_requests/{id}` |
| `getSigners` / `getSignerStatus` | GET `.../signers` |
| `downloadSignedDocument` | GET `.../documents/{id}/download` |
| `getAuditTrail` | GET `.../audit_trails[/download]` |
| `cancelSignatureRequest` | POST `.../cancel` |
| `remindSigner` | POST `.../signers/{id}/send_reminder` |
| `getConsumption` | GET `/consumption/detail` |
| `provisionWorkspace` (onboarding org) | POST `/workspaces` ✅ |

## 7. Questions ouvertes IA (restantes)

- ❓ **Idempotence** (pour des retries d'agent sûrs) — non confirmée.
- ❓ Lien de signature récupérable en `delivery_mode=none` (pour `sendSignatureRequest` via Brevo) — champ de réponse à confirmer.
