// subscribers/notificationEventSubscriber.js
// Phase 4D/4E — EventBus -> Notification subscriber. Idempotent, best-effort,
// in-app notifications ONLY (never sends an email).
//
// Coverage:
//   sale.finalized          -> notification "new_sale"
//   booking.no_show_marked  -> notification "no_show_recorded"
// (The mission text mentioned "new_client" for sale.finalized, but new_client is
//  the SIGNUP notification with no event source; "new_sale" is used for parity.
//  See report 66.)
//
// MODE (EVENT_NOTIFICATION_SUBSCRIBER_MODE, default "off"):
//   off    : handlers do nothing (no claim, no notification).
//   shadow : handler resolves variables + records a NotificationEventDelivery with
//            status "shadow" — but does NOT create the Notification (parity test).
//   active : creates the Notification (status "created"). An "active" run that
//            finds a prior "shadow" delivery UPGRADES it (so shadow->active works).
// Legacy alias: ENABLE_EVENT_NOTIFICATION_SUBSCRIBERS=true  =>  mode "active".
//
// GUARANTEES: never throws to the emitter; reuses triggerNotification; no email;
// no secret/sensitive payload (client email is intentionally NOT included).

import { subscribe } from '../services/eventBusService.js';
import { triggerNotification } from '../services/notificationService.js';
import NotificationEventDelivery from '../models/NotificationEventDelivery.js';
import Sale from '../models/Sale.js';
import ServiceBooking from '../models/ServiceBooking.js';

export function getSubscriberMode() {
  const m = String(process.env.EVENT_NOTIFICATION_SUBSCRIBER_MODE || '').trim().toLowerCase();
  if (m === 'off' || m === 'shadow' || m === 'active') return m;
  // Legacy alias.
  if (String(process.env.ENABLE_EVENT_NOTIFICATION_SUBSCRIBERS || '').trim() === 'true') return 'active';
  return 'off';
}

// Idempotent claim. Returns { proceed } — proceed=true means "create the notif now".
// In active mode, a pre-existing "shadow" delivery is upgraded to "created".
async function claimDelivery(key, eventLogId, mode) {
  const wantActive = mode === 'active';
  const existing = await NotificationEventDelivery.findOne(key);
  if (existing) {
    if (wantActive && existing.status === 'shadow') {
      existing.status = 'created';
      await existing.save();
      return { proceed: true };
    }
    return { proceed: false };
  }
  try {
    await NotificationEventDelivery.create({
      ...key,
      eventLogId: eventLogId || null,
      status: wantActive ? 'created' : 'shadow'
    });
    return { proceed: wantActive };
  } catch (err) {
    if (err?.code === 11000) {
      const concurrent = await NotificationEventDelivery.findOne(key);
      if (wantActive && concurrent?.status === 'shadow') {
        concurrent.status = 'created';
        await concurrent.save();
        return { proceed: true };
      }
      return { proceed: false };
    }
    throw err;
  }
}

// --- variable builders (parity with the direct triggerNotification calls) ---

async function buildNewSaleVars(contextId, eventLog) {
  let amount = eventLog?.payloadSafe?.totalAmount;
  try {
    const sale = await Sale.findOne({ saleId: String(contextId) }).select('saleId totalAmount').lean();
    if (sale && typeof sale.totalAmount === 'number') amount = sale.totalAmount;
  } catch (_err) {
    // best-effort: keep the EventLog payload amount
  }
  return {
    saleId: String(contextId),
    amount: typeof amount === 'number' ? amount.toFixed(2) : '—',
    link: '/gestion.html?page=ventes',
    linkLabel: 'Voir les ventes'
  };
}

async function buildNoShowVars(contextId) {
  let booking = null;
  try {
    booking = await ServiceBooking.findById(contextId)
      .populate('clientId', 'firstName lastName')
      .populate('serviceId', 'name')
      .lean();
  } catch (_err) {
    booking = null;
  }
  if (!booking) return null; // object not found -> no notification (best-effort)
  const client = booking.clientId || {};
  // Privacy: name only (NO email fallback, unlike the legacy direct call).
  const clientName = [client.firstName, client.lastName].filter(Boolean).join(' ') || '—';
  const serviceName = booking.serviceId?.name || '—';
  const bookingDate = booking.startAt
    ? new Date(booking.startAt).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : '—';
  return {
    bookingId: String(contextId),
    clientName,
    serviceName,
    bookingDate,
    link: '/gestion.html?page=planning',
    linkLabel: 'Voir le planning'
  };
}

// --- handlers ---

export async function handleSaleFinalizedNotification(eventLog) {
  try {
    const mode = getSubscriberMode();
    if (mode === 'off') return;
    if (!eventLog || eventLog.eventName !== 'sale.finalized') return;
    const contextId = eventLog.contextId || eventLog.payloadSafe?.saleId || null;
    if (!contextId) return;

    const vars = await buildNewSaleVars(contextId, eventLog);
    if (!vars) return;

    const key = { eventName: 'sale.finalized', contextType: 'sale', contextId: String(contextId), notificationType: 'new_sale' };
    const { proceed } = await claimDelivery(key, eventLog._id, mode);
    if (!proceed) return; // shadow, or already delivered

    // M3B — enrichit avec les variables du contexte standard + corrélation event→notif.
    const ctxVars = eventLog?.payloadSafe?.context?.variables || {};
    // M8 — `templateKey` explicite (= type) : le moteur consomme le NotificationTemplate
    // publié si présent, sinon fallback legacy. Le scope reste choisi par le moteur (M3A).
    await triggerNotification('new_sale', { ...ctxVars, ...vars }, {
      templateKey: 'new_sale',
      event: { eventId: eventLog._id, eventName: eventLog.eventName, contextType: eventLog.contextType || 'sale', contextId: String(contextId) }
    });
  } catch (err) {
    console.error('[notifSubscriber] sale.finalized handler error:', err?.message || err);
  }
}

export async function handleBookingNoShowNotification(eventLog) {
  try {
    const mode = getSubscriberMode();
    if (mode === 'off') return;
    if (!eventLog || eventLog.eventName !== 'booking.no_show_marked') return;
    const contextId = eventLog.contextId || eventLog.payloadSafe?.bookingId || null;
    if (!contextId) return;

    const vars = await buildNoShowVars(contextId);
    if (!vars) return; // object not found -> no notification

    const key = { eventName: 'booking.no_show_marked', contextType: 'service_booking', contextId: String(contextId), notificationType: 'no_show_recorded' };
    const { proceed } = await claimDelivery(key, eventLog._id, mode);
    if (!proceed) return;

    // M3B — enrichit avec les variables du contexte standard + corrélation event→notif.
    const ctxVars = eventLog?.payloadSafe?.context?.variables || {};
    // M8 — `templateKey` explicite (= type) ; scope choisi par le moteur (M3A).
    await triggerNotification('no_show_recorded', { ...ctxVars, ...vars }, {
      templateKey: 'no_show_recorded',
      event: { eventId: eventLog._id, eventName: eventLog.eventName, contextType: eventLog.contextType || 'service_booking', contextId: String(contextId) }
    });
  } catch (err) {
    console.error('[notifSubscriber] no_show handler error:', err?.message || err);
  }
}

// Register subscribers (Set dedup in the bus => calling twice is a no-op).
export function registerNotificationSubscribers() {
  subscribe('sale.finalized', handleSaleFinalizedNotification);
  subscribe('booking.no_show_marked', handleBookingNoShowNotification);
}

export default registerNotificationSubscribers;
