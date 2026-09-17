import mongoose from 'mongoose';
import { Schema } from 'mongoose';

const accessSchema = new Schema({
  public: { type: Boolean, default: true },
  requiresAuth: { type: Boolean, default: false },
  requiresPurchase: { type: Boolean, default: false }
}, { _id: false });

const menuItemSchema = new mongoose.Schema({
  label: { type: String, required: true },
  slug: { type: String, required: true, lowercase: true, trim: true },
  order: { type: Number, default: 0 },
  access: { type: accessSchema, default: () => ({}) }
}, { timestamps: true, collection: 'vitrineMenuItems' });

menuItemSchema.index({ slug: 1 }, { unique: true });

export default mongoose.model('VitrineMenuItem', menuItemSchema);
