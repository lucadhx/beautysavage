import mongoose from 'mongoose';

const bookingSlotLockSchema = new mongoose.Schema({
  practitionerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PractitionerProfile',
    required: true
  },
  bookingId: {
    type: String,
    required: true,
    trim: true
  },
  slotStartAt: {
    type: Date,
    required: true
  },
  // M13 — type de verrou :
  //  - 'booking'  : verrou PERMANENT lié à une réservation confirmée (legacy, expiresAt null).
  //  - 'hold'     : verrou TEMPORAIRE posé quand l'admin sélectionne un créneau (expire seul).
  lockType: {
    type: String,
    enum: ['booking', 'hold'],
    default: 'booking'
  },
  // Date d'expiration (uniquement pour les holds). null pour les verrous permanents :
  // l'index TTL n'expire QUE les documents dont `expiresAt` est un Date → les permanents survivent.
  expiresAt: {
    type: Date,
    default: null
  },
  // Admin détenteur du hold (traçabilité) + jeton de session de hold.
  heldByAdminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  holdToken: {
    type: String,
    trim: true,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { collection: 'booking_slot_locks' });

// M10/M11 — `practitionerId` = entité institut UNIQUE : cet index unique est déjà GLOBAL de facto
// (un seul détenteur possible par minute). Conservé legacy.
bookingSlotLockSchema.index({ practitionerId: 1, slotStartAt: 1 }, { unique: true });
bookingSlotLockSchema.index({ bookingId: 1 });
// M13 — purge automatique des holds temporaires. expireAfterSeconds:0 = expire à l'instant `expiresAt`.
// Les verrous permanents (expiresAt:null, non-Date) sont IGNORÉS par le TTL → jamais purgés.
bookingSlotLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
bookingSlotLockSchema.index({ holdToken: 1 }, { sparse: true });
// M11B — l'index GLOBAL UNIQUE `{ slotStartAt } unique` (garantie double-booking SANS practitionerId)
// est créé VOLONTAIREMENT via scripts/cleanupPractitionerLegacy.js (--create-global-index, après
// contrôle de doublons), JAMAIS au boot. On NE déclare PAS `{ slotStartAt }` ici pour laisser au
// script la maîtrise exclusive de ce pattern d'index (clé identique = conflit MongoDB).

const BookingSlotLock = mongoose.model('BookingSlotLock', bookingSlotLockSchema);
export default BookingSlotLock;
