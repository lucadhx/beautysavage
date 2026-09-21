# Yousign — Delivery mode & récupération des liens de signature (référence confirmée)

> **Créé 2026-06-27** à partir du **scan API Reference live** (`developers.yousign.com`). Sources : `docs/manage-signature-link-delivery`, `docs/notification-managed-by-yourself-1`, `docs/delivery-mode`, `reference/get-signers-signersid-1`, `reference/post-signature_requests-signaturerequestid-activate-1`.
> **Statut** : ✅ CONFIRMÉ sauf mention contraire. **Lève le verrou QDS6** (« lien de signature en `delivery_mode=none` »).

## 1. Le fait central (résout QDS6)

✅ **Oui, LYCARZ peut récupérer le lien de signature individuel de chaque signataire, dès la V1, en `delivery_mode=none`.**

- Champ : **`signature_link`** (URL, ex. `https://yousign.app/signatures/ae1b52cf…`) sur l'objet **Signer**.
- Expiration : **`signature_link_expiration_date`**.
- Pour les **Approvers**, l'équivalent est **`approval_link`**.

## 2. Où et quand récupérer le lien

| Source | Contenu | Moment |
|---|---|---|
| Réponse de **`POST /signature_requests/{id}/activate`** | tableau `signers[]` avec `signature_link` (signataires **non ordonnés** = tous d'un coup) | **à l'activation** |
| **`GET /signature_requests/{id}/signers/{signerId}`** (Get a Signer) | `signature_link` + `signature_link_expiration_date` | **après activation** |
| **`GET /signature_requests/{id}/signers`** (List signers) | idem par signataire | après activation |

- ❗ **Avant activation** : `signature_link` = **`null`**.
- **Unique par signataire** : ✅.
- **Validité** : **48 h** par défaut (ajustable **1-72 h** via support Yousign). Si expiré → **re-`GET` le signer** régénère un lien frais.
- **Disponible dans les deux modes** : `none` **et** `email` (en `email`, Yousign envoie aussi l'email). Essentiel en `none`.

## 3. Signataires ordonnés (`ordered_signers=true`)

- À l'activation, **seul le 1ᵉʳ** signataire a un `signature_link` actif.
- S'abonner au webhook **`signer.notified`** : il se déclenche quand le signataire suivant devient actif → récupérer son lien via `GET signer`.
- ⚠️ **V1 LYCARZ = signature parallèle** (`ordered_signers=false`) ⇒ **tous les liens disponibles dès l'activation**, pas de séquence à gérer.

## 4. Workflow LYCARZ recommandé (Mode B — envoi via Brevo)

```txt
POST /signature_requests            (draft, delivery_mode=none)
   → POST documents (PDF, parse_anchors)
   → POST signers (Participants résolus)
   → POST fields  (ou Smart Anchors)
POST .../activate
   → réponse : signers[].signature_link  (parallèle V1 = tous)
   → LYCARZ envoie chaque lien via le module Email/Brevo (identité garage)
webhooks signer.done / signature_request.done → timeline + archivage
```

## 5. Toujours non documenté (à valider sandbox)

- **Reminders automatiques Yousign en `delivery_mode=none`** : non confirmé (la relance reste à gérer côté LYCARZ — cohérent avec Brevo).
- **Header d'idempotence** au niveau request (dédup webhook OK via `event_id`).
- Effet exact d'un **`declined`** sur la request et les autres signataires.

## 6. Impact produit

✅ **Le Mode B (LYCARZ envoie les liens via Brevo) est viable dès la V1.** Le **Mode C hybride** (V1 `email` puis V2 `none`) n'est plus une nécessité technique : `none` est utilisable immédiatement. La bascule reste un **choix produit** (un seul canal/identité d'envoi via Brevo) confirmé par la doc.
