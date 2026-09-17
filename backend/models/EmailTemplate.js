import mongoose from 'mongoose';

const emailTemplateSchema = new mongoose.Schema(
  {
    functionName: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },
    subject: {
      type: String,
      default: ''
    },
    bodyHtml: {
      type: String,
      default: ''
    },
    fullHtml: {
      type: String,
      default: ''
    },
    mode: {
      type: String,
      enum: ['text', 'html'],
      lowercase: true,
      trim: true,
      default: 'text'
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EmailTemplateCategory',
      default: null
    },
    recipient: {
      type: String,
      enum: ['client', 'institute', 'both'],
      default: 'client'
    },
    isMetadataOnly: {
      type: Boolean,
      default: false
    },

    // --- Versioning (Phase 5A) -------------------------------------------------
    // One published version per functionName drives the runtime; drafts/archives
    // are history. Existing docs (created before this phase) have no `status`; the
    // runtime treats a missing status as published (legacy fallback) so the content
    // sent is never changed before migration.
    version: { type: Number, default: 1 },
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'published' },
    publishedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    publishedBy: { type: String, default: '' },
    createdFromVersion: { type: Number, default: null },
    isSystemDefault: { type: Boolean, default: false }
  },
  {
    timestamps: true,
    collection: 'email_templates'
  }
);

// NOTE: the legacy `{ functionName: 1 } unique` index is intentionally removed so a
// functionName can have multiple versions. The single-published invariant is held
// by a PARTIAL unique index below. The legacy index is dropped by the migration
// (scripts/migrateEmailTemplatesToVersioning.js) on existing databases.
emailTemplateSchema.index({ functionName: 1, status: 1 });
emailTemplateSchema.index(
  { functionName: 1 },
  { unique: true, partialFilterExpression: { status: 'published' }, name: 'uniq_published_template' }
);

const EmailTemplate = mongoose.model('EmailTemplate', emailTemplateSchema);
export default EmailTemplate;
