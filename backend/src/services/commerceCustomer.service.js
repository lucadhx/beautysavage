import crypto from 'node:crypto';
import { configuredSiteUrl } from '../utils/siteOrigin.js';
import { Customer } from '../models/Customer.model.js';
import { ApiError } from '../utils/ApiError.js';
import { maskEmail } from '../utils/eventPayloadSafety.js';
import { emitAndDispatch } from './events/domainEvent.service.js';

/**
 * LE CLIENT D'UNE RÉSERVATION SAISIE PAR L'INSTITUT, et les messages qui la
 * confirment.
 *
 * Vit à part de `commerce.service.js` pour une raison de dépendances : le
 * calendrier en a besoin, et `commerce.service.js` importe déjà le calendrier.
 */

/** Durée du lien « choisir mon mot de passe » remis à un compte créé par l'institut. */
const ACCOUNT_SETUP_LINK_DAYS = 7;

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;


function splitName(fullName = '') {
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/**
 * RETROUVE OU CRÉE le compte client d'une réservation manuelle.
 *
 * Une adresse inconnue devient un compte : sans lui, le rendez-vous n'avait
 * aucun propriétaire — pas d'espace client, pas de confirmation, pas de
 * message d'annulation. Le compte n'a pas de mot de passe connu de quiconque :
 * la cliente reçoit un lien pour choisir le sien.
 *
 * Une adresse connue n'est JAMAIS modifiée — seuls les champs vides sont
 * complétés (un téléphone saisi au comptoir n'écrase pas celui du compte).
 *
 * @returns {Promise<{customer: object|null, created: boolean}>}
 */
/**
 * Compte ouvert par l'institut et pas encore activé par la cliente. Les comptes
 * antérieurs au marqueur `createdByInstitute` se reconnaissent à ce qu'aucun
 * code de vérification n'a jamais été demandé (une inscription spontanée en
 * demande toujours un).
 */
export function isPendingInstituteAccount(customer) {
  if (!customer || customer.emailVerified) return false;
  return Boolean(customer.createdByInstitute) || !customer.emailVerification?.requestedAt;
}

/**
 * ENVOIE LE LIEN D'ACCÈS d'un compte ouvert par l'institut : « Votre espace
 * client est prêt — choisissez votre mot de passe ». Le choisir depuis ce lien
 * vaut vérification de l'adresse. Rappelable (renvoi depuis le Manager, lien
 * expiré, inscription sur une adresse déjà connue) : chaque appel invalide le
 * lien précédent.
 */
export async function sendCustomerAccessLink(customer, { origin = 'RESEND', siteUrl = '' } = {}) {
  const setupSecret = crypto.randomBytes(32).toString('hex');
  const requestedAt = new Date();
  const expiresAt = new Date(requestedAt.getTime() + ACCOUNT_SETUP_LINK_DAYS * 24 * 60 * 60 * 1000);
  await Customer.updateOne({ _id: customer._id }, { $set: {
    passwordReset: {
      tokenHash: crypto.createHash('sha256').update(setupSecret).digest('hex'),
      expiresAt,
      requestedAt,
      usedAt: null,
    },
  } });
  const event = await emitAndDispatch({
    type: 'customer.account_created',
    entityType: 'Customer',
    entityId: customer._id,
    payloadSafe: {
      customerId: String(customer._id),
      customerEmailMasked: maskEmail(customer.email),
      actionUrl: `${siteUrl || await configuredSiteUrl()}/espace-client/mot-de-passe?token=${setupSecret}&bienvenue=1`,
      expiresAt: expiresAt.toISOString(),
      origin,
      createdAt: requestedAt.toISOString(),
    },
    idempotencyKey: `customer-account-created:${customer._id}:${requestedAt.getTime()}`,
  });
  // `emitAndDispatch` ne lève pas : un événement refusé laisserait croire au
  // Manager que le lien est parti.
  if (!event) throw ApiError.serviceUnavailable('Le lien d’accès n’a pas pu être envoyé. Réessayez dans un instant.');
  return { sent: true, expiresAt };
}

export async function ensureCustomerForBooking({ email, name = '', phone = '' } = {}) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return { customer: null, created: false };
  if (!EMAIL_PATTERN.test(normalized)) throw ApiError.badRequest('Adresse e-mail client invalide');

  const existing = await Customer.findOne({ email: normalized });
  if (existing) {
    const { firstName, lastName } = splitName(name);
    let changed = false;
    if (!existing.firstName && firstName) { existing.firstName = firstName; changed = true; }
    if (!existing.lastName && lastName) { existing.lastName = lastName; changed = true; }
    if (!existing.phone && phone) { existing.phone = String(phone).trim(); changed = true; }
    if (changed) await existing.save();
    return { customer: existing, created: false };
  }

  const { firstName, lastName } = splitName(name);
  let customer;
  try {
    customer = await Customer.create({
      email: normalized,
      // Aléatoire et jamais transmis : personne ne peut se connecter avec.
      password: crypto.randomBytes(24).toString('base64url'),
      firstName,
      lastName,
      phone: String(phone || '').trim(),
      emailVerified: false,
      createdByInstitute: true,
    });
  } catch (err) {
    // Deux réservations simultanées pour la même adresse : la seconde reprend le compte.
    if (err?.code === 11000) {
      return { customer: await Customer.findOne({ email: normalized }), created: false };
    }
    throw err;
  }

  // La réservation ne dépend pas de l'e-mail : en cas d'échec, l'institut renverra le lien depuis la fiche cliente.
  await sendCustomerAccessLink(customer, { origin: 'MANUAL_BOOKING' }).catch(() => null);
  return { customer, created: true };
}

/**
 * « VOTRE RENDEZ-VOUS EST CONFIRMÉ » — émis pour tout rendez-vous prestation
 * qui a un client identifié, qu'il vienne de la vitrine ou du Manager.
 */
export async function emitAppointmentBooked(event, { saleNumber = '', origin = 'MANAGER' } = {}) {
  const customerId = event?.customerSnapshot?.customerId;
  if (!customerId || event.type !== 'SERVICE_BOOKING') return;
  const payment = event.paymentSnapshot || {};
  await emitAndDispatch({
    type: 'appointment.booked',
    entityType: 'CalendarEvent',
    entityId: event._id,
    payloadSafe: {
      calendarEventId: String(event._id),
      customerId: String(customerId),
      appointmentTitle: String(event.title || 'Rendez-vous').slice(0, 180),
      appointmentStart: new Date(event.startsAt).toISOString(),
      appointmentEnd: new Date(event.endsAt).toISOString(),
      paidAmount: Math.max(0, Math.round(Number(payment.paidCents || 0))),
      balanceDueAmount: Math.max(0, Math.round(Number(payment.balanceDueCents || 0))),
      ...(saleNumber ? { saleNumber: String(saleNumber).slice(0, 64) } : {}),
      origin,
      bookedAt: new Date().toISOString(),
    },
    idempotencyKey: `appointment-booked:${event._id}`,
  });
}

export default { ensureCustomerForBooking, emitAppointmentBooked };
