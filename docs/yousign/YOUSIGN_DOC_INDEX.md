# Yousign — Index de navigation documentaire (pour LYCARZ)

> **Statut** : Audit documentaire READ-ONLY. **Aucun code, aucun commit, aucune implémentation.**
> **Document** : `docs/yousign/YOUSIGN_DOC_INDEX.md`
> **Date** : 2026-06-04
> **Source d'arborescence** : PDF fourni (`Liste references yousign.pdf` — export du menu de navigation `developers.yousign.com`, **167 pages, 9 sections** — confirmé par extraction).
> **Source de contenu** : pages officielles `developers.yousign.com/docs/*` récupérées en lecture (les facts confirmés sont marqués ✅ dans les guides/audits).
> **Base URL doc** : `https://developers.yousign.com/docs/<slug>`

## Méthode & niveau de confiance

Ce dossier distingue systématiquement trois niveaux :

- ✅ **Confirmé** — vérifié sur une page officielle Yousign récupérée pendant cet audit.
- 🟡 **Probable** — déduit de la structure de navigation ou d'une page connexe, non vérifié mot à mot.
- ❓ **Inconnu** — nécessite un audit API détaillé (Phase 2) ou un test réel en sandbox.

> ⚠️ **Limite d'audit honnête** : le PDF de navigation des **guides** (167 pages `/docs/*`) donne l'arborescence + URLs. Le contenu **confirmé** provient des ~16 pages-guides P1 récupérées pendant cet audit.
>
> ✅ **Mise à jour** : un second PDF (l'**API Reference** `/reference/*`) a été fourni — il liste **l'intégralité des endpoints avec leurs méthodes HTTP** (Signature Request, Signer, Document, Field, Audit Trail, Webhooks + events, Workspace, Consumption, Template, etc.). Ces **paths/méthodes sont donc confirmés** (cf. `api/YOUSIGN_API_REFERENCE_INDEX.md`). Restent 🟡/❓ : les **bodies de requête détaillés**, codes d'erreur, idempotence et le rate limit production (pages détail non extraites → Phase 2 via Postman).
>
> **Questions résolues grâce à l'API Reference** : provisioning workspace par API (`POST /workspaces`) ✅ ; cycle activate/cancel/reactivate ✅ ; signature serveur (`.../sign`) ✅ ; création webhook subscription ✅ ; téléchargement PDF signé ✅ ; **templates en lecture seule** (pas de création API) ✅ → confirme « moteur documentaire côté LYCARZ ».
>
> ### ✅ MISE À JOUR 2026-06-27 (scan API Reference live — 2 verrous levés)
> Un **scan ciblé des pages live** `developers.yousign.com/reference/*` + `/docs/*` a **résolu les deux derniers ❓ critiques** :
> - **Lien de signature en `delivery_mode=none`** → champ **`signature_link`** (Signer), réponse `activate` + `GET signer`. **Nouvelle référence** : [`YOUSIGN_DELIVERY_AND_SIGNING_LINKS.md`](YOUSIGN_DELIVERY_AND_SIGNING_LINKS.md).
> - **Smart Anchors** → syntaxe `{{signer_index|type|w|h}}`, `parse_anchors`, PDF/DOCX. **Nouvelle référence** : [`YOUSIGN_SMART_ANCHORS.md`](YOUSIGN_SMART_ANCHORS.md).
> - Nouveaux sous-objets confirmés dans la navbar : **Approver**, **Follower**, **Metadata**, **Signer Document Request**.
> Rapport complet : document d'audit non versionné dans ce dépôt (lien retiré : il pointait vers un fichier absent).

## Légende des priorités

| Priorité | Signification pour LYCARZ |
|---|---|
| **P1** | Indispensable pour la V1 Documents/Signatures (cœur signature : request, signer, document, field, webhooks, environnements, clés API, niveaux, audit trail, consommation, limites). |
| **P2** | Utile (templates, recipient ordering, signing experience, notifications, workspaces, identity verification ciblée, migration). |
| **P3** | Optionnel / hors périmètre prévisible (workflows complets, électronic seal, intégrations tierces Zapier/Salesforce, vérifications avancées watchlist/bank/video). |

---

## 1. Quickstart

| Page | URL (`/docs/…`) | Priorité | Justification |
|---|---|:-:|---|
| Introduction | `introduction-new` | **P1** | Vue d'ensemble API v3 REST, 4 capacités, eIDAS/RGPD. ✅ |
| Set up your account | `set-up-your-account` | P2 | Onboarding compte ; utile au moment de l'intégration. |
| Postman collection | `postman-collection` | P2 | Accélère l'exploration API en Phase 2. |
| Changelog (RSS) | `changelog-rss-feed` | P2 | Veille sur les évolutions API (versionnement). |

## 2. ✍ Electronic Signature (cœur du besoin LYCARZ)

| Page | URL | Priorité | Justification |
|---|---|:-:|---|
| Electronic Signature | `electronic-signature` | **P1** | Concept central. |
| How-to — Create your first Signature Request | `create-your-first-signature-request` | **P1** | Parcours de bout en bout. |
| **Signature Request** | `signature-request-2` | **P1** | Objet pivot (statuts, draft→activate, expiration). ✅ |
| **Signer** | `signer-1` | **P1** | Signataire (props, statuts, sources). ✅ |
| Signer Consent Request | `signer-consent-requests` | P2 | Cas de consentement spécifique. |
| Signer Document Request | `signer-documents` | P2 | Demande de doc au signataire (max 10, 25 MB). |
| **Document** | `document-1` | **P1** | Formats, 50 MB, 50 docs max, PDF 1.6+. ✅ |
| **Field** | `fields` | **P1** | 8 types de champs. ✅ |
| Field creation with API endpoints | `field-creation-with-api-endpoints` | **P1** | Placement par coordonnées. ✅ |
| Field creation with Smart Anchors | `fields-creation-with-smart-anchors` | P2 | Ancres texte (≤150 pages). |
| Field — Signature | `signature-field` | **P1** | Champ signature. |
| Field — Signature Date | `signature-date` | P2 | |
| Field — Signer Name | `signer-name` | P2 | |
| Field — Signer Email | `signer-email` | P2 | |
| Field — Mention | `mention` | P2 | |
| Field — Initials | `initiales` | P2 | |
| Field — Text | `text` | P2 | Saisie signataire. |
| Field — Read-Only Text | `read-only-text` | **P1** | **Clé pour LYCARZ** : injecter données dossier (prix, VIN) en lecture seule. |
| Field — Checkbox | `checkbox` | P2 | |
| Field — Radio Group | `radio-group` | P2 | |
| Approver | `approver-1` | P2 | Validation interne avant signature (max 10). |
| Follower | `follower-1` | P2 | Lecteur en copie (max 100). |
| **eSignature Audit trail** | `audit-trails-new` | **P1** | Preuve probante, PDF+JSON, rétention 10 ans. ✅ |
| Metadata | `metadata` | P2 | Données libres. |
| Label | `label-1` | P2 | Étiquetage (max 50). |
| Custom Properties | `custom-properties` | P2 | **Utile** : corréler `signatureRequestId` ↔ dossier LYCARZ. |
| Template | `template` | P2 | Templates côté app Yousign. ✅ |
| Manage templates | `manage-templates` | P2 | |
| Use Templates to create Signature Requests | `use-templates-to-create-signature-requests` | P2 | |
| **Signature levels and authentication** | `setup-signature-security` | **P1** | SES/AES/QES. |
| **Signature level** | `set-the-signature-level` | **P1** | `signature_level` par signataire. ✅ |
| Advanced eSignature (AES) | `advanced-esignature-new` | P2 | V2 (vérif identité obligatoire). |
| — AES Delegated Registration Authority | `advanced-signature-with-delegated-registration-authority` | P3 | |
| — AES error messages | `list-of-error-messages-for-failed-identification-1` | P3 | |
| — Pre-verify identity (AES) | `pre-verify-the-identity-of-a-signer-for-advanced-electronic-signature` | P3 | |
| — Reuse Image Identity (AES) | `reuse-a-image-check-verification-for-an-advanced-electronic-signature-aes` | P3 | |
| Qualified eSignature (QES) | `qualified-signature` | P3 | Hors V1 (handwritten-equivalent, lourd). |
| — QES capabilities & limitations | `qes-capabilities-and-limitations` | P3 | |
| — QES signer journey | `signer-journey-for-the-qes-level` | P3 | |
| — Testing QES in Sandbox | `using-qes-signature-requests-in-sandbox` | P3 | |
| — QES name parsing rules | `signer-name-parsing-rules-for-the-qes-level` | P3 | |
| — QES error messages | `list-of-error-messages-for-failed-identification` | P3 | |
| — Identity mismatch errors | `manage-names-mismatch-after-a-failed-attempt` | P3 | |
| **Authentication mode** | `choose-the-signature-request-authentication-mode` | **P1** | OTP email/SMS/no-otp. |
| — Custom OTP SMS | `custom-otp-sms` | P2 | |
| **Manage the recipients flow** | `manage-the-recipients-flow` | **P1** | Ordre des signataires. ✅ |
| — Manage signature link delivery | `manage-signature-link-delivery` | **P1** | Delivery mode email/none. ✅ |
| — **Configure recipient ordering** | `configure-recipient-ordering` | **P1** | `ordered_signers`, custom order. ✅ — **clé pour décision "V1 sans signatureOrder"**. |
| **Email notifications** | `email-notifications` | **P1** | LYCARZ gère ses emails (Brevo) → `delivery_mode=none`. |
| — Deactivate email notifications | `deactivate-email-notifications` | **P1** | Désactiver les emails Yousign. |
| — Customize email content | `email-customization` | P2 | |
| — Reminders | `reminders` | P2 | Relances. |
| — Manage notification delivery failures | `manage-notification-delivery-failures` | P2 | |
| **Customize the signature experience** | `customize-the-signature-experience` | P2 | 4 modes (email/portal/iframe/custom). ✅ |
| — Custom Experience | `custom-experiences-new` | P2 | Logo/couleurs. |
| — Signature Portal | `signature-portal` | P3 | |
| — Redirect signer at end | `redirect-a-signer-at-the-end-of-the-signing-flow` | P2 | Retour vers LYCARZ post-signature. |
| — iFrame the signing interface | `using-iframe` | P2 | Signer dans LYCARZ. |
| — iFrame limitations | `iframe-limitations` | P2 | |
| — Integrate the iFrame | `iframe-advanced` | P2 | |
| — iFrame security settings | `iframe-security-settings` | P2 | |
| — Build your own signing interface | `building-your-own-signing-flow` | P3 | |
| Code examples (Node.js) | `nodejs` | P2 | **LYCARZ = Node/ESM** → pertinent Phase 2. |
| Code examples — Symfony/.NET/Ruby/PHP | `symfony-new`, `net`, `ruby-new`, `php` | P3 | Autres langages. |

## 3. Electronic Seal (P3 — non prioritaire LYCARZ)

| Page | URL | Priorité |
|---|---|:-:|
| Electronic Seal (+ 13 sous-pages) | `electronic-seal-reference`, `create-an-electronic-seal`, `simple-electronic-seal`, `advanced-electronic-seal`, `qualified-electronic-seal`, `add-fields-to-your-electronic-seal`, `follow-electronic-seal-status`, `manage-images-for-electronic-seal`, `add-caption-to-your-electronic-seal`, `multiple-use-for-electronic-seal`, `delete-an-electronic-seal-document`, `encryption-keys-generation`, `choose-the-right-security-level-for-your-seal` | **P3** |

> **Justification P3** : le **seal** (cachet serveur, sans signataire humain) ne correspond pas au besoin LYCARZ V1 (signature garage + client). À reconsidérer si LYCARZ génère des documents auto-scellés (ex. attestations système).

## 4. Document and Identity Verification (P3 majoritaire)

| Bloc | URLs | Priorité | Justification |
|---|---|:-:|---|
| Identity Verification (Image/Video) | `document-verification`, `identity-document-verification`, `video-based-identity-verification` (+ sous-pages request/retrieve/follow/testing) | P3 (P2 si AES/QES adopté) | Nécessaire seulement pour AES/QES (V2+). |
| Watchlist Screening | `watchlists-verification` + sous-pages | P3 | KYC/AML — hors périmètre auto. |
| Proof of Address | `proof-of-address-verification` + sous-pages | P3 | |
| Bank Account checks (+ SEPAmail) | `bank-account-details-verification`, `bank-account-lookup-verification` + sous-pages | P3 | |
| Company Registry Verification | `company-verification` + sous-pages | P3 (🟡 P2 pour B2B) | **Pourrait servir** à vérifier une société cliente (LYCARZ = B2B auto). À évaluer. |
| Document Analysis | `document-analysis` + sous-pages | P3 | |
| Name Matching rules | `person-matching-rules` | P3 | |
| Verification Audit Trail | `verification-audit-trails` | P3 | |

## 5. Workflows (P3 — LYCARZ a son propre moteur)

| Page | URL | Priorité |
|---|---|:-:|
| Workflows + Templates + Sessions + Collect (+ ~12 sous-pages) | `workflows`, `workflow-templates`, `workflow-sessions`, `understand-workflow-session-statuses`, `unblock-a-workflow-session`, `how-to-guide-create-execute-your-first-workflow-session`, `workflow-session-links`, `understand-applicant-statuses`, `customize-worfklow-collect-experience`, `iframe-workflow-collect`, `custom-experiences-workflow-collect`, `track-workflows-in-your-app-coming-soon` | **P3** |

> **Justification P3 (décision d'architecture)** : LYCARZ possède son **propre moteur de workflow** (CRM doc §6) et a figé un **workflow V1 manuel** (CRM doc §30.2). On **n'utilise pas** les Workflows Yousign comme orchestrateur — même logique que « CRM Brevo non utilisé ». Yousign reste un **exécutant de signature**, pas un moteur de processus métier.

## 6. ⚙ Admin

| Page | URL | Priorité | Justification |
|---|---|:-:|---|
| User | `user-1` | P2 | Utilisateurs Yousign. |
| User Invitation | `user-invitation` | P3 | |
| **Workspace** | `workspaces` | **P1** | **Pivot multi-tenant** : 1 workspace par organisation LYCARZ. ✅ |
| **Consumption** | `consumption-new` | **P1** | Comptage facturation (par signataire invité). ✅ |

## 7. 里 Integration with third-party tools (P3)

| Page | URL | Priorité |
|---|---|:-:|
| Zapier (+ 2 sous-pages) | `integration-zapier-yousign`, `use-cases-of-automation-zapier-and-yousign`, `connect-yousign-and-zapier` | P3 |
| Salesforce (+ 3 sous-pages) | `salesforce`, `getting-started`, `try-it-yourself`, `plug-play-use-cases` | P3 |

> **Justification P3** : LYCARZ intègre **directement l'API** (pattern IntegratedApi), pas via Zapier/Salesforce.

## 8. API Core concepts & tools

| Page | URL | Priorité | Justification |
|---|---|:-:|---|
| **API Keys** | `api-keys` | **P1** | Auth `Bearer`, scope org/workspace, env-bound. ✅ |
| **Environments** | `environments-new` | **P1** | Sandbox vs prod (base URLs distinctes). ✅ |
| **Webhooks** | `webhooks` | **P1** | Événements signature/signer. ✅ |
| Managing Webhook Subscriptions | `subscription` | **P1** | Création subscriptions. ✅ |
| **Handling Webhooks** | `use-webhooks-in-your-app` | **P1** | HMAC SHA-256 `x-yousign-signature-256`, IP allowlist. ✅ |
| **Failure & Retry Policy** | `failure-and-retry-policy` | **P1** | 8 retries, backoff, timeout. ✅ |
| **Pagination** | `pagination-1` | **P1** | Cursor `after`, limit 100. ✅ |
| Filters | `filters` | P2 | Filtrage des listes. |
| **Limits** | `limits-new` | **P1** | Quotas (100 signers, 50 docs, 500 fields…). ✅ |
| API & Webhook Logs | `api-webhook-logs` | P2 | Debug. |
| Compatibility & browsers | `compatibility` | P2 | |

## 9. Migration (P3 — pertinent seulement si legacy)

| Page | URL | Priorité |
|---|---|:-:|
| Migrating API V2→V3 | `migration-from-our-api-v2` | P3 |
| Migrating Webhooks V2→V3 | `migration-webhook-v2-v3` | P3 |
| V2 server stamps → V3 seals | `migrating-webhooks-v2-to-v3-copy` | P3 |
| FAQ | `frequently-asked-questions` | P2 |

---

## Synthèse priorisation

| Priorité | Nb pages (approx.) | Périmètre |
|---|:-:|---|
| **P1** | ~30 | Cœur signature + infra API (signature request/signer/document/field/levels/auth/recipient ordering/audit trail) + webhooks + environnements + clés + limites + consommation + workspace. |
| **P2** | ~45 | Templates, signing experience, notifications, smart anchors, identity verification ciblée, filtres, FAQ, code Node.js. |
| **P3** | ~92 | Electronic Seal, vérifications avancées, Workflows Yousign, intégrations tierces, migration, langages non-Node, QES. |

> **Recommandation de lecture V1** : se concentrer sur les ~30 pages **P1**. Les guides (`docs/yousign/guides/`) et l'index API (`docs/yousign/api/`) couvrent ce sous-ensemble. Le reste est inventorié pour complétude mais hors chemin critique V1.
