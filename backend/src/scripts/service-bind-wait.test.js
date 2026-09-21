// LE PORT N'AVAIT PAS DISPARU — IL N'ÉTAIT PAS ENCORE REVENU.
//
// ══ L'INCIDENT REPRODUIT ════════════════════════════════════════════════════
//
// Déploiement SB Auto 06 TEST du 07/08 00:34, run 6a7527438c3a67223efa8eac :
// `services.start` échoue en 7 915 ms sur PM2_PROCESS_UNSTABLE, « le service
// est en ligne mais n'écoute pas sur le port 5002 ».
//
// La chronologie réelle disait pourtant l'inverse d'une panne :
//   · avant le reload, 5002 appartient au pid 223359 — le service canonique ;
//   · `pm2 reload … --update-env` rend « ✓ » ;
//   · PM2 annonce `online`, PID stable sur 1,5 s, bon pm_exec_path, bon pm_cwd,
//     aucun redémarrage supplémentaire ;
//   · et 5002 n'écoute pas.
//
// « online » chez PM2 signifie « le processus est forké », pas « il écoute ».
// Entre les deux, le backend fait son démarrage : connexion au cluster Mongo
// distant, huit étapes de migration, puis seulement `app.listen()`. Le budget
// d'attente valait 3 000 ms + 1 500 ms, et la lecture du socket était UNIQUE :
// son absence au premier regard valait échec définitif.
//
// Ces tests figent le contrat corrigé : on OBSERVE jusqu'à une échéance, on
// sort dès que la preuve est acquise, et on échoue immédiatement — sans
// attendre l'échéance — dès que le processus se dégrade.
import { strict as assert } from 'node:assert';

process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'TEST';

let ok = 0;
let ko = 0;
const check = (libelle, condition) => {
  if (condition) { ok += 1; console.log(`  ✓ ${libelle}`); } else { ko += 1; console.log(`  ✗ ${libelle}`); }
};
const section = (titre) => console.log(`\n${titre}`);

const { verifyServiceHealth } = await import('../deployment-engine/ports.js');

const CWD = '/var/www/demo-sbauto06.ly-solution.com/backend';
const EXEC = `${CWD}/src/server.js`;

const proc = (over = {}) => ({
  name: 'sbauto-demo-sbauto06.ly-solution.com',
  pid: 223360,
  pm2_env: {
    status: 'online',
    restart_time: 2,
    pm_exec_path: EXEC,
    pm_cwd: CWD,
    env: { PORT: '5002' },
    ...over.env_,
  },
  ...over,
});

const socketLine = (port, pid) => `LISTEN 0 511 *:${port} *:* users:(("node /var/www/d",pid=${pid},fd=50))`;

/**
 * Un serveur simulé dont l'état ÉVOLUE au fil des lectures — c'est tout le
 * sujet : un instantané ne distingue pas « pas encore » de « jamais ».
 */
function serveurSimule({ pm2Suite, socketsSuite }) {
  let iPm2 = 0;
  let iSock = 0;
  const suivant = (suite, i) => suite[Math.min(i, suite.length - 1)];
  return {
    lectures: () => ({ pm2: iPm2, sockets: iSock }),
    async exec(cmd) {
      if (cmd.startsWith('pm2 jlist')) {
        const v = suivant(pm2Suite, iPm2); iPm2 += 1;
        return { stdout: JSON.stringify(v), stderr: '', code: 0 };
      }
      if (cmd.startsWith('ss -ltnp')) {
        const v = suivant(socketsSuite, iSock); iSock += 1;
        return { stdout: v, stderr: '', code: 0 };
      }
      if (cmd.startsWith('pm2 logs')) {
        return {
          stdout: 'Error: connect ECONNREFUSED mongodb+srv://user:motdepasse@cluster.mongodb.net/base\n'
            + 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.charge.signature',
          stderr: '', code: 0,
        };
      }
      return { stdout: '', stderr: '', code: 0 };
    },
  };
}

const sansAttente = async () => {};
const sante = (transport, over = {}) => verifyServiceHealth(transport, {
  name: 'sbauto-demo-sbauto06.ly-solution.com',
  port: 5002,
  expectedExecPath: EXEC,
  expectedCwd: CWD,
  baselineRestarts: 2,
  settleMs: 0,
  wait: sansAttente,
  bindPollMs: 1,
  ...over,
});

const echoue = async (fn) => {
  try { await fn(); return null; } catch (e) { return e; }
};

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE SCÉNARIO RÉEL — le service lie son port après son démarrage');
{
  /**
   * Le port est vide aux premières lectures — le backend se connecte à Mongo et
   * migre — puis apparaît, possédé par NOTRE pid. C'est exactement ce que le
   * moteur déclarait en échec.
   */
  const srv = serveurSimule({
    pm2Suite: [[proc()]],
    socketsSuite: [
      // 5001 (ancienne destination) et 5100 (Panel) écoutent ; 5002 pas encore.
      `${socketLine(5001, 106932)}\n${socketLine(5100, 225509)}`,
      `${socketLine(5001, 106932)}\n${socketLine(5100, 225509)}`,
      `${socketLine(5001, 106932)}\n${socketLine(5100, 225509)}`,
      `${socketLine(5001, 106932)}\n${socketLine(5002, 223360)}\n${socketLine(5100, 225509)}`,
    ],
  });

  const r = await sante(srv);
  check('le démarrage est validé, pas déclaré instable', r.healthy === true);
  check('…le port est écouté', r.portListened === true);
  check('…et par NOTRE processus', r.portOwnedByService === true);
  check('…avec le pid réellement observé', r.pid === 223360);
  check('il a fallu plusieurs observations : une seule ne suffisait pas',
    srv.lectures().sockets >= 4);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LES TROIS ALLOCATIONS RESTENT DISTINCTES');
{
  const srv = serveurSimule({
    pm2Suite: [[
      proc(),
      { name: 'sbauto-demo-sbauto.lycarz.com', pid: 106932, pm2_env: { status: 'online', env: { PORT: '5001' } } },
      { name: 'panel-panel.ly-solution.com', pid: 225509, pm2_env: { status: 'online', env: { PORT: '5100' } } },
    ]],
    socketsSuite: [`${socketLine(5001, 106932)}\n${socketLine(5002, 223360)}\n${socketLine(5100, 225509)}`],
  });

  const r = await sante(srv);
  check('la destination canonique est validée sur 5002', r.port === 5002 && r.portOwnedByService);
  check('…sans jamais réutiliser 5001', r.pid !== 106932);
  check('…ni toucher au Panel sur 5100', r.pid !== 225509);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('A — en ligne mais AUCUN socket avant l’échéance');
{
  const srv = serveurSimule({
    pm2Suite: [[proc()]],
    socketsSuite: [socketLine(5001, 106932)],
  });
  const err = await echoue(() => sante(srv, { bindTimeoutMs: 0 }));
  check('l’échec est prononcé', err !== null);
  check('…avec le code d’instabilité', err.code === 'PM2_PROCESS_UNSTABLE');
  check('…en nommant le délai réellement attendu', /toujours pas sur le port/.test(err.message));
  check('…et l’instantané final est joint',
    err.details.pid === 223360 && Array.isArray(err.details.listening));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('B — le port appartient à un AUTRE processus : conflit, pas lenteur');
{
  const srv = serveurSimule({
    pm2Suite: [[proc()]],
    socketsSuite: [socketLine(5002, 999111)],
  });
  const err = await echoue(() => sante(srv, { bindTimeoutMs: 30_000 }));
  check('l’échec est immédiat, sans attendre l’échéance', err !== null);
  check('…et nommé comme un conflit de propriété', err.code === 'PM2_PORT_NOT_OWNED');
  check('…avec le pid réel du détenteur', err.details.socketPid === 999111);
  check('…et le nôtre, pour comparaison', err.details.pid === 223360);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('C — le processus se dégrade pendant l’attente : échec immédiat');
{
  // Il redémarre : il ne parvient pas à se lancer.
  const srv = serveurSimule({
    pm2Suite: [[proc()], [proc()], [proc({ pm2_env: { status: 'online', restart_time: 5, pm_exec_path: EXEC, pm_cwd: CWD, env: { PORT: '5002' } } })]],
    socketsSuite: [socketLine(5001, 106932)],
  });
  const err = await echoue(() => sante(srv, { bindTimeoutMs: 30_000 }));
  check('la boucle de redémarrage est détectée', err !== null);
  check('…sans attendre l’échéance', /redémarre|boucle/.test(err.message));
  check('…et les journaux du service sont joints', typeof err.details.serviceLogTail === 'string');
  check('…SANS le mot de passe de la base', !err.details.serviceLogTail.includes('motdepasse'));
  check('…ni le jeton', !err.details.serviceLogTail.includes('eyJhbGciOiJIUzI1NiJ9'));
  check('…mais avec la cause lisible', /ECONNREFUSED/.test(err.details.serviceLogTail));

  // Il passe à `errored`.
  const srv2 = serveurSimule({
    pm2Suite: [[proc()], [proc()], [proc({ pm2_env: { status: 'errored', restart_time: 2, pm_exec_path: EXEC, pm_cwd: CWD, env: { PORT: '5002' } } })]],
    socketsSuite: [socketLine(5001, 106932)],
  });
  const err2 = await echoue(() => sante(srv2, { bindTimeoutMs: 30_000 }));
  check('un passage à « errored » interrompt l’attente', /errored/.test(err2?.message ?? ''));

  // Il disparaît de PM2.
  const srv3 = serveurSimule({
    pm2Suite: [[proc()], [proc()], []],
    socketsSuite: [socketLine(5001, 106932)],
  });
  const err3 = await echoue(() => sante(srv3, { bindTimeoutMs: 30_000 }));
  check('une disparition de PM2 aussi', /disparu de PM2/.test(err3?.message ?? ''));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('E — identité structurelle divergente : le nom ne suffit pas');
{
  const srv = serveurSimule({
    pm2Suite: [[proc({ pm2_env: { status: 'online', restart_time: 2, pm_exec_path: '/var/www/ancien/src/server.js', pm_cwd: '/var/www/ancien', env: { PORT: '5002' } } })]],
    socketsSuite: [socketLine(5002, 223360)],
  });
  const err = await echoue(() => sante(srv));
  check('un process du bon NOM mais du mauvais chemin est refusé', err !== null);
  check('…au titre du chemin périmé', err.code === 'PM2_STALE_PATH');
  check('…et le chemin observé est donné', /ancien/.test(JSON.stringify(err.details)));
}

/* ══════════════════════════════════════════════════════════════════════════ */
console.log(`\n${ok} réussis, ${ko} échoués`);
assert.equal(ko, 0, `${ko} vérification(s) en échec.`);
