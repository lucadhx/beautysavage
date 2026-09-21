# Sécurité des webhooks Brevo

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


Point critique : **Brevo ne documente AUCUNE signature HMAC** pour ses webhooks
(confirmé : `docs/Brevo/guides/11_SECURITY.md`, miroir de la doc officielle). C'est
une divergence majeure avec Stripe et Yousign, qui signent leur corps en HMAC-SHA256.

## Décision — Bearer token, pas de signature inventée

On **n'invente pas** de « signature Brevo ». Le mécanisme retenu est un **Bearer
token**, le plus fort des trois mécanismes documentés par Brevo (Basic Auth,
Bearer, en-têtes custom) :

- configuré à la création du webhook : `auth: { type: "bearer", token }` ;
- renvoyé par Brevo dans l'en-tête `Authorization: Bearer <token>` ;
- vérifié **avant tout traitement métier**
  ([`brevoWebhookAuth.service.js`](../backend/src/services/brevo/brevoWebhookAuth.service.js)).

## Propriétés de la vérification

- **Secret par mode**, chiffré au repos : credential IntegratedAPI `webhookSecret`
  dans `modes.{TEST|PROD}.credentials` (AES-256-GCM, cf. [INTEGRATED_API.md](INTEGRATED_API.md)).
- **Comparaison résistante au timing** : garde de longueur puis
  `crypto.timingSafeEqual`, comme Stripe/Yousign.
- **Token absent → refusé. Token incorrect → refusé.** Aucun des deux ne fuite.
- **Le secret n'est jamais journalisé** ni renvoyé par l'API.
- **Réponse neutre** aux appels non authentifiés : `401 { received:false }`, sans
  distinguer « non configuré » de « token invalide ». Aucun détail de config, aucune
  stack trace.
- L'endpoint **ne dépend d'aucune session Manager** (public au sens réseau).

## Endpoint

`POST /api/webhooks/brevo/transactional/:mode` — `mode` ∈ `test|prod`. Le mode
**vient de la route**, jamais du payload. Monté **avant `express.json()`** (corps
brut, cohérent avec Stripe/Yousign), limite stricte **512 ko** (traitement unitaire,
`batched:false`).

## Codes de réponse

| Situation | Code |
|---|---|
| Authentifié + accepté (ou doublon reconnu) | `200 { received:true }` |
| Mode de route inconnu | `404 { received:false }` |
| Auth manquante/invalide/non configurée | `401 { received:false }` (neutre) |
| JSON illisible | `400 { received:false }` |
| Erreur de **persistance** | `500 { received:false }` → Brevo réessaie |

Le `2xx` n'est renvoyé que lorsque l'événement est **durablement accepté** (persisté)
ou reconnu comme **doublon**. Une erreur de persistance renvoie `5xx` pour que Brevo
rejoue — l'idempotence protège du double traitement.

## Durcissement complémentaire (recommandé, hors code)

- **IP allowlist** des plages Brevo au niveau reverse-proxy (`1.179.112.0/20`,
  `172.246.240.0/20` — **à confirmer** avant prod, cf. `docs/Brevo/guides/11_SECURITY.md`).
- **URL HTTPS publique** (jamais `localhost`). En développement : ngrok / URL
  publique. Le webhook TEST doit être **distinct** du webhook PROD.

## Rotation du secret (double clé)

Livrée. La rotation (`POST /api/dev/brevo-webhook-config/:mode/rotate-secret`)
suit un ordre qui évite toute interruption : **générer** un nouveau secret →
**mettre à jour l'auth du webhook chez Brevo** → **basculer** le secret local
(nouveau = courant, ancien = `webhookSecretPrevious`) avec une **fenêtre de
transition** (~15 min). Pendant cette fenêtre, `verifyBrevoWebhookBearer` accepte
l'ancien **et** le nouveau secret, puis l'ancien est rejeté à l'expiration. Si Brevo
refuse la mise à jour, le secret courant reste **inchangé** (aucune interruption).
