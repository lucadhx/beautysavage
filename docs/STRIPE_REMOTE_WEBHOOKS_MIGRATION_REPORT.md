# Suppression du mode Stripe CLI — webhooks Stripe TEST/PROD gérés par l'API

> **⚠️ RAPPORT HISTORIQUE — NE PAS SUIVRE COMME PROCÉDURE.**
> Ce document décrit un état du système à la date de sa rédaction. Plusieurs
> architectures qu'il mentionne ont été supprimées depuis — notamment la page
> IntegratedAPI du Manager, les credentials Brevo locaux et le webhook Brevo
> local. Autorités actuelles : [ARCHITECTURE.md](ARCHITECTURE.md) ·
> [PROTOCOL.md](PROTOCOL.md) · [INTEGRATED_API.md](INTEGRATED_API.md) ·
> [PANEL_BRIDGE.md](PANEL_BRIDGE.md).


> Chantier 2026-07-25, branche `feat/unified-production-baseline` (base `d663a37`).
> Aucune branche parallèle, aucun worktree, aucun `push --force`.

## 1. Avant

- **Fonctionnement** : en développement, le canal officiel des webhooks Stripe
  TEST était `stripe listen` (Stripe CLI). `backend npm run dev` lançait, via
  `concurrently`, le backend ET `src/scripts/stripe-listen.js` : attente du
  `/health`, `spawn('stripe', ['listen', '--forward-to', …, '--events', …])`,
  parsing de stdout pour extraire le `whsec_` local, bannière invitant à le
  coller dans Manager → Stripe → TEST → webhook_secret.
- **Skip** : `stripeSkipWhen` (integrationWebhookProviders) sautait TOUTE
  synchronisation distante TEST hors PROD dès que `STRIPE_CLI_ENABLED` n'était
  pas `false` → résultat `{ skipped: true, reason: 'STRIPE_CLI_LOCAL' }`.
- **Source du `whsec_`** : produit localement par Stripe CLI, saisi À LA MAIN
  dans le Manager (champ requis du catalogue).
- **Problèmes** : dépendance à un binaire externe (installation, login,
  versions), secret manuel volatil, endpoint distant TEST jamais créé, écart
  TEST/PROD de doctrine, `skip` silencieux dans les rapports.

## 2. Après

```
Backend public TEST résolu (ngrok auto-détecté)
    → buildWebhookUrl() : https://<tunnel>/api/webhooks/stripe
    → ensureAllWebhooks(TEST) → provider Stripe → remoteWebhookSyncEngine
    → recherche par DESCRIPTION canonique SB_AUTO_06_MANAGED_STRIPE_PAYMENT_TEST
    → création si absent (whsec_ capturé DANS la réponse de création,
      chiffré immédiatement dans IntegratedApi.modes.TEST.credentials)
    → mise à jour du MÊME endpoint si URL/événements/description divergent
    → réception réelle des événements sur le backend public
```

- Même moteur générique que Brevo/Yousign — aucun code Stripe spécifique
  ajouté : la suppression du `skipWhen` a suffi (le cycle création/update/
  recréation/dédoublonnage/capture existait déjà, prouvé par les tests).
- PROD inchangé dans sa mécanique : `runtime_config` écrit `backendUrl` PROD,
  le bootstrap du backend déployé réconcilie `ensureAllWebhooks('PROD')` avec
  les clés PROD. TEST et PROD strictement isolés (identités distantes et
  secrets par mode, vérifiés par test).
- La SEULE raison de ne pas synchroniser en TEST : pas d'URL publique
  (`URL_NOT_PUBLIC`) — jamais l'état de la machine locale.
- Secret local absent avec endpoint distant présent → recréation contrôlée de
  NOTRE endpoint (nouveau secret capturé, ancien endpoint géré supprimé,
  inconnus jamais touchés).
- Veille ngrok (bootstrap, 60 s) : un changement de tunnel met à jour le MÊME
  endpoint (id conservé, secret conservé — Stripe permet l'update d'URL).
- Vérification des signatures inchangée : `verifyStripeWebhookAnyMode` résout
  le `whsec_` chiffré PAR MODE depuis IntegratedAPI (jamais l'ENV) — le
  nouveau secret est en service dès sa persistance ; un ancien secret CLI ne
  prend jamais priorité (remplacé à la première synchronisation).

## 3. Migration (idempotente, sans script)

| Cas | Comportement constaté/testé |
|---|---|
| A. ancien secret CLI présent, pas d'endpoint canonique | endpoint créé, NOUVEAU `whsec_` remplace l'ancien (test « 6bis » + constaté en recette réelle) |
| B. endpoint canonique + secret stocké | alignement URL/événements, endpoint et secret conservés (idempotence testée) |
| C. endpoint présent, secret local absent | recréation contrôlée, nouveau secret, ancien endpoint géré supprimé (test « 4 ») |
| D. plusieurs endpoints canoniques | doublons GÉRÉS supprimés, endpoint principal déterministe, inconnus intacts (test « 3 ») |
| E. aucune URL publique TEST | `URL_NOT_PUBLIC`, rien créé chez Stripe, aucun retour à Stripe CLI |

## 4. Registre unique des événements (13)

`stripeEventRegistry.js` (`STRIPE_HANDLED_EVENTS`) reste l'UNIQUE source :
`checkout.session.{completed,async_payment_succeeded,async_payment_failed,expired}`,
`payment_intent.{succeeded,payment_failed}`, `charge.refunded`,
`invoice.{finalized,paid,payment_failed}`,
`customer.subscription.{created,updated,deleted}` — audit confirmé : chacun est
réellement traité par `contractWebhook.service.js`, aucun événement mort,
aucun manquant ; l'endpoint distant souscrit exactement cette liste (testé).
L'ancienne liste `stripe listen --events` a disparu avec le script.

## 5. Manager

- Carte générique « Webhooks des intégrations » inchangée dans sa structure :
  Stripe TEST affiche désormais Synchronisé / URL calculée (ngrok) / dernier
  sync / dernier événement — plus jamais « réconciliation sautée
  (STRIPE_CLI_LOCAL) ». Synchroniser / Réparer / Tester fonctionnent sans CLI
  (Tester = diagnostic honnête : credentials, endpoint retrouvé, conformité
  URL/événements, secret présent, joignabilité — jamais un faux « événement
  envoyé »).
- Intégrations API : le champ Stripe `webhookSecret` est marqué **autoManaged**
  (badge « auto », lecture seule) — plus de copier-coller de `whsec_`. Non
  requis pour « Configuré » : il arrive à la première synchronisation.

## 6. Nettoyage (occurrences fonctionnelles finales)

- `STRIPE_CLI_LOCAL` : **0** (restent : le test qui vérifie sa disparition,
  la doc de doctrine, les rapports historiques `STRIPE_CLI_*_REPORT.md`).
- `stripe listen` : **0** dans le démarrage canonique (restent : mentions
  « n'est plus utilisé » et rapports historiques).
- `STRIPE_CLI_ENABLED` / `STRIPE_CLI_EVENTS` / `STRIPE_WEBHOOK_FORWARD_URL` :
  supprimées de `.env.example` ; plus lues nulle part (test : la variable
  legacy est IGNORÉE si présente).
- Supprimés : `stripe-listen.js`, `stripe-listen.test.js`, scripts npm
  `dev:stripe`/`test:stripe-cli`, dépendance `concurrently`,
  `docs/STRIPE_LOCAL_WEBHOOK_DEVELOPMENT.md`.

## 7. Recette réelle TEST (2026-07-25, sans Stripe CLI)

Environnement réel : clés Stripe TEST configurées, tunnel ngrok
`https://equinox-saturate-clustered.ngrok-free.dev → localhost:6070`, backend
6070 exécutant le commit du chantier (vérifié par `/api/version`).

Constaté (lecture seule, aucun secret affiché) :
- URL publique TEST résolue : tunnel ngrok (source `NGROK`, webhookReady).
- Compte Stripe TEST : **1 seul** endpoint canonique
  `SB_AUTO_06_MANAGED_STRIPE_PAYMENT_TEST` (id masqué `we_1Tx…FG8P`), URL
  `https://equinox-saturate-clustered.ngrok-free.dev/api/webhooks/stripe`,
  **13 événements**, actif — créé AUTOMATIQUEMENT par le bootstrap, sans
  aucune action manuelle.
- `whsec_` capturé à la création et stocké **chiffré** (updatedAt horodaté),
  resynchronisation ultérieure idempotente (lastSyncedAt postérieur, zéro
  erreur, zéro doublon).
- Diagnostic « Tester » : conforme + secret présent + route publique joignable
  (`ok: true`).

Restent MANUELS (validation métier) : un paiement TEST réel de bout en bout
(checkout navigateur, carte de test) pour constater « Dernier événement » ;
un redémarrage réel de ngrok pour constater l'update du même endpoint (couvert
par les tests, et par la veille déjà éprouvée sur Brevo).

## 8. Recette PROD (procédure, à exécuter au prochain déploiement)

Déployer via le Manager → `backendUrl` PROD écrit par `runtime_config` →
bootstrap PROD → `ensureAllWebhooks('PROD')` → endpoint
`SB_AUTO_06_MANAGED_STRIPE_PAYMENT_PROD` créé/aligné avec les clés PROD,
secret PROD capturé et chiffré, TEST intact ; puis paiement contrôlé et
vérification des états dans le Manager. Aucune clé PROD utilisée pendant les
tests automatisés ni la recette locale.

## 9. Tests

Voir le rapport de session : uniformité 48 ✓ (dont sync jamais sautée,
variable legacy ignorée, cas A, isolation TEST/PROD), orchestrateur 35 ✓,
résolution d'URL 45 ✓, integrated-api 64 ✓, stripe 34 ✓, chaîne backend
complète verte, manager (tsc + suites) vert, vitrine 68 ✓, builds OK.
