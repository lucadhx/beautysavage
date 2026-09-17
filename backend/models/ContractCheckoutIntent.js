import mongoose from 'mongoose';

const contractCheckoutIntentSchema = new mongoose.Schema(
  {
    stripePaymentIntentId: {
      type: String,
      unique: true,
      sparse: true
    },
    stripeSetupIntentId: {
      type: String,
      unique: true,
      sparse: true
    },
    contractId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contract',
      required: true
    },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    type: {
      type: String,
      enum: ['launch', 'monthly'],
      required: true
    },
    processed: { type: Boolean, default: false }
  },
  {
    collection: 'contract_checkout_intents',
    timestamps: true
  }
);

const ContractCheckoutIntent = mongoose.model(
  'ContractCheckoutIntent',
  contractCheckoutIntentSchema
);
export default ContractCheckoutIntent;
