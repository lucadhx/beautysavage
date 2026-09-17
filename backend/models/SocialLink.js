import mongoose from 'mongoose';

export const SOCIAL_TYPES = ['instagram', 'tiktok', 'youtube'];
export const SOCIAL_ORDER = ['instagram', 'tiktok', 'youtube'];

const socialLinkSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: SOCIAL_TYPES,
      required: true,
      lowercase: true,
      trim: true
    },
    url: {
      type: String,
      required: true,
      trim: true
    },
    isActive: {
      type: Boolean,
      default: false
    },
    createdAt: {
      type: Date,
      default: () => new Date()
    }
  },
  { versionKey: false }
);

socialLinkSchema.index({ type: 1 }, { unique: true });

export default mongoose.model('SocialLink', socialLinkSchema);
