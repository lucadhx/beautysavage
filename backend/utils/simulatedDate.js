/**
 * simulatedDate.js
 * Fournit getNow() — retourne la date simulée si configurée, sinon new Date().
 * La date simulée est stockée dans CommissionSettings.simulatedDate (singleton).
 */

import CommissionSettings from '../models/CommissionSettings.js';

export async function getNow() {
  try {
    const settings = await CommissionSettings.findOne().lean();
    if (settings?.simulatedDate) return new Date(settings.simulatedDate);
  } catch (_) {
    // En cas d'erreur DB on renvoie la vraie date
  }
  return new Date();
}
