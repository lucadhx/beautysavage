import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import { getSingleton } from '../utils/singleton.js';
import { SiteStatus } from '../models/SiteStatus.model.js';
import {
  setTechnicalSuspension,
  reconcileSiteStatus,
  setContractProtection,
} from '../services/siteEnforcement.service.js';

export const get = asyncHandler(async (req, res) => {
  const status = await getSingleton(SiteStatus);
  return ok(res, status);
});

/**
 * DEV : suspension TECHNIQUE (maintenance). Le statut effectif est ensuite
 * recalculé par l'enforcement (une suspension technique prime sur tout).
 */
export const suspend = asyncHandler(async (req, res) => {
  const { site, notice } = await setTechnicalSuspension({
    active: true,
    reason: req.body.reason || '',
    /**
     * L'INTENTION DE PRÉVENIR — explicite, jamais supposée.
     *
     * `=== true` et non une coercition : un corps sans le champ ne notifie
     * pas. Deviner « oui » sur une requête malformée enverrait un e-mail à
     * tous les administrateurs d'un client pour une manipulation interne.
     */
    notifyAdmins: req.body.notifyAdmins === true,
    actorEmail: req.user?.email || '',
    actor: req.user,
  });

  /**
   * ══ L'E-MAIL EST UNE CONSÉQUENCE, PAS UNE CONDITION ═══════════════════════
   *
   * La suspension est ACQUISE : la cause est persistée et le site réconcilié
   * par l'appel ci-dessus. L'annonce part ensuite, et son échec n'a aucun
   * chemin pour revenir en arrière — `announceManualSuspension` ne lève jamais,
   * et n'écrit ni sur le site ni sur sa cause.
   *
   * Attendue, en revanche, plutôt que lancée dans le vide : le rapport
   * accompagne la réponse, pour que l'écran puisse dire « suspendu, mais les
   * administrateurs n'ont pas pu être prévenus » au lieu de laisser croire à un
   * envoi qui n'a pas eu lieu. Un `void` ici aurait produit un silence.
   */
  const notification = notice
    ? await (await import('../services/siteSuspensionNotice.service.js'))
      .announceManualSuspension(notice)
    : null;

  /**
   * LA FICHE DU SITE, PLUS LE RAPPORT D'ANNONCE.
   *
   * La forme de la fiche ne change pas — l'écran continue de la poser telle
   * quelle dans son contexte. `notification` est un champ EN PLUS, absent quand
   * personne n'a demandé d'annonce, et il décrit un envoi, jamais un état.
   */
  return ok(res, { ...site.toObject(), notification });
});

/**
 * DEV : lève la suspension TECHNIQUE, puis RECALCULE le statut. Le site ne
 * redevient PAS actif s'il n'existe aucun contrat honoré (enforcement activé).
 */
export const reactivate = asyncHandler(async (req, res) => {
  /**
   * LA REPRISE RETIRE UNE CAUSE, ELLE N'EN LÈVE AUCUNE AUTRE.
   *
   * Aucun `status = ACTIVE` ici ni dans le service : c'est la réconciliation
   * qui tranche. Un site fermé pour impayé, pour contrat éteint, ou les deux,
   * reste fermé — et c'est la bonne réponse.
   *
   * Aucune notification non plus : le cahier des charges n'en demande qu'à la
   * suspension. En inventer une à la reprise enverrait un message que personne
   * n'a demandé, sans case pour le refuser.
   */
  const { site } = await setTechnicalSuspension({
    active: false,
    actorEmail: req.user?.email || '',
    actor: req.user,
  });
  return ok(res, site);
});

/**
 * DEV : active/désactive la PROTECTION CONTRACTUELLE.
 *
 * Ce levier ne rouvre ni ne ferme le site directement : il dit seulement si
 * l'absence de contrat honoré est une cause de suspension. Une suspension
 * technique en cours reste donc en vigueur, protection ou pas — c'est le
 * service d'enforcement qui tranche, et lui seul.
 */
export const setProtection = asyncHandler(async (req, res) => {
  const status = await setContractProtection({
    enabled: req.body.enabled,
    actor: req.user,
  });
  return ok(res, status);
});

/** DEV : force une réconciliation du statut du site. */
export const reconcile = asyncHandler(async (req, res) => {
  const status = await reconcileSiteStatus({ actor: req.user });
  return ok(res, status);
});
