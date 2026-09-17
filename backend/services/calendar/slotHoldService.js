// services/calendar/slotHoldService.js
// M13 — Verrous TEMPORAIRES de créneau (holds). Quand l'admin SÉLECTIONNE un créneau dans le
// drawer de réservation manuelle, on pose un hold court (5 min) qui empêche une double-réservation
// concurrente pendant la saisie. Le hold EXPIRE seul (index TTL sur `expiresAt`) : pas de blocage
// définitif en cas d'abandon. À la confirmation, le hold est libéré puis le verrou PERMANENT est
// posé par createServiceBookingWithProtection (revalidation finale de la disponibilité).
import crypto from 'node:crypto';

import BookingSlotLock from '../../models/BookingSlotLock.js';
import Service from '../../models/Service.js';
import { resolveInstitutePractitionerProfile } from './instituteCalendarContext.js';

const MINUTE_IN_MS = 60 * 1000;
export const DEFAULT_HOLD_MINUTES = 5;

function slotError(code, message, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

function buildHoldToken() {
  return `HOLD-${Date.now()}-${crypto.randomUUID().split('-')[0]}`;
}

/**
 * Pose un hold temporaire sur toutes les minutes occupées par un créneau (durée + buffer).
 * @returns {Promise<{ holdToken: string, expiresAt: Date, slotStartAt: Date, slotEndAt: Date }>}
 */
export async function createSlotHold({
  serviceId,
  startAt,
  endAt = null,
  adminId = null,
  holdMinutes = DEFAULT_HOLD_MINUTES,
  now = new Date(),
  session = null
} = {}) {
  const institute = await resolveInstitutePractitionerProfile({ session });
  if (!institute) throw slotError('INSTITUTE_NOT_CONFIGURED', "L'institut n'a pas de calendrier configuré.", 409);

  const service = await Service.findById(serviceId).session(session || null).lean();
  if (!service) throw slotError('SERVICE_NOT_FOUND', 'Prestation introuvable.', 404);

  const start = new Date(startAt);
  const end = endAt ? new Date(endAt) : new Date(start.getTime() + Number(service.duration || 0) * MINUTE_IN_MS);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    throw slotError('SLOT_INVALID', 'Créneau invalide.', 400);
  }

  const occupiedEndAt = new Date(end.getTime() + Number(service.bufferTime || 0) * MINUTE_IN_MS);
  const holdToken = buildHoldToken();
  const expiresAt = new Date(now.getTime() + Math.max(1, Number(holdMinutes) || DEFAULT_HOLD_MINUTES) * MINUTE_IN_MS);

  const docs = [];
  for (let cursor = start.getTime(); cursor < occupiedEndAt.getTime(); cursor += MINUTE_IN_MS) {
    docs.push({
      practitionerId: institute._id,
      bookingId: holdToken, // satisfait le champ requis ; identifie aussi le hold pour le release.
      slotStartAt: new Date(cursor),
      lockType: 'hold',
      expiresAt,
      heldByAdminId: adminId,
      holdToken
    });
  }

  try {
    if (docs.length) {
      await BookingSlotLock.insertMany(docs, { ordered: true, ...(session ? { session } : {}) });
    }
  } catch (error) {
    await releaseSlotHold({ holdToken, session }).catch(() => {});
    if (Number(error?.code) === 11000) {
      throw slotError('SLOT_UNAVAILABLE', 'Ce créneau vient d\'être réservé ou est déjà en cours de réservation.', 409);
    }
    throw error;
  }

  return { holdToken, expiresAt, slotStartAt: start, slotEndAt: end };
}

/** Libère un hold (tous les verrous temporaires d'un token). Idempotent. */
export async function releaseSlotHold({ holdToken, session = null } = {}) {
  const token = String(holdToken || '').trim();
  if (!token) return { deletedCount: 0 };
  let query = BookingSlotLock.deleteMany({ holdToken: token, lockType: 'hold' });
  if (session) query = query.session(session);
  return query;
}

export default { createSlotHold, releaseSlotHold, DEFAULT_HOLD_MINUTES };
