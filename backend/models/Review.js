import mongoose from 'mongoose';
import { REVIEW_SOURCE_TYPES, REVIEW_TARGET_TYPES } from '../services/reviews/reviewTargeting.js';

// C3 — Modération. Défaut 'published' (rétro-compat : avis existants sans champ = visibles via la
// requête vitrine tolérante). Un admin peut masquer (rejected) ou repasser en attente.
export const REVIEW_STATUSES = Object.freeze(['pending', 'published', 'rejected']);

const reviewSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    formationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Formation',
      default: null
    },
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      default: null
    },
    targetType: {
      type: String,
      enum: REVIEW_TARGET_TYPES,
      default: 'formation'
    },
    sourceType: {
      type: String,
      enum: REVIEW_SOURCE_TYPES,
      default: 'client'
    },
    displayName: {
      type: String,
      trim: true,
      default: ''
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    comment: {
      type: String,
      trim: true,
      default: ''
    },
    status: {
      type: String,
      enum: REVIEW_STATUSES,
      default: 'published'
    },
    moderatedAt: { type: Date, default: null },
    moderatedByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdAt: {
      type: Date,
      default: () => new Date()
    }
  },
  { collection: 'reviews' }
);

reviewSchema.pre('validate', function validateReview(next) {
  const targetType = String(this.targetType || '').trim().toLowerCase() || 'formation';
  this.targetType = targetType === 'service' ? 'service' : 'formation';

  const sourceType = String(this.sourceType || '').trim().toLowerCase() || 'client';
  this.sourceType = sourceType === 'manual_institute' ? 'manual_institute' : 'client';

  if (this.targetType === 'service') {
    if (!this.serviceId) {
      this.invalidate('serviceId', 'La prestation est obligatoire.');
    }
    this.formationId = null;
  } else {
    if (!this.formationId) {
      this.invalidate('formationId', 'La formation est obligatoire.');
    }
    this.serviceId = null;
  }

  if (this.sourceType === 'client') {
    if (!this.userId) {
      this.invalidate('userId', "L'auteur client est obligatoire.");
    }
  } else {
    this.userId = this.userId || null;
  }

  next();
});

reviewSchema.index(
  { userId: 1, formationId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      userId: { $type: 'objectId' },
      formationId: { $type: 'objectId' }
    }
  }
);
reviewSchema.index(
  { userId: 1, serviceId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      userId: { $type: 'objectId' },
      serviceId: { $type: 'objectId' }
    }
  }
);
reviewSchema.index({ targetType: 1, formationId: 1, createdAt: -1 });
reviewSchema.index({ targetType: 1, serviceId: 1, createdAt: -1 });

const Review = mongoose.model('Review', reviewSchema);
export default Review;
