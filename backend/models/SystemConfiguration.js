import mongoose from 'mongoose';

// S1 — SystemConfiguration : SOURCE OFFICIELLE UNIQUE de la configuration métier globale.
// Document SINGLETON (un seul document en base, collection 'systemconfiguration').
// Évolutif : sections prévues dès maintenant même si certaines restent vides au départ.
//
// Ce modèle NE contient JAMAIS de secret / credential / flag runtime (ceux-ci restent
// dans le .env). Il ne porte que de la configuration métier exposable.

const addressSchema = new mongoose.Schema(
  {
    line1: { type: String, default: '', trim: true },
    line2: { type: String, default: '', trim: true },
    city: { type: String, default: '', trim: true },
    postalCode: { type: String, default: '', trim: true },
    country: { type: String, default: 'FR', trim: true }
  },
  { _id: false }
);

// 🌐 Domaines — Panel URL + Vitrine URL (validés en amont par le service).
const domainsSchema = new mongoose.Schema(
  {
    panelUrl: { type: String, default: '', trim: true },
    vitrineUrl: { type: String, default: '', trim: true }
  },
  { _id: false }
);

// 🏢 Informations de l'institut (identité globale).
const instituteSchema = new mongoose.Schema(
  {
    // Défaut vide volontaire : laisse chaque générateur (factures, cartes cadeaux…)
    // appliquer son propre libellé par défaut tant que l'institut n'est pas configuré.
    name: { type: String, default: '', trim: true },
    email: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true },
    address: { type: addressSchema, default: () => ({}) },
    siret: { type: String, default: '', trim: true }
  },
  { _id: false }
);

// 🌍 Localisation (fuseau horaire d'affichage, langue, devise).
// NB : TZ runtime reste piloté par process.env.TZ (boot) ; ce champ est l'affichage métier.
const localizationSchema = new mongoose.Schema(
  {
    timezone: { type: String, default: 'Europe/Paris', trim: true },
    language: { type: String, default: 'fr', trim: true },
    currency: { type: String, default: 'EUR', trim: true }
  },
  { _id: false }
);

// 💰 Fiscalité (TVA par défaut + mention légale).
const taxSchema = new mongoose.Schema(
  {
    // Taux de TVA par défaut en pourcentage (0 = franchise / non applicable).
    defaultVatRate: { type: Number, default: 0, min: 0, max: 100 },
    vatMention: {
      type: String,
      default: 'TVA non applicable, article 293B du CGI',
      trim: true
    }
  },
  { _id: false }
);

// 🔧 Configuration système (paramètres techniques exposables — PAS de secret).
const systemSchema = new mongoose.Schema(
  {
    // Nom de la plateforme éditrice (distinct de l'institut) — affiché sur les factures de commission.
    platformName: { type: String, default: '', trim: true }
  },
  { _id: false }
);

// ⚠️ Maintenance (mode + message). Évolutif (le mode maintenance applicatif reste géré
// par siteStatusService ; cette section centralise l'intention de config).
const maintenanceSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    message: { type: String, default: '', trim: true }
  },
  { _id: false }
);

const systemConfigurationSchema = new mongoose.Schema(
  {
    // Verrou singleton : toujours 'global', index unique → un seul document possible.
    key: { type: String, default: 'global', unique: true, immutable: true },

    domains: { type: domainsSchema, default: () => ({}) },
    institute: { type: instituteSchema, default: () => ({}) },
    localization: { type: localizationSchema, default: () => ({}) },
    tax: { type: taxSchema, default: () => ({}) },
    system: { type: systemSchema, default: () => ({}) },
    maintenance: { type: maintenanceSchema, default: () => ({}) },

    updatedAt: { type: Date, default: Date.now },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { collection: 'systemconfiguration' }
);

const SystemConfiguration = mongoose.model('SystemConfiguration', systemConfigurationSchema);
export default SystemConfiguration;
