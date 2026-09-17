import mongoose from 'mongoose';

// M1 — Identités de communication (expéditeurs). Inspiré de la logique LYCARZ (sender vérifié Brevo
// + domaine authentifié). AUCUN secret stocké ici. Le rôle `client` n'est JAMAIS une identité
// configurable (résolu depuis le contexte métier) — il n'apparaît donc pas dans l'enum.
export const COMMUNICATION_ROLES = ['support', 'commerciale'];
export const COMMUNICATION_SCOPES = ['platform', 'institute'];
// Appariement rôle → scope imposé : support=plateforme/dev, commerciale=institut/admin.
export const ROLE_SCOPE = { support: 'platform', commerciale: 'institute' };
export const IDENTITY_STATUSES = ['unverified', 'verification_pending', 'verified', 'disabled'];

const dnsRecordSchema = new mongoose.Schema(
  {
    type: { type: String, default: '' },
    host: { type: String, default: '' },
    value: { type: String, default: '' },
    status: { type: String, default: '' }
  },
  { _id: false }
);

const verificationSchema = new mongoose.Schema(
  {
    requestedAt: { type: Date, default: null },
    verifiedAt: { type: Date, default: null },
    lastErrorCode: { type: String, default: '' },
    lastErrorMessageSafe: { type: String, default: '' }
  },
  { _id: false }
);

const communicationIdentitySchema = new mongoose.Schema(
  {
    role: { type: String, enum: COMMUNICATION_ROLES, required: true },
    scope: { type: String, enum: COMMUNICATION_SCOPES, required: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    displayName: { type: String, required: true, trim: true },

    status: { type: String, enum: IDENTITY_STATUSES, default: 'unverified' },
    active: { type: Boolean, default: false },

    provider: { type: String, default: 'brevo' },
    providerSenderId: { type: String, default: '' },
    providerVerificationStatus: { type: String, default: '' },
    providerVerificationRequestedAt: { type: Date, default: null },
    providerVerifiedAt: { type: Date, default: null },

    domain: { type: String, default: '', trim: true, lowercase: true },
    domainAuthenticated: { type: Boolean, default: false },
    domainStatus: { type: String, default: '' },
    dnsRecords: { type: [dnsRecordSchema], default: [] },

    verification: { type: verificationSchema, default: () => ({}) },

    metadata: { type: mongoose.Schema.Types.Mixed, default: undefined },
    createdBy: { type: String, default: null },
    updatedBy: { type: String, default: null }
  },
  { timestamps: true, collection: 'communication_identities' }
);

// Cohérence rôle ↔ scope (support=platform, commerciale=institute).
communicationIdentitySchema.path('scope').validate(function validateScope(value) {
  return ROLE_SCOPE[this.role] === value;
}, 'Scope incohérent avec le rôle (support=platform, commerciale=institute).');

// Au plus UNE identité active par (role, scope).
communicationIdentitySchema.index(
  { role: 1, scope: 1 },
  { name: 'comm_identity_active_per_role_scope', unique: true, partialFilterExpression: { active: true } }
);
communicationIdentitySchema.index({ email: 1, role: 1, scope: 1 }, { name: 'comm_identity_lookup' });

const CommunicationIdentity = mongoose.model('CommunicationIdentity', communicationIdentitySchema);
export default CommunicationIdentity;
