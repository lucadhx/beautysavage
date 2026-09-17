import mongoose from 'mongoose';

const emailTemplateCategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },
    order: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true,
    collection: 'email_template_categories'
  }
);

emailTemplateCategorySchema.index({ slug: 1 }, { unique: true });

const EmailTemplateCategory = mongoose.model('EmailTemplateCategory', emailTemplateCategorySchema);
export default EmailTemplateCategory;
