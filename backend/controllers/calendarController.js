// controllers/calendarController.js
// M10 — Endpoint manager du calendrier GLOBAL de l'institut. Admin/dev uniquement
// (monté sous requireGestionRole, jamais client). Lecture seule, champs SAFE.
import { listGlobalCalendarItems, CALENDAR_ITEM_TYPES } from '../services/calendar/globalCalendarService.js';

const MAX_RANGE_DAYS = 92; // garde-fou : fenêtre ≤ ~3 mois

// ─── GET /api/gestion/calendar/items?startDate=&endDate=&type=&status= ─────────
export async function getCalendarItems(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { startDate, endDate, type = null, status = null } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ ok: false, error: 'startDate et endDate sont requis.' });
    }
    const from = new Date(startDate);
    const to = new Date(endDate);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
      return res.status(400).json({ ok: false, error: 'Plage de dates invalide.' });
    }
    if ((to - from) / (1000 * 60 * 60 * 24) > MAX_RANGE_DAYS) {
      return res.status(400).json({ ok: false, error: `Plage trop large (max ${MAX_RANGE_DAYS} jours).` });
    }
    if (type && !CALENDAR_ITEM_TYPES.includes(String(type))) {
      return res.status(400).json({ ok: false, error: 'type invalide.' });
    }

    const items = await listGlobalCalendarItems({
      startDate: from,
      endDate: to,
      type: type ? String(type) : null,
      status: status ? String(status) : null
    });

    return res.json({ ok: true, items });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ ok: false, error: error.message });
    }
    console.error('[calendarController] getCalendarItems error:', error?.message || error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export default { getCalendarItems };
