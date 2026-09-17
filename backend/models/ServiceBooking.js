import mongoose from 'mongoose';
import { ACTIVE_SERVICE_BOOKING_STATUSES } from '../constants/serviceBooking.js';

const selectedOptionSchema = new mongoose.Schema({
  optionId: { type: mongoose.Schema.Types.ObjectId },
  name: { type: String },
  price: { type: Number }
}, { _id: false });

const consumerWaiverSnapshotSchema = new mongoose.Schema({
  refundDays: { type: Number },
  retractationDays: { type: Number, default: 14 },
  waiverType: {
    type: String,
    enum: ['legal', 'institut', 'both', null],
    default: null
  },
  waiverAcceptedAt: { type: Date, default: null }
}, { _id: false });

const serviceBookingSchema = new mongoose.Schema({
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service',
    required: true
  },
  practitionerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PractitionerProfile',
    required: true
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  bookingId: { type: String, required: true },

  startAt: { type: Date, required: true },
  endAt: { type: Date, required: true },

  selectedOptions: { type: [selectedOptionSchema], default: [] },

  totalPrice: { type: Number, required: true },
  depositAmount: { type: Number, default: 0 },
  // Pré-React D3 — acompte : montant total vendu + solde restant (réglé sur place en V1).
  totalSoldAmount: { type: Number, default: 0 },
  balanceDueAmount: { type: Number, default: 0 },
  balanceSettlementMode: { type: String, enum: ['none', 'pay_on_site', null], default: null },
  balancePaidAt: { type: Date, default: null },
  // RX2.3 — moyen de règlement du solde sur place (CB/espèces/autre), renseigné depuis le drawer
  // finance lors de l'encaissement. Additif/optionnel : les réservations historiques restent valides.
  balancePaymentMethod: { type: String, enum: ['cash', 'card', 'other', null], default: null },

  paymentType: {
    type: String,
    enum: ['full', 'deposit', 'free'],
    default: 'full'
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'deposit_paid', 'paid', 'refunded', 'cancelled'],
    default: 'pending'
  },
  stripePaymentIntentId: { type: String, default: null, sparse: true },

  status: {
    type: String,
    enum: ['pending_payment', 'confirmed', 'cancelled', 'no_show', 'completed'],
    default: 'pending_payment'
  },
  cancelledAt: { type: Date, default: null },
  cancelledBy: { type: String, enum: ['client', 'admin', 'system', null], default: null },
  noShowAt: { type: Date, default: null },

  consumerWaiverSnapshot: { type: consumerWaiverSnapshotSchema, default: () => ({}) },

  saleId: { type: String, default: null, trim: true },

  // M13 — origine de la réservation et mode de règlement.
  //  - source 'online'           : checkout client habituel (défaut, rétro-compatible).
  //  - source 'manual_institute' : créée au comptoir par l'admin (paiement sur place, pas de Stripe).
  source: {
    type: String,
    enum: ['online', 'manual_institute'],
    default: 'online'
  },
  paymentMode: {
    type: String,
    enum: ['stripe', 'on_site'],
    default: 'stripe'
  },
  // Admin créateur (réservation manuelle) — traçabilité.
  createdByAdminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  manualNote: { type: String, trim: true, default: '' },

  remindersSent: [{ type: String }],

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { collection: 'service_bookings' });

serviceBookingSchema.index({ bookingId: 1 }, { unique: true });
serviceBookingSchema.index({ clientId: 1, startAt: -1 });
serviceBookingSchema.index({ practitionerId: 1, startAt: -1 });
// M10/M11 — `practitionerId` = entité institut UNIQUE : cet index unique partiel garantit déjà
// l'anti-double-booking GLOBAL (une seule entité). Conservé legacy (cleanup futur via script).
serviceBookingSchema.index(
  { practitionerId: 1, startAt: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ACTIVE_SERVICE_BOOKING_STATUSES }
    }
  }
);
// M11B — index GLOBAL (non-unique) pour les requêtes calendrier par plage de dates/statut,
// indépendant du prestataire (entité institut unique). Safe à créer au boot.
serviceBookingSchema.index({ startAt: 1, status: 1 });
serviceBookingSchema.index({ serviceId: 1 });

const ServiceBooking = mongoose.model('ServiceBooking', serviceBookingSchema);
export default ServiceBooking;
