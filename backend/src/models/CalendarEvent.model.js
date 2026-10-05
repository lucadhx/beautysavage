import mongoose from 'mongoose';

const moneySnapshotSchema = new mongoose.Schema(
  {
    totalCents: { type: Number, default: 0, min: 0 },
    paidCents: { type: Number, default: 0, min: 0 },
    depositCents: { type: Number, default: 0, min: 0 },
    balanceDueCents: { type: Number, default: 0, min: 0 },
    balancePaidCents: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'EUR' },
    balancePaymentMethod: { type: String, default: '' },
  },
  { _id: false }
);

const calendarEventSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['SERVICE_BOOKING', 'FORMATION_SESSION', 'MANUAL_BLOCK'],
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceProduct', default: null, index: true },
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceSale', default: null, index: true },
    lineId: { type: String, default: '' },
    customerSnapshot: {
      // Sans ce champ déclaré, Mongoose jetait l'identifiant du client : le
      // rendez-vous ne savait plus à qui écrire (confirmation, annulation).
      customerId: { type: String, default: '' },
      name: { type: String, default: '' },
      email: { type: String, default: '' },
      phone: { type: String, default: '' },
    },
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, required: true, index: true },
    timezone: { type: String, default: 'Europe/Paris' },
    status: {
      type: String,
      // HELD = créneau RETENU pendant le paiement en ligne (30 min) : il compte
      // comme occupé tant que `holdExpiresAt` n'est pas passé, puis s'efface.
      enum: ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'HELD'],
      default: 'SCHEDULED',
      index: true,
    },
    holdExpiresAt: { type: Date, default: null },
    paymentSnapshot: { type: moneySnapshotSchema, default: () => ({}) },
    notes: { type: String, default: '' },
    cancellation: {
      reason: { type: String, default: '' },
      cancelledAt: { type: Date, default: null },
      refundedCents: { type: Number, default: 0, min: 0 },
      refundedAt: { type: Date, default: null },
    },
    source: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

calendarEventSchema.index({ startsAt: 1, endsAt: 1, status: 1 });

export const CalendarEvent = mongoose.model('CalendarEvent', calendarEventSchema);
export default CalendarEvent;
