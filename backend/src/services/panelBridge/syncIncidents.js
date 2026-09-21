/**
 * INCIDENTS DE SYNCHRONISATION — une erreur de sync ne disparaît jamais sans
 * trace.
 *
 * ══ CE QUE CE MODULE FERME ══════════════════════════════════════════════════
 *
 * La chaîne live traverse une dizaine de maillons — hook de modèle,
 * déclencheur, projection, outbox, transport, applicateur — et chacun d'eux
 * avait une bonne raison de ne pas lever : la sauvegarde métier est déjà
 * acquise, et rien ne doit la remettre en cause. Cette discipline est juste.
 *
 * Ce qui ne l'était pas, c'est la manière de se taire. Un `catch` sans
 * message, un `.catch(() => {})`, un `lastError` posé sur un objet que
 * personne ne lit : trois façons de perdre la SEULE information qui aurait
 * permis d'expliquer pourquoi le Panel affiche encore l'ancien nom.
 *
 * ══ CE QU'ON JOURNALISE, ET DANS QUEL ORDRE ═════════════════════════════════
 *
 * Un incident porte un CODE stable (grepable), puis le contexte qui permet de
 * le rejouer : le type d'entité, son identifiant, l'identifiant d'écriture, le
 * numéro de tentative, l'étape. Aucun de ces champs n'est deviné : ce qui n'est
 * pas connu est simplement absent.
 *
 * ══ CE QU'ON NE JOURNALISE JAMAIS ═══════════════════════════════════════════
 *
 * Ni jeton de pont, ni code d'appairage, ni identifiant d'API, ni charge utile.
 * Un incident dit CE QUI a échoué et OÙ ; il ne recopie pas la donnée. Les
 * clés listées ci-dessous sont refusées à la construction — une frontière qui
 * dépend de la vigilance de l'appelant finit toujours par céder.
 */
import { logger } from '../../utils/logger.js';

/** Codes stables — on les cherche dans les journaux, ils ne changent pas. */
export const SYNC_INCIDENT = Object.freeze({
  /** Une projection n'a pas pu être construite (lecture métier en échec). */
  PROJECTION_BUILD_FAILED: 'PROJECTION_BUILD_FAILED',
  /** La mise en file durable a échoué : l'écriture n'est PAS partie. */
  OUTBOX_ENQUEUE_FAILED: 'OUTBOX_ENQUEUE_FAILED',
  /** Le transport a échoué : l'écriture reste en file, avec backoff. */
  OUTBOX_PUSH_FAILED: 'OUTBOX_PUSH_FAILED',
  /** Le Panel a REFUSÉ l'écriture : elle ne repartira pas telle quelle. */
  OUTBOX_WRITE_REJECTED: 'OUTBOX_WRITE_REJECTED',
  /** Le rattrapage descendant a échoué (transport). */
  PULL_FAILED: 'PULL_FAILED',
  /**
   * UNE ÉCRITURE QUE CE RUNTIME NE SAIT PAS TRAITER — et qu'il ne SAUTE PAS.
   *
   * Deux causes, un seul remède : ce binaire est en retard sur le Panel.
   *
   *   INCOMPATIBLE     le type d'entité est inconnu du contrat local.
   *   WIRING_MISSING   le contrat le déclare appliqué, aucun applicateur n'est
   *                    branché.
   *
   * Le curseur est RETENU : l'écriture reste dans le journal du Panel, et la
   * mise à niveau la rattrapera seule. Sans cet incident, le saut était
   * silencieux et la perte définitive.
   */
  CHANGE_INCOMPATIBLE: 'CHANGE_INCOMPATIBLE',
  /** Une écriture du Panel n'a PAS pu être appliquée localement. */
  APPLY_FAILED: 'APPLY_FAILED',
  /**
   * Une écriture ILLISIBLE dans une page par ailleurs valide.
   *
   * Elle est écartée nommément et le curseur avance : une seule entrée
   * malformée ne doit pas pouvoir arrêter définitivement tout le rattrapage.
   * C'est une PERTE, et elle doit donc se voir — d'où un incident dédié,
   * distinct de `PULL_FAILED` qui, lui, dit « la page entière est inutilisable ».
   */
  CHANGE_UNREADABLE: 'CHANGE_UNREADABLE',
  /** Un déclencheur de projection n'a pas pu s'exécuter. */
  TRIGGER_FAILED: 'TRIGGER_FAILED',
  /** Un cycle a été sauté parce qu'un autre tournait déjà. */
  CYCLE_SKIPPED: 'CYCLE_SKIPPED',
  /** Un cycle a levé — ce qui, par contrat, ne devrait pas arriver. */
  CYCLE_FAILED: 'CYCLE_FAILED',
});

/**
 * Clés bannies du contexte — secrets et charges utiles.
 *
 * La comparaison est faite sur le nom NORMALISÉ (minuscules, sans séparateur)
 * pour que `bridge_token`, `bridgeToken` et `BRIDGE-TOKEN` tombent ensemble.
 */
const INTERDITS = [
  'token', 'secret', 'password', 'passphrase', 'credential', 'apikey',
  'authorization', 'bearer', 'pairingcode', 'payload', 'body',
];

const normalise = (cle) => String(cle).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Retire ce qui n'a rien à faire dans un journal, sans rien inventer. */
function contexteSur(contexte) {
  const sortie = {};
  for (const [cle, valeur] of Object.entries(contexte ?? {})) {
    if (valeur === undefined || valeur === null || valeur === '') continue;
    const nom = normalise(cle);
    if (INTERDITS.some((interdit) => nom.includes(interdit))) continue;
    sortie[cle] = typeof valeur === 'object' ? '[objet omis]' : valeur;
  }
  return sortie;
}

/** `code=X entityType=Y …` — lisible à l'œil, découpable à la machine. */
function formate(code, contexte) {
  const paires = Object.entries(contexteSur(contexte)).map(([k, v]) => `${k}=${v}`);
  return `[sync-incident] code=${code}${paires.length ? ` ${paires.join(' ')}` : ''}`;
}

/**
 * Journalise un incident. NE LÈVE JAMAIS : un défaut d'observabilité ne doit
 * pas devenir un défaut de fonctionnement.
 *
 * @param {string}  code      un membre de `SYNC_INCIDENT`
 * @param {object} [contexte] entityType, entityId, writeId, attempt, step,
 *                            environment, reason… — jamais un secret
 * @param {'warn'|'error'} [severite] `error` quand une donnée peut rester en
 *                            arrière indéfiniment ; `warn` quand la reprise
 *                            automatique la rattrapera.
 */
/**
 * ══ UN INCIDENT QUI SE RÉPÈTE NE SE RÉPÈTE PAS DANS LE JOURNAL ═════════════
 *
 * ── CE QUE ÇA DONNAIT ──────────────────────────────────────────────────────
 *
 * En développement local, le bail de consommation est tenu par le backend
 * DÉPLOYÉ — c'est voulu : un poste de travail ne doit pas consommer la file du
 * Panel que la production consomme déjà. Le rattrapage est donc sauté à chaque
 * cycle, et le même `PULL_FAILED … LEASE_HELD_ELSEWHERE` s'écrivait toutes les
 * quelques secondes, indéfiniment.
 *
 * Un état NORMAL qui s'annonce en boucle comme un incident finit par ressembler
 * à une panne : on lance `npm run dev`, le terminal se remplit d'avertissements,
 * et l'on cherche ce qui est cassé alors que rien ne l'est. Pire, le vrai
 * incident qui surviendrait au milieu passerait inaperçu.
 *
 * ── CE QUI EST FAIT, ET CE QUI N'EST PAS FAIT ──────────────────────────────
 *
 * On ne SUPPRIME rien : la première occurrence est journalisée immédiatement,
 * telle quelle. Les suivantes, IDENTIQUES (même code, même contexte), sont
 * comptées puis résumées au plus une fois par fenêtre — « ×147 depuis 5 min ».
 * Un incident qui change de nature a une autre signature, donc il repart
 * aussitôt : la répétition est étouffée, jamais l'information.
 */
const FENETRE_REPETITION_MS = 5 * 60_000;

/** signature → { dernierLog, supprimes } */
const vus = new Map();

/**
 * Faut-il écrire cette ligne, et avec quel suffixe de comptage ?
 *
 * Ne lève pas et ne grandit pas sans fin : la carte est purgée des signatures
 * qui n'ont pas reparu depuis deux fenêtres — sans quoi un service de longue
 * durée y accumulerait une entrée par contexte distinct.
 */
function cadence(signature, maintenant) {
  for (const [cle, etat] of vus) {
    if (maintenant - etat.dernierLog > FENETRE_REPETITION_MS * 2) vus.delete(cle);
  }

  const etat = vus.get(signature);
  if (!etat) {
    vus.set(signature, { dernierLog: maintenant, supprimes: 0 });
    return { ecrire: true, suffixe: '' };
  }
  if (maintenant - etat.dernierLog < FENETRE_REPETITION_MS) {
    etat.supprimes += 1;
    return { ecrire: false, suffixe: '' };
  }
  const suffixe = etat.supprimes > 0 ? ` (×${etat.supprimes + 1} depuis la dernière ligne)` : '';
  etat.dernierLog = maintenant;
  etat.supprimes = 0;
  return { ecrire: true, suffixe };
}

export function recordSyncIncident(code, contexte = {}, severite = 'warn') {
  try {
    const ligne = formate(code, contexte);
    /* La ligne formatée EST la signature : deux incidents qui s'écrivent
       pareil sont le même incident, et deux qui diffèrent en diffèrent. */
    const { ecrire, suffixe } = cadence(`${severite}|${ligne}`, Date.now());
    if (!ecrire) return;
    if (severite === 'error') logger.error(ligne + suffixe);
    else logger.warn(ligne + suffixe);
  } catch {
    /* un journal fautif ne casse pas une synchronisation */
  }
}

/** Remet le compteur à zéro — réservé aux tests, qui doivent partir d'un état net. */
export function resetSyncIncidentThrottle() {
  vus.clear();
}

export default { recordSyncIncident, SYNC_INCIDENT, resetSyncIncidentThrottle };
