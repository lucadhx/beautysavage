import mongoose from 'mongoose';
import { ROLES } from '../utils/constants.js';

/**
 * Apparence des badges de rôle (couleurs), éditable par un DEV uniquement.
 * Consommée par tous les comptes authentifiés (badge « rôle » du profil,
 * de la barre latérale, etc.). Une couleur de fond + une couleur de texte
 * par rôle pour un contrôle total du contraste.
 */
const roleStyleSchema = new mongoose.Schema(
  {
    background: { type: String, default: '#64748b' },
    foreground: { type: String, default: '#ffffff' },
  },
  { _id: false }
);

const roleAppearanceSchema = new mongoose.Schema(
  {
    roles: {
      [ROLES.DEV]: {
        type: roleStyleSchema,
        default: () => ({ background: '#7c3aed', foreground: '#ffffff' }),
      },
      [ROLES.ADMIN]: {
        type: roleStyleSchema,
        default: () => ({ background: '#2563eb', foreground: '#ffffff' }),
      },
    },
  },
  { timestamps: true }
);

export const RoleAppearance = mongoose.model('RoleAppearance', roleAppearanceSchema);
export default RoleAppearance;
