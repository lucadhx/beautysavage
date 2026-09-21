# Yousign ↔ LYCARZ — Mapping des entités

> **MàJ Sprint CRM-1K (2026-06-16) — `placeFields` (gap SS-1) implémenté.** `YousignProvider.placeFields({providerRequestId, signers, fields?, runtime})` : `GET /signature_requests/{id}/documents` → docId, puis `POST /signature_requests/{id}/documents/{docId}/fields` (type `signature`, `signer_id`, `page/x/y/width/height`) — **1 champ par signataire**, AVANT `activate`. **Stratégie fallback safe** si aucune coordonnée fournie : pied de page (page 1, x=80, y=700−i·80, 180×60) — **NON juridiquement parfaite** ; placement exact = configuration future. Best-effort (un champ raté ne bloque pas les autres). Le `StubProvider.placeFields` simule (sans réseau). États SigningFlow Yousign mappés : ongoing→sent, signer.link_opened→viewed, signer.done(partiel)→partially_signed, signature_request.done→signed (PDF archivé) ou signed_pending_archive (retry), declined/expired/canceled. **Yousign prêt mais NON forcé** (SIGNATURE_PROVIDER=stub par défaut ; prod = devis/clés/DPA/juridique/config).

> **MàJ Sprint CRM-1N (2026-06-16) — relance signataires.** `provider.remind(providerRequestId)` ajouté : stub simule (sans réseau), Yousign `POST /signature_requests/{id}/reminders` (best-effort). `signature.service.remindSigningFlow` (flow actif sent/viewed/partially_signed → lastReminderAt + OpportunityEvent `signature_reminder_sent` + ActivityLog). Endpoint `POST /admin/crm/signing-flows/:id/remind`. Pas de relance simulée silencieuse (toujours via le provider + tracée).

> READ-ONLY. Cohérent avec CRM doc §30.1 (Lead → Vehicle Opportunity), §31 (DMS), §32 (Signature System V1). ✅ confirmé / 🟡 / ❓.

## 1. Chaîne de correspondance

```txt
LYCARZ                                  Yousign
──────                                  ───────
Lead (personne/société)          ─┐
  └─ Vehicle Opportunity          ─┤    (aucun équivalent — reste 100% LYCARZ)
       (dossier véhicule)          │
         └─ GeneratedDocument     ─┤
              └─ DocumentVersion  ─┼──►  Signature Request   (1 par version à signer)
                   │                │       ├─ Document        (le PDF de la version)
                   │ requiredSigners├──►    ├─ Signers         (garage, client)
                   │ (§32.1)        │       ├─ Fields          (signature garage/client)
                   │                │       └─ Audit Trail     (preuve, 10 ans)
                   └─ SigningFlow   ─┘
Organization                     ──────►  Workspace            (1 par organisation)
IntegratedApi("yousign")         ──────►  API Key (Bearer, env-bound)
WebhookEvent                     ◄──────  Webhook (HMAC SHA-256)
```

## 2. Correspondance entité par entité

| Entité LYCARZ | Entité Yousign | Relation | Vérité |
|---|---|---|---|
| `Organization` | **Workspace** | 1:1 | LYCARZ (stocke `workspaceId`) |
| `Lead` | — | aucune | **LYCARZ only** |
| `Vehicle Opportunity` (dossier véhicule) | — | aucune | **LYCARZ only** |
| `GeneratedDocument` / `DocumentVersion` (§31) | **Signature Request + Document** | 1 version → 1 request | PDF généré par LYCARZ, signé par Yousign |
| `requiredSigners` (garage/client, §32.1) | **Signers** | 1:1 | LYCARZ source (coordonnées du Lead) |
| `SigningFlow` (§27.8) | request config (`ordered_signers`, level) | mapping config | LYCARZ décide |
| Snapshot config signature (§32.2) | `signatureRequestId` + level + provider | fige à la génération | **LYCARZ** (immuable) |
| Statut signature (1/2, 2/2, §32.1) | request/signer status | dérivé via webhooks | LYCARZ projette |
| Preuve légale | **Audit Trail** (PDF+JSON, 10 ans) | téléchargé à `done` | Yousign fournit, LYCARZ archive aussi |
| `IntegratedApi("yousign")` | API Key | credentials | LYCARZ (chiffré AES-GCM) |
| `WebhookEvent` | Webhook delivery | dédup `event_id` | LYCARZ |

## 3. Informations à **synchroniser** (LYCARZ → Yousign)

- Le **PDF de la version** (`DocumentVersion`) → upload comme document signable.
- Les **coordonnées des signataires** (nom/email/téléphone garage + client) → Signers.
- Les **positions des champs** de signature → Fields.
- Le **workspace** de l'organisation → scope de la request.

## 4. Informations à **rapatrier** (Yousign → LYCARZ)

- Les **changements de statut** (webhooks) → MAJ `DocumentVersion.status` + `LeadEvent` timeline.
- Le **PDF signé final** → archivé dans le dossier véhicule + bibliothèque.
- L'**audit trail** → archivé comme preuve probante.
- La **consommation** (par workspace) → reporting finance.

## 5. Informations qui **restent dans MongoDB** (jamais chez Yousign)

- Tout le **CRM** : Lead, Vehicle Opportunity, statuts workflow, bibliothèque documentaire, communication.
- Le **moteur documentaire** : DocumentDefinition, DocumentTemplate, Field Registry, variables, obsolescence.
- Les **règles métier** : requiredSigners (décidé par DocumentDefinition), workflow manuel V1.
- Le **snapshot de configuration** (immuable §32.2) — Yousign exécute, LYCARZ se souvient.

## 6. Corrélation request ↔ document (clé)

> Pour relier un webhook Yousign au bon document LYCARZ : stocker côté LYCARZ le `signatureRequestId` Yousign sur la `DocumentVersion` (et inversement via **Custom Properties / Metadata** Yousign si besoin de retrouver le dossier depuis Yousign). 🟡 à confirmer (guide custom-properties).

## 7. Doctrine (rappel)

> **Yousign exécute la signature et fournit la preuve. LYCARZ pense, génère, décide, stocke, orchestre.** La vérité métier ne quitte jamais MongoDB. Identique à la doctrine Brevo (transport/observation, jamais vérité).
