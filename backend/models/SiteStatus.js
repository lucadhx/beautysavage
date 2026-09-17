import mongoose from 'mongoose';

const siteStatusHistoryEntrySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['active', 'suspended', 'maintenance'],
      required: true
    },
    reason: {
      type: String,
      default: ''
    },
    eta: {
      type: String,
      default: ''
    },
    date: {
      type: Date,
      default: () => new Date()
    },
    startedAt: {
      type: Date,
      default: null
    },
    endedAt: {
      type: Date,
      default: null
    },
    byUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  { _id: false }
);

const siteStatusSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      default: 'global',
      trim: true
    },
    currentStatus: {
      type: String,
      enum: ['active', 'suspended', 'maintenance'],
      default: 'active'
    },
    updatedAt: {
      type: Date,
      default: () => new Date()
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    reason: {
      type: String,
      default: ''
    },
    eta: {
      type: String,
      default: ''
    },
    maintenanceStartedAt: {
      type: Date,
      default: null
    },
    maintenanceEndedAt: {
      type: Date,
      default: null
    },
    history: {
      type: [siteStatusHistoryEntrySchema],
      default: []
    }
  },
  {
    collection: 'site_status'
  }
);

siteStatusSchema.index({ key: 1 }, { unique: true });

const SiteStatus = mongoose.model('SiteStatus', siteStatusSchema);

export default SiteStatus;
