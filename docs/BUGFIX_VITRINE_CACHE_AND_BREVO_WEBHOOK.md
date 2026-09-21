# Correctifs finaux P2 — Vitrine obsolète & Webhook Brevo « jaune »

> **⚠️ RAPPORT HISTORIQUE — NE PAS SUIVRE COMME PROCÉDURE.**
> Ce document décrit un état du système à la date de sa rédaction. Plusieurs
> architectures qu'il mentionne ont été supprimées depuis — notamment la page
> IntegratedAPI du Manager, les credentials Brevo locaux et le webhook Brevo
> local. Autorités actuelles : [ARCHITECTURE.md](ARCHITECTURE.md) ·
> [PROTOCOL.md](PROTOCOL.md) · [INTEGRATED_API.md](INTEGRATED_API.md) ·
> [PANEL_BRIDGE.md](PANEL_BRIDGE.md).


> Deux anomalies fonctionnelles ciblées, sans refonte du moteur de déploiement.

## BUG 1 — La vitrine affichait une ancienne version

### Cause exacte (démontrée, pas supposée)

Audit du site réellement servi (`https://demo-sbauto.lycarz.com`) :

| Preuve | Constat |
|---|---|
| `index.html` servi | référence **`/assets/index-BfjDWAPH.js`** = le hash du build du rapport |
| `version.json` servi | `commit 1f940c4`, `builtAt 2026-07-22T20:24:51`, `vitrineArtifactHash 2b137e44…` |
| `sw.js` / `service-worker.js` / `manifest.webmanifest` | `text/html`, 1528 o = **fallback SPA** → **aucun service worker** réel |
| en-têtes `index.html` | **AUCUN `Cache-Control`** (ni `expires`, ni `add_header`) |

**Le serveur servait donc la BONNE version.** La divergence était côté **navigateur** :
la config Nginx générée ne posait **aucune** politique de cache. Sans `Cache-Control`,
le navigateur applique un **cache heuristique** sur `index.html` et continue de servir
l'ancien `index.html` (qui référence d'anciens hash d'assets) sans revalider — d'où
« l'ancienne version ». Défaut secondaire : un asset au hash périmé retombait sur
`index.html` via `try_files` (HTML servi pour un `.js`) au lieu d'un 404 franc.

### Correction minimale

- **`nginx.js`** — helper `staticSiteLocations()` appliqué à la vitrine ET au Manager :
  - `index.html` / `version.json` / `build-manifest.json` → `Cache-Control: no-cache`
    (toujours revalider → le nouveau build est pris immédiatement) ;
  - `/assets/*` (nom = hash de contenu) → `expires 1y; Cache-Control: public, immutable`
    et `try_files $uri =404` (plus de HTML servi pour un asset absent) ;
  - fallback SPA `/` conservé.
- **Validation `WEBSITE_ARTIFACT_MISMATCH`** (étape `validate` du pipeline) :
  - `build.js` calcule une **empreinte web** de chaque dist : `sha256(index.html)` +
    JS d'entrée `{name, sha256}` (`webFingerprint`) ;
  - `health.js` (`checkWebsiteArtifact`) refait, depuis l'extérieur, la comparaison
    `index.html distant == construit` et `JS principal servi == construit` ;
  - divergence ⇒ `WEBSITE_ARTIFACT_MISMATCH` — le déploiement n'est plus « validé »
    si le navigateur reçoit autre chose que l'artefact construit.

> Effet : après le prochain déploiement, `index.html` est servi en `no-cache` ; un
> navigateur encore sur l'ancienne page se met à jour au prochain chargement (au pire
> après un rafraîchissement forcé, le temps que son cache heuristique préexistant expire).

## BUG 2 — « Suivi des emails » restait jaune

### Cause exacte (démontrée)

La sonde de joignabilité publique répond **200** :
`GET https://api.demo-sbauto.lycarz.com/api/webhooks/brevo/transactional/PROD/health → 200`
(et l'URL du webhook pointe déjà, via `deriveNetworkUrls`, sur `https://api.<domaine>` —
hypothèse d'URL erronée écartée). Le webhook est donc **correctement installé et joignable**.

La carte était pourtant jaune car elle se calcule via
`getBrevoOperationalReadiness(mode, { probe: false })`. Pour un webhook pourtant
structurellement sain, cette fonction exigeait en plus une **preuve de joignabilité
FRAÎCHE** (`healthStatus === 'HEALTHY'` **et** `healthyUntil > now`). Or :

- la carte **ne sonde jamais** (`probe: false`) ;
- la preuve n'est posée que par un **événement reçu** ou une **sonde active**, et elle
  **expire** (TTL 10 min TEST / 60 min PROD).

Résultat : la carte **confondait « webhook installé » et « joignabilité prouvée dans
les N dernières minutes »** → blocage `WEBHOOK_HEALTH_EXPIRED` → état `WEBHOOK_UNAVAILABLE`
(jaune), même avec un endpoint qui répond 200.

### Critères pour passer au VERT — avant / après

| Critère | Garde-fou d'envoi | Carte (avant) | Carte (après) |
|---|---|---|---|
| Provider activé | exigé | exigé | exigé |
| Clé API présente | exigé | exigé | exigé |
| Expéditeur configuré | exigé | exigé | exigé |
| Webhook enregistré + actif | exigé | exigé | exigé |
| Secret présent | exigé | exigé | exigé |
| URL alignée (pas de drift) | exigé | exigé | exigé |
| Événements non désynchronisés | exigé | exigé | exigé |
| **Joignabilité prouvée & non périmée** | **exigé** | **exigé** ❌ | **informatif** ✅ |

### Correction minimale

- **`brevoOperational.service.js`** — nouveau paramètre `requireLiveReachability`
  (défaut `true`). Le bloc de joignabilité ne s'exécute que si `true`.
  - **Garde-fou d'envoi** (`assertBrevoOperational`, `probe: true`) : **inchangé** —
    on ne doit jamais envoyer un e-mail dont on ne pourra pas constater la remise.
  - **Carte** : `requireLiveReachability: false` → l'état reflète l'**installation** ;
    la joignabilité (`healthStatus`, `lastReceivedAt`) est renvoyée à titre **informatif**.
- **`emailConfiguration.service.js`** (`operationalView`) : appelle désormais
  `{ probe: false, requireLiveReachability: false }` et expose `operational.webhook`.
- **Front** : la carte affiche « Dernier événement reçu : <date | —> » **séparément**,
  sans repasser en orange pour un suivi correctement installé.

## Tests ajoutés

- **`website-artifact.test.js` (16)** — `webFingerprint` (index/JS), `checkWebsiteArtifact`
  (identique → ok ; index divergent / JS divergent / injoignable → mismatch ; empreinte
  absente → skip), politique de cache Nginx (no-cache index, assets immutable + `=404`,
  fallback SPA, appliquée aux deux sites).
- **`brevo-operational.test.js` (+11, 93 total)** — installation ≠ joignabilité :
  garde-fou d'envoi bloque toujours sur preuve expirée ; carte verte pour un webhook
  installé sans preuve fraîche, sans sonde, joignabilité informative ; webhook absent
  reste non-vert ; bout-en-bout via `serializeEmailConfiguration`.

## Validation

- `tsc` Manager **0** ; builds Manager + vitrine **OK**.
- Backend : website-artifact 16, deployment-build 44, deployment-engine 99,
  convergence-parity 37, control-plane 29, brevo 63, brevo-operational 93,
  brevo-webhook 147, email-configuration 239, email-delivery 204 — **tous verts**.
- Live (avant redéploiement) : webhook health `200`, vitrine `version.json` = `1f940c4`.
