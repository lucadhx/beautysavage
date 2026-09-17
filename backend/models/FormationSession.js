import mongoose from 'mongoose';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const FORMATION_SESSION_STATUS_ACTIVE = 'active';
export const FORMATION_SESSION_STATUS_CANCELED_BY_INSTITUTE = 'canceled_by_institute';
export const FORMATION_SESSION_STATUS_CANCELED = 'canceled';
export const FORMATION_SESSION_INACTIVE_STATUSES = Object.freeze([
  FORMATION_SESSION_STATUS_CANCELED_BY_INSTITUTE,
  FORMATION_SESSION_STATUS_CANCELED
]);

export function normalizeFormationSessionStatus(value) {
  const normalized = String(value || FORMATION_SESSION_STATUS_ACTIVE)
    .trim()
    .toLowerCase();
  return normalized || FORMATION_SESSION_STATUS_ACTIVE;
}

export function isInactiveFormationSessionStatus(value) {
  return FORMATION_SESSION_INACTIVE_STATUSES.includes(normalizeFormationSessionStatus(value));
}

export function buildActiveFormationSessionFilter(base = {}) {
  return {
    ...base,
    status: { $nin: FORMATION_SESSION_INACTIVE_STATUSES }
  };
}

const scheduleEntrySchema = new mongoose.Schema(
  {
    dayIndex: {
      type: Number,
      required: true,
      min: 1
    },
    startTime: {
      type: String,
      required: true,
      match: TIME_PATTERN
    },
    endTime: {
      type: String,
      required: true,
      match: TIME_PATTERN
    }
  },
  {
    _id: false
  }
);

const formationSessionSchema = new mongoose.Schema(
  {
    formationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Formation',
      required: true
    },
    startDate: {
      type: Date,
      required: true
    },
    durationDays: {
      type: Number,
      required: true,
      min: 1
    },
    schedule: {
      type: [scheduleEntrySchema],
      required: true
    },
    maxClients: {
      type: Number,
      required: true,
      min: 1
    },
    reservedCount: {
      type: Number,
      default: 0,
      min: 0
    },
    status: {
      type: String,
      enum: [
        FORMATION_SESSION_STATUS_ACTIVE,
        FORMATION_SESSION_STATUS_CANCELED_BY_INSTITUTE,
        FORMATION_SESSION_STATUS_CANCELED
      ],
      default: FORMATION_SESSION_STATUS_ACTIVE
    },
    canceledAt: {
      type: Date,
      default: null
    },
    canceledReason: {
      type: String,
      trim: true,
      default: ''
    },
    instructorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    // C1 — QR de présence (MVP). Token opaque propre à la session, encodé dans le QR affiché le
    // jour de la formation. Pas de caméra ni de certificat en C1 (préparé pour C2).
    qrToken: {
      type: String,
      default: ''
    },
    qrGeneratedAt: {
      type: Date,
      default: null
    },
    // LOT2 — clés de rappels déjà envoyés pour cette session (ex. "24h"), anti-doublon du
    // scheduler formationSessionRemindersJob (mirroir de ServiceBooking.remindersSent).
    remindersSent: {
      type: [String],
      default: []
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'formationsessions'
  }
);

formationSessionSchema.index({ formationId: 1, startDate: 1 });

const FormationSession = mongoose.model('FormationSession', formationSessionSchema);
export default FormationSession;
