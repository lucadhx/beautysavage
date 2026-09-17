// C2 — Présence à une session présentielle. Un participant (issu d'un Purchase sur la session)
// peut être marqué present/absent. Token opaque par participant pour le scan QR institut.
// Aucun certificat ici (préparé C3).
import mongoose from 'mongoose';

export const ATTENDANCE_STATUSES = Object.freeze(['pending', 'present', 'absent']);
export const ATTENDANCE_METHODS = Object.freeze(['qr', 'manual']);

const sessionAttendanceSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FormationSession',
      required: true
    },
    formationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Formation',
      required: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    status: { type: String, enum: ATTENDANCE_STATUSES, default: 'pending' },
    method: { type: String, enum: ATTENDANCE_METHODS, default: null },
    checkedInAt: { type: Date, default: null },
    markedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    // Token opaque propre au participant (présenté côté client, scanné par l'institut).
    attendanceToken: { type: String, default: '' }
  },
  {
    timestamps: true,
    collection: 'session_attendance'
  }
);

sessionAttendanceSchema.index({ sessionId: 1, userId: 1 }, { unique: true });
sessionAttendanceSchema.index(
  { attendanceToken: 1 },
  { unique: true, partialFilterExpression: { attendanceToken: { $type: 'string', $gt: '' } } }
);

const SessionAttendance = mongoose.model('SessionAttendance', sessionAttendanceSchema);
export default SessionAttendance;
