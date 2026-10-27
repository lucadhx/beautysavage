/**
 * IDENTITÉ DE LA CLIENTE — prénom, nom, téléphone.
 *
 * Obligatoires à l'inscription : l'institut doit savoir QUI vient (le planning
 * affiche le nom, pas une adresse e-mail) et pouvoir l'appeler (retard,
 * empêchement). Une cliente inscrite avant la règle complète les siens au
 * moment de réserver : la même règle les vérifie, une seule fois écrite.
 *
 * Module pur (aucune base) : l'inscription, le profil et le paiement lisent la
 * même règle.
 */
import { ApiError } from '../utils/ApiError.js';

const NAME_MAX = 60;

/** Le téléphone tel que saisi, nettoyé des espaces superflus — et ses chiffres. */
export function normalizePhone(raw) {
  const text = String(raw ?? '').trim().replace(/\s+/g, ' ');
  return { text, digits: text.replace(/\D/g, '') };
}

/** Un numéro plausible : 10 à 15 chiffres, seuls « + . - ( ) » et espaces autour. */
export function isPlausiblePhone(raw) {
  const { text, digits } = normalizePhone(raw);
  return /^[+\d][\d\s.\-()]*$/.test(text) && digits.length >= 10 && digits.length <= 15;
}

/** Ce qui manque à l'identité d'une cliente, en clés stables. */
export function missingIdentityFields(customer) {
  const missing = [];
  if (!String(customer?.firstName ?? '').trim()) missing.push('firstName');
  if (!String(customer?.lastName ?? '').trim()) missing.push('lastName');
  if (!isPlausiblePhone(customer?.phone)) missing.push('phone');
  return missing;
}

const LABELS = { firstName: 'votre prénom', lastName: 'votre nom', phone: 'un numéro de téléphone valide' };

/**
 * Valide et normalise prénom / nom / téléphone, ou refuse avec le détail de ce
 * qui manque (`CUSTOMER_IDENTITY_INVALID`, `fields`).
 */
export function assertCustomerIdentity(payload) {
  const identity = {
    firstName: String(payload?.firstName ?? '').trim().replace(/\s+/g, ' ').slice(0, NAME_MAX),
    lastName: String(payload?.lastName ?? '').trim().replace(/\s+/g, ' ').slice(0, NAME_MAX),
    phone: normalizePhone(payload?.phone).text.slice(0, 30),
  };
  const missing = missingIdentityFields(identity);
  if (missing.length) {
    const list = missing.map((k) => LABELS[k]);
    const sentence = list.length > 1 ? `${list.slice(0, -1).join(', ')} et ${list.at(-1)}` : list[0];
    throw ApiError.badRequest(`Indiquez ${sentence}.`, { code: 'CUSTOMER_IDENTITY_INVALID', fields: missing });
  }
  return identity;
}
