// services/checkout/unified/unifiedCheckoutRepository.js
// Sprint U1 — Persistance du moteur UnifiedCheckout. Idempotence par `idempotencyKey`
// (un même key → le même checkout). Génération d'un `checkoutId` opaque.

import crypto from 'node:crypto';
import UnifiedCheckout from '../../../models/UnifiedCheckout.js';

export function buildCheckoutId() {
  const suffix = crypto.randomUUID().split('-')[0];
  return `UC-${Date.now()}-${suffix}`;
}

export async function findByCheckoutId(checkoutId) {
  const id = String(checkoutId || '').trim();
  if (!id) return null;
  return UnifiedCheckout.findOne({ checkoutId: id });
}

export async function findByIdempotencyKey(idempotencyKey) {
  const key = String(idempotencyKey || '').trim();
  if (!key) return null;
  return UnifiedCheckout.findOne({ idempotencyKey: key });
}

export async function createCheckout(data) {
  const doc = new UnifiedCheckout({
    checkoutId: data.checkoutId || buildCheckoutId(),
    ...data
  });
  return doc.save();
}

export async function updateCheckout(checkoutId, patch = {}) {
  const id = String(checkoutId || '').trim();
  if (!id) return null;
  return UnifiedCheckout.findOneAndUpdate({ checkoutId: id }, { $set: patch }, { new: true });
}

/**
 * Idempotence : renvoie le checkout existant pour `idempotencyKey`, sinon en crée un via `build()`.
 * Gère la course (E11000 sur l'index unique idempotencyKey) en relisant l'existant.
 */
export async function findOrCreateByIdempotencyKey(idempotencyKey, build) {
  const key = String(idempotencyKey || '').trim();
  if (!key) {
    const data = await build();
    return { checkout: await createCheckout(data), created: true };
  }
  const existing = await findByIdempotencyKey(key);
  if (existing) return { checkout: existing, created: false };
  try {
    const data = await build();
    const checkout = await createCheckout({ ...data, idempotencyKey: key });
    return { checkout, created: true };
  } catch (error) {
    if (Number(error?.code) === 11000) {
      const raced = await findByIdempotencyKey(key);
      if (raced) return { checkout: raced, created: false };
    }
    throw error;
  }
}

export async function listRecentCheckouts(limit = 50) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return UnifiedCheckout.find({}).sort({ createdAt: -1 }).limit(safeLimit).lean();
}
