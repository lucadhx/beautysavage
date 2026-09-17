// controllers/mailSupervisionController.js
// M3E — Handlers de supervision mail (lecture seule). Le roleView est imposé par la route
// (dev → 'dev' via requireStrictDev ; admin → 'admin'). Aucune écriture, aucun secret.

import {
  listMailEventDeliveries,
  getMailEventDeliveryDetail,
  getMailSupervisionStats,
  listSendLogsForSupervision,
  getSendLogSupervisionStats
} from '../services/mail/mailSupervisionService.js';

function readFilters(req) {
  const q = req.query || {};
  return {
    status: q.status,
    eventName: q.eventName,
    templateKey: q.templateKey,
    fromRole: q.fromRole,
    toRole: q.toRole,
    contextType: q.contextType,
    contextId: q.contextId,
    dateFrom: q.dateFrom,
    dateTo: q.dateTo,
    limit: q.limit
  };
}

function makeHandlers(roleView) {
  return {
    listDeliveries: async (req, res) => {
      try {
        const result = await listMailEventDeliveries({ roleView, ...readFilters(req) });
        return res.json({ ok: true, roleView, ...result });
      } catch (error) {
        console.error('[mailSupervision] listDeliveries error', error?.message || error);
        return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
      }
    },
    getDeliveryDetail: async (req, res) => {
      try {
        const dto = await getMailEventDeliveryDetail(req.params.id, { roleView });
        if (!dto) return res.status(404).json({ ok: false, error: 'Livraison introuvable.' });
        return res.json({ ok: true, roleView, delivery: dto });
      } catch (error) {
        console.error('[mailSupervision] getDeliveryDetail error', error?.message || error);
        return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
      }
    },
    deliveryStats: async (req, res) => {
      try {
        const stats = await getMailSupervisionStats({ roleView, dateFrom: req.query?.dateFrom, dateTo: req.query?.dateTo });
        return res.json({ ok: true, stats });
      } catch (error) {
        console.error('[mailSupervision] deliveryStats error', error?.message || error);
        return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
      }
    },
    listSendLogs: async (req, res) => {
      try {
        const result = await listSendLogsForSupervision({ roleView, ...readFilters(req) });
        return res.json({ ok: true, roleView, ...result });
      } catch (error) {
        console.error('[mailSupervision] listSendLogs error', error?.message || error);
        return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
      }
    },
    sendLogStats: async (req, res) => {
      try {
        const stats = await getSendLogSupervisionStats({ roleView, dateFrom: req.query?.dateFrom, dateTo: req.query?.dateTo });
        return res.json({ ok: true, stats });
      } catch (error) {
        console.error('[mailSupervision] sendLogStats error', error?.message || error);
        return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
      }
    }
  };
}

export const devMailSupervision = makeHandlers('dev');
export const adminMailSupervision = makeHandlers('admin');
