import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceProduct', required: true, index: true },
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceSale', required: true, index: true },
    targetKind: { type: String, enum: ['SERVICE', 'TRAINING', 'PRODUCT', 'GIFT_CARD'], required: true, index: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: '', trim: true },
    displayName: { type: String, default: '', trim: true },
    status: { type: String, enum: ['PENDING', 'PUBLISHED', 'REJECTED'], default: 'PENDING', index: true },
    moderationComment: { type: String, default: '' },
    moderatedAt: { type: Date, default: null },
    moderatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    manual: { type: Boolean, default: false },
    sourceLabel: { type: String, default: '', trim: true },
  },
  { timestamps: true }
);

reviewSchema.index({ customerId: 1, productId: 1 }, { unique: true });

export const Review = mongoose.model('Review', reviewSchema);
export default Review;
