import mongoose from 'mongoose';

const accessSchema = new mongoose.Schema(
  {
    public: { type: Boolean, default: true },
    requiresAuth: { type: Boolean, default: false },
    requiresPurchase: { type: Boolean, default: false },
    purchaseType: { type: String, default: null }
  },
  { _id: false }
);

const disabledSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    from: { type: Date, default: null },
    to: { type: Date, default: null }
  },
  { _id: false }
);

const pageSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    moduleFile: { type: String, required: true },
    type: { type: String, required: true, enum: ['vitrine', 'gestion'] },
    order: { type: Number, default: 0 },
    navigationPlacement: {
      type: String,
      enum: ['header', 'burger'],
      default: null
    },
    allowedRolesGestion: {
      type: [String],
      enum: ['admin', 'dev'],
      default: () => ['admin', 'dev']
    },
    access: { type: accessSchema, default: () => ({}) },
    disabled: { type: disabledSchema, default: () => ({}) },
    devOnly: { type: Boolean, default: false },
    categories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CategoryGestion'
      }
    ],
    categoryOrders: [
      {
        _id: false,
        categoryId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'CategoryGestion',
          default: null
        },
        order: { type: Number, default: 0 }
      }
    ]
  },
  { timestamps: true, collection: 'pages' }
);

const Page = mongoose.model('Page', pageSchema);
export default Page;
