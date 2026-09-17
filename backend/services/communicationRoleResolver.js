// M1 — Resolver fromRole/toRole. BRIQUE SEULE (non câblée aux envois existants en M1).
// fromRole ∈ {support, commerciale} ; toRole ∈ {support, commerciale, client}.
// support = identité active platform ; commerciale = identité active institute ;
// client = résolu depuis le contexte métier (context.client.email). Aucun fallback hardcodé.
import { getActiveIdentity, CommunicationIdentityError } from './communicationIdentityService.js';

const SENDER_ROLES = ['support', 'commerciale'];
const RECIPIENT_ROLES = ['support', 'commerciale', 'client'];

async function resolveIdentityParty(role) {
  const identity = await getActiveIdentity(role);
  if (!identity) {
    throw new CommunicationIdentityError('identity_not_ready', `Aucune identité ${role} active et vérifiée.`, 409);
  }
  return { email: identity.email, name: identity.displayName, role };
}

/** Expéditeur : doit être une identité configurée (support/commerciale). */
export async function resolveSender(role, _context = {}) {
  if (!SENDER_ROLES.includes(role)) {
    throw new CommunicationIdentityError('invalid_from_role', `fromRole invalide : ${role}.`, 400);
  }
  return resolveIdentityParty(role);
}

/** Destinataire : support/commerciale = identité active ; client = contexte métier. */
export async function resolveRecipient(role, context = {}) {
  if (!RECIPIENT_ROLES.includes(role)) {
    throw new CommunicationIdentityError('invalid_to_role', `toRole invalide : ${role}.`, 400);
  }
  if (role === 'client') {
    const email = String(context?.client?.email || '').trim().toLowerCase();
    if (!email) {
      throw new CommunicationIdentityError('client_recipient_missing', 'Destinataire client absent du contexte.', 400);
    }
    const name = context?.client?.name ? String(context.client.name).trim() : undefined;
    return { email, name, role: 'client' };
  }
  return resolveIdentityParty(role);
}

/** Construit l'enveloppe { from, to[] } pour un envoi (non utilisée par les envois actuels en M1). */
export async function resolveMailEnvelope({ fromRole, toRole, context = {} } = {}) {
  const from = await resolveSender(fromRole, context);
  const recipient = await resolveRecipient(toRole, context);
  return { from, to: [recipient] };
}
