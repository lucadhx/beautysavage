# BOOTSTRAP — LES REPRISES AVANT LES WORKERS

> **Invariant tenu par ce lot** — aucun service de fond ne peut observer ou
> modifier un état que l'amorçage doit encore réparer. Au moment où le premier
> worker peut produire un effet, toutes les reprises structurelles dont il
> dépend sont terminées et leurs garanties constatées.

Ce lot ferme le dernier risque résiduel du lot précédent
([BOOTSTRAP_STARTUP_INVARIANTS_REPORT](BOOTSTRAP_STARTUP_INVARIANTS_REPORT.md)),
qui reste **PASS** et n'est pas régressé.

---

## 1. LA CAUSE RACINE

Les reprises structurelles vivaient dans `server.js`, **après** `bootstrap()`.
Or `bootstrap()` démarre les services de fond. L'ordre réel était donc :

```text
BACKGROUND SERVICES  →  REPRISES  →  INVARIANTS  →  READY
```

L'ordonnanceur du pont battait, le signe de vie annonçait « OK » au Panel, les
déclencheurs de synchronisation étaient armés et la veille du tunnel tournait —
pendant que l'état structurel du projet était encore en cours de réparation.

### Le cas le plus coûteux n'était pas théorique

`migrateDeploymentTargets()` ne **répare** pas « deux destinations ACTIVE dans le
même environnement » : elle **refuse le démarrage** (`MigrationBlockedError /
ACTIVE_CONFLICT`). Le processus sortait donc en erreur — *après* avoir dit au
Panel qu'il était vivant et en bonne santé.

Un backend qui s'annonce sain puis meurt est pire qu'un backend qui ne démarre
pas : la supervision a enregistré un signe de vie qui n'engageait rien.

---

## 2. AUDIT DU CONTRAT `bootstrap()`

`bootstrap()` compte **46 appelants**, tous sous la forme `await bootstrap()`
sans argument. Un seul est le runtime de production.

| Contexte | Appelants | Attentes |
|---|---|---|
| Runtime production | `src/server.js` | core + panel + integratedAPI + **reprises** + workers |
| Outils CLI | `scripts/seed.js`, `scripts/email-diagnostic.js` | état préparé ; workers indifférents |
| Recettes | 44 fichiers `src/scripts/*.test.js` | voir ci-dessous |

### Les recettes qui dépendent RÉELLEMENT des workers

Relevé par recherche des symboles qu'elles observent (`PanelOutboxEntry`,
`hasSyncListener`, `describeScheduler`, `notifyResourceChanged`, `reconcileAll`,
`runPushCycle`, `runSyncCycle`) :

```text
bootstrap-recovery-before-workers.test.js    bootstrap-startup-invariants.test.js
contract-operations.test.js                  contract-payment-grace-policy.test.js
contract-projection-immediacy.test.js        project-sync.test.js
runtime-shutdown.test.js                     team-sync.test.js
ui-live-channel.test.js
```

**Neuf recettes** cassent si `bootstrap()` cesse de brancher les déclencheurs de
synchronisation. C'est le fait décisif de la stratégie de compatibilité : le
risque à fermer n'était pas « `bootstrap()` démarre des workers », c'était
« des workers démarrent avant les reprises ».

---

## 3. CLASSIFICATION DES REPRISES

Déduite de ce que l'**échec** de chacune laisserait derrière lui, jamais de sa
place dans le fichier.

| Reprise | Classe | Bloquante | Justification |
|---|---|---|---|
| `migrateDeploymentTargets` | **STRUCTURAL** | **OUI** | Porte « une seule destination ACTIVE par environnement » : détecte les conflits, construit l'index unique et le **relit en base**. Sans elle la garantie n'existe pas, et rien ne le signalerait. |
| `migratePortRegistry` | STRUCTURAL | non | Complète des réservations et **signale** des conflits ; elle n'en arbitre aucun. Un conflit non repris ne rend aucun worker dangereux — c'est le prochain *déploiement* qui sera refusé, par une garde qui lui est propre. |
| `migrateProjectMedia` | BUSINESS | non | Complète l'environnement de médias existants. Aucun worker ne les lit au démarrage. |
| `consommerMarqueurReprise` | BUSINESS | non | Qualifie un redémarrage attendu. Son échec produit au pire un run mal étiqueté. |
| `recoverOrphanRuns` | BUSINESS | non | Referme des étapes `running` sans processus. Son échec laisse un écran en chargement — lisible, réparé au démarrage suivant. |
| `finalizeOrphanRuns` | BUSINESS | non | Idem, sur les runs les plus anciens. |

### L'ordre interne compte aussi

1. **Destinations** d'abord — seule bloquante ; inutile de réparer des données
   pour un processus qui ne servira jamais.
2. **Registre des ports** ensuite — il **lit** les destinations que l'étape 1
   vient de compléter (`lifecycleStatus`, `environment`).
3. **Médias**, indépendants.
4. **Marqueur** de reprise **avant** la reprise générique — sinon un redémarrage
   parfaitement attendu (celui que le backend provoque en déployant sa propre
   application) serait qualifié d'incident.
5. **Runs orphelins**, puis finalisation des plus anciens.

---

## 4. MATRICE DE DÉPENDANCE DES WORKERS

| Worker | Lit / écrit | Sûr à partir de | Criticité |
|---|---|---|---|
| Veille du tunnel (`setInterval` 60 s) | ngrok, webhooks distants, `SystemConfiguration.network` | état structurel prêt | dégradable (confort de développement) |
| Déclencheurs de synchronisation | `Company`, `Contract`, `SiteStatus`, `User` → outbox | état structurel prêt | **bloquant si appairé** — sans eux plus rien ne part vers le Panel |
| Signe de vie Panel | publie une **santé** | état structurel prêt | dégradable (Panel injoignable ≠ projet cassé) |
| Photographie complète | lit l'état métier → outbox | état structurel prêt | dégradable (l'ordonnanceur reprend) |
| Ordonnanceur du pont | heartbeat + outbox + pull | état structurel prêt | **bloquant si appairé** — sinon le Panel classe le projet hors ligne |

**La criticité vient du rôle, pas du type.** Classer tous les ordonnanceurs
« non bloquants » serait commode et faux : sur un projet appairé, l'ordonnanceur
et les déclencheurs portent la synchronisation entière. Sur un projet autonome,
ils n'ont personne à servir — leur absence est un constat, pas une panne.

---

## 5. DÉCISION D'ARCHITECTURE

Deux frontières explicites, et une façade qui les enchaîne.

```js
await bootstrapStructuralState();   // CORE → PANEL → INTEGRATED APIs → REPRISES → INVARIANTS STRUCTURELS
await startBackgroundServices();    // BACKGROUND SERVICES → INVARIANTS DE SERVICES
```

* `bootstrapStructuralState()` **lève** si une reprise bloquante échoue. À cet
  instant, aucun minuteur n'est armé, aucun déclencheur branché, aucun heartbeat
  parti.
* `startBackgroundServices()` **refuse** de démarrer quoi que ce soit tant que la
  phase 1 n'a pas abouti. *C'est la garde, et non l'ordre des lignes, qui rend
  l'invariant vrai* — une convention se perd au premier appelant pressé.
* `stopBackgroundServices()` est son exact symétrique : ordre **inverse**,
  inventaire vidé, vidangeur désinscrit.

Les noms génériques (`init()`, `start()`, `run()`) ont été écartés : trois
lifecycles coexistent ici (runtime, pont, reprises), et un verbe ambigu aurait
rendu impossible de dire lequel on démarre.

---

## 6. STRATÉGIE DE COMPATIBILITÉ

```js
export async function bootstrap(options = {}) {
  const etat = await bootstrapStructuralState();
  if (options.startBackgroundServices !== false) await startBackgroundServices();
  return { structural: etat, backgroundServices: describeBackgroundServices(), pendingRetries: … };
}
```

* **Les 45 appelants historiques ne changent pas.** `await bootstrap()` continue
  de préparer l'état **et** de démarrer les services — parce que neuf recettes en
  dépendent réellement.
* **L'ordre sûr est garanti DANS la façade.** Même un appelant qui ignore tout du
  lifecycle obtient désormais reprises → invariants → workers. On ne pouvait pas
  laisser `bootstrap()` démarrer des workers sans y déplacer aussi les reprises :
  la façade aurait elle-même violé l'invariant du lot.
* **Le runtime réel n'utilise pas la façade.** `server.js` appelle les deux
  phases explicitement : un point d'entrée qui délègue à une façade ne montre
  plus l'ordre qu'il garantit.
* `bootstrap({ startBackgroundServices: false })` sert aux recettes qui veulent
  éprouver l'état structurel seul, ou activer à la main.

**Le seul changement observable pour les anciens appelants** : les reprises
tournent désormais pendant `bootstrap()`. Sur les bases de recette (vides ou
neuves) elles sont des no-op ; la suite complète en est la preuve.

---

## 7. ORDRE APRÈS — la séquence réellement exécutée par `server.js`

```text
installProcessGuards()
beginBootstrapReport()
app.listen()                       ← le port répond ; routes métier = 503 SERVICE_STARTING
connectDatabase()                  ← BLOQUANT
│
├─ bootstrapStructuralState()
│   ├─ amorcerCoeur()              CORE
│   ├─ amorcerPanel()              PANEL
│   ├─ amorcerIntegratedApis()     INTEGRATED APIs
│   ├─ runStructuralRecovery()     REPRISES  ← déplacées ici
│   └─ assertStructuralInvariants()  STRUCTURAL INVARIANTS ← frontière
│
├─ startBackgroundServices()       ← REFUSE si la phase 1 n'a pas abouti
│   ├─ demarrerServices()          BACKGROUND SERVICES
│   └─ verifierInvariantsDeServices()  SERVICE INVARIANTS
│
├─ invariants finaux + critère d'acceptation chiffré
├─ assertBootstrapInvariants()     ← la condition de READY
├─ finalizeBootstrapReport()
└─ markReady() ; « API PRÊTE »
```

---

## 8. INVARIANTS STRUCTURELS

Déduits du runtime réel, pas d'une liste souhaitée.

| Invariant | Preuve exigée |
|---|---|
| Une seule destination active par environnement | index unique **relu en base** après reprise, aucun conflit actif |
| Aucune reprise structurelle encore en vol | toutes les reprises ont rendu leur issue avant cette ligne |
| Aucune reprise bloquante en échec | les reprises portant une garantie ont toutes abouti |

Le registre des ports et l'état média n'y figurent **pas** : le code réel ne leur
fait porter aucune garantie. Les y inscrire aurait produit un invariant
décoratif — c'est-à-dire un invariant qu'on finit par contourner.

---

## 9. INVARIANTS DE SERVICES

Un `startX()` qui rend sans lever ne prouve rien. On interroge les composants.

| Invariant | Preuve | Criticité |
|---|---|---|
| Déclencheurs branchés | `hasSyncListener()` — emplacement unique par construction | bloquant si appairé |
| Ordonnanceur actif | `describeScheduler().running` — un minuteur **existe** | bloquant si appairé + cadence voulue |
| Gestionnaire de reprises opérationnel | le runtime accepte encore du travail | bloquant |
| Toutes les ressources inscrites à l'arrêt | `drainHookLabels()` contient « services de fond » | bloquant |
| Aucun service en double | l'inventaire n'a aucun libellé répété | bloquant |

---

## 10. CONTRAT DE READINESS

```text
état structurel préparé
ET reprises structurelles terminées
ET invariants structurels satisfaits
ET services de fond démarrés
ET invariants de services satisfaits
ET blockingErrors = 0
→ markReady()
```

Le critère d'acceptation est **chiffré**, relu auprès de ses modules au moment où
il est écrit — jamais recopié d'une variable posée plus haut :

```text
[ ok ] Aucun service de fond n’a observé un état non réparé —
       structuralRecoveryPending=0 · structuralInvariantFailures=0 ·
       requiredWorkersMissing=0 · duplicateWorkers=0 · blockingErrors=0
```

Pendant tout le chemin, les routes métier répondent `503 SERVICE_STARTING`.

---

## 11. ORDRE D'ARRÊT

```text
isShuttingDown() = true          ← readinessPhase() passe DRAINING, les routes refusent
        ↓
beginDraining()
        ↓
stopBackgroundServices()         ← ordre INVERSE du démarrage :
        ordonnanceur du pont  (drainBridgeScheduler : arrête PUIS attend les cycles en vol)
        déclencheurs de synchronisation
        veille du tunnel
        ↓
reprises de démarrage arrêtées   (vidangeur propre au gestionnaire)
        ↓
server.close() + closeIdleConnections()
        ↓
disconnectDatabase()
```

Aucun worker n'écrit pendant qu'on démonte son stockage.

---

## 12. PREUVE DE LA FENÊTRE DE COURSE

`npm run test:bootstrap-order` — preuve **temporelle**, pas textuelle. Le double
de Panel horodate chaque appel reçu ; la reprise horodate sa fin.

```text
✓ les reprises structurelles sont TERMINÉES à la fin de la phase 1
✓ AUCUN cycle de worker pendant la phase 1 (cycles avant reprises = 0)
✓ …la phase 1 a bien fait ses appels de PRÉPARATION (webhook Stripe provisionné)
✓ …puis l’ordonnanceur travaille réellement (le worker EXISTE)
✓ PREUVE : reprises terminées à Tn, premier cycle de worker à Tn+19 ms
✓ PREUVE : cycles de worker antérieurs à la fin des reprises = 0
✓ le rapport horodaté confirme : dernière reprise ≤ premier service
✓ les invariants structurels sont constatés ENTRE les deux
```

Un « cycle de worker » est un verbe de l'**ordonnanceur** (`heartbeat`,
`pushChanges`, `pullChanges`) : les gestes périodiques, ceux qui partent sans que
personne ne les ait demandés. Le provisionnement du webhook Stripe
(`invokeCapability`) n'en est pas un : c'est une étape de *préparation*, que
l'ordre cible place délibérément en phase 3. La distinction n'est pas
cosmétique — un provisionnement ne lit aucune donnée que les reprises réparent,
là où un heartbeat publie une **santé** que le backend n'est pas encore en droit
de promettre.

### Le cas bloquant, qui est le plus net

```text
✓ la garantie est tenue par la BASE : une 2ᵉ destination active est refusée
✓ …état hérité reconstitué : deux destinations actives, sans index
✓ la phase 1 LÈVE sur une reprise bloquante en échec
✓ AUCUN service de fond n’a démarré
✓ …aucun minuteur d’ordonnanceur
✓ …aucun déclencheur de synchronisation
✓ LE PANEL N’A REÇU AUCUN SIGNE DE VIE d’un backend qui ne démarrera pas
```

---

## 12 bis. RÉSULTATS

```text
npm run test:bootstrap-order   →  78 réussis, 0 échoués   (nouveau lot)
npm run test:bootstrap         →  91 réussis, 0 échoués   (lot précédent, intact)
npm test                       →  95 scripts · 5 782 constats · 0 échec · exit 0
```

### Trois gardes de source mises à jour

Elles lisaient `server.js` pour une logique qui a changé de fichier. L'invariant
qu'elles protègent est **inchangé** ; seul son hébergeur a bougé.

| Recette | Ce qu'elle vérifie | Fichier lu, désormais |
|---|---|---|
| `migration-fail-closed` | la reprise porteuse de garantie n'est pas absorbée ; les autres restent tolérantes | `structuralRecovery.service.js` |
| `deployment-ssh-restart` | le marqueur est lu **avant** la reprise générique des runs | `structuralRecovery.service.js` |
| `bootstrap-startup-invariants` | le drainage couvre toutes les ressources de fond | inventaire + vidangeur unique |

Chacune a été **renforcée** au passage : elles vérifient en plus que la reprise
précède le démarrage des services — la propriété que ce lot installe.

Un balayage a été fait pour les autres gardes lisant `server.js` : aucune ne
référence les reprises déplacées.

### Un vrai défaut trouvé par la recette

`startBackgroundServices()` rendait `{ started: false, reason:
'NOOP_ALREADY_STARTED', ...describeBackgroundServices() }`. Le spread arrivant
**en dernier**, `describeBackgroundServices().started` — qui vaut `true` puisque
les services tournent — écrasait le `started: false` du refus. Le NOOP se
déguisait donc en démarrage réussi : exactement le genre de réponse qui rend une
idempotence invérifiable. L'ordre des champs est corrigé.

---

## 13. RISQUES RÉSIDUELS

1. **Les recettes exécutent désormais les reprises.** C'est la contrepartie
   assumée de la façade : impossible de laisser `bootstrap()` démarrer des
   workers sans y déplacer les reprises. Sur des bases de recette elles sont des
   no-op — la suite complète est la preuve, pas une supposition.
2. **`assertServiceInvariants()` est exporté pour la recette.** Sans lui, le cas
   « le worker obligatoire manque » n'était pas inductible sans modifier le
   produit. La surface est symétrique de `assertStructuralInvariants()` et ne
   permet que de *constater*.
3. **Une seule reprise dégradable est réellement inductible en échec**
   (`migrateProjectMedia`, via une doublure sur le modèle). Les autres échouent
   par des chemins qu'on ne peut pas provoquer sans toucher au produit ; leur
   classification est documentée et lisible dans la source, pas éprouvée
   individuellement.
4. **`SIGTERM` pendant une reprise n'est pas simulé au niveau du signal.** La
   recette prouve l'état équivalent (arrêt demandé alors que rien n'a démarré →
   NOOP, aucune fausse panne). Envoyer un vrai signal au milieu d'une reprise
   demanderait un processus enfant et un point d'arrêt injecté dans le produit.
5. **Le provisionnement du webhook Stripe précède les reprises** (phase 3 avant
   phase 4), conformément à l'ordre cible demandé. Il contacte donc le Panel
   avant que la viabilité du démarrage ne soit établie. Aucune donnée réparée par
   les reprises n'est en jeu, mais si l'on voulait qu'aucun appel sortant ne
   précède les reprises, il faudrait déplacer INTEGRATED APIs après RECOVERY —
   ce qui contredirait l'ordre cible de ce lot.
