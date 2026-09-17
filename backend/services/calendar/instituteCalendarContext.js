// services/calendar/instituteCalendarContext.js
// M10 — Décision métier ferme : une seule entité = L'INSTITUT. Plus de multi-prestataires.
// Le calendrier est GLOBAL. Ce module résout l'unique entité de planification de l'institut
// (héritée du modèle PractitionerProfile, désormais sémantiquement « l'institut »).
//
// Les champs `practitionerId` (ServiceBooking / BookingSlotLock / PractitionerProfile) sont
// CONSERVÉS en legacy nullable-compatible (suppression DB = trop risquée : index uniques,
// verrous, refund, sale). Ils ne doivent plus être EXIGÉS à la réservation. Cleanup futur
// via script volontaire.
import PractitionerProfile from '../../models/PractitionerProfile.js';

// Identifiant logique du calendrier global de l'institut (entité unique).
export const DEFAULT_INSTITUTE_CALENDAR_ID = 'institute';

/**
 * Résout l'unique profil de planification de l'institut (le « practitioner » legacy devenu
 * l'institut). Renvoie le profil actif le plus ancien, ou null si aucun.
 * @param {{ session?: import('mongoose').ClientSession|null }} [opts]
 * @returns {Promise<object|null>}
 */
export async function resolveInstitutePractitionerProfile({ session = null } = {}) {
  let query = PractitionerProfile.findOne({ isActive: true }).sort({ createdAt: 1 });
  if (session) query = query.session(session);
  const profile = await query.lean();
  if (profile) return profile;
  // Fallback : tout profil (même inactif) pour ne jamais bloquer un institut mal configuré.
  let any = PractitionerProfile.findOne().sort({ createdAt: 1 });
  if (session) any = any.session(session);
  return any.lean();
}

/**
 * Résout l'id de l'entité institut (ObjectId du profil unique). null si aucun profil.
 * @param {{ session?: import('mongoose').ClientSession|null }} [opts]
 * @returns {Promise<import('mongoose').Types.ObjectId|null>}
 */
export async function resolveInstitutePractitionerId({ session = null } = {}) {
  const profile = await resolveInstitutePractitionerProfile({ session });
  return profile?._id || null;
}

export default {
  DEFAULT_INSTITUTE_CALENDAR_ID,
  resolveInstitutePractitionerProfile,
  resolveInstitutePractitionerId
};
