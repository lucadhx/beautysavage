import mongoose from 'mongoose';

const categoryGestionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    icon: {
      type: String,
      trim: true,
      default: 'bi-folder'
    },
    order: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  {
    timestamps: true,
    collection: 'categorygestion'
  }
);

categoryGestionSchema.index({ name: 1 }, { unique: true });
categoryGestionSchema.index({ order: 1, createdAt: 1 });

const CategoryGestion = mongoose.model('CategoryGestion', categoryGestionSchema);
export default CategoryGestion;
