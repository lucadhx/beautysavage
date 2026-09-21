/**
 * ══ LE PÉRIMÈTRE RÉEL DE `node --watch`, MESURÉ — ET LE TRACEUR QUI LE SUIT ══
 *
 * ── CE QUE CETTE RECETTE EXISTE POUR EMPÊCHER ──────────────────────────────
 *
 * La V1 du diagnostic reposait sur une PRÉMISSE écrite en commentaire :
 * « `backend/src` est le seul dossier dont une modification relance le
 * service ». Personne ne l'avait éprouvée. Elle était fausse, et son rapport
 * — `filesChanged=0` — était donc exact et sans valeur.
 *
 * Cette suite remplace la prémisse par une MESURE. Elle lance un vrai
 * `node --watch` sur un bac à sable, touche des fichiers un par un, et lit la
 * sortie du surveillant. Si Node change de comportement à une version future,
 * c'est ICI que ça tombe — pas dans un incident de production, six mois plus
 * tard, sur un rapport qu'on croira.
 *
 * ── ORGANISATION ───────────────────────────────────────────────────────────
 *
 *   1. MESURE     ce que Node surveille vraiment (bac à sable, vrai surveillant)
 *   2. GRAPHE     ce que le traceur croit être chargé, et d'où il le tient
 *   3. RACINES    ce qu'il surveille, chemins réels compris
 *   4. A–F        les six falsifications exigées par le lot
 *   5. LANCEUR    la capture de la sortie du process PARENT
 *   6. REPRISE    la corrélation « Restarting » ↔ écritures observées
 *
 * Runner autonome : aucun réseau, aucune base, aucun VPS.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.ENV = process.env.ENV || 'TEST';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
process.env.DB_TEST = process.env.DB_TEST || 'forensics_v2';
process.env.DB_PROD = process.env.DB_PROD || 'forensics_v2_prod';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'forensics-v2-secret-0123456789abcdef0123456789';
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

const require_ = createRequire(import.meta.url);
const forensics = await import('../services/deployment/forensics/restartForensics.js');
const mg = await import('../services/deployment/forensics/moduleGraph.js');

try { fs.rmSync(forensics.cheminTrace, { force: true }); } catch { /* rien à retirer */ }

function capturerConsole() {
  const lignes = [];
  const original = console.log;
  console.log = (...args) => { lignes.push(args.join(' ')); };
  return { lignes, rendre: () => { console.log = original; } };
}

async function attendreJournal(motif, depuis, tours = 60) {
  for (let i = 0; i < tours; i += 1) {
    const brut = fs.existsSync(forensics.cheminTrace)
      ? fs.readFileSync(forensics.cheminTrace, 'utf8') : '';
    if (brut.slice(depuis).includes(motif)) return true;
    await dormir(100);
  }
  return false;
}
const tailleJournal = () => (fs.existsSync(forensics.cheminTrace)
  ? fs.statSync(forensics.cheminTrace).size : 0);

/* ══════════════════════════════════════════════════════════════════════════
   1. LA MESURE — ce que `node --watch` surveille VRAIMENT.
   ══════════════════════════════════════════════════════════════════════════ */
section(`1 · Périmètre réel de \`node --watch\` (mesuré sur ${process.version}, ${process.platform})`);

const BAC = fs.mkdtempSync(path.join(os.tmpdir(), 'forensics-v2-'));
const bBack = path.join(BAC, 'backend');
const bSrc = path.join(bBack, 'src');
const bNm = path.join(bBack, 'node_modules');
const ecrire = (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };

ecrire(path.join(BAC, 'package.json'), JSON.stringify({ name: 'r', private: true }));
ecrire(path.join(BAC, 'partage', 'commun.cjs'), 'module.exports = 1;\n');
ecrire(path.join(bBack, 'package.json'), JSON.stringify({ name: 'b', type: 'module' }, null, 2));
ecrire(path.join(bBack, 'horsSrc.cjs'), 'module.exports = 1;\n');
ecrire(path.join(bBack, 'logs', 'trace.jsonl'), '{}\n');
ecrire(path.join(bNm, 'charge', 'package.json'), JSON.stringify({ name: 'charge', main: 'index.js' }));
ecrire(path.join(bNm, 'charge', 'index.js'), 'module.exports = 1;\n');
ecrire(path.join(bSrc, 'importe.js'), 'export const importe = 1;\n');
ecrire(path.join(bSrc, 'inerte.js'), 'export const inerte = 1;\n');
ecrire(path.join(bSrc, 'server.js'), `
import { createRequire } from 'node:module';
import { importe } from './importe.js';
const r = createRequire(import.meta.url);
r('../horsSrc.cjs'); r('../../partage/commun.cjs'); r('charge');
console.log('BOOT', importe);
setInterval(() => {}, 1 << 30);
`);

const surveillant = spawn(process.execPath, ['--watch', 'src/server.js'], {
  cwd: bBack, stdio: ['ignore', 'pipe', 'pipe'],
});
const sortie = [];
for (const flux of [surveillant.stdout, surveillant.stderr]) {
  flux.on('data', (b) => { for (const l of String(b).split('\n').filter(Boolean)) sortie.push(l.trim()); });
}
const nbRestart = () => sortie.filter((l) => /Restarting/i.test(l)).length;
await dormir(2500);

const MESURE = {};
async function mesurer(cle, chemin, action = (p) => fs.appendFileSync(p, `\n// ${Date.now()}\n`)) {
  const avant = nbRestart();
  try { action(chemin); } catch { /* le cas est simplement non mesurable ici */ }
  await dormir(1500);
  MESURE[cle] = nbRestart() > avant;
  await dormir(800);
}
const modifierJson = (p) => {
  const j = JSON.parse(fs.readFileSync(p, 'utf8')); j.probe = Date.now();
  fs.writeFileSync(p, JSON.stringify(j, null, 2));
};

await mesurer('importeSousSrc', path.join(bSrc, 'importe.js'));
await mesurer('inerteSousSrc', path.join(bSrc, 'inerte.js'));
await mesurer('chargeHorsSrc', path.join(bBack, 'horsSrc.cjs'));
await mesurer('chargeHorsBackend', path.join(BAC, 'partage', 'commun.cjs'));
await mesurer('nodeModulesCharge', path.join(bNm, 'charge', 'index.js'));
await mesurer('packageJsonBackend', path.join(bBack, 'package.json'), modifierJson);
await mesurer('logs', path.join(bBack, 'logs', 'trace.jsonl'));

surveillant.kill();
await dormir(300);

check('un fichier IMPORTÉ sous src relance', MESURE.importeSousSrc === true);
/**
 * LES DEUX MESURES QUI DÉTRUISENT LA PRÉMISSE DE LA V1.
 *
 * Si l'une des deux devenait fausse, la V1 aurait eu raison et toute cette
 * mission serait à revoir. C'est exactement ce qu'un contrôle doit pouvoir dire.
 */
check('un module CHARGÉ HORS src relance AUSSI', MESURE.chargeHorsSrc === true);
check('…y compris hors de `backend` (dossier partagé du dépôt)', MESURE.chargeHorsBackend === true);
check('un fichier CHARGÉ dans node_modules relance AUSSI', MESURE.nodeModulesCharge === true);
check('un fichier NON chargé, même sous src, ne relance PAS', MESURE.inerteSousSrc === false);
/**
 * `package.json` — LE LOT DEMANDE DE NE RIEN SUPPOSER, ON MESURE DONC.
 *
 * Le résultat contredit l'hypothèse la plus répandue : il ne déclenche rien.
 * On l'inscrit tel quel plutôt que de l'ajouter « au cas où » au périmètre —
 * surveiller un fichier inerte, c'est fabriquer des faux coupables.
 */
check('`backend/package.json` ne relance PAS', MESURE.packageJsonBackend === false);
check('`backend/logs/` ne relance PAS (le traceur peut donc y écrire)', MESURE.logs === false);

/* ══════════════════════════════════════════════════════════════════════════
   2. LE GRAPHE — ce que le traceur croit chargé, et d'où il le tient.
   ══════════════════════════════════════════════════════════════════════════ */
section('2 · Le graphe réellement chargé, et ses trois sources');
{
  // On charge un vrai paquet CJS pour que le cache CommonJS ne soit pas vide.
  require_('jsonwebtoken');
  const { graphe, stats } = mg.construireGrapheCharge();

  check('le graphe n’est pas vide', stats.total > 50);
  /**
   * ON NOMME CE QUI DOIT S'Y TROUVER, plutôt que de compter.
   *
   * Un seuil numérique dépend du point d'entrée : cette recette n'est pas
   * `server.js`, et son arbre est plus court. Vérifier la PRÉSENCE de modules
   * dont on sait qu'ils sont chargés éprouve la même propriété sans dépendre de
   * qui lance la mesure.
   */
  const chemins = [...graphe.keys()].map((p) => p.replace(/\\/g, '/'));
  check('il contient les modules de backend/src réellement chargés',
    chemins.some((p) => p.endsWith('/services/deployment/forensics/restartForensics.js'))
    && chemins.some((p) => p.endsWith('/config/env.js')));
  /**
   * L'ANGLE MORT DE LA V1, CHIFFRÉ.
   *
   * `node_modules` n'était surveillé NULLE PART, alors que ses fichiers
   * chargés relancent le service (mesuré en section 1).
   */
  check('…ET des fichiers de node_modules — l’angle mort de la V1',
    (stats.parZone.node_modules ?? 0) > 10);
  check('les sources sont nommées, pas confondues',
    stats.sources.statiques > 0 && stats.sources.cjs > 0);

  check('chaque entrée porte un chemin RÉEL', [...graphe.values()].every((i) => typeof i.realpath === 'string'));
  check('…une zone', [...graphe.values()].every((i) => Object.values(mg.ZONES).includes(i.zone)));
  check('…et la provenance de sa preuve',
    [...graphe.values()].every((i) => i.sources.size > 0));

  /** La classification doit être stable, sinon le rapport devient illisible. */
  check('zoneDe classe correctement',
    mg.zoneDe(path.join(SRC, 'x.js')) === mg.ZONES.BACKEND_SRC
    && mg.zoneDe(path.join(BACKEND, 'x.js')) === mg.ZONES.BACKEND_ROOT
    && mg.zoneDe(path.join(BACKEND, 'node_modules', 'a', 'i.js')) === mg.ZONES.NODE_MODULES
    && mg.zoneDe(path.join(os.tmpdir(), 'x.js')) === mg.ZONES.EXTERNAL);

  /**
   * LA TRAVERSÉE STATIQUE VOIT CE QU'UN CROCHET NE PEUT PAS VOIR.
   *
   * ESM résout tout l'arbre statique avant d'évaluer la moindre ligne : un
   * `registerHooks` posé dans le graphe arrive toujours après. Sans S1, tout le
   * code du produit chargé au démarrage serait invisible.
   */
  const statique = mg.grapheStatique(path.join(SRC, 'server.js'));
  check('la traversée statique atteint le produit depuis `server.js`', statique.size > 100);
  check('…et n’invente pas de fichiers', [...statique].every((f) => fs.existsSync(f)));
}

/* ══════════════════════════════════════════════════════════════════════════
   3. LES RACINES — peu nombreuses, réelles, et sans doublon.
   ══════════════════════════════════════════════════════════════════════════ */
section('3 · Racines de surveillance dérivées du graphe');
{
  const { graphe } = mg.construireGrapheCharge();
  const racines = mg.racinesDeSurveillance(graphe);

  check('des racines sont produites', racines.toutes.length > 0);
  check('…en petit nombre (pas un veilleur par fichier)', racines.toutes.length < 20);
  check('node_modules est couvert', racines.toutes.some((r) => r.includes('node_modules'))
    || racines.modulesNodeCouverts.length > 0);
  /**
   * AUCUN DOUBLON : un arbre déjà couvert par une racine de projet ne reçoit
   * pas un second veilleur, sinon chaque écriture serait comptée deux fois.
   */
  check('aucune racine n’est contenue dans une autre',
    racines.toutes.every((a) => !racines.toutes.some((b) => b !== a && a.startsWith(b + path.sep))));
  check('les racines sont des dossiers existants',
    racines.toutes.every((r) => { try { return fs.statSync(r).isDirectory(); } catch { return false; } }));
}

/* ══════════════════════════════════════════════════════════════════════════
/* ══════════════════════════════════════════════════════════════════════════
   4. LES FALSIFICATIONS A–F ONT DÉMÉNAGÉ — ET C'EST LE CORRECTIF LUI-MÊME.
   ══════════════════════════════════════════════════════════════════════════ */
section('4 · L’attribution n’appartient plus à l’enfant');
{
  /**
   * ══ POURQUOI CES SIX FALSIFICATIONS NE SONT PLUS ICI ═════════════════════
   *
   * Elles éprouvaient la capacité de l'ENFANT à voir un fichier bouger : ses
   * veilleurs, son instantané, son diff. Cette capacité a été RETIRÉE, et pas
   * par commodité — elle coûtait, à chaque clic « Suivant », plus de 1200
   * lectures et hachages posés juste avant l'opération observée :
   *
   *     22:37:57.653  ARMED
   *     22:37:57.663  CHANGE  …/startupReconciliation.service.js   (+10 ms)
   *     22:37:57.797  CHANGE  …/integratedApiStartup.service.js    (+144 ms)
   *     22:37:59.258  Restarting
   *
   * ARMED est la dernière ligne que l'enfant ait écrite : il est mort dans
   * son propre balayage. Un observateur qui agit sur ce qu'il mesure ne mesure
   * plus rien.
   *
   * Les six falsifications existent toujours — CÔTÉ PARENT, dans
   * deployment-restart-forensics-v3.test.js, où elles s'exécutent contre un
   * vrai lanceur et un vrai
ode --watch. On garde ici la preuve que la
   * capacité a bien QUITTÉ l'enfant, plutôt que de supprimer des contrôles en
   * silence.
   */
  const enfantSrc = fs.readFileSync(
    path.join(SRC, 'services/deployment/forensics/restartForensics.js'), 'utf8',
  );
  const code = enfantSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  check('l’enfant ne pose plus aucun veilleur', !/fs\.watch\(/.test(code));
  check('…ne construit plus de graphe', !/construireGrapheCharge/.test(code));
  check('…ne photographie plus rien', !/photographierGraphe/.test(code));
  check('…et ne rend plus de déclencheur', /candidat: null/.test(code));

  /** Ce qu'il garde : le contexte métier, que le parent ne peut pas deviner. */
  check('il publie toujours sa session au lanceur', /SESSION_ARMED/.test(code));
  check('…et journalise toujours HTTP et SSH',
    /export function noterHttp/.test(code) && /export function noterSsh/.test(code));

  /** La couverture n'a pas disparu : elle a changé de process. */
  const v3 = fs.readFileSync(path.join(SRC, 'scripts/deployment-restart-forensics-v3.test.js'), 'utf8');
  for (const cas of ['A —', 'B —', 'C —', 'D —', 'E —', 'F —']) {
    check(`la falsification « ${cas} » est éprouvée côté PARENT (V3)`, v3.includes(cas));
  }
}
/* ══════════════════════════════════════════════════════════════════════════
   5. LE LANCEUR — entendre le process PARENT.
   ══════════════════════════════════════════════════════════════════════════ */
section('5 · Le lanceur capture « Restarting », sans rien changer d’autre');
{
  const lanceur = fs.readFileSync(path.join(BACKEND, 'scripts/dev-watch.js'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND, 'package.json'), 'utf8'));

  /**
   * ON JUGE LE CODE, PAS LE RÉCIT.
   *
   * Le lanceur EXPLIQUE en commentaire pourquoi il n'ajoute ni `--import` ni
   * `--watch-path` — et c'est cette explication qui empêche quelqu'un de les
   * ajouter un jour « pour instrumenter ». Un contrôle qui lirait tout le
   * fichier se déclencherait sur sa propre justification.
   */
  const codeSeul = lanceur.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  /**
   * LA COMMANDE PORTE DÉSORMAIS UNE PORTÉE — voir le lot « dev watch scope ».
   * Ce qui reste proscrit, c'est ce qui changerait le PROCESSUS observé.
   */
  check('la commande lancée cible `src/server.js`', /'src\/server\.js'/.test(codeSeul));
  check('…avec une portée explicite', /--watch-path/.test(codeSeul));
  check('…sans drapeau qui modifierait le processus observé',
    !/--import|--require|--loader|--experimental-loader/.test(codeSeul));
  check('la sortie est relayée intégralement', /sortie\.write\(bloc\)/.test(lanceur));
  check('les signaux sont transmis à l’enfant (Ctrl-C fonctionne toujours)',
    /SIGINT.*SIGTERM.*SIGHUP/s.test(lanceur) && /enfant\.kill\(signal\)/.test(lanceur));
  check('le code de sortie est transparent', /process\.exit\(code \?\? 0\)/.test(lanceur));
  check('`npm run dev` l’utilise', pkg.scripts.dev === 'node scripts/dev-watch.js');
  check('…et la commande d’origine reste accessible',
    pkg.scripts['dev:raw'] === 'node --watch src/server.js');
  check('il refuse de tourner en PROD', /ENV.*PROD/.test(lanceur) && /process\.exit\(1\)/.test(lanceur));

  /**
   * LE JOURNAL DU LANCEUR VIT HORS DU GRAPHE.
   *
   * Mesuré en section 1 : `backend/logs/` ne déclenche aucun redémarrage. Si
   * ce journal vivait sous `src/`, le lanceur provoquerait exactement
   * l'événement qu'il prétend observer — à chaque redémarrage, un redémarrage.
   */
  check('le journal du lanceur est écrit sous `logs/`, hors du graphe',
    /logs', 'deployment-forensics'/.test(lanceur));
  check('…et le traceur sait où le lire',
    forensics.FICHIER_WATCH.replace(/\\/g, '/').endsWith('logs/deployment-forensics/watch-parent.jsonl'));

  /** Il distingue les trois issues, qui appellent trois enquêtes différentes. */
  for (const evenement of ['RESTARTING', 'FAILED', 'COMPLETED']) {
    check(`il nomme l’issue « ${evenement} »`, lanceur.includes(`'${evenement}'`));
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   6. LA REPRISE — corrélation « Restarting » ↔ écriture observée.
   ══════════════════════════════════════════════════════════════════════════ */
section("6 · La reprise renvoie au verdict du LANCEUR");
{
  /**
   * La reprise de l enfant corrélait autrefois SES propres événements avec le
   * "Restarting" du parent. Elle n en a plus : il n observe plus le système de
   * fichiers. Elle rend donc le CONTEXTE et renvoie explicitement au verdict du
   * lanceur — plutôt que d annoncer un "likelyTrigger=(aucun)" qui se lirait
   * comme une absence de cause alors qu il n a simplement rien cherché.
   */
  const enfantSrc = fs.readFileSync(
    path.join(SRC, "services/deployment/forensics/restartForensics.js"), "utf8",
  );
  check("la reprise annonce que l attribution est côté lanceur",
    /attribution=CÔTÉ LANCEUR/.test(enfantSrc));
  check("…et ne prétend plus nommer un déclencheur",
    /candidat: null, changements: \[\], restart/.test(enfantSrc));
  check("le verdict du parent est bien réimprimé au démarrage suivant",
    /export function rejouerAttributionParent/.test(enfantSrc));
  check("…avec les champs exigés du lot",
    /likelyTrigger=/.test(enfantSrc) && /confidence=/.test(enfantSrc)
    && /classification=/.test(enfantSrc) && /WRITER=/.test(enfantSrc));
  check("la corrélation fine (FS_EVENTS, GRAPH_DIFF, confiance) est éprouvée côté PARENT (V3)",
    fs.readFileSync(path.join(SRC, "scripts/deployment-restart-forensics-v3.test.js"), "utf8")
      .includes("§10 — B · les événements fichier sont joints"));
}
/* ══════════════════════════════════════════════════════════════════════════
   7. HYGIÈNE — activation automatique, aucun drapeau, rien en PROD.
   ══════════════════════════════════════════════════════════════════════════ */
section('7 · Armement automatique, et rien à faire à la main');
{
  const ctrl = fs.readFileSync(path.join(SRC, 'controllers/deployment.controller.js'), 'utf8');
  check('le clic « Suivant » arme seul la trace',
    /forensics\.armerTraceConnexion\(\{ etape: 'CONNECTION_SERVER' \}\)/.test(ctrl));
  check('…et le désarmement est DIFFÉRÉ, pas supprimé',
    /planifierDesarmement\('CONNECTED'\)/.test(ctrl) && /planifierDesarmement\('SSH_REFUSED'\)/.test(ctrl));

  const src = fs.readFileSync(path.join(SRC, 'services/deployment/forensics/restartForensics.js'), 'utf8');
  check('aucun drapeau d’environnement n’est requis',
    !/process\.env\.(FORENSICS|DEBUG_FS|TRACE|WATCH)_/.test(src));
  check('la trace reste interdite en PROD', /config\.env !== 'PROD'/.test(src));
  check('le répit après l’issue est court et borné',
    /REPIT_APRES_ISSUE_MS = 2_000/.test(src));
  check('aucun gestionnaire de signal n’est posé — la terminaison reste celle de Node',
    !/process\.on\('SIGTERM'|process\.on\('SIGINT'/.test(src));

  const graphe = fs.readFileSync(path.join(SRC, 'services/deployment/forensics/moduleGraph.js'), 'utf8');
  check('le module de graphe ne dépend QUE de `node:` (il ne s’ajoute pas au graphe qu’il décrit)',
    (graphe.match(/^import .* from '(?!node:)/gm) ?? []).length === 0);
  /**
   * L'ENFANT NE HACHE PLUS RIEN DU TOUT — la question ne se pose donc plus pour
   * lui. Le plafond d'empreintes vit désormais côté lanceur, seul endroit où un
   * hachage a encore lieu, et où il est borné.
   */
  check('l’enfant ne hache plus aucun fichier', !/createHash/.test(src));
  check('…et le plafond d’empreintes est tenu par le lanceur',
    /PLAFOND_EMPREINTES_NM/.test(
      fs.readFileSync(path.join(BACKEND, 'scripts/forensics/watchAuthority.js'), 'utf8'),
    ));

  /** Le traceur ne doit rien écrire dans ce qu'il surveille. */
  check('le traceur n’écrit que sous `logs/`',
    !new RegExp(`appendFileSync\\(\\s*path\\.join\\(SRC`).test(src));
}

/* ── NETTOYAGE ───────────────────────────────────────────────────────────── */
if (forensics.estArmee()) forensics.desarmerTrace('CLEANUP');
fs.rmSync(BAC, { recursive: true, force: true });

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
