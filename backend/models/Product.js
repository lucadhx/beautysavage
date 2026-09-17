import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    price: {
      type: Number,
      default: 0
    },
    coverImage: {
      type: String,
      trim: true,
      default: ''
    },
    trailerVideoUrl: {
      type: String,
      trim: true,
      default: ''
    },
    photos: {
      type: [String],
      default: [],
      set(value) {
        if (!Array.isArray(value)) return [];
        return value
          .map(entry => String(entry || '').trim())
          .filter(Boolean);
      }
    },
    active: {
      type: Boolean,
      default: true
    },
    isBoosted: {
      type: Boolean,
      default: false
    },
    boostOrder: {
      type: Number,
      min: 1,
      max: 3,
      default: null
    },
    createdAt: {
      type: Date,
      default: () => new Date()
    }
  },
  { collection: 'products' }
);

productSchema.index({ name: 1 }, { unique: true });

const Product = mongoose.model('Product', productSchema);
export default Product;
