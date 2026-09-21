/**
 * ══ L'ARMEMENT NE DOIT RIEN LIRE — MESURÉ, PAS PROMIS ══════════════════════
 *
 * ── LE FAIT QUI A IMPOSÉ CE LOT ────────────────────────────────────────────
 *
 *     22:37:57.653  ARMED
 *     22:37:57.663  CHANGE  …/startupReconciliation.service.js   (+10 ms)
 *     22:37:57.797  CHANGE  …/integratedApiStartup.service.js    (+144 ms)
 *     22:37:59.258  Restarting 'src/server.js'
 *
 * Les deux fichiers n'ont jamais changé — contenu, taille, mtime, ctime et
 * inode identiques, `LastWriteTime` antérieur d'une heure. Mais `ARMED` est la
 * DERNIÈRE ligne que l'enfant ait écrite : il a été tué pendant son propre
 * balayage, lequel lisait et hachait plus de 1200 fichiers.
 *
 * Cela ne démontre pas que le traceur explique les incidents ANTÉRIEURS à son
 * existence, et cette suite ne le prétend pas. Cela démontre qu'un observateur
 * qui déclenche 1200 lectures au clic modifie les conditions de l'expérience.
 *
 * ── CE QUI EST ÉPROUVÉ ICI ─────────────────────────────────────────────────
 *
 * On COMPTE les appels système réellement émis pendant l'armement, en
 * instrumentant `fs`. Attendu : ZÉRO lecture de fichier du projet, zéro
 * parcours de dossier, zéro hachage. Un contrôle qui lirait seulement le code
 * source pourrait être satisfait par une intention ; celui-ci ne peut l'être
 * que par un comportement.
 *
 * Runner autonome : aucun réseau, aucune base.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.env.ENV = process.env.ENV || 'TEST';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
process.env.DB_TEST = process.env.DB_TEST || 'forensics_nonintrusif';
process.env.DB_PROD = process.env.DB_PROD || 'forensics_nonintrusif_prod';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'forensics-nonintrusif-0123456789abcdef0123456789';
process.env.INTEGRATED_API_ENCRYPTION_KEY = process.env.INTEGRATED_API_ENCRYPTION_KEY || '0'.repeat(64);
process.env.NGROK_API_URL = process.env.NGROK_API_URL || 'http://127.0.0.1:1';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(ICI, '..');
const BACKEND = path.resolve(SRC, '..');
const LOGS = path.join(BACKEND, 'logs');

let pass = 0;
let fail = 0;
const check = (nom, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (t) => console.log(`\n${t}`);

const forensics = await import('../services/deployment/forensics/restartForensics.js');
try { fs.rmSync(forensics.cheminTrace, { force: true }); } catch { /* rien */ }

/**
 * ══ LE COMPTEUR — ON INSTRUMENTE, ON NE SIMULE PAS ═════════════════════════
 *
 * On enveloppe les fonctions de `fs` réellement susceptibles de toucher le
 * projet. Chaque appel est classé par CIBLE : le journal forensique vit sous
 * `backend/logs/`, hors du graphe de modules, et la mesure a établi qu'y écrire
 * ne relance rien — ces appels-là sont donc légitimes et comptés à part.
 *
 * Tout le reste — une lecture de source, un parcours de dossier, un `stat` sur
 * le projet — est une intrusion.
 */
function instrumenterFs() {
  const observes = ['readFileSync', 'readFile', 'readdirSync', 'readdir', 'statSync', 'stat', 'lstatSync', 'realpathSync', 'openSync', 'createReadStream'];
  const originaux = new Map();
  const appels = { projet: [], journal: [], autre: [] };

  const classer = (nom, cible) => {
    const p = String(cible ?? '');
    const absolu = path.isAbsolute(p) ? path.normalize(p) : p;
    if (absolu.startsWith(LOGS)) { appels.journal.push(`${nom}(${path.basename(absolu)})`); return; }
    if (absolu.startsWith(BACKEND)) { appels.projet.push(`${nom}(${path.relative(BACKEND, absolu)})`); return; }
    appels.autre.push(`${nom}(${absolu.slice(0, 60)})`);
  };

  for (const nom of observes) {
    if (typeof fs[nom] !== 'function') continue;
    originaux.set(nom, fs[nom]);
    const original = fs[nom];
    fs[nom] = function instrumente(...args) {
      try { classer(nom, args[0]); } catch { /* la mesure ne casse jamais l'appel */ }
      return original.apply(this, args);
    };
  }
  // `realpathSync.native` est une propriété de fonction : elle se perd sinon.
  if (originaux.has('realpathSync') && originaux.get('realpathSync').native) {
    fs.realpathSync.native = originaux.get('realpathSync').native;
  }

  const hachages = [];
  const createHash = crypto.createHash;
  crypto.createHash = function instrumente(algo, ...reste) {
    hachages.push(algo);
    return createHash.call(this, algo, ...reste);
  };

  return {
    appels,
    hachages,
    rendre() {
      for (const [nom, fn] of originaux) fs[nom] = fn;
      crypto.createHash = createHash;
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   1. L'ARMEMENT — zéro lecture du projet.
   ══════════════════════════════════════════════════════════════════════════ */
section('1 · Armer CONNECTION_SERVER ne lit AUCUN fichier du projet');
{
  const sonde = instrumenterFs();
  const t0 = Date.now();
  forensics.armerTraceConnexion({ etape: 'CONNECTION_SERVER' });
  const duree = Date.now() - t0;
  sonde.rendre();

  check('la session est bien armée', forensics.estArmee() === true);

  /**
   * LE CONTRÔLE CENTRAL DU LOT. Une seule lecture de source ferait échouer ce
   * test — et c'est exactement l'intention : rendre la régression impossible à
   * committer sans la voir.
   */
  check(`AUCUNE lecture/stat/parcours du projet (${sonde.appels.projet.length} observé(s)`
    + `${sonde.appels.projet.length ? ` : ${sonde.appels.projet.slice(0, 4).join(', ')}` : ''})`,
  sonde.appels.projet.length === 0);

  check(`AUCUN hachage (${sonde.hachages.length} observé(s))`, sonde.hachages.length === 0);

  /** Écrire la ligne de journal reste permis : hors graphe, mesuré inoffensif. */
  check('seul le journal hors graphe est touché, et à peine',
    sonde.appels.journal.length <= 2);

  /**
   * O(1) SE MESURE AUSSI AU CHRONOMÈTRE. Le balayage précédent prenait des
   * centaines de millisecondes ; une déclaration en prend zéro.
   */
  check(`l’armement est instantané (${duree}ms)`, duree < 60);

  forensics.desarmerTrace('TEST');
  check('…et se désarme', forensics.estArmee() === false);
}

/* ══════════════════════════════════════════════════════════════════════════
   2. LE DÉSARMEMENT non plus — il rephotographiait tout.
   ══════════════════════════════════════════════════════════════════════════ */
section('2 · Désarmer ne relit rien non plus');
{
  forensics.armerTraceConnexion({ etape: 'CONNECTION_SERVER' });
  forensics.noterHttp('POST', '/api/deployment/vps-session');
  forensics.noterSsh('probe start', { host: 'vps.exemple.com', username: 'root' });

  const sonde = instrumenterFs();
  const issue = forensics.desarmerTrace('CONNECTED');
  sonde.rendre();

  check(`le désarmement ne relit AUCUN fichier du projet (${sonde.appels.projet.length})`,
    sonde.appels.projet.length === 0);
  check('…ni ne hache quoi que ce soit', sonde.hachages.length === 0);
  /**
   * LE CONTRAT DE RETOUR SURVIT, VIDE ET HONNÊTE. Le supprimer casserait les
   * appelants ; le remplir serait mentir — l'enfant n'observe plus rien.
   */
  check('l’issue reste dans le contrat, sans rien prétendre',
    Array.isArray(issue?.touches) && issue.touches.length === 0 && issue.candidat === null);
}

/* ══════════════════════════════════════════════════════════════════════════
   3. LA STRUCTURE — l'armement est INCAPABLE de scanner.
   ══════════════════════════════════════════════════════════════════════════ */
section('3 · L’incapacité est structurelle, pas conventionnelle');
{
  const src = fs.readFileSync(
    path.join(SRC, 'services/deployment/forensics/restartForensics.js'), 'utf8',
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /**
   * ON NE PEUT PAS APPELER CE QU'ON N'IMPORTE PAS.
   *
   * Tant que ces fonctions restaient importées, l'armement pouvait redevenir un
   * balayage sans que personne ne le remarque en relecture. Il faut désormais
   * RAJOUTER une ligne d'import pour commettre la régression.
   */
  for (const interdit of ['construireGrapheCharge', 'racinesDeSurveillance', 'photographierGraphe']) {
    check(`\`${interdit}\` n’est plus accessible depuis ce module`, !code.includes(interdit));
  }
  check('aucun `fs.watch` n’est posé par l’enfant', !/fs\.watch\(/.test(code));

  /**
   * ══ LES SEULES LECTURES TOLÉRÉES SONT CELLES DES JOURNAUX ════════════════
   *
   * La reprise au démarrage DOIT relire `connexion-serveur.jsonl` et
   * `watch-parent.jsonl` — c'est ainsi que le verdict du lanceur revient dans
   * la console de l'exploitant. Ces fichiers vivent sous `backend/logs/`, hors
   * du graphe de modules, et la mesure établit qu'y toucher ne relance rien.
   *
   * On vérifie donc la CIBLE de chaque lecture, pas leur absence : un contrôle
   * qui interdirait tout `readFileSync` obligerait à contourner la règle pour
   * faire fonctionner la reprise — et une règle qu'on contourne ne protège plus.
   */
  const lectures = [...code.matchAll(/readFileSync\(([^,)]*)/g)].map((m) => m[1].trim());
  check(`toute lecture vise un JOURNAL, jamais le projet (${lectures.length} lecture(s))`,
    lectures.length > 0 && lectures.every((cible) => /FICHIER_TRACE|FICHIER_WATCH/.test(cible)));
  check('aucun parcours de dossier nulle part', !/readdirSync\(|readdir\(/.test(code));

  /** L'armement lui-même, borné à sa propre fonction, ne lit rien du tout. */
  const debutArm = code.indexOf('export function armerTraceConnexion');
  const finArm = code.indexOf('export function noterHttp');
  const corpsArmement = code.slice(debutArm, finArm);
  check('le corps de l’armement ne contient AUCUNE lecture',
    debutArm > 0 && finArm > debutArm && !/readFileSync|readdirSync|statSync/.test(corpsArmement));

  /** Ce qui RESTE doit rester : le contexte métier est la raison d'être. */
  check('la session est toujours publiée au lanceur', /type: 'SESSION_ARMED'/.test(code));
  check('…les appels HTTP toujours notés', /export function noterHttp/.test(code));
  check('…les étapes SSH toujours notées', /export function noterSsh/.test(code));
  check('…et le verdict du lanceur toujours réimprimé',
    /export function rejouerAttributionParent/.test(code));

  /** §11 — les trois PID sont NOMMÉS, plus de « parent » générique. */
  check('les PID sont désambiguïsés (serverPid / nodeWatchPid)',
    /serverPid=\$\{process\.pid\} nodeWatchPid=\$\{process\.ppid\}/.test(src));
}

/* ══════════════════════════════════════════════════════════════════════════
   4. RECETTE DES 50 ARMEMENTS (§9).
   ══════════════════════════════════════════════════════════════════════════ */
section('4 · 50 armements successifs — coût total mesuré');
{
  const sonde = instrumenterFs();
  const t0 = Date.now();
  for (let i = 0; i < 50; i += 1) {
    forensics.armerTraceConnexion({ etape: 'CONNECTION_SERVER' });
    forensics.noterHttp('POST', '/api/deployment/vps-session');
    forensics.desarmerTrace('CONNECTED');
  }
  const duree = Date.now() - t0;
  sonde.rendre();

  /**
   * AVANT ce lot, ces 50 armements auraient produit ~60 000 lectures et ~17 000
   * hachages. C'est le chiffre que cette ligne remplace par zéro.
   */
  check(`50 armements → 0 lecture du projet (${sonde.appels.projet.length})`,
    sonde.appels.projet.length === 0);
  check(`50 armements → 0 hachage (${sonde.hachages.length})`, sonde.hachages.length === 0);
  check(`…et un coût total négligeable (${duree}ms)`, duree < 1500);
  check('aucune session ne fuit', forensics.estArmee() === false);
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
