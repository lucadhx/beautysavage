import mongoose from 'mongoose';

const deletedFormationClientSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      trim: true,
      default: ''
    },
    email: {
      type: String,
      trim: true,
      default: ''
    },
    firstName: {
      type: String,
      trim: true,
      default: ''
    },
    lastName: {
      type: String,
      trim: true,
      default: ''
    },
    saleIds: {
      type: [String],
      default: []
    },
    purchaseIds: {
      type: [String],
      default: []
    },
    totalPaid: {
      type: Number,
      default: 0
    },
    subscribedAt: {
      type: Date,
      default: null
    },
    lastSubscribedAt: {
      type: Date,
      default: null
    }
  },
  { _id: false }
);

const deletedFormationHistorySchema = new mongoose.Schema(
  {
    formationId: {
      type: String,
      required: true,
      trim: true
    },
    formationTitle: {
      type: String,
      required: true,
      trim: true
    },
    formationType: {
      type: String,
      trim: true,
      default: ''
    },
    formationPrice: {
      type: Number,
      default: 0
    },
    clientsCount: {
      type: Number,
      default: 0
    },
    clients: {
      type: [deletedFormationClientSchema],
      default: []
    },
    deletedBy: {
      userId: {
        type: String,
        trim: true,
        default: ''
      },
      email: {
        type: String,
        trim: true,
        default: ''
      },
      firstName: {
        type: String,
        trim: true,
        default: ''
      },
      lastName: {
        type: String,
        trim: true,
        default: ''
      },
      role: {
        type: String,
        trim: true,
        default: ''
      }
    },
    deletedAt: {
      type: Date,
      default: () => new Date()
    },
    createdAt: {
      type: Date,
      default: () => new Date()
    }
  },
  { collection: 'deleted_formation_history' }
);

deletedFormationHistorySchema.index({ deletedAt: -1 });
deletedFormationHistorySchema.index({ formationId: 1, deletedAt: -1 });

const DeletedFormationHistory = mongoose.model(
  'DeletedFormationHistory',
  deletedFormationHistorySchema
);

export default DeletedFormationHistory;
