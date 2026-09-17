import mongoose from 'mongoose';

const noShowRecordSchema = new mongoose.Schema({
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServiceBooking',
    required: true
  },
  recordedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  recordedAt: { type: Date, default: Date.now }
}, { collection: 'no_show_records' });

noShowRecordSchema.index({ clientId: 1 });
noShowRecordSchema.index({ bookingId: 1 });

const NoShowRecord = mongoose.model('NoShowRecord', noShowRecordSchema);
export default NoShowRecord;
