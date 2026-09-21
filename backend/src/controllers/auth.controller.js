import { asyncHandler } from '../utils/asyncHandler.js';
import { oublierTentatives } from '../middlewares/authRateLimit.js';
import { ok } from '../utils/apiResponse.js';
import * as authService from '../services/auth.service.js';

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.login(email, password);
  /**
   * LA RÉUSSITE EFFACE LE SEAU DE CETTE IDENTITÉ.
   *
   * Quelqu’un qui retrouve son mot de passe au sixième essai ne doit pas
   * rester à deux tentatives du blocage pour le quart d’heure suivant. Le
   * seau d’IP n’est PAS effacé : il protège contre un balayage de comptes, et
   * une réussite sur l’un d’eux ne dit rien des autres.
   */
  await oublierTentatives('project-login', email).catch(() => null);
  return ok(res, result);
});

export const me = asyncHandler(async (req, res) => {
  return ok(res, req.user);
});

export const testAccounts = asyncHandler(async (req, res) => {
  return ok(res, await authService.listTestAccounts());
});

export const devLogin = asyncHandler(async (req, res) => {
  const result = await authService.devLogin(req.body.email);
  return ok(res, result);
});

export const updateProfile = asyncHandler(async (req, res) => {
  const user = await authService.updateProfile(req.user._id, { name: req.body.name });
  return ok(res, user);
});

export const forgotPassword = asyncHandler(async (req, res) => {
  return ok(res, await authService.requestPasswordReset(req.body.email));
});

export const resetPassword = asyncHandler(async (req, res) => {
  return ok(res, await authService.resetPassword(req.body.token, req.body.newPassword));
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await authService.changePassword(req.user._id, currentPassword, newPassword);
  return ok(res, user);
});

/* ══════════════════════════════════════════════════════════════════════════
   ACTIVATION DU PREMIER ACCÈS (LOT 2C) — surfaces PUBLIQUES.

   Elles doivent l'être : leur destinataire n'a, par définition, aucun moyen
   de s'authentifier. Le token EST la preuve, et il ne prouve qu'une chose —
   la possession de la boîte à laquelle il a été envoyé.
   ══════════════════════════════════════════════════════════════════════════ */

/** Le lien est-il encore utilisable ? Consulté par la page avant d'afficher le formulaire. */
export const describeActivation = asyncHandler(async (req, res) => {
  const { describeActivation: decrire } = await import('../services/localDevBootstrap.service.js');
  return ok(res, await decrire(String(req.query.token || '')));
});

export const activateAccount = asyncHandler(async (req, res) => {
  const { activateAccount: activer } = await import('../services/localDevBootstrap.service.js');
  return ok(res, await activer(req.body.token, req.body.newPassword));
});

export const resendActivation = asyncHandler(async (req, res) => {
  const { resendActivation: renvoyer } = await import('../services/localDevBootstrap.service.js');
  return ok(res, await renvoyer(req.body.email));
});
