// RX2.1/RX2.2 — Espace Finance (React, admin/dev). Le backend agrège et fait autorité.
import { buildFinanceDashboard } from '../services/financeService.js';
import { buildFinanceTimeline, resolveTimelineWindow } from '../services/finance/financeTimelineService.js';
import { buildFinanceMovementDetail } from '../services/finance/financeMovementDetailService.js';
import {
  getCurrentCommissionOverview,
  getCommissionPaymentDetail,
  getCommissionPaymentHistory,
} from '../services/finance/commissionFinanceService.js';
import { listGiftCardFinanceCards, getGiftCardFinanceDetail } from '../services/finance/giftCardFinanceService.js';
import { getNow } from '../utils/simulatedDate.js';

const VALID_RANGES = new Set(['today', '7d', '30d']);
const VALID_PERIODS = new Set(['today', 'week', 'month', 'all']);
const VALID_TYPES = new Set(['all', 'sale', 'deposit', 'balance', 'gift_card', 'refund', 'commission', 'invoice']);
const VALID_STATUSES = new Set(['paid', 'pending', 'refunded', 'balance_due', 'failed', 'cancelled']);

export async function getFinanceDashboard(req, res) {
  try {
    const requested = String(req.query.range || 'today').toLowerCase();
    const range = VALID_RANGES.has(requested) ? requested : 'today';
    const referenceDate = req.query.referenceDate ? new Date(req.query.referenceDate) : null;
    const snapshot = await buildFinanceDashboard({
      range,
      referenceDate: referenceDate && !Number.isNaN(referenceDate.getTime()) ? referenceDate : null,
    });
    return res.json({ ok: true, ...snapshot });
  } catch (error) {
    console.error('Erreur Finance Dashboard', error);
    return res.status(500).json({ ok: false, error: 'Impossible de charger le tableau de bord financier.' });
  }
}

// RX2.2 — Financial Timeline : mouvements financiers narratifs + résumé filtrable.
export async function getFinanceTimeline(req, res) {
  try {
    const periodRaw = String(req.query.period || 'all').toLowerCase();
    const period = VALID_PERIODS.has(periodRaw) ? periodRaw : 'all';
    const typeRaw = String(req.query.type || 'all').toLowerCase();
    const type = VALID_TYPES.has(typeRaw) ? typeRaw : 'all';
    const statusRaw = String(req.query.status || '').toLowerCase();
    const status = VALID_STATUSES.has(statusRaw) ? statusRaw : '';
    const limit = Number(req.query.limit) || 50;

    const { dateFrom, dateTo } = resolveTimelineWindow(period);
    const { summary, items } = await buildFinanceTimeline({ dateFrom, dateTo, type, status, limit });
    return res.json({ ok: true, period, type, status: status || null, summary, items });
  } catch (error) {
    console.error('Erreur Finance Timeline', error);
    return res.status(500).json({ ok: false, error: 'Impossible de charger la timeline financière.' });
  }
}

const VALID_SOURCE_MODELS = new Set(['Sale', 'ServiceBooking', 'RefundRequest', 'GiftCardTransaction', 'CommissionPayment', 'Invoice']);

// RX2.3 — Détail d'un mouvement financier (breakdown paiement + profit net).
export async function getFinanceMovementDetail(req, res) {
  try {
    const sourceModel = String(req.query.sourceModel || '').trim();
    const sourceId = String(req.query.sourceId || '').trim();
    const type = String(req.query.type || '').trim();
    if (!VALID_SOURCE_MODELS.has(sourceModel) || !sourceId) {
      return res.status(400).json({ ok: false, error: 'Paramètres de mouvement invalides.' });
    }
    const detail = await buildFinanceMovementDetail({ sourceModel, sourceId, type });
    if (!detail) {
      return res.status(404).json({ ok: false, error: 'Mouvement introuvable.' });
    }
    return res.json({ ok: true, ...detail });
  } catch (error) {
    console.error('Erreur Finance Movement Detail', error);
    return res.status(500).json({ ok: false, error: 'Impossible de charger le détail du mouvement.' });
  }
}

// RX2.5 — Commissions premium (lecture). Réutilise le moteur ; respecte la date simulée (getNow).
export async function getCommissionOverview(req, res) {
  try {
    const now = await getNow();
    const overview = await getCurrentCommissionOverview(now);
    return res.json({ ok: true, ...overview });
  } catch (error) {
    console.error('Erreur Commission Overview', error);
    return res.status(500).json({ ok: false, error: 'Impossible de charger la commission du mois.' });
  }
}

export async function getCommissionHistory(req, res) {
  try {
    const now = await getNow();
    const history = await getCommissionPaymentHistory(now);
    return res.json({ ok: true, ...history });
  } catch (error) {
    console.error('Erreur Commission History', error);
    return res.status(500).json({ ok: false, error: 'Impossible de charger l\'historique des commissions.' });
  }
}

export async function getCommissionDetail(req, res) {
  try {
    const now = await getNow();
    const result = await getCommissionPaymentDetail(req.params.year, req.params.month, now);
    if (!result) return res.status(404).json({ ok: false, error: 'Commission introuvable.' });
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error('Erreur Commission Detail', error);
    return res.status(500).json({ ok: false, error: 'Impossible de charger le détail de la commission.' });
  }
}

// RX2.6 — Gift Card Finance (cycle de vie financier des cartes cadeaux).
export async function getGiftCardsFinance(req, res) {
  try {
    const result = await listGiftCardFinanceCards({
      creationMode: req.query.creationMode,
      status: req.query.status,
      search: req.query.search,
      limit: req.query.limit,
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error('Erreur Gift Card Finance list', error);
    return res.status(500).json({ ok: false, error: 'Impossible de charger les cartes cadeaux.' });
  }
}

export async function getGiftCardFinanceDetailHandler(req, res) {
  try {
    const detail = await getGiftCardFinanceDetail(req.params.giftCardId);
    if (!detail) return res.status(404).json({ ok: false, error: 'Carte cadeau introuvable.' });
    return res.json({ ok: true, ...detail });
  } catch (error) {
    console.error('Erreur Gift Card Finance detail', error);
    return res.status(500).json({ ok: false, error: 'Impossible de charger le détail de la carte cadeau.' });
  }
}
