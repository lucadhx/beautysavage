// M1 — Service de gestion des identités de communication (support / commerciale).
// Le rôle `client` n'est JAMAIS configurable ici (résolu depuis le contexte métier).
import CommunicationIdentity, { ROLE_SCOPE } from '../models/CommunicationIdentity.js';
import * as brevoSender from './communicationBrevoSenderAdapter.js';

export class CommunicationIdentityError extends Error {
  constructor(code, message, status = 400) {
    super(message || code);
    this.name = 'CommunicationIdentityError';
    this.code = code;
    this.status = status;
  }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function domainFromEmail(email) {
  const at = String(email || '').lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : '';
}

/** Valide le rôle et déduit le scope imposé. Rejette `client` et tout rôle/scope incohérent. */
function resolveRoleScope(role, scope) {
  if (role === 'client') {
    throw new CommunicationIdentityError('client_not_configurable', 'Le rôle client n’est pas configurable.', 400);
  }
  const expected = ROLE_SCOPE[role];
  if (!expected) {
    throw new CommunicationIdentityError('invalid_role', 'Rôle de communication invalide.', 400);
  }
  if (scope !== undefined && scope !== null && scope !== expected) {
    throw new CommunicationIdentityError('invalid_scope', `Le rôle ${role} impose le scope ${expected}.`, 400);
  }
  return expected;
}

export async function createCommunicationIdentity({ role, scope, email, displayName, actor } = {}) {
  const resolvedScope = resolveRoleScope(role, scope);
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw new CommunicationIdentityError('invalid_email', 'Adresse e-mail invalide.', 400);
  }
  const name = String(displayName || '').trim();
  if (!name) {
    throw new CommunicationIdentityError('display_name_required', 'Le nom d’affichage est requis.', 400);
  }
  const identity = await CommunicationIdentity.create({
    role,
    scope: resolvedScope,
    email: normalizedEmail,
    displayName: name,
    domain: domainFromEmail(normalizedEmail),
    status: 'unverified',
    active: false,
    createdBy: actor || null,
    updatedBy: actor || null
  });
  return identity;
}

export async function listCommunicationIdentities({ role, scope } = {}) {
  const filter = {};
  if (role) filter.role = role;
  if (scope) filter.scope = scope;
  return CommunicationIdentity.find(filter).sort({ createdAt: -1 }).lean();
}

async function loadIdentity(id) {
  const identity = await CommunicationIdentity.findById(id);
  if (!identity) {
    throw new CommunicationIdentityError('identity_not_found', 'Identité introuvable.', 404);
  }
  return identity;
}

export async function setActiveCommunicationIdentity(id, actor) {
  const identity = await loadIdentity(id);
  if (identity.status !== 'verified') {
    throw new CommunicationIdentityError('identity_not_verified', 'Identité non vérifiée : activation impossible.', 409);
  }
  // Désactive les autres actives du même (role, scope) AVANT d'activer (séquentiel, sans transaction).
  await CommunicationIdentity.updateMany(
    { role: identity.role, scope: identity.scope, active: true, _id: { $ne: identity._id } },
    { active: false, updatedBy: actor || null }
  );
  identity.active = true;
  identity.updatedBy = actor || null;
  await identity.save();
  return identity;
}

export async function requestSenderVerification(id, actor) {
  const identity = await loadIdentity(id);
  try {
    const res = await brevoSender.requestSenderVerification({ email: identity.email, name: identity.displayName });
    identity.providerSenderId = res.senderId || identity.providerSenderId;
    identity.providerVerificationStatus = res.status || 'verification_pending';
    identity.providerVerificationRequestedAt = new Date();
    identity.status = 'verification_pending';
    identity.verification = { ...identity.verification?.toObject?.(), requestedAt: new Date(), lastErrorCode: '', lastErrorMessageSafe: '' };
    identity.updatedBy = actor || null;
    await identity.save();
    return identity;
  } catch (error) {
    identity.verification = {
      ...identity.verification?.toObject?.(),
      lastErrorCode: error?.code || 'verification_request_failed',
      lastErrorMessageSafe: error?.message || 'Échec de la demande de vérification.'
    };
    identity.updatedBy = actor || null;
    await identity.save();
    throw error instanceof CommunicationIdentityError
      ? error
      : new CommunicationIdentityError(error?.code || 'verification_request_failed', error?.message, 502);
  }
}

export async function confirmSenderVerification(id, otpOrCode, actor) {
  const identity = await loadIdentity(id);
  try {
    const res = await brevoSender.confirmSenderVerification({
      senderId: identity.providerSenderId,
      otp: String(otpOrCode || '').trim()
    });
    const verified = res.status === 'verified';
    identity.providerVerificationStatus = res.status || identity.providerVerificationStatus;
    if (verified) {
      identity.status = 'verified';
      identity.providerVerifiedAt = new Date();
      identity.verification = { ...identity.verification?.toObject?.(), verifiedAt: new Date(), lastErrorCode: '', lastErrorMessageSafe: '' };
    }
    identity.updatedBy = actor || null;
    await identity.save();
    return identity;
  } catch (error) {
    identity.verification = {
      ...identity.verification?.toObject?.(),
      lastErrorCode: error?.code || 'verification_confirm_failed',
      lastErrorMessageSafe: error?.message || 'Échec de la confirmation.'
    };
    identity.updatedBy = actor || null;
    await identity.save();
    throw error instanceof CommunicationIdentityError
      ? error
      : new CommunicationIdentityError(error?.code || 'verification_confirm_failed', error?.message, 502);
  }
}

export async function refreshIdentityVerificationStatus(id) {
  const identity = await loadIdentity(id);
  const sender = await brevoSender.getSenderStatus({ email: identity.email });
  if (sender.senderId) identity.providerSenderId = sender.senderId;
  if (sender.active && identity.status !== 'disabled') {
    identity.status = 'verified';
    if (!identity.providerVerifiedAt) identity.providerVerifiedAt = new Date();
  }
  if (identity.domain) {
    const dom = await brevoSender.getDomainStatus({ domain: identity.domain });
    identity.domainAuthenticated = Boolean(dom.authenticated);
    identity.domainStatus = dom.status || '';
    identity.dnsRecords = Array.isArray(dom.dnsRecords) ? dom.dnsRecords : [];
  }
  await identity.save();
  return identity;
}

export async function getActiveIdentity(role, scope) {
  const resolvedScope = scope || ROLE_SCOPE[role];
  return CommunicationIdentity.findOne({ role, scope: resolvedScope, active: true, status: 'verified' }).lean();
}

/**
 * Vérifie qu'une identité active+vérifiée existe pour (role, scope).
 * mode 'strict' (défaut) → throw si absente ; mode 'warn' → renvoie {ready:false} sans throw.
 * `domainAuthenticated:false` n'empêche PAS d'être prêt (verified suffit) ; le flag est exposé.
 */
export async function assertIdentityReady(role, scope, { mode = 'strict' } = {}) {
  const identity = await getActiveIdentity(role, scope);
  if (!identity) {
    if (mode === 'warn') return { ready: false, identity: null };
    throw new CommunicationIdentityError('identity_not_ready', `Aucune identité ${role} active et vérifiée.`, 409);
  }
  return { ready: true, identity, domainAuthenticated: Boolean(identity.domainAuthenticated) };
}
