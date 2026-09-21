/* ROUTAGE D'ENVIRONNEMENT CÔTÉ ENV=PROD — le miroir du lot L2.
 *
 * ── CE QUE CE FICHIER PROUVAIT, ET CE QU'IL PROUVE MAINTENANT ───────────────
 *
 * Il prouvait l'INDÉPENDANCE entre l'ENV applicatif et le mode fournisseur :
 * sous ENV=PROD, `activeMode=TEST` rendait la clé de test. C'était la doctrine ;
 * elle est révoquée (lot L2).
 *
 * Il prouve désormais l'inverse, et c'est le cas le plus important du parc :
 * une instance de PRODUCTION utilise les clés de PRODUCTION, quoi qu'un ancien
 * réglage prétende. `integrated-api-environment-routing.test.js` couvre le
 * versant TEST ; celui-ci couvre le versant PROD, celui où une erreur coûte de
 * l'argent réel.
 *
 * Runner autonome. */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'PROD'; // ENV applicatif = PROD
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'test_base';
process.env.DB_PROD = 'prod_base';
process.env.JWT_SECRET = 'test-secret-jwt-long-enough-32chars!!';
process.env.PORT = '4137';
process.env.CORS_ORIGINS = 'http://localhost:6061,http://localhost:6062';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
const { bootstrap } = await import('../config/bootstrap.js');
await connectDatabase();
await bootstrap();
// Le service est PRÊT : cette suite a fait elle-même tout ce que le démarrage fait.
await (await import("./helpers/serviceReady.helper.js")).markTestServiceReady();

const { IntegratedApi } = await import('../models/IntegratedApi.model.js');
const { getCredential, applicationEnvironment } = await import('../services/integratedApi.service.js');
const { encryptSecret, lastFourOf } = await import('../utils/integratedApiCrypto.js');
const cred = (v) => ({ encryptedValue: encryptSecret(v), lastFour: lastFourOf(v) });

console.log('\nPROD_SELECTS_PROD — quoi que dise le réglage hérité');
{
  check('ENV applicatif = PROD', applicationEnvironment() === 'PROD');

  const stripe = await IntegratedApi.findOne({ provider: 'STRIPE' });
  stripe.modes.TEST.credentials.set('secretKey', cred('sk_test_ENVPROD_TESTKEY'));
  stripe.modes.PROD.credentials.set('secretKey', cred('sk_live_ENVPROD_PRODKEY'));
  stripe.recomputeAll();

  /**
   * LE PIÈGE : `activeMode = TEST` sur une instance de PRODUCTION, les deux
   * mondes renseignés. C'est exactement la configuration de la base dormante
   * `sbauto06_prod` relevée par l'inventaire du parc — et c'est ce qui a permis
   * un paiement PAID en `environment: PROD`, `providerMode: TEST`.
   *
   * Sous la doctrine L2, ce réglage n'a plus aucun effet.
   */
  stripe.activeMode = 'TEST';
  await stripe.save();
  check('activeMode=TEST n a AUCUN effet : la cle LIVE est utilisee',
    (await getCredential('STRIPE', 'secretKey')) === 'sk_live_ENVPROD_PRODKEY');
  check('...et surtout pas la cle de test',
    (await getCredential('STRIPE', 'secretKey')) !== 'sk_test_ENVPROD_TESTKEY');

  stripe.activeMode = 'PROD';
  await stripe.save();
  check('activeMode=PROD ne change rien non plus : toujours la cle LIVE',
    (await getCredential('STRIPE', 'secretKey')) === 'sk_live_ENVPROD_PRODKEY');

  check('un mode explicite reste lisible pour le diagnostic',
    (await getCredential('STRIPE', 'secretKey', { mode: 'TEST' })) === 'sk_test_ENVPROD_TESTKEY');

  /**
   * AUCUN REPLI : on vide le monde de PRODUCTION en laissant celui de test
   * plein. Un repli reussirait — et ferait tourner une production sur un compte
   * de test. On exige l'echec.
   */
  stripe.modes.PROD.credentials.delete('secretKey');
  stripe.recomputeAll();
  await stripe.save();
  let refus = null;
  try { await getCredential('STRIPE', 'secretKey'); } catch (e) { refus = e.code; }
  check('cle PROD absente -> echec type, jamais un repli sur TEST', refus === 'UNFILLED');
  check('...alors que la cle de test est bien presente',
    Boolean(stripe.modes.TEST.credentials.get('secretKey')));

  stripe.modes.PROD.credentials.set('secretKey', cred('sk_live_ENVPROD_PRODKEY'));
  stripe.recomputeAll();
  await stripe.save();
}

// --- Outils de recette : INTERDITS en PROD ----------------------------------
// Ces outils terminent un contrat et purgent la base. Les cacher dans l'UI ne
// protège rien : le refus doit venir du SERVICE, donc valoir aussi pour un appel
// d'API direct. C'est le test qui l'impose.
console.log('\nOutils de recette sous ENV=PROD');
{
  const testTools = await import('../services/contractTestTools.service.js');
  const { Contract } = await import('../models/Contract.model.js');

  let guard = null;
  try { testTools.assertTestEnvironment(); } catch (e) { guard = e; }
  check('assertTestEnvironment refuse en PROD', guard?.statusCode === 403);
  check('message explicite', /réservé à l'environnement TEST/.test(guard?.message || ''));

  // Contrat fictif : la garde doit tomber AVANT toute logique métier.
  const fake = { _id: '000000000000000000000000', status: 'ACTIVE', stripe: { subscription: {} } };
  let endErr = null;
  try { await testTools.endContractNow(fake, null); } catch (e) { endErr = e; }
  check('endContractNow refusé en PROD (403)', endErr?.statusCode === 403);

  let resetErr = null;
  try { await testTools.resetRecette(null); } catch (e) { resetErr = e; }
  check('resetRecette refusé en PROD (403)', resetErr?.statusCode === 403);

  // Et surtout : rien n'a été détruit.
  check('aucune purge effectuée en PROD', (await Contract.countDocuments({})) === 0);
}

await disconnectDatabase();
await mongod.stop();
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
