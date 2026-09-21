/**
 * « CE MESSAGE A-T-IL ENCORE UNE RAISON D'ÊTRE ? » — posé JUSTE AVANT l'envoi.
 *
 * ══ LE DÉFAUT QUE CE MODULE FERME ═══════════════════════════════════════════
 *
 * Un événement est un FAIT : il s'est produit, il ne se rétracte pas. Une
 * action est une CONSÉQUENCE, et une conséquence peut cesser d'être justifiée
 * entre le moment où on la décide et le moment où on l'exécute.
 *
 * Le cas réel : une relance d'impayé est créée, le premier envoi échoue parce
 * que le fournisseur est momentanément injoignable, une nouvelle tentative est
 * programmée. Entre les deux, le client paie. Sans cette garde, le worker se
 * réveille et écrit « nous n'avons toujours pas reçu votre règlement » à
 * quelqu'un qui vient de régler.
 *
 * Ce n'est pas un défaut d'idempotence — l'envoi n'a jamais eu lieu. C'est un
 * message devenu FAUX pendant qu'il attendait.
 *
 * ══ POURQUOI LA GARDE EST ICI, ET PAS DANS LE HANDLER ═══════════════════════
 *
 * Le handler d'envoi sait composer un message ; il ne sait rien du métier qui
 * l'a demandé. Lui confier la question l'obligerait à connaître les impayés,
 * les contrats et les paiements — c'est-à-dire à devenir le contraire de ce
 * qu'il est.
 *
 * La garde est donc DÉCLARÉE par le domaine métier, par type d'événement, et
 * le répartiteur se contente de la consulter. Un type sans garde est toujours
 * pertinent : l'absence de règle n'est pas une raison de ne pas envoyer.
 *
 * ══ ELLE NE PEUT PAS FAIRE ÉCHOUER UN ENVOI ════════════════════════════════
 *
 * Une garde qui lève est une garde qu'on ignore : douter n'est pas savoir, et
 * bloquer un message sur une exception ferait taire des relances légitimes au
 * premier hoquet de la base. Le doute profite à l'envoi, et l'erreur est
 * journalisée.
 */
import { logger } from '../../utils/logger.js';

/** @type {Map<string, (event: object) => Promise<{relevant: boolean, reason?: string}>>} */
const gardes = new Map();

/**
 * Déclare la garde de pertinence d'un type d'événement.
 *
 * @param {string} eventType
 * @param {(event: object) => Promise<{relevant: boolean, reason?: string}>} garde
 */
export function registerRelevanceGuard(eventType, garde) {
  if (typeof garde !== 'function') {
    throw new Error(`Garde de pertinence invalide pour « ${eventType} ».`);
  }
  gardes.set(eventType, garde);
}

/** Utilisé par les recettes pour repartir d'un registre vierge. */
export function clearRelevanceGuards() {
  gardes.clear();
}

export function hasRelevanceGuard(eventType) {
  return gardes.has(eventType);
}

/** Les types qui déclarent une garde — pour l'inventaire et les contrôles. */
export function describeRelevanceGuards() {
  return [...gardes.keys()].sort();
}

/**
 * @param {object} event
 * @returns {Promise<{relevant: boolean, reason: string|null}>}
 */
export async function isStillRelevant(event) {
  const garde = gardes.get(event?.type);
  if (!garde) return { relevant: true, reason: null };

  try {
    const verdict = await garde(event);
    if (verdict?.relevant === false) {
      return { relevant: false, reason: String(verdict.reason || 'condition métier disparue') };
    }
    return { relevant: true, reason: null };
  } catch (err) {
    logger.warn(
      `[events] garde de pertinence en erreur pour « ${event?.type} » — `
      + `${err?.message ?? 'erreur inconnue'}. L'envoi est maintenu.`,
    );
    return { relevant: true, reason: null };
  }
}

export default { registerRelevanceGuard, isStillRelevant, hasRelevanceGuard, describeRelevanceGuards };
