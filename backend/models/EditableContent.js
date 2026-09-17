import mongoose from 'mongoose';

const TARGET_VALUES = ['page', 'product', 'formation', 'legal-page'];

const editableContentSchema = new mongoose.Schema(
  {
    targetType: {
      type: String,
      enum: TARGET_VALUES,
      required: true
    },
    targetId: {
      type: String,
      required: true,
      trim: true
    },
    zoneKey: {
      type: String,
      required: true,
      trim: true
    },
    contentHtml: {
      type: String,
      default: ''
    },
    updatedAt: {
      type: Date,
      default: () => new Date()
    }
  },
  { collection: 'editable_contents' }
);

editableContentSchema.index(
  { targetType: 1, targetId: 1, zoneKey: 1 },
  { unique: true, background: false }
);

const EditableContent = mongoose.model('EditableContent', editableContentSchema);
export default EditableContent;
