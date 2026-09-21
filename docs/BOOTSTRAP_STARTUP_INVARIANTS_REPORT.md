# BOOTSTRAP / INTEGRATED API — RAPPORT DE LOT

> **Invariant tenu par ce lot** — quand le backend écrit `API PRÊTE`, toute
> IntegratedAPI qui devait quelque chose au démarrage l'a réellement fait, ou
> bien son geste est inscrit à un mécanisme qui le reprendra. Plus aucune
> opération n'est abandonnée en silence parce qu'une dépendance manquait au
> moment où on l'a tentée.

---

## 1. LA CAUSE RACINE

Le démarrage produisait ceci, dans cet ordre exact :

```text
Webhook STRIPE/payment (TEST) : réconciliation sautée (PANEL_NOT_PAIRED).
Pont Panel : appairage restauré (Panel L.Y Solution).
...
API PRÊTE
```

Trois lignes vraies, une conclusion fausse.

`config/bootstrap.js` réconciliait les webhooks **avant** de restaurer
l'appairage du Panel. Or, depuis L6.3A, le webhook Stripe est provisionné *par
le Panel* : `createPanelBackedStripeWebhookManager.ensureWebhook()` commence par
`if (!capabilitiesAvailable()) return { skipped: true, reason: 'PANEL_NOT_PAIRED' }`,
et `capabilitiesAvailable()` exige `isPaired()` — donc `hydratePairing()`.

La dépendance arrivait **deux lignes plus bas**. Le geste sauté ne l'apprenait
jamais : aucun retry, aucune trace exploitable, aucun compteur. Un `return` n'est
pas une décision — c'est un abandon silencieux.

Trois causes secondaires, de même nature :

| # | Cause | Conséquence |
|---|---|---|
| R1 | Ordre accidentel : webhooks avant appairage | Stripe jamais provisionné au démarrage |
| R2 | Aucune mémoire des gestes sautés | Une dépendance qui arrive ne débloque rien |
| R3 | `API PRÊTE` = « `bootstrap()` n'a pas levé » | Aucun invariant vérifié avant d'ouvrir le service |
| R4 | Journal sans totalisateur | Chaque brique décidait seule de son niveau ; rien ne s'additionnait |

---

## 2. ORDRE D'AMORÇAGE — AVANT / APRÈS

### Avant

```text
ENV → Mongo
  └─ bootstrap()
       crypto · comptes · migrations e-mail · singletons · module e-mail
       événements · seeds · migrations · catalogue IntegratedAPI
       purge Panel · état du site · CORS
       ── RÉCONCILIATION DES WEBHOOKS ◀── le Panel n'est pas encore là
       veille ngrok
       ── PONT PANEL : hydratePairing() ◀── la dépendance arrive ICI
       configureBridgeRuntime · appairage auto
       void reconcileAll() · void reconcileTeam() · void startupBridgeHello()
       ordonnanceur
  reprises (destinations, ports, médias, runs)
  markReady() ; « API PRÊTE »
```

### Après

```text
ENV → Mongo
  └─ bootstrap()
       1. CŒUR        crypto · comptes · migrations · singletons · module e-mail
                      événements · seeds · CATALOGUE IntegratedAPI
                      purge Panel · état du site · CORS
       2. PANEL       persistance · onPairingChanged · hydratePairing()
                      configureProjectBridge · outbox · configureBridgeRuntime
                      appairage automatique
       3. INTEGRATED  ensureAllWebhooks(mode)  ◀── le Panel est là
          APIs        audit → état + preuve + reprise par fournisseur
       4. SERVICES    veille tunnel · déclencheurs · signe de vie (attendu)
                      photographie (attendue) · ordonnanceur · drainage
  REPRISES            destinations (bloquante) · ports · médias · runs
  INVARIANTS          garanties constatées explicitement
  assertBootstrapInvariants()   ◀── la condition de READY
  markReady() ; « API PRÊTE » (ou « MODE DÉGRADÉ : … »)
```

**Le graphe de dépendances est désormais celui du code, pas celui des lignes.**
`amorcerPanel()` précède `amorcerIntegratedApis()` dans la séquence, et
`bootstrap-startup-invariants.test.js` en prend la preuve **sur la source**.

---

## 3. MATRICE DE DÉMARRAGE DES INTEGRATED API

Les quatre fournisseurs réellement présents dans SB Auto
(`utils/integratedApiCatalog.js`). *Ubiflow, CarStudio AI, CarVertical et
AssuCarteGrise n'existent pas dans ce projet* — vérifié par recherche sur tout
`backend/src`.

| Provider | Autorité | Credentials requis | Appairage requis | Webhook géré | Appel distant | Bloquant | Reprise | État nominal (autonome) | État nominal (appairé) |
|---|---|---|---|---|---|---|---|---|---|
| **STRIPE** / `payment` | PANEL | aucun (`fields: []`) | **oui** | oui (via capacité `webhook.endpoint.ensure`) | oui, par le Panel | non | armée sur appairage + repli borné sur panne | `DEFERRED` (PANEL_NOT_PAIRED) | `READY` / `READY_RECONCILED` |
| **BREVO** / `transactional` | locale | `apiKey` | non | oui (API Brevo directe) | oui | non | repli borné ; armée si pas d'URL publique en dev | `NOT_REQUIRED` (CREDENTIALS_NOT_CONFIGURED) | `READY` / `READY_RECONCILED` |
| **YOUSIGN** | PANEL | aucun | non (au démarrage) | non — webhook reçu par le Panel (R10.5C) | non | non | — | `NOT_REQUIRED` (PANEL_AUTHORITY) | idem |
| **HOSTINGER** | PANEL | aucun | non (au démarrage) | non | non | non | — | `NOT_REQUIRED` (PANEL_AUTHORITY) | idem |

Le code qui produit cette matrice **ne cite aucun fournisseur** : il lit le
catalogue (`authority`, `fields.required`) et le registre de webhooks gérés.
Ajouter un cinquième fournisseur ne demande aucune ligne ici.

---

## 4. LE VOCABULAIRE D'ÉTAT

`services/lifecycle/bootstrapReport.service.js` :

| État | Sens | Compté comme |
|---|---|---|
| `DISABLED` | fournisseur coupé — rien n'est dû | not_required |
| `NOT_REQUIRED` | aucune action de démarrage requise | not_required |
| `DEFERRED` | rien n'est **faisable**, la dépendance est nommée, le geste est **armé** | not_required |
| `READY` | prérequis **constatés**, rien à corriger | ok |
| `RECONCILING` | réconciliation en cours (transitoire) | degraded |
| `READY_RECONCILED` | réconciliation distante réellement effectuée | ok |
| `DEGRADED_RETRYING` | action due non aboutie, reprise **programmée** | degraded |
| `FAILED_BLOCKING` | action due échouée, interdit de servir | failed (bloquant) |

`DEFERRED` est la clé du lot. Un projet autonome n'a personne à qui demander le
provisionnement Stripe : le compter *dégradé* ferait rougir chaque démarrage
normal (et un rapport toujours rouge cesse d'être lu) ; le compter
*not_required* serait le mensonge inverse. `DEFERRED` dit les deux : **rien
n'est cassé, et rien n'est perdu** — la preuve étant le travail armé que
`/readyz` énumère nommément.

---

## 5. LA REPRISE CENTRALISÉE

`services/lifecycle/startupReconciliation.service.js` remplace tout `setTimeout`
dispersé. Un travail porte : clé unique, provider/capacité, état, tentative,
prochaine échéance, dernier motif.

* **Clé unique** — deux inscriptions du même geste n'en font qu'un ; c'est ce
  qui interdit deux webhooks distants.
* **Idempotence** — le travail rejoue exactement le geste du démarrage
  (`ensureProviderWebhooks`), lui-même idempotent et sérialisé par mode.
* **Non-réentrance** — trois déclencheurs possibles (échéance, appairage,
  tunnel) ne produisent jamais deux exécutions simultanées.
* **Repli borné** — 15 s, 30 s, 60 s, 120 s, 300 s, puis **abandon explicite** ;
  l'état reste `EXHAUSTED` et visible, jamais effacé.
* **Travail armé (`gated`)** — aucune échéance, aucun épuisement : il attend un
  ÉVÉNEMENT. C'est le cas de `PANEL_NOT_PAIRED`, et de `URL_NOT_PUBLIC` en
  développement.
* **Arrêt** — le module s'inscrit lui-même au drainage : aucun minuteur ne
  survit à un redémarrage de développement.

### Les deux événements qui débloquent

| Événement | Source | Effet |
|---|---|---|
| Appairage établi ou restauré | `pairingStore.onPairingChanged` (nouveau) | `runPendingStartupJobs('panel-…')` |
| Tunnel de développement monté / changé | veille ngrok | `ensureAllWebhooks('TEST')` + `runPendingStartupJobs('ngrok-tunnel')` |

`onPairingChanged` vit dans `pairingStore.js` — le seul endroit qui sait de
première main que l'appairage a changé. Il **n'importe rien** : c'est l'abonné
qui apporte son travail, et `bridge-conformity` reste vert.

---

## 6. LA POLITIQUE `API PRÊTE`

`API PRÊTE` ne signifie plus « `listen()` a fonctionné ». La condition est
écrite une fois, dans `assertBootstrapInvariants()`, et appliquée par le seul
appelant autorisé (`server.js`), **avant** `markReady()`.

**Bloquant** (le service n'ouvre pas) :

* MongoDB inaccessible ;
* clé de chiffrement invalide **en PROD** (fail-closed, inchangé) ;
* reprise des destinations en échec — elle porte la garantie « une seule
  destination active par environnement ».

**Non bloquant** (le service ouvre, et le dit) :

* Panel injoignable, non appairé, ou pont non câblé ;
* réconciliation de webhook différée, en reprise, ou épuisée ;
* module e-mail non initialisé, purge héritée en échec, registre des ports ou
  médias non repris.

Quand un constat dégradé subsiste, la **dernière ligne du démarrage le porte** :

```text
[warn] API PRÊTE sur http://localhost:6070 (ENV=TEST) — MODE DÉGRADÉ : Module e-mail (EMAIL_MODULE_INIT_FAILED)
```

Un `[ ok ] API PRÊTE` posé au-dessus d'un résumé dégradé apprend à ne plus lire
le résumé.

---

## 7. PAS DE `[ ok ]` SANS PREUVE

`recordCheck()` **refuse** un succès sans champ `proof` : il le reclasse
`DEGRADED / PROOF_MISSING`. La règle est appliquée par le code, pas par la
discipline de celui qui l'écrit.

Ce qu'une preuve doit être, selon la brique :

| Brique | Preuve exigée |
|---|---|
| MongoDB | connexion établie, nom de base |
| Chiffrement | clé présente **et valide** (longueur, forme, distincte de `JWT_SECRET`) |
| Singletons | 7 documents uniques chargés |
| Appairage Panel | restauré depuis la base chiffrée, nom du Panel |
| Webhook | **endpoint distant relu** et trouvé conforme, ou créé/corrigé |
| Signe de vie | heartbeat **accepté** par le Panel |
| Ordonnanceur | cadences réellement appliquées, rendues par `startBridgeScheduler` |

« Stripe est prêt parce qu'une ligne existe en base » n'est pas un constat.

---

## 8. LE RÉSUMÉ CALCULÉ

Aucun compteur n'est tenu à la main : tous sont dérivés des constats déposés,
donc incapables de diverger de ce que le journal a montré.

```text
══ INVARIANTS ══════════════════════════════════════════════
[ ok ] Une seule destination active par environnement — index unique relu en base après reprise
[ ok ] Aucune opération de démarrage abandonnée sans reprise — 0 reprise(s) programmée(s) et 1 armée(s) : STRIPE/payment (TEST) [ARMED]
[ ok ] Bootstrap terminé :
       core=11/11
       panel=1/1 (+1 non requis)
       integratedApi=0 ready · 3 not_required · 1 deferred · 0 degraded · 0 failed
       webhooks=0 conforme(s) dont 0 corrigé(s) au démarrage
       services=4/4 (+1 non requis)
       reprises=4/4
       invariants=2/2
       blockingErrors=0
       pendingRetries=0
       deferred=1 (armé(s), en attente d’une dépendance)
```

Le **dénominateur compte ce qui était dû**, pas ce qui existe : `panel=1/2` se
lisait comme un manque alors que le second constat était « mode autonome, rien
n'est dû ». Un compteur qui n'est jamais plein cesse d'être lu.

---

## 9. `/readyz`

L'état complet est exposé, sans aucun secret :

```json
{
  "ready": true,
  "phase": "READY",
  "bootstrap": {
    "core": { "ok": 11, "notRequired": 0, "degraded": 0, "failed": 0, "total": 11 },
    "integratedApi": { "ready": 0, "reconciled": 0, "notRequired": 3, "deferred": 1, "degraded": 0, "failed": 0, "total": 4 },
    "blockingErrors": 0,
    "degraded": [],
    "pendingRetries": 0,
    "deferred": 1,
    "retries": [
      { "key": "webhook:STRIPE:payment:TEST", "state": "ARMED", "gated": true,
        "attempts": 0, "nextAttemptAt": null, "lastReason": "PANEL_NOT_PAIRED" }
    ]
  }
}
```

Un webhook réconcilié quarante secondes après le démarrage **cesse** d'y
apparaître : `updateIntegratedApi()` met le constat à jour, pour que
l'exploitant ne cherche pas une panne éteinte.

---

## 10. ARRÊT

Trois ressources ont une durée de vie, et les trois sont inscrites au drainage :

| Ressource | Inscription |
|---|---|
| Reprises de démarrage | `startupReconciliation` s'inscrit lui-même |
| Veille du tunnel | `onDrain` dans `demarrerServices()` (elle n'était qu'`unref()`) |
| Ordonnanceur du pont | `onDrain(() => drainBridgeScheduler())` |

`drainBridgeScheduler()` **arrête puis attend**, sous plafond de 5 s. Arrêter
les minuteurs ne suffisait pas : un cycle déjà parti — typiquement la poussée
immédiate qui suit un enregistrement — atteignait une base refermée et
journalisait `CYCLE_FAILED` au niveau ERREUR sur un arrêt parfaitement normal.
Un prédicat injecté (`acceptingWorkProvider`) ferme la fenêtre d'entrée, le
drainage ferme celle de sortie.

---

## 11. RECETTE

`npm run test:bootstrap` — `src/scripts/bootstrap-startup-invariants.test.js`.

Aucun appel réel, aucune action facturable : le Panel est un double complet en
mémoire qui tient un **registre d'endpoints**, de sorte que l'idempotence est
*constatée* et non supposée.

| Section | Ce qui est prouvé |
|---|---|
| 1 | Vocabulaire : chaque motif de réconciliation devient l'état exact |
| 2 | Reprises : clé unique, repli borné, abandon explicite, travail armé, non-réentrance |
| 3 | Rapport : succès sans preuve refusé, résumé calculé, blocage nommé |
| 4 | **Ordre**, prouvé sur la source ; plus aucun `void` d'amorçage |
| 5 | Projet autonome : `DEFERRED`, travail armé, **aucun appel distant** |
| 6 | **Le bug historique** : l'appairage arrive après, le geste part quand même |
| 7 | Idempotence : rejouer ne crée jamais un second endpoint |
| 8 | Double amorçage : aucun doublon de webhook, fournisseur ni écouteur |
| 9 | Panne distante : pas de faux OK, état dégradé qui se répare seul |
| 10 | Fournisseur désactivé : aucun appel distant |
| 10bis | Réconciliation sans réponse : « ne rien savoir » ne s'écrit pas `[ ok ]` |
| 11 | Aptitude : `/readyz` lisible, prérequis bloquant interdisant READY |
| 12 | Arrêt : aucune minuterie de reprise ne survit au drainage |

### Résultats

```text
npm run test:bootstrap   →  90 réussis, 0 échoués
npm test                 →  94 scripts · 5 701 constats · 0 échec · exit 0
```

### Deux recettes corrigées, et pourquoi

**`contract-projection-immediacy.test.js` était vert par COURSE GAGNÉE.**
La photographie d'amorçage partait en `void projectSync.reconcileAll()`. Sur une
base vide, elle met un tombstone « plus aucun contrat » en file — mais elle
n'avait, le plus souvent, pas fini quand la recette commençait. Le constat
« supprimer le dernier contrat fait apparaître un tombstone » passait donc parce
que la file était encore vide.

Rendre cette photographie déterministe (elle est désormais ATTENDUE, §2) rend le
tombstone d'amorçage systématique, et la déduplication de l'outbox — parfaitement
correcte : « tant qu'un tombstone attend d'être livré, un second n'apprend rien à
personne » — supprime le second. La recette mesurait un accident. Elle part
maintenant d'une file propre, et ses `settle(900)` fixes sont remplacés par une
attente de CONDITION bornée : plus rapide au repos, et sans faux échec sous
charge.

**`panel-push-liveness.test.js` était cassé avant ce lot.** Son double de client
n'avait pas suivi l'entrée de `introspectFederatedPrincipal` dans
`PANEL_CLIENT_METHODS` (L12.B) : `isPanelClient()` le refusait et le fichier
mourait à la construction du pont. Le défaut n'était pas visible parce que la
chaîne `npm test` s'arrêtait plus tôt.

**Deux gardes de source mises à jour** (`yousign-flow`, `payment-default-incident`)
— elles exigeaient DEUX inscriptions littérales de l'applicateur, une par
registre. Le bootstrap ne recopie plus la table : elle est déclarée une fois et
alimente les deux registres. Compter deux occurrences reviendrait à exiger le
retour de la duplication, c'est-à-dire le défaut que ces gardes attrapent. Elles
vérifient désormais la propriété : le type est déclaré une fois, et les deux
registres reçoivent LA MÊME table.

---

## 12. RISQUES RÉSIDUELS

1. **Les reprises de données (`REPRISES`) tournent après les services de fond.**
   L'ordonnanceur du pont bat donc avant que « une seule destination active par
   environnement » ne soit vérifiée. Comportement **inchangé** par ce lot ;
   déplacer ces migrations dans `bootstrap()` changerait le contrat des dizaines
   de recettes qui appellent `bootstrap()` seul.
2. **`URL_NOT_PUBLIC` est armé en développement, repris en PROD.** En dev, seule
   la veille du tunnel le débloque ; si le tunnel ne change jamais d'adresse
   après le démarrage, le travail reste armé. C'est exact — sans adresse
   publique, un webhook ne servirait à rien — mais cela suppose que la veille
   tourne.
3. **La disponibilité réelle des fournisseurs sous autorité Panel n'est pas
   sondée au démarrage.** Un aller-retour par fournisseur à chaque démarrage
   pour une information revérifiée au premier usage métier serait un coût sans
   contrepartie. `NOT_REQUIRED — PANEL_AUTHORITY` dit ce qu'on sait : rien n'est
   dû *localement*.
4. **`avecPlafond` borne mais n'annule pas.** Une réconciliation qui dépasse
   20 s continue en arrière-plan ; elle est idempotente, donc au pire elle
   double le travail de la reprise, jamais l'endpoint distant.
