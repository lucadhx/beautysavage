# Rapport final — Lot 7 : webhooks Brevo & suivi réel des livraisons

> **⚠️ RAPPORT HISTORIQUE — NE PAS SUIVRE COMME PROCÉDURE.**
> Ce document décrit un état du système à la date de sa rédaction. Plusieurs
> architectures qu'il mentionne ont été supprimées depuis — notamment la page
> IntegratedAPI du Manager, les credentials Brevo locaux et le webhook Brevo
> local. Autorités actuelles : [ARCHITECTURE.md](ARCHITECTURE.md) ·
> [PROTOCOL.md](PROTOCOL.md) · [INTEGRATED_API.md](INTEGRATED_API.md) ·
> [PANEL_BRIDGE.md](PANEL_BRIDGE.md).


Branche `feat/brevo` · 11 commits (`ae99dfe` → HEAD) · aucun merge `main`.

## Objectif

Distinguer réellement **accepté pour envoi** (`SENT`) de **délivré** (`DELIVERED`)
et de tout le reste (différé, rebonds, bloqué, invalide, spam, désinscription,
ouvertures, clics), via le parcours : Brevo → webhook authentifié → normalisation →
événement idempotent → rapprochement → transition → historique → Manager.

## Audit — contradictions Brevo relevées

1. **Aucune signature HMAC** (≠ Stripe/Yousign) → **Bearer token**, jamais de
   signature inventée.
2. **Deux espaces de noms** : config-time camelCase (`softBounce`, `invalid`,
   `uniqueOpened`) vs payload-time snake_case (`soft_bounce`, `invalid_email`,
   `unique_opened`, `error`, `proxy_open`). Le registre mappe **les deux**.
3. **Pas d'id d'événement unique** (`id` = id du webhook) → clé d'idempotence
   **composée**, sans PII.
4. `message-id` (webhook) vs `messageId` (`/smtp/email`) : chevrons `<…>` tolérés
   des deux côtés.

## Livré

### Backend — moteur
- Normalisation des deux espaces de noms (`brevoTransactionalEventRegistry.js`).
- Machine d'état **pure et déterministe** (`brevoDeliveryTransitions.js`) :
  précédence sûre au désordre, négatifs terminaux protégés, engagement séparé.
- Journal fournisseur idempotent `BrevoWebhookEvent` + timeline `EmailDeliveryEvent`.
- `EmailDelivery` étendu (statuts fins, `engagement`, index composé).
- Ingestion (`brevoWebhookIngest.service.js`) : normalise → persiste (idempotent) →
  rapproche par `(provider, mode, messageId)` → applique → timeline ; ne stocke que
  des champs sûrs. Réconciliation bornée + CLI `brevo:webhooks:reconcile`.
- Endpoint `POST /api/webhooks/brevo/transactional/:mode` (Bearer, corps brut
  512 ko, 2xx durable / 5xx récupérable / 401 neutre).

### Backend — configuration & rotation
- `brevoWebhookConfig.service.js` : URL canonique dérivée de la SEULE source de
  vérité (« Configuration Système → Réseau » = `SystemConfiguration.network.backendUrl`,
  la même que le test réseau ; aucun repli localhost, erreur explicite si absente),
  liste distante, identification (id → URL → description unique), création, **adoption**,
  mise à jour sur divergence, détection de suppression externe, jamais de doublon,
  **limite Brevo** explicite, diagnostic non destructif.
- **Rotation du secret** : double clé + fenêtre de transition ; `verifyBrevoWebhookBearer`
  accepte l'ancien secret jusqu'à expiration.
- Routes DEV `/api/dev/brevo-webhook-config/:mode` (sync/diagnose/rotate/disable).

### Backend — API DEV de consultation
- `GET /api/dev/email-deliveries` (+`/:id` avec timeline, +`/:id/events`).
- `GET /api/dev/brevo-webhook-events` (+`/:id`). Filtres stricts, masquage, aucun
  secret/PII/payload brut.

### Manager
- Page `/dev/livraisons-email` : liste filtrable, détail, timeline, engagement avec
  **avertissement de fiabilité** (« détectée », jamais « lu »). `SENT` reste
  « Accepté par Brevo », neutre.
- Section « Webhook transactionnel » dans la carte Brevo : état par mode + actions
  Configurer/Vérifier/Régénérer le secret/Désactiver. Jamais de secret affiché.

## Sécurité & confidentialité

Bearer par mode (chiffré, timing-safe, jamais loggé) ; réponses neutres ; aucune
PII/token dans la clé d'idempotence ni le payload stocké (URL réduite au domaine) ;
`EventActionExecution SUCCEEDED` jamais retransformé en `FAILED` ; ouvertures/clics
n'altèrent jamais le statut.

## Validation

- **Backend** : suite complète verte, dont `brevo-webhook.test.js` (98 assertions :
  auth+rotation, idempotence, normalisation, rapprochement, transitions, engagement,
  confidentialité, sync distante). Régressions (email-delivery, domain-events,
  contact, stripe, yousign, contrats…) : **0 échec**. `app.js` s'importe proprement.
- **Manager** : toutes les suites pures vertes (dont `emailDeliveries` 38 +
  `brevoWebhook` 16). `tsc -b` : **0 erreur**. `vite build` : **OK**.

## Limites restantes (déclarées)

- **Recette réelle de bout en bout NON exécutée** — cf.
  [BREVO_WEBHOOK_REAL_TEST_CHECKLIST.md](BREVO_WEBHOOK_REAL_TEST_CHECKLIST.md).
- Webhooks **batchés** volontairement exclus.
- Plages IP Brevo à confirmer avant allowlist prod.

> **`SENT` = Brevo a accepté l'envoi ; seul un webhook `DELIVERED` marque la livraison
> comme délivrée.** Aucun webhook transactionnel Brevo réel n'a été validé de bout en
> bout pendant ce lot.
