# Rapport — Mise en place Stripe CLI (webhooks locaux via `npm run dev`)

## État initial
- Branche `main`, arbre propre. Pas de `package.json` racine → `npm run dev` se
  lance dans `backend/`.
- Port backend réel : **6060** (`PORT=6060`, défaut 4000). Endpoint webhook
  confirmé : **`/api/webhooks/stripe`** (corps brut, monté avant `express.json`).
  Health : **`GET /health`**.
- Outils : ni `concurrently`, ni `nodemon`/`tsx`/`wait-on` (seul
  `mongodb-memory-server`). Script `dev` = `node --watch src/server.js` (backend
  seul, pas de frontend inclus).

## OS & Stripe CLI
- OS : Windows 11. Gestionnaire : **winget** disponible (scoop absent).
- Stripe CLI **absent au départ**, installé via winget (source officielle,
  binaire GitHub signé, hash vérifié par winget) :
  `winget install --id Stripe.StripeCli --exact`.
- Version installée : **stripe 1.43.8** (`--events` supporté par `stripe listen`).

## Authentification
- **Non authentifié** (`~/.config/stripe/config.toml` absent). Étape **manuelle
  restante** : `stripe login` (interactive, ouvre le navigateur — non
  automatisable). Aucun token extrait/affiché/commité.

## Architecture du lancement
- `dev:app` → `node --watch src/server.js` (commande de dev existante, préservée).
- `dev:stripe` → `node src/scripts/stripe-listen.js`.
- `dev` → `concurrently --kill-others-on-fail --names APP,STRIPE -c blue,magenta
  "npm:dev:app" "npm:dev:stripe"`.
- Le script Stripe **sort toujours en code 0** (désactivé / CLI absente / backend
  non prêt / arrêt de Stripe CLI) afin que `--kill-others-on-fail` ne tue jamais
  le backend à cause de Stripe.

## Script d'orchestration
`backend/src/scripts/stripe-listen.js` :
- fonctions pures exportées (testées) : `isStripeCliEnabled`, `resolvePort`,
  `resolveForwardUrl`, `resolveEvents`, `buildStripeListenArgs`,
  `extractWebhookSecret`, `createSecretWatcher`, `redactApiKeys`, `buildBanner` ;
- attente du backend sur `/health` (timeout 40 s, retries 1 s) avant de démarrer
  Stripe CLI ;
- `spawn('stripe', ['listen','--forward-to',URL, '--events', …])` (shell sur
  Windows uniquement, args contrôlés) ;
- détection du `whsec_...` sur stdout **et** stderr, gestion des chunks, bloc
  visuel affiché **une seule fois** ;
- rédaction défensive de toute `sk_test_`/`sk_live_` dans les logs relayés ;
- arrêt propre SIGINT/SIGTERM (Windows : `taskkill /T /F` → pas d'orphelin),
  handlers enregistrés une fois, `child.on('error'|'exit')` gérés.

## Port / URL / événements
- Port : résolu depuis `PORT` (6060). URL de transfert :
  `http://localhost:6060/api/webhooks/stripe` (surchargée par
  `STRIPE_WEBHOOK_FORWARD_URL`).
- Événements par défaut : les **6 réellement traités** (filtrage activé, supporté
  par la CLI 1.43.8) — `checkout.session.completed`, `invoice.paid`,
  `invoice.payment_failed`, `customer.subscription.created|updated|deleted`.
  `STRIPE_CLI_EVENTS=all` pour tout écouter.

## Variables d'environnement (`.env.example`)
`STRIPE_CLI_ENABLED=true` (défaut), `STRIPE_WEBHOOK_FORWARD_URL` (optionnel),
`STRIPE_CLI_EVENTS` (optionnel). Le port n'est **pas** dupliqué (réutilise `PORT`).
Le `whsec_` n'est jamais mis dans `.env.example`.

## Tests créés
`backend/src/scripts/stripe-listen.test.js` — **35 assertions** : activation
(défaut/false), port/URL (défaut + override), événements (défaut 6 / all / liste),
args `stripe listen` (avec/sans `--events`, URL), extraction `whsec_` (normal /
absent / première occurrence), watcher (chunks, une seule fois, aucun),
rédaction `sk_` (whsec_ conservé), bloc visuel (secret + endpoint + rappel Manager
+ avertissement prod). **Aucun vrai Stripe CLI lancé.**

## Résultats
- Unitaires script : **35/35** ✓.
- Suite backend complète : **386 assertions, 0 échec** (migration 54, integrated-api
  53, contracts 38, yousign 34, stripe 28, lifecycle 42, stripe-cli 35, smoke 102).
- Chemins runtime vérifiés :
  - `STRIPE_CLI_ENABLED=false` → message + exit 0 (backend intact) ✓ ;
  - CLI absente (shell sans PATH) → instructions d'installation + exit 0 ✓ ;
  - **backend en cours + CLI présente (non authentifiée)** : attente `/health`
    OK → démarrage `stripe listen` (all) → « not configured API keys » → exit 0
    avec astuce `stripe login` (backend non tué) ✓.
- `stripe trigger` : **non exécuté** (nécessite `stripe login`). À faire au test
  manuel final.

## Limites
- `stripe login` reste **manuel** (interactif). Tant qu'il n'est pas fait, le
  bloc `whsec_` n'apparaît pas (le backend tourne normalement).
- Le `whsec_` du listener CLI est **temporaire** ; à recopier dans le Manager s'il
  change.
- Git Bash n'hérite pas du PATH winget ; `npm run dev` doit être lancé depuis un
  terminal où `stripe` est sur le PATH (PowerShell/CMD après réouverture).

## Fichiers créés
- `backend/src/scripts/stripe-listen.js`
- `backend/src/scripts/stripe-listen.test.js`
- `docs/STRIPE_LOCAL_WEBHOOK_DEVELOPMENT.md`
- `STRIPE_CLI_DEV_SETUP_REPORT.md`

## Fichiers modifiés
- `backend/package.json` (scripts `dev:app`/`dev:stripe`/`dev`, `test:stripe-cli`,
  devDep `concurrently`)
- `backend/.env.example` (variables Stripe CLI)
- `README.md`

## Commandes utilisateur finales
```bash
# une seule fois
winget install --id Stripe.StripeCli --exact   # (déjà fait)
stripe login                                    # étape manuelle restante

# à chaque session (dans backend/)
npm run dev
# → copier le whsec_ affiché dans Manager DEV › Intégrations API › Stripe › TEST
# → tester : stripe trigger checkout.session.completed
```

> Sécurité : aucun `whsec_` réel, aucun token CLI, aucune clé `sk_` n'est écrit
> dans un fichier versionné. Exemple masqué : `whsec_[REDACTED]`.
