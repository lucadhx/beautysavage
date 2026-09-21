/**
 * POLITIQUE D'ÉCHEC DU PONT — ce qu'on fait d'une écriture qui n'est pas passée.
 *
 * ══ LE DÉFAUT QUE CE MODULE FERME ═══════════════════════════════════════════
 *
 * Il n'existait que deux issues : « accusée » et « refusée ». La première
 * sortait l'écriture de la file, la seconde AUSSI — en posant le même
 * `acknowledgedAt`, donc en la livrant au même index TTL. Un refus était donc
 * traité, dans les faits, comme une réussite : file vide, compteur à zéro,
 * aucune alerte, et la donnée métier perdue pour de bon.
 *
 * Le symptôme observé a été un logo. Le contrat du Panel validait la
 * présentation d'un projet avec un schéma fermé qui ignorait le descripteur de
 * média ; toute instance disposant d'un logo — toute instance de production —
 * voyait donc sa présentation refusée, et son nom figé pour toujours sur la
 * fiche. Le schéma est corrigé (lot L1) ; ce module traite la CLASSE de défaut,
 * pour que le prochain écart de contrat ne coûte pas la même chose.
 *
 * ══ LA DISTINCTION QUI COMPTE ═══════════════════════════════════════════════
 *
 * Ce n'est PAS « réessayable / définitif ». Presque tout refus est réparable :
 * un destinataire se déploie, un lot se livre, un schéma s'élargit. La vraie
 * distinction est :
 *
 *   · à quelle CADENCE on réaffirme — sans marteler un destinataire qui
 *     refusera de la même façon dans la seconde qui suit ;
 *   · ce qu'on MONTRE pendant ce temps — un refus doit être visible, et jamais
 *     compté comme convergé.
 *
 * On classe donc pour DIRE et pour CADENCER, jamais pour jeter.
 *
 * ══ CE QUE CE MODULE N'EST PAS ══════════════════════════════════════════════
 *
 * Il ne connaît ni Mongo, ni le métier, ni la configuration : il traduit un
 * code en décision. La frontière du pont vaut aussi pour lui
 * (`bridge-conformity`).
 */

/**
 * LES CINQ CLASSES. Le nom dit d'où vient l'échec, pas ce qu'on en fait —
 * la conduite à tenir est dans `POLITIQUES`.
 */
export const FAILURE_CLASS = Object.freeze({
  /** Le destinataire n'a pas répondu, ou a répondu qu'il allait mal. */
  TRANSIENT: 'TRANSIENT',
  /** Il a compris la requête et n'en veut pas SOUS CETTE FORME. */
  COMPATIBILITY: 'COMPATIBILITY',
  /** Il refuse la relation elle-même : monde, jeton, appairage. */
  SECURITY: 'SECURITY',
  /** Il a compris et refuse le FOND : entité, version, état. */
  BUSINESS: 'BUSINESS',
  /** Il l'avait déjà — ce n'est pas un échec, et il ne faut pas le traiter comme tel. */
  IDEMPOTENT: 'IDEMPOTENT',
});

/**
 * CADENCES DE RÉAFFIRMATION, en secondes, par classe.
 *
 * ── POURQUOI SI LENT, ET POURQUOI PAS INFINI ────────────────────────────────
 * Un refus de contrat ne se répare pas en quinze secondes : il se répare quand
 * quelqu'un déploie. Réaffirmer toutes les secondes ne ferait qu'ajouter du
 * bruit à une panne déjà connue. Mais ne jamais réaffirmer, c'est exiger un
 * geste humain — et personne ne saura lequel, ni quand.
 *
 * Cinq minutes puis un palier par heure : un destinataire corrigé à 10 h 00
 * converge au pire à 10 h 05, sans que personne n'ait rien fait. Le coût est
 * d'une petite écriture HTTP par heure et par entité bloquée.
 *
 * Le transport garde sa propre échelle (15 s → 1 h) : une coupure réseau dure
 * des secondes, un écart de contrat dure un déploiement.
 */
const CADENCES = Object.freeze({
  [FAILURE_CLASS.COMPATIBILITY]: [300, 1800, 3600, 3600, 21600],
  [FAILURE_CLASS.BUSINESS]: [300, 1800, 3600, 3600, 21600],
  /**
   * SÉCURITÉ — on réaffirme, mais très lentement.
   *
   * Un désaccord d'environnement ou d'appairage se corrige par une
   * intervention (un `.env`, un réappairage), pas par une insistance. Marteler
   * un Panel qui nous refuse pour un motif de sécurité serait, en plus d'être
   * inutile, exactement ce qu'un journal d'accès signale comme une anomalie.
   */
  [FAILURE_CLASS.SECURITY]: [3600, 21600, 86400],
});

/** Palier terminal d'une cadence — on n'attend jamais plus que le dernier. */
export function delaiDeReaffirmation(failureClass, rejections) {
  const paliers = CADENCES[failureClass] ?? CADENCES[FAILURE_CLASS.COMPATIBILITY];
  const rang = Math.min(Math.max(rejections, 1) - 1, paliers.length - 1);
  return paliers[rang];
}

/**
 * CODES DU CONTRAT → CLASSE. Table EXPLICITE, jamais une heuristique sur le
 * texte du message : un libellé change, un code non.
 *
 * Un code inconnu tombe en `COMPATIBILITY` — l'hypothèse la plus prudente :
 * on conserve, on montre, on réaffirme lentement. Le contraire (« inconnu donc
 * on jette ») est précisément le défaut qu'on ferme.
 */
const PAR_CODE = Object.freeze({
  // — le destinataire ne comprend pas ce qu'on lui envoie ————————————
  ENTITY_PAYLOAD_INVALID: FAILURE_CLASS.COMPATIBILITY,
  BRIDGE_INVALID_PAYLOAD: FAILURE_CLASS.COMPATIBILITY,
  BRIDGE_ENTITY_TYPE_UNSUPPORTED: FAILURE_CLASS.COMPATIBILITY,
  BRIDGE_CONTRACT_VERSION_UNSUPPORTED: FAILURE_CLASS.COMPATIBILITY,

  // — il refuse la relation ————————————————————————————————————————
  BRIDGE_ENVIRONMENT_MISMATCH: FAILURE_CLASS.SECURITY,
  BRIDGE_UNAUTHORIZED: FAILURE_CLASS.SECURITY,
  BRIDGE_FORBIDDEN: FAILURE_CLASS.SECURITY,
  BRIDGE_NOT_PAIRED: FAILURE_CLASS.SECURITY,
  BRIDGE_ALREADY_PAIRED: FAILURE_CLASS.SECURITY,

  // — il est là, mais pas en état de répondre ——————————————————————
  BRIDGE_PANEL_UNREACHABLE: FAILURE_CLASS.TRANSIENT,
  BRIDGE_TIMEOUT: FAILURE_CLASS.TRANSIENT,
  BRIDGE_INTERNAL: FAILURE_CLASS.TRANSIENT,
});

/** La classe d'un refus reçu dans un accusé (`SyncAck.code`). */
export function classifyRejection(code) {
  const clef = String(code ?? '').trim().toUpperCase();
  return PAR_CODE[clef] ?? FAILURE_CLASS.COMPATIBILITY;
}

/**
 * La classe d'un accusé, quel qu'il soit. `APPLIED`/`IGNORED` ne sont pas des
 * échecs ; `DUPLICATE` non plus — le destinataire l'avait déjà, et insister
 * n'apprendrait rien à personne.
 */
export function classifyAck({ status, code } = {}) {
  if (status === 'REJECTED') return classifyRejection(code);
  return FAILURE_CLASS.IDEMPOTENT;
}

/**
 * UN REFUS N'EST JAMAIS UNE RÉUSSITE.
 *
 * Cette fonction existe pour qu'aucun appelant n'ait à s'en souvenir : c'est
 * elle, et elle seule, qui décide si une issue clôt le dossier.
 */
export function estResolu(status) {
  return status === 'APPLIED' || status === 'DUPLICATE' || status === 'IGNORED';
}

export default {
  FAILURE_CLASS,
  classifyAck,
  classifyRejection,
  delaiDeReaffirmation,
  estResolu,
};
