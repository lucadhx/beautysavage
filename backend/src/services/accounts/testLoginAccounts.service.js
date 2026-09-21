// LE WIDGET DE CONNEXION RAPIDE — sa seule source, et ses règles (L12.D).
//
// ══ CE QUE CE MODULE RÉPARE ═════════════════════════════════════════════════
//
// Le widget de recette lisait `User` directement, avec un filtre
// `{ status: 'ACTIVE' }`. Deux défauts, et le second est celui qui l'a rendu
// inutile :
//
//   1. UN FILTRE SUR UN CHAMP AJOUTÉ APRÈS COUP. Les comptes créés avant le
//      LOT 2C n'ont pas de `status` EN BASE — le défaut du schéma s'applique à
//      l'écriture, jamais à la relecture d'un document déjà écrit. Une égalité
//      Mongo ne matche pas un champ absent : ces comptes-là avaient disparu de
//      la liste, en silence.
//
//   2. UNE SEULE POPULATION. Depuis la fédération, le développeur du projet
//      n'a plus de compte local : son identité vit au Panel et se projette ici
//      en `ExternalPrincipal`. Le widget ne connaissait que `User`, donc il ne
//      pouvait plus proposer précisément la personne pour qui il existe.
//
// ══ L'AUTORITÉ EST CELLE DU PROJET, PAS UNE LISTE PARALLÈLE ═════════════════
//
// On appelle `listProjectAccounts()` — la MÊME lecture que `/api/accounts/all`
// et que le pont sert au Panel. Le widget n'a donc aucune liste à lui : un
// compte créé apparaît, un compte supprimé disparaît, et il n'existe aucun
// décor semé qui puisse mentir sur l'état réel du projet.
//
// ══ CE QU'IL N'EST PAS ═════════════════════════════════════════════════════
//
// Ce n'est pas un contournement. Il ne fabrique aucun mot de passe, aucun
// jeton, aucune assertion. Pour un compte LOCAL il désigne le mécanisme TEST
// existant ; pour un accès PANEL il ne désigne QUE le vrai parcours fédéré,
// qui reste arbitré par le Panel — appairage, rôle, `projectAccess`.
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { listProjectAccounts } from './projectAccounts.service.js';
import {
  ACCOUNT_SOURCES,
  ACCOUNT_STATUS,
  PRINCIPAL_TYPES,
  SOURCE_LABEL,
} from './projectAccountView.js';
import {
  panelUrlForFederation,
  projectIdForFederation,
} from '../panelBridge/capabilityClient.js';

/**
 * COMMENT ON ENTRE, SELON CE QU'ON EST.
 *
 * Deux modes, jamais un troisième, et surtout jamais un mode « au choix » :
 * c'est la NATURE du principal qui décide, pas une préférence d'écran. Sans
 * cela, quelqu'un finirait par tenter un `dev-login` sur une identité Panel —
 * ce qui supposerait de lui inventer un compte local, donc un mot de passe.
 */
export const TEST_LOGIN_MODES = Object.freeze({
  LOCAL_TEST: 'LOCAL_TEST',
  FEDERATED_TEST: 'FEDERATED_TEST',
});

/** Pourquoi une ligne n'est pas cliquable. `null` quand elle l'est. */
export const TEST_LOGIN_BLOCKERS = Object.freeze({
  /** Projet autonome : aucune fédération n'est possible d'ici. */
  PANEL_NOT_PAIRED: 'PANEL_NOT_PAIRED',
  /** Le dernier contact avec le Panel disait « accès retiré ». */
  PANEL_ACCESS_REVOKED: 'PANEL_ACCESS_REVOKED',
  /** Compte local fermé. */
  LOCAL_DISABLED: 'LOCAL_DISABLED',
});

/**
 * LES CHAMPS DU DTO, DANS L'ORDRE. Sert la garde de forme des suites : un
 * écran et une recette qui recopient la liste finissent par en oublier un.
 */
export const TEST_LOGIN_ACCOUNT_FIELDS = Object.freeze([
  'id',
  'displayName',
  'email',
  'role',
  'source',
  'principalType',
  'enabled',
  'status',
  'loginMode',
  'connectable',
  'blockedReason',
]);

/**
 * LE RÔLE QU'UN PROJET PEUT CONNAÎTRE. Tout le reste est une hiérarchie
 * étrangère — voir `assertProjectRole`.
 */
const PROJECT_ROLES = Object.freeze(['DEV', 'ADMIN']);

/**
 * GARDE DE NON-FUITE — la hiérarchie du Panel ne franchit pas la frontière.
 *
 * ══ POURQUOI UNE GARDE ICI, ALORS QUE TROIS COUCHES LA TIENNENT DÉJÀ ════════
 *
 * Le Panel projette `DEV` à l'émission ; son vérificateur REFUSE une assertion
 * qui porterait autre chose ; `panelAccountView` retombe sur `DEV`. Trois
 * gardes, et pourtant celle-ci n'est pas redondante : elle est la DERNIÈRE
 * avant l'écran, et c'est la seule qui protège le cas où la valeur n'est pas
 * venue d'une assertion — une projection écrite avant que la règle n'existe,
 * une reprise de base, une écriture manuelle.
 *
 * Elle CORRIGE plutôt qu'elle ne lève : un rôle inconnu à l'écran ne doit pas
 * casser l'écran, il doit être ramené à ce que le projet sait lire. Et elle
 * le DIT dans le journal — une correction silencieuse serait un défaut qu'on
 * ne verrait jamais.
 */
function assertProjectRole(role, contexte) {
  if (PROJECT_ROLES.includes(role)) return role;
  logger.warn(
    `[test-login] rôle non projeté « ${role} » sur ${contexte} — ramené à DEV. `
    + 'La hiérarchie du Panel ne doit pas franchir la frontière du projet.',
  );
  return 'DEV';
}

/**
 * LE PROJET PEUT-IL FÉDÉRER, DEPUIS ICI ?
 *
 * Préconditions LOCALES uniquement — appairage présent, adresse du Panel et
 * identité de projet connues. On n'appelle PAS le Panel : l'écran de connexion
 * s'affiche à chaque visite, et le faire dépendre d'un aller-retour réseau
 * rendrait le login LOCAL tributaire de la disponibilité du Panel. C'est la
 * même doctrine que `describeFederation`, et elle vaut ici pour la même raison.
 */
function federationAvailability() {
  const panelUrl = panelUrlForFederation();
  const projectId = projectIdForFederation();
  return { available: Boolean(panelUrl && projectId), paired: Boolean(projectId) };
}

/** Un compte LOCAL, vu par le widget. */
function toLocalTestAccount(compte) {
  const connectable = compte.enabled === true;
  return {
    id: compte.id,
    displayName: compte.displayName,
    email: compte.email,
    role: assertProjectRole(compte.role, `le compte local ${compte.id}`),
    source: ACCOUNT_SOURCES.LOCAL,
    principalType: PRINCIPAL_TYPES.LOCAL_USER,
    enabled: compte.enabled,
    status: compte.status,
    loginMode: TEST_LOGIN_MODES.LOCAL_TEST,
    connectable,
    blockedReason: connectable ? null : TEST_LOGIN_BLOCKERS.LOCAL_DISABLED,
  };
}

/**
 * Un accès L.Y SOLUTION, vu par le widget.
 *
 * ── `connectable` NE DIT PAS « AUTORISÉ », IL DIT « INUTILE D'ESSAYER » ─────
 *
 * L'autorisation appartient au Panel, qui la tranche à l'émission de
 * l'assertion : rôle, `projectAccess`, appairage. Ce drapeau ne fait
 * qu'éviter d'afficher un bouton dont on SAIT DÉJÀ qu'il échouera — projet non
 * appairé, ou accès que le dernier contact disait retiré. Le passer à `true`
 * n'accorderait rien : le refus arriverait simplement plus tard, chez le Panel.
 */
function toPanelTestAccount(compte, federation) {
  const blockedReason = !federation.available
    ? TEST_LOGIN_BLOCKERS.PANEL_NOT_PAIRED
    : compte.enabled === false
      ? TEST_LOGIN_BLOCKERS.PANEL_ACCESS_REVOKED
      : null;
  return {
    id: compte.id,
    displayName: compte.displayName,
    email: compte.email,
    role: assertProjectRole(compte.role, `l’accès L.Y Solution ${compte.id}`),
    source: ACCOUNT_SOURCES.PANEL,
    principalType: PRINCIPAL_TYPES.PANEL_USER,
    enabled: compte.enabled,
    status: compte.status,
    loginMode: TEST_LOGIN_MODES.FEDERATED_TEST,
    connectable: blockedReason === null,
    blockedReason,
  };
}

/**
 * LA RÉPONSE DU WIDGET — deux populations nommées, jamais fusionnées.
 *
 * ══ LA GARDE D'ENVIRONNEMENT VIENT AVANT TOUTE LECTURE ══════════════════════
 *
 * Aucune requête n'est émise en PROD : on ne rend pas une liste vide APRÈS
 * l'avoir lue, on refuse AVANT de la lire. La nuance est celle qui compte le
 * jour où quelqu'un journalise la lecture, la met en cache, ou en dérive un
 * compteur — la liste des comptes d'administration d'un projet en production
 * ne doit pas exister en mémoire à cause d'un widget de recette.
 */
export async function describeTestLogin() {
  if (!config.isTest) {
    return {
      enabled: false,
      environment: config.env,
      federation: { available: false, paired: false },
      accounts: [],
      /** Compat historique : l'ancien contrat n'avait que `enabled`/`accounts`. */
      labels: SOURCE_LABEL,
    };
  }

  const federation = federationAvailability();
  const canoniques = await listProjectAccounts();

  const accounts = canoniques
    /**
     * UN COMPTE EN ATTENTE D'ACTIVATION N'EST PAS PROPOSÉ.
     *
     * Le montrer suggérerait qu'on peut y entrer, alors qu'il n'a jamais eu de
     * mot de passe — et la connexion rapide le refuse déjà, comme le login. La
     * doctrine vient du LOT 2C ; elle est conservée mot pour mot, et sa recette
     * l'éprouve toujours.
     */
    .filter((c) => c.status !== ACCOUNT_STATUS.PENDING_ACTIVATION)
    .map((c) => (c.source === ACCOUNT_SOURCES.PANEL
      ? toPanelTestAccount(c, federation)
      : toLocalTestAccount(c)));

  return {
    enabled: true,
    environment: config.env,
    federation,
    accounts,
    labels: SOURCE_LABEL,
  };
}

export default { describeTestLogin, TEST_LOGIN_MODES, TEST_LOGIN_BLOCKERS, TEST_LOGIN_ACCOUNT_FIELDS };
