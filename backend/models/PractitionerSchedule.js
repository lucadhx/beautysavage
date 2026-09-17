import mongoose from 'mongoose';

const timeSlotSchema = new mongoose.Schema({
  startTime: { type: String, required: true },
  endTime: { type: String, required: true }
}, { _id: false });

const weekdaySchema = new mongoose.Schema({
  dayOfWeek: { type: Number, min: 0, max: 6, required: true },
  isWorking: { type: Boolean, default: true },
  slots: { type: [timeSlotSchema], default: [] }
}, { _id: false });

const practitionerScheduleSchema = new mongoose.Schema({
  practitionerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PractitionerProfile',
    required: true
  },
  weeklySchedule: { type: [weekdaySchema], default: [] },
  lunchBreak: {
    isActive: { type: Boolean, default: false },
    startTime: { type: String, default: '12:00' },
    endTime: { type: String, default: '13:00' }
  },
  updatedAt: { type: Date, default: Date.now }
}, { collection: 'practitioner_schedules' });

practitionerScheduleSchema.index({ practitionerId: 1 }, { unique: true });

const PractitionerSchedule = mongoose.model('PractitionerSchedule', practitionerScheduleSchema);
export default PractitionerSchedule;
