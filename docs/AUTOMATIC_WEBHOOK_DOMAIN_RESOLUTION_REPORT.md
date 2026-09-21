# Rapport — Résolution automatique des webhooks par domaine public canonique

> **⚠️ RAPPORT HISTORIQUE — NE PAS SUIVRE COMME PROCÉDURE.**
> Ce document décrit un état du système à la date de sa rédaction. Plusieurs
> architectures qu'il mentionne ont été supprimées depuis — notamment la page
> IntegratedAPI du Manager, les credentials Brevo locaux et le webhook Brevo
> local. Autorités actuelles : [ARCHITECTURE.md](ARCHITECTURE.md) ·
> [PROTOCOL.md](PROTOCOL.md) · [INTEGRATED_API.md](INTEGRATED_API.md) ·
> [PANEL_BRIDGE.md](PANEL_BRIDGE.md).


> Chantier du 2026-07-24 sur `feat/unified-production-baseline`.
> Objectif produit : le propriétaire ne saisit JAMAIS une URL de webhook — le
> système connaît son URL publique et toutes les intégrations en dérivent leurs
> endpoints, en dev (ngrok) comme en prod (domaine déployé).

## 1. Architecture avant

- **Source canonique déjà existante** : `SystemConfiguration.network.backendUrl`
  (singleton, relu à chaque appel via `getPublicBackendUrl()`, sans cache).
  Écrite par : le Manager (Config Système → Réseau), le **moteur de déploiement**
  (étape `runtime_config` → `https://api.<domaine>` dans la base cible), défauts
  (`NETWORK_DEFAULTS` = localhost:6070).
- **PROD : déjà automatique** (déploiement → runtime_config → bootstrap).
- **DEV : 100 % manuel** — lancer ngrok, copier l'URL, la coller dans le
  Manager après chaque redémarrage du tunnel. Aucune détection.
- Notions concurrentes cartographiées (aucune supprimée, aucune dupliquée) :
  `PUBLIC_URL`/`config.publicUrl` (défaut de démarrage, valeur *vitrine* —
  jamais utilisée par les webhooks), `VITE_API_URL` (bootstrap des fronts,
  orthogonale), `NETWORK_DEFAULTS` (défauts de la canonique),
  `canonicalWebhookUrl` et `webhook.webhookUrl` persisté (dérivées de la
  canonique), URL Stripe CLI (dev, indépendante).

## 2. Architecture après

**Aucune nouvelle notion concurrente.** La canonique reste
`network.backendUrl` ; deux couches s'y ajoutent :

### Résolution — `resolvePublicBackendUrl(mode)` (`networkConfig.service.js`)

| Mode | Ordre de résolution |
|---|---|
| **PROD** | 1. Config Système (écrite par le déploiement) → 2. env `PUBLIC_BACKEND_URL` → 3. `WEBHOOK_PUBLIC_URL_UNAVAILABLE`. **Jamais ngrok, jamais localhost.** |
| **TEST** | 1. **tunnel ngrok COURANT** (détection auto) → 2. Config Système si publique → 3. env `PUBLIC_BACKEND_URL` → 4. localhost (dev sans webhook, `webhookReady:false`) → 5. `WEBHOOK_PUBLIC_URL_UNAVAILABLE`. |

Retour structuré `{url, source, webhookReady, code?}` — jamais d'exception.
Sources : `NGROK · SYSTEM_CONFIGURATION · ENVIRONMENT · LOCALHOST · NONE`.
HTTPS public obligatoire pour être `webhookReady` ; slash final supprimé ;
**jamais de route persistée** (seule la racine est stockée, les routes sont
calculées).

### Détection ngrok — `ngrokTunnel.service.js`

API locale d'inspection ngrok (`http://127.0.0.1:4040/api/tunnels`,
surchageable `NGROK_API_URL`). Ne retient qu'un tunnel **HTTPS** pointant vers
**notre port backend** (un tunnel du Manager/vitrine est ignoré). Timeout
1,5 s, cache 10 s, échec silencieux (ngrok absent = « pas de tunnel », pas une
erreur). Jamais appelée quand `ENV=PROD`.

### Construction — `buildWebhookUrl()` (`webhooks/managedWebhookRegistry.js`)

`<publicBackendUrl>/api/webhooks/<segments>` — **seul** fabricant d'URL de
webhook du projet. Exemples réels :
`https://abc123.ngrok-free.app/api/webhooks/brevo/transactional/test`,
`https://api.demo-sbauto.lycarz.com/api/webhooks/brevo/transactional/prod`.

## 3. Contrat générique ManagedWebhook (provider + category + mode)

Registre code-first `MANAGED_WEBHOOKS` :

| Provider | Category | Route | remoteSync |
|---|---|---|---|
| BREVO | transactional | `/api/webhooks/brevo/transactional/{test\|prod}` | **oui** |
| STRIPE | payment | `/api/webhooks/stripe` (route réelle actuelle) | non (dashboard/CLI) |
| YOUSIGN | signature | `/api/webhooks/yousign` | non (dashboard) |

Chaque entrée : `routeSegments`, `expectedEvents`, `secretReference` (nom du
credential chiffré — jamais le secret), `authentication`. L'état persistant
(webhookId, url, statut, `lastReceivedAt/Type`, santé) reste dans
`IntegratedApi.modes[mode].webhook` — aucune collection ni clé dupliquée.
Brancher Stripe/Yousign plus tard = écrire leur driver de sync distant, rien
d'autre à inventer.

### Description distante stable (LOT 6)

Canonique : `SB_AUTO_06_MANAGED_BREVO_TRANSACTIONAL_TEST|PROD`
(+ suffixe `#<WEBHOOK_INSTALLATION_ID>` si plusieurs installations partagent un
compte fournisseur). **Jamais le domaine comme identifiant.** L'ancienne
description (`SBauto06 transactional delivery tracking - …`) reste reconnue
comme NÔTRE en lecture (adoption), et la première synchronisation la **migre**
vers la convention canonique (PUT, même webhookId).

## 4. Réconciliation (LOT 5) — `ensureBrevoTransactionalWebhook(mode)`

1. Résout l'URL publique (resolver) → construit `expectedUrl` ;
2. skip silencieux si config incomplète (`BREVO_DISABLED`, `API_KEY_MISSING`,
   `URL_NOT_PUBLIC`) — un compte volontairement non configuré n'est pas une
   erreur ;
3. lit les webhooks distants (liste vide tolérée) ;
4. identifie le géré : webhookId → URL exacte → description (canonique **ou**
   legacy), uniquement si unique ;
5. **dédoublonnage sûr** : les doublons portant NOTRE description (canonique ou
   legacy) sont supprimés, un seul survit (préférence au webhookId local puis à
   la description canonique). **Un webhook inconnu n'est JAMAIS supprimé** ;
6. crée si absent, met à jour si divergent (URL, événements normalisés,
   description), **ne fait rien si conforme** ;
7. persiste webhookId + état + erreurs sûres ; jamais de secret loggé.
Sérialisé par mode (aucune course), timeouts réseau de 10 s.

## 5. Fonctionnement ngrok (dev) & PROD

**DEV (`npm run dev`)** : bootstrap → `ensure('TEST')` (timeout 20 s) ;
puis **veille périodique 60 s** : quand l'URL ngrok change, le webhook TEST est
resynchronisé automatiquement — même webhookId, aucun doublon, PROD jamais
touché. ngrok absent : le backend démarre normalement, log
« réconciliation sautée (URL_NOT_PUBLIC) », et `dev-canonical` affiche
« Backend public : aucun tunnel ngrok — webhooks non synchronisés ». Avec
tunnel : « Backend public : https://…ngrok-free.app (webhook Brevo TEST
synchronisé automatiquement) ».

**PROD** : pipeline de déploiement inchangé (domaines → Nginx → API → health →
`runtime_config` écrit `https://api.<domaine>` → validate) ; le redémarrage
PM2 déclenche le bootstrap → `ensure('PROD')` (timeouté, non bloquant, warning
explicite en cas d'échec réel). Le webhook ne bloque jamais un déploiement
applicatif réussi.

## 6. Manager (LOT 10)

Panneau « suivi de livraison » : affiche en **lecture seule**
« Backend public : <url> — <provenance> » (détectée via ngrok / Configuration
Système / variable d'environnement) et « Webhook calculé : <url> ». Personne ne
saisit d'URL de webhook. Les trois états restent séparés (canal d'envoi /
configuration webhook / activité). L'override avancé demeure la page DEV
« Configuration Système → Réseau » (inchangée).

## 7. Sécurité (LOT 12 — vérifiée)

Secrets TEST/PROD distincts, chiffrés AES-256-GCM (`credentials` Map), jamais
exposés ni loggés ; Bearer obligatoire (401 absent/incorrect, `timingSafeEqual`,
fenêtre de rotation 15 min) ; payload 512 ko max, idempotence par
`idempotencyKey` (doublons absorbés), retries Brevo gérés ; `batched:false` ;
logs à adresses hashées. Suite `brevo-webhook.test.js` : 147 ✓.

## 8. Gestion des erreurs

- Résolution : jamais d'exception — état `WEBHOOK_PUBLIC_URL_UNAVAILABLE`.
- Réconciliation : skip structuré vs échec structuré `{error:{code,message}}`
  (message sûr) ; bootstrap : info/succès/warning, jamais un démarrage raté.
- Un tunnel d'un autre service (manager/vitrine) n'est jamais confondu avec le
  backend ; jamais de webhook externe vers localhost.

## 9. Migration

Aucune migration de données : les webhooks existants sont identifiés par leur
webhookId persisté (ou leur description legacy), adoptés, puis leur description
est migrée vers la convention canonique à la première synchronisation. Les
doublons historiques gérés sont purgés automatiquement (jamais les inconnus).

## 10. Fichiers modifiés

- **Nouveaux** : `backend/src/services/ngrokTunnel.service.js`,
  `backend/src/services/webhooks/managedWebhookRegistry.js`,
  `backend/src/scripts/webhook-url-resolution.test.js`.
- **Backend** : `networkConfig.service.js` (resolver),
  `brevo/brevoWebhookConfig.service.js` (description canonique + legacy,
  dédoublonnage, état enrichi `publicBackendUrl`/`publicUrlSource`),
  `email/brevoOperational.service.js` + `emailConfiguration.service.js`
  (projections), `config/bootstrap.js` (ensure TEST + veille ngrok + timeout),
  `package.json` (suite câblée).
- **Manager** : `types/index.ts`, `lib/emailConfiguration.ts` (trackingView),
  `components/dev/EmailConfigurationSection.tsx` (affichage lecture seule).
- **Racine** : `scripts/dev-canonical.mjs` (résumé Backend public).

## 11. Tests & résultats

| Suite | Résultat |
|---|---|
| `webhook-url-resolution.test.js` (nouvelle — résolution TEST/PROD, priorité ngrok, tunnel d'un autre port ignoré, localhost, env, construction registre, descriptions canonique/legacy/installation, **changement d'URL ngrok → PUT même webhookId sans doublon, PROD intact**) | **44 ✓** |
| `brevo-operational.test.js` (+ adoption legacy, migration description, dédoublonnage sûr avec inconnu préservé) | **121 ✓** |
| `brevo-webhook.test.js` / `email-configuration` / `email-diagnostic` / `contact` | 147 ✓ / 238 ✓ / 19 ✓ / 267 ✓ |
| **Chaîne backend complète** (~39 suites) | **EXIT=0, aucun échec** |
| Manager (13 suites + `tsc -b`) | **0 échec** |

## 12. Recette locale (LOT 14 — exécutée)

`npm run dev` réel : backend 6070 (health 200), manager 6071, vitrine 6062 ;
sans ngrok : log backend « Webhook Brevo TEST : réconciliation sautée
(URL_NOT_PUBLIC) », résumé « Backend public : aucun tunnel ngrok — webhooks non
synchronisés (backend fonctionnel) » ; arrêt propre. Le scénario tunnel réel
(URL détectée, sync effective, changement d'URL) est couvert par les tests avec
ngrok simulé — la vérification avec un vrai tunnel reste à faire à la main
(voir § Limites).

## 13. Limites / restant à tester manuellement

1. **ngrok réel** : lancer `ngrok http 6070`, puis `npm run dev` — vérifier le
   résumé, la carte Brevo (Backend public « détectée automatiquement »), la
   création effective du webhook chez Brevo, puis redémarrer ngrok et attendre
   ≤ 60 s la resynchronisation (même webhookId).
2. La veille est dans le processus backend (mono-processus) — un déploiement
   multi-instances exigerait un verrou distribué (hors périmètre, documenté).
3. Stripe/Yousign : URLs encore configurées au dashboard (contrat prêt,
   `remoteSync:false`).
4. Corrections du chantier précédent (destinataires/états Brevo) : tests verts,
   recette manuelle PROD toujours à faire.

## 14. Procédure de recette PROD (manuelle — JAMAIS automatique)

1. Déployer via le Manager (procédure officielle). Le pipeline écrit
   `https://api.<domaine>` (runtime_config) ; au redémarrage, le bootstrap
   réconcilie le webhook PROD (logs PM2 : « réconcilié » ou « sautée (raison) »).
2. Manager PROD → Intégrations API → Brevo : vérifier « Backend public :
   https://api.demo-sbauto.lycarz.com — Configuration Système (écrite par le
   déploiement) » et « Webhook calculé : …/api/webhooks/brevo/transactional/prod » ;
   panneau suivi vert (« Aucun événement reçu pour le moment » tant qu'aucun
   e-mail n'est parti).
3. Chez Brevo : UN seul webhook transactionnel
   `SB_AUTO_06_MANAGED_BREVO_TRANSACTIONAL_PROD` (l'ancienne description a été
   migrée, les doublons gérés purgés).
4. Envoyer un e-mail de test → événements `request`/`delivered` reçus →
   « Dernier événement : … » renseigné.
5. Cas changement de domaine : redéployer sur le nouveau domaine — le webhook
   PROD doit suivre automatiquement (même webhookId, pas de doublon).
