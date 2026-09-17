import mongoose from 'mongoose';

import Formation from '../models/Formation.js';
import FormationSession, {
  buildActiveFormationSessionFilter,
  isInactiveFormationSessionStatus
} from '../models/FormationSession.js';
import Purchase from '../models/Purchase.js';
import User from '../models/user.js';
import { buildSessionPayload } from './formationSessionController.js';

function toDateKey(date) {
  if (!date) return null;
  const target = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(target.getTime())) return null;
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, '0');
  const day = String(target.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildSessionDateKeys(startDate, durationDays) {
  const count = Number.isFinite(durationDays) ? Math.max(1, Math.floor(durationDays)) : 1;
  if (!startDate) return [];
  const base = startDate instanceof Date ? startDate : new Date(startDate);
  if (Number.isNaN(base.getTime())) return [];
  const keys = [];
  for (let offset = 0; offset < count; offset += 1) {
    const current = new Date(base);
    current.setDate(base.getDate() + offset);
    const key = toDateKey(current);
    if (key) {
      keys.push(key);
    }
  }
  return keys;
}

export async function getPlanningOverview(req, res) {
  try {
    const sessions = await FormationSession.find(buildActiveFormationSessionFilter({ reservedCount: { $gt: 0 } }))
      .sort({ startDate: 1 })
      .lean();
    const formationIds = Array.from(
      new Set(sessions.map(entry => entry.formationId?.toString()).filter(Boolean))
    );
    const formations = formationIds.length ? await Formation.find({ _id: { $in: formationIds } }).lean() : [];
    const formationMap = new Map(formations.map(f => [f._id?.toString(), f]));
    const days = {};
    for (const session of sessions) {
      const payload = buildSessionPayload(session);
      if (!payload) continue;
      const dateKey = toDateKey(payload.startDate);
      if (!dateKey) continue;
      const formation = formationMap.get(session.formationId?.toString());
      const entry = {
        id: payload.id,
        formationId: session.formationId?.toString(),
        formationName: formation?.name || 'Formation',
        formationCover: formation?.coverImage || '',
        startDate: payload.startDate ? new Date(payload.startDate).toISOString() : null,
        startDateKey: toDateKey(payload.startDate),
        durationDays: payload.durationDays,
        durationLabel: payload.durationLabel,
        schedule: payload.schedule,
        reservedCount: payload.reservedCount,
        maxClients: payload.maxClients,
        placesRemaining: payload.placesRemaining,
        isAvailable: payload.isAvailable
      };
      buildSessionDateKeys(payload.startDate, payload.durationDays).forEach(key => {
        days[key] = days[key] || [];
        days[key].push(entry);
      });
    }
    return res.json({ ok: true, days });
  } catch (error) {
    console.error('Impossible de charger le planning', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire le planning.' });
  }
}

export async function getPlanningSessionDetail(req, res) {
  try {
    const sessionId = String(req.params.sessionId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ ok: false, error: 'Session invalide.' });
    }
    const session = await FormationSession.findById(sessionId).lean();
    if (!session) {
      return res.status(404).json({ ok: false, error: 'Session introuvable.' });
    }
    if (isInactiveFormationSessionStatus(session.status)) {
      return res.status(404).json({ ok: false, error: 'Session introuvable.' });
    }
    if ((session.reservedCount ?? 0) <= 0) {
      return res.status(400).json({ ok: false, error: 'Aucune réservation associée à cette session.' });
    }
    const formation = await Formation.findById(session.formationId).lean();
    if (!formation || formation.type !== 'presentiel') {
      return res.status(404).json({ ok: false, error: 'Formation présentielle introuvable.' });
    }
    const payload = buildSessionPayload(session);
    if (!payload) {
      return res.status(404).json({ ok: false, error: 'Session introuvable.' });
    }
    const participantsPurchases = await Purchase.find({
      sessionId: session._id,
      itemType: 'formation'
    }).sort({ createdAt: 1 }).lean();
    const userIds = Array.from(
      new Set(participantsPurchases.map(entry => entry.userId?.toString()).filter(Boolean))
    );
    const users = userIds.length ? await User.find({ _id: { $in: userIds } }).lean() : [];
    const userMap = new Map(users.map(user => [user._id?.toString(), user]));
    const participants = participantsPurchases
      .map(entry => {
        const user = userMap.get(entry.userId?.toString());
        const status = String(entry.participationStatus || 'active').trim() || 'active';
        const selectedOptions = Array.isArray(entry.selectedOptions)
          ? entry.selectedOptions.map(opt => ({
              optionId: opt.optionId?.toString() || '',
              name: opt.name || '',
              price: Number.isFinite(Number(opt.price)) ? Number(opt.price) : 0
            }))
          : [];
        return {
          id: entry.userId?.toString(),
          firstName: user?.firstName || '',
          lastName: user?.lastName || '',
          email: user?.email || '',
          phone: user?.phone || '',
          joinedAt: entry.createdAt,
          status,
          canceledAt: entry.canceledAt || null,
          selectedOptions
        };
      })
      .sort((a, b) => {
        if (a.status !== b.status) {
          return a.status === 'active' ? -1 : 1;
        }
        return new Date(a.joinedAt || 0) - new Date(b.joinedAt || 0);
      });
    return res.json({
      ok: true,
      formation: {
        id: formation._id?.toString(),
        name: formation.name,
        coverImage: formation.coverImage || '',
        coverUrl: formation.coverImage || ''
      },
      session: {
        ...payload,
        startDateKey: toDateKey(payload.startDate)
      },
      participants
    });
  } catch (error) {
    console.error('Impossible de lire le détail de session', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire le détail de la session.' });
  }
}

export async function getSessionAttendees(req, res) {
  try {
    const sessionId = String(req.params.sessionId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ ok: false, error: 'Session invalide.' });
    }
    const session = await FormationSession.findById(sessionId).lean();
    if (!session) {
      return res.status(404).json({ ok: false, error: 'Session introuvable.' });
    }

    const formation = await Formation.findById(session.formationId).lean();
    const payload = buildSessionPayload(session);

    const participantsPurchases = await Purchase.find({
      sessionId: session._id,
      itemType: 'formation'
    }).sort({ createdAt: 1 }).lean();

    const userIds = Array.from(
      new Set(participantsPurchases.map(e => e.userId?.toString()).filter(Boolean))
    );
    const users = userIds.length ? await User.find({ _id: { $in: userIds } }).lean() : [];
    const userMap = new Map(users.map(u => [u._id?.toString(), u]));

    const participants = participantsPurchases.map(entry => {
      const user = userMap.get(entry.userId?.toString());
      const status = String(entry.participationStatus || 'active').trim() || 'active';
      const selectedOptions = Array.isArray(entry.selectedOptions)
        ? entry.selectedOptions.map(opt => ({
            optionId: opt.optionId?.toString() || '',
            name: opt.name || '',
            price: Number.isFinite(Number(opt.price)) ? Number(opt.price) : 0
          }))
        : [];
      return {
        id: entry.userId?.toString(),
        firstName: user?.firstName || '',
        lastName: user?.lastName || '',
        email: user?.email || '',
        joinedAt: entry.createdAt,
        status,
        canceledAt: entry.canceledAt || null,
        selectedOptions
      };
    }).sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      return new Date(a.joinedAt || 0) - new Date(b.joinedAt || 0);
    });

    return res.json({
      ok: true,
      formation: formation ? { id: formation._id?.toString(), name: formation.name } : null,
      session: payload || null,
      isSessionPast: payload?.startDate ? new Date(payload.startDate) <= new Date() : false,
      participants
    });
  } catch (error) {
    console.error('getSessionAttendees error', error);
    return res.status(500).json({ ok: false, error: 'Impossible de charger les participants.' });
  }
}
