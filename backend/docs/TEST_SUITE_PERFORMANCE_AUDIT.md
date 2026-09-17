# Audit performance des suites de tests

> Branche `phase-0-security-baseline` (RX-BLOCKER-2-FINAL). Objectif : comprendre pourquoi valider un sprint
> prend ~1 h et « donne l'impression que rien ne se passe », puis fournir des scripts rapides/complets **sans
> désactiver ni affaiblir un seul test**.

## 1. Cause racine de la lenteur
Configuration backend (`vitest.config.js`) : `pool: 'forks'` + **`fileParallelism: false`**. Chaque **fichier**
de test s'exécute dans un fork **séquentiel**, et `tests/setup/testDb.js` démarre **une instance
`MongoMemoryServer` par fichier** (`startMemoryDb()` mémoïsé par worker) puis importe `app.js` (connexion
mongoose + migrations). → **coût fixe d'amorçage ~6–7 s PAR FICHIER**, avant même d'exécuter les assertions.

Ce choix est **volontaire et correct** : lancer plusieurs mongod en parallèle saturait la machine (fuites,
instabilité). Mais il rend le temps ≈ **(nb de fichiers) × coût d'amorçage + temps des tests**.

### Le multiplicateur : le nombre de fichiers
| Suite | Fichiers | Tests | Durée mesurée | Coût/fichier implicite |
|---|---:|---:|---:|---:|
| `tests/p0` | 14 | 44 | **92,8 s** | ~6,6 s |
| `tests/p1` | **200** | ~900 | **~20–30 min** (extrapolé : 200 × ~6,6 s + tests) | ~6,6 s |
| `tests/integration` | 2 | — | ~15–20 s | — |
| `tests/audit` (business + commissions) | 2 | — | ~1–3 min | — |
| Front `react:test` | 125 | ~470 | _voir §mesures_ (jsdom, parallèle) | faible |
| Front `react:build` | — | — | **12,7 s** | — |
| RX-BLOCKER-2 ciblé (3 back + 2 front) | 5 | 23 | **1 m 18 s** | — |

**`tests/p1` (200 fichiers) domine tout.** C'est là que part l'heure.

## 2. Cause racine du crash « frontend »
Lancer **la suite backend complète ET la suite frontend (test+lint+build) EN MÊME TEMPS** (deux tâches de fond)
sature les processus Windows : `Worker exited unexpectedly` (tinypool) puis
`fork: Resource temporarily unavailable`. **Ce n'est pas un test rouge** — relancées **seules**, les suites
passent. Le remède est de **ne jamais chevaucher deux suites lourdes**.

## 3. Bruit de logs (« rien ne se passe »)
`app.js` appelait `morgan('dev')` **inconditionnellement** → chaque requête HTTP de test imprimait une ligne
(`POST /auth/login 200 …`), noyant les récapitulatifs vitest et donnant l'impression d'un blocage.

## 4. Correctifs livrés (sûrs, aucun test affaibli)
1. **Orchestrateur séquentiel fail-fast** `scripts/run/runReleaseChecks.js` : exécute les étapes **l'une après
   l'autre** (jamais de chevauchement → plus de crash de saturation), affiche `[i/N] <étape> — démarré HH:MM:SS`
   puis `PASS/FAIL en <durée>`, et un **récapitulatif chronométré**. S'arrête à la 1ʳᵉ étape rouge.
2. **Scripts npm ciblés** (additifs — rien de supprimé) :
   - `npm run test:rx-blocker-2` → uniquement les tests RX-BLOCKER-2 (3 fichiers backend + 2 front) — **~1 m 20**.
   - `npm run test:quick` → RX-BLOCKER-2 + `test:p0` + `react:lint` — boucle rapide de sprint.
   - `npm run test:release` → les 8 étapes complètes, séquentielles, fail-fast.
   - `npm run test:perf:audit` → mêmes étapes que release mais **sans fail-fast**, imprime la durée de chacune
     (pour re-mesurer quand on veut).
3. **Log HTTP coupé en test** : `app.js` ne monte `morgan('dev')` que si `NODE_ENV !== 'test'` → sortie vitest
   lisible. Purement cosmétique/logging, aucun impact fonctionnel.

## 5. Stratégie d'usage recommandée
- **Pendant le dev d'un sprint** : `npm run test:rx-blocker-2` (ou `test:quick`) → feedback en 1–2 min.
- **Avant démo / merge** : `npm run test:release` → tout, séquentiel, fail-fast, visible.
- **Ne jamais** lancer deux suites lourdes en parallèle (backend-full ∥ front-full) → saturation garantie.

## 6. Optimisations futures (NON appliquées — risque à évaluer, hors périmètre sûr de ce sprint)
| Piste | Gain attendu | Risque / pourquoi différée |
|---|---|---|
| **Mongo unique partagé** entre fichiers (1 `MongoMemoryServer` global + `clearDatabase()` entre tests) au lieu d'1/fichier | **Très élevé** (supprime ~6 s × 200) | Refonte de `testDb.js`/`testApp.js` ; l'isolation par fichier doit rester garantie (état global, index, `process.env` partagé en forks). À faire dans un sprint dédié avec preuve d'isolation. |
| **Sharder `tests/p1`** en lots (`p1/a*`, `p1/b*`…) exécutés séquentiellement mais mesurés | Visibilité + parallélisme contrôlé | Ne réduit pas le coût fixe total ; utile surtout pour le reporting. |
| `--reporter=dot` sur les suites backend | Sortie plus courte | Cosmétique ; peut masquer le détail d'un test lent. |
| Réutiliser l'app bootée (`getTestApp` déjà mémoïsé) sur plus de fichiers | Moyen | Nécessiterait de regrouper des fichiers → couplage. |

**Interdits respectés** : aucun test désactivé/skippé, aucune assertion retirée, `fileParallelism:false` conservé
(sa suppression réintroduirait les fuites multi-mongod), pool Vitest inchangé (pas de preuve d'un meilleur).

## 7. Mesures brutes (cette session, séquentielles)
- `test:rx-blocker-2` : 14 back + 9 front verts — **1 m 18 s**.
- `test:p0` : 44 verts / 14 fichiers — **92,8 s**.
- `react:build` : vitrine + manager — **12,7 s**.
- Suite backend complète : **exit 0 (verte)** en tâche de fond (longue — cf. §1).
