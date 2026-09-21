/**
 * ══ LA PORTÉE DU SURVEILLANT DE DÉVELOPPEMENT — ÉPROUVÉE EN VRAI ═══════════
 *
 * ── LE DÉFAUT PRODUIT QUE CETTE SUITE VERROUILLE ───────────────────────────
 *
 * `node --watch` surveille l'entrypoint ET tout module importé. Le backend en
 * charge ~1400, dont ~900 dans `node_modules` : le serveur de développement
 * dépendait donc de notifications émises par des dépendances tierces.
 *
 * Trois incidents mesurés, tous de la même forme — un événement `fs.watch` sans
 * aucun changement de contenu, mtime, ctime, taille ni inode :
 *
 *     ssh2/lib/index.js              → restart
 *     iconv-lite/encodings/index.js  → restart (hash identique sur 6 relevés)
 *
 * Le second est survenu APRÈS le retrait du balayage forensique : ce n'était
 * donc pas l'instrumentation, c'était la PORTÉE.
 *
 * ── CE QUI EST ÉPROUVÉ ICI ─────────────────────────────────────────────────
 *
 * Le VRAI lanceur, lancé pour de bon, avec de vrais paquets `ssh2` et
 * `iconv-lite` dans un `node_modules` de bac à sable. On touche, on regarde si
 * ça relance. Aucune lecture de code ne pourrait tenir cette promesse.
 *
 * Runner autonome : aucun réseau, aucune base, aucun VPS.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SRC_REEL = path.resolve(ICI, '..');
const BACKEND = path.resolve(SRC_REEL, '..');

let pass = 0;
let fail = 0;
const check = (nom, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (t) => console.log(`\n${t}`);
const dormir = (ms) => new Promise((r) => { setTimeout(r, ms); });

/* ── LE BAC À SABLE, calqué sur le backend réel ─────────────────────────── */
const BAC = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-'));
const BACK = path.join(BAC, 'backend');
const SRC = path.join(BACK, 'src');
const NM = path.join(BACK, 'node_modules');
const ecrire = (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };

ecrire(path.join(BACK, 'package.json'), JSON.stringify({ name: 'b', type: 'module' }));
ecrire(path.join(BACK, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3 }));
ecrire(path.join(BACK, 'logs', 'trace.jsonl'), '{}\n');
ecrire(path.join(BACK, 'uploads', 'photo.txt'), 'x\n');
/* Les deux coupables historiques, sous leurs vrais noms. */
ecrire(path.join(NM, 'iconv-lite', 'package.json'), JSON.stringify({ name: 'iconv-lite', main: 'encodings/index.js' }));
ecrire(path.join(NM, 'iconv-lite', 'encodings', 'index.js'), 'module.exports = 1;\n');
ecrire(path.join(NM, 'ssh2', 'package.json'), JSON.stringify({ name: 'ssh2', main: 'lib/index.js' }));
ecrire(path.join(NM, 'ssh2', 'lib', 'index.js'), 'module.exports = { Client: class {} };\n');
ecrire(path.join(SRC, 'services', 'foo.service.js'), 'export const foo = 1;\n');
ecrire(path.join(SRC, 'controllers', 'bar.controller.js'), 'export const bar = 1;\n');
ecrire(path.join(SRC, 'server.js'), `
import { createRequire } from 'node:module';
import { foo } from './services/foo.service.js';
import { bar } from './controllers/bar.controller.js';
const r = createRequire(import.meta.url);
r('iconv-lite'); r('ssh2');
console.log('BOOT pid=' + process.pid, foo + bar);
setInterval(() => {}, 1 << 30);
`);

/* Le VRAI lanceur et ses helpers, copiés tels quels. */
fs.mkdirSync(path.join(BACK, 'scripts', 'forensics'), { recursive: true });
fs.copyFileSync(path.join(BACKEND, 'scripts/dev-watch.js'), path.join(BACK, 'scripts/dev-watch.js'));
for (const f of ['watchAuthority.js', 'fs-events.ps1', 'process-trace.ps1']) {
  fs.copyFileSync(path.join(BACKEND, 'scripts/forensics', f), path.join(BACK, 'scripts/forensics', f));
}

const lanceur = spawn(process.execPath, ['scripts/dev-watch.js'], {
  cwd: BACK, env: { ...process.env, ENV: 'TEST' }, stdio: ['ignore', 'pipe', 'pipe'],
});
const sortie = [];
for (const f of [lanceur.stdout, lanceur.stderr]) {
  f.on('data', (b) => { for (const l of String(b).split('\n').filter(Boolean)) sortie.push(l.trim()); });
}
const nbRestart = () => sortie.filter((l) => /Restarting/i.test(l)).length;
const nbBoot = () => sortie.filter((l) => /^BOOT/.test(l)).length;

await dormir(7000); // le lanceur + ses helpers PowerShell + le premier boot

check('le backend de bac à sable démarre sous le lanceur', nbBoot() >= 1);

/**
 * `touche` — ON ÉCRIT SANS CHANGER LE CONTENU.
 *
 * C'est la forme exacte des incidents : `fs.watch` signale, et pourtant hash,
 * mtime, ctime, taille et inode sont identiques. On la reproduit en réécrivant
 * les mêmes octets puis en restaurant les horodatages.
 */
function toucher(p) {
  const st = fs.statSync(p);
  const contenu = fs.readFileSync(p);
  fs.writeFileSync(p, contenu);
  fs.utimesSync(p, st.atime, st.mtime);
}

async function essai(nom, action, attenduRestart) {
  const avant = nbRestart();
  action();
  await dormir(2200);
  const observe = nbRestart() > avant;
  check(`${nom} → ${attenduRestart ? 'RESTART' : 'aucun restart'}`, observe === attenduRestart);
  await dormir(900);
  return observe;
}

/* ══════════════════════════════════════════════════════════════════════════
   1. CE QUI NE DOIT PLUS RELANCER (§5) — les coupables historiques.
   ══════════════════════════════════════════════════════════════════════════ */
section('1 · node_modules ne relance plus rien');
await essai('iconv-lite/encodings/index.js touché',
  () => toucher(path.join(NM, 'iconv-lite', 'encodings', 'index.js')), false);
await essai('iconv-lite/encodings/index.js MODIFIÉ',
  () => fs.appendFileSync(path.join(NM, 'iconv-lite', 'encodings', 'index.js'), '\n// x\n'), false);
await essai('ssh2/lib/index.js touché',
  () => toucher(path.join(NM, 'ssh2', 'lib', 'index.js')), false);
await essai('ssh2/lib/index.js MODIFIÉ',
  () => fs.appendFileSync(path.join(NM, 'ssh2', 'lib', 'index.js'), '\n// x\n'), false);
await essai('logs/trace.jsonl',
  () => fs.appendFileSync(path.join(BACK, 'logs', 'trace.jsonl'), '{}\n'), false);
await essai('uploads/photo.txt',
  () => fs.appendFileSync(path.join(BACK, 'uploads', 'photo.txt'), 'y\n'), false);
await essai('package-lock.json',
  () => fs.writeFileSync(path.join(BACK, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, n: Date.now() })),
  false);

/* ══════════════════════════════════════════════════════════════════════════
   2. CE QUI DOIT TOUJOURS RELANCER (§4) — notre code.
   ══════════════════════════════════════════════════════════════════════════ */
section('2 · backend/src relance toujours');
await essai('src/services/foo.service.js modifié',
  () => fs.appendFileSync(path.join(SRC, 'services', 'foo.service.js'), '\n// x\n'), true);
await essai('src/controllers/bar.controller.js modifié',
  () => fs.appendFileSync(path.join(SRC, 'controllers', 'bar.controller.js'), '\n// x\n'), true);
await essai('src/server.js (entrypoint) modifié',
  () => fs.appendFileSync(path.join(SRC, 'server.js'), '\n// x\n'), true);
/**
 * GAGNÉ AU PASSAGE : `--watch` IGNORAIT les fichiers nouvellement créés (mesuré).
 * `--watch-path` les prend, ce qui correspond mieux au travail réel — on écrit
 * un fichier, il compte.
 */
await essai('NOUVEAU fichier sous src',
  () => fs.writeFileSync(path.join(SRC, 'services', 'nouveau.service.js'), 'export const n = 1;\n'), true);

/* ══════════════════════════════════════════════════════════════════════════
   2 bis. UNE RECETTE N'EST PAS DU RUNTIME (incident du 18/08).
   ══════════════════════════════════════════════════════════════════════════ */
section('2 bis · éditer une recette ne relance PAS l’API');
{
  /**
   * ══ CE QUE CE CONTRÔLE DÉFEND ═══════════════════════════════════════════
   *
   * Pendant un déploiement réel, l'édition de
   * `backend/src/scripts/engine-governance.test.js` a relancé l'API — et le
   * process qui exécutait le déploiement est mort avec elle.
   *
   * `src/scripts/` ne fait PAS partie du graphe de modules du serveur : ce sont
   * des recettes et des utilitaires en ligne de commande. `node --watch` ne les
   * aurait jamais surveillés ; `--watch-path=./src`, qui suit un CHEMIN et non
   * le graphe, les avait embarqués au passage.
   *
   * On ne masque rien : l'écrivain était une session de développement éditant
   * des sources — comportement normal. Ce qui ne l'est pas, c'est qu'éditer un
   * test tue un déploiement en cours.
   */
  const dossierScripts = path.join(SRC, 'scripts');
  fs.mkdirSync(dossierScripts, { recursive: true });
  const recette = path.join(dossierScripts, 'exemple.test.js');
  fs.writeFileSync(recette, '// recette\n');
  await dormir(2200);

  await essai('src/scripts/exemple.test.js modifié → AUCUN redémarrage',
    () => fs.appendFileSync(recette, '\n// modification de recette\n'), false);

  /*
   * Et le contrôle qui empêche de « réussir » en cassant tout : le runtime,
   * lui, doit toujours relancer. Sans lui, une portée vide passerait ce test.
   */
  /*
   * Le dossier doit EXISTER au lancement : Node fige la liste des chemins
   * surveillés au démarrage. `services` est là depuis le début du bac à sable —
   * en créer un nouveau ici prouverait seulement qu'un dossier apparu après
   * coup n'est pas suivi, ce qui est une autre question.
   */
  await essai('…tandis que le runtime reste bien surveillé',
    () => fs.appendFileSync(path.join(SRC, 'services', 'foo.service.js'), '\n// x\n'), true);
}

/* ══════════════════════════════════════════════════════════════════════════
   3. LA RECETTE DE L'INCIDENT (§7 · §8) — une écriture node_modules
      PENDANT une opération longue ne l'interrompt pas.
   ══════════════════════════════════════════════════════════════════════════ */
section('3 · Une écriture node_modules pendant une opération longue ne coupe rien');
{
  const bootsAvant = nbBoot();
  const restartsAvant = nbRestart();

  /**
   * On simule la fenêtre CONNECTION_SERVER : pendant deux secondes — la durée
   * d'une sonde SSH — on martèle les deux dépendances qui provoquaient
   * l'incident. Sous `--watch`, chacune aurait tué le process en vol, et le
   * Manager aurait affiché « ECONNRESET / serveur injoignable » sur une
   * connexion qui n'avait pourtant rien à se reprocher.
   */
  const t0 = Date.now();
  while (Date.now() - t0 < 2000) {
    toucher(path.join(NM, 'ssh2', 'lib', 'index.js'));
    toucher(path.join(NM, 'iconv-lite', 'encodings', 'index.js'));
    fs.appendFileSync(path.join(NM, 'iconv-lite', 'encodings', 'index.js'), '');
    await dormir(120);
  }
  await dormir(2200);

  check('aucun redémarrage pendant toute la fenêtre', nbRestart() === restartsAvant);
  check('…le process n’a jamais été remplacé', nbBoot() === bootsAvant);
  check('…donc aucune requête en vol n’aurait été coupée', nbRestart() === restartsAvant);
}

/* ══════════════════════════════════════════════════════════════════════════
   4. LE JOURNAL DIT LA VÉRITÉ SUR CE QU'IL SURVEILLE (§9).
   ══════════════════════════════════════════════════════════════════════════ */
section('4 · Le forensic n’annonce plus une portée qu’il n’a pas');
{
  const journal = path.join(BACK, 'logs', 'deployment-forensics', 'watch-parent.jsonl');
  const lignes = fs.existsSync(journal)
    ? fs.readFileSync(journal, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    : [];

  const demarrage = lignes.find((l) => l.event === 'LAUNCHER_START');
  check('la commande enfant est `--watch-path=./src`',
    /--watch-path=\.\/src/.test(demarrage?.commande ?? ''));
  check('…et n’ajoute plus `--watch` (la portée implique le mode)',
    !/(^|\s)--watch(\s|$)/.test(demarrage?.commande ?? ''));

  const portee = lignes.find((l) => l.event === 'WATCH_SCOPE');
  check('la portée est journalisée', portee?.mode === '--watch-path');
  check('…avec sa conséquence nommée',
    /node_modules ne peut plus relancer/.test(portee?.consequence ?? ''));

  const verdicts = lignes.filter((l) => l.event === 'WATCH_RESTART');
  check('des redémarrages ont bien été attribués', verdicts.length >= 3);
  /**
   * LE CONTRÔLE QUI EMPÊCHE LE RAPPORT DE MENTIR.
   *
   * Node continue d'ANNONCER chaque module chargé, `node_modules` compris. Si
   * l'autorité les comptait comme surveillés, elle finirait par désigner l'un
   * d'eux comme déclencheur d'un redémarrage qu'il ne pouvait pas causer.
   */
  const dernier = verdicts.at(-1);
  check('le verdict distingue « chargé » et « surveillé »',
    typeof dernier?.loadedFiles === 'number' && typeof dernier?.watchedFiles === 'number');
  /**
   * MESURE : sous `--watch-path`, Node cesse aussi d'ANNONCER ses dépendances —
   * `loadedFiles` et `watchedFiles` peuvent donc coïncider, et c'est le cas le
   * plus sain qui soit. L'invariant à tenir n'est pas « strictement plus
   * petit », c'est « jamais plus grand, et jamais un node_modules ».
   */
  console.log(`      (loadedFiles=${dernier.loadedFiles} watchedFiles=${dernier.watchedFiles})`);
  check('…et surveillé n’excède JAMAIS chargé',
    dernier.watchedFiles <= dernier.loadedFiles);
  /**
   * L'ATTRIBUTION NE DOIT PAS S'ÊTRE ÉTEINTE AVEC LE CANAL IPC.
   *
   * MESURE : sous `--watch-path`, Node cesse d'annoncer ses modules. Si
   * l'autorité s'en tenait là, son ensemble serait vide, chaque événement
   * serait « hors graphe » et tout verdict retomberait à `confidence=NONE`.
   * La portée sert donc de graphe — et l'on vérifie que ça marche.
   */
  check('l’ensemble surveillé n’est PAS vide (la portée sert de graphe)',
    dernier.watchedFiles > 0);
  const nomme = verdicts.filter((v) => v.likelyTrigger);
  check('…et les redémarrages de `src` sont bel et bien attribués',
    nomme.length >= 1 && nomme.every((v) => String(v.likelyTrigger).includes('src/')));
  check('…avec une confiance exploitable',
    nomme.every((v) => ['HIGH', 'MEDIUM'].includes(v.confidence)));
  check('…la portée est nommée dans le verdict',
    Array.isArray(dernier?.watchScope) && dernier.watchScope.join().includes('src'));
  check('AUCUN verdict ne désigne un fichier de node_modules',
    verdicts.every((v) => !String(v.likelyTrigger ?? '').includes('node_modules')));
}

lanceur.kill();
await dormir(1200);
fs.rmSync(BAC, { recursive: true, force: true });

/* ══════════════════════════════════════════════════════════════════════════
   5. LE CONTRAT — PROD intacte, moteur intact.
   ══════════════════════════════════════════════════════════════════════════ */
section('5 · Aucun effet hors du serveur de développement');
{
  const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND, 'package.json'), 'utf8'));
  check('`npm start` (PROD) est inchangé', pkg.scripts.start === 'node src/server.js');
  check('`npm run dev` passe par le lanceur', pkg.scripts.dev === 'node scripts/dev-watch.js');

  const lanceurSrc = fs.readFileSync(path.join(BACKEND, 'scripts/dev-watch.js'), 'utf8');
  const code = lanceurSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('le lanceur refuse toujours de tourner en PROD', /ENV.*PROD/.test(code));
  /**
   * NODE RESTE L'AUTORITÉ DU REDÉMARRAGE (§2). Le lanceur observe et relaie ;
   * il ne décide jamais de relancer. Un watcher maison ici recréerait, en pire,
   * le problème qu'on vient de fermer.
   */
  check('le lanceur ne crée AUCUN watcher métier',
    !/chokidar|watchFile|nodemon/.test(code));
  check('…et sa portée est bornée par plateforme',
    /win32.*darwin|darwin.*win32/s.test(code));
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
