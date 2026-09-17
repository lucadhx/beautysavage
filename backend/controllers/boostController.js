import mongoose from 'mongoose';

import Product from '../models/Product.js';
import Formation from '../models/Formation.js';
import { getActivePromotion } from '../services/promotionService.js';
import { mapEntity } from './businessController.js';

const VALID_TARGETS = {
  product: Product,
  formation: Formation
};

const MAX_BOOSTS = 3;
const AVAILABLE_BOOST_ORDERS = [1, 2, 3];
function normalizeTargetType(value) {
  if (!value) return null;
  const candidate = String(value || '').trim().toLowerCase();
  return VALID_TARGETS[candidate] ? candidate : null;
}

async function listBoostedEntries() {
  const [products, formations] = await Promise.all([
    Product.find({ isBoosted: true }).select('_id boostOrder').lean(),
    Formation.find({ isBoosted: true }).select('_id boostOrder').lean()
  ]);
  const entries = [];
  products.forEach(doc => {
    if (!doc?._id) return;
    entries.push({
      type: 'product',
      id: doc._id.toString(),
      boostOrder: Number.isFinite(Number(doc.boostOrder)) ? Number(doc.boostOrder) : null
    });
  });
  formations.forEach(doc => {
    if (!doc?._id) return;
    entries.push({
      type: 'formation',
      id: doc._id.toString(),
      boostOrder: Number.isFinite(Number(doc.boostOrder)) ? Number(doc.boostOrder) : null
    });
  });
  return entries;
}

async function loadExistingBoosts(excludeId = null) {
  const entries = await listBoostedEntries();
  if (!excludeId) return entries;
  return entries.filter(entry => entry.id !== excludeId);
}

function buildModelForTarget(targetType) {
  return VALID_TARGETS[targetType] || null;
}

async function hydrateBoostEntry(entry) {
  if (!entry?.type || !entry?.id) return null;
  const Model = buildModelForTarget(entry.type);
  if (!Model) return null;
  const doc = await Model.findById(entry.id).lean();
  if (!doc) return null;
  const promotion = await getActivePromotion(entry.type, entry.id);
  const entity = mapEntity(doc, promotion);
  return {
    ...entity,
    type: entry.type,
    boostOrder: entry.boostOrder
  };
}

export async function listBoosts(_req, res) {
  try {
    const entries = await listBoostedEntries();
    const boosts = (
      await Promise.all(entries.map(entry => hydrateBoostEntry(entry)))
    )
      .filter(Boolean)
      .sort((a, b) => {
        const orderA = Number.isFinite(Number(a.boostOrder)) ? Number(a.boostOrder) : Number.MAX_SAFE_INTEGER;
        const orderB = Number.isFinite(Number(b.boostOrder)) ? Number(b.boostOrder) : Number.MAX_SAFE_INTEGER;
        return orderA - orderB;
      });
    return res.json({ ok: true, boosts });
  } catch (error) {
    console.error('Impossible de lister les boosts', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire les boosts.' });
  }
}

export async function setBoost(req, res) {
  const targetType = normalizeTargetType(req.body?.targetType);
  const targetId = String(req.body?.targetId || '').trim();
  const enableBoost = req.body?.isBoosted === true;
  if (!targetType || !mongoose.Types.ObjectId.isValid(targetId)) {
    return res.status(400).json({ ok: false, error: 'Type ou identifiant invalide.' });
  }
  const Model = buildModelForTarget(targetType);
  if (!Model) {
    return res.status(400).json({ ok: false, error: 'Cible de boost inconnue.' });
  }
  try {
    const target = await Model.findById(targetId);
    if (!target) {
      return res.status(404).json({ ok: false, error: 'Élément introuvable.' });
    }
    const otherBoosts = await loadExistingBoosts(targetId);
    const wasBoosted = Boolean(target.isBoosted);
    if (enableBoost) {
      if (!wasBoosted && otherBoosts.length >= MAX_BOOSTS) {
        return res.status(400).json({ ok: false, error: 'Limite de 3 boosts atteinte.' });
      }
      if (!wasBoosted) {
        const usedOrders = otherBoosts
          .map(entry =>
            Number.isFinite(Number(entry.boostOrder)) ? Number(entry.boostOrder) : null
          )
          .filter(order => Number.isFinite(order));
        const assignedOrder =
          AVAILABLE_BOOST_ORDERS.find(order => !usedOrders.includes(order)) ||
          AVAILABLE_BOOST_ORDERS[0];
        target.boostOrder = assignedOrder;
      }
      target.isBoosted = true;
    } else {
      target.isBoosted = false;
      target.boostOrder = null;
    }
    await target.save();
    const promotion = await getActivePromotion(targetType, target._id);
    return res.json({ ok: true, entity: mapEntity(target.toObject(), promotion) });
  } catch (error) {
    console.error('Erreur boost article', error);
    return res.status(500).json({ ok: false, error: 'Impossible de mettre à jour le boost.' });
  }
}
