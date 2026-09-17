import mongoose from 'mongoose';

const giftCardConfigSchema = new mongoose.Schema(
  {
    minAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 50
    },
    // C1 — borne haute optionnelle (0 = illimité) + montants suggérés vitrine.
    maxAmount: {
      type: Number,
      min: 0,
      default: 0
    },
    presetAmounts: {
      type: [Number],
      default: []
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    image: {
      type: String,
      trim: true,
      default: ''
    }
  },
  {
    collection: 'giftCardConfigs',
    timestamps: true
  }
);

const GiftCardConfig = mongoose.model('GiftCardConfig', giftCardConfigSchema);
export default GiftCardConfig;
