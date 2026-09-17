import crypto from 'node:crypto';
import mongoose from 'mongoose';

const saleItemSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['product', 'formation', 'gift-card', 'formation-option', 'service', 'service-option'],
      required: true
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    formationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Formation',
      default: null
    },
    name: {
      type: String,
      trim: true,
      default: ''
    },
    price: {
      type: Number,
      default: 0
    },
    basePrice: {
      type: Number,
      default: 0
    },
    finalPrice: {
      type: Number,
      default: 0
    },
    promotionApplied: {
      type: Boolean,
      default: false
    },
    promotionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Promotion',
      default: null
    },
    consumerWaiverSnapshot: {
      refundDays: { type: Number, default: null },
      retractationDays: { type: Number, default: 14 },
      waiverType: {
        type: String,
        enum: ['legal', 'institut', 'both', null],
        default: null
      },
      waiverAcceptedAt: { type: Date, default: null }
    }
  },
  { _id: false }
);

const saleSchema = new mongoose.Schema(
  {
    saleId: {
      type: String,
      required: true,
      trim: true
    },
    invoiceToken: {
      type: String,
      trim: true,
      default: () => crypto.randomBytes(24).toString('hex')
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    customer: {
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
      email: {
        type: String,
        trim: true,
        default: ''
      }
    },
    items: {
      type: [saleItemSchema],
      default: []
    },
    giftCardUsage: {
      type: [
        {
          giftCardId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'GiftCard',
            required: true
          },
          code: {
            type: String,
            trim: true,
            required: true
          },
          amountUsed: {
            type: Number,
            default: 0
          }
        }
      ],
      default: []
    },
    totalAmount: {
      type: Number,
      default: 0
    },
    commissionRate: {
      type: Number,
      default: null
    },
    commissionAmount: {
      type: Number,
      default: null
    },
    itemCount: {
      type: Number,
      default: 0
    },
    accepted_cgv: {
      type: Boolean,
      default: true
    },
    renonciation_text: {
      type: String,
      trim: true,
      default: null
    },
    date_formation: {
      type: Date,
      default: null
    },
    date_session: {
      type: Date,
      default: null
    },
    date_achat: {
      type: Date,
      default: () => new Date()
    },
    consumerWaiverAcceptedText: {
      type: String,
      trim: true
    },
    consumerWaiverAcceptedAt: {
      type: Date
    },
    // Sprint pré-React A1 — snapshot immuable des consentements légaux revalidés
    // côté serveur au moment de l'achat (CGV / rétractation / renonciation). Tous
    // les champs sont optionnels : les ventes historiques restent valides.
    legalConsentSnapshot: {
      cgvAccepted: { type: Boolean, default: null },
      cgvAcceptedAt: { type: Date, default: null },
      withdrawalNoticeAccepted: { type: Boolean, default: null },
      withdrawalWaiverAccepted: { type: Boolean, default: null },
      serviceDatedAcknowledged: { type: Boolean, default: null },
      digitalContentImmediateAccessAccepted: { type: Boolean, default: null },
      source: { type: String, trim: true, default: null },
      version: { type: String, trim: true, default: null }
    },
    client_ip: {
      type: String,
      trim: true,
      default: '0.0.0.0'
    },
    // Sprint pré-React A7 — statut de livraison d'accès pour les achats distanciel.
    // 'manual_pending' = accès livré manuellement (pas de faux « accès immédiat ») ;
    // 'immediate' = accès immédiat réellement configuré ; null = non applicable.
    accessDeliveryStatus: {
      type: String,
      enum: ['manual_pending', 'immediate', null],
      default: null
    },
    // Pré-React C3 — horodatage de l'octroi d'accès distanciel (accès immédiat). Une fois
    // posé, la formation distancielle n'est plus remboursable (contenu numérique à vie).
    accessGrantedAt: {
      type: Date,
      default: null
    },
    // Pré-React — snapshot pricing : promotion (une seule), carte cadeau comme MOYEN DE
    // PAIEMENT (pas une remise), base de commission = prix vendu. Tous champs optionnels.
    pricingSnapshot: {
      catalogAmount: { type: Number, default: null },
      promotionDiscountAmount: { type: Number, default: null },
      soldAmount: { type: Number, default: null },
      giftCardPaymentAmount: { type: Number, default: null },
      stripePaymentAmount: { type: Number, default: null },
      commissionBaseAmount: { type: Number, default: null },
      refundableAmount: { type: Number, default: null },
      version: { type: String, default: null }
    },
    // Pré-React B1 — snapshot fiscal V1 (franchise en base, TVA non applicable).
    // HT = TTC, vatAmount = 0. Source : constants/tax.js. Tous champs optionnels :
    // les ventes historiques restent valides.
    taxSnapshot: {
      taxMode: { type: String, default: null },
      vatRate: { type: Number, default: null },
      vatLegalLabel: { type: String, default: null },
      totalExcludingTax: { type: Number, default: null },
      vatAmount: { type: Number, default: null },
      totalIncludingTax: { type: Number, default: null },
      version: { type: String, default: null }
    },
    createdAt: {
      type: Date,
      default: () => new Date()
    },
    refundRequestId: {
      type: String,
      trim: true,
      default: ''
    },
    refundStatus: {
      type: String,
      trim: true,
      default: ''
    },
    refundAmount: {
      type: Number,
      default: 0
    },
    instituteDecision: {
      flowId: {
        type: String,
        trim: true,
        default: ''
      },
      flowType: {
        type: String,
        trim: true,
        default: ''
      },
      status: {
        type: String,
        trim: true,
        default: ''
      },
      reason: {
        type: String,
        trim: true,
        default: ''
      },
      updatedAt: {
        type: Date,
        default: null
      }
    },
    rescheduleInfo: {
      previousSessionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'FormationSession',
        default: null
      },
      nextSessionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'FormationSession',
        default: null
      },
      previousSessionStartAt: {
        type: Date,
        default: null
      },
      nextSessionStartAt: {
        type: Date,
        default: null
      },
      confirmedSessionStartAt: {
        type: Date,
        default: null
      },
      updatedAt: {
        type: Date,
        default: null
      }
    },
    giftCardCompensation: {
      giftCardId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'GiftCard',
        default: null
      },
      code: {
        type: String,
        trim: true,
        default: ''
      },
      amount: {
        type: Number,
        default: 0
      },
      balance: {
        type: Number,
        default: 0
      },
      createdAt: {
        type: Date,
        default: null
      }
    },
    stripeSessionId: {
      type: String,
      trim: true,
      default: null
    },
    stripePaymentIntentId: {
      type: String,
      trim: true,
      default: null
    },
    stripeFee: {
      type: Number,
      default: null
    },
    stripeNet: {
      type: Number,
      default: null
    }
  },
  { collection: 'sales' }
);

saleSchema.index({ saleId: 1 }, { unique: true });
saleSchema.index({ invoiceToken: 1 }, { unique: true, sparse: true });
saleSchema.index({ userId: 1 });
saleSchema.index({ 'items.itemId': 1, 'items.type': 1 });
saleSchema.index({ 'items.formationId': 1, 'items.type': 1 });
saleSchema.index({ stripeSessionId: 1 }, { sparse: true });
// Phase 1B-1: enforce ONE sale per Stripe PaymentIntent at the DB level. This unique
// partial index (string values only) also covers lookups by stripePaymentIntentId,
// so it replaces the previous non-unique sparse index on the same field. Sales with
// stripePaymentIntentId=null (mock / internal gift-card / legacy) are NOT constrained
// and never collide. Built deterministically at boot (app.js) before traffic.
saleSchema.index(
  { stripePaymentIntentId: 1 },
  {
    unique: true,
    name: 'uniq_stripe_payment_intent',
    partialFilterExpression: { stripePaymentIntentId: { $type: 'string' } }
  }
);

const Sale = mongoose.model('Sale', saleSchema);
export default Sale;
