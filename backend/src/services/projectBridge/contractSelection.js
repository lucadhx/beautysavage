/**
 * QUEL CONTRAT EST LE CONTRAT ACTUEL — et lesquels appartiennent à l'histoire.
 *
 * ── LE DÉFAUT QUE CE MODULE CORRIGE ─────────────────────────────────────────
 * La projection choisissait « le contrat ACTIF, et à défaut le plus récemment
 * modifié ». Ce « à défaut » était l'erreur : un projet dont le contrat venait
 * d'être résilié n'a plus AUCUN contrat actuel — mais le contrat résilié était,
 * par construction, le plus récemment modifié. Il repartait donc au Panel comme
 * s'il était en vigueur, avec son abonnement, ses frais de mise en service, sa
 * signature et son document. La fiche affichait tout cela sous une pastille
 * « Contrat terminé » : l'état contractuel du moment mélangé au détail d'un
 * contrat mort.
 *
 * Le contrat le plus récent n'est pas forcément le contrat actuel.
 *
 * ── CE QUI FAIT LE PARTAGE ──────────────────────────────────────────────────
 * Le métier définit déjà ses statuts terminaux : un contrat ENDED, CANCELLED ou
 * FAILED — ou archivé — a cessé d'exister comme engagement. Il ne peut plus
 * redevenir le contrat courant, quoi qu'en dise sa date de modification.
 *
 * Tout le reste est « en cours » au sens large : ACTIVE et CANCEL_AT_PERIOD_END
 * (résilié mais servi jusqu'à l'échéance) parce que le contrat produit encore
 * ses effets ; DRAFT, PENDING_DEV_SIGNATURE, INACTIVE et
 * ACTIVATION_IN_PROGRESS parce qu'un contrat en cours de mise en place est bien
 * le contrat du moment — il n'appartient pas à l'histoire, il n'a pas encore
 * commencé.
 *
 * Fonction PURE : elle reçoit des contrats, elle n'interroge rien.
 */
import { CONTRACT_STATUS } from '../../utils/contractConstants.js';

/** Statuts dont on ne revient pas. Un contrat qui y est entré est du passé. */
export const TERMINAL_CONTRACT_STATUSES = Object.freeze([
  CONTRACT_STATUS.ENDED,
  CONTRACT_STATUS.CANCELLED,
  CONTRACT_STATUS.FAILED,
]);

/**
 * Ordre de préférence pour désigner LE contrat courant quand plusieurs sont en
 * cours — situation que le métier ne veut pas, mais qui doit se trancher.
 */
const PRIORITE = [
  CONTRACT_STATUS.ACTIVE,
  CONTRACT_STATUS.CANCEL_AT_PERIOD_END,
  CONTRACT_STATUS.ACTIVATION_IN_PROGRESS,
  CONTRACT_STATUS.INACTIVE,
  CONTRACT_STATUS.PENDING_DEV_SIGNATURE,
  CONTRACT_STATUS.DRAFT,
];

export function estTermine(contract) {
  return Boolean(contract?.archived) || TERMINAL_CONTRACT_STATUSES.includes(contract?.status);
}

const horodatage = (v) => {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isNaN(t) ? null : t;
};

/**
 * Quand un contrat vivant a-t-il bougé pour la dernière fois ? La plus récente
 * de ses traces — c'est ce qui départage deux contrats en cours.
 */
const recence = (contract) => {
  const dates = [contract?.activation?.activatedAt, contract?.updatedAt, contract?.createdAt]
    .map(horodatage)
    .filter((t) => t !== null);
  return dates.length > 0 ? Math.max(...dates) : 0;
};

/**
 * Quand un contrat terminé a-t-il PRIS FIN ? Sa date de fin d'abord — c'est
 * elle qui situe un contrat dans l'histoire. Prendre la plus récente de toutes
 * ses traces ferait remonter un vieux contrat qu'une écriture technique aurait
 * touché hier.
 */
const fin = (contract) =>
  horodatage(contract?.stripe?.subscription?.endedAt)
  ?? horodatage(contract?.stripe?.subscription?.cancelledAt)
  ?? horodatage(contract?.updatedAt)
  ?? horodatage(contract?.createdAt)
  ?? 0;

/**
 * Partage une liste de contrats entre le courant et l'histoire.
 *
 * @param {object[]} contracts
 * @returns {{ current: object|null, previous: object[] }}
 *   `current` vaut `null` quand aucun contrat n'est en cours — et ce `null` est
 *   une information, pas un manque : il dit « ce projet n'a pas de contrat ».
 */
export function selectCurrentAndPreviousContracts(contracts = []) {
  const tous = Array.isArray(contracts) ? contracts.filter(Boolean) : [];

  const encours = tous.filter((c) => !estTermine(c));
  const termines = tous.filter((c) => estTermine(c));

  // Le plus « avancé » d'abord ; à statut égal, le plus récent.
  const courant = encours.sort((a, b) => {
    const rang = PRIORITE.indexOf(a.status) - PRIORITE.indexOf(b.status);
    if (rang !== 0) return rang;
    return recence(b) - recence(a);
  })[0] ?? null;

  // L'histoire se lit du plus récent au plus ancien : la dernière chose qui
  // s'est passée est celle qu'on cherche en premier.
  const precedents = termines.sort((a, b) => fin(b) - fin(a));

  // Un contrat en cours qui ne serait pas retenu (deux contrats vivants) reste
  // visible : il n'est pas « terminé », mais le taire serait pire que de le
  // ranger après le courant.
  const ecartes = encours.filter((c) => c !== courant);

  return { current: courant, previous: [...precedents, ...ecartes] };
}

export default { selectCurrentAndPreviousContracts, estTermine, TERMINAL_CONTRACT_STATUSES };
