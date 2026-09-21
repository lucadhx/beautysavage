/**
 * UNE GARDE QU'ON N'EXÉCUTE PAS NE GARDE RIEN.
 *
 * ══ LE DÉFAUT QUE CETTE SUITE FERME ═════════════════════════════════════════
 *
 * `panel-pairing-session.test.js` était rouge — dix contrôles sur vingt — dans
 * la baseline CERTIFIÉE. Pas depuis une semaine : depuis que le backend a gagné
 * sa garde de disponibilité, laquelle répond `503 SERVICE_STARTING` à toute
 * route métier tant que l'amorçage n'est pas déclaré terminé. La suite montait
 * son application à la main, ne déclarait rien, et lisait un défaut de session
 * là où il n'y avait qu'un service s'estimant encore en train de naître.
 *
 * Personne ne l'a vu, et la raison est simple : elle n'était pas dans la
 * chaîne `npm test`. Elle n'était pas seule — au moment d'écrire ces lignes,
 * 35 suites sur 146 étaient dans ce cas, dont des recettes de déploiement, de
 * duplication, de pont et d'amorçage du premier compte.
 *
 * Écrire une suite est un geste ; la BRANCHER en est un autre. Rien ne
 * rappelait le second, et il est celui qui compte : une garde hors chaîne ne
 * proteste jamais, et sa lente dérive vers le rouge est indolore.
 *
 * ══ CE QUE CETTE SUITE EXIGE ════════════════════════════════════════════════
 *
 * Toute suite de `src/scripts/*.test.js` appartient à l'un des deux ensembles,
 * et à aucun troisième :
 *
 *   · `npm test`             — elle passe, et elle protège ;
 *   · `npm run test:quarantine` — elle échoue POUR UNE RAISON CONNUE, elle est
 *     nommée, et sa dette est visible.
 *
 * La quarantaine n'est pas une poubelle : c'est une dette DÉCLARÉE. Ce qui est
 * interdit, c'est la troisième catégorie — celle qui n'existe nulle part et que
 * personne ne regarde.
 *
 * ══ POURQUOI PAS « TOUT DANS LA CHAÎNE » ════════════════════════════════════
 *
 * Parce qu'une chaîne rouge en permanence cesse d'être lue, et l'on retombe
 * exactement dans le défaut d'origine — cette fois avec 146 suites au lieu
 * d'une. Une dette nommée se solde ; une alarme constante s'ignore.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE_BACKEND = path.resolve(ICI, '../..');

let pass = 0;
let fail = 0;
const check = (n, c, detail = '') => {
  if (c) { pass += 1; console.log(`  ✓ ${n}`); }
  else { fail += 1; console.error(`  ✗ ${n}${detail ? ` — ${detail}` : ''}`); }
};

const pkg = JSON.parse(fs.readFileSync(path.join(RACINE_BACKEND, 'package.json'), 'utf8'));
const chaine = String(pkg.scripts?.test ?? '');
const quarantaine = String(pkg.scripts?.['test:quarantine'] ?? '');

const suites = fs.readdirSync(ICI).filter((f) => f.endsWith('.test.js')).sort();

console.log('\n1 · Chaque suite est branchée quelque part');
check('la chaîne `npm test` existe', chaine.length > 0);
check('la quarantaine est déclarée', quarantaine.length > 0);

/**
 * `vitrine-responsive` passe par un script nommé (elle exige
 * `--experimental-strip-types`) : on la reconnaît par ce script, pas par son
 * fichier, sinon la garde réclamerait une ligne qui ne saurait pas s'exécuter.
 */
const scriptsNommes = Object.values(pkg.scripts ?? {}).join(' && ');
const estBranchee = (f) => {
  if (chaine.includes(f) || quarantaine.includes(f)) return true;
  const nom = f.replace(/\.test\.js$/, '');
  return quarantaine.includes(`test:${nom}`) || (quarantaine.includes('vitrine-responsive') && nom === 'vitrine-responsive');
};

const orphelines = suites.filter((f) => !estBranchee(f));
check(
  `aucune suite orpheline (${suites.length} suites au total)`,
  orphelines.length === 0,
  orphelines.length
    ? `${orphelines.length} hors chaîne ET hors quarantaine : ${orphelines.slice(0, 8).join(', ')}${orphelines.length > 8 ? '…' : ''}`
    : '',
);

console.log('\n2 · La quarantaine reste une dette, pas un dépotoir');
const enQuarantaine = suites.filter((f) => quarantaine.includes(f));
/**
 * Un seuil, et il est bas exprès. La quarantaine doit rester assez petite pour
 * qu'on la lise en entier : au-delà, elle redevient le tiroir dont cette suite
 * existe pour empêcher la réouverture.
 */
const PLAFOND = 8;
check(
  `la quarantaine tient en ${PLAFOND} suites (actuellement ${enQuarantaine.length})`,
  enQuarantaine.length <= PLAFOND,
  enQuarantaine.join(', '),
);
check('une suite n’est pas à la fois dans la chaîne et en quarantaine',
  !suites.some((f) => chaine.includes(f) && quarantaine.includes(f)),
  suites.filter((f) => chaine.includes(f) && quarantaine.includes(f)).join(', '));

console.log('\n3 · Les suites nées de la fabrique sont dans la chaîne');
/**
 * Les recettes qui gardent la DUPLICATION et le PREMIER COMPTE sont celles dont
 * la sortie de chaîne coûte le plus cher : elles ne protègent pas un écran,
 * elles protègent la naissance d'un projet client. Elles sont nommées ici pour
 * qu'un retrait soit un geste explicite, et non un oubli.
 */
for (const critique of [
  'duplication.test.js',
  'duplication-phases.test.js',
  'duplication-stream.test.js',
  'seed-dev-account.test.js',
  'first-admin-bootstrap.test.js',
  'panel-pairing-session.test.js',
  'federated-dev-identity.test.js',
  'docs-runtime-sync.test.js',
]) {
  check(`${critique} est dans la chaîne`, chaine.includes(critique));
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
