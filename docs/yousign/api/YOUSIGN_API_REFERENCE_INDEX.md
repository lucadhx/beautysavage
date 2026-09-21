# Yousign API v3 — Index de référence des endpoints (pour LYCARZ)

> READ-ONLY. **Mise à jour** : la liste complète des endpoints est désormais **confirmée** (✅) à partir du PDF d'API Reference fourni (sidebar `/reference/*` avec méthodes HTTP). Base : `https://api.yousign.app/v3` (prod) / `https://api-sandbox.yousign.app/v3` (sandbox).
> **Convention** : REST/JSON, auth `Authorization: Bearer {apiKey}`, pagination cursor (`after`, `limit≤100`), clés liées à un environnement.
> Légende : ✅ endpoint confirmé dans la doc · 🟡 body/détail à confirmer en Phase 2 (page détail non extraite).

## 0. Introduction / transverse (P1)

| Page | Réf |
|---|---|
| OAS specification | `/reference/oas-specification` |
| Errors / Errors List | `/reference/errors-1`, `/reference/list-of-errors` |
| Versioning | `/reference/versioning` |
| Rate limits | `/reference/rate-limits` |

> ⚠️ Le détail chiffré du **rate limit production** est sur `/reference/rate-limits` (page non extraite) → à lire en Phase 2 (cf. guide 13 question ouverte).

## 1. Signature Request (P1) ✅

| Méthode | Endpoint | Action |
|---|---|---|
| GET | `/signature_requests` | Lister les signature requests |
| POST | `/signature_requests` | **Initier** une signature request (draft) |
| GET | `/signature_requests/{id}` | Récupérer une request |
| PATCH | `/signature_requests/{id}` | Mettre à jour une request |
| DELETE | `/signature_requests/{id}` | Supprimer une request |
| POST | `/signature_requests/{id}/activate` | **Activer** (draft → ongoing) |
| POST | `/signature_requests/{id}/cancel` | Annuler |
| POST | `/signature_requests/{id}/reactivate` | Réactiver une request expirée |

## 2. Signer (P1) ✅

| Méthode | Endpoint | Action |
|---|---|---|
| GET | `/signature_requests/{id}/signers` | Lister les signataires |
| POST | `/signature_requests/{id}/signers` | Créer un signataire |
| GET | `/signers/{signerId}` | Récupérer un signataire |
| PATCH | `/signature_requests/{id}/signers/{signerId}` | Mettre à jour |
| DELETE | `/signature_requests/{id}/signers/{signerId}` | Supprimer |
| POST | `/signature_requests/{id}/signers/{signerId}/send_otp` | **Envoyer un OTP** au signataire |
| POST | `/signature_requests/{id}/signers/{signerId}/sign` | **Signer par API** (server-to-server) |
| POST | `/signature_requests/{id}/signers/{signerId}/send_reminder` | Relance manuelle |
| POST | `/signature_requests/{id}/signers/{signerId}/identity_verification` | Pré-vérifier une pièce d'identité (AES) |
| POST | `.../signers/{id}/unblock_identification` | Débloquer après mismatch d'identité |
| GET | `.../signers/{id}/verified_identity_proof/download` | Télécharger la preuve d'identité (PDF) |

> 💡 **Découverte clé** : `.../sign` permet de **faire signer via l'API** (utile pour le garage en signature serveur, ou un flux embarqué piloté par LYCARZ).

## 3. Document (P1) ✅

| Méthode | Endpoint | Action |
|---|---|---|
| GET | `/signature_requests/{id}/documents` | Lister les documents |
| POST | `/signature_requests/{id}/documents` | **Ajouter** un document (multipart) |
| GET | `/signature_requests/{id}/documents/download` | Télécharger tous les documents |
| GET | `.../documents/{documentId}` | Récupérer un document |
| GET | `.../documents/{documentId}/download` | **Télécharger un document** (PDF signé final) |
| PATCH | `.../documents/{documentId}` | Mettre à jour |
| DELETE | `.../documents/{documentId}` | Supprimer |
| POST | `.../documents/{documentId}/replace` | **Remplacer** un document |

## 4. Field (P1) ✅

| Méthode | Endpoint | Action |
|---|---|---|
| GET | `.../documents/{documentId}/fields` | Lister les champs |
| POST | `.../documents/{documentId}/fields` | **Créer un champ** (coordonnées) |
| DELETE | `.../documents/{documentId}/fields/{fieldId}` | Supprimer |
| PATCH/UPDATE | `.../documents/{documentId}/fields/{fieldId}` | Mettre à jour |
| POST | `/signature_requests/{id}/documents/{id}/fields/{id}/answer` | Répondre à un champ |

## 5. Audit Trail (P1) ✅

| Méthode | Endpoint | Action |
|---|---|---|
| GET | `/signature_requests/{id}/audit_trails/download` | Télécharger les audit trails de la request |
| GET | `.../signers/{signerId}/audit_trails` | Audit trail signataire (JSON) |
| GET | `/signers/{signerId}/audit_trails/download` | Audit trail signataire (PDF) |

## 6. Corrélation métier — Metadata / Custom Property / Label (P1-P2) ✅

> **Pour relier une request Yousign à un dossier LYCARZ.**

| Méthode | Endpoint | Action |
|---|---|---|
| GET/POST/PUT/DELETE | `/signature_requests/{id}/metadata` | **Metadata** clé/valeur sur la request |
| GET/POST | `/custom_properties` | Custom Properties (compte) |
| GET/PATCH/DELETE | `/custom_properties/{id}` | Gérer une custom property |
| GET/POST/PATCH/DELETE | `/labels`, `/labels/{id}` | Labels |
| GET/PUT/DELETE | `/signature_requests/{id}/labels[/{id}]` | Associer/retirer un label |

## 7. Template (P2) ✅ — **lecture seule**

| Méthode | Endpoint | Action |
|---|---|---|
| GET | `/templates` | **Lister** les templates (créés dans l'app Yousign) |

> ✅ **Décision confirmée** : il n'y a **que `GET /templates`** (aucune création/édition par API). Cela **valide** le choix LYCARZ de garder son propre moteur de templates (DMS §31) — les Templates Yousign ne sont pas une voie code-first.

## 8. Webhooks — Subscriptions (P1) ✅

| Méthode | Endpoint | Action |
|---|---|---|
| GET | `/webhooks` | Lister les subscriptions |
| POST | `/webhooks/subscriptions` | **Créer** une subscription |
| GET | `/webhooks/{webhookId}` | Récupérer |
| PATCH | `/webhooks/{webhookId}` | Mettre à jour |
| DELETE | `/webhooks/{webhookId}` | Supprimer |

## 9. Webhook Events (P1) ✅ — catalogue exhaustif

**Signature Request** (13) : `activated`, `approved`, `canceled`, `declined`, `deleted`, `done`, `expired`, `permanently_deleted`, `reactivated`, `reminder_executed`, `automatic_reminder_executed`, `rejected`, **`paused`**, **`resumed`**.
**Signer** (12) : `declined`, `done`, `error`, `identification_blocked`, `identification_failed`, `identification_succeeded`, `identification_expired`, `identity_saved`, `link_opened`, `notified`, `sender_contacted`, `notification_delivery_failed`.
**Approver** (4) : `approved`, `notified`, `rejected`, `notification_delivery_failed`.
**Contact** (1) : `created`.
**Electronic Seal** (2) : `done`, `error`.
**Verification** (6) : `identity_document.done`, `identity_video.done`, `bank_account.done`, `bank_account_lookup.done`, `bank_account_connection.done`, `proof_of_address.done`, `company.done`, `watchlist.done`.
**User** (1) : `completed`.
**Workflow** (`action_group` + `session`) : `blocked`/`done`/`started`.
**Document Analysis** (1) : `done`.
**Applicant** (3) : `notified`, `processed`, `session_blocked`.

> Pivots V1 LYCARZ : `signature_request.done`, `signer.done`, `signer.link_opened`, `signature_request.declined/expired/canceled`.

## 10. Consumption (P1) ✅

| Méthode | Endpoint | Action |
|---|---|---|
| GET | `/consumptions` | ⚠️ **DEPRECATED** |
| GET | `/consumption/detail` (alias `/consumptions/detail`) | Conso détaillée (date, source, type, level, workspace) |
| GET | `/consumption/addon` (alias `/consumptions/addons`) | Conso add-ons (quota, prod only) |
| GET | `/consumptions/export` | Export conso |
| GET | `/consumptions/records/invited_signers` | **Records signataires invités** (= unité facturable signature) |
| GET | `/consumptions/records/electronic_seals` | Records seals |
| GET | `/consumptions/records/identifications` | Records identifications (QES) |

## 11. Workspace / User / Invitation (P1) ✅

| Méthode | Endpoint | Action |
|---|---|---|
| GET | `/workspaces` | Lister |
| POST | `/workspaces` | **Créer un workspace** (provisioning par API ✅) |
| GET | `/workspaces/default` | Workspace par défaut |
| POST | `/workspaces/{id}` (markAsDefault) | Marquer par défaut |
| GET/PATCH/DELETE | `/workspaces/{id}` | Gérer |
| PUT | `/workspaces/{id}/users` | Associer un user |
| DELETE | `/workspaces/{id}/users/{userId}` | Retirer un user |
| GET/POST/GET/PATCH/DELETE | `/users[...]` | Gestion utilisateurs |
| GET | `/invitations`, `/users/{id}/invitation` | Invitations |

> ✅ **Découverte clé** : **`POST /workspaces` existe** → provisioning automatique d'un workspace par Organization LYCARZ **possible par API** (résout une question ouverte multi-tenant).

## 12. Contact / Custom Experience (P2) ✅

| Domaine | Endpoints |
|---|---|
| **Contact** | `GET/POST /contacts`, `GET/PATCH/DELETE /contacts/{id}` |
| **Custom Experience** | `GET/POST /custom_experiences`, `GET/PATCH/DELETE /custom_experiences/{id}`, gestion logo |

## 13. Hors périmètre LYCARZ V1 (P3) ✅ (listés pour complétude)

- **Electronic Seal** : `POST/GET /electronic_seals`, audit trail, documents, images.
- **Document & Identity Verification** : `/verifications/{bank_accounts,identity_documents,identity_videos,companies,watchlists,proofs_of_address,bank_account_lookups}`, `/document_analyses`, `/verifications/{type}/{id}/audit_trail`.
- **Workflows** : `/workflow_sessions`, `/workflow_templates`, `/workflow_sessions/{id}/links`, `/workflow_sessions/{id}/applicants`.
- **Signer Document Request / Signer Consent Request** : sous-ressources de la request (collecte de docs/consentements signataire).
- **Archive** : `POST /archives`, `GET /archives/{id}/download`.
- ⚠️ **Deprecated** : `POST /documents` (upload hors request), `GET /consumptions`.

## Schéma de documentation par endpoint (Phase 2)

Les **paths et méthodes** sont désormais confirmés. La Phase 2 (via Postman / pages `/reference/*` détaillées) renseignera, par endpoint : Request Body exact · Response · codes d'erreur · idempotence · exemples. Voir fichiers `docs/yousign/api/*.md`.
