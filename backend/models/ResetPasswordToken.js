import mongoose from 'mongoose';

const resetPasswordTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    used: {
      type: Boolean,
      default: false
    },
    usedAt: {
      type: Date,
      default: null
    },
    createdAt: {
      type: Date,
      default: () => new Date()
    }
  },
  { collection: 'reset_password_tokens' }
);

resetPasswordTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const ResetPasswordToken = mongoose.model('ResetPasswordToken', resetPasswordTokenSchema);
export default ResetPasswordToken;
