/**
 * Diagnostics DEV des soumissions de contact — RENDRE OBSERVABLE une décision qui,
 * autrement, est invisible.
 *
 * ═══ LE PROBLÈME QUE CE MODULE RÉSOUT ════════════════════════════════════════
 *
 * L'anti-abus répond au visiteur un SUCCÈS NEUTRE quand il rejette (pour ne pas
 * apprendre au robot quoi corriger). Conséquence en RECETTE : une soumission
 * légitime neutralisée à tort (honeypot rempli par l'autofill du navigateur, débit
 * global épuisé pendant des essais répétés…) « réussit » côté vitrine mais ne crée
 * RIEN — et personne ne peut le voir. Ce module trace la décision pour l'espace DEV.
 *
 * ═══ CE QU'IL NE STOCKE JAMAIS ═══════════════════════════════════════════════
 *
 * Jamais le MESSAGE complet, jamais l'adresse en clair (masquée). Anneau en mémoire,
 * borné : un outil de diagnostic, pas une seconde source de vérité ni une archive.
 * Perdu au redémarrage — assumé (le besoin est l'immédiateté en recette).
 */

/** Décision prise pour une tentative de soumission. */
export const CONTACT_DECISION = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  DUPLICATE: 'DUPLICATE',
  REJECTED_AS_SPAM: 'REJECTED_AS_SPAM',
});

const RING_SIZE = 50;
const ring = [];

/**
 * Enregistre une décision. `emailMasked` uniquement (jamais l'adresse complète),
 * jamais le message. `reason` = motif anti-abus pour un rejet, sinon null.
 */
export function recordContactDecision({ decision, reason = null, emailMasked = '', submissionId = null }) {
  ring.push({
    at: new Date().toISOString(),
    decision,
    reason: reason || null,
    emailMasked: emailMasked || '',
    submissionId: submissionId || null,
  });
  if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE);
}

/** Décisions récentes, les plus récentes d'abord (copie défensive). */
export function recentContactDecisions() {
  return ring.slice().reverse();
}

/** Réservé aux tests. */
export function _resetContactDiagnostics() {
  ring.length = 0;
}

export default { CONTACT_DECISION, recordContactDecision, recentContactDecisions, _resetContactDiagnostics };
