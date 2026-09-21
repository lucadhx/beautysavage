# Webhooks transactionnels Brevo

> **⚠️ ARCHITECTURE SUPPRIMÉE — document conservé pour l'histoire.**
>
> Le webhook Brevo **local** décrit ici n'existe plus. Les e-mails de ce projet
> partent du compte Brevo **du Panel**, et les événements de livraison suivent le
> COMPTE : ils arrivent au Panel, qui les reprojette par le pont
> (`EMAIL_DELIVERED` / `EMAIL_BOUNCED`). Il n'y a plus de route
> `/webhooks/brevo/transactional/:mode`, plus de clé Brevo locale, plus de secret
> de webhook Brevo.
>
> Chemin actuel : [INTEGRATED_API.md](INTEGRATED_API.md#brevo--e-mail) ·
> [PANEL_BRIDGE.md](PANEL_BRIDGE.md) · [PROTOCOL.md](PROTOCOL.md#incident--e-mail).


Configuration, événements souscrits, endpoint. Voir
[EMAIL_DELIVERY_TRACKING.md](EMAIL_DELIVERY_TRACKING.md) (moteur de suivi) et
[BREVO_WEBHOOK_SECURITY.md](BREVO_WEBHOOK_SECURITY.md) (authentification).

## Type de webhook

Un seul type dans ce lot : **`transactional`** (les webhooks `marketing` et
`inbound` sont hors périmètre). Traitement **unitaire** : `batched:false`.

> Brevo supporte aussi les webhooks **batchés** (un POST regroupant plusieurs
> événements). Ils sont **volontairement exclus** : le traitement unitaire simplifie
> l'idempotence, l'observabilité, le rapprochement et le diagnostic. L'endpoint
> tolère néanmoins un tableau par prudence.

## Événements souscrits (config-time, camelCase)

À passer dans `events` de `POST /v3/webhooks`
([`SUBSCRIBED_CONFIG_EVENTS`](../backend/src/utils/brevoTransactionalEventRegistry.js)) :

```
sent, request, delivered, deferred, softBounce, hardBounce, blocked, spam,
invalid, error, unsubscribed, opened, uniqueOpened, click
```

Pour un e-mail transactionnel, `request` est l'événement « demande acceptée »
(≈ notre `SENT`) ; `sent` apparaît surtout côté SMS/config-time. Les deux sont
normalisés (`ACCEPTED`/`SENT`) et n'écrasent pas un statut plus avancé.

## Payload reçu (payload-time)

Champs utilisés : `event` (snake_case), `message-id` (rapprochement), `email`/`to`,
`ts_event`/`ts`/`ts_epoch`/`date` (date), `reason`, `bounce_type`, `error_code`,
`tag`, `template_id`, `link`. Les autres champs sont ignorés ; rien de sensible
n'est persisté (cf. `rawPayloadSafe`).

## Endpoint

`POST /api/webhooks/brevo/transactional/:mode` — `:mode` ∈ `test|prod`,
authentification **Bearer** (cf. sécurité). Réponse `200 { received:true }`.

## Configuration & synchronisation

La création/synchronisation distante du webhook est gérée par
[`brevoWebhookConfig.service.js`](../backend/src/services/brevo/brevoWebhookConfig.service.js),
piloté depuis la **section « Webhook transactionnel » de la carte Brevo** (Manager
DEV) via `/api/dev/brevo-webhook-config/:mode` :

- **Configurer / Synchroniser** : crée le webhook s'il manque, l'adopte s'il existe
  déjà, le met à jour s'il diverge — jamais de doublon.
- **Vérifier la configuration** : diagnostic non destructif (compare URL/événements/
  auth, sans exposer le secret).
- **Régénérer le secret** : rotation à double clé (fenêtre de transition).
- **Désactiver** : supprime le webhook distant (jamais implicitement).

Le secret Bearer est le credential IntegratedAPI **`webhookSecret`** (par mode,
chiffré), généré automatiquement à la première synchronisation si absent.

**Première activation idempotente.** Un compte Brevo neuf n'a **aucun** webhook :
`GET /v3/webhooks` renvoie alors un **400 « Webhook record does not exist »** (et
non une liste vide). C'est traité comme une **liste vide**, pas une erreur — le
premier clic « Activer le suivi » initialise le secret, crée le webhook distant,
enregistre l'identifiant et renvoie `CONFIGURED`. Deux clics (même concurrents) ne
produisent **qu'un** webhook (sérialisation par mode). Codes d'erreur distincts :
`BACKEND_URL_NOT_CONFIGURED`, `URL_NOT_PUBLIC`, `BREVO_API_KEY_MISSING`,
`BREVO_API_UNAUTHORIZED`, `BREVO_WEBHOOK_LIMIT_REACHED`, `BREVO_REMOTE_ERROR`,
`WEBHOOK_CONFIGURATION_CONFLICT` — jamais un 502 opaque pour une config absente.

## Contradictions relevées (audit)

- ⚠️ **Aucune signature HMAC** côté Brevo (≠ Stripe/Yousign). → Bearer, pas de
  signature inventée.
- ⚠️ **Deux espaces de noms** d'événements (camelCase config-time vs snake_case
  payload-time) — ex. `invalid` (config) devient `invalid_email` (payload). Le
  registre mappe les deux.
- ⚠️ **Pas d'id d'événement unique** : `id` = id du webhook. → clé d'idempotence
  composée.
- 🟡 Plages IP Brevo **à confirmer** avant allowlist prod.

## Reste à faire

Webhook **batché** (exclu volontairement) et **recette réelle** de bout en bout —
cf. [BREVO_WEBHOOK_REAL_TEST_CHECKLIST.md](BREVO_WEBHOOK_REAL_TEST_CHECKLIST.md).
