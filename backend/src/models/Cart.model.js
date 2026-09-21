import mongoose from 'mongoose';

const cartLineSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceProduct', required: true },
    quantity: { type: Number, default: 1, min: 1 },
    sessionId: { type: mongoose.Schema.Types.ObjectId, default: null },
    bookingSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    optionKeys: [{ type: String }],
    giftCard: { type: mongoose.Schema.Types.Mixed, default: null },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const cartSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, unique: true },
    lines: [cartLineSchema],
    updatedByCheckoutAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const Cart = mongoose.model('Cart', cartSchema);
export default Cart;
