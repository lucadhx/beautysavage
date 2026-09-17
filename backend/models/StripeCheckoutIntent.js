import mongoose from 'mongoose';

const stripeCheckoutIntentSchema = new mongoose.Schema(
  {
    checkoutState: {
      type: Object,
      required: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    clientIp: {
      type: String,
      default: ''
    },
    stripeSessionId: {
      type: String,
      default: null
    },
    createdAt: {
      type: Date,
      default: () => new Date(),
      expires: 3600
    }
  },
  { collection: 'stripe_checkout_intents' }
);

stripeCheckoutIntentSchema.index({ stripeSessionId: 1 }, { sparse: true });

const StripeCheckoutIntent = mongoose.model('StripeCheckoutIntent', stripeCheckoutIntentSchema);
export default StripeCheckoutIntent;
