import mongoose from 'mongoose';

const decisionSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ['VALIDATED', 'REJECTED'], required: true },
    comment: { type: String, default: '' },
    decidedAt: { type: Date, default: Date.now },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    certificateUrl: { type: String, default: '' },
  },
  { _id: false }
);

const trainingSubmissionSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceProduct', required: true, index: true },
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceSale', required: true, index: true },
    attempt: { type: Number, default: 1, min: 1 },
    status: { type: String, enum: ['PENDING', 'VALIDATED', 'REJECTED'], default: 'PENDING', index: true },
    evaluationVersion: { type: Number, default: 1 },
    answersSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    deliverablesSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    progressSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    scoreSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    decision: { type: decisionSchema, default: null },
  },
  { timestamps: true }
);

trainingSubmissionSchema.index(
  { customerId: 1, productId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'PENDING' } }
);

export const TrainingSubmission = mongoose.model('TrainingSubmission', trainingSubmissionSchema);
export default TrainingSubmission;
