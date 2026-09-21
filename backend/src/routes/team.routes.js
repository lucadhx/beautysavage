/**
 * ÉQUIPE DE L'AGENCE — publiée par le Panel, consultée ici.
 *
 * ── POURQUOI CETTE SURFACE A CHANGÉ DE NATURE ──────────────────────────────
 * Chaque projet tenait sa propre liste, éditable sur place. Deux projets
 * opérés par la même agence pouvaient donc annoncer deux équipes
 * différentes, et un départ devait être répercuté autant de fois qu'il y
 * avait de projets. Le Panel publie désormais une liste unique.
 *
 * La lecture sert la liste PUBLIÉE, pas la collection locale : sans cela on
 * garderait deux vérités concurrentes, et rien ne dirait laquelle affiche la
 * page Support.
 *
 * Les écritures sont refusées explicitement, avec un code. Retirer le
 * formulaire n'aurait pas suffi : la route restait ouverte.
 */
import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { getCompanyConfiguration } from '../services/panelConfiguration/panelConfiguration.service.js';
import { ok } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.use(authenticate);

/**
 * L'équipe telle que le Panel l'a publiée.
 *
 * Sans Panel appairé, ou sans entreprise publiée, la liste est VIDE — pas
 * une erreur, et surtout pas une équipe de repli : afficher quelqu'un que
 * l'autorité ne connaît pas serait pire que n'afficher personne.
 */
router.get('/', asyncHandler(async (_req, res) => {
  const configuration = await getCompanyConfiguration();
  return ok(res, configuration?.team ?? []);
}));

/** Toute écriture est refusée : le Panel est l'autorité de cette liste. */
const refus = (_req, res) => res.status(409).json({
  success: false,
  code: 'DEV_TEAM_MANAGED_BY_PANEL',
  message: "L'équipe de l'agence est administrée depuis le Panel et ne se modifie plus ici.",
});

router.post('/', refus);
router.patch('/reorder', refus);
router.put('/:id', refus);
router.delete('/:id', refus);

export default router;
