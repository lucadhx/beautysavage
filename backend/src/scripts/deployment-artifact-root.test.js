/**
 * LA RACINE DU PROJET SOURCE — ce que `artifact.build` regarde, et pourquoi.
 *
 * ══ L'INCIDENT QUE CETTE SUITE FERME ════════════════════════════════════════
 *
 * Un déploiement SB Auto TEST a échoué à `artifact.build` sur :
 *
 *     ARTIFACT_PATH_INVALID
 *     « Projet introuvable ou invalide : vitrine/package.json manquant. »
 *
 * alors que `vitrine/package.json` existait — et existe toujours — dans le
 * dépôt. Toutes les étapes précédentes (DNS, SSH, Node, PM2, Nginx) étaient
 * vertes, et aucune mutation distante n'avait eu lieu.
 *
 * La racine des sources était DÉDUITE de l'emplacement du moteur :
 * `path.resolve(__dirname, '../../..')` depuis
 * `<racine>/backend/src/deployment-engine`. Cette remontée est juste dans un
 * checkout de développement. Elle est FAUSSE partout où le backend est déployé :
 * sur le serveur il vit dans `/var/www/<hôte>/backend`, et la même remontée
 * désigne `/var/www/<hôte>` — un dossier qui a la bonne FORME (des sous-dossiers
 * portant les noms des applications) sans en avoir la substance, puisque les
 * fronts n'y sont présents que sous forme de `dist` publié.
 *
 * Deux traces de l'incident le confirmaient sans ambiguïté :
 *   · le contexte local rapportait `linux x64`, quand le poste est sous Windows ;
 *   · la version publiée était `v20260817-1202`, le repli HORODATÉ de
 *     `getProjectVersion()` — donc `git rev-parse` avait échoué à la racine
 *     utilisée. Le dépôt de développement, lui, rend un SHA.
 *
 * ══ CE QUE CETTE SUITE VÉRIFIE ══════════════════════════════════════════════
 *
 *   1. la structure RÉELLE du dépôt, observée sur le vrai filesystem ;
 *   2. l'indépendance totale au `cwd` — y compris depuis un processus enfant ;
 *   3. l'ordre d'autorité de la racine, et le fait qu'aucun candidat n'est cru
 *      sur parole ;
 *   4. la reproduction de l'incident sur un layout DÉPLOYÉ simulé ;
 *   5. et surtout : qu'une machine sans les sources est refusée par le
 *      préflight LOCAL — avant le moindre run, la moindre session SSH, la
 *      moindre mutation DNS.
 *
 * `fs.existsSync` n'est JAMAIS simulé ici : une garde qui mocke le filesystem
 * ne dit rien de ce que le filesystem contient, et c'est précisément la
 * question posée par cet incident.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

let pass = 0;
let fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name}${detail ? `\n      → ${detail}` : ''}`); }
};
const section = (t) => console.log(`\n${t}`);

const ICI = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(ICI, '..', 'deployment-engine');
const REPO_ROOT = path.resolve(ICI, '..', '..', '..');

const {
  MODULE_PROJECT_ROOT, PROJECT_ROOT_ENV_VAR, ROOT_SOURCES,
  projectRootCandidate, inspectProjectRoot,
} = await import('../deployment-engine/projectRoot.js');
const { APPS } = await import('../deployment-engine/config/project.profile.js');
const { buildableApps } = await import('../deployment-engine/topology.js');
const { buildArtifact, PROJECT_ROOT } = await import('../deployment-engine/build.js');
const { runLocalPreflight } = await import('../deployment-engine/localPreflight.js');

/* ══════════════════════════════════════════════════════════════════════════ */
section('1. La structure RÉELLE du dépôt — observée, jamais simulée');
/* ══════════════════════════════════════════════════════════════════════════ */
{
  check('la racine déduite du module EST la racine du dépôt',
    path.resolve(MODULE_PROJECT_ROOT) === path.resolve(REPO_ROOT),
    `module=${MODULE_PROJECT_ROOT} dépôt=${REPO_ROOT}`);

  // C'est LE fait que l'incident contestait. On le lit sur le disque.
  for (const app of APPS) {
    const pkg = path.join(REPO_ROOT, app.dir, 'package.json');
    check(`${app.dir}/package.json existe réellement`, fs.existsSync(pkg), pkg);
  }
  for (const app of buildableApps(APPS)) {
    const lock = path.join(REPO_ROOT, app.dir, 'package-lock.json');
    check(`${app.dir}/package-lock.json existe réellement (npm ci possible)`,
      fs.existsSync(lock), lock);
  }

  const inspection = await inspectProjectRoot();
  check('l’inspection de la vraie racine ne trouve AUCUN absent',
    inspection.ok && inspection.missing.length === 0,
    JSON.stringify(inspection.missing));
  check('l’inspection expose une application par entrée de profil',
    Object.keys(inspection.apps).length === APPS.length);
  check('les chemins rendus sont ABSOLUS',
    Object.values(inspection.apps).every((p) => path.isAbsolute(p)));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('2. Indépendance au répertoire courant — la racine ne se devine pas');
/* ══════════════════════════════════════════════════════════════════════════ */
{
  const cwdOrigine = process.cwd();
  const tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cwd-hostile-'));
  const cwdsHostiles = [
    REPO_ROOT,
    path.join(REPO_ROOT, 'backend'),
    path.join(REPO_ROOT, 'manager'),
    tempCwd,
  ].filter((d) => fs.existsSync(d));

  const resultats = [];
  try {
    for (const cwd of cwdsHostiles) {
      process.chdir(cwd);
      const insp = await inspectProjectRoot();
      resultats.push({ cwd, root: insp.root, ok: insp.ok });
    }
  } finally {
    process.chdir(cwdOrigine);
  }

  check(`${cwdsHostiles.length} répertoires courants différents éprouvés`,
    resultats.length === cwdsHostiles.length);
  const racines = new Set(resultats.map((r) => r.root));
  check('la racine résolue est IDENTIQUE depuis tous les cwd',
    racines.size === 1, [...racines].join(' | '));
  check('la racine résolue reste celle du dépôt',
    [...racines][0] === path.resolve(REPO_ROOT));
  check('l’inspection est valide depuis tous les cwd',
    resultats.every((r) => r.ok));

  fs.rmSync(tempCwd, { recursive: true, force: true });
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('3. Processus enfant détaché — le worker hérite d’une racine, pas d’un cwd');
/* ══════════════════════════════════════════════════════════════════════════ */
{
  /**
   * LA MEILLEURE GARDE CONTRE LA RÉCIDIVE.
   *
   * Un worker de déploiement est lancé détaché, avec son propre `cwd`. Si la
   * racine dépendait de ce `cwd`, elle divergerait entre l'API et le worker
   * sans que rien ne le signale. On lance donc un VRAI processus Node depuis un
   * répertoire temporaire, et on compare ce qu'il résout à ce que résout le
   * processus courant.
   */
  const sondeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-probe-'));
  const sonde = path.join(sondeDir, 'sonde.mjs');
  const buildUrl = pathToFileURL(path.join(ENGINE_DIR, 'build.js')).href;
  const rootUrl = pathToFileURL(path.join(ENGINE_DIR, 'projectRoot.js')).href;
  fs.writeFileSync(sonde,
    `const { PROJECT_ROOT } = await import(${JSON.stringify(buildUrl)});\n`
    + `const { inspectProjectRoot } = await import(${JSON.stringify(rootUrl)});\n`
    + 'const i = await inspectProjectRoot();\n'
    + 'console.log(JSON.stringify({ PROJECT_ROOT, root: i.root, ok: i.ok, cwd: process.cwd() }));\n');

  const { stdout } = await execFileP(process.execPath, [sonde], { cwd: sondeDir });
  const enfant = JSON.parse(stdout.trim());

  check('le processus enfant a bien un cwd hostile',
    path.resolve(enfant.cwd) === path.resolve(sondeDir), enfant.cwd);
  check('l’enfant résout la MÊME racine que le parent',
    enfant.root === path.resolve(REPO_ROOT), enfant.root);
  check('PROJECT_ROOT de l’enfant vaut celui du parent',
    enfant.PROJECT_ROOT === PROJECT_ROOT, `${enfant.PROJECT_ROOT} vs ${PROJECT_ROOT}`);
  check('l’enfant trouve les sources', enfant.ok === true);

  fs.rmSync(sondeDir, { recursive: true, force: true });
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('4. Ordre d’autorité — explicite d’abord, et rien n’est cru sur parole');
/* ══════════════════════════════════════════════════════════════════════════ */
{
  const faux = path.join(os.tmpdir(), 'racine-qui-nexiste-pas');

  check('sans rien : la racine vient de l’emplacement du module',
    projectRootCandidate({ env: {} }).source === ROOT_SOURCES.MODULE);
  check(`${PROJECT_ROOT_ENV_VAR} l’emporte sur l’emplacement du module`,
    projectRootCandidate({ env: { [PROJECT_ROOT_ENV_VAR]: faux } }).source === ROOT_SOURCES.ENV);
  check(`la racine explicite l’emporte sur ${PROJECT_ROOT_ENV_VAR}`,
    projectRootCandidate({ root: REPO_ROOT, env: { [PROJECT_ROOT_ENV_VAR]: faux } }).source
      === ROOT_SOURCES.OPTION);
  check('une racine vide n’est pas une racine',
    projectRootCandidate({ root: '   ', env: {} }).source === ROOT_SOURCES.MODULE);
  check('la racine est toujours absolue et normalisée',
    path.isAbsolute(projectRootCandidate({ root: 'a/b/../c', env: {} }).root));

  // Le point essentiel : une racine EXPLICITE mais fausse échoue comme une
  // racine déduite mais fausse. L'autorité dit OÙ chercher, jamais QUE c'est bon.
  const insp = await inspectProjectRoot({ root: faux });
  check('une racine explicite FAUSSE est rejetée, pas acceptée',
    insp.ok === false && insp.missing.length === APPS.length);
  check('le rejet nomme la racine explicite en cause',
    insp.root === path.resolve(faux) && insp.source === ROOT_SOURCES.OPTION);

  // Et une racine explicite VALIDE est retenue telle quelle.
  const inspVraie = await inspectProjectRoot({ root: REPO_ROOT });
  check('une racine explicite VALIDE est retenue', inspVraie.ok && inspVraie.source === ROOT_SOURCES.OPTION);

  check(`${PROJECT_ROOT_ENV_VAR} pointant sur le vrai dépôt est accepté`,
    (await inspectProjectRoot({ env: { [PROJECT_ROOT_ENV_VAR]: REPO_ROOT } })).ok === true);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('5. Reproduction de l’incident — le layout DÉPLOYÉ, à l’identique');
/* ══════════════════════════════════════════════════════════════════════════ */
{
  /**
   * On reconstitue `/var/www/<hôte>/` tel que le déploiement le produit :
   *   backend/   les SOURCES du backend (c'est lui qui tourne) ;
   *   vitrine/   le `dist` publié — index.html + assets, JAMAIS de package.json ;
   *   manager/   idem.
   * Puis on y installe une copie du moteur, et on l'importe DEPUIS LÀ. La racine
   * qu'il déduit est alors celle du site déployé : c'est l'incident, à la ligne près.
   */
  const faux = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-deploye-'));
  fs.cpSync(ENGINE_DIR, path.join(faux, 'backend', 'src', 'deployment-engine'), { recursive: true });
  // Le backend déployé emporte bien son package.json : seuls les FRONTS n'ont
  // que leur dist. La reproduction doit être fidèle sur ce point.
  fs.writeFileSync(path.join(faux, 'backend', 'package.json'), '{"name":"backend-deploye"}\n');
  for (const app of buildableApps(APPS)) {
    fs.mkdirSync(path.join(faux, app.dir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(faux, app.dir, 'index.html'), '<!doctype html><html></html>');
  }

  const moteurDeploye = path.join(faux, 'backend', 'src', 'deployment-engine');
  const buildDeploye = await import(pathToFileURL(path.join(moteurDeploye, 'build.js')).href);
  const racineDeploye = await import(pathToFileURL(path.join(moteurDeploye, 'projectRoot.js')).href);

  check('le moteur relocalisé déduit la racine du SITE DÉPLOYÉ',
    path.resolve(racineDeploye.MODULE_PROJECT_ROOT) === path.resolve(faux),
    racineDeploye.MODULE_PROJECT_ROOT);

  // La version horodatée, signature de l'incident : pas de dépôt Git à cette racine.
  const version = await buildDeploye.getProjectVersion();
  check('la version y retombe sur le repli HORODATÉ (aucun dépôt Git)',
    /^v\d{8}-\d{4}$/.test(version), version);

  const inspection = await racineDeploye.inspectProjectRoot();
  check('l’inspection y échoue', inspection.ok === false);
  check('elle désigne les FRONTS, et pas le backend (qui, lui, est déployé)',
    inspection.missing.length === buildableApps(APPS).length
    && inspection.missing.every((m) => m.requires === 'package.json'),
    JSON.stringify(inspection.missing.map((m) => `${m.dir}/${m.requires}`)));

  let erreur = null;
  try {
    await buildDeploye.buildArtifact({ onLog: () => {} });
  } catch (err) { erreur = err; }

  check('buildArtifact y échoue toujours — la machine n’a pas les sources',
    erreur?.code === 'ARTIFACT_PATH_INVALID', String(erreur?.code));
  check('le code d’erreur historique est PRÉSERVÉ (contrat inchangé)',
    erreur?.step === 'build');
  check('l’erreur porte désormais la RACINE ABSOLUE inspectée',
    erreur?.details?.projectRoot === path.resolve(faux), erreur?.details?.projectRoot);
  check('l’erreur porte la PROVENANCE de cette racine',
    erreur?.details?.projectRootSource === ROOT_SOURCES.MODULE);
  check('l’erreur porte l’inventaire COMPLET des absents, pas le premier seul',
    Array.isArray(erreur?.details?.missing)
    && erreur.details.missing.length === buildableApps(APPS).length);

  /**
   * ══ LE VRAI CORRECTIF : LE REFUS ARRIVE AVANT TOUTE MUTATION ═════════════
   *
   * Sur cette même racine, le préflight LOCAL doit refuser. C'est lui qui
   * s'exécute avant le run, avant SSH, avant DNS — là où un refus ne laisse
   * rien derrière lui. Avant correction il rendait `ok: true` : hors dépôt Git
   * il n'avait tout simplement rien à dire.
   */
  const prefTest = await runLocalPreflight({ env: 'TEST', root: faux });
  check('préflight LOCAL : refuse en TEST (avant run, SSH et DNS)', prefTest.ok === false);
  const layoutCheck = prefTest.failedChecks.find((c) => c.id === 'source.layout');
  check('le contrôle fautif est bien « source.layout »', Boolean(layoutCheck));
  check('il est de portée locale', layoutCheck?.scope === 'local');
  check('il est bloquant', layoutCheck?.required === true);
  check('son détail nomme la racine inspectée',
    typeof layoutCheck?.detail === 'string' && layoutCheck.detail.includes(path.resolve(faux)));
  /**
   * Le refus doit NOMMER le problème, pas le contrôle. « Sources du projet
   * présentes » est le titre du contrôle ; l'opposer tel quel à l'opérateur lui
   * annoncerait l'inverse du fait constaté.
   */
  check('l’échec porte une phrase de PROBLÈME distincte du titre du contrôle',
    typeof layoutCheck?.summary === 'string'
    && layoutCheck.summary.length > 0
    && layoutCheck.summary !== layoutCheck.label,
    `summary=${layoutCheck?.summary} label=${layoutCheck?.label}`);
  check('le préflight expose la racine retenue',
    prefTest.projectRoot === path.resolve(faux));

  const prefProd = await runLocalPreflight({ env: 'PROD', root: faux });
  check('préflight LOCAL : refuse aussi en PROD', prefProd.ok === false);

  fs.rmSync(faux, { recursive: true, force: true });
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('6. Non-régression : le vrai dépôt passe le préflight local');
/* ══════════════════════════════════════════════════════════════════════════ */
{
  const pref = await runLocalPreflight({ env: 'TEST' });
  const layout = pref.checks.find((c) => c.id === 'source.layout');
  check('le contrôle « source.layout » existe', Boolean(layout));
  check('il PASSE sur le vrai dépôt', layout?.ok === true, layout?.detail);
  check('aucun échec de layout sur le vrai dépôt',
    !pref.failedChecks.some((c) => c.id === 'source.layout'));
  // En TEST, un dépôt non commité ne bloque pas : la seule raison de refuser
  // ici serait le layout. Le poste de développement doit donc rester vert.
  check('le préflight TEST est vert sur le poste de développement',
    pref.ok === true, JSON.stringify(pref.failedChecks.map((c) => c.id)));
  check('le préflight expose la racine du dépôt',
    pref.projectRoot === path.resolve(REPO_ROOT));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('7. Chemins : primitives pathlib, jamais de concaténation');
/* ══════════════════════════════════════════════════════════════════════════ */
{
  const source = fs.readFileSync(path.join(ENGINE_DIR, 'projectRoot.js'), 'utf8')
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  /**
   * On interdit la CONCATÉNATION de chemin (`racine + '/' + dossier`), pas les
   * gabarits d'affichage (`${dir}/${fichier}`) : ces derniers composent un
   * libellé lisible pour l'opérateur, jamais un chemin remis au filesystem. La
   * distinction compte — une garde qui confond les deux force à dégrader les
   * messages sans rien gagner en justesse de chemin.
   */
  check('aucune concaténation de chemin avec « / »', !/\+\s*['"][/\\]/.test(source));
  check('les chemins sont composés par path.join / path.resolve',
    /path\.join\(/.test(source) && /path\.resolve\(/.test(source));

  // Et la preuve COMPORTEMENTALE, qui vaut mieux que la lecture du texte :
  // séparateurs POSIX, séparateurs natifs et segments `..` mènent au même point.
  const posix = projectRootCandidate({ root: `${REPO_ROOT.replace(/\\/g, '/')}/${APPS[0].dir}/..`, env: {} });
  check('un chemin à séparateurs POSIX est normalisé vers la racine',
    posix.root === path.resolve(REPO_ROOT), posix.root);
  const natif = projectRootCandidate({ root: path.join(REPO_ROOT, APPS[0].dir, '..'), env: {} });
  check('séparateurs natifs et POSIX donnent la MÊME racine', natif.root === posix.root);

  // Sous Windows, la lettre de lecteur doit survivre à la normalisation.
  if (process.platform === 'win32') {
    check('la lettre de lecteur est préservée',
      /^[A-Za-z]:\\/.test(posix.root), posix.root);
  }

  // Une inspection menée via un chemin à séparateurs POSIX trouve les mêmes
  // applications : la normalisation ne se contente pas d'être jolie.
  const inspPosix = await inspectProjectRoot({ root: REPO_ROOT.replace(/\\/g, '/') });
  check('l’inspection via un chemin POSIX trouve les sources', inspPosix.ok === true);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} racine d’artefact : ${pass} succès, ${fail} échec(s)`);
process.exit(fail === 0 ? 0 : 1);
