/**
 * CONNEXION SSH — elle se règle TOUJOURS, et l'étape se termine TOUJOURS.
 *
 * ── LE DÉFAUT QU'IL VERROUILLE ──────────────────────────────────────────────
 * `SshTransport._connect` n'écoutait que `ready` et `error`. Une tentative peut
 * pourtant mourir sans jamais émettre `error` : le serveur ferme avant la
 * poignée de main (`close`), le pair coupe (`end`), ou ssh2 abandonne sur son
 * propre délai (`timeout`). La promesse restait alors pendante POUR TOUJOURS :
 * le préflight attendait sa première commande, l'étape « Connexion sécurisée au
 * serveur » n'aboutissait jamais, et le flux NDJSON ne se fermait pas — ni
 * succès, ni erreur, ni rapport, rien à relancer.
 *
 * Ces contrôles éprouvent CHAQUE chemin de sortie, y compris le silence.
 */
import { EventEmitter } from 'node:events';
import net from 'node:net';

let pass = 0;
let fail = 0;
const check = (nom, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${nom}`); } else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (titre) => console.log(`\n${titre}`);

const { SshTransport } = await import('../deployment-engine/transport/SshTransport.js');

/**
 * Client ssh2 simulé — il ne fait QUE ce qu'on lui dit, y compris rien.
 * `connect()` déclenche le scénario au tour de boucle suivant.
 */
function clientFactice(scenario) {
  const c = new EventEmitter();
  c.fini = false;
  c.detruit = false;
  c.end = () => { c.fini = true; };
  c.destroy = () => { c.detruit = true; };
  c.connect = () => { setImmediate(() => scenario(c)); };
  return c;
}

const transport = (scenario, opts = {}) => new SshTransport({
  host: '203.0.113.10', username: 'root', password: 'secret',
  connectTimeoutMs: 150,
  clientFactory: () => clientFactice(scenario),
  ...opts,
});

/** Règle-t-elle dans un délai raisonnable ? On ne teste pas l'infini, on le borne. */
async function issue(promesse, limite = 2_000) {
  let minuteur;
  const garde = new Promise((_, rej) => {
    minuteur = setTimeout(() => rej(new Error('PENDANTE')), limite);
  });
  try {
    await Promise.race([promesse, garde]);
    return { type: 'ok' };
  } catch (err) {
    return err.message === 'PENDANTE' ? { type: 'pendante' } : { type: 'erreur', message: err.message };
  } finally {
    clearTimeout(minuteur);
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
section('1. Le silence — le cas qui figeait tout');
{
  // Le serveur accepte, puis plus rien. Aucun évènement, jamais.
  const t = transport(() => {});
  const debut = Date.now();
  const r = await issue(t.exec('id -un'));
  check('la tentative se règle (elle ne reste pas pendante)', r.type !== 'pendante');
  check('…en erreur, pas en faux succès', r.type === 'erreur');
  check('…et le message nomme le délai', /délai de connexion ssh dépassé/i.test(r.message || ''));
  check('…dans le plafond annoncé', Date.now() - debut < 1_000);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('2. Tous les autres chemins de sortie');
{
  const cas = [
    ['fermeture avant la poignée de main (close)', (c) => c.emit('close'), /fermée avant la fin de la négociation/i],
    ['coupure par le serveur (end)', (c) => c.emit('end'), /interrompue par le serveur/i],
    ['délai propre à ssh2 (timeout)', (c) => c.emit('timeout'), /délai de connexion ssh dépassé/i],
    ['erreur explicite (error)', (c) => c.emit('error', new Error('All configured authentication methods failed')), /authentication methods failed/i],
    ['refus réseau (ECONNREFUSED)', (c) => { const e = new Error('connect ECONNREFUSED'); e.code = 'ECONNREFUSED'; c.emit('error', e); }, /econnrefused/i],
  ];
  for (const [nom, scenario, motif] of cas) {
    const r = await issue(transport(scenario).exec('id -un'));
    check(`${nom} → issue rendue`, r.type === 'erreur');
    check(`${nom} → message fidèle`, motif.test(r.message || ''));
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
section('3. Une seule issue, et la socket est rendue');
{
  // `close` juste après `error` : la promesse est déjà réglée, rien ne doit
  // se produire une seconde fois.
  let client = null;
  const t = new SshTransport({
    host: 'h', username: 'u', password: 'p', connectTimeoutMs: 500,
    clientFactory: () => {
      client = clientFactice((c) => {
        c.emit('error', new Error('boom'));
        c.emit('close');
        c.emit('end');
      });
      return client;
    },
  });
  const r = await issue(t.exec('id -un'));
  check('une erreur, pas deux', r.type === 'erreur' && /boom/.test(r.message));
  check('le client est refermé après un échec', client.fini === true);
  check('…et détruit, pour rendre la socket', client.detruit === true);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('4. Succès — et une coupure ultérieure ne tue pas le backend');
{
  const t = new SshTransport({
    host: 'h', username: 'u', password: 'p', connectTimeoutMs: 500,
    clientFactory: () => {
      const c = clientFactice((x) => x.emit('ready'));
      c.exec = (cmd, cb) => {
        const flux = new EventEmitter();
        flux.stderr = new EventEmitter();
        flux.close = () => {};
        cb(null, flux);
        setImmediate(() => { flux.emit('data', Buffer.from('root\n')); flux.emit('close', 0); });
      };
      return c;
    },
  });
  const res = await t.exec('id -un');
  check('la commande passe', res.code === 0 && res.stdout.trim() === 'root');

  // Après connexion, une erreur ssh2 sans écouteur ferait tomber le processus.
  let creve = false;
  try { t._client.emit('error', new Error('coupure tardive')); } catch { creve = true; }
  check('une coupure APRÈS connexion ne lève pas d’exception non gérée', creve === false);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('5. Sur une VRAIE socket muette (sans ssh2 simulé)');
{
  // Un serveur TCP qui accepte et ne dit jamais rien : exactement ce que fait
  // un pare-feu qui laisse passer le SYN puis avale le reste.
  const sockets = new Set();
  const serveur = net.createServer((s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  const { port } = serveur.address();

  const t = new SshTransport({
    host: '127.0.0.1', port, username: 'root', password: 'x',
    readyTimeout: 400, connectTimeoutMs: 1_200,
  });
  const debut = Date.now();
  const r = await issue(t.exec('id -un'), 5_000);
  check('la connexion muette rend la main', r.type === 'erreur');
  check('…sans attendre indéfiniment', Date.now() - debut < 3_000);
  await t.close();
  // Le serveur muet garde la socket ouverte : on la coupe, sinon `close()`
  // attendrait une fin qui ne vient jamais — le défaut même qu'on teste.
  for (const s of sockets) s.destroy();
  await new Promise((r2) => serveur.close(r2));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('6. INVARIANT — aucune étape ne reste « en cours »');
{
  const { DeploymentEngine } = await import('../deployment-engine/DeploymentEngine.js');

  /** Transport qui échoue à la connexion, comme un VPS injoignable. */
  const txKo = {
    kind: 'ssh',
    exec: async () => { throw new Error('connect ECONNREFUSED 203.0.113.10:22'); },
    writeFile: async () => {}, readFile: async () => '', uploadDir: async () => ({ files: 0, bytes: 0 }),
    close: async () => {},
  };

  const evenements = [];
  const engine = new DeploymentEngine({ transportFactory: () => txKo, wildcardBases: [] });
  const resultat = await engine.deployWithReport({
    url: 'https://demo.example.com',
    transport: txKo,
    onEvent: (e) => evenements.push(e),
    options: { preflightOnly: true, operationType: 'PRECHECK', targetName: 'demo', env: 'PROD' },
  });

  // Chaque étape ouverte doit avoir reçu exactement une issue.
  const ouvertes = new Set();
  const issues = new Map();
  for (const e of evenements) {
    if (e.type === 'step.started') ouvertes.add(e.stepId);
    if (['step.succeeded', 'step.failed', 'step.warning', 'step.skipped'].includes(e.type)) {
      ouvertes.delete(e.stepId);
      issues.set(e.stepId, (issues.get(e.stepId) || 0) + 1);
    }
  }
  check('aucune étape laissée « en cours » à la fin du flux', ouvertes.size === 0);
  check('…et aucune terminée deux fois', [...issues.values()].every((n) => n === 1));

  const demarrees = evenements.filter((e) => e.type === 'step.started').map((e) => e.stepId);
  check('« Connexion sécurisée au serveur » est ANNONCÉE', demarrees.includes('ssh.connect'));
  check('…et terminée en erreur', evenements.some((e) => e.type === 'step.failed' && e.stepId === 'ssh.connect'));
  check('l’étape fautive est nommée dans le résultat', resultat.finalStepId === 'ssh.connect');
  check('le run se termine (pas de flux ouvert)', resultat.ok === false && resultat.status === 'error');
  check('un rapport existe malgré l’échec', Boolean(resultat.structuredReport));

  // La cause réelle est lisible, pas un « hors ligne » inventé.
  const echec = evenements.find((e) => e.type === 'step.failed' && e.stepId === 'ssh.connect');
  check('le message reste celui du serveur', /connexion au serveur impossible/i.test(echec.publicMessage || ''));
  check('…et le détail technique porte la cause', /econnrefused/i.test(echec.technicalMessage || ''));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('7. Deuxième tentative après échec');
{
  const { DeploymentEngine } = await import('../deployment-engine/DeploymentEngine.js');
  let essai = 0;
  const tx = {
    kind: 'ssh',
    exec: async (cmd) => {
      if (essai === 1) throw new Error('connect ETIMEDOUT');
      // Réponses minimales pour que le préflight aille au bout.
      if (cmd.includes('command -v')) return { code: 0, stdout: 'OK\n', stderr: '' };
      if (cmd.includes('id -un')) return { code: 0, stdout: 'root\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    },
    writeFile: async () => {}, readFile: async () => '', uploadDir: async () => ({ files: 0, bytes: 0 }),
    close: async () => {},
  };
  const lancer = async () => {
    const evts = [];
    const engine = new DeploymentEngine({ transportFactory: () => tx, wildcardBases: [] });
    const r = await engine.deployWithReport({
      url: 'https://demo.example.com', transport: tx, onEvent: (e) => evts.push(e),
      options: { preflightOnly: true, operationType: 'PRECHECK', targetName: 'demo', env: 'PROD' },
    });
    return { r, evts };
  };

  essai = 1;
  const un = await lancer();
  check('1ʳᵉ tentative : échec explicite sur la connexion', un.r.finalStepId === 'ssh.connect');
  check('…flux terminé', un.evts.some((e) => e.type === 'deployment.failed'));

  essai = 2;
  const deux = await lancer();
  const sshOk = deux.evts.find((e) => e.type === 'step.succeeded' && e.stepId === 'ssh.connect');
  check('2ᵉ tentative : la connexion réussit', Boolean(sshOk));
  check('…rien ne reste bloqué de la tentative précédente',
    !deux.evts.some((e) => e.type === 'step.failed' && e.stepId === 'ssh.connect'));
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
