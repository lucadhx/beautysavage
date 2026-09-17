// services/customer360/customer360Service.js
// M12 — Agrégation Customer 360 (Client Hub). Réunit Sale, ServiceBooking, Purchase, GiftCard,
// RefundRequest, Invoice, Notification, SendLog, EventLog autour d'un client (User role 'client').
// Toutes les requêtes en parallèle (.lean()). Aucun modèle modifié ; sérialisation SAFE via le mapper.

import mongoose from 'mongoose';

import User from '../../models/user.js';
import Sale from '../../models/Sale.js';
import ServiceBooking from '../../models/ServiceBooking.js';
import Purchase from '../../models/Purchase.js';
import GiftCard from '../../models/GiftCard.js';
import RefundRequest from '../../models/RefundRequest.js';
import Invoice from '../../models/Invoice.js';
import Notification from '../../models/Notification.js';
import SendLog from '../../models/SendLog.js';
import EventLog from '../../models/EventLog.js';
import Formation from '../../models/Formation.js';
import FormationProgress from '../../models/FormationProgress.js';
import SessionAttendance from '../../models/SessionAttendance.js';
import Product from '../../models/Product.js';
import { hashRecipient } from '../sendLogService.js';
import {
  mapCustomerIdentity, mapSale, mapBooking, mapFormation, mapProduct, mapGiftCard,
  mapRefund, mapInvoice, mapCommunication, mapNotification, buildDocuments, buildSummary, buildFinancial
} from './customer360Mapper.js';
import { buildCustomerTimeline } from './customer360TimelineBuilder.js';

function notFound(message) {
  return Object.assign(new Error(message), { status: 404, code: 'CUSTOMER_NOT_FOUND' });
}

/**
 * Construit la fiche Customer 360 complète.
 * @param {string} customerId
 * @returns {Promise<object>} payload Customer360 (customer/summary/timeline/sections/financial).
 */
export async function buildCustomer360(customerId) {
  if (!customerId || !mongoose.Types.ObjectId.isValid(String(customerId))) {
    throw Object.assign(new Error('Client invalide.'), { status: 400, code: 'INVALID_CUSTOMER_ID' });
  }
  const customer = await User.findOne({ _id: customerId, role: 'client' }).lean();
  if (!customer) throw notFound('Client introuvable.');

  // 1. Entités directement rattachées au client (parallèle).
  const [salesRaw, bookingsRaw, purchasesRaw, giftCardsRaw, refundsRaw] = await Promise.all([
    Sale.find({ userId: customer._id }).sort({ createdAt: -1 }).lean(),
    ServiceBooking.find({ clientId: customer._id }).populate('serviceId', 'name').sort({ startAt: -1 }).lean(),
    Purchase.find({ userId: customer._id }).sort({ createdAt: -1 }).lean(),
    GiftCard.find({ userId: customer._id }).sort({ purchasedAt: -1 }).lean(),
    RefundRequest.find({ userId: customer._id }).sort({ requestedAt: -1 }).lean()
  ]);

  // 2. Résolution des noms (formations / produits) référencés par les Purchase.
  const formationIds = [...new Set(purchasesRaw.filter(p => p.itemType === 'formation').map(p => String(p.formationId || p.itemId)).filter(Boolean))];
  const productIds = [...new Set(purchasesRaw.filter(p => p.itemType === 'product').map(p => String(p.itemId)).filter(Boolean))];
  const saleIds = salesRaw.map(s => String(s.saleId || '').trim()).filter(Boolean);
  const recipientHash = hashRecipient(customer.email);

  // C2 — sessions présentielles réservées (pour la présence) + ids learning corrélés.
  const sessionIds = [...new Set(purchasesRaw.map(p => String(p.sessionId || '')).filter(Boolean))];

  // contextId corrélés (events/notifs/sendlogs) : saleId + ids DB + ids métier.
  const contextIds = [
    ...saleIds,
    ...bookingsRaw.flatMap(b => [String(b._id), b.bookingId].filter(Boolean)),
    ...refundsRaw.flatMap(r => [String(r._id), r.refundId].filter(Boolean)),
    ...giftCardsRaw.map(g => String(g._id)),
    // C2 — formation/session ids → les EventLog learning (formation.started/completed, présence) sont récupérés.
    ...formationIds,
    ...sessionIds
  ];

  // 3. Entités corrélées (parallèle).
  const [formations, products, invoicesRaw, notificationsRaw, sendLogsRaw, eventLogsRaw] = await Promise.all([
    formationIds.length ? Formation.find({ _id: { $in: formationIds } }).select('name type').lean() : [],
    productIds.length ? Product.find({ _id: { $in: productIds } }).select('name').lean() : [],
    Invoice.find({ $or: [{ userId: customer._id }, ...(saleIds.length ? [{ saleId: { $in: saleIds } }] : [])] }).lean(),
    contextIds.length ? Notification.find({ contextId: { $in: contextIds } }).sort({ createdAt: -1 }).limit(100).lean() : [],
    SendLog.find({
      $or: [
        ...(recipientHash ? [{ recipientHash }] : []),
        ...(contextIds.length ? [{ contextId: { $in: contextIds } }] : [])
      ]
    }).sort({ createdAt: -1 }).limit(150).lean(),
    contextIds.length ? EventLog.find({ contextId: { $in: contextIds } }).sort({ createdAt: -1 }).limit(200).lean() : []
  ]);

  const formationById = new Map(formations.map(f => [String(f._id), f]));
  const productById = new Map(products.map(p => [String(p._id), p]));

  // C2 — progression + présence (learning), best-effort additif.
  const [progressRaw, attendanceRaw] = await Promise.all([
    formationIds.length ? FormationProgress.find({ userId: customer._id, formationId: { $in: formationIds } }).lean() : [],
    sessionIds.length ? SessionAttendance.find({ userId: customer._id, sessionId: { $in: sessionIds } }).lean() : []
  ]);
  const progressByFormation = new Map(progressRaw.map(p => [String(p.formationId), p]));
  const attendanceBySession = new Map(attendanceRaw.map(a => [String(a.sessionId), a]));

  // 4. Mapping SAFE.
  const sales = salesRaw.map(mapSale);
  const bookings = bookingsRaw.map(b => mapBooking(b));
  const mappedFormations = purchasesRaw.filter(p => p.itemType === 'formation').map(p => mapFormation(p, formationById, progressByFormation, attendanceBySession));
  const mappedProducts = purchasesRaw.filter(p => p.itemType === 'product').map(p => mapProduct(p, productById));
  const giftCards = giftCardsRaw.map(mapGiftCard);
  const refunds = refundsRaw.map(mapRefund);
  const invoices = invoicesRaw.map(mapInvoice);
  const communications = sendLogsRaw.map(mapCommunication);
  const notifications = notificationsRaw.map(mapNotification);
  const documents = buildDocuments({ invoices: invoicesRaw, refunds: refundsRaw, sales: salesRaw });

  // 5. Timeline (entités mappées + EventLog curé).
  const timeline = buildCustomerTimeline({
    sales, bookings, formations: mappedFormations, products: mappedProducts, giftCards, refunds,
    invoices, communications, notifications, eventLogs: eventLogsRaw
  });

  // 6. Résumé + financier.
  const summary = buildSummary({
    customer, sales: salesRaw, bookings, formations: mappedFormations,
    products: mappedProducts, giftCards, refunds, timeline
  });
  const financial = buildFinancial({ sales: salesRaw, bookings, giftCards, refunds, invoices: invoicesRaw });

  return {
    customer: mapCustomerIdentity(customer),
    summary,
    timeline,
    sales,
    bookings,
    formations: mappedFormations,
    products: mappedProducts,
    giftCards,
    refunds,
    documents,
    communications,
    notifications,
    financial
  };
}

/**
 * Recherche rapide de clients (nom/prénom/e-mail) + carte résumé (dernière visite / prochaine résa).
 * @param {{ search?: string, limit?: number }} params
 */
export async function searchCustomers({ search = '', limit = 25 } = {}) {
  const term = String(search || '').trim();
  const cap = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const query = term
    ? {
        role: 'client',
        $or: [
          { email: { $regex: term, $options: 'i' } },
          { firstName: { $regex: term, $options: 'i' } },
          { lastName: { $regex: term, $options: 'i' } }
        ]
      }
    : { role: 'client' };

  const clients = await User.find(query).sort({ createdAt: -1 }).limit(cap).lean();
  if (!clients.length) return [];
  const ids = clients.map(c => c._id);

  const [salesAgg, bookingsAgg] = await Promise.all([
    Sale.aggregate([
      { $match: { userId: { $in: ids } } },
      { $group: { _id: '$userId', salesCount: { $sum: 1 }, totalSpent: { $sum: '$totalAmount' }, lastSaleAt: { $max: '$createdAt' } } }
    ]),
    ServiceBooking.aggregate([
      { $match: { clientId: { $in: ids }, status: { $in: ['confirmed', 'pending_payment'] }, startAt: { $gt: new Date() } } },
      { $group: { _id: '$clientId', nextStartAt: { $min: '$startAt' } } }
    ])
  ]);
  const salesMap = new Map(salesAgg.map(e => [String(e._id), e]));
  const nextMap = new Map(bookingsAgg.map(e => [String(e._id), e.nextStartAt]));

  return clients.map(c => {
    const key = String(c._id);
    const s = salesMap.get(key);
    return {
      id: key,
      displayName: `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email || '—',
      firstName: c.firstName || '',
      lastName: c.lastName || '',
      email: c.email || '',
      createdAt: c.createdAt || null,
      bookingSuspended: Boolean(c.bookingSuspended),
      salesCount: s?.salesCount || 0,
      totalSpent: Math.round(Number(s?.totalSpent || 0) * 100) / 100,
      lastVisitAt: s?.lastSaleAt || c.lastLogin || null,
      nextBookingAt: nextMap.get(key) || null
    };
  });
}

export default { buildCustomer360, searchCustomers };
