import mongoose from 'mongoose';

import Purchase from '../models/Purchase.js';
import Sale from '../models/Sale.js';

const { Types } = mongoose;

function normalizeFormationIds(formationIds = []) {
  const seen = new Set();
  const normalized = [];
  formationIds.forEach(entry => {
    const id = String(entry || '').trim();
    if (!Types.ObjectId.isValid(id) || seen.has(id)) return;
    seen.add(id);
    normalized.push(id);
  });
  return normalized;
}

function initUserSets(ids = []) {
  const map = new Map();
  ids.forEach(id => {
    map.set(id, new Set());
  });
  return map;
}

export async function getFormationPurchasedUserCounts(formationIds = []) {
  const normalizedIds = normalizeFormationIds(formationIds);
  if (!normalizedIds.length) {
    return new Map();
  }
  const objectIds = normalizedIds.map(id => new Types.ObjectId(id));
  const usersByFormation = initUserSets(normalizedIds);

  const [purchases, sales] = await Promise.all([
    Purchase.find({
      itemType: 'formation',
      itemId: { $in: objectIds }
    })
      .select({ itemId: 1, userId: 1 })
      .lean(),
    Sale.find({
      items: {
        $elemMatch: {
          type: 'formation',
          itemId: { $in: objectIds }
        }
      }
    })
      .select({ userId: 1, items: 1 })
      .lean()
  ]);

  purchases.forEach(entry => {
    const formationId = String(entry?.itemId || '');
    const userId = String(entry?.userId || '');
    if (!formationId || !userId || !usersByFormation.has(formationId)) return;
    usersByFormation.get(formationId).add(userId);
  });

  sales.forEach(entry => {
    const userId = String(entry?.userId || '');
    if (!userId) return;
    const items = Array.isArray(entry?.items) ? entry.items : [];
    items.forEach(item => {
      if (item?.type !== 'formation') return;
      const formationId = String(item?.itemId || '');
      if (!formationId || !usersByFormation.has(formationId)) return;
      usersByFormation.get(formationId).add(userId);
    });
  });

  const counts = new Map();
  usersByFormation.forEach((userSet, formationId) => {
    const total = userSet.size;
    counts.set(formationId, {
      purchasedUsersCount: total,
      soldCount: total
    });
  });
  return counts;
}

export async function getFormationPurchasedUsersCount(formationId) {
  const normalized = normalizeFormationIds([formationId]);
  if (!normalized.length) {
    return 0;
  }
  const statsMap = await getFormationPurchasedUserCounts(normalized);
  const stats = statsMap.get(normalized[0]);
  return Number(stats?.purchasedUsersCount || 0);
}

export async function hasFormationBeenPurchased(formationId) {
  const normalized = normalizeFormationIds([formationId]);
  if (!normalized.length) {
    return false;
  }
  const targetObjectId = new Types.ObjectId(normalized[0]);
  const purchaseExists = await Purchase.exists({
    itemType: 'formation',
    itemId: targetObjectId
  });
  if (purchaseExists) {
    return true;
  }
  const saleExists = await Sale.exists({
    items: {
      $elemMatch: {
        type: 'formation',
        itemId: targetObjectId
      }
    }
  });
  return Boolean(saleExists);
}

