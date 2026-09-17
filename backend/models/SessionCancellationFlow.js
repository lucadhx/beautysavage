import mongoose from 'mongoose';

const FLOW_DECISIONS = ['pending', 'refund', 'reschedule', 'confirm', 'gift_card'];
const FLOW_TYPES = [
  'session_cancelled',
  'session_updated',
  'formation_deleted',
  'service_booking_cancelled'
];

const sessionSnapshotSchema = new mongoose.Schema(
  {
    startDate: { type: Date, default: null },
    durationDays: { type: Number, min: 1, default: 1 },
    schedule: {
      type: [
        {
          dayIndex: { type: Number, min: 1, required: true },
          startTime: { type: String, trim: true, default: '' },
          endTime: { type: String, trim: true, default: '' }
        }
      ],
      default: []
    },
    timezone: { type: String, trim: true, default: 'Europe/Paris' }
  },
  { _id: false }
);

const formationSnapshotSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: '' },
    coverImage: { type: String, trim: true, default: '' },
    type: { type: String, trim: true, default: 'presentiel' },
    price: { type: Number, default: 0 },
    refundDays: { type: Number, min: 0, default: 7 }
  },
  { _id: false }
);

const serviceSnapshotSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: '' },
    slug: { type: String, trim: true, default: '' },
    duration: { type: Number, default: 0 },
    cancellationDays: { type: Number, default: 7 },
    isActive: { type: Boolean, default: true },
    isBookable: { type: Boolean, default: true },
    allowClientChoosePractitioner: { type: Boolean, default: true }
  },
  { _id: false }
);

const bookingSnapshotSchema = new mongoose.Schema(
  {
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    totalPrice: { type: Number, default: 0 },
    practitionerId: { type: mongoose.Schema.Types.ObjectId, ref: 'PractitionerProfile', default: null },
    selectedOptions: { type: mongoose.Schema.Types.Mixed, default: [] }
  },
  { _id: false }
);

const sessionCancellationAuditSchema = new mongoose.Schema(
  {
    type: { type: String, trim: true, required: true },
    at: { type: Date, default: () => new Date() },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { _id: false }
);

const sessionCancellationFlowSchema = new mongoose.Schema(
  {
    flowId: {
      type: String,
      required: true,
      trim: true,
      unique: true
    },
    tokenHash: {
      type: String,
      required: true,
      trim: true
    },
    tokenCreatedAt: {
      type: Date,
      required: true
    },
    tokenExpiresAt: {
      type: Date,
      required: true
    },
    usedAt: {
      type: Date,
      default: null
    },
    decision: {
      type: String,
      enum: FLOW_DECISIONS,
      default: 'pending'
    },
    flowType: {
      type: String,
      enum: FLOW_TYPES,
      default: 'session_cancelled'
    },
    decisionAt: {
      type: Date,
      default: null
    },
    autoRefundAt: {
      type: Date,
      required: true
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FormationSession',
      default: null
    },
    formationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Formation',
      required: false,
      default: null
    },
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      default: null
    },
    bookingId: {
      type: String,
      trim: true,
      default: null
    },
    saleId: {
      type: String,
      trim: true,
      default: ''
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    clientEmail: {
      type: String,
      trim: true,
      default: ''
    },
    purchaseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Purchase',
      default: null
    },
    originalSessionSnapshot: {
      type: sessionSnapshotSchema,
      default: () => ({})
    },
    updatedSessionSnapshot: {
      type: sessionSnapshotSchema,
      default: null
    },
    formationSnapshot: {
      type: formationSnapshotSchema,
      default: () => ({})
    },
    serviceSnapshot: {
      type: serviceSnapshotSchema,
      default: null
    },
    bookingSnapshot: {
      type: bookingSnapshotSchema,
      default: null
    },
    chosenSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FormationSession',
      default: null
    },
    chosenSessionSnapshot: {
      type: sessionSnapshotSchema,
      default: null
    },
    acceptedCgv: {
      type: Boolean,
      default: false
    },
    renunciationTextAccepted: {
      type: String,
      trim: true,
      default: null
    },
    renunciationTextPrevious: {
      type: String,
      trim: true,
      default: null
    },
    refundRequestId: {
      type: String,
      trim: true,
      default: ''
    },
    giftCardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GiftCard',
      default: null
    },
    reason: {
      type: String,
      trim: true,
      default: ''
    },
    audit: {
      type: [sessionCancellationAuditSchema],
      default: []
    }
  },
  {
    collection: 'sessioncancellationflows',
    timestamps: true
  }
);

sessionCancellationFlowSchema.index({ tokenHash: 1 }, { unique: true });
sessionCancellationFlowSchema.index({ userId: 1, decision: 1, autoRefundAt: 1 });
sessionCancellationFlowSchema.index({ sessionId: 1, flowType: 1, decision: 1 });
sessionCancellationFlowSchema.index({ formationId: 1, createdAt: -1 });
sessionCancellationFlowSchema.index({ purchaseId: 1, flowType: 1, decision: 1 });
sessionCancellationFlowSchema.index({ serviceId: 1, flowType: 1, decision: 1 });
sessionCancellationFlowSchema.index({ bookingId: 1, flowType: 1, decision: 1 });

const SessionCancellationFlow = mongoose.model(
  'SessionCancellationFlow',
  sessionCancellationFlowSchema
);

export { FLOW_DECISIONS, FLOW_TYPES };
export default SessionCancellationFlow;
