# Entitlement du site : suspension technique vs contractuelle

La disponibilité du site public est **dérivée** (jamais un simple booléen posé). Elle
compose **deux dimensions indépendantes** — voir
[siteEnforcement.service.js](../backend/src/services/siteEnforcement.service.js) et
[SiteStatus.model.js](../backend/src/models/SiteStatus.model.js).

## 1. Règle de composition

```
siteAccessible = !suspensionTechnique && entitlementContractuel

entitlementContractuel = enforcement désactivé ? true
                       : (un contrat ACTIVE ou CANCEL_AT_PERIOD_END existe)
```

- **Suspension technique** : levier **manuel DEV** (maintenance) —
  `technicalSuspension.active`. Indépendante du contrat.
- **Entitlement contractuel** : présence d'un contrat **servable**
  (`SITE_SERVEABLE_STATUSES` = `ACTIVE`, `CANCEL_AT_PERIOD_END`). Piloté par
  la protection contractuelle (`SiteStatus.contractProtectionEnabled` — un
  réglage du site, pilotable depuis le Manager comme depuis le Panel, cf.
  [CONTRACT_ENFORCEMENT_ROLLOUT.md](./CONTRACT_ENFORCEMENT_ROLLOUT.md)).

`suspensionSource` (dérivée) : `NONE`, `TECHNICAL` (prioritaire à l'affichage) ou
`CONTRACT`.

## 2. Invariants (testés)

- **Lever une suspension technique ne contourne PAS l'absence de contrat actif** :
  le statut est toujours recalculé (un site sans contrat servable reste suspendu).
- **Activer un contrat ne lève PAS une suspension technique** : une maintenance
  reste effective tant que le DEV ne la retire pas.
- **Résiliation en fin de période** (`CANCEL_AT_PERIOD_END`) : entitlement **maintenu**
  jusqu'à l'échéance → site actif.
- **Fin effective** (`ENDED`) : entitlement retiré → **suspension automatique**.
- **Unicité** : un seul contrat `ACTIVE`/`CANCEL_AT_PERIOD_END` à la fois.

Ces invariants sont couverts par `test:subscriptions` (section « Unicité contrat &
suspension technique ») et `test:lifecycle`.

## 3. Réconciliation & vérification

`reconcileSiteStatus` recalcule et persiste le statut après chaque transition
(activation, fin, webhook). `npm run contracts:verify-entitlements` (lecture seule)
détecte les incohérences : contrat vivant sans abonnement valide, abonnement actif
mais contrat incohérent, résiliation demandée non reflétée, site actif sans contrat
servable. Voir [SUBSCRIPTION_RECONCILIATION.md](./SUBSCRIPTION_RECONCILIATION.md).

## 4. Endpoints

`GET /api/site-status` (statut dérivé + source). `POST /api/site-status/suspend` ·
`/reactivate` · `/reconcile` (DEV) — leviers techniques, jamais un contournement de
l'entitlement contractuel.
