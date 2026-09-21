// LA REPRÉSENTATION CANONIQUE D'UN COMPTE DE CE PROJET.
//
// ══ POURQUOI CE FICHIER EXISTE ══════════════════════════════════════════════
//
// Les mêmes personnes étaient décrites de trois façons différentes :
//
//   · le Manager, pour ses comptes locaux — un document `User` sérialisé tel
//     quel, avec `_id`, `name`, `role` ;
//   · le Manager, pour les accès L.Y Solution — un objet à part, avec
//     `panelUserId`, `displayName`, `lastSyncedAt` ;
//   · le Panel — une projection `PanelProjectMember` alimentée par le flux de
//     synchronisation, avec `entityId`, `name`, `role`, et RIEN sur les accès
//     fédérés.
//
// Trois formes pour une seule réalité, dont une qui n'en montrait que la
// moitié. Un opérateur qui comparait les deux écrans ne pouvait pas savoir si
// une différence était un décalage de synchronisation, une population absente,
// ou un vrai écart de droits.
//
// ══ LE CONTRAT ══════════════════════════════════════════════════════════════
//
//   id             identifiant STABLE dans le périmètre du projet
//   displayName    ce qu'on affiche
//   email          l'adresse
//   role           le rôle DANS CE PROJET, et jamais celui du Panel
//   source         LOCAL | PANEL — d'où vient l'identité
//   principalType  LOCAL_USER | PANEL_USER — ce qu'elle EST
//   enabled        peut-elle entrer, à notre connaissance
//   status         ACTIVE | DISABLED — la même chose, dite pour un écran
//   lastSyncedAt   pour une identité fédérée : la fraîcheur de ce qu'on sait
//   createdAt      quand elle est apparue ici
//
// ══ LA RÈGLE QUI COMPTE : `role` EST UN RÔLE DE PROJET ══════════════════════
//
// Un `SUPER_ADMIN` du Panel entre ici en `DEV`. Ce n'est pas une perte
// d'information, c'est la seule information vraie : ce projet ne connaît pas
// la hiérarchie du Panel, et l'y importer ferait décider une échelle étrangère
// des droits chez un client. La projection est déjà faite à l'émission de
// l'assertion ; ce module ne fait que ne pas la défaire.
import { EXTERNAL_PROVIDERS } from '../../models/ExternalPrincipal.model.js';
import { USER_STATUS } from '../../utils/constants.js';

export const ACCOUNT_SOURCES = Object.freeze({
  LOCAL: 'LOCAL',
  PANEL: 'PANEL',
});

export const PRINCIPAL_TYPES = Object.freeze({
  LOCAL_USER: 'LOCAL_USER',
  PANEL_USER: 'PANEL_USER',
});

/**
 * L'ÉTAT D'UN COMPTE, DIT POUR UN ÉCRAN.
 *
 * ── POURQUOI `PENDING_ACTIVATION` N'EST PAS `DISABLED` ──────────────────────
 *
 * `DISABLED` décrit un accès RETIRÉ : il a existé, quelqu'un l'a fermé, et le
 * geste de réparation est de le rouvrir. `PENDING_ACTIVATION` décrit un accès
 * JAMAIS OUVERT : il n'y a rien à révoquer, et le geste de réparation est un
 * lien d'activation à (re)envoyer.
 *
 * Les confondre faisait chercher un interrupteur là où il fallait un e-mail.
 */
export const ACCOUNT_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
  PENDING_ACTIVATION: 'PENDING_ACTIVATION',
});

/** Les champs du contrat, dans l'ordre. Sert la garde de parité des suites. */
export const PROJECT_ACCOUNT_VIEW_FIELDS = Object.freeze([
  'id',
  'displayName',
  'email',
  'role',
  'source',
  'principalType',
  'enabled',
  'status',
  'lastSyncedAt',
  'createdAt',
]);

const statusOf = (enabled) => (enabled ? ACCOUNT_STATUS.ACTIVE : ACCOUNT_STATUS.DISABLED);

/**
 * UN COMPTE LOCAL DU PROJET.
 *
 * `lastSyncedAt: null` et ce n'est pas un trou : une identité locale n'est
 * synchronisée de nulle part, elle EST ici. Mettre une date inventée ferait
 * croire à une fraîcheur qui n'a pas de sens pour cette population.
 *
 * ── `enabled` LIT `status`, ET C'EST UN CORRECTIF ───────────────────────────
 *
 * Cette vue interrogeait `doc.enabled` et `doc.disabled` — deux champs que le
 * modèle `User` ne porte PAS, et n'a jamais portés. La condition était donc
 * toujours vraie : un compte EN ATTENTE D'ACTIVATION, qui n'a pas de mot de
 * passe et ne peut entrer nulle part, était décrit « actif » au Manager comme
 * au Panel. La seule information disponible sur « ce compte peut-il entrer »
 * est `status`, et c'est elle qu'on lit désormais.
 *
 * Les deux anciens champs restent consultés : un document antérieur pourrait
 * les porter, et une lecture qui les ignorerait rouvrirait un accès que
 * quelqu'un avait fermé.
 */
export function localAccountView(user) {
  const doc = typeof user?.toJSON === 'function' ? user.toJSON() : user;
  /**
   * `status` ABSENT vaut ACTIVE — comme le défaut du schéma.
   *
   * Les documents antérieurs au LOT 2C n'ont pas le champ en base : un défaut
   * Mongoose s'applique à l'ÉCRITURE, jamais à la lecture d'un document déjà
   * écrit. Traiter l'absence comme « pas actif » aurait fait disparaître des
   * comptes en exercice.
   */
  const pending = doc?.status === USER_STATUS.PENDING_ACTIVATION;
  const enabled = !pending && doc?.enabled !== false && doc?.disabled !== true;
  return {
    id: String(doc?._id ?? doc?.id ?? ''),
    displayName: doc?.name || doc?.email || 'Compte sans nom',
    email: doc?.email ?? '',
    role: doc?.role ?? 'ADMIN',
    source: ACCOUNT_SOURCES.LOCAL,
    principalType: PRINCIPAL_TYPES.LOCAL_USER,
    enabled,
    status: pending ? ACCOUNT_STATUS.PENDING_ACTIVATION : statusOf(enabled),
    lastSyncedAt: null,
    createdAt: doc?.createdAt ? new Date(doc.createdAt).toISOString() : null,
  };
}

/**
 * UNE IDENTITÉ L.Y SOLUTION PROJETÉE ICI.
 *
 * ── `enabled` EST UN REFLET, ET IL FAUT LE LIRE COMME TEL ───────────────────
 *
 * La valeur date du dernier contact avec le Panel. Elle n'AUTORISE rien : un
 * accès est refusé parce que le Panel l'a dit à l'instant, jamais parce
 * qu'une copie locale disait « vrai ». C'est pour cela que `lastSyncedAt`
 * voyage avec — sans elle, « actif » se lirait comme une garantie présente.
 *
 * ── L'IDENTIFIANT EST CELUI DU PANEL, PRÉFIXÉ ───────────────────────────────
 *
 * `panel:<panelUserId>`. Un identifiant nu pourrait entrer en collision avec
 * un `_id` local dans une liste fusionnée — et deux lignes qui partagent une
 * clé React, c'est une ligne qui disparaît.
 */
export function panelAccountView(principal) {
  const enabled = principal?.enabled !== false;
  return {
    id: `panel:${principal?.externalUserId ?? ''}`,
    displayName: principal?.displayName || principal?.email || 'Développeur L.Y Solution',
    email: principal?.email ?? '',
    /**
     * TOUJOURS LE RÔLE DE PROJET. Un SUPER_ADMIN du Panel est un DEV ici —
     * l'assertion l'a déjà projeté, et rien ne doit le défaire.
     */
    role: principal?.role || 'DEV',
    source: ACCOUNT_SOURCES.PANEL,
    principalType: PRINCIPAL_TYPES.PANEL_USER,
    enabled,
    status: statusOf(enabled),
    lastSyncedAt: principal?.lastSyncedAt
      ? new Date(principal.lastSyncedAt).toISOString()
      : null,
    createdAt: principal?.createdAt ? new Date(principal.createdAt).toISOString() : null,
  };
}

/** Le libellé métier de la provenance — le MÊME des deux côtés du pont. */
export const SOURCE_LABEL = Object.freeze({
  LOCAL: 'Compte du projet',
  PANEL: 'Accès L.Y Solution',
});

export default {
  ACCOUNT_SOURCES,
  ACCOUNT_STATUS,
  PRINCIPAL_TYPES,
  PROJECT_ACCOUNT_VIEW_FIELDS,
  SOURCE_LABEL,
  localAccountView,
  panelAccountView,
};
