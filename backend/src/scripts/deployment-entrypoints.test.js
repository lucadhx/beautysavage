/**
 * ══ UNE SEULE PORTE POUR DÉPLOYER — ET ELLE EST GARDÉE ══════════════════════
 *
 * ── LE DÉFAUT QUE CETTE RECETTE VERROUILLE ────────────────────────────────
 *
 * `POST /api/deployment/deploy` a survécu à tous les lots qui ont durci le
 * déploiement. Elle appelait `engine.deploy()` directement, donc SANS rien de
 * ce qui rend aujourd'hui une mise en ligne racontable :
 *
 *   · aucun `createRun` — le déploiement n'existait dans aucun journal durable ;
 *   · aucune barrière de publication — elle pouvait basculer la release sans
 *     avoir vérifié qu'elle savait encore l'écrire ;
 *   · aucun journal forensique ;
 *   · `markDeploying(targetId)` SANS `runId` : le verrou de destination
 *     s'inscrivait à `null`, c'est-à-dire qu'il ne verrouillait RIEN. Un
 *     `/deploy/stream` lancé dans la foulée passait le filtre conditionnel sans
 *     rien voir — deux pipelines sur la même destination.
 *
 * Elle n'avait plus aucun appelant. Une route morte qui contourne les garanties
 * n'est pas du code mort : c'est une porte dérobée que personne ne surveille.
 *
 * ── POURQUOI UNE GARDE, ET PAS SEULEMENT UNE SUPPRESSION ──────────────────
 *
 * Supprimer ferme le trou d'aujourd'hui. Ce qui l'a creusé — « j'ajoute vite
 * une route qui appelle le moteur » — reste possible demain, et se relit comme
 * un raccourci innocent. Cette recette échoue donc si une SECONDE route de
 * déploiement réapparaît, quel que soit son nom, ou si l'unique entrée cesse de
 * créer son run et de verrouiller avec un vrai `runId`.
 *
 * ── CE QU'ELLE N'AFFIRME PAS ──────────────────────────────────────────────
 *
 * Elle ne dit rien de `DeploymentEngine.deploy()`, qui reste une primitive du
 * moteur MIROIR, identique dans tous les dépôts et éprouvée par
 * `deployment-engine.test.js`. Ce qui est interdit, c'est de l'EXPOSER en HTTP.
 *
 * Runner autonome : lecture de sources, aucune base, aucun réseau.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(ICI, '..');
const PROJET = path.resolve(ICI, '../../..');

let pass = 0;
let fail = 0;
const check = (nom, cond) => {
  if (cond) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (t) => console.log(`\n${t}`);

const lire = (p) => fs.readFileSync(p, 'utf8');
/** Les commentaires ne sont pas du code : une route « citée » n'est pas montée. */
const sansCommentaires = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const routes = sansCommentaires(lire(path.join(SRC, 'routes/deployment.routes.js')));
const controleur = lire(path.join(SRC, 'controllers/deployment.controller.js'));
const controleurCode = sansCommentaires(controleur);
const httpTrace = sansCommentaires(lire(path.join(SRC, 'services/deployment/forensics/httpTrace.js')));

/* ════════════════════════════════════════════════════════════════════════════
   1. LA ROUTE HÉRITÉE NE REVIENT PAS
   ════════════════════════════════════════════════════════════════════════════ */
section('1. `POST /deploy` (réponse unique) est morte, et le reste');
{
  /** Toutes les routes montées : verbe + chemin + nom du handler. */
  const montees = [...routes.matchAll(/router\.(get|post|put|delete|patch)\(\s*'([^']+)'[\s\S]*?ctrl\.(\w+)/g)]
    .map((m) => ({ verbe: m[1].toUpperCase(), chemin: m[2], handler: m[3] }));

  check('des routes de déploiement sont bien montées (sinon la garde serait vide)',
    montees.length > 0);

  const heritee = montees.find((r) => r.chemin === '/deploy');
  check('aucune route `/deploy` n’est montée', heritee === undefined);
  if (heritee) console.error(`    → ressuscitée : ${heritee.verbe} ${heritee.chemin} → ctrl.${heritee.handler}`);

  check('…et le contrôleur n’exporte plus de handler `deploy`',
    !/export\s+(const|async\s+function|function)\s+deploy\s*[=(]/.test(controleurCode));

  check('la trace HTTP ne référence plus `/deploy` seul',
    !/^\s*'\/deploy',\s*$/m.test(httpTrace));
  check('…mais trace toujours `/deploy/stream`', /'\/deploy\/stream'/.test(httpTrace));
}

/* ════════════════════════════════════════════════════════════════════════════
   2. UN SEUL POINT D'ENTRÉE PUBLIC DE DÉPLOIEMENT
   ════════════════════════════════════════════════════════════════════════════ */
section('2. PUBLIC_DEPLOYMENT_ENTRYPOINTS === [POST /api/deployment/deploy/stream]');
{
  const montees = [...routes.matchAll(/router\.(get|post|put|delete|patch)\(\s*'([^']+)'[\s\S]*?ctrl\.(\w+)/g)]
    .map((m) => ({ verbe: m[1].toUpperCase(), chemin: m[2], handler: m[3] }));

  /**
   * LE CORPS D'UN HANDLER EXPORTÉ — jusqu'à la DÉCLARATION SUIVANTE, exportée
   * ou non.
   *
   * On lit ce que la route exécute RÉELLEMENT, plutôt que de se fier à son nom :
   * une route nommée `/simulate` qui déploierait pour de bon serait invisible à
   * une garde qui ne regarderait que les chemins.
   *
   * ── LE FAUX POSITIF QUE CETTE BORNE FERME ─────────────────────────────────
   *
   * S'arrêter au prochain `export` seulement rattachait au handler précédent
   * TOUTES les fonctions privées qui le suivent — dont `streamOperation`, qui
   * contient `deployWithReport`. `POST /preflight`, qui n'appelle pourtant que
   * `engine.preflight`, était alors compté comme un second point d'entrée de
   * déploiement. Une garde qui crie au loup est une garde qu'on désactive.
   */
  const corpsDe = (nom) => {
    const debut = controleurCode.search(
      new RegExp(`export\\s+(?:const|async\\s+function|function)\\s+${nom}\\s*[=(]`),
    );
    if (debut === -1) return '';
    const suite = controleurCode.slice(debut + 10);
    const finRel = suite.search(/\n(?:export\s+(?:const|async\s+function|function)|async\s+function|function)\s/);
    return finRel === -1 ? suite : suite.slice(0, finRel);
  };

  /**
   * QU'EST-CE QUI « DÉPLOIE POUR DE VRAI » ?
   *
   * Un PRÉFLIGHT emprunte le même orchestrateur, mais avec `preflightOnly:
   * true` : il s'arrête AVANT la frontière de publication et ne bascule aucune
   * release. Confondre les deux ferait compter deux entrées là où il n'y en a
   * qu'une — et rendrait la garde inutilisable, donc désactivée un jour.
   */
  const deploieVraiment = (nom) => {
    const corps = corpsDe(nom);
    if (/preflightOnly:\s*true/.test(corps)) return false;
    return /preflightOnly:\s*false/.test(corps)
      || /engine\.deploy\s*\(/.test(corps)
      || /deployWithReport\s*\(/.test(corps);
  };

  const entrees = montees.filter((r) => deploieVraiment(r.handler));
  const rendu = entrees.map((r) => `${r.verbe} /api/deployment${r.chemin}`);

  check(`exactement UN point d’entrée de déploiement (${rendu.length})`, rendu.length === 1);
  check('…et c’est `POST /api/deployment/deploy/stream`',
    rendu[0] === 'POST /api/deployment/deploy/stream');
  if (rendu.length !== 1) console.error(`    → trouvés : ${rendu.join(' | ') || '(aucun)'}`);

  /**
   * AUCUN AUTRE HANDLER EXPORTÉ NE TOUCHE LE MOTEUR DE DÉPLOIEMENT.
   *
   * Y compris ceux qui ne seraient pas encore montés : un handler exporté est
   * une route en attente de l'être.
   */
  const exportes = [...controleurCode.matchAll(/export\s+(?:const|async\s+function|function)\s+(\w+)/g)]
    .map((m) => m[1]);
  const fautifs = exportes.filter((nom) => {
    const corps = corpsDe(nom);
    return /engine\.deploy\s*\(/.test(corps) || /deployWithReport\s*\(/.test(corps);
  });
  check(`aucun handler exporté n’appelle le moteur en direct${fautifs.length ? ` — ${fautifs.join(', ')}` : ''}`,
    fautifs.length === 0);
}

/* ════════════════════════════════════════════════════════════════════════════
   3. L'UNIQUE ENTRÉE PASSE PAR LE PIPELINE DURABLE
   ════════════════════════════════════════════════════════════════════════════ */
section('3. L’unique entrée crée son run, verrouille avec un VRAI runId, et journalise');
{
  /**
   * L'orchestrateur est privé (`streamOperation`) : c'est LUI qui porte les
   * garanties, et les deux flux (déploiement, préflight) en dérivent. On
   * vérifie donc l'implémentation, pas la façade.
   */
  const debut = controleurCode.indexOf('async function streamOperation');
  check('l’orchestrateur unique existe', debut !== -1);
  const orchestrateur = debut === -1 ? '' : controleurCode.slice(debut);

  check('il ouvre un run durable AVANT toute mutation', /runs\.createRun\(/.test(orchestrateur));
  check('…et refuse de commencer si le run n’a pas pu être ouvert',
    /DEPLOYMENT_RUN_NOT_CREATED/.test(orchestrateur));

  /**
   * LE VERROU PORTE UN VRAI IDENTIFIANT.
   *
   * C'est le point exact où la route héritée trahissait : `markDeploying(targetId)`
   * sans second argument écrit `activeDeploymentRunId: null` — un verrou vide,
   * qu'un déploiement concurrent franchit sans le voir.
   */
  check('le verrou de destination est posé AVEC le runId',
    /markDeploying\(\s*targetId\s*,\s*runId\s*\)/.test(orchestrateur));
  check('…et aucun verrou n’est posé sans identifiant de run',
    !/markDeploying\(\s*targetId\s*\)/.test(controleurCode));
  check('…un refus de verrou est une RÉPONSE, pas un silence',
    /DEPLOYMENT_ALREADY_RUNNING/.test(orchestrateur));

  check('l’orchestrateur passe par le rapport instrumenté du moteur',
    /engine\.deployWithReport\(/.test(orchestrateur));
  check('…et jamais par `engine.deploy()`', !/engine\.deploy\s*\(/.test(orchestrateur));
}

/* ════════════════════════════════════════════════════════════════════════════
   4. AUCUN CLIENT NE SAIT PLUS APPELER LA ROUTE MORTE
   ════════════════════════════════════════════════════════════════════════════ */
section('4. Le SDK du Manager ne connaît plus qu’un déploiement');
{
  const sdkPath = path.join(PROJET, 'manager/src/lib/api.ts');
  const types = path.join(PROJET, 'manager/src/types/index.ts');

  if (!fs.existsSync(sdkPath)) {
    check('SDK Manager absent de ce dépôt — rien à garder ici', true);
  } else {
    const sdk = sansCommentaires(lire(sdkPath));
    check('le SDK n’expose plus `/deployment/deploy` (réponse unique)',
      !/'\/deployment\/deploy'/.test(sdk));
    check('…mais expose toujours le flux', /'\/deployment\/deploy\/stream'/.test(sdk));
    check('le type de l’ancienne réponse ne subsiste pas',
      !/DeployResult/.test(sdk) && !/export interface DeployResult/.test(lire(types)));
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   5. LA DOCUMENTATION NE PROPOSE PLUS LA PORTE FERMÉE
   ════════════════════════════════════════════════════════════════════════════ */
section('5. La documentation ne présente plus la route héritée comme utilisable');
{
  const doc = path.join(PROJET, 'docs/DEPLOYMENT_ENGINE.md');
  if (!fs.existsSync(doc)) {
    check('documentation absente — rien à garder ici', true);
  } else {
    const texte = lire(doc);
    const ligneTableau = texte.split(/\r?\n/).find(
      (l) => /^\|/.test(l) && /`\/api\/deployment\/deploy`/.test(l),
    );
    check('aucune ligne de tableau n’annonce encore `/api/deployment/deploy`',
      ligneTableau === undefined);
    check('…et le flux reste documenté',
      /`\/api\/deployment\/deploy\/stream`/.test(texte));
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   6. LE PORT EST ARRÊTÉ AVANT NGINX — SUR LES DEUX PILOTES
   ════════════════════════════════════════════════════════════════════════════ */
/**
 * ══ L'INCIDENT QUE CETTE SECTION VERROUILLE ═════════════════════════════════
 *
 * `demo-fjservices06.ly-solution.com` a servi le site d'un AUTRE client. Son
 * Nginx proxifiait `/api/` vers `127.0.0.1:5102`, port détenu par le backend de
 * `kleenpro` : la bonne vitrine allait chercher entreprise, thème et catalogue
 * dans la base d'un tiers. Fuite inter-locataires, en HTTPS, sur le bon domaine.
 *
 * `PortReservation` vit dans la base DU PROJET : le registre d'un projet neuf
 * est vide et ignore ses voisins sur le serveur partagé. `ensureUsablePort`
 * existe pour cela — elle interroge la MACHINE et réattribue le port avant
 * qu'il n'entre dans une configuration.
 *
 * Le défaut n'était pas son absence : c'était qu'elle n'était câblée que sur UN
 * pilote. `deploy-drive.js` l'appelait ; l'écran du Manager — par lequel
 * passent tous les déploiements réels — ne connaissait que `verifyBeforeStart`,
 * à l'étape `services.start`, c'est-à-dire APRÈS `nginx.configure`, APRÈS
 * `https.configure` et APRÈS la bascule des artefacts. Le moteur refusait de
 * démarrer — à raison — mais trop tard : le site était déjà en ligne, câblé sur
 * le backend du voisin.
 *
 * Une protection qui ne vit que sur une porte n'est pas une protection. Cette
 * section échoue donc si l'une des deux portes la perd, ou si elle glisse APRÈS
 * l'entrée dans le moteur.
 */
section('6. Les DEUX pilotes arrêtent le port avant de laisser le moteur écrire');
{
  const debut = controleurCode.indexOf('async function streamOperation');
  const orchestrateur = debut === -1 ? '' : controleurCode.slice(debut);

  const iPort = orchestrateur.indexOf('ports.ensureUsablePort(');
  const iMoteur = orchestrateur.indexOf('engine.deployWithReport(');

  check('l’écran du Manager oppose le registre des ports à la machine',
    iPort !== -1);
  check('…AVANT d’entrer dans le moteur (donc avant `nginx.configure`)',
    iPort !== -1 && iMoteur !== -1 && iPort < iMoteur);

  /**
   * UN PORT DÉPLACÉ DOIT L'ÊTRE DES DEUX CÔTÉS.
   *
   * Nginx lit `backendPort` de la destination, le backend lit `PORT` dans son
   * `.env` distant. N'en déplacer qu'un produirait un proxy qui pointe là où
   * personne n'écoute : un 502 propre, et une panne dont la cause est invisible
   * dans les deux configurations prises séparément.
   */
  check('un déplacement met à jour le port de la destination',
    /target\.backendPort\s*=\s*verdict\.port/.test(orchestrateur));
  check('…et le `PORT` du .env distant',
    /resolvedRemoteEnv\.PORT\s*=\s*String\(verdict\.port\)/.test(orchestrateur));

  /**
   * LE FILET N'EST PAS RETIRÉ. `ensureUsablePort` corrige ce qu'elle peut voir
   * au moment où elle regarde ; entre ce moment et le démarrage, un service
   * peut renaître. `verifyBeforeStart` reste donc bloquante avant le `pm2 start`.
   */
  check('la vérification d’avant démarrage reste en place',
    /ports\.verifyBeforeStart\(/.test(orchestrateur));

  /** L'AUTRE PORTE — la console — garde la même protection, dans le même ordre. */
  const drivePath = path.join(SRC, 'scripts/deploy-drive.js');
  if (!fs.existsSync(drivePath)) {
    check('pilote console absent de ce dépôt — rien à garder ici', true);
  } else {
    const drive = sansCommentaires(lire(drivePath));
    const dPort = drive.indexOf('ensureUsablePort(');
    const dMoteur = drive.indexOf('engine.deployWithReport(');
    check('le pilote console oppose lui aussi le registre à la machine', dPort !== -1);
    check('…et lui aussi AVANT d’entrer dans le moteur',
      dPort !== -1 && dMoteur !== -1 && dPort < dMoteur);
  }

  /** L'événement du journal existe : sans lui, l'entrée serait silencieusement jetée. */
  const journalSrc = lire(path.join(SRC, 'services/deployment/forensics/runJournal.service.js'));
  check('`PORT_REASSIGNED` appartient au vocabulaire du journal',
    /PORT_REASSIGNED:\s*'PORT_REASSIGNED'/.test(journalSrc));
}

/* ════════════════════════════════════════════════════════════════════════════
   7. UN RÉSULTAT PASSÉ NE MASQUE PAS UNE ACTION EN COURS
   ════════════════════════════════════════════════════════════════════════════ */
/**
 * ══ L'INCIDENT QUE CETTE SECTION VERROUILLE ═════════════════════════════════
 *
 * Après un déploiement réussi, cliquer sur « Déployer » réaffichait AUSSITÔT
 * l'écran de réussite à 100 % du run PRÉCÉDENT. Le nouveau déploiement partait
 * bien en arrière-plan — l'opérateur, lui, lisait le résultat de l'ancien.
 *
 * Deux causes, et il fallait les deux :
 *   · l'acquittement était un BOOLÉEN (« l'écran a été refermé »), remis à zéro
 *     à chaque montage et incapable de dire QUEL run avait été lu ;
 *   · `latest` est le dernier run du PROJET, toutes destinations confondues —
 *     le backend ne filtre que si on lui passe `targetId`, et l'écran ne le lui
 *     passait pas.
 */
section('7. L’écran de déploiement n’oppose pas un run terminé à une action explicite');
{
  const pagePath = path.join(PROJET, 'manager/src/pages/dev/DeploymentPage.tsx');
  if (!fs.existsSync(pagePath)) {
    check('écran Manager absent de ce dépôt — rien à garder ici', true);
  } else {
    const page = sansCommentaires(lire(pagePath));

    check('l’acquittement retient un IDENTIFIANT de run, jamais un booléen',
      /acquitterRun\(/.test(page) && !/repriseAcquittee/.test(page));
    check('…et la reprise compare cet identifiant',
      /candidatReprise\.id\s*!==\s*runAcquitte/.test(page));
    check('lancer un déploiement acquitte le résultat précédent',
      /if\s*\(resultatRecent\)\s*acquitterRun\(resultatRecent\.id\)/.test(page));
    check('un résultat récent est rattaché à SA destination',
      /dernierRun\.targetId\s*!==\s*deployTargetId/.test(page));

    /**
     * UN RUN ACTIF DOIT CONTINUER DE PRENDRE L'ÉCRAN (§24) : c'est lui qui
     * empêche d'en lancer un second par-dessus. On vérifie qu'il reste
     * prioritaire, et qu'il n'est jamais acquitté au lancement.
     */
    check('un run ACTIF reste prioritaire sur un résultat récent',
      /runActif\s*\?\?\s*resultatRecent/.test(page));
  }
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
