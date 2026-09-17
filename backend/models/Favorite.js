import mongoose from 'mongoose';

export const FAVORITE_TARGET_TYPES = ['product', 'formation'];

const favoriteSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    targetType: {
      type: String,
      required: true,
      enum: FAVORITE_TARGET_TYPES
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    createdAt: {
      type: Date,
      default: () => new Date()
    }
  },
  { collection: 'favorites' }
);

favoriteSchema.index({ userId: 1, targetType: 1, targetId: 1 }, { unique: true });

const Favorite = mongoose.model('Favorite', favoriteSchema);
export default Favorite;
