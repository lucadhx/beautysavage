/* Typographie du thème vitrine : catalogue allowlist, défauts historiques,
 * enum Mongoose (jamais de famille CSS libre), compatibilité des anciens
 * thèmes. Mongo mémoire, aucun réseau. */
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.ENV = 'TEST';
process.env.DB_TEST = 'typo_test';
process.env.DB_PROD = 'typo_prod';
process.env.JWT_SECRET = 'x'.repeat(48);
process.env.INTEGRATED_API_ENCRYPTION_KEY = 'a'.repeat(64);
const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const section = (n) => console.log(`\n${n}`);

const { FONT_CATALOG, FONT_IDS, DEFAULT_TYPOGRAPHY, fontById } = await import('../utils/fontCatalog.js');
const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();
const { Theme } = await import('../models/Theme.model.js');

try {
  section('1. Catalogue — allowlist code-first');
  check('ids uniques', new Set(FONT_IDS).size === FONT_CATALOG.length);
  check('chaque entrée complète', FONT_CATALOG.every((f) => f.id && f.label && f.cssFamily && f.category && f.previewText && f.availableWeights.length > 0 && f.source));
  check('les défauts existent dans le catalogue', Boolean(fontById(DEFAULT_TYPOGRAPHY.headingFont) && fontById(DEFAULT_TYPOGRAPHY.bodyFont)));
  check('défauts = rendu historique (Poppins/Inter)', DEFAULT_TYPOGRAPHY.headingFont === 'poppins' && DEFAULT_TYPOGRAPHY.bodyFont === 'inter');
  check('police système présente (secours)', Boolean(fontById('system')));
  check('id inconnu -> null', fontById('comic-sans') === null);

  section('2. Modèle — défauts et validation');
  const fresh = new Theme();
  /**
   * LES DÉFAUTS DU PROJET NE SONT PAS CEUX DU CATALOGUE — et c'est le sujet.
   *
   * `DEFAULT_TYPOGRAPHY` reste le défaut GÉNÉRIQUE du catalogue de polices,
   * partagé par tout le parc. `Theme` porte, lui, les défauts de CE projet :
   * L.Y Solution titre en Manrope, une grotesque géométrique qui tient la
   * ligne fine et le grand corps que le plan de site demande. Le corps de
   * texte reste Inter.
   *
   * On vérifie donc les deux séparément : que le catalogue n'a pas bougé
   * (ci-dessus), et que le modèle applique bien le choix du projet.
   */
  check('nouveau thème : défauts du PROJET posés',
    fresh.typography.headingFont === 'manrope' && fresh.typography.bodyFont === 'inter');
  check('…et ils appartiennent au catalogue',
    Boolean(fontById(fresh.typography.headingFont) && fontById(fresh.typography.bodyFont)));
  const okDoc = new Theme({ typography: { headingFont: 'montserrat', bodyFont: 'manrope' } });
  check('sélection valide acceptée', (await okDoc.validate().then(() => true).catch(() => false)) === true);
  const bad = new Theme({ typography: { headingFont: 'comic-sans', bodyFont: 'inter' } });
  check('police INCONNUE refusée (enum)', (await bad.validate().then(() => false).catch(() => true)) === true);
  const injected = new Theme({ typography: { headingFont: "'Evil'; background:url(x)", bodyFont: 'inter' } });
  check('valeur CSS libre refusée', (await injected.validate().then(() => false).catch(() => true)) === true);

  section('3. Compatibilité — ancien thème sans typographie');
  // Document ANTÉRIEUR inséré brut (sans le bloc typography).
  await Theme.collection.insertOne({ colors: { background: '#000', foreground: '#fff', primary: '#25b', accent: '#3bf' }, radius: '0.85rem' });
  const legacy = await Theme.findOne({ radius: '0.85rem' });
  check('lecture : défauts appliqués (rendu inchangé)',
    legacy.typography.headingFont === 'manrope' && legacy.typography.bodyFont === 'inter');
  legacy.typography.headingFont = 'oswald';
  await legacy.save();
  const reread = await Theme.findById(legacy._id);
  check('persistance de la sélection', reread.typography.headingFont === 'oswald' && reread.typography.bodyFont === 'inter');

  console.log(`\n${pass} réussis, ${fail} échoués`);
} catch (err) {
  console.error('TYPOGRAPHY TEST CRASHED:', err);
  fail++;
} finally {
  await disconnectDatabase();
  await mongod.stop();
  process.exit(fail === 0 ? 0 : 1);
}
