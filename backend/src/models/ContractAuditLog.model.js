import mongoose from 'mongoose';
import { AUDIT_ACTOR_TYPE_VALUES } from '../utils/contractConstants.js';

/**
 * Journal d'audit métier du contrat. Trace qui a fait quoi, quand. Ne stocke
 * JAMAIS de secret API, token, donnée bancaire, corps de webhook complet ni PDF :
 * seulement des métadonnées sûres (`metadataSafe`).
 */
const contractAuditLogSchema = new mongoose.Schema(
  {
    contractId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', index: true, default: null },
    action: { type: String, required: true },
    actorType: { type: String, enum: AUDIT_ACTOR_TYPE_VALUES, required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    provider: { type: String, default: null },
    metadataSafe: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const ContractAuditLog = mongoose.model('ContractAuditLog', contractAuditLogSchema);
export default ContractAuditLog;

/** Helper d'écriture d'une entrée d'audit (best-effort, ne jette pas). */
export async function logContractAudit({ contractId, action, actorType, actorId, provider, metadataSafe }) {
  try {
    await ContractAuditLog.create({ contractId, action, actorType, actorId, provider, metadataSafe });
  } catch {
    /* l'audit ne doit jamais casser le flux métier */
  }
}
