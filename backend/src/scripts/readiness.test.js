/*
 * DISPONIBILITÉ DU SERVICE — « vivant » n'est pas « prêt ».
 *
 * ══ CE QUE CETTE RECETTE PROUVE, ET POURQUOI ELLE EXISTE ═════════════════════
 *
 * `app.listen()` était la dernière ligne du démarrage : il venait après
 * `connectDatabase()`, `bootstrap()` — qui réconcilie les webhooks avec un
 * plafond de vingt secondes — et cinq reprises de données. Pendant toute cette
 * fenêtre, RIEN n'écoutait sur le port.
 *
 * Le Manager recevait donc un `502` d'nginx ou un `ECONNREFUSED`, tous deux
 * affichés « Serveur injoignable ». C'est ce qui produisait le symptôme
 * observé : une tentative de déploiement refusée avant même que ses prérequis
 * ne se lancent, puis un succès quelques dizaines de secondes plus tard sans
 * qu'on ait rien changé.
 *
 * La recette éprouve la conception qui remplace cela :
 *   · le port répond dès le début — `/livez` est servi avant tout amorçage ;
 *   · `/readyz` ne ment pas : il refuse tant que les dépendances manquent ;
 *   · les routes métier refusent en `503` + code stable, JAMAIS en `401`,
 *     jamais en `500`, jamais par une socket coupée ;
 *   · une fois prêt, tout redevient normal sans redémarrage.
 *
 * ══ POURQUOI UNE VRAIE BASE ÉPHÉMÈRE, ET PAS UN BOUCHON ═════════════════════
 *
 * L'aptitude exige DEUX conditions : l'amorçage terminé ET la base joignable.
 * Simuler la seconde en forçant un état interne de Mongoose éprouverait le
 * bouchon, pas la règle — et resterait vert le jour où la lecture de l'état
 * changerait. Une base en mémoire coûte quelques secondes et rend la preuve
 * réelle : c'est la même lecture qu'en production.
 */
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { requireServiceReady } from '../middlewares/readiness.middleware.js';
import {
  describeReadiness, isReady, markReady, readinessPhase, resetReadiness,
  unavailabilityReason,
} from '../services/lifecycle/readiness.service.js';

let pass = 0;
let fail = 0;
const check = (n, c) => {
  if (c) { pass += 1; console.log(`  ✓ ${n}`); } else { fail += 1; console.error(`  ✗ ${n}`); }
};
const section = (t) => console.log(`\n${t}`);

/**
 * Une application MINIMALE, montée exactement comme `app.js` monte la vraie :
 * sondes d'abord, garde ensuite, métier après. C'est l'ORDRE qui est la
 * garantie — une recette qui monterait la garde ailleurs prouverait autre chose
 * que ce que le runtime fait.
 */
const app = express();
app.get('/livez', (req, res) =>
  res.status(200).json({ success: true, data: { status: 'alive' } })
);
app.get('/readyz', (req, res) => {
  const etat = describeReadiness();
  if (!etat.ready) res.set('Retry-After', '2');
  return res.status(etat.ready ? 200 : 503).json({ success: etat.ready, data: etat });
});
app.use(requireServiceReady);
// Le « métier » : s'il est atteint, c'est que la garde a laissé passer.
app.get('/api/deployment/targets', (req, res) =>
  res.status(200).json({ success: true, data: { atteint: true } })
);

resetReadiness();
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

async function appel(chemin) {
  const res = await fetch(`${base}${chemin}`);
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json, headers: res.headers };
}

section('Amorçage en cours — le port écoute, le métier refuse proprement');
{
  check('la phase initiale est STARTING', readinessPhase() === 'STARTING');
  check('le service ne se déclare pas prêt', isReady() === false);

  const livez = await appel('/livez');
  check('/livez répond 200 pendant l’amorçage', livez.status === 200);

  const readyz = await appel('/readyz');
  check('/readyz répond 503 pendant l’amorçage', readyz.status === 503);
  check('/readyz ne prétend pas être prêt', readyz.json?.data?.ready === false);
  check('/readyz porte un Retry-After', readyz.headers.get('retry-after') === '2');

  /**
   * LE POINT CENTRAL. Une route métier appelée trop tôt doit dire « je ne peux
   * pas encore », et surtout PAS « tu n'es pas authentifié » : un 401 ferait
   * effacer le jeton du Manager, alors qu'aucun serveur n'a contesté l'identité.
   */
  const metier = await appel('/api/deployment/targets');
  check('une route métier refuse en 503 pendant l’amorçage', metier.status === 503);
  check('… avec le code stable SERVICE_STARTING',
    metier.json?.details?.code === 'SERVICE_STARTING');
  check('… en affirmant que la session reste valide',
    metier.json?.details?.sessionValid === true);
  check('… et en se déclarant réessayable', metier.json?.details?.retryable === true);
  check('une route métier ne répond JAMAIS 401 pendant l’amorçage', metier.status !== 401);
  check('une route métier ne répond JAMAIS 500 pendant l’amorçage', metier.status !== 500);
  check('la route métier n’a PAS été exécutée', metier.json?.data?.atteint !== true);

  const raison = unavailabilityReason();
  check('la cause nommée est le démarrage, pas la base',
    raison?.code === 'SERVICE_STARTING');
}

section('Service prêt — aucun échauffement, aucune seconde tentative');
const memoire = await MongoMemoryServer.create();
{
  await mongoose.connect(memoire.getUri(), { dbName: 'readiness_test' });
  markReady();
  check('la phase devient READY', readinessPhase() === 'READY');
  check('la base est effectivement joignable',
    describeReadiness().checks.database === true);

  const readyz = await appel('/readyz');
  check('/readyz répond 200 une fois prêt', readyz.status === 200);

  /**
   * LE CRITÈRE DU LOT : le PREMIER appel après l'état prêt aboutit. Pas de
   * requête d'échauffement, pas de seconde tentative, pas d'attente empirique.
   */
  const metier = await appel('/api/deployment/targets');
  check('le PREMIER appel métier aboutit, sans échauffement', metier.status === 200);
  check('… et la route a bien été exécutée', metier.json?.data?.atteint === true);
}

section('Base perdue en cours de service — 503 nommé, jamais un 401 ni un 500');
{
  await mongoose.disconnect();
  check('la connexion est effectivement rompue',
    describeReadiness().checks.database === false);

  const readyz = await appel('/readyz');
  check('/readyz redevient 503 quand la base tombe', readyz.status === 503);
  check('… en désignant la base comme la dépendance manquante',
    readyz.json?.data?.checks?.database === false);

  const metier = await appel('/api/deployment/targets');
  check('une route métier refuse en 503 quand la base est absente', metier.status === 503);
  /**
   * Ici — et ici seulement — la base est la CAUSE nommée : le service est
   * amorcé, donc son absence décrit une vraie panne et non un état attendu.
   */
  check('… avec le code stable DATABASE_UNAVAILABLE',
    metier.json?.details?.code === 'DATABASE_UNAVAILABLE');
  check('… sans jamais accuser la session', metier.status !== 401);
  check('… et en affirmant que la session reste valide',
    metier.json?.details?.sessionValid === true);

  /**
   * `/livez` reste vert : le process va bien, c'est sa base qui manque. Un
   * `/livez` qui échouerait ici ferait redémarrer en boucle un backend sain —
   * et le redémarrage ne répare pas une base absente.
   */
  const livez = await appel('/livez');
  check('/livez reste 200 : le process vit, c’est sa base qui manque',
    livez.status === 200);

  /* Le service revient SANS redémarrage — la reprise est une propriété. */
  await mongoose.connect(memoire.getUri(), { dbName: 'readiness_test' });
  const reprise = await appel('/readyz');
  check('/readyz redevient 200 dès que la base revient, sans redémarrage',
    reprise.status === 200);
  const metierRepris = await appel('/api/deployment/targets');
  check('… et le métier repasse au PREMIER appel', metierRepris.status === 200);
}

section('Les sondes ne sont jamais gardées — même quand rien ne va');
{
  resetReadiness();
  const livez = await appel('/livez');
  const readyz = await appel('/readyz');
  check('/livez reste joignable service non prêt', livez.status === 200);
  check('/readyz reste joignable service non prêt (503, mais servi)',
    readyz.status === 503 && readyz.json?.data !== undefined);
}

await new Promise((resolve) => { server.close(resolve); });
await mongoose.disconnect().catch(() => {});
await memoire.stop();
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
