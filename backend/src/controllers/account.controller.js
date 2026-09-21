import { asyncHandler } from '../utils/asyncHandler.js';
import { ok, created, noContent } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { User } from '../models/User.model.js';
import { localAccountView } from '../services/accounts/projectAccountView.js';
import { listProjectAccounts, summarizeAccounts } from '../services/accounts/projectAccounts.service.js';

/** DEV only: full account management (ADMIN + DEV accounts). */

/**
 * `GET /api/accounts` — LES COMPTES LOCAUX, DANS LA REPRÉSENTATION CANONIQUE.
 *
 * ══ CE QUE CETTE LISTE RENDAIT AVANT ══════════════════════════════════════
 *
 * Le document Mongoose sérialisé tel quel : `_id`, `name`, `role`, et tout ce
 * que le schéma portait ce jour-là. C'était commode et c'était le problème —
 * la forme de l'écran suivait la forme de la base, et le Panel, qui décrivait
 * les mêmes personnes, en avait inventé une autre.
 *
 * Elle rend désormais la vue canonique (`projectAccountView`), celle-là même
 * que le pont sert au Panel. La parité n'est plus une vérification : c'est le
 * même code.
 */
export const list = asyncHandler(async (req, res) => {
  const users = await User.find().sort({ createdAt: 1 }).lean();
  return ok(res, users.map(localAccountView));
});

/**
 * `GET /api/accounts/all` — LES DEUX POPULATIONS, COMME LE PANEL LES VOIT.
 *
 * Comptes locaux ET accès L.Y Solution, dans une seule liste ordonnée. C'est
 * la réponse à « qui peut entrer ici », qui est la question qu'un opérateur se
 * pose réellement — les deux listes séparées l'obligeaient à faire la fusion
 * de tête, et à deviner si une absence était un droit retiré ou un écran
 * incomplet.
 */
export const listAll = asyncHandler(async (_req, res) => {
  const list = await listProjectAccounts();
  return ok(res, { accounts: list, summary: summarizeAccounts(list), readAt: new Date().toISOString() });
});

export const create = asyncHandler(async (req, res) => {
  const { email, password, name, role } = req.body;
  const exists = await User.findOne({ email: email.toLowerCase() });
  if (exists) throw ApiError.conflict('Un compte avec cet email existe déjà');
  const user = await User.create({ email, password, name, role });
  return created(res, user.toJSON());
});

export const update = asyncHandler(async (req, res) => {
  const { email, name, role, password } = req.body;
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('Compte introuvable');

  if (email && email.toLowerCase() !== user.email) {
    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) throw ApiError.conflict('Un compte avec cet email existe déjà');
    user.email = email;
  }
  if (name !== undefined) user.name = name;
  if (role) user.role = role;
  if (password) user.password = password; // re-hashed by pre-save hook
  await user.save();
  return ok(res, user.toJSON());
});

export const remove = asyncHandler(async (req, res) => {
  /**
   * « PAS SON PROPRE COMPTE » — et `_id` peut être `null` (L12.B).
   *
   * Une identité fédérée L.Y Solution n'a AUCUN compte local : elle ne peut
   * donc pas supprimer le sien, et la comparaison n'a pas de sujet. Écrire
   * `req.user._id.toString()` sans garde levait une erreur de lecture sur
   * `null` — un développeur du Panel supprimant un compte client aurait reçu
   * « Erreur interne » à la place de la suppression.
   */
  if (req.user?._id && req.params.id === String(req.user._id)) {
    throw ApiError.badRequest('Vous ne pouvez pas supprimer votre propre compte');
  }
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) throw ApiError.notFound('Compte introuvable');
  return noContent(res);
});
