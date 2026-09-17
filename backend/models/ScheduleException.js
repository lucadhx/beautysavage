import mongoose from 'mongoose';

const scheduleExceptionSchema = new mongoose.Schema({
  practitionerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PractitionerProfile',
    required: true
  },
  date: { type: Date, required: true },
  type: {
    type: String,
    enum: ['block', 'add', 'modify'],
    required: true
  },
  isFullDay: { type: Boolean, default: false },
  startTime: { type: String, default: null },
  endTime: { type: String, default: null },
  slots: [{ startTime: { type: String }, endTime: { type: String } }],
  reason: { type: String, default: '', trim: true },
  createdAt: { type: Date, default: Date.now }
}, { collection: 'schedule_exceptions' });

scheduleExceptionSchema.index({ practitionerId: 1, date: 1 }, { unique: true });

const ScheduleException = mongoose.model('ScheduleException', scheduleExceptionSchema);
export default ScheduleException;
