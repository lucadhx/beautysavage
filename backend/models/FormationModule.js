import mongoose from 'mongoose';

const formationModuleSchema = new mongoose.Schema(
  {
    formationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Formation',
      required: true
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    descriptionEditorial: { type: String, default: '' },
    videos: {
      // Legacy documents may still store plain URL strings; keep Mixed for backward compatibility.
      type: [mongoose.Schema.Types.Mixed],
      default: []
    },
    files: {
      // Legacy entries may miss fileId/size/order; normalized in controller payload builders.
      type: [mongoose.Schema.Types.Mixed],
      default: []
    },
    order: { type: Number, default: 0 }
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
    collection: 'formationmodules'
  }
);

formationModuleSchema.index({ formationId: 1, order: 1 });

const FormationModule = mongoose.model('FormationModule', formationModuleSchema);
export default FormationModule;
