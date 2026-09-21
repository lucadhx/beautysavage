/* LE FORÇAGE DE LA CONNEXION EST-IL RÉELLEMENT RALENTI ?
 *
 * ══ CE QUI EXISTAIT, ET POURQUOI CE N'ÉTAIT PAS UNE PROTECTION ══════════════
 *
 * `rateLimit()` — un compteur en mémoire, par IP seule, et DÉSACTIVÉ dès que
 * `config.isTest` était vrai. Or `isTest` vaut `!isProd` : sur l'environnement
 * TEST DÉPLOYÉ, la protection n'existait que dans le code. Elle ne comptait
 * rien, nulle part.
 *
 * Cette suite éprouve le comportement RÉEL, en HTTP, à travers l'application
 * complète — le seul niveau où un middleware oublié sur une route se voit.
 *
 * ══ CE QUI EST VÉRIFIÉ ══════════════════════════════════════════════════════
 *
 *   · le seau d'IDENTITÉ ferme avant celui d'IP ;
 *   · 429 et non 401 — un 401 dirait « identifiants invalides » à quelqu'un qui
 *     a peut-être tapé les bons ;
 *   · `Retry-After`, et la durée aussi dans le CORPS, que l'écran atteint ;
 *   · aucune énumération : le refus n'apprend rien sur le compte ;
 *   · une AUTRE identité passe encore — aucun verrouillage de compte ;
 *   · une réussite efface le seau de cette identité ;
 *   · le parcours FÉDÉRÉ a sa propre portée : un login fédéré légitime traverse
 *     deux routes, et ne doit pas consommer deux tentatives de connexion native ;
 *   · les compteurs SURVIVENT à un redémarrage — le défaut central du limiteur
 *     en mémoire qu'ils remplacent.
 *
 * Runner autonome — base éphémère, aucun réseau. */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'ratelimit_test';
process.env.DB_PROD = 'ratelimit_prod';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.PORT = '4163';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.NGROK_API_URL = 'http://127.0.0.1:1'; // hermétique à un vrai tunnel

let pass = 0;
let fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const section = (n) => console.log(`\n${n}`);

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
const { bootstrap } = await import('../config/bootstrap.js');
await connectDatabase();
await bootstrap();
await (await import('./helpers/serviceReady.helper.js')).markTestServiceReady();
await (await import('./helpers/testAccounts.helper.js')).seedTestAccounts();

const { createApp } = await import('../app.js');
const app = createApp();
const server = app.listen(4163);

const { AUTH_RATE_LIMITS, AUTH_RATE_LIMITED } = await import('../middlewares/authRateLimit.js');
const AuthAttempt = (await import('../models/AuthAttempt.model.js')).default;

async function api(method, path, { body } = {}) {
  const res = await fetch(`http://localhost:4163${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch { /* corps non-JSON */ }
  return { status: res.status, json: j, headers: res.headers };
}

const login = (email, password) => api('POST', '/api/auth/login', { body: { email, password } });
const viderLesSeaux = () => AuthAttempt.deleteMany({});

const COMPTE = 'dev@mail.com';
const MOT_DE_PASSE = '123dev';

/* ══════════════════════════════════════════════════════════════════════════ */
section('Les deux dimensions existent, et dans le bon ordre');
{
  check('une fenêtre est définie', Number.isFinite(AUTH_RATE_LIMITS.windowMs) && AUTH_RATE_LIMITS.windowMs > 0);
  check('…un plafond par IP', Number.isInteger(AUTH_RATE_LIMITS.perIp) && AUTH_RATE_LIMITS.perIp > 0);
  check('…un plafond par IDENTITÉ', Number.isInteger(AUTH_RATE_LIMITS.perIdentity) && AUTH_RATE_LIMITS.perIdentity > 0);
  /* Si l'IP fermait la première, le plafond d'identité ne servirait jamais —
   * et une attaque distribuée, une identité par adresse, ne rencontrerait
   * aucune limite d'identité. */
  check('…et l’identité est plus contrainte que l’adresse',
    AUTH_RATE_LIMITS.perIdentity < AUTH_RATE_LIMITS.perIp);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('La protection est ACTIVE sur TEST — c’est tout le sujet');
{
  await viderLesSeaux();
  const config = (await import('../config/env.js')).config;
  check('l’environnement de cette suite est bien TEST', config.isTest === true);

  let dernier = null;
  let premier429 = null;
  for (let i = 0; i < AUTH_RATE_LIMITS.perIdentity + 2; i += 1) {
    dernier = await login(COMPTE, 'mauvais');
    if (dernier.status === 429 && premier429 === null) premier429 = i + 1;
  }
  check('le martèlement est refusé, MALGRÉ isTest', dernier.status === 429);
  check('…au plafond d’identité', premier429 === AUTH_RATE_LIMITS.perIdentity + 1);
  check('…avec un code métier stable', dernier.json?.code === AUTH_RATE_LIMITED);

  const retryHeader = Number(dernier.headers.get('retry-after'));
  check('…un en-tête Retry-After exploitable', Number.isFinite(retryHeader) && retryHeader > 0);
  /* Le client du manager normalise `details` en tableau-ou-rien : un objet y
   * serait écarté. La durée voyage donc AUSSI à la racine du corps. */
  check('…et la durée à la RACINE du corps, là où l’écran la lit',
    Number(dernier.json?.retryAfterSeconds) === retryHeader);

  const texte = JSON.stringify(dernier.json);
  check('…sans révéler l’existence du compte', !texte.includes(COMPTE));
  check('…sans annoncer d’essais restants', !/restant|remaining/i.test(texte));
  check('…sans parler de blocage définitif', !/verrouill|bloqué définitivement/i.test(texte));

  const autre = await login('inconnu@exemple.test', 'mauvais');
  check('une AUTRE identité n’est pas contaminée', autre.status !== 429);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('Une connexion réussie efface le seau de cette identité');
{
  await viderLesSeaux();
  for (let i = 0; i < AUTH_RATE_LIMITS.perIdentity - 1; i += 1) await login(COMPTE, 'mauvais');

  const reussite = await login(COMPTE, MOT_DE_PASSE);
  check('la bonne combinaison passe encore juste avant le plafond', reussite.status === 200);

  /* Quelqu'un qui retrouve son mot de passe au septième essai ne doit pas
   * rester à une tentative du blocage pour le quart d'heure suivant. */
  const apres = await login(COMPTE, 'mauvais');
  check('…et le compteur de cette identité est reparti de zéro', apres.status !== 429);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('Le balayage de comptes depuis une seule adresse est arrêté');
{
  await viderLesSeaux();
  /* Une seule tentative par identité : chacune reste très en dessous de SON
   * plafond. Seul le seau d'adresse peut voir ce motif — et c'est exactement
   * ce qu'un limiteur par identité seule laisse passer intégralement. */
  let dernier = null;
  for (let i = 0; i < AUTH_RATE_LIMITS.perIp + 1; i += 1) {
    dernier = await login(`balayage-${i}@exemple.test`, 'mauvais');
  }
  check('le seau d’IP ferme le balayage', dernier.status === 429);
  check('…par le même code métier', dernier.json?.code === AUTH_RATE_LIMITED);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('Le parcours fédéré a sa PROPRE portée');
{
  await viderLesSeaux();
  /* Fermer la connexion native ne doit pas fermer la porte fédérée : un login
   * fédéré traverse `start` PUIS `callback`, et les compter dans le seau de la
   * connexion locale ferait consommer deux tentatives pour un seul geste. */
  for (let i = 0; i < AUTH_RATE_LIMITS.perIdentity + 1; i += 1) await login(COMPTE, 'mauvais');
  const natif = await login(COMPTE, 'mauvais');
  check('la connexion native est bien fermée', natif.status === 429);

  const federe = await api('POST', '/api/auth/federated/panel/start', { body: {} });
  check('…le parcours fédéré reste ouvert', federe.status !== 429);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('Les compteurs survivent à un redémarrage');
{
  await viderLesSeaux();
  for (let i = 0; i < AUTH_RATE_LIMITS.perIdentity + 1; i += 1) {
    await login('persistant@exemple.test', 'mauvais');
  }

  /* Un compteur porté par une `Map` meurt avec le processus : il suffisait d'un
   * redémarrage — un déploiement, un plantage, ou un plantage PROVOQUÉ — pour
   * le remettre à zéro. Ici il vit en base et ne remarque rien. */
  await disconnectDatabase();
  await connectDatabase();

  const apres = await login('persistant@exemple.test', 'mauvais');
  check('le seau est toujours fermé après un redémarrage', apres.status === 429);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('Ce compteur ne constitue pas un fichier de comptes');
{
  const documents = await AuthAttempt.find({}).lean();
  check('des compteurs existent bien', documents.length > 0);

  const brut = JSON.stringify(documents);
  /* L'identité est HACHÉE : ce compteur doit dire « cette identité a trop
   * essayé » sans constituer, au passage, la liste des adresses que l'on tente
   * de forcer — c'est-à-dire la liste qu'un attaquant voudrait. */
  check('…mais aucune adresse e-mail en clair',
    !brut.includes('persistant@exemple.test') && !brut.includes(COMPTE));
  check('…et aucun mot de passe', !brut.includes(MOT_DE_PASSE) && !brut.includes('mauvais'));
  check('…chaque compteur porte une date d’expiration',
    documents.every((d) => d.expiresAt instanceof Date));
  /* Fenêtre GLISSANTE. Un verrou permanent transformerait une nuisance en déni
   * de service : connaître l'adresse d'un administrateur suffirait à lui fermer
   * la porte. */
  check('…qui ne dépasse jamais la fenêtre déclarée',
    documents.every((d) => d.expiresAt.getTime() - Date.now() <= AUTH_RATE_LIMITS.windowMs + 1000));
}

server.close();
await disconnectDatabase();
await mongod.stop();

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
