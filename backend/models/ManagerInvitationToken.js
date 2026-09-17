// RX-BLOCKER-2 — Jeton d'invitation manager (miroir de ResetPasswordToken). Token OPAQUE hashé SHA-256,
// TTL 7 jours (TTL index), usage unique. Jamais loggé en clair.
import mongoose from 'mongoose';

const managerInvitationTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    used: { type: Boolean, default: false },
    usedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    sentAt: { type: Date, default: () => new Date() },
    lastSentAt: { type: Date, default: () => new Date() },
    createdAt: { type: Date, default: () => new Date() }
  },
  { collection: 'manager_invitation_tokens' }
);

// Purge automatique après expiration.
managerInvitationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const ManagerInvitationToken = mongoose.model('ManagerInvitationToken', managerInvitationTokenSchema);
export default ManagerInvitationToken;
