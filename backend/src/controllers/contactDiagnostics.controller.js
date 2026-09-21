import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import { recentContactDecisions } from '../services/contact/contactDiagnostics.js';

/**
 * Diagnostics DEV des soumissions de contact — LECTURE SEULE.
 *
 * Rend visible la décision (ACCEPTED / DUPLICATE / REJECTED_AS_SPAM) que la réponse
 * neutre cache au visiteur. Aucune donnée sensible : e-mail masqué, jamais le
 * message. Anneau en mémoire, borné.
 */
export const getContactDiagnostics = asyncHandler(async (req, res) =>
  ok(res, { decisions: recentContactDecisions() })
);

export default { getContactDiagnostics };
