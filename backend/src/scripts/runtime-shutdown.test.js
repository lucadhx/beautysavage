/**
 * ARRÊT ORDONNÉ — RUNNING → DRAINING → STOPPED.
 *
 * ══ LE DÉFAUT QUE CE FICHIER FERME ══════════════════════════════════════════
 *
 * `PROJECTION_BUILD_FAILED / SITE_STATUS` apparaissait à l'arrêt, sans qu'aucune
 * projection n'ait réellement échoué :
 *
 *   1. une écriture métier programme une projection (fenêtre de 500 ms) ;
 *   2. l'arrêt survient dans cette fenêtre ;
 *   3. la connexion à la base se ferme ;
 *   4. le minuteur arrive à échéance et lit une base fermée ;
 *   5. l'échec est journalisé comme une PANNE.
 *
 * Le système n'était pas en panne : il s'arrêtait. Confondre les deux apprend à
 * ignorer une catégorie d'incidents — et le jour où l'un d'eux est vrai,
 * personne ne le lit. C'est exactement le mécanisme qui avait laissé passer le
 * refus permanent de `PROJECT_PRESENTATION`.
 *
 * ══ ET UN SECOND DÉFAUT, PLUS COÛTEUX ═══════════════════════════════════════
 *
 * `server.close()` n'appelle son rappel qu'à la fermeture de la DERNIÈRE
 * connexion. Un flux `GET /api/live/events` ne se ferme jamais seul : son
 * battement de maintien le garde ouvert, c'est sa fonction. Un seul Manager
 * ouvert suffisait donc à épuiser le délai de grâce de 10 s, et l'arrêt se
 * terminait par `process.exit(1)` — base jamais refermée proprement, `reload`
 * PM2 soldé par un code d'erreur sur un arrêt parfaitement normal.
 *
 * ══ CE QUE CE FICHIER REFUSE DE PROUVER PAR L'ABSENCE DE BRUIT ══════════════
 *
 * « Plus de message » ne serait pas une garantie : un `catch` vide donnerait le
 * même silence. On prouve donc les DEUX sens — une vraie erreur AVANT l'arrêt
 * reste journalisée, la même erreur PENDANT l'arrêt ne l'est pas — et que
 * l'écriture métier n'est jamais perdue dans l'intervalle.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'shutdown_test';
process.env.DB_PROD = 'shutdown_prod';
process.env.JWT_SECRET = 'test-secret-jwt-shutdown';
process.env.PORT = '4193';
process.env.CORS_ORIGINS = 'http://localhost:6062';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.SIGNATURE_PROVIDER = 'stub';
process.env.STRIPE_PROVIDER = 'stub';
// L'ordonnanceur du pont n'a rien à faire ici : ce fichier éprouve l'ARRÊT,
// pas la livraison. Le laisser tourner ajouterait des tics de fond qui
// masqueraient précisément ce qu'on mesure.
process.env.PANEL_SCHEDULER_ENABLED = 'false';

let pass = 0; let fail = 0;
const check = (n, c) => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)); };
const section = (n) => console.log(`\n${n}`);
const attendre = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * MOUCHARD DE JOURNAL — on lit ce que le produit ÉCRIT, pas ce qu'il retourne.
 *
 * L'incident n'est pas une valeur de retour : c'est une ligne. La seule façon
 * honnête de vérifier qu'elle apparaît (ou pas) est de la capturer.
 */
const erreursCapturees = [];
const consoleErreurOrigine = console.error;
console.error = (...args) => {
  erreursCapturees.push(args.map(String).join(' '));
  consoleErreurOrigine(...args);
};
const incidentsProjection = () => erreursCapturees.filter((l) => l.includes('PROJECTION_BUILD_FAILED'));

const { connectDatabase } = await import('../config/db.js');
const { bootstrap } = await import('../config/bootstrap.js');
const { createApp } = await import('../app.js');
await connectDatabase();
await bootstrap();
// Le service est PRÊT : cette suite a fait elle-même tout ce que le démarrage fait.
await (await import("./helpers/serviceReady.helper.js")).markTestServiceReady();
// LOT 2C — le DÉCOR de recette (dev@mail.com, admin@mail.com) ne vient plus du
// produit : `bootstrap()` ne pose aucun mot de passe. Voir helpers/testAccounts.helper.js.
await (await import("./helpers/testAccounts.helper.js")).seedTestAccounts();

const app = createApp();
const server = app.listen(4193);
const base = 'http://localhost:4193';

const lifecycle = await import('../services/lifecycle/runtimeLifecycle.js');
const projectSync = await import('../services/projectBridge/projectSync.service.js');
const uiLive = await import('../services/uiLive/uiLive.service.js');
const outbox = await import('../services/panelBridge/persistence/mongoOutboxAdapter.js');
const { getSingleton } = await import('../utils/singleton.js');
const { SiteStatus } = await import('../models/SiteStatus.model.js');

async function jeton() {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'dev@mail.com', password: '123dev' }),
  });
  return (await res.json())?.data?.token ?? null;
}

try {
  check('le runtime démarre en marche', lifecycle.lifecycleState() === 'RUNNING');
  check('…et accepte du travail', lifecycle.isAcceptingWork() === true);

  /* ══════════════════════════════════════════════════════════════════════ */
  section('UNE PROJECTION PROGRAMMÉE EST VIDANGÉE, PAS PERDUE');
  {
    await outbox.clearOutbox();
    const avant = await outbox.pendingCount();

    projectSync.scheduleProjection('SITE_STATUS');
    check('la projection attend sa fenêtre de regroupement',
      projectSync.pendingProjections().includes('SITE_STATUS'));

    // L'arrêt survient DANS la fenêtre — le cas exact du défaut.
    await lifecycle.beginDraining({ reason: 'test' });

    check('plus aucune projection en attente', projectSync.pendingProjections().length === 0);
    const apres = await outbox.pendingCount();
    check(`elle est partie EN FILE avant la fermeture (${avant} → ${apres})`, apres > avant);
    check('…et aucun incident n’a été fabriqué', incidentsProjection().length === 0);
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  section('PENDANT LE DRAINAGE, PLUS RIEN N’EST PROGRAMMÉ');
  {
    check('le runtime n’accepte plus de travail', lifecycle.isAcceptingWork() === false);

    projectSync.scheduleProjection('CONTRACT');
    check('une demande de projection ne programme AUCUN minuteur',
      projectSync.pendingProjections().length === 0);

    /**
     * ET CE N'EST PAS UNE PERTE : l'écriture métier est persistée avant toute
     * projection, et `reconcileAll()` reconstruit la photographie complète au
     * prochain démarrage. L'arrêt DIFFÈRE, il n'annule pas.
     */
    lifecycle.markRunning();
    await outbox.clearOutbox();
    await projectSync.reconcileAll();
    const rattrape = await outbox.pendingCount();
    check(`la reprise au démarrage remet la photographie en file (${rattrape} entrée(s))`,
      rattrape > 0);
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  section('UN FLUX D’INTERFACE OUVERT NE BLOQUE PLUS L’ARRÊT');
  {
    uiLive.resetUiLiveForTests();
    const token = await jeton();
    check('jeton DEV obtenu', Boolean(token));

    const controleur = new AbortController();
    const flux = await fetch(`${base}/api/live/events`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controleur.signal,
    });
    check(`le flux est ouvert (${flux.status})`, flux.status === 200);

    // Le premier message confirme l'abonnement — sans lui, « connecté » ne
    // serait qu'une supposition.
    const lecteur = flux.body.getReader();
    const premier = new TextDecoder().decode((await lecteur.read()).value ?? new Uint8Array());
    check('…et il s’annonce', premier.includes('live.ready'));
    check('le backend compte 1 abonné', uiLive.describeUiLive().subscribers === 1);

    /**
     * LE CŒUR DU DÉFAUT — et on exécute la VRAIE séquence d'arrêt, celle que
     * `server.js` appelle sur `SIGTERM`. En recopier l'ordre ici prouverait la
     * copie, et resterait vert le jour où le point d'entrée changerait.
     *
     * Le délai de grâce est raccourci : on veut distinguer « fermé » de
     * « coupé de force », pas attendre dix secondes pour l'apprendre.
     */
    const issue = await lifecycle.gracefulShutdown({
      server, reason: 'SIGTERM', graceMs: 4_000,
    });

    check('le drainage a fermé les flux', uiLive.describeUiLive().subscribers === 0);
    check('…sans en oublier aucun', uiLive.describeUiLive().leaked === 0);
    check('…et les fermetures sont comptées',
      uiLive.describeUiLive().closed === uiLive.describeUiLive().opened);

    check('server.close() ABOUTIT — l’arrêt n’est plus FORCÉ', issue === 'closed');
    check('…et le runtime se déclare arrêté', lifecycle.lifecycleState() === 'STOPPED');

    // Le client voit la fin du flux, et il sait qu'elle est VOULUE.
    const suite = await lecteur.read().catch(() => ({ done: true, value: null }));
    const texte = suite.value ? new TextDecoder().decode(suite.value) : '';
    check('le client est prévenu que la coupure est volontaire',
      suite.done === true || texte.includes('live.closing'));
    controleur.abort();
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  section('UNE VRAIE ERREUR AVANT L’ARRÊT RESTE VISIBLE');
  {
    /**
     * On ferme la base SANS passer par `disconnectDatabase()` : le runtime se
     * croit donc encore en marche, et l'échec de construction est un VRAI
     * échec — exactement celui qu'il faut continuer à voir.
     */
    await mongoose.disconnect();
    lifecycle.markRunning();
    erreursCapturees.length = 0;

    const issue = await projectSync.projectNow('SITE_STATUS');
    check('la projection échoue', issue.queued === false);
    check('…et l’incident est JOURNALISÉ', incidentsProjection().length === 1);
    check('…nommant l’agrégat concerné',
      incidentsProjection()[0].includes('entityType=SITE_STATUS'));
    check('…et il n’est pas présenté comme un arrêt',
      issue.abandonedOnShutdown === undefined);
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  section('LA MÊME ERREUR PENDANT L’ARRÊT N’EST PLUS UNE PANNE');
  {
    erreursCapturees.length = 0;
    await lifecycle.beginDraining({ reason: 'SIGTERM' });

    const issue = await projectSync.projectNow('SITE_STATUS');
    check('la projection échoue de la MÊME façon', issue.queued === false);
    check('…mais AUCUN incident n’est fabriqué', incidentsProjection().length === 0);
    check('…et l’abandon est nommé pour ce qu’il est',
      issue.abandonedOnShutdown === true);

    /**
     * LA DIFFÉRENCE TIENT À L'ÉTAT DU RUNTIME, JAMAIS À L'ENVIRONNEMENT.
     *
     * Les deux sections précédentes tournent dans le MÊME processus, avec le
     * MÊME `ENV`, sur la MÊME erreur. Seul le cycle de vie change. Un
     * `if (NODE_ENV === 'test')` aurait rendu ces deux sections identiques —
     * et aurait laissé le bruit exactement là où il nuit : en production.
     */
    check('seul le cycle de vie distingue les deux cas',
      lifecycle.lifecycleState() === 'DRAINING');
  }
} finally {
  console.error = consoleErreurOrigine;
  try { server.close(); } catch { /* déjà fermé */ }
  try { await mongoose.disconnect(); } catch { /* déjà fermée */ }
  await mongod.stop();
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
