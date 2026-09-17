import mongoose from 'mongoose';

import CommissionConfig from '../models/CommissionConfig.js';
import CommissionTransaction from '../models/CommissionTransaction.js';

function roundToCents(value) {
  return Math.round(value * 100) / 100;
}

function resolveObjectId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  if (typeof value === 'object' && value._id && mongoose.Types.ObjectId.isValid(value._id)) {
    return new mongoose.Types.ObjectId(value._id);
  }
  return null;
}

function normalizeCommissionType(type) {
  const candidate = String(type || '').trim().toLowerCase();
  if (candidate === 'percentage' || candidate === 'fixed') {
    return candidate;
  }
  return null;
}

export async function getActiveCommissionConfig() {
  // isActive: { $ne: false } matches both true and docs without the field (migration compat)
  return CommissionConfig.findOne({ isActive: { $ne: false } }).sort({ createdAt: -1 }).lean();
}

export async function createCommissionConfigEntry({ type = 'percentage', value, createdBy } = {}) {
  const normalizedType = normalizeCommissionType(type);
  if (!normalizedType) {
    throw new Error('Type de commission invalide.');
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new Error('Valeur de commission invalide.');
  }
  const creatorObjectId = resolveObjectId(createdBy);
  if (!creatorObjectId) {
    throw new Error('Createur de configuration invalide.');
  }
  // Soft-delete all previously active configs
  await CommissionConfig.updateMany(
    { isActive: { $ne: false } },
    { $set: { isActive: false, deletedAt: new Date() } }
  );
  return CommissionConfig.create({
    type: normalizedType,
    value: numericValue,
    createdBy: creatorObjectId,
    isActive: true
  });
}

export function calculateCommissionAmount({ type, value, price }) {
  const amount = Number.isFinite(Number(price)) ? Number(price) : 0;
  const numericValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  if (type === 'percentage') {
    return roundToCents((amount * numericValue) / 100);
  }
  return roundToCents(numericValue);
}

export async function recordCommissionTransactions({ saleId, formationEntries, config }) {
  if (!saleId || !Array.isArray(formationEntries) || !formationEntries.length) {
    return [];
  }
  const effectiveConfig = config || (await getActiveCommissionConfig());
  const commissionType = effectiveConfig?.type || 'fixed';
  const commissionValue = Number.isFinite(Number(effectiveConfig?.value)) ? Number(effectiveConfig.value) : 0;
  const now = new Date();
  const transactions = formationEntries
    .map(entry => {
      const formationId = resolveObjectId(entry.formationId);
      if (!formationId) return null;
      const formationName = String(entry.formationName || 'Formation').trim() || 'Formation';
      return {
        saleId,
        formationId,
        formationName,
        commissionType,
        commissionValue,
        commissionAmount: calculateCommissionAmount({
          type: commissionType,
          value: commissionValue,
          price: Number.isFinite(Number(entry.price)) ? Number(entry.price) : 0
        }),
        createdAt: entry.createdAt ? new Date(entry.createdAt) : now
      };
    })
    .filter(Boolean);
  if (!transactions.length) {
    return [];
  }
  return CommissionTransaction.insertMany(transactions);
}
