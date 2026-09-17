
import CommissionConfig from '../models/CommissionConfig.js';
import CommissionTransaction from '../models/CommissionTransaction.js';
import Contract from '../models/Contract.js';
import { buildSegments, locateSegment, startOfDay } from '../utils/statistics.js';
import { createCommissionConfigEntry } from '../services/commissionService.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_CUSTOM_DAYS = 62;

function roundToCents(value) {
  return Math.round(value * 100) / 100;
}

function parseDateParam(value) {
  if (!value) return null;
  const candidate = new Date(value);
  if (Number.isNaN(candidate.getTime())) return null;
  return candidate;
}

function buildDateFilter(start, end) {
  const dateFilter = {};
  if (start) {
    dateFilter.$gte = start;
  }
  if (end) {
    dateFilter.$lt = end;
  }
  return Object.keys(dateFilter).length ? { createdAt: dateFilter } : {};
}

function createCommissionSegments(baseSegments) {
  return baseSegments.map(segment => ({
    label: segment.label,
    start: segment.start,
    end: segment.end,
    count: 0,
    totalCommission: 0
  }));
}

function buildCustomSegments(start, end) {
  const segments = [];
  let current = new Date(start);
  while (current < end) {
    const next = new Date(current);
    next.setDate(next.getDate() + 1);
    segments.push({
      label: current.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' }),
      start: new Date(current),
      end: next,
      count: 0,
      totalCommission: 0
    });
    current = next;
  }
  return segments;
}

function aggregateCommissionData(transactions, segments) {
  let totalCommission = 0;
  let totalTransactions = 0;
  for (const transaction of transactions) {
    const amount = Number.isFinite(Number(transaction.commissionAmount)) ? Number(transaction.commissionAmount) : 0;
    totalCommission += amount;
    totalTransactions += 1;
    const timestamp = new Date(transaction.createdAt || Date.now()).getTime();
    const segment = locateSegment(segments, timestamp);
    if (segment) {
      segment.count += 1;
      segment.totalCommission += amount;
    }
  }
  return {
    totalCommission: roundToCents(totalCommission),
    totalTransactions
  };
}

function computeConfigStats(transactions) {
  const gross = roundToCents(
    transactions
      .filter(t => t.sourceType === 'sale' || (!t.sourceType && (t.commissionAmount || 0) > 0))
      .reduce((s, t) => s + Math.max(0, Number(t.commissionAmount) || 0), 0)
  );
  const deductions = roundToCents(
    transactions
      .filter(t => ['refund_adjustment', 'refund_reversal'].includes(t.sourceType))
      .reduce((s, t) => s + Math.abs(Number(t.commissionAmount) || 0), 0)
  );
  return { gross, deductions, net: roundToCents(Math.max(0, gross - deductions)) };
}

export async function getCommissionStats(req, res) {
  try {
    const period = String(req.query.period || 'day').toLowerCase();
    let segments = [];
    let startFilter = null;
    let endFilter = null;
    if (period === 'custom') {
      const rawStart = parseDateParam(req.query.start);
      const rawEnd = parseDateParam(req.query.end);
      if (!rawStart || !rawEnd) {
        return res.status(400).json({ ok: false, error: 'Start et end sont requis pour une période personnalisée.' });
      }
      const startDay = startOfDay(rawStart);
      const endDay = startOfDay(rawEnd);
      const endExclusive = new Date(endDay);
      endExclusive.setDate(endExclusive.getDate() + 1);
      const dayCount = Math.ceil((endExclusive.getTime() - startDay.getTime()) / MS_PER_DAY);
      if (dayCount <= 0) {
        return res.status(400).json({ ok: false, error: 'Plage personnalisée invalide.' });
      }
      if (dayCount > MAX_CUSTOM_DAYS) {
        return res.status(400).json({
          ok: false,
          error: `La période personnalisée ne peut pas dépasser ${MAX_CUSTOM_DAYS} jours.`
        });
      }
      segments = buildCustomSegments(startDay, endExclusive);
      startFilter = startDay;
      endFilter = endExclusive;
    } else {
      if (!['day', 'week', 'month', 'year'].includes(period)) {
        return res.status(400).json({ ok: false, error: 'Période invalide.' });
      }
      const base = buildSegments(period);
      segments = createCommissionSegments(base);
      startFilter = segments[0]?.start;
      endFilter = segments[segments.length - 1]?.end;
    }
    const filter = buildDateFilter(startFilter, endFilter);
    const transactions = await CommissionTransaction.find(filter).lean();
    const { totalCommission, totalTransactions } = aggregateCommissionData(transactions, segments);
    return res.json({
      ok: true,
      period,
      totalTransactions,
      totalCommission,
      series: segments.map(segment => ({
        label: segment.label,
        count: segment.count,
        totalCommission: roundToCents(segment.totalCommission)
      }))
    });
  } catch (error) {
    console.error('Erreur stats commissions', error);
    return res.status(500).json({ ok: false, error: 'Impossible de calculer les statistiques.' });
  }
}

export async function listCommissionTransactions(req, res) {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
    const startParam = parseDateParam(req.query.start);
    const endParam = parseDateParam(req.query.end);
    const period = String(req.query.period || '').toLowerCase();
    let filter = buildDateFilter(startParam, endParam);
    if (!filter.createdAt && ['day', 'week', 'month', 'year'].includes(period)) {
      const base = buildSegments(period);
      const startFilter = base[0]?.start;
      const endFilter = base[base.length - 1]?.end;
      filter = buildDateFilter(startFilter, endFilter);
    }
    const transactions = await CommissionTransaction.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    const totalCommission = roundToCents(
      transactions.reduce((sum, entry) => {
        const amount = Number.isFinite(Number(entry.commissionAmount ?? 0))
          ? Number(entry.commissionAmount)
          : 0;
        return sum + amount;
      }, 0)
    );
    return res.json({ ok: true, transactions, totalCommission });
  } catch (error) {
    console.error('Erreur liste commissions', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire les transactions.' });
  }
}

export async function createCommissionConfig(req, res) {
  try {
    const type = String(req.body?.type || '').toLowerCase();
    const value = Number(req.body?.value);
    if (!['percentage', 'fixed'].includes(type)) {
      return res.status(400).json({ ok: false, error: 'Type invalide.' });
    }
    if (!Number.isFinite(value) || value < 0) {
      return res.status(400).json({ ok: false, error: 'Valeur invalide.' });
    }
    const creatorId = req.sessionUser?._id;
    if (!creatorId) {
      return res.status(401).json({ ok: false, error: 'Authentification requise.' });
    }
    const config = await createCommissionConfigEntry({
      type,
      value,
      createdBy: creatorId
    });
    return res.status(201).json({ ok: true, config });
  } catch (error) {
    console.error('Erreur création configuration commission', error);
    return res.status(500).json({ ok: false, error: 'Impossible de créer la configuration.' });
  }
}

// ---------------------------------------------------------------------------
// GET /commissions/config/stats — config active + revenus cumulés
// ---------------------------------------------------------------------------
export async function getCommissionConfigStats(_req, res) {
  try {
    const activeContract = await Contract.findOne({ status: 'active' }).lean();
    const hasActiveContract = Boolean(activeContract);

    const config = await CommissionConfig.findOne({ isActive: { $ne: false } })
      .sort({ createdAt: -1 })
      .lean();

    if (!config) {
      return res.json({ ok: true, config: null, stats: null, hasActiveContract });
    }

    const transactions = await CommissionTransaction.find({
      createdAt: { $gte: config.createdAt }
    }).lean();

    return res.json({
      ok: true,
      config,
      stats: computeConfigStats(transactions),
      hasActiveContract
    });
  } catch (error) {
    console.error('Erreur stats config commission', error);
    return res.status(500).json({ ok: false, error: 'Impossible de calculer les statistiques.' });
  }
}

// ---------------------------------------------------------------------------
// DELETE /commissions/config/active — soft delete (isActive: false)
// Bloqué si contrat actif
// ---------------------------------------------------------------------------
export async function deleteActiveCommissionConfig(_req, res) {
  try {
    const activeContract = await Contract.findOne({ status: 'active' }).lean();
    if (activeContract) {
      return res.status(409).json({
        ok: false,
        blocked: true,
        reason: 'active_contract',
        error: 'Configuration liée à un contrat actif — résiliez d\'abord le contrat.'
      });
    }

    const config = await CommissionConfig.findOne({ isActive: { $ne: false } }).sort({ createdAt: -1 });
    if (!config) {
      return res.status(404).json({ ok: false, error: 'Aucune configuration active.' });
    }

    config.isActive = false;
    config.deletedAt = new Date();
    await config.save();

    return res.json({ ok: true });
  } catch (error) {
    console.error('Erreur suppression config commission', error);
    return res.status(500).json({ ok: false, error: 'Impossible de supprimer la configuration.' });
  }
}

// ---------------------------------------------------------------------------
// GET /commissions/config/history — configs supprimées avec stats par période
// ---------------------------------------------------------------------------
export async function getCommissionConfigHistory(_req, res) {
  try {
    const configs = await CommissionConfig.find({ isActive: false })
      .sort({ deletedAt: -1 })
      .limit(100)
      .lean();

    if (!configs.length) {
      return res.json({ ok: true, configs: [] });
    }

    const configsWithStats = await Promise.all(
      configs.map(async (config) => {
        const start = config.createdAt;
        const end = config.deletedAt || new Date();
        const transactions = await CommissionTransaction.find({
          createdAt: { $gte: start, $lt: end }
        }).lean();
        return { ...config, stats: computeConfigStats(transactions) };
      })
    );

    return res.json({ ok: true, configs: configsWithStats });
  } catch (error) {
    console.error('Erreur lecture historique commissions', error);
    return res.status(500).json({ ok: false, error: "Impossible de lire l'historique." });
  }
}
