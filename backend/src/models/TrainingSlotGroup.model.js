import mongoose from 'mongoose';

/**
 * CRÉNEAU PARTAGÉ — plusieurs sessions de formations présentielles DIFFÉRENTES
 * proposées sur le même créneau, parce que la formatrice n'en donnera qu'une.
 *
 *   OUVERT     toutes les sessions membres sont en vente ;
 *   ATTRIBUÉ   la première vente PAYÉE a désigné la gagnante (`winner`) ; les
 *              autres sessions sont annulées (« créneau attribué à … ») ;
 *   DISSOUS    il ne reste qu'une session : ce n'est plus un créneau partagé.
 *
 * `hold` est la RETENUE EXCLUSIVE pendant un paiement : tant qu'elle court,
 * aucune autre cliente ne peut ouvrir de paiement sur une session du groupe.
 * L'attribution est une écriture CONDITIONNELLE (`status: OPEN → ASSIGNED`) :
 * deux paiements simultanés ne peuvent jamais désigner deux gagnantes.
 */
const memberSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceProduct', required: true },
    sessionId: { type: mongoose.Schema.Types.ObjectId, required: true },
    title: { type: String, default: '' },
    /** Annulée PAR l'attribution (et donc rouvrable), pas par l'institut. */
    cancelledByAssignment: { type: Boolean, default: false },
  },
  { _id: false }
);

const trainingSlotGroupSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ['OPEN', 'ASSIGNED', 'DISSOLVED'], default: 'OPEN', index: true },
    members: { type: [memberSchema], default: [] },
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, required: true },
    hold: {
      saleId: { type: mongoose.Schema.Types.ObjectId, default: null },
      customerId: { type: mongoose.Schema.Types.ObjectId, default: null },
      sessionId: { type: mongoose.Schema.Types.ObjectId, default: null },
      expiresAt: { type: Date, default: null },
    },
    winner: {
      productId: { type: mongoose.Schema.Types.ObjectId, default: null },
      sessionId: { type: mongoose.Schema.Types.ObjectId, default: null },
      saleId: { type: mongoose.Schema.Types.ObjectId, default: null },
      title: { type: String, default: '' },
      at: { type: Date, default: null },
    },
    history: {
      type: [{ _id: false, at: Date, action: String, detail: String }],
      default: [],
    },
  },
  { timestamps: true }
);

trainingSlotGroupSchema.index({ 'members.sessionId': 1 });

export const TrainingSlotGroup = mongoose.model('TrainingSlotGroup', trainingSlotGroupSchema);
export default TrainingSlotGroup;
