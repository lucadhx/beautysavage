import mongoose from 'mongoose';

const rangeSchema = new mongoose.Schema(
  {
    start: { type: String, required: true },
    end: { type: String, required: true },
  },
  { _id: false }
);

const weeklyDaySchema = new mongoose.Schema(
  {
    weekday: { type: Number, required: true, min: 1, max: 7 },
    enabled: { type: Boolean, default: true },
    ranges: { type: [rangeSchema], default: [] },
  },
  { _id: false }
);

const exceptionSchema = new mongoose.Schema(
  {
    date: { type: String, required: true },
    closed: { type: Boolean, default: false },
    ranges: { type: [rangeSchema], default: [] },
    reason: { type: String, default: '' },
  },
  { _id: true }
);

const bookingScheduleSchema = new mongoose.Schema(
  {
    singleton: { type: String, default: 'global', unique: true },
    timezone: { type: String, default: 'Europe/Paris' },
    slotStepMinutes: { type: Number, default: 15, min: 5 },
    weeklyHours: { type: [weeklyDaySchema], default: [] },
    exceptions: { type: [exceptionSchema], default: [] },
    reminders: { type: [mongoose.Schema.Types.Mixed], default: [] },
    noShowPolicy: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const BookingSchedule = mongoose.model('BookingSchedule', bookingScheduleSchema);
export default BookingSchedule;
