# Réconciliation des abonnements (filet de sécurité)

Les webhooks peuvent être **retardés ou perdus**. La réconciliation relit Stripe et
corrige les états internes — **idempotente**, ne crée jamais d'abonnement, produit un
rapport **sans secret**. Elle ne remplace pas les webhooks : c'est un filet.

## 1. Ce qu'elle corrige

Pour chaque contrat ayant un abonnement non terminal
([reconcileSubscription](../backend/src/services/subscription.service.js)) :

- **statut** (mapper centralisé, contexte `cancel_at_period_end`) ;
- **période** (`currentPeriodStart/End`) ;
- **résiliation** programmée (`cancelAtPeriodEnd`) ;
- **fin effective** → abonnement `ENDED`, contrat `ENDED`, `endedAt`, puis
  **réconciliation du site** (suspension automatique) ;
- puis `reconcileSiteStatus` global.

## 2. Commandes & endpoints

| Usage | Effet |
|---|---|
| `npm run subscriptions:sync` | Réconcilie tous les abonnements non terminaux + le site |
| `POST /api/contracts/:id/sync-subscription` (DEV) | Réconcilie l'abonnement d'un contrat + le site |
| `npm run contracts:verify-entitlements` | **Lecture seule** : détecte les incohérences (code retour ≠ 0 si anomalies) |
| `POST /api/contracts/:id/sync` (DEV) | Réconciliation globale du contrat (Yousign + frais + abonnement) |

Le bouton « Synchroniser l'abonnement » (Manager DEV) ne crée jamais d'abonnement.

## 3. Anomalies détectées par `verify-entitlements`

- `CONTRACT_LIVE_WITHOUT_VALID_SUBSCRIPTION` — contrat ACTIVE/CANCEL_AT_PERIOD_END,
  abonnement requis mais non entitlé ;
- `SUBSCRIPTION_ACTIVE_BUT_CONTRACT_INCOHERENT` — abonnement entitlé, contrat dans un
  statut incohérent ;
- `CANCELLATION_REQUESTED_NOT_REFLECTED` — `cancelAtPeriodEnd` mais contrat encore
  ACTIVE ;
- `SITE_ACTIVE_WITHOUT_SERVEABLE_CONTRACT` — site actif sans contrat servable (hors
  suspension technique).

## 4. Robustesse

Stripe indisponible / rate limit / timeout : la réconciliation **n'altère rien**
dans le doute (réessai au prochain passage). Les statuts terminaux
(`ENDED`/`CANCELLED`/`FAILED`) ne sont jamais retraités. Voir aussi
[STRIPE_SUBSCRIPTION_FLOW.md](./STRIPE_SUBSCRIPTION_FLOW.md) et
[SITE_CONTRACT_ENTITLEMENT.md](./SITE_CONTRACT_ENTITLEMENT.md).
