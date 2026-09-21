/* LE PROJET, CONSOMMATEUR DES MODÈLES DU PANEL — et rien d'autre (L12.1).
 *
 * ══ CE QUE CE FICHIER TESTAIT, ET POURQUOI IL A ÉTÉ REMPLACÉ ════════════════
 *
 * Huit cents lignes éprouvant une base de modèles LOCALE : le registre, le
 * validateur de HTML, le moteur de rendu, l'amorçage en base, la version
 * optimiste, l'historique, la restauration. Tout cela existe encore — chez le
 * Panel, qui en est la seule autorité. Ici, plus rien de tout cela n'existe.
 *
 * Le remplacer par un fichier vide aurait laissé un trou : la question « ce
 * projet consomme-t-il correctement l'autorité ? » n'était couverte nulle part.
 *
 * ══ CE QUI EST ÉPROUVÉ MAINTENANT ═══════════════════════════════════════════
 *
 *   1. le cache de CONTRAT ne contient que du vocabulaire — jamais de contenu ;
 *   2. la validation locale porte sur ce que le projet FOURNIT, à l'aune du
 *      contrat du Panel, et ne bloque JAMAIS en l'absence de contrat ;
 *   3. les empreintes remontées au Panel sont celles qu'il a servies ;
 *   4. sans Panel appairé, toute lecture REFUSE — jamais de repli local.
 *
 * Base en mémoire, aucun réseau. Runner autonome. */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'test_base';
process.env.DB_PROD = 'prod_base';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.PORT = '4166';
process.env.INTEGRATED_API_ENCRYPTION_KEY = '0'.repeat(64);

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }
async function codeOf(fn) {
  try { await fn(); return null; } catch (e) { return e.code || e.name; }
}

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();

const contrat = await import('../services/email/emailTemplateContract.service.js');
const { EmailTemplateContract } = await import('../models/EmailTemplateContract.model.js');

/** La projection telle que le pont la sert — la FORME exacte du contrat. */
const PROJECTION = [
  {
    templateId: 'PASSWORD_RESET_REQUEST',
    name: 'Compte — réinitialisation du mot de passe',
    subject: 'Réinitialisation de votre mot de passe',
    html: '<!DOCTYPE html><p>ne doit jamais être mis en cache</p>',
    enabled: true,
    configured: true,
    usable: true,
    version: 3,
    ownedBy: 'PROJECT',
    variableContractFingerprint: 'empreinte-servie-par-le-panel',
    variables: [
      { key: 'company.name', label: 'Entreprise', description: '', type: 'TEXT', required: true },
      { key: 'reset.url', label: 'Lien', description: '', type: 'URL', required: true },
      { key: 'reset.expiresIn', label: 'Délai', description: '', type: 'TEXT', required: false },
    ],
  },
  {
    templateId: 'CONTACT_ADMIN_NOTIFICATION',
    name: 'Contact',
    subject: 'Nouvelle demande',
    enabled: true,
    configured: true,
    usable: true,
    version: 1,
    ownedBy: 'PROJECT',
    variableContractFingerprint: 'empreinte-contact',
    variables: [{ key: 'contact.name', label: '', description: '', type: 'TEXT', required: true }],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
section('1 · Le cache ne conserve QUE du vocabulaire');
{
  await contrat.cacheContracts(PROJECTION);

  const docs = await EmailTemplateContract.find({}).lean();
  check('un document par modèle servi', docs.length === 2);

  const brut = JSON.stringify(docs);
  check('AUCUN sujet n’est conservé', !brut.includes('Réinitialisation de votre mot de passe'));
  check('AUCUN HTML n’est conservé', !brut.includes('<!DOCTYPE html>'));
  check('AUCUNE version de contenu n’est conservée', !docs.some((d) => 'version' in d));
  check('AUCUN interrupteur n’est conservé', !docs.some((d) => 'enabled' in d));

  const reset = docs.find((d) => d.templateCode === 'PASSWORD_RESET_REQUEST');
  check('les variables sont conservées', reset.variables.length === 3);
  check('leur obligation est conservée',
    reset.variables.find((v) => v.key === 'reset.url').required === true);
  check('leur type est conservé',
    reset.variables.find((v) => v.key === 'reset.url').type === 'URL');
  check('l’empreinte est TRANSPORTÉE, jamais recalculée',
    reset.fingerprint === 'empreinte-servie-par-le-panel');
  check('la date de lecture est tracée', typeof reset.refreshedAt === 'string');
}

// ═══════════════════════════════════════════════════════════════════════════
section('2 · Le cache CONVERGE — un modèle retiré disparaît');
{
  await contrat.cacheContracts([PROJECTION[0]]);
  const restants = await EmailTemplateContract.find({}).select('templateCode').lean();
  check('le modèle retiré de la projection quitte le cache', restants.length === 1);
  check('le modèle encore servi reste', restants[0].templateCode === 'PASSWORD_RESET_REQUEST');

  /**
   * POURQUOI LA CONVERGENCE COMPTE ICI.
   *
   * Le contrat conservé alimente la déclaration d'usage renvoyée au Panel.
   * Garder l'empreinte d'un modèle que ce projet ne consomme plus le ferait
   * ressortir dans cette déclaration, et le Panel reposerait une instance que
   * personne ne demande — exactement le genre d'instance orpheline que ce lot
   * archive côté Panel.
   */
  await contrat.cacheContracts(PROJECTION);
  check('une nouvelle projection le repose', (await EmailTemplateContract.countDocuments()) === 2);
}

// ═══════════════════════════════════════════════════════════════════════════
section('3 · Les empreintes remontées sont celles servies par le Panel');
{
  const empreintes = await contrat.contractFingerprints();
  check('une empreinte par modèle', Object.keys(empreintes).length === 2);
  check('l’empreinte du modèle de mot de passe',
    empreintes.PASSWORD_RESET_REQUEST === 'empreinte-servie-par-le-panel');
  check('l’empreinte du modèle de contact',
    empreintes.CONTACT_ADMIN_NOTIFICATION === 'empreinte-contact');

  /** Une empreinte vide n'est pas une empreinte : elle ne doit pas être annoncée. */
  await EmailTemplateContract.updateOne(
    { templateCode: 'CONTACT_ADMIN_NOTIFICATION' }, { $set: { fingerprint: '' } },
  );
  const partielles = await contrat.contractFingerprints();
  check('une empreinte vide n’est PAS annoncée au Panel',
    partielles.CONTACT_ADMIN_NOTIFICATION === undefined);
  await contrat.cacheContracts(PROJECTION);
}

// ═══════════════════════════════════════════════════════════════════════════
section('4 · La validation porte sur ce que le PROJET fournit');
{
  const bonnes = new Map([
    ['company.name', 'SB Auto'],
    ['reset.url', 'https://exemple.fr/reset'],
  ]);
  check('des valeurs conformes ne produisent aucun problème',
    (await contrat.validateProvidedVariables('PASSWORD_RESET_REQUEST', bonnes)).length === 0);

  const manquante = new Map([['company.name', 'SB Auto']]);
  const p1 = await contrat.validateProvidedVariables('PASSWORD_RESET_REQUEST', manquante);
  check('une variable OBLIGATOIRE absente est signalée',
    p1.some((p) => p.code === 'MISSING_REQUIRED_VARIABLE' && p.variable === 'reset.url'));

  const vide = new Map([...bonnes, ['reset.url', '   ']]);
  check('une variable obligatoire VIDE est signalée aussi',
    (await contrat.validateProvidedVariables('PASSWORD_RESET_REQUEST', vide))
      .some((p) => p.code === 'MISSING_REQUIRED_VARIABLE'));

  const inconnue = new Map([...bonnes, ['reset.inventee', 'x']]);
  const p2 = await contrat.validateProvidedVariables('PASSWORD_RESET_REQUEST', inconnue);
  check('une variable INCONNUE du contrat est signalée',
    p2.some((p) => p.code === 'UNKNOWN_VARIABLE' && p.variable === 'reset.inventee'));

  check('une variable facultative absente ne gêne pas',
    (await contrat.validateProvidedVariables('PASSWORD_RESET_REQUEST', bonnes)).length === 0);

  check('un objet simple est accepté comme une Map',
    (await contrat.validateProvidedVariables('PASSWORD_RESET_REQUEST', {
      'company.name': 'SB Auto', 'reset.url': 'https://exemple.fr/reset',
    })).length === 0);
}

// ═══════════════════════════════════════════════════════════════════════════
section('5 · Un contrat INCONNU ne bloque JAMAIS — le Panel reste l’autorité');
{
  /**
   * ══ L'INVARIANT LE PLUS IMPORTANT DE CE FICHIER ═══════════════════════════
   *
   * Un projet qui n'a pas encore lu son contrat — démarrage, Panel injoignable
   * au boot, première mise en service — doit pouvoir envoyer. Refuser ici
   * recréerait exactement le veto local que ce lot supprime, simplement déplacé
   * du contenu vers le vocabulaire.
   */
  check('aucun contrat connu -> aucun problème signalé',
    (await contrat.validateProvidedVariables('MODELE_JAMAIS_LU', { quoi: 'que ce soit' })).length === 0);

  await EmailTemplateContract.updateOne(
    { templateCode: 'CONTACT_ADMIN_NOTIFICATION' }, { $set: { variables: [] } },
  );
  check('contrat connu mais SANS variable -> aucun problème signalé',
    (await contrat.validateProvidedVariables('CONTACT_ADMIN_NOTIFICATION', { 'x.y': 1 })).length === 0);
  await contrat.cacheContracts(PROJECTION);
}

// ═══════════════════════════════════════════════════════════════════════════
section('6 · Sans Panel appairé, toute lecture REFUSE — jamais de repli local');
{
  check('la projection se déclare indisponible', contrat.templateProjectionAvailable() === false);

  for (const [nom, appel] of [
    ['liste', () => contrat.listProjection()],
    ['détail', () => contrat.getProjectionEntry('PASSWORD_RESET_REQUEST')],
    ['aperçu', () => contrat.previewProjection('PASSWORD_RESET_REQUEST')],
    ['diagnostic', () => contrat.projectionReadiness('PASSWORD_RESET_REQUEST')],
    ['envoi de test', () => contrat.sendProjectionTest('PASSWORD_RESET_REQUEST', 'a@b.fr')],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const code = await codeOf(appel);
    check(`${nom} : refus explicite (${code})`, code === 'BRIDGE_NOT_PAIRED');
  }

  /**
   * Et le CACHE, lui, ne sert JAMAIS de repli d'affichage. Il contient
   * pourtant deux contrats à cet instant : s'ils suffisaient à peupler un
   * écran, la copie locale serait de retour sous un autre nom.
   */
  check('le cache contient bien des contrats…', (await EmailTemplateContract.countDocuments()) === 2);
  check('…et il ne sert pourtant pas de repli à la lecture',
    (await codeOf(() => contrat.listProjection())) === 'BRIDGE_NOT_PAIRED');

  const rapport = await contrat.refreshContracts();
  check('le rafraîchissement ne LÈVE pas quand le pont manque', rapport.refreshed === false);
  check('…et il en donne la raison', rapport.reason === 'NOT_PAIRED');
}

// ---------------------------------------------------------------------------
await disconnectDatabase();
await mongod.stop();

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
