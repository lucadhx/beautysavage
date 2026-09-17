import mongoose from 'mongoose';

const siteUIConfigSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      default: 'global',
      unique: true,
      immutable: true
    },
    patienceTitle: {
      type: String,
      trim: true,
      default: 'Patience, l’expérience arrive…'
    },
    patienceDescription: {
      type: String,
      trim: true,
      default: 'Nous préparons actuellement une expérience premium pour vous.'
    },
    showTimer: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true,
    collection: 'siteuiconfig'
  }
);

const SiteUIConfig = mongoose.model('SiteUIConfig', siteUIConfigSchema);
export default SiteUIConfig;
