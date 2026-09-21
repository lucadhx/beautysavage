/**
 * ══ UNE REQUÊTE NE RÉÉCRIT JAMAIS LE CODE QUI LA SERT ═══════════════════════
 *
 * ── L'INCIDENT ────────────────────────────────────────────────────────────
 *
 * Pendant un parcours de déploiement, le backend local redémarrait, et les
 * appels en vol mouraient en `ECONNRESET` :
 *
 *     GET  /api/deployment/dns-status?hostname=…   ← ECONNRESET
 *     POST /api/deployment/vps-session              ← ECONNRESET
 *     Restarting 'src/server.js'
 *
 * Le backend de développement tourne sous `node --watch src/server.js`. Trois
 * comportements ont été MESURÉS, et ils ne se confondent pas :
 *
 *     changement d'un fichier IMPORTÉ  →  « Restarting 'src/server.js' »
 *     exception non interceptée        →  « Failed running … »
 *     process tué par un signal        →  « Failed running … »
 *
 * Le message observé désigne donc, sans ambiguïté possible, la MODIFICATION
 * D'UN FICHIER DU GRAPHE DE MODULES. D'où la question que cette recette ferme :
 * une route de déploiement peut-elle écrire dans son propre code source ?
 *
 * ── POURQUOI CETTE GARDE VAUT PLUS QU'UN CONSTAT ──────────────────────────
 *
 * Un runtime qui génère un fichier sous `src/` — un cache, une configuration
 * dérivée, un manifeste — est un défaut sérieux et silencieux : en production
 * il réécrit le déployé ; en développement il se relance lui-même au pire
 * moment, et l'incident se lit comme une panne réseau. Personne ne l'écrit
 * volontairement : cela arrive par un chemin de sortie mal choisi, une seule
 * fois, et plus rien ne le signale.
 *
 * On EXÉCUTE donc réellement les routes du parcours, et l'on compare le code
 * source avant/après — empreinte de modification comprise.
 *
 * Runner autonome : base en mémoire, aucun VPS, aucun réseau sortant.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(ICI, '..');
const BACKEND = path.resolve(ICI, '../..');

let pass = 0;
let fail = 0;
const check = (nom, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (t) => console.log(`\n${t}`);

const require = createRequire(path.join(BACKEND, 'package.json'));
const { MongoMemoryServer } = await import(pathToFileURL(require.resolve('mongodb-memory-server')).href);
const mongod = await MongoMemoryServer.create();

process.env.ENV = 'TEST';
/*
  ══ LA RECETTE FOURNIT SON PROPRE DÉVELOPPEUR ═══════════════════════════════

  Elle crée `no-mutation@dev.test` par la primitive du runtime. Or celle-ci
  applique la garde « au plus un compte par rôle structurel » : si l'amorçage a
  déjà créé un DEV — ce qu'il fait sur un poste de développement, à partir de
  `FIRST_DEV_EMAIL` —, la création est refusée, le compte reste introuvable, et
  la recette s'effondrait sur un `null` deux lignes plus bas.

  On VIDE ces variables plutôt que de les supprimer : `dotenv` ne remplace pas
  une variable déjà posée, mais il remplit celles qui manquent.
*/
process.env.FIRST_DEV_EMAIL = '';
process.env.SEED_DEV_EMAIL = '';
process.env.FIRST_ADMIN_EMAIL = '';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'no_source_mutation';
process.env.DB_PROD = 'no_source_mutation_prod';
process.env.JWT_SECRET = 'no-source-mutation-secret-0123456789abcdef0123456789';
process.env.INTEGRATED_API_ENCRYPTION_KEY = '0'.repeat(64);
process.env.NGROK_API_URL = 'http://127.0.0.1:1';
process.env.PANEL_SCHEDULER_ENABLED = 'false';

/**
 * L'INVENTAIRE PORTE L'EMPREINTE, PAS SEULEMENT LA DATE.
 *
 * Une réécriture à l'identique change la `mtime` sans changer le contenu — et
 * c'est SUFFISANT pour que le watcher relance le service. Une modification de
 * contenu à `mtime` égale, elle, serait invisible d'une comparaison de dates.
 * On retient donc les deux.
 */
function inventaire(racine) {
  const out = new Map();
  const parcourir = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { parcourir(p); continue; }
      try {
        const st = fs.statSync(p);
        out.set(path.relative(racine, p).replace(/\\/g, '/'), `${st.mtimeMs}:${st.size}`);
      } catch { /* disparu en cours de lecture */ }
    }
  };
  parcourir(racine);
  return out;
}

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();
const { bootstrap } = await import('../config/bootstrap.js');
await bootstrap();
const { createApp } = await import('../app.js');
await (await import('./helpers/serviceReady.helper.js')).markTestServiceReady();
const app = createApp();
const serveur = app.listen(0);
const base = `http://127.0.0.1:${serveur.address().port}`;

/* ── UNE VRAIE SESSION DEV, PAR LE PARCOURS D'ACTIVATION RÉEL ───────────── */
const amorcage = await import('../services/localDevBootstrap.service.js');
const { User } = await import('../models/User.model.js');
const MOT_DE_PASSE = 'Recette-NoMutation-2026!';
{
  let u = await User.findOne({ email: 'no-mutation@dev.test' });
  if (!u) {
    await amorcage.ensureInitialLocalUser({
      email: 'no-mutation@dev.test', name: 'Recette', role: 'DEV',
      controlPlane: { available: () => true, async invoke() { return { outcome: 'SUCCEEDED' }; } },
    });
    u = await User.findOne({ email: 'no-mutation@dev.test' });
  }
  /*
    UN DÉCOR QUI N'A PAS PU SE POSER DOIT LE DIRE.

    Sans cette garde, l'absence du compte se manifestait par un
    « Cannot read properties of null » à la ligne suivante — un message qui
    n'apprend rien et qui envoie chercher un défaut du déploiement là où c'est
    la création du compte qui a été refusée.
  */
  if (!u) {
    console.error(
      '  ✗ décor : le compte DEV de recette n’a pas pu être créé — un autre '
      + 'compte DEV existe déjà (garde « au plus un compte par rôle »).',
    );
    process.exit(1);
  }
  if (u.status === 'PENDING_ACTIVATION') {
    const { rawToken } = await amorcage.issueActivation(u);
    await amorcage.activateAccount(rawToken, MOT_DE_PASSE);
  }
}
const connexion = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'no-mutation@dev.test', password: MOT_DE_PASSE }),
});
const jeton = (await connexion.json().catch(() => ({})))?.data?.token ?? null;

const appel = (chemin, options = {}) => fetch(base + chemin, {
  ...options,
  headers: {
    ...(options.headers ?? {}),
    ...(jeton ? { authorization: `Bearer ${jeton}` } : {}),
  },
});

/* ══════════════════════════════════════════════════════════════════════════ */
section('1 · Une session DEV réelle, sans laquelle la recette ne prouverait rien');
{
  check('le jeton DEV est obtenu par la vraie route de connexion', typeof jeton === 'string');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('2 · Le parcours de déploiement n’écrit RIEN sous backend/src');
{
  const avant = inventaire(SRC);
  check(`le code source est inventorié (${avant.size} fichiers)`, avant.size > 100);

  /**
   * LES APPELS DU PARCOURS RÉEL — ceux que l'écran émet en ouvrant le
   * déploiement, et les deux qui sont morts en `ECONNRESET` le jour de
   * l'incident. Leur code de réponse importe peu ici : un refus métier
   * (pas de VPS joignable, projet non appairé) traverse exactement les mêmes
   * couches, et c'est ce trajet qu'on surveille.
   */
  const etapes = [
    ['GET  /deployment/version', () => appel('/api/deployment/version')],
    ['GET  /deployment/phases', () => appel('/api/deployment/phases')],
    ['GET  /deployment/targets', () => appel('/api/deployment/targets')],
    ['GET  /deployment/dns-status', () => appel('/api/deployment/dns-status?hostname=demo-sbauto06.ly-solution.com')],
    ['POST /deployment/vps-session', () => appel('/api/deployment/vps-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '127.0.0.1', username: 'root', password: 'mot-de-passe-inexistant' }),
    })],
    ['GET  /deployment/runs', () => appel('/api/deployment/runs')],
  ];

  const statuts = [];
  for (const [nom, fn] of etapes) {
    const r = await fn().catch(() => null);
    statuts.push(`${nom} → ${r ? r.status : 'erreur réseau'}`);
    await r?.text?.().catch(() => {});
  }
  check(`les ${etapes.length} appels du parcours ont été exécutés`, statuts.length === etapes.length);
  for (const s of statuts) console.log(`         · ${s}`);

  const apres = inventaire(SRC);
  const modifies = [...apres.entries()].filter(([f, e]) => avant.has(f) && avant.get(f) !== e).map(([f]) => f);
  const ajoutes = [...apres.keys()].filter((f) => !avant.has(f));
  const supprimes = [...avant.keys()].filter((f) => !apres.has(f));

  check(`AUCUN fichier source modifié${modifies.length ? ` — ${modifies.slice(0, 5).join(', ')}` : ''}`,
    modifies.length === 0);
  check(`AUCUN fichier source ajouté${ajoutes.length ? ` — ${ajoutes.slice(0, 5).join(', ')}` : ''}`,
    ajoutes.length === 0);
  check(`AUCUN fichier source supprimé${supprimes.length ? ` — ${supprimes.slice(0, 5).join(', ')}` : ''}`,
    supprimes.length === 0);

  if (modifies.length || ajoutes.length) {
    console.error('    → Un runtime qui écrit son propre code source relance le service en');
    console.error('       développement, et réécrit le déployé en production. Déplacez cette');
    console.error('       écriture hors du graphe de modules (logs/, tmp, base de données).');
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('3 · Les écritures légitimes visent des dossiers NON surveillés');
{
  /**
   * Le runtime écrit — c'est normal. Ce qui compte est OÙ : un chemin hors du
   * graphe de modules ne relance jamais le service et ne réécrit jamais le
   * déployé. On vérifie les destinations déclarées plutôt que d'interdire
   * l'écriture.
   */
  const diagnostic = fs.readFileSync(path.join(SRC, 'utils/diagnosticReport.js'), 'utf8');
  check('les rapports de diagnostic vont dans `logs/`, hors du code',
    /LOGS_DIR\s*=\s*path\.resolve\(HERE,\s*'\.\.\/\.\.\/logs'\)/.test(diagnostic));

  const build = fs.readFileSync(path.join(SRC, 'deployment-engine/build.js'), 'utf8');
  check('le build local prépare son artefact dans un temporaire système',
    /stagingBase\s*=\s*os\.tmpdir\(\)/.test(build));
  check('…et jamais dans le dépôt', !/stagingBase\s*=\s*path\.join\(__dirname/.test(build));

  const vault = fs.readFileSync(path.join(SRC, 'deployment-engine/passwordVault.js'), 'utf8');
  check('le coffre de session VPS ne connaît AUCUN fichier',
    !/writeFile|readFile|fs\./.test(vault));
  check('…il vit en mémoire, et meurt avec le process', /const store = new Map\(\)/.test(vault));
}

serveur.close();
await disconnectDatabase();
await mongod.stop();

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
