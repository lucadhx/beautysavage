import mongoose from 'mongoose';

const ASSET_TYPES = ['upload', 'url', null];

const managedAssetSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ASSET_TYPES,
      default: null
    },
    url: {
      type: String,
      trim: true,
      default: null
    },
    filePath: {
      type: String,
      trim: true,
      default: null
    },
    updatedAt: {
      type: Date,
      default: null
    }
  },
  { _id: false }
);

const aboutSchema = new mongoose.Schema(
  {
    photo: {
      type: managedAssetSchema,
      default: () => ({})
    },
    editorialHtml: {
      type: String,
      default: ''
    }
  },
  { _id: false }
);

const homePageSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      default: 'global',
      unique: true,
      immutable: true
    },
    banner: {
      type: managedAssetSchema,
      default: () => ({})
    },
    slogan: {
      type: String,
      trim: true,
      default: ''
    },
    hookEditorialHtml: {
      type: String,
      default: ''
    },
    about: {
      type: aboutSchema,
      default: () => ({})
    },
    // FAQ générale affichée sur la page d'accueil (gérée depuis le manager).
    faq: {
      type: [new mongoose.Schema({
        question: { type: String, default: '', trim: true },
        answer: { type: String, default: '', trim: true }
      }, { _id: false })],
      default: []
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  {
    timestamps: true,
    collection: 'homepagesettings'
  }
);

const HomePageSettings = mongoose.model('HomePageSettings', homePageSettingsSchema);
export default HomePageSettings;
