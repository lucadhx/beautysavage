# Yousign — Risques & limites pour LYCARZ

> READ-ONLY. Niveaux : 🟢 faible · 🟡 moyen · 🟠 élevé · 🔴 critique. ✅ fondé sur faits / 🟡 déduit / ❓ à confirmer.

## 1. Limitations API (✅)

| Limite | Valeur | Niveau | Mitigation |
|---|---|:-:|---|
| Documents/request | 50 | 🟢 | Largement suffisant (1/doc). |
| Signers/request | 100 (5 sandbox) | 🟢 | 2 suffisent. |
| Fields/request | 500 | 🟢 | OK. |
| Taille document | 50 MB | 🟢 | OK pour PDF auto. |
| Lien signature | 48 h (1-72 h) | 🟡 | Prévoir relance si expiré. |
| Rate limit sandbox | 30/min | 🟡 | Suffisant dev ; pas de load test. |
| Rate limit **prod** | ❓ inconnu | 🟠 | **Confirmer avant dimensionnement.** |
| Timeout webhook | 1 s (1ʳᵉ) | 🟠 | **ACK immédiat + async obligatoire.** |
| Idempotence | ❓ | 🟠 | Confirmer ; sinon garde-fou anti-doublon côté LYCARZ. |

## 2. Limitations SaaS / billing

| Risque | Niveau | Détail |
|---|:-:|---|
| **Facturation à l'invitation** (pas complétion) | 🟠 | Lead mort = coût quand même. Plafonner par quota plan. |
| **x2 si garage facturé** | 🟠 | Double le coût/document. ❓ à clarifier. |
| **Prix € inconnus** | 🔴 | Pas de décision finale sans devis. Bloquant commercial. |
| Archivage facturé/MB | 🟡 | Estimer volumétrie ; inclus ou add-on ❓. |

## 3. Limitations multi-tenant

| Risque | Niveau | Détail |
|---|:-:|---|
| Provisioning workspace par API | ❓→🟠 | Si **app-only**, onboarding org self-service bloqué. À confirmer. |
| Limite nb workspaces/compte | ❓ | Impact scalabilité (combien de garages ?). |
| Isolation des credentials | 🟢 | Clé scopable workspace ; AES-GCM côté LYCARZ. |
| Réputation/quota partagés (compte unique) | 🟡 | Mutualisé entre garages ; suivre par workspace. |

## 4. Limitations IA

| Risque | Niveau | Détail |
|---|:-:|---|
| Lien signature en `delivery_mode=none` | 🟠 | Bloque l'envoi via Brevo si non exposé. ❓ critique. |
| Idempotence absente | 🟠 | Retries d'agent → risque de doubles requests. |
| Pas de logique métier chez Yousign | 🟢 | Voulu (doctrine). L'IA orchestre côté LYCARZ. |

## 5. Limitations signature

| Risque | Niveau | Détail |
|---|:-:|---|
| Valeur juridique **SES** pour bon de commande FR | 🟠 | **Avis juridique requis** (pas un fait API). Si AES nécessaire → vérif identité + surcoût. |
| AES/QES interdisent iFrame/custom | 🟡 | Si embarqué voulu (V2), rester SES. |
| QES lourd (vidéo + ordre + même niveau) | 🟢 (hors V1) | Non concerné V1. |
| Signature liée à une version précise | 🟢 | ✅ géré par snapshot LYCARZ §32.2. |

## 6. Dépendances critiques

| Dépendance | Niveau | Mitigation |
|---|:-:|---|
| **Lock-in provider** | 🟡 | Abstraction `ISignatureProvider` (§27.13) → Yousign substituable (DocuSign/Universign). **Ne pas coupler le métier à Yousign.** |
| Archivage légal via Arkhineo (Yousign) | 🟡 | **LYCARZ archive aussi** le PDF signé + audit trail (ne pas dépendre du provider pour la vérité). |
| Disponibilité Yousign (SLA) | ❓→🟡 | Confirmer SLA ; file d'attente côté LYCARZ si indispo. |
| RGPD / hébergement UE | 🟢 (🟡 à confirmer) | Yousign FR/UE, eIDAS — DPA à signer. |

## 7. Synthèse des risques par niveau

- 🔴 **Critique** : prix inconnus (décision commerciale impossible sans devis).
- 🟠 **Élevé** : rate limit prod inconnu, timeout webhook 1 s, idempotence ❓, lien signature en `delivery_mode=none`, facturation à l'invitation, valeur juridique SES.
- 🟡 **Moyen** : lock-in (mitigé par abstraction), multi-tenant workspaces (provisioning ❓), réputation partagée, archivage redondant.
- 🟢 **Faible** : limites quantitatives API, QES (hors V1), snapshot version (déjà géré).

> **Aucun risque rédhibitoire technique** pour la V1. Les risques 🔴/🟠 sont soit **commerciaux** (devis), soit **résolubles par confirmation Phase 2** (rate limit, idempotence, lien signature, provisioning).

> ### ✅ MISE À JOUR 2026-06-27 (scan API Reference live — risques abaissés)
> | Risque | Avant | Après | Justification |
> |---|:-:|:-:|---|
> | **Lien signature en `delivery_mode=none`** (§4) | 🟠 ❓ | 🟢 **RÉSOLU** | Champ **`signature_link`** sur Signer, exposé à l'`activate` + `GET signer`, 48 h. **Plus bloquant pour Brevo.** |
> | **Smart Anchors / placement des zones** | 🟠 ❓ (audit zones) | 🟢 **RÉSOLU** (syntaxe) | `{{signer_index\|type\|w\|h}}` + `parse_anchors`/`total_anchors`, **PDF/DOCX**. Reste sandbox : détection sur PDF-from-HTML. |
> | **Rate limit prod** (§1) | 🟠 ❓ | 🟡 **PRÉCISÉ** | Baseline doc ≈ **30/min · 200/h** ; **personnalisable** par demande ; diffère sandbox/prod. Confirmer le quota négocié. |
> | **Idempotence** (§1) | 🟠 ❓ | 🟠 **partiel** | Dédup **webhook** via `event_id` confirmée ; **header d'idempotence niveau request TOUJOURS NON DOCUMENTÉ** → garde-fou anti-doublon côté LYCARZ (1 request/Document-Version). |
> | **Origine repère coordonnées** | — | 🟡 **NON DOCUMENTÉ** | Unité = **px** confirmée ; origine haut/bas non documentée → **contournée** en utilisant les Smart Anchors. |
>
> Détails : `../audits/YOUSIGN_API_REFERENCE_FULL_SCAN_AND_CRM_MAPPING_UPDATE.md`.
