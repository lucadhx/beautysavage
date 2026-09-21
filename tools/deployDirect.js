// DÉPLOYER SANS PASSER PAR L'INTERFACE — l'entrée d'exploitation.
//
//   node tools/deployDirect.js --environment TEST [--skip-build] [--preflight-only]
//
// ══ POURQUOI CETTE ENTRÉE EXISTE ════════════════════════════════════════════
//
// Le déploiement se déclenche depuis le Manager : un développeur se connecte,
// ouvre une session VPS, clique. La route est gardée par `authenticate` puis
// `authorize(ROLES.DEV)`.
//
// Cette garde protège une INTERFACE — elle répond à « qui a le droit de
// cliquer ». Elle ne dit rien de ce dont le déploiement a besoin pour
// s'exécuter, et c'est là que la confusion coûtait cher : faute du mot de passe
// d'un compte métier, on ne pouvait plus déployer depuis un poste
// d'exploitation, alors qu'aucune ligne du moteur ne demande ce compte.
//
// ══ CE QUE LE MOTEUR DEMANDE RÉELLEMENT ════════════════════════════════════
//
// Vérifié dans le code, pas supposé :
//
//     engine.deployWithReport({ url, sessionId, user, deploymentRunId, onEvent })
//
//   `url`              la destination, lue en base ;
//   `sessionId`        une session VPS — c'est `VPS_PASS` qui ouvre le serveur ;
//   `deploymentRunId`  le run durable, créé par les mêmes services ;
//   `user`             une ATTRIBUTION écrite au journal, et rien d'autre.
//
// Aucun compte métier n'entre dans le déploiement. `user` sert à écrire QUI a
// demandé — ici, l'exploitation.
//
// ══ CE QUE CE RUNNER NE FAIT PAS ═══════════════════════════════════════════
//
// Il ne contient AUCUNE logique de déploiement. Pas un `ssh`, pas un `scp`,
// pas un `pm2 restart`, pas une ligne de nginx. Reproduire les commandes du
// moteur donnerait un second moteur, qui divergerait au premier correctif
// apporté au premier — et c'est sur une mise en production qu'on s'en
// apercevrait.
//
// Il appelle le CONTRÔLEUR OFFICIEL, `deployStream`, celui-là même que la route
// HTTP appelle. Tout ce que le parcours garantit est donc garanti ici, parce
// que c'est le même code qui l'exécute :
//
//   · les prérequis locaux (sources commitées) ;
//   · la configuration distante construite côté serveur ;
//   · le `DeploymentRun` durable ;
//   · le verrou de destination (`markDeploying`) et sa libération ;
//   · le plan de contrôle, la release, l'identité, le DNS ;
//   · le pipeline, ses étapes, sa barrière de publication ;
//   · le contrôle de santé public et la finalisation ;
//   · le rollback, et le rapport forensique.
//
// ══ POURQUOI PAS UN JETON ═══════════════════════════════════════════════════
//
// On aurait pu signer un jeton avec la clé du serveur et appeler la route par
// HTTP. Ça marche, et ça donne le change : ce runner AURAIT L'AIR d'un
// utilisateur connecté. Il n'en est pas un, et prétendre le contraire brouille
// exactement la distinction que ce fichier existe pour établir.
//
// Il ne se fait donc passer pour personne. Il s'attribue un acteur nommé, que
// le journal du run conservera tel quel.
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
const PREFLIGHT_SEUL = process.argv.includes('--preflight-only');

const journal = (...a) => console.log(...a);

/**
 * PROD N'EST PAS ACCESSIBLE PAR CETTE PORTE.
 *
 * Un runner d'exploitation sans écran de confirmation n'a rien à faire en
 * production : la route HTTP, elle, exige une confirmation explicite, et c'est
 * précisément le garde-fou qu'on ne veut pas contourner par commodité.
 */
if (ENVIRONNEMENT !== 'TEST') {
  console.error(
    `Refus : cette entrée ne dessert que TEST (demandé : ${ENVIRONNEMENT}). `
    + 'Un déploiement de production passe par l’interface, avec sa confirmation.',
  );
  process.exit(2);
}

/* ── L'ENVIRONNEMENT, CHARGÉ COMME LE SERVEUR LE CHARGE ────────────────────── */

const { config: charger } = await import(
  pathToFileURL(path.join(BACKEND, 'node_modules', 'dotenv', 'lib', 'main.js')).href
);
charger({ path: path.join(BACKEND, '.env') });
if (!process.env.VPS_PASS) {
  /**
   * `VPS_PASS` appartient à l'INFRASTRUCTURE, pas à ce projet : c'est le même
   * serveur qui héberge le Panel et cette démo. Le chercher là où il est déjà
   * évite de le recopier dans un second fichier — un secret dupliqué est un
   * secret qu'on oublie de faire tourner.
   */
  charger({ path: path.resolve(RACINE, '..', 'Panel', 'backend', '.env') });
}
if (!process.env.VPS_PASS) {
  console.error('VPS_PASS introuvable : le moteur ne peut pas ouvrir de session sur le serveur.');
  process.exit(1);
}

process.env.ENV = 'TEST';

const requireBackend = (rel) => import(pathToFileURL(path.join(BACKEND, 'src', rel)).href);

const { connectDatabase, disconnectDatabase } = await requireBackend('config/db.js');
const vault = await requireBackend('deployment-engine/passwordVault.js');
const targets = await requireBackend('services/deploymentTarget.service.js')
  .catch(() => null);
const controleur = await requireBackend('controllers/deployment.controller.js');
const { DeploymentTarget } = await requireBackend('models/DeploymentTarget.model.js')
  .catch(() => ({ DeploymentTarget: null }));

await connectDatabase();

let code = 0;
let sessionId = null;

/**
 * LA RÉPONSE SIMULÉE — juste assez pour que le contrôleur écrive son flux.
 *
 * Elle n'imite pas Express : elle implémente les cinq gestes que
 * `streamOperation` utilise. Un objet plus complet donnerait l'illusion d'un
 * serveur, et masquerait le jour où le contrôleur en attendra un sixième —
 * alors qu'ici il lèvera, franchement.
 */
function reponseDeFlux() {
  const etapes = [];
  let statut = 200;
  let refus = null;
  return {
    etapes,
    get statut() { return statut; },
    get refus() { return refus; },
    headersSent: false,
    writableEnded: false,
    setHeader() {},
    flushHeaders() { this.headersSent = true; },
    flush() {},
    status(c) { statut = c; return this; },
    json(corps) { refus = corps; this.writableEnded = true; return this; },
    write(ligne) {
      const brut = String(ligne).trim();
      if (!brut) return true;
      let ev;
      try { ev = JSON.parse(brut); } catch { journal(`   ? ${brut.slice(0, 160)}`); return true; }
      etapes.push(ev);
      const quoi = ev.stepId ?? ev.type ?? '·';
      const etat = ev.status ?? '';
      const dit = ev.label ?? ev.message ?? '';
      journal(`   [${String(quoi).padEnd(26)}] ${String(etat).padEnd(8)} ${String(dit).slice(0, 120)}`);
      return true;
    },
    end() { this.writableEnded = true; return this; },
    on() {},
  };
}

try {
  /* ── CE QUI VA ÊTRE TOUCHÉ, DIT AVANT DE LE TOUCHER ─────────────────────── */

  const cible = DeploymentTarget
    ? await DeploymentTarget.findOne({ environment: 'TEST' }).lean()
    : null;
  if (!cible) throw new Error('aucune destination TEST enregistrée.');

  const { execSync } = await import('node:child_process');
  const git = (cmd, fallback = '(non git)') => {
    try {
      return String(execSync(`git ${cmd}`, { cwd: RACINE, stdio: ['ignore', 'pipe', 'ignore'] })).trim() || fallback;
    } catch {
      return fallback;
    }
  };

  journal(`\n=== DÉPLOIEMENT DIRECT — ${(process.env.PROJECT_NAME ?? 'PROJET').toUpperCase()}, DESTINATION TEST ===\n`);
  journal(`   projet        : ${process.env.PROJECT_NAME ?? '(sans nom)'}`);
  journal(`   environnement : ${cible.environment}`);
  journal(`   destination   : ${cible._id}`);
  journal(`   site          : ${cible.url ?? `https://${cible.host}`}`);
  journal(`   manager       : https://manager.${cible.host}`);
  journal(`   backend       : https://api.${cible.host}`);
  journal(`   serveur       : ${cible.sshUser}@${cible.sshHost}`);
  journal(`   branche       : ${git('branch --show-current')}`);
  journal(`   commit        : ${git('rev-parse --short HEAD')}`);
  journal(`   version posée : ${cible.currentVersion ?? '(inconnue)'}`);

  /* ── LA SESSION VPS — par le coffre officiel, jamais affichée ───────────── */

  const session = vault.openSession({
    host: cible.sshHost,
    username: cible.sshUser,
    password: process.env.VPS_PASS,
  });
  sessionId = session.sessionId;
  journal(`\n   session VPS ouverte (expire ${session.expiresAt}).`);

  /* ── LE CONTRÔLEUR OFFICIEL, APPELÉ TEL QUEL ────────────────────────────── */

  const requete = {
    body: {
      targetId: String(cible._id),
      sessionId,
      ...(SANS_BUILD ? { skipBuild: true } : {}),
    },
    /**
     * L'ACTEUR EST NOMMÉ POUR CE QU'IL EST.
     *
     * Le contrôleur écrit `req.user?.email` dans le journal du run. Y mettre
     * l'adresse d'un développeur ferait croire, des mois plus tard, que
     * quelqu'un a cliqué. Personne n'a cliqué : c'est l'exploitation.
     */
    user: { email: 'exploitation@runner.local' },
    method: 'POST',
    originalUrl: '/deployment/deploy/stream (runner direct)',
    headers: {},
    on() {},
  };

  const reponse = reponseDeFlux();
  journal(`\n── ${PREFLIGHT_SEUL ? 'PRÉFLIGHT' : 'DÉPLOIEMENT'} ──\n`);
  if (PREFLIGHT_SEUL) await controleur.preflightStream(requete, reponse);
  else await controleur.deployStream(requete, reponse);

  if (reponse.refus) {
    journal(`\n   REFUS (${reponse.statut}) : ${reponse.refus.message ?? ''}`);
    if (reponse.refus.details) journal(`   ${JSON.stringify(reponse.refus.details).slice(0, 500)}`);
    code = 1;
  } else {
    const echecs = reponse.etapes.filter((e) => e.status === 'error' || e.type === 'step.failed');
    const rapport = reponse.etapes.find((e) => e.type === 'deployment.report_ready');
    journal(`\n   ${reponse.etapes.length} évènement(s), ${echecs.length} en échec.`);
    for (const e of echecs.slice(0, 10)) {
      journal(`   ✗ ${e.stepId ?? e.type} — ${String(e.message ?? '').slice(0, 200)}`);
    }
    if (rapport) journal(`   rapport : ok=${rapport.ok} status=${rapport.status} runId=${rapport.runId ?? '?'}`);
    code = echecs.length === 0 && rapport?.ok !== false ? 0 : 1;
  }
} catch (error) {
  journal(`\nÉCHEC : ${error?.message ?? error}`);
  if (error?.details) journal(`   détails : ${JSON.stringify(error.details).slice(0, 400)}`);
  code = 1;
} finally {
  /**
   * LA SESSION SE REFERME QUOI QU'IL ARRIVE.
   *
   * Laissée ouverte, elle garde un mot de passe en mémoire et — pire — le
   * verrou de destination : le prochain déploiement échouerait sur
   * « exécution en cours » pour une session que plus personne n'utilise.
   */
  if (sessionId) {
    try { vault.closeSession(sessionId); journal('\nsession VPS refermée.'); }
    catch { /* déjà close par l'opération : c'est le comportement voulu */ }
  }
  await disconnectDatabase().catch(() => {});
  process.exit(code);
}
