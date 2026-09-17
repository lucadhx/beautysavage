import mongoose from 'mongoose';

const cartItemSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['product', 'formation'],
      required: true
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
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
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null
    }
  },
  { _id: false }
);

const cartSnapshotSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    items: {
      type: [cartItemSchema],
      default: []
    },
    totalAmount: {
      type: Number,
      default: 0
    },
    itemCount: {
      type: Number,
      default: 0
    },
    updatedAt: {
      type: Date,
      default: () => new Date()
    }
  },
  { collection: 'cartSnapshots' }
);

cartSnapshotSchema.index({ userId: 1 }, { unique: true });

const CartSnapshot = mongoose.model('CartSnapshot', cartSnapshotSchema);
export default CartSnapshot;
