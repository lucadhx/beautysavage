/**
 * LES PHASES DE DUPLICATION — protocole, machine d'état, ordre observé.
 *
 * ══ CE QUE CETTE SUITE GARDE ════════════════════════════════════════════════
 *
 * `engine-governance` prouve, par lecture du code, qu'il n'existe plus qu'UNE
 * définition de phase et que tout en dérive. C'est une garde STATIQUE : elle ne
 * peut rien dire de ce qui se passe réellement pendant une duplication.
 *
 * Cette suite-ci éprouve le RUNTIME, et quatre propriétés qu'aucune relecture
 * ne pourrait établir :
 *
 *   · une phase hors registre fait ÉCHOUER l'émission, sur-le-champ — pas une
 *     ligne qui n'arrive jamais, trois écrans plus loin ;
 *   · une transition impossible est refusée. `pending → ok` en particulier : une
 *     étape déclarée réussie sans avoir commencé est exactement le mensonge que
 *     ce lot existe pour rendre impossible ;
 *   · `skipped` n'est pas `ok`. Une phase qui n'avait rien à faire n'a rien
 *     réussi, et l'écrire autrement promettrait une garantie qu'on n'a pas ;
 *   · l'ordre OBSERVÉ pendant une vraie duplication correspond à l'ordre
 *     canonique. Pas deux instantanés écrits à la main que l'on compare l'un à
 *     l'autre : l'observé est comparé AU REGISTRE.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { createPhaseTracker, PhaseProtocolError } from '../duplication-engine/phaseTracker.js';
import {
  DUPLICATION_PHASES,
  PHASE_STATUS,
  phaseDefinition,
} from '../duplication-engine/config/duplication.phases.js';
import { duplicateProject } from '../duplication-engine/duplication.js';

let pass = 0;
let fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const section = (n) => console.log(`\n${n}`);

const leve = (fn) => { try { fn(); return null; } catch (e) { return e; } };

const ADMIN = Object.freeze({
  adminEmail: 'contact@phases.test',
  adminPassword: 'Phases-Admin-2026',
  adminPasswordConfirmation: 'Phases-Admin-2026',
});

const mongod = await MongoMemoryServer.create();
const uri = mongod.getUri();
let tmpRoot;

/** Une arborescence de projet minimale mais RÉELLE : trois sous-projets Node. */
async function fixture() {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phases-dup-'));
  const src = path.join(tmpRoot, 'source');
  for (const dossier of ['backend', 'manager', 'vitrine']) {
    await fs.mkdir(path.join(src, dossier), { recursive: true });
  }
  await fs.writeFile(path.join(src, 'package.json'), JSON.stringify({ name: 'racine', private: true }));
  await fs.writeFile(path.join(src, 'backend', 'package.json'), JSON.stringify({
    name: 'backend', private: true, scripts: { dev: 'node src/server.js' }, dependencies: { express: '^4.0.0' },
  }));
  await fs.writeFile(path.join(src, 'backend', 'package-lock.json'), '{"lockfileVersion":3}');
  await fs.writeFile(path.join(src, 'backend', '.env.example'), 'ENV=TEST\nDB_TEST=x\nDB_PROD=y\n');
  /* Le profil de projet : sans lui, la copie garderait l identite technique
     de sa source — la duplication REFUSE, et ce test le suppose present. */
  await fs.mkdir(path.join(src, 'backend', 'src', 'deployment-engine', 'config'), { recursive: true });
  await fs.writeFile(
    path.join(src, 'backend', 'src', 'deployment-engine', 'config', 'project.profile.js'),
    "export const PROJECT_SLUG = 'src';\nexport const PROJECT_ID = 'srcid';\n",
  );
  for (const front of ['manager', 'vitrine']) {
    await fs.writeFile(path.join(src, front, 'package.json'), JSON.stringify({
      name: front, private: true, scripts: { dev: 'vite' }, devDependencies: { vite: '^5.0.0' },
    }));
    await fs.writeFile(path.join(src, front, 'package-lock.json'), '{"lockfileVersion":3}');
  }
  return src;
}

function execMock({ echoue = null } = {}) {
  return async (command, args, { cwd } = {}) => {
    const rel = cwd ? path.basename(cwd) : '';
    if ((args?.[0] === 'ci' || args?.[0] === 'install')) {
      if (rel === echoue) return { code: 1, stdout: '', stderr: 'boom' };
      await fs.mkdir(path.join(cwd, 'node_modules', '.bin'), { recursive: true });
      if (rel === 'manager' || rel === 'vitrine') {
        await fs.writeFile(path.join(cwd, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite'), 'x');
        await fs.mkdir(path.join(cwd, 'node_modules', 'vite'), { recursive: true });
        await fs.writeFile(path.join(cwd, 'node_modules', 'vite', 'package.json'), '{"name":"vite","version":"5.0.0"}');
      }
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
}

try {
  /* ══════════════════════════════════════════════════════════════════════════
     1. LE PROTOCOLE — une phase inconnue ne peut pas être émise.
     ══════════════════════════════════════════════════════════════════════════ */
  section('1 · Le registre est la seule porte d’entrée');
  {
    const vus = [];
    const t = createPhaseTracker((e) => vus.push(e));

    const inconnue = leve(() => t.phase('foo', 'running'));
    check('une phase HORS REGISTRE fait échouer l’émission', inconnue !== null);
    check('…et le message nomme le fichier où la déclarer',
      /duplication\.phases\.js/.test(inconnue.message));
    check('…aucun événement n’a été émis', vus.length === 0);

    check('un statut hors vocabulaire est refusé', leve(() => t.phase('copy', 'presque')) !== null);
    check('…« failed » n’existe plus', leve(() => t.phase('copy', 'failed')) !== null);

    /**
     * UNE CIBLE SUR UNE PHASE STATIQUE DÉDOUBLERAIT UNE LIGNE UNIQUE.
     * L'interface afficherait deux « Copie des fichiers », et le registre n'en
     * connaîtrait qu'une.
     */
    const cibleInterdite = leve(() => t.phase('copy', 'running', { target: 'backend' }));
    check('une cible sur une phase NON dynamique est refusée',
      cibleInterdite instanceof PhaseProtocolError);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     2. LA MACHINE D'ÉTAT — on ne réussit pas ce qu'on n'a pas commencé.
     ══════════════════════════════════════════════════════════════════════════ */
  section('2 · Transitions : ce qui est interdit, et pourquoi');
  {
    const t = createPhaseTracker();
    check('pending → ok est REFUSÉ (réussir sans avoir commencé)',
      leve(() => t.phase('mongo', 'ok')) instanceof PhaseProtocolError);

    t.phase('mongo', 'running');
    check('running deux fois est REFUSÉ',
      leve(() => t.phase('mongo', 'running')) instanceof PhaseProtocolError);
    t.phase('mongo', 'ok');
    check('ok → running est REFUSÉ (une phase finie ne recommence pas)',
      leve(() => t.phase('mongo', 'running')) instanceof PhaseProtocolError);

    t.phase('copy', 'running');
    t.phase('copy', 'error');
    check('error → ok est REFUSÉ (un échec ne s’efface pas)',
      leve(() => t.phase('copy', 'ok')) instanceof PhaseProtocolError);

    t.skip('validate', 'aucun sous-projet');
    check('skipped est un état À PART, jamais « ok »',
      t.state('validate') === PHASE_STATUS.SKIPPED && t.state('validate') !== PHASE_STATUS.OK);
    check('skipped → running est REFUSÉ',
      leve(() => t.phase('validate', 'running')) instanceof PhaseProtocolError);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     3. LA PHASE OUBLIÉE — impossible de conclure sans elle.
     ══════════════════════════════════════════════════════════════════════════ */
  section('3 · Une phase obligatoire oubliée est une anomalie MOTEUR');
  {
    const t = createPhaseTracker();
    check('au départ, TOUTES les phases requises manquent',
      t.missingRequired().length === DUPLICATION_PHASES.filter((p) => p.required).length);

    t.phase('mongo', 'running');
    check('une phase EN COURS compte comme manquante', t.missingRequired().includes('mongo'));
    t.phase('mongo', 'ok');
    check('…et cesse de manquer une fois aboutie', !t.missingRequired().includes('mongo'));

    t.skip('dependencies', 'aucun sous-projet Node découvert');
    check('une phase PASSÉE ne manque pas non plus', !t.missingRequired().includes('dependencies'));

    t.phase('copy', 'running');
    t.phase('copy', 'error');
    check('une phase en ERREUR manque toujours', t.missingRequired().includes('copy'));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     4. L'ORDRE OBSERVÉ — une vraie duplication, du début à la fin.
     ══════════════════════════════════════════════════════════════════════════ */
  section('4 · L’ordre réellement observé correspond au registre');
  const src = await fixture();
  const trace = [];
  const resultat = await duplicateProject(
    {
      projectName: 'Phases', folderName: 'phases-ok', dbTest: 'phases_test', dbProd: 'phases_prod',
      devEmail: 'dev@phases.test', devName: 'Dev', ...ADMIN,
      githubRepositoryUrl: 'https://github.com/x/phases.git',
    },
    {
      sourceRoot: src, destParent: tmpRoot, mongoUri: uri, stamp: 's1',
      exec: execMock(), onPhase: (e) => trace.push(e), onLog: () => {},
    }
  );
  check('la duplication aboutit', resultat.state === 'created');

  console.log('\n  ── TRACE OBSERVÉE ──');
  trace.forEach((e, i) => console.log(
    `  ${String(i + 1).padStart(2, '0')} ${e.status.toUpperCase().padEnd(8)} ${e.phase}${e.target ? ` [${e.target}]` : ''}`
  ));
  console.log('');

  /**
   * L'OBSERVÉ EST COMPARÉ AU REGISTRE, PAS À UN INSTANTANÉ.
   *
   * Comparer deux listes écrites à la main ne prouve que leur ressemblance. On
   * compare donc l'ordre d'apparition réel à l'ordre DÉCLARÉ : c'est la seule
   * comparaison qu'un futur ajout de phase ne pourra pas rendre fausse en
   * silence.
   */
  const premiereApparition = [];
  for (const e of trace) if (!premiereApparition.includes(e.phase)) premiereApparition.push(e.phase);
  const ordresObserves = premiereApparition.map((id) => phaseDefinition(id).order);
  check('les phases apparaissent dans l’ORDRE CANONIQUE',
    ordresObserves.every((o, i) => i === 0 || o >= ordresObserves[i - 1]));
  check('…et toutes appartiennent au registre',
    premiereApparition.every((id) => phaseDefinition(id) !== null));

  const requises = DUPLICATION_PHASES.filter((p) => p.required).map((p) => p.id);
  check('toute phase REQUISE a été observée',
    requises.every((id) => premiereApparition.includes(id)));

  /* ── LA CHECKLIST DU RAPPORT REFLÈTE LA TRACE ───────────────────────────── */
  const parCle = new Map(resultat.checklist.map((e) => [`${e.id}${e.target ? `:${e.target}` : ''}`, e.status]));
  const dernierEtat = new Map();
  for (const e of trace) dernierEtat.set(`${e.phase}${e.target ? `:${e.target}` : ''}`, e.status);
  check('la checklist du rapport reprend EXACTEMENT le dernier état de chaque phase',
    [...dernierEtat.entries()].every(([cle, statut]) => parCle.get(cle) === statut));
  check('…et rien de plus', parCle.size === dernierEtat.size);

  /* ══════════════════════════════════════════════════════════════════════════
     5. INJECTION D'ÉCHEC — la suite reste EN ATTENTE, jamais réussie.
     ══════════════════════════════════════════════════════════════════════════ */
  section('5 · Un échec n’allume rien de ce qui suit');
  {
    const traceEchec = [];
    const erreur = await duplicateProject(
      {
        projectName: 'Phases KO', folderName: 'phases-ko', dbTest: 'ko_test', dbProd: 'ko_prod',
        devEmail: 'dev@phases.test', devName: 'Dev', ...ADMIN,
        githubRepositoryUrl: 'https://github.com/x/phases.git',
      },
      {
        sourceRoot: src, destParent: tmpRoot, mongoUri: uri, stamp: 's2',
        exec: execMock({ echoue: 'manager' }), onPhase: (e) => traceEchec.push(e), onLog: () => {},
      }
    ).then(() => null).catch((e) => e);

    check('la duplication ÉCHOUE', erreur !== null);
    const enErreur = traceEchec.filter((e) => e.status === 'error');
    check('…la cible fautive est marquée en ERREUR',
      enErreur.some((e) => e.phase === 'dependencies' && e.target === 'manager'));

    /**
     * CE QUI SUIT RESTE MUET, ET C'EST LE POINT.
     * Une checklist qui passerait au vert après un échec ferait croire à une
     * duplication utilisable — et le dossier existe pourtant à moitié.
     */
    const apres = traceEchec.slice(traceEchec.findIndex((e) => e.status === 'error') + 1);
    check('…aucune phase n’est déclarée réussie APRÈS l’échec',
      !apres.some((e) => e.status === 'ok'));
    check('…« validate » n’a jamais été atteinte',
      !traceEchec.some((e) => e.phase === 'validate'));
    check('…et « done » non plus', !traceEchec.some((e) => e.phase === 'done'));
  }

  /* ── L'ÉCHEC DU PREMIER ADMINISTRATEUR : encore plus tôt ────────────────── */
  {
    const traceAdmin = [];
    const erreur = await duplicateProject(
      {
        projectName: 'Phases Admin KO', folderName: 'phases-admin-ko',
        dbTest: 'phases_test', dbProd: 'admin_ko_prod',
        devEmail: 'dev@phases.test', devName: 'Dev', ...ADMIN,
        githubRepositoryUrl: 'https://github.com/x/phases.git',
      },
      {
        sourceRoot: src, destParent: tmpRoot, mongoUri: uri, stamp: 's3',
        exec: execMock(), onPhase: (e) => traceAdmin.push(e), onLog: () => {},
      }
    ).then(() => null).catch((e) => e);

    check('un administrateur déjà présent ARRÊTE la duplication',
      erreur?.details?.blocker === 'FIRST_ADMIN_ALREADY_PRESENT');
    check('…la phase first_admin est en ERREUR',
      traceAdmin.some((e) => e.phase === 'first_admin' && e.status === 'error'));
    check('…et la copie n’a jamais commencé',
      !traceAdmin.some((e) => e.phase === 'copy'));
  }

  console.log(`\n${pass} réussis, ${fail} échoués`);
} catch (err) {
  console.error('DUPLICATION PHASES TEST CRASHED:', err);
  fail++;
} finally {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  await mongod.stop();
  process.exit(fail === 0 ? 0 : 1);
}
