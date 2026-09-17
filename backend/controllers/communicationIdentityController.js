// M1 — Endpoints de gestion des identités de communication. Payload SAFE (aucun secret).
import CommunicationIdentity from '../models/CommunicationIdentity.js';
import {
  createCommunicationIdentity,
  listCommunicationIdentities,
  setActiveCommunicationIdentity,
  requestSenderVerification,
  confirmSenderVerification,
  refreshIdentityVerificationStatus,
  CommunicationIdentityError
} from '../services/communicationIdentityService.js';

// Vue publique-safe d'une identité : aucun secret n'est stocké, on expose des champs neutres.
function toSafe(identity) {
  const i = typeof identity.toObject === 'function' ? identity.toObject() : identity;
  return {
    id: String(i._id),
    role: i.role,
    scope: i.scope,
    email: i.email,
    displayName: i.displayName,
    status: i.status,
    active: Boolean(i.active),
    provider: i.provider,
    providerSenderId: i.providerSenderId || '',
    providerVerificationStatus: i.providerVerificationStatus || '',
    domain: i.domain || '',
    domainAuthenticated: Boolean(i.domainAuthenticated),
    domainStatus: i.domainStatus || '',
    dnsRecords: Array.isArray(i.dnsRecords) ? i.dnsRecords : [],
    verification: {
      requestedAt: i.verification?.requestedAt || null,
      verifiedAt: i.verification?.verifiedAt || null,
      lastErrorCode: i.verification?.lastErrorCode || '',
      lastErrorMessageSafe: i.verification?.lastErrorMessageSafe || ''
    },
    createdAt: i.createdAt,
    updatedAt: i.updatedAt
  };
}

const actorOf = (req) => req.sessionUserId || null;
const isDev = (req) => String(req.sessionUser?.role || '').toLowerCase() === 'dev';

function handleError(res, error) {
  if (error instanceof CommunicationIdentityError) {
    return res.status(error.status || 400).json({ ok: false, code: error.code, error: error.message });
  }
  console.error('[communicationIdentity] erreur', error?.message);
  return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
}

// support → dev only. commerciale → admin ou dev.
async function loadManageable(req, res) {
  const identity = await CommunicationIdentity.findById(req.params.id);
  if (!identity) {
    res.status(404).json({ ok: false, code: 'identity_not_found', error: 'Identité introuvable.' });
    return null;
  }
  if (identity.role === 'support' && !isDev(req)) {
    res.status(403).json({ ok: false, code: 'forbidden_support_identity', error: 'Réservé au développeur.' });
    return null;
  }
  return identity;
}

export async function listIdentitiesHandler(req, res) {
  try {
    const { role, scope } = req.query || {};
    const identities = await listCommunicationIdentities({ role, scope });
    return res.json({ ok: true, identities: identities.map(toSafe) });
  } catch (error) {
    return handleError(res, error);
  }
}

function makeCreateHandler(role, scope) {
  return async function createHandler(req, res) {
    try {
      const { email, displayName } = req.body || {};
      const identity = await createCommunicationIdentity({ role, scope, email, displayName, actor: actorOf(req) });
      return res.status(201).json({ ok: true, identity: toSafe(identity) });
    } catch (error) {
      return handleError(res, error);
    }
  };
}

export const createSupportHandler = makeCreateHandler('support', 'platform');
export const createCommercialeHandler = makeCreateHandler('commerciale', 'institute');

export async function requestVerificationHandler(req, res) {
  try {
    const identity = await loadManageable(req, res);
    if (!identity) return undefined;
    const updated = await requestSenderVerification(identity._id, actorOf(req));
    return res.json({ ok: true, identity: toSafe(updated) });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function confirmVerificationHandler(req, res) {
  try {
    const identity = await loadManageable(req, res);
    if (!identity) return undefined;
    const { otp, code } = req.body || {};
    const updated = await confirmSenderVerification(identity._id, otp || code, actorOf(req));
    return res.json({ ok: true, identity: toSafe(updated) });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function setActiveHandler(req, res) {
  try {
    const identity = await loadManageable(req, res);
    if (!identity) return undefined;
    const updated = await setActiveCommunicationIdentity(identity._id, actorOf(req));
    return res.json({ ok: true, identity: toSafe(updated) });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function refreshHandler(req, res) {
  try {
    const identity = await loadManageable(req, res);
    if (!identity) return undefined;
    const updated = await refreshIdentityVerificationStatus(identity._id);
    return res.json({ ok: true, identity: toSafe(updated) });
  } catch (error) {
    return handleError(res, error);
  }
}
