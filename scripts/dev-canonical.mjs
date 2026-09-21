#!/usr/bin/env node
/**
 * Démarrage DEV unique et SANS AMBIGUÏTÉ depuis le worktree canonique.
 *
 * Objectif : ne plus jamais douter de « quelle version tourne sur localhost ».
 * Le script :
 *   1. imprime racine / branche / commit / dirty / ENV / ports ;
 *   2. AVERTIT si la branche n'est pas la canonique ;
 *   3. DÉTECTE d'anciens serveurs concurrents (6060/6061 = ex-feat/brevo) ;
 *   4. RECYCLE les ports canoniques : tout processus qui écoute encore sur
 *      6100/6101/6102 est un reliquat d'une session dev précédente (ports
 *      réservés au projet) — il est terminé automatiquement, en l'affichant.
 *      « npm run dev » ne doit JAMAIS échouer pour un port occupé ;
 *   5. lance backend 6100 + manager 6101 + vitrine 6102 ;
 *   6. vérifie après démarrage : 6100/health=200, 6100/api/version=commit, 6101=200.
 *
 *   node scripts/dev-canonical.mjs
 *
 * Régime canonique : backend 6100 · manager 6101 · vitrine 6102.
 * Le Manager 6101 parle au backend 6100 en MÊME ORIGINE (proxy Vite) — pas de
 * VITE_API_URL, pas de CORS (cf. manager/vite.config.ts).
 */
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * LE RECYCLAGE DE PORT VIT DANS LE BACKEND, ET PLUS ICI.
 *
 * Ce script en portait sa propre copie — quatre fonctions locales, dont un
 * `portInUse` qui n'interrogeait que `127.0.0.1`. Un serveur Vite orphelin
 * écoutant sur `[::1]` SEULEMENT était donc invisible : le port était déclaré
 * libre, le nouveau serveur se posait à côté, et comme `localhost` se résout
 * en `::1` d'abord sous Windows, le navigateur atteignait l'ORPHELIN. On
 * lançait le dev d'IRK et l'on obtenait le site du projet précédent.
 *
 * La logique vit maintenant dans `backend/src/utils/portRecycling.js`, que
 * `server.js` utilise aussi : une seule implémentation, un seul correctif.
 * Le module ne dépend que de `node:net` et `node:child_process`.
 */
import { portInUse, pidsListeningOn, recyclePort } from '../backend/src/utils/portRecycling.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
/**
 * LA BRANCHE CANONIQUE EST CELLE QUE LE DÉPÔT SUIT — pas un nom figé.
 *
 * ══ CE QUE LE NOM EN DUR PRODUISAIT ═════════════════════════════════════════
 *
 * Il valait « feat/unified-production-baseline », une branche qui n'existe plus
 * dans ce dépôt : il n'y a que `main`, et c'est elle la canonique. Chaque
 * `npm run dev` s'ouvrait donc sur un avertissement alarmant —
 * « ⚠ NON canonique · Tu risques de lancer une version non convergée » —
 * parfaitement faux, et affiché si souvent qu'il ne voulait plus rien dire.
 *
 * Un avertissement qu'on apprend à ignorer est pire que pas d'avertissement :
 * le jour où la branche est réellement mauvaise, il se noie dans le bruit.
 *
 * On lit donc la branche suivie (`@{u}` → `origin/main` → `main`). Le
 * message ne réapparaît que si l'on travaille vraiment à côté — et il redevient
 * juste si la branche par défaut est un jour renommée.
 */
const CANONICAL_BRANCH = (
  (() => {
    try {
      return execSync('git rev-parse --abbrev-ref --symbolic-full-name @{u}', {
        cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim().replace(/^[^/]+\//, '');
    } catch { return ''; }
  })()
) || 'main';

const BACKEND_PORT = Number(process.env.BACKEND_PORT || 6100);
const MANAGER_PORT = Number(process.env.MANAGER_PORT || 6101);
const VITRINE_PORT = Number(process.env.VITRINE_PORT || 6102);
const LEGACY_PORTS = [6060, 6061]; // ex-worktree feat/brevo — source de confusion

function git(args) {
  try { return execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf8' }).trim(); }
  catch { return null; }
}

async function httpJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    const body = await res.json().catch(() => null);
    return { code: res.status, body };
  } catch { return { code: 0, body: null }; }
}

const branch = git('rev-parse --abbrev-ref HEAD') || '(inconnue)';
const commit = git('rev-parse --short HEAD') || '(inconnu)';
const isDirty = Boolean(git('status --porcelain'));
const env = process.env.APP_ENV || process.env.NODE_ENV || 'TEST';

const line = '─'.repeat(66);
console.log(`\n${line}`);
console.log('  BeautySavage — démarrage DEV canonique');
console.log(line);
console.log(`  Racine projet : ${ROOT}`);
console.log(`  Branche       : ${branch}${branch === CANONICAL_BRANCH ? '  ✓' : '  ⚠ NON canonique'}`);
console.log(`  Commit        : ${commit}${isDirty ? '  ⚠ DIRTY' : '  ✓ propre'}`);
console.log(`  ENV           : ${env}`);
console.log(`  Ports         : backend ${BACKEND_PORT} · manager ${MANAGER_PORT} · vitrine ${VITRINE_PORT}`);
console.log(`${line}\n`);

if (branch !== CANONICAL_BRANCH) {
  console.log(`  ⚠ La branche courante n'est pas « ${CANONICAL_BRANCH} ».`);
  console.log('    Tu risques de lancer une version non convergée. Vérifie ton worktree.\n');
}

// 3. Anciens serveurs concurrents (6060/6061 ex-feat/brevo).
for (const p of LEGACY_PORTS) {
  if (await portInUse(p)) {
    console.log(`  ⚠ Un serveur écoute encore sur ${p} (ancien couple feat/brevo).`);
    console.log('    Il peut créer une confusion de version. Arrête-le puis relance si besoin.');
  }
}

// 4. RECYCLAGE automatique des ports canoniques : ces ports appartiennent au
//    projet — tout processus qui y écoute encore est un reliquat d'une session
//    dev précédente (backend --watch orphelin, vite pas terminé…). On le
//    termine proprement et on démarre. Jamais de refus pour « port occupé ».



const NOM_DE_PORT = {
  [BACKEND_PORT]: 'BACKEND_PORT',
  [MANAGER_PORT]: 'MANAGER_PORT',
  [VITRINE_PORT]: 'VITRINE_PORT',
};

for (const p of [BACKEND_PORT, MANAGER_PORT, VITRINE_PORT]) {
  const issue = await recyclePort(p, { log: (m) => console.log(m) });
  if (issue.freed) continue;
  console.error(`
  ✗ Port ${p} toujours occupé après recyclage (${issue.reason}).`);
  console.error(`    Identifie-le : netstat -ano | findstr :${p} — puis termine-le, ou change ${NOM_DE_PORT[p]}.
`);
  process.exit(1);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];

function run(name, cwd, args, extraEnv) {
  const child = spawn(npm, args, {
    cwd: path.join(ROOT, cwd),
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  child.on('exit', (code) => {
    console.log(`\n[${name}] terminé (code ${code}). Arrêt des autres services…`);
    shutdown();
  });
  children.push(child);
}

/**
 * ══ L'ARRÊT DOIT LIBÉRER LES PORTS, PAS SEULEMENT TUER LES ENFANTS ═════════
 *
 * ── CE QUI SE PASSAIT ─────────────────────────────────────────────────────
 *
 * On tuait l'arbre de chaque enfant, puis on sortait. Mesuré : après un
 * Ctrl-C, les TROIS ports restaient tenus par des orphelins.
 *
 * Deux raisons, et elles se cumulent :
 *
 *   · sous Windows, Ctrl-C fait apparaître « Terminer le programme de
 *     commandes (O/N) ? ». Répondre O tue le `.cmd` — et ses petits-enfants
 *     (`node`, `vite`) se retrouvent rattachés à personne, port toujours
 *     ouvert ;
 *   · selon la façon dont le terminal se ferme, le signal reçu n'est pas
 *     toujours `SIGINT` : un `SIGHUP` ou un `SIGBREAK` ne déclenchait AUCUN
 *     gestionnaire, donc aucun nettoyage.
 *
 * ── CE QUI LE REMPLACE ────────────────────────────────────────────────────
 *
 * On écoute les quatre signaux, et surtout on ne se fie plus à la seule
 * généalogie : après avoir tué les enfants, on BALAIE LES PORTS et on termine
 * qui les écoute encore, quel que soit son ascendant. La sortie n'a lieu
 * qu'ensuite.
 *
 * Le balayage est synchrone à dessein — `pidsListeningOn` et `taskkill`
 * passent par `execSync`. Sur un chemin de sortie, une promesse n'est pas
 * garantie de se résoudre avant que le processus ne disparaisse.
 *
 * Le démarrage recycle DÉJÀ ces mêmes ports (plus haut) : la ceinture et les
 * bretelles. Même un terminal fermé d'un clic, qui ne laisse jouer aucun
 * gestionnaire, ne peut plus gêner la session suivante.
 */
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;

  for (const c of children) {
    try {
      // Windows : tuer l'ARBRE complet (npm.cmd → node --watch → serveur…),
      // sinon des petits-enfants survivent et squattent les ports.
      if (process.platform === 'win32') execSync(`taskkill /PID ${c.pid} /T /F`, { stdio: 'ignore' });
      else c.kill();
    } catch { /* déjà mort */ }
  }

  // BALAYAGE FINAL — ce qui écoute encore nos ports n'a plus de raison d'être.
  for (const p of [BACKEND_PORT, MANAGER_PORT, VITRINE_PORT]) {
    for (const pid of pidsListeningOn(p)) {
      if (pid === process.pid) continue;
      try {
        if (process.platform === 'win32') execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
        else execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
      } catch { /* déjà mort */ }
    }
  }

  process.exit(0);
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(signal, shutdown);
}

run('backend', 'backend', ['run', 'dev:app'], { PORT: String(BACKEND_PORT) });
run('manager', 'manager', ['run', 'dev', '--', '--port', String(MANAGER_PORT), '--host'], {});
run('vitrine', 'vitrine', ['run', 'dev', '--', '--port', String(VITRINE_PORT), '--host'], {});

// 6. Healthchecks après démarrage (poll ~40 s max).
(async () => {
  const deadline = Date.now() + 40_000;
  let health = null, version = null, manager = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    health = await httpJson(`http://localhost:${BACKEND_PORT}/health`);
    version = await httpJson(`http://localhost:${BACKEND_PORT}/api/version`);
    manager = (await httpJson(`http://localhost:${MANAGER_PORT}/`)).code || 0;
    if (health.code === 200 && version.code === 200 && manager) break;
  }
  const vCommit = version?.body?.data?.shortCommit || '—';
  const commitOk = vCommit === commit;
  // Tunnel ngrok : détection directe (API locale d'inspection, 127.0.0.1:4040).
  // Le BACKEND fait la même détection et synchronise TOUS les webhooks TEST
  // (Brevo, Stripe, Yousign) tout seul (bootstrap + veille) — ici on AFFICHE.
  // ngrok absent n'est PAS une erreur : le backend fonctionne, les webhooks ne
  // sont simplement pas synchronisés.
  let ngrokUrl = null;
  try {
    const t = await httpJson('http://127.0.0.1:4040/api/tunnels');
    const hit = (t.body?.tunnels || []).find(
      (x) => String(x.public_url || '').startsWith('https://') && String(x.config?.addr || '').endsWith(`:${BACKEND_PORT}`)
    );
    ngrokUrl = hit ? hit.public_url : null;
  } catch { ngrokUrl = null; }
  console.log(`\n${line}`);
  console.log('  Contrôles post-démarrage');
  console.log(`  backend /health          : ${health?.code === 200 ? '200 ✓' : (health?.code || 'KO') + ' ✗'}`);
  console.log(`  backend /api/version     : ${version?.code === 200 ? `${vCommit} ${commitOk ? '✓ (= source)' : `⚠ ≠ ${commit}`}` : (version?.code || 'KO') + ' ✗'}`);
  console.log(`  manager (${MANAGER_PORT})          : ${manager ? manager + ' ✓' : 'KO ✗'}`);
  console.log(line);
  console.log(`  Backend public : ${ngrokUrl ? `${ngrokUrl}  (tunnel ngrok — webhooks TEST Brevo/Stripe/Yousign synchronisés automatiquement)` : 'aucun tunnel ngrok — webhooks non synchronisés (backend fonctionnel)'}`);
  console.log(line);
  console.log(`  Backend : http://localhost:${BACKEND_PORT}`);
  console.log(`  Manager : http://localhost:${MANAGER_PORT}`);
  console.log(`  Vitrine : http://localhost:${VITRINE_PORT}`);
  console.log(`${line}\n`);
})();
