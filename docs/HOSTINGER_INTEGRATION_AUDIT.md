# Audit de l'API Hostinger (docs/hostinger/api-1.json)

> **⚠️ RAPPORT HISTORIQUE — NE PAS SUIVRE COMME PROCÉDURE.**
> Ce document décrit un état du système à la date de sa rédaction. Plusieurs
> architectures qu'il mentionne ont été supprimées depuis — notamment la page
> IntegratedAPI du Manager, les credentials Brevo locaux et le webhook Brevo
> local. Autorités actuelles : [ARCHITECTURE.md](ARCHITECTURE.md) ·
> [PROTOCOL.md](PROTOCOL.md) · [INTEGRATED_API.md](INTEGRATED_API.md) ·
> [PANEL_BRIDGE.md](PANEL_BRIDGE.md).


Analyse intégrale de la spécification OpenAPI officielle **Hostinger API v1.8.2**
(`docs/hostinger/api-1.json`, OpenAPI 3.0.0). **Aucune capacité inventée** : seuls
les endpoints réellement présents dans la spec sont utilisés.

## Authentification

- Schéma unique : `apiToken` — **HTTP Bearer** (`Authorization: Bearer <token>`).
- `security` global : `[{ apiToken: [] }]` → tous les endpoints exigent le token.
- Serveur de production : `https://developers.hostinger.com`.
- **Aucun** accountId / customerId / zoneId requis : les zones sont adressées par
  **nom de domaine** dans l'URL. → La config IntegratedAPI se limite à `apiToken`
  (+ `baseUrl` éditable, défaut ci-dessus).

## Format d'erreur (commun)

- `{ message: string, correlation_id: string }` (correlation_id = **request ID**,
  précieux pour le rapport).
- 422 (validation) : `{ message, errors: { champ: [msg…] }, correlation_id }`.
- 401 : `{ message: "Unauthenticated", correlation_id }`.
- **429** existe (rate limiting) — la spec ne documente PAS d'en-têtes
  `X-RateLimit-*` ni `Retry-After` → on gère 429 défensivement (erreur typée,
  respect de `Retry-After` s'il est présent, back-off conservateur, **aucun retry
  sur mutation**).

## Matrice de capacités (ce que le moteur utilise)

| Capacité | Supportée | Endpoint | Limites | Usage prévu |
|----------|-----------|----------|---------|-------------|
| Lister les domaines gérés | ✅ | `GET /api/domains/v1/portfolio` | pagination éventuelle | Test de connexion (non destructif) + détection de zone |
| Détails d'un domaine | ✅ | `GET /api/domains/v1/portfolio/{domain}` | — | Diagnostic zone |
| **Lire les enregistrements DNS** | ✅ | `GET /api/dns/v1/zones/{domain}` | zone par nom de domaine | Lire l'existant, détecter conflits |
| **Créer/Mettre à jour DNS** | ✅ | `PUT /api/dns/v1/zones/{domain}` | upsert par (name,type) | Créer/corriger A vitrine + Manager |
| **Valider DNS (non destructif)** | ✅ | `POST /api/dns/v1/zones/{domain}/validate` | même corps que PUT | Dry-run avant mutation |
| Supprimer des enregistrements | ✅ | `DELETE /api/dns/v1/zones/{domain}` | corps `{ filters }` | Rollback ciblé (non utilisé par défaut) |
| Reset zone | ✅ | `POST /api/dns/v1/zones/{domain}/reset` | destructif | **non utilisé** |
| Snapshots DNS (list/get/restore) | ✅ | `GET/POST /api/dns/v1/snapshots/{domain}…` | — | **non utilisé** (piste rollback future) |

### Modèle d'enregistrement DNS (exact, d'après la spec)

`GET zones/{domain}` → tableau de `RecordResource` :
```
{ name: "www"|"@"|"demo-sbauto", type: "A"|"AAAA"|"CNAME"|…, ttl: 14400, records: [{ content: "195.35.0.211" }] }
```
`PUT zones/{domain}` (upsert) — `UpdateRequest` :
```
{ overwrite: boolean (def true), zone: [ { name, type, ttl?, records:[{content}] } ] }
```
- `overwrite:true` : les RR de même (name,type) sont supprimés puis recréés
  (sinon TTL mis à jour + ajout). Portée **limitée aux (name,type) fournis** — ne
  touche pas les autres enregistrements de la zone.
- `@` = nom apex/wildcard ; les noms sont **relatifs** à la zone.

## Capacités présentes mais HORS PÉRIMÈTRE de ce lot (DNS uniquement)

Documentées et réelles, mais non implémentées ici (le produit vise l'automatisation
DNS). Elles pourraient adresser l'échec d'authentification SSH rencontré :

| Capacité | Endpoint | Piste future |
|----------|----------|--------------|
| Firewall VPS (rules, activate…) | `…/api/vps/v1/firewall…` | ouvrir 22/80/443 |
| Clés publiques SSH (attach) | `POST /api/vps/v1/public-keys/attach/{vmId}` | auth SSH par clé |
| Mot de passe root VPS | `PUT /api/vps/v1/virtual-machines/{vmId}/root-password` | réinitialiser le mot de passe |
| PTR, recreate, post-install scripts | `…/api/vps/v1/…` | — |

> Ce lot **n'utilise que le DNS et la lecture des domaines**. Aucune capacité VPS
> n'est appelée. On ne suppose JAMAIS pouvoir modifier la config SSH via l'API.

## Capacités NON disponibles dans la spec

- Pas d'API de « propagation DNS » : la propagation se vérifie par **résolution
  DNS publique réelle** (côté moteur), distincte du succès de l'appel API.
- Pas d'endpoint « get account » dédié : le test de connexion utilise
  `GET portfolio` (liste des domaines).

## Architecture retenue

- Interface **`DnsProvider`** (verifyCredentials, listZones, findBestZone,
  listRecords, ensureRecord, verifyResolution) — le pipeline en dépend, **pas** du
  client Hostinger.
- Client Hostinger isolé (`backend/src/integrations/hostinger/`) : Bearer,
  timeout, AbortController, retry **contrôlé sur GET idempotents uniquement**,
  back-off, 429 typé, parsing défensif, `correlation_id` capturé.
- Détection de zone par **Public Suffix List** (`tldts`) → registrable domain,
  puis choix de la **zone gérée la plus spécifique** parmi le portefeuille.
- Stratégie DNS configurable : `HOSTINGER_MANAGED` | `EXISTING_DNS` | `MANUAL` |
  `NONE` (compat wildcard/DNS manuel/fournisseur externe préservée).

## Sécurité

- `apiToken` **chiffré au repos** (AES-256-GCM, coffre IntegratedAPI existant),
  jamais en clair, jamais renvoyé au frontend, jamais dans les logs/rapports/Git.
- Redaction centrale étendue : `Authorization: Bearer …`, la clé exacte
  enregistrée au runtime → `[REDACTED_SECRET]`.

## Stratégie DNS (résumé) & rollback

- Idempotent (`ensureRecord`) : `already_correct` si l'IP est déjà bonne.
- **Jamais** d'écrasement silencieux d'un enregistrement tiers (IP différente,
  CNAME, A multiples → **conflit bloquant**, ancienne/nouvelle valeur affichées).
- Wildcard : acceptée si elle pointe déjà vers l'IP, **mais** la résolution exacte
  de chaque hostname (vitrine ET Manager) est vérifiée séparément.
- Rollback prudent : on ne supprime **que** ce que le moteur a créé ; métadonnées
  d'origine conservées dans le rapport.

## Procédure de test réel

1. DEV → Intégrations API → **Hostinger** → coller la **clé API** (hPanel →
   Account → API) → **Enregistrer** → **Vérifier** (appel `GET portfolio` non
   destructif : nombre de domaines accessibles, aucun changement).
2. Activer le mode voulu (TEST/PROD).
3. Déploiement : saisir l'URL vitrine → le moteur détecte la zone, prépare les DNS
   vitrine + Manager, vérifie la propagation, puis poursuit SSH + déploiement.

### Permissions requises pour la clé API
La clé doit disposer des scopes **Domains (lecture)** et **DNS (lecture + écriture)**
sur la zone concernée. Sans le scope DNS écriture : lecture/diagnostic OK, mais la
création d'enregistrement échoue avec `HOSTINGER_PERMISSION_DENIED` (403).
