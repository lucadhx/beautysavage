import mongoose from 'mongoose';
import { notifyEntitySaved } from '../utils/syncNotifier.js';
import { NETWORK_DEFAULTS } from '../utils/constants.js';

/**
 * Configuration système (singleton). V1 : uniquement la section `network`.
 * La structure est volontairement imbriquée pour accueillir plus tard d'autres
 * sections (analytics, seo, smtp…) SANS casser l'existant. Aucun secret ici.
 */
const networkSchema = new mongoose.Schema(
  {
    backendUrl: { type: String, default: NETWORK_DEFAULTS.backendUrl },
    managerUrl: { type: String, default: NETWORK_DEFAULTS.managerUrl },
    websiteUrl: { type: String, default: NETWORK_DEFAULTS.websiteUrl },
  },
  { _id: false }
);

const systemConfigurationSchema = new mongoose.Schema(
  {
    network: { type: networkSchema, default: () => ({}) },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);


// Le Panel doit voir ce changement : on l'ANNONCE, sans rien savoir de lui.
// Le hook est posé AVANT `mongoose.model()` — après, il ne serait jamais rejoué.
// Les chemins modifiés sont capturés AVANT le save : Mongoose les efface
// ensuite, et `post` ne verrait plus rien changer.
systemConfigurationSchema.pre('save', function captureChangedPaths() {
  this.$locals.syncChangedPaths = this.isNew ? ['*'] : this.modifiedPaths();
});
systemConfigurationSchema.post('save', function announceSaved() {
  notifyEntitySaved('NETWORK', this.$locals.syncChangedPaths ?? []);
});

export const SystemConfiguration = mongoose.model('SystemConfiguration', systemConfigurationSchema);
export default SystemConfiguration;
