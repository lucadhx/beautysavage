// LES ACCÈS L.Y SOLUTION, VUS DEPUIS LE PROJET (L12.B-UI).
//
// ── CE QUE CETTE LISTE EST, ET CE QU'ELLE N'EST PAS ─────────────────────────
//
// C'est un JOURNAL DE PRÉSENCE, pas un annuaire du Panel. Elle montre les
// identités qui se sont réellement connectées ICI, avec ce qu'on sait d'elles
// au dernier contact. Elle ne dit pas qui, au Panel, POURRAIT venir : le projet
// n'a pas à connaître l'effectif de l'agence, et le lui rendre ferait de chaque
// projet un annuaire d'employés.
//
// ── `enabled` EST UN REFLET, ET L'ÉCRAN DOIT LE DIRE ────────────────────────
//
// La valeur montrée date du dernier contact avec le Panel. Elle n'autorise
// rien : un accès est refusé parce que le Panel l'a dit à l'instant, jamais
// parce qu'une copie locale disait « vrai ». L'écran affiche donc aussi la date
// de dernière synchronisation — sans quoi « actif » se lirait comme une
// garantie présente.
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import { ExternalPrincipal, EXTERNAL_PROVIDERS } from '../models/ExternalPrincipal.model.js';
import { panelAccountView } from '../services/accounts/projectAccountView.js';

/** `GET /api/accounts/external` — DEV uniquement (garde posée à la route). */
export const listExternalPrincipals = asyncHandler(async (_req, res) => {
  const principals = await ExternalPrincipal
    .find({ provider: EXTERNAL_PROVIDERS.LY_SOLUTION_PANEL })
    .sort({ displayName: 1, email: 1 })
    .lean();

  /**
   * LA VUE CANONIQUE, PLUS CE QUE CET ÉCRAN SEUL AFFICHE.
   *
   * `panelAccountView` porte le contrat partagé avec le Panel ; `panelUserId`
   * et `lastSeenAt` s'y ajoutent parce que cet écran-ci les montre et que le
   * Panel n'en a pas besoin. Étendre la vue canonique pour eux l'aurait
   * alourdie des deux côtés ; les recopier dans une forme parallèle aurait
   * recréé la divergence. On AJOUTE, on ne redéfinit pas.
   */
  return ok(res, principals.map((principal) => ({
    ...panelAccountView(principal),
    panelUserId: principal.externalUserId,
    lastSeenAt: principal.lastSeenAt ?? null,
    provider: EXTERNAL_PROVIDERS.LY_SOLUTION_PANEL,
  })));
});

export default { listExternalPrincipals };
