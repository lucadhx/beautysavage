# Yousign — Recommandation finale pour LYCARZ

> READ-ONLY. Synthèse des audits fonctionnel / technique / billing / AI-ready / mapping / risques. ✅ confirmé / 🟡 / ❓.

## Question : si nous démarrions aujourd'hui la V1 CRM Documents Signatures, recommanderais-tu Yousign ?

### Réponse : **OUI — recommandé comme provider de signature V1**, sous réserve de **3 confirmations** (devis, rate limit prod, lien signature en mode `none`).

---

## 1. Pourquoi (les raisons fortes, ✅)

1. **FR/UE & eIDAS natif** — SES/AES/QES conformes, audit trail probant **10 ans** (Arkhineo). Idéal pour la vente automobile française (B2B/B2C).
2. **Alignement architectural quasi parfait** — le modèle Yousign (Signature Request → Signers → Fields → Audit Trail) **mappe directement** sur le `SigningFlow` / `Signature System V1` LYCARZ (§27, §32).
3. **Signature parallèle native** (`ordered_signers=false`) — **confirme la décision V1 « sans signatureOrder »** sans contorsion.
4. **Multi-tenant natif** — **Workspaces** conçus pour ISV = isolation par organisation, prête à l'emploi.
5. **Intégration `IntegratedApi` triviale** — modèle **identique à Stripe** (clés env-bound, `dual_environment`, Bearer, webhooks HMAC, sandbox URL). Réutilise le pattern `stripe.service.js` déjà éprouvé.
6. **Webhooks robustes** — HMAC SHA-256, 8 retries, dédup `event_id` → **réutilise le pattern Stripe/Multi-Diffusion** (raw-body, `WebhookEvent`).
7. **API-first / AI-ready** — tout en REST → actions atomiques mappables (§30.4), provider-agnostic préservé (§27.13).
8. **Provider-agnostic respecté** — Yousign reste un **exécutant** ; aucune vérité métier déplacée (même doctrine que Brevo).

## 2. Avantages

| Avantage | Impact LYCARZ |
|---|---|
| eIDAS + archivage 10 ans | Valeur probante des documents signés |
| Workspaces | Multi-tenant sans effort |
| Stripe-like | Intégration rapide, pattern connu |
| Sandbox gratuit (trial) | Dev sans coût initial |
| Consumption API par workspace | Refacturation / quota par plan |
| SES sans vérif identité | Parcours client fluide |

## 3. Inconvénients

| Inconvénient | Gravité | Note |
|---|---|---|
| Prix € non publics | 🔴 | Devis obligatoire avant engagement. |
| Facturation à l'invitation (pas complétion) | 🟠 | Coût sur leads non convertis. |
| x2 par document si garage facturé | 🟠 | À clarifier. |
| Rate limit prod inconnu | 🟠 | À confirmer. |
| Lien signature en `delivery_mode=none` ❓ | 🟠 | Bloquant pour envoi via Brevo si non exposé. |
| Templates/Workflows Yousign à ne pas utiliser | 🟢 | Doublon du métier LYCARZ — éviter (pas un défaut, une discipline). |

## 4. Risques (rappel)

- 🔴 Commercial : prix inconnus → **devis**.
- 🟠 Technique (résolubles Phase 2) : rate limit prod, idempotence, lien signature mode `none`, timeout webhook 1 s.
- 🟠 Juridique : valeur SES pour bon de commande FR → **avis juridique**.
- 🟡 Lock-in : **mitigé** par `ISignatureProvider` (Yousign substituable).

## 5. Adaptations à prévoir (côté LYCARZ, documentaire)

1. **`IntegratedApi("yousign")`** en `runtimeModel: "dual_environment"` (comme Stripe), tokens `api_key` test/prod + `webhook_secret`.
2. **`initYousignFromIntegratedApi()`** au boot (pattern `stripe.service.js`), fallback env.
3. **Webhook controller** raw-body avant `express.json()`, HMAC `x-yousign-signature-256`, `WebhookEvent` dédup, ACK <1 s + traitement async (queue).
4. **`delivery_mode=none`** + envoi du lien via **module Email/Brevo** (CDC Communication §3.0) — **si** le lien est exposé (sinon fallback `email`).
5. **1 Workspace par Organization** ; `workspaceId` stocké côté LYCARZ.
6. **Snapshot de configuration** (§32.2) : stocker `signatureRequestId` + level + provider sur la `DocumentVersion`.
7. **Archivage redondant** : LYCARZ stocke aussi le PDF signé + audit trail (ne pas dépendre du provider pour la vérité).
8. **Génération PDF côté LYCARZ** (DMS §31) ; Yousign reçoit le PDF + champs de signature par coordonnées — **ne pas** utiliser Templates Yousign.
9. **SES par défaut** ; AES/QES = V2 (si exigence juridique).

## 6. Décisions du CDC à confirmer/ajuster

| Décision CDC | Compatible Yousign ? | Note |
|---|---|---|
| Workflow V1 manuel (§30.2) | ✅ | Yousign ne pilote pas le workflow ; webhooks tracent seulement. |
| Signatures V1 sans `signatureOrder` (§32.1) | ✅ | `ordered_signers=false`. |
| Documents par dossier véhicule (§30.1) | ✅ | 1 request par DocumentVersion. |
| Bibliothèque au niveau Lead (§34.7) | ✅ | Indépendant de Yousign. |
| AI Ready obligatoire (§30.4) | ✅ | API-first, actions atomiques, audit. |
| Provider-agnostic (§27.13) | ✅ | Yousign = 1 implémentation de `ISignatureProvider`. |
| Snapshot config immuable (§32.2) | ✅ | LYCARZ fige ; Yousign exécute. |

> **Aucune décision du CDC n'est à remettre en cause.** Yousign s'insère dans l'architecture existante sans la modifier.

## 7. Verdict

> ✅ **Recommandation : retenir Yousign comme premier `ISignatureProvider` de LYCARZ pour la V1**, derrière l'abstraction provider-agnostic. C'est le choix **le plus cohérent** (FR/UE, eIDAS, Stripe-like, multi-tenant natif), le **plus rapide à intégrer** (pattern Stripe), et le **moins risqué techniquement**.
>
> **Conditions de Go** : (1) obtenir un **devis** (prix + statut signataire garage) ; (2) confirmer **rate limit prod** + **idempotence** + **récupération du lien de signature en `delivery_mode=none`** via un mini-audit API/Postman en sandbox ; (3) **avis juridique** sur la valeur SES pour les documents de vente automobile.
>
> **Stratégie de prudence** : garder l'abstraction `ISignatureProvider` stricte pour pouvoir substituer DocuSign/Universign si le devis ou un point bloquant le justifiait. Commencer par un **InternalStubSignatureProvider** (dev) puis brancher Yousign.

## 8. Prochaines étapes documentaires (avant tout code)

> **Mise à jour** : l'API Reference complète a confirmé tous les **endpoints/méthodes** (cf. `api/YOUSIGN_API_REFERENCE_INDEX.md`). Plusieurs questions ouvertes techniques sont **résolues** : provisioning workspace par API, cycle activate/cancel/reactivate, signature serveur, webhooks subscription, download PDF signé, templates lecture-seule. Restent à confirmer en Phase 2 : **bodies détaillés, idempotence, rate limit prod, lien de signature en `delivery_mode=none`**.

> ### ✅ MISE À JOUR 2026-06-27 (scan API Reference live — 2 verrous levés)
> Deux des trois « confirmations » techniques de la condition de Go sont **résolues par la documentation** (plus besoin de sandbox pour les *trancher*, sandbox = validation finale) :
> 1. **Lien de signature en `delivery_mode=none` — RÉSOLU** : champ **`signature_link`** (+ `signature_link_expiration_date`) sur l'objet **Signer**, exposé dans la réponse d'**`activate`** et via **`GET signer`**, après activation, unique par signataire, 48 h. **⇒ Mode B (envoi via Brevo) viable en V1.** (résout QDS6, point 4 des adaptations §5.)
> 2. **Smart Anchors — RÉSOLU** : syntaxe `{{signer_index|type|width|height|…}}` documentée, `parse_anchors:true` + `total_anchors`, **PDF/DOCX supportés**. ⇒ le **bloc Signature LYCARZ peut devenir une ancre texte** (robuste à la mise en page), évitant l'incertitude sur l'origine des coordonnées. Reste à valider en sandbox : **détection sur PDF généré depuis HTML** (texte sélectionnable, 1 ligne).
> **Restent ouverts** : **rate limit prod exact** (baseline doc ≈ 30/min · 200/h, personnalisable), **idempotence niveau request** (dédup webhook OK via `event_id`), **origine du repère coordonnées** (contournée si Smart Anchors), **devis** + **avis juridique SES**. Détails : `../audits/YOUSIGN_API_REFERENCE_FULL_SCAN_AND_CRM_MAPPING_UPDATE.md`.

1. **Phase 2 — Audit API détaillé** (bodies/erreurs/idempotence via Postman + pages `/reference/*` détaillées) : compléter `docs/yousign/api/*`.
2. **Devis commercial Yousign** → compléter `YOUSIGN_BILLING_AUDIT.md` avec les prix réels.
3. **Test sandbox** (lecture) : valider le flux create→activate→sign→webhook→audit trail.
4. **Avis juridique** SES vente automobile.
5. **Décision Go/No-Go** documentée.
