import mongoose from 'mongoose';
import Notification from '../models/Notification.js';
import NotificationConfig from '../models/NotificationConfig.js';
import { getSessionUserId } from '../utils/session.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// M3A — clause d'audience (panel) :
//   - 'dev'   → strictement targetRole === 'dev'.
//   - 'admin' → tout SAUF 'dev' (legacy-safe : inclut 'admin' + anciennes notifs
//               null / valeurs non-dev, donc aucune notif existante ne disparaît).
function audienceClause(audience) {
  return audience === 'dev' ? { targetRole: 'dev' } : { targetRole: { $ne: 'dev' } };
}

// Filtre d'accès : audience (panel) + granularité de livraison intra-audience
// (all / role / user-nominatif) + non expirée. Le clause "role" ne dépend plus de
// targetRole (devenu l'audience) : tout role-broadcast est visible dans son audience.
function buildAccessFilter(userId, audience) {
  const now = new Date();
  return {
    $and: [
      audienceClause(audience),
      {
        $or: [
          { targetType: 'all' },
          { targetType: 'role' },
          { targetType: 'user', targetUserId: new mongoose.Types.ObjectId(String(userId)) }
        ]
      },
      {
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
      }
    ]
  };
}

// Correspondance d'identifiant robuste : le paramètre d'URL peut être soit le `_id` Mongo
// (ce qu'envoie le frontend React : `notification.id` = `_id.toString()`), soit le
// `notificationId` métier (`NOTIF-XXXX`, utilisé par certains appels/tests). On matche les DEUX
// → corrige le 404 causé par le mismatch _id/notificationId, sans casser les appelants existants.
function buildIdClause(idParam) {
  const raw = String(idParam || '');
  const clauses = [{ notificationId: raw }];
  if (mongoose.Types.ObjectId.isValid(raw)) {
    clauses.push({ _id: new mongoose.Types.ObjectId(raw) });
  }
  return { $or: clauses };
}

// ─── Coeurs paramétrés par audience (admin | dev) ─────────────────────────────

async function listNotificationsCore(req, res, audience) {
  const userId = getSessionUserId(req);

  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const unreadOnly = req.query.unreadOnly === 'true';

    const filter = buildAccessFilter(userId, audience);
    if (unreadOnly) {
      filter.$and.push({ readBy: { $ne: new mongoose.Types.ObjectId(String(userId)) } });
    }

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const unreadCount = await Notification.countDocuments({
      ...buildAccessFilter(userId, audience),
      readBy: { $ne: new mongoose.Types.ObjectId(String(userId)) }
    });

    const serialized = notifications.map(n => ({
      id: n._id?.toString(),
      notificationId: n.notificationId,
      title: n.title,
      message: n.message,
      category: n.category,
      targetRole: n.targetRole || 'admin',
      targetType: n.targetType || 'all',
      link: n.link,
      linkLabel: n.linkLabel,
      eventType: n.eventType,
      eventName: n.eventName || null,
      contextType: n.contextType || null,
      contextId: n.contextId || null,
      // M9 — champs enrichis M8 exposés au centre de notifications React (SAFE :
      // categorySnapshot/priority/persistent/action sont des métadonnées d'affichage ;
      // variablesSnapshot N'EST PAS exposé).
      categoryId: n.categoryId ? String(n.categoryId) : null,
      categorySnapshot: n.categorySnapshot && (n.categorySnapshot.name || n.categorySnapshot.slug || n.categorySnapshot.icon || n.categorySnapshot.color)
        ? {
            name: n.categorySnapshot.name ?? null,
            slug: n.categorySnapshot.slug ?? null,
            icon: n.categorySnapshot.icon ?? null,
            color: n.categorySnapshot.color ?? null
          }
        : null,
      priority: n.priority || 'normal',
      persistent: Boolean(n.persistent),
      action: n.action || null,
      templateKey: n.templateKey || null,
      templateVersion: typeof n.templateVersion === 'number' ? n.templateVersion : null,
      isRead: n.readBy?.some(id => String(id) === String(userId)) || false,
      createdAt: n.createdAt,
      expiresAt: n.expiresAt || null
    }));

    return res.json({ ok: true, notifications: serialized, unreadCount });
  } catch (err) {
    console.error('[notificationController] listNotifications error:', err.message);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

async function markAsReadCore(req, res, audience) {
  const userId = getSessionUserId(req);

  try {
    const { notificationId } = req.params;
    const filter = buildAccessFilter(userId, audience);
    filter.$and.push(buildIdClause(notificationId));

    const notif = await Notification.findOne(filter);
    if (!notif) return res.status(404).json({ ok: false, error: 'Notification introuvable.' });

    const oid = new mongoose.Types.ObjectId(String(userId));
    if (!notif.readBy.some(id => String(id) === String(userId))) {
      notif.readBy.push(oid);
      await notif.save();
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[notificationController] markAsRead error:', err.message);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

async function markAllAsReadCore(req, res, audience) {
  const userId = getSessionUserId(req);

  try {
    const oid = new mongoose.Types.ObjectId(String(userId));
    await Notification.updateMany(
      {
        ...buildAccessFilter(userId, audience),
        readBy: { $ne: oid }
      },
      { $push: { readBy: oid } }
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('[notificationController] markAllAsRead error:', err.message);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

async function deleteNotificationCore(req, res, audience) {
  const userId = getSessionUserId(req);

  try {
    const { notificationId } = req.params;
    const filter = buildAccessFilter(userId, audience);
    filter.$and.push(buildIdClause(notificationId));
    const result = await Notification.deleteOne(filter);

    // Idempotent : une suppression déjà effectuée (0 supprimé) renvoie tout de même un succès,
    // pour que le frontend re-synchronise sa liste (invalidation onSuccess) au lieu de rester
    // bloqué sur un 404 répété. `deleted` indique si un document a réellement été retiré.
    return res.json({ ok: true, deleted: result.deletedCount > 0 });
  } catch (err) {
    console.error('[notificationController] deleteNotification error:', err.message);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

// ─── Manager/Admin (audience 'admin') ─────────────────────────────────────────
// GET/PATCH/DELETE /api/gestion/notifications  — accessible admin ET dev (gestionRoleGuard).

export function listNotifications(req, res) { return listNotificationsCore(req, res, 'admin'); }
export function markAsRead(req, res) { return markAsReadCore(req, res, 'admin'); }
export function markAllAsRead(req, res) { return markAllAsReadCore(req, res, 'admin'); }
export function deleteNotification(req, res) { return deleteNotificationCore(req, res, 'admin'); }

// ─── Dev (audience 'dev') ─────────────────────────────────────────────────────
// /api/gestion/dev/notifications — STRICTEMENT dev (requireStrictDev). Admin/client → 403.

export function listDevNotifications(req, res) { return listNotificationsCore(req, res, 'dev'); }
export function markDevNotificationAsRead(req, res) { return markAsReadCore(req, res, 'dev'); }
export function markAllDevNotificationsAsRead(req, res) { return markAllAsReadCore(req, res, 'dev'); }
export function deleteDevNotification(req, res) { return deleteNotificationCore(req, res, 'dev'); }

// ─── GET /api/gestion/notifications/config ────────────────────────────────────

export async function getConfig(req, res) {
  try {
    let config = await NotificationConfig.findOne().lean();
    if (!config) {
      return res.json({ ok: true, config: null });
    }
    return res.json({ ok: true, config });
  } catch (err) {
    console.error('[notificationController] getConfig error:', err.message);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

// ─── PUT /api/gestion/notifications/config ────────────────────────────────────

export async function updateConfig(req, res) {
  try {
    const { widgetPosition, pollingIntervalSeconds, notificationLifetimeDays, events, categories } = req.body || {};

    const update = {};
    if (typeof widgetPosition === 'string') update.widgetPosition = widgetPosition;
    if (typeof pollingIntervalSeconds === 'number') update.pollingIntervalSeconds = pollingIntervalSeconds;
    if (typeof notificationLifetimeDays === 'number') update.notificationLifetimeDays = notificationLifetimeDays;
    if (Array.isArray(events)) update.events = events;
    if (Array.isArray(categories)) update.categories = categories;

    const config = await NotificationConfig.findOneAndUpdate(
      {},
      { $set: update },
      { new: true, upsert: true, runValidators: true }
    );

    return res.json({ ok: true, config });
  } catch (err) {
    console.error('[notificationController] updateConfig error:', err.message);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

// ─── DELETE /api/gestion/notifications/config/categories/:categoryId ──────────

export async function deleteCategory(req, res) {
  try {
    const { categoryId } = req.params;
    const config = await NotificationConfig.findOne();
    if (!config) return res.status(404).json({ ok: false, error: 'Config introuvable.' });

    const cat = config.categories.find(c => c.id === categoryId);
    if (!cat) return res.status(404).json({ ok: false, error: 'Catégorie introuvable.' });
    const affectedCount = config.events.filter(e => e.category === categoryId).length;

    config.categories = config.categories.filter(c => c.id !== categoryId);
    config.events = config.events.map(e => {
      if (e.category === categoryId) {
        const plain = e.toObject ? e.toObject() : { ...e };
        plain.category = null;
        return plain;
      }
      return e;
    });
    await config.save();

    return res.json({ ok: true, affectedEvents: affectedCount, config });
  } catch (err) {
    console.error('[notificationController] deleteCategory error:', err.message);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}
