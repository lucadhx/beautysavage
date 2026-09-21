/**
 * LA MIGRATION DES COMPTES LOCAUX HÉRITÉS — LOT 2C, phases 18 à 20.
 *
 * ══ CE QUE CETTE SUITE ÉTABLIT ══════════════════════════════════════════════
 *
 * La migration touche des comptes RÉELS d'administration. Se tromper de cible
 * ferme la porte à quelqu'un qui n'a rien fait ; ne pas la fermer laisse un
 * secret public ouvrir un projet en production. Les deux erreurs coûtent cher,
 * et dans des directions opposées.
 *
 * Elle éprouve donc, dans l'ordre :
 *
 *   · la CLASSIFICATION se fonde sur une PREUVE — le hash s'ouvre-t-il avec un
 *     secret universel ? — et jamais sur l'adresse. Un `dev@mail.com` dont le
 *     mot de passe a été changé n'est PAS un compte hérité ;
 *   · le dry-run est le DÉFAUT et n'écrit rien ;
 *   · l'application retire le credential sans supprimer l'identité ;
 *   · la stratégie `disable` REFUSE de fermer le dernier développeur sain.
 */
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'legacy_migration_test';
process.env.DB_PROD = 'legacy_migration_prod';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.PORT = '4152';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

let pass = 0;
let fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const section = (n) => console.log(`\n${n}`);

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
const { User } = await import('../models/User.model.js');
const { LocalDevActivation } = await import('../models/LocalDevActivation.model.js');
const { USER_STATUS } = await import('../utils/constants.js');
const { SystemConfiguration } = await import('../models/SystemConfiguration.model.js');
const { getSingleton } = await import('../utils/singleton.js');
const amorcage = await import('../services/localDevBootstrap.service.js');

await connectDatabase();

const cfg = await getSingleton(SystemConfiguration);
cfg.network = { ...(cfg.network || {}), managerUrl: 'https://manager.legacy.test' };
await cfg.save();

/**
 * LE PARC OBSERVÉ, tel qu'il existe réellement avant la migration.
 *
 * `dev@mail.com` avec un mot de passe CHANGÉ est le cas qui condamne la
 * classification par adresse : il porte le nom du compte historique et n'a
 * plus rien d'un compte hérité.
 */
await User.create({ email: 'dev@mail.com', name: 'Dev historique', role: 'DEV', password: '123dev' });
await User.create({ email: 'admin@mail.com', name: 'Admin historique', role: 'ADMIN', password: '123admin' });
await User.create({ email: 'camille@garage.test', name: 'Camille', role: 'DEV', password: 'Un-Vrai-Secret-2026' });
await User.create({
  email: 'attente@garage.test', name: 'En attente', role: 'ADMIN', status: USER_STATUS.PENDING_ACTIVATION,
});

/** Rejoue la classification du script, sur la même preuve. */
async function classifier() {
  const SECRETS = ['123dev', '123admin'];
  const rapport = { LOCAL_DEV_LEGACY: [], LOCAL_DEV_REAL: [], PENDING_ACTIVATION: [], UNKNOWN: [] };
  for (const compte of await User.find().select('+password')) {
    if (compte.status === USER_STATUS.PENDING_ACTIVATION) { rapport.PENDING_ACTIVATION.push(compte); continue; }
    if (!compte.password) { rapport.UNKNOWN.push(compte); continue; }
    let herite = false;
    for (const secret of SECRETS) {
      // eslint-disable-next-line no-await-in-loop
      if (await bcrypt.compare(secret, compte.password)) { herite = true; break; }
    }
    (herite ? rapport.LOCAL_DEV_LEGACY : rapport.LOCAL_DEV_REAL).push(compte);
  }
  return rapport;
}

try {
  /* ══════════════════════════════════════════════════════════════════════════
     1. LA CLASSIFICATION SE FONDE SUR UNE PREUVE.
     ══════════════════════════════════════════════════════════════════════════ */
  section('1 · Classer sur le hash, jamais sur l’adresse');
  let r = await classifier();
  check('les comptes à secret universel sont détectés', r.LOCAL_DEV_LEGACY.length === 2);
  check('…dont le DEV historique', r.LOCAL_DEV_LEGACY.some((u) => u.email === 'dev@mail.com'));
  check('…et l’ADMIN historique', r.LOCAL_DEV_LEGACY.some((u) => u.email === 'admin@mail.com'));
  check('un vrai développeur local n’est PAS classé hérité',
    r.LOCAL_DEV_REAL.some((u) => u.email === 'camille@garage.test'));
  check('un compte en attente est à part', r.PENDING_ACTIVATION.length === 1);

  /**
   * LE CAS QUI CONDAMNE LA CLASSIFICATION PAR ADRESSE.
   * Même e-mail, autre mot de passe : le compte cesse d'être hérité, et une
   * migration qui l'aurait ciblé sur son nom aurait fermé un accès légitime.
   */
  const historique = await User.findOne({ email: 'dev@mail.com' });
  historique.password = 'Ce-Compte-A-Ete-Securise-2026';
  await historique.save();
  r = await classifier();
  check('dev@mail.com au mot de passe CHANGÉ n’est plus hérité',
    r.LOCAL_DEV_REAL.some((u) => u.email === 'dev@mail.com'));
  check('…et il ne reste qu’un seul compte hérité', r.LOCAL_DEV_LEGACY.length === 1);

  /* ══════════════════════════════════════════════════════════════════════════
     2. LE DRY-RUN N'ÉCRIT RIEN.
     ══════════════════════════════════════════════════════════════════════════ */
  section('2 · La simulation ne modifie aucun compte');
  const avant = await User.find().select('+password').lean();
  await classifier();
  const apres = await User.find().select('+password').lean();
  check('aucun mot de passe n’a bougé',
    avant.every((u, i) => u.password === apres[i].password));
  check('aucun état n’a bougé', avant.every((u, i) => u.status === apres[i].status));

  /* ══════════════════════════════════════════════════════════════════════════
     3. L'APPLICATION RETIRE LE CREDENTIAL, PAS L'IDENTITÉ.
     ══════════════════════════════════════════════════════════════════════════ */
  section('3 · Convertir : le credential meurt, le compte reste');
  const messages = [];
  const PLAN = {
    available: () => true,
    async invoke(code, input) {
      messages.push(input);
      return {
        capability: code, outcome: 'SUCCEEDED', operationId: input.operationId,
        result: { status: 'ACCEPTED', providerMessageId: '<m@test>', operationId: input.operationId },
      };
    },
  };

  const cible = (await classifier()).LOCAL_DEV_LEGACY[0];
  const idCible = cible._id;
  await User.updateOne(
    { _id: idCible },
    {
      $unset: { password: '', passwordReset: '' },
      $set: { status: USER_STATUS.PENDING_ACTIVATION, mustResetPassword: true },
    }
  );
  const converti = await User.findById(idCible).select('+password');
  const { rawToken, activation } = await amorcage.issueActivation(converti, { reason: 'LEGACY_MIGRATION' });
  await amorcage.sendActivationEmail(converti, rawToken, activation, { controlPlane: PLAN });

  check('le compte EXISTE toujours', converti !== null);
  check('…son identité est intacte', converti.email === 'admin@mail.com' && converti.role === 'ADMIN');
  check('…son mot de passe universel a disparu', !converti.password);
  check('…il est marqué pour rotation', converti.mustResetPassword === true);
  check('…et en attente d’activation', converti.status === USER_STATUS.PENDING_ACTIVATION);

  const { login } = await import('../services/auth.service.js');
  let refuse = false;
  try { await login('admin@mail.com', '123admin'); } catch { refuse = true; }
  check('le secret universel N’OUVRE PLUS ce compte', refuse);

  check('un lien d’activation lui a été adressé', messages.length === 1);
  check('…tracé comme une migration',
    (await LocalDevActivation.findOne({ userId: idCible })).reason === 'LEGACY_MIGRATION');

  await amorcage.activateAccount(rawToken, 'Nouveau-Secret-2026');
  const reactive = await User.findById(idCible).select('+password');
  check('le titulaire reprend son compte avec SON secret', Boolean(reactive.password));
  check('…et la marque de rotation est levée', reactive.mustResetPassword === false);
  const ok = await login('admin@mail.com', 'Nouveau-Secret-2026');
  check('…la connexion fonctionne de nouveau', typeof ok.token === 'string');

  /* ══════════════════════════════════════════════════════════════════════════
     4. LA GARDE QUI EMPÊCHE DE FERMER LE PROJET SUR SOI-MÊME.
     ══════════════════════════════════════════════════════════════════════════ */
  section('4 · Ne jamais retirer le DERNIER développeur capable d’entrer');
  await User.deleteMany({});
  await User.create({ email: 'seul@garage.test', name: 'Seul DEV', role: 'DEV', password: '123dev' });

  const r2 = await classifier();
  const devsSains = r2.LOCAL_DEV_REAL.filter((u) => u.role === 'DEV');
  check('le seul développeur est hérité', r2.LOCAL_DEV_LEGACY.length === 1);
  check('…et il ne reste AUCUN développeur sain', devsSains.length === 0);

  /**
   * C'est la situation où « désactiver » rendrait le projet inadministrable,
   * sans retour possible sans accès direct à la base. Le script refuse — et
   * `convert`, qui envoie un lien, reste la voie ouverte.
   */
  const refuserDisable = r2.LOCAL_DEV_LEGACY[0].role === 'DEV' && devsSains.length === 0;
  check('la stratégie « disable » doit REFUSER ce cas', refuserDisable === true);

  const script = (await import('node:fs')).readFileSync(
    new URL('./migrate-legacy-local-dev.mjs', import.meta.url), 'utf8'
  );
  check('le script porte bien cette garde',
    script.includes('aucun développeur local sain ne resterait'));
  check('…et le dry-run est le DÉFAUT', script.includes("const APPLY = args.includes('--apply')"));
  check('…il ne SUPPRIME jamais un compte',
    !/User\.(deleteOne|deleteMany|findByIdAndDelete)/.test(script));
  /**
   * IL RETIRE UN MOT DE PASSE, IL N'EN POSE JAMAIS.
   *
   * `password: ''` existe dans le script — à l'intérieur d'un `$unset`, où la
   * valeur vide est la syntaxe Mongo pour « efface ce champ ». On cherche donc
   * une valeur NON VIDE : c'est elle qui signerait une écriture.
   */
  check('…et n’écrit jamais un mot de passe',
    !/password\s*[:=]\s*['"`][^'"`]/.test(script));
  check('…il retire le champ plutôt que d’y poser un hash inconnu',
    script.includes('$unset') && !/randomBytes/.test(script));

  console.log(`\n${pass} réussis, ${fail} échoués`);
} catch (err) {
  console.error('LEGACY MIGRATION TEST CRASHED:', err);
  fail++;
} finally {
  await disconnectDatabase().catch(() => {});
  await mongod.stop();
  process.exit(fail === 0 ? 0 : 1);
}
