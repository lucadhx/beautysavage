# Enforcement contractuel — activation progressive

Invariant : **aucun contrat actif ⇒ site suspendu**. Comme un site et une
entreprise existent **déjà**, l'enforcement est piloté par un flag pour éviter de
suspendre brutalement la vitrine en production.

## 1. Règle d'accessibilité (source de vérité backend)

[services/siteEnforcement.service.js](../backend/src/services/siteEnforcement.service.js) :

```
site accessible = AUCUNE suspension technique  ET  contrat honoré
contrat honoré  = enforcement désactivé ? true : (contrat ACTIVE ou CANCEL_AT_PERIOD_END)
```

Deux sources de suspension distinctes ([SiteStatus](../backend/src/models/SiteStatus.model.js)) :

- **TECHNIQUE** : levier manuel DEV (maintenance) — prime sur tout.
- **CONTRACTUELLE** : aucun contrat honoré alors que l'enforcement est activé.

Conséquence clé : **lever la suspension technique ne réactive pas** un site
dépourvu de contrat actif — le statut est toujours recalculé par l'enforcement.

## 2. Le réglage « protection contractuelle »

**Ce n'est plus une variable d'environnement.** C'est un réglage du site :
`SiteStatus.contractProtectionEnabled` (`false` par défaut), modifiable sans
redémarrage.

| Valeur | Comportement |
|---|---|
| `false` | Le contrat n'affecte pas l'accessibilité (comportement historique). Seule la suspension technique agit. |
| `true` | L'invariant s'applique : sans contrat actif, le site est suspendu (source `CONTRACT`). |

Une seule valeur, deux points d'écriture — jamais deux copies :

| Depuis | Chemin |
|---|---|
| **Manager** (page « Statut du site », rôle DEV) | `POST /api/site-status/contract-protection` |
| **Panel** (fiche projet, carte « Protection contractuelle », compte DEV) | opération du pont `contract.set_protection` |

Le Panel ne stocke rien : il relit l'état du projet à chaque affichage, via le
catalogue d'opérations (`GET /api/project-bridge/v1/operations`, champ
`contractProtection`). C'est ce qui rend impossible un « Panel dit ON, Manager
dit OFF ».

> Pourquoi le catalogue et non la projection `CONTRACT` : celle-ci est un
> *tombstone* quand le projet n'a aucun contrat — c'est-à-dire exactement le cas
> où ce réglage décide de l'accès. Elle l'effacerait au pire moment.

Le statut est réconcilié : au boot, après chaque activation/résiliation/fin de
contrat, à chaque bascule du réglage, et via `POST /api/site-status/reconcile`
(DEV) ou `npm run contracts:reconcile`.

## 3. État AVANT activation de l'enforcement

- Le site fonctionne comme aujourd'hui (`status` piloté par la suspension
  technique uniquement).
- Les modules contrats/paiements/signature sont utilisables et testables sans
  impacter l'accessibilité du site.

## 4. Procédure de bascule (recommandée)

1. **Configurer** Stripe + Yousign (TEST puis PROD) dans le Manager.
2. **Préparer** un contrat en TEST, dérouler tout le parcours en sandbox
   (`SIGNATURE_PROVIDER`/`STRIPE_PROVIDER` réels TEST), vérifier les webhooks
   (ngrok) et le placement des zones de signature (voir SIGNATURE.md §4).
3. **En PROD** : créer, faire signer et activer un contrat réel **avant**
   d'activer la protection (sinon la vitrine serait suspendue).
4. Activer la protection depuis le Manager ou le Panel — **aucun redémarrage** —
   puis vérifier `GET /api/site-status` (doit rester `ACTIVE` grâce au contrat
   actif, avec `suspensionSource: NONE`).

## 5. Impact TEST / PROD

- **TEST** : activer l'enforcement en TEST pour valider l'invariant (le site TEST
  sera suspendu tant qu'aucun contrat TEST n'est actif). C'est le comportement
  attendu.
- **PROD** : **ne jamais** activer l'enforcement sans contrat actif préparé, clés
  configurées et validation explicite.

## 6. Rollback

Désactiver la protection (Manager ou Panel) : la cause `CONTRACT` disparaît
immédiatement, sans redémarrage. Le site redevient accessible **sauf s'il est
suspendu pour une autre cause** — une suspension technique en cours n'est jamais
levée par ce réglage. Aucune donnée contractuelle n'est perdue.

## 7. Politique d'impayé

Voir [STRIPE_INTEGRATION.md](./STRIPE_INTEGRATION.md) §5. En V1, l'impayé isolé
(`invoice.payment_failed`) **ne suspend pas** ; la fin effective d'abonnement fait
foi. `CONTRACT_PAYMENT_GRACE_DAYS` réservé pour une politique de grâce future.
