/* LE RECYCLAGE DE PORT — et surtout ce qu'il REFUSE de faire.
 *
 * ══ POURQUOI CETTE SUITE EXISTE ═════════════════════════════════════════════
 *
 * `server.js` termine désormais le processus qui tient son port, au lieu
 * d'échouer en `EADDRINUSE`. C'est un geste violent : mal borné, il coupe le
 * site d'un AUTRE client. Le registre de ports de ce projet a déjà constaté un
 * port revendiqué ici et détenu là-bas par `panel-panel.ly-solution.com` — le
 * scénario n'est pas théorique.
 *
 * Ce qui est éprouvé ici n'est donc pas « le port se libère » (c'est la partie
 * facile), c'est la liste exacte des cas où RIEN ne doit être tué :
 *
 *   · sous PM2 — un backend déployé ne recycle jamais ;
 *   · quand `DEV_PORT_RECYCLE=off` — l'échappatoire de celui qui préfère
 *     l'échec franc ;
 *   · quand le détenteur est lui-même supervisé — même lancé à la main sur le
 *     serveur, ce module ne peut pas prendre le port d'un service ;
 *   · quand le détenteur, c'est NOUS — se tuer soi-même transformerait un port
 *     occupé en processus disparu.
 *
 * ══ CE QUE LA SUITE TUE RÉELLEMENT ══════════════════════════════════════════
 *
 * Uniquement des enfants qu'elle a elle-même lancés, sur des ports éphémères
 * qu'elle a choisis. Aucun processus préexistant n'est touché, et chaque enfant
 * est ramassé en fin de course même si une assertion échoue.
 *
 * Runner autonome, sans base ni serveur applicatif.
 */
import net from 'node:net';
import { spawn } from 'node:child_process';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

process.env.ENV = 'TEST';

const {
  portInUse, pidsListeningOn, isSupervised, isRecyclable, recyclePort,
} = await import('../utils/portRecycling.js');

/** Les enfants lancés par cette suite — ramassés quoi qu'il arrive. */
const enfants = [];

/** Un port libre, obtenu du noyau : jamais un numéro choisi à la main. */
function portLibre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/**
 * Un occupant, dans un VRAI processus séparé.
 *
 * `marqueur` finit dans sa ligne de commande : c'est ce que lit la garde qui
 * épargne les services supervisés, et c'est donc ainsi qu'on l'éprouve — sans
 * simuler la détection, en la faisant travailler sur une vraie ligne.
 */
async function lancerOccupant(port, marqueur = '') {
  const code = `require('net').createServer().listen(${port},'127.0.0.1',()=>console.log('up'));`;
  const args = ['-e', code];
  if (marqueur) args.push(marqueur);
  const enfant = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'ignore'] });
  enfants.push(enfant);
  await new Promise((resolve, reject) => {
    enfant.stdout.once('data', resolve);
    enfant.once('error', reject);
    setTimeout(() => reject(new Error('occupant non démarré')), 5_000);
  });
  // Le port doit être RÉELLEMENT tenu avant qu'on ne mesure quoi que ce soit.
  const limite = Date.now() + 3_000;
  while (Date.now() < limite && !(await portInUse(port))) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return enfant;
}

try {
  /* ---------------------------------------------------------------------- */
  section('1. Les verrous, avant toute exécution');
  {
    check('un processus local n’est pas supervisé', isSupervised({}) === false);
    check('PM2 (`pm_id`) est reconnu comme supervision', isSupervised({ pm_id: '3' }) === true);
    check('PM2 (`PM2_HOME`) aussi', isSupervised({ PM2_HOME: '/root/.pm2' }) === true);

    check('en local, le recyclage est autorisé', isRecyclable({}).allowed === true);
    check('sous PM2, il est refusé', isRecyclable({ pm_id: '3' }).allowed === false);
    check('… et la raison le nomme',
      /PM2/.test(isRecyclable({ pm_id: '3' }).reason ?? ''));
    for (const v of ['off', '0', 'false', 'no', 'non', 'OFF']) {
      check(`DEV_PORT_RECYCLE=${v} coupe le recyclage`,
        isRecyclable({ DEV_PORT_RECYCLE: v }).allowed === false);
    }
    check('une valeur quelconque ne le coupe PAS',
      isRecyclable({ DEV_PORT_RECYCLE: 'on' }).allowed === true);
  }

  /* ---------------------------------------------------------------------- */
  section('2. Un port libre est « libéré » sans rien tuer');
  {
    const port = await portLibre();
    const issue = await recyclePort(port);
    check('freed = true', issue.freed === true);
    check('aucun processus terminé', issue.killed.length === 0);
    check('aucune raison à donner', issue.reason === null);
  }

  /* ---------------------------------------------------------------------- */
  section('3. Un occupant ordinaire est terminé, et le port revient');
  {
    const port = await portLibre();
    const occupant = await lancerOccupant(port);
    check('le port est bien tenu avant recyclage', await portInUse(port));
    check('le PID de l’occupant est retrouvé',
      pidsListeningOn(port).includes(occupant.pid));

    const traces = [];
    const issue = await recyclePort(port, { log: (m) => traces.push(m) });

    check('freed = true', issue.freed === true);
    check('un processus a été terminé', issue.killed.length === 1);
    check('c’est bien l’occupant', issue.killed[0]?.pid === occupant.pid);
    check('le port est réellement libre', !(await portInUse(port)));
    check('le geste a été JOURNALISÉ — on ne tue rien en silence',
      traces.some((m) => m.includes(String(occupant.pid))));
  }

  /* ---------------------------------------------------------------------- */
  section('4. Sous PM2, RIEN n’est tué — le verrou principal');
  {
    const port = await portLibre();
    const occupant = await lancerOccupant(port);

    const ancien = process.env.pm_id;
    process.env.pm_id = '7';
    const issue = await recyclePort(port);
    if (ancien === undefined) delete process.env.pm_id; else process.env.pm_id = ancien;

    check('freed = false', issue.freed === false);
    check('aucun processus terminé', issue.killed.length === 0);
    check('la raison nomme la supervision', /PM2/.test(issue.reason ?? ''));
    check('l’occupant est TOUJOURS VIVANT', await portInUse(port));

    occupant.kill();
  }

  /* ---------------------------------------------------------------------- */
  section('5. Un occupant SUPERVISÉ est épargné, même en local');
  {
    const port = await portLibre();
    // « pm2 » dans la ligne de commande : la garde lit la vraie ligne, pas un
    // drapeau qu'on lui souffle.
    const occupant = await lancerOccupant(port, 'pm2');

    const traces = [];
    const issue = await recyclePort(port, { log: (m) => traces.push(m), timeoutMs: 1_000 });

    check('freed = false', issue.freed === false);
    check('aucun processus terminé', issue.killed.length === 0);
    check('la raison dit qu’il est supervisé', /supervis/i.test(issue.reason ?? ''));
    check('le refus est journalisé', traces.some((m) => /supervis/i.test(m)));
    check('l’occupant est TOUJOURS VIVANT', await portInUse(port));

    occupant.kill();
  }

  /* ---------------------------------------------------------------------- */
  section('6. Le recyclage ne se tue jamais lui-même');
  {
    const port = await portLibre();
    const serveur = net.createServer();
    await new Promise((r) => serveur.listen(port, '127.0.0.1', r));

    check('c’est bien NOTRE processus qui tient le port',
      pidsListeningOn(port).includes(process.pid));

    const issue = await recyclePort(port, { timeoutMs: 1_000 });

    check('aucun processus terminé', issue.killed.length === 0);
    check('le processus courant est toujours là', process.pid > 0);
    check('le port n’est pas déclaré libre à tort', issue.freed === false);

    await new Promise((r) => serveur.close(r));
  }
  /* ---------------------------------------------------------------------- */
  section('5. Un occupant en IPv6 SEULEMENT est vu, et recyclé');
  {
    /*
      ══ LA RÉGRESSION QUE CE CAS INTERDIT ═══════════════════════════════════

      `portInUse` n'interrogeait que `127.0.0.1`. Un serveur de développement
      Vite laissé orphelin écoute souvent sur `[::1]` SEULEMENT : il était donc
      invisible, le port était déclaré libre, et le nouveau serveur se posait à
      côté de lui. Comme `localhost` se résout en `::1` avant `127.0.0.1` sous
      Windows, le navigateur atteignait le SURVIVANT — on lançait le dev d'un
      projet et l'on obtenait le site du projet précédent. Constaté tel quel.

      L'occupant ci-dessous n'écoute QUE sur `::1`. S'il n'est pas détecté, le
      port est annoncé libre et ces vérifications tombent.
    */
    const port = await portLibre();
    const code = `require('net').createServer().listen(${port},'::1',()=>console.log('up'));`;
    const enfant = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'ignore'] });
    enfants.push(enfant);

    let demarre = true;
    await new Promise((resolve) => {
      enfant.stdout.once('data', resolve);
      /* Une machine sans pile IPv6 ne peut pas éprouver ce cas : on le note et
         on passe, plutôt que de faire échouer une suite pour une absence. */
      enfant.once('error', () => { demarre = false; resolve(); });
      setTimeout(() => { demarre = false; resolve(); }, 5_000);
    });

    if (!demarre) {
      console.log('  ⊘ pas de pile IPv6 sur cette machine — cas non éprouvé');
    } else {
      const limite = Date.now() + 3_000;
      while (Date.now() < limite && !(await portInUse(port))) {
        await new Promise((r) => setTimeout(r, 50));
      }

      check('un occupant IPv6 seul est DÉTECTÉ', await portInUse(port));
      check('… et il est retrouvé par PID', pidsListeningOn(port).length > 0);

      const issue = await recyclePort(port, { timeoutMs: 6_000 });
      check('… il est recyclé', issue.freed === true);
      check('… et le port est réellement libre', !(await portInUse(port)));
    }
  }
} finally {
  for (const enfant of enfants) {
    try { enfant.kill('SIGKILL'); } catch { /* déjà mort — c'était le but */ }
  }
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
