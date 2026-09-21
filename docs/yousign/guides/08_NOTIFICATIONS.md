# Yousign — Notifications (guide LYCARZ)

> READ-ONLY. Source : `email-notifications`, `deactivate-email-notifications`, `email-customization`, `reminders`, `manage-notification-delivery-failures`. ✅/🟡.

## Description

✅ Yousign peut envoyer les emails de signature (invitation, relance) — ou les laisser à votre charge via `delivery_mode=none` (guide 07).

## Concepts & Capacités

- ✅ **Désactivation** des notifications email Yousign (`deactivate-email-notifications`).
- 🟡 **Personnalisation** du contenu email (sujet/corps), expéditeur (nom org/workspace/custom).
- 🟡 **Reminders** (relances automatiques) configurables.
- 🟡 **Notification delivery failures** : événements webhook `notification_delivery_failed` (confirmé côté webhooks).

## Cas d'usage LYCARZ — décision

- ⚠️ **LYCARZ a un module Email transversal** (CDC Communication §3.0) via **Brevo**. Faire envoyer les emails par Yousign **fragmenterait** le canal email (2 expéditeurs, 2 historiques).
- **Recommandation** : `delivery_mode=none` + **désactiver** les notifications Yousign → LYCARZ envoie le lien de signature **via Brevo**, avec l'**Email Identity** du garage (CDC Communication Partie 18). Un seul canal, un seul historique, une seule identité d'envoi.
- **Exception** : si l'obtention des liens par signataire en mode `none` s'avère complexe (cf. guide 07 question ouverte), envisager `delivery_mode=email` en **fallback V1** puis migrer.

## Impact CRM / Communication

- Aligne signature et communication sous le **même canal email** (Brevo) → cohérence d'identité, de réputation, d'historique dossier.

## Impact IA

- `sendSignatureEmail` reste une action du **module Email** LYCARZ, pas de Yousign.

## Questions ouvertes

- ❓ En `delivery_mode=none`, la réponse expose-t-elle le **signature link** par signer ? (bloquant pour l'option Brevo — à confirmer Phase 2).
- ❓ Les **reminders** Yousign sont-ils utilisables même en `delivery_mode=none` ? (probablement non).

> ### ✅ MISE À JOUR 2026-06-27 (API Reference live — `docs/manage-signature-link-delivery`, `docs/notification-managed-by-yourself-1`, `docs/delivery-mode`)
> - **CONFIRMÉ** : en `delivery_mode=none`, le lien **EST exposé** — champ **`signature_link`** (+ **`signature_link_expiration_date`**) sur l'objet **Signer**. Récupérable dans : la **réponse d'`activate`** (tous les signers non ordonnés d'un coup) **ou** via **`GET /signature_requests/{id}/signers/{signerId}`** (Get a Signer). Disponible **après activation** (avant = `null`). **L'option Brevo (Mode B) n'est donc plus bloquée.** Détail : `api/signers.md` (MàJ 2026-06-27) + `YOUSIGN_DELIVERY_AND_SIGNING_LINKS.md`.
> - **CONFIRMÉ** : pour signataires **ordonnés** (`ordered_signers=true`), seul le 1ᵉʳ lien est dispo à l'activation ; s'abonner au webhook **`signer.notified`** pour récupérer le lien du signataire suivant (`GET signer`). En **V1 LYCARZ = signature parallèle** (`ordered_signers=false`) → **tous les liens dès l'activation**.
> - **MIS À JOUR** : les liens sont exposés **aussi en `delivery_mode=email`** (le champ `signature_link` est présent dans les deux modes ; en `email`, Yousign envoie aussi l'email).
> - **TOUJOURS NON DOCUMENTÉ** : usage des **reminders automatiques Yousign en mode `none`** (la relance reste à gérer côté LYCARZ — cohérent avec l'envoi via Brevo).
