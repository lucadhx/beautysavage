import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const customerSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    firstName: { type: String, default: '', trim: true },
    lastName: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true },
    billingAddress: {
      line1: { type: String, default: '' },
      line2: { type: String, default: '' },
      postalCode: { type: String, default: '' },
      city: { type: String, default: '' },
      country: { type: String, default: 'FR' },
    },
    marketingConsent: { type: Boolean, default: false },
    emailVerified: { type: Boolean, default: false, index: true },
    emailVerification: {
      tokenHash: { type: String, default: '', select: false },
      expiresAt: { type: Date, default: null },
      requestedAt: { type: Date, default: null },
      verifiedAt: { type: Date, default: null },
    },
    passwordReset: {
      tokenHash: { type: String, default: '', select: false },
      expiresAt: { type: Date, default: null },
      requestedAt: { type: Date, default: null },
      usedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

customerSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, await bcrypt.genSalt(10));
  next();
});

customerSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

customerSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.password;
    return ret;
  },
});

export const Customer = mongoose.model('Customer', customerSchema);
export default Customer;
