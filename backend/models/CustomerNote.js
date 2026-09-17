import mongoose from 'mongoose';

/**
 * M13 — Note interne libre attachée à un client (Customer 360, action "Ajouter une note").
 * Additive, sans impact sur les autres domaines. Visible admin/dev uniquement.
 */
const customerNoteSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    authorRole: { type: String, enum: ['admin', 'dev'], default: 'admin' },
    authorLabel: { type: String, trim: true, default: '' },
    body: { type: String, trim: true, required: true }
  },
  { timestamps: true, collection: 'customer_notes' }
);

customerNoteSchema.index({ customerId: 1, createdAt: -1 });

const CustomerNote = mongoose.model('CustomerNote', customerNoteSchema);
export default CustomerNote;
