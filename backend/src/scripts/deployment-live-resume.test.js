/**
 * ══ UN DÉPLOIEMENT APPARTIENT AU BACKEND, PAS À LA PAGE QUI L'A LANCÉ ══════
 *
 * ── LE DÉFAUT ──────────────────────────────────────────────────────────────
 *
 * Le suivi vivait dans la page React : les étapes s'accumulaient dans un
 * `useState` alimenté par le flux NDJSON, et le `runId` n'était connu qu'après
 * réception d'un premier événement. Quitter l'écran coupait le flux
 * (`AbortController`) et jetait l'état.
 *
 * Le run, lui, continuait : `recordStep` écrit CHAQUE transition en base au
 * moment où elle arrive. Rien n'était perdu — rien n'était demandé. L'écran
 * revenait vide, avec un bouton « Déployer » réarmé devant un déploiement bien
 * vivant.
 *
 * ── CE QUI EST ÉPROUVÉ ─────────────────────────────────────────────────────
 *
 * Que le backend sait répondre aux trois questions dont l'écran a besoin :
 * « y a-t-il un run en cours », « où en est-il », « préviens-moi de la suite ».
 * Et qu'observer n'exécute jamais rien.
 *
 * Runner autonome : base en mémoire, aucun réseau, aucun VPS, aucun SSH.
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const ICI = path.dirname(fileURLToPath(import.meta.url));

let pass = 0;
let fail = 0;
const check = (nom, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (t) => console.log(`\n${t}`);
const dormir = (ms) => new Promise((r) => { setTimeout(r, ms); });

const mongo = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongo.getUri();
process.env.DB_TEST = 'live_resume';
process.env.DB_PROD = 'live_resume_prod';
process.env.JWT_SECRET = 'live-resume-secret-0123456789abcdef0123456789';
process.env.INTEGRATED_API_ENCRYPTION_KEY = '0'.repeat(64);
process.env.NGROK_API_URL = 'http://127.0.0.1:1';
process.env.PORT = '4207';

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();

const runs = await import('../services/deploymentRun.service.js');
const { DeploymentRun } = await import('../models/DeploymentRun.model.js');
const { DeploymentTarget } = await import('../models/DeploymentTarget.model.js');
const { markReady } = await import('../services/lifecycle/readiness.service.js');
markReady();
const { createApp } = await import('../app.js');

/* ── UNE SESSION DEV RÉELLE : les routes de déploiement l'exigent ────────── */
const { User } = await import('../models/User.model.js');
const { ROLES, USER_STATUS } = await import('../utils/constants.js');
const dev = await User.create({
  email: 'dev@resume.test', name: 'Dev', role: ROLES.DEV,
  password: 'MotDePasseResume-2026', status: USER_STATUS.ACTIVE,
});
const jwt = (await import('jsonwebtoken')).default;
const { config } = await import('../config/env.js');
const JETON = jwt.sign({ sub: String(dev._id), role: 'DEV' }, config.jwt.secret, { expiresIn: '1h' });

const PORT = 4207;
const serveur = createApp().listen(PORT);

async function api(methode, chemin) {
  const r = await fetch(`http://127.0.0.1:${PORT}${chemin}`, {
    method: methode, headers: { authorization: `Bearer ${JETON}` },
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, data: json?.data ?? null, json };
}

/** Un observateur NDJSON, exactement comme le Manager en ouvrira un. */
function observer(runId) {
  const evenements = [];
  let resoudreFin;
  const fin = new Promise((r) => { resoudreFin = r; });
  const requete = http.request(
    { host: '127.0.0.1', port: PORT, path: `/api/deployment/runs/${runId}/observe`, method: 'GET', headers: { authorization: `Bearer ${JETON}` } },
    (reponse) => {
      let tampon = '';
      reponse.on('data', (b) => {
        tampon += b.toString('utf8');
        const lignes = tampon.split('\n');
        tampon = lignes.pop() ?? '';
        for (const l of lignes) { if (l.trim()) { try { evenements.push(JSON.parse(l)); } catch { /* partiel */ } } }
      });
      reponse.on('end', () => resoudreFin('end'));
    },
  );
  requete.on('error', () => resoudreFin('error'));
  requete.end();
  return { evenements, fin, couper: () => requete.destroy() };
}

/* ── LE DÉCOR : une destination et un run que l'on fait avancer à la main ── */
const cible = await DeploymentTarget.create({
  name: 'Destination recette', url: 'https://site.test', host: 'site.test',
  type: 'domain', environment: 'TEST', backendPort: 5101,
  sshHost: 'vps.test', sshUser: 'root', siteHost: 'site.test', managerHost: 'manager.test',
});
const run = await runs.createRun({
  target: { _id: cible._id, name: cible.name, sshHost: 'vps.test', sshUser: 'root' },
  user: dev.email, version: 'abc1234', operationType: 'DEPLOYMENT',
});
const RUN_ID = String(run._id);

/** Fait avancer le run comme le moteur le ferait — écriture en base. */
async function avancer(stepId, status, message = null) {
  const doc = await DeploymentRun.findById(RUN_ID);
  const existant = doc.steps.find((s) => s.id === stepId);
  if (existant) { existant.status = status; existant.publicMessage = message; }
  else doc.steps.push({ id: stepId, label: stepId, status, publicMessage: message });
  doc.currentStepId = status === 'running' ? stepId : null;
  doc.updatedAt = new Date();
  await doc.save();
}

/* ══════════════════════════════════════════════════════════════════════════
   1. LE RUN EST PERSISTANT ET DÉCOUVRABLE.
   ══════════════════════════════════════════════════════════════════════════ */
section('1 · Un run en cours se retrouve sans rien savoir de lui');
{
  await avancer('preflight', 'ok', 'Prérequis vérifiés');
  await avancer('ssh', 'running', 'Connexion au serveur');

  const r = await api('GET', '/api/deployment/runs/active');
  check('la découverte répond', r.status === 200);
  check('…un run actif est signalé', r.data?.active === true);
  check('…avec son identifiant', r.data?.run?.id === RUN_ID);
  check('…son statut', r.data?.run?.status === 'running');
  check('…son étape courante', r.data?.run?.currentStepId === 'ssh');
  check('…et sa date de départ', typeof r.data?.run?.startedAt === 'string');

  /**
   * LA CHECKLIST EST RECONSTRUCTIBLE — c'est tout l'objet du lot.
   * Terminées, en cours, à venir : l'écran n'a besoin de rien d'autre.
   */
  const etapes = r.data?.run?.steps ?? [];
  check('les étapes TERMINÉES sont dans l’instantané',
    etapes.find((s) => s.id === 'preflight')?.status === 'ok');
  check('…et l’étape EN COURS aussi',
    etapes.find((s) => s.id === 'ssh')?.status === 'running');

  /** §27 — actif et dernier sont deux questions différentes. */
  check('le dernier run est rendu séparément', r.data?.latest?.id === RUN_ID);
}

/* ══════════════════════════════════════════════════════════════════════════
   2. OBSERVER — instantané d'abord, suite ensuite, sans rien déclencher.
   ══════════════════════════════════════════════════════════════════════════ */
section('2 · Un observateur reçoit l’état complet PUIS la suite');
{
  const o = observer(RUN_ID);
  await dormir(900);

  const premier = o.evenements[0];
  check('le premier message est un instantané', premier?.type === 'run.snapshot');
  check('…complet dès l’ouverture (§9)',
    premier?.snapshot?.steps?.length === 2 && premier.snapshot.currentStepId === 'ssh');

  /* Le run avance PENDANT que l'observateur écoute. */
  await avancer('ssh', 'ok', 'Connecté');
  await avancer('upload', 'running', 'Envoi des fichiers');
  await dormir(1800);

  const dernier = o.evenements.filter((e) => e.type === 'run.snapshot').at(-1);
  check('la progression suivante est reçue en direct',
    dernier?.snapshot?.currentStepId === 'upload');
  check('…et l’étape précédente est passée à OK',
    dernier?.snapshot?.steps?.find((s) => s.id === 'ssh')?.status === 'ok');

  /**
   * OBSERVER N'EXÉCUTE RIEN. Le run n'a avancé que par nos écritures : si la
   * route avait relancé quoi que ce soit, des étapes inconnues seraient
   * apparues.
   */
  const apres = await DeploymentRun.findById(RUN_ID).lean();
  check('observer n’a lancé AUCUN moteur',
    apres.steps.every((s) => ['preflight', 'ssh', 'upload'].includes(s.id)));

  o.couper();
  await dormir(400);

  /* §8 — le job continue avec zéro observateur. */
  await avancer('upload', 'ok');
  const seul = await DeploymentRun.findById(RUN_ID).lean();
  check('le run continue avec 0 observateur connecté',
    seul.steps.find((s) => s.id === 'upload')?.status === 'ok'
    && seul.status === 'running');
}

/* ══════════════════════════════════════════════════════════════════════════
   3. RECONNEXION — le même run, l'état complet, rien de perdu (§35).
   ══════════════════════════════════════════════════════════════════════════ */
section('3 · Reprise après « navigation » : même run, checklist complète');
{
  const decouverte = await api('GET', '/api/deployment/runs/active');
  check('sameRunId', decouverte.data?.run?.id === RUN_ID);

  const o2 = observer(RUN_ID);
  await dormir(900);
  const snap = o2.evenements[0]?.snapshot;

  check('la reprise reçoit les étapes faites PENDANT l’absence',
    snap?.steps?.find((s) => s.id === 'upload')?.status === 'ok');
  check('…et toutes les précédentes',
    ['preflight', 'ssh', 'upload'].every((id) => snap.steps.some((s) => s.id === id)));

  /* Une étape FUTURE arrive en direct sur le second observateur. */
  await avancer('restart', 'running', 'Redémarrage');
  await dormir(1600);
  const vu = o2.evenements.filter((e) => e.type === 'run.snapshot').at(-1);
  check('une étape postérieure est reçue en live après reconnexion',
    vu?.snapshot?.currentStepId === 'restart');

  /* §20 — deux observateurs simultanés, aucun propriétaire. */
  const o3 = observer(RUN_ID);
  await dormir(900);
  check('un SECOND observateur simultané reçoit aussi l’instantané',
    o3.evenements[0]?.type === 'run.snapshot');
  o3.couper();
  await dormir(500);
  await avancer('restart', 'ok');
  await dormir(1600);
  check('…et la fermeture de l’un n’interrompt pas l’autre',
    o2.evenements.filter((e) => e.type === 'run.snapshot').at(-1)
      ?.snapshot?.steps?.find((s) => s.id === 'restart')?.status === 'ok');

  o2.couper();
  await dormir(400);
}

/* ══════════════════════════════════════════════════════════════════════════
   4. FIN DU RUN — et ce qu'un observateur en retard doit recevoir (§14).
   ══════════════════════════════════════════════════════════════════════════ */
section('4 · Run terminé : plus actif, mais toujours consultable');
{
  await DeploymentRun.updateOne({ _id: RUN_ID }, {
    $set: { status: 'success', finishedAt: new Date(), durationMs: 1234, currentStepId: null },
  });

  const r = await api('GET', '/api/deployment/runs/active');
  check('le run terminé n’est PLUS actif', r.data?.active === false && r.data?.run === null);
  /** §26/§27 — le résultat reste présentable après navigation. */
  check('…mais reste rendu comme DERNIER run', r.data?.latest?.id === RUN_ID);
  check('…avec son statut final', r.data?.latest?.status === 'success');

  /**
   * §14 — UN OBSERVATEUR QUI ARRIVE APRÈS LA FIN.
   * Il ne doit pas rester suspendu sur « en cours » : il reçoit l'état final
   * et une fermeture propre.
   */
  const o = observer(RUN_ID);
  const issue = await Promise.race([o.fin, dormir(6000).then(() => 'timeout')]);
  check('un observateur tardif reçoit l’état final et le flux se ferme',
    issue === 'end');
  check('…avec le statut final', o.evenements.at(-1)?.type === 'run.closed'
    && o.evenements.at(-1)?.status === 'success');
}

/* ══════════════════════════════════════════════════════════════════════════
   5. LE SECOND DÉPLOIEMENT EST REFUSÉ, ET NOMME LE RUN EXISTANT (§13).
   ══════════════════════════════════════════════════════════════════════════ */
section('5 · Double déploiement : refus nommé côté backend');
{
  const lifecycle = await import('../services/deployment/destinationLifecycle.service.js');
  const cible2 = await DeploymentTarget.create({
    /**
     * ENVIRONNEMENT DIFFÉRENT — un index unique n'autorise qu'une destination
     * active par environnement, et cette section parle de verrou, pas d'unicité.
     */
    name: 'Occupée', url: 'https://s2.test', host: 's2.test',
    type: 'domain', environment: 'PROD', backendPort: 5102,
    sshHost: 'vps2.test', sshUser: 'root', siteHost: 's2.test', managerHost: 'm2.test',
  });
  const run2 = await runs.createRun({
    target: { _id: cible2._id, name: cible2.name, sshHost: 'vps2.test', sshUser: 'root' },
    user: dev.email, version: 'v', operationType: 'DEPLOYMENT',
  });
  await lifecycle.lockForDeployment(String(cible2._id), String(run2._id));

  let refus = null;
  try { await lifecycle.lockForDeployment(String(cible2._id), 'un-autre-run'); }
  catch (err) { refus = err; }

  check('le second lancement est REFUSÉ', refus !== null && refus.statusCode === 409);
  check('…avec un code métier stable',
    refus?.details?.code === 'DEPLOYMENT_ALREADY_RUNNING');
  /**
   * L'IDENTIFIANT DU RUN EN COURS EST JOINT — c'est ce qui permet à l'écran de
   * proposer « suivre le déploiement en cours » plutôt qu'une erreur sèche.
   */
  check('…et l’identifiant du run qui occupe la place',
    refus?.details?.runId === String(run2._id));
}

/* ══════════════════════════════════════════════════════════════════════════
   6. LE CONTRAT — observer ne peut pas démarrer, démarrer n'est pas observer.
   ══════════════════════════════════════════════════════════════════════════ */
section('6 · Les deux verbes sont séparés par construction');
{
  const fs = await import('node:fs');
  const routes = fs.readFileSync(path.join(ICI, '../routes/deployment.routes.js'), 'utf8');
  check('l’observation est un GET', /router\.get\('\/runs\/:id\/observe'/.test(routes));
  check('le démarrage reste un POST', /router\.post\('\/deploy\/stream'/.test(routes));
  /**
   * L'ORDRE DES ROUTES EST UNE GARDE : `/runs/active` déclarée après
   * `/runs/:id` serait captée par elle et rejetée comme un identifiant
   * invalide.
   */
  check('`/runs/active` est déclarée AVANT `/runs/:id`',
    routes.indexOf("'/runs/active'") < routes.indexOf("'/runs/:id'"));

  const ctrl = fs.readFileSync(path.join(ICI, '../controllers/deployment.controller.js'), 'utf8');
  const corps = ctrl.slice(ctrl.indexOf('export async function observeRun'));
  const finCorps = corps.slice(0, corps.indexOf('\n}\n') + 3);
  check('l’observateur ne touche NI moteur NI verrou',
    !/DeploymentEngine|lockForDeployment|beginControlPlane/.test(finCorps));
  /** §17/§36 — un départ d'observateur n'annule rien. */
  check('…et une déconnexion ne demande aucune annulation',
    /job continues/.test(finCorps) && !/cancel|abort/i.test(finCorps));
}

await new Promise((r) => serveur.close(r));
await disconnectDatabase();
await mongo.stop();

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
