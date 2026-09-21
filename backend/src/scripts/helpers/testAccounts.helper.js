import { User } from '../../models/User.model.js';
import { ROLES, USER_STATUS } from '../../utils/constants.js';

/**
 * LES COMPTES DE RECETTE — un DÉCOR DE TEST, plus jamais un produit (LOT 2C).
 *
 * ══ CE QUI A CHANGÉ, ET POURQUOI CE FICHIER EXISTE ══════════════════════════
 *
 * `dev@mail.com / 123dev` et `admin@mail.com / 123admin` étaient créés par
 * `src/config/bootstrap.js` — donc par le PRODUIT, sur chaque projet dupliqué,
 * y compris en production. C'était la faille : un secret identique sur tout le
 * parc, connu de quiconque a lu un README.
 *
 * Les mêmes valeurs, écrites ICI, ne sont plus la même chose. Ce fichier vit
 * sous `scripts/`, n'est importé que par des suites de test, et n'écrit que
 * dans une base éphémère montée en mémoire pour la durée d'un test. Un mot de
 * passe connu dans un décor jetable n'est pas un credential : c'est une
 * constante de test, au même titre qu'un `whsec_stripe_test_secret`.
 *
 * La distinction n'est pas rhétorique — elle est VÉRIFIABLE, et le scan de
 * sécurité du lot la vérifie : aucune de ces valeurs ne doit apparaître hors de
 * `scripts/`, et le code produit ne doit posséder aucun chemin qui les
 * fabrique.
 *
 * ══ POURQUOI LES COMPTES SONT `ACTIVE` ET NON `PENDING_ACTIVATION` ══════════
 *
 * Ces suites éprouvent le MÉTIER, pas l'amorçage. Leur faire traverser un
 * parcours d'activation par e-mail à chaque démarrage n'éprouverait rien de
 * plus et rendrait chaque suite dépendante de la plateforme d'envoi. Le
 * parcours d'activation, lui, a sa propre suite — `local-dev-bootstrap.test.js`
 * — qui part d'une base vide et ne pose aucun mot de passe à la main.
 */
export const TEST_ACCOUNTS = Object.freeze([
  { email: 'dev@mail.com', password: '123dev', name: 'Développeur', role: ROLES.DEV },
  { email: 'admin@mail.com', password: '123admin', name: 'Administrateur', role: ROLES.ADMIN },
]);

/**
 * Pose le décor. IDEMPOTENT : une suite qui l'appelle deux fois, ou après un
 * `bootstrap()` ayant déjà créé un compte, ne casse pas.
 */
export async function seedTestAccounts() {
  const created = [];
  for (const compte of TEST_ACCOUNTS) {
    if (await User.findOne({ email: compte.email })) continue;
    await User.create({ ...compte, status: USER_STATUS.ACTIVE });
    created.push(compte.email);
  }
  return created;
}

export default seedTestAccounts;
