# RX-RUN — Guide de lancement React Canary & rollback

> ⚡ **Mise à jour RX-RUN-2 (commande unique)** — le parcours officiel est désormais :
> ```bash
> npm run dev                       # développement : React ON + backend (build auto)
> npm run dev:vanilla               # rollback local (React OFF)
> npm install && npm run build && npm start   # déploiement : React ON automatique
> npm run start:vanilla             # rollback prod
> npm run check                     # préflight offline · npm run verify [url] — smoke HTTP
> ```
> Le flag React est **injecté par les scripts** (jamais dans le `.env`). Les commandes détaillées ci-dessous
> (`canary:*`) sont **remplacées** par ce set — cf. `RX_RUN_2_ONE_COMMAND_REPORT.md`. La section historique
> reste pour référence.


> Procédure fiable pour lancer BeautySavage en **React Canary** (local/staging), tester les parcours, puis
> **revenir en arrière**. **Ne modifie jamais le défaut prod** : `REACT_OFFICIAL_FRONTEND` reste OFF dans le
> `.env` ; le canary est activé par le lanceur, pour la session en cours uniquement. Cf. `RX_RUN_LAUNCH_AUDIT.md`.

## 0. Prérequis (une fois)
`.env` renseigné (bootstrap technique) : `MONGODB_URI`, `SESSION_SECRET`, `PWD_PEPPER`, `CREDENTIAL_VAULT_KEY`.
Config métier (Stripe/Brevo/domaines/institut) en base via les panels Dev (cf. `.env.example`). MongoDB joignable.

## 1. Build React + préflight
```bash
cd backend
npm run canary:build          # build vitrine + manager (dist)
npm run check:launch:canary   # préflight OFFLINE (env, vault, builds) — doit finir « Prêt à lancer »
```
Corriger toute ligne ❌ avant de continuer.

## 2. Démarrer en Canary (React officiel)
```bash
npm run clean-port            # libère le port si besoin
npm run canary:up             # démarre flag ON (React), sans toucher le .env
```
Le serveur écoute (défaut `http://localhost:3000`). En Canary :
`/` → `302 /app/` · `/vitrine.html` → `/app/` · `/gestion.html` → `/manager/`.

## 3. Smoke-test automatique
Dans un second terminal :
```bash
npm run verify:parcours                      # http://localhost:3000
# ou : npm run verify:parcours https://staging.mon-domaine
```
Tous les checks doivent être ✅ (santé, mode de serving = React, SPA `/app` + `/manager`, `/api` non shadowée,
thème, catalogue, cartes cadeaux, Stripe config, contrat).

## 4. Checklist parcours manuels (navigateur)
À dérouler sur `/app/…` (canary) :
- **Vitrine** : accueil, catalogue prestations/formations, fiche, cartes cadeaux, pages légales, 404.
- **Auth** : inscription → code e-mail → vérification ; connexion ; mot de passe oublié → lien → reset ; logout.
- **Checkout** : panier → checkout → **retour Stripe** `/app/paiement/succes|annule` (flag-aware RX-GO).
- **Client Hub** : `/app/mon-compte` (rendez-vous, cartes, factures, documents, profil, aide).
- **Tokenisés (lien e-mail)** : `/app/decision?flowId=&token=`, `/app/refund-tracking/:token`, `/app/invoice/:token`.
- **Manager** : `/manager` (login → dashboard hub), planning, clients, catalogue, finance, communication, dev.
- **Deep-link / refresh** : recharger (F5) une route profonde `/app/mon-compte/rendez-vous` → pas de page blanche.
- **Rollback à chaud** : sans redéployer, `Ctrl+C` puis `npm run vanilla:up` → `/` repointe `/vitrine.html`.

## 5. Rollback (revenir en arrière)
```bash
# Arrêter le process canary (Ctrl+C), puis :
npm run vanilla:up            # flag OFF (= défaut prod), Vanilla servi immédiatement
# ou simplement : npm start
```
Aucune donnée modifiée, aucune migration : la bascule est **uniquement** un flag de serving. Les liens e-mail
déjà envoyés en Vanilla restent valides (Vanilla sert `?page=…`) ; ceux envoyés en Canary pointent React
(`/app/…`) — cohérent avec le mode actif au moment de l'envoi.

## 6. Staging (domaine réel)
Configurer `vitrineUrl`/`panelUrl` (HTTPS) dans Dev Panel → Paramètres Système (ou
`node scripts/seedSystemConfiguration.js`). Option front séparé : `CHECKOUT_RETURN_BASE_URL`. Puis
`verify:parcours https://staging.mon-domaine`.

## Dépannage express
| Symptôme | Cause probable | Correction |
|---|---|---|
| `/app` ou `/manager` → 503 | build absent | `npm run canary:build` |
| `/` reste sur `/vitrine.html` en canary | lancé sans le flag | `npm run canary:up` (pas `npm start`) |
| Boot échoue immédiatement | `.env` incomplet | `npm run check:launch` |
| `/api/webhooks/brevo` → 503 | `BREVO_WEBHOOK_SECRET` absent (prod) | seed coffre Brevo |
| Vitrine vide | pas de données/pages | `node scripts/seedVitrine.js` |

**Rappel** : ne pas mettre `REACT_OFFICIAL_FRONTEND=true` dans le `.env` de production tant que la recette
Canary n'est pas validée. Le flag est lu dynamiquement → bascule/rollback sans redéploiement.
