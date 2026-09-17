import mongoose from 'mongoose';

// Pré-React D1 — `service` ajouté : Promotion devient la source officielle unique de
// promotion, y compris pour les prestations (Service.promotion devient legacy).
const PROMOTION_TARGETS = ['product', 'formation', 'service'];
const PROMOTION_TYPES = ['fixed', 'percentage'];

const promotionSchema = new mongoose.Schema(
  {
    targetType: {
      type: String,
      enum: PROMOTION_TARGETS,
      required: true
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    discountType: {
      type: String,
      enum: PROMOTION_TYPES,
      required: true
    },
    discountValue: {
      type: Number,
      required: true,
      min: 0
    },
    startAt: {
      type: Date,
      required: true
    },
    endAt: {
      type: Date,
      default: null
    },
    createdAt: {
      type: Date,
      default: () => new Date()
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  { collection: 'promotions' }
);

promotionSchema.index({ targetType: 1, targetId: 1, startAt: -1 });
promotionSchema.index({ startAt: 1, endAt: 1 });

const Promotion = mongoose.model('Promotion', promotionSchema);
export default Promotion;
