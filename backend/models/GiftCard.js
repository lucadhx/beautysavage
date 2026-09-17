import mongoose from 'mongoose';

const GIFT_CARD_STATUSES = Object.freeze(['active', 'redeemed']);
// M13 — origine de la carte et mode de paiement.
const GIFT_CARD_CREATION_MODES = Object.freeze(['online', 'manual_institute']);
const GIFT_CARD_PAYMENT_MODES = Object.freeze(['stripe', 'on_site']);
const GIFT_CARD_MANUAL_PAYMENT_METHODS = Object.freeze(['cash', 'card', 'other']);

const giftCardSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true
    },
    configId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GiftCardConfig',
      default: null
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    balance: {
      type: Number,
      required: true,
      min: 0
    },
    reservedAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    reservations: {
      type: [
        {
          paymentIntentId: {
            type: String,
            required: true,
            trim: true
          },
          amount: {
            type: Number,
            required: true,
            min: 0
          },
          createdAt: {
            type: Date,
            default: Date.now
          }
        }
      ],
      default: []
    },
    status: {
      type: String,
      enum: GIFT_CARD_STATUSES,
      default: 'active'
    },
    saleId: {
      type: String,
      trim: true,
      default: ''
    },
    purchasedAt: {
      type: Date,
      default: () => new Date()
    },
    passwordHash: {
      type: String,
      trim: true,
      default: ''
    },
    passwordEncrypted: {
      type: String,
      trim: true,
      default: ''
    },

    // --- M13 : cartes cadeaux manuelles (paiement sur place) + bénéficiaire -----------------
    // Tous additifs. Les cartes existantes restent valides : creationMode/paymentMode par défaut
    // = parcours en ligne historique, recipientName/purchaserName vides (non bloquant en lecture).
    recipientName: {
      type: String,
      trim: true,
      default: ''
    },
    purchaserName: {
      type: String,
      trim: true,
      default: ''
    },
    message: {
      type: String,
      trim: true,
      default: ''
    },
    creationMode: {
      type: String,
      enum: GIFT_CARD_CREATION_MODES,
      default: 'online'
    },
    paymentMode: {
      type: String,
      enum: GIFT_CARD_PAYMENT_MODES,
      default: 'stripe'
    },
    // Libellé affiché ("Paiement sur place" pour les cartes créées à la main).
    paymentLabel: {
      type: String,
      trim: true,
      default: ''
    },
    // Template de rendu figé à la création (snapshot du template actif au moment de l'émission).
    activeTemplateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GiftCardTemplate',
      default: null
    },
    // QR : on ne stocke JAMAIS le token opaque en clair, seulement son hash (lookup côté backend).
    qrTokenHash: {
      type: String,
      trim: true,
      default: ''
    },
    qrPayloadVersion: {
      type: Number,
      default: 0
    },
    // LOT2 — version du PIN : incrémentée à chaque reset (invalidation de l'ancien code).
    pinVersion: {
      type: Number,
      default: 0
    },
    pinResetAt: {
      type: Date,
      default: null
    },
    // Émission manuelle : admin émetteur + détail du paiement sur place.
    createdByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    manualPaymentMethod: {
      type: String,
      enum: [...GIFT_CARD_MANUAL_PAYMENT_METHODS, null],
      default: null
    },
    manualPaymentNote: {
      type: String,
      trim: true,
      default: ''
    },
    // Rendus générés (stockage local) : image/preview HTML + PDF de la carte.
    cardVisualUrl: {
      type: String,
      trim: true,
      default: ''
    },
    generatedPdfUrl: {
      type: String,
      trim: true,
      default: ''
    }
  },
  {
    collection: 'giftCards',
    timestamps: true
  }
);

giftCardSchema.index({ code: 1 }, { unique: true });
giftCardSchema.index({ userId: 1 });
giftCardSchema.index({ 'reservations.paymentIntentId': 1 }, { sparse: true });
// M13 — lookup par QR : hash unique, index PARTIEL sur les seules valeurs non vides (les cartes
// legacy/sans QR ont qrTokenHash='' et ne sont pas contraintes par l'unicité).
giftCardSchema.index(
  { qrTokenHash: 1 },
  { unique: true, partialFilterExpression: { qrTokenHash: { $gt: '' } }, name: 'uniq_gift_card_qr_token' }
);
giftCardSchema.index({ creationMode: 1 });

const GiftCard = mongoose.model('GiftCard', giftCardSchema);
export {
  GIFT_CARD_STATUSES,
  GIFT_CARD_CREATION_MODES,
  GIFT_CARD_PAYMENT_MODES,
  GIFT_CARD_MANUAL_PAYMENT_METHODS
};
export default GiftCard;
