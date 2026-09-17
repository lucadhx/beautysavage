import mongoose from 'mongoose';

const reminderSchema = new mongoose.Schema({
  hoursBeforeAppointment: { type: Number, required: true },
  isActive: { type: Boolean, default: true }
}, { _id: false });

const serviceSettingsSchema = new mongoose.Schema({
  allowClientChoosePractitioner: { type: Boolean, default: false },
  noShowSystemEnabled: { type: Boolean, default: true },
  noShowSuspensionThreshold: { type: Number, default: 3 },
  reminders: { type: [reminderSchema], default: [] },
  updatedAt: { type: Date, default: Date.now }
}, { collection: 'service_settings' });

const ServiceSettings = mongoose.model('ServiceSettings', serviceSettingsSchema);
export default ServiceSettings;
