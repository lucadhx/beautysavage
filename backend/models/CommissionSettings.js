import mongoose from 'mongoose';

const commissionReminderSchema = new mongoose.Schema(
  { daysBeforeDue: { type: Number, required: true, min: 1 } },
  { _id: false }
);

// Document singleton — un seul document en base
const commissionSettingsSchema = new mongoose.Schema(
  {
    latePaymentDays: { type: Number, default: 15, min: 2 },
    // Rappels automatiques : liste de { daysBeforeDue } (1 ≤ daysBeforeDue < latePaymentDays)
    reminders: { type: [commissionReminderSchema], default: [] },
    // Date simulée pour les tests (dev uniquement) — null = date réelle
    simulatedDate: { type: Date, default: null },
    // RX2.5 — termes de paiement de la commission plateforme (dev-only, défauts sûrs).
    //  gracePeriodDays : jours de tolérance après l'échéance avant le statut « overdue ».
    //  blockingMode    : V1 = 'none'/'warning_only' (statut + alertes only, AUCUN blocage auto agressif).
    //  suspensionWarningAfterDays : nb de jours d'overdue avant un statut « suspension_risk » (affichage).
    gracePeriodDays: { type: Number, default: 0, min: 0 },
    blockingMode: {
      type: String,
      enum: ['none', 'warning_only', 'block_purchases', 'block_manager'],
      default: 'none'
    },
    suspensionWarningAfterDays: { type: Number, default: 0, min: 0 },
    updatedAt: { type: Date, default: Date.now }
  },
  { collection: 'commissionsettings' }
);

const CommissionSettings = mongoose.model('CommissionSettings', commissionSettingsSchema);
export default CommissionSettings;
