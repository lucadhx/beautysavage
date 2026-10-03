import mongoose from 'mongoose';

const secretRefSchema = new mongoose.Schema(
  {
    encryptedValue: { type: String, default: '' },
    lastFour: { type: String, default: '' },
    verifiedAt: { type: Date, default: null },
  },
  { _id: false }
);

/**
 * LES CLÉS D'UN ENVIRONNEMENT — TEST (clés de test Stripe) ou PROD (clés
 * live). C'est l'environnement du serveur (`ENV`) qui choisit lequel est lu :
 * une base PROD recopiée depuis TEST n'emporte donc jamais de clés de test
 * en production, et inversement.
 */
const modeSlotSchema = new mongoose.Schema(
  {
    publicKey: { type: secretRefSchema, default: () => ({}) },
    secretKey: { type: secretRefSchema, default: () => ({}) },
    webhookSecret: { type: secretRefSchema, default: () => ({}) },
    webhookEndpointId: { type: String, default: '' },
    webhookUrl: { type: String, default: '' },
    webhookLastProvisionedAt: { type: Date, default: null },
    webhookLastError: { type: String, default: '' },
    senderEmail: { type: String, default: '' },
    senderName: { type: String, default: '' },
    verified: { type: Boolean, default: false },
    lastTestAt: { type: Date, default: null },
    lastTestError: { type: String, default: '' },
  },
  { _id: false }
);

const instituteIntegrationSchema = new mongoose.Schema(
  {
    modes: {
      TEST: { type: modeSlotSchema, default: () => ({}) },
      PROD: { type: modeSlotSchema, default: () => ({}) },
    },
    provider: { type: String, enum: ['STRIPE_INSTITUTE', 'BREVO_INSTITUTE'], required: true, unique: true },
    mode: { type: String, enum: ['TEST', 'PROD'], default: 'TEST' },
    publicKey: { type: secretRefSchema, default: () => ({}) },
    secretKey: { type: secretRefSchema, default: () => ({}) },
    webhookSecret: { type: secretRefSchema, default: () => ({}) },
    webhookEndpointId: { type: String, default: '' },
    webhookUrl: { type: String, default: '' },
    webhookLastProvisionedAt: { type: Date, default: null },
    webhookLastError: { type: String, default: '' },
    senderEmail: { type: String, default: '' },
    senderName: { type: String, default: '' },
    verified: { type: Boolean, default: false },
    lastTestAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const InstituteIntegration = mongoose.model('InstituteIntegration', instituteIntegrationSchema);
export default InstituteIntegration;
