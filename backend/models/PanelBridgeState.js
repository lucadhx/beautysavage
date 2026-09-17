import mongoose from 'mongoose';

// Une seule liaison panel par instance BeautySavage. Le jeton est chiffré avec
// le coffre local ; il n'est jamais renvoyé par une route HTTP.
const panelBridgeStateSchema = new mongoose.Schema(
  {
    singleton: { type: String, unique: true, default: 'beautysavage' },
    projectId: { type: String, default: null },
    projectKey: { type: String, required: true, default: 'beautysavage' },
    panelBaseUrl: { type: String, default: null },
    bridgeTokenEncrypted: { type: String, default: null, select: false },
    pairedAt: { type: Date, default: null },
    lastHeartbeatAt: { type: Date, default: null },
    lastPanelSyncAt: { type: Date, default: null },
    syncCursor: { type: String, default: null },
    status: { type: String, enum: ['UNPAIRED', 'PAIRED', 'REVOKED'], default: 'UNPAIRED' }
  },
  { timestamps: true }
);

export default mongoose.models.PanelBridgeState ||
  mongoose.model('PanelBridgeState', panelBridgeStateSchema);
