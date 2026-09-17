import mongoose from 'mongoose';

const LOGO_TYPES = ['url', 'upload', null];

const siteIdentitySchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      default: 'global',
      unique: true,
      immutable: true
    },
    siteName: {
      type: String,
      required: true,
      trim: true,
      default: 'Beauty Savage'
    },
    logoType: {
      type: String,
      enum: LOGO_TYPES,
      default: null
    },
    logoUrl: {
      type: String,
      trim: true,
      default: null
    },
    logoPath: {
      type: String,
      trim: true,
      default: null
    }
  },
  {
    timestamps: true,
    collection: 'siteidentity'
  }
);

const SiteIdentity = mongoose.model('SiteIdentity', siteIdentitySchema);
export default SiteIdentity;
