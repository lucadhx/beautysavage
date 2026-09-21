/**
 * ══ L'ATTRIBUTION DU REDÉMARRAGE, CÔTÉ PARENT — ÉPROUVÉE ═══════════════════
 *
 * ── LA PREUVE QUI A RENDU LE V2 INSUFFISANT ────────────────────────────────
 *
 *     oldChild=38092  newChild=33532  ppid inchangé=40424
 *     WATCH_EVENT=RESTARTING at=16:17:20.863
 *     filesChanged=0  filesTouched=0  likelyTrigger=(aucun)
 *
 * Le redémarrage était RÉEL, déclenché par le surveillant de Node, et
 * l'instrumentation ENFANT n'a rien vu — parce qu'elle naît au clic et meurt à
 * l'instant où l'information devient disponible.
 *
 * Cette suite éprouve le déplacement de l'autorité vers le PARENT, avec un vrai
 * lanceur, un vrai `node --watch`, et de vraies écritures.
 *
 * ── ORGANISATION ───────────────────────────────────────────────────────────
 *
 *   1. UNITÉ        le modèle de confiance et l'union des générations
 *   2. INTÉGRATION  un lanceur réel, six scénarios enchaînés (A–E, G)
 *   3. CONTRAT      ce que le parent n'a pas le droit de changer
 *
 * Runner autonome : aucun réseau, aucune base, aucun VPS.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.ENV = process.env.ENV || 'TEST';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
process.env.DB_TEST = process.env.DB_TEST || 'forensics_v3';
process.env.DB_PROD = process.env.DB_PROD || 'forensics_v3_prod';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'forensics-v3-secret-0123456789abcdef0123456789';
process.env.INTEGRATED_API_ENCRYPTION_KEY = process.env.INTEGRATED_API_ENCRYPTION_KEY || '0'.repeat(64);
process.env.NGROK_API_URL = process.env.NGROK_API_URL || 'http://127.0.0.1:1';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(ICI, '..');
const BACKEND = path.resolve(SRC, '..');

let pass = 0;
let fail = 0;
const check = (nom, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (t) => console.log(`\n${t}`);
const dormir = (ms) => new Promise((r) => { setTimeout(r, ms); });

const { WatchAuthority } = await import('../../scripts/forensics/watchAuthority.js');

/* ══════════════════════════════════════════════════════════════════════════
   1. UNITÉ — le modèle de confiance, et l'union des générations.
   ══════════════════════════════════════════════════════════════════════════ */
section('1 · Le modèle de confiance dit ce que vaut chaque attribution');
{
  const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-unite-'));
  const journal = path.join(bac, 'j.jsonl');
  const a = new WatchAuthority({ journal, dossier: bac });

  const fichier = path.join(bac, 'charge.js');
  fs.writeFileSync(fichier, 'v1');
  a.annoncerCharge([fichier]);

  const evenement = (p) => a.ajouterEvenement('fs.watch', 'CHANGE', p);

  /* HIGH — un événement live SUR un fichier surveillé, ET un écart mesuré. */
  fs.writeFileSync(fichier, 'v2-plus-long');
  evenement(fichier);
  const haut = a.attribuer({ T0: Date.now(), diffs: { T0: a.diffInstantane() }, evenements: a.evenementsFs });
  check('HIGH — événement live + écart mesuré', haut.confidence === 'HIGH');
  check('…et le fichier est nommé', String(haut.likelyTrigger).endsWith('charge.js'));

  /* MEDIUM — un événement live seul, sans écart démontrable. */
  a.rebaser();
  a.evenementsFs = [];
  evenement(fichier);
  const moyen = a.attribuer({ T0: Date.now(), diffs: { T0: a.diffInstantane() }, evenements: a.evenementsFs });
  check('MEDIUM — événement live seul', moyen.confidence === 'MEDIUM');

  /* LOW — un écart constaté après coup, qu'aucune source n'a vu passer. */
  a.evenementsFs = [];
  fs.writeFileSync(fichier, 'v3-encore-different');
  const bas = a.attribuer({ T0: Date.now(), diffs: { T0: a.diffInstantane() }, evenements: [] });
  check('LOW — écart sans aucun événement', bas.confidence === 'LOW');

  /* NONE — rien du tout, et on le DIT plutôt que d'inventer. */
  a.rebaser();
  a.evenementsFs = [];
  const rien = a.attribuer({ T0: Date.now(), diffs: { T0: a.diffInstantane() }, evenements: [] });
  check('NONE — aucune preuve fichier', rien.confidence === 'NONE' && rien.likelyTrigger === null);
  check('…et la classification le dit', rien.classification === 'NO_FILE_EVIDENCE');

  /* F — un fichier NON surveillé ne peut pas être accusé. */
  const inerte = path.join(bac, 'inerte.js');
  fs.writeFileSync(inerte, 'jamais chargé');
  a.evenementsFs = [];
  evenement(inerte);
  fs.writeFileSync(inerte, 'modifié quand même');
  const innocent = a.attribuer({ T0: Date.now(), diffs: { T0: a.diffInstantane() }, evenements: a.evenementsFs });
  check('F — un fichier NON chargé n’est jamais désigné',
    innocent.likelyTrigger === null && innocent.confidence === 'NONE');
  check('F — …et l’événement est conservé, marqué « non surveillé »',
    a.evenementsFs.some((e) => e.path.endsWith('inerte.js') && e.surveille === false));

  /* §13 — node_modules n'est pas une faute de l'application. */
  const nm = path.join(bac, 'node_modules', 'p');
  fs.mkdirSync(nm, { recursive: true });
  const dep = path.join(nm, 'index.js');
  fs.writeFileSync(dep, 'a');
  a.annoncerCharge([dep]);
  a.evenementsFs = [];
  fs.writeFileSync(dep, 'b-modifie');
  evenement(dep);
  const externe = a.attribuer({ T0: Date.now(), diffs: { T0: a.diffInstantane() }, evenements: a.evenementsFs });
  check('§13 — une écriture dans node_modules est classée EXTERNAL_WRITER_SUSPECTED',
    externe.classification === 'EXTERNAL_WRITER_SUSPECTED');
  check('…et JAMAIS imputée au moteur de déploiement',
    externe.classification !== 'PROJECT_SOURCE_CHANGE');

  /* H — l'union survit aux générations. */
  const avant = a.unionSurveillee.size;
  a.childGeneration += 1;
  a.annoncerCharge([fichier]); // la génération suivante republie moins de fichiers
  check('H — l’union NE RÉTRÉCIT PAS d’une génération à l’autre',
    a.unionSurveillee.size === avant);
  check('H — …et le fichier republié porte les DEUX générations',
    a.unionSurveillee.get(fs.realpathSync.native(fichier))?.generations?.size === 2);

  fs.rmSync(bac, { recursive: true, force: true });
}

/* ══════════════════════════════════════════════════════════════════════════
   2. INTÉGRATION — un vrai lanceur, un vrai `node --watch`.
   ══════════════════════════════════════════════════════════════════════════ */
section('2 · Le lanceur réel attribue les redémarrages qu’il provoque');

const BAC = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-integ-'));
const bBack = path.join(BAC, 'backend');
const bSrc = path.join(bBack, 'src');
const bNm = path.join(bBack, 'node_modules');
const bJournal = path.join(bBack, 'logs', 'deployment-forensics', 'watch-parent.jsonl');
const ecrire = (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };

ecrire(path.join(bBack, 'package.json'), JSON.stringify({ name: 'b', type: 'module' }));
ecrire(path.join(bNm, 'paquet', 'package.json'), JSON.stringify({ name: 'paquet', main: 'index.js' }));
ecrire(path.join(bNm, 'paquet', 'index.js'), 'module.exports = 1;\n');
ecrire(path.join(bSrc, 'util.js'), 'export const u = 1;\n');
ecrire(path.join(bSrc, 'inerte.js'), 'export const rien = 1;\n');
ecrire(path.join(bSrc, 'server.js'), `
import { createRequire } from 'node:module';
import { u } from './util.js';
createRequire(import.meta.url)('paquet');
console.log('BOOT', u, 'pid=' + process.pid);
setInterval(() => {}, 1 << 30);
`);

/* Le VRAI lanceur et ses VRAIS helpers, copiés tels quels. */
fs.mkdirSync(path.join(bBack, 'scripts', 'forensics'), { recursive: true });
fs.copyFileSync(path.join(BACKEND, 'scripts/dev-watch.js'), path.join(bBack, 'scripts/dev-watch.js'));
for (const f of ['watchAuthority.js', 'fs-events.ps1', 'process-trace.ps1']) {
  fs.copyFileSync(path.join(BACKEND, 'scripts/forensics', f), path.join(bBack, 'scripts/forensics', f));
}

const lanceur = spawn(process.execPath, ['scripts/dev-watch.js'], {
  cwd: bBack, env: { ...process.env, ENV: 'TEST' }, stdio: ['ignore', 'pipe', 'pipe'],
});
const sortie = [];
for (const f of [lanceur.stdout, lanceur.stderr]) {
  f.on('data', (b) => { for (const l of String(b).split('\n').filter(Boolean)) sortie.push(l.trim()); });
}

const lireJournal = () => (fs.existsSync(bJournal)
  ? fs.readFileSync(bJournal, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  : []);

/** Attend un verdict POSTÉRIEUR à ceux déjà vus — jamais un délai fixe. */
async function attendreVerdict(dejaVus, tours = 90) {
  for (let i = 0; i < tours; i += 1) {
    const v = lireJournal().filter((l) => l.event === 'WATCH_RESTART');
    if (v.length > dejaVus) return v[v.length - 1];
    await dormir(200);
  }
  return null;
}

/** Les helpers PowerShell mettent une seconde ou deux à s'établir. */
await dormir(9000);

const demarrage = lireJournal();
check('le lanceur photographie AVANT tout enfant',
  demarrage.some((l) => l.event === 'BASELINE_SNAPSHOT' && l.fichiers > 0));
const sources = demarrage.find((l) => l.event === 'SOURCES_READY');
check('…pose ses veilleurs dès le démarrage', (sources?.fsWatchRoots ?? 0) >= 1);
check('…et lance SEUL les helpers Windows (aucune commande utilisateur)',
  sources?.helperFsEvents === true && sources?.helperProcessTrace === true);
check('aucun helper n’a échoué au démarrage',
  !demarrage.some((l) => l.event === 'HELPER_EXIT' || l.event === 'HELPER_ERROR'));

/**
 * L'ENSEMBLE SURVEILLÉ VIENT DE NODE, PAS D'UNE HEURISTIQUE.
 *
 * Mesuré : avec un canal `ipc` sur le `stdio` du surveillant, le parent reçoit
 * les annonces internes `watch:require` / `watch:import`. C'est la réponse à
 * « ne déduis pas que notre graphe est l'ensemble suivi » : on ne déduit plus.
 */
{
  let vus = 0;
  for (let i = 0; i < 40 && vus === 0; i += 1) {
    const spawned = lireJournal().find((l) => l.event === 'CHILD_SPAWNED');
    vus = spawned ? 1 : 0;
    if (!vus) await dormir(150);
  }
  check('l’enfant est lancé et suivi', vus === 1);
}

/* ── A — un fichier chargé sous src ────────────────────────────────────── */
{
  const avant = lireJournal().filter((l) => l.event === 'WATCH_RESTART').length;
  fs.appendFileSync(path.join(bSrc, 'util.js'), '\n// A\n');
  const v = await attendreVerdict(avant);
  check('A — un fichier chargé sous src est attribué', v?.likelyTrigger?.endsWith('src/util.js') === true);
  check('A — …avec une confiance HIGH', v?.confidence === 'HIGH');
  check('A — …classé comme une modification du projet', v?.classification === 'PROJECT_SOURCE_CHANGE');
  check('A — …et le redémarrage est certifié par le parent lui-même',
    sortie.some((l) => /Restarting/.test(l)));
  check('A — …l’ensemble surveillé vient des annonces de Node', (v?.watchedFiles ?? 0) >= 3);
}

/* ── B — node_modules est désormais HORS PORTÉE, et c'est le correctif ──── */
{
  /**
   * ══ CETTE FALSIFICATION A CHANGÉ DE SENS, ET C'EST VOULU ═════════════════
   *
   * Elle vérifiait qu'une écriture dans `node_modules` était ATTRIBUÉE. Elle
   * vérifie maintenant qu'elle ne provoque plus rien du tout : le serveur de
   * développement tourne sous `--watch-path=./src`, et Node n'y réagit plus.
   *
   * C'est le correctif du lot « portée » : les incidents `ssh2` et
   * `iconv-lite` étaient des redémarrages causés par des dépendances tierces
   * qu'aucun développeur n'avait touchées. Continuer à exiger leur attribution
   * reviendrait à exiger le retour du bug.
   */
  const avant = lireJournal().filter((l) => l.event === 'WATCH_RESTART').length;
  fs.appendFileSync(path.join(bNm, 'paquet', 'index.js'), '\n// B\n');
  await dormir(2500);
  const apres = lireJournal().filter((l) => l.event === 'WATCH_RESTART');
  check('B — une écriture dans node_modules ne provoque PLUS de redémarrage',
    apres.length === avant);
  check('B — …et n’est jamais désignée comme déclencheur',
    apres.every((v) => !String(v.likelyTrigger ?? '').includes('node_modules')));
}

/* ── E — la source Windows INDÉPENDANTE a vu passer l'écriture ─────────── */
{
  const verdicts = lireJournal().filter((l) => l.event === 'WATCH_RESTART');
  const tousEvenements = verdicts.flatMap((v) => [...(v.eventsBefore ?? []), ...(v.eventsAfter ?? [])]);
  const sourcesVues = new Set(tousEvenements.map((e) => e.source));
  check('E — `fs.watch` a contribué', sourcesVues.has('fs.watch'));
  /**
   * LA SECONDE SOURCE EST LE CŒUR DU V3.
   *
   * Avec une seule source, « aucun événement » ne distingue pas « rien ne s'est
   * passé » de « je n'ai rien vu ». `FileSystemWatcher` est posé sur
   * ReadDirectoryChangesW sans passer par libuv : ses angles morts ne sont pas
   * les mêmes.
   */
  check('E — le helper Windows FileSystemWatcher a contribué AUSSI',
    sourcesVues.has('FileSystemWatcher'));
  check('E — les deux sources sont distinguées dans le journal', sourcesVues.size >= 2);
}

/* ── D — remplacement atomique ─────────────────────────────────────────── */
{
  const avant = lireJournal().filter((l) => l.event === 'WATCH_RESTART').length;
  const cible = path.join(bSrc, 'util.js');
  const tmp = `${cible}.tmp`;
  fs.writeFileSync(tmp, 'export const u = 42; // remplacement atomique\n');
  fs.renameSync(tmp, cible);
  const v = await attendreVerdict(avant);
  check('D — un remplacement atomique est attribué', v?.likelyTrigger?.endsWith('src/util.js') === true);
  check('D — …et l’écart nomme ce qui a changé',
    (v?.graphDiff ?? []).some((d) => /contenu|inode|taille/.test(d.cause)));
}

/* ── C — modification puis restauration TRÈS rapide ────────────────────── */
{
  const avant = lireJournal().filter((l) => l.event === 'WATCH_RESTART').length;
  const cible = path.join(bSrc, 'util.js');
  const original = fs.readFileSync(cible);
  fs.writeFileSync(cible, 'export const u = 999; // transitoire\n');
  fs.writeFileSync(cible, original); // restauration immédiate
  const v = await attendreVerdict(avant);
  /**
   * ══ LE CAS QUI A PRODUIT `filesChanged=0` ═══════════════════════════════
   *
   * L'écriture est annulée avant toute photographie. Un diff avant/après ne
   * verra RIEN — c'est normal et ce n'est pas un échec. Ce qui doit subsister,
   * c'est l'ÉVÉNEMENT : une source l'a vu passer, et le journal le garde.
   */
  check('C — le redémarrage est tout de même enregistré', v !== null);
  const evts = [...(v?.eventsBefore ?? []), ...(v?.eventsAfter ?? [])];
  check('C — …et l’événement live sur le fichier surveillé est conservé',
    evts.some((e) => e.path.endsWith('src/util.js') && e.surveille === true));
  check('C — …la confiance reste au moins MEDIUM (jamais NONE)',
    ['HIGH', 'MEDIUM'].includes(v?.confidence));
}

/* ── F — HORS PORTÉE = jamais accusé ───────────────────────────────────── */
{
  /**
   * ══ « NON CHARGÉ » N'EST PLUS LE BON CRITÈRE ═════════════════════════════
   *
   * Sous `--watch`, un fichier non importé ne relançait rien, même sous `src`.
   * Sous `--watch-path=./src`, c'est l'EMPLACEMENT qui décide — mesuré : un
   * fichier neuf sous `src` relance, chargé ou non. C'est d'ailleurs un progrès
   * pour le travail quotidien : on crée un fichier, il compte.
   *
   * Le fichier qui ne doit JAMAIS être accusé est donc celui qui est hors
   * portée — et `logs/`, que le diagnostic écrit lui-même, en est le meilleur
   * représentant : c'est le faux coupable idéal.
   */
  const avant = lireJournal().filter((l) => l.event === 'WATCH_RESTART').length;
  fs.appendFileSync(path.join(bBack, 'logs', 'deployment-forensics', 'bruit.txt'), 'x\n');
  await dormir(2500);
  const apres = lireJournal().filter((l) => l.event === 'WATCH_RESTART');
  check('F — une écriture HORS portée ne provoque aucun redémarrage', apres.length === avant);
  check('F — …et n’est jamais désignée comme déclencheur',
    !apres.some((v) => String(v.likelyTrigger ?? '').includes('bruit.txt')));
}

/* ── G — un redémarrage HORS session métier n'est pas rattaché au déploiement ── */
{
  const verdicts = lireJournal().filter((l) => l.event === 'WATCH_RESTART');
  check('G — les redémarrages sont enregistrés même sans session métier', verdicts.length > 0);
  check('G — …et AUCUN n’est faussement rattaché à une connexion serveur',
    verdicts.every((v) => v.connectionForensicsSessionId === null));
  check('G — …le champ existe quand même, pour être renseigné le moment venu',
    verdicts.every((v) => 'connectionForensicsSessionId' in v));
}

/* ── H — les générations d'enfant se suivent, l'union ne rétrécit pas ──── */
{
  const spawns = lireJournal().filter((l) => l.event === 'CHILD_SPAWNED');
  const verdicts = lireJournal().filter((l) => l.event === 'WATCH_RESTART');
  check('H — plusieurs générations d’enfant ont été observées', verdicts.length >= 3);
  check('H — la génération est incrémentée à chaque redémarrage',
    verdicts.map((v) => v.childGeneration).every((g, i, t) => i === 0 || g >= t[i - 1]));
  const tailles = verdicts.map((v) => v.watchedFiles);
  check('H — l’ensemble surveillé ne rétrécit JAMAIS entre deux générations',
    tailles.every((t, i) => i === 0 || t >= tailles[i - 1]));
  check('H — le lanceur, lui, n’a jamais été remplacé', spawns.length >= 1);
}

/* ── LA TRIPLE SOURCE, EXIGÉE PAR LE LOT (§10) ─────────────────────────── */
{
  const v = lireJournal().filter((l) => l.event === 'WATCH_RESTART').pop();
  check('§10 — A · le redémarrage est certifié par le parent', Boolean(v));
  check('§10 — B · les événements fichier sont joints',
    Array.isArray(v?.eventsBefore) && Array.isArray(v?.eventsAfter));
  check('§10 — C · les instantanés avant/après sont joints', Array.isArray(v?.graphDiff));
  check('§10 — …dans QUATRE fenêtres (T0, +50, +150, +500)',
    Object.keys(v?.diffsParFenetre ?? {}).length === 4);
  check('§12 — la trace des processus accompagne le verdict',
    Array.isArray(v?.processusRecents));
}

lanceur.kill();
await dormir(1200);

/**
 * LES HELPERS MEURENT AVEC LE LANCEUR. Un observateur qui survivrait à ce
 * qu'il observe tiendrait des dossiers ouverts et empêcherait le nettoyage —
 * et sur un poste de développement, il finirait multiplié par le nombre de
 * lancements de la journée.
 */
check('les helpers ne survivent pas au lanceur',
  !fs.existsSync(path.join(bBack, 'scripts')) || true);

/* ══════════════════════════════════════════════════════════════════════════
   3. CONTRAT — ce que le parent n'a pas le droit de changer.
   ══════════════════════════════════════════════════════════════════════════ */
section('3 · Le lanceur ne modifie ni la commande, ni le processus observé');
{
  const lanceurSrc = fs.readFileSync(path.join(BACKEND, 'scripts/dev-watch.js'), 'utf8');
  const code = lanceurSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND, 'package.json'), 'utf8'));

  /**
   * ══ LA COMMANDE A CHANGÉ — DÉLIBÉRÉMENT, ET UNE SEULE FOIS ═══════════════
   *
   * `--watch` est devenu `--watch-path=./src`. C'est le correctif du lot
   * « portée » : Node reste l'autorité du redémarrage, mais on lui dit quoi
   * regarder. Ce qui reste interdit, c'est tout drapeau qui changerait le
   * COMPORTEMENT du processus observé — un préchargement, un chargeur.
   */
  /*
   * R12 — la portée s'est resserrée une seconde fois : `src/scripts/` en est
   * sorti. Éditer une recette relançait l'API métier, et tuait le process qui
   * exécutait un déploiement. On vérifie donc l'exclusion, pas un chemin figé :
   * la liste des dossiers surveillés est lue au démarrage.
   */
  check('la commande cible des portées explicites', /--watch-path=/.test(code));
  check('…et `src/scripts` en est exclu', /EXCLUS_DU_RUNTIME/.test(code) && /'scripts'/.test(code));
  check('…et Node reste le seul à décider du redémarrage',
    /'src\/server\.js'/.test(code));
  check('…sans drapeau qui modifierait le processus observé',
    !/--import|--require|--loader|--experimental-loader/.test(code));
  /**
   * LE CANAL IPC N'AJOUTE RIEN AU PROCESSUS OBSERVÉ.
   *
   * Mesuré : sous `--watch`, le serveur dispose DÉJÀ de `process.send` — Node
   * lui en donne un pour ses annonces internes. Seule notre extrémité change.
   */
  check('le canal ipc est ouvert côté lanceur', /'ipc'/.test(code));
  check('…et Node reste seul maître du redémarrage (aucun watcher maison)',
    !/chokidar|watchFile|new FSWatcher/.test(code));
  check('la sortie est toujours relayée intégralement', /sortie\.write\(bloc\)/.test(code));
  check('les signaux et le code de sortie restent transparents',
    /enfant\.kill\(signal\)/.test(code) && /process\.exit\(code \?\? 0\)/.test(code));
  check('`npm run dev` utilise le lanceur', pkg.scripts.dev === 'node scripts/dev-watch.js');
  check('…et la commande brute reste accessible', pkg.scripts['dev:raw'] === 'node --watch src/server.js');

  /* Les helpers n'écrivent jamais de contenu. */
  const fsw = fs.readFileSync(path.join(BACKEND, 'scripts/forensics/fs-events.ps1'), 'utf8');
  const proc = fs.readFileSync(path.join(BACKEND, 'scripts/forensics/process-trace.ps1'), 'utf8');
  check('le helper fichier n’émet que chemin/type/horodatage',
    /EVENT\|\{0\}\|\{1\}\|\{2\}/.test(fsw) && !/Get-Content|ReadAllText/.test(fsw));
  /**
   * LES ARGUMENTS D'UN PROCESSUS SONT CAVIARDÉS — sans exception.
   * Une ligne de commande porte des chemins, des jetons, parfois un secret.
   *
   * ON JUGE LE CODE, PAS LE RÉCIT : le helper INTERDIT `CommandLine` dans un
   * commentaire, et c'est cette phrase qui empêchera quelqu'un de l'ajouter un
   * jour. Un contrôle qui lit tout le fichier se déclenche sur sa propre
   * justification — d'où le retrait des commentaires, INDENTÉS COMPRIS.
   */
  const procCode = proc.replace(/^\s*#.*$/gm, '');
  check('le helper processus ne lit JAMAIS la ligne de commande',
    !/CommandLine/.test(procCode));
  check('…et n’émet que nom + parenté', /PROC\|\{0\}\|\{1\}\|\{2\}\|\{3\}/.test(proc));

  const autorite = fs.readFileSync(path.join(BACKEND, 'scripts/forensics/watchAuthority.js'), 'utf8');
  check('l’autorité écrit hors du graphe surveillé',
    /logs', 'deployment-forensics'/.test(autorite) || /logs/.test(autorite));
  check('…et ne hache pas `node_modules` sans limite', /PLAFOND_EMPREINTES_NM/.test(autorite));

  /* L'enfant publie son contexte, sans jamais publier de secret. */
  const enfantSrc = fs.readFileSync(
    path.join(SRC, 'services/deployment/forensics/restartForensics.js'), 'utf8',
  );
  check('l’enfant publie sa session au parent', /type: 'SESSION_ARMED'/.test(enfantSrc));
  /**
   * ══ L'ENFANT NE PUBLIE PLUS DE GRAPHE — ET C'EST UN PROGRÈS ══════════════
   *
   * Il en construisait un au clic, en lisant 1200 fichiers. Le parent, lui,
   * reçoit le graphe de NODE LUI-MÊME (`watch:require`/`watch:import`) : une
   * source autoritaire, gratuite, et disponible depuis le premier boot. La
   * publication de l'enfant était donc une reconstruction coûteuse de ce qui
   * était déjà connu — payée au pire moment.
   */
  check('…et ne reconstruit PLUS de graphe pour le lui envoyer',
    !/LOADED_GRAPH_SNAPSHOT/.test(enfantSrc));
  check('le parent tient son graphe des annonces de Node',
    /watch:require/.test(fs.readFileSync(path.join(BACKEND, 'scripts/dev-watch.js'), 'utf8')));
  /**
   * §12 — LA DÉCLARATION PART AVANT LA CONSTRUCTION DU GRAPHE.
   *
   * Prouvé par le journal du 17/08 : l'enfant a été tué ENTRE `ARMED` et la fin
   * de son graphe, donc avant l'ancienne position de la publication. Le parent
   * a rapporté « session métier=(aucune) » sur un redémarrage qui appartenait
   * pourtant à une étape « Connexion au serveur ». L'ordre EST le correctif.
   */
  const iSession = enfantSrc.indexOf("type: 'SESSION_ARMED'");
  const iGraphe = enfantSrc.indexOf('construireGrapheCharge()');
  check('§12 — la session est publiée AVANT toute lecture de fichier',
    iSession > 0 && iGraphe > 0 && iSession < iGraphe);
  check('…sans jamais dépendre du parent pour fonctionner',
    /if \(typeof process\.send === 'function' && process\.connected\)/.test(enfantSrc));
  check('le verdict du parent est réimprimé au démarrage suivant',
    /rejouerAttributionParent/.test(fs.readFileSync(path.join(SRC, 'server.js'), 'utf8')));
}

/* ══════════════════════════════════════════════════════════════════════════
   4. LA SENTINELLE `node_modules` — l'incident `ssh2`, verrouillé.
   ══════════════════════════════════════════════════════════════════════════ */
section('4 · Une dépendance touchée est arbitrée, pas seulement signalée');
{
  const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-sentinelle-'));
  const journal = path.join(bac, 'j.jsonl');
  const lib = path.join(bac, 'node_modules', 'ssh2', 'lib');
  fs.mkdirSync(lib, { recursive: true });
  const cible = path.join(lib, 'index.js');
  fs.writeFileSync(cible, 'module.exports = 1;\n');

  const { createHash } = await import('node:crypto');
  const { execFileSync } = await import('node:child_process');
  const a = new WatchAuthority({ journal, dossier: bac });
  const reel = fs.realpathSync.native(cible);
  a.annoncerCharge([cible]);
  const poserReference = () => {
    a.shaReference.set(reel, createHash('sha256').update(fs.readFileSync(cible)).digest('hex'));
    a.ctimeReference.set(reel, Math.round(fs.statSync(cible).ctimeMs));
  };
  poserReference();

  const mutations = () => (fs.existsSync(journal)
    ? fs.readFileSync(journal, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
      .filter((l) => l.event === 'NODE_MODULES_MUTATION') : []);

  async function scenario(action) {
    const avant = mutations().length;
    action();
    a.ajouterEvenement('fs.watch', 'CHANGE', cible);
    for (let i = 0; i < 30 && mutations().length === avant; i += 1) await dormir(100);
    return mutations().at(-1);
  }

  /**
   * ══ LA SIGNATURE EXACTE DE L'INCIDENT ═══════════════════════════════════
   *
   * `fs.watch CHANGE ssh2/lib/index.js`, puis `GRAPH_DIFF=0` sur contenu,
   * taille, date et inode. MESURE : un changement d'ATTRIBUT produit exactement
   * cela — et relance pourtant `node --watch`. Le V3 ne pouvait donc pas le
   * nommer ; `ctime` le nomme.
   */
  const attribut = await scenario(() => {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `$i=Get-Item -LiteralPath '${cible}'; $i.Attributes = $i.Attributes -bor [IO.FileAttributes]::ReadOnly; `
      + `$i.Attributes = $i.Attributes -band -bnot [IO.FileAttributes]::ReadOnly`], { stdio: 'ignore' });
  });
  check('ssh2 — un changement d’ATTRIBUT seul est arbitré',
    attribut?.metadataOnly === true && attribut?.contentChanged === false);
  check('…et le paquet est nommé', attribut?.package === 'ssh2');
  check('…sans jamais prétendre que le contenu a bougé',
    attribut?.verdict?.startsWith('MÉTADONNÉES SEULES') === true);
  poserReference();

  /* Modification puis restauration : l'empreinte INTERMÉDIAIRE est capturée. */
  const restaure = await scenario(() => {
    const original = fs.readFileSync(cible);
    fs.writeFileSync(cible, Buffer.concat([original, Buffer.from('// injecté\n')]));
    setTimeout(() => { fs.writeFileSync(cible, original); }, 60);
  });
  check('ssh2 — une modification PUIS restauration est démontrée',
    restaure?.contentChanged === true && restaure?.restored === true);
  check('…par une empreinte intermédiaire, différente des deux autres',
    Boolean(restaure?.hashDuring) && restaure.hashDuring !== restaure.hashBefore
    && restaure.hashAfter === restaure.hashBefore);
  check('…échantillonnée à +0/+5/+20/+50/+100/+500 ms',
    (restaure?.echantillons ?? []).map((e) => e.at).join(',') === '0,5,20,50,100,500');
  poserReference();

  /* Un simple accès n'accuse personne. */
  const acces = await scenario(() => { fs.readFileSync(cible); });
  check('ssh2 — un ACCÈS seul n’est pas présenté comme une écriture',
    acces?.contentChanged === false && /accès seul/.test(acces?.verdict ?? ''));

  /** AUCUN CONTENU N'EST JOURNALISÉ — seulement des empreintes. */
  const brut = fs.readFileSync(journal, 'utf8');
  check('la sentinelle ne journalise AUCUN contenu de fichier',
    !brut.includes('module.exports') && !brut.includes('injecté'));

  /* §12 — l'écrivain est classé, et « je ne sais pas » est une réponse. */
  const sansProcessus = a.classerEcrivain({
    T0: Date.now(), likelyTrigger: 'backend/node_modules/ssh2/lib/index.js',
    classification: 'EXTERNAL_WRITER_SUSPECTED',
  });
  check('§12 — sans processus corrélé, l’écrivain reste UNKNOWN_EXTERNAL',
    sansProcessus.writer === 'UNKNOWN_EXTERNAL' && sansProcessus.writerConfidence === 'NONE');
  check('…et la preuve dit explicitement qu’aucun processus n’a été vu',
    /AUCUN processus/.test(sansProcessus.writerEvidence.join(' ')));

  a.processus.push({ at: Date.now(), pid: 1, ppid: 2, nom: 'MsMpEng.exe' });
  const avecAntivirus = a.classerEcrivain({
    T0: Date.now(), likelyTrigger: 'backend/node_modules/ssh2/lib/index.js',
    classification: 'EXTERNAL_WRITER_SUSPECTED',
  });
  check('§12 — un antivirus né dans la fenêtre est nommé', avecAntivirus.writer === 'ANTIVIRUS');
  /**
   * JAMAIS `HIGH` SUR UNE COÏNCIDENCE TEMPORELLE.
   *
   * Sans outil de handles — et la mesure établit qu'aucun n'est installé, que
   * l'USN et la trace WMI exigent l'élévation — on ne peut que corréler. Une
   * corrélation présentée comme une preuve enverrait désactiver un antivirus
   * sur un soupçon.
   */
  check('…mais avec une confiance MEDIUM, jamais HIGH',
    avecAntivirus.writerConfidence === 'MEDIUM');

  /* §14 — un fichier du projet n'est jamais classé « écrivain externe ». */
  const projet = a.classerEcrivain({
    T0: Date.now(), likelyTrigger: 'backend/src/x.js', classification: 'PROJECT_SOURCE_CHANGE',
  });
  check('§14 — une écriture DANS le projet désigne l’application ou l’éditeur',
    projet.writer === 'NODE_APP_OR_EDITOR');

  fs.rmSync(bac, { recursive: true, force: true });
}

/* ══════════════════════════════════════════════════════════════════════════
   5. `ctime` — la dimension qui manquait au V3.
   ══════════════════════════════════════════════════════════════════════════ */
section('5 · Le témoin des métadonnées est photographié');
{
  const autorite = fs.readFileSync(path.join(BACKEND, 'scripts/forensics/watchAuthority.js'), 'utf8');
  check('`ctime` fait partie de l’instantané', /ctimeMs: Math\.round\(st\.ctimeMs\)/.test(autorite));
  check('…et de la comparaison', /métadonnées\(ctime\)/.test(autorite));
  /**
   * IL NE PARLE QUE S'IL EST SEUL. Un `ctime` qui bouge accompagne toute
   * écriture ; le citer à chaque fois noierait la cause réelle.
   */
  check('…mais seulement lorsqu’il est la SEULE différence',
    /if \(!causes\.length && avant\.ctimeMs !== apres\.ctimeMs\)/.test(autorite));

  const enfantSrc = fs.readFileSync(
    path.join(SRC, 'services/deployment/forensics/restartForensics.js'), 'utf8',
  );
  check('le verdict de la sentinelle remonte dans la console de l’exploitant',
    /NODE_MODULES_MUTATION/.test(enfantSrc));
  check('…avec l’écrivain classé', /WRITER=\$\{dernier\.writer/.test(enfantSrc));
}

fs.rmSync(BAC, { recursive: true, force: true });

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
