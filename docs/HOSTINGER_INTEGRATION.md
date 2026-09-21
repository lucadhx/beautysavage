# Intégration Hostinger — Gestion automatique du DNS

> **⚠️ PARTIELLEMENT OBSOLÈTE — l'autorité a changé de main.**
>
> Le DNS n'est plus piloté par un jeton Hostinger **local** : Hostinger est sous
> autorité Panel. Le projet invoque les capacités `dns.zone.resolve` et
> `dns.records.read` ; la plateforme prouve que le nom appartient au projet, puis
> écrit avec SA clé. Il n'y a plus rien à configurer dans SB Auto.
>
> Voir [INTEGRATED_API.md](INTEGRATED_API.md#hostinger--dns).


Lorsque l'intégration Hostinger est **active et configurée** dans IntegratedAPI,
le moteur **crée ou ajuste automatiquement les enregistrements DNS exacts**
requis pour la vitrine ET le Manager, vérifie leur propagation, enrichit le
rapport, puis poursuit le déploiement — **sans intervention manuelle dans
hPanel**.

Voir l'audit complet de l'API : [`HOSTINGER_INTEGRATION_AUDIT.md`](HOSTINGER_INTEGRATION_AUDIT.md)
(source : `docs/hostinger/api-1.json`, aucune capacité inventée).

## Où saisir la clé API

**DEV → Intégrations API → Hostinger** :
1. Coller la **clé API** (hPanel → *Account* → *API* → générer un token).
2. **Enregistrer** (chiffrée AES-256-GCM, jamais renvoyée, jamais en clair).
3. **Vérifier** : appel RÉEL non destructif (`GET /api/domains/v1/portfolio`) →
   nombre de domaines accessibles, **aucun changement**.
4. Choisir le **mode actif** (TEST/PROD, indépendant de l'ENV applicatif).

### Permissions requises pour la clé
Scopes **Domains (lecture)** et **DNS (lecture + écriture)** sur la zone visée.
Sans écriture DNS : lecture/diagnostic OK, la création échoue en
`HOSTINGER_PERMISSION_DENIED` (403).

## Architecture

```
DnsProvider (interface)  ← le pipeline en dépend, jamais du client Hostinger
   └─ HostingerDnsProvider  → HostingerClient (Bearer, retry GET, 429, correlation_id)
backend/src/integrations/hostinger/  hostinger.{errors,client,dnsProvider,service}.js
backend/src/deployment/dns/          zoneResolver(PSL) · ensureDns · propagation · strategy · dnsPhase · MockDnsProvider
```

- **Zone** : déduite par **Public Suffix List** (`tldts`) → domaine registrable,
  puis zone gérée **la plus spécifique** (co.uk, com.br… gérés correctement).
- **URL vitrine** : toujours saisie par l'utilisateur. **URL Manager** : dérivée
  `manager.<host>`. Les DEUX adresses sont créées/vérifiées automatiquement.

## Parcours DNS automatique (ordre sûr, §8)

Aucune mutation externe avant les validations non destructives indispensables :

```
1. Validation destination
2. dns.zone      Détection du domaine (zone la plus spécifique)
3. dns.provider  Connexion + vérification credentials (non destructif)
4. dns.read      Lecture des enregistrements + détection de conflits (plan, sans muter)
5. ssh.connect   Connexion sécurisée au serveur
6. server.preflight / remote.safety
7. dns.site      Création/correction A de l'hôte principal ← MUTATION (après SSH OK)
8. dns.apps      Création/correction A de CHAQUE application sur sous-domaine ← MUTATION
                 (liste dérivée du profil ; étape ignorée si le profil n'en déclare aucune)
9. dns.verify    Résolution DNS publique de TOUS les hôtes (bornée, retryable)
10. (déploiement)
```

Un **SSH KO → aucun enregistrement DNS inutile** n'est créé (les mutations
n'ont lieu qu'après la connexion serveur validée).

## Politique DNS (idempotence & conflits)

| Situation | Action |
|---|---|
| Aucun A exact | **create** |
| A exact = bonne IP | **none** (`already_correct`) |
| A exact = autre IP | **conflict** `WRONG_IP` (bloqué, ancienne/nouvelle valeur affichées) |
| CNAME au même nom | **conflict** `CNAME_CONFLICT` |
| Plusieurs A | **conflict** `MULTIPLE_A` |
| Wildcard `*` = bonne IP, pas de A exact | **wildcard_covers** (pas de création ; résolution exacte vérifiée à part) |

> Un enregistrement tiers n'est **jamais écrasé** silencieusement. La correction
> exige une confirmation explicite (`allowOverwrite`). Le moteur ne supprime que
> ce qu'il a créé. Une wildcard `*.zone` ne présume **jamais** la couverture d'un
> hôte à deux niveaux (ex. `manager.demo-sbauto.zone`) : chaque hôte est vérifié.

## Propagation (trois états distincts)

1. succès de l'appel API Hostinger ; 2. visibilité dans la zone (relecture) ;
3. **résolution DNS publique** effective. La phase `dns.verify` interroge la
résolution publique avec tentatives bornées + intervalle progressif + timeout
global. Propagation en cours → **avertissement retryable** (adresses créées, IDs
conservés), jamais un état « inconnu ».

## TTL

TTL demandé **300 s** (dev). L'API accepte un `ttl` par enregistrement ; le
rapport indique TTL demandé / appliqué / existant. Un TTL refusé ne fait pas
échouer l'opération (repli sur la valeur acceptée).

## Rapport enrichi

Section **`## Hostinger / DNS provider`** (sans secret) : provider, zone,
stratégie de sélection, hostnames, action par adresse (none/create/update/
conflict), valeur précédente/attendue, TTL, `correlation_id`, résolution
publique des deux hôtes, chronologie, erreurs typées, recommandations.

## Sécurité / redaction

La clé API est **chiffrée** (IntegratedAPI), **jamais** exposée au frontend, aux
logs, au rapport, au flux NDJSON, à Git. La redaction centrale masque
`Authorization: Bearer …` et la valeur exacte de la clé → `[REDACTED_SECRET]`.
Tests dédiés anti-fuite.

## Domaine externe / non géré / migration

- Domaine **non présent** dans le portefeuille Hostinger → `dns.zone`/`dns.read`
  l'expliquent ; fallback DNS manuel (le DNS doit déjà pointer vers le VPS).
- **Hostinger non configuré** → étapes DNS **sautées** + avertissement + **CTA**
  vers Intégrations API (affiché AVANT le lancement, pas après plusieurs minutes).
- Stratégies préservées : `HOSTINGER_MANAGED` | `EXISTING_DNS` (wildcard/manuel)
  | `MANUAL` | `NONE`. Aucun flux existant cassé. Rien codé en dur (domaine, IP,
  zone) : n'importe quelle URL complète valide est acceptée.

## Prochain test réel

1. Saisir + **Vérifier** la clé API (DEV → Intégrations API → Hostinger).
2. Activer le mode.
3. Déployer `https://demo-sbauto.lycarz.com` : zone `lycarz.com` détectée, `A`
   `demo-sbauto` et `A` `manager.demo-sbauto` créés/vérifiés vers l'IP du VPS,
   propagation vérifiée, déploiement poursuivi — **sans ouvrir hPanel**.
