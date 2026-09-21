# Promotion des données TEST → PROD

Procédure fiable, sécurisée et **réutilisable** pour dupliquer les données de la
base **TEST** vers la base **PROD** sur le **même cluster** MongoDB.

> ⚠️ La base **TEST reste l'environnement de travail** et n'est **jamais** modifiée
> par cette procédure. PROD est l'environnement destiné au déploiement VPS.

---

## 1. Pourquoi cette migration ?

Toute la vraie donnée métier vit dans **DB_TEST** (saisie via le manager en local).
Avant un déploiement VPS, il faut initialiser **DB_PROD** avec une **photographie
fidèle** de TEST : mêmes `_id`, mêmes relations, mêmes timestamps, mêmes mots de
passe hashés, mêmes singletons, mêmes configurations.

Ce n'est **pas** une synchronisation continue : c'est une **copie ponctuelle et
contrôlée**. Toute migration ultérieure devra être relancée explicitement.

## 2. Source et destination

| | Base | Rôle | Écriture ? |
|---|---|---|---|
| **Source** | `DB_TEST` | données réelles | **jamais** (lecture seule) |
| **Destination** | `DB_PROD` | cible de déploiement | oui (copie) |

La source est **toujours** explicitement `DB_TEST`, la destination **toujours**
`DB_PROD` — **indépendamment** de la variable `ENV`. Les deux connexions sont
des clients MongoDB **physiquement distincts**.

## 3. Prérequis

Dans `backend/.env` :

```env
MONGODB_URI=...      # un seul cluster
DB_TEST=..._test     # source
DB_PROD=..._prod     # destination (DIFFÉRENTE de DB_TEST)
```

Le script **refuse de démarrer** si `DB_TEST === DB_PROD` ou si une variable manque.
`ENV` n'a **aucune** influence sur le choix source/destination.

## 4. Commandes

```bash
cd backend

npm run db:promote:audit      # lecture seule : compare TEST/PROD, ne modifie rien
npm run db:promote:dry-run    # simulation : aucune écriture, rapport complet
npm run db:promote            # migration réelle (confirmation requise)
npm run db:verify-prod        # vérifie la parité TEST/PROD (lecture seule)
```

Options du mode réel :

| Option | Effet |
|---|---|
| `--reset-prod` | Réinitialise PROD (sauvegarde + suppression des collections) avant la copie. **Requis pour une PROD non vide.** |
| `--allow-non-empty-prod` | Insère par-dessus une PROD non vide (usage avancé, risque de conflits d'unicité). |

## 5. Déroulé recommandé

### Étape 1 — Audit
```bash
npm run db:promote:audit
```
Affiche les collections détectées, le nombre de documents TEST vs PROD, l'état des
singletons/comptes/uploads et les URLs `localhost`/`ngrok`. **N'écrit rien.**

### Étape 2 — Dry-run
```bash
npm run db:promote:dry-run           # ou : --dry-run --reset-prod
```
Simule toute la migration et génère un rapport détaillé. **N'écrit ni dans TEST ni
dans PROD.**

### Étape 3 — Migration réelle
```bash
npm run db:promote -- --reset-prod   # si PROD n'est pas vide
```
Le script :
1. calcule l'empreinte de TEST (**avant**) ;
2. **sauvegarde** PROD (snapshot JSON, jamais supprimé automatiquement) ;
3. réinitialise PROD si `--reset-prod` (jamais TEST, jamais `dropDatabase`) ;
4. copie chaque collection (documents + index) ;
5. recalcule l'empreinte de TEST (**après**) → **TEST inchangée : OUI/NON** ;
6. contrôle la **parité** PROD vs TEST (empreintes par collection) ;
7. contrôle l'intégrité de PROD (singletons, comptes, références).

La migration n'est déclarée **réussie** que si : TEST inchangée **ET** toutes les
collections en parité **ET** aucune erreur d'intégrité.

**Confirmation** — en interactif, il faut taper exactement :
```
PROMOTE TEST TO PROD
```
En non-interactif (CI uniquement) :
```bash
CONFIRM_PROD_PROMOTION=PROMOTE_TEST_TO_PROD npm run db:promote -- --reset-prod
```

### Étape 4 — Vérification
```bash
npm run db:verify-prod
```
Recompare TEST et PROD (collections, counts, ensembles de `_id`, empreintes de
contenu, singletons, comptes, références). **Lecture seule.**

### Étape 5 — Boot PROD temporaire
```bash
# dans backend/.env : ENV=PROD (temporairement)
npm run start
```
Vérifier : connexion, login DEV/ADMIN, `/api/public/bootstrap` (services, avis,
horaires, avant/après, promotions), thèmes, configuration système, uploads,
**aucune duplication**. Puis **repasser `ENV=TEST`** pour le développement local.

## 6. Sauvegarde et rapports

Tous les fichiers sont écrits dans `backend/migration-reports/` (ignoré par Git) :

| Fichier | Contenu |
|---|---|
| `test-to-prod-<ts>.json` / `.md` | Rapport complet (audit / dry-run / apply). |
| `test-to-prod-verify-<ts>.json` / `.md` | Rapport de parité. |
| `uploads-manifest.json` | Fichiers `uploads/` à déployer + références cassées/orphelines. |
| `prod-backup-<ts>.json` | Snapshot EJSON de PROD **avant** migration. |

Aucun rapport ne contient de secret : le scan de secrets ne rapporte que des
**chemins de champs**, jamais de valeurs ; l'URI Mongo, le JWT et les hash de mot
de passe ne sont jamais lus.

## 7. Uploads (fichiers locaux)

Les images sont stockées **localement** dans `backend/uploads/` et référencées en
base par des URL `${PUBLIC_URL}/uploads/<fichier>`. La copie DB **ne déplace pas**
les fichiers. Le `uploads-manifest.json` liste les fichiers à copier sur le VPS,
signale les **références cassées** (fichier manquant) et les **orphelins** (fichier
non référencé). Le déploiement des fichiers se fera lors de l'étape VPS.

## 8. Configuration réseau

`SystemConfiguration.network` (backendUrl / managerUrl / websiteUrl) est copié **tel
quel** depuis TEST. En TEST il contient typiquement `localhost`/`ngrok`. Après
migration, ces valeurs doivent être **remplacées** dans PROD (via le manager en DEV,
*Configuration système › Réseau*) par les vraies URL publiques, **avant** le
déploiement. Le rapport les signale explicitement. Les domaines réels ne sont pas
inventés par le script.

## 9. Comportement du bootstrap en PROD

Le bootstrap au démarrage est **idempotent** et **ne seed aucune donnée de
démonstration en PROD** (garde `!config.isProd`, voir
[`backend/src/config/bootstrap.js`](../backend/src/config/bootstrap.js)) :

- ✅ crée les comptes/singletons manquants (structurel, idempotent) ;
- ❌ n'injecte **jamais** d'avis, FAQ ou extras de démo en PROD ;
- ❌ ne duplique rien (gardes `countDocuments`/`findOne`).

Après migration, les collections sont déjà pleines : le bootstrap est donc un no-op
sur les données.

## 10. Retour arrière (rollback)

PROD étant initialement remplie de données jetables (défaut du bootstrap), le
rollback initial est simple. Procédure **réutilisable** :

1. Le snapshot `prod-backup-<ts>.json` documente l'état **avant** migration.
2. Pour revenir en arrière, relancer une migration contrôlée depuis la source
   souhaitée, ou restaurer manuellement le snapshot avec un petit script d'import
   EJSON (les documents sont sérialisés en EJSON canonique, réimportables tels
   quels).
3. Si `mongodump`/`mongorestore` sont disponibles côté cluster, préférer :
   ```bash
   mongodump  --uri "$MONGODB_URI" --db "$DB_PROD" --out ./dump-prod
   mongorestore --uri "$MONGODB_URI" --nsInclude "$DB_PROD.*" ./dump-prod
   ```

> Ne **jamais** supprimer les fichiers `prod-backup-*.json`.

## 11. Limites

- Copie **ponctuelle** : pas de synchronisation continue ni de réplication.
- Ne copie **pas** les fichiers d'upload (voir manifest + étape VPS).
- Ne remplace **pas** automatiquement les URL `localhost`/`ngrok` (signalées, à
  corriger manuellement).
- Les variables d'environnement (JWT, URI…) ne sont **pas** des données de base et
  ne sont jamais copiées.

## 12. Procédure de validation avant VPS

- [ ] `db:promote:audit` — aucun blocage critique.
- [ ] `db:promote:dry-run` — plan cohérent.
- [ ] `db:promote --reset-prod` — **TEST inchangée : OUI**, parité **MATCH**, intégrité **OK**.
- [ ] `db:verify-prod` — parité globale **MATCH**.
- [ ] Boot `ENV=PROD` — login DEV/ADMIN OK, bootstrap public OK, **aucune duplication**.
- [ ] `uploads-manifest.json` — 0 référence cassée.
- [ ] URL `localhost`/`ngrok` recensées pour remplacement.
- [ ] Repasser `ENV=TEST` en local.

## 13. Contraintes de sécurité garanties

- Jamais d'écriture / suppression / vidage sur TEST (client source en lecture seule).
- Refus si `DB_TEST === DB_PROD`.
- Jamais d'écrasement **silencieux** d'une PROD non vide.
- `--reset-prod` ne peut cibler que `DB_PROD` (vérif du nom de base), jamais TEST,
  jamais `dropDatabase()`.
- Aucun secret affiché ni écrit dans les rapports.
