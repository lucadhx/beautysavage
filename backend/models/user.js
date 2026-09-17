import mongoose from 'mongoose';

const ROLES = ['client', 'admin', 'dev'];

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  firstName: {
    type: String,
    trim: true,
    default: ''
  },
  lastName: {
    type: String,
    trim: true,
    default: ''
  },
  passwordHash: { type: String, required: true },
  passwordSalt: { type: String, required: true },
  role: {
    type: String,
    required: true,
    enum: ROLES
  },
  currentMode: {
    type: String,
    enum: ['vitrine', 'gestion'],
    default: 'vitrine'
  },
  sessionTokenHash: { type: String, default: null },
  isActive: { type: Boolean, default: true },
  mustChangePassword: { type: Boolean, default: false },
  emailVerified: { type: Boolean, default: true },
  emailVerificationCodeHash: { type: String, default: null },
  emailVerificationExpiresAt: { type: Date, default: null },
  emailVerificationAttempts: { type: Number, default: 0 },
  emailVerificationLastSentAt: { type: Date, default: null },
  stripeCustomerId: { type: String, default: null, sparse: true, index: true },
  bookingSuspended: { type: Boolean, default: false },
  createdAt: { type: Date, default: () => new Date() }
}, { collection: 'users' });
userSchema.add({
  lastLogin: { type: Date, default: null },
  active: { type: Boolean, default: true }
});
// RX-BLOCKER-2 — Cycle de vie d'un compte MANAGER invité (additif ; absent chez les clients existants).
// 'invited' = créé, mot de passe pas encore défini ; 'active' = invitation acceptée ; 'disabled' = désactivé.
userSchema.add({
  managerInviteStatus: { type: String, enum: ['invited', 'active', 'disabled'], default: undefined },
  managerInviteSentAt: { type: Date, default: null },
  managerActivatedAt: { type: Date, default: null },
  disabledAt: { type: Date, default: null }
});

userSchema.pre('save', function(next) {
  if (typeof this.isActive !== 'boolean' && typeof this.active === 'boolean') {
    this.isActive = this.active;
  }
  if (typeof this.isActive === 'boolean') {
    this.active = this.isActive;
  }
  next();
});

userSchema.index({ email: 1 }, { unique: true });

const User = mongoose.model('User', userSchema);
export default User;
