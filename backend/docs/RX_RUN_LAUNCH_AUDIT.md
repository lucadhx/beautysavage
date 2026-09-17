# RX-RUN — Audit de lancement (React Canary)

> Branche `phase-0-security-baseline`. **Aucune feature, aucun refactor** : audit + scripts + docs pour lancer
> BeautySavage en **React Canary**, tester les parcours, et **revenir en arrière** facilement. Le backend
> reste l'autorité ; la config métier vit en base (cf. `.env.example` : bootstrap technique uniquement).

## Outils fournis (RX-RUN)
| Commande | Rôle |
|---|---|
| `npm run check:launch` | Préflight OFFLINE (env obligatoires, format vault, builds React) — lecture seule |
| `npm run check:launch:canary` | Idem + rappel que le flag est posé par le lanceur canary |
| `npm run canary:build` | Build des deux SPA React (`frontend-react/apps/*/dist`) |
| `npm run canary:up` | Démarre le serveur **flag ON** (React officiel) — sans toucher le `.env` |
| `npm run vanilla:up` | Démarre le serveur **flag OFF** (rollback) — = défaut prod |
| `npm run verify:parcours [baseUrl]` | Smoke-test HTTP des parcours (serveur lancé) — lecture seule |

## Matrice de lancement
| Élément | Statut attendu | Commande de vérification | Risque si KO | Correction |
|---|---|---|---|---|
| `.env` MONGODB_URI | défini (pas placeholder) | `npm run check:launch` | **Ne démarre pas** | renseigner `.env` |
| `.env` SESSION_SECRET / PWD_PEPPER | définis | `npm run check:launch` | Ne démarre pas | `node -e "crypto.randomBytes(64)…"` |
| `CREDENTIAL_VAULT_KEY` (64 hex) | défini + bon format | `npm run check:launch` | Refus de boot (coffre) | `node -e "crypto.randomBytes(32).toString('hex')"` |
| IntegratedAPI (Stripe/Brevo) | seedés au coffre | `curl /api/stripe/config` (200 + clé) | Paiement/mails KO | `node scripts/migrateEnvCredentialsToIntegratedApi.js --apply` (depuis `.env.backup`) |
| SystemConfiguration (domaines) | seed idempotent au boot | `curl /api/site-status` (200) | URLs = localhost | `node scripts/seedSystemConfiguration.js` ; domaines via Dev Panel |
| CommunicationIdentity (expéditeur) | identité commerciale vérifiée | Dev/Manager Panel → Communication | Mails non envoyés | configurer + vérifier sender Brevo |
| Theme actif (vitrine/panel) | 1 actif par scope | `curl /api/theme/vitrine` (200, `theme` non-null) | Thème par défaut | `node scripts/migrateThemesToScopes.js` |
| GiftCardTemplate actif | ≥ 1 actif (seed au boot) | Manager → cartes-cadeaux/templates | PDF carte cadeau vide | seed idempotent au boot (auto) |
| Builds React (`dist`) | présents | `npm run check:launch` | `/app` `/manager` → 503 | `npm run canary:build` |
| `REACT_OFFICIAL_FRONTEND` | OFF par défaut ; ON via `canary:up` | `curl -I /` (302 → `/app/` ou `/vitrine.html`) | mode inattendu | `canary:up` / `vanilla:up` |
| Routes `/app` + `/manager` | servies en SPA | `npm run verify:parcours` | page blanche/503 | build + relancer |
| `/api` `/auth` `/uploads` non shadowés | jamais 302 vers `/app` | `npm run verify:parcours` | API cassée | (déjà garanti RX1 ; test `rx1ReactFrontend`) |
| Stripe hosted (`CHECKOUT_HOSTED`) | OFF par défaut | `.env` / `curl /api/stripe/config` | checkout hébergé inactif | `CHECKOUT_HOSTED=true` si voulu (+ retours flag-aware RX-GO) |
| Brevo (webhook secret) | requis en prod | `curl /api/webhooks/brevo` (503 si absent) | webhooks e-mail KO | `BREVO_WEBHOOK_SECRET` (coffre) |
| MongoDB | joignable | boot log / `check:launch` (URI) | Ne démarre pas | vérifier URI/accès réseau |
| Données de démo (pages/menu) | optionnel | `curl /api/vitrine/shop` (200) | vitrine vide | `node scripts/seedVitrine.js` |

## Prérequis boot (rappel)
- **Obligatoires** (throw si absents) : `MONGODB_URI`, `SESSION_SECRET`, `PWD_PEPPER`, `CREDENTIAL_VAULT_KEY`.
- **Seeds idempotents au boot** (`app.js`) : `seedSystemConfigurationFromEnv` (domaines/institut), `seedIntegratedApisFromEnv`
  (coffre), `seedGiftCardTemplates` (≥ 1 template actif). Non bloquants (fallback `.env`).
- **Flags** (défaut sûr) : `REACT_OFFICIAL_FRONTEND=false`, `CHECKOUT_HOSTED=false`, `PLATFORM_CHECKOUT_HOSTED=false`,
  `MAIL_ROLE_RESOLVER_ENABLED=false`, `EVENT_NOTIFICATION_SUBSCRIBER_MODE=off`.

## Procédure & rollback
Voir **`RX_RUN_LAUNCH_GUIDE.md`** (build → préflight → canary:up → verify:parcours → tests parcours manuels →
rollback `vanilla:up`). **Ne jamais modifier le défaut prod** (`REACT_OFFICIAL_FRONTEND` reste OFF dans le
`.env`) ; le canary est **local/staging** via le lanceur. Rollback = arrêter le process + `vanilla:up`.

## Limites
- Les scripts RX-RUN sont **read-only** (aucune mutation DB) : les seeds restent pilotés par le boot / les
  scripts `seed*`/`migrate*` existants.
- `verify:parcours` teste la **disponibilité** des endpoints, pas la logique métier (couverte par la suite de
  tests). Les parcours interactifs (paiement, e-mail, QR) se testent manuellement (checklist du guide).
