# Yousign — Audit fonctionnel pour LYCARZ

> READ-ONLY. Fondé sur les pages officielles récupérées (guides 01-13). ✅ confirmé / 🟡 probable / ❓ inconnu.
> **Question centrale : Yousign est-il adapté à la vision LYCARZ ?** → **Réponse courte : OUI pour la V1 Signatures (SES, B2B/B2C auto), avec un excellent alignement architectural.**

## 1. Adéquation par domaine LYCARZ

| Domaine LYCARZ | Yousign couvre ? | Détail |
|---|---|---|
| **CRM Leads** | ❌ (et c'est voulu) | Yousign ne fait pas de CRM. LYCARZ reste source de vérité (cohérent doctrine Brevo). |
| **Dossiers véhicules (Vehicle Opportunity)** | ➖ indirect | Yousign signe les **documents** d'un dossier ; le dossier reste LYCARZ. |
| **Documents métier** | 🟡 partiel | Yousign **signe** un PDF fourni ; LYCARZ **génère** le PDF (DMS §31). Bon découpage. |
| **Signatures** | ✅ parfait | Cœur de métier Yousign. SES/AES/QES eIDAS, audit trail 10 ans, webhooks. |
| **Emails** | ➖ optionnel | Yousign peut notifier, mais LYCARZ a son module Email (Brevo). Recommandation : `delivery_mode=none`. |
| **IA future** | ✅ compatible | API REST complète → actions atomiques mappables. |
| **Multi-tenant** | ✅ natif | **Workspaces** = isolation par organisation (conçu pour ISV). |
| **SaaS B2B** | ✅ | Yousign est FR/UE, eIDAS, multi-workspace, consumption par workspace. |

## 2. Ce que Yousign fait **parfaitement** (✅)

- **Signature électronique eIDAS** (SES/AES/QES), niveau **par signataire**.
- **Audit trail probant** : PDF + JSON, rétention **10 ans** (Arkhineo).
- **Webhooks robustes** : HMAC SHA-256, 8 retries backoff, dédup `event_id`, IP allowlist.
- **Multi-tenant** via **Workspaces** (isolation documents par org).
- **Signature parallèle ou ordonnée** configurable (`ordered_signers`) → **colle à la décision V1 sans ordre**.
- **Sandbox** gratuit (pendant trial) pour développer.
- **Consumption API** par workspace → pilotage coût par organisation.

## 3. Ce que Yousign fait **partiellement** (🟡)

- **Génération documentaire** : Yousign a des **Templates**, mais LYCARZ garde son moteur (DMS) → on n'utilise pas les Templates Yousign pour le contenu.
- **Notifications email** : possibles mais **fragmenteraient** le canal email LYCARZ → préférer Brevo.
- **Placement de champs** : par coordonnées API **ou** Smart Anchors — fonctionnel, mais nécessite des positions définies par LYCARZ.
- **Visibilité documents par signataire** : ✅ mais **Pro/Scale** uniquement.

## 4. Ce que Yousign **ne fait pas** (❌, LYCARZ doit développer)

- **CRM / dossiers / leads** → LYCARZ.
- **Génération de PDF métier à partir de données** (Field Registry, variables, obsolescence) → LYCARZ DMS §31.
- **Bibliothèque documentaire** (arborescence Lead) → LYCARZ §34.7.
- **Orchestration workflow métier** (statuts dossier) → LYCARZ moteur §6 (workflow V1 manuel §30.2).
- **Identité d'envoi email garage** (Email Identities OTP) → LYCARZ + Brevo.
- **Snapshot de configuration de signature** (immuabilité §32.2) → logique LYCARZ (Yousign fournit l'exécution, LYCARZ fige le `signatureRequestId` + config).

## 5. Fonctionnalités **à intégrer en V1** vs **reportées**

| V1 (SES, signature simple) | Reporté V2+ |
|---|---|
| Signature Request (create/activate) | AES/QES (vérif identité) |
| 2 signers SES (garage + client) | Identity/Video verification |
| Upload PDF généré (signable) | iFrame de signature embarquée |
| Fields signature par coordonnées | Templates Yousign |
| `delivery_mode=none` + Brevo | Reminders Yousign |
| Webhooks done/declined/expired | Electronic Seal |
| Audit trail download + archivage | Workflows Yousign (jamais — LYCARZ a le sien) |
| Workspace par organisation | Visibilité doc par signataire (Pro/Scale) |
| Consumption tracking | Company verification B2B (à évaluer) |

## 6. Fonctionnalités **inutiles ou dangereuses** pour LYCARZ

| Fonctionnalité | Verdict | Raison |
|---|---|---|
| **Workflows Yousign** | ❌ à ne pas utiliser | Doublon du moteur LYCARZ ; déplacerait la logique métier chez le provider (anti-pattern, cf. doctrine). |
| **Templates Yousign (contenu)** | ⚠️ éviter | Doublon du DMS LYCARZ ; rompt le code-first. |
| **Notifications email Yousign** | ⚠️ éviter | Fragmente le canal email (2 expéditeurs/historiques). |
| **Electronic Seal** | ➖ hors scope | Pas de signataire humain ; pas le besoin V1. |
| **Identity/Watchlist/Bank verifications** | ➖ hors scope V1 | Lourd, coûteux ; seulement si AES/QES requis. |

## 7. Conclusion fonctionnelle

✅ **Yousign est bien adapté à la vision LYCARZ** comme **provider de signature pur** :
- Il **exécute** la signature (request → signers → fields → audit trail) et **observe** (webhooks).
- LYCARZ **décide, génère, stocke, orchestre** — exactement la même doctrine que pour Brevo.
- Le découpage est propre : **provider-agnostic** (§27.13) respecté, aucune vérité métier déplacée.

> **Réserve** : la **valeur juridique du niveau SES** pour un bon de commande automobile en France doit être validée par un **avis juridique** (hors périmètre API). Si AES requis → surcoût + vérification d'identité (V2).
