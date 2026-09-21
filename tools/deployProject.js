// DÉPLOYER CE PROJET PAR SA PROPRE SURFACE — sans interface graphique.
//
//   node tools/deployProject.js --environment TEST [--skip-build]
//
// ══ POURQUOI PASSER PAR L'API PLUTÔT QUE PAR LE MOTEUR ══════════════════════
//
// Le moteur de déploiement est appelable directement. Le faire sauterait tout
// ce que la route vérifie AVANT d'engager quoi que ce soit : le run durable, la
// barrière de publication, le verrou de destination, le journal forensique.
//
// La route héritée qui contournait tout cela a été SUPPRIMÉE, et une garde
// (`deployment-entrypoints.test.js`) échoue si une seconde apparaît. Ce script
// n'en ouvre pas une : il emprunte la seule porte, `POST /deploy/stream`.
//
// ══ CE QU'IL AJOUTE ═════════════════════════════════════════════════════════
//
// Rien à la logique de déploiement. Il démarre le backend local, s'authentifie,
// ouvre une session VPS, suit le flux NDJSON d'étapes, et s'arrête. C'est un
// opérateur sans souris — pas un second moteur.
//
// ══ POURQUOI UN PORT DÉDIÉ ══════════════════════════════════════════════════
//
// Reprendre celui du `.env` ferait échouer le déploiement pour la pire raison
// possible — « port occupé » — ou, s'il était libre, ferait croire ensuite que
// l'instance de développement est morte.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RACINE = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const BACKEND = path.join(RACINE, 'backend');

const arg = (nom, defaut = null) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i === -1 ? defaut : process.argv[i + 1];
};
const ENVIRONNEMENT = String(arg('environment', 'TEST')).toUpperCase();
const SANS_BUILD = process.argv.includes('--skip-build');

const journal = (...a) => console.log(...a);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Les identifiants viennent de l'environnement du poste, transitent dans UNE
 * requête locale, et n'apparaissent dans aucune sortie.
 */
if (!process.env.VPS_PASS || !process.env.SEED_DEV_EMAIL || !process.env.SEED_DEV_PASSWORD) {
  const { config: charger } = await import(
    pathToFileURL(path.join(BACKEND, 'node_modules', 'dotenv', 'lib', 'main.js')).href
  );
  charger({ path: path.join(BACKEND, '.env') });
}

const identifiants = {
  email: process.env.SEED_DEV_EMAIL,
  motDePasse: process.env.SEED_DEV_PASSWORD,
  ssh: process.env.VPS_PASS,
};
if (!identifiants.email || !identifiants.motDePasse || !identifiants.ssh) {
  console.error('Identifiants introuvables : SEED_DEV_EMAIL, SEED_DEV_PASSWORD et VPS_PASS sont requis.');
  process.exit(1);
}

const PORT = Number(arg('port', '') || 4188);
const BASE = `http://127.0.0.1:${PORT}`;

let backend = null;

async function attendreDisponible(limiteMs = 120_000) {
  const debut = Date.now();
  while (Date.now() - debut < limiteMs) {
    try {
      /**
       * `/readyz` dit « prêt à servir », `/health` dit « vivant ». Un port
       * ouvert avant l'amorçage répondrait « vivant » alors que les routes
       * métier refusent encore en 503.
       */
      const r = await fetch(`${BASE}/readyz`);
      if (r.ok) return true;
    } catch { /* pas encore levé */ }
    await dormir(1500);
  }
  return false;
}

async function api(chemin, { method = 'GET', body = null, jeton = null } = {}) {
  const r = await fetch(`${BASE}${chemin}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(jeton ? { authorization: `Bearer ${jeton}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const texte = await r.text();
  let corps = {};
  try { corps = texte ? JSON.parse(texte) : {}; } catch { corps = { brut: texte.slice(0, 400) }; }
  if (!r.ok) {
    const e = new Error(corps.message || `HTTP ${r.status} sur ${chemin}`);
    e.status = r.status;
    e.details = corps.details ?? null;
    e.code = corps.code ?? null;
    throw e;
  }
  return corps.data ?? corps;
}

/**
 * LE FLUX D'ÉTAPES, LIGNE PAR LIGNE.
 *
 * Le déploiement n'est pas une réponse : c'est une suite d'évènements NDJSON.
 * Les accumuler pour les lire à la fin ferait perdre l'information la plus
 * utile — CE QUI se passait quand ça s'est arrêté.
 */
async function suivreFlux(chemin, corps, jeton) {
  const r = await fetch(`${BASE}${chemin}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${jeton}` },
    body: JSON.stringify(corps),
  });
  if (!r.ok || !r.body) {
    const texte = await r.text().catch(() => '');
    throw new Error(`le flux a été refusé (HTTP ${r.status}) : ${texte.slice(0, 400)}`);
  }

  const lecteur = r.body.getReader();
  const decodeur = new TextDecoder();
  let reste = '';
  const evenements = [];
  let dernier = null;

  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await lecteur.read();
    if (done) break;
    reste += decodeur.decode(value, { stream: true });
    const lignes = reste.split('\n');
    reste = lignes.pop() ?? '';
    for (const ligne of lignes) {
      const brut = ligne.trim();
      if (!brut) continue;
      let ev;
      try { ev = JSON.parse(brut); } catch { journal(`   ? ${brut.slice(0, 160)}`); continue; }
      evenements.push(ev);
      dernier = ev;
      const etiquette = ev.phase ?? ev.step ?? ev.type ?? '·';
      const etat = ev.status ?? ev.state ?? '';
      const message = ev.message ?? ev.detail ?? '';
      journal(`   [${String(etiquette).padEnd(22)}] ${etat}${message ? ` — ${String(message).slice(0, 160)}` : ''}`);
    }
  }
  return { evenements, dernier };
}

/* -------------------------------------------------------------------------- */

let code = 0;
try {
  journal(`\n=== DÉPLOIEMENT DE ${process.env.PROJECT_NAME ?? 'CE PROJET'} — destination ${ENVIRONNEMENT} ===\n`);

  journal('démarrage du backend local…');
  backend = spawn(process.execPath, [path.join(BACKEND, 'src', 'server.js')], {
    cwd: BACKEND,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backend.stdout.on('data', (d) => {
    const t = String(d);
    if (/error|échec|failed/i.test(t)) process.stdout.write(`   [backend] ${t}`);
  });
  backend.stderr.on('data', (d) => process.stdout.write(`   [backend:err] ${d}`));

  if (!await attendreDisponible()) throw new Error('le backend local n’est pas devenu prêt.');
  journal(`backend prêt sur ${BASE}`);

  const auth = await api('/api/auth/login', {
    method: 'POST',
    body: { email: identifiants.email, password: identifiants.motDePasse },
  });
  const jeton = auth.token ?? auth.accessToken;
  if (!jeton) throw new Error('authentification sans jeton.');
  journal('authentifié.');

  const cibles = await api('/api/deployment/targets', { jeton });
  const liste = Array.isArray(cibles) ? cibles : (cibles.targets ?? []);
  const cible = liste.find((c) => String(c.environment).toUpperCase() === ENVIRONNEMENT);
  if (!cible) {
    throw new Error(`Aucune destination ${ENVIRONNEMENT} (${liste.length} destination(s) connue(s)).`);
  }
  const cibleId = cible.id ?? cible._id ?? cible.targetId;
  journal(`destination : « ${cible.name ?? cible.host} » → ${cible.publicUrl ?? cible.host}`);

  /**
   * LA SESSION VPS EST OUVERTE UNE FOIS, ET REFERMÉE QUOI QU'IL ARRIVE.
   *
   * Une session laissée ouverte tient le verrou de destination : le prochain
   * déploiement échouerait sur « exécution en cours » pour une session que
   * plus personne n'utilise.
   */
  const session = await api('/api/deployment/vps-session', {
    method: 'POST', jeton,
    body: { host: cible.host, username: cible.username ?? cible.sshUser ?? 'root', password: identifiants.ssh },
  });
  const sessionId = session.sessionId ?? session.id;
  if (!sessionId) throw new Error('session VPS sans identifiant.');
  journal(`session VPS ouverte.`);

  try {
    journal('\n── PRÉFLIGHT ──');
    const pre = await suivreFlux('/api/deployment/preflight/stream', { targetId: cibleId, sessionId }, jeton);
    const preOk = !pre.evenements.some((e) => /fail|error|refus/i.test(String(e.status ?? '')));
    journal(`   issue du préflight : ${preOk ? 'OK' : 'ANOMALIE'}`);

    journal('\n── DÉPLOIEMENT ──');
    const dep = await suivreFlux(
      '/api/deployment/deploy/stream',
      { targetId: cibleId, sessionId, email: identifiants.email, ...(SANS_BUILD ? { skipBuild: true } : {}) },
      jeton,
    );
    const echecs = dep.evenements.filter((e) => /fail|error/i.test(String(e.status ?? '')));
    journal(`\n   ${dep.evenements.length} évènement(s), ${echecs.length} en échec.`);
    for (const e of echecs.slice(0, 10)) {
      journal(`   ✗ ${e.phase ?? e.step ?? '?'} — ${String(e.message ?? '').slice(0, 200)}`);
    }
    code = echecs.length === 0 ? 0 : 1;
  } finally {
    await api(`/api/deployment/vps-session/${sessionId}`, { method: 'DELETE', jeton }).catch(() => {});
    journal('\nsession VPS refermée.');
  }
} catch (error) {
  journal(`\nÉCHEC : ${error?.message ?? error}`);
  if (error?.details) journal(`   détails : ${JSON.stringify(error.details).slice(0, 400)}`);
  code = 1;
} finally {
  if (backend) backend.kill();
  await dormir(500);
  process.exit(code);
}
