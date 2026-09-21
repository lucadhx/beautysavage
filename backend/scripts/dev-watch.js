#!/usr/bin/env node
/**
 * ══ LE LANCEUR DE DÉVELOPPEMENT — ET L'AUTORITÉ DU REDÉMARRAGE (V3) ════════
 *
 * ── CE QU'IL RÉSOLVAIT DÉJÀ (V2) ───────────────────────────────────────────
 *
 * « Restarting 'src/server.js' » est imprimé par le process PARENT. Le serveur,
 * qui est son ENFANT, ne le voit jamais : quand ce message s'affiche, il est
 * déjà mort. Sans ce lanceur, un diagnostic ne peut qu'INFÉRER un redémarrage,
 * sans le distinguer d'un plantage ou d'un `kill`.
 *
 * ── CE QU'IL DEVIENT (V3) ──────────────────────────────────────────────────
 *
 * Le V2 a capté le redémarrage — et l'enfant n'a vu aucun fichier :
 *
 *     oldChild=38092 newChild=33532 ppid inchangé  →  vrai redémarrage
 *     filesChanged=0 filesTouched=0                →  aucune attribution
 *
 * L'attribution déménage donc ici, pour trois raisons qu'aucun réglage de
 * l'enfant ne peut compenser :
 *
 *   1. LE TEMPS. Les veilleurs de l'enfant naissent au clic, quelques
 *      millisecondes avant l'écriture cherchée. Ceux du parent observent depuis
 *      `npm run dev`.
 *   2. LA SURVIE. L'enfant meurt à l'instant où l'information devient
 *      disponible. Le parent, lui, peut photographier APRÈS.
 *   3. L'AUTORITÉ. Mesuré : avec un canal `ipc` sur le `stdio` du surveillant —
 *      la ligne de commande reste identique — le parent reçoit les
 *      notifications internes `watch:require` / `watch:import`. L'ensemble
 *      surveillé n'est plus reconstruit par heuristique : Node le dicte.
 *
 * L'enfant garde ce qu'il sait faire seul : la chronologie métier (HTTP, SSH,
 * DNS, run). Les deux rôles ne se mélangent pas.
 *
 * ══ POURQUOI IL NE CHANGE PAS LE COMPORTEMENT OBSERVÉ ══════════════════════
 *
 * C'est la condition de validité de toute la mesure, donc elle est tenue point
 * par point :
 *
 *   · MÊME COMMANDE. `node --watch src/server.js`, sans un drapeau de plus. Un
 *     `--import` ou un `--watch-path` changerait le graphe surveillé,
 *     c'est-à-dire l'objet même de la mesure.
 *   · LE CANAL IPC N'AJOUTE RIEN AU PROCESSUS OBSERVÉ. Mesuré : le serveur
 *     dispose DÉJÀ de `process.send` sans nous — le mode `--watch` lui en donne
 *     un pour ses propres annonces. Seule notre extrémité du tuyau change.
 *   · MÊME SORTIE, relayée telle quelle, sans préfixe ni tampon.
 *   · AUCUNE ÉCRITURE DANS LE GRAPHE. Les journaux vont sous `backend/logs/`,
 *     dont la mesure établit qu'il ne déclenche aucun redémarrage.
 *   · SIGNAUX RELAYÉS, code de sortie transparent.
 *
 * ── DÉVELOPPEMENT UNIQUEMENT ───────────────────────────────────────────────
 *
 * Rien de tout ceci n'a de sens en production, où le serveur tourne sous PM2
 * sans `--watch`. Le script refuse de s'exécuter avec `ENV=PROD`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { WatchAuthority, BACKEND, SRC, chemineRelatif } from './forensics/watchAuthority.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const DOSSIER = path.join(BACKEND, 'logs', 'deployment-forensics');
const JOURNAL = path.join(DOSSIER, 'watch-parent.jsonl');

if (String(process.env.ENV ?? '').toUpperCase() === 'PROD') {
  console.error('[dev-watch] ENV=PROD : ce lanceur est réservé au développement.');
  process.exit(1);
}

try { fs.mkdirSync(DOSSIER, { recursive: true }); } catch { /* le relais prime sur le journal */ }

/**
 * LE JOURNAL EST BORNÉ, ET C'EST UNE PRÉCAUTION D'HYGIÈNE.
 *
 * Une session de développement qui dure des jours produirait un fichier que
 * plus personne ne relit. On repart d'une page blanche à chaque lancement : la
 * seule question à laquelle ce journal répond — « ce process-ci a-t-il été
 * redémarré, quand, et à cause de quoi ? » — ne porte que sur la session
 * courante.
 */

/**
 * ══ LA PORTÉE DE SURVEILLANCE — `--watch-path=./src` ═══════════════════════
 *
 * ── LE DÉFAUT PRODUIT QUE CECI FERME ───────────────────────────────────────
 *
 * `node --watch` surveille, par contrat, l'entrypoint ET tout module
 * importé/requis. Le backend en charge ~1400, dont ~900 dans `node_modules`.
 * Le serveur de développement dépendait donc de notifications émises par des
 * dépendances tierces qui ne sont pas notre code.
 *
 * Trois incidents mesurés, tous de la même forme — un événement `fs.watch`
 * sans le moindre changement de contenu, mtime, ctime, taille ni inode :
 *
 *     ssh2/lib/index.js              → restart
 *     iconv-lite/encodings/index.js  → restart (hash identique sur 6 relevés)
 *
 * Le dernier est survenu APRÈS le retrait du balayage forensique : ce n'était
 * donc pas le traceur. C'était la PORTÉE du surveillant.
 *
 * ── LA MESURE QUI FONDE CE CHOIX (Node v22.19.0, win32) ────────────────────
 *
 *                                   --watch     --watch-path=./src
 *     src chargé                    RESTART     RESTART
 *     src/server.js (entrypoint)    RESTART     RESTART
 *     NOUVEAU fichier sous src      —           RESTART   ← gagné au passage
 *     node_modules/iconv-lite       RESTART     —
 *     node_modules/ssh2             RESTART     —
 *     logs/ · uploads/ · lockfile   —           —
 *
 * `--watch-path` implique le mode surveillance : `--watch` devient inutile, et
 * l'omettre rend l'intention lisible dans la commande elle-même.
 *
 * ── CONSÉQUENCE ASSUMÉE ────────────────────────────────────────────────────
 *
 * Un `npm install` qui modifie une dépendance ne relance PLUS le backend. C'est
 * voulu : relancer le serveur parce qu'un tiers a réécrit un fichier n'a jamais
 * rendu service. Après un vrai changement de dépendances, on relance
 * `npm run dev` à la main. On ne réintroduit PAS de surveillance de
 * `node_modules`.
 */
/**
 * ══ LA PORTÉE EXCLUT `src/scripts/` — et ce n'est pas un contournement ═════
 *
 * ── L'INCIDENT QUI L'A RÉVÉLÉ ─────────────────────────────────────────────
 *
 * Pendant un déploiement réel, deux écritures ont relancé l'API :
 *
 *     backend/src/routes/index.js                   ← code runtime, LÉGITIME
 *     backend/src/scripts/engine-governance.test.js ← une RECETTE
 *
 * La seconde n'aurait jamais dû relancer quoi que ce soit. `src/scripts/`
 * contient 127 recettes et 31 utilitaires en ligne de commande, et le serveur
 * n'en importe AUCUN : ils ne font pas partie du graphe de modules de l'API.
 *
 * ── POURQUOI `--watch-path=./src` LES SURVEILLAIT QUAND MÊME ──────────────
 *
 * `node --watch` suit le GRAPHE (un test n'y est jamais). `--watch-path` suit
 * un CHEMIN — donc tout `./src`, graphe ou pas. En réparant la portée trop
 * large de `node_modules`, le lot précédent l'avait élargie côté recettes :
 * éditer un test redémarrait l'API métier.
 *
 * ── CE QUE CE N'EST PAS ───────────────────────────────────────────────────
 *
 * Ce n'est pas masquer un écrivain fautif. L'écrivain a été identifié — une
 * session de développement éditant des sources, comportement NORMAL d'un
 * environnement de développement. Ce qui n'est pas normal, c'est qu'éditer une
 * recette tue le process qui exécute un déploiement.
 *
 * Node n'offre aucune exclusion : on énumère donc les dossiers du runtime. Un
 * nouveau dossier sous `src/` devra être ajouté ici — la recette de portée le
 * rappellera, ce qui vaut mieux qu'une surveillance trop large et muette.
 */
/**
 * On EXCLUT, on n'énumère pas.
 *
 * Une liste blanche de dossiers paraissait plus explicite — elle était surtout
 * plus fragile : elle oubliait les fichiers posés directement sous `src/`, et
 * un nouveau dossier runtime aurait cessé d'être surveillé SANS RIEN DIRE.
 * Une portée trop étroite et muette est le pire des deux mondes : on croit
 * développer à chaud, et le serveur ne se recharge plus.
 *
 * L'exclusion, elle, ne connaît qu'un cas particulier — et c'est exactement ce
 * qu'on veut décrire.
 */
const EXCLUS_DU_RUNTIME = Object.freeze(['scripts']);
const PORTEE = './src';
/**
 * Node documente `--watch-path` comme supporté sur macOS et Windows seulement.
 * Ailleurs, il refuse de démarrer — et un serveur de développement qui ne
 * démarre pas est pire que le défaut qu'on corrige. On retombe donc
 * explicitement sur `--watch`, en le DISANT : un repli silencieux ferait croire
 * à une portée restreinte là où elle ne l'est pas.
 */
const PORTEE_SUPPORTEE = process.platform === 'win32' || process.platform === 'darwin';
/*
 * Plusieurs `--watch-path` sont acceptés : on surveille l'entrypoint et chaque
 * dossier du runtime, jamais `src/scripts/`.
 */
/*
 * ON NE SURVEILLE QUE CE QUI EXISTE.
 *
 * Node REFUSE de démarrer si un `--watch-path` pointe vers un chemin absent —
 * et un serveur de développement qui ne démarre pas est pire que le défaut
 * qu'on corrige. Un bac à sable, ou un projet dupliqué qui n'a pas encore tous
 * les dossiers, doit démarrer normalement.
 */
const CHEMINS_SURVEILLES = (() => {
  try {
    return fs.readdirSync(path.join(BACKEND, 'src'))
      .filter((e) => !EXCLUS_DU_RUNTIME.includes(e))
      .map((e) => `./src/${e}`);
  } catch {
    /* Pas de `src` lisible : on retombe sur la portée large plutôt que sur rien. */
    return [PORTEE];
  }
})();
const ARGUMENTS = PORTEE_SUPPORTEE
  ? [...CHEMINS_SURVEILLES.map((c) => `--watch-path=${c}`), 'src/server.js']
  : ['--watch', 'src/server.js'];

if (!PORTEE_SUPPORTEE) {
  console.warn(
    `[dev-watch] --watch-path n'est pas supporté sur ${process.platform} : repli sur --watch. `
    + 'Une écriture dans node_modules pourra relancer le serveur.',
  );
}

try { fs.writeFileSync(JOURNAL, ''); } catch { /* idem */ }

const autorite = new WatchAuthority({ journal: JOURNAL, dossier: DOSSIER });

autorite.noter('LAUNCHER_START', {
  commande: `node ${ARGUMENTS.join(' ')}`,
  porteeSurveillee: PORTEE_SUPPORTEE ? CHEMINS_SURVEILLES.join(' ') : '(tout le graphe — --watch-path indisponible)',
  node: process.version,
  plateforme: process.platform,
});

/**
 * L'AUTORITÉ DOIT SAVOIR CE QUE NODE SURVEILLE VRAIMENT (§9).
 *
 * Sans cette ligne, le rapport continuerait d'annoncer « 1400 fichiers
 * surveillés » — dont 900 que Node ne regarde plus. Une instrumentation qui
 * croit observer ce qui n'est plus observé produit des rapports faux avec
 * l'aplomb des rapports vrais.
 */
autorite.definirPortee(PORTEE_SUPPORTEE ? [SRC] : null);

/**
 * QUELS OUTILS WINDOWS PEUVENT NOMMER UN ÉCRIVAIN ? (§4)
 *
 * Détecté au lancement, jamais demandé à l'exploitant. Le résultat est
 * journalisé : un rapport qui conclut « écrivain inconnu » doit dire POURQUOI
 * il l'est resté.
 */
autorite.detecterOutils();

/* ── L'INSTANTANÉ DE DÉPART, AVANT MÊME LE PREMIER ENFANT ───────────────── */
const photographies = autorite.instantaneInitial();
autorite.noter('BASELINE_SNAPSHOT', { fichiers: photographies, racine: chemineRelatif(SRC) });

/**
 * LES RACINES DE SURVEILLANCE DU PARENT — ALIGNÉES SUR CELLE DE NODE.
 *
 * Elles incluaient `backend/node_modules`, parce que la mesure avait établi
 * qu'un module chargé y relançait le service. Ce n'est plus vrai : sous
 * `--watch-path=./src`, Node n'y réagit plus.
 *
 * Continuer à l'observer produirait des `FS_EVENTS` sur des fichiers incapables
 * de causer le redémarrage qu'on analyse — c'est-à-dire précisément les faux
 * positifs `ssh2` et `iconv-lite` que ce lot supprime, réinjectés par le
 * diagnostic lui-même.
 */
const RACINES = (PORTEE_SUPPORTEE ? [SRC] : [SRC, path.join(BACKEND, 'node_modules')])
  .filter((r) => {
    try { return fs.statSync(r).isDirectory(); } catch { return false; }
  });
const poses = autorite.demarrerVeilleursFs(RACINES);
const helpers = autorite.demarrerHelpers(RACINES);
autorite.noter('SOURCES_READY', {
  fsWatchRoots: poses,
  racines: RACINES.map(chemineRelatif),
  helperFsEvents: helpers.fsOk,
  helperProcessTrace: helpers.procOk,
});

/**
 * CE QUE LE SURVEILLANT DIT, ET CE QUE ÇA SIGNIFIE.
 *
 * Trois messages mesurés, trois causes distinctes. On les nomme séparément —
 * les réunir sous « quelque chose s'est passé » recréerait l'ambiguïté que ce
 * lanceur existe pour lever.
 */
const MOTIFS = [
  [/Restarting\s+'(.+?)'/i, 'RESTARTING'],       // un fichier du graphe a changé
  [/Failed running\s+'(.+?)'/i, 'FAILED'],       // l'enfant est mort anormalement
  [/Completed running\s+'(.+?)'/i, 'COMPLETED'], // l'enfant s'est terminé seul
];

let tampon = '';
function analyser(morceau) {
  tampon += morceau;
  const lignes = tampon.split(/\r?\n/);
  tampon = lignes.pop() ?? '';
  for (const ligne of lignes) {
    for (const [motif, event] of MOTIFS) {
      const m = ligne.match(motif);
      if (!m) continue;
      autorite.noter(event, { cible: m[1] });
      if (event === 'RESTARTING') {
        /**
         * ON N'ATTEND PAS L'ATTRIBUTION POUR RELAYER LA SORTIE.
         *
         * Elle prend jusqu'à 500 ms (trois instantanés différés). Bloquer ici
         * retarderait l'affichage du terminal de l'exploitant — et changerait
         * la temporalité de ce qu'on observe.
         */
        void autorite.attribuerRedemarrage({ cible: m[1] });
        autorite.childGeneration += 1;
      }
      break;
    }
  }
}

/**
 * `stdio: 'pipe'` est indispensable — c'est tout l'objet du lanceur — et le
 * quatrième canal, `ipc`, est ce qui donne au parent l'ensemble surveillé par
 * Node lui-même. Il a un effet de bord connu sur les couleurs (la sortie n'est
 * plus un terminal), qu'on annule explicitement.
 */
const enfant = spawn(process.execPath, ARGUMENTS, {
  cwd: BACKEND,
  env: { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR ?? '1' },
  stdio: ['inherit', 'pipe', 'pipe', 'ipc'],
});

autorite.currentChildPid = enfant.pid;
autorite.noter('CHILD_SPAWNED', { watcherPid: enfant.pid, generation: autorite.childGeneration });

/**
 * LE CANAL IPC PORTE DEUX CONVERSATIONS, ET ON LES DISTINGUE.
 *
 *   `watch:require` / `watch:import`   NODE annonce ce qu'il surveille.
 *   `forensics:*`                      NOTRE enfant annonce son contexte métier.
 *
 * Les messages de Node ne nous sont pas destinés — nous les LISONS au passage,
 * sans jamais y répondre ni les modifier. C'est une écoute, pas une
 * interposition : le mode `--watch` continue de fonctionner exactement comme
 * s'il était seul.
 */
enfant.on('message', (message) => {
  try {
    for (const cle of ['watch:require', 'watch:import']) {
      if (Array.isArray(message?.[cle])) autorite.annoncerCharge(message[cle]);
    }
    const f = message?.forensics;
    if (f?.type === 'SESSION_ARMED') autorite.sessionMetierArmee(f);
    else if (f?.type === 'SESSION_DISARMED') autorite.sessionMetierDesarmee(f);
    else if (f?.type === 'LOADED_GRAPH_SNAPSHOT' && Array.isArray(f.files)) {
      /**
       * LE GRAPHE PUBLIÉ PAR L'ENFANT COMPLÈTE CELUI DE NODE.
       *
       * Il apporte ce que notre canal ne peut pas voir : les modules chargés
       * avant que l'écoute ne soit établie. On UNIONNE — on ne remplace pas :
       * chaque source couvre l'angle mort de l'autre.
       */
      const n = autorite.annoncerCharge(f.files, 'child-graph');
      autorite.noter('CHILD_GRAPH_PUBLISHED', {
        recus: f.files.length, nouveaux: n, total: autorite.unionSurveillee.size, pid: f.pid ?? null,
      });
    }
  } catch { /* un observateur ne casse jamais le canal qu'il écoute */ }
});

for (const [flux, sortie] of [[enfant.stdout, process.stdout], [enfant.stderr, process.stderr]]) {
  flux.on('data', (bloc) => {
    sortie.write(bloc);          // relais intégral, d'abord — le diagnostic passe après
    try { analyser(bloc.toString('utf8')); } catch { /* jamais bloquant */ }
  });
}

/**
 * LES SIGNAUX APPARTIENNENT À L'ENFANT.
 *
 * Sans ce relais, Ctrl-C arrêterait le lanceur et laisserait le surveillant —
 * et donc le serveur — vivant en arrière-plan, port occupé. On transmet, et
 * l'on ne décide rien à sa place. Les helpers, eux, meurent avec nous.
 */
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    autorite.noter('LAUNCHER_SIGNAL', { signal });
    autorite.arreterHelpers();
    try { enfant.kill(signal); } catch { /* déjà parti */ }
  });
}

enfant.on('exit', (code, signal) => {
  autorite.noter('WATCHER_EXIT', { code, signal });
  autorite.arreterHelpers();
  // Transparent : le lanceur meurt exactement comme ce qu'il a lancé.
  process.exit(code ?? 0);
});

enfant.on('error', (err) => {
  autorite.noter('LAUNCHER_ERROR', { message: err?.message });
  autorite.arreterHelpers();
  console.error(`[dev-watch] impossible de lancer le surveillant : ${err?.message}`);
  process.exit(1);
});
